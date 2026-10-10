// Kein Shebang: wird per `node scripts/langfuse-nachliefern.mjs` gestartet UND von test/harness/langfuse-nachliefern.test.ts importiert.
/**
 * Langfuse nachliefern (#1577, Teil 2a/3 von #1556): sendet die laut Abgleich fehlenden Calls per OTLP/HTTP-JSON nach,
 * idempotent. Bewusst ein eigenes Modul: `langfuse-abgleich.mjs --pruefen` bleibt beweisbar lesend. Dubletten werden nur gemeldet.
 *
 *   node scripts/langfuse-nachliefern.mjs [--session <id>] [--seit <ISO>] [--aktuell <id>] [--beendet <id>] [--ausloeser sessionstart|sessionend] [--trocken] [--json]
 *
 * Idempotenz: je Session zuerst das Ist (zwei Metrics-Abfragen, bei Differenz Observations), gesendet wird `fehlend` minus
 * Ledger-`gesendet` (`~/.claude/state/langfuse-abgleich.json`, nur eine Brücke über den Ingestion-Verzug). Ein kaputtes oder
 * fehlendes Ledger kostet höchstens Abfragen, nie eine Doppelsendung. Importiert nur Builtins und hook-taugliche Module
 * (Hook-Verdrahtung: #1578, Einstieg scripts/langfuse-abgleich-hook.mjs; mit --ausloeser laufen Wartezeit, Lock und Log, ohne nur Lock und Log). Aufruf: docs/referenz/befehle.md, Einordnung: docs/model-routing.md › Checkliste Punkt 1.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { hauptrepoPfad, ladeSessionDatei, projektSlug } from "./transkript.mjs";
import {
  diffMultimenge,
  findeSessions,
  hatDifferenz,
  istAbfragen,
  istAusMetrics,
  holeMetrics,
  RUHEFRIST_MIN,
  scoreId,
  sollEintraege,
} from "./langfuse-abgleich-kern.mjs";
import { fetchSessionObservations, langfuseZugang, sendeOtlp, sendeScore } from "./langfuse-api.mjs";
import { bauePayloads } from "./langfuse-otlp.mjs";
import { gesperrterLauf, lockMeldung, warte, zeigenswert } from "./langfuse-lock.mjs";

/** Sessions mit einem Call vor diesem Zeitpunkt werden nur gezählt: davor fehlt die TTL-Aufteilung der Cache-Writes, der Fingerabdruck passt nicht zu Langfuse (vgl. langfuse-abgleich.mjs). */
export const STICHTAG = "2026-10-07T00:00:00Z";
/** Ohne bekanntes Ende gilt eine Session erst nach dieser Ruhe als beendet (eine untätig offene Parallelsession bleibt unberührt). */
export const RUHEFRIST_OHNE_ENDE_H = 24;
/** Ruhe bei bekanntem Ende (SessionEnd): kürzer als die Wartezeit des Hooks (WARTE_SESSIONEND in langfuse-abgleich-hook), damit der Lauf nach dem Warten sendet. */
export const RUHEFRIST_BEENDET_MS = 150_000;
const LEDGER_NAME = "langfuse-abgleich.json";
/** Zeitversatz zwischen dem Ende-Zeitpunkt des Hooks und der letzten Transkript-Änderung. */
export const ENDE_SCHLUPF_MS = 5_000;
/** Ein Ledger-`gesendet` gilt so lange als unterwegs (Ingestion-Verzug), danach wird ein noch fehlender Call erneut gesendet (die IDs sind deterministisch, eine Wiederholung ist ungefährlich). */
export const GESENDET_ABLAUF_MS = 4 * RUHEFRIST_MIN * 60_000;
/** Gesamtfrist eines Laufs: unter LOCK_VERALTET_MS (15 min), damit kein Lauf länger hängt als sein Lock; übrige Sessions folgen beim nächsten Lauf. */
export const GESAMTFRIST_MS = 10 * 60_000;

export const AUFRUFHILFE = "Aufruf: node scripts/langfuse-nachliefern.mjs [--session <id>] [--seit <ISO>] [--aktuell <id>] [--beendet <id>] [--ausloeser sessionstart|sessionend] [--trocken] [--json]";
export const OHNE_ZUGANG = "Kein Langfuse-Zugang: LANGFUSE_PUBLIC_KEY + LANGFUSE_SECRET_KEY fehlen (aus der Umgebung, im Hook zusätzlich aus ~/.langfuse-secret und den Plugin-Optionen; Agentenläufe haben den Secret-Key nicht).";
const AUSLOESER = ["sessionstart", "sessionend"];

/** Unbekanntes Flag oder fehlender Wert: `fehler` gesetzt (der Aufrufer meldet Exit 2). */
export function parseArgs(argv) {
  const a = { session: null, seit: null, aktuell: null, beendet: null, ausloeser: null, trocken: false, json: false, fehler: null };
  const mitWert = { "--session": "session", "--seit": "seit", "--aktuell": "aktuell", "--beendet": "beendet", "--ausloeser": "ausloeser" };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === "--trocken") a.trocken = true;
    else if (k === "--json") a.json = true;
    else if (k in mitWert) {
      const wert = argv[++i];
      if (wert === undefined || wert.startsWith("--")) a.fehler = `${k} braucht einen Wert`;
      else if (k === "--ausloeser" && !AUSLOESER.includes(wert)) a.fehler = `--ausloeser: erlaubt sind ${AUSLOESER.join(", ")}`;
      else a[mitWert[k]] = wert;
    } else a.fehler = `Unbekanntes Argument: ${k}`;
  }
  return a;
}

// ── Ledger ───────────────────────────────────────────────────────────────────

const leeresLedger = () => ({ version: 1, sessions: {} });
const istLedger = (j) => j?.version === 1 && j.sessions && typeof j.sessions === "object" && !Array.isArray(j.sessions);

/** `{ ledger, kaputt }`; fehlende Datei = leer, kaputte (kein JSON oder falsche Form) = leer und `kaputt` (der Aufrufer sichert sie). */
function ledgerLesen(datei) {
  if (!existsSync(datei)) return { ledger: leeresLedger(), kaputt: false };
  try {
    const j = JSON.parse(readFileSync(datei, "utf8"));
    if (istLedger(j)) return { ledger: j, kaputt: false };
  } catch {
    // fällt auf kaputt
  }
  return { ledger: leeresLedger(), kaputt: true };
}

/** Atomar: erst `<datei>.tmp`, dann `rename`. */
function ledgerSchreiben(datei, ledger) {
  mkdirSync(join(datei, ".."), { recursive: true });
  const tmp = `${datei}.tmp`;
  writeFileSync(tmp, JSON.stringify(ledger, null, 2) + "\n");
  renameSync(tmp, datei);
}

// ── Eine Session ─────────────────────────────────────────────────────────────

const OBS_FELDER = "core,basic,model,usage,metadata";

/** Zahl, die ein Score trägt: Anteil der Soll-Calls, die in Langfuse stehen (oder unterwegs sind). */
const quote = (n, fehlend) => (n ? (n - fehlend) / n : 1);

async function istUndDiff({ s, soll, zugang, now, fetchImpl }) {
  const fruehester = Math.min(...soll.map((e) => Date.parse(e.ts)).filter(Number.isFinite));
  const q = istAbfragen({ von: new Date(fruehester - 3_600_000).toISOString(), bis: new Date(now + 60_000).toISOString(), session: s.id });
  const rows = [];
  for (const abfrage of [q.zaehlung, q.tokens]) rows.push(...(await holeMetrics(abfrage, zugang, fetchImpl)));
  const ist = istAusMetrics(rows).get(s.id) ?? { calls: 0, tokens: null };
  if (!hatDifferenz(soll, { calls: ist.calls ?? 0, tokens: ist.tokens })) return { observations: null, diff: null };
  const observations = await fetchSessionObservations(s.id, { ...zugang, fetchImpl, type: "GENERATION", fields: OBS_FELDER });
  return { observations, diff: diffMultimenge(soll, observations) };
}

/** Scores einer Session (deterministische IDs, Upsert). `erfassung_hook` nur, wenn Observations geholt wurden oder bei Δ = 0 ohne Ledger-`gesendet`. */
function scoresFuer({ s, soll, observations, rest, ledgerGesendet, env }) {
  const n = soll.length;
  const basis = { dataType: "NUMERIC", sessionId: s.id, ...(env.LANGFUSE_TRACING_ENVIRONMENT ? { environment: env.LANGFUSE_TRACING_ENVIRONMENT } : {}) };
  const scores = [{ ...basis, id: scoreId(s.id, "erfassung"), name: "erfassung", value: quote(n, rest) }];
  if (observations) {
    const hook = diffMultimenge(soll, observations.filter((o) => o?.metadata?.quelle !== "abgleich"));
    scores.push({ ...basis, id: scoreId(s.id, "erfassung_hook"), name: "erfassung_hook", value: quote(n, hook.fehlend.length) });
  } else if (!ledgerGesendet.length) {
    scores.push({ ...basis, id: scoreId(s.id, "erfassung_hook"), name: "erfassung_hook", value: 1 });
  }
  return scores;
}

async function sendeChunks({ s, chunks, eintrag, zugang, fetchImpl, protokoll, rec, now }) {
  for (const chunk of chunks) {
    try {
      await sendeOtlp(chunk.payload, { ...zugang, fetchImpl });
    } catch (e) {
      protokoll.fehler.push({ session: s.id, status: e.status ?? null, meldung: e.message });
      return false;
    }
    eintrag.gesendet.push(...chunk.generationIds);
    for (const id of chunk.generationIds) eintrag.gesendetAm[id] = now;
    eintrag.spans.push(...chunk.spanIds);
    rec.gesendet += chunk.generationIds.length;
    protokoll.gesendet += chunk.generationIds.length;
    protokoll.spans += chunk.spanIds.length;
  }
  return true;
}

/** Eine Session bis zum Ledger-Stand; mutiert `ledger.sessions[id]` nur um angenommene Chunks und eine vollständige Bestätigung. */
async function verarbeite(s, c) {
  const { args, ledger, zugang, env, now, fetchImpl, repoRoot, protokoll } = c;
  const alt = ledger.sessions[s.id];
  const unveraendert = alt && alt.groesse === s.groesse && alt.mtime === s.mtime;
  const rec = { session: s.id, status: "", gesendet: 0, dubletten: 0, wuerdeSenden: 0, ausstehend: 0, befund: null, endeVerworfen: false };
  protokoll.sessions.push(rec);
  if (args.aktuell === s.id) return Object.assign(rec, { status: "aktuell" });
  // Das SessionEnd-Kind wartet 3 min: wuchs das Transkript danach (resume), gilt das Ende nicht mehr und die laufende Session bleibt unberührt.
  const endeGilt = args.ende == null || s.mtime <= args.ende + ENDE_SCHLUPF_MS;
  const endeAngegeben = args.beendet === s.id || args.session === s.id;
  const endeBekannt = endeAngegeben && endeGilt;
  // Ob Claude Code nach dem SessionEnd-Hook noch länger ins Transkript schreibt, zeigt dieses Logfeld (sonst fiele jede Session still auf die 24-h-Frist zurück).
  rec.endeVerworfen = endeAngegeben && !endeGilt;
  const beendet = endeBekannt || Boolean(alt?.beendet && unveraendert);
  const ruheMs = beendet ? RUHEFRIST_BEENDET_MS : RUHEFRIST_OHNE_ENDE_H * 3_600_000;
  // Bekanntes Ende vor jedem Fetch festhalten (auch wenn dieser wirft), sonst gälte beim nächsten Lauf wieder die 24-h-Frist.
  if (endeBekannt && !args.trocken) ledger.sessions[s.id] = { gesendet: [], spans: [], ...alt, pfad: s.pfad, groesse: s.groesse, mtime: s.mtime, bestaetigt: Boolean(alt?.bestaetigt && unveraendert), beendet: true };
  if (now - s.mtime < ruheMs) return Object.assign(rec, { status: "läuft" });
  if (alt?.bestaetigt && unveraendert) return Object.assign(rec, { status: "bestätigt" });
  // Sessions vor dem Stichtag und ohne Calls: der Vermerk spart bei unverändertem Stand das erneute Parsen und die Abfrage.
  if (alt?.vermerk && unveraendert) return Object.assign(rec, { status: alt.vermerk });
  const vermerke = (status) => {
    if (!args.trocken) ledger.sessions[s.id] = { gesendet: [], spans: [], gesendetAm: {}, pfad: s.pfad, groesse: s.groesse, mtime: s.mtime, bestaetigt: false, beendet, vermerk: status };
  };
  const soll = sollEintraege(ladeSessionDatei(s.pfad), { session: s.id });
  if (!soll.length) {
    vermerke("ohne Calls");
    return Object.assign(rec, { status: "ohne Calls" });
  }
  const vorStichtag = Math.min(...soll.map((e) => Date.parse(e.ts)).filter(Number.isFinite)) < Date.parse(STICHTAG);
  if (vorStichtag) {
    vermerke("vor Stichtag");
    // Würde-senden-Zahl für den Bericht nur im ersten Lauf: der Vermerk überspringt die Abfrage bei unverändertem Stand.
  }
  const { observations, diff } = await istUndDiff({ s, soll, zugang, now, fetchImpl });
  // Ein neu verarbeiteter Stand gilt erst nach Δ = 0 als bestätigt (auch wenn der alte Eintrag bestätigt war und die Session gewachsen ist).
  const eintrag = { gesendet: [], spans: [], ...alt, pfad: s.pfad, groesse: s.groesse, mtime: s.mtime, bestaetigt: false, beendet: beendet };
  // Abgelaufene (oder ohne Zeitstempel aus einem Altbestand stammende) Einträge zählen nicht mehr als unterwegs: ein noch fehlender Call wird erneut gesendet.
  const frisch = (id) => now - (eintrag.gesendetAm?.[id] ?? -Infinity) < GESENDET_ABLAUF_MS;
  eintrag.gesendet = eintrag.gesendet.filter(frisch);
  eintrag.gesendetAm = Object.fromEntries(eintrag.gesendet.map((id) => [id, eintrag.gesendetAm[id]]));
  const imLedger = new Set(eintrag.gesendet);
  const fehlend = diff?.fehlend ?? [];
  const zuSenden = fehlend.filter((e) => !imLedger.has(e.id));
  rec.dubletten = diff?.dubletten.length ?? 0;
  const mehrdeutig = diff?.art === "fingerprint" && fehlend.length > 0 && rec.dubletten > 0;
  if (vorStichtag) return Object.assign(rec, { status: "vor Stichtag", wuerdeSenden: mehrdeutig ? 0 : zuSenden.length });
  const sendbar = mehrdeutig ? [] : zuSenden;
  if (args.trocken) return Object.assign(rec, { status: mehrdeutig ? "mehrdeutig" : "trocken", wuerdeSenden: sendbar.length });

  // Δ = 0 oder nichts mehr sendbar: nur bestätigen, wenn auch kein gesendeter Call mehr unterwegs ist.
  const nochFehlend = new Set(fehlend.map((e) => e.id));
  eintrag.gesendet = eintrag.gesendet.filter((id) => nochFehlend.has(id));
  eintrag.gesendetAm = Object.fromEntries(eintrag.gesendet.map((id) => [id, eintrag.gesendetAm[id]]));
  let ok = true;
  if (sendbar.length) {
    const { chunks } = bauePayloads(s.id, sendbar, { soll, ledgerSpans: eintrag.spans, env, project: basename(hauptrepoPfad(repoRoot)) });
    ok = await sendeChunks({ s, chunks, eintrag, zugang, fetchImpl, protokoll, rec, now });
  }
  rec.status = mehrdeutig ? "mehrdeutig" : ok ? "gesendet" : "Fehler";
  rec.ausstehend = eintrag.gesendet.length;
  if (!ok) {
    // Fortschritt nur für angenommene Chunks; nicht bestätigt, Stand nicht als aktuell vermerken.
    // Mit bekanntem Ende bleibt der aktuelle Stand vermerkt, damit der Folgelauf `beendet` wiedererkennt.
    if (eintrag.gesendet.length || eintrag.spans.length) ledger.sessions[s.id] = { ...eintrag, bestaetigt: false, groesse: beendet ? s.groesse : (alt?.groesse ?? null), mtime: beendet ? s.mtime : (alt?.mtime ?? null) };
    return rec;
  }
  // Nichts sendbar und nichts mehr unterwegs (Δ = 0 oder nur Dubletten/mehrdeutig): bestätigt, neue Prüfung erst bei Transkript-Änderung.
  if (!sendbar.length && !eintrag.gesendet.length) {
    rec.befund = mehrdeutig ? "mehrdeutig: Fehlend und Dubletten zugleich, nichts gesendet" : rec.dubletten ? "nur Dubletten, nichts zu senden" : null;
    if (!rec.befund) rec.status = "vollständig";
    eintrag.bestaetigt = true;
  }
  ledger.sessions[s.id] = { ...eintrag, groesse: s.groesse, mtime: s.mtime };
  if (rec.befund) ledger.sessions[s.id].befund = rec.befund;
  else delete ledger.sessions[s.id].befund;
  const rest = mehrdeutig ? zuSenden.length : 0;
  try {
    for (const score of scoresFuer({ s, soll, observations, rest, ledgerGesendet: alt?.gesendet ?? [], env })) await sendeScore(score, { ...zugang, fetchImpl });
  } catch (e) {
    protokoll.fehler.push({ session: s.id, status: e.status ?? null, meldung: `Score: ${e.message}` });
  }
  return rec;
}

// ── Ablauf ───────────────────────────────────────────────────────────────────

function bericht(args, protokoll) {
  if (args.json) return JSON.stringify(protokoll, null, 2);
  const p = protokoll;
  const zeilen = [`Nachliefern: ${p.geprueft} Session(s) geprüft, ${p.gesendet} Call(s) und ${p.spans} Subagent-Span(s) gesendet, ${p.dubletten} Dublette(n) (nur gemeldet), würde senden: ${p.wuerdeSenden}.`];
  for (const r of p.sessions.filter(zeigenswert)) {
    zeilen.push(`- ${r.session.slice(0, 8)} ${r.status}: gesendet ${r.gesendet}, würde senden ${r.wuerdeSenden}, Dubletten ${r.dubletten}, ausstehend ${r.ausstehend}${r.befund ? `, ${r.befund}` : ""}${r.endeVerworfen ? ", Ende verworfen (Transkript wuchs nach dem SessionEnd-Hook)" : ""}`);
  }
  if (p.uebrig) zeilen.push(`Gesamtfrist von ${GESAMTFRIST_MS / 60_000} min erreicht: ${p.uebrig} Session(s) folgen beim nächsten Lauf.`);
  for (const f of p.fehler) zeilen.push(`FEHLER ${f.session.slice(0, 8)} (HTTP ${f.status ?? "–"}): ${f.meldung}`);
  return zeilen.join("\n");
}

/**
 * Nachliefern ausführen: `{ exitCode, text, protokoll }`. 0 = Bericht, 1 = mindestens ein Fehler (übrige Sessions liefen weiter),
 * 2 = Aufruf oder Zugang fehlt (vor jedem Request).
 */
export async function nachliefern(args, { env = process.env, now = Date.now(), uhr = Date.now, fetchImpl = fetch, projectsRoot, repoRoot, stateDir } = {}) {
  const protokoll = { zugang: null, geprueft: 0, uebrig: 0, gesendet: 0, spans: 0, dubletten: 0, wuerdeSenden: 0, sessions: [], fehler: [] };
  if (args.fehler) return { exitCode: 2, text: `${args.fehler}\n${AUFRUFHILFE}`, protokoll };
  const seitMs = args.seit ? Date.parse(args.seit) : now - 7 * 86_400_000;
  if (!Number.isFinite(seitMs)) return { exitCode: 2, text: `--seit ist keine ISO-Zeit: ${args.seit}\n${AUFRUFHILFE}`, protokoll };
  let zugang;
  try {
    zugang = langfuseZugang(env, OHNE_ZUGANG);
    protokoll.zugang = true;
  } catch (e) {
    protokoll.zugang = false;
    return { exitCode: 2, text: e.message, protokoll };
  }
  const ledgerDatei = join(stateDir, LEDGER_NAME);
  const { ledger, kaputt } = ledgerLesen(ledgerDatei);
  if (kaputt && !args.trocken) renameSync(ledgerDatei, `${ledgerDatei}.kaputt-${new Date(now).toISOString().replace(/[:.]/g, "-")}`);
  const vorher = JSON.stringify(ledger);
  // resume: die Session läuft wieder, ein früheres SessionEnd gilt nicht mehr (sonst sendete der nächste Lauf nach der kurzen Ruhefrist mitten in die Session).
  if (args.aktuell && !args.trocken && ledger.sessions[args.aktuell]?.beendet) ledger.sessions[args.aktuell].beendet = false;
  const sessions = findeSessions({ projectsRoot, praefix: projektSlug(repoRoot), seitMs, sessionId: args.session });
  // Gesamtfrist: nach GESAMTFRIST_MS beginnt keine weitere Session; die übrigen folgen beim nächsten Lauf.
  const start = uhr();
  for (const [i, s] of sessions.entries()) {
    if (uhr() - start > GESAMTFRIST_MS) {
      protokoll.uebrig = sessions.length - i;
      break;
    }
    protokoll.geprueft += 1;
    try {
      await verarbeite(s, { args, ledger, zugang, env, now, fetchImpl, repoRoot, protokoll });
    } catch (e) {
      protokoll.fehler.push({ session: s.id, status: e.status ?? null, meldung: e.message });
    }
  }
  protokoll.dubletten = protokoll.sessions.reduce((n, r) => n + r.dubletten, 0);
  protokoll.wuerdeSenden = protokoll.sessions.reduce((n, r) => n + r.wuerdeSenden, 0);
  if (!args.trocken) {
    for (const [id, e] of Object.entries(ledger.sessions)) if (!existsSync(e.pfad ?? "")) delete ledger.sessions[id];
    if (kaputt || JSON.stringify(ledger) !== vorher) ledgerSchreiben(ledgerDatei, ledger);
  }
  return { exitCode: protokoll.fehler.length ? 1 : 0, text: bericht(args, protokoll), protokoll };
}

// ── Hook-Betrieb: Wartezeit, Lock und Log (#1578; Lock und Log: langfuse-lock.mjs) ─────

/** Nach SessionEnd zuerst warten: Plugin-Flush und Ingestion-Verzug. Muss länger sein als RUHEFRIST_BEENDET_MS, sonst gälte die Session beim Lauf noch als laufend. */
export const WARTE_SESSIONEND = 180_000;

/** Hook-Lauf: SessionEnd wartet zuerst WARTE_SESSIONEND (der Lauf misst die Ruhe danach) und versucht einen belegten Lock einmal erneut. */
export async function hookLauf(args, optionen) {
  const ende = args.ausloeser === "sessionend";
  const endeZeit = (optionen.uhr ?? Date.now)();
  if (ende) await (optionen.schlafen ?? warte)(WARTE_SESSIONEND);
  return gesperrterLauf(ende ? { ...args, ende: endeZeit } : args, { ...optionen, ausloeser: args.ausloeser, wiederholen: ende });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const repoRoot = hauptrepoPfad(fileURLToPath(new URL("..", import.meta.url)));
  const stateDir = join(homedir(), ".claude", "state");
  const lauf = (a, o) => nachliefern(a, { projectsRoot: join(homedir(), ".claude", "projects"), stateDir, repoRoot, ...o });
  if (args.ausloeser && !args.fehler) {
    await hookLauf(args, { stateDir, lauf });
    return;
  }
  // Manueller Lauf: schreibende Läufe teilen sich den Lock mit dem Hook (Aufruffehler und Trockenlauf lesen nur).
  if (args.fehler || args.trocken) {
    const { exitCode, text } = await lauf(args, {});
    (exitCode === 0 ? console.log : console.error)(text);
    process.exitCode = exitCode;
    return;
  }
  const { lock, ergebnis } = await gesperrterLauf(args, { stateDir, lauf, ausloeser: "manuell" });
  if (!ergebnis) {
    console.error(lockMeldung(lock));
    process.exitCode = 1;
    return;
  }
  (ergebnis.exitCode === 0 ? console.log : console.error)(ergebnis.text);
  process.exitCode = ergebnis.exitCode;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();

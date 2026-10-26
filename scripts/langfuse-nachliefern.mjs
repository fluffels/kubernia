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

import { fileURLToPath } from "node:url";
import { istDirektaufruf } from "./direktaufruf.mjs";
import { existsSync, mkdirSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { flagsLesen } from "./flag-lib.mjs";
import { ladeProjektConfig, repoName } from "./projekt-config-lib.mjs";
import { worktreePraefix } from "./ticket-namen.mjs";
import { hauptrepoPfad, ladeSessionDatei, projekteWurzel, projektSlug } from "./transkript.mjs";
import {
  diffMultimenge,
  findeSessions,
  hatDifferenz,
  istAbfragen,
  istAusMetrics,
  holeMetrics,
  LEDGER_NAME,
  RUHEFRIST_MIN,
  ledgerLesen,
  endeGilt,
  endeGiltFuer,
  ENDE_SCHLUPF_MS,
  nachliefererWartet,
  standUnveraendert,
  scoreId,
  sollEintraege,
  vorStichtag,
} from "./langfuse-abgleich-kern.mjs";
import { fetchSessionObservations, langfuseZugang, sendeOtlp, sendeScore } from "./langfuse-api.mjs";
import { kindEnv } from "./langfuse-zugang.mjs";
import { bauePayloads } from "./langfuse-otlp.mjs";
import { gesperrterLauf, kurzerStand, leseStartMarke, lockMeldung, markiereStart, warte, zeigenswert } from "./langfuse-lock.mjs";

// Stichtag und Fristen stehen im Kern (eine Definition); die Tests lesen sie hier.
export { RUHEFRIST_BEENDET_MS, RUHEFRIST_OHNE_ENDE_H, STICHTAG } from "./langfuse-abgleich-kern.mjs";

export { ENDE_SCHLUPF_MS };
/** Ein Ledger-`gesendet` gilt so lange als unterwegs (Ingestion-Verzug), danach wird ein noch fehlender Call erneut gesendet (die IDs sind deterministisch, eine Wiederholung ist ungefährlich). */
export const GESENDET_ABLAUF_MS = 4 * RUHEFRIST_MIN * 60_000;
/** Gesamtfrist eines Laufs: unter LOCK_VERALTET_MS (15 min), damit kein Lauf länger hängt als sein Lock; übrige Sessions folgen beim nächsten Lauf. */
export const GESAMTFRIST_MS = 10 * 60_000;
/** Befund einer Session mit Lücke und Dubletten zugleich: nichts gesendet, aber nie bestätigt (jeder Lauf prüft neu, z.B. nach einer geänderten Dublettenregel). */
export const BEFUND_MEHRDEUTIG = "mehrdeutig: Fehlend und Dubletten zugleich, nichts gesendet";
/** Ob ein Ledger-Eintrag als bestätigt gilt; ältere Stände vermerkten Mehrdeutigkeit als bestätigt, das gilt nicht mehr. */
export function giltBestaetigt(eintrag) {
  return Boolean(eintrag?.bestaetigt) && eintrag.befund !== BEFUND_MEHRDEUTIG;
}

export const AUFRUFHILFE = "Aufruf: node scripts/langfuse-nachliefern.mjs [--session <id>] [--seit <ISO>] [--aktuell <id>] [--beendet <id>] [--ausloeser sessionstart|sessionend] [--trocken] [--json]";
export const OHNE_ZUGANG = "Kein Langfuse-Zugang: LANGFUSE_PUBLIC_KEY + LANGFUSE_SECRET_KEY fehlen (aus der Umgebung, zusätzlich aus ~/.langfuse-secret und den Plugin-Optionen; Agentenläufe nutzen den Secret-Key nicht: das ist Regel, `permissions.deny` sperrt nur das Read-Tool, technisch gesperrt ist die Datei nur unter der Sandbox, die unter Windows nicht greift). Im Agentenlauf: Session-ID in den PR-Text; die Maintainerin liefert mit `node scripts/langfuse-nachliefern.mjs --session <id>` nach (docs/model-routing.md › Langfuse-Erfassung belegen).";
const AUSLOESER = ["sessionstart", "sessionend"];

/** Fehlertext fürs Protokoll: Node meldet bei Netzfehlern nur „fetch failed“, die Ursache steckt in `cause` (Code oder Meldung). */
export function fehlerText(e) {
  const meldung = e instanceof Error ? e.message : String(e);
  const ursache = e instanceof Error && e.cause ? (e.cause.code ?? e.cause.message) : null;
  return ursache ? `${meldung} (${ursache})` : meldung;
}

/** Unbekanntes Flag oder fehlender Wert: `fehler` gesetzt (der Aufrufer meldet Exit 2). */
export function parseArgs(argv) {
  const optionen = { session: { type: "string" }, seit: { type: "string" }, aktuell: { type: "string" }, beendet: { type: "string" }, ausloeser: { type: "string" }, trocken: { type: "boolean" }, json: { type: "boolean" } };
  const { werte, fehler } = flagsLesen(argv, optionen);
  const a = { session: werte.session ?? null, seit: werte.seit ?? null, aktuell: werte.aktuell ?? null, beendet: werte.beendet ?? null, ausloeser: werte.ausloeser ?? null, trocken: werte.trocken === true, json: werte.json === true, fehler: fehler?.text ?? null };
  if (a.fehler === null && a.ausloeser !== null && !AUSLOESER.includes(a.ausloeser)) {
    a.fehler = `--ausloeser: erlaubt sind ${AUSLOESER.join(", ")}`;
    a.ausloeser = null;
  }
  return a;
}

// ── Ledger ───────────────────────────────────────────────────────────────────

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
      protokoll.fehler.push({ session: s.id, status: e.status ?? null, meldung: fehlerText(e) });
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
  const { args, ledger, zugang, env, now, fetchImpl, repoRoot, protokoll, worktree, repo } = c;
  const alt = ledger.sessions[s.id];
  const unveraendert = standUnveraendert(alt, s);
  const rec = { session: s.id, status: "", gesendet: 0, dubletten: 0, wuerdeSenden: 0, ausstehend: 0, befund: null, endeVerworfen: false, fortgesetzt: false };
  protokoll.sessions.push(rec);
  if (args.aktuell === s.id) return Object.assign(rec, { status: "aktuell" });
  // Das SessionEnd-Kind wartet 10 min: wuchs das Transkript danach oder startete die Session neu (Startmarke, resume), gilt das Ende nicht mehr
  // und die laufende Session bleibt unberührt (ihre weiteren Turns sendet der Plugin-Hook selbst, #1953).
  const endeAngegeben = args.beendet === s.id || args.session === s.id;
  const fortgesetztAm = endeAngegeben ? c.startMarke ?? null : null;
  const endeOk = endeGilt({ ende: args.ende, mtime: s.mtime, fortgesetztAm });
  const endeBekannt = endeAngegeben && endeOk;
  // Ob Claude Code nach dem SessionEnd-Hook noch länger ins Transkript schreibt, zeigt dieses Logfeld (sonst fiele jede Session still auf die 24-h-Frist zurück).
  rec.endeVerworfen = endeAngegeben && !endeOk;
  rec.fortgesetzt = rec.endeVerworfen && endeGilt({ ende: args.ende, mtime: s.mtime });
  const beendet = endeBekannt || endeGiltFuer(alt, s);
  // Bekanntes Ende vor jedem Fetch festhalten (auch wenn dieser wirft), sonst gälte beim nächsten Lauf wieder die 24-h-Frist.
  if (endeBekannt && !args.trocken) ledger.sessions[s.id] = { gesendet: [], spans: [], ...alt, pfad: s.pfad, groesse: s.groesse, mtime: s.mtime, bestaetigt: giltBestaetigt(alt) && unveraendert, beendet: true };
  if (nachliefererWartet({ mtime: s.mtime, now, beendet })) return Object.assign(rec, { status: "läuft" });
  if (giltBestaetigt(alt) && unveraendert) return Object.assign(rec, { status: "bestätigt" });
  // Sessions vor dem Stichtag und ohne Calls: der Vermerk spart bei unverändertem Stand das erneute Parsen und die Abfrage.
  if (alt?.vermerk && unveraendert) return Object.assign(rec, { status: alt.vermerk });
  const vermerke = (status) => {
    if (!args.trocken) ledger.sessions[s.id] = { gesendet: [], spans: [], gesendetAm: {}, pfad: s.pfad, groesse: s.groesse, mtime: s.mtime, bestaetigt: false, beendet, vermerk: status };
  };
  const soll = sollEintraege(ladeSessionDatei(s.pfad), { session: s.id, worktree });
  if (!soll.length) {
    vermerke("ohne Calls");
    return Object.assign(rec, { status: "ohne Calls" });
  }
  const davor = vorStichtag(soll);
  if (davor) {
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
  rec.leer = diff?.leer?.length ?? 0;
  const mehrdeutig = diff?.art === "fingerprint" && fehlend.length > 0 && rec.dubletten > 0;
  if (davor) return Object.assign(rec, { status: "vor Stichtag", wuerdeSenden: mehrdeutig ? 0 : zuSenden.length });
  const sendbar = mehrdeutig ? [] : zuSenden;
  if (args.trocken) return Object.assign(rec, { status: mehrdeutig ? "mehrdeutig" : "trocken", wuerdeSenden: sendbar.length });

  // Δ = 0 oder nichts mehr sendbar: nur bestätigen, wenn auch kein gesendeter Call mehr unterwegs ist.
  const nochFehlend = new Set(fehlend.map((e) => e.id));
  eintrag.gesendet = eintrag.gesendet.filter((id) => nochFehlend.has(id));
  eintrag.gesendetAm = Object.fromEntries(eintrag.gesendet.map((id) => [id, eintrag.gesendetAm[id]]));
  let ok = true;
  if (sendbar.length) {
    const { chunks } = bauePayloads(s.id, sendbar, { soll, ledgerSpans: eintrag.spans, env, project: basename(hauptrepoPfad(repoRoot)), repoName: repo });
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
  // Nichts sendbar und nichts mehr unterwegs (Δ = 0 oder nur Dubletten): bestätigt, neue Prüfung erst bei Transkript-Änderung; mehrdeutig bleibt unbestätigt und wird bei jedem Lauf neu geprüft.
  if (!sendbar.length && !eintrag.gesendet.length) {
    rec.befund = mehrdeutig ? BEFUND_MEHRDEUTIG : rec.dubletten ? "nur Dubletten, nichts zu senden" : null;
    if (!rec.befund) rec.status = "vollständig";
    eintrag.bestaetigt = !mehrdeutig;
  }
  ledger.sessions[s.id] = { ...eintrag, groesse: s.groesse, mtime: s.mtime };
  if (rec.befund) ledger.sessions[s.id].befund = rec.befund;
  else delete ledger.sessions[s.id].befund;
  const rest = mehrdeutig ? zuSenden.length : 0;
  try {
    for (const score of scoresFuer({ s, soll, observations, rest, ledgerGesendet: alt?.gesendet ?? [], env })) await sendeScore(score, { ...zugang, fetchImpl });
  } catch (e) {
    protokoll.fehler.push({ session: s.id, status: e.status ?? null, meldung: `Score: ${fehlerText(e)}` });
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
export async function nachliefern(args, { env = process.env, now = Date.now(), uhr = Date.now, fetchImpl = fetch, projectsRoot, repoRoot, stateDir, config } = {}) {
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
  let worktree;
  let repo;
  try {
    const cfg = config ?? ladeProjektConfig({ pruefen: false });
    worktree = worktreePraefix(cfg);
    repo = repoName(cfg);
  } catch (e) {
    return { exitCode: 1, text: `Fehler: ${e.message}`, protokoll };
  }
  const ledgerDatei = join(stateDir, LEDGER_NAME);
  const { ledger, kaputt } = ledgerLesen(ledgerDatei);
  if (kaputt && !args.trocken) renameSync(ledgerDatei, `${ledgerDatei}.kaputt-${new Date(now).toISOString().replace(/[:.]/g, "-")}`);
  const vorher = JSON.stringify(ledger);
  // resume: die Session läuft wieder, ein früheres SessionEnd gilt nicht mehr (sonst sendete der nächste Lauf nach der kurzen Ruhefrist mitten in die Session).
  if (args.aktuell && !args.trocken && ledger.sessions[args.aktuell]?.beendet) ledger.sessions[args.aktuell].beendet = false;
  const startMarke = args.beendet || args.session ? leseStartMarke(stateDir, args.beendet ?? args.session) : null;
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
      await verarbeite(s, { args, ledger, zugang, env, now, fetchImpl, repoRoot, protokoll, worktree, repo, startMarke });
    } catch (e) {
      protokoll.fehler.push({ session: s.id, status: e.status ?? null, meldung: fehlerText(e) });
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
export const WARTE_SESSIONEND = 600_000;

/** Hook-Lauf: SessionEnd wartet zuerst WARTE_SESSIONEND (der Lauf misst die Ruhe danach) und versucht einen belegten Lock einmal erneut. */
export async function hookLauf(args, optionen) {
  const ende = args.ausloeser === "sessionend";
  const endeZeit = (optionen.uhr ?? Date.now)();
  // Startmarke je SessionStart (auch bei belegtem Lock): ein wartendes SessionEnd-Kind derselben Session erkennt so die Fortsetzung.
  if (args.ausloeser === "sessionstart" && args.aktuell) markiereStart(optionen.stateDir, args.aktuell, endeZeit);
  if (ende) await (optionen.schlafen ?? warte)(WARTE_SESSIONEND);
  return gesperrterLauf(ende ? { ...args, ende: endeZeit } : args, { ...optionen, ausloeser: args.ausloeser, wiederholen: ende });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const repoRoot = hauptrepoPfad(fileURLToPath(new URL("..", import.meta.url)));
  const stateDir = join(homedir(), ".claude", "state");
  const lauf = (a, o) => nachliefern(a, { projectsRoot: projekteWurzel(), stateDir, repoRoot, env: kindEnv(process.env, homedir()), ...o }); // Zugang auch aus ~/.langfuse-secret und den Plugin-Optionen, wie im Hook (#1821 L30)
  if (args.ausloeser && !args.fehler) {
    await hookLauf(args, { stateDir, lauf, stand: kurzerStand(fileURLToPath(new URL("..", import.meta.url))) });
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

if (istDirektaufruf(import.meta.url)) await main();

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

import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { ladeSessionDatei } from "./transkript.mjs";
import {
  diffMultimenge,
  findeSessions,
  hatDifferenz,
  istAbfragen,
  istAusMetrics,
  holeMetrics,
  projektPraefix,
  repoWurzel,
  scoreId,
  sollEintraege,
} from "./langfuse-abgleich.mjs";
import { fetchSessionObservations, langfuseZugang, sendeOtlp, sendeScore } from "./langfuse-api.mjs";
import { bauePayloads } from "./langfuse-otlp.mjs";

/** Sessions mit einem Call vor diesem Zeitpunkt (Hook-Aufzeichnung davor unvollständig, nicht vergleichbar) werden nur gezählt. */
export const STICHTAG = "2026-10-09T13:27:35Z";
/** Ohne bekanntes Ende gilt eine Session erst nach dieser Ruhe als beendet (eine untätig offene Parallelsession bleibt unberührt). */
export const RUHEFRIST_OHNE_ENDE_H = 24;
/** Ruhe bei bekanntem Ende (SessionEnd): kürzer als die Wartezeit des Hooks (WARTE_SESSIONEND in langfuse-abgleich-hook), damit der Lauf nach dem Warten sendet. */
export const RUHEFRIST_BEENDET_MS = 150_000;
const LEDGER_NAME = "langfuse-abgleich.json";
/** Zeitversatz zwischen dem Ende-Zeitpunkt des Hooks und der letzten Transkript-Änderung. */
const ENDE_SCHLUPF_MS = 5_000;

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

async function sendeChunks({ s, chunks, eintrag, zugang, fetchImpl, protokoll, rec }) {
  for (const chunk of chunks) {
    try {
      await sendeOtlp(chunk.payload, { ...zugang, fetchImpl });
    } catch (e) {
      protokoll.fehler.push({ session: s.id, status: e.status ?? null, meldung: e.message });
      return false;
    }
    eintrag.gesendet.push(...chunk.generationIds);
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
  const rec = { session: s.id, status: "", gesendet: 0, dubletten: 0, wuerdeSenden: 0, ausstehend: 0, befund: null };
  protokoll.sessions.push(rec);
  if (args.aktuell === s.id) return Object.assign(rec, { status: "aktuell" });
  // Das SessionEnd-Kind wartet 3 min: wuchs das Transkript danach (resume), gilt das Ende nicht mehr und die laufende Session bleibt unberührt.
  const endeGilt = args.ende == null || s.mtime <= args.ende + ENDE_SCHLUPF_MS;
  const endeBekannt = (args.beendet === s.id || args.session === s.id) && endeGilt;
  const beendet = endeBekannt || Boolean(alt?.beendet && unveraendert);
  const ruheMs = beendet ? RUHEFRIST_BEENDET_MS : RUHEFRIST_OHNE_ENDE_H * 3_600_000;
  if (now - s.mtime < ruheMs) {
    // Bekanntes Ende festhalten, sonst gälte beim nächsten Lauf (nach der Ruhefrist) wieder die 24-h-Frist.
    if (endeBekannt && !args.trocken) ledger.sessions[s.id] = { gesendet: [], spans: [], ...alt, pfad: s.pfad, groesse: s.groesse, mtime: s.mtime, bestaetigt: Boolean(alt?.bestaetigt && unveraendert), beendet: true };
    return Object.assign(rec, { status: "läuft" });
  }
  if (alt?.bestaetigt && unveraendert) return Object.assign(rec, { status: "bestätigt" });
  const soll = sollEintraege(ladeSessionDatei(s.pfad), { session: s.id });
  if (!soll.length) return Object.assign(rec, { status: "ohne Calls" });
  const vorStichtag = Math.min(...soll.map((e) => Date.parse(e.ts)).filter(Number.isFinite)) < Date.parse(STICHTAG);
  const { observations, diff } = await istUndDiff({ s, soll, zugang, now, fetchImpl });
  // Ein neu verarbeiteter Stand gilt erst nach Δ = 0 als bestätigt (auch wenn der alte Eintrag bestätigt war und die Session gewachsen ist).
  const eintrag = { gesendet: [], spans: [], ...alt, pfad: s.pfad, groesse: s.groesse, mtime: s.mtime, bestaetigt: false, beendet: beendet };
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
  let ok = true;
  if (sendbar.length) {
    const { chunks } = bauePayloads(s.id, sendbar, { soll, ledgerSpans: eintrag.spans, env, project: basename(repoWurzel(repoRoot)) });
    ok = await sendeChunks({ s, chunks, eintrag, zugang, fetchImpl, protokoll, rec });
  }
  rec.status = mehrdeutig ? "mehrdeutig" : ok ? "gesendet" : "Fehler";
  rec.ausstehend = eintrag.gesendet.length;
  if (!ok) {
    // Fortschritt nur für angenommene Chunks; nicht bestätigt, Stand nicht als aktuell vermerken.
    if (eintrag.gesendet.length || eintrag.spans.length) ledger.sessions[s.id] = { ...eintrag, bestaetigt: false, groesse: alt?.groesse ?? null, mtime: alt?.mtime ?? null };
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

const zeigenswert = (x) => x.gesendet || x.wuerdeSenden || x.dubletten || x.ausstehend || x.befund || x.status === "Fehler" || x.status === "mehrdeutig";

function bericht(args, protokoll) {
  if (args.json) return JSON.stringify(protokoll, null, 2);
  const p = protokoll;
  const zeilen = [`Nachliefern: ${p.geprueft} Session(s) geprüft, ${p.gesendet} Call(s) und ${p.spans} Subagent-Span(s) gesendet, ${p.dubletten} Dublette(n) (nur gemeldet), würde senden: ${p.wuerdeSenden}.`];
  for (const r of p.sessions.filter(zeigenswert)) {
    zeilen.push(`- ${r.session.slice(0, 8)} ${r.status}: gesendet ${r.gesendet}, würde senden ${r.wuerdeSenden}, Dubletten ${r.dubletten}, ausstehend ${r.ausstehend}${r.befund ? `, ${r.befund}` : ""}`);
  }
  for (const f of p.fehler) zeilen.push(`FEHLER ${f.session.slice(0, 8)} (HTTP ${f.status ?? "–"}): ${f.meldung}`);
  return zeilen.join("\n");
}

/**
 * Nachliefern ausführen: `{ exitCode, text, protokoll }`. 0 = Bericht, 1 = mindestens ein Fehler (übrige Sessions liefen weiter),
 * 2 = Aufruf oder Zugang fehlt (vor jedem Request).
 */
export async function nachliefern(args, { env = process.env, now = Date.now(), fetchImpl = fetch, projectsRoot, repoRoot, stateDir } = {}) {
  const protokoll = { zugang: null, geprueft: 0, gesendet: 0, spans: 0, dubletten: 0, wuerdeSenden: 0, sessions: [], fehler: [] };
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
  const sessions = findeSessions({ projectsRoot, praefix: projektPraefix(repoRoot), seitMs, sessionId: args.session });
  for (const s of sessions) {
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

// ── Hook-Betrieb: Lock, Log, Wartezeit (#1578) ─────────────────────────────────

/** Nach SessionEnd zuerst warten: Plugin-Flush und Ingestion-Verzug. Muss länger sein als RUHEFRIST_BEENDET_MS, sonst gälte die Session beim Lauf noch als laufend. */
export const WARTE_SESSIONEND = 180_000;
/** Belegter Lock an SessionEnd: einmal nach dieser Zeit erneut versuchen (`/clear` löst SessionEnd und SessionStart fast gleichzeitig aus). */
export const WARTE_LOCK = 60_000;
export const LOCK_VERALTET_MS = 15 * 60_000;
export const LOG_MAX_BYTES = 1_048_576;
const LOCK_NAME = "langfuse-abgleich.lock";
const LOG_NAME = "langfuse-abgleich.log";
const warte = (ms) => new Promise((r) => setTimeout(r, ms));

function lockVeraltet(datei, now) {
  try {
    const zeit = JSON.parse(readFileSync(datei, "utf8"))?.zeit;
    if (Number.isFinite(zeit)) return now - zeit > LOCK_VERALTET_MS;
  } catch {
    // kaputter Inhalt: dann zählt die Änderungszeit
  }
  try {
    return now - statSync(datei).mtimeMs > LOCK_VERALTET_MS;
  } catch {
    return true; // inzwischen weg
  }
}

/** `"frei"` (neu angelegt), `"übernommen"` (veralteten Lock ersetzt) oder `"belegt"`. Anlage atomar per `wx` mit pid und Zeit. */
export function lockNehmen(datei, { now = Date.now(), pid = process.pid } = {}) {
  mkdirSync(dirname(datei), { recursive: true });
  const versuch = () => {
    try {
      writeFileSync(datei, JSON.stringify({ pid, zeit: now }), { flag: "wx" });
      return true;
    } catch (e) {
      if (e.code === "EEXIST") return false;
      throw e;
    }
  };
  if (versuch()) return "frei";
  if (!lockVeraltet(datei, now)) return "belegt";
  try {
    unlinkSync(datei);
  } catch {
    // ein anderer Lauf war schneller: der zweite wx entscheidet
  }
  return versuch() ? "übernommen" : "belegt";
}

/** Gibt den Lock nur frei, wenn er die eigene pid trägt (ein übernommener Lock gehört einem anderen Lauf). */
export function lockFreigeben(datei, pid = process.pid) {
  try {
    if (JSON.parse(readFileSync(datei, "utf8"))?.pid === pid) unlinkSync(datei);
  } catch {
    // weg oder kaputt: nichts zu tun
  }
}

/** Hängt `eintrag` als eine JSON-Zeile an; ab `max` Bytes wandert die Datei vorher nach `<datei>.1` (eine ältere `.1` wird ersetzt). */
export function logAnhaengen(datei, eintrag, { max = LOG_MAX_BYTES } = {}) {
  mkdirSync(dirname(datei), { recursive: true });
  try {
    if (statSync(datei).size >= max) renameSync(datei, `${datei}.1`);
  } catch {
    // keine Datei: die erste Zeile legt sie an
  }
  appendFileSync(datei, JSON.stringify(eintrag) + "\n");
}

/** Die Logzeile eines Laufs aus dem `protokoll` (ohne Protokoll, z.B. Lock belegt: Nullwerte). Keine Zugangswerte, nur ja/nein. */
export function logEintrag({ zeit, ausloeser, session, lock, exitCode = null, protokoll = null, fehler = [] }) {
  const p = protokoll ?? { zugang: null, geprueft: 0, gesendet: 0, spans: 0, dubletten: 0, wuerdeSenden: 0, sessions: [], fehler: [] };
  const kurz = (f) => ({ ...f, meldung: String(f.meldung ?? "").slice(0, 300) });
  return {
    zeit,
    ausloeser,
    session: session ?? null,
    lock,
    zugang: p.zugang,
    exitCode,
    geprueft: p.geprueft,
    gesendet: p.gesendet,
    spans: p.spans,
    dubletten: p.dubletten,
    wuerdeSenden: p.wuerdeSenden,
    sessions: p.sessions.filter(zeigenswert).map((r) => ({ session: r.session, status: r.status, gesendet: r.gesendet, wuerdeSenden: r.wuerdeSenden, dubletten: r.dubletten, ausstehend: r.ausstehend })),
    fehler: [...p.fehler, ...fehler].map(kurz),
  };
}

/**
 * Ein Lauf unter Lock mit Logzeile: `{ lock, ergebnis }` (`ergebnis` null, wenn der Lock belegt blieb oder der Lauf abstürzte). `wiederholen`: bei belegtem
 * Lock einmal nach WARTE_LOCK erneut versuchen. Ein Absturz in `lauf` wird protokolliert, der Lock im `finally` freigegeben.
 */
export async function gesperrterLauf(args, { stateDir, lauf, ausloeser, wiederholen = false, schlafen = warte, uhr = Date.now, pid = process.pid }) {
  const lockDatei = join(stateDir, LOCK_NAME);
  const basis = { ausloeser, session: args.session ?? args.aktuell ?? null, lock: null };
  const logge = (extra) => {
    try {
      logAnhaengen(join(stateDir, LOG_NAME), logEintrag({ zeit: new Date(uhr()).toISOString(), ...basis, ...extra }));
    } catch {
      // Ein Logfehler darf den Lauf nie kippen.
    }
  };
  const nimm = () => {
    try {
      return lockNehmen(lockDatei, { now: uhr(), pid });
    } catch (e) {
      basis.fehler = [{ session: basis.session, status: null, meldung: `Lock: ${e.message}` }];
      return "fehler"; // ein unlesbarer Zustandsordner: kein Lauf, aber nie ein Wurf
    }
  };
  let lock = nimm();
  if (lock === "belegt" && wiederholen) {
    await schlafen(WARTE_LOCK);
    lock = nimm();
  }
  basis.lock = lock;
  if (lock === "belegt" || lock === "fehler") {
    logge({ fehler: basis.fehler });
    return { lock, ergebnis: null };
  }
  try {
    const ergebnis = await lauf(args, { now: uhr() });
    logge({ exitCode: ergebnis.exitCode, protokoll: ergebnis.protokoll });
    return { lock, ergebnis };
  } catch (e) {
    logge({ exitCode: 1, fehler: [{ session: basis.session, status: null, meldung: e.message }] });
    return { lock, ergebnis: null };
  } finally {
    lockFreigeben(lockDatei, pid);
  }
}

/** Hook-Lauf: SessionEnd wartet zuerst WARTE_SESSIONEND (der Lauf misst die Ruhe danach) und versucht einen belegten Lock einmal erneut. */
export async function hookLauf(args, optionen) {
  const ende = args.ausloeser === "sessionend";
  const endeZeit = (optionen.uhr ?? Date.now)();
  if (ende) await (optionen.schlafen ?? warte)(WARTE_SESSIONEND);
  return gesperrterLauf(ende ? { ...args, ende: endeZeit } : args, { ...optionen, ausloeser: args.ausloeser, wiederholen: ende });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const repoRoot = repoWurzel(fileURLToPath(new URL("..", import.meta.url)));
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
    console.error(lock === "belegt" ? "Ein anderer Nachlieferlauf hält den Lock (~/.claude/state/langfuse-abgleich.lock); später erneut versuchen." : lock === "fehler" ? "Der Lock ließ sich nicht anlegen: ~/.claude/state prüfen." : "Nachliefern abgestürzt, siehe ~/.claude/state/langfuse-abgleich.log.");
    process.exitCode = 1;
    return;
  }
  (ergebnis.exitCode === 0 ? console.log : console.error)(ergebnis.text);
  process.exitCode = ergebnis.exitCode;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();

// Kein Shebang: wird per `node scripts/langfuse-nachliefern.mjs` gestartet UND von test/harness/langfuse-nachliefern.test.ts importiert.
/**
 * Langfuse nachliefern (#1577, Teil 2a/3 von #1556): sendet die laut Abgleich fehlenden Calls per OTLP/HTTP-JSON nach,
 * idempotent. Bewusst ein eigenes Modul: `langfuse-abgleich.mjs --pruefen` bleibt beweisbar lesend. Dubletten werden nur gemeldet.
 *
 *   node scripts/langfuse-nachliefern.mjs [--session <id>] [--seit <ISO>] [--aktuell <id>] [--beendet <id>] [--ausloeser sessionstart|sessionend] [--trocken] [--json]
 * Aufträge anderer Prozesse (`node scripts/langfuse-auftrag.mjs <id>`, key-frei, factory#213) führt der SessionStart-Lauf aus.
 *
 * Idempotenz: je Session zuerst das Ist (zwei Metrics-Abfragen, bei Differenz Observations), gesendet wird `fehlend` minus
 * Ledger-`gesendet` (`~/.claude/state/langfuse-abgleich.json`, nur eine Brücke über den Ingestion-Verzug). Ein kaputtes oder
 * fehlendes Ledger kostet höchstens Abfragen, nie eine Doppelsendung. Importiert nur Builtins und hook-taugliche Module
 * (Hook-Verdrahtung: #1578, Einstieg scripts/langfuse-abgleich-hook.mjs; mit --ausloeser laufen Wartezeit, Lock und Log, ohne nur Lock und Log). Aufruf: docs/referenz/befehle.md, Einordnung: docs/model-routing.md (Fabrik) › Langfuse-Status überprüfen, Punkt 1.
 */

import { fileURLToPath } from "node:url";
import { istDirektaufruf } from "./direktaufruf.mjs";
import { existsSync, renameSync } from "node:fs";
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
import { auftraegeLesen, auftragErledigen, schreibeJsonAtomar } from "./langfuse-auftrag-lib.mjs";
import { gesperrterLauf, kurzerStand, leseStartMarke, lockMeldung, markiereStart, warte, zeigenswert } from "./langfuse-lock.mjs";
import { factorySeiteIn } from "./factory-seite.mjs";

const WURZEL = fileURLToPath(new URL("..", import.meta.url));

// Stichtag und Fristen stehen im Kern (eine Definition); die Tests lesen sie hier.
export { RUHEFRIST_BEENDET_MS, RUHEFRIST_OHNE_ENDE_H, STICHTAG } from "./langfuse-abgleich-kern.mjs";

export { ENDE_SCHLUPF_MS };
/** Ein Ledger-`gesendet` gilt so lange als unterwegs (Ingestion-Verzug), danach wird ein noch fehlender Call erneut gesendet (die IDs sind deterministisch, eine Wiederholung ist ungefährlich). */
export const GESENDET_ABLAUF_MS = 4 * RUHEFRIST_MIN * 60_000;
/** Gesamtfrist eines Laufs: unter LOCK_VERALTET_MS (15 min), damit kein Lauf länger hängt als sein Lock; übrige Sessions folgen beim nächsten Lauf. */
export const GESAMTFRIST_MS = 10 * 60_000;
/**
 * Befund einer Session mit Lücke und unzuordenbaren Dubletten zugleich: nichts gesendet, aber nie bestätigt (jeder Lauf prüft neu, z.B. nach einer geänderten Dublettenregel).
 * Der Wortlaut (noch „Dubletten“) bleibt Byte für Byte: ältere Ledger-Einträge tragen ihn, `giltBestaetigt` vergleicht ihn.
 */
export const BEFUND_MEHRDEUTIG = "mehrdeutig: Fehlend und Dubletten zugleich, nichts gesendet";
/** Ob ein Ledger-Eintrag als bestätigt gilt; ältere Stände vermerkten Mehrdeutigkeit als bestätigt, das gilt nicht mehr. */
export function giltBestaetigt(eintrag) {
  return Boolean(eintrag?.bestaetigt) && eintrag.befund !== BEFUND_MEHRDEUTIG;
}

export const AUFRUFHILFE = "Aufruf: node scripts/langfuse-nachliefern.mjs [--session <id>] [--seit <ISO>] [--aktuell <id>] [--beendet <id>] [--ausloeser sessionstart|sessionend] [--trocken] [--json]";
/** Hinweis ohne Langfuse-Zugang; eine Funktion statt Konstante, damit der Modul-Import keine Sync-Stand-Datei liest (Muster `natives()` in `sandbox-doctor.mjs`). */
export const ohneZugang = () => "Kein Langfuse-Zugang: LANGFUSE_PUBLIC_KEY + LANGFUSE_SECRET_KEY fehlen (aus der Umgebung, zusätzlich aus ~/.langfuse-secret und den Plugin-Optionen; Agentenläufe nutzen den Secret-Key nicht: das ist Regel, `permissions.deny` sperrt nur das Read-Tool, technisch gesperrt ist die Datei nur unter der Sandbox, die unter Windows nicht greift). Im Agentenlauf: `node scripts/langfuse-auftrag.mjs <session-id>` legt einen Auftrag ab (ohne Key), den der nächste SessionStart-Lauf ausführt; die Session-ID steht zusätzlich im PR-Text (Rückfall: die Maintainerin liefert mit `node scripts/langfuse-nachliefern.mjs --session <id>` nach) (" + factorySeiteIn(WURZEL, "docs/model-routing.md", "langfuse-erfassung-belegen-1293") + ").";
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

/** Status je Session im Protokoll, Log und Bericht (Texte unverändert: Ledger und Auftrags-Logik vergleichen sie). */
export const STATUS = Object.freeze({
  AKTUELL: "aktuell",
  LAEUFT: "läuft",
  BESTAETIGT: "bestätigt",
  OHNE_CALLS: "ohne Calls",
  VOR_STICHTAG: "vor Stichtag",
  MEHRDEUTIG: "mehrdeutig",
  TROCKEN: "trocken",
  GESENDET: "gesendet",
  FEHLER: "Fehler",
  VOLLSTAENDIG: "vollständig",
});

/** Δ = 0: kein Diff (die Abfrage fand keinen Unterschied); die Felder, die `nachlieferEntscheidung` liest, mit ihren leeren Werten. */
const KEIN_DIFF = Object.freeze({ fehlend: [], dubletten: [], unzuordenbar: [], leer: [], art: null });

/**
 * Entscheidung einer Session nach dem Diff, pur: was ist sendbar (Ledger-`gesendet` schon abgezogen), ist der Befund mehrdeutig, und endet der Lauf hier
 * (`status`: vor Stichtag oder Trockenlauf; `wuerdeSenden` ist dann die Vorschau). Nur unzuordenbare Dubletten machen mehrdeutig; Kopien schon gedeckter
 * Calls blockieren das Nachliefern nicht (factory#213).
 */
export function nachlieferEntscheidung({ diff, gesendet, davor, trocken }) {
  const d = { ...KEIN_DIFF, ...diff };
  const imLedger = new Set(gesendet);
  const zuSenden = d.fehlend.filter((e) => !imLedger.has(e.id));
  const unzuordenbar = d.unzuordenbar.length;
  const mehrdeutig = d.art === "fingerprint" && d.fehlend.length > 0 && unzuordenbar > 0;
  const sendbar = mehrdeutig ? [] : zuSenden;
  const basis = { zuSenden, sendbar, mehrdeutig, dubletten: d.dubletten.length, unzuordenbar, leer: d.leer.length, wuerdeSenden: sendbar.length };
  if (davor) return { ...basis, status: STATUS.VOR_STICHTAG };
  if (trocken) return { ...basis, status: mehrdeutig ? STATUS.MEHRDEUTIG : STATUS.TROCKEN };
  return basis;
}

/** Status, mit dem die Session vor jeder Prüfung endet (Ruhefrist läuft, schon bestätigt, Vermerk bei unverändertem Stand), sonst `null`. Pur. */
export function fruehesEnde({ alt, unveraendert, mtime, now, beendet }) {
  if (nachliefererWartet({ mtime, now, beendet })) return STATUS.LAEUFT;
  if (giltBestaetigt(alt) && unveraendert) return STATUS.BESTAETIGT;
  // Sessions vor dem Stichtag und ohne Calls: der Vermerk spart bei unverändertem Stand das erneute Parsen und die Abfrage.
  if (alt?.vermerk && unveraendert) return alt.vermerk;
  return null;
}

/**
 * Ledger-Eintrag der Session für diesen Lauf, pur: der alte Stand, neu bezogen auf die Datei und unbestätigt (ein neu verarbeiteter Stand gilt erst nach Δ = 0
 * als bestätigt). Abgelaufene (oder ohne Zeitstempel aus einem Altbestand stammende) `gesendet`-Einträge zählen nicht mehr als unterwegs: ein noch fehlender Call
 * wird erneut gesendet.
 */
export function bereinigeEintrag({ alt, s, beendet, now }) {
  const eintrag = { gesendet: [], spans: [], ...alt, pfad: s.pfad, groesse: s.groesse, mtime: s.mtime, bestaetigt: false, beendet };
  const frisch = (id) => now - (eintrag.gesendetAm?.[id] ?? -Infinity) < GESENDET_ABLAUF_MS;
  eintrag.gesendet = eintrag.gesendet.filter(frisch);
  eintrag.gesendetAm = Object.fromEntries(eintrag.gesendet.map((id) => [id, eintrag.gesendetAm[id]]));
  return eintrag;
}

/** Ob das Ende der Session gilt; hält `rec.endeVerworfen/fortgesetzt` fest und vermerkt ein bekanntes Ende vor jedem Fetch im Ledger. Liefert `beendet`. */
function endeFestlegen(s, c, alt, unveraendert, rec) {
  const { args, ledger } = c;
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
  return beendet;
}

/** Nach dem Senden: nur noch fehlende Calls bleiben als „unterwegs“ im Eintrag. */
function gesendetAufFehlend(eintrag, fehlend) {
  const nochFehlend = new Set(fehlend.map((e) => e.id));
  eintrag.gesendet = eintrag.gesendet.filter((id) => nochFehlend.has(id));
  eintrag.gesendetAm = Object.fromEntries(eintrag.gesendet.map((id) => [id, eintrag.gesendetAm[id]]));
}

/** Scores einer abgeschlossenen Session senden; ein Fehler kommt ins Protokoll, nie in den Lauf. */
async function sendeScores(args, c) {
  const { protokoll, zugang, fetchImpl } = c;
  try {
    for (const score of scoresFuer(args)) await sendeScore(score, { ...zugang, fetchImpl });
  } catch (e) {
    protokoll.fehler.push({ session: args.s.id, status: e.status ?? null, meldung: `Score: ${fehlerText(e)}` });
  }
}

/** Fortschritt nach einem Sendefehler nur für angenommene Chunks; nicht bestätigt, Stand nicht als aktuell vermerkt (mit bekanntem Ende bleibt er vermerkt, damit der Folgelauf `beendet` wiedererkennt). */
export function ledgerNachFehler({ s, c, alt, eintrag, beendet }) {
  if (!eintrag.gesendet.length && !eintrag.spans.length) return;
  c.ledger.sessions[s.id] = { ...eintrag, bestaetigt: false, groesse: beendet ? s.groesse : (alt?.groesse ?? null), mtime: beendet ? s.mtime : (alt?.mtime ?? null) };
}

/** Nichts sendbar und nichts mehr unterwegs (Δ = 0 oder nur Dubletten): bestätigt, neue Prüfung erst bei Transkript-Änderung; mehrdeutig bleibt unbestätigt und wird bei jedem Lauf neu geprüft. */
function bestaetige(rec, eintrag, e) {
  if (e.sendbar.length || eintrag.gesendet.length) return;
  rec.befund = e.mehrdeutig ? BEFUND_MEHRDEUTIG : e.dubletten ? "nur Dubletten, nichts zu senden" : null;
  if (!rec.befund) rec.status = STATUS.VOLLSTAENDIG;
  eintrag.bestaetigt = !e.mehrdeutig;
}

/** Ledger-Stand und Scores nach dem Senden; `rec` trägt Status und Befund. */
async function schliesseAb({ s, c, rec, alt, eintrag, e, ok, soll, observations, beendet }) {
  const { ledger, env } = c;
  rec.status = e.mehrdeutig ? STATUS.MEHRDEUTIG : ok ? STATUS.GESENDET : STATUS.FEHLER;
  rec.ausstehend = eintrag.gesendet.length;
  if (!ok) {
    ledgerNachFehler({ s, c, alt, eintrag, beendet });
    return rec;
  }
  bestaetige(rec, eintrag, e);
  ledger.sessions[s.id] = { ...eintrag, groesse: s.groesse, mtime: s.mtime };
  if (rec.befund) ledger.sessions[s.id].befund = rec.befund;
  else delete ledger.sessions[s.id].befund;
  const rest = e.mehrdeutig ? e.zuSenden.length : 0;
  await sendeScores({ s, soll, observations, rest, ledgerGesendet: alt?.gesendet ?? [], env }, c);
  return rec;
}

/** Eine Session bis zum Ledger-Stand; mutiert `ledger.sessions[id]` nur um angenommene Chunks und eine vollständige Bestätigung. */
async function verarbeite(s, c) {
  const { args, ledger, zugang, env, now, fetchImpl, repoRoot, protokoll, worktree, repo } = c;
  const alt = ledger.sessions[s.id];
  const unveraendert = standUnveraendert(alt, s);
  const rec = { session: s.id, status: "", gesendet: 0, dubletten: 0, unzuordenbar: 0, wuerdeSenden: 0, ausstehend: 0, befund: null, endeVerworfen: false, fortgesetzt: false };
  protokoll.sessions.push(rec);
  if (args.aktuell === s.id) return Object.assign(rec, { status: STATUS.AKTUELL });
  const beendet = endeFestlegen(s, c, alt, unveraendert, rec);
  const frueh = fruehesEnde({ alt, unveraendert, mtime: s.mtime, now, beendet });
  if (frueh) return Object.assign(rec, { status: frueh });
  const vermerke = (status) => {
    if (!args.trocken) ledger.sessions[s.id] = { gesendet: [], spans: [], gesendetAm: {}, pfad: s.pfad, groesse: s.groesse, mtime: s.mtime, bestaetigt: false, beendet, vermerk: status };
  };
  const soll = sollEintraege(ladeSessionDatei(s.pfad), { session: s.id, worktree });
  if (!soll.length) {
    vermerke(STATUS.OHNE_CALLS);
    return Object.assign(rec, { status: STATUS.OHNE_CALLS });
  }
  const davor = vorStichtag(soll);
  if (davor) vermerke(STATUS.VOR_STICHTAG);
  const { observations, diff } = await istUndDiff({ s, soll, zugang, now, fetchImpl });
  const eintrag = bereinigeEintrag({ alt, s, beendet, now });
  const e = nachlieferEntscheidung({ diff, gesendet: eintrag.gesendet, davor, trocken: args.trocken });
  Object.assign(rec, { dubletten: e.dubletten, unzuordenbar: e.unzuordenbar, leer: e.leer });
  // Würde-senden-Zahl für den Bericht nur im ersten Lauf vor dem Stichtag: der Vermerk überspringt die Abfrage bei unverändertem Stand.
  if (e.status) return Object.assign(rec, { status: e.status, wuerdeSenden: e.wuerdeSenden });

  // Δ = 0 oder nichts mehr sendbar: nur bestätigen, wenn auch kein gesendeter Call mehr unterwegs ist.
  gesendetAufFehlend(eintrag, diff?.fehlend ?? []);
  let ok = true;
  if (e.sendbar.length) {
    const { chunks } = bauePayloads(s.id, e.sendbar, { soll, ledgerSpans: eintrag.spans, env, project: basename(hauptrepoPfad(repoRoot)), repoName: repo });
    ok = await sendeChunks({ s, chunks, eintrag, zugang, fetchImpl, protokoll, rec, now });
  }
  return schliesseAb({ s, c, rec, alt, eintrag, e, ok, soll, observations, beendet });
}

// ── Ablauf ───────────────────────────────────────────────────────────────────

function bericht(args, protokoll) {
  if (args.json) return JSON.stringify(protokoll, null, 2);
  const p = protokoll;
  const zeilen = [`Nachliefern: ${p.geprueft} Session(s) geprüft, ${p.gesendet} Call(s) und ${p.spans} Subagent-Span(s) gesendet, ${p.dubletten} Dublette(n) (nur gemeldet), würde senden: ${p.wuerdeSenden}.`];
  for (const r of p.sessions.filter(zeigenswert)) {
    zeilen.push(`- ${r.session.slice(0, 8)} ${r.status}: gesendet ${r.gesendet}, würde senden ${r.wuerdeSenden}, Dubletten ${r.dubletten}${r.unzuordenbar ? ` (unzuordenbar ${r.unzuordenbar})` : ""}, ausstehend ${r.ausstehend}${r.befund ? `, ${r.befund}` : ""}${r.endeVerworfen ? (r.fortgesetzt ? ", Ende verworfen (Session nach dem SessionEnd neu gestartet, Startmarke)" : ", Ende verworfen (Transkript wuchs nach dem SessionEnd-Hook)") : ""}`);
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
    zugang = langfuseZugang(env, ohneZugang());
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
    if (kaputt || JSON.stringify(ledger) !== vorher) schreibeJsonAtomar(ledgerDatei, ledger);
  }
  return { exitCode: protokoll.fehler.length ? 1 : 0, text: bericht(args, protokoll), protokoll };
}

// ── Hook-Betrieb: Wartezeit, Lock und Log (#1578; Lock und Log: langfuse-lock.mjs) ─────

/** Nach SessionEnd zuerst warten: Plugin-Flush und Ingestion-Verzug. Muss länger sein als RUHEFRIST_BEENDET_MS, sonst gälte die Session beim Lauf noch als laufend. */
export const WARTE_SESSIONEND = 600_000;

/** Hook-Lauf: SessionEnd wartet zuerst WARTE_SESSIONEND (der Lauf misst die Ruhe danach) und versucht einen belegten Lock einmal erneut. */
export async function hookLauf(args, optionen) {
  const ende = args.ausloeser === "sessionend";
  const jetzt = (optionen.uhr ?? Date.now)();
  // Startmarke je SessionStart (auch bei belegtem Lock): ein wartendes SessionEnd-Kind derselben Session erkennt so die Fortsetzung.
  if (args.ausloeser === "sessionstart" && args.aktuell) markiereStart(optionen.stateDir, args.aktuell, jetzt);
  if (ende) await (optionen.schlafen ?? warte)(WARTE_SESSIONEND);
  const haupt = await gesperrterLauf(ende ? { ...args, ende: jetzt } : args, { ...optionen, ausloeser: args.ausloeser, wiederholen: ende });
  if (args.ausloeser === "sessionstart") await fuehreAuftraegeAus(args, optionen);
  return haupt;
}

/** Status, bei denen ein Auftrag für den nächsten Start bleibt. */
const NICHT_FERTIG = [STATUS.MEHRDEUTIG, STATUS.LAEUFT, STATUS.FEHLER, STATUS.AKTUELL];

/** Ein Auftrag ist erledigt, wenn sein Lauf ohne Fehler endete und die Session weder mehrdeutig noch in der Ruhefrist noch die laufende ist. */
const auftragFertig = (e) => e !== null && e.exitCode === 0 && e.protokoll.sessions.every((r) => !NICHT_FERTIG.includes(r.status));

/** Offene Nachliefer-Aufträge (factory#213) nach einem SessionStart-Lauf ausführen: je Session ein Lauf unter Lock, auch außerhalb des 7-Tage-Fensters (`--session`). */
async function fuehreAuftraegeAus(args, optionen) {
  for (const id of auftraegeLesen(optionen.stateDir, (optionen.uhr ?? Date.now)())) {
    const { ergebnis } = await gesperrterLauf({ ...args, ausloeser: null, beendet: null, session: id }, { ...optionen, ausloeser: "auftrag" });
    if (auftragFertig(ergebnis)) auftragErledigen(optionen.stateDir, id);
  }
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

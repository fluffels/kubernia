// Kein Shebang: wird per `node scripts/langfuse-nachliefern.mjs` gestartet UND von test/harness/langfuse-nachliefern.test.ts importiert.
/**
 * Langfuse nachliefern (#1577, Teil 2a/3 von #1556): sendet die laut Abgleich fehlenden Calls per OTLP/HTTP-JSON nach,
 * idempotent. Bewusst ein eigenes Modul: `langfuse-abgleich.mjs --pruefen` bleibt beweisbar lesend. Dubletten werden nur gemeldet.
 *
 *   node scripts/langfuse-nachliefern.mjs [--session <id>] [--seit <ISO>] [--aktuell <id>] [--beendet <id>] [--trocken] [--json]
 *
 * Idempotenz: je Session zuerst das Ist (zwei Metrics-Abfragen, bei Differenz Observations), gesendet wird `fehlend` minus
 * Ledger-`gesendet` (`~/.claude/state/langfuse-abgleich.json`, nur eine Brücke über den Ingestion-Verzug). Ein kaputtes oder
 * fehlendes Ledger kostet höchstens Abfragen, nie eine Doppelsendung. Importiert nur Builtins und hook-taugliche Module
 * (Hook-Verdrahtung: #1578). Aufruf: docs/referenz/befehle.md, Einordnung: docs/model-routing.md › Checkliste Punkt 1.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { ladeSessionDatei } from "./transkript.mjs";
import {
  RUHEFRIST_MIN,
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
export const STICHTAG = "2026-10-09T00:00:00Z";
/** Ohne bekanntes Ende gilt eine Session erst nach dieser Ruhe als beendet (eine untätig offene Parallelsession bleibt unberührt). */
export const RUHEFRIST_OHNE_ENDE_H = 24;
const LEDGER_NAME = "langfuse-abgleich.json";

export const AUFRUFHILFE = "Aufruf: node scripts/langfuse-nachliefern.mjs [--session <id>] [--seit <ISO>] [--aktuell <id>] [--beendet <id>] [--trocken] [--json]";
export const OHNE_ZUGANG = "Kein Langfuse-Zugang: LANGFUSE_PUBLIC_KEY + LANGFUSE_SECRET_KEY fehlen (nur aus der Umgebung; Agentenläufe haben den Secret-Key nicht).";

/** Unbekanntes Flag oder fehlender Wert: `fehler` gesetzt (der Aufrufer meldet Exit 2). */
export function parseArgs(argv) {
  const a = { session: null, seit: null, aktuell: null, beendet: null, trocken: false, json: false, fehler: null };
  const mitWert = { "--session": "session", "--seit": "seit", "--aktuell": "aktuell", "--beendet": "beendet" };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === "--trocken") a.trocken = true;
    else if (k === "--json") a.json = true;
    else if (k in mitWert) {
      const wert = argv[++i];
      if (wert === undefined || wert.startsWith("--")) a.fehler = `${k} braucht einen Wert`;
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
  const endeBekannt = args.beendet === s.id || args.session === s.id;
  const beendet = endeBekannt || Boolean(alt?.beendet && unveraendert);
  const ruheMs = beendet ? RUHEFRIST_MIN * 60_000 : RUHEFRIST_OHNE_ENDE_H * 3_600_000;
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

function bericht(args, protokoll) {
  if (args.json) return JSON.stringify(protokoll, null, 2);
  const p = protokoll;
  const zeilen = [`Nachliefern: ${p.geprueft} Session(s) geprüft, ${p.gesendet} Call(s) und ${p.spans} Subagent-Span(s) gesendet, ${p.dubletten} Dublette(n) (nur gemeldet), würde senden: ${p.wuerdeSenden}.`];
  for (const r of p.sessions.filter((x) => x.gesendet || x.wuerdeSenden || x.dubletten || x.ausstehend || x.befund || x.status === "Fehler" || x.status === "mehrdeutig")) {
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
  const protokoll = { geprueft: 0, gesendet: 0, spans: 0, dubletten: 0, wuerdeSenden: 0, sessions: [], fehler: [] };
  if (args.fehler) return { exitCode: 2, text: `${args.fehler}\n${AUFRUFHILFE}`, protokoll };
  const seitMs = args.seit ? Date.parse(args.seit) : now - 7 * 86_400_000;
  if (!Number.isFinite(seitMs)) return { exitCode: 2, text: `--seit ist keine ISO-Zeit: ${args.seit}\n${AUFRUFHILFE}`, protokoll };
  let zugang;
  try {
    zugang = langfuseZugang(env, OHNE_ZUGANG);
  } catch (e) {
    return { exitCode: 2, text: e.message, protokoll };
  }
  const ledgerDatei = join(stateDir, LEDGER_NAME);
  const { ledger, kaputt } = ledgerLesen(ledgerDatei);
  if (kaputt && !args.trocken) renameSync(ledgerDatei, `${ledgerDatei}.kaputt-${new Date(now).toISOString().replace(/[:.]/g, "-")}`);
  const vorher = JSON.stringify(ledger);
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

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const repoRoot = fileURLToPath(new URL("..", import.meta.url));
  const { exitCode, text } = await nachliefern(args, { projectsRoot: join(homedir(), ".claude", "projects"), stateDir: join(homedir(), ".claude", "state"), repoRoot });
  (exitCode === 0 ? console.log : console.error)(text);
  process.exitCode = exitCode;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();

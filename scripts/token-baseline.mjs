// Kein Shebang: wird per `node scripts/token-baseline.mjs` gestartet UND von
// test/harness/token-baseline.test.ts importiert (ein `#!` bricht den Test-Import).
/**
 * Token- und Loop-Baseline pro Ticket-Lauf (#1068): Tokens nach Phase × Modell
 * (Input / Cache-Write / Cache-Read / Output) plus Loop-Kennzahlen.
 * Aufruf, Phasen-Regeln und Baseline: docs/model-routing.md §5.
 *
 *   node scripts/token-baseline.mjs --session <id> [--session <id>…] \
 *        [--issue <nr>] [--pr <nr>] [--from <ISO-Zeit>] [--langfuse] [--json]
 *
 * ZWEI Quellen, EINE Auswertung (`summarize` kennt die Quelle nicht):
 *   1. Standard: das lokale Claude-Code-Transkript (vollständig, ohne Schlüssel).
 *   2. `--langfuse`: die v2-Observations-API (v4 hat die v1-Traces-API
 *      abgeschaltet); LANGFUSE_PUBLIC_KEY/_SECRET_KEY, optional _BASE_URL.
 *      Nur so vollständig wie die Hook-Aufzeichnung — ohne den lokalen
 *      Hook-Patch aus #1084 fehlt Folgearbeit nach Hintergrund-Subagenten
 *      (für #1064 der Großteil), mit Patch Calls und Tokens identisch. Die Baseline misst
 *      deshalb über das Transkript (docs/model-routing.md §5).
 *
 * Projekt-Brain-Kennzahlen (#1205): Tool-Events beider Quellen → `brain` (scripts/brain-metrics.mjs).
 *
 * Bewusst NICHT in `npm run verify` (liest lokale Transkripte bzw. braucht Netz
 * und gh-Auth). Die Auswertung ist pure/exportiert und ohne IO getestet; die
 * dünnen IO-Helfer (Dateisuche, gh) sind bewusst ungetestet.
 */

import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { parseNachweis } from "./slice-override.mjs";
import { ghText, zaehleRoteCommits } from "./ci-laeufe.mjs";
import { ghJson } from "./gh-cli.mjs";
import { EINGABE_TOOLS, brainMetrics, mitEingabe, pflegeIntervals, toolEventsFromLangfuse, toolEventsFromTranscript } from "./brain-metrics.mjs";
import { ladeSessionDatei, transkriptZeilen } from "./transkript.mjs";
import { fehlerArten, pruefLaeufe, wiederlesen } from "./tool-metriken.mjs";

/** Lenses pro Review-Runde für Läufe ohne Runden-Marker (vor #1265 liefen immer alle drei Brillen, #1012). */
export const LENSES_PER_ROUND = 3;

export const PHASES = [
  "Auswahl",
  "Planung",
  "Umsetzung",
  "Pflege",
  "Review",
  "CI/Merge",
  "Recherche",
  "Nachlauf",
];

/** Workflow-Labels (`.claude/workflows/kubernia-ticket.js`) → Phase, per Präfix. */
const WORKFLOW_LABELS = [
  [/^auswahl/i, "Auswahl"],
  [/^(plan|preflight):/i, "Planung"],
  [/^(umsetzen|nachbessern)\b/i, "Umsetzung"],
  [/^(pr\+merge|ci-fix)\b/i, "CI/Merge"],
];

/**
 * Phase eines Subagenten: erst der eindeutige `agentType`, dann Workflow-Label,
 * dann Skill-Beschreibung (Review vor Plan — „Lens 2 gegen den Plan" ist Review).
 * Unklar → null: der Call fällt auf den Zeitschnitt des Hauptagenten zurück,
 * statt in einem Sammeltopf zu verschwinden.
 */
export function classifySubagent(agentType, description) {
  const t = String(agentType ?? "");
  const d = String(description ?? "");
  if (/planner/i.test(t)) return "Planung";
  if (/explore/i.test(t)) return "Recherche";
  if (/lens/i.test(t)) return "Review";
  // Der Umsetzer arbeitet über Umsetzung UND CI/Merge: keine feste Phase, der
  // Zeitschnitt teilt ihn; vor den Beschreibungs-Regeln, damit „Plan“/„Review“ im Text nicht greift.
  if (/umsetzer/i.test(t)) return null;
  for (const [re, phase] of WORKFLOW_LABELS) if (re.test(d)) return phase;
  if (/\blens\b|review|kritiker/i.test(d)) return "Review";
  if (/\bplan/i.test(d)) return "Planung";
  return null;
}

/** Hauptagent-Phase aus dem Zeitpunkt; fehlende Grenzen fallen auf Umsetzung. */
export function classifyMainByTime(ts, { claimAt, prCreatedAt, mergedAt } = {}) {
  const t = Date.parse(ts);
  if (claimAt && t < Date.parse(claimAt)) return "Auswahl";
  if (mergedAt && t >= Date.parse(mergedAt)) return "Nachlauf";
  if (prCreatedAt && t >= Date.parse(prCreatedAt)) return "CI/Merge";
  return "Umsetzung";
}

/** Runden-Marker einer Lens: Workflow-Label `lens:<brille>:r<n>`, Skill-Beschreibung `… R<n>` (#1265). */
const ROUND_MARKER = /(?::r|\bR)(\d+)\b/;

/**
 * Review-Runden. Tragen die Lenses einen Runden-Marker, zählt der höchste Marker (#1265: die
 * Staffel fährt 1–3 Lenses je Runde, eine feste Lens-Zahl je Runde stimmt nicht mehr; eine Lens
 * ohne Marker zählt als Runde 1). Ohne Marker die Heuristik für ältere Läufe: je drei Lenses eine
 * Runde (#1012). Jeder weitere Review-Subagent ohne „Lens" (z.B. „Frischer Kritiker Runde 2") ist
 * eine eigene Runde. Der Festgefahren-Review ist keine Konvergenz-Runde und zählt nicht.
 */
export function countReviewRounds(reviewDescriptions) {
  const rounds = reviewDescriptions.filter((d) => !/festgefahren/i.test(d));
  const lenses = rounds.filter((d) => /\blens\b/i.test(d));
  const markers = lenses.map((d) => Number(ROUND_MARKER.exec(d)?.[1] ?? 1));
  const lensRounds = lenses.some((d) => ROUND_MARKER.test(d))
    ? Math.max(...markers)
    : Math.ceil(lenses.length / LENSES_PER_ROUND);
  return lensRounds + (rounds.length - lenses.length);
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** Stand der Preistabelle (im Report ausgegeben, bei jeder Preisänderung mitziehen). */
export const PRICES_STAND = "2026-10-08";

/**
 * Preise in $ je Mio Tokens (Stand siehe `PRICES_STAND`, Quelle: Preisliste auf claude.com/pricing,
 * deckungsgleich mit den Modell-Definitionen der lokalen Langfuse-Instanz). Langfuse
 * rechnet Kosten nur bei der Ingestion, ein später angelegter Preis gilt nicht
 * rückwirkend — darum kommen die Kosten im Transkript-Modus aus dieser Tabelle.
 * Ein Modell ohne Eintrag ist „ohne Preis" (null), nie 0 $.
 *
 * Ein Eintrag ist ein Preisobjekt (gilt immer) ODER eine Liste von Perioden
 * `[{ validFrom: null | ISO-Zeit, …Preise }]`, aufsteigend nach `validFrom` (`null` = seit
 * Modellstart). Eine Preisänderung wird als neue Periode ANGEHÄNGT, damit alte Läufe ihren
 * damaligen Preis behalten. Preisobjekt oder Periode kann `stufen: [{ ueberPrompt, …Preise }]`
 * tragen: Prompt = input + cacheWrite + cacheRead des Calls; über `ueberPrompt` Tokens
 * (strikt größer) gelten die Preise der höchsten zutreffenden Stufe statt der Grundpreise.
 * Quellen: platform.claude.com/docs/en/about-claude/pricing und die Release Notes
 * (Sonnet 5.5, Cache-Read ab 2026-10-07 0,10 statt 0,20 $; die Uhrzeit ist nicht belegt, 00:00 UTC
 * ist eine Annahme, der Fehler beschränkt sich auf Cache-Reads dieses einen Tages).
 */
export const PRICES = {
  "claude-sonnet-5-5": [
    { validFrom: null, input: 2, cacheWrite5m: 2.5, cacheWrite1h: 4, cacheRead: 0.2, output: 10 },
    { validFrom: "2026-10-07T00:00:00Z", input: 2, cacheWrite5m: 2.5, cacheWrite1h: 4, cacheRead: 0.1, output: 10 },
  ],
  "claude-opus-5-5": { input: 4, cacheWrite5m: 5, cacheWrite1h: 8, cacheRead: 0.2, output: 20 },
  "claude-opus-5": { input: 5, cacheWrite5m: 6.25, cacheWrite1h: 10, cacheRead: 0.5, output: 25 },
  "claude-haiku-5-5": {
    input: 0.1,
    cacheWrite5m: 0.125,
    cacheWrite1h: 0.2,
    cacheRead: 0.01,
    output: 0.5,
    stufen: [{ ueberPrompt: 100_000, input: 0.5, cacheWrite5m: 0.625, cacheWrite1h: 1, cacheRead: 0.05, output: 2.5 }],
  },
  "claude-haiku-4-5": { input: 1, cacheWrite5m: 1.25, cacheWrite1h: 2, cacheRead: 0.1, output: 5 },
};

const matcherCache = new WeakMap();

/** Je Preistabelle einmal gebaut: [{ key, re }] statt pro Call neuer RegExp. */
function matchersOf(prices) {
  let list = matcherCache.get(prices);
  if (!list) {
    list = Object.keys(prices).map((key) => ({ key, re: new RegExp(`^${key}-\\d{8}$`) }));
    matcherCache.set(prices, list);
  }
  return list;
}

/** Eintrag → die zum Zeitpunkt `ts` gültige Periode (Einzelobjekt gilt immer). Bei einer Periodenliste
 *  und fehlendem/ungültigem `ts` ist die Periode nicht bestimmbar: „ohne Preis" (null), nie still die neueste (#1309). */
export function periodAt(entry, ts) {
  if (!Array.isArray(entry)) return entry;
  const at = Date.parse(ts);
  if (!Number.isFinite(at)) return null;
  const valid = entry.filter((p) => p.validFrom == null || !(at < Date.parse(p.validFrom)));
  return valid.length ? valid[valid.length - 1] : null;
}

/** Exakter Name oder Name mit Datums-Suffix (`-20251001`); `claude-opus-5-5` ist kein Opus 5. */
function priceFor(model, prices, ts) {
  const id = String(model ?? "");
  const hit = matchersOf(prices).find(({ key, re }) => id === key || re.test(id));
  return hit ? periodAt(prices[hit.key], ts) : null;
}

/** Preise der höchsten Stufe, deren `ueberPrompt` der Prompt strikt übersteigt (unabhängig von der Listenreihenfolge); sonst die Grundpreise. */
function stufePreis(preis, prompt) {
  const treffer = (preis.stufen ?? []).filter((st) => prompt > st.ueberPrompt).sort((a, b) => b.ueberPrompt - a.ueberPrompt)[0];
  return treffer ? { ...preis, ...treffer } : preis;
}

/** Kosten eines Calls je Teil in $; null, wenn das Modell keinen Preis hat. */
export function priceParts(c, prices = PRICES) {
  const base = priceFor(c.model, prices, c.ts);
  if (!base) return null;
  const write = num(c.cacheWrite);
  const p = stufePreis(base, num(c.input) + write + num(c.cacheRead));
  const write1h = Math.min(num(c.cacheWrite1h), write);
  // Division statt Multiplikation mit 1e-6: bleibt bei glatten Zahlen exakt.
  const mio = 1e6;
  return {
    input: (num(c.input) * p.input) / mio,
    cacheWrite: ((write - write1h) * p.cacheWrite5m + write1h * p.cacheWrite1h) / mio,
    cacheRead: (num(c.cacheRead) * p.cacheRead) / mio,
    output: (num(c.output) * p.output) / mio,
  };
}

/** Gesamtkosten eines Calls in $; null = ohne Preis. */
export function priceCall(c, prices = PRICES) {
  const parts = c.costParts ?? priceParts(c, prices);
  return parts ? sumParts(parts) : null;
}

const sumParts = (p) => p.input + p.cacheWrite + p.cacheRead + p.output;

const contextOf = (c) => num(c.input) + num(c.cacheWrite) + num(c.cacheRead);

function median(values) {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

const subKey = (c) => c.subagent.id ?? c.subagent;
/**
 * Schlüssel der Konversation eines Calls (#1331): Subagent über `subKey`, der Hauptagent über `main:<sessionId>`. Mehrere
 * Sessions (`--session a --session b`) teilten sonst den Schlüssel `null` und vermischten ihre Pflege-Intervalle. Calls ohne
 * Session-Angabe (Tests, ältere Aufrufer) behalten `null`; die Events tragen denselben Schlüssel in `agent`.
 */
const agentKey = (c) => (c.subagent ? subKey(c) : c.session ? `main:${c.session}` : null);

/**
 * Sockel (#1198/#1206): Kontext des ERSTEN Calls des Hauptagenten (Größe der Session, darum
 * sessionweit und unabhängig von `--from`) bzw. je Subagent; Planung und Review als Median über
 * die Subagenten IM Ticket-Fenster (`windowCalls`: nach `--from`, ohne Nachlauf), damit der Planer
 * eines anderen Tickets derselben Session nicht mitzählt.
 */
function sockelOf(allCalls, windowCalls) {
  const first = (calls) => [...calls].sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts));
  const main = first(allCalls).find((c) => !c.subagent);
  const firstBySub = new Map();
  for (const c of first(windowCalls)) if (c.subagent && !firstBySub.has(subKey(c))) firstBySub.set(subKey(c), c);
  const phaseSockel = (phase) =>
    median(
      [...firstBySub.values()]
        .filter((c) => classifySubagent(c.subagent.agentType, c.subagent.description) === phase)
        .map(contextOf),
    );
  return { main: main ? contextOf(main) : null, planung: phaseSockel("Planung"), review: phaseSockel("Review") };
}

const ohnePreis = (c) => c.cost === undefined || c.cost === null;

/** Calls ohne Preis je Modell (#1441): der Wächter nennt das fehlende Modell, damit es in PRICES nachgetragen wird. */
function unpricedModels(calls) {
  const out = {};
  for (const c of calls.filter(ohnePreis)) {
    const name = String(c.model ?? "unbekannt");
    out[name] = (out[name] ?? 0) + 1;
  }
  return out;
}

/**
 * Pure Kernlogik über normalisierte Calls:
 *   calls:     [{ ts, model, input, cacheWrite, cacheWrite1h?, cacheRead, output, cost?, costParts?, subagent?: {id, agentType, description} }]
 *              (`cost` null/fehlend = ohne Preis; `costParts` = Kosten je Teil, nur aus dem Transkript-Adapter)
 *   questions: Anzahl AskUserQuestion-Aufrufe
 * Review-Runden zählen nur Subagenten mit Calls IM Ticket-Fenster — sonst
 * erbte ein Ticket die Lenses eines früheren Tickets derselben Session.
 */
export function summarize({ calls, questions = 0, events }, bounds = {}, prFiles = null) {
  // Events vor `--from` (früheres Ticket derselben Session) und nach dem Merge zählen nicht (auch nicht die Pflege-Marker).
  const imFenster = (events ?? []).filter((e) => fensterLage(e.ts, bounds) === "ticket");
  const { intervals, unpaired } = events ? pflegeIntervals(imFenster) : { intervals: [], unpaired: 0 };
  const window = windowCalls(calls, bounds, intervals);
  const sorted = phaseRows(window);
  const ticket = window.filter((w) => w.phase !== "Nachlauf").map((w) => w.call);
  const out = {
    rows: sorted,
    // Summe = das Ticket; der Nachlauf nach dem Merge wird gezeigt, aber nicht mitgezählt.
    total: totalOf(sorted.filter((r) => r.phase !== "Nachlauf")),
    // Invariante: Σ rows = total + nachlauf (Kosten und Calls); der Nachlauf ist die einzige Differenz (#1379).
    nachlauf: totalOf(sorted.filter((r) => r.phase === "Nachlauf")),
    hasCost: window.some((w) => w.call.cost !== undefined && w.call.cost !== null),
    reviewRounds: countReviewRounds(reviewDescriptions(ticket)),
    cacheRebuilds: countCacheRebuilds(ticket),
    questions,
    unpriced: ticket.filter(ohnePreis).length,
    unpricedModels: unpricedModels(ticket),
    costParts: costPartsOf(ticket),
    medianContext: {
      all: median(ticket.map(contextOf)),
      main: median(ticket.filter((c) => !c.subagent).map(contextOf)),
    },
    sockel: sockelOf(calls, ticket),
  };
  if (events) {
    // Das Ticket-Fenster besitzt dieser Ort (`fensterLage`); Marker und Brain-Kennzahlen bekommen nur Events darin.
    const recherche = sorted.filter((r) => r.phase === "Recherche");
    out.pflegeUnpaired = unpaired;
    out.pflegeOhneDauer = intervals.filter((iv) => iv.from === iv.to).length; // Start und Ende im selben Befehl: gepaart, aber ohne Messwert (#1382)
    out.fehler = fehlerArten(imFenster);
    out.lesen = wiederlesen(imFenster);
    out.pruef = pruefLaeufe(imFenster);
    // Ein Umsetzer lief, aber kein einziger Marker: die Pflegekosten stecken in „Umsetzung“ (#1379).
    out.pflegeFehlt = intervals.length === 0 && unpaired === 0 && ticket.some((c) => c.subagent?.agentType === "kubernia-umsetzer");
    out.brain = { ...brainMetrics(imFenster, prFiles), rechercheTokens: recherche.reduce((n, r) => n + r.input + r.cacheWrite + r.cacheRead + r.output, 0) };
  }
  return out;
}

/** Lage eines Zeitstempels zum Ticket-Fenster: `vor` `from` (fremde Arbeit), `ticket` (halboffen `[from, mergedAt)`), `nachlauf` ab dem Merge. */
export function fensterLage(ts, bounds = {}) {
  if (bounds.from && Date.parse(ts) < Date.parse(bounds.from)) return "vor";
  if (bounds.mergedAt && Date.parse(ts) >= Date.parse(bounds.mergedAt)) return "nachlauf";
  return "ticket";
}

/**
 * Calls im Ticket-Fenster samt Phase. Vor `from` liegt fremde Arbeit derselben Session (z.B. ein
 * vorheriges Ticket) — weglassen; nach dem Merge ist alles Nachlauf, auch ein Subagent, den erst
 * das Gespräch danach startet. Calls eines Agenten zwischen seinen Pflege-Markern (#1099, `intervals` aus
 * `pflegeIntervals`, Grenzen inklusive) sind Pflege; der Nachlauf schlägt sie, sie schlagen die übrigen Regeln.
 */
export function windowCalls(calls, bounds = {}, intervals = []) {
  const out = [];
  for (const c of calls) {
    const lage = fensterLage(c.ts, bounds);
    if (lage === "vor") continue;
    const afterMerge = lage === "nachlauf";
    const agent = agentKey(c);
    const t = Date.parse(c.ts);
    const inPflege = intervals.some((iv) => iv.agent === agent && t >= Date.parse(iv.from) && t <= Date.parse(iv.to));
    const subPhase = c.subagent ? classifySubagent(c.subagent.agentType, c.subagent.description) : null;
    out.push({ call: c, phase: afterMerge ? "Nachlauf" : inPflege ? "Pflege" : (subPhase ?? classifyMainByTime(c.ts, bounds)) });
  }
  return out;
}

/** Tabellenzeilen Phase × Modell, nach Phasenreihenfolge sortiert. */
function phaseRows(window) {
  const rows = new Map();
  for (const { call: c, phase } of window) {
    const model = c.model || "unbekannt";
    const key = `${phase}\u0000${model}`;
    const r = rows.get(key) ?? { phase, model, calls: 0, input: 0, cacheWrite: 0, cacheRead: 0, output: 0, cost: 0 };
    r.calls += 1;
    r.input += num(c.input);
    r.cacheWrite += num(c.cacheWrite);
    r.cacheRead += num(c.cacheRead);
    r.output += num(c.output);
    if (c.cost !== undefined && c.cost !== null) r.cost += num(c.cost);
    rows.set(key, r);
  }
  return [...rows.values()].sort((a, b) => PHASES.indexOf(a.phase) - PHASES.indexOf(b.phase) || a.model.localeCompare(b.model));
}

function totalOf(rows) {
  return rows.reduce(
    (t, r) => ({
      calls: t.calls + r.calls,
      input: t.input + r.input,
      cacheWrite: t.cacheWrite + r.cacheWrite,
      cacheRead: t.cacheRead + r.cacheRead,
      output: t.output + r.output,
      cost: t.cost + r.cost,
    }),
    { calls: 0, input: 0, cacheWrite: 0, cacheRead: 0, output: 0, cost: 0 },
  );
}

/** Kosten je Teil über die bepreisten Calls. */
function costPartsOf(calls) {
  const parts = { input: 0, cacheWrite: 0, cacheRead: 0, output: 0 };
  for (const c of calls) for (const k of Object.keys(parts)) parts[k] += num(c.costParts?.[k]);
  return parts;
}

/** Pause, ab der ein Cache (5-Minuten-TTL) als abgelaufen gilt: Subagenten schreiben mit 5 m, der Hauptchat mit 1 h. */
const CACHE_PAUSE_MS = { subagent: 5 * 60_000, main: 60 * 60_000 };

/**
 * Cache-Neuaufbauten (#1309, Messpunkt zur Cache-TTL des Umsetzers): ein Call gilt als Neuaufbau, wenn
 * seit dem Vorgänger derselben Konversation (je Subagent bzw. „main") mehr als die TTL vergangen ist UND
 * der Cache-Read unter der Hälfte des Kontexts liegt (der Prefix wurde also neu geschrieben, nicht gelesen).
 * Rückgabe: Anzahl und die dabei neu geschriebenen Cache-Write-Tokens.
 */
export function countCacheRebuilds(calls) {
  const byConv = new Map();
  for (const c of calls) {
    const key = String(agentKey(c) ?? "main");
    if (!byConv.has(key)) byConv.set(key, []);
    byConv.get(key).push(c);
  }
  let count = 0;
  let cacheWriteTokens = 0;
  for (const list of byConv.values()) {
    const pause = list[0].subagent ? CACHE_PAUSE_MS.subagent : CACHE_PAUSE_MS.main;
    const sorted = [...list].sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts));
    for (let i = 1; i < sorted.length; i++) {
      const gap = Date.parse(sorted[i].ts) - Date.parse(sorted[i - 1].ts);
      const ctx = contextOf(sorted[i]);
      if (gap > pause && ctx > 0 && num(sorted[i].cacheRead) < ctx / 2) {
        count += 1;
        cacheWriteTokens += num(sorted[i].cacheWrite);
      }
    }
  }
  return { count, cacheWriteTokens };
}

/** Beschreibungen der Review-Subagenten, die im Ticket-Fenster Calls haben (je Subagent einmal). */
function reviewDescriptions(ticketCalls) {
  const subs = new Map();
  for (const c of ticketCalls) if (c.subagent) subs.set(subKey(c), c.subagent);
  return [...subs.values()]
    .filter((s) => classifySubagent(s.agentType, s.description) === "Review")
    .map((s) => String(s.description ?? ""));
}

// ── Quelle 1: Claude-Code-Transkript ─────────────────────────────────────────

/**
 * JSONL-Zeilen eines Transkripts → Calls. Claude Code schreibt pro Content-
 * Block eine Zeile mit derselben `message.id`; die Usage wird je Nachricht
 * genau einmal gezählt (Output = Maximum über die Zeilen, weil Zwischenzeilen
 * einen Teilstand tragen).
 */
export function callsFromTranscript(textOderZeilen, subagent = null) {
  const byId = new Map();
  let questions = 0;
  // Text oder die schon geparsten Zeilen (`transkriptZeilen`): `readTranscriptSession` parst jede Zeile nur einmal.
  for (const row of Array.isArray(textOderZeilen) ? textOderZeilen : transkriptZeilen(textOderZeilen)) {
    const msg = row?.message;
    if (row?.type !== "assistant" || !msg?.usage) continue;
    // Eine Zeile trägt genau einen Content-Block — jede Rückfrage zählt also einmal.
    for (const c of msg.content ?? []) if (c?.type === "tool_use" && c.name === "AskUserQuestion") questions += 1;
    const key = msg.id ?? row.uuid;
    const u = msg.usage;
    const prev = byId.get(key);
    if (prev) {
      prev.output = Math.max(prev.output, num(u.output_tokens));
      prev.costParts = priceParts(prev);
      prev.cost = prev.costParts ? priceCall(prev) : null;
      continue;
    }
    const call = {
      ts: row.timestamp,
      model: msg.model,
      input: num(u.input_tokens),
      cacheWrite: num(u.cache_creation_input_tokens),
      // Ohne Aufteilung zählt alles als 5m (der günstigere Preis, bewusst nicht geraten).
      cacheWrite1h: num(u.cache_creation?.ephemeral_1h_input_tokens),
      cacheRead: num(u.cache_read_input_tokens),
      output: num(u.output_tokens),
      subagent,
    };
    call.costParts = priceParts(call);
    call.cost = call.costParts ? priceCall(call) : null;
    byId.set(key, call);
  }
  return { calls: [...byId.values()], questions };
}

/** Sucht <id>.jsonl in allen Projektordnern unter ~/.claude/projects (Worktree-Sessions liegen in eigenen). */
export function readTranscriptSession(sessionId, projectsRoot) {
  const candidates = readdirSync(projectsRoot).map((d) => join(projectsRoot, d, `${sessionId}.jsonl`));
  const main = candidates.find((p) => existsSync(p));
  if (!main) throw new Error(`Kein Transkript für Session ${sessionId} unter ${projectsRoot}`);
  const sitzung = ladeSessionDatei(main);
  const all = callsFromTranscript(sitzung.main);
  for (const c of all.calls) c.session = sessionId;
  all.events = toolEventsFromTranscript(sitzung.main, `main:${sessionId}`);
  for (const { datei, meta, zeilen } of sitzung.subagents) {
    const sub = { id: datei, agentType: meta.agentType, description: meta.description, parentAgentId: meta.parentAgentId };
    const r = callsFromTranscript(zeilen, sub);
    all.events.push(...toolEventsFromTranscript(zeilen, sub.id));
    all.calls.push(...r.calls);
    all.questions += r.questions;
  }
  return all;
}

// ── Quelle 2: Langfuse v2-Observations-API ───────────────────────────────────

function isSubagentSpan(o) {
  return typeof o?.name === "string" && o.name.startsWith("Subagent") && o.type !== "GENERATION";
}

function spanInfo(span) {
  return { id: span.id, agentType: span.metadata?.agent_type, description: String(span.name ?? "").replace(/^Subagent:?\s*/, "") };
}

/** Nächster umschließender Subagent-Span (über parentObservationId) oder null. */
export function findSubagentAncestor(obs, byId) {
  let cur = obs.parentObservationId ? byId.get(obs.parentObservationId) : undefined;
  const seen = new Set();
  while (cur && !seen.has(cur.id)) {
    if (isSubagentSpan(cur)) return cur;
    seen.add(cur.id);
    cur = cur.parentObservationId ? byId.get(cur.parentObservationId) : undefined;
  }
  return null;
}

/**
 * Resolver für `toolEventsFromLangfuse` (#1099): ordnet ein TOOL dem umschließenden Subagent-Span zu
 * (dieselbe ID wie `subKey` der Calls), der Hauptagent ergibt null. `observations` sind die vollen Observations
 * der Session (mit Eltern-Verweisen); ein TOOL aus einer schlanken Abfrage wird über seine ID dort nachgeschlagen.
 */
export function toolAgentResolver(observations) {
  const byId = new Map(observations.map((o) => [o.id, o]));
  return (o) => findSubagentAncestor(byId.get(o.id) ?? o, byId)?.id ?? null;
}

/** Langfuse-Observations (Hook `langfuse-observability`) → Calls. */
export function callsFromLangfuse(observations) {
  const byId = new Map(observations.map((o) => [o.id, o]));
  const calls = observations
    .filter((o) => o.type === "GENERATION")
    .map((o) => {
      const span = findSubagentAncestor(o, byId);
      const u = o.usageDetails ?? {};
      // Die Hook-Aufzeichnung trennt die Cache-Writes nach TTL (`input_cache_creation_5m|1h`); ältere
      // Aufzeichnungen tragen nur die Summe (`cache_creation_input_tokens`, zählt als 5m).
      const write5m = num(u.input_cache_creation_5m);
      const write1h = num(u.input_cache_creation_1h);
      const split = u.input_cache_creation_5m !== undefined || u.input_cache_creation_1h !== undefined;
      const call = {
        ts: o.startTime,
        model: o.providedModelName ?? o.model,
        input: num(u.input),
        cacheWrite: split ? write5m + write1h : num(u.cache_creation_input_tokens),
        cacheWrite1h: split ? write1h : 0,
        cacheRead: num(u.cache_read_input_tokens),
        output: num(u.output),
        subagent: span ? spanInfo(span) : null,
      };
      // Eine Preisquelle (#1239): Kosten immer aus PRICES wie im Transkript-Modus, nicht aus Langfuse
      // (`totalCost` entsteht nur bei der Ingestion und gilt nicht rückwirkend).
      call.costParts = priceParts(call);
      call.cost = call.costParts ? priceCall(call) : null;
      return call;
    });
  return {
    calls,
    questions: observations.filter((o) => o.name === "Tool: AskUserQuestion").length,
  };
}

/** Alle Observations einer Session über die v2-API holen (cursor-paginiert). */
export async function fetchSessionObservations(
  sessionId,
  { baseUrl, publicKey, secretKey, fetchImpl = fetch, type, name, fields = "core,basic,model,usage,metadata" },
) {
  const auth = "Basic " + Buffer.from(`${publicKey}:${secretKey}`).toString("base64");
  const out = [];
  let cursor;
  do {
    const q = new URLSearchParams({ sessionId, limit: "1000", fields });
    if (type) q.set("type", type);
    if (name) q.set("name", name);
    if (cursor) q.set("cursor", cursor);
    const res = await fetchImpl(`${baseUrl.replace(/\/$/, "")}/api/public/v2/observations?${q}`, {
      headers: { Authorization: auth },
    });
    if (!res.ok) throw new Error(`Langfuse ${res.status}: ${await res.text()}`);
    const body = await res.json();
    out.push(...(body.data ?? []));
    cursor = body.meta?.cursor;
  } while (cursor);
  return out;
}

// ── Loop-Kennzahlen aus GitHub ───────────────────────────────────────────────

/** Gemergt ohne CI-Fix = gemergt und kein einziger roter CI-Push. */
export function mergedWithoutRework(mergedAt, failedPushes) {
  return Boolean(mergedAt) && failedPushes === 0;
}

/** Claim-Zeitpunkt = erstes `assigned`-Event im Issue-Verlauf. */
function claimAt(issue) {
  const events = ghJson(["api", `repos/{owner}/{repo}/issues/${issue}/events`, "--paginate"]);
  return events.find((e) => e.event === "assigned")?.created_at;
}

/**
 * Review-Runden und Planer aus den Nachweis-Zeilen der PR-Commits (`KQ-Review:`/`KQ-Plan:`, #1270) statt
 * aus der Transkript-Heuristik. null, wenn keine `KQ-Review:`-Zeile im PR steht (älterer Lauf).
 */
export function nachweisAusCommits(commits) {
  const text = (Array.isArray(commits) ? commits : [])
    .map((c) => `${c?.messageHeadline ?? ""}\n${c?.messageBody ?? ""}`)
    .join("\n");
  const { plan, review } = parseNachweis(text);
  if (!review || !Number.isFinite(review.runden)) return null;
  return { runden: review.runden, plan: plan ? plan.art === "planer" : null };
}

/** CI-Fix-Runden = distinct head_sha mit rotem CI-Lauf zwischen PR-Erstellung und Merge (dieselbe Zählung wie #904, gemeinsamer Abruf: ci-laeufe.mjs). */
function prInfo(pr) {
  const p = ghJson(["pr", "view", String(pr), "--json", "createdAt,mergedAt,headRefName,commits,files"]);
  return {
    prCreatedAt: p.createdAt,
    mergedAt: p.mergedAt,
    failedPushes: zaehleRoteCommits(ghText, { branch: p.headRefName, createdAt: p.createdAt, mergedAt: p.mergedAt }),
    nachweis: nachweisAusCommits(p.commits),
    files: p.files ?? [],
  };
}

// ── Ausgabe + CLI ────────────────────────────────────────────────────────────

const fmt = (n) => Math.round(n).toLocaleString("de-DE");

const FEHLER_LABEL = [["hook", "Hook"], ["guard", "Guard"], ["permission", "Permission"], ["zuGross", "zu groß"], ["sonst", "sonst"]];

/** Zusatzzeilen zu Tool-Fehlern, Lesen und fehlenden Pflege-Markern (#1379); nur mit Tool-Events. */
function werkzeugZeilen(summary) {
  const out = [];
  if (summary.fehler) {
    const f = summary.fehler;
    const teile = FEHLER_LABEL.map(([k, l]) => `${l} ${f[k] ?? 0}`);
    out.push(`Tool-Fehler: ${teile.join(" · ")} · Exit≠0 ${f.exit ?? 0} (kein Fehlersignal)`);
  }
  const l = summary.lesen;
  if (l) {
    const top = l.top.length ? ` · Top ${l.top.map((d) => `${d.datei} ${d.n}×`).join(", ")}` : "";
    out.push(
      `Lesen: ${l.reads} Reads (${l.abschnittsweise} abschnittsweise) · Wiederlesen voll ${l.voll.n} (≈ ${fmt(l.voll.tokens)} Tok) · gezielt ${l.gezielt.n} (≈ ${fmt(l.gezielt.tokens)} Tok)${top}`,
    );
  }
  if (summary.pruef) out.push(`Prüfläufe: verify voll ${summary.pruef.voll} · gezielt ${summary.pruef.gezielt}`);
  if (summary.pflegeFehlt) out.push("⚠️ Kein Pflege-Marker — Pflegekosten stecken in „Umsetzung“.");
  return out;
}

/** Markdown-Report (Tabelle Phase × Modell + Loop-Zeile). */
export function renderMarkdown(summary, loop = {}) {
  const cost = (v) => (summary.hasCost ? v.toFixed(2) : "–");
  const lines = [
    "| Phase | Modell | Calls | Input | Cache-Write | Cache-Read | Output | Kosten $ |",
    "|---|---|--:|--:|--:|--:|--:|--:|",
  ];
  const zeile = (r, label) =>
    `| ${label} | \`${r.model}\` | ${r.calls} | ${fmt(r.input)} | ${fmt(r.cacheWrite)} | ${fmt(r.cacheRead)} | ${fmt(r.output)} | ${cost(r.cost)} |`;
  for (const r of summary.rows.filter((x) => x.phase !== "Nachlauf")) lines.push(zeile(r, r.phase));
  const t = summary.total;
  lines.push(
    `| **Summe (ohne Nachlauf)** | | ${t.calls} | ${fmt(t.input)} | ${fmt(t.cacheWrite)} | ${fmt(t.cacheRead)} | ${fmt(t.output)} | ${cost(t.cost)} |`,
  );
  for (const r of summary.rows.filter((x) => x.phase === "Nachlauf")) lines.push(zeile(r, "Nachlauf (nicht in der Summe)"));
  const ci = loop.failedPushes ?? "–";
  const merged =
    loop.mergedAt === undefined ? "–" : mergedWithoutRework(loop.mergedAt, loop.failedPushes) ? "ja" : "nein";
  const dash = (v) => (v === null || v === undefined ? "–" : fmt(v));
  const brain = summary.brain;
  const sk = summary.sockel;
  const mc = summary.medianContext;
  lines.push(
    "",
    `Sockel Haupt ${dash(sk?.main)} · Planer ${dash(sk?.planung)} · Lens ${dash(sk?.review)} · Median-Kontext Haupt ${dash(mc?.main)} / gesamt ${dash(mc?.all)}`,
  );
  const parts = summary.costParts;
  const sum = parts ? sumParts(parts) : 0;
  if (sum > 0) {
    const pct = (v) => `${Math.round((v / sum) * 100)} %`;
    lines.push(
      `Kostenanteile: Input ${pct(parts.input)} · Cache-Write ${pct(parts.cacheWrite)} · Cache-Read ${pct(parts.cacheRead)} · Output ${pct(parts.output)}`,
    );
  }
  if (summary.cacheRebuilds) {
    const cr = summary.cacheRebuilds;
    lines.push(`Cache-Neuaufbauten: ${cr.count} (≈ ${fmt(cr.cacheWriteTokens)} Tokens Cache-Write)`);
  }
  if (brain) {
    const pr = brain.prBrain ? `${brain.prBrain.pages} Seiten (+${brain.prBrain.additions}/−${brain.prBrain.deletions})` : "–";
    lines.push(
      `Projekt-Brain: gelesen ${brain.brainReads}× (${brain.brainPages} Seiten, ≈ ${fmt(brain.brainReadTokens)} Tokens) · Suche ${brain.searchCalls} Calls (≈ ${fmt(brain.searchTokens)} Tokens) · Recherche-Subagenten ${fmt(brain.rechercheTokens)} Tokens · Calls bis erster Edit ${dash(brain.callsBeforeFirstEdit)} · Brain-Pflege ${brain.brainWrites} Schreibzugriffe, PR ${pr}`,
    );
  }
  lines.push(...werkzeugZeilen(summary));
  if (summary.pflegeOhneDauer > 0) lines.push(`⚠️ ${summary.pflegeOhneDauer} Pflege-Intervall ohne Dauer — Start und Ende standen im selben Befehl (je ein eigener Shell-Befehl nötig), Phase „Pflege“ nicht messbar.`);
  if (summary.pflegeUnpaired > 0) lines.push(`⚠️ ${summary.pflegeUnpaired} Pflege-Marker ohne Gegenstück — Phase „Pflege“ unvollständig.`);
  lines.push(`Preise Stand ${PRICES_STAND}`);
  if (summary.unpriced > 0) lines.push(ohnePreisZeile(summary));
  const nw = loop.nachweis;
  const runden = nw ? `${nw.runden} (Nachweis)` : `${summary.reviewRounds} (Heuristik)`;
  const planer = nw && nw.plan !== null ? ` · Planer: ${nw.plan ? "ja" : "nein"} (KQ-Plan)` : "";
  lines.push(
    "",
    `Review-Runden: ${runden} · CI-Fix-Runden: ${ci} · Rückfragen: ${summary.questions} · gemergt ohne CI-Fix: ${merged}${planer}`,
  );
  return lines.join("\n");
}

/** Warnzeile „ohne Preis“ mit den betroffenen Modellen (#1441). */
function ohnePreisZeile(summary) {
  const modelle = Object.entries(summary.unpricedModels ?? {}).map(([m, n]) => `${m} (${n})`).join(", ");
  return `⚠️ ${summary.unpriced} Call(s) ohne Preis${modelle ? `: ${modelle}` : ""} — Modell in PRICES nachtragen (oder Zeitpunkt fehlt), Kosten unvollständig.`;
}

/** Zugangsdaten für `--langfuse` aus der Umgebung (#1441); ohne Secret-Key (Agentenläufe haben ihn nicht) Hinweis auf den Ersatzweg. */
export function langfuseZugang(env) {
  const { LANGFUSE_PUBLIC_KEY: publicKey, LANGFUSE_SECRET_KEY: secretKey } = env;
  if (!publicKey || !secretKey) {
    throw new Error(
      "--langfuse braucht LANGFUSE_PUBLIC_KEY + LANGFUSE_SECRET_KEY; Agentenläufe haben den Secret-Key nicht: dort queryMetrics (View observations, Filter sessionId und type = GENERATION, Dimension usageType, Metrik usageByType), siehe docs/model-routing.md › Checkliste Punkt 1.",
    );
  }
  return { baseUrl: env.LANGFUSE_BASE_URL ?? "http://localhost:3000", publicKey, secretKey };
}

export function parseArgs(argv) {
  const a = { sessions: [], json: false, langfuse: false };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === "--session") a.sessions.push(argv[++i]);
    else if (k === "--issue") a.issue = argv[++i];
    else if (k === "--pr") a.pr = argv[++i];
    else if (k === "--json") a.json = true;
    else if (k === "--langfuse") a.langfuse = true;
    else if (k === "--from") a.from = argv[++i];
    else throw new Error(`Unbekanntes Argument: ${k}`);
  }
  return a;
}

/** Mehrere Sessions (z.B. Abbruch + Resume) zu einem Lauf zusammenlegen. */
function merge(parts) {
  return {
    calls: parts.flatMap((p) => p.calls),
    questions: parts.reduce((n, p) => n + p.questions, 0),
    events: parts.some((p) => p.events) ? parts.flatMap((p) => p.events ?? []) : undefined,
  };
}

async function loadRun(args) {
  if (!args.langfuse) {
    const root = join(homedir(), ".claude", "projects");
    return merge(args.sessions.map((s) => readTranscriptSession(s, root)));
  }
  const zugang = langfuseZugang(process.env);
  const parts = [];
  for (const s of args.sessions) parts.push(await ladeLangfuseSession(s, zugang));
  return merge(parts);
}

/**
 * Eine Session aus Langfuse: Calls aus den GENERATIONs, Tool-Events in zwei Stufen. Stufe 1 holt alle TOOL-Observations schlank
 * (Name, Zeit, `orig_len`), Stufe 2 die Eingabe (`io`; v2 liefert sie nur samt Ausgabe) nur für die Tools aus `EINGABE_TOOLS`.
 * Die Namen für Stufe 2 kommen aus Stufe 1 (`metadata.tool_name` → tatsächlicher Span-Name): der Hook hängt Datei-Tools einen
 * Bereichs-Qualifier an (`Tool: Read [Kubernia-Doku]`), ein fester Name träfe sie nie. `fetchImpl` ist für Tests injizierbar.
 */
export async function ladeLangfuseSession(sessionId, opts) {
  const observations = await fetchSessionObservations(sessionId, opts);
  const part = callsFromLangfuse(observations);
  const werkzeuge = await fetchSessionObservations(sessionId, { ...opts, type: "TOOL", fields: "core,basic,metadata" });
  const namen = new Set(
    werkzeuge.filter((o) => EINGABE_TOOLS.includes(o?.metadata?.tool_name ?? String(o?.name ?? "").replace(/^Tool:\s*/, "").replace(/\s*\[.*\]$/, ""))).map((o) => o.name),
  );
  const eingaben = [];
  for (const name of namen) eingaben.push(...(await fetchSessionObservations(sessionId, { ...opts, type: "TOOL", name, fields: "core,io" })));
  part.events = toolEventsFromLangfuse(mitEingabe(werkzeuge, eingaben), toolAgentResolver(observations)).map((e) => ({ ...e, agent: e.agent ?? `main:${sessionId}` }));
  for (const c of part.calls) if (!c.subagent) c.session = sessionId;
  return part;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.sessions.length === 0) {
    console.error(
      "Aufruf: node scripts/token-baseline.mjs --session <id> [--issue <nr>] [--pr <nr>] [--from <ISO>] [--langfuse] [--json]",
    );
    process.exit(2);
  }
  const run = await loadRun(args);
  const loop = args.pr ? prInfo(args.pr) : {};
  const bounds = {
    from: args.from,
    claimAt: args.issue ? claimAt(args.issue) : undefined,
    prCreatedAt: loop.prCreatedAt,
    mergedAt: loop.mergedAt,
  };
  const summary = summarize(run, bounds, loop.files ?? null);
  if (args.json) console.log(JSON.stringify({ bounds, loop, ...summary }, null, 2));
  else console.log(renderMarkdown(summary, loop));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}

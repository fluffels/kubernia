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
 * Bewusst NICHT in `npm run verify` (liest lokale Transkripte bzw. braucht Netz
 * und gh-Auth). Die Auswertung ist pure/exportiert und ohne IO getestet; die
 * dünnen IO-Helfer (Dateisuche, gh) sind bewusst ungetestet.
 */

import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

/** Lenses pro Review-Runde (Architektur / Requirement-Treue / Test-Adäquanz, #1012). */
export const LENSES_PER_ROUND = 3;

export const PHASES = [
  "Auswahl",
  "Planung",
  "Umsetzung",
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

/**
 * Review-Runden (Heuristik): je drei Lenses sind eine Runde (#1012), jeder
 * weitere Review-Subagent ohne „Lens" (z.B. „Frischer Kritiker Runde 2") ist
 * eine eigene Runde. Annahme: jede Lens-Runde fährt alle drei Lenses. Der
 * Festgefahren-Review ist keine Konvergenz-Runde und zählt nicht.
 */
export function countReviewRounds(reviewDescriptions) {
  const rounds = reviewDescriptions.filter((d) => !/festgefahren/i.test(d));
  const lenses = rounds.filter((d) => /\blens\b/i.test(d)).length;
  return Math.ceil(lenses / LENSES_PER_ROUND) + (rounds.length - lenses);
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Preise in $ je Mio Tokens (Stand 2026-10-06, Quelle: Preisliste auf claude.com/pricing,
 * deckungsgleich mit den Modell-Definitionen der lokalen Langfuse-Instanz). Langfuse
 * rechnet Kosten nur bei der Ingestion, ein später angelegter Preis gilt nicht
 * rückwirkend — darum kommen die Kosten im Transkript-Modus aus dieser Tabelle.
 * Ein Modell ohne Eintrag ist „ohne Preis" (null), nie 0 $.
 */
export const PRICES = {
  "claude-sonnet-5-5": { input: 2, cacheWrite5m: 2.5, cacheWrite1h: 4, cacheRead: 0.2, output: 10 },
  "claude-opus-5-5": { input: 4, cacheWrite5m: 5, cacheWrite1h: 8, cacheRead: 0.2, output: 20 },
  "claude-opus-5": { input: 5, cacheWrite5m: 6.25, cacheWrite1h: 10, cacheRead: 0.5, output: 25 },
  "claude-haiku-4-5": { input: 1, cacheWrite5m: 1.25, cacheWrite1h: 2, cacheRead: 0.1, output: 5 },
};

/** Exakter Name oder Name mit Datums-Suffix (`-20251001`); `claude-opus-5-5` ist kein Opus 5. */
function priceFor(model, prices) {
  const id = String(model ?? "");
  const key = Object.keys(prices).find((k) => id === k || new RegExp(`^${k}-\\d{8}$`).test(id));
  return key ? prices[key] : null;
}

/** Kosten eines Calls je Teil in $; null, wenn das Modell keinen Preis hat. */
export function priceParts(c, prices = PRICES) {
  const p = priceFor(c.model, prices);
  if (!p) return null;
  const write = num(c.cacheWrite);
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
  const parts = priceParts(c, prices);
  return parts ? parts.input + parts.cacheWrite + parts.cacheRead + parts.output : null;
}

const contextOf = (c) => num(c.input) + num(c.cacheWrite) + num(c.cacheRead);

function median(values) {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

const subKey = (c) => c.subagent.id ?? c.subagent;

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

/**
 * Pure Kernlogik über normalisierte Calls:
 *   calls:     [{ ts, model, input, cacheWrite, cacheRead, output, cost?, subagent?: {id, agentType, description} }]
 *   questions: Anzahl AskUserQuestion-Aufrufe
 * Review-Runden zählen nur Subagenten mit Calls IM Ticket-Fenster — sonst
 * erbte ein Ticket die Lenses eines früheren Tickets derselben Session.
 */
export function summarize({ calls, questions = 0 }, bounds = {}) {
  const rows = new Map();
  const inWindow = new Map();
  const windowCalls = [];
  const contexts = { all: [], main: [] };
  const costParts = { input: 0, cacheWrite: 0, cacheRead: 0, output: 0 };
  let unpriced = 0;
  let hasCost = false;
  for (const c of calls) {
    // Vor `from` liegt fremde Arbeit derselben Session (z.B. ein vorheriges Ticket) — weglassen.
    if (bounds.from && Date.parse(c.ts) < Date.parse(bounds.from)) continue;
    // Nach dem Merge ist alles Nachlauf — auch ein Subagent, den erst das Gespräch danach startet.
    const afterMerge = bounds.mergedAt && Date.parse(c.ts) >= Date.parse(bounds.mergedAt);
    const subPhase = c.subagent ? classifySubagent(c.subagent.agentType, c.subagent.description) : null;
    const phase = afterMerge ? "Nachlauf" : (subPhase ?? classifyMainByTime(c.ts, bounds));
    if (c.subagent && phase !== "Nachlauf") inWindow.set(subKey(c), c.subagent);
    if (phase !== "Nachlauf") {
      windowCalls.push(c);
      contexts.all.push(contextOf(c));
      if (!c.subagent) contexts.main.push(contextOf(c));
      if (c.cost === undefined || c.cost === null) unpriced += 1;
      for (const k of Object.keys(costParts)) costParts[k] += num(c.costParts?.[k]);
    }
    const model = c.model || "unbekannt";
    const key = `${phase}\u0000${model}`;
    const r = rows.get(key) ?? { phase, model, calls: 0, input: 0, cacheWrite: 0, cacheRead: 0, output: 0, cost: 0 };
    r.calls += 1;
    r.input += num(c.input);
    r.cacheWrite += num(c.cacheWrite);
    r.cacheRead += num(c.cacheRead);
    r.output += num(c.output);
    if (c.cost !== undefined && c.cost !== null) {
      hasCost = true;
      r.cost += num(c.cost);
    }
    rows.set(key, r);
  }
  const sorted = [...rows.values()].sort(
    (a, b) => PHASES.indexOf(a.phase) - PHASES.indexOf(b.phase) || a.model.localeCompare(b.model),
  );
  // Summe = das Ticket; der Nachlauf nach dem Merge wird gezeigt, aber nicht mitgezählt.
  const total = sorted
    .filter((r) => r.phase !== "Nachlauf")
    .reduce(
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
  const reviewDescriptions = [...inWindow.values()]
    .filter((s) => classifySubagent(s.agentType, s.description) === "Review")
    .map((s) => String(s.description ?? ""));
  return {
    rows: sorted,
    total,
    hasCost,
    reviewRounds: countReviewRounds(reviewDescriptions),
    questions,
    unpriced,
    costParts,
    medianContext: { all: median(contexts.all), main: median(contexts.main) },
    sockel: sockelOf(calls, windowCalls),
  };
}

// ── Quelle 1: Claude-Code-Transkript ─────────────────────────────────────────

/**
 * JSONL-Zeilen eines Transkripts → Calls. Claude Code schreibt pro Content-
 * Block eine Zeile mit derselben `message.id`; die Usage wird je Nachricht
 * genau einmal gezählt (Output = Maximum über die Zeilen, weil Zwischenzeilen
 * einen Teilstand tragen).
 */
export function callsFromTranscript(jsonlText, subagent = null) {
  const byId = new Map();
  let questions = 0;
  for (const line of String(jsonlText).split(/\r?\n/)) {
    if (!line.trim()) continue;
    let row;
    try {
      row = JSON.parse(line);
    } catch {
      continue; // abgeschnittene letzte Zeile eines laufenden Transkripts
    }
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
function readTranscriptSession(sessionId, projectsRoot) {
  const candidates = readdirSync(projectsRoot).map((d) => join(projectsRoot, d, `${sessionId}.jsonl`));
  const main = candidates.find((p) => existsSync(p));
  if (!main) throw new Error(`Kein Transkript für Session ${sessionId} unter ${projectsRoot}`);
  const all = callsFromTranscript(readFileSync(main, "utf8"));
  const dir = main.replace(/\.jsonl$/, "") + "/subagents";
  if (existsSync(dir)) {
    for (const f of readdirSync(dir).filter((n) => n.endsWith(".jsonl"))) {
      const metaPath = join(dir, f.replace(/\.jsonl$/, ".meta.json"));
      const meta = existsSync(metaPath) ? JSON.parse(readFileSync(metaPath, "utf8")) : {};
      const sub = { id: f, agentType: meta.agentType, description: meta.description };
      const r = callsFromTranscript(readFileSync(join(dir, f), "utf8"), sub);
      all.calls.push(...r.calls);
      all.questions += r.questions;
    }
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

/** Langfuse-Observations (Hook `langfuse-observability`) → Calls. */
export function callsFromLangfuse(observations) {
  const byId = new Map(observations.map((o) => [o.id, o]));
  const calls = observations
    .filter((o) => o.type === "GENERATION")
    .map((o) => {
      const span = findSubagentAncestor(o, byId);
      const u = o.usageDetails ?? {};
      return {
        ts: o.startTime,
        model: o.providedModelName ?? o.model,
        input: u.input,
        cacheWrite: u.cache_creation_input_tokens,
        cacheRead: u.cache_read_input_tokens,
        output: u.output,
        cost: o.totalCost ?? null,
        subagent: span ? spanInfo(span) : null,
      };
    });
  return {
    calls,
    questions: observations.filter((o) => o.name === "Tool: AskUserQuestion").length,
  };
}

/** Alle Observations einer Session über die v2-API holen (cursor-paginiert). */
export async function fetchSessionObservations(sessionId, { baseUrl, publicKey, secretKey, fetchImpl = fetch }) {
  const auth = "Basic " + Buffer.from(`${publicKey}:${secretKey}`).toString("base64");
  const out = [];
  let cursor;
  do {
    const q = new URLSearchParams({ sessionId, limit: "1000", fields: "core,basic,model,usage,metadata" });
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

/** CI-Fix-Runden = distinct head_sha mit failed CI-Lauf (dieselbe Zählung wie #904). */
export function countFailedPushes(workflowRuns) {
  return new Set((workflowRuns ?? []).map((r) => r.head_sha)).size;
}

/** Gemergt ohne Nacharbeit = gemergt und kein einziger roter CI-Push. */
export function mergedWithoutRework(mergedAt, failedPushes) {
  return Boolean(mergedAt) && failedPushes === 0;
}

function ghJson(args) {
  return JSON.parse(execFileSync("gh", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }));
}

/** Claim-Zeitpunkt = erstes `assigned`-Event im Issue-Verlauf. */
function claimAt(issue) {
  const events = ghJson(["api", `repos/{owner}/{repo}/issues/${issue}/events`, "--paginate"]);
  return events.find((e) => e.event === "assigned")?.created_at;
}

function prInfo(pr) {
  const p = ghJson(["pr", "view", String(pr), "--json", "createdAt,mergedAt,headRefName"]);
  const runs = ghJson([
    "api",
    `repos/{owner}/{repo}/actions/workflows/ci.yml/runs?branch=${encodeURIComponent(p.headRefName)}&status=failure&event=pull_request&per_page=100`,
  ]);
  return { prCreatedAt: p.createdAt, mergedAt: p.mergedAt, failedPushes: countFailedPushes(runs.workflow_runs) };
}

// ── Ausgabe + CLI ────────────────────────────────────────────────────────────

const fmt = (n) => Math.round(n).toLocaleString("de-DE");

/** Markdown-Report (Tabelle Phase × Modell + Loop-Zeile). */
export function renderMarkdown(summary, loop = {}) {
  const cost = (v) => (summary.hasCost ? v.toFixed(2) : "–");
  const lines = [
    "| Phase | Modell | Calls | Input | Cache-Write | Cache-Read | Output | Kosten $ |",
    "|---|---|--:|--:|--:|--:|--:|--:|",
  ];
  for (const r of summary.rows) {
    lines.push(
      `| ${r.phase} | \`${r.model}\` | ${r.calls} | ${fmt(r.input)} | ${fmt(r.cacheWrite)} | ${fmt(r.cacheRead)} | ${fmt(r.output)} | ${cost(r.cost)} |`,
    );
  }
  const t = summary.total;
  lines.push(
    `| **Summe (ohne Nachlauf)** | | ${t.calls} | ${fmt(t.input)} | ${fmt(t.cacheWrite)} | ${fmt(t.cacheRead)} | ${fmt(t.output)} | ${cost(t.cost)} |`,
  );
  const ci = loop.failedPushes ?? "–";
  const merged =
    loop.mergedAt === undefined ? "–" : mergedWithoutRework(loop.mergedAt, loop.failedPushes) ? "ja" : "nein";
  const dash = (v) => (v === null || v === undefined ? "–" : fmt(v));
  const sk = summary.sockel;
  const mc = summary.medianContext;
  lines.push(
    "",
    `Sockel Haupt ${dash(sk?.main)} · Planer ${dash(sk?.planung)} · Lens ${dash(sk?.review)} · Median-Kontext Haupt ${dash(mc?.main)} / gesamt ${dash(mc?.all)}`,
  );
  const parts = summary.costParts;
  const sum = parts ? parts.input + parts.cacheWrite + parts.cacheRead + parts.output : 0;
  if (sum > 0) {
    const pct = (v) => `${Math.round((v / sum) * 100)} %`;
    lines.push(
      `Kostenanteile: Input ${pct(parts.input)} · Cache-Write ${pct(parts.cacheWrite)} · Cache-Read ${pct(parts.cacheRead)} · Output ${pct(parts.output)}`,
    );
  }
  if (summary.unpriced > 0) lines.push(`⚠️ ${summary.unpriced} Call(s) ohne Preis (Transkript: Modell nicht in PRICES; Langfuse: kein Preis für das Modell hinterlegt) — Kosten unvollständig.`);
  lines.push(
    "",
    `Review-Runden: ${summary.reviewRounds} · CI-Fix-Runden: ${ci} · Rückfragen: ${summary.questions} · gemergt ohne Nacharbeit: ${merged}`,
  );
  return lines.join("\n");
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
  };
}

async function loadRun(args) {
  if (!args.langfuse) {
    const root = join(homedir(), ".claude", "projects");
    return merge(args.sessions.map((s) => readTranscriptSession(s, root)));
  }
  const { LANGFUSE_PUBLIC_KEY: publicKey, LANGFUSE_SECRET_KEY: secretKey } = process.env;
  if (!publicKey || !secretKey) throw new Error("--langfuse braucht LANGFUSE_PUBLIC_KEY + LANGFUSE_SECRET_KEY.");
  const baseUrl = process.env.LANGFUSE_BASE_URL ?? "http://localhost:3000";
  const parts = [];
  for (const s of args.sessions)
    parts.push(callsFromLangfuse(await fetchSessionObservations(s, { baseUrl, publicKey, secretKey })));
  return merge(parts);
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
  const summary = summarize(run, bounds);
  if (args.json) console.log(JSON.stringify({ bounds, loop, ...summary }, null, 2));
  else console.log(renderMarkdown(summary, loop));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}

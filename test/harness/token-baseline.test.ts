/* Token- und Loop-Baseline pro Ticket-Lauf (#1068).
 *
 * @harness-waechter – einziger Durchsetzer seiner Regel, darum im geschützten test/harness/ (#1165).
 *
 * Die Auswertungslogik lebt in scripts/token-baseline.mjs. Weder Transkript-
 * Dateien noch Langfuse noch gh werden hier angefasst: die Tests füttern
 * JSONL-Text bzw. Observations in der Form, die Claude Code bzw. die
 * v2-Observations-API liefern, und die Fetch-Schicht bekommt ein injiziertes
 * `fetch`.
 *
 * Ausführen mit: npm test
 */
import { describe, test } from "vitest";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Reines Node-Tooling-Skript ohne Declaration-File (wie scripts/check-diffsize.mjs).
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as baselineModule from "../../scripts/token-baseline.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as brainModule from "../../scripts/brain-metrics.mjs";

const toolEventsFromLangfuse = (brainModule as { toolEventsFromLangfuse: (obs: unknown[], agentOf?: (o: never) => string | null) => PEv[] }).toolEventsFromLangfuse;

type Sub = { id?: string; agentType?: string; description?: string; parentAgentId?: string };
type Call = {
  ts: string;
  model?: string | null;
  input?: number;
  cacheWrite?: number;
  cacheWrite1h?: number;
  cacheRead?: number;
  output?: number;
  cost?: number | string | null;
  costParts?: Parts | null;
  subagent?: Sub | null;
  session?: string;
};
type Run = { calls: Call[]; questions?: number };
type Row = { phase: string; model: string; calls: number; input: number; cacheWrite: number; cacheRead: number; output: number; cost: number };
type Parts = { input: number; cacheWrite: number; cacheRead: number; output: number };
type Summary = {
  rows: Row[];
  total: Omit<Row, "phase" | "model">;
  hasCost: boolean;
  reviewRounds: number;
  questions: number;
  unpriced: number;
  unpricedModels?: Record<string, number>;
  costParts: Parts;
  medianContext: { all: number | null; main: number | null };
  sockel: { main: number | null; planung: number | null; review: number | null };
};
type PEv = { ts: string; tool: string; input: Record<string, unknown>; resultChars: number; agent: string | null };
type Bounds = { from?: string; claimAt?: string; prCreatedAt?: string; mergedAt?: string };
type Obs = {
  id: string;
  type: string;
  name: string;
  startTime: string;
  parentObservationId?: string | null;
  providedModelName?: string | null;
  metadata?: { agent_type?: string };
  usageDetails?: Record<string, number>;
  totalCost?: number | string;
};

/** Modul-Form EINMAL deklarieren und genau hier casten (Muster wie cleanup-worktrees.test.ts). */
const m = baselineModule as {
  classifySubagent: (agentType?: string, description?: string) => string | null;
  classifyMainByTime: (ts: string, bounds?: Bounds) => string;
  countReviewRounds: (descriptions: string[]) => number;
  summarize: (run: Run & { events?: PEv[] }, bounds?: Bounds) => Summary & { pflegeUnpaired?: number };
  toolAgentResolver: (obs: Obs[]) => (o: Obs) => string | null;
  callsFromTranscript: (jsonl: string, subagent?: Sub | null) => { calls: Call[]; questions: number };
  readTranscriptSession: (sessionId: string, projectsRoot: string) => { calls: Call[]; questions: number };
  callsFromLangfuse: (obs: Obs[]) => Run & { questions: number };
  mergedWithoutRework: (mergedAt: string | null | undefined, failedPushes: number) => boolean;
  renderMarkdown: (s: Summary, loop?: { failedPushes?: number; mergedAt?: string | null; nachweis?: { runden: number; plan: boolean | null } | null }) => string;
  priceCall: (c: Call, prices?: unknown) => number | null;
  priceParts: (c: Call, prices?: unknown) => Parts | null;
  windowCalls: (calls: Call[], bounds?: Bounds, intervals?: { agent: string | null; from: string; to: string }[]) => { call: Call; phase: string }[];
  PRICES_STAND: string;
  langfuseZugang: (env: Record<string, string | undefined>) => { baseUrl: string; publicKey: string; secretKey: string };
  periodAt: (entry: unknown, ts?: string) => Record<string, unknown> | null;
  countCacheRebuilds: (calls: Call[]) => { count: number; cacheWriteTokens: number };
  nachweisAusCommits: (commits: unknown) => { runden: number; plan: boolean | null } | null;
  parseArgs: (argv: string[]) => { sessions: string[]; issue?: string; pr?: string; from?: string; json: boolean; langfuse: boolean };
  fetchSessionObservations: (
    sessionId: string,
    opts: { baseUrl: string; publicKey: string; secretKey: string; fetchImpl: typeof fetch },
  ) => Promise<Obs[]>;
};

const BOUNDS: Bounds = {
  claimAt: "2026-09-29T10:00:00Z",
  prCreatedAt: "2026-09-29T12:00:00Z",
  mergedAt: "2026-09-29T13:00:00Z",
};
const call = (ts: string, output: number, extra: Partial<Call> = {}): Call => ({
  ts,
  model: "claude-sonnet-5-5",
  input: 1,
  cacheWrite: 10,
  cacheRead: 100,
  output,
  ...extra,
});

describe("token-baseline: Phasen-Zuordnung", () => {
  test("Subagent-Typen: Planer, Lens, Kritiker, Explore; Unklares → null (Zeitschnitt)", () => {
    assert.equal(m.classifySubagent("kubernia-planner", "Planungspass für #1064"), "Planung");
    assert.equal(m.classifySubagent("general-purpose", "Lens 1: Architektur"), "Review");
    assert.equal(m.classifySubagent("general-purpose", "Frischer Kritiker Runde 2"), "Review");
    assert.equal(m.classifySubagent("Explore", "Review-Kontext sammeln"), "Recherche");
    assert.equal(m.classifySubagent("general-purpose", "Lens 2: Requirement-Treue gegen den Plan"), "Review");
    // kubernia-lens mit einer Beschreibung ohne Review-Wort: der agentType allein ordnet zu.
    assert.equal(m.classifySubagent("kubernia-lens", "Architektur-Blick auf #1264"), "Review");
    assert.equal(m.classifySubagent("claude-code-guide", "Liest Claude Code AGENTS.md?"), null);
    // Der Umsetzer (#1280) arbeitet über Umsetzung UND CI/Merge: bewusst keine feste Phase,
    // der Zeitschnitt an PR-/Merge-Zeitpunkt teilt seine Calls genauer auf (#1291).
    assert.equal(m.classifySubagent("kubernia-umsetzer", "Umsetzung #1291"), null);
    assert.equal(m.classifySubagent("kubernia-umsetzer", "Umsetzung #1291 nach Plan inkl. Review-Fix"), null, "der Typ zählt, nicht die Beschreibung");
    assert.equal(m.classifySubagent(undefined, undefined), null);
  });

  test("Workflow-Labels werden per Präfix ihrer Phase zugeordnet", () => {
    assert.equal(m.classifySubagent(undefined, "auswahl+claim"), "Auswahl");
    assert.equal(m.classifySubagent(undefined, "preflight:#12"), "Planung");
    assert.equal(m.classifySubagent(undefined, "umsetzen:#12"), "Umsetzung");
    assert.equal(m.classifySubagent(undefined, "nachbessern 1/2:#12"), "Umsetzung");
    assert.equal(m.classifySubagent(undefined, "lens:architektur"), "Review");
    assert.equal(m.classifySubagent(undefined, "pr+merge:#12"), "CI/Merge");
    assert.equal(m.classifySubagent(undefined, "ci-fix 2/3:#12"), "CI/Merge");
  });

  test("unklarer Subagent fällt in summarize auf den Zeitschnitt zurück", () => {
    const s = m.summarize({ calls: [call("2026-09-29T12:30:00Z", 1, { subagent: { id: "g", agentType: "claude-code-guide" } })] }, BOUNDS);
    assert.equal(s.rows[0].phase, "CI/Merge");
  });

  test("Hauptagent: Auswahl → Umsetzung → CI/Merge → Nachlauf an den Grenzen", () => {
    assert.equal(m.classifyMainByTime("2026-09-29T09:59:59Z", BOUNDS), "Auswahl");
    assert.equal(m.classifyMainByTime("2026-09-29T10:00:00Z", BOUNDS), "Umsetzung");
    assert.equal(m.classifyMainByTime("2026-09-29T12:00:00Z", BOUNDS), "CI/Merge");
    assert.equal(m.classifyMainByTime("2026-09-29T13:00:00Z", BOUNDS), "Nachlauf");
  });

  test("ohne Grenzen fällt der Hauptagent komplett auf Umsetzung (kein Raten)", () => {
    assert.equal(m.classifyMainByTime("2020-01-01T00:00:00Z", {}), "Umsetzung");
    assert.equal(m.classifyMainByTime("2030-01-01T00:00:00Z"), "Umsetzung");
  });

  test("Review-Runden: drei Lenses = eine Runde, jeder Kritiker eine weitere", () => {
    assert.equal(m.countReviewRounds([]), 0);
    assert.equal(m.countReviewRounds(["Lens 1", "Lens 2", "Lens 3"]), 1);
    assert.equal(m.countReviewRounds(["Lens 1", "Lens 2", "Lens 3", "Frischer Kritiker Runde 2"]), 2);
    assert.equal(m.countReviewRounds(["Lens 1", "Lens 2", "Lens 3", "Lens 1 (R2)"]), 2);
    assert.equal(m.countReviewRounds(["Lens 1", "Lens 2", "Lens 3", "review-festgefahren:#12"]), 1);
  });

  test("Review-Runden mit Runden-Marker (#1265): die Lens-Zahl je Runde schwankt, gezählt wird der Marker", () => {
    // Die Staffel fährt 1–3 Lenses je Runde; die Heuristik „drei = eine Runde" läge dann daneben.
    assert.equal(m.countReviewRounds(["lens:doku:r1", "lens:doku:r2"]), 2, "Doku-Lens zweimal = zwei Runden");
    assert.equal(m.countReviewRounds(["lens:doku:r1"]), 1);
    assert.equal(
      m.countReviewRounds(["lens:architektur:r1", "lens:requirement-treue:r1", "lens:test-adaequanz:r1", "lens:architektur:r2", "lens:test-adaequanz:r2"]),
      2,
      "fünf Lenses über zwei Runden sind zwei Runden, nicht ceil(5/3)",
    );
    assert.equal(m.countReviewRounds(["Lens Doku R1", "Lens Doku R2"]), 2, "Skill-Pfad: Marker R<n> in der Beschreibung");
    assert.equal(m.countReviewRounds(["lens:doku:r1", "review-festgefahren:#12"]), 1, "Festgefahren zählt weiter nicht");
    assert.equal(m.countReviewRounds(["Lens Architektur", "Lens Requirement"]), 1, "ohne Marker bleibt die Heuristik");
  });
});

describe("token-baseline: summarize", () => {
  const plan: Sub = { id: "p", agentType: "kubernia-planner", description: "Planungspass" };
  const lens: Sub = { id: "l1", agentType: "general-purpose", description: "Lens 1: Architektur" };
  const lens2: Sub = { id: "l2", agentType: "general-purpose", description: "Lens 2" };
  const lens3: Sub = { id: "l3", description: "Lens 3" };
  const run: Run = {
    calls: [
      call("2026-09-29T09:00:00Z", 5),
      call("2026-09-29T11:00:00Z", 50),
      call("2026-09-29T12:30:00Z", 7),
      call("2026-09-29T14:00:00Z", 999), // Nachlauf: gezeigt, aber nicht in der Summe
      call("2026-09-29T10:30:00Z", 9, { model: "claude-opus-5", subagent: plan }),
      // Lens läuft zeitlich nach dem PR — der Subagent schlägt die Zeit.
      call("2026-09-29T12:10:00Z", 1, { model: "claude-opus-5-5", subagent: lens }),
      // Zweiter Call derselben Lens: bleibt EINE Lens (Dedupe über id), keine zweite Runde.
      call("2026-09-29T12:10:30Z", 0, { model: "claude-opus-5-5", subagent: lens, input: 0, cacheWrite: 0, cacheRead: 0 }),
      call("2026-09-29T12:11:00Z", 0, { model: "claude-opus-5-5", subagent: lens2, input: 0, cacheWrite: 0, cacheRead: 0 }),
      call("2026-09-29T12:12:00Z", 0, { model: "claude-opus-5-5", subagent: lens3, input: 0, cacheWrite: 0, cacheRead: 0 }),
      // Subagent NACH dem Merge gehört in den Nachlauf, nicht in seine Phase.
      call("2026-09-29T13:30:00Z", 3, { model: "claude-haiku-4-5", subagent: plan }),
      // Kritiker NACH dem Merge: Nachlauf, zählt keine Review-Runde.
      call("2026-09-29T13:40:00Z", 0, { model: "claude-opus-5-5", subagent: { id: "k", description: "Kritiker Runde 2" }, input: 0, cacheWrite: 0, cacheRead: 0 }),
    ],
    questions: 2,
  };

  test("verteilt Tokens auf Phase × Modell in fester Phasen-Reihenfolge", () => {
    const s = m.summarize(run, BOUNDS);
    assert.deepEqual(
      s.rows.map((r) => `${r.phase}/${r.model}`),
      [
        "Auswahl/claude-sonnet-5-5",
        "Planung/claude-opus-5",
        "Umsetzung/claude-sonnet-5-5",
        "Review/claude-opus-5-5",
        "CI/Merge/claude-sonnet-5-5",
        "Nachlauf/claude-haiku-4-5",
        "Nachlauf/claude-opus-5-5",
        "Nachlauf/claude-sonnet-5-5",
      ],
    );
    assert.equal(s.rows.find((r) => r.phase === "Umsetzung")?.output, 50);
  });

  test("Summe zählt den Nachlauf nicht mit, trennt Cache-Read/-Write", () => {
    const s = m.summarize(run, BOUNDS);
    assert.equal(s.total.calls, 8);
    assert.equal(s.total.output, 5 + 50 + 7 + 9 + 1);
    assert.equal(s.total.cacheRead, 500);
    assert.equal(s.total.cacheWrite, 50);
  });

  test("Loop-Zähler: Review-Runden aus den Subagenten, Rückfragen durchgereicht", () => {
    const s = m.summarize(run, BOUNDS);
    assert.equal(s.reviewRounds, 1);
    assert.equal(s.questions, 2);
  });

  test("Lenses eines früheren Tickets derselben Session (vor --from) zählen keine Runde", () => {
    const s = m.summarize(run, { ...BOUNDS, from: "2026-09-29T12:30:00Z" });
    assert.equal(s.reviewRounds, 0);
  });

  test("--from schneidet fremde Arbeit derselben Session weg (Session mit mehreren Tickets)", () => {
    const s = m.summarize(run, { ...BOUNDS, from: "2026-09-29T10:00:00Z" });
    assert.equal(s.rows.some((r) => r.phase === "Auswahl"), false);
    assert.equal(s.total.calls, 7);
  });

  test("kaputte Usage wird 0 statt NaN, fehlendes Modell heißt 'unbekannt', ohne Kosten kein $", () => {
    const s = m.summarize({ calls: [{ ts: "2026-09-29T10:00:00Z", model: null, input: Number.NaN, output: 3 }] });
    assert.equal(s.rows[0].model, "unbekannt");
    assert.equal(s.total.input, 0);
    assert.equal(s.hasCost, false);
    assert.match(m.renderMarkdown(s), /\| – \|$/m);
  });
});

describe("token-baseline: Quelle Transkript", () => {
  const row = (id: string, ts: string, output: number, content: object[] = [], model = "claude-opus-5-5") =>
    JSON.stringify({
      type: "assistant",
      timestamp: ts,
      message: {
        id,
        model,
        content,
        usage: { input_tokens: 2, cache_creation_input_tokens: 30, cache_read_input_tokens: 400, output_tokens: output },
      },
    });

  test("eine Nachricht über mehrere Zeilen zählt einmal, Output = Maximum", () => {
    const jsonl = [
      row("msg_1", "2026-09-29T10:00:00Z", 480),
      row("msg_1", "2026-09-29T10:00:01Z", 12, [{ type: "tool_use", name: "AskUserQuestion" }]),
      row("msg_2", "2026-09-29T10:01:00Z", 7),
    ].join("\n");
    const { calls, questions } = m.callsFromTranscript(jsonl);
    assert.equal(calls.length, 2);
    assert.equal(questions, 1, "Rückfrage auf einer Folgezeile derselben Nachricht zählt");
    assert.equal(calls[0].output, 480);
    assert.equal(calls[0].cacheRead, 400);
    assert.equal(calls[0].ts, "2026-09-29T10:00:00Z");
  });

  test("ignoriert Nicht-Assistant-Zeilen, Zeilen ohne Usage und eine abgeschnittene letzte Zeile", () => {
    const jsonl = [
      JSON.stringify({ type: "user", message: { content: "hi" } }),
      JSON.stringify({ type: "assistant", message: { id: "x", content: [] } }),
      row("msg_1", "2026-09-29T10:00:00Z", 5),
      '{"type":"assistant","message":{"id":"msg_9"', // laufendes Transkript
    ].join("\r\n");
    assert.equal(m.callsFromTranscript(jsonl).calls.length, 1);
  });

  test("zählt AskUserQuestion-Aufrufe als Rückfragen und hängt den Subagenten an", () => {
    const sub = { agentType: "kubernia-planner", description: "Plan" };
    const jsonl = [
      row("msg_1", "2026-09-29T10:00:00Z", 5, [{ type: "tool_use", name: "AskUserQuestion" }]),
      row("msg_2", "2026-09-29T10:00:00Z", 5, [{ type: "tool_use", name: "Agent" }]),
    ].join("\n");
    const r = m.callsFromTranscript(jsonl, sub);
    assert.equal(r.questions, 1);
    assert.deepEqual(r.calls[0].subagent, sub);
  });
});

describe("token-baseline: Quelle Langfuse", () => {
  const gen = (id: string, parent: string | null, usage: Record<string, number>): Obs => ({
    id,
    type: "GENERATION",
    name: "LLM Call",
    startTime: "2026-09-29T10:30:00Z",
    parentObservationId: parent,
    providedModelName: "claude-opus-5",
    usageDetails: usage,
    totalCost: "0.25",
  });

  test("Generation erbt den Subagenten vom Span über mehrere Ebenen, Usage-Felder werden gemappt", () => {
    const r = m.callsFromLangfuse([
      { id: "s", type: "SPAN", name: "Subagent: Planungspass", startTime: "x", metadata: { agent_type: "kubernia-planner" } },
      { id: "t", type: "TOOL", name: "Tool: Bash", startTime: "x", parentObservationId: "s" },
      gen("g", "t", { input: 3, output: 9, cache_read_input_tokens: 70, cache_creation_input_tokens: 8 }),
      { id: "q", type: "TOOL", name: "Tool: AskUserQuestion", startTime: "x" },
    ]);
    assert.deepEqual(r.calls[0].subagent, { id: "s", agentType: "kubernia-planner", description: "Planungspass" });
    assert.equal(r.calls[0].cacheRead, 70);
    assert.equal(r.calls[0].cacheWrite, 8);
    assert.equal(r.questions, 1);
    const s = m.summarize(r);
    assert.equal(s.rows[0].phase, "Planung");
    // Eine Preisquelle (#1239): Kosten aus PRICES, nicht aus Langfuse-totalCost (0.25 im Fixture).
    assert.ok(Math.abs(s.total.cost - 0.000325) < 1e-12, `Kosten aus PRICES, war ${s.total.cost}`);
    assert.equal(s.hasCost, true);
  });

  test("verschachtelt (#1291): Lens unter dem Umsetzer zählt als Review, der Umsetzer selbst per Zeitschnitt", () => {
    const r = m.callsFromLangfuse([
      { id: "u", type: "SPAN", name: "Subagent: Umsetzung #1291", startTime: "x", metadata: { agent_type: "kubernia-umsetzer" } },
      { id: "l", type: "SPAN", name: "Subagent: Lens Architektur R1", startTime: "x", parentObservationId: "u", metadata: { agent_type: "kubernia-lens" } },
      gen("gl", "l", { input: 1 }),
      { ...gen("gu1", "u", { input: 1 }), startTime: "2026-09-29T11:00:00Z" },
      { ...gen("gu2", "u", { input: 1 }), startTime: "2026-09-29T12:30:00Z" },
    ]);
    const nachId = (id: string) => r.calls[["gl", "gu1", "gu2"].indexOf(id)];
    assert.equal(nachId("gl").subagent?.agentType, "kubernia-lens", "nächster umschließender Subagent, nicht der äußerste");
    const zeilen = m.summarize(r, BOUNDS).rows.map((row) => [row.phase, row.calls]).sort();
    assert.deepEqual(
      zeilen,
      [["CI/Merge", 1], ["Review", 1], ["Umsetzung", 1]],
      "Lens → Review, Umsetzer vor dem PR → Umsetzung, danach → CI/Merge; je Phase genau ein Call",
    );
  });

  test("Zyklus in parentObservationId hängt nicht, Hauptagent bleibt Hauptagent", () => {
    const r = m.callsFromLangfuse([
      { id: "a", type: "SPAN", name: "A", startTime: "x", parentObservationId: "b" },
      { id: "b", type: "SPAN", name: "B", startTime: "x", parentObservationId: "a" },
      gen("g", "a", { input: 1 }),
    ]);
    assert.equal(r.calls[0].subagent, null);
  });

  test("fetchSessionObservations paginiert per Cursor und filtert per sessionId", async () => {
    const urls: string[] = [];
    const pages = [
      { data: [{ id: "1" }], meta: { cursor: "c2" } },
      { data: [{ id: "2" }], meta: {} },
    ];
    const fetchImpl = ((url: string) => {
      urls.push(url);
      const body = pages.shift();
      return Promise.resolve({ ok: true, json: () => Promise.resolve(body) });
    }) as unknown as typeof fetch;
    const out = await m.fetchSessionObservations("sess-1", { baseUrl: "http://lf/", publicKey: "pk", secretKey: "sk", fetchImpl });
    assert.deepEqual(out.map((o) => o.id), ["1", "2"]);
    assert.match(urls[0], /^http:\/\/lf\/api\/public\/v2\/observations\?sessionId=sess-1&/);
    assert.match(urls[1], /cursor=c2/);
  });

  test("fetchSessionObservations wirft bei HTTP-Fehler statt still leer zu melden", async () => {
    const fetchImpl = (() =>
      Promise.resolve({ ok: false, status: 401, text: () => Promise.resolve("nope") })) as unknown as typeof fetch;
    await assert.rejects(
      m.fetchSessionObservations("s", { baseUrl: "http://lf", publicKey: "pk", secretKey: "sk", fetchImpl }),
      /Langfuse 401/,
    );
  });
});

describe("token-baseline: CI-/Merge-Kennzahlen und CLI", () => {
  test("gemergt ohne CI-Fix nur bei Merge UND null roten Pushes", () => {
    assert.equal(m.mergedWithoutRework("2026-09-29T12:00:00Z", 0), true);
    assert.equal(m.mergedWithoutRework("2026-09-29T12:00:00Z", 1), false);
    assert.equal(m.mergedWithoutRework(null, 0), false);
  });

  test("renderMarkdown zeigt Summe und Loop-Zeile, fehlende PR-Daten als –", () => {
    const s = m.summarize({ calls: [call("2026-09-29T10:00:00Z", 1, { input: 1234 })] });
    const md = m.renderMarkdown(s);
    assert.match(md, /\| \*\*Summe \(ohne Nachlauf\)\*\* \|/);
    assert.match(md, /1\.234/);
    assert.match(md, /CI-Fix-Runden: – · Rückfragen: 0 · gemergt ohne CI-Fix: –/);
    assert.match(m.renderMarkdown(s, { failedPushes: 0, mergedAt: "x" }), /gemergt ohne CI-Fix: ja/);
  });

  test("parseArgs sammelt mehrere Sessions und lehnt Unbekanntes ab", () => {
    assert.deepEqual(m.parseArgs(["--session", "a", "--session", "b", "--issue", "7", "--pr", "9", "--from", "T", "--langfuse", "--json"]), {
      sessions: ["a", "b"],
      issue: "7",
      pr: "9",
      from: "T",
      json: true,
      langfuse: true,
    });
    assert.throws(() => m.parseArgs(["--foo"]), /Unbekanntes Argument/);
  });
});

describe("token-baseline: Preise (#1206)", () => {
  const MIO = 1_000_000;
  const only = (extra: Partial<Call>): Call => ({
    ts: "2026-10-05T10:00:00Z",
    model: "claude-sonnet-5-5",
    input: 0,
    cacheWrite: 0,
    cacheRead: 0,
    output: 0,
    ...extra,
  });
  const line = (id: string, model: string, usage: Record<string, unknown>, ts = "2026-10-05T10:00:00Z") =>
    JSON.stringify({ type: "assistant", timestamp: ts, message: { id, model, usage } });

  test("Input, Cache-Read und Output nach Preisliste (Sonnet 5.5: 2 / 0,20 / 10 $ je Mio)", () => {
    assert.equal(m.priceCall(only({ input: MIO })), 2);
    assert.equal(m.priceCall(only({ cacheRead: MIO })), 0.2);
    assert.equal(m.priceCall(only({ output: MIO })), 10);
  });

  test("Cache-Write: 5m- und 1h-Anteil haben verschiedene Preise (Sonnet 2,50 / 4 $)", () => {
    assert.equal(m.priceCall(only({ cacheWrite: MIO })), 2.5);
    assert.equal(m.priceCall(only({ cacheWrite: MIO, cacheWrite1h: MIO })), 4);
    assert.equal(m.priceCall(only({ cacheWrite: MIO, cacheWrite1h: MIO / 2 })), 3.25);
  });

  test("Modell-ID mit Datum findet den Preis per Präfix (Haiku 4.5)", () => {
    assert.equal(m.priceCall(only({ model: "claude-haiku-4-5-20251001", input: MIO })), 1);
  });

  test("Opus 5.5 ist billiger als Opus 5 (Cache-Read 0,20 statt 0,50), Präfix darf nicht verwechseln", () => {
    assert.equal(m.priceCall(only({ model: "claude-opus-5-5", cacheRead: MIO })), 0.2);
    assert.equal(m.priceCall(only({ model: "claude-opus-5", cacheRead: MIO })), 0.5);
  });

  test("unbekanntes oder fehlendes Modell → null, nie 0", () => {
    assert.equal(m.priceCall(only({ model: "gpt-x", input: MIO })), null);
    assert.equal(m.priceCall(only({ model: null, input: MIO })), null);
    assert.equal(m.priceParts(only({ model: "gpt-x" })), null);
  });

  test("kaputte Usage wird 0 statt NaN; 1h-Anteil über dem Gesamt-Write wird gedeckelt", () => {
    assert.equal(m.priceCall(only({ input: NaN, output: undefined })), 0);
    assert.equal(m.priceCall(only({ cacheWrite: MIO, cacheWrite1h: 3 * MIO })), 4);
  });

  test("Teilkosten ergeben zusammen den Gesamtbetrag", () => {
    const c = only({ input: 10, cacheWrite: 1000, cacheWrite1h: 400, cacheRead: 5000, output: 70 });
    const p = m.priceParts(c)!;
    assert.ok(Math.abs(p.input + p.cacheWrite + p.cacheRead + p.output - m.priceCall(c)!) < 1e-12);
  });

  test("Transkript: cache_creation.ephemeral_1h wird als cacheWrite1h gelesen und bepreist", () => {
    const usage = {
      cache_creation_input_tokens: MIO,
      cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: MIO },
    };
    const r = m.callsFromTranscript(line("a", "claude-sonnet-5-5", usage));
    assert.equal(r.calls[0].cacheWrite1h, MIO);
    assert.equal(r.calls[0].cost, 4);
  });

  test("Transkript ohne cache_creation-Aufteilung: alles zählt als 5m", () => {
    const r = m.callsFromTranscript(line("a", "claude-sonnet-5-5", { cache_creation_input_tokens: MIO }));
    assert.equal(r.calls[0].cacheWrite1h, 0);
    assert.equal(r.calls[0].cost, 2.5);
  });
});

describe("token-baseline: Sockel, Median-Kontext, Kosten-Teile (#1206)", () => {
  const plan: Sub = { id: "p", agentType: "kubernia-planner", description: "Planungspass" };
  const lensA: Sub = { id: "la", agentType: "general-purpose", description: "Lens 1" };
  const lensB: Sub = { id: "lb", agentType: "general-purpose", description: "Lens 2" };
  // Kontext je Call = input + cacheWrite + cacheRead
  const ctx = (ts: string, total: number, extra: Partial<Call> = {}): Call => ({
    ts,
    model: "claude-sonnet-5-5",
    input: 0,
    cacheWrite: 0,
    cacheRead: total,
    output: 0,
    ...extra,
  });
  const line = (id: string, model: string, usage: Record<string, unknown>, ts: string) =>
    JSON.stringify({ type: "assistant", timestamp: ts, message: { id, model, usage } });

  test("Sockel = erster Call (nach Zeit) des Hauptagenten bzw. je Subagent, Median je Phase", () => {
    const s = m.summarize({
      calls: [
        ctx("2026-10-05T10:05:00Z", 90_000),
        ctx("2026-10-05T10:00:00Z", 60_000), // erster Hauptagent-Call
        ctx("2026-10-05T10:10:00Z", 30_000, { subagent: plan }),
        ctx("2026-10-05T10:11:00Z", 99_000, { subagent: plan }),
        ctx("2026-10-05T10:20:00Z", 50_000, { subagent: lensA }),
        ctx("2026-10-05T10:20:00Z", 54_000, { subagent: lensB }),
      ],
    });
    assert.equal(s.sockel.main, 60_000);
    assert.equal(s.sockel.planung, 30_000);
    assert.equal(s.sockel.review, 52_000);
  });

  test("--from ändert den Sockel des Hauptagenten nicht (Größe der Session)", () => {
    const calls = [ctx("2026-10-05T10:00:00Z", 60_000), ctx("2026-10-05T11:00:00Z", 80_000)];
    const s = m.summarize({ calls }, { from: "2026-10-05T10:30:00Z" });
    assert.equal(s.sockel.main, 60_000);
    assert.equal(s.medianContext.all, 80_000);
  });

  test("Median-Kontext: gerade Anzahl mittelt, Nachlauf zählt nicht, Hauptagent getrennt", () => {
    const calls = [
      ctx("2026-10-05T10:00:00Z", 10),
      ctx("2026-10-05T10:01:00Z", 30),
      ctx("2026-10-05T10:02:00Z", 20),
      ctx("2026-10-05T10:03:00Z", 1000, { subagent: plan }),
      ctx("2026-10-05T12:00:00Z", 9_999_999), // Nachlauf
    ];
    const s = m.summarize({ calls }, { mergedAt: "2026-10-05T11:00:00Z" });
    assert.equal(s.medianContext.main, 20);
    assert.equal(s.medianContext.all, 25); // 10, 20, 30, 1000 → (20+30)/2
  });

  test("ohne Calls: Median und Sockel sind null, nicht 0", () => {
    const s = m.summarize({ calls: [] });
    assert.equal(s.medianContext.all, null);
    assert.equal(s.medianContext.main, null);
    assert.equal(s.sockel.main, null);
    assert.equal(s.sockel.planung, null);
    assert.equal(s.sockel.review, null);
  });

  test("unpriced zählt Calls ohne Preis, costParts summiert die bepreisten", () => {
    const text = [
      line("a", "claude-sonnet-5-5", { input_tokens: 1_000_000, output_tokens: 1_000_000 }, "2026-10-05T10:00:00Z"),
      line("b", "gpt-x", { input_tokens: 5 }, "2026-10-05T10:01:00Z"),
    ].join("\n");
    const s = m.summarize(m.callsFromTranscript(text));
    assert.equal(s.unpriced, 1);
    assert.equal(s.costParts.input, 2);
    assert.equal(s.costParts.output, 10);
    assert.equal(s.total.cost, 12);
  });

  test("renderMarkdown nennt Sockel, Median-Kontext, Kostenanteile und Calls ohne Preis", () => {
    const text = [
      line("a", "claude-sonnet-5-5", { cache_read_input_tokens: 60_000 }, "2026-10-05T10:00:00Z"),
      line("b", "gpt-x", { input_tokens: 5 }, "2026-10-05T10:01:00Z"),
    ].join("\n");
    const md = m.renderMarkdown(m.summarize(m.callsFromTranscript(text)));
    assert.match(md, /Sockel Haupt 60\.000/);
    assert.match(md, /Median-Kontext/);
    assert.match(md, /Kostenanteile/);
    assert.match(md, /1 Call\(s\) ohne Preis/);
  });
});

describe("token-baseline: Härtung nach Review (#1206)", () => {
  const MIO = 1_000_000;
  const row = (id: string, model: string, usage: Record<string, unknown>, ts = "2026-10-05T10:00:00Z") =>
    JSON.stringify({ type: "assistant", timestamp: ts, message: { id, model, usage } });
  const at = (ts: string, total: number, extra: Partial<Call> = {}): Call => ({
    ts,
    model: "claude-sonnet-5-5",
    input: 0,
    cacheWrite: 0,
    cacheRead: total,
    output: 0,
    ...extra,
  });
  const plan: Sub = { id: "p", agentType: "kubernia-planner", description: "Planungspass" };

  test("Präfix-Falle: künftiges claude-opus-5-6 ist ohne Preis, nicht Opus 5; Datums-Suffix bleibt erlaubt", () => {
    const c = (model: string): Call => ({ ts: "2026-10-05T10:00:00Z", model, input: MIO });
    assert.equal(m.priceCall(c("claude-opus-5-6")), null);
    assert.equal(m.priceCall(c("claude-opus-5-20990101")), 5);
    assert.equal(m.priceCall(c("claude-opus-5-5-20990101")), 4);
  });

  test("Präfix-Falle unabhängig von der Reihenfolge der Preistabelle", () => {
    const p = {
      "claude-opus-5": { input: 5, cacheWrite5m: 0, cacheWrite1h: 0, cacheRead: 0, output: 0 },
      "claude-opus-5-5": { input: 4, cacheWrite5m: 0, cacheWrite1h: 0, cacheRead: 0, output: 0 },
    };
    assert.equal(m.priceCall({ ts: "t", model: "claude-opus-5-5", input: MIO }, p), 4);
    assert.equal(m.priceCall({ ts: "t", model: "claude-opus-5-6", input: MIO }, p), null);
  });

  test("mehrzeilige Nachricht: Kosten folgen dem Maximum des Outputs, nicht der ersten Teilzeile", () => {
    const text = [
      row("a", "claude-sonnet-5-5", { output_tokens: 0 }),
      row("a", "claude-sonnet-5-5", { output_tokens: MIO }),
    ].join("\n");
    const r = m.callsFromTranscript(text);
    assert.equal(r.calls.length, 1);
    assert.equal(r.calls[0].cost, 10);
    assert.equal((r.calls[0] as Call & { costParts: { output: number } }).costParts.output, 10);
  });

  test("Nachlauf zählt weder in unpriced noch in costParts", () => {
    const text = [
      row("a", "claude-sonnet-5-5", { input_tokens: MIO }, "2026-10-05T10:00:00Z"),
      row("b", "gpt-x", { input_tokens: 5 }, "2026-10-05T12:00:00Z"),
      row("c", "claude-sonnet-5-5", { output_tokens: MIO }, "2026-10-05T12:01:00Z"),
    ].join("\n");
    const s = m.summarize(m.callsFromTranscript(text), { mergedAt: "2026-10-05T11:00:00Z" });
    assert.equal(s.unpriced, 0);
    assert.deepEqual(s.unpricedModels, {}, "Nachlauf zählt auch nicht in die Modell-Liste");
    assert.equal(s.costParts.input, 2);
    assert.equal(s.costParts.output, 0);
  });

  test("Sockel: Planer vor --from (anderes Ticket derselben Session) zählt nicht, der Haupt-Sockel bleibt sessionweit", () => {
    const other: Sub = { id: "other", agentType: "kubernia-planner", description: "Planungspass für #1" };
    const s = m.summarize(
      {
        calls: [
          at("2026-10-05T09:00:00Z", 60_000),
          at("2026-10-05T09:10:00Z", 99_000, { subagent: other }),
          at("2026-10-05T10:10:00Z", 30_000, { subagent: plan }),
        ],
      },
      { from: "2026-10-05T10:00:00Z" },
    );
    assert.equal(s.sockel.main, 60_000);
    assert.equal(s.sockel.planung, 30_000);
  });

  test("Sockel: Planer nach dem Merge (Nachlauf) zählt nicht", () => {
    const s = m.summarize(
      { calls: [at("2026-10-05T10:00:00Z", 60_000), at("2026-10-05T12:00:00Z", 77_000, { subagent: plan })] },
      { mergedAt: "2026-10-05T11:00:00Z" },
    );
    assert.equal(s.sockel.planung, null);
  });

  test("Sockel: zwei Lens-Subagenten ohne id gehen getrennt in den Median ein", () => {
    const s = m.summarize({
      calls: [
        at("2026-10-05T10:00:00Z", 40_000, { subagent: { agentType: "general-purpose", description: "Lens 1" } }),
        at("2026-10-05T10:00:01Z", 60_000, { subagent: { agentType: "general-purpose", description: "Lens 2" } }),
      ],
    });
    assert.equal(s.sockel.review, 50_000);
  });

  test("renderMarkdown: ohne Kosten keine Kostenanteile, ohne unpriced keine Warnung, null-Sockel als –", () => {
    const md = m.renderMarkdown(m.summarize({ calls: [at("2026-10-05T10:00:00Z", 1_000, { subagent: plan, cost: 0 })] }));
    assert.doesNotMatch(md, /Kostenanteile/);
    assert.doesNotMatch(md, /ohne Preis/);
    assert.match(md, /Sockel Haupt – · Planer 1\.000 · Lens –/);
  });

  test("renderMarkdown: Kostenanteile sind echte Prozente (25 % Input, 75 % Output)", () => {
    // Sonnet: 5 Tsd Input = 0,01 $, 3 Tsd Output = 0,03 $ → 25 % / 75 %
    const text = row("a", "claude-sonnet-5-5", { input_tokens: 5000, output_tokens: 3000 });
    const md = m.renderMarkdown(m.summarize(m.callsFromTranscript(text)));
    assert.match(md, /Kostenanteile: Input 25 % · Cache-Write 0 % · Cache-Read 0 % · Output 75 %/);
  });
});

describe("token-baseline: Kontext-Formel und Preistabelle (#1206)", () => {
  const MIO = 1_000_000;

  test("Kontext je Call = input + cacheWrite + cacheRead (alle drei Felder verschieden)", () => {
    const mixed = (ts: string, extra: Partial<Call> = {}): Call => ({
      ts,
      model: "claude-sonnet-5-5",
      input: 1,
      cacheWrite: 10,
      cacheRead: 100,
      output: 7, // zählt nicht zum Kontext
      ...extra,
    });
    const plan: Sub = { id: "p", agentType: "kubernia-planner", description: "Planungspass" };
    const s = m.summarize({ calls: [mixed("2026-10-05T10:00:00Z"), mixed("2026-10-05T10:01:00Z", { subagent: plan })] });
    assert.equal(s.sockel.main, 111);
    assert.equal(s.sockel.planung, 111);
    assert.equal(s.medianContext.all, 111);
    assert.equal(s.medianContext.main, 111);
  });

  test("jeder Preis jedes Modells ist festgenagelt (je Mio Tokens: Input / Write 5m / Write 1h / Read / Output)", () => {
    const expected: Record<string, number[]> = {
      "claude-sonnet-5-5": [2, 2.5, 4, 0.1, 10], // Cache-Read ab 2026-10-07 0,10 (davor 0,20, eigener Test) // Haiku 5.5 hat Stufen: eigener Test
      "claude-opus-5-5": [4, 5, 8, 0.2, 20],
      "claude-opus-5": [5, 6.25, 10, 0.5, 25],
      "claude-haiku-4-5": [1, 1.25, 2, 0.1, 5],
    };
    for (const [model, [input, write5m, write1h, read, output]] of Object.entries(expected)) {
      const c = (extra: Partial<Call>): Call => ({ ts: "2026-10-08T00:00:00Z", model, input: 0, cacheWrite: 0, cacheRead: 0, output: 0, ...extra });
      assert.equal(m.priceCall(c({ input: MIO })), input, `${model} input`);
      assert.equal(m.priceCall(c({ cacheWrite: MIO })), write5m, `${model} write 5m`);
      assert.equal(m.priceCall(c({ cacheWrite: MIO, cacheWrite1h: MIO })), write1h, `${model} write 1h`);
      assert.equal(m.priceCall(c({ cacheRead: MIO })), read, `${model} read`);
      assert.equal(m.priceCall(c({ output: MIO })), output, `${model} output`);
    }
  });
});

describe("token-baseline: Preisstufen, Sonnet-Periode, Modelle ohne Preis, Langfuse-Zugang (#1441)", () => {
  const MIO = 1_000_000;
  const row = (id: string, model: string, usage: Record<string, unknown>, ts = "2026-10-05T10:00:00Z") =>
    JSON.stringify({ type: "assistant", timestamp: ts, message: { id, model, usage } });
  const haiku = (extra: Partial<Call>): Call => ({ ts: "2026-10-08T00:00:00Z", model: "claude-haiku-5-5", input: 0, cacheWrite: 0, cacheRead: 0, output: 0, ...extra });

  test("Haiku 5.5: ab mehr als 100.000 Prompt-Tokens gelten die Stufenpreise (Input, Write, Read, Output)", () => {
    // Prompt = input + cacheWrite + cacheRead; 100.000 ist noch Standard, 100.001 schon Stufe.
    assert.equal(m.priceCall(haiku({ input: 100_000, output: MIO })), 0.01 + 0.5);
    assert.equal(m.priceCall(haiku({ input: 100_001, output: MIO })), (100_001 * 0.5) / MIO + 2.5);
    assert.equal(m.priceCall(haiku({ cacheRead: 100_001 })), (100_001 * 0.05) / MIO);
    assert.equal(m.priceCall(haiku({ cacheWrite: 100_001 })), (100_001 * 0.625) / MIO);
    assert.equal(m.priceCall(haiku({ cacheWrite: 100_001, cacheWrite1h: 100_001 })), (100_001 * 1) / MIO);
    // Grundpreise bis 100.000 Prompt-Tokens (Read, Write 5m, Write 1h; Input und Output stehen oben).
    assert.equal(m.priceCall(haiku({ cacheRead: 100_000 })), (100_000 * 0.01) / MIO);
    assert.equal(m.priceCall(haiku({ cacheWrite: 100_000 })), (100_000 * 0.125) / MIO);
    assert.equal(m.priceCall(haiku({ cacheWrite: 100_000, cacheWrite1h: 100_000 })), (100_000 * 0.2) / MIO);
    // Der Prompt setzt sich aus allen drei Feldern zusammen.
    assert.equal(m.priceCall(haiku({ input: 40_000, cacheWrite: 30_000, cacheRead: 30_001 })), (40_000 * 0.5 + 30_000 * 0.625 + 30_001 * 0.05) / MIO);
  });

  test("Stufen: ohne `stufen` unverändert, unsortiert gilt die höchste zutreffende Schwelle, mit Perioden zusammen", () => {
    const basis = { input: 1, cacheWrite5m: 1, cacheWrite1h: 1, cacheRead: 1, output: 1 };
    const ohne = { "claude-x": basis };
    const mk = (input: number): Call => ({ ts: "2026-10-08T00:00:00Z", model: "claude-x", input, cacheWrite: 0, cacheRead: 0, output: 0 });
    assert.equal(m.priceCall(mk(500_000), ohne), 0.5);
    const stufig = {
      "claude-x": { ...basis, stufen: [{ ueberPrompt: 100_000, input: 2 }, { ueberPrompt: 200_000, input: 3 }] },
    };
    assert.equal(m.priceCall(mk(150_000), stufig), 0.3);
    assert.equal(m.priceCall(mk(250_000), stufig), 0.75);
    const periode = {
      "claude-x": [
        { validFrom: null, ...basis, stufen: [{ ueberPrompt: 100, input: 2 }] },
        { validFrom: "2026-11-01T00:00:00Z", ...basis, input: 10, stufen: [{ ueberPrompt: 100, input: 20 }] },
      ],
    };
    assert.equal(m.priceCall({ ...mk(1_000_000), ts: "2026-10-31T00:00:00Z" }, periode), 2);
    assert.equal(m.priceCall({ ...mk(1_000_000), ts: "2026-11-02T00:00:00Z" }, periode), 20);
    assert.equal(m.priceCall({ ...mk(50), ts: "2026-11-02T00:00:00Z" }, periode), 50 * 10 / MIO);
  });

  test("Sonnet 5.5: Cache-Read vor 2026-10-07 0,20 $, ab dann 0,10 $; ungültiger Zeitstempel ist ohne Preis", () => {
    const sonnet = (ts: string): Call => ({ ts, model: "claude-sonnet-5-5", input: 0, cacheWrite: 0, cacheRead: MIO, output: 0 });
    assert.equal(m.priceCall(sonnet("2026-10-06T23:59:59Z")), 0.2);
    assert.equal(m.priceCall(sonnet("2026-10-07T00:00:00Z")), 0.1);
    assert.equal(m.priceCall(sonnet("kein-zeitpunkt")), null);
  });

  test("Wächter: die Warnzeile nennt die Modelle ohne Preis mit Anzahl; ohne solche Calls keine Zeile", () => {
    const text = [
      row("a", "claude-haiku-9-9", { input_tokens: 5 }),
      row("b", "claude-haiku-9-9", { input_tokens: 5 }),
      row("c", "claude-neu-1", { input_tokens: 5 }),
    ].join("\n");
    const s = m.summarize(m.callsFromTranscript(text));
    assert.deepEqual(s.unpricedModels, { "claude-haiku-9-9": 2, "claude-neu-1": 1 });
    const md = m.renderMarkdown(s);
    assert.match(md, /3 Call\(s\) ohne Preis: claude-haiku-9-9 \(2\), claude-neu-1 \(1\) — Modell in PRICES nachtragen/);
    const ok = m.renderMarkdown(m.summarize(m.callsFromTranscript(row("d", "claude-sonnet-5-5", { input_tokens: 5 }))));
    assert.doesNotMatch(ok, /ohne Preis/);
  });

  test("langfuseZugang: ohne Secret-Key Wurf mit Hinweis auf queryMetrics, mit beiden Keys Default-Base-URL", () => {
    assert.throws(() => m.langfuseZugang({ LANGFUSE_PUBLIC_KEY: "pk" }), /queryMetrics.*usageByType/);
    assert.throws(() => m.langfuseZugang({ LANGFUSE_SECRET_KEY: "sk" }), /LANGFUSE_PUBLIC_KEY/);
    assert.deepEqual(m.langfuseZugang({ LANGFUSE_PUBLIC_KEY: "pk", LANGFUSE_SECRET_KEY: "sk" }), { baseUrl: "http://localhost:3000", publicKey: "pk", secretKey: "sk" });
    assert.equal(m.langfuseZugang({ LANGFUSE_PUBLIC_KEY: "pk", LANGFUSE_SECRET_KEY: "sk", LANGFUSE_BASE_URL: "http://lf" }).baseUrl, "http://lf");
  });
});

describe("token-baseline: eine Preisquelle, Preisperioden, Fensterfilter (#1239)", () => {
  const MIO = 1_000_000;
  const gen = (usage: Record<string, number>, model = "claude-sonnet-5-5"): Obs => ({
    id: "g",
    type: "GENERATION",
    name: "LLM Call",
    startTime: "2026-10-05T10:00:00Z",
    providedModelName: model,
    usageDetails: usage,
    totalCost: "99",
  });

  test("Langfuse: 5m-/1h-Writes aus den echten Schlüsseln, Kostenanteile und Kosten wie im Transkript-Modus", () => {
    const usage = { input: 1000, output: 500, cache_read_input_tokens: 2000, input_cache_creation_5m: 300, input_cache_creation_1h: 200 };
    const lf = m.callsFromLangfuse([gen(usage)]).calls[0];
    assert.equal(lf.cacheWrite, 500);
    assert.equal(lf.cacheWrite1h, 200);
    const tr = m.callsFromTranscript(
      JSON.stringify({
        type: "assistant",
        timestamp: lf.ts,
        message: { id: "x", model: "claude-sonnet-5-5", usage: { input_tokens: 1000, output_tokens: 500, cache_read_input_tokens: 2000, cache_creation_input_tokens: 500, cache_creation: { ephemeral_1h_input_tokens: 200 } } },
      }),
    ).calls[0];
    assert.deepEqual(lf.costParts, tr.costParts);
    assert.equal(lf.cost, tr.cost);
    assert.notEqual(lf.cost, 99, "Langfuse-totalCost wird nicht mehr als Kosten genutzt");
  });

  test("Langfuse: Modell ohne Preis bleibt ohne Preis (null), nie totalCost oder 0", () => {
    const lf = m.callsFromLangfuse([gen({ input: 5 }, "claude-unbekannt")]).calls[0];
    assert.equal(lf.cost, null);
    assert.equal(lf.costParts ?? null, null);
  });

  test("priceCall summiert vorhandene costParts statt neu zu bepreisen", () => {
    const c = call("2026-10-05T10:00:00Z", 1, { model: "claude-unbekannt", costParts: { input: 1, cacheWrite: 2, cacheRead: 3, output: 4 } });
    assert.equal(m.priceCall(c), 10);
  });

  test("Preisperioden: der Preis gilt ab validFrom, davor die ältere Periode; Einzelobjekt gilt immer", () => {
    const alt = { input: 1, cacheWrite5m: 1, cacheWrite1h: 1, cacheRead: 1, output: 1 };
    const neu = { input: 2, cacheWrite5m: 2, cacheWrite1h: 2, cacheRead: 2, output: 2 };
    const prices = { "claude-x": [{ validFrom: null, ...alt }, { validFrom: "2026-11-01T00:00:00Z", ...neu }], "claude-y": alt };
    const mk = (ts: string, model: string): Call => ({ ts, model, input: MIO, cacheWrite: 0, cacheRead: 0, output: 0 });
    assert.equal(m.priceCall(mk("2026-10-31T23:59:59Z", "claude-x"), prices), 1);
    assert.equal(m.priceCall(mk("2026-11-01T00:00:00Z", "claude-x"), prices), 2);
    assert.equal(m.priceCall(mk("2030-01-01T00:00:00Z", "claude-y"), prices), 1);
  });

  test("Report nennt den Stand der Preistabelle", () => {
    assert.match(m.PRICES_STAND, /^\d{4}-\d{2}-\d{2}$/);
    const md = m.renderMarkdown(m.summarize({ calls: [call("2026-10-05T10:00:00Z", 1)] }));
    assert.match(md, new RegExp(`Preise Stand ${m.PRICES_STAND}`));
  });

  test("windowCalls: lässt Calls vor from weg und kennzeichnet Nachlauf nach dem Merge", () => {
    const vor = call("2026-09-29T09:00:00Z", 1);
    const drin = call("2026-09-29T10:30:00Z", 1);
    const nach = call("2026-09-29T13:30:00Z", 1);
    const w = m.windowCalls([vor, drin, nach], { ...BOUNDS, from: "2026-09-29T10:00:00Z" });
    assert.deepEqual(w.map((x) => x.call), [drin, nach]);
    assert.equal(w[1].phase, "Nachlauf");
    assert.notEqual(w[0].phase, "Nachlauf");
  });
});

describe("token-baseline: readTranscriptSession (#1311)", () => {
  const zeile = (id: string, ts: string) =>
    JSON.stringify({
      type: "assistant",
      timestamp: ts,
      uuid: id,
      message: { id, model: "claude-sonnet-5-5", usage: { input_tokens: 1, output_tokens: 2, cache_read_input_tokens: 3 } },
    });

  /** Session-Ordner in der Form von ~/.claude/projects/<projekt>/<id>.jsonl (+ <id>/subagents/). */
  function mitSession(bauen: (dir: string, id: string) => void, body: (root: string) => void) {
    const root = mkdtempSync(join(tmpdir(), "kq-tb-"));
    try {
      const proj = join(root, "proj");
      mkdirSync(proj);
      bauen(proj, "sess-1");
      body(root);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }

  test("verschachtelte meta.json: Lens unter dem Umsetzer wird als Review gezählt, der Elternbezug bleibt erhalten", () => {
    mitSession(
      (proj, id) => {
        writeFileSync(join(proj, `${id}.jsonl`), zeile("h1", "2026-09-29T09:00:00Z") + "\n");
        const sub = join(proj, id, "subagents");
        mkdirSync(sub, { recursive: true });
        writeFileSync(join(sub, "agent-u.jsonl"), zeile("u1", "2026-09-29T11:00:00Z") + "\n");
        writeFileSync(
          join(sub, "agent-u.meta.json"),
          JSON.stringify({ agentType: "kubernia-umsetzer", description: "Umsetzung #1", spawnDepth: 1 }),
        );
        writeFileSync(join(sub, "agent-l.jsonl"), zeile("l1", "2026-09-29T11:30:00Z") + "\n");
        writeFileSync(
          join(sub, "agent-l.meta.json"),
          JSON.stringify({ agentType: "kubernia-lens", description: "Lens Architektur R1", parentAgentId: "u", spawnDepth: 2 }),
        );
      },
      (root) => {
        const r = m.readTranscriptSession("sess-1", root);
        assert.equal(r.calls.length, 3);
        const lens = r.calls.find((c) => c.subagent?.agentType === "kubernia-lens");
        assert.equal(lens?.subagent?.parentAgentId, "u");
        const phasen = Object.fromEntries(m.summarize(r, BOUNDS).rows.map((row) => [row.phase, row.calls]));
        assert.equal(phasen["Review"], 1, "die Lens zählt als Review, obwohl sie unter dem Umsetzer läuft");
        assert.equal(phasen["Umsetzung"], 1, "der Umsetzer vor dem PR → Umsetzung");
      },
    );
  });

  test("Pflege-Marker im Subagenten-Transkript färben genau dessen Calls (Transkript-Modus, Ende zu Ende)", () => {
    const bash = (id: string, ts: string, command: string) =>
      JSON.stringify({ type: "assistant", timestamp: ts, message: { content: [{ type: "tool_use", id, name: "Bash", input: { command } }] } });
    mitSession(
      (proj, id) => {
        // Marker im Hauptchat darf keinen Subagent-Call einfärben.
        writeFileSync(join(proj, `${id}.jsonl`), bash("m1", "2026-09-29T11:01:00Z", 'echo "pflege: start #1"') + "\n");
        const sub = join(proj, id, "subagents");
        mkdirSync(sub, { recursive: true });
        writeFileSync(
          join(sub, "agent-u.jsonl"),
          [
            zeile("u0", "2026-09-29T10:30:00Z"),
            bash("a", "2026-09-29T11:00:00Z", 'echo "pflege: start #1"'),
            zeile("u1", "2026-09-29T11:05:00Z"),
            bash("b", "2026-09-29T11:10:00Z", 'echo "pflege: ende #1"'),
            zeile("u2", "2026-09-29T11:20:00Z"),
          ].join("\n") + "\n",
        );
        writeFileSync(join(sub, "agent-u.meta.json"), JSON.stringify({ agentType: "kubernia-umsetzer", description: "Umsetzung #1" }));
      },
      (root) => {
        const r = m.readTranscriptSession("sess-1", root) as Run & { events?: PEv[] };
        const s = m.summarize(r, BOUNDS);
        const phasen = Object.fromEntries(s.rows.map((row) => [row.phase, row.calls]));
        assert.equal(phasen["Pflege"], 1, "genau der Call zwischen den Markern");
        assert.equal(phasen["Umsetzung"], 2);
        assert.equal(s.pflegeUnpaired, 1, "der Haupt-Marker bleibt ungepaart und färbt nichts");
      },
    );
  });

  test("Hauptagent-Marker im Transkript färben genau die Calls ihrer Session (Ende zu Ende, #1331)", () => {
    const bash = (id: string, ts: string, command: string) =>
      JSON.stringify({ type: "assistant", timestamp: ts, message: { content: [{ type: "tool_use", id, name: "Bash", input: { command } }] } });
    mitSession(
      (proj, id) =>
        writeFileSync(
          join(proj, `${id}.jsonl`),
          [
            zeile("x0", "2026-09-29T10:30:00Z"),
            bash("a", "2026-09-29T11:00:00Z", 'echo "pflege: start #1"'),
            zeile("x1", "2026-09-29T11:05:00Z"),
            bash("b", "2026-09-29T11:10:00Z", 'echo "pflege: ende #1"'),
            zeile("x2", "2026-09-29T11:20:00Z"),
          ].join("\n") + "\n",
        ),
      (root) => {
        const r = m.readTranscriptSession("sess-1", root) as Run & { events?: PEv[] };
        assert.deepEqual([...new Set(r.calls.map((c) => c.session))], ["sess-1"]);
        assert.ok(r.events?.length && r.events.every((e) => e.agent === "main:sess-1"), "Events tragen denselben Schlüssel wie die Calls");
        const s = m.summarize(r, BOUNDS);
        assert.equal(Object.fromEntries(s.rows.map((row) => [row.phase, row.calls]))["Pflege"], 1, "der Call zwischen den Markern");
        assert.equal(s.pflegeUnpaired, 0);
      },
    );
  });

  test("fehlende meta.json: der Subagent hat keinen Typ und fällt auf den Zeitschnitt", () => {
    mitSession(
      (proj, id) => {
        writeFileSync(join(proj, `${id}.jsonl`), "");
        const sub = join(proj, id, "subagents");
        mkdirSync(sub, { recursive: true });
        writeFileSync(join(sub, "agent-x.jsonl"), zeile("x1", "2026-09-29T11:00:00Z") + "\n");
      },
      (root) => {
        const r = m.readTranscriptSession("sess-1", root);
        assert.equal(r.calls.length, 1);
        assert.equal(r.calls[0].subagent?.agentType, undefined);
      },
    );
  });

  test("unbekannte Session wirft, statt still leer zu melden", () => {
    mitSession(
      () => undefined,
      (root) => assert.throws(() => m.readTranscriptSession("gibt-es-nicht", root), /Kein Transkript für Session gibt-es-nicht/),
    );
  });
});

describe("token-baseline: Nachweis, Zeitpunkt, Cache-Neuaufbau (#1309)", () => {
  const SHA = "a".repeat(40);
  const nachweisCommit = (plan = "KQ-Plan: kubernia-planner", runden = 2) => ({
    messageHeadline: "chore: Nachweis",
    messageBody: `${plan}\nKQ-Review: head=${SHA} runden=${runden} lenses=architektur,requirement-treue,test-adaequanz verdikt=ok`,
  });

  test("nachweisAusCommits: Runden und Planer aus den Commit-Zeilen; ohne KQ-Review null", () => {
    assert.deepEqual(m.nachweisAusCommits([{ messageHeadline: "feat: x", messageBody: "" }, nachweisCommit()]), { runden: 2, plan: true });
    assert.deepEqual(m.nachweisAusCommits([nachweisCommit("KQ-Plan: ohne — Planer lieferte keinen Plan", 3)]), { runden: 3, plan: false });
    assert.equal(m.nachweisAusCommits([{ messageHeadline: "feat: x", messageBody: "kein Nachweis" }]), null);
    assert.equal(m.nachweisAusCommits(undefined), null, "kaputte Eingabe wirft nicht");
    assert.equal(m.nachweisAusCommits([{ messageHeadline: "x", messageBody: "KQ-Review: head=kaputt runden=viele" }]), null, "kaputte Rundenzahl ist kein Nachweis");
  });

  test("renderMarkdown: Nachweis ersetzt die Heuristik und nennt den Planer; ohne Nachweis steht Heuristik", () => {
    const s = m.summarize({ calls: [call("2026-09-29T10:00:00Z", 1)] });
    assert.match(m.renderMarkdown(s), /Review-Runden: 0 \(Heuristik\)/);
    const md = m.renderMarkdown(s, { failedPushes: 0, mergedAt: "x", nachweis: { runden: 2, plan: true } });
    assert.match(md, /Review-Runden: 2 \(Nachweis\)/);
    assert.match(md, /Planer: ja \(KQ-Plan\)/);
    assert.match(m.renderMarkdown(s, { nachweis: { runden: 1, plan: false } }), /Planer: nein \(KQ-Plan\)/);
    assert.doesNotMatch(m.renderMarkdown(s, { nachweis: { runden: 1, plan: null } }), /Planer:/);
  });

  test("periodAt: fehlender oder ungültiger Zeitpunkt bei Periodenliste → null, gültiger → richtige Periode", () => {
    const alt = { input: 1 };
    const neu = { input: 2 };
    const liste = [{ validFrom: null, ...alt }, { validFrom: "2026-11-01T00:00:00Z", ...neu }];
    assert.equal(m.periodAt(liste, undefined), null);
    assert.equal(m.periodAt(liste, ""), null);
    assert.equal(m.periodAt(liste, "kein-datum"), null);
    assert.equal(m.periodAt(liste, "2026-10-01T00:00:00Z")?.input, 1);
    assert.equal(m.periodAt(liste, "2026-11-02T00:00:00Z")?.input, 2);
    assert.equal(m.periodAt(alt, undefined)?.input, 1, "ein Einzelobjekt gilt immer, auch ohne Zeitpunkt");
  });

  test("priceCall: Call ohne gültiges ts bei Perioden-Tabelle ist ohne Preis; die Meldung nennt den Zeitpunkt", () => {
    const p = { input: 1, cacheWrite5m: 1, cacheWrite1h: 1, cacheRead: 1, output: 1 };
    const prices = { "claude-x": [{ validFrom: null, ...p }, { validFrom: "2026-11-01T00:00:00Z", ...p, input: 2 }] };
    const ohneTs = { ts: "", model: "claude-x", input: 1_000_000, cacheWrite: 0, cacheRead: 0, output: 0 };
    assert.equal(m.priceCall(ohneTs, prices), null);
    assert.equal(m.priceCall({ ...ohneTs, ts: "2026-10-01T00:00:00Z" }, prices), 1);
    const md = m.renderMarkdown(m.summarize({ calls: [{ ...ohneTs, cost: null }] }));
    assert.match(md, /Zeitpunkt fehlt/);
  });

  const lauf = (ts: string, extra: Partial<Call> = {}): Call => ({ ts, model: "claude-sonnet-5-5", input: 10, cacheWrite: 0, cacheRead: 1000, output: 1, ...extra });
  const umsetzer = { id: "u1", agentType: "kubernia-umsetzer" };

  test("countCacheRebuilds: ohne Pause kein Neuaufbau; Pause + Neuaufbau zählt; Pause + warmer Cache zählt nicht", () => {
    const ohnePause = [lauf("2026-10-05T10:00:00Z", { subagent: umsetzer }), lauf("2026-10-05T10:02:00Z", { subagent: umsetzer, cacheRead: 0, cacheWrite: 900 })];
    assert.deepEqual(m.countCacheRebuilds(ohnePause), { count: 0, cacheWriteTokens: 0 }, "unter 5 Minuten: Cache lebt noch");
    const neuaufbau = [lauf("2026-10-05T10:00:00Z", { subagent: umsetzer }), lauf("2026-10-05T10:09:00Z", { subagent: umsetzer, cacheRead: 100, cacheWrite: 900 })];
    assert.deepEqual(m.countCacheRebuilds(neuaufbau), { count: 1, cacheWriteTokens: 900 });
    const warm = [lauf("2026-10-05T10:00:00Z", { subagent: umsetzer }), lauf("2026-10-05T10:09:00Z", { subagent: umsetzer, cacheRead: 900, cacheWrite: 50 })];
    assert.deepEqual(m.countCacheRebuilds(warm), { count: 0, cacheWriteTokens: 0 }, "Pause, aber der Cache wurde gelesen (1h-TTL oder Nachtreffer)");
  });

  test("countCacheRebuilds: je Konversation getrennt, Hauptagent erst ab 60 Minuten Pause, unsortiert ok", () => {
    const haupt = [lauf("2026-10-05T10:00:00Z"), lauf("2026-10-05T10:30:00Z", { cacheRead: 0, cacheWrite: 500 })];
    assert.equal(m.countCacheRebuilds(haupt).count, 0, "30 min < 60 min (1h-TTL des Hauptchats)");
    const hauptLang = [lauf("2026-10-05T10:00:00Z"), lauf("2026-10-05T11:30:00Z", { cacheRead: 0, cacheWrite: 500 })];
    assert.equal(m.countCacheRebuilds(hauptLang).count, 1);
    // #1331: Hauptagent-Calls mit Session-Schlüssel bekommen weiter die 60-Minuten-Grenze, nicht die 5 Minuten der Subagenten.
    const hauptMitSession = haupt.map((c) => ({ ...c, session: "a" }));
    assert.equal(m.countCacheRebuilds(hauptMitSession).count, 0, "30 min mit session: weiter Hauptagent");
    const gemischt = [
      lauf("2026-10-05T10:09:00Z", { subagent: umsetzer, cacheRead: 0, cacheWrite: 900 }),
      lauf("2026-10-05T10:00:00Z", { subagent: umsetzer }),
      lauf("2026-10-05T10:04:30Z", { subagent: { id: "u2", agentType: "kubernia-lens" } }),
    ];
    assert.equal(m.countCacheRebuilds(gemischt).count, 1, "ein anderer Subagent dazwischen verdeckt die Pause nicht (zusammengelegt wären beide Lücken unter 5 min)");
  });

  test("renderMarkdown nennt die Cache-Neuaufbauten", () => {
    const calls = [lauf("2026-10-05T10:00:00Z", { subagent: umsetzer }), lauf("2026-10-05T10:09:00Z", { subagent: umsetzer, cacheRead: 0, cacheWrite: 900 })];
    assert.match(m.renderMarkdown(m.summarize({ calls })), /Cache-Neuaufbauten: 1 \(≈ 900 Tokens Cache-Write\)/);
  });
});

describe("token-baseline: Grenzwerte von countCacheRebuilds (#1311)", () => {
  const umsetzer = { id: "u1", agentType: "kubernia-umsetzer" };
  const warm = (ts: string): Call => ({ ts, model: "claude-sonnet-5-5", input: 0, cacheWrite: 0, cacheRead: 1000, output: 1, subagent: umsetzer });
  const spaeter = (ts: string, cacheRead: number, cacheWrite: number): Call => ({ ts, model: "claude-sonnet-5-5", input: 0, cacheWrite, cacheRead, output: 1, subagent: umsetzer });

  test("Pause genau 5 Minuten zählt nicht, eine Millisekunde mehr schon", () => {
    const a = warm("2026-10-05T10:00:00.000Z");
    assert.equal(m.countCacheRebuilds([a, spaeter("2026-10-05T10:05:00.000Z", 0, 900)]).count, 0, "genau die TTL: Cache lebt noch");
    assert.equal(m.countCacheRebuilds([a, spaeter("2026-10-05T10:05:00.001Z", 0, 900)]).count, 1, "knapp darüber: abgelaufen");
  });

  test("Cache-Read genau halber Kontext zählt nicht, knapp darunter schon", () => {
    const a = warm("2026-10-05T10:00:00Z");
    assert.equal(m.countCacheRebuilds([a, spaeter("2026-10-05T10:09:00Z", 500, 500)]).count, 0, "Read = Kontext/2: gelesen, kein Neuaufbau");
    assert.equal(m.countCacheRebuilds([a, spaeter("2026-10-05T10:09:00Z", 499, 501)]).count, 1, "Read knapp unter Kontext/2");
  });

  test("Hauptchat: genau 60 Minuten zählt nicht, eine Millisekunde mehr schon", () => {
    const haupt = (ts: string, cacheRead: number, cacheWrite: number): Call => ({ ts, model: "claude-opus-5-5", input: 0, cacheWrite, cacheRead, output: 1 });
    const a = haupt("2026-10-05T10:00:00.000Z", 1000, 0);
    assert.equal(m.countCacheRebuilds([a, haupt("2026-10-05T11:00:00.000Z", 0, 900)]).count, 0);
    assert.equal(m.countCacheRebuilds([a, haupt("2026-10-05T11:00:00.001Z", 0, 900)]).count, 1);
  });

  test("leere Kontexte (alles 0) und ein einzelner Call zählen nie", () => {
    assert.deepEqual(m.countCacheRebuilds([]), { count: 0, cacheWriteTokens: 0 });
    assert.equal(m.countCacheRebuilds([warm("2026-10-05T10:00:00Z")]).count, 0);
    assert.equal(m.countCacheRebuilds([warm("2026-10-05T10:00:00Z"), spaeter("2026-10-05T10:30:00Z", 0, 0)]).count, 0, "Kontext 0: kein Neuaufbau messbar");
  });
});

describe("token-baseline: Phase Pflege (#1099)", () => {
  const umsetzer: Sub = { id: "u", agentType: "kubernia-umsetzer", description: "Umsetzung #12" };
  const wf: Sub = { id: "w", description: "umsetzen:#12" };
  const marker = (ts: string, art: "start" | "ende", agent: string | null = "u"): PEv => ({
    ts,
    tool: "Bash",
    input: { command: `echo "pflege: ${art} #12"` },
    resultChars: 0,
    agent,
  });
  const IV = [{ agent: "u", from: "2026-09-29T11:00:00Z", to: "2026-09-29T11:10:00Z" }];

  test("nur Calls des Agenten im Intervall (Grenzen inklusive) sind Pflege", () => {
    const calls = [
      call("2026-09-29T10:59:59Z", 1, { subagent: umsetzer }),
      call("2026-09-29T11:00:00Z", 2, { subagent: umsetzer }),
      call("2026-09-29T11:05:00Z", 3, { subagent: umsetzer }),
      call("2026-09-29T11:10:00Z", 4, { subagent: umsetzer }),
      call("2026-09-29T11:10:01Z", 5, { subagent: umsetzer }),
    ];
    const w = m.windowCalls(calls, BOUNDS, IV);
    assert.deepEqual(w.map((x) => x.phase), ["Umsetzung", "Pflege", "Pflege", "Pflege", "Umsetzung"]);
  });

  test("Hauptagent im selben Zeitraum bleibt Umsetzung (Agenten-Grenze)", () => {
    const w = m.windowCalls([call("2026-09-29T11:05:00Z", 1), call("2026-09-29T11:06:00Z", 1, { subagent: { id: "anderer", agentType: "kubernia-umsetzer" } })], BOUNDS, IV);
    assert.deepEqual(w.map((x) => x.phase), ["Umsetzung", "Umsetzung"]);
  });

  test("Workflow-Label umsetzen:#12 im Intervall wird Pflege", () => {
    const w = m.windowCalls([call("2026-09-29T11:05:00Z", 1, { subagent: wf })], BOUNDS, [{ agent: "w", from: IV[0].from, to: IV[0].to }]);
    assert.equal(w[0].phase, "Pflege");
  });

  test("Nachlauf schlägt Pflege", () => {
    const w = m.windowCalls([call("2026-09-29T13:30:00Z", 1, { subagent: umsetzer })], BOUNDS, [{ agent: "u", from: "2026-09-29T13:00:00Z", to: "2026-09-29T14:00:00Z" }]);
    assert.equal(w[0].phase, "Nachlauf");
  });

  test("ohne Intervalle unverändert (Default)", () => {
    assert.equal(m.windowCalls([call("2026-09-29T11:05:00Z", 1, { subagent: umsetzer })], BOUNDS)[0].phase, "Umsetzung");
  });

  test("summarize: Zeile Pflege zwischen Umsetzung und Review, gepaarte Marker ohne Warnung", () => {
    const calls = [
      call("2026-09-29T10:30:00Z", 1, { subagent: umsetzer }),
      call("2026-09-29T11:05:00Z", 2, { subagent: umsetzer }),
      call("2026-09-29T11:30:00Z", 3, { model: "claude-opus-5-5", subagent: { id: "l", agentType: "kubernia-lens", description: "Lens Architektur R1" } }),
    ];
    const events = [marker("2026-09-29T11:00:00Z", "start"), marker("2026-09-29T11:10:00Z", "ende")];
    const s = m.summarize({ calls, events }, BOUNDS);
    assert.deepEqual(s.rows.map((r) => r.phase), ["Umsetzung", "Pflege", "Review"]);
    assert.equal(s.pflegeUnpaired, 0);
    assert.doesNotMatch(m.renderMarkdown(s), /Pflege-Marker ohne Gegenstück/);
  });

  test("Start und Ende im selben Zeitpunkt (ein Befehl): Pflege ohne Dauer wird gemeldet, nicht als Gegenstück-Fehler (#1382)", () => {
    const calls = [call("2026-09-29T11:05:00Z", 2, { subagent: umsetzer })];
    const events = [marker("2026-09-29T11:00:00Z", "start"), marker("2026-09-29T11:00:00Z", "ende")];
    const s = m.summarize({ calls, events }, BOUNDS) as ReturnType<typeof m.summarize> & { pflegeOhneDauer?: number };
    assert.equal(s.pflegeUnpaired, 0);
    assert.equal(s.pflegeOhneDauer, 1);
    const md = m.renderMarkdown(s);
    assert.match(md, /1 Pflege-Intervall ohne Dauer/);
    assert.doesNotMatch(md, /ohne Gegenstück/);
    const normal = m.summarize({ calls, events: [marker("2026-09-29T11:00:00Z", "start"), marker("2026-09-29T11:10:00Z", "ende")] }, BOUNDS) as typeof s;
    assert.equal(normal.pflegeOhneDauer, 0);
    assert.doesNotMatch(m.renderMarkdown(normal), /ohne Dauer/);
  });

  test("ungepaarter Marker: keine Pflege-Zeile, Warnzeile; ohne events keine Warnung", () => {
    const calls = [call("2026-09-29T11:05:00Z", 2, { subagent: umsetzer })];
    const s = m.summarize({ calls, events: [marker("2026-09-29T11:00:00Z", "start")] }, BOUNDS);
    assert.deepEqual(s.rows.map((r) => r.phase), ["Umsetzung"]);
    assert.equal(s.pflegeUnpaired, 1);
    assert.match(m.renderMarkdown(s), /1 Pflege-Marker ohne Gegenstück/);
    const ohne = m.summarize({ calls }, BOUNDS);
    assert.ok(!ohne.pflegeUnpaired);
    assert.doesNotMatch(m.renderMarkdown(ohne), /Pflege-Marker ohne Gegenstück/);
  });

  test("Marker vor --from (früheres Ticket) erzeugen weder Intervall noch Warnzeile", () => {
    const calls = [call("2026-09-29T11:05:00Z", 2, { subagent: umsetzer })];
    const s = m.summarize({ calls, events: [marker("2026-09-29T09:00:00Z", "start")] }, { ...BOUNDS, from: "2026-09-29T10:00:00Z" });
    assert.equal(s.pflegeUnpaired, 0);
    assert.deepEqual(s.rows.map((r) => r.phase), ["Umsetzung"]);
  });

  test("Marker nach dem Merge (mergedAt) erzeugen kein Intervall und keine Warnzeile (#1331)", () => {
    const calls = [call("2026-09-29T11:05:00Z", 2, { subagent: umsetzer })];
    const s = m.summarize({ calls, events: [marker("2026-09-29T13:00:00Z", "start")] }, BOUNDS);
    assert.equal(s.pflegeUnpaired, 0, "ein Start ab mergedAt (halboffen) liegt außerhalb des Ticket-Fensters");
    const davor = m.summarize({ calls, events: [marker("2026-09-29T12:59:59Z", "start")] }, BOUNDS);
    assert.equal(davor.pflegeUnpaired, 1, "Gegenprobe: eine Sekunde früher zählt");
  });

  test("zwei Hauptagent-Sessions mit verschränkten Markern ergeben zwei saubere Intervalle (#1331)", () => {
    const hauptMarker = (session: string, ts: string, art: "start" | "ende"): PEv => marker(ts, art, `main:${session}`);
    const events = [
      hauptMarker("a", "2026-09-29T11:00:00Z", "start"),
      hauptMarker("b", "2026-09-29T11:02:00Z", "start"),
      hauptMarker("a", "2026-09-29T11:10:00Z", "ende"),
      hauptMarker("b", "2026-09-29T11:12:00Z", "ende"),
    ];
    const calls = [
      call("2026-09-29T11:05:00Z", 1, { session: "a" }),
      call("2026-09-29T11:11:00Z", 1, { session: "b" }),
      call("2026-09-29T11:11:00Z", 1, { session: "a" }), // a ist hier schon aus dem Intervall
    ];
    const s = m.summarize({ calls, events }, BOUNDS);
    assert.equal(s.pflegeUnpaired, 0);
    const phasen = Object.fromEntries(s.rows.map((r) => [r.phase, r.calls]));
    assert.equal(phasen["Pflege"], 2);
    assert.equal(phasen["Umsetzung"], 1);
  });

  test("Langfuse-Parität: Marker-TOOL unter dem Subagent-Span ergibt dieselbe Zuordnung", () => {
    const obs: Obs[] = [
      { id: "u", type: "SPAN", name: "Subagent: Umsetzung #12", startTime: "2026-09-29T10:00:00Z", metadata: { agent_type: "kubernia-umsetzer" } },
      { id: "t1", type: "TOOL", name: "Tool: Bash", startTime: "2026-09-29T11:00:00Z", parentObservationId: "u", input: { command: 'echo "pflege: start #12"' }, metadata: { tool_name: "Bash" } } as Obs,
      { id: "g", type: "GENERATION", name: "LLM Call", startTime: "2026-09-29T11:05:00Z", parentObservationId: "u", providedModelName: "claude-sonnet-5-5", usageDetails: { output: 4 } },
      { id: "t2", type: "TOOL", name: "Tool: Bash", startTime: "2026-09-29T11:10:00Z", parentObservationId: "u", input: { command: 'echo "pflege: ende #12"' }, metadata: { tool_name: "Bash" } } as Obs,
    ];
    const run = m.callsFromLangfuse(obs) as Run;
    // Schlanke Abfrage: die TOOL-Einträge tragen keinen Eltern-Verweis, der Resolver schlägt ihn in der vollen Liste nach.
    const schlank = obs.filter((o) => o.type === "TOOL").map((o) => ({ ...o, parentObservationId: undefined }));
    const events = toolEventsFromLangfuse(schlank, m.toolAgentResolver(obs));
    assert.deepEqual(events.map((e) => e.agent), ["u", "u"]);
    const s = m.summarize({ ...run, events }, BOUNDS);
    assert.deepEqual(s.rows.map((r) => r.phase), ["Pflege"]);
  });
});

describe("token-baseline: Nachlauf, Tool-Fehler, Lesen, fehlender Marker (#1379)", () => {
  type Sum = Summary & { nachlauf: { calls: number; cost: number }; fehler?: Record<string, number>; lesen?: { reads: number; voll: { n: number } }; pflegeFehlt?: boolean };
  const umsetzer: Sub = { id: "u", agentType: "kubernia-umsetzer", description: "Umsetzung #12" };
  const sum = (c: Call[], events?: unknown[]) => m.summarize({ calls: c, events: events as PEv[] }, BOUNDS) as unknown as Sum;
  const calls = [
    call("2026-09-29T11:00:00Z", 50, { cost: 1.5 }),
    call("2026-09-29T11:30:00Z", 7, { subagent: umsetzer, cost: 0.5 }),
    call("2026-09-29T14:00:00Z", 999, { cost: 0.25 }), // Nachlauf
    call("2026-09-29T14:10:00Z", 1, { model: "claude-opus-5-5", cost: 0.5 }),
  ];
  const rd = (ts: string, file: string): PEv => ({ ts, tool: "Read", input: { file_path: file }, resultChars: 400, agent: "u" });

  test("Invariante: Σ rows = total + nachlauf (Calls und Kosten), Nachlauf-Zeilen stehen unter der Summe", () => {
    const s = sum(calls);
    const rows = s.rows.reduce((a, r) => ({ calls: a.calls + r.calls, cost: a.cost + r.cost }), { calls: 0, cost: 0 });
    assert.equal(rows.calls, s.total.calls + s.nachlauf.calls);
    assert.ok(Math.abs(rows.cost - (s.total.cost + s.nachlauf.cost)) < 1e-9);
    assert.equal(s.nachlauf.calls, 2);
    assert.equal(s.nachlauf.cost, 0.75);
    const md = m.renderMarkdown(s);
    assert.ok(md.indexOf("Summe (ohne Nachlauf)") < md.indexOf("Nachlauf (nicht in der Summe)"));
    assert.doesNotMatch(md.slice(0, md.indexOf("Summe (ohne Nachlauf)")), /\| Nachlauf \|/, "Nachlauf-Zeilen stehen nicht über der Summe");
  });

  test("ohne Nachlauf ist nachlauf.calls 0 und es gibt keine Nachlauf-Zeile", () => {
    const s = sum(calls.slice(0, 2));
    assert.equal(s.nachlauf.calls, 0);
    assert.doesNotMatch(m.renderMarkdown(s), /nicht in der Summe/);
  });

  test("Tool-Fehler und Lesen: Zeilen im Report, nur mit Events und nur im Ticket-Fenster", () => {
    const events: PEv[] = [
      { ts: "2026-09-29T11:00:00Z", tool: "Bash", input: {}, resultChars: 0, agent: "u", fehler: "Blocked: sleep 1" } as PEv,
      { ts: "2026-09-29T11:01:00Z", tool: "Bash", input: {}, resultChars: 0, agent: "u", fehler: "Exit code 1" } as PEv,
      { ts: "2026-09-29T14:00:00Z", tool: "Bash", input: {}, resultChars: 0, agent: "u", fehler: "Blocked: nach dem Merge" } as PEv,
      rd("2026-09-29T11:02:00Z", "/x/a.md"),
      rd("2026-09-29T11:03:00Z", "/x/a.md"),
      { ts: "2026-09-29T11:04:00Z", tool: "Bash", input: { command: "npm run verify:kompakt" }, resultChars: 0, agent: "u" },
      { ts: "2026-09-29T14:01:00Z", tool: "Bash", input: { command: "npm run verify" }, resultChars: 0, agent: "u" },
    ];
    const s = sum(calls, events);
    assert.deepEqual(s.fehler, { guard: 1, exit: 1 });
    assert.equal(s.lesen?.voll.n, 1);
    const md = m.renderMarkdown(s);
    assert.match(md, /Tool-Fehler: Hook 0 · Guard 1 · Permission 0 · zu groß 0 · sonst 0 · Exit≠0 1 \(kein Fehlersignal\)/);
    assert.match(md, /Lesen: 2 Reads \(0 abschnittsweise\) · Wiederlesen voll 1 \(≈ 100 Tok\) · gezielt 0 \(≈ 0 Tok\) · Top a\.md 1×/);
    assert.match(md, /Prüfläufe: verify voll 1 · gezielt 0/);
    assert.doesNotMatch(m.renderMarkdown(sum(calls)), /Tool-Fehler:|Lesen:|Prüfläufe:/);
  });

  test("Warnzeile: Umsetzer ohne jeden Marker; nicht mit Markern, nicht ohne Umsetzer, nicht ohne Events", () => {
    const echo = (ts: string, art: string): PEv => ({ ts, tool: "Bash", input: { command: `echo "pflege: ${art} #12"` }, resultChars: 0, agent: "u" });
    assert.equal(sum(calls, []).pflegeFehlt, true);
    assert.match(m.renderMarkdown(sum(calls, [])), /Kein Pflege-Marker — Pflegekosten stecken in „Umsetzung“/);
    const mitMarker = sum(calls, [echo("2026-09-29T11:10:00Z", "start"), echo("2026-09-29T11:20:00Z", "ende")]);
    assert.equal(mitMarker.pflegeFehlt, false);
    assert.doesNotMatch(m.renderMarkdown(mitMarker), /Kein Pflege-Marker/);
    const ungepaart = sum(calls, [echo("2026-09-29T11:10:00Z", "start")]);
    assert.equal(ungepaart.pflegeFehlt, false, "ein Marker ohne Gegenstück bekommt nur die Unpaired-Warnung");
    assert.doesNotMatch(m.renderMarkdown(ungepaart), /Kein Pflege-Marker/);
    const nurNachlauf = [calls[0], call("2026-09-29T14:20:00Z", 4, { subagent: umsetzer, cost: 0.1 })];
    assert.equal(sum(nurNachlauf, []).pflegeFehlt, false, "ein Umsetzer erst nach dem Merge löst keine Warnung aus");
    assert.equal(sum([calls[0]], []).pflegeFehlt, false, "ohne Umsetzer keine Warnung");
    assert.ok(!sum(calls).pflegeFehlt, "ohne Events keine Warnung");
  });
});

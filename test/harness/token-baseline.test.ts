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

// Reines Node-Tooling-Skript ohne Declaration-File (wie scripts/check-diffsize.mjs).
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as baselineModule from "../../scripts/token-baseline.mjs";

type Sub = { id?: string; agentType?: string; description?: string };
type Call = {
  ts: string;
  model?: string | null;
  input?: number;
  cacheWrite?: number;
  cacheRead?: number;
  output?: number;
  cost?: number | string;
  subagent?: Sub | null;
};
type Run = { calls: Call[]; questions?: number };
type Row = { phase: string; model: string; calls: number; input: number; cacheWrite: number; cacheRead: number; output: number; cost: number };
type Summary = { rows: Row[]; total: Omit<Row, "phase" | "model">; hasCost: boolean; reviewRounds: number; questions: number };
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
  summarize: (run: Run, bounds?: Bounds) => Summary;
  callsFromTranscript: (jsonl: string, subagent?: Sub | null) => { calls: Call[]; questions: number };
  callsFromLangfuse: (obs: Obs[]) => Run & { questions: number };
  countFailedPushes: (runs: { head_sha: string }[] | undefined) => number;
  mergedWithoutRework: (mergedAt: string | null | undefined, failedPushes: number) => boolean;
  renderMarkdown: (s: Summary, loop?: { failedPushes?: number; mergedAt?: string | null }) => string;
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
    assert.equal(m.classifySubagent("claude-code-guide", "Liest Claude Code AGENTS.md?"), null);
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
    assert.equal(s.total.cost, 0.25);
    assert.equal(s.hasCost, true);
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
  test("CI-Fix-Runden zählen distinct head_sha (Rerun zählt nicht doppelt, wie #904)", () => {
    assert.equal(m.countFailedPushes([{ head_sha: "a" }, { head_sha: "a" }, { head_sha: "b" }]), 2);
    assert.equal(m.countFailedPushes(undefined), 0);
  });

  test("gemergt ohne Nacharbeit nur bei Merge UND null roten Pushes", () => {
    assert.equal(m.mergedWithoutRework("2026-09-29T12:00:00Z", 0), true);
    assert.equal(m.mergedWithoutRework("2026-09-29T12:00:00Z", 1), false);
    assert.equal(m.mergedWithoutRework(null, 0), false);
  });

  test("renderMarkdown zeigt Summe und Loop-Zeile, fehlende PR-Daten als –", () => {
    const s = m.summarize({ calls: [call("2026-09-29T10:00:00Z", 1, { input: 1234 })] });
    const md = m.renderMarkdown(s);
    assert.match(md, /\| \*\*Summe \(ohne Nachlauf\)\*\* \|/);
    assert.match(md, /1\.234/);
    assert.match(md, /CI-Fix-Runden: – · Rückfragen: 0 · gemergt ohne Nacharbeit: –/);
    assert.match(m.renderMarkdown(s, { failedPushes: 0, mergedAt: "x" }), /gemergt ohne Nacharbeit: ja/);
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

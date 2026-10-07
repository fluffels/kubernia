/* Projekt-Brain-Kennzahlen (#1205): Klassifikation, Event-Adapter, Kennzahlen.
 * Rein pur: Transkript-JSONL und Langfuse-Observations kommen als Fixtures, kein IO.
 */
import { describe, test } from "vitest";
import assert from "node:assert/strict";

// Reines Node-Tooling-Skript ohne Declaration-File (wie scripts/check-diffsize.mjs).
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as bmModule from "../scripts/brain-metrics.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as baselineModule from "../scripts/token-baseline.mjs";

type Ev = { ts: string; tool: string; input: Record<string, unknown>; resultChars: number };
type Metrics = {
  brainReads: number;
  brainPages: number;
  brainReadTokens: number;
  searchCalls: number;
  searchTokens: number;
  rechercheTokens: number;
  callsBeforeFirstEdit: number | null;
  brainWrites: number;
  prBrain: { pages: number; additions: number; deletions: number } | null;
};
type Row = { phase: string; input: number; cacheWrite: number; cacheRead: number; output: number };
type Obs = { type: string; startTime: string; name?: string; input?: unknown; metadata?: Record<string, unknown> };

/** Modul-Form EINMAL deklarieren und genau hier casten. */
const bm = bmModule as {
  isBrainPage: (p?: string) => boolean;
  classifyShell: (command: string, tool?: string) => { brainReads: string[]; search: boolean };
  toolEventsFromTranscript: (jsonl: string) => Ev[];
  toolEventsFromLangfuse: (obs: Obs[]) => Ev[];
  brainMetrics: (run: { events?: Ev[]; rows?: Row[] }, bounds?: { from?: string; mergedAt?: string }, prFiles?: { path: string; additions?: number; deletions?: number }[] | null) => Metrics;
};
const baseline = baselineModule as {
  renderMarkdown: (s: object, loop?: object) => string;
  summarize: (run: object, bounds?: object, prFiles?: object[] | null) => { brain?: Metrics };
  fetchSessionObservations: (id: string, o: object) => Promise<unknown[]>;
};
const { isBrainPage, classifyShell, toolEventsFromTranscript, toolEventsFromLangfuse, brainMetrics } = bm;

const ev = (ts: string, tool: string, input: Record<string, unknown> = {}, resultChars = 0): Ev => ({ ts, tool, input, resultChars });

describe("isBrainPage", () => {
  test("erkennt Markdown unter docs/", () => {
    for (const p of [
      "docs/x.md",
      "C:\\r\\docs\\adr\\0013-a.md",
      "/r/.claude/worktrees/kq-1/docs/module/sim.md",
    ])
      assert.equal(isBrainPage(p), true, p);
  });
  test("lehnt alles andere ab", () => {
    for (const p of ["AGENTS.md", "src/content/AGENTS.md", "docs/img/a.png", "xdocs/a.md", "docs.md", "node_modules/p/docs/a.md", "", undefined])
      assert.equal(isBrainPage(p), false, String(p));
  });
});

describe("classifyShell", () => {
  test("Lesezugriffe auf Brain-Seiten", () => {
    for (const c of ["cat docs/a.md", "sed -n 1,40p docs/x.md | head", "cd x && cat docs/a.md"])
      assert.deepEqual(classifyShell(c).brainReads.length, 1, c);
    assert.equal(classifyShell("Get-Content docs\\a.md", "PowerShell").brainReads.length, 1);
  });
  test("Suche", () => {
    for (const c of ["grep -rn foo docs/", "rg x", "find . -name a", "git grep foo"]) {
      const r = classifyShell(c);
      assert.equal(r.search, true, c);
      assert.equal(r.brainReads.length, 0, c);
    }
    assert.equal(classifyShell("Get-ChildItem -Recurse x", "PowerShell").search, true);
  });
  test("weder noch", () => {
    for (const c of ["npm test", "cat README.md", "echo docs/a.md"]) assert.deepEqual(classifyShell(c), { brainReads: [], search: false }, c);
  });
  test("nicht parsebar: Fallback, wirft nicht", () => {
    const r = classifyShell("cat docs/a.md 'offen");
    assert.equal(r.brainReads.length, 1);
  });
});

describe("toolEventsFromTranscript", () => {
  const use = (id: string, name: string, input: object, ts = "2026-10-01T10:00:00Z") =>
    JSON.stringify({ type: "assistant", timestamp: ts, message: { content: [{ type: "tool_use", id, name, input }] } });
  const res = (id: string, content: unknown) =>
    JSON.stringify({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: id, content }] } });
  test("verknüpft Ergebnis als String und als Text-Array (Bilder zählen nicht)", () => {
    const e = toolEventsFromTranscript(
      [use("a", "Read", { file_path: "docs/a.md" }), res("a", "12345"), use("b", "Read", {}), res("b", [{ type: "text", text: "abc" }, { type: "image" }])].join("\n"),
    );
    assert.deepEqual(e.map((x: Ev) => x.resultChars), [5, 3]);
  });
  test("fehlendes Ergebnis → 0, kaputte Zeile übersprungen, mehrere tool_use je Nachricht", () => {
    const multi = JSON.stringify({
      type: "assistant",
      timestamp: "2026-10-01T10:00:00Z",
      message: { content: [{ type: "tool_use", id: "x", name: "Grep", input: {} }, { type: "tool_use", id: "y", name: "Glob", input: {} }] },
    });
    const e = toolEventsFromTranscript(["{kaputt", multi, use("z", "Bash", { command: "ls" })].join("\n"));
    assert.equal(e.length, 3);
    assert.ok(e.every((x: Ev) => x.resultChars === 0));
  });
});

describe("toolEventsFromLangfuse", () => {
  test("Input als Objekt und JSON-String, orig_len als Ergebnisgröße, nur TOOL", () => {
    const e = toolEventsFromLangfuse([
      { type: "TOOL", startTime: "t1", input: "{\"file_path\": \"docs/a.md\"}", metadata: { tool_name: "Read", output_meta: { orig_len: 400 } } },
      { type: "TOOL", startTime: "t2", name: "Tool: Grep [Kubernia-Code]", input: { pattern: "x" }, metadata: {} },
      { type: "GENERATION", startTime: "t3", input: {} },
      { type: "SPAN", startTime: "t4", input: {} },
    ]);
    assert.equal(e.length, 2);
    assert.deepEqual([e[0].tool, e[0].input.file_path, e[0].resultChars], ["Read", "docs/a.md", 400]);
    assert.deepEqual([e[1].tool, e[1].resultChars], ["Grep", 0]);
  });
});

describe("brainMetrics", () => {
  const T = (n: number) => `2026-10-01T10:00:0${n}Z`;
  test("zählt Reads, Suche, Pflege und Calls bis zum ersten Edit", () => {
    const m = brainMetrics({
      events: [
        ev(T(0), "Read", { file_path: "docs/a.md" }, 400),
        ev(T(1), "Bash", { command: "cat docs/b.md" }, 800),
        ev(T(2), "Grep", { pattern: "x" }, 40),
        ev(T(3), "Edit", { file_path: "C:\\Users\\x\\AppData\\Local\\Temp\\s.txt" }),
        ev(T(4), "Edit", { file_path: "src/a.ts" }),
        ev(T(5), "Write", { file_path: "docs/c.md" }),
        ev(T(6), "Write", { file_path: "src/b.ts" }),
      ],
    });
    assert.equal(m.brainReads, 2);
    assert.equal(m.brainPages, 2);
    assert.equal(m.brainReadTokens, 300);
    assert.equal(m.searchCalls, 1);
    assert.equal(m.searchTokens, 10);
    assert.equal(m.callsBeforeFirstEdit, 4);
    assert.equal(m.brainWrites, 1);
  });
  test("Fenster: vor from und ab mergedAt zählt nicht", () => {
    const m = brainMetrics(
      { events: [ev(T(0), "Read", { file_path: "docs/a.md" }), ev(T(2), "Read", { file_path: "docs/b.md" }), ev(T(4), "Read", { file_path: "docs/c.md" })] },
      { from: T(1), mergedAt: T(3) },
    );
    assert.equal(m.brainReads, 1);
  });
  test("kein Edit → null; leerer Lauf wirft nicht", () => {
    assert.equal(brainMetrics({ events: [ev(T(0), "Read", { file_path: "src/a.ts" })] }).callsBeforeFirstEdit, null);
    const z = brainMetrics({});
    assert.deepEqual([z.brainReads, z.searchCalls, z.brainWrites, z.rechercheTokens, z.prBrain], [0, 0, 0, 0, null]);
  });
  test("Recherche-Tokens aus den Phasenzeilen, PR-Seiten nur unter docs/", () => {
    const m = brainMetrics(
      { rows: [{ phase: "Recherche", input: 1, cacheWrite: 2, cacheRead: 3, output: 4 }, { phase: "Umsetzung", input: 100, cacheWrite: 0, cacheRead: 0, output: 0 }] },
      {},
      [{ path: "docs/a.md", additions: 5, deletions: 1 }, { path: "src/x.ts", additions: 9, deletions: 9 }],
    );
    assert.equal(m.rechercheTokens, 10);
    assert.deepEqual(m.prBrain, { pages: 1, additions: 5, deletions: 1 });
    assert.equal(brainMetrics({}, {}, [{ path: "src/x.ts" }]).prBrain?.pages, 0);
  });
});

describe("renderMarkdown mit Projekt-Brain", () => {
  const summary = {
    rows: [], total: { calls: 0, input: 0, cacheWrite: 0, cacheRead: 0, output: 0, cost: 0 }, hasCost: false,
    reviewRounds: 1, cacheRebuilds: null, questions: 0, unpriced: 0, costParts: null, medianContext: {}, sockel: {},
  };
  test("Zeile erscheint mit brain, fehlt ohne", () => {
    const brain = brainMetrics({ events: [ev("2026-10-01T10:00:00Z", "Read", { file_path: "docs/a.md" }, 400)] }, {}, null);
    const out = baseline.renderMarkdown({ ...summary, brain }, {});
    assert.match(out, /Projekt-Brain: gelesen 1× \(1 Seiten, ≈ 100 Tokens\)/);
    assert.match(out, /Calls bis erster Edit –/);
    assert.match(out, /PR –/);
    assert.doesNotMatch(baseline.renderMarkdown(summary, {}), /Projekt-Brain/);
  });
});

describe("Härtung nach Review", () => {
  const T = (n: number) => `2026-10-01T10:00:0${n}Z`;
  const use = (id: string, name: string, input: object) => ({ type: "tool_use", id, name, input });
  test("Ergebnisse werden über die ID verknüpft, auch bei umgekehrter Reihenfolge und verwaister ID", () => {
    const lines = [
      JSON.stringify({ type: "assistant", timestamp: T(0), message: { content: [use("a", "Read", {}), use("b", "Grep", {})] } }),
      JSON.stringify({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "b", content: "22" }, { type: "tool_result", tool_use_id: "zz", content: "999" }, { type: "tool_result", tool_use_id: "a", content: "1" }] } }),
    ].join("\n");
    const e = toolEventsFromTranscript(lines);
    assert.deepEqual(e.map((x) => [x.tool, x.resultChars]), [["Read", 1], ["Grep", 2]]);
  });
  test("summarize verdrahtet Events, Fenster und PR-Dateien; ohne events kein brain", () => {
    const events = [ev(T(0), "Read", { file_path: "docs/a.md" }), ev(T(2), "Read", { file_path: "docs/b.md" }), ev(T(4), "Read", { file_path: "docs/c.md" })];
    const s = baseline.summarize({ calls: [], events }, { from: T(1), mergedAt: T(3) }, [{ path: "docs/x.md", additions: 2, deletions: 1 }]);
    assert.equal(s.brain?.brainReads, 1);
    assert.equal(s.brain?.prBrain?.pages, 1);
    assert.equal(baseline.summarize({ calls: [] }).brain, undefined);
  });
  test("Events werden nach Zeit sortiert (Subagenten-Events kommen hinten an)", () => {
    const m = brainMetrics({ events: [ev(T(3), "Edit", { file_path: "src/a.ts" }), ev(T(0), "Read", {}), ev(T(1), "Read", {}), ev(T(2), "Read", {})] });
    assert.equal(m.callsBeforeFirstEdit, 3);
  });
  test("Fenster ist halboffen: from zählt, mergedAt nicht", () => {
    const m = brainMetrics({ events: [ev(T(1), "Read", { file_path: "docs/a.md" }), ev(T(3), "Read", { file_path: "docs/b.md" })] }, { from: T(1), mergedAt: T(3) });
    assert.equal(m.brainReads, 1);
  });
  test("grep auf eine Brain-Seite ist Suche, kein Lesen", () => {
    assert.deepEqual(classifyShell("grep foo docs/x.md"), { brainReads: [], search: true });
  });
  test("AST-Weg: Quotes und Substitution; PowerShell mit &&", () => {
    assert.equal(classifyShell('cat "docs/a.md"').brainReads.length, 1);
    assert.equal(classifyShell("x=$(cat docs/a.md)").brainReads.length, 1);
    assert.equal(classifyShell("cd x && cat docs/a.md", "PowerShell").brainReads.length, 1);
  });
  test("Seiten dedupliziert, Mehrfach-Pfade zählen einzeln, Schreibzugriff per notebook_path/MultiEdit", () => {
    const m = brainMetrics({
      events: [
        ev(T(0), "Read", { file_path: "C:\\r\\docs\\a.md" }),
        ev(T(1), "Bash", { command: "cat C:/r/docs/a.md" }),
        ev(T(2), "Bash", { command: "cat docs/a.md docs/b.md" }),
        ev(T(3), "MultiEdit", { file_path: "docs/z.md" }),
        ev(T(4), "NotebookEdit", { notebook_path: "docs/n.md" }),
      ],
    });
    assert.deepEqual([m.brainReads, m.brainPages, m.brainWrites], [4, 3, 2]);
  });
  test("kaputter Langfuse-Input wirft nicht", () => {
    const e = toolEventsFromLangfuse([{ type: "TOOL", startTime: T(0), input: "{kaputt", metadata: { tool_name: "Read" } }]);
    assert.deepEqual(e[0].input, {});
  });
  test("Report-Zeile vollständig", () => {
    const brain = brainMetrics(
      { events: [ev(T(0), "Grep", {}, 40), ev(T(1), "Write", { file_path: "docs/n.md" })], rows: [{ phase: "Recherche", input: 5, cacheWrite: 0, cacheRead: 0, output: 0 }] },
      {},
      [{ path: "docs/n.md", additions: 3, deletions: 2 }],
    );
    const out = baseline.renderMarkdown({ rows: [], total: { calls: 0, input: 0, cacheWrite: 0, cacheRead: 0, output: 0, cost: 0 }, hasCost: false, reviewRounds: 0, cacheRebuilds: null, questions: 0, unpriced: 0, costParts: null, medianContext: {}, sockel: {}, brain }, {});
    assert.match(out, /Suche 1 Calls \(≈ 10 Tokens\) · Recherche-Subagenten 5 Tokens · Calls bis erster Edit 1 · Brain-Pflege 1 Schreibzugriffe, PR 1 Seiten \(\+3\/−2\)/);
  });
  test("fetchSessionObservations reicht type und fields durch", async () => {
    const urls: string[] = [];
    const fetchImpl = (u: string) => {
      urls.push(u);
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ data: [{ id: "1" }], meta: {} }) });
    };
    const r = await baseline.fetchSessionObservations("s", { baseUrl: "http://x", publicKey: "p", secretKey: "k", fetchImpl, type: "TOOL", fields: "core,io" });
    assert.equal(r.length, 1);
    assert.match(urls[0], /type=TOOL/);
    assert.match(urls[0], /fields=core%2Cio/);
  });
});

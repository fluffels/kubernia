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

type Ev = { ts: string; tool: string; input: Record<string, unknown>; resultChars: number; agent?: string | null };
type Metrics = {
  brainReads: number;
  brainPages: number;
  brainReadTokens: number;
  searchCalls: number;
  searchTokens: number;
  callsBeforeFirstEdit: number | null;
  brainWrites: number;
  prBrain: { pages: number; additions: number; deletions: number } | null;
};
type Obs = { id?: string; type: string; startTime: string; name?: string; input?: unknown; metadata?: Record<string, unknown> };

/** Modul-Form EINMAL deklarieren und genau hier casten. */
const bm = bmModule as {
  isBrainPage: (p?: string) => boolean;
  classifyShell: (command: string, tool?: string) => { brainReads: string[]; search: boolean };
  toolEventsFromTranscript: (jsonlOderZeilen: string | object[], agent?: string | null) => Ev[];
  toolEventsFromLangfuse: (obs: Obs[], agentOf?: (o: Obs) => string | null) => Ev[];
  pflegeMarker: (ev: Ev) => "start" | "ende" | null;
  pflegeIntervals: (events: Ev[]) => { intervals: { agent: string | null; from: string; to: string }[]; unpaired: number };
  brainMetrics: (events?: Ev[], prFiles?: { path: string; additions?: number; deletions?: number }[] | null) => Metrics;
  transkriptZeilen: (text: string) => object[];
  mitEingabe: (meta: Obs[], io: { id?: string; input?: unknown }[]) => Obs[];
  EINGABE_TOOLS: string[];
};
const baseline = baselineModule as {
  renderMarkdown: (s: object, loop?: object) => string;
  summarize: (run: object, bounds?: object, prFiles?: object[] | null) => { brain?: Metrics & { rechercheTokens: number } };
  fensterLage: (ts: string, bounds?: object) => string;
  ladeLangfuseSession: (id: string, o: object) => Promise<{ events: Ev[] }>;
  callsFromTranscript: (textOderZeilen: string | object[]) => { calls: unknown[]; questions: number };
  fetchSessionObservations: (id: string, o: object) => Promise<unknown[]>;
};
const { isBrainPage, classifyShell, toolEventsFromTranscript, toolEventsFromLangfuse, brainMetrics, pflegeMarker, pflegeIntervals } = bm;

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
  test("Env-Präfix und Zuweisungen: `LANG=C cat …` liest, eine reine Zuweisung ist kein Kommando (#1322 Z4)", () => {
    assert.equal(classifyShell("LANG=C cat docs/a.md").brainReads.length, 1);
    assert.equal(classifyShell("A=1 B=2 grep x docs/a.md").search, true);
    assert.deepEqual(classifyShell("X=docs/a.md"), { brainReads: [], search: false });
    assert.equal(classifyShell(String.raw`cat <<EOF
$(cat docs/a.md)
EOF`).brainReads.length, 1, "Ersetzung im Heredoc");
  });
  test("PowerShell: Klammern und Quotes um Kommando und Pfad (#1322 Z4)", () => {
    assert.equal(classifyShell("(Get-Content docs/a.md)", "PowerShell").brainReads.length, 1);
    assert.equal(classifyShell("$t = (Get-Content 'docs/a.md' -Raw)", "PowerShell").brainReads.length, 1);
    assert.equal(classifyShell('Get-Content "docs/a.md"', "PowerShell").brainReads.length, 1);
    assert.deepEqual(classifyShell("$t = (Get-Date)", "PowerShell"), { brainReads: [], search: false });
  });
  test("git show <rev>:docs/x.md zählt als Lesezugriff, mit globalen Optionen und Env-Präfix (#1331)", () => {
    for (const c of [
      "git show origin/main:docs/a.md",
      "MSYS_NO_PATHCONV=1 git show origin/main:docs/a.md",
      "git -C /r/wt show HEAD:docs/module/x.md",
      "git --no-pager -c core.quotepath=off show origin/main:docs/a.md | head",
      "git show --stat origin/main:docs/a.md",
    ])
      assert.deepEqual(classifyShell(c).brainReads, [c.includes("module") ? "docs/module/x.md" : "docs/a.md"], c);
    assert.deepEqual(classifyShell("git show origin/main:docs/a.md origin/main:docs/b.md").brainReads, ["docs/a.md", "docs/b.md"]);
    assert.equal(classifyShell("git show origin/main:docs/a.md", "PowerShell").brainReads.length, 1);
  });
  test("git show zählt nicht, wenn es keine Brain-Seite liest (#1331)", () => {
    for (const c of ["git show HEAD:src/x.ts", "git show --stat", "git show HEAD", "git status docs/a.md", "git log origin/main:docs/a.md", "git show C:/r/docs/a.md", "git show origin/main:docs/a.ts"])
      assert.deepEqual(classifyShell(c), { brainReads: [], search: false }, c);
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
    const m = brainMetrics([
      ev(T(0), "Read", { file_path: "docs/a.md" }, 400),
      ev(T(1), "Bash", { command: "cat docs/b.md" }, 800),
      ev(T(2), "Grep", { pattern: "x" }, 40),
      ev(T(3), "Edit", { file_path: "C:\\Users\\x\\AppData\\Local\\Temp\\s.txt" }),
      ev(T(4), "Edit", { file_path: "src/a.ts" }),
      ev(T(5), "Write", { file_path: "docs/c.md" }),
      ev(T(6), "Write", { file_path: "src/b.ts" }),
    ]);
    assert.equal(m.brainReads, 2);
    assert.equal(m.brainPages, 2);
    assert.equal(m.brainReadTokens, 300);
    assert.equal(m.searchCalls, 1);
    assert.equal(m.searchTokens, 10);
    assert.equal(m.callsBeforeFirstEdit, 4);
    assert.equal(m.brainWrites, 1);
  });
  test("kein Edit → null; leerer Lauf wirft nicht; die Funktion kennt kein Fenster mehr", () => {
    assert.equal(brainMetrics([ev(T(0), "Read", { file_path: "src/a.ts" })]).callsBeforeFirstEdit, null);
    const z = brainMetrics();
    assert.deepEqual([z.brainReads, z.searchCalls, z.brainWrites, z.prBrain], [0, 0, 0, null]);
    assert.equal(brainMetrics([ev("2020-01-01T00:00:00Z", "Read", { file_path: "docs/a.md" })]).brainReads, 1, "kein Filter nach Zeit");
    assert.equal("rechercheTokens" in z, false, "Recherche-Tokens rechnet summarize");
  });
  test("PR-Seiten nur unter docs/", () => {
    const m = brainMetrics([], [{ path: "docs/a.md", additions: 5, deletions: 1 }, { path: "src/x.ts", additions: 9, deletions: 9 }]);
    assert.deepEqual(m.prBrain, { pages: 1, additions: 5, deletions: 1 });
    assert.equal(brainMetrics([], [{ path: "src/x.ts" }]).prBrain?.pages, 0);
  });
});

describe("renderMarkdown mit Projekt-Brain", () => {
  const summary = {
    rows: [], total: { calls: 0, input: 0, cacheWrite: 0, cacheRead: 0, output: 0, cost: 0 }, hasCost: false,
    reviewRounds: 1, cacheRebuilds: null, questions: 0, unpriced: 0, costParts: null, medianContext: {}, sockel: {},
  };
  test("Zeile erscheint mit brain, fehlt ohne", () => {
    const brain = { ...brainMetrics([ev("2026-10-01T10:00:00Z", "Read", { file_path: "docs/a.md" }, 400)], null), rechercheTokens: 0 };
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
  test("Transkript-Adapter mit geparsten Zeilen liefert dasselbe wie mit Text (Zeilen werden nur einmal geparst)", () => {
    const text = [
      JSON.stringify({ type: "assistant", timestamp: T(0), message: { id: "m1", model: "x", usage: { input_tokens: 3, output_tokens: 2 }, content: [use("a", "Read", { file_path: "docs/a.md" })] } }),
      "{abgeschnitten",
      "",
      JSON.stringify({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "a", content: "1234" }] } }),
    ].join("\n");
    const zeilen = bm.transkriptZeilen(text);
    assert.equal(zeilen.length, 2, "leere und kaputte Zeile entfallen");
    assert.deepEqual(toolEventsFromTranscript(zeilen), toolEventsFromTranscript(text));
    assert.deepEqual(baseline.callsFromTranscript(zeilen), baseline.callsFromTranscript(text));
    assert.equal(baseline.callsFromTranscript(zeilen).calls.length, 1);
  });
  test("summarize filtert das Ticket-Fenster halboffen (from zählt, mergedAt nicht) und reicht PR-Dateien durch; ohne events kein brain", () => {
    const events = [
      ev(T(0), "Read", { file_path: "docs/a.md" }),
      ev(T(1), "Read", { file_path: "docs/b.md" }),
      ev(T(3), "Read", { file_path: "docs/c.md" }),
      ev(T(4), "Read", { file_path: "docs/d.md" }),
    ];
    const s = baseline.summarize({ calls: [], events }, { from: T(1), mergedAt: T(3) }, [{ path: "docs/x.md", additions: 2, deletions: 1 }]);
    assert.equal(s.brain?.brainReads, 1, "vor from und ab mergedAt zählt nicht");
    assert.equal(s.brain?.brainPages, 1);
    assert.equal(s.brain?.prBrain?.pages, 1);
    assert.equal(baseline.summarize({ calls: [] }).brain, undefined);
  });
  test("fensterLage: vor, ticket (halboffen), nachlauf; ohne Grenzen alles ticket", () => {
    const b = { from: T(1), mergedAt: T(3) };
    assert.deepEqual([T(0), T(1), T(2), T(3), T(4)].map((t) => baseline.fensterLage(t, b)), ["vor", "ticket", "ticket", "nachlauf", "nachlauf"]);
    assert.equal(baseline.fensterLage(T(0)), "ticket");
  });
  test("Events werden nach Zeit sortiert (Subagenten-Events kommen hinten an)", () => {
    const m = brainMetrics([ev(T(3), "Edit", { file_path: "src/a.ts" }), ev(T(0), "Read", {}), ev(T(1), "Read", {}), ev(T(2), "Read", {})]);
    assert.equal(m.callsBeforeFirstEdit, 3);
  });
  test("grep auf eine Brain-Seite ist Suche, kein Lesen", () => {
    assert.deepEqual(classifyShell("grep foo docs/x.md"), { brainReads: [], search: true });
  });
  test("AST-Weg: Quotes und Substitution; PowerShell mit &&", () => {
    assert.equal(classifyShell('cat "docs/a.md"').brainReads.length, 1);
    assert.equal(classifyShell("x=$(cat docs/a.md)").brainReads.length, 1);
    assert.equal(classifyShell("cd x && cat docs/a.md", "PowerShell").brainReads.length, 1);
  });
  test("Schreibzugriff per notebook_path/MultiEdit; Mehrfach-Pfade zählen einzeln", () => {
    const m = brainMetrics([
      ev(T(2), "Bash", { command: "cat docs/a.md docs/b.md" }),
      ev(T(3), "MultiEdit", { file_path: "docs/z.md" }),
      ev(T(4), "NotebookEdit", { notebook_path: "docs/n.md" }),
    ]);
    assert.deepEqual([m.brainReads, m.brainPages, m.brainWrites], [2, 2, 2]);
  });
  test("dieselbe Seite per absolutem, Worktree- und Shell-Pfad ist eine Seite", () => {
    const m = brainMetrics([
      ev(T(0), "Read", { file_path: "C:\\r\\docs\\a.md" }),
      ev(T(1), "Bash", { command: "cat C:/r/docs/a.md" }),
      ev(T(2), "Read", { file_path: "C:\\dev\\x\\docs\\a.md" }),
      ev(T(3), "Read", { file_path: "C:\\dev\\x\\.claude\\worktrees\\kq-1\\docs\\a.md" }),
    ]);
    assert.deepEqual([m.brainReads, m.brainPages], [4, 1]);
  });
  test("Seitenschlüssel: letztes docs/-Segment, auch bei Elternordner docs, und Groß-/Kleinschreibung (#1322 Z8/Z9)", () => {
    const eltern = brainMetrics([
      ev(T(0), "Read", { file_path: "C:/docs/kubernia/docs/x.md" }),
      ev(T(1), "Read", { file_path: "docs/x.md" }),
    ]);
    assert.deepEqual([eltern.brainReads, eltern.brainPages], [2, 1], "Elternordner docs trennt nicht von der Seite");
    const gross = brainMetrics([
      ev(T(0), "Read", { file_path: "C:\\Dev\\X\\Docs\\Model-Routing.md" }),
      ev(T(1), "Read", { file_path: "docs/model-routing.md" }),
    ]);
    assert.deepEqual([gross.brainReads, gross.brainPages], [2, 1], "Windows-Schreibweise ist dieselbe Seite");
    const zwei = brainMetrics([ev(T(0), "Read", { file_path: "docs/a.md" }), ev(T(1), "Read", { file_path: "docs/b.md" })]);
    assert.equal(zwei.brainPages, 2, "verschiedene Seiten bleiben verschieden");
  });
  test("summarize rechnet die Recherche-Tokens aus den Phasenzeilen selbst", () => {
    const call = { ts: T(0), model: "m", input: 7, cacheWrite: 0, cacheRead: 0, output: 0, subagent: { id: "s", agentType: "Explore", description: "x" } };
    assert.equal(baseline.summarize({ calls: [call], events: [] }).brain?.rechercheTokens, 7);
    const umsetzung = { ...call, input: 100, subagent: { id: "u", agentType: "kubernia-umsetzer", description: "u" } };
    assert.equal(baseline.summarize({ calls: [call, umsetzung], events: [] }).brain?.rechercheTokens, 7, "nur die Recherche-Phase");
    const spaet = { ...call, ts: T(5) };
    assert.equal(baseline.summarize({ calls: [spaet], events: [] }, { mergedAt: T(3) }).brain?.rechercheTokens, 0, "Nachlauf zählt nicht");
  });
  test("kaputter Langfuse-Input wirft nicht", () => {
    const e = toolEventsFromLangfuse([{ type: "TOOL", startTime: T(0), input: "{kaputt", metadata: { tool_name: "Read" } }]);
    assert.deepEqual(e[0].input, {});
  });
  test("Report-Zeile vollständig", () => {
    const brain = {
      ...brainMetrics([ev(T(0), "Grep", {}, 40), ev(T(1), "Write", { file_path: "docs/n.md" })], [{ path: "docs/n.md", additions: 3, deletions: 2 }]),
      rechercheTokens: 5,
    };
    const out = baseline.renderMarkdown({ rows: [], total: { calls: 0, input: 0, cacheWrite: 0, cacheRead: 0, output: 0, cost: 0 }, hasCost: false, reviewRounds: 0, cacheRebuilds: null, questions: 0, unpriced: 0, costParts: null, medianContext: {}, sockel: {}, brain }, {});
    assert.match(out, /Suche 1 Calls \(≈ 10 Tokens\) · Recherche-Subagenten 5 Tokens · Calls bis erster Edit 1 · Brain-Pflege 1 Schreibzugriffe, PR 1 Seiten \(\+3\/−2\)/);
  });
  test("fetchSessionObservations reicht type, name und fields durch", async () => {
    const urls: string[] = [];
    const fetchImpl = (u: string) => {
      urls.push(u);
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ data: [{ id: "1" }], meta: {} }) });
    };
    const r = await baseline.fetchSessionObservations("s", { baseUrl: "http://x", publicKey: "p", secretKey: "k", fetchImpl, type: "TOOL", name: "Tool: Read", fields: "core,io" });
    assert.equal(r.length, 1);
    assert.match(urls[0], /type=TOOL/);
    assert.match(urls[0], /name=Tool%3A\+Read/);
    assert.match(urls[0], /fields=core%2Cio/);
    await baseline.fetchSessionObservations("s", { baseUrl: "http://x", publicKey: "p", secretKey: "k", fetchImpl });
    assert.doesNotMatch(urls[1], /name=/, "ohne name kein Filter");
  });
});

describe("Langfuse in zwei Stufen: mitEingabe und EINGABE_TOOLS (#1322 Z6)", () => {
  const T = (n: number) => `2026-10-01T10:00:0${n}Z`;
  test("die Eingabe wird per id an die Metadaten-Observation gehängt; fehlendes und verwaistes io sind harmlos", () => {
    const meta = [
      { id: "1", type: "TOOL", startTime: T(0), metadata: { tool_name: "Read", output_meta: { orig_len: 400 } } },
      { id: "2", type: "TOOL", startTime: T(1), metadata: { tool_name: "Grep" } },
      { id: "3", type: "TOOL", startTime: T(2), metadata: { tool_name: "Bash" } },
    ];
    const io = [{ id: "1", input: { file_path: "docs/a.md" } }, { id: "verwaist", input: { command: "x" } }];
    const e = toolEventsFromLangfuse(bm.mitEingabe(meta, io));
    assert.deepEqual(e.map((x) => [x.tool, x.input, x.resultChars]), [["Read", { file_path: "docs/a.md" }, 400], ["Grep", {}, 0], ["Bash", {}, 0]]);
    assert.equal(brainMetrics(e).brainReads, 1);
    assert.deepEqual(bm.mitEingabe(undefined as never, undefined as never), []);
    assert.equal(bm.mitEingabe(meta, undefined as never).length, 3);
  });
  test("EINGABE_TOOLS nennt genau die Tools, deren Eingabe die Kennzahlen lesen", () => {
    assert.deepEqual([...bm.EINGABE_TOOLS].sort(), ["Bash", "Edit", "MultiEdit", "NotebookEdit", "PowerShell", "Read", "Write"]);
  });
});

describe("ladeLangfuseSession: zwei Stufen mit tatsächlichen Span-Namen (#1322 Z6)", () => {
  const T = (n: number) => `2026-10-01T10:00:0${n}Z`;
  type Q = { sessionId: string | null; type: string | null; name: string | null; fields: string | null };
  // Mock, der `type` und `name` EXAKT filtert wie die v2-API; Datei-Tools tragen den Bereichs-Qualifier des Hooks.
  const alle = [
    { id: "g1", type: "GENERATION", name: "Claude", startTime: T(0), usageDetails: { input: 1, output: 1 }, model: "m" },
    { id: "r1", type: "TOOL", name: "Tool: Read [Kubernia-Doku]", startTime: T(1), metadata: { tool_name: "Read", output_meta: { orig_len: 400 } }, input: { file_path: "docs/a.md" } },
    { id: "b1", type: "TOOL", name: "Tool: Bash", startTime: T(2), metadata: { tool_name: "Bash", output_meta: { orig_len: 8 } }, input: { command: "cat docs/b.md" } },
    { id: "g2", type: "TOOL", name: "Tool: Grep", startTime: T(3), metadata: { tool_name: "Grep" }, input: { pattern: "x" } },
  ];
  const mock = (anfragen: Q[]) => (url: string) => {
    const q = new URL(url).searchParams;
    anfragen.push({ sessionId: q.get("sessionId"), type: q.get("type"), name: q.get("name"), fields: q.get("fields") });
    const treffer = alle.filter((o) => (!q.get("type") || o.type === q.get("type")) && (!q.get("name") || o.name === q.get("name")));
    const mitIo = (q.get("fields") ?? "").split(",").includes("io");
    const daten = treffer.map((o) => (mitIo ? o : { ...o, input: undefined }));
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ data: daten, meta: {} }) });
  };
  const lade = baseline.ladeLangfuseSession;

  test("Datei-Tools mit Qualifier bekommen ihre Eingabe: Brain-Lesezugriffe per Read und per Bash werden gezählt", async () => {
    const anfragen: Q[] = [];
    const part = await lade("s1", { baseUrl: "http://x", publicKey: "p", secretKey: "k", fetchImpl: mock(anfragen) });
    const m = brainMetrics(part.events);
    assert.deepEqual([m.brainReads, m.brainPages, m.brainReadTokens], [2, 2, 100 + 2], "Read (400 Zeichen) und cat (8 Zeichen)");
    const stufe2 = anfragen.filter((a) => a.name);
    assert.deepEqual(stufe2.map((a) => a.name).sort(), ["Tool: Bash", "Tool: Read [Kubernia-Doku]"], "nur Tools aus EINGABE_TOOLS, mit dem echten Namen");
    assert.ok(stufe2.every((a) => a.fields === "core,io" && a.type === "TOOL" && a.sessionId === "s1"));
    assert.ok(anfragen.filter((a) => !a.name && a.type === "TOOL").every((a) => a.fields === "core,basic,metadata"), "Stufe 1 holt kein io");
  });

  test("ohne Eingabe-Tools gibt es keine zweite Stufe; Grep zählt ohne Eingabe", async () => {
    const anfragen: Q[] = [];
    const nurGrep = [alle[3]];
    const fetchImpl = (url: string) => {
      anfragen.push({ sessionId: null, type: new URL(url).searchParams.get("type"), name: new URL(url).searchParams.get("name"), fields: null });
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ data: new URL(url).searchParams.get("type") === "TOOL" ? nurGrep : [], meta: {} }) });
    };
    const part = await lade("s", { baseUrl: "http://x", publicKey: "p", secretKey: "k", fetchImpl });
    assert.equal(anfragen.filter((a) => a.name).length, 0);
    assert.equal(brainMetrics(part.events).searchCalls, 1);
  });

  test("Namens-Fallback: ein Span ohne metadata.tool_name wird über den Span-Namen als Eingabe-Tool erkannt (#1331)", async () => {
    const ohneMeta = [
      { id: "r1", type: "TOOL", name: "Tool: Read [Kubernia-Doku]", startTime: T(1), metadata: { output_meta: { orig_len: 400 } }, input: { file_path: "docs/a.md" } },
      { id: "x1", type: "TOOL", name: "Tool: Grep", startTime: T(2), metadata: {}, input: { pattern: "x" } },
    ];
    const namen: (string | null)[] = [];
    const fetchImpl = (url: string) => {
      const q = new URL(url).searchParams;
      if (q.get("name")) namen.push(q.get("name"));
      const daten = q.get("type") === "TOOL" ? ohneMeta.filter((o) => !q.get("name") || o.name === q.get("name")) : [];
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ data: daten, meta: {} }) });
    };
    const part = await lade("s", { baseUrl: "http://x", publicKey: "p", secretKey: "k", fetchImpl });
    assert.deepEqual(namen, ["Tool: Read [Kubernia-Doku]"], "Stufe 2 fragt nur das Eingabe-Tool, erkannt am Namen ohne Präfix und Qualifier");
    const m = brainMetrics(part.events);
    assert.deepEqual([m.brainReads, m.searchCalls], [1, 1]);
  });

  test("Hauptagent ohne Subagent-Span: Events und Calls tragen den Session-Schlüssel (#1331)", async () => {
    const daten = [
      { id: "g1", type: "GENERATION", name: "Claude", startTime: T(1), usageDetails: { input: 1, output: 1 }, model: "m" },
      { id: "b1", type: "TOOL", name: "Tool: Bash", startTime: T(0), metadata: { tool_name: "Bash" }, input: { command: 'echo "pflege: start #1"' } },
    ];
    const fetchImpl = (url: string) => {
      const q = new URL(url).searchParams;
      const treffer = daten.filter((o) => (!q.get("type") || o.type === q.get("type")) && (!q.get("name") || o.name === q.get("name")));
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ data: treffer, meta: {} }) });
    };
    const part = (await lade("sess-9", { baseUrl: "http://x", publicKey: "p", secretKey: "k", fetchImpl })) as unknown as { events: Ev[]; calls: { session?: string }[] };
    assert.deepEqual(part.events.map((e) => e.agent), ["main:sess-9"]);
    assert.deepEqual(part.calls.map((c) => c.session), ["sess-9"]);
  });

  test("kaputte Antwort der zweiten Stufe: der Fehler steigt auf statt leerer Zahlen", async () => {
    let n = 0;
    const fetchImpl = (url: string) => {
      n += 1;
      const q = new URL(url).searchParams;
      if (q.get("name")) return Promise.resolve({ ok: false, status: 500, text: () => Promise.resolve("kaputt") });
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ data: q.get("type") === "TOOL" ? alle.slice(1, 2) : [], meta: {} }) });
    };
    await assert.rejects(lade("s", { baseUrl: "http://x", publicKey: "p", secretKey: "k", fetchImpl }), /Langfuse 500/);
    assert.ok(n >= 3);
  });
});

describe("Pflege-Marker (#1099)", () => {
  const T = (n: number) => `2026-10-01T10:00:0${n}Z`;
  const sh = (command: string, tool = "Bash", agent: string | null = null, ts = T(0)): Ev => ({ ...ev(ts, tool, { command }), agent });
  test("start/ende per echo, Quotes und angehängt", () => {
    assert.equal(pflegeMarker(sh('echo "pflege: start #1"')), "start");
    assert.equal(pflegeMarker(sh("echo 'pflege: ende #1'")), "ende");
    assert.equal(pflegeMarker(sh('git status && echo "pflege: start #1"')), "start");
    assert.equal(pflegeMarker(sh("echo pflege: ende #1")), "ende");
    assert.equal(pflegeMarker(sh('echo "Pflege: START #1"')), "start");
  });
  test("PowerShell echo / Write-Output", () => {
    assert.equal(pflegeMarker(sh('echo "pflege: start #1"', "PowerShell")), "start");
    assert.equal(pflegeMarker(sh('Write-Output "pflege: ende #1"', "PowerShell")), "ende");
  });
  test("Negativ: kein echo, Kunstwort, anderes Tool, Text nur in Argument eines anderen Kommandos", () => {
    assert.equal(pflegeMarker(sh('grep "pflege: start" x')), null);
    assert.equal(pflegeMarker(sh('echo "pflege: startklar"')), null);
    assert.equal(pflegeMarker(sh('echo "kein marker"')), null);
    assert.equal(pflegeMarker(sh('git commit -m "echo pflege: start"')), null);
    assert.equal(pflegeMarker({ ...ev(T(0), "Read", { command: 'echo "pflege: start #1"' }) }), null);
    assert.equal(pflegeMarker(ev(T(0), "Bash", {})), null);
  });
  test("Intervalle: je Agent verschränkt gepaart", () => {
    const e = [
      sh('echo "pflege: start #1"', "Bash", "a", T(1)),
      sh('echo "pflege: start #1"', "Bash", "b", T(2)),
      sh('echo "pflege: ende #1"', "Bash", "a", T(3)),
      sh('echo "pflege: ende #1"', "Bash", "b", T(4)),
    ];
    const r = pflegeIntervals(e);
    assert.deepEqual(r.intervals, [{ agent: "a", from: T(1), to: T(3) }, { agent: "b", from: T(2), to: T(4) }]);
    assert.equal(r.unpaired, 0);
  });
  test("Start-Start-Ende: zweiter Start ersetzt, der erste zählt ungepaart", () => {
    const r = pflegeIntervals([sh('echo "pflege: start"', "Bash", null, T(1)), sh('echo "pflege: start"', "Bash", null, T(2)), sh('echo "pflege: ende"', "Bash", null, T(3))]);
    assert.deepEqual(r.intervals, [{ agent: null, from: T(2), to: T(3) }]);
    assert.equal(r.unpaired, 1);
  });
  test("Ende ohne Start und offener Start sind ungepaart; Eingabe unsortiert", () => {
    assert.deepEqual(pflegeIntervals([sh('echo "pflege: ende"')]), { intervals: [], unpaired: 1 });
    assert.deepEqual(pflegeIntervals([sh('echo "pflege: start"')]), { intervals: [], unpaired: 1 });
    const r = pflegeIntervals([sh('echo "pflege: ende"', "Bash", null, T(5)), sh('echo "pflege: start"', "Bash", null, T(1))]);
    assert.equal(r.intervals.length, 1);
    assert.equal(r.unpaired, 0);
  });
  test("Event-Adapter setzen agent (Default null)", () => {
    const line = JSON.stringify({ type: "assistant", timestamp: T(0), message: { content: [{ type: "tool_use", id: "a", name: "Bash", input: {} }] } });
    assert.equal(toolEventsFromTranscript(line)[0].agent, null);
    assert.equal(toolEventsFromTranscript(line, "sub.jsonl")[0].agent, "sub.jsonl");
    const obs: Obs = { id: "t1", type: "TOOL", startTime: T(0), input: {}, metadata: { tool_name: "Bash" } };
    assert.equal(toolEventsFromLangfuse([obs])[0].agent, null);
    assert.equal(toolEventsFromLangfuse([obs], (o) => `x-${o.id}`)[0].agent, "x-t1");
  });
});

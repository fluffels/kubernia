/* Tool-Fehler nach Art und Wiederlesen je Agent (#1379 Z4/Z6): pure Auswertung über Tool-Events. */
import { describe, test } from "vitest";
import assert from "node:assert/strict";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as tmModule from "../scripts/tool-metriken.mjs";

type Ev = { ts?: string; tool: string; input: Record<string, unknown>; resultChars: number; agent?: string | null; fehler?: string | null };
type Lesen = { reads: number; abschnittsweise: number; voll: { n: number; tokens: number }; gezielt: { n: number; tokens: number }; top: { datei: string; n: number; tokens: number }[] };
const tm = tmModule as {
  fehlerArt: (t?: string | null) => string | null;
  fehlerArten: (e: Ev[]) => Record<string, number>;
  wiederlesen: (e: Ev[]) => Lesen;
  pruefLaeufe: (e: Ev[]) => { voll: number; gezielt: number };
};

const rd = (file: string, extra: Record<string, unknown> = {}, agent = "a", chars = 4000, fehler: string | null = null): Ev => ({
  tool: "Read",
  input: { file_path: file, ...extra },
  resultChars: chars,
  agent,
  fehler,
});
const ed = (file: string, agent = "a", tool = "Edit"): Ev => ({ tool, input: { file_path: file }, resultChars: 0, agent });

describe("fehlerArt", () => {
  test("klassifiziert die echten Präfixe", () => {
    const f = tm.fehlerArt;
    assert.equal(f("File content (31000 tokens) exceeds maximum allowed tokens (25000). Use offset"), "zuGross");
    assert.equal(f("Exit code 1\nfoo"), "exit");
    assert.equal(f("PreToolUse:Bash hook error: [x]: Blocked"), "hook");
    assert.equal(f("Blocked: sleep 100 followed by: echo hi"), "guard");
    assert.equal(f("<tool_use_error>Blocked: sleep 5</tool_use_error>"), "guard");
    assert.equal(f("Permission to use Bash has been denied"), "permission");
    assert.equal(f("Permission for this action was denied"), "permission");
    assert.equal(f("MCP error -32602: bad"), "sonst");
  });
  test("Negativfälle: leer und Treffer nur mitten im Text", () => {
    assert.equal(tm.fehlerArt(null), null);
    assert.equal(tm.fehlerArt(""), null);
    assert.equal(tm.fehlerArt(undefined), null);
    assert.equal(tm.fehlerArt("irgendwas Exit code 1 mitten drin"), "sonst");
    assert.equal(tm.fehlerArt("irgendwas Blocked: x"), "sonst");
  });
});

describe("fehlerArten", () => {
  test("zählt nur Events mit Fehlertext", () => {
    const e: Ev[] = [
      { tool: "Bash", input: {}, resultChars: 0, fehler: "Exit code 2" },
      { tool: "Bash", input: {}, resultChars: 0, fehler: "Blocked: sleep 1" },
      { tool: "Bash", input: {}, resultChars: 50, fehler: null },
      { tool: "Bash", input: { command: "echo Blocked: x" }, resultChars: 20 },
    ];
    assert.deepEqual(tm.fehlerArten(e), { exit: 1, guard: 1 });
    assert.deepEqual(tm.fehlerArten([]), {});
  });
});

describe("wiederlesen", () => {
  test("leer ergibt Nullen", () => {
    assert.deepEqual(tm.wiederlesen([]), { reads: 0, abschnittsweise: 0, voll: { n: 0, tokens: 0 }, gezielt: { n: 0, tokens: 0 }, top: [] });
  });
  test("zwei Agenten, dieselbe Datei: kein Wiederlesen", () => {
    const r = tm.wiederlesen([rd("/a/x.md", {}, "l1"), rd("/a/x.md", {}, "l2")]);
    assert.equal(r.voll.n + r.gezielt.n, 0);
    assert.equal(r.reads, 2);
  });
  test("Abschnitte ohne Lücke und Überlappung zählen nicht", () => {
    const r = tm.wiederlesen([rd("/p", { offset: 1, limit: 100 }), rd("/p", { offset: 101, limit: 100 }), rd("/p", { offset: 201, limit: 100 })]);
    assert.equal(r.voll.n + r.gezielt.n, 0);
    assert.equal(r.abschnittsweise, 3);
  });
  test("voll nach voll ist ein Voll-Wiederlesen", () => {
    const r = tm.wiederlesen([rd("/p"), rd("/p", {}, "a", 8000)]);
    assert.equal(r.voll.n, 1);
    assert.equal(r.voll.tokens, 2000);
    assert.equal(r.top[0].datei, "p");
  });
  test("offset/limit nach voll ist gezielt", () => {
    const r = tm.wiederlesen([rd("/p"), rd("/p", { offset: 10, limit: 5 })]);
    assert.equal(r.gezielt.n, 1);
    assert.equal(r.voll.n, 0);
  });
  test("nach eigenem Edit zählt es nicht, nach fremdem schon", () => {
    for (const tool of ["Edit", "Write", "MultiEdit"]) {
      assert.equal(tm.wiederlesen([rd("/p"), ed("/p", "a", tool), rd("/p")]).voll.n, 0, tool);
    }
    assert.equal(tm.wiederlesen([rd("/p"), ed("/p", "b"), rd("/p")]).voll.n, 1);
  });
  test("Read mit Fehler wird ignoriert", () => {
    const r = tm.wiederlesen([rd("/p", {}, "a", 0, "File content (9 tokens) exceeds maximum allowed tokens"), rd("/p")]);
    assert.equal(r.voll.n, 0);
    assert.equal(r.reads, 1);
  });
  test("Pfadvarianten sind dieselbe Datei; offset 0 wie 1", () => {
    assert.equal(tm.wiederlesen([rd("C:\\Dev\\X.md"), rd("c:/dev/x.md")]).voll.n, 1);
    assert.equal(tm.wiederlesen([rd("/p", { offset: 0, limit: 10 }), rd("/p", { offset: 1, limit: 10 })]).gezielt.n, 1);
  });
  test("Überlappung um genau eine Zeile zählt, ein Read nur mit limit ist gezielt", () => {
    assert.equal(tm.wiederlesen([rd("/p", { offset: 1, limit: 100 }), rd("/p", { offset: 100, limit: 100 })]).gezielt.n, 1);
    assert.equal(tm.wiederlesen([rd("/p"), rd("/p", { limit: 50 })]).gezielt.n, 1);
    assert.equal(tm.wiederlesen([rd("/p"), rd("/p", { limit: 50 })]).voll.n, 0);
  });
  test("abschnittsweise zählt nur Erst-Lesen, gezieltes Wiederlesen nicht", () => {
    const r = tm.wiederlesen([rd("/p", { offset: 1, limit: 10 }), rd("/p", { offset: 5, limit: 10 })]);
    assert.equal(r.abschnittsweise, 1);
    assert.equal(r.gezielt.n, 1);
  });
  test("Top 5 sortiert nach Anzahl, häufigste Datei zuerst", () => {
    const evs = [rd("/d/a.md"), rd("/d/a.md"), rd("/d/b.md"), rd("/d/b.md"), rd("/d/b.md"), rd("/d/b.md")];
    assert.deepEqual(tm.wiederlesen(evs).top.map((t) => [t.datei, t.n]), [["b.md", 3], ["a.md", 1]]);
  });
  test("Top 5 nach Anzahl", () => {
    const evs: Ev[] = [];
    for (let i = 0; i < 7; i++) evs.push(rd(`/d/f${i}.md`), rd(`/d/f${i}.md`));
    assert.equal(tm.wiederlesen(evs).top.length, 5);
  });
});

describe("pruefLaeufe (#1120)", () => {
  const z = tm.pruefLaeufe;
  const sh = (command: string, tool = "Bash", fehler: string | null = null): Ev => ({ tool, input: { command }, resultChars: 0, agent: "u", fehler });
  test("zählt volle Läufe in jeder Befehlsform", () => {
    const evs = [
      sh("npm run verify"),
      sh("cd x && npm run verify:kompakt 2>&1 | tail -5"),
      sh("npm run -s verify"),
      sh("npm run verify:full"),
      sh("npm run verify", "PowerShell"),
      sh("node scripts/verify-lauf.mjs"),
    ];
    assert.deepEqual(z(evs), { voll: 6, gezielt: 0 });
  });
  test("zählt npm mit Flag samt Wert vor run (--prefix, -C) und run-script", () => {
    const evs = [sh("npm --prefix C:/x/kq-1 run verify:kompakt"), sh("npm -C C:/x run-script verify"), sh("npm --prefix C:/x run verify:changed"), sh("npm --prefix C:/x run lint")];
    assert.deepEqual(z(evs), { voll: 2, gezielt: 1 });
  });
  test("zählt gezielte Läufe getrennt", () => {
    assert.deepEqual(z([sh("npm run verify:changed"), sh("node scripts/verify-lauf.mjs --changed"), sh("npm run verify", "PowerShell")]), { voll: 1, gezielt: 2 });
  });
  test("Negativ: verify:bundle, Text in Commit/echo und blockierte Events zählen nicht", () => {
    const evs = [
      sh("npm run verify:bundle"),
      sh('git commit -m "npm run verify grün"'),
      sh('echo "npm run verify"'),
      sh("npm run verify", "Bash", "Blocked: sleep"),
      sh("npm run verify", "Bash", "PreToolUse:Bash hook error: [x]: Blocked"),
      sh("npm run verify", "Bash", "Permission to use Bash has been denied"),
      sh("npm run lint"),
      sh("npm ci"),
      sh("npm --prefix C:/x/kq-1 ci"),
      sh("npm test"),
      sh("npm install"),
      { tool: "Read", input: { file_path: "npm run verify" }, resultChars: 0 },
    ];
    assert.deepEqual(z(evs), { voll: 0, gezielt: 0 });
  });
  test("Ein roter Lauf (Exit code 1) zählt", () => {
    assert.deepEqual(z([sh("npm run verify", "Bash", "Exit code 1\nfoo")]), { voll: 1, gezielt: 0 });
  });
});

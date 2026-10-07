/* Helfer `mermaidText` und `ganzzahlKonstante` der Doku-Generatoren (#1370). */
import { describe, test } from "vitest";
import assert from "node:assert/strict";
import { join } from "node:path";
import { fixture } from "./support/tmp-fixture";

// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as md from "../scripts/docs-gen/markdown.mjs";

const api = md as unknown as {
  mermaidText: (s: string) => string;
  ganzzahlKonstante: (root: string, datei: string, name: string) => string;
};

describe("mermaidText", () => {
  test("escaped #, &, Anführungszeichen, < und > als Entity-Codes", () => {
    assert.equal(api.mermaidText('a#b&c"d<e>f'), "a#35;b#amp;c#quot;d#lt;e#gt;f");
  });
  test("# wird zuerst ersetzt: erzeugte Entity-Codes werden nicht doppelt escaped", () => {
    assert.equal(api.mermaidText("&"), "#amp;");
    assert.ok(!api.mermaidText('"').includes("#35;"));
  });
  test("Zeilenumbrüche werden zu Leerzeichen, harmloser Text bleibt gleich", () => {
    assert.equal(api.mermaidText("a\r\nb"), "a b");
    assert.equal(api.mermaidText("Docker – Ö?"), "Docker – Ö?");
  });
});

describe("ganzzahlKonstante", () => {
  const f = (inhalt: string) => fixture({ "k.ts": inhalt });
  test("liest export const und const mit Semikolon oder Kommentar", () => {
    assert.equal(api.ganzzahlKonstante(f("export const MAX_X = 7;\n"), "k.ts", "MAX_X"), "7");
    assert.equal(api.ganzzahlKonstante(f("const MAX_X = 12 // Notiz\n"), "k.ts", "MAX_X"), "12");
  });
  test("wirft bei fehlender Datei, fehlender, doppelter oder nicht-literaler Konstante", () => {
    assert.throws(() => api.ganzzahlKonstante(f(""), "weg.ts", "MAX_X"), /weg\.ts nicht gefunden/);
    assert.throws(() => api.ganzzahlKonstante(f("const ANDERE = 1;\n"), "k.ts", "MAX_X"), /MAX_X fehlt in k\.ts/);
    assert.throws(() => api.ganzzahlKonstante(f("const MAX_X = 1;\nconst MAX_X = 2;\n"), "k.ts", "MAX_X"), /steht mehrfach/);
    assert.throws(() => api.ganzzahlKonstante(f("const MAX_X = 1 + 2;\n"), "k.ts", "MAX_X"), /kein Ganzzahl-Literal/);
  });
  test("Namen mit Regex-Sonderzeichen werden wörtlich genommen", () => {
    assert.throws(() => api.ganzzahlKonstante(f("const MAXAX = 1;\n"), "k.ts", "MAX.X"), /fehlt/);
  });
});

describe("leseJson (#1411)", () => {
  const leseJson = (md as unknown as { leseJson: (root: string, rel: string, was: string) => unknown }).leseJson;
  test("liest relativ und absolut", () => {
    const root = fixture({ "a.json": '{"x":1}' });
    assert.deepEqual(leseJson(root, "a.json", "Datei"), { x: 1 });
    assert.deepEqual(leseJson("/gibt/es/nicht", join(root, "a.json"), "Datei"), { x: 1 });
  });
  test("fehlende Datei und kaputtes JSON werfen mit sprechender Meldung", () => {
    const root = fixture({ "kaputt.json": "{ x" });
    assert.throws(() => leseJson(root, "weg.json", "Config"), /Config weg\.json nicht gefunden/);
    assert.throws(() => leseJson(root, "kaputt.json", "Config"), /kaputt\.json ist kein gültiges JSON/);
    assert.throws(() => leseJson(root, join(root, "kaputt.json"), "Config"), /kein gültiges JSON/);
  });
});

describe("kettenSchritte (#1411)", () => {
  const kettenSchritte = (md as unknown as { kettenSchritte: (s: Record<string, string>, c: string[], k: string) => string[] }).kettenSchritte;
  test("löst verschachtelte Ketten auf und zählt je Schritt einmal", () => {
    const scripts = { verify: "npm run a && npm run b && npm test && npm run a", b: "npm run c && npm run d" };
    assert.deepEqual(kettenSchritte(scripts, ["verify"], "verify"), ["a", "c", "d", "test"]);
  });
  test("Kettennamen aus `chains` werden weder aufgelöst noch als Schritt gezählt", () => {
    assert.deepEqual(kettenSchritte({ verify: "npm run a", full: "npm run verify && npm run z" }, ["verify", "full"], "full"), ["z"]);
  });
});

describe("pruefeMermaid: Größenwächter (#1411)", () => {
  const m = md as unknown as { pruefeMermaid: (t: string, was?: string) => void; mermaidBloecke: (t: string) => string[] };
  const front = "---\nconfig:\n  theme: base\n---\n";
  const kanten = (n: number) => Array.from({ length: n }, (_, i) => `  a${i} --> b${i}`).join("\n");
  test("Zeichengrenze 50_000 gilt, 50_001 wirft", () => {
    const rumpf = "sequenceDiagram\n";
    m.pruefeMermaid(rumpf + "x".repeat(50_000 - rumpf.length));
    assert.throws(() => m.pruefeMermaid(rumpf + "x".repeat(50_001 - rumpf.length)), /50001 Zeichen/);
  });
  test("Kantengrenze 500 gilt, 501 wirft (flowchart und graph)", () => {
    m.pruefeMermaid(`flowchart TB\n${kanten(500)}`);
    assert.throws(() => m.pruefeMermaid(`flowchart TB\n${kanten(501)}`), /501 Kanten/);
    assert.throws(() => m.pruefeMermaid(`graph LR\n${kanten(501)}`), /501 Kanten/);
  });
  test("alle Link-Enden zählen, auch gepunktet, dick und ohne Pfeil", () => {
    const sieben = ["a --> b", "a ==> b", "a .-> b", "a --- b", "a === b", "a -.- b", "a ~~~ b", "a --x b", "a --o b"].join("\n");
    assert.throws(() => m.pruefeMermaid(`flowchart TB\n${sieben}\n${kanten(492)}`), /501 Kanten/);
    m.pruefeMermaid(`flowchart TB\n${sieben}\n${kanten(491)}`);
  });
  test("das --- des Frontmatters zählt nicht; andere Diagrammarten werden nicht nach Kanten gezählt", () => {
    m.pruefeMermaid(`${front}flowchart TB\n${kanten(500)}`);
    assert.throws(() => m.pruefeMermaid(`${front}flowchart TB\n${kanten(501)}`), /501 Kanten/);
    m.pruefeMermaid(`sequenceDiagram\n${kanten(900)}`);
  });
  test("mermaidBloecke liefert nur geschlossene mermaid-Fences", () => {
    assert.deepEqual(m.mermaidBloecke("x\n```mermaid\nflowchart TB\n```\n```ts\nlet a;\n```\n```mermaid\noffen"), ["flowchart TB"]);
  });
});

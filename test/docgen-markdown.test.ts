/* Helfer `mermaidText` und `ganzzahlKonstante` der Doku-Generatoren (#1370). */
import { describe, test } from "vitest";
import assert from "node:assert/strict";
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

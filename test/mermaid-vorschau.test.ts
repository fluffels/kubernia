/* Mermaid-Vorschau (#1392): Block-Erkennung, Seite und der Pfadschutz des localhost-Servers sind pur und werden getestet;
 * das Rendern selbst prüft man einmal im Playwright-MCP (docs/agent-harness-faq.md). */
import { describe, expect, test } from "vitest";
import { fixture } from "./support/tmp-fixture";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as raw from "../scripts/mermaid-vorschau.mjs";

const M = raw as unknown as {
  mermaidBloecke: (md: string) => string[];
  vorschauHtml: (b: string[]) => string;
  mermaidDatei: (dist: string, url: string) => string | null;
};

describe("mermaidBloecke", () => {
  test("findet alle mermaid-Fences, auch mit Frontmatter und CRLF; andere Fences nicht", () => {
    const md = "```mermaid\r\n---\r\nconfig:\r\n  theme: base\r\n---\r\nflowchart TD\r\n  a-->b\r\n```\r\ntext\r\n```ts\r\nconst x = 1;\r\n```\r\n```mermaid\r\nflowchart LR\r\n```\r\n";
    const b = M.mermaidBloecke(md);
    expect(b).toHaveLength(2);
    expect(b[0]).toContain("theme: base");
    expect(b[0]).toContain("a-->b");
    expect(b[1]).toBe("flowchart LR");
  });
  test("kein Block, ungeschlossener Block: leer", () => {
    expect(M.mermaidBloecke("nur Text")).toEqual([]);
    expect(M.mermaidBloecke("```mermaid\nflowchart TD")).toEqual([]);
  });
});

describe("vorschauHtml", () => {
  test("je Block eine helle und eine dunkle Fläche, Code wird escaped", () => {
    const h = M.vorschauHtml(["a<b & c"]);
    expect(h.match(/class="hell"/g)).toHaveLength(1);
    expect(h.match(/class="dunkel"/g)).toHaveLength(1);
    expect(h).toContain("a&lt;b &amp; c");
    expect(h).not.toContain("a<b & c");
  });
  test("ohne Blöcke ein Hinweis statt leerer Seite", () => {
    expect(M.vorschauHtml([])).toContain("Keine mermaid-Blöcke gefunden");
  });
});

describe("mermaidDatei: Pfadschutz", () => {
  test("liefert Dateien unter dem Ordner, nichts außerhalb und nichts Fehlendes", () => {
    const root = fixture({ "dist/a.mjs": "x", "geheim.txt": "y" });
    const dist = `${root}/dist`;
    expect(M.mermaidDatei(dist, "/mermaid/a.mjs")).toMatch(/a\.mjs$/);
    expect(M.mermaidDatei(dist, "/mermaid/..%2fgeheim.txt")).toBeNull();
    expect(M.mermaidDatei(dist, "/mermaid/../geheim.txt")).toBeNull();
    expect(M.mermaidDatei(dist, "/mermaid/fehlt.mjs")).toBeNull();
    expect(M.mermaidDatei(dist, "/mermaid/")).toBeNull();
  });
});

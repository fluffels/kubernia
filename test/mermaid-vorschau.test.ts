/* Mermaid-Vorschau (#1392): Block-Erkennung, Seite und der Pfadschutz des localhost-Servers sind pur und werden getestet;
 * das Rendern selbst prüft man einmal im Playwright-MCP (docs/agent-harness-faq.md). */
import { describe, expect, test } from "vitest";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { fixture } from "./support/tmp-fixture";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as raw from "../scripts/mermaid-vorschau.mjs";

const M = raw as unknown as {
  mermaidBloecke: (md: string) => string[];
  vorschauHtml: (b: string[]) => string;
  mermaidDatei: (dist: string, url: string) => string | null;
  unterhalb: (basis: string, pfad: string) => string | null;
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
  test("~~~mermaid und 4-Backtick-Fences werden erkannt, ein innerer ```-Block schließt den äußeren nicht (Z5c)", () => {
    expect(M.mermaidBloecke("~~~mermaid\nflowchart TD\n~~~")).toEqual(["flowchart TD"]);
    expect(M.mermaidBloecke("````mermaid\nflowchart TD\n```\nB-->C\n````")).toEqual(["flowchart TD\n```\nB-->C"]);
    expect(M.mermaidBloecke("```mermaid\nflowchart TD\n~~~\nx\n```")).toEqual(["flowchart TD\n~~~\nx"]);
  });
  test("ein mermaid-Beispiel innerhalb eines äußeren Fences zählt nicht als Block (Z5c)", () => {
    expect(M.mermaidBloecke("````md\n```mermaid\nflowchart TD\n```\n````")).toEqual([]);
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
    const root = fixture({ "dist/a.mjs": "x", "dist-evil/b.mjs": "z", "geheim.txt": "y" });
    const dist = `${root}/dist`;
    expect(M.mermaidDatei(dist, "/mermaid/../dist-evil/b.mjs")).toBeNull(); // Geschwister mit gleichem Präfix
    expect(M.mermaidDatei(dist, "/mermaid/a.mjs")).toMatch(/a\.mjs$/);
    expect(M.mermaidDatei(dist, "/mermaid/..%2fgeheim.txt")).toBeNull();
    expect(M.mermaidDatei(dist, "/mermaid/../geheim.txt")).toBeNull();
    expect(M.mermaidDatei(dist, "/mermaid/fehlt.mjs")).toBeNull();
    expect(M.mermaidDatei(dist, "/mermaid/")).toBeNull();
    expect(M.mermaidDatei(dist, "/mermaid/%E0")).toBeNull(); // kaputte Prozent-Kodierung
  });
});

describe("unterhalb: Pfad bleibt im Ordner (#1663)", () => {
  test("Pfade im Ordner und der Ordner selbst gelten, Ausbruch und Geschwister nicht", () => {
    const root = fixture({ "repo/docs/a.md": "x", "repo-fremd/b.md": "y" });
    const repo = `${root}/repo`;
    expect(M.unterhalb(repo, `${repo}/docs/a.md`)).toMatch(/a\.md$/);
    expect(M.unterhalb(repo, repo)).not.toBeNull();
    expect(M.unterhalb(repo, `${repo}/docs/../../repo-fremd/b.md`)).toBeNull();
    expect(M.unterhalb(repo, `${repo}/../geheim.txt`)).toBeNull();
    expect(M.unterhalb(repo, `${root}/repo-fremd/b.md`)).toBeNull(); // gleiches Präfix, anderer Ordner
  });
});

describe("CLI: --port prüft die Portnummer vor dem Start (#1837)", () => {
  const SKRIPT = fileURLToPath(new URL("../scripts/mermaid-vorschau.mjs", import.meta.url));
  const lauf = (port: string) => spawnSync(process.execPath, [SKRIPT, "docs/x.md", "--mermaid", "kein-ordner", "--port", port], { encoding: "utf8", timeout: 20000 });
  test.each(["0", "65536", "-1", "1.5", "abc"])("--port %s: Aufruf-Fehler mit Exit 2 und Portmeldung", (port) => {
    const r = lauf(port);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("--port erwartet eine Portnummer");
  });
  test("ein gültiger Port ist kein Aufruf-Fehler (weiter bis zur fehlenden mermaid-Installation)", () => {
    const r = lauf("1");
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("mermaid fehlt unter");
    expect(r.stderr).not.toContain("--port erwartet");
  });
});

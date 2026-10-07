/* Lebende Doku (#1355, ADR 0017): Marker-Engine `scripts/docs-gen.mjs` + Generatoren `gates` und
 * `harness-inventar`. Engine und Generatoren laufen gegen ein Fixture-Root (mkdtemp), dazu ein
 * Echt-Repo-Test: die eingecheckten Abschnitte müssen aktuell sein (dasselbe prüft `check:docgen`).
 */
import { afterEach, describe, test } from "vitest";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as docsGen from "../scripts/docs-gen.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as gates from "../scripts/docs-gen/gates.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as inventar from "../scripts/docs-gen/harness-inventar.mjs";

type Err = { file?: string; section: string; message: string };
type Run = { stale: { file: string; section: string }[]; errors: Err[]; written: string[] };
type Cfg = Record<string, unknown>;
type Gen = Record<string, (ctx: { rootDir: string; config: Cfg }) => string>;

const api = docsGen as unknown as {
  parseSections: (t: string) => { sections: { name: string; startLine: number; endLine: number; indent: string }[]; errors: Err[] };
  renderSections: (t: string, o: Record<string, string>) => string;
  runDocsGen: (a: { rootDir: string; config: Cfg; generators?: Gen; write?: boolean }) => Run;
  loadConfig: (rootDir?: string) => Cfg;
};
const gatesApi = gates as unknown as {
  parseChain: (s: string) => string[];
  gatesGenerator: (ctx: { rootDir: string; config: Cfg }) => string;
};
const inventarApi = inventar as unknown as { harnessInventarGenerator: (ctx: { rootDir: string; config: Cfg }) => string };

const dirs: string[] = [];
function fixture(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "kq-docgen-"));
  dirs.push(root);
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(root, rel);
    mkdirSync(join(abs, ".."), { recursive: true });
    writeFileSync(abs, content);
  }
  return root;
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const S = "<!-- GEN:demo START -->";
const E = "<!-- GEN:demo END -->";
const HINT = "<!-- Generiert von npm run docs:gen – nicht von Hand ändern. -->";
const gen: Gen = { demo: () => "| a |\n|---|\n| 1 |" };
const cfg: Cfg = { markdown: ["a.md"] };

describe("parseSections", () => {
  test("liest einen gültigen Abschnitt samt Einrückung", () => {
    const r = api.parseSections(`x\n  ${S}\n  ${E}\ny`);
    assert.deepEqual(r.errors, []);
    assert.deepEqual(r.sections, [{ name: "demo", startLine: 1, endLine: 2, indent: "  " }]);
  });
  test("END fehlt: Fehler", () => {
    const r = api.parseSections(`${S}\ntext`);
    assert.equal(r.errors.length, 1);
    assert.match(r.errors[0].message, /END-Marker.*fehlt/);
  });
  test("END ohne START: Fehler", () => {
    assert.match(api.parseSections(E).errors[0].message, /ohne START/);
  });
  test("END-Name passt nicht zum START: Fehler", () => {
    const r = api.parseSections(`${S}\n<!-- GEN:other END -->`);
    assert.match(r.errors[0].message, /passt nicht/);
  });
  test("verschachtelter START: Fehler", () => {
    const r = api.parseSections(`${S}\n<!-- GEN:two START -->`);
    assert.match(r.errors[0].message, /innerhalb des offenen/);
  });
  test("derselbe Name zweimal in einer Datei: Fehler", () => {
    const r = api.parseSections(`${S}\n${E}\n${S}\n${E}`);
    assert.match(r.errors[0].message, /doppelt/);
  });
  test("unlesbare GEN-Zeile: Fehler", () => {
    assert.match(api.parseSections("<!-- GEN:demo BEGIN -->").errors[0].message, /unlesbar/);
  });
  test("Marker in Code-Fences und inline werden ignoriert", () => {
    const r = api.parseSections(`\`\`\`\n${S}\n\`\`\`\ntext \`${S}\` text\n~~~\n<!-- GEN:kaputt -->\n~~~`);
    assert.deepEqual(r, { sections: [], errors: [] });
  });
});

describe("renderSections", () => {
  test("setzt Hinweis, Leerzeilen und Ausgabe; übernimmt die Einrückung", () => {
    const out = api.renderSections(`- item\n\n  ${S}\n  ${E}\n`, { demo: "a\n\nb" });
    assert.equal(out, `- item\n\n  ${S}\n  ${HINT}\n\n  a\n\n  b\n\n  ${E}\n`);
  });
  test("ist idempotent", () => {
    const once = api.renderSections(`${S}\n${E}`, { demo: "x" });
    assert.equal(api.renderSections(once, { demo: "x" }), once);
  });
  test("behält CRLF bei", () => {
    const out = api.renderSections(`${S}\r\n${E}\r\n`, { demo: "x" });
    assert.ok(out.includes("\r\n") && !/[^\r]\n/.test(out));
  });
});

describe("runDocsGen", () => {
  const fresh = `${S}\n${HINT}\n\n| a |\n|---|\n| 1 |\n\n${E}\n`;

  test("aktueller Abschnitt: nichts stale, kein Fehler", () => {
    const root = fixture({ "a.md": fresh });
    const r = api.runDocsGen({ rootDir: root, config: cfg, generators: gen });
    assert.deepEqual([r.stale, r.errors], [[], []]);
  });
  test("CRLF-Datei mit aktuellem Abschnitt ist grün", () => {
    const root = fixture({ "a.md": fresh.replace(/\n/g, "\r\n") });
    const r = api.runDocsGen({ rootDir: root, config: cfg, generators: gen });
    assert.deepEqual([r.stale, r.errors], [[], []]);
  });
  test("veralteter Abschnitt: stale mit Datei und Abschnitt; der Prüflauf schreibt nie", () => {
    const old = fresh.replace("| 1 |", "| 2 |");
    const root = fixture({ "a.md": old });
    const r = api.runDocsGen({ rootDir: root, config: cfg, generators: gen });
    assert.deepEqual(r.stale, [{ file: "a.md", section: "demo" }]);
    assert.equal(readFileSync(join(root, "a.md"), "utf8"), old);
  });
  test("write behebt es, behält CRLF und ist beim zweiten Lauf ein No-op", () => {
    const old = fresh.replace("| 1 |", "| 2 |").replace(/\n/g, "\r\n");
    const root = fixture({ "a.md": old });
    const w = api.runDocsGen({ rootDir: root, config: cfg, generators: gen, write: true });
    assert.deepEqual(w.written, ["a.md"]);
    assert.equal(readFileSync(join(root, "a.md"), "utf8"), fresh.replace(/\n/g, "\r\n"));
    assert.deepEqual(api.runDocsGen({ rootDir: root, config: cfg, generators: gen, write: true }).written, []);
  });
  test("unbekannter Generator: Fehler mit Datei und Abschnitt", () => {
    const root = fixture({ "a.md": `<!-- GEN:nix START -->\n<!-- GEN:nix END -->\n` });
    const r = api.runDocsGen({ rootDir: root, config: cfg, generators: gen });
    assert.equal(r.errors[0].file, "a.md");
    assert.equal(r.errors[0].section, "nix");
    assert.match(r.errors[0].message, /unbekannter Generator/);
  });
  test("fehlender END-Marker: Fehler mit Datei", () => {
    const root = fixture({ "a.md": `${S}\n` });
    const r = api.runDocsGen({ rootDir: root, config: cfg, generators: gen });
    assert.equal(r.errors[0].file, "a.md");
    assert.match(r.errors[0].message, /END-Marker/);
  });
  test("doppelter Abschnitt in einer Datei: Fehler; derselbe Generator in zwei Dateien ist erlaubt", () => {
    const dup = fixture({ "a.md": `${S}\n${E}\n${S}\n${E}\n` });
    assert.match(api.runDocsGen({ rootDir: dup, config: cfg, generators: gen }).errors[0].message, /doppelt/);
    const two = fixture({ "a.md": fresh, "b.md": fresh });
    const r = api.runDocsGen({ rootDir: two, config: { markdown: ["a.md", "b.md"] }, generators: gen });
    assert.deepEqual([r.stale, r.errors], [[], []]);
  });
  test("fail-closed: bei einem Fehler schreibt write auch die anderen Dateien nicht", () => {
    const stale = fresh.replace("| 1 |", "| 2 |");
    const root = fixture({ "a.md": stale, "b.md": `${S}\n` });
    const r = api.runDocsGen({ rootDir: root, config: { markdown: ["a.md", "b.md"] }, generators: gen, write: true });
    assert.ok(r.errors.length > 0);
    assert.deepEqual(r.written, []);
    assert.equal(readFileSync(join(root, "a.md"), "utf8"), stale);
  });
  test("Generator-Exception wird zum Fehler mit Datei und Abschnitt", () => {
    const root = fixture({ "a.md": `${S}\n${E}\n` });
    const boom: Gen = {
      demo: () => {
        throw new Error("kaputt");
      },
    };
    const r = api.runDocsGen({ rootDir: root, config: cfg, generators: boom });
    assert.equal(r.errors[0].section, "demo");
    assert.match(r.errors[0].message, /kaputt/);
  });
  test("durchsucht Ordner rekursiv, nur konfigurierte Wurzeln", () => {
    const root = fixture({ "docs/sub/x.md": `${S}\n${E}\n`, "other/y.md": `${S}\n` });
    const r = api.runDocsGen({ rootDir: root, config: { markdown: ["docs"] }, generators: gen });
    assert.deepEqual(r.stale, [{ file: "docs/sub/x.md", section: "demo" }]);
    assert.deepEqual(r.errors, []);
  });
});

describe("Generator gates", () => {
  const pkg = (scripts: Record<string, string>) => JSON.stringify({ scripts });
  const base = {
    "package.json": pkg({ verify: "npm run a && npm run b && npm test", "verify:full": "npm run verify && npm run c && node x.mjs", a: "x", b: "x", c: "x", test: "x" }),
    ".github/ci.yml": "run: npm audit --x\n",
  };
  const conf = (over: Record<string, unknown> = {}) => ({
    gates: {
      package: "package.json",
      chains: ["verify", "verify:full"],
      descriptions: { a: "A", b: "B", test: "T", c: "C", "node x.mjs": "X" },
      ci: [{ command: "npm audit --x", source: ".github/ci.yml", description: "Audit" }],
      ...over,
    },
  });
  const run = (files: Record<string, string>, config: Cfg) =>
    gatesApi.gatesGenerator({ rootDir: fixture(files), config });

  test("parseChain: npm run, npm test, Rohbefehl", () => {
    assert.deepEqual(gatesApi.parseChain("npm run a && npm test && node x.mjs --y"), ["a", "test", "node x.mjs --y"]);
  });
  test("Reihenfolge, Kettenspalte, verschachtelte Kette ohne eigene Zeile, CI-Zeile", () => {
    const rows = run(base, conf({ descriptions: { a: "A", b: "B", test: "T", c: "C", "node x.mjs": "X" } }))
      .split("\n")
      .slice(2);
    assert.deepEqual(rows, [
      "| `npm run a` | `verify` | A |",
      "| `npm run b` | `verify` | B |",
      "| `npm test` | `verify` | T |",
      "| `npm run c` | `verify:full` | C |",
      "| `node x.mjs` | `verify:full` | X |",
      "| `npm audit --x` | CI | Audit |",
    ]);
  });
  test("Gate ohne Beschreibung: rot, alle fehlenden in einer Meldung", () => {
    assert.throws(() => run(base, conf({ descriptions: { a: "A", test: "T", c: "C", "node x.mjs": "X" } })), /ohne Beschreibung.*\bb\b/);
    assert.throws(() => run(base, conf({ descriptions: { test: "T", "node x.mjs": "X" } })), /a, b, c/);
  });
  test("stale Beschreibung ohne Gate: rot", () => {
    assert.throws(() => run(base, conf({ descriptions: { a: "A", b: "B", test: "T", c: "C", "node x.mjs": "X", weg: "W" } })), /stale.*weg/);
  });
  test("konfigurierte Kette fehlt in package.json: rot", () => {
    assert.throws(() => run(base, conf({ chains: ["verify", "nope"] })), /Kette "nope" fehlt/);
  });
  test("CI-Befehl steht nicht in der Quelle: rot; Quelle fehlt: rot", () => {
    const ci = (command: string, source = ".github/ci.yml") => [{ command, source, description: "d" }];
    assert.throws(() => run(base, conf({ ci: ci("npm audit --y") })), /nicht \(mehr\) in/);
    assert.throws(() => run(base, conf({ ci: ci("npm audit --x", "weg.yml") })), /nicht lesbar/);
  });
});

describe("Generator harness-inventar", () => {
  const conf = {
    harness: { agents: ".claude/agents", skills: ".claude/skills", workflows: ".claude/workflows", settings: ".claude/settings.json", gitHooks: ".githooks", mcp: ".mcp.json" },
  };
  const files = {
    ".claude/agents/b.md": "---\nname: beta\nmodel: opus\neffort: high\n---\nText",
    ".claude/agents/a.md": "---\nname: alpha\ndescription: GEHEIM\n---\nText",
    ".claude/skills/s1/SKILL.md": "---\nname: s1\n---\n",
    ".claude/skills/s2/SKILL.md": "---\nname: s2\nmodel: sonnet\n---\n",
    ".claude/workflows/w.js": "export const meta = {\n  name: 'wf-name',\n}\n",
    ".claude/workflows/ohne.js": "console.log(1)\n",
    ".claude/settings.json": JSON.stringify({
      hooks: { PreToolUse: [{ matcher: "Bash|PowerShell", hooks: [{ type: "command", command: "node", args: ["${CLAUDE_PROJECT_DIR}/scripts/h.mjs"] }] }] },
    }),
    ".githooks/pre-push": "#!/bin/sh\n",
    ".mcp.json": JSON.stringify({
      mcpServers: {
        remote: { type: "http", url: "https://api.example.org/mcp", headers: { Authorization: "Bearer GEHEIMTOKEN" } },
        local: { type: "stdio", command: "node", args: ["scripts/x.mjs", "--isolated"] },
      },
    }),
  };
  const gen = (f: Record<string, string>, c: Cfg = conf) => inventarApi.harnessInventarGenerator({ rootDir: fixture(f), config: c });

  test("Subagent mit und ohne model, fest sortiert; Skill-Default Session-Modell", () => {
    const out = gen(files);
    assert.ok(out.includes("| Subagent | `alpha` | model: —, effort: — | `.claude/agents/a.md` |"));
    assert.ok(out.includes("| Subagent | `beta` | model: opus, effort: high | `.claude/agents/b.md` |"));
    assert.ok(out.indexOf("`alpha`") < out.indexOf("`beta`"));
    assert.ok(out.includes("| Skill | `s1` | model: Session-Modell |"));
    assert.ok(out.includes("| Skill | `s2` | model: sonnet |"));
  });
  test("Workflow: meta.name, sonst Dateiname", () => {
    const out = gen(files);
    assert.ok(out.includes("| Workflow | `wf-name` |"));
    assert.ok(out.includes("| Workflow | `ohne` |"));
  });
  test("Hook: Matcher-Pipe escapet, CLAUDE_PROJECT_DIR entfernt; Git-Hook", () => {
    const out = gen(files);
    assert.ok(out.includes("matcher: `Bash\\|PowerShell`, `node scripts/h.mjs`"));
    assert.ok(!out.includes("CLAUDE_PROJECT_DIR"));
    assert.ok(out.includes("| Git-Hook | `pre-push` |"));
  });
  test("MCP: http mit Host, stdio mit erstem Argument; nie Header, Token oder Beschreibungen", () => {
    const out = gen(files);
    assert.ok(out.includes("| MCP-Server | `remote` | http, api.example.org |"));
    assert.ok(out.includes("| MCP-Server | `local` | stdio, node scripts/x.mjs |"));
    assert.ok(!out.includes("GEHEIM"));
  });
  test("konfigurierter Pfad fehlt: rot; nicht konfigurierter Teil entfällt", () => {
    assert.throws(() => gen({ ".mcp.json": "{}" }, { harness: { mcp: ".mcp.json", agents: "weg" } }), /weg.*nicht gefunden/);
    const out = gen({ ".mcp.json": "{}" }, { harness: { mcp: ".mcp.json" } });
    assert.equal(out.split("\n").length, 2);
  });
});

describe("Echt-Repo", () => {
  test("alle generierten Abschnitte sind aktuell, keine Fehler", () => {
    const r = api.runDocsGen({ rootDir: process.cwd(), config: api.loadConfig(process.cwd()) });
    assert.deepEqual(r.errors, []);
    assert.deepEqual(r.stale, []);
  });
});

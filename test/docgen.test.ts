/* Lebende Doku (#1355, ADR 0017): Marker-Engine `scripts/docs-gen.mjs` + Generatoren `gates` und
 * `harness-inventar`. Engine und Generatoren laufen gegen ein Fixture-Root (mkdtemp), dazu ein
 * Echt-Repo-Test: die eingecheckten Abschnitte müssen aktuell sein (dasselbe prüft `check:docgen`).
 */
import { describe, test } from "vitest";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fixture } from "./support/tmp-fixture";

// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as docsGen from "../scripts/docs-gen.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as gates from "../scripts/docs-gen/gates.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as inventar from "../scripts/docs-gen/harness-inventar.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as markdown from "../scripts/docs-gen/markdown.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as registry from "../scripts/docs-gen/registry.mjs";

type Err = { file?: string; section: string; message: string };
type Run = { stale: { file: string; section: string }[]; errors: Err[]; written: string[] };
type Cfg = Record<string, unknown>;
type Gen = Record<string, (ctx: { rootDir: string; config: Cfg }) => string>;

const api = docsGen as unknown as {
  parseSections: (t: string) => { sections: { name: string; startLine: number; endLine: number; indent: string }[]; errors: Err[] };
  renderSections: (t: string, o: Record<string, string>, hinweis?: string) => string;
  runDocsGen: (a: { rootDir: string; config: Cfg; generators?: Gen; write?: boolean }) => Run;
  loadConfig: (rootDir?: string, pfad?: string) => Cfg;
  cli: (argv: string[], o: { rootDir: string; config?: Cfg; generators?: Gen; out: (s: string) => void; err: (s: string) => void }) => number;
};
const mdApi = markdown as unknown as {
  parseChain: (s: string) => string[];
  fenceMaske: (lines: string[]) => boolean[];
  fenceBloecke: (lines: string[]) => { start: number; ende: number; geschlossen: boolean; info: string; inhalt: string[] }[];
  collectMarkdown: (rootDir: string, roots?: string[], o?: { ueberspringe?: (ent: { name: string; isDirectory: () => boolean }, relDir: string) => boolean }) => string[];
  parseFrontmatter: (t: string) => Record<string, string>;
  brauche: (rootDir: string, rel: string, was: string, errors: string[]) => boolean;
};
const registryApi = registry as unknown as { GENERATORS: Record<string, unknown> };
const gatesApi = gates as unknown as {
  gatesGenerator: (ctx: { rootDir: string; config: Cfg }) => string;
};
const inventarApi = inventar as unknown as { harnessInventarGenerator: (ctx: { rootDir: string; config: Cfg }) => string };

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
  test("ein mit Backticks geöffneter Fence wird nicht von Tildes geschlossen", () => {
    const r = api.parseSections(`\`\`\`\n~~~\n${S}\n${E}\n\`\`\``);
    assert.deepEqual(r, { sections: [], errors: [] });
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
  test("Datei mit zwei Abschnitten: nur der veraltete wird gemeldet, write rendert beide", () => {
    const two2 = (b: string) => `<!-- GEN:demo START -->
${HINT}

| a |
|---|
| 1 |

<!-- GEN:demo END -->

text

<!-- GEN:demo2 START -->
${HINT}

${b}

<!-- GEN:demo2 END -->
`;
    const g2: Gen = { demo: gen.demo, demo2: () => "neu" };
    const root = fixture({ "a.md": two2("alt") });
    const r = api.runDocsGen({ rootDir: root, config: cfg, generators: g2 });
    assert.deepEqual(r.stale, [{ file: "a.md", section: "demo2" }]);
    const root2 = fixture({ "a.md": `<!-- GEN:demo START -->
<!-- GEN:demo END -->

text

<!-- GEN:demo2 START -->
<!-- GEN:demo2 END -->
` });
    api.runDocsGen({ rootDir: root2, config: cfg, generators: g2, write: true });
    assert.equal(readFileSync(join(root2, "a.md"), "utf8"), two2("neu"));
    assert.deepEqual(api.runDocsGen({ rootDir: root2, config: cfg, generators: g2 }).stale, []);
  });
  describe("zwei Abschnitte in einer Datei, Spiegelfälle (#1392)", () => {
    const zwei = (a: string, b: string) => `${S}\n${HINT}\n\n${a}\n\n${E}\n\n<!-- GEN:demo2 START -->\n${HINT}\n\n${b}\n\n<!-- GEN:demo2 END -->\n`;
    const g2: Gen = { demo: () => "eins", demo2: () => "zwei" };
    const leer = `${S}\n${E}\n\n<!-- GEN:demo2 START -->\n<!-- GEN:demo2 END -->\n`;
    test("erster veraltet, zweiter aktuell: genau der erste wird gemeldet", () => {
      const root = fixture({ "a.md": zwei("alt", "zwei") });
      assert.deepEqual(api.runDocsGen({ rootDir: root, config: cfg, generators: g2 }).stale, [{ file: "a.md", section: "demo" }]);
    });
    test("beide veraltet: beide werden gemeldet", () => {
      const root = fixture({ "a.md": zwei("alt", "alt") });
      assert.deepEqual(api.runDocsGen({ rootDir: root, config: cfg, generators: g2 }).stale, [
        { file: "a.md", section: "demo" },
        { file: "a.md", section: "demo2" },
      ]);
    });
    test("write repariert den ersten, obwohl der zweite aktuell ist", () => {
      const root = fixture({ "a.md": zwei("alt", "zwei") });
      assert.deepEqual(api.runDocsGen({ rootDir: root, config: cfg, generators: g2, write: true }).written, ["a.md"]);
      assert.equal(readFileSync(join(root, "a.md"), "utf8"), zwei("eins", "zwei"));
    });
    test("write rendert beide, der zweite Lauf ist leer", () => {
      const root = fixture({ "a.md": leer });
      api.runDocsGen({ rootDir: root, config: cfg, generators: g2, write: true });
      assert.equal(readFileSync(join(root, "a.md"), "utf8"), zwei("eins", "zwei"));
      assert.deepEqual(api.runDocsGen({ rootDir: root, config: cfg, generators: g2 }).stale, []);
    });
  });
  test("von Hand geänderte Hinweiszeile gilt als veraltet", () => {
    const root = fixture({ "a.md": fresh.replace(HINT, "<!-- anders -->") });
    assert.deepEqual(api.runDocsGen({ rootDir: root, config: cfg, generators: gen }).stale, [{ file: "a.md", section: "demo" }]);
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
    assert.deepEqual(mdApi.parseChain("npm run a && npm test && node x.mjs --y"), ["a", "test", "node x.mjs --y"]);
  });
  test("parseChain: Argumente hinter -- fallen weg (Z5g)", () => {
    assert.deepEqual(mdApi.parseChain("npm run a -- --flag && npm test -- --run && npm run b"), ["a", "test", "b"]);
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
  test("derselbe Schritt in zwei Ketten erscheint nur einmal (erste Kette)", () => {
    const files = { ...base, "package.json": pkg({ verify: "npm run a", "verify:full": "npm run verify && npm run a && npm run c", a: "x", c: "x" }) };
    const out = run(files, conf({ descriptions: { a: "A", c: "C" }, ci: [] }));
    assert.equal(out.split("\n").filter((l) => l.includes("npm run a")).length, 1);
    assert.ok(out.includes("| `npm run a` | `verify` | A |"));
  });
  test("CI-Befehl steht nicht in der Quelle: rot; Quelle fehlt: rot", () => {
    const ci = (command: string, source = ".github/ci.yml") => [{ command, source, description: "d" }];
    assert.throws(() => run(base, conf({ ci: ci("npm audit --y") })), /nicht \(mehr\) in/);
    assert.throws(() => run(base, conf({ ci: ci("npm audit --x", "weg.yml") })), /nicht lesbar/);
  });
});

describe("Generator gates: verschachtelte Ketten (#1392)", () => {
  const conf = (descriptions: Record<string, string>) => ({
    gates: { package: "package.json", chains: ["verify"], descriptions },
  });
  const run = (scripts: Record<string, string>, descriptions: Record<string, string>) =>
    gatesApi.gatesGenerator({ rootDir: fixture({ "package.json": JSON.stringify({ scripts }) }), config: conf(descriptions) });

  test("ein Schritt, der selbst eine && -Kette ist, wird aufgelöst und bekommt keine eigene Zeile", () => {
    const out = run({ verify: "npm run a && npm run inner", inner: "npm run b && npm run c", a: "x", b: "x", c: "x" }, { a: "A", b: "B", c: "C" });
    assert.deepEqual(out.split("\n").slice(2), ["| `npm run a` | `verify` | A |", "| `npm run b` | `verify` | B |", "| `npm run c` | `verify` | C |"]);
  });
  test("mehrfach verschachtelt", () => {
    const out = run({ verify: "npm run o", o: "npm run m && npm run a", m: "npm run b && npm run c", a: "x", b: "x", c: "x" }, { a: "A", b: "B", c: "C" });
    assert.deepEqual(out.split("\n").slice(2).map((l) => l.split(" | ")[0]), ["| `npm run b`", "| `npm run c`", "| `npm run a`"]);
  });
  test("Alias ohne && bleibt ein Schritt", () => {
    const out = run({ verify: "npm run a", a: "npm run b", b: "x" }, { a: "A" });
    assert.ok(out.includes("| `npm run a` | `verify` | A |"));
    assert.ok(!out.includes("npm run b"));
  });
  test("Zyklus ist ein Fehler", () => {
    assert.throws(() => run({ verify: "npm run x", x: "npm run y && npm run a", y: "npm run x && npm run a", a: "x" }, { a: "A" }), /Zyklus/);
  });
});

describe("docs-gen CLI und Registry (#1392)", () => {
  const files = { "a.md": `${S}\n${HINT}\n\n| a |\n|---|\n| 1 |\n\n${E}\n` };
  const lauf = (argv: string[], f: Record<string, string> = files, o: { config?: Cfg; generators?: Gen } = {}) => {
    const out: string[] = [];
    const err: string[] = [];
    const code = api.cli(argv, { rootDir: fixture(f), config: cfg, generators: gen, out: (x) => out.push(x), err: (x) => err.push(x), ...o });
    return { code, out: out.join("\n"), err: err.join("\n") };
  };

  test("aktuell: Exit 0", () => {
    const r = lauf([]);
    assert.equal(r.code, 0);
    assert.match(r.out, /aktuell/);
  });
  test("veraltet: Exit 1 mit Fix-Text, ohne zu schreiben", () => {
    const r = lauf([], { "a.md": `${S}\n${E}\n` });
    assert.equal(r.code, 1);
    assert.match(r.err, /veraltet/);
    assert.match(r.err, /Fix: npm run docs:gen/);
  });
  test("Fehler: Exit 1 mit Fix-Text für Marker", () => {
    const r = lauf([], { "a.md": `${S}\n` });
    assert.equal(r.code, 1);
    assert.match(r.err, /Fix: Marker bzw\. Generator-Daten/);
  });
  test("--write: Exit 0 und \"geschrieben\"", () => {
    const r = lauf(["--write"], { "a.md": `${S}\n${E}\n` });
    assert.equal(r.code, 0);
    assert.match(r.out, /geschrieben: a\.md/);
    assert.match(lauf(["--write"]).out, /nichts zu tun/);
  });
  test("--config: eigene Datei wird gelesen; falscher Pfad oder fehlender Wert ergibt Exit 1", () => {
    const f = { ...files, "x/eigen.json": JSON.stringify({ markdown: ["a.md"] }) };
    const ok = api.cli(["--config", "x/eigen.json"], { rootDir: fixture(f), generators: gen, out: () => undefined, err: () => undefined });
    assert.equal(ok, 0);
    const ausgabe: string[] = [];
    const falsch = api.cli(["--config", "gibtsnicht.json"], { rootDir: fixture(f), generators: gen, out: () => undefined, err: (x) => ausgabe.push(x) });
    assert.equal(falsch, 1);
    assert.match(ausgabe.join(""), /Config nicht lesbar/);
    const ohneWert = api.cli(["--config"], { rootDir: fixture(f), generators: gen, out: () => undefined, err: (x) => ausgabe.push(x) });
    assert.equal(ohneWert, 1);
  });
  test("loadConfig liest den Standardpfad und einen übergebenen Pfad", () => {
    const root = fixture({ "scripts/docs-gen/config.json": '{"markdown":["x"]}', "andere.json": '{"markdown":["y"]}' });
    assert.deepEqual(api.loadConfig(root), { markdown: ["x"] });
    assert.deepEqual(api.loadConfig(root, "andere.json"), { markdown: ["y"] });
  });
  test("befehl: Standard bleibt npm run docs:gen, eigener Befehl steht in Hinweiszeile und Fix-Text (#1373)", () => {
    const eigen = { "a.md": `${S}\n<!-- Generiert von make docs – nicht von Hand ändern. -->\n\n| a |\n|---|\n| 1 |\n\n${E}\n` };
    const ok = lauf([], eigen, { config: { ...cfg, befehl: "make docs" } });
    assert.equal(ok.code, 0, ok.err);
    const alt = lauf([], eigen, { config: { ...cfg, befehl: "make docs" } });
    assert.equal(alt.code, 0);
    // dieselbe Datei mit Standard-Befehl: veraltet, Fix nennt npm run docs:gen
    const std = lauf([], eigen);
    assert.equal(std.code, 1);
    assert.match(std.err, /Fix: npm run docs:gen/);
    // veraltet mit eigenem Befehl: Fix nennt ihn, nicht npm
    const stale = lauf([], { "a.md": `${S}\n${E}\n` }, { config: { ...cfg, befehl: "make docs" } });
    assert.equal(stale.code, 1);
    assert.match(stale.err, /Fix: make docs/);
    assert.doesNotMatch(stale.err, /npm run/);
    // Fehlerfall (Marker): Fix-Text nennt ebenfalls den eigenen Befehl
    const kaputt = lauf([], { "a.md": `${S}\n` }, { config: { ...cfg, befehl: "make docs" } });
    assert.match(kaputt.err, /dann make docs/);
    assert.doesNotMatch(kaputt.err, /npm run/);
  });
  test("befehl: --write schreibt die Hinweiszeile mit dem eigenen Befehl", () => {
    const root = fixture({ "a.md": `${S}\n${E}\n` });
    const code = api.cli(["--write"], { rootDir: root, config: { ...cfg, befehl: "make docs" }, generators: gen, out: () => undefined, err: () => undefined });
    assert.equal(code, 0);
    assert.match(readFileSync(join(root, "a.md"), "utf8"), /<!-- Generiert von make docs – nicht von Hand ändern\. -->/);
  });
  test.each([["leer", ""], ["nur Leerzeichen", "  "], ["führendes Leerzeichen", " make docs"], ["folgendes Leerzeichen", "make docs "], ["Zahl", 5], ["Zeilenumbruch", "make\ndocs"], ["Bindestriche --", "make -- docs"], ["Kommentar-Ende", "a --> b"]])(
    "befehl ungültig (%s): Exit 1, nichts geschrieben",
    (_n, wert) => {
      const root = fixture({ "a.md": `${S}\n${E}\n` });
      const fehler: string[] = [];
      const code = api.cli(["--write"], { rootDir: root, config: { ...cfg, befehl: wert }, generators: gen, out: () => undefined, err: (x) => fehler.push(x) });
      assert.equal(code, 1);
      assert.match(fehler.join(""), /befehl/);
      assert.equal(readFileSync(join(root, "a.md"), "utf8"), `${S}\n${E}\n`);
    },
  );
  test("renderSections nimmt einen eigenen Hinweis entgegen", () => {
    assert.equal(api.renderSections(`${S}\n${E}`, { demo: "x" }, "<!-- H -->"), `${S}\n<!-- H -->\n\nx\n\n${E}`);
  });
  test("Registry: jeder Eintrag ist eine Funktion", () => {
    for (const [name, g] of Object.entries(registryApi.GENERATORS)) assert.equal(typeof g, "function", name);
  });
});

describe("markdown-Helfer (#1392)", () => {
  test("fenceMaske: Fence-Zeilen inklusive; Tilde schließt keinen Backtick-Fence", () => {
    assert.deepEqual(mdApi.fenceMaske(["a", "```", "b", "~~~", "```", "c"]), [false, true, true, true, true, false]);
  });
  test("fenceMaske: offener Fence bleibt bis zum Ende offen", () => {
    assert.deepEqual(mdApi.fenceMaske(["```", "x"]), [true, true]);
  });
  test("fenceMaske (CommonMark, Z5c): 4-Backtick-Fence wird von innerem ``` nicht geschlossen, ein Schluss mit Info-String schließt nicht", () => {
    assert.deepEqual(mdApi.fenceMaske(["````", "```", "x", "```", "````", "y"]), [true, true, true, true, true, false]);
    assert.deepEqual(mdApi.fenceMaske(["```", "```ts", "x", "```", "y"]), [true, true, true, true, false]);
  });
  test("fenceBloecke: Start, Ende, Info, Inhalt, geschlossen", () => {
    const b = mdApi.fenceBloecke(["a", "~~~mermaid ", "x", "~~~", "```", "y"]);
    assert.deepEqual(b, [
      { start: 1, ende: 3, geschlossen: true, info: "mermaid", inhalt: ["x"] },
      { start: 4, ende: 5, geschlossen: false, info: "", inhalt: ["y"] },
    ]);
  });
  test("fenceBloecke: ``` mit Backtick im Info-String ist kein Fence (Inline-Code)", () => {
    assert.deepEqual(mdApi.fenceBloecke(["```a`b", "x"]), []);
  });
  test("parseFrontmatter: CRLF, Unterstrich-Schlüssel, ein Paar Anführungszeichen, kein Frontmatter", () => {
    assert.deepEqual(mdApi.parseFrontmatter("---\r\nname: x\r\nmy_key: 'a b'\r\n---\r\ntext"), { name: "x", my_key: "a b" });
    assert.deepEqual(mdApi.parseFrontmatter("# Kein Frontmatter\nname: x\n"), {});
    assert.equal(mdApi.parseFrontmatter('---\nk: "q\n---\n').k, '"q');
  });
  test("collectMarkdown: Standard ist das ganze Root; ueberspringe schließt Ordner und Dateien aus", () => {
    const root = fixture({ "a.md": "", "docs/b.md": "", "skip/c.md": "", ".claude/lose.md": "", ".claude/skills/s.md": "", "x.txt": "" });
    assert.deepEqual(mdApi.collectMarkdown(root), [".claude/lose.md", ".claude/skills/s.md", "a.md", "docs/b.md", "skip/c.md"]);
    const gefiltert = mdApi.collectMarkdown(root, ["."], { ueberspringe: (e, rel) => (e.isDirectory() ? e.name === "skip" : rel === ".claude") });
    assert.deepEqual(gefiltert, [".claude/skills/s.md", "a.md", "docs/b.md"]);
  });
  test("brauche: vorhanden → true, fehlend → false mit Meldung", () => {
    const root = fixture({ "da.txt": "" });
    const errors: string[] = [];
    assert.equal(mdApi.brauche(root, "da.txt", "Datei", errors), true);
    assert.equal(mdApi.brauche(root, "weg.txt", "Datei", errors), false);
    assert.deepEqual(errors, ['Datei "weg.txt" nicht gefunden (Config veraltet?)']);
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
        local: { type: "stdio", command: "node", args: ["--isolated", "scripts/x.mjs"] },
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
    assert.ok(out.indexOf("`local`") < out.indexOf("`remote`"));
    assert.ok(!out.includes("GEHEIM"));
  });
  test("Plugin: nur enabledPlugins mit true; Name und Marktplatz getrennt; ohne enabledPlugins keine Zeile", () => {
    const withPlugins = {
      ...files,
      ".claude/settings.json": JSON.stringify({ enabledPlugins: { "an@markt": true, "aus@markt": false, "ohne-markt": true } }),
    };
    const out = gen(withPlugins);
    assert.ok(out.includes("| Plugin | `an` | Marktplatz: markt | `.claude/settings.json` |"));
    assert.ok(out.includes("| Plugin | `ohne-markt` | — | `.claude/settings.json` |"));
    assert.ok(!out.includes("aus"));
    assert.ok(!gen(files).includes("| Plugin |"));
    const unsorted = { ...files, ".claude/settings.json": JSON.stringify({ enabledPlugins: { "z@m": true, "a@m": true, "x@m": "true", "y@m": 1 } }) };
    const o2 = gen(unsorted);
    assert.ok(o2.indexOf("`a`") > 0 && o2.indexOf("`a`") < o2.indexOf("`z`"));
    assert.ok(!o2.includes("`x`") && !o2.includes("`y`"));
  });
  test("konfigurierter Pfad fehlt: rot; nicht konfigurierter Teil entfällt", () => {
    assert.throws(() => gen({ ".mcp.json": "{}" }, { harness: { mcp: ".mcp.json", agents: "weg" } }), /weg.*nicht gefunden/);
    const out = gen({ ".mcp.json": "{}" }, { harness: { mcp: ".mcp.json" } });
    assert.equal(out.split("\n").length, 2);
  });
});

describe("Echt-Repo", () => {
  // Den vollen Vergleich (inkl. dependency-cruiser) macht `check:docgen` in `verify`; hier nur die Marker (#1392).
  test("alle GEN-Marker der Repo-Doku sind wohlgeformt und haben einen registrierten Generator", () => {
    const config = api.loadConfig(process.cwd()) as { markdown: string[] };
    const dateien = mdApi.collectMarkdown(process.cwd(), config.markdown);
    assert.ok(dateien.length > 0);
    const namen = new Set<string>();
    for (const d of dateien) {
      const r = api.parseSections(readFileSync(join(process.cwd(), d), "utf8"));
      assert.deepEqual(r.errors, [], d);
      for (const sec of r.sections) namen.add(sec.name);
    }
    assert.ok(namen.size > 0);
    for (const n of namen) assert.ok(Object.hasOwn(registryApi.GENERATORS, n), `unbekannter Generator ${n}`);
  });
});

describe("Mermaid-Größenwächter in der Engine (#1411)", () => {
  const gross = (n: number) => ["```mermaid", "flowchart TB", ...Array.from({ length: n }, (_, i) => `  a${i} --> b${i}`), "```"].join("\n");
  const doc = `${S}\n${E}\n`;
  test("zu großes Diagramm ist ein Generatorfehler und es wird nichts geschrieben (fail-closed)", () => {
    const root = fixture({ "a.md": doc, "b.md": doc });
    const res = api.runDocsGen({ rootDir: root, config: { markdown: ["a.md", "b.md"] }, generators: { demo: () => gross(501) }, write: true });
    assert.equal(res.errors.length, 2);
    assert.match(res.errors[0].message, /501 Kanten/);
    assert.deepEqual(res.written, []);
    assert.equal(readFileSync(join(root, "a.md"), "utf8"), doc);
  });
  test("Diagramm an der Grenze (500 Kanten) wird geschrieben", () => {
    const root = fixture({ "a.md": doc });
    const res = api.runDocsGen({ rootDir: root, config: { markdown: ["a.md"] }, generators: { demo: () => gross(500) }, write: true });
    assert.deepEqual(res.errors, []);
    assert.deepEqual(res.written, ["a.md"]);
  });
});

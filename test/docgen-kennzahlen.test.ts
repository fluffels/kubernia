/* Generator `harness-kennzahlen` (#1579, ADR 0017): Zählbares des Harness aus versionierten Dateien, damit `check:docgen` die Zahlen in
 * README und docs/agent-harness.md aktuell hält. Fixture-Repo (mkdtemp) statt Echt-Repo; der Echt-Repo-Beleg ist `check:docgen` selbst.
 */
import { describe, test } from "vitest";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fixture } from "./support/tmp-fixture";

// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as kennzahlen from "../scripts/docs-gen/harness-kennzahlen.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as docsGen from "../scripts/docs-gen.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as registry from "../scripts/docs-gen/registry.mjs";

type Cfg = Record<string, unknown>;
type Gen = (ctx: { rootDir: string; config: Cfg }) => string;
type Run = { stale: { file: string; section: string }[]; errors: { message: string }[]; written: string[] };
const gen = (kennzahlen as unknown as { harnessKennzahlenGenerator: Gen }).harnessKennzahlenGenerator;
const run = (docsGen as unknown as { runDocsGen: (a: { rootDir: string; config: Cfg; generators: Record<string, Gen>; write?: boolean }) => Run }).runDocsGen;
const GENERATORS = (registry as unknown as { GENERATORS: Record<string, unknown> }).GENERATORS;

const KONFIG: Cfg = {
  markdown: ["README.md"],
  kennzahlen: {
    package: "package.json",
    chains: ["verify", "verify:full"],
    skripte: ["scripts"],
    skriptEndungen: [".mjs", ".cjs"],
    waechter: { ordner: "test/harness" },
    workflows: ".github/workflows",
    adr: "docs/adr",
  },
};
const adr = (nr: string, titel = "Titel") => `# ADR ${nr}: ${titel}\n\n> Status: **akzeptiert** · Datum: 2026-10-01\n\n## Kontext\n`;
const marker = (kopf: string) => `/* ${kopf}\n *\n * @harness-waechter – Begründung.\n */\n`;
const REPO: Record<string, string> = {
  "package.json": JSON.stringify({ scripts: { a: "x", b: "y", c: "z", verify: "npm run a && npm run b", "verify:full": "npm run verify && npm run c && npm run b" } }),
  "scripts/eins.mjs": "export {};",
  "scripts/zwei.cjs": "module.exports = {};",
  "scripts/docs-gen/drei.mjs": "export {};",
  "scripts/notiz.md": "kein Skript",
  "scripts/node_modules/fremd.mjs": "export {};",
  "test/harness/a.test.ts": marker("Wächter A"),
  "test/harness/unter/b.test.ts": marker("Wächter B"),
  "test/harness/ohne.test.ts": "// kein Marker\n",
  "test/harness/erwaehnt.test.ts": "// siehe @harness-waechter im Text\n",
  "test/harness/helfer.ts": marker("Helfer ist kein Test"),
  ".github/workflows/ci.yml": "name: ci",
  ".github/workflows/zweiter.yaml": "name: z",
  ".github/workflows/notiz.md": "kein Workflow",
  "docs/adr/0001-a.md": adr("0001"),
  "docs/adr/0002-b.md": adr("0002"),
  "docs/adr/README.md": "# Index",
  "README.md": "# Demo\n",
};

const zeilen = (md: string) => md.split("\n").slice(2).map((z) => z.split("|").slice(1, 3).map((s) => s.trim()));
const wert = (md: string, name: string): string | undefined => zeilen(md).find(([n]) => n === name)?.[1];

describe("harness-kennzahlen: Zählung", () => {
  const md = gen({ rootDir: fixture(REPO), config: KONFIG });

  test("Prüfschritte je Kette: eigene Schritte, verschachtelte Kette aufgelöst, je Schritt einmal", () => {
    assert.equal(wert(md, "Prüfschritte in `verify`"), "2");
    assert.equal(wert(md, "Prüfschritte in `verify:full`"), "2"); // c und b (je Kette gezählt); `verify` ist ein Kettenname und zählt nicht mit
  });
  test("Skripte: .mjs und .cjs rekursiv, kein .md, kein node_modules", () => {
    assert.equal(wert(md, "Skripte"), "3");
  });
  test("Wächter-Tests: nur *.test.ts mit dem Marker als eigener Kommentar-Zeile (rekursiv)", () => {
    assert.equal(wert(md, "Wächter-Tests"), "2");
  });
  test("CI-Workflows: .yml und .yaml, keine anderen Dateien", () => {
    assert.equal(wert(md, "CI-Workflows"), "2");
  });
  test("ADRs: NNNN-*.md, ohne README", () => {
    assert.equal(wert(md, "ADRs"), "2");
  });
  test("jede Zeile nennt ihre Zählregel", () => {
    for (const z of md.split("\n").slice(2)) assert.ok(z.split("|")[3].trim().length > 10, z);
  });
});

describe("harness-kennzahlen: Fehlerfälle (fail-closed)", () => {
  test("Config-Block fehlt", () => {
    assert.throws(() => gen({ rootDir: fixture(REPO), config: { markdown: [] } }), /kennzahlen.*fehlt/);
  });
  test("Kette fehlt in package.json", () => {
    const root = fixture({ ...REPO, "package.json": JSON.stringify({ scripts: { verify: "npm run a" } }) });
    assert.throws(() => gen({ rootDir: root, config: KONFIG }), /Kette "verify:full" fehlt/);
  });
  test("Ordner der Config fehlt (veraltete Config)", () => {
    const root = fixture({ ...REPO });
    const kaputt = { ...KONFIG, kennzahlen: { ...(KONFIG.kennzahlen as object), workflows: ".github/weg" } };
    assert.throws(() => gen({ rootDir: root, config: kaputt }), /Workflow-Ordner.*nicht gefunden/);
  });
  test("ADR mit falschem Kopf: Fehler statt falscher Zahl", () => {
    const root = fixture({ ...REPO, "docs/adr/0003-c.md": "# Kein ADR-Kopf\n" });
    assert.throws(() => gen({ rootDir: root, config: KONFIG }), /docs\/adr\/0003-c\.md/);
  });
});

describe("harness-kennzahlen: Negativfall der Zeile (ein Skript ohne docs:gen macht check:docgen rot)", () => {
  const S = "<!-- GEN:harness-kennzahlen START -->";
  const E = "<!-- GEN:harness-kennzahlen END -->";
  const generators = { "harness-kennzahlen": gen };

  test("aktuell nach docs:gen, rot nach einem zusätzlichen Skript, wieder grün nach docs:gen", () => {
    const root = fixture({ ...REPO, "README.md": `# Demo\n\n${S}\n${E}\n` });
    const schreibe = run({ rootDir: root, config: KONFIG, generators, write: true });
    assert.deepEqual(schreibe.errors, []);
    assert.deepEqual(run({ rootDir: root, config: KONFIG, generators }).stale, []);

    mkdirSync(join(root, "scripts"), { recursive: true });
    writeFileSync(join(root, "scripts", "neu.mjs"), "export {};");
    const rot = run({ rootDir: root, config: KONFIG, generators });
    assert.deepEqual(rot.stale.map((s) => `${s.file}:${s.section}`), ["README.md:harness-kennzahlen"]);

    run({ rootDir: root, config: KONFIG, generators, write: true });
    assert.deepEqual(run({ rootDir: root, config: KONFIG, generators }).stale, []);
  });

  test("auch ein neuer Wächter-Test, ein neuer Workflow und ein neues ADR machen den Abschnitt veraltet", () => {
    const neu: [string, string][] = [
      ["test/harness/neu.test.ts", marker("Neu")],
      [".github/workflows/neu.yml", "name: neu"],
      ["docs/adr/0003-neu.md", adr("0003")],
    ];
    for (const [pfad, inhalt] of neu) {
      const root = fixture({ ...REPO, "README.md": `# Demo\n\n${S}\n${E}\n` });
      run({ rootDir: root, config: KONFIG, generators, write: true });
      mkdirSync(join(root, pfad, ".."), { recursive: true });
      writeFileSync(join(root, pfad), inhalt);
      assert.equal(run({ rootDir: root, config: KONFIG, generators }).stale.length, 1, pfad);
    }
  });
});

describe("harness-kennzahlen: Registry und eingecheckte Abschnitte", () => {
  test("der Generator steht in der Registry", () => {
    assert.equal(GENERATORS["harness-kennzahlen"], gen);
  });
});

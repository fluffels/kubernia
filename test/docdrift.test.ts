/* Harness-Drift-Wächter (#529) – hält die "Doku als Kontext-Selektor" ehrlich,
 * jenseits der Datei-Landkarte (die bewacht #482 / docmap.test.ts).
 *
 * AGENTS.md lädt JEDE KI-Session als Kontext; README und die Befehls-Referenz
 * docs/referenz/befehle.md (#1078) werden on-demand gelesen.
 * Sie nennen `npm run <x>`-Kommandos (die es geben muss) und verweisen mit vielen
 * internen Markdown-Links + `#ankern` quer auf andere Harness-Docs. Beides veraltet
 * leise – ein Agent tippt dann ein totes Kommando oder folgt einem toten Link.
 * Dieser Test macht genau diesen Drift ROT. Fitness-Function-Kategorie neben
 * layering/filesize/docmap (#390/#482), nicht mit Verhaltens-Tests vermischen.
 *
 * Prüf-Logik importiert aus scripts/check-docdrift.mjs (EINE Quelle der Wahrheit
 * mit der CLI `npm run check:docdrift`).
 *
 * Ausführen mit:  npm test   (oder gezielt: npm run check:docdrift)
 */
import { describe, test } from "vitest";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Reines Node-Tooling-Skript ohne Declaration-File (allowJs aus, scripts/ nicht im tsconfig)
// – der Laufzeit-Import genügt, die Typen deklarieren wir hier lokal.
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as checkDocDrift from "../scripts/check-docdrift.mjs";

const parseNpmRunMentions: (md: string) => Set<string> = checkDocDrift.parseNpmRunMentions;
const extractLinks: (md: string) => { target: string; path: string; anchor: string }[] =
  checkDocDrift.extractLinks;
const slugify: (t: string) => string = checkDocDrift.slugify;
const collectHeadingSlugs: (md: string) => string[] = checkDocDrift.collectHeadingSlugs;
const auditDocDrift: () => {
  deadCommands: { file: string; script: string }[];
  undocumentedScripts: string[];
  deadLinks: { file: string; target: string; resolved: string }[];
  deadAnchors: { file: string; target: string; resolved: string; anchor: string }[];
  verifyChainViolations: { file: string; chain: string[]; missing: string[] }[];
} = checkDocDrift.auditDocDrift;
const parseVerifyChain: (pkgScripts: Record<string, string>) => string[] = checkDocDrift.parseVerifyChain;
const findDocumentedVerifyChains: (md: string) => string[][] = checkDocDrift.findDocumentedVerifyChains;
// Neue Bindings (#1091) typisiert per Assertion statt per unsafe-Zugriff: der Alt-Bestand
// oben ist in eslint-suppressions.json eingefroren und soll nicht wachsen.
const { collectMarkdown, VERSIONED_CLAUDE_DIRS } = checkDocDrift as unknown as {
  collectMarkdown: (rootDir?: string) => string[];
  VERSIONED_CLAUDE_DIRS: Set<string>;
};

// Begründete Ausnahme wie in agents-md-native.test.ts: eng begrenzter Inline-Disable statt die
// Gate-Config-Baseline eslint-suppressions.json anzufassen (das .mjs hat kein .d.ts).
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
const CORE_DOCS: string[] = checkDocDrift.CORE_DOCS;

const audit = auditDocDrift();

describe("Harness-Doku-Drift (#529)", () => {
  test("jedes CORE_DOCS-Dokument existiert (#1078) – sonst zählte der Rückwärts-Check es still nicht mit", () => {
    // check-docdrift überspringt ein fehlendes Kern-Doc (`content.has(f)`); ohne diesen Test würde
    // ein Umbenennen von docs/referenz/befehle.md nur indirekt auffallen.
    const fehlend = CORE_DOCS.filter((f) => !existsSync(fileURLToPath(new URL(`../${f}`, import.meta.url))));
    assert.deepEqual(fehlend, [], "Kern-Doc(s) fehlen – Datei wiederherstellen oder CORE_DOCS nachziehen.");
    assert.ok(CORE_DOCS.includes("docs/referenz/befehle.md"), "die Befehls-Referenz muss Kern-Doc sein");
  });

  test("keine toten Kommandos: jedes dokumentierte `npm run <x>` existiert in package.json", () => {
    assert.deepEqual(
      audit.deadCommands.map((c) => `${c.file}: npm run ${c.script}`),
      [],
      "Diese in der Doku erwähnten npm-Skripte gibt es nicht (mehr) – Kommando korrigieren oder Skript anlegen.",
    );
  });

  test("keine undokumentierten Kern-Skripte: jedes package.json-Skript steht in AGENTS.md/README/docs/referenz/befehle.md", () => {
    assert.deepEqual(
      audit.undocumentedScripts,
      [],
      "Diese package.json-Skripte werden in keinem Kern-Doc erwähnt – dokumentieren oder (mit Begründung) in " +
        "scripts/check-docdrift.mjs › DOC_EXEMPT_SCRIPTS aufnehmen.",
    );
  });

  test("keine toten Links: jeder interne Markdown-Link zeigt auf eine existierende Datei", () => {
    assert.deepEqual(
      audit.deadLinks.map((l) => `${l.file}: „${l.target}" → ${l.resolved}`),
      [],
      "Diese internen Links zeigen ins Leere – Pfad korrigieren oder Ziel anlegen.",
    );
  });

  test("keine toten Anker: jeder `#anker` trifft eine reale Überschrift", () => {
    assert.deepEqual(
      audit.deadAnchors.map((a) => `${a.file}: „${a.target}" (#${a.anchor} fehlt in ${a.resolved})`),
      [],
      "Diese Anker-Links treffen keine Überschrift – Anker/Überschrift angleichen (GitHub-Slug-Regel).",
    );
  });

  test("keine veralteten verify-Ketten: alle typecheck→…→test-Sequenzen enthalten alle Gates", () => {
    assert.deepEqual(
      audit.verifyChainViolations.map(
        (v) => `${v.file}: fehlende Gates ${v.missing.join(", ")}`,
      ),
      [],
      "Diese Dateien dokumentieren eine unvollständige verify-Kette – an package.json angleichen.",
    );
  });

  // ── Red-Green: die Mechanik greift wirklich (ein immer-grüner Wächter wäre wertlos) ──

  test("parseNpmRunMentions erkennt `npm run x` und `npm test`, nicht `npm install`", () => {
    const found = parseNpmRunMentions(
      "Erst `npm install`, dann `npm run build:offline` und `npm test`, aber nicht npm audit.",
    );
    assert.equal(found.has("build:offline"), true);
    assert.equal(found.has("test"), true); // `npm test` → Skript `test`
    assert.equal(found.has("install"), false); // npm-Builtin, kein Skript
    assert.equal(found.has("audit"), false);
  });

  test("extractLinks liefert interne Links (mit Anker), lässt externe aus", () => {
    const md = [
      "Siehe [Regeln](AGENTS.md#konventionen) und [Karte](../CLAUDE.md).",
      "Extern: [Repo](https://github.com/fluffels/kubernia) und [Mail](mailto:x@y.z).",
      "Bild: ![Logo](assets/logo.png).",
    ].join("\n");
    const links = extractLinks(md);
    assert.deepEqual(
      links.map((l) => l.target),
      ["AGENTS.md#konventionen", "../CLAUDE.md", "assets/logo.png"],
      "Nur interne Links (inkl. Bild); http/mailto müssen ausgelassen sein.",
    );
    const anchored = links.find((l) => l.path === "AGENTS.md");
    assert.equal(anchored?.anchor, "konventionen");
  });

  test("extractLinks ignoriert Links in Code-Fences und Inline-Code", () => {
    const md = ["```", "[nur Beispiel](tote-datei.md)", "```", "Echt: [x](CLAUDE.md), Code: `[y](z.md)`."].join(
      "\n",
    );
    assert.deepEqual(
      extractLinks(md).map((l) => l.target),
      ["CLAUDE.md"],
      "Beispiel-Links in ```-Fences und `inline`-Code dürfen nicht als echte Links zählen.",
    );
  });

  test("slugify folgt der GitHub-Regel (Emoji/Em-Dash/Umlaute)", () => {
    assert.equal(slugify("Das Wichtigste zuerst (harte Regeln)"), "das-wichtigste-zuerst-harte-regeln");
    // Emoji + Em-Dash erzeugen führenden bzw. doppelten Bindestrich (echtes AGENTS.md-Beispiel):
    assert.equal(
      slugify("⭐ Oberste Regel — über allem, auch über den ADRs"),
      "-oberste-regel--über-allem-auch-über-den-adrs",
    );
  });

  test("parseVerifyChain extrahiert Gate-Reihenfolge aus package.json-verify-Skript", () => {
    const chain = parseVerifyChain({
      verify: "npm run typecheck && npm run lint && npm run check:arch && npm test",
    });
    assert.deepEqual(chain, ["typecheck", "lint", "check:arch", "test"]);
  });

  test("findDocumentedVerifyChains erkennt typecheck→…→test-Sequenz, nicht andere Pfeile", () => {
    const md = [
      "Fahre `npm run verify` (typecheck → lint → check:arch → test) und schau.",
      "Aber Build→Deploy→Test ist kein verify-Gate.",
    ].join("\n");
    const chains = findDocumentedVerifyChains(md);
    assert.equal(chains.length, 1);
    assert.deepEqual(chains[0], ["typecheck", "lint", "check:arch", "test"]);
  });

  test("findDocumentedVerifyChains erkennt Ketten auch in Code-Block-Kommentaren", () => {
    const md = "```bash\nnpm run verify   # typecheck → lint → check:arch → test\n```";
    const chains = findDocumentedVerifyChains(md);
    assert.equal(chains.length, 1, "Kette im Code-Kommentar muss erkannt werden (SKILL.md-Muster)");
  });

  test("auditVerifyChain meldet fehlende Gates in dokumentierter Kette (Red-Green)", () => {
    const pkgScripts = {
      verify: "npm run typecheck && npm run lint && npm run check:arch && npm run check:size && npm test",
    };
    // Kette ohne check:size dokumentiert → soll als Verletzung gemeldet werden
    const violations = checkDocDrift.auditVerifyChain(
      "",
      ["fake.md"],
      new Map([["fake.md", "npm run verify (typecheck → lint → check:arch → test)"]]),
      pkgScripts,
    );
    assert.equal(violations.length, 1);
    assert.deepEqual(violations[0]!.missing, ["check:size"]);
  });

  test("auditVerifyChain ist still bei vollständiger Kette", () => {
    const pkgScripts = {
      verify: "npm run typecheck && npm run lint && npm run check:arch && npm test",
    };
    const violations = checkDocDrift.auditVerifyChain(
      "",
      ["ok.md"],
      new Map([["ok.md", "verify: typecheck → lint → check:arch → test"]]),
      pkgScripts,
    );
    assert.equal(violations.length, 0);
  });

  test("collectHeadingSlugs überspringt Code-Fences und dedupliziert mit -1/-2", () => {
    const md = [
      "# Titel",
      "## Abschnitt",
      "```bash",
      "# kein Heading (bash-Kommentar)",
      "```",
      "## Abschnitt",
    ].join("\n");
    assert.deepEqual(collectHeadingSlugs(md), ["titel", "abschnitt", "abschnitt-1"]);
  });
});

// #1091: .claude war pauschal ausgeklammert – damit blieben Links/Anker/verify-Ketten in
// den versionierten Skills/Agenten ungeprüft. Gescannt werden jetzt genau die
// versionierten .claude-Unterordner; Worktrees und lokaler, untrackter Kram bleiben draußen.
describe("collectMarkdown: versionierte .claude-Ordner ja, Worktrees/Lokales nein (#1091)", () => {
  test("erfasst skills/agents/workflows, lässt worktrees, untrackte Ordner und node_modules aus", () => {
    const dir = mkdtempSync(join(tmpdir(), "kq-docdrift-"));
    try {
      const files = [
        "docs/x.md",
        ".claude/skills/a/SKILL.md",
        ".claude/agents/b.md",
        ".claude/workflows/c.md",
        ".claude/worktrees/kq-1/AGENTS.md", // Repo-Kopie eines parallelen Agenten
        ".claude/plugins/lokal.md", // untrackter .claude-Unterordner
        ".claude/lokal.md", // untrackte Datei direkt unter .claude
        "node_modules/pkg/README.md",
        "docs/.claude/y.md", // verschachteltes .claude: KEIN Root-.claude, wird normal gescannt
      ];
      for (const f of files) {
        mkdirSync(dirname(join(dir, f)), { recursive: true });
        writeFileSync(join(dir, f), "# x\n");
      }
      writeFileSync(join(dir, ".claude/settings.local.json"), "{}");
      assert.deepEqual(collectMarkdown(dir), [
        ".claude/agents/b.md",
        ".claude/skills/a/SKILL.md",
        ".claude/workflows/c.md",
        "docs/.claude/y.md",
        "docs/x.md",
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("VERSIONED_CLAUDE_DIRS deckt sich mit den !.claude/<ordner>/-Ausnahmen in .gitignore", () => {
    // Wird künftig ein weiterer .claude-Unterordner versioniert, darf er nicht still
    // ungescannt bleiben – und umgekehrt darf die Liste nichts Untracktes öffnen.
    const gitignore = readFileSync(fileURLToPath(new URL("../.gitignore", import.meta.url)), "utf8");
    const unignored = [...gitignore.matchAll(/^!\.claude\/([^/\s]+)\/\s*$/gm)].map((m) => m[1]).sort();
    assert.ok(unignored.length > 0, "Leerlauf-Schutz: keine !.claude/<ordner>/-Zeilen in .gitignore gefunden");
    assert.deepEqual([...VERSIONED_CLAUDE_DIRS].sort(), unignored);
  });
});

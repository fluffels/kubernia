/* Native-Load-Wächter (#1087, Nachfolger des Bridge-Wächters aus #992) – AGENTS.md wird von
 * Claude Code nur dann selbst geladen, wenn KEINE CLAUDE.md im Weg liegt.
 *
 * @harness-waechter – einziger Durchsetzer seiner Regel, darum im geschützten test/harness/ (#1165).
 *
 * Seit #1087 gibt es genau EINE Root-Kontextdatei: AGENTS.md (SSOT, jede harte Regel genau
 * einmal). Claude Code ≥ 2.1.277 lädt sie nativ – aber nur, solange im Projekt-Root weder
 * `CLAUDE.md` noch `.claude/CLAUDE.md` noch `CLAUDE.local.md` liegt. Taucht eine davon auf,
 * lädt Claude Code sie STATT AGENTS.md, und jede Session arbeitet still ohne die harten
 * Regeln. Ein Rückfallnetz (SessionStart-Hook) gibt es bewusst nicht (Entscheidung der
 * Maintainerin, Pre-Flight #1078). Der Wächter deckt zwei Fehlklassen ab:
 *
 *   1. **Eine CLAUDE.md taucht wieder auf.** Geprüft per `existsSync`, bewusst NICHT per
 *      `git ls-files`: `.claude/*` ist gitignored, und eine ungetrackte lokale Datei
 *      (`.claude/CLAUDE.md`, `CLAUDE.local.md`) schaltet das native Laden genauso ab.
 *      Folge: auch eine private `CLAUDE.local.md` macht `npm test` rot – gewollt.
 *   2. **Eine Datei beschreibt CLAUDE.md noch als Brücke.** Genau die Prosa-Drift, die #992
 *      auslöste (Peripherie schrieb eine abgelegte Rolle fort). `check:docdrift` (#529) sieht
 *      nur Kommandos/Links/Anker, keine Rollen-Behauptungen. Hier werden sie ROT.
 *
 * Grenze (bewusst, ehrlich): Der Wächter beweist nicht, dass Claude Code AGENTS.md wirklich
 * lädt – das ist eine Zusage der offiziellen Claude-Code-Doku, keine Repo-Tatsache. Er hält
 * nur die Voraussetzung dafür (keine CLAUDE.md) und fängt die abgelegten Rollen-Begriffe
 * (RETIRED_ROLE_CLAIMS) neben einer CLAUDE.md-Erwähnung, nicht jede Falschbeschreibung.
 *
 * Fitness-Function-Kategorie neben layering/filesize/docmap/docdrift (#390/#482/#529),
 * nicht mit Verhaltens-Tests vermischen. Bewusst **ohne** eigenes `scripts/check-*.mjs`:
 * `scripts/check-` ist gate-config-geschützt (Goodhart-Guard #903, Label-Pflicht), und
 * für rein doku-strukturelle Wächter gibt es die etablierte test-only-Familie
 * (`test/readme.test.ts`, `test/build-config.test.ts`, `test/forum-board-prio.test.ts`).
 *
 * Fence-Logik + Markdown-Inventar importiert aus scripts/check-docdrift.mjs (EINE
 * Quelle der Wahrheit für „was in diesem Repo als Codeblock gilt" bzw. „welche
 * Markdown-Dateien gehören zum Repo").
 *
 * Ausführen mit:  npm test
 */
import { describe, test } from "vitest";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// Reines Node-Tooling-Skript ohne Declaration-File (allowJs aus, scripts/ nicht im tsconfig)
// – der Laufzeit-Import genügt, die Typen deklarieren wir hier lokal.
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as checkDocDrift from "../../scripts/check-docdrift.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as checkInternalRefs from "../../scripts/check-internalrefs.mjs";

// Begründete Ausnahme: das .mjs hat kein Declaration-File, der Namespace ist für tsc
// „error typed". Die Schwester-Tests (docdrift/docmap/context-size) haben dafür Einträge
// in der Bulk-Baseline eslint-suppressions.json; hier bleibt es bewusst ein sichtbarer,
// eng begrenzter Inline-Disable — statt eine Gate-Config-Datei anzufassen.
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
const stripFencedCode: (md: string) => string = checkDocDrift.stripFencedCode;
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
const collectMarkdown: (rootDir?: string) => string[] = checkDocDrift.collectMarkdown;
// Getrackte Dateien per `git ls-files -z` (quotepath-sicher) – dieselbe Quelle wie check:internalrefs.
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
const listTrackedFiles: (rootDir?: string) => string[] = checkInternalRefs.listTrackedFiles;

const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const read = (rel: string) => readFileSync(fileURLToPath(new URL(`../../${rel}`, import.meta.url)), "utf8");

/**
 * Die Projekt-Memory-Dateien, deren bloße Existenz das native Laden von AGENTS.md abschaltet
 * (Claude-Code-Doku › Memory › AGENTS.md). `~/.claude/CLAUDE.md` zählt nicht – die liegt
 * außerhalb des Repos. Eine CLAUDE.md in einem Unterordner (z.B. `src/`) ist ebenfalls kein
 * Projekt-Memory des Roots und bleibt hier bewusst außen vor.
 */
const BLOCKING_MEMORY_FILES = ["CLAUDE.md", ".claude/CLAUDE.md", "CLAUDE.local.md"];

/** Welche der blockierenden Memory-Dateien liegen im Root `rootDir` (per existsSync, auch ungetrackt)? */
function blockingMemoryFiles(rootDir: string): string[] {
  return BLOCKING_MEMORY_FILES.filter((rel) => existsSync(join(rootDir, rel)));
}

/**
 * Rollen-Behauptungen über CLAUDE.md, die es nicht mehr gibt – samt neuer Heimat für die
 * Fehlermeldung. Steht so ein Begriff in derselben Zeile wie eine CLAUDE.md-Erwähnung,
 * beschreibt die Datei eine Rolle, die CLAUDE.md abgegeben hat (bzw. seit #1087 eine Datei,
 * die es gar nicht mehr gibt).
 * **Escape-Hatch** (Backticks = Zitat, keine Behauptung): Wer den Begriff diskutieren muss,
 * setzt ihn in Inline-Backticks oder schreibt ihn ohne die Datei in derselben Zeile.
 */
const RETIRED_ROLE_CLAIMS: { term: string; home: string; pattern?: RegExp }[] = [
  {
    term: "Brücke",
    pattern: /Br(ü|ue)cke/i,
    home: "seit #1087 gibt es keine CLAUDE.md mehr – Claude Code lädt AGENTS.md nativ",
  },
  // Im Markdown steht die Import-Zeile meist als `@AGENTS.md`-Import; die Backtick-Strippung
  // lässt davon nur „-Import" übrig. Darum das Substantiv „Import" als eigenes Wort (auch nach
  // Bindestrich) – bewusst NICHT „importiert"/„Import-Zyklus", die treffen Schichtregel-Prosa.
  {
    term: "@AGENTS.md-Import",
    pattern: /(?:^|[\s(-])Import(?![\w-])/,
    home: "seit #1087 zieht keine CLAUDE.md mehr AGENTS.md per @-Import – Claude Code lädt AGENTS.md nativ",
  },
  {
    term: "Schnellstart",
    home: "seit #992 hat AGENTS.md den Ticket-Ablauf und CONTRIBUTING.md das Setup",
  },
  {
    term: "Datei-für-Datei",
    home: "die Repo-Landkarte (docs/referenz/) ist seit #907 Subsystem-granular – Datei-Granularität steckt in den docs/module/-Tiefendocs",
  },
  // Umschreibung derselben abgelegten Rolle (#1002/#1064), als tolerantes Muster statt
  // Variantenliste; bewusst NICHT „in welcher Schicht" – das beschreibt korrekt die Schichtregeln.
  {
    term: "welche Datei welche Schicht",
    pattern: /welche Datei,?\s+welche Schicht/i,
    home: "die Repo-Landkarte (docs/referenz/) ist seit #907 Subsystem-granular – Datei-Granularität steckt in den docs/module/-Tiefendocs",
  },
];

/**
 * Versionierte Agenten-Konfiguration (#1002/#1064): Skills, Agents, Workflows unter `.claude/`.
 * Deren Markdown erfasst seit #1091 auch `collectMarkdown`; nötig bleibt dieser Walk für
 * `.js`, weil die Workflow-Prompts als Freitext in `.claude/workflows/*.js` stehen. Quelle ist
 * `git ls-files` (Worktrees sind nie versioniert); `.claude/worktrees/` zusätzlich explizit aus.
 */
function isVersionedAgentConfig(path: string): boolean {
  return path.startsWith(".claude/") && !path.startsWith(".claude/worktrees/") && /\.(md|js)$/.test(path);
}

function collectAgentConfig(): string[] {
  return listTrackedFiles(REPO_ROOT).filter(isVersionedAgentConfig);
}

/**
 * Zeilen in `md`, die CLAUDE.md eine abgelegte Rolle zuschreiben. Codeblöcke und
 * Inline-Backticks sind ausgeblendet (Zitat ≠ Behauptung).
 */
function retiredRoleClaims(md: string): { line: number; term: string; home: string; text: string }[] {
  const found: { line: number; term: string; home: string; text: string }[] = [];
  stripFencedCode(md)
    .split(/\r?\n/)
    .forEach((raw, i) => {
      // Die Datei zählt auch in Backticks (`CLAUDE.md` ist die übliche Schreibweise) – nur der
      // BEGRIFF in Backticks ist ein Zitat. Sonst rutschte jede Behauptung per Backticks durch.
      if (!raw.includes("CLAUDE.md")) return;
      const line = raw.replace(/`[^`\n]*`/g, "");
      for (const { term, home, pattern } of RETIRED_ROLE_CLAIMS) {
        if (pattern ? pattern.test(line) : line.includes(term)) found.push({ line: i + 1, term, home, text: raw.trim().slice(0, 120) });
      }
    });
  return found;
}

describe("Keine CLAUDE.md verdrängt das native Laden von AGENTS.md (#1087)", () => {
  test("im Repo-Root liegt weder CLAUDE.md noch .claude/CLAUDE.md noch CLAUDE.local.md", () => {
    // Anker: zeigt REPO_ROOT nach einem Umzug in die falsche Tiefe, fände die Prüfung unten
    // dort nie eine CLAUDE.md und bliebe still grün (Review #1165/#1177). Bewusst package.json
    // statt AGENTS.md: modul-lokale AGENTS.md (#1168) gibt es auch in Unterordnern.
    assert.ok(existsSync(join(REPO_ROOT, "package.json")), `REPO_ROOT ist nicht der Repo-Root: ${REPO_ROOT}`);
    assert.deepEqual(
      blockingMemoryFiles(REPO_ROOT),
      [],
      "Gefunden – bitte löschen (bzw. den Inhalt nach AGENTS.md überführen). Solange eine dieser Dateien " +
        "im Projekt-Root liegt, lädt Claude Code sie STATT AGENTS.md; jede Session liefe dann still ohne die " +
        "harten Regeln der SSOT. Auch ungetrackte lokale Dateien zählen (darum existsSync, nicht git ls-files).",
    );
  });

  test("Erkennung greift wirklich (Red-Green): jede Variante trifft, Unterordner nicht", () => {
    // No-op-Schutz: ein Wächter, der immer grün ist, wäre wertlos.
    const dir = mkdtempSync(join(tmpdir(), "kq-agents-native-"));
    try {
      assert.deepEqual(blockingMemoryFiles(dir), [], "leerer Root ist sauber");
      mkdirSync(join(dir, "src"));
      writeFileSync(join(dir, "src", "CLAUDE.md"), "x");
      assert.deepEqual(blockingMemoryFiles(dir), [], "CLAUDE.md im Unterordner ist kein Root-Memory");
      // Bewusst ein festes Literal statt BLOCKING_MEMORY_FILES: sonst fiele mit einem gestrichenen
      // Pfad auch sein Prüffall weg, und die Selbstprobe bliebe grün (Sabotage-Befund im Review).
      for (const rel of ["CLAUDE.md", ".claude/CLAUDE.md", "CLAUDE.local.md"]) {
        const sub = mkdtempSync(join(tmpdir(), "kq-agents-native-"));
        try {
          mkdirSync(join(sub, ".claude"));
          writeFileSync(join(sub, rel), "x");
          assert.deepEqual(blockingMemoryFiles(sub), [rel], `${rel} muss treffen`);
        } finally {
          rmSync(sub, { recursive: true, force: true });
        }
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("Kein Markdown beschreibt CLAUDE.md noch in einer abgelegten Rolle (#992/#1087)", () => {
  test("kein Markdown im Repo schreibt CLAUDE.md eine abgelegte Rolle zu", () => {
    const violations: string[] = [];
    for (const file of new Set([...collectMarkdown(REPO_ROOT), ...collectAgentConfig()])) {
      for (const v of retiredRoleClaims(read(file))) {
        violations.push(`${file}:${v.line} nennt CLAUDE.md „${v.term}" – ${v.home}. Zeile: „${v.text}"`);
      }
    }
    assert.deepEqual(
      violations,
      [],
      "Veraltete Rollen-Beschreibung von CLAUDE.md gefunden. Entweder die Beschreibung nachziehen " +
        "(AGENTS.md ist die einzige Root-Kontextdatei, nativ geladen) oder – wenn der Begriff bewusst " +
        `zitiert wird, etwa in einem ADR – in Inline-Backticks setzen:\n${violations.join("\n")}`,
    );
  });

  test("Erkennung greift wirklich (Red-Green): Behauptung ja, Zitat/andere Datei nein", () => {
    assert.deepEqual(
      retiredRoleClaims("[CLAUDE.md](CLAUDE.md) ist nur noch die **Brücke** hierher.").map((v) => [v.line, v.term]),
      [[1, "Brücke"]],
      "die alte Brücken-Behauptung muss zählen",
    );
    assert.deepEqual(
      retiredRoleClaims("CLAUDE.md zieht AGENTS.md per `@AGENTS.md`-Import.").map((v) => v.term),
      ["@AGENTS.md-Import"],
      "die Import-Behauptung muss auch mit gebacktickter Import-Zeile zählen",
    );
    assert.equal(retiredRoleClaims("CLAUDE.md ist die Bruecke.").length, 1, "ASCII-Umschrift zählt auch");
    assert.equal(retiredRoleClaims("CLAUDE.md: BRÜCKE zu AGENTS.md").length, 1, "Groß-/Kleinschreibung egal");
    assert.deepEqual(retiredRoleClaims("CLAUDE.md steht in der ReImportliste."), [], "Import mitten im Wort ist kein Substantiv");
    assert.deepEqual(
      retiredRoleClaims("CLAUDE.md ist der Schnellstart.").map((v) => [v.line, v.term]),
      [[1, "Schnellstart"]],
    );
    assert.deepEqual(
      retiredRoleClaims("[CLAUDE.md](CLAUDE.md) ist die Datei-für-Datei-Landkarte.").map((v) => v.term),
      ["Datei-für-Datei"],
      "auch als Markdown-Link muss sie zählen",
    );
    assert.deepEqual(
      retiredRoleClaims("- **[CLAUDE.md](CLAUDE.md)** — Repo-Landkarte (welche Datei welche Schicht/Zweck).").map((v) => v.term),
      ["welche Datei welche Schicht"],
      "die Umschreibung aus #1002 muss zählen",
    );
    assert.equal(retiredRoleClaims("Siehe CLAUDE.md: welche Datei,  welche Schicht.").length, 1, "Varianten mit Komma/Leerraum");
    assert.deepEqual(retiredRoleClaims("Die `Brücke` in CLAUDE.md gibt es nicht mehr."), [], "Begriff in Backticks = Zitat");
    assert.deepEqual(
      retiredRoleClaims("`CLAUDE.md`: die Brücke dorthin.").map((v) => v.term),
      ["Brücke"],
      "die Datei in Backticks ist KEIN Freibrief – sonst rutscht jede Behauptung durch",
    );
    assert.deepEqual(
      retiredRoleClaims("Seit #1087 lädt Claude Code AGENTS.md nativ; eine CLAUDE.md importiert nichts, kein Import-Zyklus."),
      [],
      "„importiert\"/„Import-Zyklus\" sind keine Import-Behauptung",
    );
    assert.deepEqual(retiredRoleClaims("```\nCLAUDE.md ist die Brücke\n```\n"), [], "im Codeblock zählt nicht");
    assert.deepEqual(retiredRoleClaims("AGENTS.md ist die Brücke zur README."), [], "ohne CLAUDE.md keine Behauptung");
    assert.deepEqual(
      retiredRoleClaims("Welche Datei in welcher Schicht liegt, steht in CLAUDE.md › Schichtregeln."),
      [],
      "die korrekte Schichtregel-Beschreibung ist keine abgelegte Rolle",
    );
  });

  test("versionierte .claude/-Konfiguration wird mitgeprüft, Parallel-Worktrees nicht (#1002)", () => {
    assert.ok(isVersionedAgentConfig(".claude/skills/kubernia/SKILL.md"));
    assert.ok(isVersionedAgentConfig(".claude/workflows/kubernia-ticket.js"), "Workflow-Prompts stehen in .js");
    assert.ok(!isVersionedAgentConfig(".claude/worktrees/kq-1/AGENTS.md"), "Worktrees paralleler Agenten nicht");
    assert.ok(!isVersionedAgentConfig(".claude/settings.json"));
    assert.ok(collectAgentConfig().includes(".claude/agents/kubernia-planner.md"), "Inventar ist nicht leer");
  });
});

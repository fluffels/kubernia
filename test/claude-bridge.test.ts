/* Bridge-Wächter (#992) – CLAUDE.md muss AGENTS.md wirklich IN den Kontext ziehen,
 * und die Rollentrennung muss überall gleich beschrieben sein.
 *
 * Rollentrennung seit #992: jede harte Regel steht genau einmal in AGENTS.md, CLAUDE.md
 * ist nur die Brücke dorthin (+ die Nachschlage-Tabellen). Der Wächter deckt die zwei
 * Fehlklassen ab, die diese Trennung leise aushöhlen:
 *
 *   1. **Die Brücke trägt nicht mehr.** Claude Code lädt `CLAUDE.md` automatisch,
 *      `AGENTS.md` **nicht** – ein reiner Prosa-Zeiger setzt darauf, dass jeder Agent
 *      freiwillig nachliest. Deshalb steht in CLAUDE.md die Import-Zeile `@AGENTS.md`.
 *      Genau die kann still verschwinden (jemand formt den Kopf um, verschiebt sie in
 *      einen Codeblock, setzt sie in Backticks) – danach liest ein Agent nur noch die
 *      halbe Wahrheit, ohne dass irgendein Gate meckert.
 *   2. **Eine Datei beschreibt CLAUDE.mds Rolle falsch.** Genau das war die Drift, die
 *      #992 überhaupt auslöste: Schnellstart/Datei-Landkarte wanderten weg, aber die
 *      Peripherie (README, docs/agent-harness.md, ADR 0008) schrieb die alte Rolle
 *      weiter fort. `check:docdrift` (#529) prüft nur Kommandos/Links/Anker und sieht
 *      solche Prosa-Behauptungen nicht. Hier werden sie ROT.
 *
 * Grenze dieses Wächters (bewusst, ehrlich): Er ist kein Semantik-Prüfer. Er fängt die
 * konkret **abgelegten** Rollen-Begriffe (RETIRED_ROLE_CLAIMS) neben einer CLAUDE.md-
 * Erwähnung, nicht jede denkbare Falschbeschreibung. Dass CLAUDE.md nicht wieder zur
 * Parallel-Doku wächst, bleibt Review-Disziplin + `check:contextsize` (#719).
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
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Reines Node-Tooling-Skript ohne Declaration-File (allowJs aus, scripts/ nicht im tsconfig)
// – der Laufzeit-Import genügt, die Typen deklarieren wir hier lokal.
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as checkDocDrift from "../scripts/check-docdrift.mjs";

// Begründete Ausnahme: das .mjs hat kein Declaration-File, der Namespace ist für tsc
// „error typed". Die Schwester-Tests (docdrift/docmap/context-size) haben dafür Einträge
// in der Bulk-Baseline eslint-suppressions.json; hier bleibt es bewusst ein sichtbarer,
// eng begrenzter Inline-Disable — statt eine Gate-Config-Datei anzufassen.
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
const stripFencedCode: (md: string) => string = checkDocDrift.stripFencedCode;
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
const collectMarkdown: (rootDir?: string) => string[] = checkDocDrift.collectMarkdown;

const REPO_ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (rel: string) => readFileSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)), "utf8");

/**
 * Zeilennummern (1-basiert), in denen `md` die Datei `target` per `@pfad`-Import zieht –
 * also so, dass Claude Code sie wirklich mitlädt. Bewusst streng: Vorkommen in einem
 * Codeblock (```) oder in Inline-Backticks sind ZITATE, kein wirksamer Import.
 */
function bridgeImportLines(md: string, target: string): number[] {
  const escaped = target.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`(?:^|\\s)@${escaped}(?=\\s|$)`);
  const found: number[] = [];
  stripFencedCode(md)
    .split(/\r?\n/)
    .forEach((line, i) => {
      if (re.test(line.replace(/`[^`\n]*`/g, ""))) found.push(i + 1);
    });
  return found;
}

/**
 * Rollen-Behauptungen über CLAUDE.md, die es nicht mehr gibt – samt neuer Heimat für die
 * Fehlermeldung. Steht so ein Begriff in derselben Zeile wie eine CLAUDE.md-Erwähnung,
 * beschreibt die Datei eine Rolle, die CLAUDE.md abgegeben hat.
 * **Escape-Hatch** (gleiche Logik wie beim Import: Backticks = Zitat, keine Behauptung):
 * Wer den Begriff diskutieren muss („der Schnellstart steht NICHT in CLAUDE.md"), setzt
 * ihn in Inline-Backticks oder schreibt ihn ohne die Datei in derselben Zeile.
 */
const RETIRED_ROLE_CLAIMS: { term: string; home: string }[] = [
  {
    term: "Schnellstart",
    home: "seit #992 hat AGENTS.md den Ticket-Ablauf und CONTRIBUTING.md das Setup; CLAUDE.md ist die Brücke + die Referenz-Tabellen",
  },
  {
    term: "Datei-für-Datei",
    home: "die Landkarte in CLAUDE.md ist seit #907 Subsystem-granular – Datei-Granularität steckt in den docs/module/-Tiefendocs",
  },
];

/**
 * Zeilen in `md`, die CLAUDE.md eine abgelegte Rolle zuschreiben. Codeblöcke und
 * Inline-Backticks sind ausgeblendet (Zitat ≠ Behauptung).
 */
function retiredRoleClaims(md: string): { line: number; term: string; home: string; text: string }[] {
  const found: { line: number; term: string; home: string; text: string }[] = [];
  stripFencedCode(md)
    .split(/\r?\n/)
    .forEach((raw, i) => {
      const line = raw.replace(/`[^`\n]*`/g, "");
      if (!line.includes("CLAUDE.md")) return;
      for (const { term, home } of RETIRED_ROLE_CLAIMS) {
        if (line.includes(term)) found.push({ line: i + 1, term, home, text: raw.trim().slice(0, 120) });
      }
    });
  return found;
}

const claudeMd = read("CLAUDE.md");
const agentsMd = read("AGENTS.md");

describe("CLAUDE.md ist eine tragende Brücke zu AGENTS.md (#992)", () => {
  test("CLAUDE.md zieht AGENTS.md per @-Import in JEDE Session", () => {
    assert.notDeepEqual(
      bridgeImportLines(claudeMd, "AGENTS.md"),
      [],
      "In CLAUDE.md fehlt die wirksame Import-Zeile `@AGENTS.md` (nicht in einem Codeblock, nicht in Backticks). " +
        "Ohne sie ist AGENTS.md nur noch ein Prosa-Zeiger – Claude Code lädt es nicht automatisch.",
    );
  });

  test("kein Import-Zyklus: AGENTS.md importiert CLAUDE.md NICHT zurück", () => {
    assert.deepEqual(
      bridgeImportLines(agentsMd, "CLAUDE.md"),
      [],
      "AGENTS.md darf CLAUDE.md nur per Markdown-Link erwähnen, nicht per @-Import – sonst laden sich die " +
        "beiden Root-Kontextdateien gegenseitig auf.",
    );
  });

  test("Erkennung greift wirklich (Red-Green): echter Import ja, Zitat/Fehlen nein", () => {
    // No-op-Schutz: ein Wächter, der immer grün ist, wäre wertlos.
    assert.deepEqual(bridgeImportLines("Kopfzeile\n\n@AGENTS.md\n", "AGENTS.md"), [3], "echter Import muss zählen");
    assert.deepEqual(bridgeImportLines("Nur Prosa: siehe [AGENTS.md](AGENTS.md).", "AGENTS.md"), []);
    assert.deepEqual(bridgeImportLines("```\n@AGENTS.md\n```\n", "AGENTS.md"), [], "im Codeblock zählt nicht");
    assert.deepEqual(bridgeImportLines("Schreibe `@AGENTS.md` in die Datei.", "AGENTS.md"), [], "Backticks zählen nicht");
    assert.deepEqual(bridgeImportLines("@AGENTS.md.bak", "AGENTS.md"), [], "Teil-Treffer eines anderen Pfads zählt nicht");
  });
});

describe("Die Rolle von CLAUDE.md ist überall gleich beschrieben (#992)", () => {
  test("kein Markdown im Repo schreibt CLAUDE.md eine abgelegte Rolle zu", () => {
    const violations: string[] = [];
    for (const file of collectMarkdown(REPO_ROOT)) {
      for (const v of retiredRoleClaims(read(file))) {
        violations.push(`${file}:${v.line} nennt CLAUDE.md „${v.term}" – ${v.home}. Zeile: „${v.text}"`);
      }
    }
    assert.deepEqual(
      violations,
      [],
      "Veraltete Rollen-Beschreibung von CLAUDE.md gefunden. Entweder die Beschreibung nachziehen " +
        "(Brücke zu AGENTS.md + Referenz-Tabellen) oder – wenn der Begriff bewusst zitiert wird – in " +
        `Inline-Backticks setzen:\n${violations.join("\n")}`,
    );
  });

  test("Erkennung greift wirklich (Red-Green): Behauptung ja, Zitat/andere Datei nein", () => {
    assert.deepEqual(
      retiredRoleClaims("CLAUDE.md ist der Schnellstart.").map((v) => [v.line, v.term]),
      [[1, "Schnellstart"]],
      "eine echte Rollen-Behauptung muss zählen",
    );
    assert.deepEqual(
      retiredRoleClaims("[CLAUDE.md](CLAUDE.md) ist die Datei-für-Datei-Landkarte.").map((v) => v.term),
      ["Datei-für-Datei"],
      "auch als Markdown-Link muss sie zählen",
    );
    assert.deepEqual(retiredRoleClaims("Der `Schnellstart` steht nicht mehr in CLAUDE.md."), [], "Backticks = Zitat");
    assert.deepEqual(retiredRoleClaims("```\nCLAUDE.md ist der Schnellstart\n```\n"), [], "im Codeblock zählt nicht");
    assert.deepEqual(retiredRoleClaims("AGENTS.md trägt den Schnellstart."), [], "ohne CLAUDE.md keine Behauptung");
  });
});

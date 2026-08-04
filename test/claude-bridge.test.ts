/* Bridge-Wächter (#992) – CLAUDE.md muss AGENTS.md wirklich IN den Kontext ziehen.
 *
 * Rollentrennung seit #992: jede harte Regel steht genau einmal in AGENTS.md, CLAUDE.md
 * ist nur die Brücke dorthin (+ die Nachschlage-Tabellen). Diese Brücke trägt aber nur,
 * wenn sie technisch greift: Claude Code lädt `CLAUDE.md` automatisch, `AGENTS.md`
 * **nicht** – ein reiner Prosa-Zeiger setzt darauf, dass jeder Agent freiwillig
 * nachliest. Deshalb steht in CLAUDE.md die Import-Zeile `@AGENTS.md`.
 *
 * Genau die kann still verschwinden (jemand formt den Kopf um, verschiebt sie in einen
 * Codeblock, setzt sie in Backticks) – und danach liest ein Agent nur noch die halbe
 * Wahrheit, ohne dass irgendein Gate meckert. Dieser Test macht das ROT.
 * Fitness-Function-Kategorie neben layering/filesize/docmap/docdrift (#390/#482/#529),
 * nicht mit Verhaltens-Tests vermischen.
 *
 * Fence-Logik importiert aus scripts/check-docdrift.mjs (EINE Quelle der Wahrheit für
 * „was in diesem Repo als Codeblock gilt").
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

/* Root-Kontextdatei-Wächter (#719) – Frühwarnung gegen unbegrenzt wachsende AGENTS.md/
 * CLAUDE.md. Analog zu test/filesize.test.ts (#390), aber für die Dateien, die JEDE
 * Agenten-Session vollständig lädt statt für src/-Module.
 *
 * Die Mess-/Allowlist-Logik wird aus scripts/check-context-size.mjs importiert – EINE
 * Quelle der Wahrheit (kein Auseinanderdriften zwischen Test und CLI).
 *
 * Ausführen mit:  npm test   (oder gezielt: npm run check:contextsize)
 */
import { describe, test } from "vitest";
import assert from "node:assert/strict";

// Reines Node-Tooling-Skript ohne Declaration-File (allowJs ist aus, scripts/ nicht im
// tsconfig-include) – der Laufzeit-Import genügt, die Typen deklarieren wir hier lokal.
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as checkContextSize from "../scripts/check-context-size.mjs";

type Budget = { file: string; budget: number };
type Sized = { file: string; loc: number; budget: number };
type Allow = { file: string; reason: string };

const CONTEXT_BUDGETS: Budget[] = checkContextSize.CONTEXT_BUDGETS;
const ALLOWLIST: Allow[] = checkContextSize.ALLOWLIST;
const collectContextSizes: (rootDir?: string, budgets?: Budget[]) => Sized[] = checkContextSize.collectContextSizes;
const findOversized: (sizes: Sized[]) => Sized[] = checkContextSize.findOversized;

const sizes = collectContextSizes();
const allowedFiles = new Set(ALLOWLIST.map((a) => a.file));

describe("Root-Kontextdatei-Budget (#719)", () => {
  test("kein Root-Kontextfile über seinem Zeilen-Budget (außer dokumentierten Ausnahmen)", () => {
    const violations = findOversized(sizes).filter((s) => !allowedFiles.has(s.file));
    assert.deepEqual(
      violations,
      [],
      `Root-Kontextdateien über Budget ohne Allowlist-Eintrag:\n` +
        violations.map((v) => `  ${v.file}: ${v.loc}/${v.budget}`).join("\n") +
        `\nInhalt auslagern (modul-lokale AGENTS.md / docs/module/*.md) oder – mit offenem Ticket – ` +
        `in scripts/check-context-size.mjs allowlisten.`,
    );
  });

  test("Allowlist ist ehrlich: jeder Eintrag liegt wirklich noch über seinem Budget (sonst stale)", () => {
    // Sobald eine Auslagerung die Datei unter ihr Budget bringt, wird der Eintrag stale
    // und dieser Test bricht – das erinnert daran, die Ausnahme wieder zu entfernen.
    const byFile = new Map(sizes.map((s) => [s.file, s]));
    const stale = ALLOWLIST.filter((a) => {
      const s = byFile.get(a.file);
      return s === undefined || s.loc <= s.budget;
    });
    assert.deepEqual(
      stale,
      [],
      `Stale Allowlist-Einträge (Datei nicht mehr über Budget oder unbekannt) – aus ` +
        `scripts/check-context-size.mjs entfernen:\n` +
        stale.map((a) => `  ${a.file}`).join("\n"),
    );
  });

  test("jede konfigurierte Root-Kontextdatei existiert wirklich und wird gemessen", () => {
    for (const b of CONTEXT_BUDGETS) {
      const s = sizes.find((x) => x.file === b.file);
      assert.ok(s && s.loc > 0, `${b.file} sollte existieren und nicht leer sein`);
    }
  });

  test("Detektion greift wirklich (Red-Green): Budget 1 trifft jede Datei, Budget riesig keine", () => {
    // No-op-Schutz: ein Wächter, der immer grün ist, wäre wertlos.
    const tinyBudgets = CONTEXT_BUDGETS.map((b) => ({ ...b, budget: 1 }));
    const hugeBudgets = CONTEXT_BUDGETS.map((b) => ({ ...b, budget: 1_000_000 }));
    const tiny = findOversized(collectContextSizes(undefined, tinyBudgets)).length;
    const huge = findOversized(collectContextSizes(undefined, hugeBudgets)).length;
    assert.equal(tiny, CONTEXT_BUDGETS.length, "Budget 1 sollte für jede Datei einen Treffer liefern.");
    assert.equal(huge, 0, "Ein riesiges Budget sollte nichts melden.");
  });
});

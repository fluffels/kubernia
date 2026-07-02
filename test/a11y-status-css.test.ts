import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/* #491 (Barrierefreiheit, Dimension 1 „Status nicht nur über Farbe"): Quiz- und
 * Dialog-Antworten färben sich richtig=grün / falsch=rot. Reine Farbe verliert
 * Rot-Grün-Sehschwäche – darum trägt ein farbunabhängiger Symbol-Shape (✓/✗) die
 * Information zusätzlich. Er wird per ::after auf .correct/.wrong gesetzt. Dieser
 * Test sichert die Stilregel als CSS-Inhalt ab, weil eine reine ::after-content-
 * Regel sonst von keinem Unit-Test berührt wird (Red-Green: ohne die content-Zeile
 * schlägt er fehl). Analog zu dialog-badge-css.test.ts (#364). */

const css = readFileSync(
  fileURLToPath(new URL("../style.css", import.meta.url)),
  "utf8",
);

/** Den Regelblock ab einem Selektor bis zur schließenden Klammer herausschneiden. */
function ruleBlock(selector: string): string {
  const start = css.indexOf(selector);
  expect(start, `Selektor „${selector}" nicht in style.css gefunden`).toBeGreaterThanOrEqual(0);
  const open = css.indexOf("{", start);
  const close = css.indexOf("}", open);
  return css.slice(open, close);
}

describe("#491: farbunabhängiger Antwort-Marker (✓/✗) an Quiz + Dialog", () => {
  it("die richtige Antwort bekommt ein ✓ per ::after", () => {
    const block = ruleBlock(".quiz-options button.correct::after");
    expect(block).toContain("✓");
    expect(block).toMatch(/content:/);
  });

  it("die falsch gewählte Antwort bekommt ein ✗ per ::after", () => {
    const block = ruleBlock(".quiz-options button.wrong::after");
    expect(block).toContain("✗");
    expect(block).toMatch(/content:/);
  });

  it("die Regel deckt sowohl Quiz- als auch Dialog-Optionen ab (ein Selektor-Block)", () => {
    // Beide Kontexte teilen sich die Marker-Regel, damit ✓/✗ überall gilt, nicht nur im Quiz.
    expect(css).toMatch(/\.quiz-options button\.correct::after,\s*\.dlg-choices button\.correct::after/);
    expect(css).toMatch(/\.quiz-options button\.wrong::after,\s*\.dlg-choices button\.wrong::after/);
  });
});

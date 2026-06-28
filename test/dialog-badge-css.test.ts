import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/* #364: Befehls-Badges (die monospace-<code>-Elemente in Dialogtexten, Terminal-
 * Aufgaben, Dev-Panel und Quiz-Erklärungen) dürfen NIE mitten im Befehl umbrechen
 * – sonst landet z.B. „docker" auf Zeile 1 und „run" auf Zeile 2, was das falsche
 * mentale Modell vermittelt. Garant dafür ist `white-space: nowrap` auf der
 * geteilten Badge-Regel. Dieser Test sichert die Regel als CSS-Inhalt ab, weil
 * eine reine Stilregel sonst von keinem Unit-Test berührt wird (Red-Green: ohne
 * die nowrap-Zeile schlägt er fehl). */

const css = readFileSync(
  fileURLToPath(new URL("../style.css", import.meta.url)),
  "utf8",
);

// Den Regelblock der Badge-Selektoren herausschneiden (vom Selektor bis zur
// schließenden Klammer) und auf die nowrap-Deklaration prüfen.
function ruleBlock(selector: string): string {
  const start = css.indexOf(selector);
  expect(start, `Selektor „${selector}" nicht in style.css gefunden`).toBeGreaterThanOrEqual(0);
  const open = css.indexOf("{", start);
  const close = css.indexOf("}", open);
  return css.slice(open, close);
}

describe("#364: Befehls-Badges brechen nie mitten im Befehl um", () => {
  it("die geteilte Badge-Regel setzt white-space: nowrap", () => {
    const block = ruleBlock(".dlg-text code, .term-tasks code");
    expect(block).toMatch(/white-space:\s*nowrap/);
  });

  it("deckt alle vier Badge-Kontexte über denselben Selektor ab", () => {
    // Ein einziger Selektor-Block bündelt Dialog, Terminal-Aufgaben, Dev-Panel
    // und Quiz-Erklärung – so gilt das nowrap überall, nicht nur im Dialog.
    expect(css).toMatch(
      /\.dlg-text code,\s*\.term-tasks code,\s*\.panel-body code,\s*\.quiz-explain code/,
    );
  });
});

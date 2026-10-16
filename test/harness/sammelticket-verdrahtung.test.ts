/* Verdrahtung des Sammelticket-Anlegers (#1663 L44d).
 *
 * @harness-waechter – einziger Durchsetzer seiner Regel, darum im geschützten test/harness/ (#1165).
 *
 * `main` in scripts/sammelticket-anlegen.mjs ruft `korrekturFuer` für das NEUE Sammelticket auf. Gibt der Aufruf `hinter` (den
 * Generationsvorgänger) nicht weiter, wird ein Nachfolger auf die Standardposition statt hinter den Vorgänger gesetzt, und kein
 * Test der puren Funktion bemerkt es. Darum prüft dieser Wächter den Quelltext: jeder Aufruf reicht `items`, `nr`, `position`
 * und `hinter` durch. Grenze: erkannt werden Aufrufe mit Objekt-Literal; ein dynamisch gebautes Argument fiele durch (dann rot).
 */
import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

const QUELLE = readFileSync(new URL("../../scripts/sammelticket-anlegen.mjs", import.meta.url), "utf8");
const PFLICHT = ["items", "nr", "position", "hinter"];

/** Alle Aufrufe `korrekturFuer({ … })` (nicht die Definition) mit ihrer Argumentliste. */
function aufrufe(text: string): string[] {
  return [...text.matchAll(/(?<!function\s)\bkorrekturFuer\(\s*(\{[^}]*\})\s*\)/g)].map((m) => m[1]);
}

/** Pflichtfelder, die ein Aufruf nicht (als Kurzform oder `feld: …`) durchreicht. */
function fehlende(arg: string): string[] {
  const felder = arg.slice(1, -1).split(",").map((f) => f.split(":")[0].trim());
  return PFLICHT.filter((p) => !felder.includes(p));
}

describe("korrekturFuer ist in main verdrahtet", () => {
  test("der Prüfer erkennt einen fehlenden Parameter (Negativfall)", () => {
    expect(fehlende("{ items, nr, position }")).toEqual(["hinter"]);
    expect(fehlende("{ items, nr: neu, position, hinter }")).toEqual([]);
    expect(aufrufe("const k = korrekturFuer({ items, nr });")).toEqual(["{ items, nr }"]);
    expect(aufrufe("export function korrekturFuer({ items, nr, position, hinter = null }) {")).toEqual([]);
  });

  test("jeder Aufruf im Skript reicht items, nr, position und hinter durch, und es gibt mindestens einen in main", () => {
    const alle = aufrufe(QUELLE);
    expect(alle.length, "kein korrekturFuer-Aufruf mehr gefunden: der Wächter prüfte nichts").toBeGreaterThanOrEqual(2);
    for (const a of alle) expect(fehlende(a), a).toEqual([]);
    const main = QUELLE.slice(QUELLE.indexOf("async function main("));
    expect(aufrufe(main).length, "main ruft korrekturFuer nicht mehr auf").toBeGreaterThanOrEqual(1);
  });
});

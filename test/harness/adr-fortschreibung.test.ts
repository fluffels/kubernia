/* Format-Wächter für ADR-Fortschreibungen (#1663 L51): jede Überschrift, die mit „Fortschreibung“ beginnt, hat die Form
 * `## Fortschreibung #<nr>[/#<nr>…] (JJJJ-MM-TT): <Titel>`.
 *
 * @harness-waechter – einziger Durchsetzer seiner Regel, darum im geschützten test/harness/ (#1165).
 *
 * Warum: ein ADR ist historisch und wird nur durch angehängte Abschnitte fortgeschrieben; eine einheitliche Überschrift macht sie
 * greifbar (Ticket, Datum, Thema) und für Werkzeuge auffindbar. Bewusste Grenze: geprüft wird nur die Überschriftenform, nicht, ob
 * das Datum zum Ticket passt, und Überschriften in Code-Fences zählen nicht. */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

const FORM = /^## Fortschreibung #\d+(\/#\d+)* \(\d{4}-\d{2}-\d{2}\): \S/;
const BEGINNT = /^#{1,6}\s+Fortschreibung/;

/** Überschriften (mit Zeilennummer) mit dem Anfang „Fortschreibung“, die nicht der Form entsprechen. Pur. */
function abweichende(text: string): string[] {
  const aus: string[] = [];
  let fence = false;
  text.split(/\r?\n/).forEach((zeile, i) => {
    if (/^\s*(```|~~~)/.test(zeile)) fence = !fence;
    else if (!fence && BEGINNT.test(zeile) && !FORM.test(zeile)) aus.push(`${i + 1}: ${zeile}`);
  });
  return aus;
}

describe("ADR-Fortschreibungen: Überschriftenform (#1663 L51)", () => {
  const dir = join(process.cwd(), "docs", "adr");
  const adrs = readdirSync(dir).filter((n) => /^\d{4}-.*\.md$/.test(n));

  test("es gibt ADRs und mindestens eine Fortschreibung zu prüfen (kein leerer Lauf)", () => {
    expect(adrs.length).toBeGreaterThan(20);
    expect(adrs.some((n) => readFileSync(join(dir, n), "utf8").includes("\n## Fortschreibung #"))).toBe(true);
  });

  test("jede Fortschreibungs-Überschrift in docs/adr/*.md hat die Form", () => {
    const fehler = adrs.flatMap((n) => abweichende(readFileSync(join(dir, n), "utf8")).map((z) => `${n}:${z}`));
    expect(fehler).toEqual([]);
  });

  test.each([
    ["## Fortschreibung #1646 (2026-10-16): Titel", true],
    ["## Fortschreibung #1279/#1276 (2026-10-06): Weichen", true],
    ["## Fortschreibung (#1646, 2026-10-16): Titel", false],
    ["## Fortschreibung #1646 (2026-10-16)", false],
    ["## Fortschreibung #1646 (2026-10-16): ", false],
    ["## Fortschreibung #1646 (16.10.2026): Titel", false],
    ["### Fortschreibung #1646 (2026-10-16): Titel", false],
    ["## Fortschreibung #1646/ (2026-10-16): Titel", false],
  ])("Negativfälle erkannt: %s", (zeile, ok) => {
    expect(abweichende(zeile).length === 0).toBe(ok);
  });

  test("Überschriften in Code-Fences zählen nicht, andere Überschriften nicht betroffen", () => {
    expect(abweichende("```\n## Fortschreibung kaputt\n```\n## Re-Evaluierung\n")).toEqual([]);
    expect(abweichende("## Fortschreibung kaputt")).toEqual(["1: ## Fortschreibung kaputt"]);
  });
});

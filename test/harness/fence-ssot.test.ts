/* Wächter: Code-Fences erkennt nur `fenceBloecke`/`fenceMaske` in scripts/docs-gen/markdown.mjs (#1866 L20).
 *
 * @harness-waechter – einziger Durchsetzer seiner Regel, darum im geschützten test/harness/ (#1165).
 *
 * Warum: ein eigener Fence-Umschalter (`fence = !fence` an einer Zeile `^\s*(```|~~~)`) schließt einen ```-Zaun an einem ~~~ und einen 4er-Zaun an
 * einem inneren ``` und weicht damit von CommonMark ab; jede Kopie driftet für sich. Der Wächter sucht den Quelltext solcher Regex-Literale
 * (Alternation aus drei Backticks und drei Tilden, auch mit `{3,}`) in scripts/**\/*.mjs und test/**\/*.ts.
 *
 * Bewusste Grenze: geprüft wird nur diese Schreibweise der Zaun-Alternation; ein Fence-Scanner in anderer Form (zwei getrennte Regexe,
 * Zeichen-Schleife) bleibt unerkannt. Ausgenommen sind `markdown.mjs` (die SSOT) und dieser Wächter; Funde, die keinen Zaun verfolgen,
 * stehen mit Grund in `ERLAUBT` (geschlossene Liste). */
import { readFileSync, readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, test } from "vitest";

const WURZEL = process.cwd();
const SSOT = "scripts/docs-gen/markdown.mjs";
const SELBST = "test/harness/fence-ssot.test.ts";
/** Funde ohne Zaun-Verfolgung (Datei: Grund). */
const ERLAUBT: Record<string, string> = {
  "scripts/spezifikation-lib.mjs": "verloreneZeilen filtert Zaun-Zeilen aus dem Zeilenvergleich (Rauschen), verfolgt keinen Zaun",
};
/** Zaun-Alternation im Quelltext: `(?:```|~~~)`, `(```|~~~)` oder die `{3,}`-Form. */
const MUSTER = /\((?:\?:)?(?:`{3}|`\{3,\})\|(?:~{3}|~\{3,\})\)/;

/** Fund (Datei) je Quelltext, der das Muster enthält. Pur. */
function funde(dateien: Record<string, string>): string[] {
  return Object.entries(dateien)
    .filter(([pfad, text]) => pfad !== SSOT && pfad !== SELBST && MUSTER.test(text))
    .map(([pfad]) => pfad);
}

function sammle(rel: string, endung: string): string[] {
  const aus: string[] = [];
  const walk = (abs: string) => {
    for (const ent of readdirSync(abs, { withFileTypes: true })) {
      if (ent.name === "node_modules") continue;
      const p = join(abs, ent.name);
      if (ent.isDirectory()) walk(p);
      else if (ent.name.endsWith(endung)) aus.push(relative(WURZEL, p).split(sep).join("/"));
    }
  };
  walk(join(WURZEL, rel));
  return aus;
}

describe("Code-Fences: eine Quelle (#1866 L20)", () => {
  test("das Muster erkennt die bekannten Schreibweisen und lässt Fremdes durch", () => {
    for (const q of ["/^\\s*(?:```|~~~)/", "/^\\s*(```|~~~)/", "/^\\s*(`{3,}|~{3,})/", "(?:`{3,}|~{3,})"]) expect(MUSTER.test(q), q).toBe(true);
    for (const q of ["/^```/", "const a = '```' + '~~~'", "/(?:`|~)/", "(`{2}|~{3})"]) expect(MUSTER.test(q), q).toBe(false);
  });

  test("funde: SSOT und Wächter sind ausgenommen, ein Zweitscanner wird gemeldet", () => {
    const q = "if (/^\\s*(?:```|~~~)/.test(z)) fence = !fence;";
    expect(funde({ [SSOT]: q, [SELBST]: q, "scripts/x.mjs": q, "scripts/y.mjs": "kein Zaun" })).toEqual(["scripts/x.mjs"]);
  });

  test("Scan: kein Skript und kein Test außer der SSOT hat einen eigenen Fence-Scanner (Ausnahmen mit Grund)", () => {
    const dateien = [...sammle("scripts", ".mjs"), ...sammle("test", ".ts")];
    expect(dateien.length).toBeGreaterThan(100); // kein leerer Lauf
    expect(dateien).toContain(SSOT);
    const texte = Object.fromEntries(dateien.map((d) => [d, readFileSync(join(WURZEL, d), "utf8")]));
    const treffer = funde(texte);
    expect(treffer.filter((d) => !(d in ERLAUBT))).toEqual([]);
    // Eine Ausnahme, die nicht mehr trifft, ist stale: entfernen.
    expect(Object.keys(ERLAUBT).filter((d) => !treffer.includes(d))).toEqual([]);
  });
});

/**
 * @harness-waechter
 * Wächter: das Umgebungsvariablen-Inventar (`docs/referenz/befehle.md` › „Umgebungsvariablen“, Ring `Kern`) und die gelesenen
 * Kern-Variablen (`umgebungsWert(<env>, "FACTORY_<NAME>")` in `scripts/**\/*.mjs`) decken sich als Menge.
 * Grenze: direkte `process.env.FACTORY_…`-Zugriffe und Workflows liegen außerhalb des Scans.
 */
import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import { sammleKernEnv as rawSammle, sammleKernEnvIn as rawSammleIn } from "../../scripts/projekt-config-lib.mjs";

const WURZEL = fileURLToPath(new URL("../../", import.meta.url));
const BEFEHLE = "docs/referenz/befehle.md";

/** Geschlossene Ausnahmeliste: Inventarzeilen ohne Literal im Code, jeweils mit Grund. */
const AUSNAHMEN: Record<string, string> = {
  FACTORY_TEST_FEHLT: "Absenz-Fixture im Test des Fehlerpfads, wird nie gelesen",
};

export interface CodeFunde {
  literale: Set<string>;
  /** Aufrufe ohne Literal als Namen (Variablenname), als `datei:zeile`. */
  ohneLiteral: string[];
}

/** Der Sammler liegt in der Kern-Lib (`sammleKernEnv`), damit der Doctor dieselben Namen kennt. */
export const sammleCode = rawSammle as (datei: string, text: string) => CodeFunde;
/** Dieselbe Lib sammelt über einen Ordner, damit Wächter und Doctor nicht zwei Läufe über die Dateien pflegen. */
const sammleOrdner = rawSammleIn as (ordner: string, bezug: string) => CodeFunde;

/** Pur: Namen der Kern-Zeilen unter `## Umgebungsvariablen` (Ring in Spalte 2, Name in Spalte 1). */
export function sammleInventar(md: string): Set<string> {
  const namen = new Set<string>();
  let drin = false;
  for (const zeile of md.split("\n")) {
    if (/^## /.test(zeile)) drin = zeile.trim() === "## Umgebungsvariablen";
    if (!drin || !zeile.startsWith("|")) continue;
    const spalten = zeile.split("|").slice(1, -1).map((s) => s.trim());
    if (spalten[1] !== "Kern") continue;
    const m = /^`([^`]+)`$/.exec(spalten[0]);
    if (m) namen.add(m[1]);
  }
  return namen;
}

/** Pur: Abweichungen zwischen Code und Inventar; leer = gleich. */
export function vergleiche(code: CodeFunde, inventar: Set<string>, ausnahmen: Record<string, string>): string[] {
  const fehler: string[] = [];
  if (inventar.size === 0) fehler.push("Inventar leer: keine Kern-Zeile unter „## Umgebungsvariablen“ gefunden");
  for (const stelle of code.ohneLiteral) fehler.push(`umgebungsWert ohne Literal als Namen (${stelle}): der Name muss als "FACTORY_…" im Aufruf stehen`);
  for (const [name, grund] of Object.entries(ausnahmen)) {
    if (grund.trim() === "") fehler.push(`Ausnahme ${name} ohne Grund`);
  }
  for (const name of code.literale) {
    if (!inventar.has(name)) fehler.push(`${name} wird gelesen, hat aber keine Kern-Zeile im Inventar`);
  }
  for (const name of inventar) {
    if (!code.literale.has(name) && !(name in ausnahmen)) fehler.push(`${name} steht im Inventar, wird aber im Code nicht gelesen (Zeile streichen oder in die Ausnahmeliste mit Grund)`);
  }
  for (const name of Object.keys(ausnahmen)) {
    if (!inventar.has(name)) fehler.push(`Ausnahme ${name} hat keine Inventarzeile`);
    if (code.literale.has(name)) fehler.push(`Ausnahme ${name} wird im Code gelesen: aus der Ausnahmeliste entfernen`);
  }
  return fehler;
}

describe("Umgebungsvariablen-Inventar gegen den Code", () => {
  test("Kern-Inventar und gelesene FACTORY_-Variablen sind mengengleich", () => {
    const code = sammleOrdner(join(WURZEL, "scripts"), WURZEL);
    const inventar = sammleInventar(readFileSync(join(WURZEL, BEFEHLE), "utf8"));
    expect(vergleiche(code, inventar, AUSNAHMEN)).toEqual([]);
  });
});

describe("Wächter-Hilfsfunktionen (Negativfälle)", () => {
  const code = (literale: string[], ohneLiteral: string[] = []): CodeFunde => ({ literale: new Set(literale), ohneLiteral });
  const tabelle = (zeilen: string[]) => `## Umgebungsvariablen\n\n| Name | Ring | a | b |\n| --- | --- | --- | --- |\n${zeilen.join("\n")}\n\n## Anderes\n| \`FACTORY_X\` | Kern | a | b |\n`;
  const zeile = (n: string, ring = "Kern") => `| \`${n}\` | ${ring} | a | b |`;

  test("Gleichheit: keine Abweichung", () => {
    expect(vergleiche(code(["FACTORY_A"]), sammleInventar(tabelle([zeile("FACTORY_A")])), {})).toEqual([]);
  });
  test("Inventarzeile ohne Literal", () => {
    expect(vergleiche(code([]), sammleInventar(tabelle([zeile("FACTORY_A")])), {})).toHaveLength(1);
  });
  test("Literal ohne Inventarzeile", () => {
    expect(vergleiche(code(["FACTORY_A"]), sammleInventar(tabelle([zeile("FACTORY_B")])), {})).toHaveLength(2);
  });
  test("Variablenname statt Literal", () => {
    const f = sammleCode("scripts/x.mjs", "const v = umgebungsWert(env, name);\n");
    expect(f.ohneLiteral).toEqual(["scripts/x.mjs:1"]);
    expect(vergleiche(f, sammleInventar(tabelle([zeile("FACTORY_A")])), {}).some((m) => m.includes("ohne Literal"))).toBe(true);
  });
  test("leere Tabelle", () => {
    expect(vergleiche(code([]), sammleInventar(tabelle([])), {}).some((m) => m.includes("Inventar leer"))).toBe(true);
  });
  test("Ring Projekt und Tabellen anderer Abschnitte zählen nicht", () => {
    expect([...sammleInventar(tabelle([zeile("FACTORY_P", "Projekt")]))]).toEqual([]);
  });
  test("Ausnahme ohne Grund, ohne Inventarzeile oder trotz Literal", () => {
    const inv = sammleInventar(tabelle([zeile("FACTORY_T")]));
    expect(vergleiche(code([]), inv, { FACTORY_T: " " }).some((m) => m.includes("ohne Grund"))).toBe(true);
    expect(vergleiche(code([]), inv, { FACTORY_U: "x" }).some((m) => m.includes("keine Inventarzeile"))).toBe(true);
    expect(vergleiche(code(["FACTORY_T"]), inv, { FACTORY_T: "x" }).some((m) => m.includes("entfernen"))).toBe(true);
  });
  test("Kommentarzeilen und die Definition zählen nicht, mehrere Literale je Zeile schon", () => {
    expect(sammleCode("scripts/x.mjs", " * umgebungsWert(env, name)\n// umgebungsWert(env, name)\n").ohneLiteral).toEqual([]);
    expect(sammleCode("scripts/projekt-config-lib.mjs", "export function umgebungsWert(env, name) {\n").ohneLiteral).toEqual([]);
    expect([...sammleCode("scripts/x.mjs", 'a(umgebungsWert(e, "FACTORY_A"), umgebungsWert(e, "FACTORY_B"))\n').literale]).toEqual(["FACTORY_A", "FACTORY_B"]);
  });
});

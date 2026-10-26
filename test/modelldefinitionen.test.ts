import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as preiseRaw from "../scripts/preise.mjs";

const PRICES = (preiseRaw as unknown as { PRICES: Record<string, unknown> }).PRICES;

/** Fitness: die Tabelle „Stand der Definitionen“ in docs/langfuse-hook-patch.md deckt jedes Modell und jede Preisperiode von `PRICES` ab (#1942). */

type Zeile = { modell: string; ab: string; status: string };

const STATUS = /^(offen|angelegt \d{4}-\d{2}-\d{2})$/;

function tabelleAus(md: string): Zeile[] {
  const zeilen: Zeile[] = [];
  let drin = false;
  for (const z of md.split(/\r?\n/)) {
    if (/^\|\s*Modell\s*\|\s*Periode ab\s*\|\s*Instanz\s*\|/.test(z)) {
      drin = true;
      continue;
    }
    if (!drin) continue;
    if (!z.startsWith("|")) break;
    const zellen = z.split("|").slice(1, -1).map((s) => s.trim());
    if (zellen.length === 3 && !/^-+$/.test(zellen[0])) zeilen.push({ modell: zellen[0], ab: zellen[1], status: zellen[2] });
  }
  return zeilen;
}

/** Erwartete (Modell, Periode)-Paare aus einer Preistabelle: `Modellstart` für `validFrom` null oder ein Einzelobjekt, sonst das Datum. */
function erwartet(preise: Record<string, unknown>): string[] {
  return Object.entries(preise).flatMap(([modell, e]) => {
    const perioden = Array.isArray(e) ? (e as { validFrom: string | null }[]) : [{ validFrom: null }];
    return perioden.map((p) => `${modell}|${p.validFrom ? p.validFrom.slice(0, 10) : "Modellstart"}`);
  });
}

const md = readFileSync(new URL("../docs/langfuse-hook-patch.md", import.meta.url), "utf8");

describe("Modelldefinitionen der Instanz", () => {
  test("jedes Modell und jede Preisperiode aus PRICES hat genau eine Zeile", () => {
    const vorhanden = tabelleAus(md).map((z) => `${z.modell}|${z.ab}`);
    for (const e of erwartet(PRICES)) expect(vorhanden.filter((v) => v === e), e).toHaveLength(1);
  });

  test("keine Zeile ohne Eintrag in PRICES", () => {
    const soll = new Set(erwartet(PRICES));
    for (const z of tabelleAus(md)) expect(soll.has(`${z.modell}|${z.ab}`), `${z.modell} ${z.ab}`).toBe(true);
  });

  test("jeder Status ist offen oder angelegt <Datum>", () => {
    for (const z of tabelleAus(md)) expect(z.status, `${z.modell} ${z.ab}`).toMatch(STATUS);
  });

  test("Negativfall: ein ergänzter PRICES-Eintrag ohne Zeile wird erkannt", () => {
    const mehr = { ...PRICES, "claude-neu-9": [{ validFrom: null }, { validFrom: "2027-01-01T00:00:00Z" }] };
    const vorhanden = new Set(tabelleAus(md).map((z) => `${z.modell}|${z.ab}`));
    expect(erwartet(mehr).filter((e) => !vorhanden.has(e))).toEqual(["claude-neu-9|Modellstart", "claude-neu-9|2027-01-01"]);
  });

  test("Negativfall: ein ungültiger Status passt nicht", () => {
    expect(STATUS.test("angelegt gestern")).toBe(false);
    expect(STATUS.test("fertig")).toBe(false);
  });
});

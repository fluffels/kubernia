/* Struktur-Pfade, Größen-Ausnahme, Doku-Generatoren und Projektdateien des Projekts (#1931, #1934, ADR 0022 F10): die projekteigenen Werte hinter den Kern-Tests.
 *
 * @harness-waechter – Projekt-Test (bleibt im Projekt, zieht nicht ins Factory-Repo): er prüft die echten Werte der Projekt-Config
 * (`struktur`, `ausnahmen`) und `scripts/docs-gen/config.json` (`generatoren`). Die projektneutralen Regeln stehen im Factory-Repo, in `projekt-config.test.ts`,
 * `doctickets.test.ts` und `kern-reinheit.test.ts`. Die Projektdateien, die Kern-Tests nicht lesen dürfen (`src/content/AGENTS.md`, der echte
 * `src`-Baum), lesen nur die Tests hier.
 */
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { describe, test } from "vitest";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as rawPc from "../../scripts/projekt-config-lib.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as checkContextSize from "../../scripts/check-context-size.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as schichtenRaw from "../../scripts/docs-gen/schichten.mjs";

const pc = rawPc as unknown as {
  strukturAus(config: unknown): { quelle: string; moduldoku: string };
  escapeKopienAus(config: unknown): string[];
  ausnahmenAus(config: unknown): { groesse: { datei: string; grund: string }[]; kontext: { datei: string; grund: string }[] };
};

const kc = checkContextSize as unknown as {
  collectContextSizes(): { file: string; chars: number; budget: number }[];
  MODULE_AGENTS_BUDGET: number;
};
type Modell = { quellwurzel: string; schichten: { id: string; wurzeln: string[] }[] };
const schichten = schichtenRaw as unknown as { schichtVon(pfad: string, m: Modell): string | null };
const echt = createRequire(import.meta.url)("../../scripts/layers.cjs") as { SCHICHT_MODELL: Modell; layerOf(f: string): string };

const WURZEL = fileURLToPath(new URL("../../", import.meta.url));
const lese = (rel: string): string => readFileSync(`${WURZEL}${rel}`, "utf8");
const config = JSON.parse(lese(".factory/projekt.json")) as unknown;

describe("Werte der Projekt-Config (#1931)", () => {
  test("struktur: Quellwurzel und Moduldoku-Ordner", () => {
    assert.deepEqual(pc.strukturAus(config), { quelle: "src", moduldoku: "docs/module" });
  });

  test("struktur.escapeKopien: die zwei Dateien mit der Kopie der Escape-Zeichenklasse (die Dateien prüft ticket-namen.test.ts)", () => {
    assert.deepEqual(pc.escapeKopienAus(config), [".dependency-cruiser.cjs", "src/content/drills/shared.ts"]);
  });

  test("ausnahmen: die Größen-Ausnahme nennt genau src/sim.ts mit #893 (nicht vakuös: die Liste ist nicht leer)", () => {
    const echt = pc.ausnahmenAus(config);
    assert.deepEqual(echt.groesse.map((a) => a.datei), ["src/sim.ts"]);
    assert.match(echt.groesse[0]?.grund ?? "", /#893/);
  });
});

describe("Doku-Generatoren des Projekts (#1931)", () => {
  const cfg = JSON.parse(lese("scripts/docs-gen/config.json")) as { generatoren?: Record<string, { datei: string }> };
  const dateien = [...new Set(Object.values(cfg.generatoren ?? {}).map((g) => g.datei))];

  test("config.generatoren nennt mindestens zwei Generator-Dateien, und jede existiert", () => {
    assert.ok(dateien.length >= 2, "die Dateien der Projekt-Generatoren stehen in der Config");
    for (const p of dateien) assert.ok(existsSync(`${WURZEL}${p}`), `${p}: Datei fehlt`);
  });
});

describe("Projektdateien hinter Kern-Tests (#1934)", () => {
  test("die echte src/content/AGENTS.md wird gemessen, gegen das Modul-Default-Budget", () => {
    const s = kc.collectContextSizes().find((x) => x.file === "src/content/AGENTS.md");
    assert.ok(s && s.chars > 0, "src/content/AGENTS.md sollte gefunden und gemessen werden.");
    assert.equal(s.budget, kc.MODULE_AGENTS_BUDGET);
  });

  test("schichtVon stimmt für jede src-Datei mit layerOf überein (echter Baum)", () => {
    const dateien: string[] = [];
    const geh = (rel: string) => {
      for (const e of readdirSync(`${WURZEL}${rel}`, { withFileTypes: true })) {
        if (e.isDirectory()) geh(`${rel}/${e.name}`);
        else if (e.isFile() && e.name.endsWith(".ts")) dateien.push(`${rel}/${e.name}`);
      }
    };
    geh("src");
    assert.ok(dateien.length > 100);
    for (const f of dateien) assert.equal(schichten.schichtVon(f, echt.SCHICHT_MODELL), echt.layerOf(f), f);
  });
});

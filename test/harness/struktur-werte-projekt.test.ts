/* Struktur-Pfade, Größen-Ausnahme und Doku-Generatoren des Projekts (#1931, ADR 0022 F10): die projekteigenen Werte hinter den Kern-Tests.
 *
 * @harness-waechter – Projekt-Test (bleibt im Projekt, zieht nicht ins Factory-Repo): er prüft die echten Werte der Projekt-Config
 * (`struktur`, `ausnahmen`) und `scripts/docs-gen/config.json` (`generatoren`). Die projektneutralen Regeln stehen in `projekt-config.test.ts`,
 * `doctickets.test.ts` und `kern-reinheit.test.ts`.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, test } from "vitest";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as rawPc from "../../scripts/projekt-config-lib.mjs";

const pc = rawPc as unknown as {
  strukturAus(config: unknown): { quelle: string; moduldoku: string };
  ausnahmenAus(config: unknown): { groesse: { datei: string; grund: string }[]; kontext: { datei: string; grund: string }[] };
};

const WURZEL = fileURLToPath(new URL("../../", import.meta.url));
const lese = (rel: string): string => readFileSync(`${WURZEL}${rel}`, "utf8");
const config = JSON.parse(lese(".factory/projekt.json")) as unknown;

describe("Werte der Projekt-Config (#1931)", () => {
  test("struktur: Quellwurzel und Moduldoku-Ordner", () => {
    assert.deepEqual(pc.strukturAus(config), { quelle: "src", moduldoku: "docs/module" });
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

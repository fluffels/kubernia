/* Doku↔Code-Drift-Wächter (#482, Stardew-Skalierung #907) – hält die Tiefendoc-Abdeckung ehrlich.
 *
 * Seit #907 wird nicht mehr die CLAUDE.md-per-File-Tabelle gegen den Code geprüft, sondern
 * ob jede `src/*.ts` als Backtick-Pfad in min. einem `docs/module/*.md`-Tiefendoc erwähnt ist.
 * CLAUDE.md zeigt nur noch 5 Subsystem-Zeilen (wächst sub-linear zur Modul-Zahl).
 *
 * Die Schicht-Konsistenz-Checks entfallen (#907): `check:arch` (dependency-cruiser) erzwingt
 * die eigentlichen Schichtgrenzen als CI-Gate — die Doku-Schicht-Angaben sind nur noch Prosa.
 * `layerOf`/`LABEL_TO_LAYER` kommen aus scripts/layers.cjs (bleibt SSOT für check:arch).
 *
 * Ausführen mit:  npm test   (oder gezielt: npm run check:docmap)
 */
import { describe, test } from "vitest";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

// Reine Node-Tooling-Skripte ohne Declaration-File (allowJs aus, scripts/ nicht im tsconfig)
// – der Laufzeit-Import genügt, die Typen deklarieren wir hier lokal.
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as checkDocMap from "../scripts/check-docmap.mjs";

const require = createRequire(import.meta.url);
const { layerOf, LABEL_TO_LAYER, LAYERS } = require("../scripts/layers.cjs");

type Audit = {
  modules: string[];
  ghosts: string[];
  orphans: string[];
  staleAllowlist: string[];
};

const parseDeepDocMaps: (rootDir?: string) => Set<string> = checkDocMap.parseDeepDocMaps;
const auditDocMap: () => Audit = checkDocMap.auditDocMap;

const audit = auditDocMap();

describe("Doku↔Code-Drift (#482/#907)", () => {
  test("keine Geister-Einträge: jeder Tiefendoc-Pfad existiert in src/", () => {
    assert.deepEqual(
      audit.ghosts,
      [],
      "Diese Tiefendoc-Einträge zeigen auf nicht existierende Pfade – Eintrag entfernen oder Pfad korrigieren.",
    );
  });

  test("keine verwaisten Module: jede src/-*.ts ist in einem Tiefendoc erwähnt", () => {
    assert.deepEqual(
      audit.orphans,
      [],
      "Diese src-Module fehlen in allen docs/module/*.md – Backtick-Pfad in passendem Tiefendoc ergänzen " +
        "oder mit Begründung in scripts/check-docmap.mjs › ORPHAN_ALLOWLIST aufnehmen.",
    );
  });

  test("ORPHAN_ALLOWLIST ist ehrlich: kein stale Eintrag", () => {
    assert.deepEqual(
      audit.staleAllowlist,
      [],
      "Stale ORPHAN_ALLOWLIST-Einträge (Datei weg oder inzwischen in einem Tiefendoc) – aus scripts/check-docmap.mjs entfernen.",
    );
  });

  // ── Red-Green: die Mechanik greift wirklich (ein immer-grüner Wächter wäre wertlos) ──

  test("parseDeepDocMaps findet Backtick-Pfade aus allen Tiefendocs", () => {
    const covered = parseDeepDocMaps();
    assert.ok(covered.has("src/sim/state.ts"), "sim/state.ts muss in sim.md stehen");
    assert.ok(covered.has("src/content.ts"), "content.ts muss in content.md stehen");
    assert.ok(covered.has("src/world/world.ts"), "world/world.ts muss in world.md stehen");
    assert.ok(covered.has("src/scenes/WorldScene.ts"), "WorldScene.ts muss in presentation.md stehen");
    assert.ok(covered.has("src/store.ts"), "store.ts muss in app.md stehen");
    assert.ok(covered.size >= 163, `Alle 163 Module müssen abgedeckt sein, got ${covered.size}`);
  });

  test("layerOf klassifiziert repräsentative Pfade wie der dependency-cruiser", () => {
    assert.equal(layerOf("src/sim/state.ts"), LAYERS.DOMAIN);
    assert.equal(layerOf("src/types.ts"), LAYERS.DOMAIN);
    assert.equal(layerOf("src/game/economy.ts"), LAYERS.APPLICATION);
    assert.equal(layerOf("src/store.ts"), LAYERS.APPLICATION);
    assert.equal(layerOf("src/scenes/WorldScene.ts"), LAYERS.PRESENTATION);
    assert.equal(layerOf("src/sfx.ts"), LAYERS.PRESENTATION);
    assert.equal(layerOf("src/main.ts"), LAYERS.ENTRY);
    assert.equal(layerOf("src/assets-data.ts"), LAYERS.ENTRY);
  });

  test("der Schicht-Abgleich würde eine echte Fehl-Deklaration fangen", () => {
    // Wäre die pure-Domäne-Datei fälschlich als „Präsentation" deklariert, MÜSSTE der
    // Vergleich (LABEL_TO_LAYER[label] vs. layerOf(file)) ungleich sein – sonst misst er nichts.
    assert.notEqual(LABEL_TO_LAYER["Präsentation"], layerOf("src/sim/state.ts"));
    assert.equal(LABEL_TO_LAYER["pure Domäne"], layerOf("src/sim/state.ts"));
  });
});

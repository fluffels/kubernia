/* Szenen-Geometrie-SSOT-Wächter (#590).
 *
 * scenes/geometry.ts bündelt die vorher über WorldScene/RegionScene/regions/clustersync
 * verstreuten Hitbox-/Layout-Konstanten. Dieser Test nagelt die Invarianten fest, auf die
 * sich die Aufrufer verlassen – so bricht ein stiller Fehl-Wert (z.B. vertauschte Reveal-
 * Bänder, ungerade Steg-Belegung) hier ROT, statt erst als schräges Verhalten im Spiel.
 *
 * geometry.ts ist reine Zahlen (kein Phaser/DOM), also im Node-Test direkt importierbar.
 *
 * Ausführen mit:  npm test
 */
import { describe, test } from "vitest";
import assert from "node:assert/strict";
import { HIT_R, LAMP_HIT, CRATE_HIT, SLOTS_PER_PIER, TAG_CAP, REVEAL_FULL, REVEAL_FADE } from "../src/scenes/geometry";

describe("scenes/geometry-SSOT (#590)", () => {
  test("Sub-Tile-Hitbox-Radius ist ein positiver Wert", () => {
    assert.ok(HIT_R > 0, "HIT_R muss positiv sein");
  });

  test("Laternen-Hitbox ist ein schmaler, hoher Pfosten (Breite < Höhe, beide positiv)", () => {
    const [w, h] = LAMP_HIT;
    assert.ok(w > 0 && h > 0, "LAMP_HIT-Maße müssen positiv sein");
    assert.ok(w < h, "Pfosten ist schmaler als hoch");
  });

  test("Kisten-Hitbox passt mittig eingerückt in eine 16px-Kachel", () => {
    // scenes/regions.ts rechnet off = (T - CRATE_HIT) / 2 und braucht off > 0 (T = 16).
    assert.ok(CRATE_HIT > 0 && CRATE_HIT < 16, "CRATE_HIT muss echt in die Kachel passen");
  });

  test("Steg-Belegung ist gerade, damit PIER_ROWS = SLOTS_PER_PIER/2 ganzzahlig bleibt", () => {
    assert.ok(SLOTS_PER_PIER > 0, "SLOTS_PER_PIER muss positiv sein");
    assert.equal(SLOTS_PER_PIER % 2, 0, "2 Spalten je Steg → gerade Slot-Zahl");
  });

  test("Tag-Deckel ist positiv (harte Render-Pool-Garantie, #416)", () => {
    assert.ok(TAG_CAP > 0, "TAG_CAP muss positiv sein");
  });

  test("Aufdeck-Bänder sind geordnet: voll sichtbar näher als der Fade-Rand", () => {
    assert.ok(REVEAL_FULL > 0, "REVEAL_FULL muss positiv sein");
    assert.ok(REVEAL_FULL < REVEAL_FADE, "voller Radius muss kleiner als der Fade-Radius sein");
  });
});

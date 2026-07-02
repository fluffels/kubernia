/* Tests für den generischen Karten-Terrain-Lader (#425, Kind von #415).
 *
 * loadMapTerrain lädt Boden/Kollision/Türen/NPC-Standplätze DATENGETRIEBEN aus der
 * Map-Registry über `scene.mapId` – statt fest „harbor" zu verdrahten. Bewusst
 * Phaser-frei (worldscene/mapterrain.ts), darum hier im Node-Test prüfbar. Geprüft
 * inkl. Negativ-/Parametrisierungs-Fall:
 *  1. der Hafen wird über scene.mapId korrekt geladen (Maße/Türen/NPCs),
 *  2. eine Registry-Karte OHNE Boden-Codec scheitert klar – das beweist, dass
 *     scene.mapId wirklich den Eintrag wählt (sonst bliebe der Aufruf still grün),
 *  3. eine unbekannte Map-ID reicht den Registry-Fehler durch.
 *
 * Ausführen mit:  npm test
 */
import { describe, it, expect } from "vitest";
import { loadMapTerrain } from "../src/scenes/worldscene/mapterrain";
import { getMapEntry } from "../src/world/maps/mapregistry";
import type { WorldSceneLike } from "../src/scenes/worldscene/types";

/** Minimaler Fake einer WorldScene: loadMapTerrain liest nur scene.mapId/W/H und
 *  schreibt ground/solidGrid/doors/npcSpawns – kein Phaser nötig. Maße kommen wie
 *  in WorldScene.create() (#425) aus demselben Registry-Eintrag. */
function fakeScene(mapId: string): WorldSceneLike {
  const entry = getMapEntry(mapId);
  return { mapId, W: entry.width, H: entry.height } as unknown as WorldSceneLike;
}

describe("loadMapTerrain (#425) – Terrain datengetrieben aus der Map-Registry", () => {
  it("lädt den Hafen über scene.mapId (Maße, Türen, NPC-Standplätze aus der .tmj)", () => {
    const scene = fakeScene("harbor");
    loadMapTerrain(scene);
    // Boden + Kollision auf die Hafen-Maße (52×40) dimensioniert.
    expect(scene.ground.length).toBe(52 * 40);
    expect(scene.solidGrid.length).toBe(52 * 40);
    // Kollision ist nicht leer (Wasser/Wände aus harbor.tmj).
    expect([...scene.solidGrid].some((s: number) => s === 1)).toBe(true);
    // Türen + NPC-Standplätze kommen aus den Objektlayern der harbor.tmj (nicht leer).
    expect(scene.doors.length).toBeGreaterThan(0);
    expect(scene.npcSpawns.length).toBeGreaterThan(0);
  });

  it("honoriert scene.mapId: eine Registry-Karte ohne Boden-Codec scheitert klar", () => {
    // test-map ist eine Registry-Karte OHNE decodeGround (rein per Phaser-Tileset
    // gerendert, kein WorldScene-Terrain). Würde loadMapTerrain fest „harbor" laden,
    // bliebe dieser Aufruf fälschlich erfolgreich – der Wurf beweist, dass scene.mapId
    // wirklich den Eintrag wählt (Red-Green-Absicherung der Parametrisierung).
    const scene = fakeScene("test-map");
    expect(() => loadMapTerrain(scene)).toThrow(/Boden-Codec|decodeGround/);
  });

  it("reicht den Registry-Fehler bei unbekannter Map-ID durch", () => {
    const scene = { mapId: "gibtsnicht", W: 1, H: 1 } as unknown as WorldSceneLike;
    expect(() => loadMapTerrain(scene)).toThrow(/unbekannte Map-ID|gibtsnicht/);
  });
});

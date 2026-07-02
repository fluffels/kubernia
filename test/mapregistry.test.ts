/* Tests für die Map-Registry (#193, Teil 3 von Epic #57).
 *
 * Die Registry ist die zentrale Liste aller Spielkarten (Map-ID → rohes .tmj +
 * Metadaten: Maße, Spawnpunkt, Tileset, Layer-Namen, map-spezifischer Parser).
 * Geprüft wird, inkl. Negativ-/Grenzfälle:
 *  1. jeder Eintrag lädt+validiert sein echtes .tmj-Artefakt sauber,
 *  2. die deklarierten Metadaten (Maße, Tilesets, Layer) stimmen mit dem
 *     tatsächlichen Inhalt des .tmj überein (Drift-Schutz – ein Eintrag kann
 *     nicht hinter seiner Datei zurückfallen),
 *  3. der Hafen-Eintrag decodiert zu exakt derselben Geometrie wie der Code,
 *  4. getMapEntry() liefert bekannte IDs und wirft bei unbekannten.
 *
 * Ausführen mit:  npm test
 */
import { describe, it, expect, expectTypeOf } from "vitest";
import { MAP_REGISTRY, getMapEntry, type MapId } from "../src/world/maps/mapregistry";
import { harborGeometry } from "../src/world/maps/harbormap";
import { collisionGrid } from "../src/world/maps/tilemap";

const ids = Object.keys(MAP_REGISTRY) as MapId[];

describe("Map-Registry – jeder Eintrag ist konsistent zu seinem .tmj", () => {
  it.each(ids)("Eintrag \"%s\" lädt+validiert sein Artefakt", (id) => {
    const entry = MAP_REGISTRY[id];
    expect(entry.id).toBe(id);
    const map = entry.parse(JSON.parse(entry.raw));
    // Deklarierte Maße = tatsächliche Maße im .tmj.
    expect(map.width).toBe(entry.width);
    expect(map.height).toBe(entry.height);
    // Deklarierte Tilesets = tatsächliche Tileset-Namen im .tmj.
    expect(map.tilesets.map((t) => t.name)).toEqual([...entry.tilesets]);
    // Deklarierte Layer existieren wirklich.
    const layerNames = map.layers.map((l) => l.name);
    expect(layerNames).toContain(entry.groundLayer);
    expect(layerNames).toContain(entry.collisionLayer);
    // Optionale Objektlayer (Türen #194 / NPCs #195) müssen existieren, wenn deklariert.
    if (entry.warpLayer) expect(layerNames).toContain(entry.warpLayer);
    if (entry.npcLayer) expect(layerNames).toContain(entry.npcLayer);
  });

  it.each(ids)("Spawn von \"%s\" liegt innerhalb der Karte", (id) => {
    const { spawn, width, height } = MAP_REGISTRY[id];
    expect(spawn.x).toBeGreaterThanOrEqual(0);
    expect(spawn.y).toBeGreaterThanOrEqual(0);
    expect(spawn.x).toBeLessThan(width);
    expect(spawn.y).toBeLessThan(height);
  });
});

describe("Map-Registry – Hafen-Eintrag trägt die echte Welt", () => {
  const harbor = getMapEntry("harbor");
  const map = harbor.parse(JSON.parse(harbor.raw));

  it("decodiert Boden zur selben Geometrie wie der Code", () => {
    expect(harbor.decodeGround).toBeDefined();
    expect(harbor.decodeGround!(map)).toEqual(harborGeometry().ground);
  });

  it("Kollisions-Layer trifft das Solid-Raster exakt", () => {
    expect(collisionGrid(map, harbor.collisionLayer)).toEqual(
      harborGeometry().solid.map((s) => s === 1),
    );
  });
});

describe("getMapEntry – Lookup & Negativfall", () => {
  it("liefert bekannte Einträge per ID", () => {
    expect(getMapEntry("harbor").id).toBe("harbor");
    expect(getMapEntry("test-map").id).toBe("test-map");
  });

  it("wirft mit klarer Meldung bei unbekannter ID", () => {
    expect(() => getMapEntry("gibtsnicht")).toThrow(/unbekannte Map-ID|gibtsnicht/);
  });
});

describe("Map-Registry – MapId ist aus der Registry abgeleitet (#428)", () => {
  it("MapId deckt genau die registrierten Karten ab (Drift-Pin)", () => {
    // Laufzeit-Pin: ändert sich die Registry, muss diese Liste mitgezogen werden.
    expect(Object.keys(MAP_REGISTRY).sort()).toEqual(["harbor", "test-map"]);
    // Typ-Pin: MapId ist exakt diese Schlüsselmenge. Wäre MapId wieder als feste Union
    // hartcodiert und liefe sie von der Registry weg, bräche dieser Vergleich beim
    // Typecheck (npm run typecheck prüft auch test/).
    expectTypeOf<MapId>().toEqualTypeOf<"harbor" | "test-map">();
  });

  it("eine erfundene Karte ist ohne Union-Edit typbar – ein Registry-Eintrag genügt", () => {
    // Kern der #428-Ableitung: eine um einen Eintrag erweiterte Registry liefert den
    // neuen Schlüssel AUTOMATISCH als Teil ihrer Schlüssel-Union – ohne dass irgendwo
    // ein Union-Type von Hand angefasst wird. Genau dieser Automatismus ist das Ziel
    // („neue Karte = ein Eintrag, kein zusätzlicher Union-Edit").
    const erweitert = { ...MAP_REGISTRY, "neue-insel": MAP_REGISTRY.harbor };
    expectTypeOf<keyof typeof erweitert>().toEqualTypeOf<MapId | "neue-insel">();
    expect(Object.keys(erweitert)).toContain("neue-insel");
  });
});

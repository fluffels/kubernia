/* Tests für das Tiled-Tilemap-Grundgerüst (#191, Epic #57).
 *
 * Deckt bewusst nicht nur den Happy Path ab, sondern vor allem die Fehlerfälle:
 * der Validator parseTiledMap() existiert genau dafür, kaputte/unpassende Maps
 * laut scheitern zu lassen, statt sie still falsch zu rendern. Zusätzlich wird
 * das ECHTE ausgelieferte Artefakt assets/maps/test-map.tmj geparst – so ist
 * sichergestellt, dass die Datei, die der Loader in scenes.ts lädt, gültig ist.
 *
 * Ausführen mit:  npm test
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  parseTiledMap,
  tileLayer,
  collisionGrid,
  resolveTilesets,
  objectGroup,
  tiledProps,
  type TiledMap,
} from "../src/world/maps/tilemap";
import { ASSET_MANIFEST } from "../src/assets-data";

const rawTestMap = readFileSync(
  fileURLToPath(new URL("../assets/maps/test-map.tmj", import.meta.url)),
  "utf8",
);

/* Roh-JSON-Knoten für die Negativfälle: bewusst lose (`any`), weil die Tests
 * GEZIELT beliebige tiefe Felder kaputt machen (Typ ändern, Feld löschen, Array
 * kürzen) – genau das, was parseTiledMap(raw: unknown) laut ablehnen soll. Ein
 * präziser TiledMap-Typ würde die Korruptions-Zuweisungen schon am Compiler
 * scheitern lassen und damit den Testzweck unterlaufen; ein rekursiver JSON-Typ
 * ist hier nicht ergonomisch (Indizieren UND primitive Zuweisung zugleich). */

/** Frisch geparste, gültige Map – als Klon-Basis für die Negativfälle, damit
 *  jeder Test gezielt EIN Feld kaputt macht (sonst maskieren sich Fehler). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- absichtlich loses Roh-JSON für gezielte Korruptions-Negativfälle (s.o.)
function freshRaw(): Record<string, any> {
  return JSON.parse(rawTestMap);
}

describe("parseTiledMap – echtes Artefakt test-map.tmj", () => {
  it("parst die ausgelieferte Test-Map ohne Fehler", () => {
    const map = parseTiledMap(freshRaw());
    expect(map.orientation).toBe("orthogonal");
    expect(map.width).toBe(8);
    expect(map.height).toBe(6);
    expect(map.tilewidth).toBe(16);
    expect(map.tileheight).toBe(16);
    expect(map.tilesets.length).toBeGreaterThan(0);
    expect(map.layers.map((l) => l.name)).toEqual(["Boden", "Kollision"]);
  });

  it("jeder Tile-Layer hat width*height Kacheln", () => {
    const map = parseTiledMap(freshRaw());
    for (const layer of map.layers) {
      if (layer.type !== "tilelayer") continue;
      expect(layer.data.length, layer.name).toBe(map.width * map.height);
    }
  });
});

describe("collisionGrid", () => {
  it("markiert den Rand als solide und das Innere als frei", () => {
    const map = parseTiledMap(freshRaw());
    const grid = collisionGrid(map, "Kollision");
    expect(grid.length).toBe(map.width * map.height);
    const solidAt = (x: number, y: number) => grid[y * map.width + x];
    // Ecken + Ränder solide
    expect(solidAt(0, 0)).toBe(true);
    expect(solidAt(7, 0)).toBe(true);
    expect(solidAt(0, 5)).toBe(true);
    expect(solidAt(7, 5)).toBe(true);
    expect(solidAt(3, 0)).toBe(true);
    expect(solidAt(0, 3)).toBe(true);
    // Inneres frei
    expect(solidAt(3, 3)).toBe(false);
    expect(solidAt(1, 1)).toBe(false);
  });

  it("wirft bei unbekanntem Layer-Namen", () => {
    const map = parseTiledMap(freshRaw());
    expect(() => collisionGrid(map, "GibtsNicht")).toThrow(/nicht gefunden/);
  });
});

describe("tileLayer", () => {
  it("findet einen Layer per Name", () => {
    const map = parseTiledMap(freshRaw());
    expect(tileLayer(map, "Boden").name).toBe("Boden");
  });

  it("wirft, wenn der Layer fehlt", () => {
    const map = parseTiledMap(freshRaw());
    expect(() => tileLayer(map, "Foo")).toThrow();
  });
});

describe("resolveTilesets", () => {
  const keys = ASSET_MANIFEST.map((a) => a.key);

  it("löst das Tileset 'town' auf den gleichnamigen Asset-Schlüssel auf", () => {
    const map = parseTiledMap(freshRaw());
    const resolved = resolveTilesets(map, keys);
    expect(resolved).toEqual([{ tiledName: "town", assetKey: "town", firstgid: 1 }]);
  });

  it("wirft, wenn ein Tileset-Name keinen Asset-Schlüssel trifft", () => {
    const raw = freshRaw();
    raw.tilesets[0].name = "gibt-es-nicht-im-manifest";
    const map = parseTiledMap(raw);
    expect(() => resolveTilesets(map, keys)).toThrow(/keinen passenden Asset-Schlüssel/);
  });
});

describe("parseTiledMap – Validierung (Negativfälle)", () => {
  it("lehnt Nicht-Objekte ab", () => {
    expect(() => parseTiledMap(null)).toThrow(/kein JSON-Objekt/);
    expect(() => parseTiledMap("[]")).toThrow();
    expect(() => parseTiledMap(42)).toThrow();
  });

  it("verlangt type='map'", () => {
    const raw = freshRaw();
    raw.type = "tileset";
    expect(() => parseTiledMap(raw)).toThrow(/type muss "map"/);
  });

  it("lehnt nicht-orthogonale Maps ab", () => {
    const raw = freshRaw();
    raw.orientation = "isometric";
    expect(() => parseTiledMap(raw)).toThrow(/orthogonal/);
  });

  it("verlangt positive Map-Maße", () => {
    const raw = freshRaw();
    raw.width = 0;
    expect(() => parseTiledMap(raw)).toThrow(/width\/height/);
  });

  it("verlangt mindestens ein Tileset", () => {
    const raw = freshRaw();
    raw.tilesets = [];
    expect(() => parseTiledMap(raw)).toThrow(/mindestens ein Tileset/);
  });

  it("verlangt mindestens einen Layer", () => {
    const raw = freshRaw();
    raw.layers = [];
    expect(() => parseTiledMap(raw)).toThrow(/mindestens ein Layer/);
  });

  it("lehnt externe Tilesets (ohne image) ab", () => {
    const raw = freshRaw();
    delete raw.tilesets[0].image;
    expect(() => parseTiledMap(raw)).toThrow(/image/);
  });

  it("lehnt unbekannte Layer-Typen ab (nur tilelayer/objectgroup)", () => {
    const raw = freshRaw();
    raw.layers[0].type = "imagelayer";
    expect(() => parseTiledMap(raw)).toThrow(/tilelayer.*objectgroup|objectgroup/);
  });

  it("erkennt eine Layer-Größe, die nicht zur Map passt", () => {
    const raw = freshRaw();
    raw.layers[0].width = 99;
    expect(() => parseTiledMap(raw)).toThrow(/passt nicht zur Map-Größe/);
  });

  it("erkennt eine data-Länge, die nicht width*height entspricht", () => {
    const raw = freshRaw();
    raw.layers[0].data = raw.layers[0].data.slice(0, -1);
    expect(() => parseTiledMap(raw)).toThrow(/Kacheln, erwartet/);
  });

  it("lehnt negative oder nicht-ganzzahlige gids ab", () => {
    const raw = freshRaw();
    raw.layers[0].data[0] = -1;
    expect(() => parseTiledMap(raw)).toThrow(/ungültige gid/);

    const raw2 = freshRaw();
    raw2.layers[0].data[0] = 1.5;
    expect(() => parseTiledMap(raw2)).toThrow(/ungültige gid/);
  });
});

/* ===== Objekt-Layer (#194, Teil 4) ===== */

/** Baut eine minimale gültige Map mit einem Objekt-Layer „Warps" (ein Objekt mit
 *  Properties) – Basis für die Positiv-/Negativfälle. Loses Roh-JSON wie freshRaw
 *  (gezielte Korruption in den Negativfällen). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- absichtlich loses Roh-JSON für gezielte Korruptions-Negativfälle (s. freshRaw)
function rawWithObjectLayer(): Record<string, any> {
  const base = freshRaw();
  base.layers.push({
    id: 9,
    name: "Warps",
    type: "objectgroup",
    visible: true,
    opacity: 1,
    objects: [
      {
        id: 1, name: "tuer1", type: "warp", x: 32, y: 48, width: 16, height: 16,
        properties: [
          { name: "theme", type: "string", value: "office" },
          { name: "title", type: "string", value: "Büro" },
        ],
      },
    ],
  });
  return base;
}

describe("parseTiledMap – Objekt-Layer", () => {
  it("parst einen objectgroup-Layer mit Objekten + Properties", () => {
    const map = parseTiledMap(rawWithObjectLayer());
    const group = objectGroup(map, "Warps");
    expect(group.type).toBe("objectgroup");
    expect(group.objects).toHaveLength(1);
    const o = group.objects[0];
    expect(o.name).toBe("tuer1");
    expect(o.x).toBe(32);
    expect(o.y).toBe(48);
    expect(tiledProps(o)).toEqual({ theme: "office", title: "Büro" });
  });

  it("objectGroup wirft, wenn der Layer fehlt oder ein Tile-Layer ist", () => {
    const map = parseTiledMap(rawWithObjectLayer());
    expect(() => objectGroup(map, "GibtsNicht")).toThrow(/nicht gefunden/);
    expect(() => objectGroup(map, "Boden")).toThrow(/tilelayer.*objectgroup|ist ein tilelayer/);
  });

  it("tileLayer wirft, wenn der Name ein Objekt-Layer ist (kein data-Zugriff ins Leere)", () => {
    const map = parseTiledMap(rawWithObjectLayer());
    expect(() => tileLayer(map, "Warps")).toThrow(/objectgroup|erwartet wurde ein tilelayer/);
  });

  it("lehnt einen objectgroup-Layer ohne objects-Array ab", () => {
    const raw = rawWithObjectLayer();
    delete raw.layers[raw.layers.length - 1].objects;
    expect(() => parseTiledMap(raw)).toThrow(/objects-Array/);
  });

  it("lehnt ein Objekt ohne name ab (name = stabile ID)", () => {
    const raw = rawWithObjectLayer();
    delete raw.layers[raw.layers.length - 1].objects[0].name;
    expect(() => parseTiledMap(raw)).toThrow(/braucht einen name/);
  });

  it("lehnt eine property mit nicht unterstütztem Wert-Typ ab", () => {
    const raw = rawWithObjectLayer();
    raw.layers[raw.layers.length - 1].objects[0].properties[0].value = { nested: true };
    expect(() => parseTiledMap(raw)).toThrow(/nicht unterstützten Wert-Typ/);
  });

  it("lehnt ein Objekt ohne numerische Koordinaten ab", () => {
    const raw = rawWithObjectLayer();
    raw.layers[raw.layers.length - 1].objects[0].x = "nope";
    expect(() => parseTiledMap(raw)).toThrow(/Zahl für x/);
  });
});

/* Red-Green-Beweis (manuell, nicht im Lauf): Setzt man in collisionGrid das
 * `gid !== 0` auf `gid === 0`, kippt der Rand-/Innen-Test sofort auf rot –
 * der Test prüft also wirklich die Kollisionslogik, nicht nur „läuft durch". */
const _typecheckOnly: TiledMap | null = null;
void _typecheckOnly;

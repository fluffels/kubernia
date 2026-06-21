/* ===== Map-Registry (#193, Teil 3 von Epic #57) =====
 * Die EINE zentrale Liste aller Spielkarten: Map-ID → rohes .tmj (Vite ?raw) +
 * Metadaten (Maße, Spawnpunkt, Tileset, Layer-Namen, map-spezifischer Parser/
 * Decoder). Damit kommt eine neue Karte künftig per Registry-Eintrag dazu statt
 * per fest verdrahtetem Pfad im Szenen-Code (Akzeptanz #57: zweite Karte ohne
 * neuen Karten-Code). Die Loader (WorldScene über loadMapTerrain (#425),
 * TilemapTestScene, spawnPlayer-Fallback) holen ihre Karte über getMapEntry(mapId)
 * statt über fest importierte Pfade.
 *
 * Phaser-frei und im Node-Test prüfbar (wie tilemap.ts/harbormap.ts): die
 * ?raw-Importe sind reine Strings, die map-spezifischen parse/decodeGround-
 * Funktionen liegen schon Phaser-frei in harbormap.ts/tilemap.ts.
 */
import { parseTiledMap, type TiledMap } from "./tilemap";
import { parseHarborMap, decodeHarborGround, HARBOR_W, HARBOR_H, WARP_LAYER, NPC_LAYER } from "./harbormap";
import harborMapRaw from "../assets/maps/harbor.tmj?raw";
import testMapRaw from "../assets/maps/test-map.tmj?raw";

/** Ein Registry-Eintrag bündelt Datei + Metadaten einer Karte. */
export interface MapEntry {
  /** Stabile ID (= Schlüssel in MAP_REGISTRY). Bewusst `string`, nicht `MapId`:
   *  `MapId` wird aus `MAP_REGISTRY` ABGELEITET (#428), eine Typisierung als `MapId`
   *  hier wäre zirkulär (MapEntry → MapId → MAP_REGISTRY → MapEntry). */
  readonly id: string;
  /** Sprechender Titel (Debug/HUD). */
  readonly title: string;
  /** Roher .tmj-Inhalt (Vite ?raw) – die „Datei" des Eintrags. */
  readonly raw: string;
  /** Maße in Kacheln (müssen zum .tmj passen – per Test gepinnt). */
  readonly width: number;
  readonly height: number;
  /** Erwartete Tileset-/Asset-Schlüssel der Karte (Reihenfolge wie im .tmj). */
  readonly tilesets: readonly string[];
  /** Layer-Namen, die die Loader brauchen. */
  readonly groundLayer: string;
  readonly collisionLayer: string;
  /** Optionaler Objekt-Layer mit Türen/Warps (#194). Karten ohne eigene Türen
   *  (Test-Map) lassen ihn weg; der Loader liest ihn per objectGroup()/
   *  doorsFromObjectGroup(). */
  readonly warpLayer?: string;
  /** Optionaler Objekt-Layer mit NPC-Standplätzen (#195). Karten ohne eigene NPCs
   *  lassen ihn weg; der Loader liest ihn per objectGroup()/npcsFromObjectGroup(). */
  readonly npcLayer?: string;
  /** Spawnpunkt in Kachelkoordinaten (Fallback, falls kein Spielstand-Pos). */
  readonly spawn: { readonly x: number; readonly y: number };
  /** Map-spezifische Validierung (z.B. Hafen prüft die festen 52×40-Maße). */
  parse(raw: unknown): TiledMap;
  /** Boden-Layer → semantische Bodencodes. Nur Karten mit eigenem Terrain-Codec
   *  (Hafen) tragen das; rein per Phaser-Tileset gerenderte Karten (Test-Map)
   *  brauchen keine Boden-Decodierung. */
  decodeGround?(map: TiledMap): number[];
}

/** Roh-Daten der zentralen Karten-Liste – die EINE Quelle aller Karten. `satisfies`
 *  prüft jeden Eintrag strukturell gegen `MapEntry`, bewahrt aber die literalen
 *  Schlüssel, sodass `MapId` daraus ABGELEITET werden kann (#428). Nach außen wird
 *  unten die einheitliche `Readonly<Record<MapId, MapEntry>>`-Sicht exportiert
 *  (optionale Layer als `?:`-Felder, tief unveränderlich wie zuvor). Eine neue Karte
 *  ist damit NUR ein Eintrag hier (plus das .tmj unter assets/maps/) – kein Union-Edit. */
const MAP_REGISTRY_DATA = {
  harbor: {
    id: "harbor",
    title: "Hafen",
    raw: harborMapRaw,
    width: HARBOR_W,
    height: HARBOR_H,
    tilesets: ["town"],
    groundLayer: "Boden",
    collisionLayer: "Kollision",
    warpLayer: WARP_LAYER,
    npcLayer: NPC_LAYER,
    // Default-Spawn der Karte = vor der Hafenmeisterei bei Ole (×TILE 16 = 400/248 px),
    // konsistent zum Erststart-Default in game.ts (`player`) seit #288. Hinweis: für den
    // Hafen ist dieser Fallback aktuell toter Code – spawnPlayer nimmt immer die (immer
    // gesetzte) gespeicherte Position; er greift nur, falls dieser Guard je entfällt, und
    // wirft den Spieler dann bewusst zu Ole statt aufs Schiff (#294).
    spawn: { x: 25, y: 15.5 },
    parse: parseHarborMap,
    decodeGround: decodeHarborGround,
  },
  "test-map": {
    id: "test-map",
    title: "Tiled-Loader-Test (#191)",
    raw: testMapRaw,
    width: 8,
    height: 6,
    tilesets: ["town"],
    groundLayer: "Boden",
    collisionLayer: "Kollision",
    spawn: { x: 4, y: 3 },
    parse: parseTiledMap,
  },
} satisfies Record<string, MapEntry>;

/** Bekannte Karten-IDs – aus `MAP_REGISTRY_DATA` ABGELEITET (#428), nicht separat als
 *  Union gepflegt. Eine neue Karte = ein Eintrag dort; ihr Schlüssel ist damit
 *  automatisch eine gültige `MapId`, ohne hier irgendetwas zu ändern. */
export type MapId = keyof typeof MAP_REGISTRY_DATA;

/** Die zentrale Karten-Liste als einheitliche, tief unveränderliche `MapEntry`-Sicht
 *  (optionale Layer als `?:`-Felder). Identische Quelle wie `MAP_REGISTRY_DATA`,
 *  nur einheitlich typisiert für die Loader. */
export const MAP_REGISTRY: Readonly<Record<MapId, MapEntry>> = MAP_REGISTRY_DATA;

/** Karten-Eintrag per ID holen; wirft mit klarer Meldung bei unbekannter ID –
 *  sonst lüde ein Loader ins Leere und die Szene bliebe leer. */
export function getMapEntry(id: string): MapEntry {
  const entry = (MAP_REGISTRY as Record<string, MapEntry>)[id];
  if (!entry) {
    throw new Error(
      `Map-Registry: unbekannte Map-ID "${id}" (bekannt: ${Object.keys(MAP_REGISTRY).join(", ")})`,
    );
  }
  return entry;
}

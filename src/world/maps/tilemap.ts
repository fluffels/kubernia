/* ===== Tiled-Tilemap-Grundgerüst (Phaser-frei, pur testbar) =====
 * Teil 1 der Tiled-Map-Migration (#191, Epic #57). Hier liegt NUR die reine
 * Logik rund um Tiled-JSON (.tmj): Typen, Validierung, Kollisions-Extraktion und
 * das Mapping Tileset → Asset-Schlüssel. Das eigentliche Phaser-Rendering
 * (`make.tilemap`/`createLayer`) lebt in scenes.ts (TilemapTestScene) – diese
 * Datei kommt bewusst ohne Phaser aus (wie world.ts/decor.ts) und wird in
 * test/tilemap.test.ts direkt im Node-Test geprüft.
 *
 * Teil 1 deckte orthogonale Maps mit eingebetteten Tilesets und Tile-Layern ab
 * (Boden + Kollision). Teil 4 (#194) ergänzt Objekt-Layer (`objectgroup`) mit
 * benannten Objekten + Custom-Properties – die Datengrundlage für das Warp-/
 * Tür-System (Türen aus dem Objektlayer statt aus der Hardcode-Liste `DOORS`);
 * NPC-Spawns (#195) nutzen dieselben Objekt-Layer. Externe Tileset-Dateien sind
 * weiterhin nicht unterstützt.
 */

/** Ein im .tmj eingebettetes Tileset. Die Pixelmaße/Spalten brauchen wir, damit
 *  Phaser die globalen Tile-IDs (gid) korrekt auf Frames des Tileset-Bilds
 *  abbildet; `name` ist der Schlüssel fürs Mapping auf das ASSET_MANIFEST. */
export interface TiledTileset {
  firstgid: number;
  name: string;
  image: string;
  imagewidth: number;
  imageheight: number;
  tilewidth: number;
  tileheight: number;
  tilecount: number;
  columns: number;
}

/** Ein Tile-Layer: `data` ist row-major (y*width + x); 0 = leere Kachel, sonst
 *  global tile id (gid = firstgid des Tilesets + lokalem Frame-Index). */
export interface TiledTileLayer {
  id: number;
  name: string;
  type: "tilelayer";
  width: number;
  height: number;
  data: number[];
  visible: boolean;
  opacity: number;
}

/** Eine Custom-Property an einem Tiled-Objekt (Tiled speichert sie als Liste von
 *  {name,type,value}). Wert auf die in Tiled üblichen Skalartypen begrenzt. */
export interface TiledProperty {
  name: string;
  type: string;
  value: string | number | boolean;
}

/** Ein Objekt in einem Objekt-Layer (Rechteck/Punkt). Für unser Warp-System ist
 *  jedes Objekt ein 16×16-Rechteck auf einer Kachel: (x,y) ist die linke obere
 *  Ecke in PIXELN (nicht Kacheln), `name` die stabile ID, `properties` tragen die
 *  Warp-Daten (theme/title/npc bzw. Zielkarte+Zielkoordinate). */
export interface TiledObject {
  id: number;
  name: string;
  /** Tiled-„class"/type des Objekts (oft leer); wir lesen die Semantik aus name+properties. */
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  properties?: TiledProperty[];
}

/** Ein Objekt-Layer (`objectgroup`): trägt benannte Objekte statt eines
 *  Kachelrasters. Datengrundlage für Türen/Warps (#194) und NPC-Spawns (#195). */
export interface TiledObjectGroup {
  id: number;
  name: string;
  type: "objectgroup";
  objects: TiledObject[];
  visible: boolean;
  opacity: number;
}

/** Ein Layer ist entweder ein Kachelraster oder ein Objekt-Layer. */
export type TiledLayer = TiledTileLayer | TiledObjectGroup;

/** Die unterstützte Teilmenge einer Tiled-Map (orthogonal, Tile- + Objekt-Layer). */
export interface TiledMap {
  type: "map";
  orientation: "orthogonal";
  width: number;
  height: number;
  tilewidth: number;
  tileheight: number;
  tilesets: TiledTileset[];
  layers: TiledLayer[];
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function posInt(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v) && v > 0;
}

/** Validiert und typisiert rohes Tiled-JSON. Wirft mit klarer Meldung, sobald
 *  etwas fehlt oder nicht zur Erwartung passt – ein still falsch geladenes
 *  Layout (falsche Maße, fehlender Layer) wäre sonst erst im Browser sichtbar.
 *  Gibt dasselbe Objekt typisiert zurück (kann direkt an Phaser weitergereicht
 *  werden). */
export function parseTiledMap(raw: unknown): TiledMap {
  if (!isObj(raw)) throw new Error("Tiled-Map: kein JSON-Objekt");
  if (raw.type !== "map") throw new Error(`Tiled-Map: type muss "map" sein, ist "${String(raw.type)}"`);
  if (raw.orientation !== "orthogonal") {
    throw new Error(`Tiled-Map: orientation muss "orthogonal" sein, ist "${String(raw.orientation)}" (Teil 1 unterstützt nur orthogonale Maps)`);
  }
  if (!posInt(raw.width) || !posInt(raw.height)) throw new Error("Tiled-Map: width/height müssen positive Ganzzahlen sein");
  if (!posInt(raw.tilewidth) || !posInt(raw.tileheight)) throw new Error("Tiled-Map: tilewidth/tileheight müssen positive Ganzzahlen sein");

  if (!Array.isArray(raw.tilesets) || raw.tilesets.length === 0) throw new Error("Tiled-Map: mindestens ein Tileset erwartet");
  const tilesets = raw.tilesets.map((t, i) => parseTileset(t, i));

  if (!Array.isArray(raw.layers) || raw.layers.length === 0) throw new Error("Tiled-Map: mindestens ein Layer erwartet");
  const layers = raw.layers.map((l, i) => parseLayer(l, i, raw.width as number, raw.height as number));

  return {
    type: "map",
    orientation: "orthogonal",
    width: raw.width,
    height: raw.height,
    tilewidth: raw.tilewidth,
    tileheight: raw.tileheight,
    tilesets,
    layers,
  };
}

function parseTileset(raw: unknown, i: number): TiledTileset {
  if (!isObj(raw)) throw new Error(`Tiled-Map: Tileset #${i} ist kein Objekt`);
  if (typeof raw.name !== "string" || raw.name.length === 0) throw new Error(`Tiled-Map: Tileset #${i} braucht einen name`);
  if (typeof raw.image !== "string") throw new Error(`Tiled-Map: Tileset "${raw.name}" braucht ein image (externe Tilesets sind in Teil 1 nicht unterstützt)`);
  if (!posInt(raw.firstgid)) throw new Error(`Tiled-Map: Tileset "${raw.name}" braucht eine positive firstgid`);
  if (!posInt(raw.columns) || !posInt(raw.tilecount)) throw new Error(`Tiled-Map: Tileset "${raw.name}" braucht positive columns/tilecount`);
  if (!posInt(raw.imagewidth) || !posInt(raw.imageheight)) throw new Error(`Tiled-Map: Tileset "${raw.name}" braucht positive imagewidth/imageheight`);
  if (!posInt(raw.tilewidth) || !posInt(raw.tileheight)) throw new Error(`Tiled-Map: Tileset "${raw.name}" braucht positive tilewidth/tileheight`);
  return {
    firstgid: raw.firstgid,
    name: raw.name,
    image: raw.image,
    imagewidth: raw.imagewidth,
    imageheight: raw.imageheight,
    tilewidth: raw.tilewidth,
    tileheight: raw.tileheight,
    tilecount: raw.tilecount,
    columns: raw.columns,
  };
}

function parseLayer(raw: unknown, i: number, mapW: number, mapH: number): TiledLayer {
  if (!isObj(raw)) throw new Error(`Tiled-Map: Layer #${i} ist kein Objekt`);
  if (raw.type === "objectgroup") return parseObjectGroup(raw, i);
  if (raw.type !== "tilelayer") throw new Error(`Tiled-Map: Layer "${String(raw.name)}" hat type "${String(raw.type)}" – unterstützt sind "tilelayer" und "objectgroup"`);
  return parseTileLayer(raw, i, mapW, mapH);
}

function parseTileLayer(raw: Record<string, unknown>, i: number, mapW: number, mapH: number): TiledTileLayer {
  if (typeof raw.name !== "string" || raw.name.length === 0) throw new Error(`Tiled-Map: Layer #${i} braucht einen name`);
  if (raw.width !== mapW || raw.height !== mapH) {
    throw new Error(`Tiled-Map: Layer "${raw.name}" (${String(raw.width)}×${String(raw.height)}) passt nicht zur Map-Größe (${mapW}×${mapH})`);
  }
  if (!Array.isArray(raw.data)) throw new Error(`Tiled-Map: Layer "${raw.name}" braucht ein data-Array`);
  if (raw.data.length !== mapW * mapH) {
    throw new Error(`Tiled-Map: Layer "${raw.name}" hat ${raw.data.length} Kacheln, erwartet ${mapW * mapH}`);
  }
  for (const gid of raw.data) {
    if (typeof gid !== "number" || !Number.isInteger(gid) || gid < 0) {
      throw new Error(`Tiled-Map: Layer "${raw.name}" enthält eine ungültige gid (${String(gid)}) – erwartet Ganzzahl ≥ 0`);
    }
  }
  return {
    id: typeof raw.id === "number" ? raw.id : i + 1,
    name: raw.name,
    type: "tilelayer",
    width: mapW,
    height: mapH,
    data: raw.data as number[],
    visible: raw.visible !== false,
    opacity: typeof raw.opacity === "number" ? raw.opacity : 1,
  };
}

function parseObjectGroup(raw: Record<string, unknown>, i: number): TiledObjectGroup {
  if (typeof raw.name !== "string" || raw.name.length === 0) throw new Error(`Tiled-Map: Layer #${i} braucht einen name`);
  if (!Array.isArray(raw.objects)) throw new Error(`Tiled-Map: Objekt-Layer "${raw.name}" braucht ein objects-Array`);
  const objects = raw.objects.map((o, j) => parseTiledObject(o, j, raw.name as string));
  return {
    id: typeof raw.id === "number" ? raw.id : i + 1,
    name: raw.name,
    type: "objectgroup",
    objects,
    visible: raw.visible !== false,
    opacity: typeof raw.opacity === "number" ? raw.opacity : 1,
  };
}

function parseTiledObject(raw: unknown, j: number, layerName: string): TiledObject {
  if (!isObj(raw)) throw new Error(`Tiled-Map: Objekt #${j} im Layer "${layerName}" ist kein Objekt`);
  if (typeof raw.name !== "string" || raw.name.length === 0) throw new Error(`Tiled-Map: Objekt #${j} im Layer "${layerName}" braucht einen name (= stabile ID)`);
  const num = (v: unknown, field: string): number => {
    if (typeof v !== "number" || !Number.isFinite(v)) throw new Error(`Tiled-Map: Objekt "${raw.name}" braucht eine Zahl für ${field}`);
    return v;
  };
  return {
    id: typeof raw.id === "number" ? raw.id : j + 1,
    name: raw.name,
    type: typeof raw.type === "string" ? raw.type : "",
    x: num(raw.x, "x"),
    y: num(raw.y, "y"),
    width: num(raw.width, "width"),
    height: num(raw.height, "height"),
    ...(raw.properties !== undefined ? { properties: parseProperties(raw.properties, raw.name) } : {}),
  };
}

function parseProperties(raw: unknown, objName: string): TiledProperty[] {
  if (!Array.isArray(raw)) throw new Error(`Tiled-Map: properties von Objekt "${objName}" müssen ein Array sein`);
  return raw.map((p, k) => {
    if (!isObj(p) || typeof p.name !== "string" || p.name.length === 0) {
      throw new Error(`Tiled-Map: property #${k} von Objekt "${objName}" braucht einen name`);
    }
    const t = typeof p.value;
    if (t !== "string" && t !== "number" && t !== "boolean") {
      throw new Error(`Tiled-Map: property "${p.name}" von Objekt "${objName}" hat einen nicht unterstützten Wert-Typ (${t}) – erlaubt: string/number/boolean`);
    }
    return { name: p.name, type: typeof p.type === "string" ? p.type : t, value: p.value as string | number | boolean };
  });
}

/** Findet einen Tile-Layer per Name; wirft, wenn er fehlt oder ein Objekt-Layer
 *  ist (damit `data`-Zugriffe nie ins Leere greifen). */
export function tileLayer(map: TiledMap, name: string): TiledTileLayer {
  const layer = map.layers.find((l) => l.name === name);
  if (!layer) throw new Error(`Tiled-Map: Layer "${name}" nicht gefunden (vorhanden: ${map.layers.map((l) => l.name).join(", ")})`);
  if (layer.type !== "tilelayer") throw new Error(`Tiled-Map: Layer "${name}" ist ein ${layer.type}, erwartet wurde ein tilelayer`);
  return layer;
}

/** Findet einen Objekt-Layer per Name; wirft, wenn er fehlt oder ein Tile-Layer
 *  ist. Liefert die typisierten Objekte (Türen/Warps/Spawns). */
export function objectGroup(map: TiledMap, name: string): TiledObjectGroup {
  const layer = map.layers.find((l) => l.name === name);
  if (!layer) throw new Error(`Tiled-Map: Objekt-Layer "${name}" nicht gefunden (vorhanden: ${map.layers.map((l) => l.name).join(", ")})`);
  if (layer.type !== "objectgroup") throw new Error(`Tiled-Map: Layer "${name}" ist ein ${layer.type}, erwartet wurde ein objectgroup`);
  return layer;
}

/** Custom-Properties eines Objekts als bequemes Name→Wert-Mapping (Tiled legt
 *  sie als Liste ab). Fehlende properties → leeres Objekt. */
export function tiledProps(obj: TiledObject): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  for (const p of obj.properties ?? []) out[p.name] = p.value;
  return out;
}

/** Kollisionsraster aus einem benannten Layer: `true`, wo eine Kachel liegt
 *  (gid !== 0). Row-major (y*width + x) – dasselbe Layout wie `solidGrid` in
 *  scenes.ts/world.ts, damit die Bewegungslogik es direkt nutzen kann. */
export function collisionGrid(map: TiledMap, layerName: string): boolean[] {
  return tileLayer(map, layerName).data.map((gid) => gid !== 0);
}

/** Auflösung Tiled-Tileset → Asset-Schlüssel. Konvention: der Tileset-`name` im
 *  .tmj entspricht exakt einem Schlüssel im ASSET_MANIFEST (assets-data.ts). So
 *  weiß der Loader, welche bereits geladene Textur er per `addTilesetImage` an
 *  das Tileset hängt. Wirft, wenn ein Tileset keinen Manifest-Schlüssel trifft –
 *  sonst lüde Phaser ins Leere und die Map bliebe unsichtbar. */
export function resolveTilesets(
  map: TiledMap,
  manifestKeys: readonly string[],
): { tiledName: string; assetKey: string; firstgid: number }[] {
  return map.tilesets.map((ts) => {
    if (!manifestKeys.includes(ts.name)) {
      throw new Error(`Tiled-Map: Tileset "${ts.name}" hat keinen passenden Asset-Schlüssel im ASSET_MANIFEST – bekannte Schlüssel u.a.: ${manifestKeys.slice(0, 8).join(", ")}…`);
    }
    return { tiledName: ts.name, assetKey: ts.name, firstgid: ts.firstgid };
  });
}

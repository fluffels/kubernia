/* ===== Hafenkarte als pure Geometrie + Tiled-Serialisierung (Phaser-frei) =====
 * Teil 2 der Tiled-Map-Migration (#192, Epic #57). Hier liegt die reine
 * Boden-/Kollisions-Geometrie der bestehenden 52×40-Hafenkarte – exakt die
 * Terrain-Schreibvorgänge, die früher inline in WorldScene.buildMap() (scenes.ts)
 * standen. Daraus wird `assets/maps/harbor.tmj` generiert (siehe
 * `harborTiledMap()` + test/harbormap.test.ts) und im Datenpfad wieder geladen.
 *
 * WICHTIG – warum kein Phaser-`createLayer`-Rendering wie in der TilemapTestScene?
 * Der Hafen-Boden wird NICHT aus einem Kachel-Sheet gestempelt, sondern per
 * Wang-Autotiling (renderGround() in scenes.ts) aus den PixelLab-Tilesets gemalt;
 * Gebäude/Deko sind PixelLab-Bilder. Eine `createLayer`-Variante über ein
 * Kachel-Sheet könnte den Look NICHT 1:1 reproduzieren. Darum trägt die .tmj hier
 * die Geometrie als DATEN (Boden = semantische Terrain-Codes, Kollision = solide
 * Kacheln) und der Datenpfad speist damit denselben Renderer → pixelgleich, aber
 * aus der Datei. Gebäude/NPCs/Türen als Tiled-Objektlayer kommen in #194/#195.
 *
 * Bodencodes (müssen zu den Konstanten in scenes.ts passen; per Test gepinnt):
 *   -2 Wasser · -3 Sandstrand · 0/1/2 Gras-Varianten · 25 Erde/Weg ·
 *   96/97/98 Hafenkai-Stein · -10 Holz (Steg/Schiffsanleger).
 * Hinweis (#108): Das Schiff schwimmt – unterm Rumpf liegt Wasser (-2, aber
 * begehbar, solidGrid 0), kein eigenes Deck-Holz mehr; nur der schmale Steg
 * SHIP_PIER ist Holz (-10). Die Wasser/Steg-Aufteilung im Schiffsbereich liefert
 * die pure shipTile()-Geometrie aus world.ts.
 */
import { SHIP, SHIP_PIER, shipTile, TILE, ENTRANCES, NPC_SPAWNS, type Door, type Spawn } from "../../world";
import { WORLD_JETTY } from "../regions/archipel";
import { parseTiledMap, tileLayer, type TiledMap } from "./tilemap";

/** Maße der Hafenkarte (identisch zu WorldScene.W/H). */
export const HARBOR_W = 52;
export const HARBOR_H = 40;

/** Semantische Bodencodes (Spiegel der scenes.ts-Konstanten – per Test gepinnt). */
export const WATER = -2;
export const SAND = -3;
export const DIRT = 25;
export const STONE = [96, 97, 98] as const;
export const PIER = -10;   // Holz-Steg / Anleger / Schiffsanleger

/** X-Startspalten der drei Anlege-Stege (je 3 Kacheln breit). Auch in scenes.ts
 *  für die Steg-Labels/Knoten genutzt – eine Quelle, damit beides nicht driftet. */
export const PIER_XS = [5, 11, 17] as const;

/** Wo Land auf Wasser trifft. Pur kopiert aus WorldScene.coastY() – Kai- und
 *  Schiffsbereich gerade, sonst geschwungener Strand. */
export function coastY(x: number): number {
  if (x >= 3 && x <= 24) return 27;   // Hafenkai: gemauerte, gerade Kante
  if (x >= 30 && x <= 38) return 27;  // Wasser rund ums Schiff
  let c = 26 + Math.round(Math.sin(x * 0.9) * 1.2 + Math.sin(x * 0.31) * 0.9);
  if (x >= 43) c = Math.min(c, 26);   // Platz für Leuchtturm-Strand & Ost-Plateau
  return Math.max(25, Math.min(28, c));
}

/** Boden- und (struktur-)Kollisionsraster der Hafenkarte. Reproduziert exakt die
 *  Terrain-Schreibvorgänge der buildMap(): Küste/Wasser/Sand/Gras, Hafenkai, Stege,
 *  schwimmendes Schiff (Wasser unterm Rumpf + Steg, #108), Archipel-Anleger,
 *  Marktplatz, Wege. NICHT enthalten (kommt zur Laufzeit in placeHarborObjects()
 *  bzw. spawnNpcs()): Gebäude-/Baum-/Deko-/Leuchtturm-Solids, freigeräumte Türen,
 *  NPC-Solids. */
export function harborGeometry(W = HARBOR_W, H = HARBOR_H): { ground: number[]; solid: number[] } {
  const ground = new Array<number>(W * H).fill(0);
  const solid = new Array<number>(W * H).fill(0);
  const set = (x: number, y: number, v: number) => { ground[y * W + x] = v; };
  // Begehbare Kachel (Steg/Anleger/Schiffsrumpf-Wasser): Boden setzen + (vorher
  // solides) Wasser darunter wieder freiräumen.
  const walkable = (x: number, y: number, v: number) => { ground[y * W + x] = v; solid[y * W + x] = 0; };
  // Weg ziehen wie buildMap.path(): erst in x, dann in y, jede berührte Kachel = Erde.
  const path = (x0: number, y0: number, x1: number, y1: number) => {
    let x = x0, y = y0;
    const sx = Math.sign(x1 - x0), sy = Math.sign(y1 - y0);
    while (x !== x1) { set(x, y, DIRT); x += sx; }
    while (y !== y1) { set(x, y, DIRT); y += sy; }
    set(x1, y1, DIRT);
  };

  // Grundterrain: Küste (Wasser solide), Sandstrand, gemischtes Gras.
  for (let x = 0; x < W; x++) {
    const cY = coastY(x);
    const beach = !(x >= 3 && x <= 24) && !(x >= 30 && x <= 38);
    for (let y = 0; y < H; y++) {
      if (y >= cY + (beach ? 2 : 0)) {
        set(x, y, WATER); solid[y * W + x] = 1;
      } else if (beach && y >= cY) {
        set(x, y, SAND);
      } else {
        const r = (((x * 73856093) ^ (y * 19349663)) >>> 0) % 100;
        set(x, y, r < 80 ? 0 : r < 93 ? 1 : 2);
      }
    }
  }

  // Hafenkai (begehbare Stein-Plattform – Gras-Solid 0 bleibt).
  for (let y = 24; y <= 26; y++) for (let x = 3; x <= 24; x++) set(x, y, STONE[(x * 3 + y) % 3]);

  // Stege (Cluster-Knoten): je 3 Kacheln breit, begehbar.
  for (const px of PIER_XS) {
    for (let y = 27; y <= 33; y++) for (let x = px; x < px + 3; x++) walkable(x, y, PIER);
  }

  // Eigenes Schiff (#108): Schiff schwimmt – pro Kachel im Schiffsbereich liefert
  // die pure shipTile()-Geometrie Holz-Steg (-10) bzw. Wasser unterm Rumpf (-2);
  // beides begehbar (das Schiff-Sprite deckt das Deck ab).
  const shipY0 = Math.min(SHIP.y, SHIP_PIER.y0);
  const shipY1 = Math.max(SHIP.y + SHIP.h - 1, SHIP_PIER.y1);
  for (let y = shipY0; y <= shipY1; y++)
    for (let x = 0; x < W; x++) {
      const t = shipTile(x, y);
      if (!t) continue;
      walkable(x, y, t === "pier" ? PIER : WATER);
    }

  // Anleger zum GitOps-Archipel.
  for (let y = WORLD_JETTY.y0; y <= WORLD_JETTY.y1; y++)
    for (let x = WORLD_JETTY.x; x < WORLD_JETTY.x + WORLD_JETTY.w; x++) walkable(x, y, PIER);

  // Marktplatz (Erde).
  for (let y = 16; y <= 22; y++) for (let x = 24; x <= 32; x++) set(x, y, DIRT);

  // Wege.
  path(28, 22, 28, 24);
  path(26, 16, 26, 14);
  path(24, 19, 13, 19); path(13, 19, 13, 15);
  path(32, 19, 41, 19);
  path(33, 16, 40, 13);
  path(26, 14, 26, 13);   // bis vor die Tür der Hafenmeisterei
  path(40, 13, 40, 12);   // bis vor die Tür des Kartenhauses

  // Erd-Vorplätze vor Werft und Vermessung.
  for (let y = 10; y <= 15; y++) for (let x = 8; x <= 17; x++) set(x, y, DIRT);
  for (let y = 18; y <= 22; y++) for (let x = 41; x <= 46; x++) set(x, y, DIRT);

  return { ground, solid };
}

/* ===== Tiled-Serialisierung =====
 * Tiled erlaubt nur gids >= 1 (0 = leere Kachel). Der Hafen-Boden enthält aber
 * negative Codes (Wasser -2, Holz -10 …). Darum wird im Boden-Layer jeder
 * Bodencode linear um GROUND_GID_OFFSET verschoben gespeichert; der Datenpfad
 * rechnet beim Laden zurück. Da JEDE Kachel ein Terrain trägt, kommt im
 * Boden-Layer nie eine 0 vor. Der minimale Code (-10) landet so auf gid 2,
 * der maximale (98) auf gid 110 – beides innerhalb des town-Tilesets (132). */
export const GROUND_GID_OFFSET = 12;
/** gid, mit dem der Kollisions-Layer solide Kacheln markiert (frei = 0). */
const COLLISION_GID = 14;

export function encodeGround(code: number): number { return code + GROUND_GID_OFFSET; }
export function decodeGround(gid: number): number { return gid - GROUND_GID_OFFSET; }

/* ===== Türen / Warps als Objektlayer (#194, Teil 4 von Epic #57) =====
 * Die Türen kommen jetzt datengetrieben aus einem Tiled-Objektlayer statt aus der
 * Hardcode-Liste DOORS. Quelle der Objekte sind die Code-Eingänge ENTRANCES
 * (Häuser + Schiff) aus world.ts – analog dazu, wie der Boden-Layer aus
 * harborGeometry() entsteht. Der Datenpfad (scenes.ts loadHarborMap) liest sie
 * per doorsFromObjectGroup() zurück; der Round-Trip ist per Test gepinnt. */

/** Name des Tür-/Warp-Objektlayers in der Hafen-.tmj. */
export const WARP_LAYER = "Türen";

/** Eine Tür/Warp als Tiled-Rechteck-Objekt: (x,y) = linke obere Ecke in Pixeln,
 *  16×16 groß auf der Tür-Kachel; die Warp-Daten als Custom-Properties. */
function warpObject(d: Door, id: number): Record<string, unknown> {
  const properties: { name: string; type: string; value: string | number }[] = [
    { name: "theme", type: "string", value: d.theme },
    { name: "title", type: "string", value: d.title },
  ];
  if (d.npc !== undefined) properties.push({ name: "npc", type: "string", value: d.npc });
  if (d.target !== undefined) properties.push({ name: "target", type: "string", value: d.target });
  if (d.targetX !== undefined) properties.push({ name: "targetX", type: "int", value: d.targetX });
  if (d.targetY !== undefined) properties.push({ name: "targetY", type: "int", value: d.targetY });
  return {
    id,
    name: d.id,
    type: "warp",
    x: d.tx * TILE,
    y: d.ty * TILE,
    width: TILE,
    height: TILE,
    rotation: 0,
    visible: true,
    properties,
  };
}

/** Der Tür-/Warp-Objektlayer der Hafenkarte – aus den Code-Eingängen serialisiert. */
export function harborWarpLayer(): Record<string, unknown> {
  return {
    id: 3,
    name: WARP_LAYER,
    type: "objectgroup",
    visible: true,
    opacity: 1,
    x: 0,
    y: 0,
    draworder: "topdown",
    objects: ENTRANCES.map((d, i) => warpObject(d, i + 1)),
  };
}

/* ===== NPC-Standplätze als Objektlayer (#195, Teil 5 von Epic #57) =====
 * Die festen NPC-Standplätze kommen jetzt datengetrieben aus einem Tiled-
 * Objektlayer statt aus der Hardcode-Liste NPC_SPAWNS. Quelle der Objekte ist
 * dieselbe Liste NPC_SPAWNS aus world.ts – analog dazu, wie der Tür-Layer aus
 * ENTRANCES entsteht. Der Datenpfad (scenes.ts loadHarborMap) liest sie per
 * npcsFromObjectGroup() zurück; der Round-Trip ist per Test gepinnt. Die
 * Quiz-Krabbe Kralle steht bewusst NICHT hier (relativ zum Schiff, erst zur
 * Laufzeit ergänzt) – genau wie sie auch in NPC_SPAWNS fehlt. */

/** Name des NPC-Spawn-Objektlayers in der Hafen-.tmj. */
export const NPC_LAYER = "NPCs";

/** Ein NPC-Standplatz als Tiled-Rechteck-Objekt: (x,y) = linke obere Ecke in Pixeln
 *  auf der (ggf. Bruch-)Standplatz-Kachel; die NPC-ID steht im `name`. Keine
 *  Custom-Properties – ein Standplatz ist nur Position + ID. Die Objekt-`id` setzt
 *  sich hinter den Tür-Objekten fort (map-weit eindeutig in Tiled). */
function npcObject(s: Spawn, id: number): Record<string, unknown> {
  return {
    id,
    name: s.id,
    type: "npc",
    x: s.x * TILE,
    y: s.y * TILE,
    width: TILE,
    height: TILE,
    rotation: 0,
    visible: true,
  };
}

/** Der NPC-Spawn-Objektlayer der Hafenkarte – aus NPC_SPAWNS serialisiert. Die
 *  Objekt-ids beginnen hinter den Tür-Objekten (ENTRANCES.length), damit sie
 *  map-weit eindeutig bleiben. */
export function harborNpcLayer(): Record<string, unknown> {
  return {
    id: 4,
    name: NPC_LAYER,
    type: "objectgroup",
    visible: true,
    opacity: 1,
    x: 0,
    y: 0,
    draworder: "topdown",
    objects: NPC_SPAWNS.map((s, i) => npcObject(s, ENTRANCES.length + i + 1)),
  };
}

/** Baut das vollständige Tiled-JSON-Objekt der Hafenkarte (Quelle für harbor.tmj).
 *  Das eingebettete `town`-Tileset erfüllt nur das Schema (Name ∈ ASSET_MANIFEST,
 *  image vorhanden); gerendert wird der Boden NICHT daraus, sondern aus den
 *  decodierten Terrain-Codes via renderGround(). */
export function harborTiledMap(): Record<string, unknown> {
  const { ground, solid } = harborGeometry();
  return {
    type: "map",
    version: "1.10",
    tiledversion: "1.10.2",
    orientation: "orthogonal",
    renderorder: "right-down",
    infinite: false,
    width: HARBOR_W,
    height: HARBOR_H,
    tilewidth: 16,
    tileheight: 16,
    nextlayerid: 5,
    nextobjectid: ENTRANCES.length + NPC_SPAWNS.length + 1,
    compressionlevel: -1,
    tilesets: [
      {
        firstgid: 1,
        name: "town",
        image: "../town.png",
        imagewidth: 192,
        imageheight: 176,
        tilewidth: 16,
        tileheight: 16,
        tilecount: 132,
        columns: 12,
        margin: 0,
        spacing: 0,
      },
    ],
    layers: [
      {
        id: 1,
        name: "Boden",
        type: "tilelayer",
        visible: true,
        opacity: 1,
        x: 0,
        y: 0,
        width: HARBOR_W,
        height: HARBOR_H,
        data: ground.map(encodeGround),
      },
      {
        id: 2,
        name: "Kollision",
        type: "tilelayer",
        visible: true,
        opacity: 1,
        x: 0,
        y: 0,
        width: HARBOR_W,
        height: HARBOR_H,
        data: solid.map((s) => (s ? COLLISION_GID : 0)),
      },
      harborWarpLayer(),
      harborNpcLayer(),
    ],
  };
}

/** Lädt + validiert eine Hafen-.tmj und gibt das geprüfte Map-Objekt zurück. */
export function parseHarborMap(raw: unknown): TiledMap {
  const map = parseTiledMap(raw);
  if (map.width !== HARBOR_W || map.height !== HARBOR_H) {
    throw new Error(`Hafenkarte: erwarte ${HARBOR_W}×${HARBOR_H}, ist ${map.width}×${map.height}`);
  }
  return map;
}

/** Boden-Layer einer Hafen-.tmj zurück in die semantischen Terrain-Codes
 *  decodieren (row-major, y*W+x) – direkt als WorldScene.ground verwendbar. */
export function decodeHarborGround(map: TiledMap): number[] {
  return tileLayer(map, "Boden").data.map(decodeGround);
}

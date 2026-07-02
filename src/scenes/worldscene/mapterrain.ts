/* ===== KubeQuest – generischer Karten-Terrain-Lader (worldscene/mapterrain.ts) =====
 * #425 (Kind von #415, Block „Skalierungs-Enabler"). Lädt Boden/Kollision/Türen/
 * NPC-Standplätze einer Karte DATENGETRIEBEN aus der Map-Registry über
 * `getMapEntry(scene.mapId)` – statt fest „harbor" zu verdrahten. Eine zweite
 * Tiled-Region kommt damit als Registry-Eintrag dazu, nicht als neue Szenen-Klasse.
 *
 * Bewusst Phaser-frei (nur die pure Map-Registry + harbormap/tilemap-Helfer, alle
 * pure Domäne), damit im Node-Test prüfbar. Die HAFEN-spezifische Szenerie (Schiff/
 * Gebäude/Leuchtturm/Türen-Optik) bleibt in terrain.ts; die datengetriebene Region-
 * Szenerie folgt mit #427 (RegionScene). Hier liegt nur der gemeinsame Terrain-Schritt.
 */
import { NPC_SPAWNS, ENTRANCES, doorsFromObjectGroup, npcsFromObjectGroup } from "../../world";
import { collisionGrid, objectGroup } from "../../world/maps/tilemap";
import { getMapEntry } from "../../world/maps/mapregistry";
import type { WorldSceneLike } from "./types";

/** #425: Boden + Kollision + Türen + NPC-Standplätze der Karte `scene.mapId` aus
 *  der Registry laden. Maße (`scene.W`/`scene.H`) setzt die Szene vorab aus
 *  demselben Registry-Eintrag (`entry.width`/`entry.height`), damit das Solid-Raster
 *  passt. Türen/NPCs kommen datengetrieben aus den Objektlayern der .tmj (#194/#195);
 *  Karten ohne eigene Layer fallen auf die Hafen-Code-Defaults zurück.
 *
 *  Eine über die WorldScene geladene Karte braucht einen Boden-Codec
 *  (`entry.decodeGround`) – fehlt er (reine Tileset-Karte wie die Loader-Testkarte),
 *  scheitert das hart und klar, statt still eine leere Welt zu rendern. */
export function loadMapTerrain(scene: WorldSceneLike) {
  const entry = getMapEntry(scene.mapId);
  const map = entry.parse(JSON.parse(entry.raw));
  if (!entry.decodeGround) {
    throw new Error(
      `WorldScene-Karte "${entry.id}" braucht einen Boden-Codec (decodeGround) in der Map-Registry.`,
    );
  }
  scene.ground = entry.decodeGround(map);
  scene.solidGrid = new Uint8Array(scene.W * scene.H);
  collisionGrid(map, entry.collisionLayer).forEach((solid, i) => { if (solid) scene.solidGrid[i] = 1; });
  // #194: Türen/Warps datengetrieben aus dem Objektlayer der .tmj statt aus der
  // Hardcode-Liste – der Beweis, dass der Tiled-Loader auch die Türen trägt.
  scene.doors = entry.warpLayer ? doorsFromObjectGroup(objectGroup(map, entry.warpLayer)) : ENTRANCES.slice();
  // #195: NPC-Standplätze datengetrieben aus dem Objektlayer der .tmj statt aus
  // der Hardcode-Liste – der Beweis, dass der Tiled-Loader auch die NPCs trägt.
  scene.npcSpawns = entry.npcLayer ? npcsFromObjectGroup(objectGroup(map, entry.npcLayer)) : NPC_SPAWNS.slice();
}

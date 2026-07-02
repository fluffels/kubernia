import Phaser from "phaser";
import { ASSET_MANIFEST } from "../assets-data";
import { parseTiledMap, collisionGrid, resolveTilesets } from "../world/maps/tilemap";
import { getMapEntry } from "../world/maps/mapregistry";
import { pixelText } from "./shared";

/** #191 (Epic #57): Demonstriert die Tiled-Map-Infrastruktur anhand einer
 *  minimalen test-map.tmj. Erreichbar über ?maptest. Beweist den ganzen Pfad:
 *  .tmj parsen/validieren (tilemap.ts) → Tileset-Name auf ASSET_MANIFEST-Bild
 *  mappen → Tile-Layer rendern → Kollisions-Ring im Debug-Overlay sichtbar.
 *  Zweite Karte ohne neuen Karten-Code – Akzeptanzkriterium für #196/#57
 *  (buildMap() ist entfernt; WorldScene lädt immer aus harbor.tmj). */
export class TilemapTestScene extends Phaser.Scene {
  /** Row-major Kollisionsraster der Testkarte (Demo-Beleg #191, hier nur gesetzt). */
  solidGrid!: boolean[];
  constructor() { super("MapTest"); }

  create() {
    // 1) .tmj parsen + validieren (reine Logik aus tilemap.ts). Das geparste,
    //    geprüfte Objekt geht 1:1 in Phasers Tilemap-Cache – kein zweites Parsen.
    const data = parseTiledMap(JSON.parse(getMapEntry("test-map").raw));
    this.cache.tilemap.add("test-map", { format: Phaser.Tilemaps.Formats.TILED_JSON, data });
    const map = this.make.tilemap({ key: "test-map" });

    // 2) Tileset-Bild ↔ Tiled-Tileset auflösen: der Tileset-Name im .tmj ist der
    //    ASSET_MANIFEST-Schlüssel der bereits in der BootScene geladenen Textur.
    const manifestKeys = ASSET_MANIFEST.map((a) => a.key);
    const tilesets = resolveTilesets(data, manifestKeys)
      .map((r) => map.addTilesetImage(r.tiledName, r.assetKey))
      .filter((t): t is Phaser.Tilemaps.Tileset => t !== null);

    // 3) Boden-Layer rendern.
    map.createLayer("Boden", tilesets, 0, 0);

    // 4) Kollisionslayer: alle gesetzten Kacheln (gid != 0) kollidieren. Die reine
    //    collisionGrid()-Funktion liefert dasselbe Raster (row-major wie world.ts)
    //    für die spätere Spiel-Logik; hier zusätzlich Phasers Layer-Kollision +
    //    Debug-Overlay als Sicht-Beweis im Browser.
    const collision = map.createLayer("Kollision", tilesets, 0, 0);
    collision?.setCollisionByExclusion([-1]);
    this.solidGrid = collisionGrid(data, "Kollision");

    const debug = this.add.graphics().setDepth(100);
    collision?.renderDebug(debug, {
      tileColor: null,
      collidingTileColor: new Phaser.Display.Color(255, 90, 60, 120),
      faceColor: new Phaser.Display.Color(255, 230, 130, 200),
    });

    // Kamera mittig auf die kleine Map, kräftiger Zoom (16px-Tiles).
    const cam = this.cameras.main;
    cam.setBackgroundColor(0x1b2433);
    cam.centerOn(map.widthInPixels / 2, map.heightInPixels / 2);
    cam.setZoom(6);

    // Fixierte Beschriftung, damit klar ist: das ist die Tiled-Testszene (#191).
    const cw = cam.width, ch = cam.height;
    pixelText(this, cw / 2, 12, "🧭 Tiled-Loader-Test (#191)", { color: "#ffe9b0", size: 16, origin: [0.5, 0], depth: 20000, shadow: true }).setScrollFactor(0);
    pixelText(this, cw / 2, ch - 16, "Boden-Layer + Kollisions-Ring (rot) aus assets/maps/test-map.tmj", { color: "#cfe3ff", size: 12, origin: [0.5, 1], depth: 20000, shadow: true }).setScrollFactor(0);
  }
}

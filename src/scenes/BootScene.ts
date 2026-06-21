import Phaser from "phaser";
import { ASSET_MANIFEST } from "../assets-data";
import { T, buildPixelFont, buildCoinIcon } from "./shared";

export class BootScene extends Phaser.Scene {
  constructor() { super("Boot"); }
  preload() {
    // a.src ist im Dev-Server eine URL, im Single-File-Build eine Base64-Data-URI.
    // Der Phaser-Loader kommt mit beidem klar (Data-URIs laden ohne XHR – Doppelklick-tauglich).
    // Laden ist für plain wie sheet identisch; das Frame-Slicing folgt erst in create().
    for (const a of ASSET_MANIFEST) this.load.image(a.key, a.src);
  }
  create() {
    // Pixel-Bitmap-Font + Münz-Icon einmalig backen (#188) – global im Cache,
    // damit World/Interior/Archipel/MapTest sie ohne erneutes Laden nutzen.
    buildPixelFont(this);
    buildCoinIcon(this);
    // Nur Sheets in Frames schneiden; plains bleiben ganze Bilder. Spaltenzahl und
    // Frame-Größe kommen aus dem Manifest (Default 16), nicht mehr aus Listen hier.
    for (const a of ASSET_MANIFEST) {
      if (a.kind !== "sheet") continue;
      const frame = a.frame ?? T;
      const tex = this.textures.get(a.key);
      const img = tex.getSourceImage();
      const rows = Math.floor(img.height / frame);
      for (let i = 0; i < a.cols * rows; i++) {
        tex.add(i, 0, (i % a.cols) * frame, Math.floor(i / a.cols) * frame, frame, frame);
      }
    }
    // #191: Mit ?maptest in der URL startet statt der Welt die Tiled-Loader-Testszene
    // (parallel zur prozeduralen buildMap()). Sonst ganz normal die WorldScene.
    const params = new URLSearchParams(typeof location !== "undefined" ? location.search : "");
    this.scene.start(params.has("maptest") ? "MapTest" : "World");
  }
}

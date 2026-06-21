import Phaser from "phaser";
import { COMMON_ASSETS } from "../assets-data";
import { buildPixelFont, buildCoinIcon, queueAssetLoad, sliceSheets } from "./shared";

export class BootScene extends Phaser.Scene {
  constructor() { super("Boot"); }
  preload() {
    // #198: NUR die gemeinsamen + Startinsel-Assets vorab laden (COMMON_ASSETS = alles ohne
    // scene-Tag). Die region-exklusiven Assets (Archipel/Leuchtturm/Lager) lädt die jeweilige
    // RegionScene erst beim Betreten nach – so lädt der Start nicht mehr Inseln, die man noch
    // gar nicht besucht hat. a.src ist im Dev-/Host-Build eine URL, im Single-File-Build eine
    // Base64-Data-URI (lädt ohne XHR – Doppelklick-tauglich); der Loader kommt mit beidem klar.
    queueAssetLoad(this, COMMON_ASSETS);
  }
  create() {
    // Pixel-Bitmap-Font + Münz-Icon einmalig backen (#188) – global im Cache,
    // damit World/Interior/Region/MapTest sie ohne erneutes Laden nutzen.
    buildPixelFont(this);
    buildCoinIcon(this);
    // Sheets der gemeinsamen Assets in Frames schneiden (plains bleiben ganze Bilder);
    // Region-Sheets schneidet später die jeweilige RegionScene (#198).
    sliceSheets(this, COMMON_ASSETS);
    // #191: Mit ?maptest in der URL startet statt der Welt die Tiled-Loader-Testszene
    // (parallel zur prozeduralen buildMap()). Sonst ganz normal die WorldScene.
    const params = new URLSearchParams(typeof location !== "undefined" ? location.search : "");
    this.scene.start(params.has("maptest") ? "MapTest" : "World");
  }
}

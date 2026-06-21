// Barrel: bündelt die einzelnen Phaser-Szenen-Module zu KQScenes (#345). Die Szenen liegen seit
// dem Split eine Datei je Klasse unter src/scenes/; gemeinsame Helfer in src/scenes/shared.ts.
//
// Die drei Nachbar-Regionen (Archipel/Leuchtturm/Lager) sind seit #427 KEINE eigenen Klassen
// mehr, sondern EINE datengetriebene RegionScene je Config (src/scenes/regions.ts) – hier zu
// Szenen-Instanzen gebaut und als REGION_SCENES exportiert (main.ts registriert sie).
import { BootScene } from "./scenes/BootScene";
import { WorldScene } from "./scenes/WorldScene";
import { InteriorScene } from "./scenes/InteriorScene";
import { RegionScene } from "./scenes/RegionScene";
import { REGION_CONFIGS } from "./scenes/regions";
import { TilemapTestScene } from "./scenes/TilemapTestScene";

/** Die Region-Szenen (Archipel/Leuchtturm/Lager) als fertige Instanzen – eine je RegionConfig
 *  (#427). Phaser akzeptiert vorab instanziierte Szenen im scene-Array von main.ts. */
export const REGION_SCENES = REGION_CONFIGS.map((cfg) => new RegionScene(cfg));

export const KQScenes = { BootScene, WorldScene, InteriorScene, REGION_SCENES, TilemapTestScene };

/* Asset-Manifest – die EINE Datenquelle pro Grafik.
 * Jedes PNG steht hier mit genau einem Eintrag: Schlüssel, importierter Pfad, Typ
 * (plain = ganzes Bild | sheet = wird in Frames geschnitten) und für Sheets die
 * Spaltenzahl (+ optionale Frame-Größe, Default 16). Der Phaser-Loader (BootScene in
 * scenes.ts) und das Frame-Slicing leiten sich generisch aus diesem Manifest ab –
 * früher musste man jedes Asset an ZWEI Stellen verdrahten (KQAssets + BOOT_SHEETS/
 * BOOT_PLAINS in scenes.ts), was leicht zu vergessen war (#59).
 *
 * Dieselbe Quelle versorgt beide Build-Wege (Ticket #58): Im Dev-Server und im
 * Host-Build (`npm run build`) gibt Vite eine URL zurück (Asset bleibt eine eigene,
 * cachebare Datei); im Offline-Build (`npm run build:offline`, vite-plugin-singlefile)
 * eine inline Base64-Data-URI – so bleibt der Doppelklick-Offline-Build self-contained,
 * ohne dass Base64 von Hand gepflegt wird.
 * Die PNGs in assets/ sind damit die einzige Quelle. Schlüssel = wie in scenes.ts/ui.ts
 * referenziert; Mapping der Tileset-Schlüssel auf Dateinamen siehe assets/pixellab/README.md. */

// Kenney-Spritesheets (Tiny Town / Tiny Dungeon, CC0)
import town from "../assets/town.png";
import dungeon from "../assets/dungeon.png";

// PixelLab Wang-Tilesets (water-sand = coast, sand-grass = meadow, grass-dirt = path, …)
import coast from "../assets/pixellab/water-sand.png";
import meadow from "../assets/pixellab/sand-grass.png";
import path from "../assets/pixellab/grass-dirt.png";
import kai from "../assets/pixellab/water-stone.png";
import dock from "../assets/pixellab/water-wood.png";

// PixelLab-Objekte
import flowers from "../assets/pixellab/flowers.png";
// Gestreute Gras-Büschel (#107): echte Pixelart-Sprites statt prozeduraler Dreieck-Halme
import grasstuft0 from "../assets/pixellab/grasstuft0.png";
import grasstuft1 from "../assets/pixellab/grasstuft1.png";
import grasstuft2 from "../assets/pixellab/grasstuft2.png";
import tree from "../assets/pixellab/tree.png";
import pine from "../assets/pixellab/pine.png";
import bush from "../assets/pixellab/bush.png";
import rock from "../assets/pixellab/rock.png";
import barrel from "../assets/pixellab/barrel.png";
import crate from "../assets/pixellab/crate.png";
import well from "../assets/pixellab/well.png";
import stall from "../assets/pixellab/stall.png";
import lamppost from "../assets/pixellab/lamppost.png";
import mushroom from "../assets/pixellab/mushroom.png";
import seashell from "../assets/pixellab/seashell.png";
import driftwood from "../assets/pixellab/driftwood.png";
import signpost from "../assets/pixellab/signpost.png";
import sign from "../assets/pixellab/sign.png";
import lighthouse from "../assets/pixellab/lighthouse.png";
import grafana_board from "../assets/pixellab/grafana_board.png";   // Monitoring-Dashboard (#111)
import alert_bell from "../assets/pixellab/alert_bell.png";         // Alarm-Glocke (#111)
import container from "../assets/pixellab/container.png";           // Frachtcontainer-Stapel (#124)
import crane from "../assets/pixellab/crane.png";                   // Hafen-Verladekran (#124)
import house_office from "../assets/pixellab/house_office.png";
import house_forge from "../assets/pixellab/house_forge.png";
import house_chart from "../assets/pixellab/house_chart.png";
import ship from "../assets/pixellab/ship.png";
import kraken from "../assets/pixellab/kraken.png";   // Hacker-Krake (Gegner, #184)
import pirate_ship from "../assets/pixellab/pirate_ship.png";   // Piraten-Schiff (Gegner, #185)
import seagull from "../assets/pixellab/seagull.png";           // Möwe (#182)

// PixelLab-Figuren (nur south-Frame genutzt)
import char_player from "../assets/pixellab/char_player.png";
import char_player_east from "../assets/pixellab/char_player_east.png";
import char_player_north from "../assets/pixellab/char_player_north.png";
import char_player_west from "../assets/pixellab/char_player_west.png";
import char_ole from "../assets/pixellab/char_ole.png";
import char_runa from "../assets/pixellab/char_runa.png";
import char_pelle from "../assets/pixellab/char_pelle.png";
import char_bo from "../assets/pixellab/char_bo.png";
import char_ada from "../assets/pixellab/char_ada.png";
import char_theo from "../assets/pixellab/char_theo.png";
import char_kralle from "../assets/pixellab/char_kralle.png";
import char_juno from "../assets/pixellab/char_juno.png";
import char_argos from "../assets/pixellab/char_argos.png";
import char_lumi from "../assets/pixellab/char_lumi.png";
import char_knut from "../assets/pixellab/char_knut.png";   // Speicher-Verwalter Knut (#125)
import char_vidar from "../assets/pixellab/char_vidar.png";   // Wachveteran Vidar (#131)

// PixelLab-Shop-Haustiere
import pet_ratte from "../assets/pixellab/pet_ratte.png";
import pet_fledermaus from "../assets/pixellab/pet_fledermaus.png";
import pet_geist from "../assets/pixellab/pet_geist.png";

/** Region-Szenen-Keys, deren Assets erst beim Betreten nachgeladen werden (#198,
 *  Lazy-Loading). Wert = Phaser-Szenen-Key der Region (RegionConfig.key in
 *  scenes/regions.ts). Ein Asset OHNE `scene` ist gemeinsam/Startinsel und wird in der
 *  BootScene vorab geladen. */
export type AssetScene = "Archipel" | "Lighthouse" | "Warehouse" | "Watchtower";

/** Ein Asset im Manifest. `plain` = ganzes Bild, `sheet` = nach dem Laden in
 *  `cols`×Zeilen Frames der Größe `frame` (Default 16) geschnitten. `scene` markiert
 *  region-exklusive Assets, die erst beim Insel-/Szenenwechsel nachgeladen werden (#198);
 *  fehlt es, ist das Asset gemeinsam + wird beim Start geladen. */
export type AssetEntry =
  | { key: string; src: string; kind: "plain"; scene?: AssetScene }
  | { key: string; src: string; kind: "sheet"; cols: number; frame?: number; scene?: AssetScene };

/** Die EINE Quelle: jedes Asset genau einmal. Neues Asset = ein Eintrag hier
 *  (plus den Import oben) – kein Nachziehen in scenes.ts mehr nötig. */
export const ASSET_MANIFEST: readonly AssetEntry[] = [
  // Spritesheets (werden in 16er-Frames geschnitten)
  { key: "town", src: town, kind: "sheet", cols: 12 },
  { key: "dungeon", src: dungeon, kind: "sheet", cols: 12 },
  { key: "coast", src: coast, kind: "sheet", cols: 4 },
  { key: "meadow", src: meadow, kind: "sheet", cols: 4 },
  { key: "path", src: path, kind: "sheet", cols: 4 },
  { key: "kai", src: kai, kind: "sheet", cols: 4 },
  { key: "dock", src: dock, kind: "sheet", cols: 4 },

  // Einzelobjekte ohne Slicing (ganze Bilder)
  { key: "flowers", src: flowers, kind: "plain" },
  // Gras-Büschel-Varianten (#107) – gestreut über die Wiese (spawnGrassDetail)
  { key: "grasstuft0", src: grasstuft0, kind: "plain" },
  { key: "grasstuft1", src: grasstuft1, kind: "plain" },
  { key: "grasstuft2", src: grasstuft2, kind: "plain" },
  { key: "tree", src: tree, kind: "plain" },
  { key: "pine", src: pine, kind: "plain" },
  { key: "bush", src: bush, kind: "plain" },
  { key: "rock", src: rock, kind: "plain" },
  { key: "barrel", src: barrel, kind: "plain" },
  { key: "crate", src: crate, kind: "plain" },
  { key: "well", src: well, kind: "plain" },
  { key: "stall", src: stall, kind: "plain" },
  { key: "lamppost", src: lamppost, kind: "plain" },
  { key: "mushroom", src: mushroom, kind: "plain" },
  { key: "seashell", src: seashell, kind: "plain" },
  { key: "driftwood", src: driftwood, kind: "plain" },
  { key: "signpost", src: signpost, kind: "plain" },
  { key: "sign", src: sign, kind: "plain" },
  { key: "lighthouse", src: lighthouse, kind: "plain" },
  // Region-exklusiv (#198, Lazy-Loading): erst beim Betreten der jeweiligen Region geladen.
  { key: "grafana_board", src: grafana_board, kind: "plain", scene: "Lighthouse" },   // Monitoring-Dashboard (#111)
  { key: "alert_bell", src: alert_bell, kind: "plain", scene: "Lighthouse" },         // Alarm-Glocke (#111)
  { key: "container", src: container, kind: "plain", scene: "Warehouse" },           // Frachtcontainer-Stapel (#124)
  { key: "crane", src: crane, kind: "plain", scene: "Warehouse" },                   // Hafen-Verladekran (#124)
  { key: "house_office", src: house_office, kind: "plain" },
  { key: "house_forge", src: house_forge, kind: "plain" },
  { key: "house_chart", src: house_chart, kind: "plain" },
  { key: "ship", src: ship, kind: "plain" },
  { key: "kraken", src: kraken, kind: "plain" },   // Hacker-Krake (Gegner, #184)
  { key: "pirate_ship", src: pirate_ship, kind: "plain" },   // Piraten-Schiff (Gegner, #185)
  { key: "seagull", src: seagull, kind: "plain" },           // Möwe (#182)

  // PixelLab-Figuren (nur south-Frame genutzt)
  { key: "char_player", src: char_player, kind: "plain" },
  { key: "char_player_east", src: char_player_east, kind: "plain" },
  { key: "char_player_north", src: char_player_north, kind: "plain" },
  { key: "char_player_west", src: char_player_west, kind: "plain" },
  { key: "char_ole", src: char_ole, kind: "plain" },
  { key: "char_runa", src: char_runa, kind: "plain" },
  { key: "char_pelle", src: char_pelle, kind: "plain" },
  { key: "char_bo", src: char_bo, kind: "plain" },
  { key: "char_ada", src: char_ada, kind: "plain" },
  { key: "char_theo", src: char_theo, kind: "plain" },
  { key: "char_kralle", src: char_kralle, kind: "plain" },
  { key: "char_juno", src: char_juno, kind: "plain" },
  { key: "char_argos", src: char_argos, kind: "plain", scene: "Archipel" },     // Insel-NPC – nur im Archipel gerendert (Porträt läuft über KQAssets-URL)
  { key: "char_lumi", src: char_lumi, kind: "plain", scene: "Lighthouse" },     // Insel-NPC – nur am Leuchtturm gerendert
  { key: "char_knut", src: char_knut, kind: "plain", scene: "Warehouse" },   // Speicher-Verwalter Knut (#125) – nur im Lager gerendert
  { key: "char_vidar", src: char_vidar, kind: "plain", scene: "Watchtower" },   // Wachveteran Vidar (#131) – nur im Wachturm-Quartier gerendert

  // PixelLab-Shop-Haustiere
  { key: "pet_ratte", src: pet_ratte, kind: "plain" },
  { key: "pet_fledermaus", src: pet_fledermaus, kind: "plain" },
  { key: "pet_geist", src: pet_geist, kind: "plain" },
];

/** Abgeleitete Schlüssel→Pfad-Tabelle (für ui.ts-Porträts u.a.).
 *  Wird aus dem Manifest erzeugt, NICHT von Hand gepflegt. */
export const KQAssets: Record<string, string> = Object.fromEntries(
  ASSET_MANIFEST.map((a) => [a.key, a.src]),
);

/** Gemeinsame + Startinsel-Assets (#198): alles OHNE `scene`-Tag. Die BootScene lädt genau
 *  diese vorab – Figuren/HUD/Terrain der Hauptkarte „Port Kubernia" + alle scene-übergreifend
 *  genutzten Sprites. Die region-exklusiven Assets bleiben außen vor und werden erst beim
 *  Betreten ihrer Region nachgeladen (assetsForScene + RegionScene.preload). */
export const COMMON_ASSETS: readonly AssetEntry[] = ASSET_MANIFEST.filter((a) => !a.scene);

/** Die region-exklusiven Assets einer Szene (#198): erst beim Insel-/Szenenwechsel
 *  nachgeladen. `scene` ist der Phaser-Szenen-Key der Region (RegionConfig.key); ein
 *  unbekannter Key liefert eine leere Liste (kein Nachladen nötig). */
export function assetsForScene(scene: string): readonly AssetEntry[] {
  return ASSET_MANIFEST.filter((a) => a.scene === scene);
}

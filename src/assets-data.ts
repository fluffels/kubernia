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

// Terraform-Plateau-Boden (#672): 16px-Holzplanken-Tile, ersetzt Kenney-dungeon-WOOD
import tf_floor from "../assets/pixellab/tf_floor.png";

// Interior-Boden/Wand-Tiles (#187): 16px-Einzelkacheln (Holzboden, Haus-Stein-Wand, Schiffsrumpf-Wand)
import interior_floor from "../assets/pixellab/interior_floor.png";
import interior_wall_house from "../assets/pixellab/interior_wall_house.png";
import interior_wall_ship from "../assets/pixellab/interior_wall_ship.png";

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
import pod_hull from "../assets/pixellab/pod_hull.png";
import well from "../assets/pixellab/well.png";
import stall from "../assets/pixellab/stall.png";
import lamppost from "../assets/pixellab/lamppost.png";
import mushroom from "../assets/pixellab/mushroom.png";
import seashell from "../assets/pixellab/seashell.png";
import driftwood from "../assets/pixellab/driftwood.png";
import signpost from "../assets/pixellab/signpost.png";
import sign from "../assets/pixellab/sign.png";
import lighthouse from "../assets/pixellab/lighthouse.png";
import watchtower from "../assets/pixellab/watchtower.png";         // Wachturm-Quartier-Turm (#440)
import grafana_board from "../assets/pixellab/grafana_board.png";   // Monitoring-Dashboard (#111)
import alert_bell from "../assets/pixellab/alert_bell.png";         // Alarm-Glocke (#111)
import container from "../assets/pixellab/container.png";           // Frachtcontainer-Stapel (#124)
import crane from "../assets/pixellab/crane.png";                   // Hafen-Verladekran (#124)
import house_office from "../assets/pixellab/house_office.png";
import house_forge from "../assets/pixellab/house_forge.png";
import house_chart from "../assets/pixellab/house_chart.png";
// Gebäudespezifische Außen-Türen (#186): ersetzen die prozeduralen Rechteck-Türen
import door_office from "../assets/pixellab/door_office.png";
import door_forge from "../assets/pixellab/door_forge.png";
import door_chart from "../assets/pixellab/door_chart.png";
import ship from "../assets/pixellab/ship.png";
// Interior-Einrichtung (#187): echte Pixelart statt prozeduraler Ellipsen/Rechtecke
import porthole from "../assets/pixellab/porthole.png";         // Messing-Bullauge (Schiff)
import interior_door from "../assets/pixellab/interior_door.png"; // Innen-Tür (Haus, Austritt)
import ship_hatch from "../assets/pixellab/ship_hatch.png";     // Decksluke (Schiff, Austritt)
// Innenraum-Möbel (#669): Tisch/Konsole/Buch/Amboss ersetzen die dungeon-Frames
import interior_table from "../assets/pixellab/interior_table.png";
import interior_console from "../assets/pixellab/interior_console.png";
import interior_book from "../assets/pixellab/interior_book.png";
import interior_anvil from "../assets/pixellab/interior_anvil.png";
import kraken from "../assets/pixellab/kraken.png";   // Hacker-Krake (Gegner, #184)
import pirate_ship from "../assets/pixellab/pirate_ship.png";   // Piraten-Schiff (Gegner, #185)
import seagull from "../assets/pixellab/seagull.png";           // Möwe (#182)
import cannon from "../assets/pixellab/cannon.png";             // Hafen-Kanone (Shop-Upgrade, #183)
import ship_frame from "../assets/pixellab/ship_frame.png";     // Schiffsrumpf im Bau, Heimat-Werft (#456)
import scaffold from "../assets/pixellab/scaffold.png";         // Werft-Baugerüst, Heimat-Werft (#456)
import shed from "../assets/pixellab/shed.png";                 // Lagerschuppen für gestoppte Container (#678)

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
import char_saga from "../assets/pixellab/char_saga.png";   // Flottenkommandantin Saga (#149)
import char_greta from "../assets/pixellab/char_greta.png";   // Werftmeisterin Greta (#166)

// PixelLab-Shop-Haustiere
import pet_ratte from "../assets/pixellab/pet_ratte.png";
import pet_fledermaus from "../assets/pixellab/pet_fledermaus.png";
import pet_geist from "../assets/pixellab/pet_geist.png";
import pet_katze from "../assets/pixellab/pet_katze.png";

// HUD-Statuszeilen-Icons (#645, Fundament-Slice von #204): gerahmte Pixel-Icons im
// warmen Stardew-Ton (16px-Raster, selective outline, detailed shading) für die
// dauersichtbare DOM-Statuszeile (index.html #hud). BEWUSST getrennt vom
// ASSET_MANIFEST oben: das speist den Phaser-BootScene-Loader (GPU-Texturen); diese
// Icons leben nur im DOM als <img>, würden als Phaser-Texturen nur unnötig geladen.
// Gemeinsame Quelle bleibt trotzdem diese Datei – der Offline-Build inlinet die
// importierten URLs als Base64-Data-URI (wie bei den Phaser-Assets).
import hud_coin from "../assets/pixellab/hud_coin.png";
import hud_streak from "../assets/pixellab/hud_streak.png";
import hud_clock from "../assets/pixellab/hud_clock.png";
import hud_season_spring from "../assets/pixellab/hud_season_spring.png";
import hud_season_summer from "../assets/pixellab/hud_season_summer.png";
import hud_season_autumn from "../assets/pixellab/hud_season_autumn.png";
import hud_season_winter from "../assets/pixellab/hud_season_winter.png";
// HUD-Tastenleisten-Icons (#646, Slice 2/4 von #204): ersetzen die Emoji in #hud-keys.
import hud_walk from "../assets/pixellab/hud_walk.png";
import hud_talk from "../assets/pixellab/hud_talk.png";
import hud_terminal from "../assets/pixellab/hud_terminal.png";
import hud_logbook from "../assets/pixellab/hud_logbook.png";
import hud_album from "../assets/pixellab/hud_album.png";
import hud_menu from "../assets/pixellab/hud_menu.png";

// Menü-Button-Icons (#648, Slice 4/4 von #204): dieselben gerahmten DOM-Icons wie die
// HUD-Statuszeile oben, nur für die vier Menü-Aktionen (Weiterspielen/Sichern/Laden/
// Zurücksetzen). Auch diese sind reine DOM-<img>, keine Phaser-Texturen.
import menu_play from "../assets/pixellab/menu_play.png";
import menu_save from "../assets/pixellab/menu_save.png";
import menu_load from "../assets/pixellab/menu_load.png";
import menu_reset from "../assets/pixellab/menu_reset.png";
// Panel-Kopf-Icons (#647, Slice 3 von #204): dieselbe DOM-Icon-Idee wie die HUD-Icons oben,
// für die Köpfe der Overlay-Panels (index.html `.panel-head`). Bewusst NUR die Motive, die
// keine andere Slice bespielt: Shop/Krabbe/Spiel. Logbuch/Album/Terminal/Menü liegen in der
// Tastenleisten-Slice #646 (hud_logbook/hud_album/hud_terminal/hud_menu) – die Panel-Köpfe
// dieser vier werden erst nach deren Merge auf die gemeinsamen Icons umgestellt (kein Doppel).
// Ein Spiel-Icon deckt alle sechs Minispiel-Panels ab (Stapel/Pod-Pack/YAML/Routing/Drift/RBAC).
import icon_shop from "../assets/pixellab/icon_shop.png";
import icon_kralle from "../assets/pixellab/icon_kralle.png";
import icon_game from "../assets/pixellab/icon_game.png";

/** Region-Szenen-Keys, deren Assets erst beim Betreten nachgeladen werden (#198,
 *  Lazy-Loading). Wert = Phaser-Szenen-Key der Region (RegionConfig.key in
 *  scenes/regions.ts). Ein Asset OHNE `scene` ist gemeinsam/Startinsel und wird in der
 *  BootScene vorab geladen. */
export type AssetScene = "Archipel" | "Lighthouse" | "Warehouse" | "Watchtower" | "Flotte" | "Werft";

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
  { key: "pod_hull", src: pod_hull, kind: "plain" },
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
  { key: "watchtower", src: watchtower, kind: "plain", scene: "Watchtower" },        // Wachturm (#440)
  { key: "ship_frame", src: ship_frame, kind: "plain", scene: "Werft" },             // Schiffsrumpf im Bau (#456)
  { key: "scaffold", src: scaffold, kind: "plain", scene: "Werft" },                 // Werft-Baugerüst (#456)
  { key: "house_office", src: house_office, kind: "plain" },
  { key: "house_forge", src: house_forge, kind: "plain" },
  { key: "house_chart", src: house_chart, kind: "plain" },
  // Gebäudespezifische Außen-Türen (#186), an der Fußlinie über die Gebäude-Front gesetzt
  { key: "door_office", src: door_office, kind: "plain" },
  { key: "door_forge", src: door_forge, kind: "plain" },
  { key: "door_chart", src: door_chart, kind: "plain" },
  { key: "ship", src: ship, kind: "plain" },
  { key: "tf_floor", src: tf_floor, kind: "plain" },           // Terraform-Plateau-Boden (#672)
  // Interior-Einrichtung (#187): Bullauge/Tür/Luke + Boden/Wand-Kacheln ersetzen prozedurale Formen im Innenraum
  { key: "porthole", src: porthole, kind: "plain" },
  { key: "interior_door", src: interior_door, kind: "plain" },
  { key: "ship_hatch", src: ship_hatch, kind: "plain" },
  { key: "interior_floor", src: interior_floor, kind: "plain" },
  { key: "interior_wall_house", src: interior_wall_house, kind: "plain" },
  { key: "interior_wall_ship", src: interior_wall_ship, kind: "plain" },
  // Innenraum-Möbel (#669): Tisch/Konsole/Buch/Amboss ersetzen die dungeon-Frames
  { key: "interior_table", src: interior_table, kind: "plain" },
  { key: "interior_console", src: interior_console, kind: "plain" },
  { key: "interior_book", src: interior_book, kind: "plain" },
  { key: "interior_anvil", src: interior_anvil, kind: "plain" },
  { key: "kraken", src: kraken, kind: "plain" },   // Hacker-Krake (Gegner, #184)
  { key: "pirate_ship", src: pirate_ship, kind: "plain" },   // Piraten-Schiff (Gegner, #185)
  { key: "seagull", src: seagull, kind: "plain" },           // Möwe (#182)
  { key: "cannon", src: cannon, kind: "plain" },             // Hafen-Kanone (Shop-Upgrade, #183)
  { key: "shed", src: shed, kind: "plain" },                 // Lagerschuppen für gestoppte Container (#678)

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
  { key: "char_saga", src: char_saga, kind: "plain", scene: "Flotte" },   // Flottenkommandantin Saga (#149) – nur auf der Expeditions-Flotte gerendert
  { key: "char_greta", src: char_greta, kind: "plain", scene: "Werft" },   // Werftmeisterin Greta (#166) – nur in der Heimat-Werft gerendert

  // PixelLab-Shop-Haustiere
  { key: "pet_ratte", src: pet_ratte, kind: "plain" },
  { key: "pet_fledermaus", src: pet_fledermaus, kind: "plain" },
  { key: "pet_geist", src: pet_geist, kind: "plain" },
  { key: "pet_katze", src: pet_katze, kind: "plain" },
];

/** Abgeleitete Schlüssel→Pfad-Tabelle (für ui.ts-Porträts u.a.).
 *  Wird aus dem Manifest erzeugt, NICHT von Hand gepflegt. */
export const KQAssets: Record<string, string> = Object.fromEntries(
  ASSET_MANIFEST.map((a) => [a.key, a.src]),
);

/** HUD-DOM-Icon-URLs (#645): Schlüssel → Vite-Asset-URL, für `<img>`-Icons in der
 *  dauersichtbaren Statuszeile (index.html #hud). Getrennt von `KQAssets`, weil diese
 *  Icons keine Phaser-Texturen sind (siehe Import-Kommentar oben). Die Folge-Slices von
 *  #204 (Tastenleiste/Panel-Köpfe/Menü-Buttons) hängen ihre DOM-Icons hier mit an. */
export const HUD_ICONS = {
  coins: hud_coin,
  streak: hud_streak,
  time: hud_clock,
} as const;

/** Saison-Icons in Kalender-Reihenfolge (#645): Index 0..3 = Frühling/Sommer/Herbst/
 *  Winter, exakt gespiegelt zu `GameClock.seasonIndex` (core/clock.ts). Das HUD tauscht
 *  das Saison-Icon anhand dieses Index (hud.ts › setClock). */
export const HUD_SEASON_ICONS: readonly string[] = [
  hud_season_spring, hud_season_summer, hud_season_autumn, hud_season_winter,
];

/** Menü-Button-DOM-Icon-URLs (#648, Slice 4/4 von #204): Schlüssel → Vite-Asset-URL, für
 *  die `<img>`-Icons der vier Menü-Aktionen (index.html #overlay-menu .menu-actions).
 *  Wie `HUD_ICONS` getrennt von `KQAssets`, weil reine DOM-Icons, keine Phaser-Texturen. */
export const MENU_ICONS = {
  play: menu_play,
  save: menu_save,
  load: menu_load,
  reset: menu_reset,
} as const;

/** HUD-Tastenleisten-Icon-URLs (#646, Slice 2/4 von #204): Aktion → Vite-Asset-URL, für
 *  die `<img>`-Icons in der Steuer-Hinweisleiste (index.html #hud-keys, gerendert in
 *  ui/overlay.ts › renderKeyHints). Schlüssel = die umbelegbaren Aktionen (core/keybindings.ts)
 *  plus die festen `walk`/`menu`. Gleiche DOM-Icon-Idee wie `HUD_ICONS`, keine Phaser-Textur. */
export const HUD_KEY_ICONS = {
  walk: hud_walk,
  talk: hud_talk,
  radio: hud_terminal,
  logbook: hud_logbook,
  album: hud_album,
  menu: hud_menu,
} as const;

/** Panel-Kopf-DOM-Icons (#647, Slice 3 von #204): `data-icon`-Schlüssel → Vite-Asset-URL,
 *  für die `<img class="pixel-icon" data-icon="…">` in den `.panel-head`-Leisten (index.html).
 *  `initHudIcons` (ui/hud.ts) verdrahtet sie generisch über das `data-icon`-Attribut, damit
 *  neue Panel-Köpfe hier nur einen Eintrag ergänzen müssen. Eigene Motive (Shop/Krabbe/Spiel);
 *  `game` teilen sich alle sechs Minispiel-Panels. Logbuch/Album/Terminal/Menü **teilen sich
 *  bewusst die #646-Tastenleisten-Icons** (`hud_logbook`/`hud_album`/`hud_terminal`/`hud_menu`) –
 *  gleiches Motiv, EIN Asset statt Doppel. Getrennt von `KQAssets` (keine Phaser-Texturen). */
export const PANEL_ICONS: Record<string, string> = {
  shop: icon_shop,
  kralle: icon_kralle,
  game: icon_game,
  logbuch: hud_logbook,
  album: hud_album,
  terminal: hud_terminal,
  menu: hud_menu,
};

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

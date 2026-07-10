# PixelLab-Assets & Autotiling (Kubernia)

Diese Grafiken wurden mit **PixelLab AI** (https://api.pixellab.ai/mcp) im Stardew-angelehnten
Stil erzeugt und ersetzen nach und nach die ursprünglichen Kenney-Tiny-Platzhalter.
Jede Datei liegt hier als PNG und wird in `src/assets-data.ts` per `import` eingebunden;
der Single-File-Offline-Build inlinet sie automatisch als Base64-Data-URI, bleibt also
self-contained. Die `.json` sind die Tileset-Metadaten.

## Einheitlicher Stil (immer mitgeben)
- **Tiles:** 16×16, `selective outline`, `detailed shading`, `highly detailed`, `high top-down`
- **Figuren:** `low top-down`, `chibi`, `selective outline`, `high detail`, size 32, 4 Richtungen (nur `south`-Frame genutzt)
- **Maßstab:** Mensch = **1 Kachel (16px)**. Daran alles ausrichten (Baum ~3 Kacheln, Busch ~1, Fass ~1).

## Terrain-Tilesets (Wang, `create_topdown_tileset` → 16 Tiles, 4×4)
Verkettet über `lower_base_tile_id`, damit gemeinsame Terrains pixelgleich anschließen.

| Datei | Übergang | tileset_id | base tiles (lower→upper) |
|---|---|---|---|
| `water-sand` (coast) | Wasser→Sand | 0df35065-b4c6-4a58-93ce-b8c11caeeb5a | water 356778f0… → sand 096ddbfb… (neu generiert #342: `pro`-Modus, raggedness 0.4 = sanft geschwungene, lebendigere Uferlinie; an dieselben Basetiles gekettet) |
| `sand-grass` (meadow) | Sand→Gras | 6de18767-1ba1-4829-b9b8-81a659508612 | sand 096ddbfb… → grass 197809d8… |
| `grass-dirt` (path) | Gras→Weg | d4085ba1-664b-45cb-ae94-0022400b5b1d | grass 197809d8… → dirt 79c94c91… |
| `water-stone` (kai) | Wasser→Stein | 18b0efb4-f9f4-4e16-97a3-e5e298eb8bb5 | water 356778f0… → stone bcb30e72… |
| `water-wood` (dock) | Wasser→Holz | 8540cac2-06ff-438f-8432-7b5865046011 | water 356778f0… → wood 2cab6bae… |

Gemeinsame Basis-Tile-IDs (zum Weiter-Verketten neuer Sets):
`water 356778f0-9b33-4025-86fe-c7bb75b06d27` · `sand 096ddbfb-6300-4a3e-bed8-d052a947fa64` ·
`grass 197809d8-8637-4344-88d1-f704a7e410f5` · `dirt 79c94c91-00e6-499d-8130-58807f11addc` ·
`stone bcb30e72-ea60-44e7-87b4-2f6ca52a98c9` · `wood 2cab6bae-8dce-4298-a8df-d1e4ef4644a8`

## Objekte (`create_map_object`, transparent)
`flowers` 0b39f8ca · `tree` 5875d1ff · `pine` 646df3e0 · `bush` 60c32cf5 · `rock` fc3a7be6 ·
`crate` 80a6f6c4 · `barrel` 694b9ecc · `well` edd57bbc · `stall` 1f189047 · `lamppost` ce7a86df · `signpost` b05d7ca2 · `sign` f6d5f12f
`lighthouse` d132cfe0 · `watchtower` 43e86eb8 · `house_office` 66ac5306 · `house_forge` 83dc3d8d · `house_chart` d83f271c
`door_office` 1691c8a5 · `door_forge` 70fce9d9 · `door_chart` b4688343 (Gebäude-Außentüren, #186; `view: side`, `selective outline`, `detailed shading`, je auf den Sprite-Stil abgestimmt: office = braune Bogentür, forge = dunkle Timber-Tür mit Eisennieten, chart = warme Bogentür mit Bullauge. Nach dem Generieren auf den Inhalt beschnitten (transparentes Padding weg), damit sie in `makeDoor` (`scenes/worldscene/terrain.ts`) mit Origin unten bündig auf der Gebäude-Fußlinie sitzen; ersetzen die früheren prozeduralen Rechteck-Türen)
`grasstuft0` 240c6cab · `grasstuft1` aacd3464 · `grasstuft2` 38bff122 (Gras-Büschel, #107; 64×64, „kleine Grasbüschel ohne Erde"; ersetzen die prozeduralen `fillTriangle`-Halme aus #40. Über `spawnGrassDetail()` in `scenes.ts` deterministisch über die Wiese gestreut — Variante/Helligkeit/Neigung/Größe/Spiegelung kommen aus `grassTuftStyle()` in `decor.ts`; die Farbe trägt das Sprite selbst, nur eine dezente Grau-Tint-Helligkeitsvariation bleibt)
`mushroom` b5ef64e2 · `seashell` fcecf607 · `driftwood` c7db4671 (Natur-Deko, #7; 64×64, `high top-down`, `selective outline`, `detailed shading`; über `scatter()` in `scenes.ts` gestreut — Pilze auf Land, Muscheln & Treibholz nur auf Sandstrand)
`pet_ratte` 6dac5de9 · `pet_fledermaus` 3a6daee7 · `pet_geist` 8cb7a436 (Shop-Haustiere, folgen der Figur; `scenes.ts` petSprite + `ui.ts` `drawTexIcon` fürs Shop-Icon)
`kraken` cb1bfcdb (Hacker-Krake/Gegner, #184; 64×64, `high top-down`, `selective outline`, `detailed shading`; lila Oktopus mit großen Augen + Tentakeln. Ersetzt in `scenes.ts` `tryStartKraken()` die früheren code-gezeichneten `fillCircle`/`fillRect`-Primitive; Spawn-/Wackel-/Vertreib-Logik (Secret anlegen) unverändert)
`seagull` 35767e8f (Möwe/Atmosphäre, #182; 48×48, `side`, `selective outline`, `medium shading`; weißer Vogel in Gleitflug-Pose. Ersetzt die prozeduralen `add.rectangle`-Flügel in `spawnGull()` aller vier Szenen; Flugrichtung via `setFlipX`)
`cannon` e7652a60 (Hafen-Kanone/Shop-Upgrade, #183; 96×64, `view: side`, `selective outline`, `detailed shading`, `high detail`; klassische Schiffskanone – Bronzerohr auf hölzerner Lafette mit Rädern, Rohr nach rechts aufs Meer. Ersetzt in `scenes/worldscene/scenery.ts` das font-/plattformabhängige Emoji-Text-Objekt `💣` durch `add.image("cannon")` (Origin 0.5, `setScale(0.3)`); Position/Depth/Sichtbarkeit wie bisher – nur sichtbar mit Shop-Upgrade `kanone`, gesteuert in `clustersync.ts`)
`pirate_ship` 91c46d16 (Piraten-Schiff/Gegner, #185; 128×96, `high top-down`, `selective outline`, `detailed shading`; dunkler, verwitterter Holzrumpf mit schwarzem Totenkopf-Segel (Jolly Roger), Bug nach links = in Fahrtrichtung. Ersetzt in `scenes.ts` `tryStartPirate()` die früheren prozeduralen `fillRect`-Rumpf-Primitive + Emoji-Flagge `☠`; auf ~0.34 herunterskaliert, Überfall-/Heran-/Abzieh-Tweens unverändert)
`ship` 357d33e0 (Dein Schiff, #41; `high top-down`, 288×176, `selective outline`, `detailed shading`; Holzschiff mit Bug nach Osten. Der von PixelLab gelieferte graue Hintergrund wurde per Edge-Flood-Fill auf Transparenz gesetzt. In `scenes.ts` `renderStatics` ersetzt es die früheren prozeduralen `graphics`-Primitive; das begehbare Holzdeck (Kollisionsraster) bleibt unverändert, die dynamische Fortschritts-Flagge `shipFlag` sitzt weiter am Masttop)
`container` efd1a7c7 · `crane` 1fb668b5 (Lagerhallen-Viertel-Hafenkai, #124; `high top-down`, `selective outline`, `detailed shading`, `high detail`; `container` 128×120 = gestapelte blau/rot/grüne Frachtcontainer (Daten-/Volume-Metapher der Phase 7), `crane` 160×176 = gelber Hafen-Verladekran mit Stahlbeinen + Kabine. Von der datengetriebenen `RegionScene` (#427) über die prop-Schleife `objectsForMap("warehouse")` → `spawnIslandObject` (#357) an ihren Registry-Standplätzen verankert gerendert + Schatten; Kollisions-Solid kommt aus der puren Geometrie)
`grafana_board` 852ad79b · `alert_bell` 1377aa69 (Monitoring-Station auf der Leuchtturm-Klippe, #111; `high top-down`, `selective outline`, `detailed shading`; `grafana_board` 128×160 = Dashboard-Tafel mit bunten Graphen auf Holzpfosten, `alert_bell` 96×120 = Bronze-Alarmglocke auf Pfosten. Von der datengetriebenen `RegionScene` (#427) über die prop-Schleife `objectsForMap("lighthouse")` → `spawnIslandObject` (#357) an ihren Registry-Standplätzen verankert gerendert + Schatten; Kollisions-Solid kommt aus der puren Geometrie)
`ship_frame` (Schiffsrumpf im Bau, Heimat-Werft, #456; `side`, 288×160, `selective outline`, `detailed shading`, `high detail`; halb verplankter Rumpf mit sichtbaren Spanten + aufrechten Baugerüst-Pfosten auf einer Kufe, Bug nach rechts. Der von PixelLab gelieferte helle Hintergrund wurde per Edge-Flood-Fill auf Transparenz gesetzt (wie bei `ship`). Ersetzt in `scenes/regions.ts` (`decorate`-Hook der Werft-Region) das früher wiederverwendete fertige `ship`-Sprite; Design mit der Maintainerin per `AskUserQuestion` gegen zwei generierte Kandidaten abgestimmt) · `scaffold` (Werft-Baugerüst, #456; `side`, 128×224, `selective outline`, `detailed shading`, `high detail`; klassisches Holzbaugerüst mit zwei Pfosten, Querstreben und kleiner Arbeitsplattform. Ersetzt im selben `decorate`-Hook die früheren prozeduralen Holzstützen-Primitive, zwei Standplätze links/rechts der Helling)
`pod_hull` 9811117f-c006-431c-bc00-e3fda4cc5ac1 (offener Holzboot-Rumpf fur Pod-Slots am Steg, #649; `high top-down`, 32×32, `selective outline`, `detailed shading`; Holzplanken-Rumpf von oben mit offenem Innenleben — ersetzt die generischen `crate`+`band`-Sprites in `clustersync.ts`; das Container-Fass (`barrel`) sitzt mit Deployment-Farb-Tint zentriert im Rumpf)

> **Terraform-Plateau-Boden** (`tf_floor`, #672): ersetzt die Kenney-dungeon-WOOD-Frames (48–53) auf dem Terraform-Plateau. `create_tiles_pro`, `square_topdown`, view_angle 90, `segmentation`-Mode → nahtlos; 16×16 RGBA PNG. Job `3fe9e81e-76bc-4dca-a2dc-d6bef77211c3`, Variante tile_15 (warme braune Außen-Holzplanken, Stardew-Stil). Gezeichnet in `scenery.ts` via `rt.draw("tf_floor", x*T, y*T)` (zuvor `rt.drawFrame("dungeon", WOOD[(x+y)%3], …)`).

> **Interior-Einrichtung (#187):** ersetzt die prozeduralen Ellipsen/Rechtecke des Hausinnenraums/der Kajüte (`scenes/InteriorScene.ts`) durch echte Pixelart. **Objekte** (`create_map_object`): `porthole` (Messing-Bullauge mit Meerblick, `view: side`, 48², an der oberen Schiffs-Rumpfwand – ersetzt die früheren `add.ellipse`-Bullaugen), `interior_door` (geschlossene Holztür, `view: side`, 40×56, als Haus-Austritt an der unteren Wand), `ship_hatch` (Decksluke von oben, `view: high top-down`, 40², als Schiffs-Austritt flach am Boden). **Boden/Wand-Kacheln** (`create_tiles_pro`, `square_topdown`, 16px, view_angle 90 = flach): `interior_floor` (Holzdielen, `segmentation`-Mode → nahtlos ohne Pro-Kachel-Raster), `interior_wall_house` (verputzte Steinwand), `interior_wall_ship` (dunkler Holzrumpf – die Rumpf-Dunkelheit steckt jetzt im Tile, das frühere halbtransparente Rechteck-Overlay entfällt). Gezeichnet in `renderRoom` (RenderTexture, `rt.draw` je Zelle) / `renderPortholes` / `renderThreshold`.

> **Innenraum-Möbel (#669):** `interior_table` (rustikaler Holztisch, `view: high top-down`, 32², `selective outline`, `detailed shading`, `muted warm earthy palette`; ersetzt `dungeon`-Frame 72 in allen Innenräumen + Hafen-Weltdeko), `interior_console` (Funkkonsole/Bordcomputer, `view: high top-down`, 32², nautischer Funk-/Navigationstisch mit Bildschirmen + Reglern; ersetzt `dungeon`-Frame 65 in Innenräumen, Weltdeko + Archipel-Quest-Trigger-Statue), `interior_book` (Logbuch aufgeschlagen, `view: high top-down`, 32²; ersetzt `dungeon`-Frame 66), `interior_anvil` (Schmiedeamboss, `view: high top-down`, 32²; ersetzt `dungeon`-Frame 74). Alle 32² Pixelart; im 16px-Raster via `setScale(0.5)`. `crate`/`barrel` (bestehende Assets) bleiben für Innenräume erhalten. Außerdem in `terrain.ts` + `regions.ts` verwendet.

> **Leuchtturm** (`lighthouse`, side-view, 72×128 → 45×100): löst den alten code-gezeichneten Turm ab; im `decorate`-Hook der Leuchtturm-Region (`scenes/regions.ts`, #427) als Bild + Felsen-Ellipse, dazu ein **rotierender Lichtkegel** (Code: weiches ADD-Blend-Dreieck `lhbeam`, 360°-Tween) und das pulsierende Lämpchen.
> **Wachturm** (`watchtower`, side-view, 128×256 → auf Inhalt zugeschnitten 114×227, #440): löst den alten code-gezeichneten Turm (Stein-Schaft + Zinnenkranz) ab; Standplatz + 2×2-Fußabdruck stehen wie beim Leuchtturm (#357) in der Entity-Registry (`content/data/entities.json`, Karte `watchtower`, Typ `tower`). Im `decorate`-Hook der Wachturm-Region (`scenes/regions.ts`) als Bild (Skalierung 0.4) + Schatten-Ellipse gerendert; das **flatternde Banner** bleibt bewusst Code (Mast-Rechteck + Dreieck-Flagge, Scale-Tween) – derselbe „dynamischer Effekt ist kein Platzhalter"-Grundsatz wie beim Leuchtturm-Lichtkegel.
> **Gebäude** (`house_office` Stein/Hafenmeisterei, `house_forge` Werft, `house_chart` Kartenhaus; `view: high top-down`, 2.5D): lösen die Kenney-„town"-Tile-Häuser ab. Gerendert über `building(x,y,w,tex,scale)` — Grundfläche (w×3 Tiles) bleibt solide, das hohe Dach ragt nach oben, Tiefe nach Fußlinie (korrektes Vorne/Hinten zur Figur).

> **`sign`** (Holz-Schildbrett, `view: side`, 96×40 → auf Inhalt zugeschnitten **75×30**, Aufhänge-Knäufe oben abgeschnitten) ist die Grundlage der **festen Orts-Schilder**. Es wird in `scenes.ts` per **Phaser `NineSlice`** (Insets 8/8/8/6) auf jede Textlänge gedehnt – Rahmen bleibt fix, Holzmitte streckt. So genügt **eine** Grafik für alle Schilder (`makeSign`). Die *dynamischen* Cluster-Labels nutzen bewusst KEIN Holz, sondern „digitale" Tech-Tags (`makeTechTag`, Monospace + Status-Punkt, Nähe-Aufdeckung).

## HUD-Statuszeilen-Icons (`create_map_object`, 32×32, `view: side`, DOM-`<img>` statt Phaser)
Kleine gerahmte Pixel-Icons für die dauersichtbare DOM-Statuszeile (`index.html` #hud, #645, Fundament-Slice von #204); ersetzen die früheren Emoji. Stil: `selective outline`, `detailed shading`, warme Stardew-Palette, „soft dark-tinted outline not pure black, single light source top-left". Gerendert als `<img class="pixel-icon">` (CSS: 32px-Quelle hart auf 16px = ÷2 ganzzahlig, `image-rendering: pixelated`). **BEWUSST getrennt vom Phaser-`ASSET_MANIFEST`:** in `src/assets-data.ts` als eigene Records `HUD_ICONS` (Münzen/Streak/Uhr) + `HUD_SEASON_ICONS` (Index 0..3 = Frühling/Sommer/Herbst/Winter, gespiegelt zu `GameClock.seasonIndex`) eingebunden — sie sind reine DOM-Icons, keine GPU-Texturen. Statische Icons werden einmalig in `ui/hud.ts` › `initHudIcons()` verdrahtet, das dynamische Saison-Icon in `setClock`.

| Datei | Motiv |
|---|---|
| `hud_coin` | Golddublone (Währung „Dublonen", `.hud-coins`) |
| `hud_streak` | Einzelne Flamme (Tages-Streak, `.hud-streak`) |
| `hud_clock` | Analog-Zifferblatt mit Messingrahmen (Uhrzeit, `#hud-time`) |
| `hud_season_spring` · `hud_season_summer` · `hud_season_autumn` · `hud_season_winter` | Spross / Sonne / Herbstblatt / Schneeflocke (Saison-Marker `#hud-date`, wechselt mit `seasonIndex`) |

## Menü-Button-Icons (`create_map_object`, 32×32, `view: side`, DOM-`<img>` statt Phaser)
Slice 4/4 von #204 (#648): dieselbe Machart und `.pixel-icon`-Klasse wie die HUD-Statuszeilen-Icons oben, für die vier Menü-Aktionen (`index.html` #overlay-menu `.menu-actions`); ersetzen die früheren Emoji. In `src/assets-data.ts` als Record `MENU_ICONS` eingebunden (reine DOM-Icons, keine Phaser-Textur), verdrahtet in `ui/hud.ts` › `initHudIcons()`.

| Datei | Motiv |
|---|---|
| `menu_play` | Grünes Play-Dreieck auf Kachel (Weiterspielen, `closeOverlays`) |
| `menu_save` | Blaue Diskette (Spielstand sichern, `exportSave`) |
| `menu_load` | Offener Ordner mit Dokument (Spielstand laden, `importPick`) |
| `menu_reset` | Rote Kreis-Pfeile (Spielstand zurücksetzen, `resetGame`, `.danger`) |

## HUD-Tastenleisten-Icons (`create_map_object`, 32×32, `view: side`, DOM-`<img>`)
Slice **2/4 von #204** (#646): ersetzen die Emoji der Steuer-Hinweisleiste (`index.html` #hud-keys) durch dieselben gerahmten Pixel-Icons wie die Statuszeile (gleicher Stil/gleiches Raster wie oben). In `src/assets-data.ts` als Record `HUD_KEY_ICONS` (Aktion → URL) eingebunden. Gerendert in `src/ui/overlay.ts` › `renderKeyHints()` (dynamisch, weil die Tastenkürzel umbelegbar sind, #232) als `<img class="pixel-icon">`; das feste Menü-Icon im `#hud-menu-btn` verdrahtet `ui/hud.ts` › `initHudIcons()`.

| Datei | Motiv |
|---|---|
| `hud_walk` | Seefahrer-Stiefel (Laufen, WASD/Pfeile) |
| `hud_talk` | Sprechblase (Reden) |
| `hud_terminal` | Retro-CRT-Terminal mit grünem Text (Funkgerät/Terminal) |
| `hud_logbook` | Aufgerollte Schriftrolle (Logbuch) |
| `hud_album` | Aufgeschlagenes Buch (Sammelalbum) |
| `hud_menu` | Schiffssteuerrad (Menü, auch `#hud-menu-btn`) |

## Panel-Kopf-Icons (`create_map_object`, 40×40, `view: side`, DOM-`<img>` statt Phaser)
Gerahmte Pixel-Icons für die Köpfe der Overlay-Panels (`index.html` `.panel-head`, #647, Slice 3 von #204); ersetzen die früheren Emoji. Gleicher Stil + gleiche Pixeldichte wie die HUD-Statuszeilen-Icons (#645), nur die 40px-Quelle wird auf **20px** gerendert (÷2 ganzzahlig, `.panel-head .pixel-icon` in `style.css`) — Panel-Köpfe sind größer als die HUD-Zeile. In `src/assets-data.ts` als Record `PANEL_ICONS` (`data-icon`-Schlüssel → URL) eingebunden, generisch in `ui/hud.ts` › `initHudIcons()` über das `data-icon`-Attribut verdrahtet (`<img class="pixel-icon" data-icon="…">`). **Eigene neue Icons nur für die Motive, die keine andere Slice hat** (Shop/Krabbe/Spiel); **Logbuch/Album/Terminal/Menü teilen sich bewusst die #646-Tastenleisten-Icons** (`hud_logbook`/`hud_album`/`hud_terminal`/`hud_menu`) — gleiches Motiv, EIN Asset statt Doppel.

| Datei | Motiv (Panel) |
|---|---|
| `icon_shop` | Marktstand mit Streifen-Markise (Pelles Handelsposten, `#overlay-shop`) |
| `icon_kralle` | Runde chibi-Krabbe (Krabbe Kralle, `#overlay-review`) |
| `icon_game` | Gestapelte Hafen-Kisten — EIN Icon für alle sechs Minispiel-Panels (Stapel/Pod-Pack/YAML/Routing/Drift/RBAC) |
| `hud_logbook` (geteilt) | Logbuch (`#overlay-quest`) |
| `hud_album` (geteilt) | Sammelalbum (`#overlay-album`) |
| `hud_terminal` (geteilt) | Terminal (`#overlay-terminal`) |
| `hud_menu` (geteilt) | Menü (`#overlay-menu`) |

## Figuren (`create_character`, 4-dir, nur `south.png` genutzt)
`char_player` daae9195 · `char_ole` b89f37e2 · `char_runa` 723246a6 · `char_pelle` 793f0232
`char_bo` f8a654e6 · `char_ada` 4b44fcee · `char_theo` f7d6621a · `char_kralle` 6551e699 · `char_juno` 8d0a9892
`char_argos` 0904ac29 (GitOps-Archipel-NPC „Argo", GitOps-Lotsin, #93)
`char_lumi` 4f187598 (Monitoring-Leuchtturm-NPC „Lumi", Leuchtturmwärterin, #112; gelbes Ölzeug + Spektiv, `view: low top-down`, `chibi`, `detailed shading`; wie unten size 48 → 68²-Canvas, auf 48² runtergerechnet)
`char_knut` 4b1912ed (Lagerhallen-Viertel-NPC „Knut", Speicher-Verwalter, #125; älterer Hafen-Verwalter mit Mütze, dunklem Overall + Klemmbrett/Logbuch, `view: low top-down`, `chibi`, `selective outline`, `detailed shading`, `high detail`, size 48 → 68²-Canvas, **auf 48² runtergerechnet** (Nearest-Neighbor) wie der 48er-Cast/Spieler (#441), 4 Richtungen, nur `south` genutzt)
`char_vidar` 6a2a55d4 (Wachturm-Quartier-NPC „Vidar", Wachveteran am Tor, #131; grummeliger alter Wächter mit Graubart, Stahlbrust über schiefer­blauer Tunika + Klemmbrett/Gästeliste, `view: low top-down`, `chibi`, `selective outline`, `detailed shading`, `high detail`, size 48 → 68²-Canvas, **auf 48² runtergerechnet** (Nearest-Neighbor) wie der 48er-Cast/Spieler, 4 Richtungen, nur `south` genutzt)
`char_saga` 5420da2d (Expeditions-Flotte-NPC „Saga", Flottenkommandantin, #149; ruhige Navigatorin/Kartografin in erdigem Look – braune Lederweste über cremefarbenem Hemd, Messing-Kompass am Gürtel, aufgerollte Seekarte unterm Arm, gedeckte Braun-/Sandtöne, `view: low top-down`, `chibi`, `selective outline`, `detailed shading`, `high detail`, size 48 → 68²-Canvas, **auf 48² runtergerechnet** (Nearest-Neighbor) wie der 48er-Cast/Spieler, 4 Richtungen, nur `south` genutzt)
`char_greta` 1b2dd719 (Heimat-Werft-NPC „Greta", Werftmeisterin, #166; resolute, praktische Bauleiterin in robustem blauem Werft-Overall, hochgeschobene Schutzbrille auf der Stirn, dicke Arbeitshandschuhe + Werkzeuggürtel, `view: low top-down`, `chibi`, `selective outline`, `detailed shading`, `high detail`, size 48 → 68²-Canvas, **auf 48² runtergerechnet** (Nearest-Neighbor) wie der 48er-Cast/Spieler, 4 Richtungen, nur `south` genutzt)

> Die 6 zuletzt ergänzten (Bo/Ada/Theo/Kralle/Juno/Argo) wurden mit `size 48` erzeugt
> (Leinwand 68²) und auf **48²** runtergerechnet — gleiche Körperhöhe (~34px),
> Fußlinie (Zeile 39 = Origin 0.81) und Mitte wie die früheren `size 32`-Figuren.
> `char_kralle` ist als aufrechtes Krabben-Maskottchen gekommen (humanoides Skelett).

> ⚠️ **Map-Objekte & Figuren werden serverseitig nach 8 h gelöscht.** Die IDs sind nur historisch —
> die dauerhafte Quelle sind die PNGs hier (per `import` in `src/assets-data.ts` eingebunden). Tilesets bleiben abrufbar.

> 💳 **Account-Stand (2026-06-15):** PixelLab läuft jetzt auf einem **Abo (Tier 1)** mit großem Generierungs-Kontingent (~2000) — die alte „4/40 Free-Trial"-Knappheit ist vorbei. Tier 1 erlaubt zudem **größere Bilder (mehr Pixel pro Bild)** → gut für große Objekte wie **Häuser, Bäume, Gebäude** (höher auflösen statt klein generieren + hochskalieren). Generieren ist unkritisch.

## Wie das Autotiling funktioniert (`src/scenes.ts`, `renderGround`)
- **Format `tileset15`:** 4×4-Sheet, Tile = Funktion der 4 Eck-Terrains. Eck-Code
  `NW<<3 | NE<<2 | SW<<1 | SE` (Bit=1 wenn „obere" Terrain). Mapping auf den Frame-Index:
  `WANG = [6,7,10,9,2,11,4,15,5,14,1,8,3,0,13,12]` — **bei allen Sets identisch** (aus den Metadaten verifiziert).
- **Terrain-Höhen je Bodenzelle:** Wasser(`-2`)=0 < Sand(`-3`)=1 < Gras/Land(sonst)=2 < Weg(`25`)=3.
- **Pro Zelle:** berührt sie Wasser → Wasser-Rand-Set nach Nachbar-**Material** (Holz `-10/-11` > Stein `96/97/98` > Sand); sonst Weg-Zelle → `path`; sonst → `meadow`. Stein-Kai/Stege innen = volles Tile.
- **Objekte/Figuren** liegen in `BootScene`-`BOOT_PLAINS` (ohne Slicing, ganzes Bild = ein Sprite),
  werden unten verankert gerendert (Origin ~0.81 = Fußhöhe; Füße sitzen auf dem Schatten).

## Ein neues Asset hinzufügen
1. `create_topdown_tileset` (Terrain, ggf. `lower_base_tile_id` aus obiger Liste) **oder** `create_map_object` / `create_character`.
2. PNG nach `assets/pixellab/` laden, in `src/assets-data.ts` per `import name from "../assets/pixellab/datei.png"` einbinden und ins `KQAssets`-Objekt aufnehmen.
3. In `BootScene`: Tileset → `BOOT_SHEETS`-Array (4 Spalten); Objekt/Figur → `BOOT_PLAINS`-Array.
4. Verwenden — **erst referenzieren, wenn geladen** (sonst grün-schwarzer Phaser-Platzhalter).

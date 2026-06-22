# PixelLab-Assets & Autotiling (KubeQuest)

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
| `water-sand` (coast) | Wasser→Sand | c7e28595-ae17-4840-9c25-31a4a7dd8eb0 | water 356778f0… → sand 096ddbfb… |
| `sand-grass` (meadow) | Sand→Gras | 6de18767-1ba1-4829-b9b8-81a659508612 | sand 096ddbfb… → grass 197809d8… |
| `grass-dirt` (path) | Gras→Weg | c2bd68ef-1b8d-4936-9787-6c3b68d4500f | grass 197809d8… → dirt e8efe511… |
| `water-stone` (kai) | Wasser→Stein | 18b0efb4-f9f4-4e16-97a3-e5e298eb8bb5 | water 356778f0… → stone bcb30e72… |
| `water-wood` (dock) | Wasser→Holz | 8540cac2-06ff-438f-8432-7b5865046011 | water 356778f0… → wood 2cab6bae… |

Gemeinsame Basis-Tile-IDs (zum Weiter-Verketten neuer Sets):
`water 356778f0-9b33-4025-86fe-c7bb75b06d27` · `sand 096ddbfb-6300-4a3e-bed8-d052a947fa64` ·
`grass 197809d8-8637-4344-88d1-f704a7e410f5` · `dirt e8efe511-b484-4a4f-90d9-7efbebebfbe3` ·
`stone bcb30e72-ea60-44e7-87b4-2f6ca52a98c9` · `wood 2cab6bae-8dce-4298-a8df-d1e4ef4644a8`

## Objekte (`create_map_object`, transparent)
`flowers` 0b39f8ca · `tree` 5875d1ff · `pine` 646df3e0 · `bush` 60c32cf5 · `rock` fc3a7be6 ·
`crate` 80a6f6c4 · `barrel` 694b9ecc · `well` edd57bbc · `stall` 1f189047 · `lamppost` ce7a86df · `signpost` b05d7ca2 · `sign` f6d5f12f
`lighthouse` d132cfe0 · `house_office` 66ac5306 · `house_forge` 83dc3d8d · `house_chart` d83f271c
`grasstuft0` 240c6cab · `grasstuft1` aacd3464 · `grasstuft2` 38bff122 (Gras-Büschel, #107; 64×64, „kleine Grasbüschel ohne Erde"; ersetzen die prozeduralen `fillTriangle`-Halme aus #40. Über `spawnGrassDetail()` in `scenes.ts` deterministisch über die Wiese gestreut — Variante/Helligkeit/Neigung/Größe/Spiegelung kommen aus `grassTuftStyle()` in `decor.ts`; die Farbe trägt das Sprite selbst, nur eine dezente Grau-Tint-Helligkeitsvariation bleibt)
`mushroom` b5ef64e2 · `seashell` fcecf607 · `driftwood` c7db4671 (Natur-Deko, #7; 64×64, `high top-down`, `selective outline`, `detailed shading`; über `scatter()` in `scenes.ts` gestreut — Pilze auf Land, Muscheln & Treibholz nur auf Sandstrand)
`pet_ratte` 6dac5de9 · `pet_fledermaus` 3a6daee7 · `pet_geist` 8cb7a436 (Shop-Haustiere, folgen der Figur; `scenes.ts` petSprite + `ui.ts` `drawTexIcon` fürs Shop-Icon)
`kraken` cb1bfcdb (Hacker-Krake/Gegner, #184; 64×64, `high top-down`, `selective outline`, `detailed shading`; lila Oktopus mit großen Augen + Tentakeln. Ersetzt in `scenes.ts` `tryStartKraken()` die früheren code-gezeichneten `fillCircle`/`fillRect`-Primitive; Spawn-/Wackel-/Vertreib-Logik (Secret anlegen) unverändert)
`seagull` 35767e8f (Möwe/Atmosphäre, #182; 48×48, `side`, `selective outline`, `medium shading`; weißer Vogel in Gleitflug-Pose. Ersetzt die prozeduralen `add.rectangle`-Flügel in `spawnGull()` aller vier Szenen; Flugrichtung via `setFlipX`)
`pirate_ship` 91c46d16 (Piraten-Schiff/Gegner, #185; 128×96, `high top-down`, `selective outline`, `detailed shading`; dunkler, verwitterter Holzrumpf mit schwarzem Totenkopf-Segel (Jolly Roger), Bug nach links = in Fahrtrichtung. Ersetzt in `scenes.ts` `tryStartPirate()` die früheren prozeduralen `fillRect`-Rumpf-Primitive + Emoji-Flagge `☠`; auf ~0.34 herunterskaliert, Überfall-/Heran-/Abzieh-Tweens unverändert)
`ship` 357d33e0 (Dein Schiff, #41; `high top-down`, 288×176, `selective outline`, `detailed shading`; Holzschiff mit Bug nach Osten. Der von PixelLab gelieferte graue Hintergrund wurde per Edge-Flood-Fill auf Transparenz gesetzt. In `scenes.ts` `renderStatics` ersetzt es die früheren prozeduralen `graphics`-Primitive; das begehbare Holzdeck (Kollisionsraster) bleibt unverändert, die dynamische Fortschritts-Flagge `shipFlag` sitzt weiter am Masttop)
`container` efd1a7c7 · `crane` 1fb668b5 (Lagerhallen-Viertel-Hafenkai, #124; `high top-down`, `selective outline`, `detailed shading`, `high detail`; `container` 128×120 = gestapelte blau/rot/grüne Frachtcontainer (Daten-/Volume-Metapher der Phase 7), `crane` 160×176 = gelber Hafen-Verladekran mit Stahlbeinen + Kabine. Von der datengetriebenen `RegionScene` (#427) über die prop-Schleife `objectsForMap("warehouse")` → `spawnIslandObject` (#357) an ihren Registry-Standplätzen verankert gerendert + Schatten; Kollisions-Solid kommt aus der puren Geometrie)
`grafana_board` 852ad79b · `alert_bell` 1377aa69 (Monitoring-Station auf der Leuchtturm-Klippe, #111; `high top-down`, `selective outline`, `detailed shading`; `grafana_board` 128×160 = Dashboard-Tafel mit bunten Graphen auf Holzpfosten, `alert_bell` 96×120 = Bronze-Alarmglocke auf Pfosten. Von der datengetriebenen `RegionScene` (#427) über die prop-Schleife `objectsForMap("lighthouse")` → `spawnIslandObject` (#357) an ihren Registry-Standplätzen verankert gerendert + Schatten; Kollisions-Solid kommt aus der puren Geometrie)

> **Leuchtturm** (`lighthouse`, side-view, 72×128 → 45×100): löst den alten code-gezeichneten Turm ab; im `decorate`-Hook der Leuchtturm-Region (`scenes/regions.ts`, #427) als Bild + Felsen-Ellipse, dazu ein **rotierender Lichtkegel** (Code: weiches ADD-Blend-Dreieck `lhbeam`, 360°-Tween) und das pulsierende Lämpchen.
> **Gebäude** (`house_office` Stein/Hafenmeisterei, `house_forge` Werft, `house_chart` Kartenhaus; `view: high top-down`, 2.5D): lösen die Kenney-„town"-Tile-Häuser ab. Gerendert über `building(x,y,w,tex,scale)` — Grundfläche (w×3 Tiles) bleibt solide, das hohe Dach ragt nach oben, Tiefe nach Fußlinie (korrektes Vorne/Hinten zur Figur).

> **`sign`** (Holz-Schildbrett, `view: side`, 96×40 → auf Inhalt zugeschnitten **75×30**, Aufhänge-Knäufe oben abgeschnitten) ist die Grundlage der **festen Orts-Schilder**. Es wird in `scenes.ts` per **Phaser `NineSlice`** (Insets 8/8/8/6) auf jede Textlänge gedehnt – Rahmen bleibt fix, Holzmitte streckt. So genügt **eine** Grafik für alle Schilder (`makeSign`). Die *dynamischen* Cluster-Labels nutzen bewusst KEIN Holz, sondern „digitale" Tech-Tags (`makeTechTag`, Monospace + Status-Punkt, Nähe-Aufdeckung).

## Figuren (`create_character`, 4-dir, nur `south.png` genutzt)
`char_player` daae9195 · `char_ole` b89f37e2 · `char_runa` 723246a6 · `char_pelle` 793f0232
`char_bo` f8a654e6 · `char_ada` 4b44fcee · `char_theo` f7d6621a · `char_kralle` 6551e699 · `char_juno` 8d0a9892
`char_argos` 0904ac29 (GitOps-Archipel-NPC „Argo", GitOps-Lotsin, #93)
`char_lumi` 4f187598 (Monitoring-Leuchtturm-NPC „Lumi", Leuchtturmwärterin, #112; gelbes Ölzeug + Spektiv, `view: low top-down`, `chibi`, `detailed shading`; wie unten size 48 → 68²-Canvas, auf 48² runtergerechnet)
`char_knut` 4b1912ed (Lagerhallen-Viertel-NPC „Knut", Speicher-Verwalter, #125; älterer Hafen-Verwalter mit Mütze, dunklem Overall + Klemmbrett/Logbuch, `view: low top-down`, `chibi`, `selective outline`, `detailed shading`, `high detail`, size 48 → 68²-Canvas, 4 Richtungen, nur `south` genutzt)
`char_vidar` 6a2a55d4 (Wachturm-Quartier-NPC „Vidar", Wachveteran am Tor, #131; grummeliger alter Wächter mit Graubart, Stahlbrust über schiefer­blauer Tunika + Klemmbrett/Gästeliste, `view: low top-down`, `chibi`, `selective outline`, `detailed shading`, `high detail`, size 48 → 68²-Canvas, **auf 48² runtergerechnet** (Nearest-Neighbor) wie der 48er-Cast/Spieler, 4 Richtungen, nur `south` genutzt)

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

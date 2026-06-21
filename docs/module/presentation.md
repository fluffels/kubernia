# Tiefendoc: Präsentation (Szenen, UI, SFX, Assets)

> On-demand-Detail zur Präsentations-Schicht — die einzige Schicht, die Phaser bzw. das DOM anfasst. Der schlanke Always-Index steht in [CLAUDE.md](../../CLAUDE.md). Die pure Logik hinter UI/Szenen liegt in [world.md](world.md) (Welt/Karten) bzw. den jeweiligen Domänen-Modulen. Pfade sind repo-relativ als Inline-Code.

## Szenen (`src/scenes.ts` + `src/scenes/*`, Split #345)

`src/scenes.ts` ist ein **Barrel** (#345): es bündelt die Szenen-Module zu `KQScenes` (von `main.ts` registriert). Die 7 Phaser-Szenen liegen seit dem Split **eine Datei je Klasse** unter `src/scenes/`, gemeinsame Helfer in `src/scenes/shared.ts`.

| Modul | Inhalt |
|---|---|
| `src/scenes/shared.ts` | Geteilte Szenen-Bausteine (#345): Karten-/Tile-Konstanten, In-Welt-Pixel-Bitmap-Font (#188, `buildPixelFont`/`pixelText`), Orts-Schilder (#254, `buildSign`), schwebende Belohnungstexte (`floatPixelText`), datengesteuertes Insel-NPC-Rendering (#349, `spawnIslandNpc`). |
| `src/scenes/BootScene.ts` | Lädt alle Grafiken + Frame-Slicing aus `ASSET_MANIFEST`, backt Font/Münz-Icon, startet dann `World` (bzw. `MapTest` via `?maptest`). |
| `src/scenes/WorldScene.ts` | Port Kubernia — seit dem Split (#393) **schlanker Orchestrator** (~460 LOC, vorher 1344): `create()` (Aufbau), `update()` (Per-Frame-Takt) plus die geteilten Render-Primitive (`set`/`get`/`deco`/`tree`/`objDeco`/`building`/`registerCullable`/`makeSign`/`makeTechTag`/`addShadow`/`makeFxTextures`), Spieler-/NPC-Setup, Kollision/Bewegung, Effekte und Off-screen-Culling. Die Spiel-Systeme liegen in `src/scenes/worldscene/*` (siehe unten). |
| `src/scenes/InteriorScene.ts` | Betretbarer Hausinnenraum (#6), von `WorldScene.enterInterior()` gestartet; `INTERIORS` legt die Möbel je Haus-Thema fest. |
| `src/scenes/ArchipelScene.ts` | GitOps-Archipel-Insel (#92); Geometrie/Kollision pur aus `src/archipel.ts`. |
| `src/scenes/LighthouseScene.ts` | Monitoring-Leuchtturm-Klippe (#111); pur aus `src/lighthouse.ts`. |
| `src/scenes/WarehouseScene.ts` | Lagerhallen-Viertel/Hafenkai (#124); pur aus `src/warehouse.ts`. |
| `src/scenes/TilemapTestScene.ts` | Tiled-Loader-Testszene (#191), erreichbar über `?maptest`. |

### WorldScene-Systeme (`src/scenes/worldscene/*`, Split #393)

`WorldScene.ts` war mit 1344 LOC die mit Abstand größte Datei (God-Scene). Der Split (#393, analog zum `scenes.ts`-Split #345 und dem `sim.ts`-Split #346) zieht die einzelnen Spiel-Systeme in fokussierte Module: **freie Funktionen, die die laufende Szene als Parameter (`scene`) bekommen** — dasselbe „freie Funktion + Host"-Muster wie `sim/*`. Der Szenen-Zustand bleibt damit in EINER Hand (der `WorldScene`-Instanz), die Logik aber in eigenen, les-/wartbaren Modulen. Die Module kommunizieren ausschließlich über die Szene (gemeinsame Felder + die Render-Primitive der Klasse) — sie importieren `WorldScene.ts` bewusst **nicht** (das wäre ein Import-Zyklus, den der Arch-Wächter #390 verbietet; der lose Struktur-Typ `WorldSceneLike` aus `types.ts` ersetzt den Klassen-Import).

| Modul | Inhalt |
|---|---|
| `src/scenes/worldscene/types.ts` | `WorldSceneLike` — loser Struktur-Typ der Szene ([key]: any, wie die Klasse), damit die Module Phaser über die Szene anfassen, ohne `WorldScene.ts` zu importieren (Zyklus-Vermeidung). |
| `src/scenes/worldscene/mapterrain.ts` | **Generischer, Phaser-freier Terrain-Lader (#425):** Boden/Kollision/Türen/NPC-Standplätze datengetrieben aus `getMapEntry(scene.mapId)` (`loadMapTerrain`) — statt fest „harbor". Eine zweite Tiled-Region kommt als Registry-Eintrag dazu; node-testbar (`test/worldscene-terrain.test.ts`). |
| `src/scenes/worldscene/terrain.ts` | HAFEN-spezifische Welt: sichtbare Objekte/Gebäude/Warpschilder setzen (`placeHarborObjects`), Türen begehbar schneiden (`carveDoors`/`makeDoor`), Wang-Autotile-Boden zeichnen (`renderGround`). Der gemeinsame Terrain-Schritt liegt seit #425 in `mapterrain.ts`; die datengetriebene Region-Szenerie folgt mit #427 (RegionScene). |
| `src/scenes/worldscene/scenery.ts` | Rein optische Ausstattung: gestreute Deko (`spawnFlowers`/`spawnGrassDetail`/`scatter`), statische Props/Effekte (`renderStatics`: Schiff, Leuchtturm, Rauch, Schmetterlinge, Schilder, Terraform-Plateau, Warp-Marker), Möwen (`spawnGull`), Tag-Nacht-Schleier (`updateDayNight`). |
| `src/scenes/worldscene/clustersync.ts` | Cluster (`Game.sim`) → Welt spiegeln: Pods als Kisten an den Stegen (`syncCluster`), Deployment-/Docker-/Helm-/Service-Tags neu bauen bei Änderung (`rebuildDynamic`), Nähe-Aufdeckung + Entzerrung der Tags (`revealNearbyLabels`, #207). |
| `src/scenes/worldscene/events.ts` | Zufalls-Gefahren: Piraten-Überfall, Hacker-Krake, Sturmschaden (je `tryStart…`/`resolve…`), gemeinsame Terminierung (`scheduleEvents`/`anyEventActive`) und Per-Frame-Tick (`tickEvents`). EIN kohäsives Modul; wächst es bei Stardew-Scope über das Datei-Budget (#390), ist der Schnitt je Gefahr offensichtlich. |
| `src/scenes/worldscene/warps.ts` | Phaser-Hülle der Übergänge: Haus/Schiff (`enterInterior`, #6) + generischer Region-Übergang (`enterRegion`, #426 — ersetzt die früheren enterArchipel/-Lighthouse/-Warehouse) + Per-Frame-Tür-/Warp-Auslösung (`updateWarps`). Die Übergangs-DATEN (`REGION_WARPS`) und der reine Anti-Pingpong-Kern (`armWarps`/`triggeredWarp`, node-testbar) liegen Phaser-frei in `src/warps.ts`; das Armed-Gate hält seinen Zustand pro Warp-ID im Set `scene.warpArmed` statt je ein benanntes Flag. Der byte-gleiche Insel→Welt-Rück-Warp ist als `IslandScene.updateReturn`/`exitToWorld` hochgezogen (Vorarbeit #427). |

## UI (`src/ui.ts` + `src/ui/*`, Split #356)

`src/ui.ts` ist **Orchestrator/Barrel** (#356): es deklariert den veränderlichen UI-Zustand (`this.*`) und komponiert das öffentliche `UI`-Objekt aus den Domänen-Bündeln unter `src/ui/` (`export const UI = { …state, ...overlayUI, ...dialogUI, … }`). Die API bleibt unverändert → `main.ts`/`scenes/*` importieren weiter `{ UI }`.

| Modul | Bündel | Inhalt |
|---|---|---|
| `src/ui/shared.ts` | — | Geteilte UI-Helfer: `$`/`esc`/`NPCS`/`SMALLTALK`/`shuffled`/`CMD_MAX_ATTEMPTS`, vorab geladene Porträt-/Shop-Bilder (`sheetImgs`) + der `part()`-Helper (typisiert die Methodenbündel via ThisType-Muster). |
| `src/ui/overlay.ts` | `overlayUI` | Event-Delegation, Blockierung, generische Modal-Tastatur (#283), Menü/Pause. |
| `src/ui/hud.ts` | `hudUI` | HUD/Toasts/Alarm, Interaktion, Tastatur-Navigation der Antwort-Buttons. |
| `src/ui/quest.ts` | `questUI` | Quest-Maschine + Begrüßung/Intro (#288). |
| `src/ui/dialog.ts` | `dialogUI` | NPC-/Bo-Dialoge. |
| `src/ui/radio.ts` | `radioUI` | Funkgerät-Terminal (teach/drill/terminal) + freies Üben. |
| `src/ui/minigame.ts` | `minigameUI` | Stapel-Minispiel. |
| `src/ui/questlog.ts` | `questlogUI` | Logbuch-Übersicht & -Detail (#326); pure Logik in `src/questlog.ts`. |
| `src/ui/shop.ts` | `shopUI` | Shop. |
| `src/ui/quiz.ts` | `quizUI` | Krabben-Quiz (Spaced-Repetition). |
| `src/ui/save.ts` | `saveUI` | Spielstand-Export/Import + `resetGame`. |

## Sound & Assets

| Modul | Inhalt |
|---|---|
| `src/sfx.ts` | WebAudio-Sounds (synthetisiert, keine Audio-Dateien). |
| `src/assets-data.ts` | `ASSET_MANIFEST` — die eine Quelle pro Grafik (Key/Pfad/Typ/Spalten); BootScene leitet Laden + Slicing daraus ab (Host-Build: eigene Dateien; Offline-Build inlinet als Data-URI). |

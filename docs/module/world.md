# Tiefendoc: Welt, Karten & pure-Domäne-Helfer

> On-demand-Detail zu den Phaser-freien Welt-/Karten-/HUD-Bausteinen. Der schlanke Always-Index steht in [CLAUDE.md](../../CLAUDE.md). Diese Module liegen bewusst **außerhalb** von `scenes.ts`, damit Welt-Geometrie, Deko und HUD-Logik im Node-Test prüfbar bleiben. Das Phaser-Rendering dazu liegt in [presentation.md](presentation.md). Pfade sind repo-relativ als Inline-Code.

## Welt-Geometrie & Kollision

| Modul | Inhalt |
|---|---|
| `src/world/world.ts` | Welt-Geometrie (Kachelraster, NPC-Standplätze, Solid-Kacheln) + **Blob-Autotile-Auswahl** (#340: `neighbors8`/`reduceBlobMask`/`autotileIndex`, 47er-Set — wählt aus der 8er-Nachbarschaft die Übergangskachel für weichere Wege/Wasserkanten; erster Schritt aus #256, noch ohne Tileset-Assets) + **Sub-Tile-Kollision** (#343: `Hitbox` = Kreis/Rechteck als Daten, `circleHitbox`/`rectHitbox`/`hitboxBlocks`/`blockedByHitboxes`/`npcHitboxes`; `footprintSolid`/`resolveMove` nehmen die Hitboxen als optionales rückwärtskompatibles Zusatzargument). Seit #386 in **allen** Szenen verdrahtet: WorldScene (Steine/Büsche rund, Laternen schmales Rechteck), Archipel/Lighthouse/Warehouse (Steine/Felsbrocken/Büsche/Fässer rund, Kisten Rechteck, NPCs rund); große Strukturen (Kräne/Container/Turm) bleiben bewusst volles Kachel-Solid. |
| `src/world/decor.ts` | Deterministische Deko-Platzierung (Büsche, Steine, Laternen, Blumen). |
| `src/hud/labellayout.ts` | Entzerrt sich überlappende In-Welt-Beschriftungen (#207): schiebt horizontal kollidierende Cluster-Tags/Schilder vertikal auseinander (`spreadLabelsVertically`). `revealNearbyLabels` in `scenes.ts` wendet die Versätze auf die sichtbaren Tags an. |
| `src/hud/cull.ts` | Off-screen-Culling & FPS-Messung (Sichtfeld-Prüfung, `FrameSampler`); Performance-Budget #82, siehe [performance-budget.md](../performance-budget.md). |

## Inseln & Bereiche (Geometrie + Warp, Phaser-frei)

Jeweils Geometrie/Kollision + Anleger/Warp + reservierte NPC-/Quest-Trigger-Standplätze; die zugehörige Phaser-Szene nutzt sie. Die Warp-Primitive (`warpAt`/`Warp`) stammen aus `world/regions/archipel.ts` und werden wiederverwendet. Alle Regions-Module liegen gebündelt unter `src/world/regions/` (#551).

| Modul | Inhalt |
|---|---|
| `src/world/regions/geometry.ts` | Geteilte Region-Bausteine (#566): `grassFrame` + `fillTerrain` (Grundterrain aus `landLevel`) + `markRegistrySolids`; einmal statt byte-gleich je Region. |
| `src/world/regions/archipel.ts` | GitOps-Archipel: Insel-Geometrie + Anleger/Warp (Hauptkarte ⇄ Insel). |
| `src/world/regions/lighthouse.ts` | Monitoring-Leuchtturm (#111): Klippen-Geometrie (Gras-Hochebene + begehbarer Stein-Klippenrand) + Aufgang/Warp am Turmfuß + Monitoring-Deko-Plätze. |
| `src/world/regions/warehouse.ts` | Lagerhallen-Viertel/Hafenkai (#124): Quay-Geometrie + Stein-Kai-Wand + Holz-Steg/Warp + Standplätze für Verladekräne/Frachtcontainer + deterministisch gestreute Lager-Güter (Kisten/Fässer). |
| `src/world/regions/watchtower.ts` | Wachturm-Quartier: Festungs-Bailey-Geometrie + Anleger/Warp + Turm-Fußabdruck (#130). |
| `src/world/regions/flotte.ts` | Expeditions-Flotte: Flaggschiff-Deck-Geometrie + Anleger/Warp (#148). |
| `src/world/regions/werft.ts` | Heimat-Werft: Werft-Hof-Geometrie + Helling/Anleger/Warp (Phase-10-Capstone, #165). |
| `src/world/warps.ts` | Region-Übergänge als Daten-Liste (`REGION_WARPS`) + reiner Anti-Pingpong-Kern `armWarps`/`triggeredWarp` (#426). |
| `src/world/hazards.ts` | Gefahren-Entscheidungskern (#512): `resolveHazardTick` (welche Gefahr startet/löst auf/tickt) + Start-Gate + Opfer-Eignung + `pirateSteal`/`stormFixKind`; dazu die szenen-neutralen `HazardEvent`/`HazardStartInfo`-Typen (#540). |

## Tiled-Karten-Pipeline

| Modul | Inhalt |
|---|---|
| `src/world/maps/tilemap.ts` | Tiled-`.tmj`-Grundgerüst (#191): Typen + Validierung + Kollisions-Raster + Tileset→Asset-Mapping; seit #194 auch Objekt-Layer (`objectgroup` + Custom-Properties) als Datengrundlage fürs Warp-/Tür-System (`objectGroup`/`tiledProps`). Maps + Workflow: `assets/maps/README.md`. |
| `src/world/maps/harbormap.ts` | Hafenkarte als Daten (#192): pure Boden-/Kollisions-Geometrie + Tiled-Serialisierung; Quelle für `assets/maps/harbor.tmj`, das seit #196 der einzige Ladepfad für `WorldScene` ist (`buildMap()` entfernt). |
| `src/world/maps/mapregistry.ts` | Map-Registry (#193): die EINE zentrale Liste aller Karten (Map-ID → rohes `.tmj` + Metadaten: Maße, Spawn, Tileset, Layer, Parser). `getMapEntry(id)` löst sie auf; die Loader in `scenes.ts` nutzen sie statt fester Pfade. |

## Reine Domänen-Helfer (`src/core/`)

| Modul | Inhalt |
|---|---|
| `src/core/clock.ts` | Zeit-/Datums-Ableitung für die HUD-Uhr (synchron zum Tag-Nacht-Schleier). |
| `src/core/coins.ts` | Value Object für Dublonen (#490, Forts. #479): Regel „nicht-negativ + ganzzahlig" + zentrale Arithmetik (Rundung/Multiplikator/Affordability) als `Coins`-Brand + Fabriken/Operationen. |
| `src/core/rng.ts` | Zufall/Determinismus-SSOT (#492): seedbarer PRNG `mulberry32`/`nextRandom`/`seedGlobalRng` + aus Namen abgeleitete stabile Werte `hashStr`/`hashHex`; ersetzt `Math.random` in `src/sim/**` + `src/content/**`. |
| `src/core/keybindings.ts` | Umbelegbare Tastatur-Aktionen (#232): diskrete Aktionstasten (Reden/Funkgerät/Logbuch/Album) als frei konfigurierbare Bindings, Phaser-/DOM-frei. |

## HUD-/Eingabe-Logik (Phaser-/DOM-frei, dünn angebunden)

| Modul | Inhalt |
|---|---|
| `src/hud/pixelfont.ts` | Glyphen-Daten (5×7) + Helfer der In-Welt-Pixel-Bitmap-Font (#188); `scenes.ts` backt daraus die RetroFont-Textur für alle In-Welt-Texte. |
| `src/hud/overlaykbd.ts` | Tastatur-Logik für einfache Modals (#283): `resolveOverlayKey` (Navigation ↑/↓/w/s bzw. Auslösen Enter/Leer/E). Dazu `dialogueNav` (#310): Vor-/Zurück-Blättern für mehrzeilige Lese-Dialoge. DOM-Anbindung dünn in `ui/*` + `main.ts`. |
| `src/hud/cmdhistory.ts` | Befehlshistorie fürs Funkgerät-Terminal (#316): `pushHistory` + `navigateHistory` (↑/↓-Cursor, bash-nah). Komfort-Kauf-gated (`Game.isCmdHistoryUnlocked`, #573); DOM-Anbindung dünn in `ui/radio.ts` + `main.ts`. Tests: `test/cmdhistory.test.ts`. |
| `src/hud/questlog.ts` | Logbuch-Übersicht (#326): Zustand jeder Quest (done/active/locked), Freischalt-Bedingung (nach Quest 1), lesbare Dialog-Zeilen fürs Nachlesen abgeschlossener Quests. DOM-Anbindung dünn in `ui/questlog.ts`. |
| `src/hud/markup.ts` | `fmtCmd`: zeichnet variable Platzhalter `<token>` in Content-Texten als sichtbares „ändere-mich"-Badge aus (#311); die EINE Quelle der Platzhalter-Konvention, angewandt an der Render-Grenze (radio/dialog/quiz/questlog/album). |
| `src/hud/cull.ts` | Off-screen-Culling & FPS-Messung (#82) + Cluster-Tag-Auswahl `selectVisibleTags` (#416). |
| `src/hud/labellayout.ts` | Entzerrt sich überlappende In-Welt-Beschriftungen (#207): schiebt horizontal kollidierende Cluster-Tags/Schilder vertikal auseinander (`spreadLabelsVertically`). |
| `src/hud/containeryard.ts` | Container-Hof-Layout (#303): `CONTAINER_DOCK`/`CONTAINER_LAGER` + `containerBarrelTile`; reine Geometrie für clustersync (Fässer) + scenery (Schuppen). |
| `src/hud/viewdecide.ts` | Reine Präsentations-Entscheidungen (#500), DOM-frei/testbar: Funk-Session-Priorität + `evaluateSubmission` (Terminal-Bewertung) + `scoreReview` (Quiz) + `resolveTalkTarget` (NPC-Routing). |
| `src/hud/toastlife.ts` | Toast-Anzeigedauer-Politik: kurze Belohnung vs. lesbarer Hinweis (>= 15 s) + Fade-Timing (#370). |
| `src/hud/kralle.ts` | Kralle-Meilenstein-Sprüche: `krallePracticeMilestone(count)` (zählbewusster Spruch an 1/10/25/50/100…, sonst null, #236). |
| `src/hud/celebrate.ts` | Erfolgs-Feier-Kern (#314): `enqueueAchievement` bündelt aufgelaufene Erfolge, `bundleCelebration`/`celebrationQuip`/`celebrationTitle` bauen die Anzeige-Sicht + deterministischen DevOps-Spruch; Feier-Overlay + Konfetti in `ui/hud.ts`. |
| `src/hud/cmdunlock.ts` | Freigeschaltete Befehlsfamilien fürs gefilterte `help` (#358): aus dem Quest-Fortschritt abgeleitet (kein neues Save-Feld), `help`/`clear` immer dabei. |
| `src/hud/helptext.ts` | `help`-Katalog + gefiltertes Rendering (#358) im CLI-Format; der Simulator delegiert sein `help` hierher (kein Zyklus). |
| `src/hud/funkexplain.ts` | Freies Funken „Was ist gerade passiert?": dosierte Auswahl einer In-World-Erklärung zur Befehlszeile (#362); Katalog ist Content-as-Data (`content/data/funk-explain/<tool>.json`). |
| `src/hud/album.ts` | Sammelalbum/Glossar (#278): Befehle (Teach-Intros) + Wissen (Quiz) aus dem Content, nach Thema gruppiert, Freischalt-Ableitung aus `completedQuests`/`review` (kein neues Save-Feld). |

# Architektur-Analyse: Trägt der Stack ein großes Spiel (Stardew-Maßstab)? (#46)

> ⚠️ **Historisch (Stand #46).** Für den **aktuellen** Stand siehe [architektur-analyse-2026-06.md](architektur-analyse-2026-06.md) – die meisten hier genannten Lücken sind inzwischen geschlossen (Tiled-Maps #191–196, Build-Split #58, Content-as-Data #348/#349, ID-basierte Saves #353/#354). Dieses Dokument bleibt als Entscheidungs-Historie erhalten.

> Spike/Analyse, kein Feature-Bau. Grundlage für die Ausbau-Roadmap.
> Stand: Juni 2026, Code-Stand `main` zum Zeitpunkt von #46.

## Kurzfassung (TL;DR)

**Ja, die Architektur ist „okay" als Fundament für ein großes Spiel** – die
Schichtung (Domäne ↔ Anwendung ↔ Präsentation), die entkoppelte Persistenz mit
Versionierung, das strikte TypeScript und die nach Domänen aufgeteilten Inhalte
sind solide gebaut und im Geist Stardew-tauglich. **Phaser 3 ist die richtige
Engine** und skaliert für ein 2D-Spiel dieser Art problemlos.

Drei Dinge müssen aber umgebaut werden, **bevor** der Content-Umfang deutlich
wächst – sie sind heute auf „eine Hafenkarte" zugeschnitten und skalieren nicht
auf „viele Karten + viele Assets":

1. **Karten-System** – heute komplett im Code handgebaut → datengetrieben (Tiled). **(größte Lücke, prio:hoch → #57)**
2. **Build-Strategie** – nur Single-File/Base64, lädt alles eager → Prod-Build mit Lazy-Loading + Offline-Export trennen. (#58)
3. **Asset-Pipeline** – manuelle Doppel-Verdrahtung pro Asset → Manifest-getrieben. (#59)

Dazu mittel-/niedrigprior: typsicherer Content (#60) und Spielstand-Validierung
beim Laden (#61).

**Nicht** nötig: ECS, eine State-Management-Library oder ein Engine-Wechsel –
das wäre Over-Engineering für den Umfang.

---

## Ausgangslage (verifiziert am Code)

| Bereich | Stand heute |
|---|---|
| Stack | Vite 5 + TypeScript 5 (`strict: true`, ganzes Projekt) + Phaser 3.87, Single-File-Build via `vite-plugin-singlefile` |
| Schichtung | pure Domäne (`sim.ts`, `content/*`, `types.ts`) ↔ Anwendung (`game.ts`, `store.ts`) ↔ Präsentation (`scenes.ts`, `ui.ts`) – sauber getrennt, Domäne ist Phaser-frei und im Node-Test lauffähig |
| Szenen | `BootScene`, `WorldScene`, `InteriorScene` (betretbare Häuser) |
| Persistenz | `store.ts`: localStorage + Auto-Save (5 s) + JSON-Export/Import, **mit** Versions-Hülle `{ v, data }` und Migrationskette |
| Inhalte | bereits nach Domänen in `src/content/` aufgeteilt (Quests/Drills/Quiz/Progression/…), #11 erledigt |
| Tests | Vitest auf Node: `sim`, `content`, `quests` (spielt die ganze Story durch), `world` |

Zwei Punkte aus dem ursprünglichen Ticket-Text sind **bereits gelöst** und im
Code überholt:

- *„Format ohne Versions-/Migrationsfeld"* → `store.ts` hat heute `CURRENT_SAVE_VERSION`, eine Migrations-Kette und eine Versions-Hülle. ✅
- *„`content.ts` ist groß und soll gesplittet werden (#11)"* → bereits aufgeteilt; `content.ts` ist nur noch eine 15-zeilige Fassade. ✅

---

## Analyse nach Themen

### 1. Skaliert Phaser 3 für eine große, offene Welt?

**Die Engine ja – der aktuelle Karten-Aufbau nein.**

Phaser 3 bringt alles mit, was Stardew-Maßstab braucht: Tilemap-Layer mit
Culling, mehrere Szenen, Kamera-Follow/Bounds, Partikel, Tweens. Genutzt wird
davon aber **kein** Tilemap-System: `WorldScene.buildMap()` in `src/scenes.ts`
setzt **jede Kachel, jeden Weg, jedes Gebäude über fest verdrahtete
Koordinaten** auf einer einzigen 52×40-Karte. NPC-Plätze und Türen stehen als
Hardcode-Listen in `src/world/world.ts` (`NPC_SPAWNS`, `DOORS`), Deko wird per
`scatter()`/`objDeco()` im Code gestreut.

Das ist für die eine Hafenszene bewährt und gut testbar (`world.ts` ist
Phaser-frei und unit-getestet), aber:

- **Jede neue Karte = neuer Handcode** statt Daten. Kein Map-Editor-Workflow.
- **Kein generisches Warp-/Übergangs-System** zwischen Karten – `InteriorScene`
  ist über ein kleines `theme`-Enum (`office|forge|chart`) fest verdrahtet.
- Objekte sind alle einzelne GameObjects; bei vielen großen Karten wächst die
  Objektzahl unkontrolliert (kein Tilemap-Layer-Culling).

→ **Empfehlung: Tiled als Karten-Quelle + Map-/Warp-Registry (#57, prio:hoch).**
Bestehende Hafenkarte zuerst 1:1 als Tiled-Map nachbauen, dann `buildMap`
entschlacken. Das ist die mit Abstand wichtigste Weiche für „großes Spiel".

### 2. Content-Architektur: trägt sie viele Quests/Items/NPCs/Maps?

**Struktur gut, Typsicherheit schwach.**

Positiv: Inhalte sind datennah und nach Domänen getrennt (`content/quests.ts`,
`drills.ts`, `quiz.ts`, `progression.ts`, `manifests.ts`). Shop, Ränge, NPCs
sind reine Daten-Arrays – gut erweiterbar. Cross-Referenzen werden in
`content.test.ts`/`quests.test.ts` geprüft.

Schwach: Die Inhalts-Typen sind bewusst permissiv – `QuestStep { type: string;
[k: string]: any }`, `clusterSnapshot: any`. Der **Compiler fängt keine falsch
gebauten Quest-Schritte**; Konsistenz hängt allein an Laufzeit-Tests. `quests.ts`
ist mit ~890 Zeilen die größte Inhaltsdatei. Bei vielen Quests/NPCs/Events
steigt das Risiko stiller Content-Fehler.

Code vs. JSON/Tiled: Quests enthalten viel Logik/Text (Regex-Akzeptanz,
Verzweigungen) – **Code ist hier richtig**, kein Grund auf reines JSON
umzustellen. Maps dagegen gehören in Daten (siehe #57). Der größte Hebel ist
**Typsicherheit**, nicht ein Datenformat-Wechsel.

→ **Empfehlung: diskriminierte Union für `QuestStep` (#60, prio:mittel).**

### 3. Save-System: Versionierung & Migration

**Schon gut – kleine Restlücke.**

`store.ts` hält Versions-Hülle + Migrationskette vor; localStorage bleibt lokaler Cache, `game.ts` wird nicht angefasst – genau das, was ein großes Spiel über viele Releases braucht.

Restlücke: Beim Laden macht `Game.load()` nur `Object.assign(defaultState,
data)`. Fehlende Felder werden ergänzt, **kaputte/fremde Werte aber ungeprüft
übernommen** (manipulierter Import, alter Feldinhalt). Keine Schema-Validierung.

→ **Empfehlung: defensive GameState-Validierung beim Laden (#61, prio:niedrig).**

### 4. Build / Performance: bleibt Single-File sinnvoll?

**Als Offline-Export ja, als einziger Pfad nein.**

`vite-plugin-singlefile` inlinet **alle** Assets als Base64-Data-URIs in **eine**
`dist/index.html` (`assetsInlineLimit` unendlich). Das ist das Headline-Feature
„per Doppelklick offline spielbar" und soll bleiben. Aber bei wachsenden Assets:

- Base64 = ~+33 % Größe, **alles** eager in einer HTML, kein Lazy-Loading pro
  Szene/Karte, kein Caching einzelner Dateien.
- Bei vielen Spritesheets/Tilesets + späterer Musik (#47) wird die HTML mehrere
  MB groß und muss komplett geparst werden, bevor irgendetwas startet →
  Lade-/Speicher-Bottleneck.

→ **Empfehlung: Build-Strategie entkoppeln (#58, prio:mittel).** Prod/Host-Build
mit szenenweisem Lazy-Loading; Single-File-Build als *zusätzliches* Offline-Target.

**Umgesetzt (#58):** Die beiden Build-Wege sind getrennt (`vite.config.ts` schaltet
über den Vite-`mode`): `npm run build` ist der Multi-File-Host-Build nach `dist/`
(Assets als eigene, cachebare Dateien), `npm run build:offline` der self-contained
Single-File-Export nach `dist-offline/`. Das `vite-plugin-singlefile` ist nur noch im
Offline-Mode aktiv. Das *szenenweise Lazy-Loading* der Assets über den Phaser-Loader
ist damit erst vorbereitet (eigener Pfad existiert), aber noch nicht implementiert –
das hängt am Asset-Manifest (#59) und bleibt Folgearbeit.

### 5. Frameworks/Tools allgemein: fehlt etwas?

| Thema | Bewertung |
|---|---|
| **State-Management-Lib** | Nicht nötig. Das `Game`-Singleton + `runtime.ts`-Singletons reichen für diesen Umfang. Globaler mutierbarer State ist überschaubar; eine Lib wäre Over-Engineering. |
| **ECS** | Nicht nötig. Phasers Scene/GameObject-Modell trägt Stardew-Maßstab; ECS einzuführen wäre Aufwand ohne Gegenwert. |
| **Map-Editor (Tiled)** | **Fehlt – wichtigste Ergänzung (#57).** |
| **Asset-Pipeline** | **Zu manuell.** Jedes Asset wird doppelt verdrahtet: `import` in `assets-data.ts` **und** Eintrag in `BOOT_SHEETS`/`BOOT_PLAINS` in `scenes.ts` (inkl. Spaltenzahl fürs Frame-Slicing). Skaliert schlecht → Manifest (#59). |
| **Audio** | `sfx.ts` ist synthetisiertes WebAudio, keine Musik. Hintergrundmusik + Settings sind als #47 schon erfasst. |
| **TypeScript strict** | Sehr gut – durchgängig strict, Ratchet abgeschlossen. Beibehalten. |
| **Tests** | Gute Domänen-Abdeckung (Sim/Content/Story). Präsentation (Phaser) bewusst ausgespart; vertretbar. |

---

## Verdikt

> **Ist die Architektur „okay" für ein großes Spiel? — Ja, als Fundament.**

Die Trennung in pure Domäne / Anwendung / Präsentation, die versionierte
Persistenz mit Backend-Andockpunkt, das strikte TypeScript und die aufgeteilten
Inhalte sind genau die Entscheidungen, die ein wachsendes Spiel braucht. Phaser 3
ist die passende Engine. Es ist **kein** Neubau und **kein** Engine-Wechsel nötig.

Die Grenzen liegen nicht im Konzept, sondern an drei Stellen, die heute auf „eine
Karte / wenige Assets" optimiert sind. Diese vor dem großen Content-Ausbau
umzubauen (vor allem das Karten-System, #57) verhindert, dass jede neue Karte und
jedes Asset teurer wird als nötig.

## Folge-Tickets (die größten Lücken)

| # | Titel | Prio |
|---|---|---|
| [#57](https://github.com/fluffels/kubequest/issues/57) | Tiled-basierte Tilemaps + Map-/Warp-Registry statt handgebauter Karte | 🔴 hoch |
| [#58](https://github.com/fluffels/kubequest/issues/58) | Build-Strategie entkoppeln: Prod-Build (Lazy-Loading) vs. Single-File-Offline-Export | 🟠 mittel |
| [#59](https://github.com/fluffels/kubequest/issues/59) | Asset-Pipeline: Manifest-getriebenes Laden statt manueller `assets-data.ts` + Frame-Slicing | 🟠 mittel |
| [#60](https://github.com/fluffels/kubequest/issues/60) | Content-Typsicherheit: diskriminierte Union für `QuestStep` | 🟠 mittel |
| [#61](https://github.com/fluffels/kubequest/issues/61) | Spielstand beim Laden validieren/sanitisieren (defensives Schema) | 🟡 niedrig |

Verwandt/bereits erfasst: #42 (Schiff betretbar – profitiert von #57), #47
(Audio), #11 (content.ts-Split – erledigt).

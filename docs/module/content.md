# Tiefendoc: Content-as-Data (`src/content.ts` + `src/content/*`)

> On-demand-Detail zur Content-Schicht. Der schlanke Always-Index steht in [CLAUDE.md](../../CLAUDE.md). **Wie man tatsächlich neuen Inhalt hinzufügt** (Quest/NPC anlegen, Save-Migration), steht im Workflow-Abschnitt der [AGENTS.md › Content-as-Data](../../AGENTS.md) — hier liegen nur die **Modul-Interna**, nicht doppelt. Pfade sind repo-relativ als Inline-Code.

## Worum es geht

Quests, NPCs, Smalltalk, Befehls-Drills und Quiz-Karten sind **Daten** (`src/content/data/*.json`), kein TS-Code (ADR 0004, #348/#349/#352/#368). Ein validierender Loader liest + prüft alles beim Start und wirft bei kaputten Daten explizit (`ContentValidationError`). Alles ist Phaser-frei und unit-getestet.

## Module

| Modul | Inhalt |
|---|---|
| `src/content.ts` | **Fassade**: bündelt `src/content/*` (Quests, Drills, Quiz, NPCs, Progression, Minispiel) zum `KQContent`-Objekt. |
| `src/content/loader.ts` | Content-as-Data-Loader (#348/#352/#368): lädt **NPCs, Smalltalk, alle 40 Quests, Befehls-Karten und Quiz-Karteikarten** aus `src/content/data/*.json` und validiert sie zur Laufzeit gegen ein **handgeschriebenes Schema** (kein Zod → zero Runtime-Dep). Kompiliert `accept` (String-Pattern → `RegExp`, für Quests UND Befehls-Karten) und löst `check`-Keys → Funktionen aus `checks.ts` auf; gibt `Quest[]`/`CmdCard[]`/`QuizCard[]` in der gewohnten Laufzeit-Form zurück. Tests: `test/loader.test.ts`. |
| `src/content/checks.ts` | `QUEST_CHECKS`-Registry (#348): die `check`-Prädikate der Quests (prüfen den Sim-Zustand) als benannte Funktionen — die „Mechanik bleibt Code"-Seite von Content-as-Data. `data/quests/*.json` referenziert sie per Key (`<questId>/<cmd|task-id>`). |
| `src/content/validate.ts` | Referenzielle Schema-Validierung (`validateContent`): prüft Querverweise, die der Typ-Check nicht sieht — Geber/NPC/Drill/`after`/`chapter`/`reviewId`/`topic` existieren, Choices wohlgeformt, kein totes Thema. Seit #410 auch die optionalen Quest-**Voraussetzungen** (`requires`): jede ID existiert, kein Selbst-Verweis, **keine Zyklen** im requires-Graph (DFS). Tests: `test/content.test.ts`. |
| `src/content/entities.ts` | Entity-Registry (#349/#357): datengesteuerte **NPC- UND Objekt-Platzierung** aus `data/entities.json` — validiert zur Laufzeit. **NPCs** (`npcs`-Array, referenzielle Integrität gegen `npcs.json`): `npcSpawnsForMap`/`npcSpawnForMap`. **Objekte/Interaktables** (`objects`-Array, #357: Quest-Trigger/props/tower mit `{id,map,x,y,type,sprite?/label?,w?/h?}`): `objectsForMap`, `objectForId`, `objectFootprint` (w×h-Fußabdruck ab Anker nach links/oben). `world.ts` (Hafen) und die Insel-Module/-Szenen leiten Standplätze + solide Objekt-Kacheln daraus ab statt sie hartzucodieren; das Render-Tuning (Sprite-Skalierung/Schatten) bleibt Präsentation (`scenes/shared.ts` › `PROP_RENDER`), prozedurale Deko (`decor.ts`) ist bewusst kein Registry-Objekt. Neuer NPC/neues Objekt = ein JSON-Eintrag. Tests: `test/entities.test.ts`. |
| `src/content/abbrev.ts` | Baustein-Katalog (#287/#298): SSOT aller Langform↔Kürzel-Paare (`-a`/`--all`, `pods`/`po` …) mit Freischalt-ID + `findAbbrevByShort` — Grundlage der „verdiente Abkürzung"-Mechanik (Gating #299, Lernpfad #300). Validiert in `test/abbrev.test.ts` gegen den echten Content. |

## `src/content/data/` — die Datenquelle (#348/#349/#352)

Vom Loader geladen + validiert, von Vite gebündelt; **kein Runtime-`fetch`**, der Offline-Build bleibt heil. Pro Region/Geber je eine Datei (wie Stardew), damit es nicht zum Monolith wird:

- `npcs.json` — NPC-Identität (Name/Titel/Sprite); `smalltalk.json` — Smalltalk; `entities.json` — Standplätze je Karte: `npcs`-Array (NPC-Platzierung #349) + `objects`-Array (platzierte Objekte/Interaktables: Quest-Trigger, Kräne, Container, Monitoring-Deko, Leuchtturm; #357).
- **Quests pro Region/Geber** in `data/quests/<giver>.json` (eine Datei je NPC) + `data/quest-order.json` (die **load-bearing** Spielreihenfolge, `GameState.questIdx` ist ein Index hierin) + `data/quest-topics.json` (Themen-Taxonomie `{id,label}`, geordnet, #327; jede Quest trägt `topic`, Gruppierung fürs Logbuch-Accordion #326). Eine Quest kann optional `requires: questId[]` (Voraussetzungen, #410) und `repeatable` deklarieren — `quest-order.json` bleibt der lineare Lernpfad, `requires` ist das datengesteuerte Gate für optionale Nebenstränge (Runtime-API `Game.canStartQuest`/`startQuest`, siehe [app.md › #410](app.md)).
- **Befehls-Karten pro Geber** in `data/cmdcards/<giver>.json` (Spaced-Repetition-Drills, #352; `chapter` zeigt auf die Quest-ID).
- **Quiz-Karteikarten pro Thema** in `data/crabquiz/<thema>.json` (Krabbe Kralle, Multiple Choice, #368; nach Wissensgebiet statt Geber, da Themen wie RBAC vor ihrer Region existieren).

**Granularität immer mitdenken:** wird eine Regionen-Datei zu groß, in sinnvolle Unterdateien splitten — eine Umstellung ist nur etwas wert, wenn sie dem Wachstum standhält.

> Quest hinzufügen/umbenennen/entfernen inkl. Save-Migrations-Regeln: siehe [AGENTS.md › Content-as-Data](../../AGENTS.md). Quest-Fortschritt persistiert seit #353/#354 per **Quest-ID** (`currentQuestId`), nicht per Zahl-Index — Einfügen/Umsortieren braucht keine Migration.

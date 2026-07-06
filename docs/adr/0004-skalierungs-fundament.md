# ADR 0004: Langfristige Skalierungs-Architektur – Fundament für ein großes Spiel

> Architecture Decision Record. Format: Kontext → Problem → Entscheidung → Konsequenzen → Umsetzungsreihenfolge.
> Status: **akzeptiert** · Datum: 2026-06-19

## Status

**Akzeptiert.** Kubernia soll langfristig zu einem großen Spiel wachsen – Stardew-Qualität *und* Stardew-Scope. Das erfordert jetzt bewusste Weichenstellungen, solange der Umbau noch überschaubar ist.

## Kontext

Der Architektur-Review (#292) hat ergeben: Die heutige Architektur ist **solide für ein fokussiertes Lernspiel mit ~35 Quests**. Für ein wirklich großes Spiel (100+ Quests, 50+ NPCs, viele Welten, jahrelange Entwicklung) fehlen drei Fundamente – und je länger man wartet, desto teurer wird der Umbau.

Dieser ADR hält fest, welche Entscheidungen jetzt getroffen werden, damit das Wachstum nicht irgendwann gegen eine Wand läuft.

## Das Problem – drei konkrete Skalierungs-Grenzen

### 1. Content ist TypeScript-Code

Quests, Dialoge, NPCs, Items leben heute als hart codiertes TypeScript (`src/content/quests.ts`: bereits 2160 Zeilen für ~35 Quests). Das skaliert nicht:

- Jede neue Quest = mehr Code im Build = langsamer TypeCheck = langsamere Iteration
- Kein Nicht-Entwickler kann Content beitragen
- Keine Content-Validierung ohne Build
- Keine Hot-Reload-Möglichkeit für Dialoge
- Bei 200 Quests: ~12.000 Zeilen TS, nicht mehr navigierbar

**Ziel:** Content als Daten-Dateien (JSON/YAML/TOML), die zur Laufzeit geladen und gegen ein Schema validiert werden. TypeScript-Code beschreibt nur noch *Typen und Mechaniken*, nicht mehr die *Inhalte*.

### 2. Entities sind hard-codiert

NPCs, Objekte, Interaktables sind feste Einträge in Arrays (`NPC_SPAWNS`, Deko-Listen). Bei 50+ NPCs mit eigenen Routinen, Dialogen und Zuständen ist das eine Sackgasse. Stardew verwaltet hunderte Entities über ein dateibasiertes System.

**Ziel:** Eine Entity-Registry – eine zentrale, datengesteuerte Tabelle aller Entities (wer, wo, welcher Typ, welche Eigenschaften), die zur Laufzeit gelesen wird. Neue NPCs/Objekte entstehen durch Datei-Einträge, nicht durch Code-Änderungen.

### 3. localStorage hat ein Limit

localStorage: 5–10 MB je Browser. Stardew-Scale-Spielstände (Inventar, Welt-Zustand, alle NPC-Verhältnisse, Quest-History, Spaced-Repetition-Deck für 500+ Karten) sprengen das irgendwann.

**Ziel:** IndexedDB als Persistenz-Backend (praktisch kein Limit im Browser, strukturierte Abfragen möglich). Die `SaveStore`-Schicht kapselt das – der Rest des Codes merkt nichts davon.

## Entscheidung

### Was jetzt festgelegt wird

1. **Content-as-Data ist die Richtung.** Neuer Content entsteht ab sofort wenn möglich als Daten-Datei, nicht als TypeScript-Objekt-Literal. Die Migration des bestehenden Contents ist ein eigenes Ticket (#348).

2. **Entity-Registry wird eingeführt.** Bevor weitere NPCs/Objekte hart codiert werden, wird die Registry gebaut (#349). Bestehende Entities werden schrittweise migriert.

3. **SaveStore migriert auf IndexedDB** (#350). API bleibt gleich, Implementierung wird getauscht. Bestandsdaten werden migriert.

4. **Phaser 3 bleibt – aber mit explizitem neuem Re-Eval-Trigger.** Phaser ist für die heutige Codebasis die richtige Wahl (ADR 0001 gilt). Aber: Sobald die Content-Pipeline (Schema-Validierung, Hot-Reload, Nicht-Entwickler-Tooling) ein eigenes Backend oder Server-Prozess erfordert, ist der Moment für eine echte Engine-Evaluation (Godot). Dieser Trigger ist hiermit dokumentiert und ergänzt ADR 0001.

### Was bewusst *nicht* entschieden wird

- **Kein sofortiger Engine-Wechsel.** Phaser + die saubere Domänen-Schicht erlaubt noch viele Jahre Wachstum, solange Content-as-Data und Entity-Registry gebaut werden. Godot wäre ein kompletter Rewrite – das ist erst relevant wenn Phaser selbst zum Bottleneck wird.
- **Kein Multiplayer/Backend.** ADR 0003 gilt weiter. Skalierung bedeutet hier *Content-Tiefe*, nicht *Mehrspieler*.

## Konsequenzen

**Positiv**
- Content kann wachsen ohne den Build zu verlangsamen
- Nicht-Entwickler können Quest-Dialoge und NPC-Texte beisteuern
- Entity-Zustand ist testbar ohne Spielstart
- Save-System trägt beliebig großen Spielstand
- Die saubere Domänen-Schicht (ADR 0001, heute schon Phaser-frei) bleibt erhalten und wird durch diese Maßnahmen *gestärkt*, nicht aufgebrochen

**Negativ / Aufwand**
- Content-Migration ist nicht trivial: bestehende Quest-TS-Objekte müssen in JSON überführt werden, Typ-Inferenz geht teilweise verloren
- Entity-Registry erfordert ein neues Schicht-Konzept (Laden, Validieren, Instanzieren)
- IndexedDB-API ist asynchron – gelöst (#350) über einen synchronen In-Memory-Cache vor IndexedDB (`await SaveStore.init()` beim Boot hydriert ihn), sodass die SaveStore-API synchron bleibt und KEIN Aufrufer umgestellt werden musste

## Umsetzungsreihenfolge (Tickets)

| Priorität | Ticket | Warum in dieser Reihenfolge |
|---|---|---|
| **hoch** | #348 Content-as-Data: Schema + Loader | Fundament; blockiert alles andere im Content-Bereich |
| **hoch** | #349 Entity-Registry | Fundament; blockiert alle neuen NPCs/Objekte |
| **hoch** ✓ | #350 IndexedDB statt localStorage | Fundament; je früher, desto weniger Datenmigrations-Aufwand. **Erledigt:** IndexedDB-Backend + sync In-Memory-Cache + einmalige localStorage→IndexedDB-Migration |
| **mittel** | #344 game.ts → sfx.ts Schichtverletzung | Kleiner Fix, saubert die Schichtung bevor sie wächst |
| **mittel** | #347 dependency-cruiser Architektur-Wächter | Verhindert neue Schichtverletzungen automatisch |
| **niedrig** | #345 scenes.ts aufteilen | Komfort, kein Fundament |
| **niedrig** | #346 sim.ts gliedern | Komfort, kein Fundament |

## Verwandte ADRs

- [ADR 0001 – Engine-Wahl Phaser 3](0001-engine-phaser.md): Re-Eval-Trigger um „Content-Pipeline erfordert eigenen Server-Prozess" ergänzt
- [ADR 0002 – Kein Backend](0002-kein-backend-keine-db.md): bleibt gültig; Content-as-Data und Entity-Registry sind Client-seitig umsetzbar
- [ADR 0003 – Kein Multiplayer](0003-multiplayer-coop-out-of-scope.md): bleibt gültig
- [ADR 0006 – Backend & Skalierung](0006-backend-und-skalierung.md) (#400): **präzisiert die IndexedDB-Begründung oben.** Der Stardew-Scope-Engpass ist *nicht* die Save-Kapazität (ein Stardew-Save ist selbst nur ~5–10 MB), sondern **Eviction** (der Browser löscht best-effort-Stände per LRU). IndexedDB allein schützt nicht – nötig ist `navigator.storage.persist()` (Folge-Ticket #401).
- [ADR 0007 – Spielsystem-Fundamente](0007-spielsystem-fundamente.md) (2026-06-21): **vervollständigt die „Content ist Daten"-Linie oben um die Mechanik-Ebene.** Dieser ADR (0004) hat Content-*Ablage* (Daten-Dateien) und *Entities* adressiert, aber zwei Mechanik-Ränder offen gelassen, die eine spätere Analyse fand: das **Quest-Fortschritts-Modell** ist linear (#410) und die **Quest-Checks** sind Code statt Daten (#411/#412). Dazu fehlt eine **persistente Zeit-Achse** (#413). ADR 0007 zieht diese drei Fundamente nach.

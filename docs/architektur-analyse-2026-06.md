# Architektur-Analyse 2026-06 – Trägt der Stack ein Spiel in Stardew-Größe?

> ➡️ **Neuere Gesamtsicht:** Eine strukturierte **arc42-Analyse** (aktueller Stand) liegt in [arc42-architektur.md](arc42-architektur.md). Die dort erledigt markierten Baustellen dieser 2026-06-Analyse (#350/#389/#390/#391/#392/#393/#411/#413) sind inzwischen umgesetzt; diese Datei bleibt als historischer Infrastruktur-Fokus erhalten.

> **Stand: 2026-06-20.** Kritische Gesamtanalyse vor dem großen Ausbau (viele Quests/Orte/Charaktere, Spielstände, Stardew-Scope).
> **Nachtrag 2026-06-21:** Eine erneute, **ADR-blinde** Analyse hat drei übersehene **Spielsystem-/Mechanik-Schulden** ergänzt (diese Analyse war Infrastruktur-fokussiert). → Abschnitt „Nachtrag 2026-06-21" unten + [ADR 0007](adr/0007-spielsystem-fundamente.md).
> Diese Analyse löst die ältere [architektur-analyse-stardew.md](architektur-analyse-stardew.md) (#46) als aktuellen Stand ab – die meisten ihrer Lücken sind inzwischen geschlossen (Tiled-Maps #191–196, Build-Split #58, Content-as-Data #348/#349, ID-basierte Saves #353/#354, sim/ui/scenes-Splits).
> Die konkrete Umsetzungs-Reihenfolge steht in [ticket-reihenfolge.md](ticket-reihenfolge.md).

## Leitfrage (oberste Regel)

Für **jede** Entscheidung: „Trägt das, wenn KubeQuest so groß wie Stardew Valley wird (100+ Quests, 50+ NPCs, viele Welten, jahrelange Entwicklung)?" Alte Entscheidungen wurden bewusst angezweifelt – nicht als gesetzt angenommen.

## TL;DR – Verdikt

**Das Fundament trägt.** Die Schichtung (pure Domäne ↔ Anwendung ↔ Präsentation, per dependency-cruiser erzwungen), Content-as-Data, die ID-basierte versionierte Persistenz mit Backup-Slot und durchgängiges strict-TypeScript sind genau die richtigen Weichen. **Kein Engine-Wechsel, kein Backend, kein ECS, kein Monorepo nötig** – das wäre Over-Engineering.

Die echten Baustellen vor dem Content-Ausbau sind **nicht** konzeptionell, sondern an fünf Stellen:

1. **Persistenz-Decke** – localStorage (~5–10 MB) reicht für Stardew-Scale-Saves nicht. → IndexedDB (#350, prio:hoch).
2. **God-Files** – `WorldScene.ts` (1344 LOC) und `game.ts` (793 LOC) bündeln zu viel. → splitten (#393, #392).
3. **KI-Entwickel-Effizienz** – die jede Session geladene CLAUDE.md-Landkarte ist sehr lang; es gibt kein Onboarding/Setup-Skript. → #394, #387.
4. **Qualitätsnetz** – kein Linter, der Arch-Wächter prüft nur die Schichtgrenze, die CI startet das gebaute Spiel nie. → #389, #390, #391.
5. **Asset-Skalierung** – alles wird eager geladen, keine Atlasse. → Lazy-Loading (#198), Atlas (#339) reaktiviert.

## Ausgangslage (am Code verifiziert, 2026-06-20)

| Bereich | Stand |
|---|---|
| Stack | Vite 5 · TypeScript 5.6 (`strict`, ganzes Projekt) · Phaser 3.87 · Vitest 2 · Node ≥22. Zero Runtime-Deps außer Phaser. |
| Umfang | ~15k LOC `src` (69 Dateien) + ~9k LOC `test` (48 Dateien). 786 Tests. |
| Schichtung | sauber getrennt, **automatisch bewacht** (dependency-cruiser, #347): Domäne/Anwendung sind Phaser-frei. |
| Persistenz | `store.ts`: localStorage, Versions-Hülle `{v,data}` (v3), Migrationskette, **Backup-Slot vor jeder Migration**, In-Memory-Fallback, Quota-Schutz. Quest-Fortschritt ID-basiert (#353/#354). |
| Content | Content-as-Data (`src/content/data/*`): Quests/NPCs/Smalltalk/Drills/Quiz als JSON, validierender Loader. |
| Build | zwei Wege aus einer Quelle: Multi-File-Host-Build + self-contained Offline-Single-File. |
| CI | Tests + strict-Typecheck + Arch-Wächter + beide Builds + Devpanel-Build (passwortgated). |

## Kritische Re-Evaluation der ADRs (nicht als gesetzt angenommen)

- **ADR 0001 – Phaser 3: BESTÄTIGT.** Phaser trägt 2D-Top-down in Stardew-Größe; der Re-Eval-Trigger (Content-Pipeline braucht eigenen Server-Prozess) ist **nicht** erreicht. Der Engpass liegt in Code-Struktur und Asset-/Save-Skalierung, nicht in der Engine.
- **ADR 0002 – kein Backend/DB: BESTÄTIGT, mit Schärfung.** Single-Player offline-first bleibt richtig; die Storage-Decke löst **IndexedDB client-seitig** (#350), nicht ein Server. **Wichtige Abgrenzung:** „kein Docker" gilt für den **Betrieb des Spiels** – eine **containerisierte Dev-Umgebung** (#388) ist reine Entwickler-Tooling und kein Widerspruch (wird in ADR 0002 ergänzt).
- **ADR 0003 – kein Multiplayer: BESTÄTIGT.** Skalierung = Content-Tiefe, nicht Mehrspieler.
- **ADR 0004 – Skalierungs-Fundament: greift.** Content-as-Data + Entity-Registry sind gebaut; das **offene Kernstück IndexedDB (#350)** wird jetzt vorgezogen.
- **Einzel-Package statt Monorepo: BESTÄTIGT (vorerst).** Bei 24k LOC ist ein Monorepo Over-Engineering; die internen Grenzen hält der Arch-Wächter. Re-Eval-Trigger: wenn Tooling/Editor/Content-Service als eigenständige Pakete entstehen.

## Befunde im Detail

### 1. Persistenz: Decke + Slots
localStorage ist die einzige Backend-Variante; bei Stardew-Scale-Ständen (Inventar, Welt-Zustand, alle NPC-Beziehungen, Quest-History, Spaced-Repetition-Deck für 500+ Karten) reicht das Limit nicht. Die `SaveStore`-Schicht ist sauber gekapselt – **nur `store.ts` wird getauscht** (#350, async). Migrationskette + Backup-Slot sind vorbildlich und bleiben. Mehrere Spielstände (#306) bauen darauf auf. **Grundregel: kein Update darf je einen bestehenden Stand brechen – immer migrieren.**

### 2. God-Files (Klassenlänge)
`WorldScene.ts` (1344) und `game.ts` (793) sind die zwei verbleibenden God-Module – die großen Familien sim.ts/ui.ts/scenes.ts sind bereits gesplittet. `game.ts` ist das Anwendungs-Pendant (Save+Wirtschaft+Progression+Spaced-Repetition in einem). Beide splitten (#392, #393), **öffentliche API als Fassade unverändert** lassen (wie ui.ts/sim.ts), `game.test.ts` (854 LOC) grün halten. Ein **Dateigröße-Budget** (#390) verhindert künftige God-Files.

### 3. KI-Entwickel-Effizienz (explizites Ziel)
Da der nächste Schub stark KI-getrieben ist, ist „die KI entwickelt billig und sicher" selbst ein Architektur-Ziel:
- **CLAUDE.md verschlanken** (#394): schlanker Always-Index (eine Zeile/Modul) + Tiefendocs on demand – spart Tokens in **jeder** Session.
- **Onboarding + `npm run setup`** (#387): ein Schritt zum lauffähigen Stand, weniger Such-Tokens.
- Kleinere Module (#392/#393) = weniger Lese-Tokens pro Änderung.
- **Qualitätsnetz** (Lint/Arch/Smoke) fängt KI-Fehler vor teuren Test-/Review-Schleifen.

### 4. Qualitätsnetz / Pipeline
Die CI ist solide, aber drei Lücken: **kein Linter** (#389), der **Arch-Wächter prüft nur die Schichtgrenze** – keine Import-Zyklen, keine verwaisten Module, kein Größen-Budget (#390), und die CI **startet das gebaute Spiel nie** (Boot-Fehler kämen durch) → headless Boot-Smoke-Test (#391). Die Präsentation wird sonst nur manuell im Browser verifiziert.

### 5. Asset-Skalierung
Assets werden eager geladen (Offline-Build inlinet alles); kein szenenweises Lazy-Loading (#198) und kein Texture-Atlas (#339). Bei vielen Inseln/Sprites wird das zum Lade-/Draw-Call-Problem – beide Tickets sind reaktiviert und vor dem großen Content-Push eingeplant.

## Neue/aktualisierte Tickets aus dieser Analyse

| # | Titel | Prio |
|---|---|---|
| #387 | Dev-Onboarding-Doku + One-Command-Setup (`npm run setup`) | 🔴 hoch |
| #392 | game.ts aufteilen (God-Object) hinter der Fassade | 🔴 hoch |
| #394 | CLAUDE.md-Landkarte verschlanken (KI-Token-Effizienz) | 🟠 mittel |
| #390 | Architektur-Wächter härten (Zyklen/Orphans/Größe) | 🟠 mittel |
| #389 | ESLint einführen + CI-Gate | 🟠 mittel |
| #391 | CI: Boot-Smoke-Test (headless) | 🟠 mittel |
| #393 | WorldScene.ts aufteilen | 🟠 mittel |
| #388 | Containerisierte Dev-Umgebung (devcontainer/compose, dev-only) | 🟠 mittel |
| #198 | Lazy-Asset-Loading (reaktiviert) | – |
| #339 | Texture-Atlas (reaktiviert) | 🟡 niedrig |

Bestehend & eingeordnet: #350 (IndexedDB, hoch), #357 (Entity-Registry Objekte), #306 (Save-Slots), #332, #334, #314 ⚠, #317 ⚠ EPIC, #293 ⚠, #355 (Grundsatz-Review Auslieferungsform).

## Nachtrag 2026-06-21 — Spielsystem-Fundamente (Mechanik-Ebene)

Die Analyse oben (Stand 2026-06-20) war auf **Infrastruktur** fokussiert (Persistenz, God-Files, KI-Effizienz, Qualitätsnetz, Asset-Skalierung) und kam zum Schluss „Fundament trägt, fünf Baustellen". Eine erneute Gesamtanalyse am 2026-06-21 — **bewusst ohne Blick in die ADRs**, um die alten Annahmen unvoreingenommen zu stresstesten — bestätigt das Infrastruktur-Verdikt, **ergänzt aber drei übersehene Schulden auf der Content-MECHANIK-Ebene** (nicht der -Ablage). Festgehalten in [ADR 0007](adr/0007-spielsystem-fundamente.md); sie gehören **vor** den Content-Push.

| # | Titel | Prio | Befund (kurz) |
|---|---|---|---|
| #410 | Quest-Modell: erweiterbar statt linearem `questIdx` | 🔴 hoch | nur eine aktive Quest; `questIdx` in jedem Save → teuerste Migration je später |
| #411 | Quest-Checks deklarativ (DSL statt 56 Hand-Prädikate) | 🔴 hoch | `checks.ts` ist Code; bricht „Content ist Daten" genau dort, wo Content explodiert |
| #412 | Karten-Freischaltung konsolidieren (`EXTRA_CARDS`+`CONCEPT_INTRO` → JSON) | 🟠 mittel | Doppelpflege zweier Hand-Maps |
| #413 | Persistenter Spiel-Kalender im `GameState` | 🔴 hoch | Zeit nur als Render-Effekt; Voraussetzung für saisonalen Content |
| #414 | Save-Migrations-Integrationstest (echte Alt-Stand-Fixtures) | 🟠 mittel | Netz **vor** #410/#413; „Saves nie brechen" absichern |
| #415 | WorldScene auf Map-Registry generalisieren + TS-Inseln datengetrieben | 🟠 mittel | neue Region = Copy-Paste-Szene; ergänzt #198/#339 |
| #416 | Cluster-Tags cullbar/gebündelt (Frame-Performance) | 🟠 mittel | dynamische Tags ohne Culling |
| #417 | Lazy-Content-Loading + `mergeScenario` entzerren | 🟡 niedrig | Content eager geparst; Laden wächst mit Quest-Zahl |
| #418 | Proprietäre LICENSE + Copyright (public bleiben) | 🟠 mittel | Repo public ohne Lizenz |
| #419 | `main`-Branch-Protection (Owner-Bypass) | 🟠 mittel | PR-Flow + Force-Push-Schutz |
| #420 | NPC-Tagesplan/Routinen | ⏸ zurückgestellt | Scope-Frage; setzt #413 voraus |
| #421 | Item-/Inventar-Modell-Fundament | ⏸ zurückgestellt | Scope-Frage (Crafting?) |

**Korrigiertes Verdikt:** Das Infrastruktur-Fundament trägt — aber „die Basis steht" stimmt erst, wenn auch die drei Spielsystem-Säulen (Quest-Modell, Checks-als-Daten, Zeit-Achse) und das Save-Netz stehen. Umsetzungsreihenfolge: [ticket-reihenfolge.md](ticket-reihenfolge.md).

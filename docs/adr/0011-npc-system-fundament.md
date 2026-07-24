# ADR 0011: NPC-System-Fundament — Datenmodell für lebendige NPCs (Zustand, Routinen, Beziehungen)

> Architecture Decision Record. Format: Kontext → Problem → Entscheidung → Konsequenzen → Umsetzungsreihenfolge.
> Status: **akzeptiert** · Datum: 2026-07-24

## Status

**Akzeptiert.** Aufgeteilt aus #871 (NPC-Entitäts-/System-Modell, iSAQB-Analyse 2026-07-14) als #963. Löst die in [ADR 0007](0007-spielsystem-fundamente.md) bewusst offen gelassene Scope-Frage: Die Maintainerin hat entschieden, dass Kubernia **lebendige** Stardew-NPCs bekommt (Zustand/Routinen/Beziehungen) — NPCs bleiben nicht bei reinen Deko-Gesprächspartnern.

## Kontext

Ein Teil des Fundaments existiert bereits:

- **Entity-Registry (#349):** `src/content/entities.ts` + `data/entities.json` trennt bereits *wer* ein NPC ist (`npcs.json`: Name/Titel/Textur) von *wo* er steht (`entities.json`: Karte/Kachel, referenziert per `id`).
- **Tagesplan-Daten (#420) sind bereits da:** `ScheduleEntry { timeStart, timeEnd, x, y }` + `npcPositionAt(npc, hhmm)` liefern die Zielposition zu einer Uhrzeit — die Präsentation (`scenes/worldscene/npcschedule.ts › updateNpcSchedules`) **teleportiert** NPCs aber an diese Position, statt sich dorthin zu bewegen.
- **Persistenter Kalender (#413) ist da:** `game/clock.ts › advanceClock()/calendar()` liefert `GameClock.hhmm` — der Zeit-Trigger für eine Zustandsmaschine existiert schon.
- **Save-Versionierung** ist etabliert: `CURRENT_SAVE_VERSION = 9` (`store/versioning.ts`), additive Felder laufen über `sanitizeState`-Defaults, strukturelle Änderungen über eine nummerierte Migration + Pflicht-Fixture (`test/savemigration.test.ts`, #510).

Was fehlt: eine **Zustands-/Verhaltensdimension** pro NPC (arbeitet er gerade, schläft er, ist er ansprechbar?) und ein **Beziehungs-/Zuneigungsmodell**, das über die reine Standplatz-Registrierung hinausgeht. [ADR 0007](0007-spielsystem-fundamente.md) hatte genau das (#420 im weiteren Sinn) bewusst `status:zurückgestellt` gelassen, weil die Scope-Frage — simulierte Alltagsroutinen/Beziehungen vs. reine Lern-Tiefe — erst entschieden werden musste. Diese Entscheidung ist jetzt gefallen (positiv); dieser ADR legt das **Datenmodell** fest, bevor die fünf aus #871 aufgeteilten Kindertickets (#964–#968) Code schreiben.

## Problem

Vier konkrete Fragen blockieren #964–#968, bis sie beantwortet sind:

1. Welche Zustands-/Verhaltensdimensionen bekommt eine NPC-Entität?
2. Wie erweitert sich das bestehende `entities.ts`/`entities.json`-Schema **additiv** (kein Bruch bestehender Karten/Stände)?
3. Wie bleibt das Phaser-frei und pure-domain-testbar (Schichtregel: kein Import von `scenes`/`ui` in `content`/`world`)?
4. Wie schneiden sich die fünf Folge-Tickets — passt die Reihenfolge, oder wo hängen sie tatsächlich voneinander ab?

## Entscheidung

### Leitprinzip: statisch (Design-Daten) ↔ dynamisch (Spielstand) sauber trennen

Analog zur bestehenden *wer*↔*wo*-Trennung (#349) bekommt das NPC-System eine zweite Achse — **was ist Design-Zeit-Content vs. was akkumuliert sich im Spielstand:**

| Dimension | Wo | Schicht | Save-Migration? |
|---|---|---|---|
| Identität (Name/Titel/Textur) | `npcs.json` (existiert) | pure Domäne | nein |
| Platzierung + Tagesplan (Karte/Kachel/`schedule`) | `entities.json` (existiert) | pure Domäne | nein |
| **Rolle** (vendor/quest-giver/trainer/flavor, #964) | `entities.json`, additiv | pure Domäne | nein |
| **Verhaltenszustand je Tagesplan-Eintrag** (working/idle/asleep/…, #964) | `entities.json`, additiv (Feld an `ScheduleEntry`) | pure Domäne | nein |
| **Aktueller Verhaltenszustand** (#965) | **abgeleitet**, nie gespeichert | pure Domäne (reine Funktion) | nein |
| **Beziehungs-/Zuneigungslevel** (#968) | **`GameState` (neu)** | Anwendung/Persistenz | **ja — die einzige Migration** |

**Leitsatz:** Verhaltenszustand wird zur Laufzeit abgeleitet (genau wie `npcPositionAt` heute Position aus Zeit ableitet) — nur die Beziehung wird persistiert. Das hält vier der fünf Kindertickets migrationsfrei und bündelt das gesamte Save-Risiko in einem einzigen Ticket (#968).

### 1. Statische Schema-Erweiterung (#964) — additiv, Vorbild `ScheduleEntry`

In `src/content/entities.ts`, additiv zu `EntityNpc` und `ScheduleEntry`:

```ts
type NpcRole = "vendor" | "quest-giver" | "trainer" | "flavor";
type NpcActivity = "idle" | "working" | "walking" | "asleep" | "away";

interface ScheduleEntry {            // erweitert
  timeStart: string; timeEnd: string; x: number; y: number;
  activity?: NpcActivity;            // NEU, Default "idle"
}
interface EntityNpc extends Spawn {  // erweitert
  map: string;
  schedule?: readonly ScheduleEntry[];
  role?: NpcRole;                    // NEU, Default "flavor"
}
```

Validierung nach demselben Muster wie `EntityObjectType`/`OBJECT_TYPES` (Allowlist, `fail(...)` bei unbekanntem Wert) und `assertNoUnknownKeys` um die neuen Felder erweitert. Beide Felder optional mit Default → **keine Migration nötig**, bestehende `entities.json`-Einträge bleiben gültig.

### 2. Zustandsmaschine (#965) — reine Funktion, kein Save

Neues pures Modul (z.B. `src/content/npcstate.ts`), analog zur Signatur von `npcPositionAt`:

```ts
function npcActivityAt(npc: EntityNpc, hhmm: string, ctx: NpcContext): NpcActivity
```

- **States:** `NpcActivity` (oben).
- **Trigger:** Tagesplan-Zeitgrenzen (Haupttreiber, deterministisch), Spieler-Interaktion (Override während des Dialogs), Übergang zwischen zwei Tagesplan-Punkten (`walking`, speist #966), kein Tagesplan-Eintrag zur aktuellen Zeit (`asleep`/`away`).
- **Rein & deterministisch:** gleiche Eingaben → gleiche Ausgabe, keine internen Mutablen. Transiente Eingaben (Interaktion, Uhrzeit) kommen als **Parameter** herein (`ctx`), nie als Import — dasselbe Injektions-Muster wie `entityMapProblems(…, knownMaps)`, verhindert einen Import-Zyklus zu `game/clock.ts`. Unit-testbar wie `content/entities.test.ts`. **Kein persistierter Zustand** → keine Migration.

### 3. Bewegung statt Teleport (#966) — Präsentation + pure Geometrie

Ersetzt den Teleport in `updateNpcSchedules`: eine reine Interpolationsfunktion in `src/world/` (z.B. `stepToward(from, to, maxDist) → pos`), unit-testbar ohne Phaser. Die Szene (Präsentation) ruft sie pro Frame auf und setzt währenddessen `activity: "walking"`. Keine neue Save-Größe.

### 4. Beziehungs-/Zuneigungsmodell (#968) — das einzige Save-Feld

Neues additives `GameState`-Feld (`src/types.ts`):

```ts
interface NpcRelation { points: number; talkedDay?: number }
interface GameState { …; npcRelations: Record<string, NpcRelation>; }
```

- **Skala:** punktbasiert (ganze Zahl), Herz-Tier abgeleitet — Stardew-Konvention: 250 Punkte/Herz, 10 Herzen, Deckel 2500. `heartLevel(points) = clamp(Math.floor(points / 250), 0, 10)` als reine Domänen-Funktion. Punkte statt direkt Herzen, damit sich Teil-Fortschritt (z.B. Tagesdeckel beim Plaudern) fein akkumuliert.
- **Speicherort:** `GameState.npcRelations`, keyed by NPC-`id` (referenziell gegen `NPCS`). Lazy: fehlender Eintrag = 0 Punkte, kein Pflichteintrag pro NPC → skaliert auf 50+ NPCs ohne Save-Bloat.
- **Migration:** rein additiv → Default `{}` in `sanitizeState`, dazu ein dokumentierter **No-op**-Eintrag in der Migrationskette (`store/versioning.ts`, `CURRENT_SAVE_VERSION` 9→10) nach demselben Muster wie bisherige additive Bumps. **Pflicht (#510):** volle Alt-Stand-Fixture + Lade-Test in `test/savemigration.test.ts`, sonst bleibt der Migrations-Wächter rot.

### Schichtregel (Frage 3)

Schema, Zustandsmaschine und Beziehungs-Mathematik bleiben **pure Domäne** (`content`/`world`/Anwendung) — kein Import von `phaser`/`scenes`/`ui` (hart erzwungen via `check:arch`). Die Präsentation (`WorldScene`/`npcschedule.ts`) verbindet: liest `calendar().hhmm`, ruft die puren Funktionen, wendet Bewegung/Aktivität visuell an und wählt zustandsabhängige Dialogtexte über den etablierten ACL-Seam (`hud/markup.ts`) statt verstreuter Sim-/Content-Zugriffe quer durch die UI.

## Konsequenzen

**Positiv**
- Löst die von ADR 0007 offen gelassene Scope-Frage explizit — Folge-Tickets müssen sie nicht mehr aufrollen.
- Vier von fünf Kindertickets (#964–#967) bleiben komplett migrationsfrei (additiv bzw. abgeleitet); das Save-Risiko konzentriert sich sichtbar in genau einem Ticket (#968).
- Baut auf bestehender Infrastruktur auf (Entity-Registry, Tagesplan-Daten, Kalender) statt sie zu duplizieren.
- Verhaltenszustand wird nie persistiert → kein Save-Bloat bei 50+ NPCs, nach Reload deterministisch neu berechnet.

**Negativ / Aufwand**
- Der Umbau von Teleport auf echte Bewegung (#966) berührt die Präsentationsschicht (`npcschedule.ts`) und braucht Browser-Verifikation statt reinem Unit-Test.
- #968 bleibt der teuerste Slice der Fünf (Save-Migration + Fixture-Pflicht) und sollte entsprechend zuletzt und mit Sorgfalt geschnitten werden.
- Diese Entscheidung legt nur das **Datenmodell** fest, nicht die konkrete Punkte-Ökonomie (wie viele Punkte pro Plausch/Quest/Geschenk) — das bleibt bewusst Inhalt von #968, sonst würde der ADR zum Feature-Design.

## Umsetzungsreihenfolge (Tickets)

| Reihenfolge | Ticket | Warum hier |
|---|---|---|
| 1 | **#964** Schema erweitern (`role` + `activity` an `ScheduleEntry`) | additiv, keine Migration; Fundament der anderen vier |
| 2 | **#965** Zustandsmaschine (reine Funktion) | kein Save; hängt an #964 |
| 3 | **#966** Bewegung entlang Schedule statt Teleport | Präsentation + pure Geometrie; nutzt den `walking`-State aus #965 |
| 4 | **#967** Interaktion an Zustand koppeln | Dialogvarianten additiv + ACL-Seam; hängt an #964/#965, liefert die Plausch-Quelle für #968 |
| 5 | **#968** Beziehungs-/Herz-Modell + Save-Migration | einziges save-berührendes Kind — zuletzt, mit dem Migrations-Netz (#510-Fixture) sorgfältig sequenziert |

## Verwandte ADRs

- [ADR 0004 – Skalierungs-Fundament](0004-skalierungs-fundament.md): Dieser ADR erweitert die dort gelegte Entity-Registry (#349) um eine zweite Achse (Zustand/Beziehung) nach derselben Content-as-Data-Logik.
- [ADR 0007 – Spielsystem-Fundamente](0007-spielsystem-fundamente.md): Löst die dort unter „Bewusst nicht entschieden" offen gelassene NPC-Scope-Frage (#420) positiv auf. Das reiche Item-/Crafting-Modell (#421) bleibt weiterhin `status:zurückgestellt` — diese Entscheidung betrifft nur NPCs, nicht Items.
- [ADR 0010 – Karten-Modell: Tiled vs. Code-Builder](0010-karten-modell-tiled-vs-code-builder.md): Gleiches Muster — additive Content-as-Data-Erweiterung statt Neubau, mit klarer Grenzregel (hier: statisch vs. dynamisch statt bespoke vs. prozedural).
- [ADR 0001 – Engine Phaser](0001-engine-phaser.md): unberührt — das gesamte Datenmodell (Schema, Zustandsmaschine, Beziehungs-Mathematik) ist Phaser-frei in der Domänenschicht umsetzbar; nur die Bewegungs-*Anwendung* (#966) sitzt in der Präsentation.

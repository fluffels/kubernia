# Tiefendoc: Content-as-Data (`src/content.ts` + `src/content/*`)

> On-demand-Detail zur Content-Schicht. Der schlanke Always-Index steht in [CLAUDE.md](../../CLAUDE.md). **Wie man tatsächlich neuen Inhalt hinzufügt** (Quest/NPC anlegen, Save-Migration), steht im Workflow-Abschnitt der [AGENTS.md › Content-as-Data](../../AGENTS.md) — hier liegen nur die **Modul-Interna**, nicht doppelt. Pfade sind repo-relativ als Inline-Code.

## Worum es geht

Quests, NPCs, Smalltalk, Befehls-Drills und Quiz-Karten sind **Daten** (`src/content/data/*.json`), kein TS-Code (ADR 0004, #348/#349/#352/#368). Ein validierender Loader liest + prüft alles beim Start und wirft bei kaputten Daten explizit (`ContentValidationError`). Alles ist Phaser-frei und unit-getestet.

## Module

| Modul | Inhalt |
|---|---|
| `src/content.ts` | **Fassade**: bündelt `src/content/*` (Quests, Drills, Quiz, NPCs, Progression, Minispiel) zum `KQContent`-Objekt. |
| `src/content/loader.ts` | Content-as-Data-Loader (#348/#352/#368): lädt **NPCs, Smalltalk, alle 40 Quests, Befehls-Karten und Quiz-Karteikarten** aus `src/content/data/*.json` und validiert sie zur Laufzeit gegen ein **handgeschriebenes Schema** (kein Zod → zero Runtime-Dep). Kompiliert `accept` (String-Pattern → `RegExp`, für Quests UND Befehls-Karten) und löst `check` auf: ein **String** → Sonderfall-Funktion aus `checks.ts`, ein **Objekt** → deklarative Regel via `check-dsl.ts` (#411). Gibt `Quest[]`/`CmdCard[]`/`QuizCard[]` in der gewohnten Laufzeit-Form zurück. Tests: `test/loader.test.ts`. |
| `src/content/parse.ts` | Geteilte Parse-Primitiven (#411): `ContentValidationError`, `fail` und die `as*`-Validatoren (`asRecord`/`asNonEmptyString`/`asInt`/`asArray`/…). Abhängigkeitsfreies **Leaf-Modul**, das loader.ts UND check-dsl.ts teilen — bricht den sonst entstehenden Import-Zyklus loader↔check-dsl (#390). `loader.ts` re-exportiert `ContentValidationError` weiter. |
| `src/content/check-dsl.ts` | Deklarative Quest-Check-DSL (#411): `compileCheck(rule, path)` übersetzt eine `check`-Regel aus der JSON in ein `(sim) => boolean`. Regeln: `all`/`any`/`not`, `some`/`none`/`count` über eine geschlossene Sammlungs-Allowlist (`CHECK_COLLECTIONS`, inkl. virtueller `alerts()`), `flag`/`includes` für Skalar-Pfade; Matcher-Formen für Element-Felder: Literal-`===`, `truthy`, `len`, `includes`, `has` (Sub-Array), `match` (Sub-Objekt). Wirft `ContentValidationError` bei kaputter Struktur/unbekannter Sammlung. Grammatik unten. Tests: `test/check-dsl.test.ts` (+ realer Durchlauf in `quests.test.ts`). |
| `src/content/checks.ts` | `QUEST_CHECKS`-Registry (#348/#411): seit #411 **nur noch die echten Code-Sonderfälle** der `check`-Prädikate — Bedingungen, die kein deklarativer Zustand sind, sondern eine transiente Aktions-Markierung (z.B. `sim.lastDeletedPod`). Der Regelfall ist Daten (Check-DSL). `data/quests/*.json` referenziert einen Sonderfall per String-Key (`<questId>/<task-id>`). |
| `src/content/validate.ts` | Referenzielle Schema-Validierung (`validateContent`): prüft Querverweise, die der Typ-Check nicht sieht — Geber/NPC/Drill/`after`/`chapter`/`introducedIn`/`reviewId`/`topic` existieren, Choices wohlgeformt, kein totes Thema. Seit #410 auch die optionalen Quest-**Voraussetzungen** (`requires`): jede ID existiert, kein Selbst-Verweis, **keine Zyklen** im requires-Graph (DFS). Tests: `test/content.test.ts`. |
| `src/content/entities.ts` | Entity-Registry (#349/#357): datengesteuerte **NPC- UND Objekt-Platzierung** aus `data/entities.json` — validiert zur Laufzeit. **NPCs** (`npcs`-Array, referenzielle Integrität gegen `npcs.json`): `npcSpawnsForMap`/`npcSpawnForMap`. **Objekte/Interaktables** (`objects`-Array, #357: Quest-Trigger/props/tower mit `{id,map,x,y,type,sprite?/label?,w?/h?}`): `objectsForMap`, `objectForId`, `objectFootprint` (w×h-Fußabdruck ab Anker nach links/oben). `world.ts` (Hafen) und die Insel-Module/-Szenen leiten Standplätze + solide Objekt-Kacheln daraus ab statt sie hartzucodieren; das Render-Tuning (Sprite-Skalierung/Schatten) bleibt Präsentation (`scenes/shared.ts` › `PROP_RENDER`), prozedurale Deko (`decor.ts`) ist bewusst kein Registry-Objekt. Neuer NPC/neues Objekt = ein JSON-Eintrag. Tests: `test/entities.test.ts`. |
| `src/content/abbrev.ts` | Baustein-Katalog (#287/#298): SSOT aller Langform↔Kürzel-Paare (`-a`/`--all`, `pods`/`po` …) mit Freischalt-ID + `findAbbrevByShort` — Grundlage der „verdiente Abkürzung"-Mechanik (Gating #299, Lernpfad #300). Validiert in `test/abbrev.test.ts` gegen den echten Content. |

## `src/content/data/` — die Datenquelle (#348/#349/#352)

Vom Loader geladen + validiert, von Vite gebündelt; **kein Runtime-`fetch`**, der Offline-Build bleibt heil. Pro Region/Geber je eine Datei (wie Stardew), damit es nicht zum Monolith wird:

- `npcs.json` — NPC-Identität (Name/Titel/Sprite); `smalltalk.json` — Smalltalk; `entities.json` — Standplätze je Karte: `npcs`-Array (NPC-Platzierung #349) + `objects`-Array (platzierte Objekte/Interaktables: Quest-Trigger, Kräne, Container, Monitoring-Deko, Leuchtturm; #357).
- **Quests pro Region/Geber** in `data/quests/<giver>.json` (eine Datei je NPC) + `data/quest-order.json` (die **load-bearing** Spielreihenfolge, `GameState.questIdx` ist ein Index hierin) + `data/quest-topics.json` (Themen-Taxonomie `{id,label}`, geordnet, #327; jede Quest trägt `topic`, Gruppierung fürs Logbuch-Accordion #326). Eine Quest kann optional `requires: questId[]` (Voraussetzungen, #410) und `repeatable` deklarieren — `quest-order.json` bleibt der lineare Lernpfad, `requires` ist das datengesteuerte Gate für optionale Nebenstränge (Runtime-API `Game.canStartQuest`/`startQuest`, siehe [app.md › #410](app.md)).
- **Befehls-Karten pro Geber** in `data/cmdcards/<giver>.json` (Spaced-Repetition-Drills, #352; `chapter` zeigt auf die Quest-ID).
- **Quiz-Karteikarten pro Thema** in `data/crabquiz/<thema>.json` (Krabbe Kralle, Multiple Choice, #368; nach Wissensgebiet statt Geber, da Themen wie RBAC vor ihrer Region existieren).

> **Karten-Freischaltung als Single Source (#412).** Wann eine Karte (CMD/Quiz) in den Spaced-Repetition-Pool kommt, steht ausschließlich in den **Karten-Daten**: das `chapter`-Feld = die Quest, nach deren Abschluss sie freigeschaltet wird (zugleich, per Default, die Einführungs-Quest ihres Konzepts). Optional `introducedIn` = die Einführungs-Quest, **falls** das Konzept FRÜHER eingeführt wird, als die Karte freigeschaltet wird (sonst gilt `chapter`). Die früheren Hand-Maps `EXTRA_CARDS` (game.ts) und `CONCEPT_INTRO` (content/learnorder.ts) sind entfallen – sie führten dieselbe Info doppelt und drifteten auseinander. `game.ts` → `registerQuestCards` schaltet pro Quest die Karten mit passendem `chapter` plus die Choice-`reviewId`s frei; der **Lernreihenfolge-Wächter** `content/learnorder.ts` (`introOrderFromContent` + `lernpfadVerstoesse`, Test `test/learnorder.test.ts`) leitet die Einführungs-Positionen aus dieser Single Source ab und prüft: keine Karte wird vor ihrer Einführung freigeschaltet.

**Granularität immer mitdenken:** wird eine Regionen-Datei zu groß, in sinnvolle Unterdateien splitten — eine Umstellung ist nur etwas wert, wenn sie dem Wachstum standhält.

> Quest hinzufügen/umbenennen/entfernen inkl. Save-Migrations-Regeln: siehe [AGENTS.md › Content-as-Data](../../AGENTS.md). Quest-Fortschritt persistiert seit #353/#354 per **Quest-ID** (`currentQuestId`), nicht per Zahl-Index — Einfügen/Umsortieren braucht keine Migration.

## Check-DSL — Quest-Erfolgsbedingungen als Daten (#411)

Eine `teach`/`terminal`-Aufgabe kann ein `check`-Prädikat tragen, das nach der Eingabe den **Sim-Zustand** prüft („ist der Service jetzt da? das Deployment heil?"). Bis #411 war jedes ein hartcodiertes Prädikat in `checks.ts` (56 Stück) — jede neue Quest mit Prüfbedingung brauchte einen Code-Eintrag. Seit #411 ist der **Regelfall Daten**: eine deklarative Regel in der Quest-JSON, die `check-dsl.ts` beim Laden zu `(sim) => boolean` kompiliert. `quests.test.ts` spielt die ganze Story durch und prüft jeden `check` gegen den echten Sim — die Migration ist damit byte-genau abgesichert.

**Regeln** (genau ein Schlüssel je Objekt):

| Regel | Bedeutung |
|---|---|
| `{ "some": "<coll>", "where": <matcher> }` | ≥1 Element der Sammlung passt (ohne `where`: Sammlung nicht leer) |
| `{ "none": "<coll>", "where": <matcher> }` | kein Element passt (Abwesenheit) |
| `{ "count": "<coll>", "where"?, "cmp": ">", "value": 3 }` | Anzahl passender Elemente verglichen (`cmp`: `>` `>=` `==` `!=` `<` `<=`) |
| `{ "flag": ["git","remoteAhead"], "eq"?: 0 }` | Skalar an einem Pfad ab `sim`; ohne `eq` truthy, mit `eq` strikt gleich. Pfad ist ein **Array** (Schlüssel mit Punkt, z.B. `["files","seekarte.md"]`, funktionieren) |
| `{ "includes": ["git","staged"], "value": "x" }` | Array unter dem Pfad enthält den Wert |
| `{ "all": [ … ] }` / `{ "any": [ … ] }` / `{ "not": … }` | UND / ODER / Negation |

**Matcher** (`where`) = Feld→Bedingung, **alle** müssen passen. Eine Bedingung ist ein Literal (strikte Gleichheit, deckt Namen/Zahlen/Booleans ab) oder ein Objekt mit genau einer Form: `{ "truthy": bool }` (Feld vorhanden/leer — z.B. `broken`/`tls`), `{ "len": n }` (Array-Länge), `{ "includes": v }` (Array enthält), `{ "has": <matcher> }` (Sub-Array hat passendes Element — z.B. StatefulSet-Pods), `{ "match": <matcher> }` (Sub-Objekt — z.B. `envFrom`).

**Sammlungen** sind eine **geschlossene Allowlist** (`CHECK_COLLECTIONS` in `check-dsl.ts`): u.a. `services`, `deployments`, `ingresses`, `networkPolicies`, `argoApps`, `statefulSets`, `pvcs`, `pvs`, `storageClasses`, `volumeSnapshots`, `serviceMonitors`, `containers`, `nodes`, `releases` und die **virtuelle** `alerts` (= `sim.alerts()`). Eine unbekannte Sammlung scheitert hart beim Laden (`ContentValidationError`) — so ist die Regel referenziell an den echten Sim-Zustand gebunden. Die konkreten Ressourcen-*Namen* (z.B. `"hafen-lager"`) lassen sich **nicht** statisch prüfen: sie entstehen erst, wenn der Spieler die Quest löst — genau das verifiziert der Check. Ein Tippfehler im Namen fällt im `quests.test.ts`-Durchlauf auf (Check bliebe fälschlich falsch → roter Test).

**Wann doch Code (`checks.ts`):** nur echte Sonderfälle, die kein deklarativer *Zustand* sind, sondern eine transiente *Aktions-Markierung* (z.B. „der Spieler hat gerade einen Pod gelöscht", `sim.lastDeletedPod`). Im Zweifel zuerst die DSL prüfen — sie deckt Sammlungen/Flags/Pfade ab; nur was wirklich nicht passt, kommt nach `checks.ts` und wird per String-Key referenziert.

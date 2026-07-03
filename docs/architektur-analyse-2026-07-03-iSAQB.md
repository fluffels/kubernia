# KubeQuest — Architektur-Analyse 2026-07-03 (iSAQB, Runde 3: ADRs, DDD, Tests, Harness)

> **Stand: 2026-07-03.** Dritte vollständige Runde, einen Tag nach [Runde 2](architektur-analyse-2026-07-02-iSAQB.md) (#577–#595) und zwei nach [Runde 1](architektur-analyse-2026-07-iSAQB.md) (#492–#524). Diese Runde ist **breiter** angelegt als die beiden Code-Runden: vier unabhängige Durchläufe haben je eine andere Brille aufgesetzt —
> **(1) die ADRs bewusst kritisch hinterfragt** (nicht als Gesetz), **(2) der Code gegen DDD/iSAQB**, **(3) die Teststrategie als _Funktionstest_-Frage** („funktioniert das Spiel, stimmt der Lerninhalt?"), **(4) der Entwicklungs-Harness** gegen die Frage „fest genug fürs Vibe-Coding, und verhindern die Guards die Wiederkehr des Aufgeräumten?".
>
> Jeder Befund ist gegen die konkrete Datei:Zeile bzw. das konkrete Gate verifiziert und gegen die Runden 1/2 auf Dubletten geprüft. Alle neuen Befunde sind als **#596–#612** ticketiert; zusätzlich zwei begründete Prio-Anhebungen (#592 mittel→**hoch**, #591 niedrig→**mittel**).

## Gesamtverdikt

**Das Fundament bleibt außergewöhnlich reif** — Runde 1 war strukturell, Runde 2 Feinschliff, und Runde 3 bestätigt das aus vier Richtungen: kein ADR ist inhaltlich falsch, die Schichtung/DDD-Disziplin trägt, die Test- und Guard-Netze sind für ein Projekt dieser Größe herausragend. Die neuen Befunde sind darum erneut eine Stufe subtiler — aber diesmal mit **zwei echten, für das Projektziel zentralen Themen**, die die beiden Code-Runden methodisch _nicht sehen konnten_, weil sie bewusst nur den Code ansahen:

1. **Die Guards sind exzellent definiert, aber lokal umgehbar durchgesetzt (Vibe-Coding-Achillesferse).** Für _strukturelle_ Regressionen (God-Files, Komplexität, Schichten, Zyklen, Save-Migration, Doku-Landkarte, Content-Reihenfolge) ist der Harness **fest genug** — diese Klassen können nicht unbemerkt zurückkehren. Die verbleibende Schwäche ist nicht die _Definition_, sondern die _Durchsetzung_: bei Direkt-Push auf `main` hängt alles am lokalen, per `git push --no-verify` umgehbaren Hook; `check:diffsize` degradiert im flachen CI-Checkout bewusst zu grün. Ein autonomer Agent kann so roten Code auf `main` schieben, auf dem ein paralleler Agent aufbaut. Das ist als **#592** erfasst und hier auf **prio:hoch** gehoben — es untergräbt alle anderen Gates.

2. **Die Tests garantieren, dass das Spiel _funktioniert_ und Content _strukturell konsistent_ ist — nicht, dass das Gelernte _stimmt_.** Kein Test prüft, dass der `correct`-Index einer Quiz-Karte fachlich richtig ist oder dass die Distraktoren echte Distraktoren sind. Ein vertauschter Index lehrt still falsches K8s und bleibt grün (#597/#598). Für ein Lernspiel ist das die didaktisch wichtigste Lücke.

Daneben stehen drei weitere wiederkehrende Muster (bekannt aus Runde 2, hier an neuen Stellen): **die letzte Meile der eigenen SSOT** (`_resetNodes` umgeht das Node-Aggregat wie zuvor `_mergeNodes` — der eine echte latente Bug, #596), **Validierungs-Asymmetrie** (die Entity-Registry ist als einzige Content-Sammlung unvalidiert, #600) und **eine Doku-Governance-Lücke** (ADR 0005 wird verwaltet, hat aber kein Artefakt — arc42 §9 verweist auf eine nicht existente Datei, #606).

Kein Umbau. Alle Befunde sind session-groß und ratchetbar.

## Methodik

| Durchlauf | Brille | Scope |
|---|---|---|
| ADR-Kritik | Entscheidungen anzweifeln (Stardew-Scope + Code-Realität) | `docs/adr/0001–0008`, `docs/arc42-architektur.md`, `docs/glossar.md` + Code-Gegenprobe |
| DDD / iSAQB | Bounded Contexts, Aggregate, Schichten, SSOT, Kopplung | `src/**`, Fokus Sim-Domäne/Content/Präsentation |
| Tests (Funktionstest) | funktioniert das Spiel, stimmt der Lerninhalt? | `test/**`, `e2e/**`, Coverage-Schwellen |
| Harness / Governance | Vibe-Coding-Härte + Regressions-Matrix | `AGENTS.md`, `docs/agent-harness.md`, `scripts/**`, ESLint/dep-cruiser/tsconfig, CI, Hooks, Fitness-Tests |

## 1) ADR-Kritik — die Entscheidungen selbst

Die ADRs sind überdurchschnittlich diszipliniert: jeder trägt einen Re-Eval-Trigger, **ADR 0006 zweifelt aktiv seine Vorgänger an** (korrigiert die falsche „IndexedDB = Kapazität"-Begründung aus 0004, benennt die reale Eviction-Lücke, die inzwischen via `src/store/persistence.ts` geschlossen ist), und **ADR 0007 ist durch #559 sogar übererfüllt** (der als „teuerster Umbau" beschriebene persistierte `questIdx` ist weg). Kein ADR ist gegen Stardew-Scope inhaltlich falsch.

| ADR | Hält? | Befund |
|---|---|---|
| 0001 Phaser 3 | ✅ ja | Mehrfach re-evaluiert, Phaser-4-Verschiebung sauber begründet (Renderer-Bug), Re-Eval hängt an #474. Kein Ticket. |
| 0002 Kein Backend | ✅ ja | Sauber an 0006/#355 delegiert; `persist()` umgesetzt. Kein Ticket. |
| 0003 Kein Multiplayer | ✅ ja | An 0002 gekoppelt, Co-op bewusst durchdacht+verworfen. Kein Ticket. |
| 0004 Skalierungs-Fundament | ✅ ja | Content-as-Data am Code sichtbar; der letzte TS-Literal-Rest (RANKS/SHOP/STACK_ROUNDS) ist als **#583** erfasst. Kein neues Ticket. |
| **0005 Auslieferungsform** | ⚠️ **fragwürdig** | **Die Datei `docs/adr/0005-auslieferungsform.md` existiert nicht**, obwohl arc42 §9 und `ticket-reihenfolge.md` sie als „ergebnisoffen gehalten" führen. Inhaltlich ist die Entscheidung längst nicht mehr neutral (0006 hat Single-File-Offline zur größen-abhängigen Option herabgestuft, während 0001/CLAUDE.md/README sie als _primäres_ Format behandeln) — es fehlt der Ort, der diesen Widerspruch auflöst. Genau der Drift, den das Projekt sonst maschinell bekämpft. → **#606** (mittel). |
| 0006 Backend & Skalierung | ✅ vorbildlich | Der stärkste ADR im Set. Kein Ticket (offener Rest = #606). |
| 0007 Spielsystem-Fundamente | ✅ ja | Umgesetzt, teils übererfüllt. Einzige offene Grundsatzfrage: NPC-Routinen/Item-Crafting — bereits als **#420/#421** (`Scope-Klaerung noetig`) ticketiert. Kein neues Ticket. |
| 0008 KI-Agenten-Harness | ⚠️ bedingt | Ehrlich (nennt die Post-hoc-Lücke selbst). Der Re-Eval-Trigger koppelt die serverseitige Absicherung aber an _fremde Beitragende_, obwohl sie an _parallele unzuverlässige Ausführende_ gehört — die Lücke besteht schon heute solo. Präzisierung inline bei #592, kein eigenes Ticket. |

**Neues Ticket aus der ADR-Runde:** **#606** (ADR 0005 anlegen).

## 2) DDD / iSAQB — Code

Die Bounded Contexts (Sim/Cluster-Domäne, Content/Lernpfad, Welt/Präsentation, Persistenz, Wirtschaft) sind sauber getrennt, die Aggregat-Disziplin aus Runde 1/2 skaliert. Die neuen Befunde sind SSOT-„letzte Meile" und Validierungs-Asymmetrie.

| Befund | Schwere | Ticket |
|---|---|---|
| **`_resetNodes` umgeht das Node-Aggregat** (`sim.ts:278`, `Object.assign({}, n)`) — der unreparierte Zwilling zu #577, das nur den _Merge_-Pfad auf `provisionNode` umstellte. Ein Szenario mit `nodes:[{name:"x"}]` erzeugt beim `reset()` einen strukturell illegalen `ClusterNode`. Der eine echte latente Bug der Runde. | **hoch** | **#596** |
| StatefulSet-Ordinal-Invariante prüft Menge statt Position (`invariants.ts:160-175`, Set-Vergleich) → schwächer als der eigene Doc-Kommentar behauptet; fängt eine künftige Ordinal-Regression nicht. | mittel | **#599** |
| **Entity-Registry hat keine inhaltliche Validierung** (`entities.ts` fehlt in `validateContent`/`ContentBundle`) → NPC-Standplatz auf unbekannter Map/ID fällt durch keine Prüfung. Gleiche Asymmetrie, die #582 für den SHOP schloss, andere Sammlung. | mittel | **#600** |
| Bewegungs-Loop 3× dupliziert über WorldScene/RegionScene/InteriorScene `update()` — #564 fasste nur den _Input_ zusammen, die _Anwendung_ ist byte-gleich kopiert. | mittel | **#601** |
| Tile-Größe doppelt definiert: `scenes/shared.ts:14` `T=16` vs. `world.ts:12` `TILE=16` (SSOT-Verletzung, nicht von #590 abgedeckt). | niedrig | **#607** |
| Ubiquitous-Language-Leak: Hafen-Wörter in Sim-Fehlertexten (`inspect.ts:316/:341`) vs. Glossar-Behauptung „Übersetzung an nur 2 Stellen". | niedrig | **#608** |
| RBAC-Identität ungeklärt: Merge dedupliziert über `(name,cluster)`, Invariante prüft nur `name` — der konzeptuelle Kern hinter #578. | niedrig | **#609** |

**Vorbildlich (unverändert lassen):** Die Aggregat-Grenze an `exec()` mit `assertClusterInvariants`, die Host-Interfaces per `Pick<…>` (ISP), die Zweiteilung struktureller Loader ↔ referenzieller Validator, der Zyklus-Brecher `parse.ts`/`runtime.ts`.

## 3) Tests — die Funktionstest-Frage

Die Sim-Domäne wird durchweg **verhaltensbasiert** über `sim.exec("…")` getestet (Ausgabe statt Interna), die Arc- und Invarianten-Tests haben echte Zähne (Gegenproben), der `learnorder`-Wächter ist genau das gewünschte didaktische Netz auf **struktureller** Ebene. Die neue Lücke ist die **inhaltlich-fachliche** Ebene:

| Befund | Schwere | Ticket |
|---|---|---|
| **Kein Schutz gegen fachlich falsche Quiz-Antwort.** Alle Quiz-Tests prüfen nur Index-Bereich/nicht-leere `explain`/Keyword-Vorkommen, **nie**, dass der `correct`-Index fachlich stimmt oder `explain` die markierte Option begründet. Ein vertauschtes `correct` lehrt still falsches K8s und bleibt grün. | **hoch** | **#597** |
| **Kein Distraktor-Wächter.** Nichts prüft, dass die _falschen_ Optionen einer Krabben-Quiz-Karte auch wirklich falsch/unterscheidbar sind (zwei plausible Lösungen / triviale Distraktoren rutschen durch; `content.test.ts:356` deckt nur Quest-`choice`-Steps ab). | **hoch** | **#598** |
| Kein e2e-Test eines echten Lern-Loops über die UI (Quiz beantworten + Drill lösen); `interaction.spec.ts:69` spielt nur das Onboarding, der Voll-Durchspiel-Test läuft nur gegen die Sim-Domäne. | mittel | **#602** |
| Kein systematischer Negativ-Durchspiel: `quests.test.ts` spielt nur die Musterlösung; ein zu weiter `accept`-Regex, der auch Falscheingaben durchwinkt, fällt nicht auf. | mittel | **#603** |

*(Die von Runde 2 erfasste a11y-`region`-Ausnahme = #560; der Determinismus-Scope in `spaced-repetition.ts` = #591, hier auf mittel gehoben.)*

## 4) Harness / Governance — Regressions-Matrix

Katharinas Kernfrage: **Verhindern die Guards, dass das Aufgeräumte wiederkehrt?** Antwort je Problemklasse:

| # | Problemklasse | Status | Gegated durch | Lücke |
|---|---|---|---|---|
| 1 | SSOT-Verletzung / Duplikation | ⚠️ teilweise | rng: hart (ESLint + `test/rng.test.ts`). Aggregat-Umgehung: **nur indirekt** (Invariant wirft bei illegalem State) + Review. | **Kein Copy-Paste-Detektor** — #596 wäre ohne den Invariant durchgerutscht. → **#612** (weiches jscpd-Gate). |
| 2 | God-Files (800 LOC) | ✅ hart | `check:size` + `test/filesize.test.ts`, Ratchet + stale-Meldung. | — |
| 3 | Funktions-Komplexität | ✅ hart | ESLint Block 4 + `test/complexity-gate.test.ts`, Baseline `{}`. | — |
| 4 | Determinismus (kein `Math.random`) | ⚠️ teilweise | Hart für `src/sim/**` + `src/content/**`. | Scope schmaler als Anspruch: `game/spaced-repetition.ts` nutzt `Math.random`. → **#591** (auf mittel gehoben). |
| 5 | Schichtverletzung | ✅ hart | `.dependency-cruiser.cjs` (Negativ-Regel wächst mit) + `test/layering.test.ts`. | — |
| 6 | Import-Zyklen / Orphans | ✅ hart | dependency-cruiser (`tsPreCompilationDeps`). | — |
| 7 | Save-Migration | ✅ hart | `test/savemigration.test.ts` — v1–v6-Fixtures, Version-Bump ohne Fixture bricht rot. | — (stärkstes Netz im Repo) |
| 8 | Bundle-Byte-Budget | ✅ hart | `check:bundle` + `test/bundle.test.ts`, CI nach Builds. | ⚠️ nur in `verify:full`/CI, nicht in `verify`/pre-push. |
| 9 | Doku↔Code-Drift (Landkarte) | ✅ hart (Struktur) | `check:docmap`/`check:docdrift` + Tests. | ⚠️ prüft Struktur, **nicht inhaltliche Aktualität** (agent-harness.md nennt #492 fälschlich „offen"). → **#610**. |
| 10 | Lernreihenfolge / Content-Struktur | ✅ hart | `learnorder`/`content`/`quests`/`schema-drift`-Tests. | Inhaltlich-fachliche Ebene ungedeckt → #597/#598 (Kap. 3). |
| 11 | Diff-Größe (reviewbare Slices) | ⚠️ teilweise | `check:diffsize` + Test, Override mit Pflicht-Begründung. | **Beißt nur im pre-push-Hook**, degradiert im flachen CI zu grün → Kern von #592. |

**Bilanz: 6× ✅ hart · 5× ⚠️ teilweise · 0× ❌ reine Disziplin.** Für strukturelle Regressionen ist der Harness vibe-coding-fest. Die ⚠️ clustern in zwei Themen: **Durchsetzung statt Definition** (8/11/#592) und **die drei nur indirekt/schmal gegateten Klassen** (SSOT-Duplikation, Determinismus-Scope, `any`-Suppressions).

Wo ein autonomer Agent den Harness heute legal umgehen kann: `git push --no-verify` (kein serverseitiges Netz), Hook nicht verdrahtet im frischen Worktree ohne `npm run setup`, `KQ_DIFFSIZE_OVERRIDE` mit selbst erfundener Begründung, **`eslint-disable no-explicit-any` ohne Budget-Deckel** (→ #604), Coverage/Bundle/Smoke nur post-hoc in CI.

| Befund | Schwere | Ticket |
|---|---|---|
| Gate-Durchsetzung lokal + per `--no-verify` umgehbar; `check:diffsize` serverseitig faktisch nie durchgesetzt. Die eine Antwort auf „vibe-coding-fest?". | **hoch** | **#592** (angehoben) |
| Ergänzend: CI-Job auf `push:[main]` (fetch-depth 0) fährt `verify` post-hoc nach + alarmiert bei Rot — schließt die Lücke, ohne den Direkt-Push-Workflow zu brechen. | mittel | **#605** |
| Suppression-Budget-Guard für `eslint-disable no-explicit-any` (Ratchet analog Komplexitäts-Gate) — sonst ist der `any`-Error pro Zeile aushebelbar. | mittel | **#604** |
| Determinismus-Guard auf `game/**` ausweiten. | mittel | **#591** (angehoben) |
| Doku-Aktualitäts-Guard (als „offen" dokumentierte Harness-Tickets gegen `gh`-Status). | niedrig | **#610** |
| Windows-Worktree-Cleanup-Regel aus dem Agenten-Memory in die Repo-SSOT (AGENTS.md) heben. | niedrig | **#611** |
| Optionaler jscpd-Duplikations-Detektor (weiches CI-Artefakt). | niedrig | **#612** |
| Lockfile-Sync-Guard = bereits **#593**; tsconfig-Target = **#594**; Phaser-vendor-Gate = **#595**. | niedrig | (bestehend) |

**AGENTS.md-Klarheit:** sehr gut — Worktree-Kollision, `--limit`-Falle und `node_modules`-Junction sind explizit adressiert. Einzige Lücke: die Windows-Cleanup-Falle lebt nur im Agenten-Memory (→ #611).

## Priorisierung (Kurzfassung)

- **HOCH (#596 · #597 · #598 · #592):** der `_resetNodes`-Aggregat-Bug, die beiden Quiz-Korrektheits-Wächter (didaktisch zentral), die serverseitige Gate-Durchsetzung. Die einzigen Befunde mit Bug- bzw. Projektziel-Relevanz.
- **MITTEL (#599 · #600 · #601 · #602 · #603 · #604 · #605 · #606 · #591):** Invarianten-Präzision, Entity-Validierung, Bewegungs-Dedup, echter Lern-Loop-Smoke, Negativ-Durchspiel, `any`-Budget, CI-Post-hoc-Netz, ADR 0005, Determinismus-Scope.
- **NIEDRIG (#607 · #608 · #609 · #610 · #611 · #612):** SSOT-/Sprach-Feinschliff, RBAC-Identität, Doku-Aktualität, Windows-Cleanup-Doku, Duplikations-Detektor.

Einsortiert in [ticket-reihenfolge.md](ticket-reihenfolge.md) (Kopf) · Vorrunden: [Runde 2](architektur-analyse-2026-07-02-iSAQB.md) · [Runde 1](architektur-analyse-2026-07-iSAQB.md) · [arc42](arc42-architektur.md).

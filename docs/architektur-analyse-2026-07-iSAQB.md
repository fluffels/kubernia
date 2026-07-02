# KubeQuest — Architektur-Analyse 2026-07-01 (iSAQB, frische Code-Sicht)

> **Stand: 2026-07-01.** Diese Analyse wurde **bewusst ohne Rücksicht auf die bestehende Doku/ADRs** erstellt — fünf unabhängige Durchläufe (je eine Schicht) haben ausschließlich den echten Code mit der iSAQB-Brille bewertet (Modularität, Kopplung/Kohäsion, konzeptuelle Integrität, Testbarkeit, Fehlerbehandlung, Querschnittskonzepte, Governance). Ziel: KubeQuest zu einem **beispiellosen Vorzeigeprojekt für Code-Qualität** machen.
>
> Sie **ergänzt** die strukturierte Gesamtsicht [arc42-architektur.md](arc42-architektur.md) (die aus dieser Analyse aktualisiert wurde) und die ältere [architektur-analyse-2026-06.md](architektur-analyse-2026-06.md). Alle Befunde sind als Tickets **#492–#524** ticketiert und stehen im Kopf der [ticket-reihenfolge.md](ticket-reihenfolge.md).

## Gesamtverdikt

**Das Fundament ist überdurchschnittlich stark und wird nicht in Frage gestellt.** Die strikte, per `dependency-cruiser` **erzwungene** Schichtung (Phaser-/DOM-freie Domäne, keine Zyklen, keine Orphans), Content-as-Data mit deklarativer Check-DSL, versionierte Persistenz mit Backup-vor-Migration und Roundtrip-Fixpunkt-Test, `strict` TypeScript, ESLint mit `no-explicit-any`/`no-floating-promises` als Error, und die Fitness-Functions (Layering/Filesize/Docmap) als CI-Gates — das ist taktisches DDD und Architektur-Governance auf einem Niveau, das die meisten Produktivprojekte nicht erreichen.

**Der rote Faden aller Befunde:** KubeQuest hat **strukturelle** Qualität exzellent mechanisiert, aber

1. **verhaltensbezogene Governance fehlt** (Determinismus, Coverage, Komplexität, Bundle-Größe, Fehlerdiagnostik sind nicht als Gate abgesichert — obwohl die Infrastruktur dafür je zur Hälfte schon existiert), und
2. **es gibt einzelne, klar benennbare Grenzen, an denen die sonst konsequente Disziplin aufhört** — und genau dort sitzen die riskantesten Befunde: das `scenario`-Feld (ungeprüft), der `importData`-Pfad (umgeht Migration), der `WorldSceneLike`-Seam (`any`), der `Math.random` in der Domäne (widerspricht dem eigenen Determinismus-Anspruch).

Keiner der Befunde verlangt einen Umbau. Es ist **Präzisierung und Absicherung** dessen, was das Projekt bereits richtig anlegt.

## Methodik

| Durchlauf | Scope |
|---|---|
| Domäne/Sim | `src/sim.ts`, `src/sim/**`, Tests `test/sim/**` |
| Content/Daten | `src/content.ts`, `src/content/**`, `data/**`, Content-Tests |
| Anwendung/Persistenz | `src/game.ts`, `src/game/**`, `src/store.ts`, `src/types.ts`, Save-Fixtures |
| Präsentation | `src/scenes/**`, `src/ui/**`, `src/sfx.ts`, `src/main.ts`, e2e |
| Querschnitt/Governance | Build, CI, ESLint/tsconfig/dependency-cruiser, Tests, devcontainer |

## Befunde nach Schichten

### Domäne / Simulator (`src/sim/*`)

| Befund | Schwere | Ticket |
|---|---|---|
| `Math.random()` in 8 puren Domänen-Dateien — widerspricht dem Determinismus-Anspruch (den `observability.ts` per FNV-Hash vormacht); blockiert Snapshot-/Golden-Tests. **Von zwei Durchläufen unabhängig als Top-Befund bestätigt.** | hoch | #492 |
| `reset`/`mergeScenario`/`snapshot` sind drei ~70-Zeilen-Triplikate + `kubectlApply` ist ein ~300-Zeilen-Monolith → neue Ressource = 6 Stellen anfassen. Größter Wartungs-Hebel. | mittel | #499 |
| DNS-1123-Value-Object nur an `kubectl create` verdrahtet; `expose`/`helm install`/`apply`/Fabriken umgehen es. Der Typ `PodName` verspricht eine Garantie, die real kaum existiert. | mittel | #507 |
| Workload-Aggregat-Helfer (`workload.ts`) werden umgangen (`helm uninstall`, StatefulSets roh gemutiert); StatefulSets haben gar keine Helfer. | mittel | #508 |
| Invarianten-Lücken: keine Namens-Eindeutigkeit, keine referenzielle Integrität, toter „STS-Namensregel siehe unten"-Verweis. | mittel | #509 |
| Host-Seam inkonsistent: `extends ClusterState` (Leaky) vs. schmale Interfaces (ISP-konform). | niedrig | #516 |
| Duplizierung: 4× clusterIP, keine `makeService`-Fabrik, 6× Ref-Parsing, 13× Delete-Block. | niedrig | #518 |

**Vorbildlich (unverändert lassen):** die deterministische Observability (FNV-Hash), zyklenfreies Layering mit type-only-Barrel, die einheitliche `_err`-Fehlerstrategie mit zentraler Aggregat-Grenze in `exec()`, der schlanke `kubectlCommand`/`gitCommand`-Dispatch.

### Content / Daten (`src/content/*`)

| Befund | Schwere | Ticket |
|---|---|---|
| `scenario`/`applyEffects` werden per `as`-Cast **ungeprüft** durchgereicht — die Validierung hört am fehleranfälligsten Feld auf. | hoch | #494 |
| Kein maschineller Schema-Drift-Wächter JSON ↔ TS-Typen (~13k Zeilen JSON als `unknown` geladen). | mittel | #498 |
| `manifests.ts` wird von **keiner Quest** genutzt; dieselben YAMLs sind in die Quest-JSONs hand-kopiert → zwei Wahrheiten. | mittel | #514 |
| `loader.ts` (759 LOC): fünffaches Loader-Quartett → generischer Helfer + Barrel-Split. | niedrig | #517 |
| Typ-Duplikate: `QuizCard`/`CmdCard` in loader **und** validate (bereits divergent); `entities.ts` dupliziert `parse.ts`-Primitiven. | niedrig | #519 |
| `PRACTICE` als großes Objekt-Literal im Code (letzter Content-as-Data-Rest). | niedrig | #521 |
| Check-DSL-Testlücke: Top-Level-`includes`-Regel ungetestet. | niedrig | #522 |

**Vorbildlich:** deklarative Check-DSL mit geschlossener Allowlist (nur **ein** echter Code-Sonderfall), Fail-fast mit pfad-lokalisierten Fehlern, Lazy-Memoisierung.

### Anwendung / Persistenz (`src/game/*`, `src/store.ts`)

| Befund | Schwere | Ticket |
|---|---|---|
| `importData` umgeht Migrationskette + `sanitizeState` und schreibt via `write()` **hüllenlos** (statt `writeState()`). Direkter „Save-nie-brechen"-Verstoß am Wiederherstellungspfad; kein Test. | hoch | #493 |
| Fehlgeschlagener `save()` (Rückgabewert ignoriert) ist für den Spieler unsichtbar → stiller Fortschrittsverlust im localStorage-Fallback. | mittel | #497 |
| Save-Versioning ohne echte SSOT: No-op-Migrationskette **+** feldbasierte Ableitung in Sanitize; trägt nur additive Änderungen. | mittel | #510 |
| `sanitizeState` unvollständig: `stats` ungeprüft (neg/float), `questStep`/`taskIdx` nicht gegen den Content geklemmt. | mittel | #511 |
| `GameSelf: [key:string]:any` opfert die Typprüfung an den Bündelgrenzen; reine Funktionen schwer isoliert testbar. | mittel | #513 |
| `store.ts` (695 LOC) bündelt vier Verantwortlichkeiten → Schnitt nach `game/*`-Muster. | niedrig | #515 |
| `GameState`: vierfach redundanter Quest-Fortschritt (Sync-Last), fehlende `LeitnerEntry`/`Position`-Typen. | niedrig | #520 |

**Vorbildlich:** Sanitize-Härtung mit Red-Green-Korrupt-Fixture, Backup-vor-Migration, Roundtrip-Fixpunkt-Test (v1–v5), IndexedDB-Fehlertoleranz („wirft nie") mit sync-Cache.

### Präsentation (`src/scenes/*`, `src/ui/*`)

| Befund | Schwere | Ticket |
|---|---|---|
| `WorldSceneLike = [key:string]:any` — alle sechs Systemmodule sind komplett ungetypt (~50 Felder × 6 Module). Größter Typsicherheits-Hebel. | hoch | #496 |
| Spiel-/Bewertungslogik steckt in `innerHTML`-Methoden (`termSubmit`, `finishReviewItem`, `talkTo`) → nur e2e-, nicht unit-testbar. | mittel | #500 |
| `economyTick` läuft **nur** in `WorldScene.update()`, nicht in `RegionScene` → passives Einkommen/Uhr/Events pausieren in Nachbar-Regionen (latenter Konsistenz-Bug, verifiziert). | mittel | #501 |
| Overlay-ID-Liste 4× hartkodiert (bereits divergent), kein Modal-Konzept. | mittel | #505 |
| `events.ts` (spielentscheidend: Belohnung/Strafe) hat **0 Tests**, Logik an Phaser gebunden. | mittel | #512 |
| Kein Fokus-Management/keine Fokusfalle, ARIA lückenhaft (keine `role=dialog`/`aria-live`). | mittel | #506 |
| `syncCluster` ungedrosselt O(Pods)/Frame + fixe 36 Pod-Slots. | niedrig | #523 |

**Vorbildlich:** die reinen, unit-getesteten Kerne (`overlaykbd`, `cull`/`selectVisibleTags`, `warps`, `labellayout`), zentrale Event-Delegation, der `#416`-Render-Pool, `RegionScene`/`REGION_CONFIGS` als datengetriebener Ersatz für drei Copy-Paste-Klassen.

### Querschnitt / Governance

| Befund | Schwere | Ticket |
|---|---|---|
| Kein zentrales Zufalls-/Determinismus-Konzept (siehe #492) + keine Fitness-Function, die `Math.random` in Domäne/Content verbietet. | hoch | #492 |
| Coverage wird **nirgends gemessen**, kein Coverage-Gate (91 Testdateien, aber abgedeckter Anteil unbekannt). | hoch | #495 |
| Governance deckelt nur LOC, misst keine zyklomatische Komplexität/Kohäsion (`kubectlApply` ist die eigentliche God-Function). | mittel | #502 |
| Kein Bundle-Size-Budget als Gate (nur `chunkSizeWarningLimit`-Warnung; Offline-Build inlined alle Assets). | mittel | #503 |
| Keine zentrale Fehlerbehandlungs-/Diagnostik-Strategie (kein `window.onerror`/Fallback-Overlay). | mittel | #504 |
| Kein FPS-/A11y-Smoke, obwohl `FpsMeter` existiert. | niedrig | #524 |

**Vorbildlich:** CI fährt wirklich alle Gates (test/typecheck/lint/arch/size/docmap/beide Builds/Boot-Smoke, reproduzierbar via `npm ci` + `.nvmrc`), zweistufiges `npm audit`-Gate + Dependabot mit Grouping, alle drei Build-Modi getestet, Fitness-Functions selbst red-green-abgesichert.

> **i18n (Deutsch fest verdrahtet):** bewusste, konsistent umgesetzte Randbedingung — **kein Ticket**, aber als Trade-off in arc42 §11 explizit benannt. Content-Strings sind bereits als Daten separiert; der teure Rest wären die im Code verstreuten Domänen-Strings (`clock.ts`, `hud/markup.ts`).

## Priorisierung (Kurzfassung)

- **HOCH (#492–#496):** Determinismus/RNG-Gate · `importData`-Save-Loch · `scenario`-Validierung · Coverage-Gate · `WorldSceneLike`-Typsicherheit. Das sind die echten Bugs/Verstöße + die zwei wichtigsten fehlenden Gates.
- **MITTEL (#497–#514):** Struktur- und Testbarkeits-Präzisierung (Registry-Muster, Logik aus DOM/Szene lösen, VO/Invarianten/Workload, Komplexitäts-/Bundle-/Fehler-Gates, Overlay-/Fokus-Konzept).
- **NIEDRIG (#515–#524):** Duplizierung einsammeln, God-Files schneiden, Typmodell schärfen, letzte Test-/Content-Lücken.

Alle 33 Tickets stehen als Block im Kopf der [ticket-reihenfolge.md](ticket-reihenfolge.md).

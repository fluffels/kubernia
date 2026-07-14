# Kubernia — unabhängige iSAQB-Architektur-Analyse (2026-07-14)

> **Auftrag:** Alle bisherigen ADRs, Analysen und Entscheidungen bewusst **ignorieren**, die Architektur aus dem **echten Code** neu und **sehr kritisch** bewerten („was da ist, kann falsch sein"), dann mit dem Doku-Stand abgleichen. Diese Datei ist die vierte doku-freie Runde und ergänzt die frühere [architektur-analyse-2026-07-iSAQB.md](architektur-analyse-2026-07-iSAQB.md).
>
> **Methode:** Fünf unabhängige Schicht-Durchläufe am Code (sim · world/scenes/game · ui/hud · store/content · build/CI/tooling), plus gezielte Verifikation der harten Doku-Behauptungen (Determinismus, Coverage, Schichtung, `any`-Disziplin, Release-Pfad) gegen die Realität. Alle Befunde sind mit Datei:Zeile belegt.

## Gesamtverdikt (ehrlich)

Kubernia ist **außergewöhnlich diszipliniert** gepflegt — deutlich über dem Niveau eines Hobby-Spiels. Die harten Doku-Behauptungen halten der Prüfung stand: Schichtung ist per `dependency-cruiser` als CI-Gate **wirklich** erzwungen, die pure Domäne ist Phaser-frei und `Math.random`-frei (instanz-eigener PRNG), es gibt nur **4** getrackte `any`-Suppressions, Coverage wird **pro Schicht** gemessen, ein einziges TODO im ganzen `src/`. Das Fitness-Function-Framework (Zyklen-/Orphan-/Größen-/Doku-Drift-Wächter mit Ratchet + Stale-Meldung) ist vorbildlich.

**Die strategischen Kern-Entscheidungen sind unter unabhängiger Prüfung richtig.** Es gibt aus dieser Analyse **keinen Grund, eine der zentralen ADRs (0001 Phaser, 0002 kein Backend, 0003 kein Multiplayer, 0004 Skalierungs-Fundament, 0005/0006 Auslieferung/Backend, 0007 Spielsystem) umzukehren.** Die Angst „das kann alles falsch sein" bestätigt sich für die großen Weichen **nicht** — sie sind sauber begründet, mit Re-Eval-Triggern versehen und halten dem Stresstest stand.

**Aber:** Eine kritische Neubewertung findet drei Dinge, die die bisherigen vier Analysen entweder **wegdefiniert** oder **übersehen** haben:

1. **Die Disziplin endet an der Präsentationsgrenze.** Domäne + Persistenz sind exzellent; `scenes/`+`ui/` (~7000 LOC, die größte Codemenge eines wachsenden Spiels) tragen fast die gesamte technische Schuld und hängen im schwächsten Test-Netz (Coverage-Floor 3 %).
2. **Mehrere „erledigt/erzwungen"-Claims der Doku sind in Wahrheit gedriftet** — sie beschreiben einen Anspruch, nicht den Code.
3. **Der Anspruch „Stardew-Scope trägt" ist in der Domäne vorbereitet, in der Karten-/Szenen-/NPC-Schicht aber noch nicht eingelöst.**

19 konkrete Befunde → Tickets #861–865, #867–880. Kein Umbau der Fundamente, sondern **Absicherung + Einlösung** des richtig Angelegten.

---

## Teil A — Was unter unabhängiger Prüfung trägt (bewusst zuerst)

| Behauptung der Doku | Verifikation | Urteil |
|---|---|---|
| Schichtung erzwungen (Domäne kein Phaser/Präsentation) | `dependency-cruiser` mit `tsPreCompilationDeps` (echter Graph), SSOT `scripts/layers.cjs`, CI-Gate | **hält** |
| Kein `Math.random` in Domäne/Anwendung | ESLint `no-restricted-properties` greift real; Sim nutzt instanz-eigenen PRNG (`sim.ts:194`) | **hält** |
| `strict` durchgängig, `any` diszipliniert | `strict:true` global; nur 4 Suppressions (`any-suppressions.json`), Ratchet | **hält** |
| Content-as-Data, nicht hartcodiert | JSON unter `content/data/` + `import.meta.glob(eager)` + Laufzeit-Validator ohne Fremd-Lib | **hält** |
| Versionierte Persistenz, Save bricht nie | `{v,data}`-Hülle, Migrationskette (v9), Backup-vor-Überschreiben, Fixtures erzwungen | **hält (robust, aber manuell)** |
| Host-Interfaces statt God-Objekt-Durchreichung | 12 `Pick<ClusterState,…>`-Interfaces (ISP), brechen Zyklen ehrlich | **hält** |
| Fitness-Functions als KI-Leitplanken | dichtes, getestetes Wächter-Netz (size/diffsize/bundle/docmap/docdrift/lockfile/arch) | **hält, überdurchschnittlich** |

Die **Befehls**-Dimension des Simulators skaliert echt (reine Handler-Tabellen: ein neues Kommando = ein Tabelleneintrag). Das ist Stardew-tauglich gebaut.

---

## Teil B — Wo die Doku driftet („das kann falsch sein" — hier stimmt es)

Diese Punkte sind der Kern des Auftrags: Stellen, an denen die Doku einen Anspruch behauptet, den der Code **nicht (mehr) einlöst**.

| # | Drift | Beleg | Ticket |
|---|---|---|---|
| B1 | **Invarianten laufen nur in Dev/Test, nicht im Prod-Build.** arc42 §5/§8 feiert den Invarianten-Wächter als *den* Schutzmechanismus — im ausgelieferten Spiel ist er aus. | `sim.ts:235` `invariantChecks = !import.meta.env.PROD` | [#862](https://github.com/fluffels/kubernia/issues/862) |
| B2 | **ACL „nur an zwei Stellen" ist verletzt.** CLAUDE.md behauptet, die Hafen↔Sim-Übersetzung laufe nur über clustersync + markup. `ui/hud.ts` mappt Sim-interne Fehlertypen direkt in der Präsentation (dritter Leak). | `ui/hud.ts:320-327` | [#872](https://github.com/fluffels/kubernia/issues/872) |
| B3 | **Determinismus wird als weitgehend gelöst dargestellt**, aber die SSOT wird in der Präsentation umgangen: `shuffled()` nutzt `Math.random` für Quiz-Optionen/Dialog-Antworten. Lint erzwingt die RNG nur in Domäne+Anwendung. | `ui/shared.ts:68-75`, `ui/quiz.ts:149`, `ui/dialog.ts:71` | [#876](https://github.com/fluffels/kubernia/issues/876) |
| B4 | **Stale Ticket-Referenz im Code.** `check-size.mjs` führt den sim.ts-Split als „#545 (Split offen)" — #545 ist geschlossen (war „Dispatch-Tabellen"), der Split ist damit untracked. Genau die Drift, gegen die das Projekt sonst maschinell schützt (`check:doctickets` ist non-blocking und ließ es durch). | `scripts/check-size.mjs:39` | [#864](https://github.com/fluffels/kubernia/issues/864) / [#877](https://github.com/fluffels/kubernia/issues/877) |
| B5 | **`tsconfig.strict.json` ist ein No-op-Alias** (`{"extends":"./tsconfig.json"}`) — `typecheck` und `typecheck:strict` prüfen identisch; zwei IntelliJ-Run-Configs + eine CLAUDE.md-Zeile suggerieren einen Unterschied, den es nicht gibt. | `tsconfig.strict.json:12` | [#877](https://github.com/fluffels/kubernia/issues/877) |

---

## Teil C — Neue Risiken, die die bisherigen Analysen übersahen (priorisiert)

### Hoch

- **C1 — Release-Pipeline ohne Test-Gate + ohne Image-Security.** `release.yml` baut+pusht das ghcr-Image beim Tag ohne `verify`/Tests, ohne Trivy/Grype-Scan des nginx/alpine-Basisimages, ohne SBOM. Das **einzige nach außen gelieferte Artefakt** ist das am wenigsten abgesicherte. → [#861](https://github.com/fluffels/kubernia/issues/861)
- **C2 — WorldScene ist trotz `mapId`-Fassade hafen-monolithisch** (harbor-Objekte, `tfPlatform`-Sonderfall, Deko-Literale, payout-Koordinaten, Kralle per `splice(6)`). Die „datengetriebene zweite Überwelt" ist **nicht real**. → [#863](https://github.com/fluffels/kubernia/issues/863)
- **C3 — Ressourcentyp-Erweiterung ist nicht Open-Closed** (8–10 Touchpoints, 3× `reset/merge/snapshot` in `sim.ts`; sim.ts bleibt 959-LOC-God-File). Die Registry #499 entschärfte nur die trivialen Typen. → [#864](https://github.com/fluffels/kubernia/issues/864) + Test [#865](https://github.com/fluffels/kubernia/issues/865)

### Mittel

- **C4 — Monolithischer 5s-Vollserialisierungs-Autosave** (`main.ts:363` + `versioning.ts:298`): der ganze GameState wird alle 5 s als ein JSON-String neu serialisiert. Skaliert linear mit der Stand-Größe → CPU/GC-Bremse bei Stardew-Volumen. Die früheren Analysen fokussierten **Eviction/Kapazität** (ADR 0006) und übersahen die **Serialisierungs-Kosten**. → [#869](https://github.com/fluffels/kubernia/issues/869)
- **C5 — Zwei divergente Karten-Modelle** (Tiled-Daten für harbor vs. Code-Builder für Regionen) + zwei parallele `renderGround`-Wang-Autotile. → [#870](https://github.com/fluffels/kubernia/issues/870)
- **C6 — NPCs ohne Entitäts-/System-Modell** (Sprite+Tween+Marker; fragile `splice(6)`-Platzierung). → [#871](https://github.com/fluffels/kubernia/issues/871)
- **C7 — `broken.type` stringly-typed**, über 4+ Dateien ohne exhaustiveness. → [#867](https://github.com/fluffels/kubernia/issues/867)
- **C8 — ESLint nutzt `recommended` statt `recommendedTypeChecked`**: zahlt die Kosten des typed-lint, nutzt nur `no-floating-promises`; `no-unsafe-*`/`no-misused-promises` sind aus. → [#868](https://github.com/fluffels/kubernia/issues/868)
- **C9 — Copy-Paste der 6 Minispiele** (~1080 LOC) + dreifache Label-Quelle; jscpd ist bewusst zahnlos, fängt es nicht. Skalierungsversagen der UI im Kleinen. → [#873](https://github.com/fluffels/kubernia/issues/873)
- **C10 — Präsentation faktisch ungetestet** (Coverage-Floor 3 %, ~7 E2E-Smokes, nur Chromium). Größte Codemenge im schwächsten Netz — ohne verteidigenden ADR. → [#874](https://github.com/fluffels/kubernia/issues/874)
- **C11 — Fehlend: SAST/CodeQL + Secret-Scanning**; UI baut per `innerHTML` mit uneinheitlichem Escaping (XSS-Smell, heute autorenkontrolliert). → [#875](https://github.com/fluffels/kubernia/issues/875)

### Niedrig

- **C12 — Kein Größen-Gate auf `content/data/`** (`knut.json` = 1828 Z.). → [#878](https://github.com/fluffels/kubernia/issues/878)
- **C13 — Grab-bag-Module** (`world/world.ts`, `scenes/shared.ts`) + irreführender Ordnername `hud/` (ist die pure Logik-Schicht, kein HUD). → [#879](https://github.com/fluffels/kubernia/issues/879)
- **C14 — Save-Migration kennt Domänen-Semantik** (`versioning.ts:175-190` importiert Komfort-Kauf-Wissen aus der Anwendungsschicht). → [#880](https://github.com/fluffels/kubernia/issues/880)

### Verstecktes Querschnitts-Thema

`Game` als globales Singleton + `setWorldScene`-Registry + direkte `Game.sim`/`Game.state`-Zugriffe (29× in `scenes/`) + die `sleep/wake`-Lifecycle-Trilogie sind die zerbrechlichste Laufzeit-Kopplung. Kein eigenes Ticket (kein akuter Bug), aber der gemeinsame Nenner hinter C2/C5/C6: Die **Präsentations-/Laufzeit-Struktur** hat den Stardew-Anspruch noch nicht eingelöst, während die Domäne ihn vorbereitet hat.

---

## Teil D — Wo wird neu entschieden? (ADR-Abgleich)

**Keine Umkehr bestehender ADRs.** Unter unabhängiger Prüfung tragen alle strategischen Entscheidungen. Das ist das wichtigste ehrliche Ergebnis: die bisherigen Analysen lagen bei den großen Weichen **richtig**.

Neu — nicht als Widerspruch, sondern als **fehlende explizite Entscheidungen**:

| Neu-Entscheidung | Warum | Ticket |
|---|---|---|
| **ADR „Präsentations-Test-Strategie"** | Der 3 %-Coverage-Floor der Präsentation ist die größte Qualitätslücke, aber nirgends als bewusste, verteidigte Entscheidung dokumentiert — nur implizit in der Coverage-Config. „Phaser/DOM = untestbar" ist eine Behauptung, die einen ADR verdient (oder das Gegenargument: mehr reine `viewdecide`-Logik extrahieren + Cross-Browser-E2E). | [#874](https://github.com/fluffels/kubernia/issues/874) |
| **Präzisierung ADR 0004: Karten-Modell festlegen** | ADR 0004 nennt Content-as-Data/Entity-Registry als Skalierungs-Fundament, entscheidet aber nicht zwischen Tiled-Daten und Code-Builder-Karten. Bei 15+ Karten muss eines gewinnen. | [#870](https://github.com/fluffels/kubernia/issues/870) |
| **Invarianten-Politik im Prod-Build** | Bewusst entscheiden: billige Teilmenge auch in Prod (empfohlen) oder dokumentiert draußen lassen — heute ist es eine stille Default-Entscheidung. | [#862](https://github.com/fluffels/kubernia/issues/862) |
| **Supply-Chain-Härtung als Querschnittskonzept erweitern** | arc42 §8 nennt Supply-Chain „abgedeckt" — deckt aber nur npm-Deps, nicht das ausgelieferte Image/den eigenen Code. | [#861](https://github.com/fluffels/kubernia/issues/861), [#875](https://github.com/fluffels/kubernia/issues/875) |

---

## Ticket-Index (19 Befunde)

| Ticket | Kurz | Schwere |
|---|---|---|
| [#861](https://github.com/fluffels/kubernia/issues/861) | Release ohne Test-Gate + Image-Security | hoch |
| [#862](https://github.com/fluffels/kubernia/issues/862) | Invarianten auch im Prod-Build | hoch |
| [#863](https://github.com/fluffels/kubernia/issues/863) | WorldScene vom Hafen entkoppeln | hoch |
| [#864](https://github.com/fluffels/kubernia/issues/864) | sim.ts-Split re-tracken + Ressourcen-Registry | hoch |
| [#865](https://github.com/fluffels/kubernia/issues/865) | snapshot()-Round-Trip-Test | mittel |
| [#867](https://github.com/fluffels/kubernia/issues/867) | broken.type discriminated union | mittel |
| [#868](https://github.com/fluffels/kubernia/issues/868) | ESLint recommendedTypeChecked | mittel |
| [#869](https://github.com/fluffels/kubernia/issues/869) | Autosave Delta/Debounce | mittel |
| [#870](https://github.com/fluffels/kubernia/issues/870) | Karten-Modell vereinheitlichen | mittel |
| [#871](https://github.com/fluffels/kubernia/issues/871) | NPC-Entitäts-/System-Modell | mittel |
| [#872](https://github.com/fluffels/kubernia/issues/872) | ACL-Leck schließen | mittel |
| [#873](https://github.com/fluffels/kubernia/issues/873) | Minispiel-Harness + Registry | mittel |
| [#874](https://github.com/fluffels/kubernia/issues/874) | Präsentations-Test-Strategie (ADR) | mittel |
| [#875](https://github.com/fluffels/kubernia/issues/875) | SAST/CodeQL + Secret-Scanning | mittel |
| [#876](https://github.com/fluffels/kubernia/issues/876) | Determinismus-Leck Präsentation | niedrig |
| [#877](https://github.com/fluffels/kubernia/issues/877) | tsconfig.strict No-op + Drift-Fixes | niedrig |
| [#878](https://github.com/fluffels/kubernia/issues/878) | content/data/ Größen-Gate | niedrig |
| [#879](https://github.com/fluffels/kubernia/issues/879) | Grab-bag-Module entflechten | niedrig |
| [#880](https://github.com/fluffels/kubernia/issues/880) | Save-Migration von Domäne entkoppeln | niedrig |

> Dokumentiert unter [#881](https://github.com/fluffels/kubernia/issues/881). Die Risiken/Drifts sind in [arc42 §8/§10/§11](arc42-architektur.md) eingearbeitet.

# KubeQuest — Architektur-Analyse 2026-07-02 (iSAQB, frische Code-Sicht)

> **Stand: 2026-07-02.** Zweite vollständige iSAQB-Runde, **einen Tag nach** der ersten ([architektur-analyse-2026-07-iSAQB.md](architektur-analyse-2026-07-iSAQB.md)). Wieder **bewusst ohne Rücksicht auf Doku/ADRs**: fünf unabhängige Durchläufe (je eine Schicht) haben ausschließlich den echten Code mit der iSAQB-Brille bewertet (Modularität, Kopplung/Kohäsion, konzeptuelle Integrität, Testbarkeit, Fehlerbehandlung, Invarianten/Value-Objects, Querschnittskonzepte, Governance). Jeder Befund ist gegen die konkrete Datei:Zeile verifiziert.
>
> Alle Befunde sind als Tickets **#577–#595** ticketiert. Drei bereits offene Tickets decken weitere Befunde ab: **#539** (Coverage-Glob), **#540** (Hazard szenen-neutral), **#560** (Landmark-A11y).

## Gesamtverdikt

**Die erste iSAQB-Runde (#492–#524) ist praktisch vollständig abgearbeitet** — und das ist am Code sichtbar, nicht nur am Board: RNG-SSOT (`src/core/rng.ts`), Value Objects für Namen/Dublonen, Cluster-Invarianten an der `exec()`-Aggregat-Grenze, getippte Workload-/Node-Mutationen, DOM-freie Entscheidungskerne (`viewdecide.ts`/`hazards.ts`), szenen-neutraler `Game.tick`, Crash-Overlay, das volltypisierte `WorldSceneFields`-Muster (kein `WorldSceneLike:any` mehr), Coverage-/Komplexitäts-/Bundle-/Diffsize-/Doku-Drift-Gates plus FPS-/axe-Smokes. Das Fundament ist jetzt **außergewöhnlich** für ein Projekt dieser Größe.

**Der rote Faden der zweiten Runde ist darum eine Stufe subtiler.** Es gibt keine strukturellen Baustellen mehr; die verbleibenden Befunde clustern in vier wiederkehrende Muster:

1. **Die letzte Meile der eigenen SSOT.** Ein Konzept ist etabliert und fast überall durchgezogen — aber an genau *einer* Stelle wird es an seiner eigenen Quelle umgangen: `sim.ts` umgeht die Workload-/Node-Aggregate in den `_merge*`-Helfern (#577/#578), der szenen-neutrale Tick treibt die Kalender-*Daten*, aber nicht die Uhr-*Anzeige* (#588), das Determinismus-Gate deckt nur zwei der als „pur" deklarierten Verzeichnisse ab (#591).
2. **Die letzten `any`-Ränder.** Die großen `[key:string]:any`-Seams sind weg, aber `UISelf`/`GameSelf` verdecken noch löchrige Zustandstypen (#589) und ungetypte Save-/Content-Bündelgrenzen (#586/#581).
3. **Validierungs-Asymmetrie im Content.** Jede Content-Sammlung hat inhaltliche Invarianten — außer dem SHOP (#582), der zudem als einziger noch nicht Content-as-Data ist (#583).
4. **Durchsetzung vs. Definition der Gates.** Die Gates selbst sind exzellent; ihre *Durchsetzung* hängt bei Direkt-Push-auf-main aber am lokalen, per `--no-verify` umgehbaren Hook (#592).

Kein Umbau. Es ist Feinschliff an den letzten Kanten dessen, was das Projekt bereits richtig macht.

## Methodik

| Durchlauf | Scope |
|---|---|
| Domäne/Sim | `src/sim.ts`, `src/sim/**`, `src/core/**`, Tests `test/sim/**` |
| Content/Daten | `src/content.ts`, `src/content/**`, `src/content/data/**`, Content-Tests |
| Anwendung/Persistenz | `src/game.ts`, `src/game/**`, `src/store.ts`, `src/store/**`, `src/types.ts`, Save-Fixtures |
| Präsentation | `src/scenes/**`, `src/ui/**`, `src/hud/**`, `src/world/**`, `src/sfx.ts`, `src/main.ts`, `src/crashreport.ts`, e2e |
| Querschnitt/Governance | Build, CI, ESLint/tsconfig/dependency-cruiser, `scripts/**`, Tests, devcontainer |

## Befunde nach Schichten

### Domäne / Simulator (`src/sim/*`, `src/core/*`)

| Befund | Schwere | Ticket |
|---|---|---|
| `sim.ts` umgeht die eigene Workload-/Node-Aggregat-SSOT: `_mergeNodes` pusht rohes `Object.assign({}, n)` statt `provisionNode` (`sim.ts:627`) → Szenario-Node ohne `status/roles/version` = **strukturell illegaler ClusterNode** (latenter Bug). Dazu `_mergeDeployments`/`_mergeStatefulAndBackups` (`:646`/`:697`) und `_makeStatefulSet` (`:496`) am Aggregat vorbei. | mittel | #577 |
| Namens-Eindeutigkeits-Merge dedupliziert Roles/RoleBindings über `name && cluster` (`sim.ts:662/:665`), die Invariante prüft aber nur `name` (`invariants.ts:108-109`) → Role + ClusterRole gleichen Namens sind im Merge erlaubt, verletzen aber die Invariante → `ClusterInvariantError` im Dev/Test-Build (enger latenter Bug). | niedrig | #578 |
| `randSuffix` zieht aus dem globalen RNG-Strom (`util.ts:16-21`), Konstruktor/`reset()` seeden ihn nicht → Determinismus nur pro Prozess-Reihenfolge, zwei `Sim`-Instanzen teilen den Strom (PV-/Pod-Namen instanz-übergreifend gekoppelt). | niedrig | #580 |
| `coins.add` brandet `(balance + amount) as Coins` ohne Regel-Reassertion (`coins.ts:63-65`) — einzige Fabrik der Datei ohne die VO-Prüfung. | niedrig | #579 |

**Vorbildlich (unverändert lassen):** Die Aggregat-Disziplin skaliert — *alle* Befehlsfamilien (kubectl/helm/argocd/glab/terraform/kubeadm) mutieren Workload/Nodes nur noch über `scaleDeployment`/`addDeployment`/`provisionNode` etc. `invariants.ts` als datengetriebene Prüfer-Liste + `assertClusterInvariants` an der `exec()`-Transaktionsgrenze ist ein lehrbuchreifes fail-loud-Netz. Host-Interfaces per `Pick<ClusterState,…>` (ISP), deterministische RNG-SSOT, zentrale DNS-1123-Prüfung an den `_make*`-Fabriken.

### Content / Daten (`src/content/*`)

| Befund | Schwere | Ticket |
|---|---|---|
| SHOP-Pet/Flaggen-Items tragen `tex/type/price` (`progression.ts:27-40`), aber `validateShop` prüft nur ID-Eindeutigkeit (`validate.ts:89-95`) → ein vertippter `tex` fällt in **keinem** Check auf und gibt still den Phaser-Platzhalter (latenter Bug). Für NPCs ist die `tex`-Prüfung längst geschlossen — der SHOP ist die einzige Sammlung ohne inhaltliche Invariante. | mittel | #582 |
| `KQContent` ist nicht per `satisfies ContentBundle` an den Validator-Eingangstyp gebunden (`content.ts:20` vs. `validate.ts:45-56`) → hand-gepflegter Struktur-Spiegel, der still driften kann; anders als die vorbildliche `keyof Scenario`-Kopplung nebenan. | mittel | #581 |
| `RANKS`/`SHOP` (`progression.ts:9-41`) + `STACK_ROUNDS` (`minigame.ts:12-38`) sind weiterhin TS-Literale statt JSON — Content-as-Data hier (anders als NPCs/Quests/Practice #521) nicht durchgezogen. | niedrig | #583 |
| `resolveScenarioManifests` liest `manifests`/`files` ohne lokales `assertNoUnknownKeys` (`manifest-lib.ts:99-114`) → Fehlerpfad zeigt später auf `scenario.manifets` statt auf die Auflösung; dazu ein stale Trade-off-Kommentar in `validate.ts:18-32` (beschreibt den Vor-#348-Zustand). | niedrig | #584 |

**Vorbildlich:** Die Zweiteilung „struktureller Loader (fail-fast) ↔ referenzieller `validateContent`" ist sauber; `parse.ts` als abhängigkeitsfreies Leaf bricht den Zyklus; `assertNoUnknownKeys` schließt jede Objektform; **der Schema-Drift JSON↔TS ist an drei Stellen maschinell bewacht** (`schema-drift.test.ts` + `Record<keyof Scenario/ApplyEffect,…>` + `Record<QuestStep["type"],…>`). `reviveScenario` und die Check-DSL-Allowlist sind exemplarische „eine Wahrheit"-Kopplung.

### Anwendung / Persistenz (`src/game/*`, `src/store/*`)

| Befund | Schwere | Ticket |
|---|---|---|
| `reset()` (`save.ts:414`), `importData()` (`:432`) und `jumpToQuest()`→`save(false)` (`progression.ts:177`) werten den `writeState`-Rückgabewert **nicht** aus (anders als `save()`, `:392-398`) → ein gescheiterter Save (voller localStorage) verpufft ohne Spielerhinweis; `importData` gibt zudem kein Erfolgssignal zurück. Kein Bestands-Save-Bruch, aber stiller Fehlschlag. | niedrig | #585 |
| `sanitizeState` prüft `clusterSnapshot` nur per `isPlainObject` (`save.ts:288`), nicht die Sim-Form → letzter ungetypter `any`-Rand an der Save-Bündelgrenze (abgefangen erst durch `new KQSim(...)`, außerhalb dieser Schicht). | niedrig | #586 |
| `today()` verrechnet den Zeitzonen-Offset in die persistierte Leitner-Fälligkeit (`shared.ts:213-216`) → Zeitzonenwechsel verschiebt `due` um ±1 Tag (kosmetisch, kein Save-Bruch). | niedrig | #587 |

**Vorbildlich (unverändert lassen):** Die Save-Sicherheit ist konsequent — `sanitizeState` klemmt **jedes** Feld inkl. `stats`/`questStep`/`taskIdx` gegen den echten Content (die in Runde 1 vermuteten Lücken sind alle geschlossen), `resolveActiveQuests` erzwingt die Invariante „fokussierte Quest immer offen", `importData` läuft jetzt korrekt durch `migrateParsed → sanitizeState → writeState`. Backup-vor-Überschreiben + Roundtrip-Fixpunkt- und Fitness-Test geben „Saves nie brechen" echte Zähne; der synchrone Cache über async-IndexedDB (`flushIdb`/`pendingWrites`, #473) ist elegant und fehlertolerant.

### Präsentation (`src/scenes/*`, `src/ui/*`, `src/hud/*`)

| Befund | Schwere | Ticket |
|---|---|---|
| HUD-Uhr-*Anzeige* tickt nur in `WorldScene`: `WorldScene.ts:545` ruft `updateDayNight`→`UI.setClock`, `RegionScene`/`InteriorScene` nie → in Nachbar-Regionen/Interieur friert Datum/Uhrzeit im HUD ein (der Kalender-*Datenstand* läuft via `Game.tick` weiter). **Gleiche Bug-Klasse wie das alte economyTick-#501, nur fürs Uhr-Rendering.** | mittel | #588 |
| Die als Typ-Anker gedachten UI-Zustandstypen sind löchrig, verdeckt durch `UISelf:any`: `ActiveDialogue` deklariert kein `answered` (`ui.ts:25-31`, genutzt `dialog.ts:80`), `ActiveReview` weder `current` noch `order` (`quiz.ts:85/:149/:197`) → Tippfehler in `r.current.*` fällt erst zur Laufzeit auf. | mittel | #589 |
| Szenen-Geometrie/Hitbox-Radien verstreut: `NPC_HIT_R/ROCK_HIT_R/BUSH_HIT_R` (`WorldScene.ts:38-41`) vs. `HIT_R` (`RegionScene.ts:32`); `SLOTS_PER_PIER`/`TAG_CAP` lokal in `clustersync.ts` — keine Szenen-Konstanten-SSOT. | niedrig | #590 |
| Zufalls-Gefahren nutzen `Math.random()` (`events.ts:48/:50`) statt der RNG-SSOT; die `next*`-Terminierung hängt an `scene.time.now`, das beim `scene.sleep()` (Region-/Haus-Besuch) pausiert → Gefahren-Timing hinkt nach Region-Aufenthalten (verwandt mit #540). | niedrig | #591 / #540 |

**Vorbildlich:** Die #500/#512-Trennung ist überzeugend durchgezogen — `evaluateSubmission`/`scoreReview`/`resolveTalkTarget` und `resolveHazardTick`/`hazardStartable` kapseln die spielentscheidende Logik DOM-/Phaser-frei; `WorldScene implements WorldSceneFields` beseitigt das alte `any`-Index-Muster echt; das Overlay-Register (`overlays.ts`) ist eine glaubwürdige SSOT mit Anti-Drift-Test; `main.ts` splittet die Tastatur in kleine reine Handler; die A11y-Basis (role=dialog/alert/status, aria-modal, Fokusfalle) ist überdurchschnittlich.

### Querschnitt / Governance

| Befund | Schwere | Ticket |
|---|---|---|
| Die Gates sind exzellent, ihre **Durchsetzung** aber post-hoc + lokal umgehbar: `check:diffsize` degradiert im flachen CI-Checkout bewusst zu Grün (`check-diffsize.mjs:135-138`), CI triggert nur auf `push:[main]`/PR (`ci.yml:7-11`), main wird direkt gepusht → einziger Vorab-Riegel ist der per `--no-verify` umgehbare Hook; ein paralleler Agent kann auf noch-rotem main aufbauen. | mittel | #592 |
| Das Determinismus-Gate (`no-restricted-properties`) deckt nur `src/sim/**`+`src/content/**` ab (`eslint.config.js:128-141`), aber weitere als „pur/deterministisch" deklarierte Stellen nutzen `Math.random` (`events.ts`, `spaced-repetition.ts:119`, `world/decor.ts`) → Scope schmaler als der Anspruch. | niedrig | #591 |
| Kein Gate prüft den `package-lock.json`-Sync gegen `package.json` außerhalb von CI (`^`-Ranges durchgehend) → Lockfile-Drift fällt lokal vor Push nicht auf. | niedrig | #593 |
| `tsconfig` `target/lib: ES2020` bei `engines.node >=22` + `.nvmrc 22` → inkonsistent zur gepinnten Toolchain (kein Fehler, Browser ist Ziel). | niedrig | #594 |
| Host-`vendor`-Chunk (Phaser) ist bewusst aus dem Bundle-Budget ausgenommen (`check-bundle.mjs:81-92`); vite hat dort nur eine Warnung → ein Phaser-Bump fällt nur indirekt auf. | niedrig | #595 |

**Vorbildlich:** Die SSOT-Disziplin ist herausragend — Schicht-Grenzen leben *einmal* in `scripts/layers.cjs` und werden von dependency-cruiser, Docmap-Wächter und Coverage-Globs gleichzeitig konsumiert. Jedes Ratchet-Gate (size/diffsize/bundle/Coverage-Floors/Suppressions) trägt dieselbe „kein Grün durch Aufweichen"-Mechanik inkl. *stale*-Meldung; `verify-script`/`prepush-hook`/`complexity-gate`-Tests verhindern, dass ein Gate still aus der Kette fällt. **Die #502-Suppressions-Baseline ist auf `{}` heruntergefahren — jede neue God-Function blockt jetzt hart.** Zweistufiges `npm audit`-Gate + Dependabot-Grouping sauber gegen das #395-Antipattern kalibriert.

## Bereits ticketiert (nicht doppelt angelegt)

- **#539** — Coverage-Domänen-Glob verfehlt Top-Level-Dateien mit reserviertem Präfix (picomatch-Extglob-Präfixkollision, `layers.cjs:81`).
- **#540** — Hazard-Domäne von der WorldScene entkoppeln (deckt das Gefahren-Timing aus #591 mit ab).
- **#560** — fehlende Landmark-Regionen (axe `region` im a11y-Smoke global ausgeblendet).

## Priorisierung (Kurzfassung)

- **MITTEL / echte Bugs zuerst (#577 · #582 · #588 · #581 · #589 · #592):** die Aggregat-SSOT-Umgehung, der ungeprüfte SHOP-`tex`, die eingefrorene HUD-Uhr, die ungekoppelte Content-Bundle-Form, die löchrigen UI-Interfaces, die serverseitig fehlende Gate-Durchsetzung. Das sind die einzigen Befunde mit Verhaltens- oder Typsicherheits-Relevanz.
- **NIEDRIG (#578–#580 · #583–#587 · #590 · #591 · #593–#595):** enge Invarianten-/VO-Präzisierung, restliche `any`-Ränder, Content-as-Data-Konsequenz, Determinismus-Scope, Governance-Feinschliff.

Keiner der Befunde verlangt einen Umbau; alle sind session-groß und ratchetbar. → [architektur-analyse-2026-07-iSAQB.md](architektur-analyse-2026-07-iSAQB.md) (Runde 1) · [arc42-architektur.md](arc42-architektur.md) (strukturierte Gesamtsicht).

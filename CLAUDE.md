# CLAUDE.md – Einstieg für KI-Agenten

> **Du bist ein Agent in diesem Repo? Hier findest du auf einen Blick alles zum Loslegen.**
> Die **ausführliche Arbeitsanweisung** (harte Regeln, Board-Workflow, Konventionen) steht in **[AGENTS.md](AGENTS.md)** – diese Datei ist der schnelle Einstieg, der dorthin führt.
> Was das Spiel **ist** (Story, Steuerung, Lernpfad), steht in der **[README.md](README.md)** – die ist spielerseitig, nicht für dich als Agent.

> ⭐ **Oberste Regel vor JEDER Änderung:** „Ist das okay, wenn KubeQuest ein Spiel in **Stardew-Valley-Größe** wird?" Nur machen, wenn ja — diese Frage steht über allen ADRs/Konventionen. Was auffällt, aber gerade nicht dran ist → **Ticket anlegen**. Details: [AGENTS.md › Oberste Regel](AGENTS.md#-oberste-regel--über-allem-auch-über-den-adrs).

## ⚡ Schnellstart (in <1 Minute zum ersten Schritt)

```
1. npm run setup                            # einmalig: prüft Node, npm install, Tests+Typecheck+Arch-Check (oder nur npm install)
2. npm run dev                              # Dev-Server, angezeigte Adresse im Browser öffnen
3. docs/ticket-reihenfolge.md               # nächstes Ticket = oberstes freies aus dem KOPF; sonst Prio→Nummer (gh issue list --state open --limit 500, ohne --limit nur die 30 neuesten)
4. gh issue edit <nr> --add-assignee @me    # SOFORT claimen = "in Arbeit"-Marker, dann mit gh issue view <nr> prüfen
5. git worktree add .claude/worktrees/kq-<nr> -b feature/kq-<nr>-<slug>   # eigener Worktree, bevor du Dateien anfasst
6. coden                                    # im Worktree umsetzen, deutsche Umlaute in Texten/Kommentaren
7. npm test                                 # muss grün sein (auch Negativfälle abdecken, Red-Green)
8. npm run typecheck                        # muss grün sein (strict)
9. npm run lint                             # muss grün sein (ESLint, #389) – im Browser sichtbare Änderungen zusätzlich anschauen
10. nach main mergen → Worktree/Branch aufräumen → Issue schließen   # Details siehe AGENTS.md
```

⚠️ **Die rohe `index.html` im Root ist die Dev-Version** und braucht den Vite-Server. Per Doppelklick öffnen → leere Seite. Zum Offline-Spielen `npm run build:offline`, dann `dist-offline/index.html` doppelklicken.

## 🟢 Aus IntelliJ starten (Ein-Klick)

Im Repo liegen fertige npm-Run-Configs unter [`.idea/runConfigurations/`](.idea/runConfigurations/) – sie tauchen in IntelliJ/WebStorm automatisch oben rechts im Run-Auswahlmenü auf:

| Run-Config | macht | entspricht |
|---|---|---|
| **dev** | startet den Vite-Dev-Server; Browser über die angezeigte Adresse öffnen | `npm run dev` |
| **build** | Host-/Prod-Build nach `dist/` | `npm run build` |
| **test** | Vitest einmalig | `npm test` |
| **typecheck** | TypeScript prüfen (Standard-Config) | `npm run typecheck` |
| **typecheck:strict** | TypeScript voll strict prüfen (`tsconfig.strict.json`) | `npm run typecheck:strict` |

**Zum Entwickeln musst du nichts extra installieren** – nur einmalig `npm install`, dann Run-Config **dev** wählen und auf ▶ klicken; der Browser zeigt das Spiel über die im Run-Fenster angezeigte Adresse.

> Eine doppelklickbare Desktop-`.exe` (wie bei Stardew) ist ein **separates** Thema (#83 Tauri) und fürs Entwickeln **nicht** nötig.

## 🛠️ Befehle

| Zweck | Befehl |
|---|---|
| One-Command-Setup (Node-Check + install + Git-Hooks + alle Checks, #387/#528) | `npm run setup` |
| **Alle Gates auf einmal – das eine Kommando vor dem Merge (#527)** | `npm run verify` (typecheck → lint → check:arch → check:size → check:docmap → check:docdrift → check:diffsize → test) |
| Voller Vor-Push-Check inkl. beider Builds + Boot-Smoke (#527) | `npm run verify:full` (= `verify` + `test:coverage` + Builds + `check:bundle` + `test:smoke`) |
| pre-push-Hook (fährt `verify` vor Push auf main, #528) | verdrahtet via `npm run setup`; Umgehung: `git push --no-verify` |
| Erstinstallation | `npm install` |
| Dev-Server | `npm run dev` |
| Host-/Prod-Build (Multi-File nach `dist/`) | `npm run build` |
| Offline-Build (self-contained `dist-offline/index.html`) | `npm run build:offline` |
| Dev-Panel-Build (#331, Panel MIT, passwortgated, `dist-devpanel/`) | `npm run build:devpanel` |
| Tests | `npm test` (Vitest) |
| Coverage-Gate (v8, Schwellen PRO Schicht statt Repo-Mittel, #495) | `npm run test:coverage` |
| Boot-Smoke-Test (headless, gegen den Offline-Build, #391) | `npm run smoke` (baut Offline + Playwright) bzw. `npm run test:smoke` (nur Lauf, Build muss da sein) |
| Typen prüfen (voll strict) | `npm run typecheck` |
| Linter (ESLint, #389; Komplexitäts-Gates complexity/max-lines-per-function/max-depth #502) | `npm run lint` |
| Stale Komplexitäts-Suppressions prunen / Baseline neu aufbauen (#502) | `npm run lint:prune` / `npm run lint:suppress` |
| Architektur-Wächter (Schichtung + Zyklen + Orphans, #347/#390) | `npm run check:arch` |
| Dateigröße-Wächter (God-File-Budget 800 LOC, #390) | `npm run check:size` |
| Doku↔Code-Drift-Wächter (CLAUDE.md-Landkarte gegen den Code, #482) | `npm run check:docmap` |
| Harness-Drift-Wächter (dokumentierte `npm run`-Kommandos + interne Doku-Links/Anker, #529) | `npm run check:docdrift` |
| Diff-Größenbudget-Wächter (max. 20 Dateien / 800 geänderte Zeilen gegen main, #533) | `npm run check:diffsize` |
| Bundle-Byte-Budget-Wächter (Offline-HTML + Spielcode-Chunks, NACH den Builds, #503) | `npm run check:bundle` |
| Security-Audit (Produktiv-Deps, CI-Gate blockt bei high+, #396) | `npm audit --omit=dev --audit-level=high` |

> ⚠️ **Code-Änderungen laden im Dev-Server NICHT automatisch neu** (#301). Eine JS/TS-Änderung löst bewusst keinen Auto-Reload aus (der riss sonst mitten im Spielen laufende Gespräche weg + blaues Flackern, v.a. wenn parallele Agenten editieren). Stattdessen erscheint ein Toast „🔄 Code geändert – neu laden (F5)". Zum Übernehmen also **F5 / Seite neu laden** (Spielstand bleibt erhalten – seit #350 in IndexedDB). CSS-Edits swappen weiterhin live.

## 🗺️ Repo-Landkarte – wo finde ich was?

**Code** (`src/`, gebaut mit Vite + TypeScript + Phaser 3; `index.html` lädt nur `src/main.ts`, Vite bündelt den Rest). **Eine Zeile pro Modul** (Datei · Schicht · ein Satz Zweck); ausführliche Historie/Interface-Details liegen in den **on-demand-Tiefendocs** unter [`docs/module/`](docs/module/) — nur lesen, wenn du am jeweiligen Bereich arbeitest:

| Datei | Schicht | Zweck |
|---|---|---|
| [`src/main.ts`](src/main.ts) | Einstieg | Start & Tastatursteuerung; `SaveStore.init()` vor `Game.load()`. |
| [`src/sim.ts`](src/sim.ts) | pure Domäne | Cluster-Simulator-**Kern** (State/reset/Fabriken/`exec`-Dispatch/snapshot); Befehlsfamilien ausgelagert nach `src/sim/*`. → [sim.md](docs/module/sim.md) |
| [`src/sim/state.ts`](src/sim/state.ts) | pure Domäne | Simulator-Zustand & Domänentypen (Pod/Deployment/…, `ClusterState`). |
| [`src/sim/util.ts`](src/sim/util.ts) | pure Domäne | Geteilte pure Sim-Helfer (IDs, Pod-Namen, Tabellen). |
| [`src/sim/names.ts`](src/sim/names.ts) | pure Domäne | Value Objects für Ressourcen-Namen (#479/#507): DNS-1123-Regel + `ResourceName`/`PodName`-Brand + prüfender Constructor `resourceName()` (von den _make*-Fabriken zentral genutzt) + `asPodName` an EINER Stelle. |
| [`src/sim/docker.ts`](src/sim/docker.ts) | pure Domäne | docker-Befehlsfamilie. |
| [`src/sim/kubectl.ts`](src/sim/kubectl.ts) | pure Domäne | kubectl-Familie: dünner Dispatch-Barrel über `src/sim/kubectl/*` (Split #397). → [sim.md](docs/module/sim.md) |
| [`src/sim/kubectl/host.ts`](src/sim/kubectl/host.ts) | pure Domäne | `KubectlHost`-Interface (was kubectl von der Sim-Klasse braucht). |
| [`src/sim/kubectl/inspect.ts`](src/sim/kubectl/inspect.ts) | pure Domäne | kubectl lesend: get/describe/top/logs (#397). |
| [`src/sim/kubectl/lifecycle.ts`](src/sim/kubectl/lifecycle.ts) | pure Domäne | kubectl Lebenszyklus: create/apply/delete (#397). |
| [`src/sim/kubectl/ops.ts`](src/sim/kubectl/ops.ts) | pure Domäne | kubectl Workload-Ops: scale/expose/set/rollout (#397). |
| [`src/sim/kubectl/security.ts`](src/sim/kubectl/security.ts) | pure Domäne | kubectl RBAC (auth can-i #126) + Pod-Security (label/admitPod #128). |
| [`src/sim/helm.ts`](src/sim/helm.ts) | pure Domäne | helm-Befehlsfamilie. |
| [`src/sim/terraform.ts`](src/sim/terraform.ts) | pure Domäne | terraform-Befehlsfamilie. |
| [`src/sim/git.ts`](src/sim/git.ts) | pure Domäne | git-Befehlsfamilie (`git push` stößt die CI an). |
| [`src/sim/argocd.ts`](src/sim/argocd.ts) | pure Domäne | argocd-Befehlsfamilie + GitOps-Reconcile. |
| [`src/sim/observability.ts`](src/sim/observability.ts) | pure Domäne | Metriken/Scrape-Targets/Alerts (deterministisch, #109/#110). |
| [`src/sim/glab.ts`](src/sim/glab.ts) | pure Domäne | glab/CI-Familie + Pipeline-Maschinerie (`runPipeline`). |
| [`src/sim/net.ts`](src/sim/net.ts) | pure Domäne | Erreichbarkeits-Befehle `nslookup` (DNS #337) + `curl` (Service erreichbar? #164). |
| [`src/sim/eviction.ts`](src/sim/eviction.ts) | pure Domäne | Ephemeral Storage & Eviction: emptyDir/ephemeral-storage-Bilanz + DiskPressure-Auswertung (#240). |
| [`src/sim/s3.ts`](src/sim/s3.ts) | pure Domäne | S3-/MinIO-Object-Store: `aws s3`-Familie (mb/rb/ls/cp/rm) + off-cluster Buckets/Objekte (#241). |
| [`src/sim/kubeadm.ts`](src/sim/kubeadm.ts) | pure Domäne | kubeadm-Familie (Aufbau-Bogen #460): leerer/zerstörter Cluster + `kubeadm init/join/reset`; vor init scheitert kubectl mit „connection refused". |
| [`src/sim/invariants.ts`](src/sim/invariants.ts) | pure Domäne | Cluster-Invarianten (#478): `clusterInvariantViolations`/`assertClusterInvariants` als SSOT für einen legalen `ClusterState` (Replica Ist/Soll, Pods auf realen Nodes, PV/PVC-Bindung); `Sim.exec()` prüft sie an der Aggregat-Grenze. |
| [`src/sim/workload.ts`](src/sim/workload.ts) | pure Domäne | Getippte Workload-Mutationen (#488/#508, Forts. #478): `scaleDeployment`/`replacePods`/`replaceDeploymentPod`/`restartStatefulPod`/`addDeployment`/`removeDeployment`/`addStatefulSet`/`removeStatefulSet` halten `pods.length === replicas` by-construction; die Befehlsfamilien (lifecycle/ops/helm/argocd/glab) mutieren den Workload-Kern (Deployments UND StatefulSets) nur noch hierüber. |
| [`src/sim/nodes.ts`](src/sim/nodes.ts) | pure Domäne | Node-Aggregat-Mutationen (#534): `provisionNode` (idempotent per Name) / `removeNode` (spiegelt `removeDeployment`) + geteilte `NODE_VERSION` + das EINE Control-Plane-Prädikat `isControlPlane`; terraform/kubeadm/observability/eviction provisionieren/prüfen Knoten nur noch hierüber (vorher über 4 Dateien dupliziert). |
| [`src/content.ts`](src/content.ts) | pure Domäne | Fassade über `src/content/*` → `KQContent`. → [content.md](docs/module/content.md) |
| [`src/content/loader.ts`](src/content/loader.ts) | pure Domäne | Content-as-Data-Loader + Laufzeit-Validierung. |
| [`src/content/parse.ts`](src/content/parse.ts) | pure Domäne | Geteilte Parse-Primitiven + `ContentValidationError` (Leaf, bricht den Zyklus loader↔check-dsl, #411). |
| [`src/content/check-dsl.ts`](src/content/check-dsl.ts) | pure Domäne | Deklarative Quest-Check-DSL: `compileCheck` Regel→Prädikat (#411). → [content.md](docs/module/content.md) |
| [`src/content/scenario.ts`](src/content/scenario.ts) | pure Domäne | Scenario-Validierung (#494): `reviveScenario` prüft Inline-`scenario` strukturell gegen eine geschlossene Feld-/applyEffect-Allowlist (fail-fast gegen stille Tippfehler). |
| [`src/content/checks.ts`](src/content/checks.ts) | pure Domäne | `QUEST_CHECKS`: nur noch echte Code-Sonderfälle (der Rest ist DSL-Daten, #411). |
| [`src/content/entities.ts`](src/content/entities.ts) | pure Domäne | Entity-Registry: datengesteuerte NPC- & Objekt-Platzierung (#349/#357). |
| [`src/content/validate.ts`](src/content/validate.ts) | pure Domäne | Schema-Validierung des Inhalts-Bündels (`validateContent`): strukturelle Konsistenz aller Quests/Drills/Quiz/Karten/Pools, ohne Fremd-Library (null Laufzeit-Deps). → [content.md](docs/module/content.md) |
| [`src/content/learnorder.ts`](src/content/learnorder.ts) | pure Domäne | Lernreihenfolge-Wächter (#235/#412): keine Quiz-/Review-Karte vor Einführung ihres Konzepts; Prüflogik wird nur vom Test-Wächter `test/learnorder.test.ts` aufgerufen. |
| [`src/content/manifests.ts`](src/content/manifests.ts) | pure Domäne | „Virtuelle Dateien": fertige YAML-/Terraform-/CI-Schnipsel, die Quests im simulierten Dateisystem hinlegen (lesen/anwenden/reparieren). |
| [`src/content/minigame.ts`](src/content/minigame.ts) | pure Domäne | Stapel-Minispiel-Daten (Docker-Image-Schichten aufsteigend, #218) + Sturm-Image-Namen-Verfälscher. |
| [`src/content/progression.ts`](src/content/progression.ts) | pure Domäne | Reine Inhalts-Daten: Ränge (XP-Schwellen) + Shop-Angebot. |
| [`src/content/util.ts`](src/content/util.ts) | pure Domäne | Kleine geteilte Inhalts-Helfer (Zufall: `pick`/Range), von Drills u.a. genutzt. |
| [`src/content/data/`](src/content/data/) | Daten | Quests/NPCs/Smalltalk/Reihenfolge/Drills/Quiz + Terraform-Konfigs (#147) + Funk-Erklärungen (#362) als JSON. |
| [`src/content/drills.ts`](src/content/drills.ts) | pure Domäne | Barrel: mergt `DRILLS` + `PRACTICE` aus `src/content/drills/*` (#457). |
| [`src/content/drills/shared.ts`](src/content/drills/shared.ts) | pure Domäne | Geteilte Helfer + `DrillTask`-Typ + ensure*-Fabriken + YAML-Konstanten-Re-Exporte (#457). |
| [`src/content/drills/docker.ts`](src/content/drills/docker.ts) | pure Domäne | Docker-Drills (pull/run/build/tag/push, #457). |
| [`src/content/drills/kubectl.ts`](src/content/drills/kubectl.ts) | pure Domäne | kubectl/Secret/Ingress-Drills (#457). |
| [`src/content/drills/git.ts`](src/content/drills/git.ts) | pure Domäne | Git/CI-Drills (#457). |
| [`src/content/drills/helm.ts`](src/content/drills/helm.ts) | pure Domäne | Helm-Drills (install/upgrade/rollback/create/template, #457). |
| [`src/content/drills/terraform.ts`](src/content/drills/terraform.ts) | pure Domäne | Terraform-Drills (plan/apply/state/output, #457). |
| [`src/content/drills/network.ts`](src/content/drills/network.ts) | pure Domäne | Netzwerk-Drills (NetworkPolicy/DNS, #457). |
| [`src/content/drills/gitops.ts`](src/content/drills/gitops.ts) | pure Domäne | GitOps/ArgoCD-Drills (#457). |
| [`src/content/drills/observability.ts`](src/content/drills/observability.ts) | pure Domäne | Observability-Drills (Metriken/Logs/Alerts, #457). |
| [`src/content/drills/rbac.ts`](src/content/drills/rbac.ts) | pure Domäne | RBAC/Pod-Security-Drills (#457). |
| [`src/content/drills/storage.ts`](src/content/drills/storage.ts) | pure Domäne | Storage-Drills (StatefulSet/PVC/Snapshot, #457). |
| [`src/content/drills/werft.ts`](src/content/drills/werft.ts) | pure Domäne | Werft-Capstone-Drills (Build→Deploy→Expose→Test, #457). |
| [`src/content/abbrev.ts`](src/content/abbrev.ts) | pure Domäne | Langform↔Kürzel-Katalog („verdiente Abkürzung"). |
| [`src/world.ts`](src/world.ts) | pure Domäne | Welt-Geometrie + Autotile (#340) + Sub-Tile-Kollision (#343/#386). → [world.md](docs/module/world.md) |
| [`src/archipel.ts`](src/archipel.ts) | pure Domäne | GitOps-Archipel-Insel: Geometrie + Warp. |
| [`src/lighthouse.ts`](src/lighthouse.ts) | pure Domäne | Monitoring-Leuchtturm-Klippe: Geometrie + Warp (#111). |
| [`src/warehouse.ts`](src/warehouse.ts) | pure Domäne | Lagerhallen-Viertel/Hafenkai: Geometrie + Warp (#124). |
| [`src/watchtower.ts`](src/watchtower.ts) | pure Domäne | Wachturm-Quartier: Festungs-Bailey-Geometrie + Anleger/Warp + Turm-Fußabdruck (#130). |
| [`src/flotte.ts`](src/flotte.ts) | pure Domäne | Expeditions-Flotte: Flaggschiff-Deck-Geometrie + Anleger/Warp (#148). |
| [`src/werft.ts`](src/werft.ts) | pure Domäne | Heimat-Werft: Werft-Hof-Geometrie + Helling/Anleger/Warp (Phase-10-Capstone, #165). |
| [`src/warps.ts`](src/warps.ts) | pure Domäne | Region-Übergänge als Daten-Liste (`REGION_WARPS`) + reiner Anti-Pingpong-Kern `armWarps`/`triggeredWarp` (#426). |
| [`src/decor.ts`](src/decor.ts) | pure Domäne | Deterministische Deko-Platzierung. |
| [`src/hazards.ts`](src/hazards.ts) | pure Domäne | Gefahren-Entscheidungskern (#512): `resolveHazardTick` (welche Gefahr startet/löst auf/tickt) + Start-Gate + Opfer-Eignung; `scenes/worldscene/events.ts` führt nur noch die Effekte aus. |
| [`src/clock.ts`](src/clock.ts) | pure Domäne | Zeit-/Datums-Ableitung für die HUD-Uhr. |
| [`src/coins.ts`](src/coins.ts) | pure Domäne | Value Object für Dublonen (#490, Forts. #479): Regel „nicht-negativ + ganzzahlig" + zentrale Arithmetik (Rundung/Multiplikator/Affordability) als `Coins`-Brand + Fabriken/Operationen. |
| [`src/rng.ts`](src/rng.ts) | pure Domäne | Zufall/Determinismus-SSOT (#492): seedbarer PRNG `mulberry32`/`nextRandom`/`seedGlobalRng` + aus Namen abgeleitete stabile Werte `hashStr`/`hashHex`; ersetzt `Math.random` in `src/sim/**` + `src/content/**`. |
| [`src/pixelfont.ts`](src/pixelfont.ts) | pure Domäne | Glyphen-Daten der In-Welt-Bitmap-Font (#188). |
| [`src/markup.ts`](src/markup.ts) | pure Domäne | `fmtCmd`: zeichnet variable Platzhalter `<token>` in Content-Texten als sichtbares „ändere-mich"-Badge aus (#311); die EINE Quelle der Platzhalter-Konvention, angewandt an der Render-Grenze (radio/dialog/quiz/questlog/album). |
| [`src/cull.ts`](src/cull.ts) | pure Domäne | Off-screen-Culling & FPS-Messung (#82) + Cluster-Tag-Auswahl `selectVisibleTags` (#416). |
| [`src/overlaykbd.ts`](src/overlaykbd.ts) | pure Domäne | Tastatur-Logik für Modals (#283) + Dialog-Blättern (#310). |
| [`src/viewdecide.ts`](src/viewdecide.ts) | pure Domäne | Reine Präsentations-Entscheidungen (#500), DOM-frei/testbar: Funk-Session-Priorität + `evaluateSubmission` (Terminal-Bewertung) + `scoreReview` (Quiz) + `resolveTalkTarget` (NPC-Routing). |
| [`src/toastlife.ts`](src/toastlife.ts) | pure Domäne | Toast-Anzeigedauer-Politik: kurze Belohnung vs. lesbarer Hinweis (>= 15 s) + Fade-Timing (#370). |
| [`src/kralle.ts`](src/kralle.ts) | pure Domäne | Kralle-Meilenstein-Sprüche: `krallePracticeMilestone(count)` (zählbewusster Spruch an 1/10/25/50/100…, sonst null, #236). |
| [`src/cmdhistory.ts`](src/cmdhistory.ts) | pure Domäne | Befehlshistorie fürs Funkgerät-Terminal (#316). |
| [`src/cmdunlock.ts`](src/cmdunlock.ts) | pure Domäne | Freigeschaltete Befehlsfamilien fürs gefilterte `help` (#358): aus dem Quest-Fortschritt abgeleitet (kein neues Save-Feld), `help`/`clear` immer dabei. |
| [`src/helptext.ts`](src/helptext.ts) | pure Domäne | `help`-Katalog + gefiltertes Rendering (#358) im CLI-Format (ein Befehl/Zeile, ausgerichtete Spalten, #359); der Simulator delegiert sein `help` hierher (eigenes, typfreies Modul → kein Zyklus). |
| [`src/funkexplain.ts`](src/funkexplain.ts) | pure Domäne | Freies Funken „Was ist gerade passiert?": dosierte Auswahl einer In-World-Erklärung zur Befehlszeile (#362); Katalog ist Content-as-Data (`content/data/funk-explain/<tool>.json`). |
| [`src/questlog.ts`](src/questlog.ts) | pure Domäne | Logbuch-Übersicht: Quest-Zustände, Nachlese (#326). |
| [`src/album.ts`](src/album.ts) | pure Domäne | Sammelalbum/Glossar (#278): Befehle (Teach-Intros) + Wissen (Quiz) aus dem Content, nach Thema gruppiert, Freischalt-Ableitung aus `completedQuests`/`review` (kein neues Save-Feld). |
| [`src/labellayout.ts`](src/labellayout.ts) | pure Domäne | Entzerrt überlappende In-Welt-Beschriftungen (#207). |
| [`src/tilemap.ts`](src/tilemap.ts) | pure Domäne | Tiled-`.tmj`-Grundgerüst (Typen/Validierung/Kollision, #191). |
| [`src/harbormap.ts`](src/harbormap.ts) | pure Domäne | Hafenkarte als Daten + Tiled-Serialisierung (#192). |
| [`src/mapregistry.ts`](src/mapregistry.ts) | pure Domäne | Zentrale Map-Registry (ID → `.tmj` + Metadaten, #193). |
| [`src/types.ts`](src/types.ts) | Typen | Zentrale Typen (GameState, Quest, …). → [app.md](docs/module/app.md) |
| [`src/game.ts`](src/game.ts) | Anwendung | `Game`-Fassade/Barrel (#356-Muster): State-Felder + Spread der `src/game/*`-Bündel. → [app.md](docs/module/app.md) |
| [`src/game/shared.ts`](src/game/shared.ts) | Anwendung | Geteilte Bausteine: `part`/`GameSelf`, `today`, Quest-ID↔Index-Brücke, `makeDefaultState`, Freischalt-Konstanten. |
| [`src/game/save.ts`](src/game/save.ts) | Anwendung | Laden/Speichern/Reset/Export/Import + `sanitizeState` + `LEGACY_QUEST_ID_MAP`. |
| [`src/game/economy.ts`](src/game/economy.ts) | Anwendung | Hafen-Wirtschaft, Streak, XP/Rang, Dublonen, Shop. |
| [`src/game/progression.ts`](src/game/progression.ts) | Anwendung | Quest-Fortschritt, Dev-Sprung (#329), freies Üben. |
| [`src/game/sandbox.ts`](src/game/sandbox.ts) | Anwendung | Wiederspiel-Sandbox (#332): abgeschlossene Quest erneut spielen, Live-Stand als RAM-Lesezeichen, `save()` währenddessen No-Op. |
| [`src/game/unlocks.ts`](src/game/unlocks.ts) | Anwendung | Verdiente Abkürzungen (#313) + Befehlshistorie (#316). |
| [`src/game/spaced-repetition.ts`](src/game/spaced-repetition.ts) | Anwendung | Leitner-Spaced-Repetition + Review-Gate + Übungs-Lernstand (Drills/Stapel-Runden, gewichtete Auswahl, #219). |
| [`src/game/clock.ts`](src/game/clock.ts) | Anwendung | Persistente Spiel-Zeit/Kalender (#413): `advanceClock` (Achse `gameDays` vorrücken) + `calendar` (abgeleiteter Tag/Saison/Uhrzeit). |
| [`src/game/tick.ts`](src/game/tick.ts) | Anwendung | Szenen-neutraler Taktgeber (#501): `Game.tick(dtMs)` rückt frame-unabhängige Domäne (Spiel-Zeit + Hafen-Wirtschaft) an EINER Stelle vor; aus Phasers globalem Pre-Step (main.ts) getrieben → läuft in JEDER Szene, Auszahlung entkoppelt über runtime-Sink. |
| [`src/runtime.ts`](src/runtime.ts) | Anwendung | Laufzeit-Singletons (bricht Import-Zyklen). |
| [`src/devpanel.ts`](src/devpanel.ts) | Anwendung | Dev-/Test-Panel (#325/#331). |
| [`src/store.ts`](src/store.ts) | Persistenz | SaveStore: IndexedDB-Backend, sync API via In-Memory-Cache (#350); Eviction-Schutz `requestPersistentStorage()` (#401); mehrere Save-Slots (#306, aktiver Slot + Slot-Index, Default-Slot am Legacy-Key). |
| [`src/scenes.ts`](src/scenes.ts) | Präsentation | Barrel der 7 Phaser-Szenen (`KQScenes`, #345). → [presentation.md](docs/module/presentation.md) |
| [`src/scenes/shared.ts`](src/scenes/shared.ts) | Präsentation | Geteilte Szenen-Bausteine (Font/Schilder/NPC-Render) + Insel-Szenen-Basisklasse `IslandScene` (#423). |
| [`src/scenes/BootScene.ts`](src/scenes/BootScene.ts) | Präsentation | Lädt Assets + Frame-Slicing, startet World. |
| [`src/scenes/WorldScene.ts`](src/scenes/WorldScene.ts) | Präsentation | Port Kubernia: schlanker Orchestrator (create/update) + Render-Primitive; Spiel-Systeme in `worldscene/*` (#393). |
| [`src/scenes/worldscene/mapterrain.ts`](src/scenes/worldscene/mapterrain.ts) | Präsentation | Generischer, Phaser-freier Terrain-Lader: Boden/Kollision/Türen/NPCs aus `getMapEntry(scene.mapId)` statt fest „harbor" (#425). |
| [`src/scenes/worldscene/terrain.ts`](src/scenes/worldscene/terrain.ts) | Präsentation | Hafen-Szenerie (Objekte/Gebäude/Türen-Optik) + Wang-Autotile-Boden (#393). |
| [`src/scenes/worldscene/scenery.ts`](src/scenes/worldscene/scenery.ts) | Präsentation | Deko, statische Props/Effekte, Möwen, Tag-Nacht-Schleier (#393). |
| [`src/scenes/worldscene/clustersync.ts`](src/scenes/worldscene/clustersync.ts) | Präsentation | Cluster→Welt-Sync: Pod-Kisten + dynamische Tags als Daten + gedeckelter Render-Pool (#393/#416). |
| [`src/scenes/worldscene/events.ts`](src/scenes/worldscene/events.ts) | Präsentation | Zufalls-Gefahren: Piraten/Krake/Sturm + Terminierung (#393). |
| [`src/scenes/worldscene/warps.ts`](src/scenes/worldscene/warps.ts) | Präsentation | Übergänge Haus/Archipel/Leuchtturm/Lager + Warp-Gates (#393). |
| [`src/scenes/worldscene/types.ts`](src/scenes/worldscene/types.ts) | Präsentation | Feld-/Primitive-Interface `WorldSceneFields` (WorldScene `implements` es) + `WorldSceneLike = Phaser.Scene & WorldSceneFields` fürs System-Modul-Muster; volltypisiert statt `any` (#393/#496). |
| [`src/scenes/InteriorScene.ts`](src/scenes/InteriorScene.ts) | Präsentation | Betretbarer Hausinnenraum (#6). |
| [`src/scenes/RegionScene.ts`](src/scenes/RegionScene.ts) | Präsentation | EINE datengetriebene Szene für alle Nachbar-Regionen (Archipel/Leuchtturm/Lager/Wachturm), gesteuert über eine `RegionConfig` (#427); ersetzt die früheren Insel-Szenen-Klassen. |
| [`src/scenes/regions.ts`](src/scenes/regions.ts) | Präsentation | Die `RegionConfig`-Liste (`REGION_CONFIGS`): Archipel #92/Leuchtturm #111/Lager #124/Wachturm #130 als Daten + `decorate`-Hooks für echte Sondermechanik (Bäume/Statue, Lichtkegel, Lager-Güter, Wachturm-Platzhalter), #427. |
| [`src/scenes/TilemapTestScene.ts`](src/scenes/TilemapTestScene.ts) | Präsentation | Tiled-Loader-Testszene (`?maptest`, #191). |
| [`src/ui.ts`](src/ui.ts) | Präsentation | UI-Orchestrator/Barrel (komponiert `UI` aus `src/ui/*`, #356). → [presentation.md](docs/module/presentation.md) |
| [`src/ui/shared.ts`](src/ui/shared.ts) | Präsentation | Geteilte UI-Helfer + `part()`-Typ-Helper. |
| [`src/ui/overlays.ts`](src/ui/overlays.ts) | Präsentation | Overlay-Register (#505): EINE Datenliste `OVERLAYS` (id/blocking/keyNav) als SSOT; `blocking`/`closeOverlays`/`overlayKey` + Einzel-Checks leiten daraus ab (`BLOCKING_OVERLAY_IDS`/`KEYNAV_OVERLAY_IDS`/`OVERLAY_ID`), an index.html gebunden. |
| [`src/ui/overlay.ts`](src/ui/overlay.ts) | Präsentation | Event-Delegation, Modal-Tastatur, Menü/Pause. |
| [`src/ui/hud.ts`](src/ui/hud.ts) | Präsentation | HUD/Toasts/Alarm, Interaktion, Antwort-Buttons. |
| [`src/ui/quest.ts`](src/ui/quest.ts) | Präsentation | Quest-Maschine + Begrüßung/Intro (#288). |
| [`src/ui/dialog.ts`](src/ui/dialog.ts) | Präsentation | NPC-/Bo-Dialoge. |
| [`src/ui/radio.ts`](src/ui/radio.ts) | Präsentation | Funkgerät-Terminal (teach/drill/terminal) + freies Üben. |
| [`src/ui/minigame.ts`](src/ui/minigame.ts) | Präsentation | Stapel-Minispiel. |
| [`src/ui/questlog.ts`](src/ui/questlog.ts) | Präsentation | Logbuch-Übersicht & -Detail (DOM, #326). |
| [`src/ui/album.ts`](src/ui/album.ts) | Präsentation | Sammelalbum/Glossar (DOM, #278): Album-Seiten je Thema + Sticker-Detail, Taste B. |
| [`src/ui/shop.ts`](src/ui/shop.ts) | Präsentation | Shop. |
| [`src/ui/quiz.ts`](src/ui/quiz.ts) | Präsentation | Krabben-Quiz (Spaced-Repetition). |
| [`src/ui/save.ts`](src/ui/save.ts) | Präsentation | Spielstand-Export/Import + `resetGame`. |
| [`src/sfx.ts`](src/sfx.ts) | Präsentation | WebAudio-Sounds (synthetisiert). |
| [`src/assets-data.ts`](src/assets-data.ts) | Assets | `ASSET_MANIFEST` (eine Quelle pro Grafik). |

**Tiefendocs (on-demand, je Subsystem):**

| Doc | Deckt ab |
|---|---|
| [`docs/module/sim.md`](docs/module/sim.md) | Simulator-Kern + alle Befehlsfamilien (`src/sim/*`), Split-Historie #346/#372–#385, Host-Interfaces, Observability #109/#110, RBAC #126/#128. |
| [`docs/module/content.md`](docs/module/content.md) | Content-as-Data (#348/#349/#352/#368): Loader/Schema, Checks, Entity-Registry, `data/`-Struktur. |
| [`docs/module/world.md`](docs/module/world.md) | Welt/Karten (pure Domäne): Geometrie, Autotile #340, Hitbox #343/#386, Inseln, Tiled-Pipeline, HUD-Helfer. |
| [`docs/module/presentation.md`](docs/module/presentation.md) | Präsentation: Szenen-Barrel & -Split #345, UI-Barrel & -Bündel #356, SFX/Assets. |
| [`docs/module/app.md`](docs/module/app.md) | Anwendung/Persistenz/Typen: `game.ts`/`sanitizeState`, runtime, devpanel, SaveStore/IndexedDB #350. |

> **Konvention (gegen erneutes Aufblähen):** Neues `src/`-Modul = **eine** knappe Zeile hier (Datei · Schicht · ein Satz Zweck). Ausführliche Historie/Interface-Details kommen in das passende [`docs/module/`](docs/module/)-Tiefendoc, **nicht** in diese Tabelle. Tiefe Begründung der Schichtung (Domäne ↔ Anwendung ↔ Präsentation): [AGENTS.md › Architektur](AGENTS.md#architektur). **Diese Konvention ist maschinell bewacht (#482):** `npm run check:docmap` (CI-Gate + `test/docmap.test.ts`) meldet jede `src/`-Datei ohne Landkarten-Zeile, jede Zeile ohne Datei und jede Schicht, die von der `dependency-cruiser`-Zuordnung abweicht — die Landkarte kann also nicht mehr leise veralten.

**Weitere Anlaufstellen:**

| Was | Wo |
|---|---|
| 🤝 Mitentwickeln (Einstieg + One-Command-Setup `npm run setup`) | [CONTRIBUTING.md](CONTRIBUTING.md) |
| 🐳 Im Container entwickeln (devcontainer / `docker compose up`, #388) | [CONTRIBUTING.md › Im Container entwickeln](CONTRIBUTING.md) · [`.devcontainer/`](.devcontainer/devcontainer.json) · [`docker-compose.yml`](docker-compose.yml) |
| 📖 Spiel-Doku (Story, Steuerung, Lernpfad) | [README.md](README.md) |
| 📋 Agenten-Regeln, Board-Workflow, Konventionen | [AGENTS.md](AGENTS.md) |
| 🗣️ Glossar (Hafen↔K8s↔Code) + Kontext-Landkarte der Subdomänen | [docs/glossar.md](docs/glossar.md) – welche Sprache/welcher Context gilt in welchem Verzeichnis (Token-lokal arbeiten) |
| 🎨 PixelLab-Assets (Liste + IDs) | [assets/pixellab/README.md](assets/pixellab/README.md) |
| 🔤 Pixelschrift fürs HUD (`KQPixel`/Silkscreen) | [`fonts.css`](fonts.css) (base64-`@font-face`) + Quelle/Lizenz in [`assets/fonts/`](assets/fonts/) (#189) |
| 🗺️ Tiled-Maps (`.tmj`) + Workflow | [assets/maps/README.md](assets/maps/README.md) |
| 🧪 Tests (Vitest) | [`test/`](test/) – Kern/Dispatch in `sim.test.ts`; die Simulator-Befehlsfamilien gespiegelt zu den `sim/`-Modulen unter [`test/sim/`](test/sim/) (docker/kubectl/rbac/helm/git/terraform/argocd/glab, #383); dazu `content.test.ts`, `quests.test.ts` u.a. **Geteiltes Harness (#475):** Querschnitts-Umgebung (window/localStorage-Stub + Spiel-Stack laden) in [`test/support/`](test/support/), valide Domänen-Eingaben/Factories in [`test/factories/`](test/factories/) (`freshSim`; `test/sim/helpers.ts` re-exportiert daraus). Verhaltens-Tests prüfen die öffentliche API/beobachtbares Verhalten, nicht Interna – die Architektur-**Fitness-Functions** (`layering.test.ts`/`filesize.test.ts`/`docmap.test.ts`, #482) sind bewusst eine eigene Kategorie. |
| 🚦 Boot- & Interaktions-Smokes (Playwright, E2E) | [`e2e/`](e2e/) – lädt den gebauten Offline-Build headless: Boot fehlerfrei (#391) **plus** schlanke Interaktions-Smokes (#480: Terminal-Eingabe, Overlay auf/zu, ein Quest-Durchlauf) über Tastatur/DOM ohne Test-Hintertür; geteilte Helfer in [`e2e/support.ts`](e2e/support.ts). Config: [`playwright.config.ts`](playwright.config.ts). Bewusst getrennt von den Vitest-Unit-Tests (`npm run smoke`). |
| ✅ Backlog / TODOs | GitHub Issues + Project-Board (`gh issue list --state open --limit 500`, `gh project list --owner fluffels`) |
| 🥇 Nächstes Ticket (Umsetzungs-Reihenfolge) | [docs/ticket-reihenfolge.md](docs/ticket-reihenfolge.md) – Kopf (kuratiert) + Auto-Rest (Prio→Nummer) + Reaktivierungs-Pool |

## ❓ Die vier Einstiegsfragen

- **Was ist das Spiel?** KubeQuest – ein 2D-Lernspiel (Phaser 3) für Docker/K8s/Helm/Terraform; die Spielwelt **ist** der Cluster. → [README.md](README.md)
- **Wie starte ich?** `npm install` → `npm run dev` → angezeigte Adresse im Browser. → Schnellstart oben.
- **Welches Ticket nehme ich?** Das **oberste freie Ticket aus dem _Kopf_** der gepflegten [Umsetzungs-Reihenfolge](docs/ticket-reihenfolge.md) (abhängigkeitsbewusst, nächstes ganz oben; ⚠️-Sonderfälle dort beachten). Steht nichts im Kopf, generisch als **Auto-Rest** nach **Priorität** (`prio:hoch` → `prio:mittel` → `prio:niedrig` → ohne Label) + **niedrigster freier Nummer** (`gh issue list --state open --limit 500` – ohne `--limit` nur die 30 neuesten!; kein Assignee, kein offener PR/Branch/Worktree) – nicht nach Inhalt aussuchen. Sofort self-assignen. → [AGENTS.md › Wo die TODOs leben](AGENTS.md#wo-die-todos-leben).
- **Wie schließe ich ab?** Tests grün + im Browser verifiziert → nach `main` mergen → Worktree/Branch aufräumen → Issue schließen. → [AGENTS.md › Git-Workflow](AGENTS.md#das-wichtigste-zuerst-harte-regeln).

---

**Vollständige Regeln & Begründungen: → [AGENTS.md](AGENTS.md). Bei Konflikt gilt AGENTS.md.**

# CLAUDE.md – Einstieg für KI-Agenten

> **Du bist ein Agent in diesem Repo? Hier findest du auf einen Blick alles zum Loslegen.**
> Die **ausführliche Arbeitsanweisung** (harte Regeln, Board-Workflow, Konventionen) steht in **[AGENTS.md](AGENTS.md)** – diese Datei ist der schnelle Einstieg, der dorthin führt.
> Was das Spiel **ist** (Story, Steuerung, Lernpfad), steht in der **[README.md](README.md)** – die ist spielerseitig, nicht für dich als Agent.

> ⭐ **Oberste Regel vor JEDER Änderung:** „Ist das okay, wenn KubeQuest ein Spiel in **Stardew-Valley-Größe** wird?" Nur machen, wenn ja — diese Frage steht über allen ADRs/Konventionen. Was auffällt, aber gerade nicht dran ist → **Ticket anlegen**. Details: [AGENTS.md › Oberste Regel](AGENTS.md#-oberste-regel--über-allem-auch-über-den-adrs).

## ⚡ Schnellstart (in <1 Minute zum ersten Schritt)

```
1. npm run setup                            # einmalig: prüft Node, npm install, Tests+Typecheck+Arch-Check (oder nur npm install)
2. npm run dev                              # Dev-Server, angezeigte Adresse im Browser öffnen
3. gh issue list --state open --limit 500   # GANZE Liste holen! ohne --limit nur die 30 neuesten. Dann nach Prio (hoch→mittel→niedrig) + niedrigster freier Nummer wählen, nicht nach Inhalt
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
| One-Command-Setup (Node-Check + install + alle Checks, #387) | `npm run setup` |
| Erstinstallation | `npm install` |
| Dev-Server | `npm run dev` |
| Host-/Prod-Build (Multi-File nach `dist/`) | `npm run build` |
| Offline-Build (self-contained `dist-offline/index.html`) | `npm run build:offline` |
| Dev-Panel-Build (#331, Panel MIT, passwortgated, `dist-devpanel/`) | `npm run build:devpanel` |
| Tests | `npm test` (Vitest) |
| Typen prüfen (voll strict) | `npm run typecheck` |
| Linter (ESLint, #389) | `npm run lint` |
| Architektur-Wächter (Schichtung + Zyklen + Orphans, #347/#390) | `npm run check:arch` |
| Dateigröße-Wächter (God-File-Budget 800 LOC, #390) | `npm run check:size` |
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
| [`src/content.ts`](src/content.ts) | pure Domäne | Fassade über `src/content/*` → `KQContent`. → [content.md](docs/module/content.md) |
| [`src/content/loader.ts`](src/content/loader.ts) | pure Domäne | Content-as-Data-Loader + Laufzeit-Validierung. |
| [`src/content/parse.ts`](src/content/parse.ts) | pure Domäne | Geteilte Parse-Primitiven + `ContentValidationError` (Leaf, bricht den Zyklus loader↔check-dsl, #411). |
| [`src/content/check-dsl.ts`](src/content/check-dsl.ts) | pure Domäne | Deklarative Quest-Check-DSL: `compileCheck` Regel→Prädikat (#411). → [content.md](docs/module/content.md) |
| [`src/content/checks.ts`](src/content/checks.ts) | pure Domäne | `QUEST_CHECKS`: nur noch echte Code-Sonderfälle (der Rest ist DSL-Daten, #411). |
| [`src/content/entities.ts`](src/content/entities.ts) | pure Domäne | Entity-Registry: datengesteuerte NPC- & Objekt-Platzierung (#349/#357). |
| [`src/content/data/`](src/content/data/) | Daten | Quests/NPCs/Smalltalk/Reihenfolge/Drills/Quiz als JSON. |
| [`src/content/abbrev.ts`](src/content/abbrev.ts) | pure Domäne | Langform↔Kürzel-Katalog („verdiente Abkürzung"). |
| [`src/world.ts`](src/world.ts) | pure Domäne | Welt-Geometrie + Autotile (#340) + Sub-Tile-Kollision (#343/#386). → [world.md](docs/module/world.md) |
| [`src/archipel.ts`](src/archipel.ts) | pure Domäne | GitOps-Archipel-Insel: Geometrie + Warp. |
| [`src/lighthouse.ts`](src/lighthouse.ts) | pure Domäne | Monitoring-Leuchtturm-Klippe: Geometrie + Warp (#111). |
| [`src/warehouse.ts`](src/warehouse.ts) | pure Domäne | Lagerhallen-Viertel/Hafenkai: Geometrie + Warp (#124). |
| [`src/decor.ts`](src/decor.ts) | pure Domäne | Deterministische Deko-Platzierung. |
| [`src/clock.ts`](src/clock.ts) | pure Domäne | Zeit-/Datums-Ableitung für die HUD-Uhr. |
| [`src/pixelfont.ts`](src/pixelfont.ts) | pure Domäne | Glyphen-Daten der In-Welt-Bitmap-Font (#188). |
| [`src/cull.ts`](src/cull.ts) | pure Domäne | Off-screen-Culling & FPS-Messung (#82). |
| [`src/overlaykbd.ts`](src/overlaykbd.ts) | pure Domäne | Tastatur-Logik für Modals (#283) + Dialog-Blättern (#310). |
| [`src/cmdhistory.ts`](src/cmdhistory.ts) | pure Domäne | Befehlshistorie fürs Funkgerät-Terminal (#316). |
| [`src/questlog.ts`](src/questlog.ts) | pure Domäne | Logbuch-Übersicht: Quest-Zustände, Nachlese (#326). |
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
| [`src/game/unlocks.ts`](src/game/unlocks.ts) | Anwendung | Verdiente Abkürzungen (#313) + Befehlshistorie (#316). |
| [`src/game/spaced-repetition.ts`](src/game/spaced-repetition.ts) | Anwendung | Leitner-Spaced-Repetition + Review-Gate. |
| [`src/game/clock.ts`](src/game/clock.ts) | Anwendung | Persistente Spiel-Zeit/Kalender (#413): `advanceClock` (Achse `gameDays` vorrücken) + `calendar` (abgeleiteter Tag/Saison/Uhrzeit). |
| [`src/runtime.ts`](src/runtime.ts) | Anwendung | Laufzeit-Singletons (bricht Import-Zyklen). |
| [`src/devpanel.ts`](src/devpanel.ts) | Anwendung | Dev-/Test-Panel (#325/#331). |
| [`src/store.ts`](src/store.ts) | Persistenz | SaveStore: IndexedDB-Backend, sync API via In-Memory-Cache (#350); Eviction-Schutz `requestPersistentStorage()` (#401). |
| [`src/scenes.ts`](src/scenes.ts) | Präsentation | Barrel der 7 Phaser-Szenen (`KQScenes`, #345). → [presentation.md](docs/module/presentation.md) |
| [`src/scenes/shared.ts`](src/scenes/shared.ts) | Präsentation | Geteilte Szenen-Bausteine (Font/Schilder/NPC-Render) + Insel-Szenen-Basisklasse `IslandScene` (#423). |
| [`src/scenes/BootScene.ts`](src/scenes/BootScene.ts) | Präsentation | Lädt Assets + Frame-Slicing, startet World. |
| [`src/scenes/WorldScene.ts`](src/scenes/WorldScene.ts) | Präsentation | Port Kubernia: schlanker Orchestrator (create/update) + Render-Primitive; Spiel-Systeme in `worldscene/*` (#393). |
| [`src/scenes/worldscene/terrain.ts`](src/scenes/worldscene/terrain.ts) | Präsentation | Hafenkarte/Boden/Türen laden + Wang-Autotile-Boden (#393). |
| [`src/scenes/worldscene/scenery.ts`](src/scenes/worldscene/scenery.ts) | Präsentation | Deko, statische Props/Effekte, Möwen, Tag-Nacht-Schleier (#393). |
| [`src/scenes/worldscene/clustersync.ts`](src/scenes/worldscene/clustersync.ts) | Präsentation | Cluster→Welt-Sync: Pod-Kisten + dynamische Tags (#393). |
| [`src/scenes/worldscene/events.ts`](src/scenes/worldscene/events.ts) | Präsentation | Zufalls-Gefahren: Piraten/Krake/Sturm + Terminierung (#393). |
| [`src/scenes/worldscene/warps.ts`](src/scenes/worldscene/warps.ts) | Präsentation | Übergänge Haus/Archipel/Leuchtturm/Lager + Warp-Gates (#393). |
| [`src/scenes/worldscene/types.ts`](src/scenes/worldscene/types.ts) | Präsentation | Struktur-Typ `WorldSceneLike` fürs System-Modul-Muster (#393). |
| [`src/scenes/InteriorScene.ts`](src/scenes/InteriorScene.ts) | Präsentation | Betretbarer Hausinnenraum (#6). |
| [`src/scenes/ArchipelScene.ts`](src/scenes/ArchipelScene.ts) | Präsentation | GitOps-Archipel-Insel (#92). |
| [`src/scenes/LighthouseScene.ts`](src/scenes/LighthouseScene.ts) | Präsentation | Monitoring-Leuchtturm-Klippe (#111). |
| [`src/scenes/WarehouseScene.ts`](src/scenes/WarehouseScene.ts) | Präsentation | Lagerhallen-Viertel/Hafenkai (#124). |
| [`src/scenes/TilemapTestScene.ts`](src/scenes/TilemapTestScene.ts) | Präsentation | Tiled-Loader-Testszene (`?maptest`, #191). |
| [`src/ui.ts`](src/ui.ts) | Präsentation | UI-Orchestrator/Barrel (komponiert `UI` aus `src/ui/*`, #356). → [presentation.md](docs/module/presentation.md) |
| [`src/ui/shared.ts`](src/ui/shared.ts) | Präsentation | Geteilte UI-Helfer + `part()`-Typ-Helper. |
| [`src/ui/overlay.ts`](src/ui/overlay.ts) | Präsentation | Event-Delegation, Modal-Tastatur, Menü/Pause. |
| [`src/ui/hud.ts`](src/ui/hud.ts) | Präsentation | HUD/Toasts/Alarm, Interaktion, Antwort-Buttons. |
| [`src/ui/quest.ts`](src/ui/quest.ts) | Präsentation | Quest-Maschine + Begrüßung/Intro (#288). |
| [`src/ui/dialog.ts`](src/ui/dialog.ts) | Präsentation | NPC-/Bo-Dialoge. |
| [`src/ui/radio.ts`](src/ui/radio.ts) | Präsentation | Funkgerät-Terminal (teach/drill/terminal) + freies Üben. |
| [`src/ui/minigame.ts`](src/ui/minigame.ts) | Präsentation | Stapel-Minispiel. |
| [`src/ui/questlog.ts`](src/ui/questlog.ts) | Präsentation | Logbuch-Übersicht & -Detail (DOM, #326). |
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

> **Konvention (gegen erneutes Aufblähen):** Neues `src/`-Modul = **eine** knappe Zeile hier (Datei · Schicht · ein Satz Zweck). Ausführliche Historie/Interface-Details kommen in das passende [`docs/module/`](docs/module/)-Tiefendoc, **nicht** in diese Tabelle. Tiefe Begründung der Schichtung (Domäne ↔ Anwendung ↔ Präsentation): [AGENTS.md › Architektur](AGENTS.md#architektur).

**Weitere Anlaufstellen:**

| Was | Wo |
|---|---|
| 🤝 Mitentwickeln (Einstieg + One-Command-Setup `npm run setup`) | [CONTRIBUTING.md](CONTRIBUTING.md) |
| 🐳 Im Container entwickeln (devcontainer / `docker compose up`, #388) | [CONTRIBUTING.md › Im Container entwickeln](CONTRIBUTING.md) · [`.devcontainer/`](.devcontainer/devcontainer.json) · [`docker-compose.yml`](docker-compose.yml) |
| 📖 Spiel-Doku (Story, Steuerung, Lernpfad) | [README.md](README.md) |
| 📋 Agenten-Regeln, Board-Workflow, Konventionen | [AGENTS.md](AGENTS.md) |
| 🎨 PixelLab-Assets (Liste + IDs) | [assets/pixellab/README.md](assets/pixellab/README.md) |
| 🔤 Pixelschrift fürs HUD (`KQPixel`/Silkscreen) | [`fonts.css`](fonts.css) (base64-`@font-face`) + Quelle/Lizenz in [`assets/fonts/`](assets/fonts/) (#189) |
| 🗺️ Tiled-Maps (`.tmj`) + Workflow | [assets/maps/README.md](assets/maps/README.md) |
| 🧪 Tests (Vitest) | [`test/`](test/) – Kern/Dispatch in `sim.test.ts`; die Simulator-Befehlsfamilien gespiegelt zu den `sim/`-Modulen unter [`test/sim/`](test/sim/) (docker/kubectl/rbac/helm/git/terraform/argocd/glab, gemeinsame Fixtures in `test/sim/helpers.ts`, #383); dazu `content.test.ts`, `quests.test.ts` u.a. |
| ✅ Backlog / TODOs | GitHub Issues + Project-Board (`gh issue list --state open --limit 500`, `gh project list --owner fluffels`) |

## ❓ Die vier Einstiegsfragen

- **Was ist das Spiel?** KubeQuest – ein 2D-Lernspiel (Phaser 3) für Docker/K8s/Helm/Terraform; die Spielwelt **ist** der Cluster. → [README.md](README.md)
- **Wie starte ich?** `npm install` → `npm run dev` → angezeigte Adresse im Browser. → Schnellstart oben.
- **Welches Ticket nehme ich?** Erst die **ganze** offene Liste holen (`gh issue list --state open --limit 500` – ohne `--limit` nur die 30 neuesten!), dann deterministisch nach **Priorität** (`prio:hoch` → `prio:mittel` → `prio:niedrig` → ohne Label), **innerhalb der Prio die niedrigste freie Nummer** (kein Assignee, kein offener PR/Branch/Worktree) – nicht nach Inhalt aussuchen. Sofort self-assignen. → [AGENTS.md › Kollisionsschutz](AGENTS.md#wo-die-todos-leben).
- **Wie schließe ich ab?** Tests grün + im Browser verifiziert → nach `main` mergen → Worktree/Branch aufräumen → Issue schließen. → [AGENTS.md › Git-Workflow](AGENTS.md#das-wichtigste-zuerst-harte-regeln).

---

**Vollständige Regeln & Begründungen: → [AGENTS.md](AGENTS.md). Bei Konflikt gilt AGENTS.md.**

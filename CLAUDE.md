# CLAUDE.md – Einstieg für KI-Agenten

> **Du bist ein Agent in diesem Repo? Hier findest du auf einen Blick alles zum Loslegen.**
> Die **ausführliche Arbeitsanweisung** (harte Regeln, Board-Workflow, Konventionen) steht in **[AGENTS.md](AGENTS.md)** – diese Datei ist der schnelle Einstieg, der dorthin führt.
> Was das Spiel **ist** (Story, Steuerung, Lernpfad), steht in der **[README.md](README.md)** – die ist spielerseitig, nicht für dich als Agent.

> ⭐ **Oberste Regel vor JEDER Änderung:** „Ist das okay, wenn Kubernia ein Spiel in **Stardew-Valley-Größe** wird?" Nur machen, wenn ja — diese Frage steht über allen ADRs/Konventionen. Was auffällt, aber gerade nicht dran ist → **Ticket anlegen**. Details: [AGENTS.md › Oberste Regel](AGENTS.md#-oberste-regel--über-allem-auch-über-den-adrs).

## ⚡ Schnellstart (in <1 Minute zum ersten Schritt)

```
1. npm run setup                            # einmalig: prüft Node, npm install, Tests+Typecheck+Arch-Check (oder nur npm install)
2. npm run dev                              # Dev-Server, angezeigte Adresse im Browser öffnen
3. docs/ticket-reihenfolge.md               # nächstes Ticket = oberstes freies Item der Board-Reihenfolge (gh project item-list 1 --owner fluffels --format json --limit 800; braucht read:project-Scope)
4. gh issue edit <nr> --add-assignee @me    # SOFORT claimen = "in Arbeit"-Marker, dann mit gh issue view <nr> prüfen
5. git fetch origin && git worktree add .claude/worktrees/kq-<nr> -b feature/kq-<nr>-<slug> origin/main   # eigener Worktree vom FRISCH geholten origin/main (nicht lokal veraltet, #772), bevor du Dateien anfasst
6. coden                                    # im Worktree umsetzen, deutsche Umlaute in Texten/Kommentaren
7. npm test                                 # muss grün sein (auch Negativfälle abdecken, Red-Green)
8. npm run typecheck                        # muss grün sein (strict)
9. npm run lint                             # muss grün sein (ESLint, #389) – im Browser sichtbare Änderungen zusätzlich anschauen
10. ggf. Doku im SELBEN Branch anpassen → Branch pushen → EIN PR (gh pr create, Body "Closes #<nr>") → CI abwarten + bis Merge bringen (gh pr merge --squash --delete-branch --auto; rot → fixen bis grün) → Worktree aufräumen → Issue schließt via Closes   # ein PR pro Ticket (#618), fertig erst wenn gemergt; PR-gegated seit #592; keine Reihenfolge-Datei mehr pflegen (#627)
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
| **Alle Gates auf einmal – das eine Kommando vor dem Merge (#527)** | `npm run verify` (typecheck → lint → check:arch → check:size → check:contextsize → check:anysuppress → check:docmap → check:docdrift → check:lockfile → check:diffsize → test) |
| Voller Vor-Push-Check inkl. beider Builds + Boot-Smoke (#527) | `npm run verify:full` (= `verify` + `test:coverage` + Builds + `check:bundle` + `test:smoke`) |
| Required-Checks auf dem PR = maßgeblicher Gate (server-seitig, seit #592) | Merge nur über `gh pr merge` bei grüner CI; kein Direkt-Push auf `main` |
| pre-push-Hook (fährt `verify`; seit #592 nur noch sekundäres Netz) | verdrahtet via `npm run setup`; greift nur bei Push auf `main` (server-seitig ohnehin blockiert) |
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
| Quiz-Korrektheits-Golden nach bewusstem Review aktualisieren (#597) | `npm run quiz:golden` |
| Sprite-Sheets aus Quell-PNGs neu packen (nach Asset-Aenderung, #339) | `npm run pack:sprites` |
| Architektur-Wächter (Schichtung + Zyklen + Orphans, #347/#390) | `npm run check:arch` |
| Dateigröße-Wächter (God-File-Budget 800 LOC, #390) | `npm run check:size` |
| Root-Kontextdatei-Wächter (Zeilenbudget für AGENTS.md/CLAUDE.md, #719) | `npm run check:contextsize` |
| Tiefendoc-Abdeckungs-Wächter (jede `src/`-Datei in einem `docs/module/`-Tiefendoc, #482/#907) | `npm run check:docmap` |
| Harness-Drift-Wächter (dokumentierte `npm run`-Kommandos + interne Doku-Links/Anker, #529) | `npm run check:docdrift` |
| Doku-Aktualitäts-Wächter (offen-markierte Roadmap-Tickets gegen den gh-Status, non-blocking, braucht `gh`, #610) | `npm run check:doctickets` |
| TS-7-Freigabe-Wächter (npm-Registry: erlaubt typescript-eslint schon TS 7? non-blocking, braucht Netz, #847) | `npm run check:tseslint-ts7` |
| Diff-Größenbudget-Wächter (max. 20 Dateien / 800 geänderte Zeilen gegen main, #533) | `npm run check:diffsize` |
| `no-explicit-any`-Suppression-Ratchet (per-Datei-Baseline, #604) | `npm run check:anysuppress` (neu ziehen: `node scripts/check-any-suppressions.mjs --write`) |
| Lockfile-Integritäts-Wächter (package-lock.json ↔ package.json, gegen Lockfile-Drift, #593) | `npm run check:lockfile` |
| Bundle-Byte-Budget-Wächter (Offline-HTML + Spielcode- + Phaser-vendor-Chunk, NACH den Builds, #503/#595) | `npm run check:bundle` |
| Duplikations-Report (jscpd, **weich/nicht-blockierend** — kein Gate, nur CI-Artefakt, #612) | `npm run check:duplication` |
| Security-Audit (Produktiv-Deps, CI-Gate blockt bei high+, #396) | `npm audit --omit=dev --audit-level=high` |

> ⚠️ **Code-Änderungen laden im Dev-Server NICHT automatisch neu** (#301). Eine JS/TS-Änderung löst bewusst keinen Auto-Reload aus (der riss sonst mitten im Spielen laufende Gespräche weg + blaues Flackern, v.a. wenn parallele Agenten editieren). Stattdessen erscheint ein Toast „🔄 Code geändert – neu laden (F5)". Zum Übernehmen also **F5 / Seite neu laden** (Spielstand bleibt erhalten – seit #350 in IndexedDB). CSS-Edits swappen weiterhin live.

## 🗺️ Repo-Landkarte – wo finde ich was?

**Code** (`src/`, gebaut mit Vite + TypeScript + Phaser 4). Gliederung nach Subsystem — alle Module je Subsystem im zugehörigen Tiefendoc unter [`docs/module/`](docs/module/) (on-demand, nur lesen wenn du dort arbeitest):

| Subsystem | Schicht(en) | Tiefendoc |
|---|---|---|
| `src/sim.ts` + `src/sim/` | pure Domäne | [sim.md](docs/module/sim.md) — Cluster-Simulator-Kern + Befehlsfamilien, Split #346/#372–#385 |
| `src/content.ts` + `src/content/` | pure Domäne | [content.md](docs/module/content.md) — Content-as-Data (#348/#349/#352/#368): Loader/Schema/Checks/Drills |
| `src/world/` + `src/core/` + `src/hud/` + `src/crashreport.ts` | pure Domäne | [world.md](docs/module/world.md) — Welt/Karten/HUD-Logik: Geometrie, Autotile #340, Hitbox, Inseln |
| `src/game.ts` + `src/game/` + `src/store.ts` + `src/store/` + `src/runtime.ts` + `src/devpanel.ts` + `src/types.ts` | Anwendung/Persistenz | [app.md](docs/module/app.md) — `game.ts`/`sanitizeState`, SaveStore/IndexedDB #350, Spiel-Zeit #413 |
| `src/scenes.ts` + `src/scenes/` + `src/ui.ts` + `src/ui/` + `src/sfx.ts` + `src/main.ts` + `src/assets-data.ts` | Präsentation/Einstieg | [presentation.md](docs/module/presentation.md) — Szenen-Split #345, UI-Split #356, SFX/Assets |

> **Konvention (Stardew-skalierbar, #907):** Neues `src/`-Modul → Backtick-Pfad-Zeile im passenden [`docs/module/`](docs/module/)-Tiefendoc (Datei · kurzer Zweck). Diese Übersicht bleibt Subsystem-granular (wächst sub-linear zur Modul-Zahl). Tiefe Begründung der Schichtung: [AGENTS.md › Architektur](AGENTS.md#architektur). **Maschinell bewacht (#482/#907):** `npm run check:docmap` (CI-Gate + `test/docmap.test.ts`) meldet jede `src/`-Datei ohne Tiefendoc-Erwähnung — die Abdeckung kann nicht mehr leise veralten.

## 🧭 Schichtregeln beim Arbeiten im Verzeichnis (welche Imports gelten wo, #472)

Die Landkarte oben sagt, **wo** ein Modul liegt; diese Tabelle sagt, **was du importieren darfst**, sobald du in einem Bereich arbeitest. Die **harten** Regeln (❌) sind keine Bitte, sondern werden von **`npm run check:arch`** (dependency-cruiser, #347) als CI-Gate erzwungen — eine Verletzung ist **rot**, nicht nur unschön. EINE Quelle der Schicht-Grenzen: [`scripts/layers.cjs`](scripts/layers.cjs); das *Warum* der Schichtung: [AGENTS.md › Architektur](AGENTS.md#architektur).

| Wenn du hier arbeitest | Schicht | Darf importieren | ❌ Verboten (hart, `check:arch`) |
|---|---|---|---|
| `src/sim/*`, `src/content/*`, `src/world/*`, `src/core/*`, `src/hud/*`, `src/types.ts` … (= alles unter `src/`, das **nicht** in den drei Zeilen darunter steht) | **pure Domäne** | nur andere pure Domäne | `phaser`, `scenes`/`ui`/`sfx` |
| `src/game/*`, `src/runtime.ts`, `src/devpanel.ts`, `src/store/*` | **Anwendung/Persistenz** | pure Domäne (nur „nach unten") | `phaser`, `scenes`/`ui`/`sfx` |
| `src/scenes/*`, `src/ui/*`, `src/sfx.ts` | **Präsentation** | alles (nach unten offen) | *(keine Import-Regel — aber ACL beachten, s.u.)* |
| `src/main.ts`, `src/assets-data.ts` | **Einstieg/Assets** | alles (bootet Phaser + Szenen) | *(bewusst ausgenommen)* |

**Zusätzlich überall hart (`check:arch`, #390):** keine **Import-Zyklen** (geteilten Zustand nach [`src/runtime.ts`](src/runtime.ts) ziehen bzw. ein Host-Interface einführen — nicht die Regel aufweichen) und keine **verwaisten Module** (toter Code: einbinden oder löschen).

**Weiche Konvention für die Präsentation (kein `check:arch`, aber gewollt):** Die Präsentation *darf* technisch nach unten alles importieren — die Übersetzung Hafen ↔ Sim läuft aber bewusst nur über die **Anti-Corruption-Layer** an genau zwei Stellen ([`src/scenes/worldscene/clustersync.ts`](src/scenes/worldscene/clustersync.ts) für den Cluster→Welt-Sync, [`src/hud/markup.ts`](src/hud/markup.ts) für Content-Texte), **nicht** als verstreute Sim-Zugriffe quer durch die UI. Warum: [docs/glossar.md](docs/glossar.md).

**Braucht ein Bereich eigene, tiefe Regeln → modul-lokale `AGENTS.md`, statt diese Datei aufzublähen.** Dafür gibt es den **Kontext-Selektor** (#483): sehr detaillierte Bereichs-Konventionen liegen in einer `src/<bereich>/AGENTS.md`, die du **nur liest, wenn du dort arbeitest** — Vorbild [`src/content/AGENTS.md`](src/content/AGENTS.md) (Content-as-Data). Das ist die **Vorstufe zu Sub-CLAUDE.mds**: Wächst ein Modul so, dass ein Agent ohne Tiefenkontext regelmäßig falsch liegt, bekommt es eine eigene lokale Regel-Datei — statt die Root-CLAUDE.md (die JEDE Session lädt) zu überfrachten.

**Weitere Anlaufstellen:**

| Was | Wo |
|---|---|
| 🤝 Mitentwickeln (Einstieg + One-Command-Setup `npm run setup`) | [CONTRIBUTING.md](CONTRIBUTING.md) |
| 🐳 Im Container entwickeln (devcontainer / `docker compose up`, #388) | [CONTRIBUTING.md › Im Container entwickeln](CONTRIBUTING.md) · [`.devcontainer/`](.devcontainer/devcontainer.json) · [`docker-compose.yml`](docker-compose.yml) |
| 🚀 Container-Deploy (Spiel-Image bauen + lokal starten, #752) | [docs/deploy.md](docs/deploy.md) |
| 📖 Spiel-Doku (Story, Steuerung, Lernpfad) | [README.md](README.md) |
| 📋 Agenten-Regeln, Board-Workflow, Konventionen | [AGENTS.md](AGENTS.md) |
| ❓ Häufige Fragen zum Agenten-Harness (FAQ) | [docs/agent-harness-faq.md](docs/agent-harness-faq.md) |
| 🏗️ Architektur (arc42 + C4/Mermaid-Diagramme §5) | [docs/arc42-architektur.md](docs/arc42-architektur.md) |
| 🗣️ Glossar (Hafen↔K8s↔Code) + Kontext-Landkarte der Subdomänen | [docs/glossar.md](docs/glossar.md) – welche Sprache/welcher Context gilt in welchem Verzeichnis (Token-lokal arbeiten) |
| 🎨 PixelLab-Assets (Liste + IDs) | [assets/pixellab/README.md](assets/pixellab/README.md) |
| 🔤 Pixelschrift fürs HUD (`KQPixel`/Silkscreen) | [`fonts.css`](fonts.css) (base64-`@font-face`) + Quelle/Lizenz in [`assets/fonts/`](assets/fonts/) (#189) |
| 🗺️ Tiled-Maps (`.tmj`) + Workflow | [assets/maps/README.md](assets/maps/README.md) |
| 🧪 Tests (Vitest) | [`test/`](test/) – Kern/Dispatch in `sim.test.ts`; die Simulator-Befehlsfamilien gespiegelt zu den `sim/`-Modulen unter [`test/sim/`](test/sim/) (docker/kubectl/rbac/helm/git/terraform/argocd/glab, #383); dazu `content.test.ts`, `quests.test.ts` u.a. **Geteiltes Harness (#475):** Querschnitts-Umgebung (window/localStorage-Stub + Spiel-Stack laden) in [`test/support/`](test/support/), valide Domänen-Eingaben/Factories in [`test/factories/`](test/factories/) (`freshSim`; `test/sim/helpers.ts` re-exportiert daraus). Verhaltens-Tests prüfen die öffentliche API/beobachtbares Verhalten, nicht Interna – die Architektur-**Fitness-Functions** (`layering.test.ts`/`filesize.test.ts`/`docmap.test.ts`, #482) sind bewusst eine eigene Kategorie. |
| 🚦 Boot- & Interaktions-Smokes (Playwright, E2E) | [`e2e/`](e2e/) – lädt den gebauten Offline-Build headless: Boot fehlerfrei (#391) **plus** schlanke Interaktions-Smokes (#480: Terminal-Eingabe, Overlay auf/zu, ein Quest-Durchlauf) **plus** ein FPS-Budget- und ein a11y-Smoke (#524: `perf-smoke.spec.ts` liest die auf `body[data-kq-fps]` gespiegelten FrameSampler-FPS bei `?perf`; `a11y-smoke.spec.ts` scannt HUD + Overlays mit axe-core) über Tastatur/DOM ohne Test-Hintertür; geteilte Helfer in [`e2e/support.ts`](e2e/support.ts). **Plus** der Lern-Loop-Smoke (#602: `learning-loop.spec.ts` spielt Onboarding → Docker-Quest bei Bo (Terminal-Aufgabe/Drill/Inline-Quiz) → Kralle-Quiz über die echte UI) – als EINZIGER Smoke gegen den **Dev-Build** (nutzt `window.kqGame` nur, um die Figur an den NPC zu setzen, weil Blind-Navigation headless nicht robust ist; Details im Datei-Kopf), Playwright startet dafür den Vite-Dev-Server (`webServer`). Config: [`playwright.config.ts`](playwright.config.ts) (`workers: 1`, damit die FPS-Messung nicht durch parallele Runs einbricht). Bewusst getrennt von den Vitest-Unit-Tests (`npm run smoke`). |
| ✅ Backlog / TODOs | GitHub Issues + Project-Board (`gh issue list --state open --limit 500`, `gh project list --owner fluffels`) |
| 🥇 Nächstes Ticket (Auswahl-Regel) | [docs/ticket-reihenfolge.md](docs/ticket-reihenfolge.md) – oberstes freies Item der Board-Reihenfolge (Drag & Drop, kein Prio-Feld, keine Datei-Pflege) |
| 🚀 Spiel deployen (Helm-Chart, lokaler Cluster) | [docs/deploy.md](docs/deploy.md) – `helm install kubernia ./deploy/chart`, kind/minikube, values |

## ❓ Die vier Einstiegsfragen

- **Was ist das Spiel?** Kubernia – ein 2D-Lernspiel (Phaser 4) für Docker/K8s/Helm/Terraform; die Spielwelt **ist** der Cluster. → [README.md](README.md)
- **Wie starte ich?** `npm install` → `npm run dev` → angezeigte Adresse im Browser. → Schnellstart oben.
- **Welches Ticket nehme ich?** Das **oberste freie Item der Board-Ansicht**, gelesen aus dem Project-Board (`gh project item-list 1 --owner fluffels --format json --limit 800`, braucht `read:project`-Scope; frei = kein Assignee per `gh issue view`, kein offener PR/Branch/Worktree, nicht `status:zurückgestellt`, kein offener Blocker). Nur **dieses eine** Kandidaten-Ticket prüfen, nicht die ganze Liste. Sofort self-assignen. Auswahl-Befehl: [Ticket-Auswahl](docs/ticket-reihenfolge.md). → [AGENTS.md › Wo die TODOs leben](AGENTS.md#wo-die-todos-leben).
- **Wie schließe ich ab?** Tests grün + im Browser verifiziert → **ein PR** (Body `Closes #<nr>`) auf dem Feature-Branch → **CI abwarten und bis zum Merge bringen** (Auto-Merge + `gh pr checks --watch`; grün → mergt, rot → fixen bis grün) → Worktree aufräumen → Issue schließt via `Closes`. **Keine Reihenfolge-Datei mehr pflegen** (entfällt seit #627). **Ein PR pro Ticket (#618); fertig erst, wenn der PR gemergt ist.** PR-gegated seit #592, kein Direkt-Push auf `main`. → [AGENTS.md › Git-Workflow](AGENTS.md#das-wichtigste-zuerst-harte-regeln).

---

**Vollständige Regeln & Begründungen: → [AGENTS.md](AGENTS.md). Bei Konflikt gilt AGENTS.md.**

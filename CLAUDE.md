# CLAUDE.md – Brücke zur Arbeitsanweisung (+ Referenz-Tabellen)

@AGENTS.md

> ⬆️ **Die Zeile darüber ist kein Verweis, sondern ein Import (#992).** Claude Code lädt `CLAUDE.md` automatisch, **`AGENTS.md` nicht** — ein reiner Prosa-Zeiger würde darauf setzen, dass jeder Agent freiwillig nachliest. Der `@`-Import zieht die SSOT [AGENTS.md](AGENTS.md) verlässlich in **jede** Session, ohne dass hier eine einzige Regel abgeschrieben werden muss. Tool-neutral bleibt es trotzdem: wer den `@`-Import nicht auswertet (Gemini CLI, Cloud-Agenten, Mensch), folgt demselben Link — **verbindlich, nicht optional: ohne AGENTS.md gelesen zu haben, fängst du nicht an.** Beim Umbau gegengeprüft: **ohne** die Import-Zeile war AGENTS.md nachweislich **nicht** im Sitzungskontext, **mit** ihr ist es drin; dass sie nicht still verschwindet (umformuliert, in einen Codeblock verschoben, in Backticks gesetzt), bewacht [`test/claude-bridge.test.ts`](test/claude-bridge.test.ts) — derselbe Wächter wird auch rot, wenn irgendeine Doku dieser Datei wieder eine abgelegte Rolle (`Schnellstart`, `Datei-für-Datei`-Landkarte) zuschreibt, denn genau diese Prosa-Drift hat #992 ausgelöst.

## 🧭 Rollentrennung – was steht wo (#992)

| Datei | Rolle | Inhalt |
|---|---|---|
| **[AGENTS.md](AGENTS.md)** | **SSOT – bei Konflikt maßgeblich** | **jede harte Regel genau einmal**: Git-/PR-Workflow, Ticket-Auswahl + Claim-/Worktree-Pflicht, Test-/TDD-/Doku-Disziplin, Gate-Philosophie, das *Warum* der Schichtung |
| **CLAUDE.md** (hier) | **Brücke + Referenz-Heimat** | der Import oben, die Erste-Minute-Mechanik und die vier Nachschlage-Tabellen, auf die AGENTS.md/README/CONTRIBUTING **verweisen**: Befehle, Repo-Landkarte, Schichtregeln, Anlaufstellen |
| **[README.md](README.md)** | spielerseitig | was das Spiel *ist* (Story, Steuerung, Lernpfad) – nicht für dich als Agent |

**Warum die Tabellen hier bleiben statt nach AGENTS.md zu wandern:** Sie sind **Referenz zum Nachschlagen, keine Regeln** — und rund 15 Stellen (AGENTS.md, README, CONTRIBUTING, das Glossar, arc42, alle `docs/module/`-Köpfe) zeigen bereits hierher; fünf npm-Skripte sind **ausschließlich** in der Befehle-Tabelle dokumentiert, `check:docdrift`-Regel 2 hängt also daran. **Der Text einer Regel**, den du hier wiederholt findest, ist dagegen ein **Drift-Bug** → zurück nach AGENTS.md führen, statt ihn an zwei Orten zu pflegen.

> **Die zwei bewusst gedoppelten Dinge — Absicht, nicht Zufall** (identisch deklariert in [AGENTS.md](AGENTS.md), damit die Grenze nicht selbst driftet):
> - ⭐ **Die oberste Regel**, weil sie über allen ADRs/Konventionen steht und in Sekunde 1 sichtbar sein muss (verbindlich formuliert in [AGENTS.md › Oberste Regel](AGENTS.md#-oberste-regel--über-allem-auch-über-den-adrs)): „Ist das okay, wenn Kubernia ein Spiel in **Stardew-Valley-Größe** wird?" — nur umsetzen, wenn ja. Was auffällt, aber gerade nicht dran ist → **Ticket anlegen**.
> - 🚦 **Die Gate-Markierungen in den Tabellen unten** („hart", „❌ verboten, erzwingt `check:arch`"). Eine Referenz-Tabelle, die verschweigt, was maschinell erzwungen wird, führt in die Irre. Sie geben die **maschinelle** SSOT wieder ([`scripts/layers.cjs`](scripts/layers.cjs), `.dependency-cruiser.cjs`, die `scripts/check-*.mjs`) — nicht eine zweite Fassung der Verhaltens-Regeln („kein Grün-durch-Aufweichen", „was muss wann grün sein"): die stehen ausschließlich in AGENTS.md.

## ⚡ Erste Minute (nur Mechanik – der Ablauf steht in AGENTS.md)

```bash
npm run setup   # einmalig: Node-Check, npm install, Git-Hooks, alle Checks (Minimalweg: npm install)
npm run dev     # Dev-Server – angezeigte Adresse im Browser öffnen
npm run verify  # alle schnellen Gates auf einmal (wann sie grün sein müssen: AGENTS.md)
```

**Der verbindliche Ticket-Ablauf** — Board-Auswahl, sofortiges Claimen, eigener Worktree von **frisch geholtem** `origin/main`, Umsetzung test-first, Doku im selben Branch, **ein** PR bis zum Merge — steht **nicht hier**, sondern in [AGENTS.md › Das Wichtigste zuerst](AGENTS.md#das-wichtigste-zuerst-harte-regeln) und [AGENTS.md › Wo die TODOs leben](AGENTS.md#wo-die-todos-leben). Durch den Import oben ist er schon in deinem Kontext — lies ihn dort, nicht aus dem Gedächtnis.

⚠️ **Die rohe `index.html` im Root ist die Dev-Version** und braucht den Vite-Server; per Doppelklick geöffnet bleibt die Seite leer. Zum Offline-Spielen `npm run build:offline`, dann `dist-offline/index.html` doppelklicken. (Dass eine JS/TS-Änderung im Dev-Server **keinen** Auto-Reload auslöst und du bewusst F5 drücken musst, steht in [AGENTS.md › Im Browser verifizieren](AGENTS.md#das-wichtigste-zuerst-harte-regeln).)

## 🛠️ Befehle

> **Kanonische Heimat** (nicht doppelt gepflegt): AGENTS.md, [CONTRIBUTING.md](CONTRIBUTING.md) und die README verweisen hierher, statt eigene Listen zu führen. Manche Skripte sind **nur** hier dokumentiert — eine Zeile entfernen ⇒ `check:docdrift` wird rot.

| Zweck | Befehl |
|---|---|
| One-Command-Setup (Node-Check + install + Git-Hooks + alle Checks, #387/#528) | `npm run setup` |
| **Alle Gates auf einmal – das eine Kommando vor dem Merge (#527)** | `npm run verify` (typecheck → lint → check:arch → check:size → check:contextsize → check:anysuppress → check:docmap → check:docdrift → check:internalrefs → check:lockfile → check:diffsize → test) |
| Voller Vor-Push-Check inkl. beider Builds + Boot-Smoke (#527) | `npm run verify:full` (= `verify` + `test:coverage` + `check:diffcoverage` + Builds + `check:bundle` + `test:smoke`) |
| Required-Checks auf dem PR = maßgeblicher Gate (server-seitig, seit #592) | `gh pr merge <nr> --squash --delete-branch --auto` + `gh pr checks <nr> --watch` (Regel-Heimat: [AGENTS.md](AGENTS.md#das-wichtigste-zuerst-harte-regeln)) |
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
| Stale Suppressions prunen / Baseline neu aufbauen (Komplexität #502 + Typsicherheit #868) | `npm run lint:prune` / `npm run lint:suppress` |
| Quiz-Korrektheits-Golden nach bewusstem Review aktualisieren (#597) | `npm run quiz:golden` |
| Sprite-Sheets aus Quell-PNGs neu packen (nach Asset-Aenderung, #339) | `npm run pack:sprites` |
| Architektur-Wächter (Schichtung + Zyklen + Orphans, #347/#390) | `npm run check:arch` |
| Dateigröße-Wächter (God-File-Budget 800 LOC, #390) | `npm run check:size` |
| Root-Kontextdatei-Wächter (Zeilenbudget für AGENTS.md/CLAUDE.md, #719) | `npm run check:contextsize` |
| Tiefendoc-Abdeckungs-Wächter (jede `src/`-Datei in einem `docs/module/`-Tiefendoc, #482/#907) | `npm run check:docmap` |
| Harness-Drift-Wächter (dokumentierte `npm run`-Kommandos + interne Doku-Links/Anker, #529) | `npm run check:docdrift` |
| Interne-Referenzen-Wächter (Arbeitgeber-/Kundenbezüge aus dem öffentlichen Repo halten, #990) | `npm run check:internalrefs` (Begriff ergänzen: `node scripts/check-internalrefs.mjs --add "<begriff>"`) |
| Doku-Aktualitäts-Wächter (offen-markierte Roadmap-Tickets gegen den gh-Status, non-blocking, braucht `gh`, #610) | `npm run check:doctickets` |
| TS-7-Freigabe-Wächter (npm-Registry: erlaubt typescript-eslint schon TS 7? non-blocking, braucht Netz, #847) | `npm run check:tseslint-ts7` |
| Diff-Größenbudget-Wächter (max. 20 Dateien / 800 geänderte Zeilen gegen main, #533) | `npm run check:diffsize` |
| Diff-Coverage-Wächter (geänderte Zeilen pro Slice getestet; **hart** für Domäne/Anwendung, Präsentation/Einstieg nur berichtend; läuft **NACH `test:coverage`**, #1021) | `npm run check:diffcoverage` |
| `no-explicit-any`-Suppression-Ratchet (per-Datei-Baseline, #604) | `npm run check:anysuppress` (neu ziehen: `node scripts/check-any-suppressions.mjs --write`) |
| Lockfile-Integritäts-Wächter (package-lock.json ↔ package.json, gegen Lockfile-Drift, #593) | `npm run check:lockfile` |
| Bundle-Byte-Budget-Wächter (Offline-HTML + Spielcode- + Phaser-vendor-Chunk, NACH den Builds, #503/#595) | `npm run check:bundle` |
| Duplikations-Report (jscpd, **weich/nicht-blockierend** — kein Gate, nur CI-Artefakt, #612) | `npm run check:duplication` |
| Security-Audit (Produktiv-Deps, CI-Gate blockt bei high+, #396) | `npm audit --omit=dev --audit-level=high` |

> Aus IntelliJ/WebStorm gibt es dieselben Befehle als Ein-Klick-Run-Configs: [CONTRIBUTING.md › Aus IntelliJ starten](CONTRIBUTING.md#aus-intellij-starten-ein-klick) — bewusst **dort**, weil Menschen-IDE-Komfort keine Tokens in einer Datei kosten soll, die JEDE Agenten-Session lädt (#719/#992).

## 🗺️ Repo-Landkarte – wo finde ich was?

> **Kanonische Heimat** (#394/#907): AGENTS.md, README, CONTRIBUTING, das Glossar, arc42 und alle `docs/module/`-Köpfe verweisen hierher — die Datei-Landkarte gibt es genau einmal.

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

Die Landkarte oben sagt, **wo** ein Modul liegt; diese Tabelle sagt, **was du importieren darfst**, sobald du in einem Bereich arbeitest. Die **harten** Regeln (❌) sind keine Bitte, sondern werden von **`npm run check:arch`** (dependency-cruiser, #347) als CI-Gate erzwungen — eine Verletzung ist **rot**, nicht nur unschön. EINE Quelle der Schicht-Grenzen: [`scripts/layers.cjs`](scripts/layers.cjs) — diese Tabelle liest sie nur ab. Das *Warum* der Schichtung: [AGENTS.md › Architektur](AGENTS.md#architektur); wie mit einem roten Gate umzugehen ist (**kein Grün-durch-Aufweichen**): [AGENTS.md](AGENTS.md#das-wichtigste-zuerst-harte-regeln).

| Wenn du hier arbeitest | Schicht | Darf importieren | ❌ Verboten (hart, `check:arch`) |
|---|---|---|---|
| `src/sim/*`, `src/content/*`, `src/world/*`, `src/core/*`, `src/hud/*`, `src/types.ts` … (= alles unter `src/`, das **nicht** in den drei Zeilen darunter steht) | **pure Domäne** | nur andere pure Domäne | `phaser`, `scenes`/`ui`/`sfx` |
| `src/game/*`, `src/runtime.ts`, `src/devpanel.ts`, `src/store/*` | **Anwendung/Persistenz** | pure Domäne (nur „nach unten") | `phaser`, `scenes`/`ui`/`sfx` |
| `src/scenes/*`, `src/ui/*`, `src/sfx.ts` | **Präsentation** | alles (nach unten offen) | *(keine Import-Regel — aber ACL beachten, s.u.)* |
| `src/main.ts`, `src/assets-data.ts` | **Einstieg/Assets** | alles (bootet Phaser + Szenen) | *(bewusst ausgenommen)* |

**Zusätzlich überall hart (`check:arch`, #390):** keine **Import-Zyklen** (geteilten Zustand nach [`src/runtime.ts`](src/runtime.ts) ziehen bzw. ein Host-Interface einführen — nicht die Regel aufweichen) und keine **verwaisten Module** (toter Code: einbinden oder löschen).

**Weiche Konvention für die Präsentation (kein `check:arch`, aber gewollt):** Die Präsentation *darf* technisch nach unten alles importieren — die Übersetzung Hafen ↔ Sim läuft aber bewusst nur über die **Anti-Corruption-Layer** an genau zwei Stellen ([`src/scenes/worldscene/clustersync.ts`](src/scenes/worldscene/clustersync.ts) für den Cluster→Welt-Sync, [`src/hud/markup.ts`](src/hud/markup.ts) für Content-Texte), **nicht** als verstreute Sim-Zugriffe quer durch die UI. Warum: [docs/glossar.md](docs/glossar.md).

**Tiefe Bereichs-Konventionen liegen modul-lokal** — `src/<bereich>/AGENTS.md`, die du **nur liest, wenn du dort arbeitest** (Kontext-Selektor #483; Vorbild [`src/content/AGENTS.md`](src/content/AGENTS.md), Content-as-Data). Die Auslagerungs-Regel dazu (was hierher darf und was nicht) steht in [AGENTS.md](AGENTS.md#das-wichtigste-zuerst-harte-regeln).

## 📚 Weitere Anlaufstellen

| Was | Wo |
|---|---|
| 📋 **Agenten-Regeln, Board-Workflow, Konventionen (SSOT)** | **[AGENTS.md](AGENTS.md)** – oben importiert; bei Konflikt maßgeblich |
| 🤝 Mitentwickeln (Einstieg + One-Command-Setup `npm run setup`, IntelliJ-Run-Configs) | [CONTRIBUTING.md](CONTRIBUTING.md) |
| 🐳 Im Container entwickeln (devcontainer / `docker compose up`, #388) | [CONTRIBUTING.md › Im Container entwickeln](CONTRIBUTING.md) · [`.devcontainer/`](.devcontainer/devcontainer.json) · [`docker-compose.yml`](docker-compose.yml) |
| 🚀 Container-Deploy (Spiel-Image bauen + lokal starten, #752) | [docs/deploy.md](docs/deploy.md) |
| 📖 Spiel-Doku (Story, Steuerung, Lernpfad) | [README.md](README.md) |
| ❓ Häufige Fragen zum Agenten-Harness (FAQ) | [docs/agent-harness-faq.md](docs/agent-harness-faq.md) |
| 🏗️ Architektur (arc42 + C4/Mermaid-Diagramme §5) | [docs/arc42-architektur.md](docs/arc42-architektur.md) |
| 🗣️ Glossar (Hafen↔K8s↔Code) + Kontext-Landkarte der Subdomänen | [docs/glossar.md](docs/glossar.md) – welche Sprache/welcher Context gilt in welchem Verzeichnis (Token-lokal arbeiten) |
| 🎨 PixelLab-Assets (Liste + IDs) | [assets/pixellab/README.md](assets/pixellab/README.md) |
| 🔤 Pixelschrift fürs HUD (`KQPixel`/Silkscreen) | [`fonts.css`](fonts.css) (base64-`@font-face`) + Quelle/Lizenz in [`assets/fonts/`](assets/fonts/) (#189) |
| 🗺️ Tiled-Maps (`.tmj`) + Workflow | [assets/maps/README.md](assets/maps/README.md) |
| 🧪 Tests (Vitest) | [`test/`](test/) – Kern/Dispatch in `sim.test.ts`; die Simulator-Befehlsfamilien gespiegelt zu den `sim/`-Modulen unter [`test/sim/`](test/sim/) (docker/kubectl/rbac/helm/git/terraform/argocd/glab, #383); dazu `content.test.ts`, `quests.test.ts` u.a. **Geteiltes Harness (#475):** Querschnitts-Umgebung (window/localStorage-Stub + Spiel-Stack laden) in [`test/support/`](test/support/), valide Domänen-Eingaben/Factories in [`test/factories/`](test/factories/) (`freshSim`; `test/sim/helpers.ts` re-exportiert daraus). Verhaltens-Tests prüfen die öffentliche API/beobachtbares Verhalten, nicht Interna – die Architektur-**Fitness-Functions** (`layering.test.ts`/`filesize.test.ts`/`docmap.test.ts`/`claude-bridge.test.ts`/`harness-approval.test.ts`/`review-context.test.ts`, #482/#992/#1012/#1034) sind bewusst eine eigene Kategorie. |
| 🚦 Boot- & Interaktions-Smokes (Playwright, E2E) | [`e2e/`](e2e/) – lädt den gebauten Offline-Build headless: Boot fehlerfrei (#391) **plus** schlanke Interaktions-Smokes (#480: Terminal-Eingabe, Overlay auf/zu, ein Quest-Durchlauf) **plus** ein FPS-Budget- und ein a11y-Smoke (#524: `perf-smoke.spec.ts` liest die auf `body[data-kq-fps]` gespiegelten FrameSampler-FPS bei `?perf`; `a11y-smoke.spec.ts` scannt HUD + Overlays mit axe-core) über Tastatur/DOM ohne Test-Hintertür; geteilte Helfer in [`e2e/support.ts`](e2e/support.ts). **Plus** der Lern-Loop-Smoke (#602: `learning-loop.spec.ts` spielt Onboarding → Docker-Quest bei Bo (Terminal-Aufgabe/Drill/Inline-Quiz) → Kralle-Quiz über die echte UI) – als EINZIGER Smoke gegen den **Dev-Build** (nutzt `window.kqGame` nur, um die Figur an den NPC zu setzen, weil Blind-Navigation headless nicht robust ist; Details im Datei-Kopf), Playwright startet dafür den Vite-Dev-Server (`webServer`). Config: [`playwright.config.ts`](playwright.config.ts) (`workers: 1`, damit die FPS-Messung nicht durch parallele Runs einbricht). Bewusst getrennt von den Vitest-Unit-Tests (`npm run smoke`). |
| ✅ Backlog / TODOs | GitHub Issues + Project-Board (`gh issue list --state open --limit 500`, `gh project list --owner fluffels`) |
| 🥇 Nächstes Ticket (Auswahl-Regel) | [docs/ticket-reihenfolge.md](docs/ticket-reihenfolge.md) – oberstes freies Item der Board-Reihenfolge; **verbindlich** in [AGENTS.md › Wo die TODOs leben](AGENTS.md#wo-die-todos-leben) |
| 🚀 Spiel deployen (Helm-Chart, lokaler Cluster) | [docs/deploy.md](docs/deploy.md) – `helm install kubernia ./deploy/chart`, kind/minikube, values |

---

**Alles Verbindliche steht in → [AGENTS.md](AGENTS.md) (oben importiert). Bei Konflikt gilt AGENTS.md.**

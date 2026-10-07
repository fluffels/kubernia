# 📚 Anlaufstellen — der Index des Projekt-Brains

> On-demand-Referenz (#1078): **wo welches Wissen liegt und wann man es liest.** Das Projekt-Brain ist `docs/`, dies der Index ([ADR 0015](../adr/0015-projekt-brain.md)). **Lese-Konvention:** erst hier die eine passende Seite wählen. Brain-Seiten (`docs/**.md`) liest du mit dem `Read`-Tool, nie per `cat`/`sed`/`head`/`Get-Content`; große Seiten nur abschnittsweise (Überschrift greppen, dann `Read` mit `offset`/`limit`). Liegt der Checkout hinter `origin/main`, holt man die Seiten einmal gebündelt (`git archive` in den Scratchpad, dort `Read`); `git show origin/main:<pfad>` (mit `MSYS_NO_PATHCONV=1` in Git-Bash) bleibt die Ausnahme für Einzelfälle, weil es kein `Read`-Äquivalent gibt; das Messskript zählt es als Brain-Lesezugriff. Gegliedert nach den Wissensarten aus [ADR 0013](../adr/0013-docs-als-agentengepflegtes-wiki.md) (#1097). Jede Seite unter `docs/` ist von hier aus erreichbar. Die harten Regeln stehen ausschließlich in [AGENTS.md](../../AGENTS.md); hier steht nur *wo* und *wann*, kein Regeltext.
>
> **Nicht hierher gehören:** der laufende Stand (offene Arbeit, Reihenfolge, Blocker) → GitHub-Issues + Project-Board (`gh issue list --state open --limit 500`, `gh project list --owner fluffels`); abgeschlossene Arbeit → PR/Commit/Issue-Kommentar.

## 📋 Regeln — wie hier gearbeitet wird

Regeltext steht nur in diesen Dateien; alle anderen Seiten erklären oder schlagen nach.

| Seite | Wann lesen |
|---|---|
| **[AGENTS.md](../../AGENTS.md)** | vor jeder Arbeit — SSOT aller harten Regeln, bei Konflikt maßgeblich |
| [src/content/AGENTS.md](../../src/content/AGENTS.md) | bevor du Quests, NPCs oder Smalltalk anlegst oder änderst (Content-as-Data, Save-Migration) |

## ⚖️ Entscheidungen — ADRs (historisch, werden nicht umgeschrieben)

Bevor eine Grundsatzfrage neu diskutiert wird, erst hier nachsehen. Vollständiger Index (generiert) und ADR-Vorlage samt Kopf-Format: [adr/README.md](../adr/README.md). Einordnung im Architekturbild: [arc42 › Architekturentscheidungen](../arc42-architektur.md#9-architekturentscheidungen-adrs).

| ADR | Wann lesen |
|---|---|
| [0001 Engine Phaser](../adr/0001-engine-phaser.md) | wenn die Engine-Wahl (Phaser vs. Godot/Unity) oder ein nativer Wrapper zur Debatte steht |
| [0002 Kein Backend, keine DB](../adr/0002-kein-backend-keine-db.md) | wenn jemand Server, Datenbank oder Service-Aufteilung fürs Kern-Spiel vorschlägt |
| [0003 Multiplayer out of scope](../adr/0003-multiplayer-coop-out-of-scope.md) | wenn Co-op oder Multiplayer aufkommt |
| [0004 Skalierungs-Fundament](../adr/0004-skalierungs-fundament.md) | wenn es um Content-as-Data, Entity-Registry, ID-basierten Quest-Fortschritt oder IndexedDB-Saves geht |
| [0005 Auslieferungsform](../adr/0005-auslieferungsform.md) | wenn Web-App vs. Desktop-Download entschieden werden soll |
| [0006 Backend bei Stardew-Scope](../adr/0006-backend-und-skalierung.md) | wenn die Backend-Frage mit Blick auf Spielgröße neu aufkommt |
| [0007 Spielsystem-Fundamente](../adr/0007-spielsystem-fundamente.md) | bevor du am Quest-Modell, an Checks oder an der Spielzeit baust |
| [0008 KI-Agenten-Harness](../adr/0008-ki-agenten-harness.md) | wenn du verstehen willst, warum das Repo von Agenten gebaut wird und was daraus folgt |
| [0009 PR-Gating](../adr/0009-pr-gating-required-checks.md) | wenn Required-Checks, Branch-Schutz oder Direkt-Push zur Debatte stehen |
| [0010 Zwei Karten-Modelle](../adr/0010-karten-modell-tiled-vs-code-builder.md) | bevor du eine Karte baust: Tiled-Daten oder Code-Builder? |
| [0011 NPC-System-Fundament](../adr/0011-npc-system-fundament.md) | bevor du NPC-Zustand, Routinen oder Beziehungen anfasst |
| [0012 Harness-Autonomie](../adr/0012-harness-autonomie-audit-spur.md) | wenn es um Selbst-Merge von Leitplanken-Änderungen und die Audit-Spur geht |
| [0013 docs/ als Wiki](../adr/0013-docs-als-agentengepflegtes-wiki.md) | bevor du Doku anlegst oder umziehst — welche Wissensart wohin gehört |
| [0014 Leitplanken ohne Label-Riegel](../adr/0014-leitplanken-ohne-label-riegel.md) | wenn es um Gate-/Harness-Änderungen, die Pfadquelle und den Audit-Kommentar geht |
| [0015 Projekt-Brain](../adr/0015-projekt-brain.md) | wenn es um Prinzipien, Token-Ziel und Messung des Projekt-Brains geht |
| [0016 Langfuse-Takt](../adr/0016-langfuse-takt-woechentlich.md) | wenn es um den wöchentlichen Takt des Status-Tickets, das Langfuse-Sammelticket oder den Board-Takt (Harness-Sammelticket nach 5 Merges, Positionskorrektur) geht |
| [0017 Lebende Doku](../adr/0017-lebende-doku-generierte-abschnitte.md) | wenn Doku generiert, ein Gate beschrieben oder ein Diagramm eingeführt wird |
| [0018 Content-Chunks je Datei](../adr/0018-content-chunks-je-datei.md) | wenn der Spielcode-Chunk oder ein Bundle-Budget reißt, Content (Quests, Crabquiz, Karten) wächst oder Lazy-Load je Region zur Debatte steht |

## 🌱 Evergreen — lebendes Wissen, im selben PR gepflegt

### Spiel und Architektur

| Seite | Wann lesen |
|---|---|
| [README.md](../../README.md) | wenn du wissen willst, was das Spiel ist: Story, Steuerung, Lernpfad |
| [arc42-architektur.md](../arc42-architektur.md) | für die Gesamtarchitektur (arc42 + C4/Mermaid-Diagramme §5) |
| [glossar.md](../glossar.md) | wenn dir ein Begriff fehlt (Hafen ↔ K8s ↔ Code) oder du wissen willst, welcher Context in welchem Verzeichnis gilt |
| [repo-landkarte.md](repo-landkarte.md) | wenn du ein Subsystem suchst: welche Schicht, welches Tiefendoc |
| [module/sim.md](../module/sim.md) | beim Arbeiten am Cluster-Simulator (`src/sim/*`) |
| [module/content.md](../module/content.md) | für die Interna von Content-as-Data (Loader, Registry) |
| [module/content-questgraph.md](../module/content-questgraph.md) | für die Quest-Landkarte: welche Region hat welche Quests, wie hängen sie zusammen (generiert) |
| [module/world.md](../module/world.md) | bei Welt-, Karten- und HUD-Logik außerhalb der Szenen |
| [module/app.md](../module/app.md) | bei Spielstand, XP, Wirtschaft, Persistenz und Einstieg |
| [module/presentation.md](../module/presentation.md) | bei Szenen, UI, SFX und Assets (Phaser/DOM) |
| [performance-budget.md](../performance-budget.md) | bevor die Welt wächst: FPS- und Sprite-Budget, Culling, Messen |
| [stardew-referenz.md](../stardew-referenz.md) | vor jedem Optik-Ticket — so sieht das Vorbild wirklich aus |
| [art-direction.md](../art-direction.md) | lebende Abweichungsliste der Optik gegen die Messlatte — vor Optik-Tickets |

### Arbeitsablauf und Nachschlagen

| Seite | Wann lesen |
|---|---|
| [CONTRIBUTING.md](../../CONTRIBUTING.md) | als menschliche Mitentwicklerin: Einstieg, One-Command-Setup `npm run setup`, IntelliJ-Run-Configs, Dependabot-Policy, [Im Container entwickeln](../../CONTRIBUTING.md#im-container-entwickeln-optional-ohne-lokales-node) (devcontainer / `docker compose up`, #388) |
| [ticket-reihenfolge.md](../ticket-reihenfolge.md) | wenn du das nächste Ticket auswählst oder ein neues Issue im Board einsortierst |
| [befehle.md](befehle.md) | wenn du wissen willst, welches `npm run`-Kommando was tut |
| [schichtregeln.md](schichtregeln.md) | bevor du in `src/` einen neuen Import setzt oder ein Modul verschiebst (`check:arch`) |
| [doku-vorlagen.md](doku-vorlagen.md) | wenn du eine Wiki-Seite anlegst: Kopfzeilen „fachlich geprüft am" bzw. Schnappschuss-Hinweis |

### Harness

| Seite | Wann lesen |
|---|---|
| [agent-harness.md](../agent-harness.md) | wenn du verstehen willst, wie und warum der Agenten-Harness funktioniert (inkl. Langfassung der harten Regeln) |
| [agent-harness-faq.md](../agent-harness-faq.md) | wenn du über eine Harness-Falle stolperst (Worktrees unter Windows, Hooks, Gates) |
| [sicherheit-agenten.md](../sicherheit-agenten.md) | wenn ein Lauf Text Dritter liest oder du eine Sicherheitslücke des Harness einordnest |
| [model-routing.md](../model-routing.md) | wenn ein neues Modell erscheint oder du wissen willst, welche Phase auf welchem Modell läuft |
| [langfuse-hook-patch.md](../langfuse-hook-patch.md) | wenn das Plugin `langfuse-observability` aktualisiert wird, der Hook-Patch geprüft oder portiert werden muss oder Langfuse Turns vermisst |

### Betrieb, Assets, Tests

| Seite | Wann lesen |
|---|---|
| [deploy.md](../deploy.md) | wenn du das Spiel als Container oder per Helm-Chart in einen Cluster bringen willst (#752) |
| [devpanel-docker.md](../devpanel-docker.md) | wenn du das Dev-/Test-Panel als Docker-Image mit Laufzeit-Passwort brauchst |
| [`.devcontainer/`](../../.devcontainer/devcontainer.json) · [`docker-compose.yml`](../../docker-compose.yml) | wenn du im Container entwickelst |
| [assets/pixellab/README.md](../../assets/pixellab/README.md) | wenn du ein PixelLab-Asset suchst oder ablegst (Liste + IDs) |
| [assets/maps/README.md](../../assets/maps/README.md) | beim Arbeiten an Tiled-Maps (`.tmj`) |
| [`fonts.css`](../../fonts.css) · [`assets/fonts/`](../../assets/fonts/) | bei der HUD-Pixelschrift `KQPixel`/Silkscreen (Quelle + Lizenz, #189) |
| [`test/`](../../test/) | wenn du Tests schreibst: Querschnitts-Umgebung in [`test/support/`](../../test/support/), Factories in [`test/factories/`](../../test/factories/) (`freshSim`); Harness-Wächter (Kopf-Marker `@harness-waechter`, geschützt) in [`test/harness/`](../../test/harness/); Kategorien und Fitness-Functions erklärt [agent-harness.md](../agent-harness.md) |
| [`e2e/`](../../e2e/) | bei Boot-, Interaktions-, FPS-, a11y- und Lern-Loop-Smokes (Playwright, `npm run smoke`); Details in [agent-harness.md › Test-Harness und e2e-Smokes](../agent-harness.md#test-harness-und-e2e-smokes), den Datei-Köpfen und [`playwright.config.ts`](../../playwright.config.ts) |

## 📸 Schnappschüsse — datiert, werden nicht aktualisiert

Momentaufnahmen eines damaligen Stands. Lesen, um Herkunft und Begründung zu verstehen; den aktuellen Stand zeigen Code, Evergreen-Seiten und Issues.

| Seite | Wann lesen |
|---|---|
| [architektur-analyse-stardew.md](../architektur-analyse-stardew.md) | Historie: erste Frage, ob der Stack Stardew-Größe trägt (#46) |
| [architektur-analyse-2026-06.md](../architektur-analyse-2026-06.md) | Historie: Infrastruktur-Fokus Juni 2026 |
| [architektur-analyse-2026-07-iSAQB.md](../architektur-analyse-2026-07-iSAQB.md) | iSAQB-Runde 1 (2026-07-01), Herkunft von #492–#524 |
| [architektur-analyse-2026-07-02-iSAQB.md](../architektur-analyse-2026-07-02-iSAQB.md) | iSAQB-Runde 2 (2026-07-02), Herkunft von #577–#595 |
| [architektur-analyse-2026-07-03-iSAQB.md](../architektur-analyse-2026-07-03-iSAQB.md) | iSAQB-Runde 3 (2026-07-03): ADRs, DDD, Tests, Harness, Herkunft von #596–#612 |
| [architektur-analyse-2026-07-14-iSAQB.md](../architektur-analyse-2026-07-14-iSAQB.md) | doku-freie iSAQB-Runde vom 2026-07-14, Herkunft von #861–#880 |
| [art-direction-audit.md](../art-direction-audit.md) | Historie: Optik gegen die Stardew-Messlatte (#44, Juni 2026); lebender Stand in [art-direction.md](../art-direction.md) |
| [spielkonzept-review.md](../spielkonzept-review.md) | führt der Lernpfad zu Senior-DevOps und macht es Spaß? (#52, Juni 2026) |
| [lernpfad-audit.md](../lernpfad-audit.md) | wird ein Befehl benutzt, bevor er eingeführt ist? (#227, Juni 2026) |
| [barrierefreiheit-audit.md](../barrierefreiheit-audit.md) | Zugänglichkeit: nur-Farbe-Status, Tastatur, Kontraste (#481, Juli 2026) |

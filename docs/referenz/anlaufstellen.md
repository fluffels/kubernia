# 📚 Anlaufstellen — der Index des Projekt-Brains

> On-demand-Referenz (#1078): **wo welches Wissen liegt und wann man es liest.** Das Projekt-Brain ist `docs/`, dies der Index ([ADR 0015](../adr/0015-projekt-brain.md)). **Lese-Konvention:** erst hier die eine passende Seite wählen. Brain-Seiten (`docs/**.md`) liest du mit dem `Read`-Tool, nie per `cat`/`sed`/`head`/`Get-Content`; große Seiten nur abschnittsweise (Überschrift greppen, dann `Read` mit `offset`/`limit`). Liegt der Checkout hinter `origin/main`, holt man die Seiten einmal gebündelt (`git archive` in den Scratchpad, dort `Read`); `git show origin/main:<pfad>` (mit `MSYS_NO_PATHCONV=1` in Git-Bash) bleibt die Ausnahme für Einzelfälle, weil es kein `Read`-Äquivalent gibt; das Messskript zählt es als Brain-Lesezugriff. Gegliedert nach den Wissensarten aus [ADR 0013](../adr/0013-docs-als-agentengepflegtes-wiki.md) (#1097). Jede Seite unter `docs/` ist von hier aus erreichbar. Die harten Regeln stehen ausschließlich in [AGENTS.md](../../AGENTS.md); hier steht nur *wo* und *wann*, kein Regeltext.
>
> **Nicht hierher gehören:** der laufende Stand (offene Arbeit, Reihenfolge, Blocker) → GitHub-Issues + Project-Board (`gh issue list --state open --limit 500`, `gh project list --owner fluffels`); abgeschlossene Arbeit → PR/Commit/Issue-Kommentar.

## 📋 Regeln — wie hier gearbeitet wird

Regeltext steht nur in diesen Dateien; alle anderen Seiten erklären oder schlagen nach.

| Seite | Wann lesen |
|---|---|
| **[AGENTS.md](../../AGENTS.md)** | vor jeder Arbeit — SSOT aller harten Regeln, bei Konflikt maßgeblich |

<!-- factory-projekt:start -->

| Seite | Wann lesen |
|---|---|
| [src/content/AGENTS.md](../../src/content/AGENTS.md) | bevor du Quests, NPCs oder Smalltalk anlegst oder änderst (Content-as-Data, Save-Migration) |

<!-- factory-projekt:ende -->

## ⚖️ Entscheidungen — ADRs (historisch, werden nicht umgeschrieben)

Bevor eine Grundsatzfrage neu diskutiert wird, erst hier nachsehen. Vollständiger Index (generiert) und ADR-Vorlage samt Kopf-Format: [adr/README.md](../adr/README.md). Einordnung im Architekturbild: [arc42 › Architekturentscheidungen](../arc42-architektur.md#9-architekturentscheidungen-adrs).

| ADR | Wann lesen |
|---|---|
| [0008 KI-Agenten-Harness](../adr/0008-ki-agenten-harness.md) | wenn du verstehen willst, warum das Repo von Agenten gebaut wird und was daraus folgt |
| [0009 PR-Gating](../adr/0009-pr-gating-required-checks.md) | wenn Required-Checks, Branch-Schutz oder Direkt-Push zur Debatte stehen |
| [0012 Harness-Autonomie](../adr/0012-harness-autonomie-audit-spur.md) | wenn es um Selbst-Merge von Leitplanken-Änderungen und die Audit-Spur geht |
| [0013 docs/ als Wiki](../adr/0013-docs-als-agentengepflegtes-wiki.md) | bevor du Doku anlegst oder umziehst — welche Wissensart wohin gehört |
| [0014 Leitplanken ohne Label-Riegel](../adr/0014-leitplanken-ohne-label-riegel.md) | wenn es um Gate-/Harness-Änderungen, die Pfadquelle und den Audit-Kommentar geht |
| [0015 Projekt-Brain](../adr/0015-projekt-brain.md) | wenn es um Prinzipien, Token-Ziel und Messung des Projekt-Brains geht |
| [0016 Langfuse-Takt](../adr/0016-langfuse-takt-woechentlich.md) | wenn es um den wöchentlichen Takt des Status-Tickets, das Langfuse-Sammelticket oder den Board-Takt (Harness-Sammelticket ab 10 Befund-Kommentaren, Spielquote, Positionskorrektur) geht |
| [0017 Lebende Doku](../adr/0017-lebende-doku-generierte-abschnitte.md) | wenn Doku generiert, ein Gate beschrieben oder ein Diagramm eingeführt wird |
| [0019 Langfuse-Plugin im User-Scope](../adr/0019-langfuse-plugin-im-user-scope.md) | wenn die Langfuse-Erfassung (Plugin, Hooks, User- vs. Projekt-Scope) geändert oder verdächtigt wird, nichts zu erfassen |
| [0020 Architekturmodell LikeC4](../adr/0020-architekturmodell-likec4.md) | wenn das Architekturmodell unter `docs/architektur/`, `check:c4` oder die Ableitung der Architekturbilder aus `scripts/layers.cjs` angefasst wird |
| [0021 Agenten-Sandbox über WSL2](../adr/0021-agenten-sandbox-wsl2.md) | wenn Sandbox, WSL2, Devcontainer oder die Netz-Allowlist der Agenten-Shell zur Debatte steht |
| [0022 Dark Factory](../adr/0022-dark-factory-kern-und-verteilung.md) | wenn der Harness-Kern als Vorlage für andere Projekte herausgelöst, eine Datei als Kern, Modul oder Projekt eingeordnet, ein zweites Board oder Verifikation ohne Mensch (Holdout, Spezifikations-Gate) oder die Veröffentlichung des Harness (Sichtbarkeit, Lizenz, Marketplace, Beiträge) zur Debatte steht |
| [0023 Transkript als Wahrheit](../adr/0023-transkript-quelle-der-wahrheit-langfuse-abgleich.md) | wenn Langfuse-Daten unvollständig wirken, der Hook des Langfuse-Plugins oder der Nachlieferer (Lock, Log, SessionStart/SessionEnd) geändert oder der Abgleich zurückgebaut werden soll |
| [0024 Hexagon als Lesart](../adr/0024-hexagon-als-lesart.md) | wenn Ports, Adapter oder die hexagonale Sicht in arc42 und im Architekturmodell angefasst werden oder jemand das Hexagon als Ordnerstruktur umsetzen will |
| [0025 Sandbox als Laufumgebung](../adr/0025-sandbox-als-austauschbare-laufumgebung.md) | wenn die Agenten-Sandbox gewechselt, `sandbox-doctor --streng` gebaut oder geprüft werden soll, ob eine Umgebung als gesandboxt gilt (Vertrag V0 bis V7, Docker Sandboxes, eigene Container-Sandbox, Cloud-Sitzung, Standard- und Rückfallweg) |
| [0026 Sammeltickets in Gruppen](../adr/0026-sammelticket-gruppen.md) | wenn Sammeltickets zu groß oder teuer werden, ein Sammelticket aufgeteilt oder eine Zeilengrenze erwogen werden soll |
| [0027 Evidenzbasiert lockern](../adr/0027-regeln-lockern.md) | wenn eine Regel, ein Gate, eine Lens, ein Hook, ein Workflow-Schritt oder Prompt-Text entfernt, eingeschränkt oder gekürzt werden soll, oder ein Status-Lauf einen Lockern-Kandidaten meldet |
| [0028 Genau ein Ticket-Ablauf](../adr/0028-ein-ticket-ablauf.md) | wenn ein zweiter Ablauf neben dem Ticket-Ablauf (Ticket-Skills mit gemeinsamem ablauf.md; Workflow-Skript, Zeiger-Skill) vorgeschlagen wird, oder der Ersatz einer früher nur im Workflow deterministischen Garantie gesucht wird |
| [0029 Harness-Cockpit](../adr/0029-harness-cockpit.md) | wenn eine Oberfläche, ein Dashboard oder ein Werkzeug zur Agenten-Übersicht gebaut, ein Bausatz erwogen oder etwas der Factory zugeordnet wird, das nicht in Projekte verteilt wird |

<!-- factory-projekt:start -->

| ADR | Wann lesen |
|---|---|
| [0001 Engine Phaser](../adr/0001-engine-phaser.md) | wenn die Engine-Wahl (Phaser vs. Godot/Unity) oder ein nativer Wrapper zur Debatte steht |
| [0002 Kein Backend, keine DB](../adr/0002-kein-backend-keine-db.md) | wenn jemand Server, Datenbank oder Service-Aufteilung fürs Kern-Spiel vorschlägt |
| [0003 Multiplayer out of scope](../adr/0003-multiplayer-coop-out-of-scope.md) | wenn Co-op oder Multiplayer aufkommt |
| [0004 Skalierungs-Fundament](../adr/0004-skalierungs-fundament.md) | wenn es um Content-as-Data, Entity-Registry, ID-basierten Quest-Fortschritt oder IndexedDB-Saves geht |
| [0005 Auslieferungsform](../adr/0005-auslieferungsform.md) | wenn Web-App vs. Desktop-Download entschieden werden soll |
| [0006 Backend bei Stardew-Scope](../adr/0006-backend-und-skalierung.md) | wenn die Backend-Frage mit Blick auf Spielgröße neu aufkommt |
| [0007 Spielsystem-Fundamente](../adr/0007-spielsystem-fundamente.md) | bevor du am Quest-Modell, an Checks oder an der Spielzeit baust |
| [0010 Zwei Karten-Modelle](../adr/0010-karten-modell-tiled-vs-code-builder.md) | bevor du eine Karte baust: Tiled-Daten oder Code-Builder? |
| [0011 NPC-System-Fundament](../adr/0011-npc-system-fundament.md) | bevor du NPC-Zustand, Routinen oder Beziehungen anfasst |
| [0018 Content-Chunks je Datei](../adr/0018-content-chunks-je-datei.md) | wenn der Spielcode-Chunk oder ein Bundle-Budget reißt, Content (Quests, Crabquiz, Karten) wächst oder Lazy-Load je Region zur Debatte steht |

<!-- factory-projekt:ende -->

## 🌱 Evergreen — lebendes Wissen, im selben PR gepflegt

### Projekt und Architektur

| Seite | Wann lesen |
|---|---|
| [README.md](../../README.md) | wenn du wissen willst, was das Projekt ist |
| [arc42-architektur.md](../arc42-architektur.md) | für die Gesamtarchitektur (arc42 + C4/Mermaid-Diagramme §5) |
| [arc42 › Hexagonale Sicht](../arc42-architektur.md#hexagonale-sicht-ports--adapters) | wenn du einen neuen Adapter oder eine neue Ein- oder Ausgabe baust (Speicher, Eingabeart, Export, Content-Quelle): welcher Port, welche Schicht, welche Tabellenzeile |
| [architektur/harness.c4](../architektur/harness.c4) | für die Harness-Sichten desselben Modells (Übersicht, Bausteine, Gates und Leitplanken, Gate-Ketten `verify` und `verify:full`, CI und Board, der Ticket-Lauf als dynamische View; Elemente gegen `.claude/`, Hooks, Gates, CI und `.mcp.json` abgeglichen) |
| [glossar.md](../glossar.md) | wenn dir ein Begriff des Projekts fehlt (Harness-Begriffe: [harness-glossar.md](../harness-glossar.md)) oder du wissen willst, welcher Context in welchem Verzeichnis gilt |
| [repo-landkarte.md](repo-landkarte.md) | wenn du ein Subsystem suchst: welche Schicht, welches Tiefendoc |
| [codex/einstieg.md](../codex/einstieg.md) | wenn Codex eingerichtet wird (derzeit nicht im Einsatz): Rollen, MCP, Berechtigungen, Hook-Abbildung |

<!-- factory-projekt:start -->

| Seite | Wann lesen |
|---|---|
| [module/sim.md](../module/sim.md) | beim Arbeiten am Cluster-Simulator (`src/sim/*`) |
| [sim-treue.md](../sim-treue.md) | wenn du das Verhalten einer Befehlsfamilie des Simulators gegen die Doku abgleichst oder einen Befehl, eine Aufrufform bzw. eine Ressourcenart ergänzt (Treue-Matrix) |
| [module/content.md](../module/content.md) | für die Interna von Content-as-Data (Loader, Registry) |
| [module/content-questgraph.md](../module/content-questgraph.md) | für die Quest-Landkarte: welche Region hat welche Quests, wie hängen sie zusammen (generiert) |
| [module/world.md](../module/world.md) | bei Welt-, Karten- und HUD-Logik außerhalb der Szenen |
| [module/app.md](../module/app.md) | bei Spielstand, XP, Wirtschaft, Persistenz und Einstieg |
| [module/presentation.md](../module/presentation.md) | bei Szenen, UI, SFX und Assets (Phaser/DOM) |
| [performance-budget.md](../performance-budget.md) | bevor die Welt wächst: FPS- und Sprite-Budget, Culling, Messen |
| [stardew-referenz.md](../stardew-referenz.md) | vor jedem Optik-Ticket — so sieht das Vorbild wirklich aus |
| [art-direction.md](../art-direction.md) | lebende Abweichungsliste der Optik gegen die Messlatte — vor Optik-Tickets |

<!-- factory-projekt:ende -->

<!-- factory-projekt:start -->

| Seite | Wann lesen |
|---|---|
| [architektur/spiel.c4](../architektur/spiel.c4) | für das LikeC4-Architekturmodell (Kontext, Container, Schichten, Hauptmodule, Hexagon; ansehen mit `npm run c4:serve`, Wächter `check:c4`) |

<!-- factory-projekt:ende -->

### Arbeitsablauf und Nachschlagen

| Seite | Wann lesen |
|---|---|
| [CONTRIBUTING.md](../../CONTRIBUTING.md) | als menschliche Mitentwicklerin: Einstieg, One-Command-Setup `npm run setup`, IntelliJ-Run-Configs, Dependabot-Policy, [Im Container entwickeln](../../CONTRIBUTING.md#im-container-entwickeln-optional-ohne-lokales-node) (devcontainer / `docker compose up`, #388) |
| [ticket-reihenfolge.md](../ticket-reihenfolge.md) | wenn du das nächste Ticket auswählst oder ein neues Issue im Board einsortierst |
| [befehle.md](befehle.md) | wenn du wissen willst, welches `npm run`-Kommando was tut und welche Umgebungsvariable ein Werkzeug liest |
| [schichtregeln.md](schichtregeln.md) | bevor du einen neuen Import setzt oder ein Modul verschiebst (Architektur-Wächter) |
| [doku-vorlagen.md](doku-vorlagen.md) | wenn du eine Wiki-Seite anlegst: Kopfzeilen „fachlich geprüft am" bzw. Schnappschuss-Hinweis |

### Harness

| Seite | Wann lesen |
|---|---|
| [agent-harness.md](../agent-harness.md) | wenn du den Projektanteil des Agenten-Harness suchst (generierte Abschnitte, Projekt-Gates, Test-Harness, Forum-Eingang); das Kernwissen steht im Factory-Repo, siehe [Factory-Seiten](#factory-seiten-projektanteil-und-kern) |
| [agent-harness-faq.md](../agent-harness-faq.md) | wenn du eine Projekt-Frage zum Harness hast (Deploybarkeit, Browser im Spiel, Architekturmodell, Perf-Smoke); die Harness-Fallen (Worktrees unter Windows, Hooks, Gates) stehen in der Kern-FAQ |
| [lessons-learned.md](../lessons-learned.md) | wenn du als Außenstehende:r wissen willst, welche Muster der Bau des Harness gezeigt hat (datierte Belege, was geändert wurde, was offen ist) |
| [harness-glossar.md](../harness-glossar.md) | wenn dir ein Harness-Begriff fehlt (Subagent, Lens, Leitplanke, Override, Sammelticket, Dark Factory) |
| [sandbox-anbinden.md](../sandbox-anbinden.md) | wenn du den Harness mit Docker Sandboxes (`sbx`), einer eigenen Container-Sandbox oder der Cloud-Sitzung betreiben willst (Einrichtung, Eigenheiten) |
| [sicherheit-agenten.md](../sicherheit-agenten.md) | wenn du den Forum-Kanal für Fremdtext nachschlägst; Vertrauensmodell und OWASP-Abgleich stehen im Factory-Repo |
| [harness-inventar.md](../harness-inventar.md) | wenn ein Claude-Code-Release oder Werkzeug-Update erscheint oder du prüfen willst, ob ein Eigenbau nativ ersetzbar ist |
| [harness-transfer.md](../harness-transfer.md) | wenn du den Harness in ein fremdes Bestands-Repo übertragen willst: Reifestufen, Werkzeug je Sprache, docs-gen übernehmen |
| [factory/entscheidungsprotokoll.md](../factory/entscheidungsprotokoll.md) | wenn du vor einer Ermessens-Weiche oder einem Hand-off (`festgefahren`, Zusatzpass, Override) stehst und entscheiden willst, ob und womit du sie selbst klärst |
| [model-routing.md](../model-routing.md) | wenn ein neues Modell erscheint oder du wissen willst, welche Phase auf welchem Modell läuft |
| [lens-gegenprobe-2026-10-09.md](../lens-gegenprobe-2026-10-09.md) | Momentaufnahme: Rohwerte und Rezept der Lens-Gegenprobe (Opus gegen Sonnet gegen Haiku je Brille); die Entscheidung steht in model-routing.md |
| [lens-gegenprobe-2026-10-15.md](../lens-gegenprobe-2026-10-15.md) | Momentaufnahme: Gegenprobe `omitClaudeMd: true` für die Lens (Kontextdateien mit und ohne), Regel, Rohwerte und Entscheidung; gültig steht sie in model-routing.md |
| [planer-gegenprobe-2026-10-16.md](../planer-gegenprobe-2026-10-16.md) | Momentaufnahme: Gegenprobe Opus `high` und Sonnet gegen Opus `xhigh` für den Planer, Regel, Rohwerte und Entscheidung; gültig steht sie in model-routing.md |
| [langfuse-hook-patch.md](../langfuse-hook-patch.md) | wenn das Plugin `langfuse-observability` aktualisiert wird, der Hook-Patch geprüft oder portiert werden muss oder Langfuse Turns vermisst |

### Betrieb, Assets, Tests

| Seite | Wann lesen |
|---|---|
| [`.devcontainer/`](../../.devcontainer/devcontainer.json) · [`docker-compose.yml`](../../docker-compose.yml) | wenn du im Container entwickelst |
| [`test/`](../../test/) | wenn du Tests schreibst: Querschnitts-Umgebung in [`test/support/`](../../test/support/), Factories in [`test/factories/`](../../test/factories/) (`freshSim`); Harness-Wächter (Kopf-Marker `@harness-waechter`, geschützt) in [`test/harness/`](../../test/harness/); Kategorien und Fitness-Functions erklärt [agent-harness.md](../agent-harness.md) |

<!-- factory-projekt:start -->

| Seite | Wann lesen |
|---|---|
| [deploy.md](../deploy.md) | wenn du das Spiel als Container oder per Helm-Chart in einen Cluster bringen willst (#752) oder `deploy/**` änderst (CI-Validierung, #1544) |
| [devpanel-docker.md](../devpanel-docker.md) | wenn du das Dev-/Test-Panel als Docker-Image mit Laufzeit-Passwort brauchst |
| [assets/pixellab/README.md](../../assets/pixellab/README.md) | wenn du ein PixelLab-Asset suchst oder ablegst (Liste + IDs) |
| [assets/maps/README.md](../../assets/maps/README.md) | beim Arbeiten an Tiled-Maps (`.tmj`) |
| [`fonts.css`](../../fonts.css) · [`assets/fonts/`](../../assets/fonts/) | bei der HUD-Pixelschrift `KQPixel`/Silkscreen (Quelle + Lizenz, #189) |

<!-- factory-projekt:ende -->

<!-- factory-projekt:start -->

| Seite | Wann lesen |
|---|---|
| [`e2e/`](../../e2e/) | bei Boot-, Interaktions-, FPS-, a11y- und Lern-Loop-Smokes (Playwright, `npm run smoke`); Details in [agent-harness.md › Test-Harness und e2e-Smokes](../agent-harness.md#test-harness-und-e2e-smokes), den Datei-Köpfen und [`playwright.config.ts`](../../playwright.config.ts) |

<!-- factory-projekt:ende -->

## Factory-Seiten: Projektanteil und Kern

<!-- factory-projekt:start -->

Sieben Seiten dieses Repos stammen aus dem Factory-Repo. Je Seite (bei gemischten Seiten je Abschnitt) gilt genau ein Urteil: **Projekt** (bleibt hier, in `factory-projekt`-Blöcken oder als generierter Abschnitt) oder **Kern** (steht nur im Factory-Repo; hier höchstens ein Anker-Stub mit einer Zeile `Kern: [Titel](Factory-Link)`). Regel, Stub-Gründe und Ausnahmen: [Fortschreibung #1967](../adr/fortschreibungen/0022-1967-factory-seiten-projektanteil.md). Der Test `test/harness/factory-seiten-projekt.test.ts` hält die Liste und die gekürzten Seiten zusammen.

| Seite | Abschnitt | Urteil | Zielort |
|---|---|---|---|
| `docs/agent-harness.md` | Kernidee, Bausteine, Cockpit, Gates-Langtexte (Tests bis Code-Scanning), Gates, Guards und Durchsetzung, sichere Autonomie-Schleife samt Sandbox-Langtext, Roadmap | Kern | [Factory: agent-harness.md](https://github.com/fluffels/self-improving-agent-harness-and-factory/blob/v0.4.2/docs/agent-harness.md); hier Anker-Stubs |
| `docs/agent-harness.md` | generierte Abschnitte (Kennzahlen, Gates, Ablauf, Sequenz, Leitplanken-Schichten), Projekt-Gates (Architektur, Spiel-Generatoren, Architekturmodell, Factory-Link, Smokes, Deploy, Schichtung, Bundle, Duplikation), Test-Harness und e2e-Smokes, Forum-Eingang, Netz-Ergänzung der Sandbox, Verwandte Dokumente | Projekt | bleibt hier: [agent-harness.md](../agent-harness.md) |
| `docs/agent-harness-faq.md` | Fragen zu CI-Ergebnis, Subagent, Übertragung, Mauer, Festgefahren, Self-Merge, Auto-Mode, Worktree, Git-Bash, Probe-Lauf, Scratch, Hook headless, deny auf SubagentHandback, Timeouts, mtime, Langfuse, CI-Schritt, Bildanhang | Kern | [Factory: agent-harness-faq.md](https://github.com/fluffels/self-improving-agent-harness-and-factory/blob/v0.4.2/docs/agent-harness-faq.md); hier Anker-Stubs |
| `docs/agent-harness-faq.md` | Deploybarkeit, Browser im Spiel, Architekturmodell, AGE-Werte, Perf-Smoke, Mermaid, Verwandte Dokumente | Projekt | bleibt hier: [agent-harness-faq.md](../agent-harness-faq.md) |
| `docs/sicherheit-agenten.md` | Quellen, Vertrauensmodell, OWASP-Abgleich, Kanäle außer dem Forum, Grenzen | Kern | [Factory: sicherheit-agenten.md](https://github.com/fluffels/self-improving-agent-harness-and-factory/blob/v0.4.2/docs/sicherheit-agenten.md); hier Anker-Stubs |
| `docs/sicherheit-agenten.md` | Kanal Forum samt Quarantäne-Muster | Projekt | bleibt hier: [sicherheit-agenten.md](../sicherheit-agenten.md#kanäle-für-fremdtext) |
| `docs/model-routing.md` | alle Abschnitte außer der Forum-Triage-Zeile der Phasen-Matrix | Kern | [Factory: model-routing.md](https://github.com/fluffels/self-improving-agent-harness-and-factory/blob/v0.4.2/docs/model-routing.md); Kürzung in #1968 |
| `docs/model-routing.md` | Forum-Triage (Block der Phasen-Matrix) | Projekt | bleibt hier: [model-routing.md](../model-routing.md) |
| `docs/ticket-reihenfolge.md` | ganze Seite | Kern | [Factory: ticket-reihenfolge.md](https://github.com/fluffels/self-improving-agent-harness-and-factory/blob/v0.4.2/docs/ticket-reihenfolge.md); Kürzung in #1968 |
| `docs/harness-glossar.md` | alle Abschnitte außer den Projekt-Blöcken | Kern | [Factory: harness-glossar.md](https://github.com/fluffels/self-improving-agent-harness-and-factory/blob/v0.4.2/docs/harness-glossar.md); Kürzung in #1968 |
| `docs/harness-glossar.md` | Projekt-Blöcke (SBOM, Factory-Link-Begriffe, Anker-Stub, Projektanteil) | Projekt | bleibt hier: [harness-glossar.md](../harness-glossar.md) |
| `docs/referenz/befehle.md` | alle Abschnitte außer den Projekt-Blöcken | Kern | [Factory: befehle.md](https://github.com/fluffels/self-improving-agent-harness-and-factory/blob/v0.4.2/docs/referenz/befehle.md); Kürzung in #1968 |
| `docs/referenz/befehle.md` | Projekt-Blöcke (Erste Minute, Projekt-Befehle) | Projekt | bleibt hier: [befehle.md](befehle.md) |

<!-- factory-projekt:ende -->

## 📸 Schnappschüsse — datiert, werden nicht aktualisiert

Momentaufnahmen eines damaligen Stands. Lesen, um Herkunft und Begründung zu verstehen; den aktuellen Stand zeigen Code, Evergreen-Seiten und Issues.

| Seite | Wann lesen |
|---|---|
| [architektur-analyse-2026-06.md](../architektur-analyse-2026-06.md) | Historie: Infrastruktur-Fokus Juni 2026 |
| [architektur-analyse-2026-07-iSAQB.md](../architektur-analyse-2026-07-iSAQB.md) | iSAQB-Runde 1 (2026-07-01), Herkunft von #492–#524 |
| [architektur-analyse-2026-07-02-iSAQB.md](../architektur-analyse-2026-07-02-iSAQB.md) | iSAQB-Runde 2 (2026-07-02), Herkunft von #577–#595 |
| [architektur-analyse-2026-07-03-iSAQB.md](../architektur-analyse-2026-07-03-iSAQB.md) | iSAQB-Runde 3 (2026-07-03): ADRs, DDD, Tests, Harness, Herkunft von #596–#612 |
| [architektur-analyse-2026-07-14-iSAQB.md](../architektur-analyse-2026-07-14-iSAQB.md) | doku-freie iSAQB-Runde vom 2026-07-14, Herkunft von #861–#880 |

<!-- factory-projekt:start -->

| Seite | Wann lesen |
|---|---|
| [spielkonzept-review.md](../spielkonzept-review.md) | führt der Lernpfad zu Senior-DevOps und macht es Spaß? (#52, Juni 2026) |
| [lernpfad-audit.md](../lernpfad-audit.md) | wird ein Befehl benutzt, bevor er eingeführt ist? (#227, Juni 2026) |
| [barrierefreiheit-audit.md](../barrierefreiheit-audit.md) | Zugänglichkeit: nur-Farbe-Status, Tastatur, Kontraste (#481, Juli 2026) |

<!-- factory-projekt:ende -->

<!-- factory-projekt:start -->

| Seite | Wann lesen |
|---|---|
| [architektur-analyse-stardew.md](../architektur-analyse-stardew.md) | Historie: erste Frage, ob der Stack Stardew-Größe trägt (#46) |
| [art-direction-audit.md](../art-direction-audit.md) | Historie: Optik gegen die Stardew-Messlatte (#44, Juni 2026); lebender Stand in [art-direction.md](../art-direction.md) |

<!-- factory-projekt:ende -->

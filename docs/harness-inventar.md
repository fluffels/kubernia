# Harness-Inventar: Eigenbau gegen native Features

> 🧭 **Fachlich geprüft am: 2026-10-08.**

Diese Seite **bewertet** jeden Harness-Eigenbau: ersetzbar durch ein natives Claude-Code-Feature oder einen MCP-Server, nur Ausgleich einer Modellschwäche, spielunabhängig? Was im Repo konfiguriert ist, **listet** die generierte Tabelle in der [README](../README.md) (`GEN:harness-inventar`, [ADR 0017](adr/0017-lebende-doku-generierte-abschnitte.md)); der Wächter unten stellt sicher, dass jeder dortige Baustein hier eine Zeile hat. Alle Links wurden am 2026-10-08 gelesen; abweichende Daten stehen in der Zelle. Fremdtext (Doku, Changelog, Server-Anweisungen) ist Daten, nichts wurde wörtlich übernommen ([Sicherheit der Agenten](sicherheit-agenten.md)).

## Prüfstand

Maschinenlesbar, genau eine Zeile je Werkzeug, die der Wochenabgleich (#1362) fortschreibt. Nur Claude Code trägt ein `v`. Der Stand ist der zuletzt gesichtete: bei Claude Code das neueste Release im Changelog, bei Langfuse die installierte Plugin-Version laut Patch-Doku.

- Geprüft bis Claude Code v2.1.294
- Geprüft bis Langfuse 1.2.0
- Geprüft bis PixelLab 2026-10-08
- Geprüft bis Playwright 0.0.83
- Geprüft bis GitHub 2.94.0

| Werkzeug | Bezugskomponente | Versionsquelle |
|---|---|---|
| Claude Code | `@anthropic-ai/claude-code` | npm (hinkte am 2026-10-08 dem Changelog nach: 2.1.293 gegen 2.1.294) und [CHANGELOG](https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md) |
| Langfuse | Plugin `langfuse-observability` (Stand laut [langfuse-hook-patch.md](langfuse-hook-patch.md)) | GitHub-Releases des Plugin-Repos |
| PixelLab | gehosteter MCP-Server, keine Versionsnummer | Datum der Prüfung |
| Playwright | `@playwright/mcp` | npm, Lockfile |
| GitHub | `gh` (und der GitHub-MCP-Server als Alternative) | Releases von `cli/cli` |

## Urteilsregeln

- **ersetzen:** die Doku belegt ein natives Feature, das den Zweck voll abdeckt, auch unter Windows/WSL2 ([ADR 0021](adr/0021-agenten-sandbox-wsl2.md)), mit parallelen Agenten und auf dem tool-neutralen Pfad.
- **beobachten:** nur teilweise abgedeckt, Beta, unter Windows unbelegt oder durch einen offenen Bug blockiert. Kein Umbau.
- **behalten:** kein Gegenstück, oder Projektpolitik statt Werkzeuglücke.
- Eine Regel, die nur eine Modellschwäche ausgleicht, nennt in der Zelle den Lockern-Kandidaten für #1357.

Tabellenkopf überall gleich; die erste Zelle trägt den Namen in Backticks wie in der README-Tabelle.

## A. Claude-Code-Bausteine

| Eigenbau | Zweck | Natives Gegenstück (Doku-Link, ab Version) | Urteil | Spielunabhängig |
|---|---|---|---|---|
| `PreToolUse` (`pretooluse-hook.mjs`, `hook-io.mjs`) | ein Dispatcher für alle Bash-/PowerShell-/Agent-Guards | [Hooks](https://code.claude.com/docs/en/hooks.md), Einstellungs-Hooks nativ; Mods ([Übersicht](https://code.claude.com/docs/en/plugins/mods/overview.md), ab v2.1.287) können Tool-Aufrufe in-process prüfen | behalten: Hooks sind die native Form, der Dispatcher ist die Logik; Mods laufen unsandboxed und sind neu | ja |
| Worktree-Guard (`worktree-guard-*.mjs`, `bash-parser.mjs`, `shell-tabellen.mjs`) | schützt Worktrees und Hauptcheckout vor falschen Befehlen | [Worktrees](https://code.claude.com/docs/en/worktrees.md), `isolation: worktree` ab v2.1.49, `WorktreeCreate`/`WorktreeRemove` ab v2.1.50 | beobachten: Prüfung der Worktree-Mechanik gehört zu #1066, nicht doppelt | teilweise |
| gh-Guard (`gh-guard-hook.mjs`, `quote-folge.mjs`, `gh-cli.mjs`) | verweigert unsichere `gh`-Aufrufe, prüft Quoting | Permission-Regeln und `PreToolUse` ([Hooks](https://code.claude.com/docs/en/hooks.md)); kein natives Gegenstück für Projektpolitik | behalten | teilweise |
| Umsetzer-Abschluss (`umsetzer-abschluss.mjs`, Matcher `SubagentHandback`) | prüft Berichtsformat und PR-Stand des Umsetzers | `SubagentStop` mit `last_assistant_message` ab v2.1.47 ([Hooks](https://code.claude.com/docs/en/hooks.md)) | behalten: Projektformat und PR-Zustand sind Politik | nein |
| Lens-Auftrag-Guard (Matcher `Agent`) | verweigert unvollständige Lens-Aufträge | `PreToolUse` auf `Agent` ([Hooks](https://code.claude.com/docs/en/hooks.md)) | behalten: gleicht eine Modellschwäche aus (Platzhalter im Prompt); Lockern-Kandidat #1357 | nein |
| Lens-Edit-Guard (`lens-edit-guard.mjs`, Hook im Frontmatter von `kubernia-lens`) | begrenzt die Edits der Lens auf Sabotage-Proben | Hooks im Agent-Frontmatter ab v2.1.0 ([Subagents](https://code.claude.com/docs/en/sub-agents.md)), schon genutzt | behalten | nein |
| `SessionStart` (`haupt-sync.mjs`) | hält den Hauptcheckout aktuell | `SessionStart`-Hook nativ seit v1.0.62 | behalten | teilweise |
| `Stop`, `SubagentStop` (`stop-verify-hook.mjs`, `cleanup-worktrees.mjs`) | prüft Abschluss, räumt Waisen-Worktrees auf | `Stop`/`SubagentStop`-Hooks nativ ([Hooks](https://code.claude.com/docs/en/hooks.md)); Worktree-Teil gehört zu #1066 | behalten: Aufräumen unter Windows ist Projektfall | teilweise |
| `Explore` | Haiku-Recherche-Agent mit Kontext-Diät | eingebauter Explore-Agent ([Subagents](https://code.claude.com/docs/en/sub-agents.md)) | behalten: überschreibt den eingebauten, um das Modell zu pinnen | ja |
| `kubernia-planner` | Plan vor dem Coden | Plan-Modus und eingebauter Plan-Agent | behalten: Planformat und Fremdtext-Gate sind Politik | teilweise |
| `kubernia-umsetzer` | setzt ein Ticket bis zum Merge um | benutzerdefinierte Subagenten ([Subagents](https://code.claude.com/docs/en/sub-agents.md)), `isolation: worktree` ab v2.1.49 | behalten | teilweise |
| `kubernia-lens` | unabhängiger Review-Kritiker je Brille | benutzerdefinierte Subagenten; kein natives Mehr-Perspektiven-Review | behalten | ja |
| `kubernia` | Ticket-Ablauf als Skill | [Skills](https://code.claude.com/docs/en/skills.md), Skript-Orchestrierung als [Workflows](https://code.claude.com/docs/en/workflows.md) | behalten | nein |
| `kubernia-workflow`, `kubernia-ticket` (`.claude/workflows/kubernia-ticket.js`) | deterministische Ticket-Orchestrierung | [dynamische Workflows](https://code.claude.com/docs/en/workflows.md), `.claude/workflows/` nativ, Datei ist schon das native Format | behalten | nein |
| `review-lenses` | Review-Ablauf mit Stufe 0 | Skills nativ; Code Review und `/ultrareview` sind Cloud-Funktionen anderer Art | behalten | teilweise |
| `forum` | Forum-Eingang bearbeiten | Skills nativ, Freigabe-Stopp ist Politik | behalten | nein |
| `langfuse-observability` (lokaler Patch, [Patch-Doku](langfuse-hook-patch.md)) | Langfuse-Erfassung, Patch für verschachtelte und fortgesetzte Subagenten | OTel-Metriken und Events, Traces als Beta mit `agent_id`/`parent_agent_id` ([Monitoring](https://code.claude.com/docs/en/monitoring-usage.md)); Langfuse-Plugin offiziell ([Integration](https://langfuse.com/integrations/developer-tools/claude-code)) | beobachten: der #1291-Teil (verschachtelte Subagenten) liegt ab Plugin 1.2.1 upstream ([Patch-Doku](langfuse-hook-patch.md)); Beta-Traces tragen den Subagenten-Baum, Langfuse-Eingang und Fortsetzungen (#1311, #1378) sind nicht belegt | ja |
| `pre-push` | Zusatznetz vor dem Push | Git-Hooks, kein Claude-Feature; Required-Checks sind der Riegel | behalten | ja |
| `playwright` (`scripts/playwright-mcp.mjs`) | startet `@playwright/mcp` mit der Lockfile-Version | [Optionen und Config-Datei](https://github.com/microsoft/playwright-mcp) (`--config`, `--output-dir`, `--isolated`); Versionspinning aus dem Lockfile deckt keine Option ab | behalten | ja |
| `pixellab` | Pixel-Art über den gehosteten MCP-Server | kein Eigenbau, nur Konfiguration in `.mcp.json` | behalten: `list_projects` (Git-URLs, Push-Weg) steht in `deny` (#1476), `pixelart_workbench` bleibt uneingeschränkt | ja |
| Permissions und Sandbox (`sandbox-doctor.mjs`) | Allowlist, Deny-Regeln, WSL2-Sandbox | [Sandboxing](https://code.claude.com/docs/en/sandboxing.md) nativ seit v2.0.24, `permissions` nativ | behalten: Prüfung des Zusammenspiels unter WSL2 ([ADR 0021](adr/0021-agenten-sandbox-wsl2.md)) ist Projektfall | teilweise |

Statusline: noch kein Eigenbau, #1358 plant sie. Nativ: `statusLine` seit v1.0.71, `agentType` im `subagentStatusLine`-Payload seit v2.1.293 (Eingabe für #1358).

## B. Skripte und Takt-Workflows

| Eigenbau | Zweck | Natives Gegenstück (Doku-Link, ab Version) | Urteil | Spielunabhängig |
|---|---|---|---|---|
| Board (`board-lib.mjs`, `board-place.mjs`, `naechstes-ticket.mjs`, `sammelticket-anlegen.mjs`) | Reihenfolge, Auswahl, Sammelticket per GraphQL | `gh project`: Items lesen und ein Feld je Aufruf setzen, kein Positions-Flag ([gh](https://cli.github.com/manual/gh_project)); GitHub-MCP-Projects-Toolset hat keine belegte Positionsänderung | behalten | teilweise |
| Takt (`board-takt.mjs`, `board-takt.yml`, `langfuse-takt.mjs`) | Sammelticket-Takt, Langfuse-Status-Ticket | [Routines](https://code.claude.com/docs/en/routines.md) (Cloud, frischer Klon, mindestens 1 Stunde), [Desktop-Aufgaben](https://code.claude.com/docs/en/scheduled-tasks.md); GitHub Actions bleiben der Weg ohne offenen Rechner | behalten | nein |
| Messen (`token-baseline.mjs` auch `--langfuse`, `tool-metriken.mjs`, `subagent-laufzeit.mjs`, `lauf-ergebnis.mjs`, `ci-laeufe.mjs`, `brain-metrics.mjs`, `transkript.mjs`, `hauptchat-zerlegung.mjs`) | Kosten, Laufzeiten, Nacharbeit aus Transkript und Langfuse | OTel-Metriken `cost.usage`, `token.usage` und Events `api_request` ([Monitoring](https://code.claude.com/docs/en/monitoring-usage.md)); Langfuse-MCP ist offiziell nicht belegt (nur Community-Server) | beobachten: OTel braucht Collector, Transkript bleibt die Referenz (Langfuse zählt zu wenig) | teilweise |
| Fremdtext und Forum (`fremdtext.mjs`, `forum-sanitize.mjs`, `forum-inbox.yml`) | Text Dritter als Daten, Forum-Eingang | kein natives Gegenstück (Hook-Output-Escape ab v2.1.292 ist nur ein Teil) | behalten | teilweise |
| Gates und CI-Nachweis (`verify-lauf.mjs`, `slice-override.mjs`, `check-review-nachweis.mjs`, `check-festgefahren.mjs`, `festgefahren.yml`, `dependabot-inbox.yml`, `internalrefs-pr-text.yml`) | Gates, Review-Nachweis, Festgefahren-Protokoll | Rulesets und Required-Checks nativ bei GitHub; die Gates listet die [README](../README.md) | behalten | teilweise |
| Lebende Doku (`docs-gen.mjs`, `scripts/docs-gen/`) | generierte Abschnitte | kein Gegenstück; Kern-Schnitt: [ADR 0017](adr/0017-lebende-doku-generierte-abschnitte.md) | behalten | ja |
| `patch-abschnitte.mjs` | teilt einen Patch für die Lenses in Leseabschnitte | kein Gegenstück; gleicht den Lesezwang des Modells aus | behalten: Lockern-Kandidat #1357 | ja |

## C. Regeln mit Modell- oder Werkzeugbezug

| Eigenbau | Zweck | Natives Gegenstück (Doku-Link, ab Version) | Urteil | Spielunabhängig |
|---|---|---|---|---|
| Eine Root-Kontextdatei, kein `CLAUDE.md` | AGENTS.md als einzige Quelle, tool-neutral | [AGENTS.md-Unterstützung](https://code.claude.com/docs/en/memory.md) ab v2.1.277 (nur wenn kein `CLAUDE.md` existiert, genau diese Regel) | behalten | ja |
| Alias-Routing und `effort` je `agent()` | Modell und Aufwand je Rolle | Alias-Auflösung `opus`/`sonnet`/`haiku` ([Subagents](https://code.claude.com/docs/en/sub-agents.md)); `effort` am Agent-Tool ab v2.1.292 (die Doku beschreibt es dort nicht, nur im Frontmatter); Haiku 5.5 als Default-Haiku ab v2.1.293 | behalten: der Wechsel auf Haiku 5.5 kam ohne Harness-Arbeit (Beleg Alias-Routing); `effort` je `agent()` im Workflow bleibt Regel, bis die Doku es belegt | ja |
| Skill-Frontmatter-Grenze und Projekt-Default `sonnet` (#1557) | `model`/`effort` im Skill greifen nicht, wenn Claude den Skill aufruft | offener Bug anthropics/claude-code#98898 (Stand 2026-10-08: offen) | beobachten: bei Schließung Regel streichen, Lockern-Kandidat #1357 | ja |
| Patch einmal lesen, Brain-Seiten per `Read`, Kontext-Diät, Planer-Laufzeitregeln | spart Tokens, verhindert Doppel-Lesen | kein Gegenstück; gleicht Modellverhalten aus | behalten: Lockern-Kandidat #1357 | ja |
| Dev-Server-Reload nach Edit (#301) | verhindert Prüfung des alten Stands | Vite lädt JS/TS hier nicht neu (Projektfall) | behalten | nein |
| Kollisionsschutz paralleler Agenten | Assignee plus Worktree-Check | Cross-Session-Nachrichten ([Doku](https://code.claude.com/docs/en/cross-session-messaging.md)): `SendMessage`/`ListAgents` ab v2.1.224 (macOS, Linux, WSL2), native Windows ab v2.1.234 | beobachten: Nachrichten sind Text, kein Lock; Assignee plus Worktree-Check funktioniert (Vorgabe der Maintainerin) | teilweise |
| Review ohne Self-Grading, Festgefahren-Protokoll | unabhängiger Blick, begrenzte Fix-Schleifen | kein Gegenstück | behalten: gleicht eine Modellschwäche aus, Lockern-Kandidat #1357 | ja |
| Worktree-Regeln | Isolation je Ticket | `--worktree` ab v2.1.49, `isolation: worktree` ab v2.1.49 | beobachten: siehe #1066 | teilweise |
| Browser-Prüfung per Playwright-MCP, Claude in Chrome gesperrt | reproduzierbare Browser-Prüfung | `@playwright/mcp` selbst | behalten | ja |
| Vorlage-Form: Plugin und Mods | Eingabe für die Form-Entscheidung ([ADR 0022](adr/0022-dark-factory-kern-und-verteilung.md), #1366) | `claude plugin install --marketplace` ab v2.1.292 ([Plugins](https://code.claude.com/docs/en/plugins/install.md)); Mods ab v2.1.287 laufen auch in `claude -p`, nicht in WSL-Sitzungen der Desktop-App | beobachten | ja |

## D. Werkzeuge

| Eigenbau | Zweck | Natives Gegenstück (Doku-Link, ab Version) | Urteil | Spielunabhängig |
|---|---|---|---|---|
| Langfuse: Hook-Patch und `token-baseline.mjs --langfuse` | Erfassung und Messung | offizielles Plugin ([Integration](https://langfuse.com/integrations/developer-tools/claude-code)); ein offizieller Langfuse-MCP-Server ist nicht belegt (nur Community-Server); OTel-Traces von Claude Code sind Beta; verschachtelte Subagenten sendet das Plugin ab 1.2.1 selbst | beobachten: Patch-Teile #1311 und #1378 bleiben | ja |
| Playwright: `scripts/playwright-mcp.mjs` | Start mit festem Versionspin | [`@playwright/mcp`](https://github.com/microsoft/playwright-mcp) mit `--config` und Optionen; Pin bleibt Projektpolitik | behalten | ja |
| GitHub: `gh`-/GraphQL-Board-Skripte | Board-Reihenfolge, Sammeltickets | [GitHub-MCP-Server](https://github.com/github/github-mcp-server) (Toolset `projects`, nicht Default; Reihenfolge nicht belegt), `gh project` ohne Positions-Flag | behalten | teilweise |
| PixelLab: MCP-Zugriff | Pixel-Art-Erzeugung | gehosteter Server; die Tool-Liste ist auf der Website nicht belegt (nur die Server-Anweisung nennt `pixelart_workbench` und Git-Zugriff über `list_projects`) | beobachten: Außenwirkung der Git-Tools prüft die Befund-Zeile | ja |

## Befunde aus dem Erstabgleich (Stand 2026-10-08)

Kein Eigenbau erreichte „ersetzen“: jede Lücke ist unbelegt (Windows, Beta, offener Bug) oder Projektpolitik. Kleine Befunde stehen als Zeilen im Harness-Sammelticket [#1476](https://github.com/fluffels/kubernia/issues/1476): Hooks aus Agent-Frontmatter fehlen im Generator, ein Fall „Befund größer als eine Zeile“ fehlt in AGENTS.md, PixelLab-Tools mit Außenwirkung. Eingaben für die Beobachtungen liegen bei #1358 (Mods, `agentType`), #1366 ([ADR 0022](adr/0022-dark-factory-kern-und-verteilung.md); `--marketplace`, Mods) und #1362 (Marker, Versionsquellen). Die Worktree-Mechanik prüft #1066.

## Verwendung

- #1362 liest die Marker und die Versionsquellen und meldet nur Changelog-Einträge, die eine Inventarzeile berühren.
- [ADR 0022](adr/0022-dark-factory-kern-und-verteilung.md) (#1366) nimmt den Kern-Schnitt aus der Spalte „Spielunabhängig“.
- #1357 nimmt die Zeilen, die nur eine Modellschwäche ausgleichen, als Lockern-Kandidaten.

## Sicherheit

Ein MCP-Server oder Plugin, das einen Eigenbau ersetzt, muss vorher durch Netz-Allowlist, Token-Deny und Fremdtext-Abgleich: [arc42 §10](arc42-architektur.md#10-qualitätsanforderungen-qualitätsbaum), [Sicherheit der Agenten](sicherheit-agenten.md) und die Herleitung in #1429.

Bewacht von `test/harness/harness-inventar.test.ts` (Prüfstand-Marker, Vollständigkeit gegen die generierte Tabelle, festes Vokabular).

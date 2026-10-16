# ADR 0029: Harness-Cockpit als Ring „Oberfläche“ im Factory-Repo, Eigenbau, nur lesend

> Architecture Decision Record. Format: Kontext → Optionen → Entscheidung → Konsequenzen → Re-Evaluierung.
> Status: **akzeptiert** · Datum: 2026-10-16 · Ticket: #1763

## Status

**Akzeptiert.** Präzisiert [ADR 0022](0022-dark-factory-kern-und-verteilung.md) §1 (Ring-Modell des Besitz-Manifests) um einen dritten Ring. Beruft sich für „kein Multiplayer“ auf [ADR 0003](0003-multiplayer-coop-out-of-scope.md). Teil des Epics #1737 (Harness-Cockpit); dieser ADR entscheidet nur Ort, Bauweise und Grenzen, das Cockpit selbst bauen die Folgetickets. [AGENTS.md](../../AGENTS.md) bleibt unverändert. Die Maintainerin hat Ort und Ring am 2026-10-16 bestätigt (Ring im Factory-Repo, kein eigenes Repo).

## Kontext

Der Harness läuft über mehrere Quellen, die keine gemeinsame Sicht haben: Boards, Ticket-Locks, Worktrees, Langfuse, Transkripte, Sammeltickets und die Sitzungen von Claude Code. Wer wissen will, was gerade läuft, was wartet und was hängt, liest sie einzeln. Ein **Cockpit** (lokale, nur lesende Oberfläche, siehe [Glossar](../harness-glossar.md)) führt sie zusammen.

Drei Fragen stehen vor dem Bau: wo es lebt, ob man es baut oder einen Bausatz nimmt, und welche Grenzen es hat. Beim Ort kollidiert es mit dem Kern-Schnitt aus ADR 0022: das Besitz-Manifest kennt nur `kern` und `kern-nach-entkopplung`, beide werden in Projekte verteilt. Ein Cockpit gehört der Factory, soll aber **nicht** in jedes Projekt wandern.

### Probe `claude agents --json --all` (2026-10-16, Windows 11, PowerShell 7)

| Messwert | Rohwert |
|---|---|
| Version | Claude Code 2.1.301 (natives Programm) |
| Aufruf | Exit 0, 319 ms, 1798 Byte, JSON-Array mit 8 Einträgen (wiederholt 0,22 s bis 0,32 s) |
| Felder (Name:Typ) | `cwd:string`, `kind:string`, `name:string`, `pid:int`, `sessionId:string`, `startedAt:int`, `status:string` |
| Beobachtete Werte | `kind`: nur `interactive`; `status`: `busy`, `idle` |
| Dienst | `claude daemon status` nach den Aufrufen: `not running`; die Listen-Ports waren vor und 3 s nach dem Aufruf identisch |
| Prozesse | im 3-s-Fenster erschienen neue `node`-Prozesse; sie hängen am gemeinsamen Elternprozess der Sitzung (Test- und Werkzeugläufe), nicht am Aufruf, und waren dem Aufruf nicht zuordenbar. Kein dauerhafter Prozess. |

Laut Hilfe gibt `--json` die aktiven Sitzungen als JSON-Array aus und beendet sich, ohne Terminal; `--all` nimmt abgeschlossene Hintergrund-Sitzungen dazu. Belegt ist damit: **`--json` startet unter Windows keinen Dienst.** Die Doku ([Agent View](https://code.claude.com/docs/en/agent-view.md)) nennt den Supervisor-Prozess, den das Öffnen der interaktiven Ansicht oder das Schicken einer Sitzung in den Hintergrund startet; beides tut das Cockpit nie.

**Abweichung zur Doku:** sie nennt zusätzlich die Felder `id` und `state` (`working`, `blocked`, `done`, `failed`, `stopped`) und den Status `waiting`. Die Probe zeigte sie nicht, möglicherweise erscheinen sie nur bei Hintergrund-Sitzungen bzw. im Wartezustand. Das Cockpit liest jedes dieser Felder optional und behandelt ein fehlendes als „unbekannt“; Agent View ist eine Research Preview, der Vertrag kann sich ändern.

Das ersetzt den WSL2-Lauf aus #1722 AK1. Fremdwerkzeuge sind nur nach Doku bewertet, nichts davon ist installiert (Lieferkette, #1689).

## Optionen

### (a) Ort

| Option | Bewertung |
|---|---|
| A1 eigenes Repo | Dritter Ort mit Versionskopplung an Factory-Bibliotheken (Langfuse-Zugang, Projekt-Config-Leser, Board-Skripte). Kern-Reinheits-Wächter und Import-Hülle wirken nicht über Repo-Grenzen. |
| **A2 Ring `oberflaeche` im Factory-Repo (gewählt)** | Ein Ort, Wächter und Hülle gelten weiter. Das Cockpit liegt heute unter `scripts/cockpit/` und zieht mit dem Factory-Umzug (F10, #1715) unverändert um. Ein Cockpit soll per Option auf beliebig viele Projekte zeigen können. |
| A3 Kern in jedem Projekt | UI-Code und Sync-/Drift-Fläche in jedem Projekt, N Cockpits statt einem. Das Werkzeug gehört der Maintainerin, nicht dem Projekt. |

### (b) Bauweise

Kriterien: nativ unter Windows ohne tmux oder WSL, nur lesend, keine neue Lieferkette (#1689), die Harness-Quellen (Boards, Locks, Worktrees, Langfuse, Transkripte, Sammeltickets) als Kern, GitHub bleibt die Quelle der Wahrheit. Bewertung nur nach Doku:

| Werkzeug | Einordnung nach Doku |
|---|---|
| [Webmux](https://www.windmill.dev/blog/webmux) | Web-Dashboard mit eingebetteten Terminals, PR- und CI-Verfolgung, Docker-Sandbox; baut auf workmux (tmux plus Worktrees) und steuert Agenten. Verletzt „ohne tmux“ und „nur lesend“. |
| [Vibe Kanban](https://github.com/BloopAI/vibe-kanban) | Läuft über `npx`; legt Worktrees an, startet Agenten, öffnet PRs, eigener Aufgabenspeicher neben GitHub. Verletzt „nur lesend“ und „GitHub als Quelle“, neue Lieferkette. |
| agent-viewer | Kanban für Claude-Sitzungen in tmux ([Verzeichniseintrag](https://www.sourcepulse.org/projects/24936696)). Verletzt „ohne tmux“, kennt die Harness-Quellen nicht. |
| [LaneConductor](https://github.com/meller/laneconductor) | Lokale Steuerebene mit Kanban über mehrere Repos, Orchestrierung. Eigener Ablauf neben dem Ticket-Ablauf, nicht nur lesend. |
| fleetview | Keine öffentliche Doku gefunden (zwei Suchläufe, nur verwandte Namen): ohne Installation nicht bewertbar. |
| natives Agent View allein | Nur Sitzungen (`busy`/`idle`), keine Subagenten, Tickets, Worktrees, Locks, Langfuse oder Boards; Research Preview. **Datenquelle** des Cockpits (nur `--json`), kein Ersatz. |
| **Eigenbau mit Node-Builtins (gewählt)** | Keine Abhängigkeit, nur lesend per Konstruktion, die Harness-Quellen sind das Herz. Kosten: eigener Pflegeaufwand. |

## Entscheidung

**Ring `oberflaeche` im Factory-Repo, Eigenbau mit Node-Builtins, lokal ohne Backend, nur lesend, kein Multiplayer.**

- **(c) Lokal ohne Backend:** Prozess auf 127.0.0.1, keine Datenbank, keine Persistenz außer einem flüchtigen Zwischenspeicher im Speicher, kein Cloud-Dienst.
- **(d) Nur lesend:** der Server beantwortet nur GET und HEAD; Unterprozesse nur über eine Allowlist lesender Befehle. Schreiben (Release-Beobachtung, Belege) macht allein der Board-Takt, nie das Cockpit. Aktionen erscheinen als Befehl zum Kopieren (etwa `claude attach <id>`), Fremdtext wird escaped.
- **(e) Kein Multiplayer** ([ADR 0003](0003-multiplayer-coop-out-of-scope.md)): eine Nutzerin, keine Konten, keine Anmeldung, nur localhost.

**Ring-Regeln** (SSOT `RING_IMPORTE` und `NUR_FACTORY` in `scripts/besitz-lib.mjs`):

| Importeur \ Ziel | `kern` | `kern-nach-entkopplung` | `oberflaeche` |
|---|---|---|---|
| `kern` | ja | nein | nein |
| `kern-nach-entkopplung` | ja | ja | nein |
| `oberflaeche` | ja | ja | ja |

Ein Importeur mit unbekanntem Ring importiert keinen Besitz. `oberflaeche` bekommt **keine** Ausnahme der Import-Hülle: das Cockpit soll mit F10 unverändert umziehen und darf nur Besitz oder die Projekt-Config importieren. Die Literalzählung des Kern-Reinheits-Wächters gilt für `oberflaeche` wie für `kern` (Baseline 0).

**Verteilung:** der Sync überträgt Einheiten des Rings `oberflaeche` nie in ein Projekt und listet sie nicht im Sync-Stand; das Drift-Gate erwartet sie im Projekt nicht (`wirdVerteilt`, Deny-List: ein unbekannter Ring wird geprüft und verteilt, also fail-closed). Das Manifest selbst geht ganz ins Projekt, weil das Drift-Gate seinen Hash vergleicht und eine gefilterte Neu-Serialisierung das Format zerstörte.

## Konsequenzen

- **Grenze:** ein Projekt trägt damit Manifest-Einträge, deren Dateien es nicht hat. `pruefeManifest` läuft heute nur in der Quelle (Sync); liefe der Wächter im Projekt, müsste er per `wirdVerteilt` filtern. F10 (#1715) entscheidet das.
- Ein weiterer nicht verteilter Ring ist eine Zeile in `RINGE`, `RING_IMPORTE` und `NUR_FACTORY` plus ein Test.
- Das Cockpit hängt an Agent View nur über `claude agents --json` und liest fehlende Felder als „unbekannt“. Ändert Claude Code den Vertrag, bricht höchstens eine Anzeige, nie ein Gate.
- Der WSL2-Lauf aus #1722 AK1 entfällt (Probe oben).
- Neue Pflege: das Cockpit ist eigener Code; wo es zu groß wird, gilt die [Oberste Regel](../../AGENTS.md#das-wichtigste-zuerst-harte-regeln) wie überall.

## Re-Evaluierung

- Agent View liefert einen stabilen JSON-Vertrag samt Subagenten: dann das Cockpit auf diese Quelle zurückbauen, soweit sie reicht.
- Eine zweite Person braucht das Cockpit: (e) und der localhost-Zuschnitt neu entscheiden, vorher nichts bauen.
- Ein Bausatz erfüllt alle Kriterien (Windows nativ, nur lesend, ohne Abhängigkeit, Harness-Quellen anbindbar): Eigenbau gegen ihn abwägen.

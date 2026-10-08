# ADR 0022: Dark Factory — Kern-Schnitt des Harness und Verteilung per Sync mit Besitz-Manifest

> Architecture Decision Record. Format: Kontext → Optionen → Entscheidung → Folgeticket-Entwürfe → Konsequenzen → Re-Evaluierung.
> Status: **akzeptiert** · Datum: 2026-10-08 · Ticket: #1366

## Status

**Akzeptiert.** Präzisiert [ADR 0008](0008-ki-agenten-harness.md) (das Entwicklungsmodell bleibt), Teil von #1350 (Baustein 8). Der ADR **ändert keine Regel**: [AGENTS.md](../../AGENTS.md) gilt unverändert, bis Folgetickets landen. **Nicht entschieden: die Veröffentlichung** (öffentliches Repo, Marketplace-Eintrag). Sie hat Außenwirkung und liegt bei der Maintainerin ([Checkpoints](../../AGENTS.md#git-pr-und-merge)). Folgetickets sind unten nur entworfen, nicht angelegt.

## Kontext

Zielbild der Maintainerin (2026-10-08): der spielunabhängige Teil des Harness wird eine wiederverwendbare **Dark Factory**; kubernia ist ihr erster Nutzer. Eingaben: die Spalte „Spielunabhängig“ im [Inventar](../harness-inventar.md), das [Transfer-Kit](../harness-transfer.md) samt Fremdrepo-Test für docs-gen, und diese Messwerte (2026-10-08, im Worktree erhoben):

- `grep -rl fluffels scripts .claude/agents .claude/skills .claude/workflows .github/workflows`: 7 Dateien tragen den Owner-Namen als Literal (`board-lib.mjs`, `kubernia-umsetzer.md`, `forum/SKILL.md`, `kubernia/SKILL.md`, `kubernia-ticket.js`, `forum-inbox.yml`, `release.yml`).
- `scripts/board-lib.mjs:15`: `PROJECT_ID` als Literal.
- `grep -rli stardew .claude scripts`: Planer, Umsetzer, `review-lenses`, `kubernia-ticket.js` und Kommentare mehrerer `check-*.mjs` und `layers.cjs`.
- `scripts/layers.cjs` mischt Kubernia-Schichtdaten (`LAYERS`, `SCHICHT_MODELL`) mit generischer Ableitung (`pruefeModell`, `musterAus`).

Belegte Fakten zu den Optionen (gelesen 2026-10-08):

- **Plugin-Manifest** ([Referenz](https://code.claude.com/docs/en/plugins-reference)): trägt Skills, Agenten, Hooks, MCP/LSP, Workflows, Monitore und `bin/`. `settings` wirkt nur für `agent` und `subagentStatusLine`, nicht für `permissions` oder `sandbox`. Eine `CLAUDE.md` im Plugin-Root wird nicht geladen. Namensraum `<plugin>:<name>`.
- **Plugin-Laden** ([Doku](https://code.claude.com/docs/en/plugins/loading)): ein nur in der Projekt-Settings-Datei aktiviertes Plugin mit externer Quelle wird auf einem Rechner ohne Installation nicht geholt; Cloud-Sessions übernehmen `extraKnownMarketplaces` nicht; Auto-Update fremder Marketplaces ist standardmäßig aus; Version = Manifest-Version oder Commit-SHA.
- **Mods** (Inventar): ab v2.1.287, laufen in `claude -p`, nicht in WSL der Desktop-App.
- **Template-Repo:** startet mit einem Commit, keine gemeinsame Historie, kein Weg für spätere Updates.
- **Subtree:** nur ein Präfix-Ordner; `.github/workflows`, `AGENTS.md` und `.claude/` müssen im Root liegen; Symlinks brechen unter Windows (#993).
- **Copier-Update** ([Doku](https://copier.readthedocs.io/en/stable/updating/)): Projekt neu erzeugen und Diff anwenden; braucht Antwortdatei und Git-Tags, Python und Jinja-Vorlagen. Windows-Verhalten dort nicht erwähnt: unbelegt.

## Optionen

Kriterien: Updates zurück in abgeleitete Projekte, Tool-Neutralität, Windows, Pflegeaufwand.

| Option | Updates | Tool-Neutralität | Windows | Pflege | Urteil |
|---|---|---|---|---|---|
| A Claude-Code-Plugin mit Marketplace | gut | nein, nur Claude-Schicht; `AGENTS.md`, CI, Gates und `permissions` passen nicht hinein | ja | gering | nicht als Träger, beobachten |
| B Template-Repo | keiner | ja | ja | keine | verworfen |
| C1 Scaffolder mit Templating (copier) | Diff mit Konfliktmarkern | ja | unbelegt, Python nötig | Jinja-Dateien laufen im Factory-Repo nicht (kein Dogfooding) | verworfen |
| **C2 Sync mit Besitz-Manifest** | **Überschreiben des Besitzes, kein Merge** | **ja** | **ja (Node, keine Symlinks)** | **Eigenbau-Werkzeug** | **gewählt** |
| D Subtree | Merge-Konflikte | ja | Symlink-Probleme | Layout-Zwang | verworfen |
| E npm-Paket | gut für Skripte | trägt nur Skripte, Node in Fremdprojekten Pflicht | ja | Veröffentlichung ist Außenwirkung | verworfen als Träger |

**Prüfung nach der obersten Regel:** bei N Projekten und 10× Harness-Änderungen kostet C2 je Update einen PR je Projekt ohne Merge-Arbeit; Templating und Subtree wachsen mit den Anpassungen je Projekt. Die Empfehlung aus #1373 („kein eigenes docs-gen-Paket“) wird bestätigt (Option E): docs-gen ist ein Baustein des Kerns.

## Entscheidung

**Entscheidung: Factory-Repo als Quelle, verteilt per Sync mit Besitz-Manifest (C2), Projektwerte zur Laufzeit statt Templating; Plugin nur als spätere optionale Verpackung der Claude-Schicht (beobachten), weil nur C2 Updates ohne Merge-Arbeit, Tool-Neutralität, Windows und Dogfooding zugleich erfüllt.**

Mechanik: Kern-Dateien sind in jedem Projekt byte-gleich. Projektwerte (Repo, Owner, Board-IDs, Labels, Präfixe, Sprache, Begriffsliste) liest der Kern zur Laufzeit aus einer Projekt-Config (Vorbild: `docs-gen --config`). Das Manifest listet den Besitz der Factory: eine Datei, einen Markdown-Block zwischen Markern oder einen JSON-Schlüssel. Der Sync überschreibt nur Besitz, kein Merge. Ein Drift-Gate wird rot, wenn ein Projekt Besitz ändert, und nennt den Weg (Upstream oder Config).

### 1. Kern-Schnitt in Ringen

- **Kern:** die „ja“-Zeilen des Inventars ohne Werkzeug-Anbindung, der docs-gen-Kern (Engine, markdown, adr, zeitleiste, schichten), CycloneDX-SBOM (Dependency-Track bewusst nicht), Factory-Kennzahlen und `check:internalrefs` samt Anonymitätsregel.
- **Kern nach Entkopplung:** die „teilweise“-Zeilen, je einem Schritt zugeordnet (Tabelle unten), plus die „nein“-Zeilen, deren Funktion Kern einer Factory ist: Ticket-Ablauf (`kubernia`, `kubernia-workflow`, `kubernia-ticket`), Umsetzer-Abschluss, Lens-Auftrag- und Lens-Edit-Guard (alle nach #1067) und der Takt (nach F11).
- **Module** (generisch, je Projekt wählbar): Playwright-Browserprüfung, PixelLab, Forum-Eingang. „Spielunabhängig“ heißt nicht „projektunabhängig“.
- **Projekt:** Stardew-Messlatte, Save-Migration samt `save-versionen`, Schichtdaten aus `layers.cjs`, `src/content/AGENTS.md`, Spiel-Generatoren, Dev-Server-Reload (#301).

| „teilweise“-Zeile | Schritt |
|---|---|
| Worktree-Guard, Stop/Cleanup, Worktree-Regeln | F3, #1066 |
| `gh`-Guard, haupt-sync, Kollisionsschutz | F2, F3 |
| Planer und Umsetzer | F3, F5, F6 |
| `review-lenses` | F5 |
| Board-Skripte | F2, F11 |
| Messen | F14 |
| Fremdtext | F2 |
| Gates und CI-Nachweis | F3, F7 |
| Permissions und Sandbox | F9 (Besitz je JSON-Schlüssel) |

Die Zeilen selbst stehen nur im Inventar (SSOT), nicht hier.

### 2. Verifikation ohne Mensch (Holdout)

Ort ist der Ticket-Workflow. Ein eigener Agent schreibt allein aus dem Ticket Prüfszenarien je Akzeptanzkriterium, bevor geplant wird. Der Workflow hält die Szenarien im Laufzustand und gibt sie nie an Planer oder Umsetzer (nicht im Worktree, nicht im Repo vor dem Merge). Nach grünem `verify` und Lens-Review prüft ein frischer Abnahme-Agent gegen die Szenarien (öffentliche API aus einem Ordner außerhalb des Worktrees, Browser per Playwright). Urteil je Kriterium: erfüllt, nicht erfüllt, nicht prüfbar, jeweils mit Beleg. Maß „erfüllt die Absicht“ = alle erfüllt.

- „Nicht erfüllt“: die Verhaltensbeschreibung geht in eine Fix-Runde und zählt gegen Cap 2.
- „Nicht prüfbar“ ist ein Spezifikationsmangel: kein Merge, Hand-off mit Ticket-Kommentar.
- Spur: PR-Kommentar plus Commit-Zeile analog `KQ-Review:`.
- Die Lenses bleiben; ob sie schlanker werden, klärt #1357.
- Ehrliche Grenze: der Holdout ist nur so stark wie die Trennung im Workflow.

### 3. Eingang = Spezifikation

Mindestformat: `## Ziel` und `## Akzeptanzkriterien` mit mindestens einem Negativfall. Geprüft bei der Auswahl; darunter wird übersprungen und einmal kommentiert, was fehlt. Sammel- und Epic-Tickets haben eigene Formate. Einführung nach der Transfer-Grundregel: Bestand berichtend, Neues hart.

### 4. Menschliche Stopps

Die Liste aus AGENTS.md (Zuschnitt #1363) steht im Kern-Block der AGENTS.md. Ein Projekt kann ergänzen, nie streichen; das Drift-Gate wird rot bei einer Änderung am Kern-Block. Die Stopps sind nicht abschaltbar.

### 5. Zwei Boards

Das Factory-Board (Harness, Langfuse, Gates, Skills) gehört zum Factory-Repo, kubernia hat ein reines Produkt-Board. Ein GitHub-Project kann Issues mehrerer Repos enthalten ([Beleg](https://docs.github.com/en/enterprise-server@3.19/issues/planning-and-tracking-with-projects/managing-items-in-your-project/adding-items-to-your-project)). Generische Befunde sind Issues im Factory-Repo; kubernia-spezifische Harness-Befunde bleiben Issues im kubernia-Repo und stehen auf dem Factory-Board. **Trennregel:** trifft die Änderung eine Besitz-Datei, gehört sie ins Factory-Repo, sonst nach kubernia.

Die Spielquote ([ADR 0016, Fortschreibung #1425](0016-langfuse-takt-woechentlich.md#fortschreibung-1425-2026-10-08-spielquote-im-takt)) wirkt künftig in der Auswahl über zwei Boards: nach 3 Produkt-Merges ist das oberste Factory-Item dran. Das ersetzt die Sammelticket-Position und löst das Positionsproblem aus #1425. Sammeltickets und Status-Ticket ziehen aufs Factory-Board; Board-Skripte und `docs/ticket-reihenfolge.md` lesen eine Liste von Boards. Bis F11 bleibt es bei einem Board.

### 6. Messung

Nacharbeit (`Folge #`, `scripts/lauf-ergebnis.mjs`), Lauf-Ergebnis, Kosten je Ticket (`token-baseline.mjs --langfuse`) und die Abnahme-Quote im ersten Durchgang. Ausgabe im Wochen-Status-Ticket; Schwellen erst nach mindestens 4 Wochen Baseline.

### 7. Anonymität

Regel, Git-Identität und `check:internalrefs` gelten im Factory-Repo und für jede synchronisierte Datei; keine persönlichen lokalen Pfade. Der Mechanismus liegt im Kern, die Begriffsliste ist Projektwert.

### 8. Sprache

Kern-Texte bleiben deutsch, die Sprachregel wird Projektwert; erstes nicht deutschsprachiges Projekt ist ein Re-Evaluierungs-Trigger.

### 9. Inkubation

Der Kern wird zuerst in kubernia geschnitten (Extraktion = Umzug, kein Umbau). Vor der Veröffentlichungsentscheidung entstehen kein neues Repo, kein Marketplace-Eintrag, kein npm-Paket und kein zweites Board.

### 10. Offen für die Maintainerin

Factory-Repo öffentlich oder privat; Marketplace-Eintrag (nur bei Plugin-Verpackung); Lizenz. Danach werden die Folgetickets angelegt.

## Folgeticket-Entwürfe

Alle `area:harness`, je eine Session unter `check:diffsize`, **angelegt erst nach der Veröffentlichungsentscheidung** wie Epic-Kinder. F1, F2, F7, F9, F12, F14 und F15 haben keine Außenwirkung und taugen auch ohne Veröffentlichung.

| Nr | Titel | Ziel und Akzeptanz (mit Negativfall) | blockiert durch |
|---|---|---|---|
| F1 | Besitz-Manifest und Kern-Reinheits-Wächter | Wächter zählt Projektliterale je Kern-Datei; Baseline nur sinkend; ein neues Literal ist rot | — |
| F2 | Projekt-Config mit Repo-, Owner- und Board-IDs | `board-lib.mjs` und die 7 Dateien lesen die Config; fehlende Config bricht klar ab, kein stiller kubernia-Default | F1 |
| F3 | Labels, Branch-/Worktree-Präfix, Commit-Zeilen-Präfix `KQ-`, Agentennamen aus Config | bestehende Nachweise bleiben gültig | F2, #1067 |
| F4 | AGENTS.md in Kern- und Projekt-Block | Stopp-Liste im Kern-Block, oberste Regel als Projekt-Leitfrage; Streichen eines Stopps im Projekt-Block ist rot | F1, #1363 |
| F5 | Stardew-Regeln aus Planer, Umsetzer, `review-lenses`, Workflow herauslösen | Kern enthält keinen Stardew-Bezug (Wächter) | F4, #1067 |
| F6 | Save-Migration ins Projekt | Kern-Registry enthält keinen Spiel-Generator (Wächter) | F4 |
| F7 | `layers.cjs` teilen: Daten (Projekt), Ableitung und `pruefeModell` (Kern) | `check:arch`, `check:c4` und docs-gen grün, Fremdrepo-Test; Leitplanken-Pfad, also Audit-Kommentar | F1 |
| F8 | Sprache als Projektwert | Kern-Texte bleiben deutsch | F4 |
| F9 | Sync-Werkzeug und Drift-Gate | Besitz je Datei, Block, JSON-Schlüssel; idempotent; CRLF-neutral; Probe unter Git Bash und PowerShell; Fremdrepo-Fixture; Projektänderung an Besitz ist rot und nennt den Weg | F1, F2 |
| F10 | Factory-Repo anlegen und Kern extrahieren | Pre-Flight, Dogfooding, kubernia per Sync von einem Tag, `check:internalrefs` grün, Langfuse-Erfassung nach #1293 belegt, FAQ-Antwort zur Übertragbarkeit nachziehen | Veröffentlichungsentscheidung, F2–F9, #993, #1067 |
| F11 | Zwei Boards | Pre-Flight für Project-Felder und -Ansichten, Board-Liste in Config, Auswahl mit Quote (Fortschreibung ADR 0016), Trennregel in AGENTS.md, Umzug der Sammeltickets; danach trägt das Produkt-Board kein `area:harness`-Item mehr | F2 |
| F12 | Spezifikations-Gate als pure Prüffunktion | Überspringen mit einmaligem Kommentar; Bestand berichtend | — |
| F13 | Holdout-Abnahme | Szenario-Agent, Abnahme-Agent, Urteil je Kriterium, „nicht prüfbar“ stoppt den Merge | #1067, F12 |
| F14 | Factory-Kennzahlen | fehlende Langfuse-Daten erscheinen als Lücke, nicht als 0 | — (Abnahme-Quote: F13) |
| F15 | CycloneDX-SBOM in der CI | Werkzeug im Ticket belegen (`npm sbom --sbom-format cyclonedx`, [Doku](https://docs.npmjs.com/cli/v10/commands/npm-sbom)); Dependency-Track bewusst nicht | — |

Reihenfolge: F1 → F2 → (F7, F9, F12, F14, F15) → F3 → F4 → F5/F6/F8 → F11 → F13 → F10.

## Konsequenzen

- **Leichter:** Updates ohne Merge-Arbeit, Dogfooding im Factory-Repo, die Spielquote über zwei Boards ist einfach.
- **Schwerer:** Anpassungen an Kern-Dateien gehen nur upstream oder per Config; das Sync-Werkzeug ist Eigenbau; die Inkubation bindet Harness-Kapazität, die Spielquote gilt weiter.
- Das Inventar-Urteil zu Plugin und Mods bleibt „beobachten“.

## Re-Evaluierung

- Plugins können `permissions`, `sandbox` oder Kontextdateien tragen, oder ein im Projekt aktiviertes Plugin wird ohne Nutzerschritt geholt (meldet der Release-Watch #1362).
- Mehr als 3 Projektänderungen an Besitz in einem Monat.
- Das Sync-Werkzeug wächst über 800 Zeilen: copier neu prüfen.
- Das erste nicht deutschsprachige Projekt.
- Die Nacharbeitsquote steigt nach F13 vier Wochen in Folge.

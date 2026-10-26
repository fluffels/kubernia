# ADR 0022: Dark Factory — Kern-Schnitt des Harness und Verteilung per Sync mit Besitz-Manifest

> Architecture Decision Record. Format: Kontext → Optionen → Entscheidung → Folgeticket-Entwürfe → Konsequenzen → Re-Evaluierung.
> Status: **akzeptiert, Workflow-Pfad entfernt: präzisiert durch ADR 0028, Ring Oberfläche: präzisiert durch ADR 0029, Ticket-Ablauf im Ring kern und Produkt-Skill im Projekt: präzisiert durch ADR 0028, Fortschreibung #1806, Betrieb ohne Harness im Projekt-Repo: Fortschreibung #1829** · Datum: 2026-10-08 · Ticket: #1366

## Status

**Akzeptiert.** Präzisiert [ADR 0008](0008-ki-agenten-harness.md) (das Entwicklungsmodell bleibt), Teil von #1350 (Baustein 8). Der ADR **ändert keine Regel**: [AGENTS.md](../../AGENTS.md) gilt unverändert, bis Folgetickets landen. **Nicht entschieden: die Veröffentlichung** (öffentliches Repo, Marketplace-Eintrag). Sie hat Außenwirkung und liegt bei der Maintainerin ([Checkpoints](../../AGENTS.md#git-pr-und-merge)). (Nachtrag 2026-10-16: entschieden, siehe [Fortschreibung #1706](#fortschreibung-1706-2026-10-16-veröffentlichungsentscheidung).) Folgetickets sind unten nur entworfen, nicht angelegt. (Nachtrag 2026-10-16: angelegt, Spalte „Ticket“ der [Folgeticket-Tabelle](#folgeticket-entwürfe).)

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

Präzisiert durch [ADR 0029](0029-harness-cockpit.md): dritter Ring `oberflaeche`.

### 2. Verifikation ohne Mensch (Holdout)

Ort ist der Ticket-Workflow. Ein eigener Agent schreibt allein aus dem Ticket Prüfszenarien je Akzeptanzkriterium, bevor geplant wird. Der Workflow hält die Szenarien im Laufzustand und gibt sie nie an Planer oder Umsetzer (nicht im Worktree, nicht im Repo vor dem Merge). Nach grünem `verify` und Lens-Review prüft ein frischer Abnahme-Agent gegen die Szenarien (öffentliche API aus einem Ordner außerhalb des Worktrees, Browser per Playwright). Urteil je Kriterium: erfüllt, nicht erfüllt, nicht prüfbar, jeweils mit Beleg. Maß „erfüllt die Absicht“ = alle erfüllt.

- „Nicht erfüllt“: die Verhaltensbeschreibung geht in eine Fix-Runde und zählt gegen Cap 2.
- „Nicht prüfbar“ ist ein Spezifikationsmangel: kein Merge, Hand-off mit Ticket-Kommentar.
- Spur: PR-Kommentar plus Commit-Zeile analog `KQ-Review:`.
- Die Lenses bleiben; ob sie schlanker werden, klärt #1357.
- Ehrliche Grenze: der Holdout ist nur so stark wie die Trennung im Workflow.

Präzisiert durch #1713: die Holdout-Abnahme läuft im Skill-Pfad, Format und Auswertung stehen in #1753 (Fortschreibung #1713 unten).

### 3. Eingang = Spezifikation

Mindestformat: `## Ziel` und `## Akzeptanzkriterien` mit mindestens einem Negativfall. Geprüft bei der Auswahl; darunter wird übersprungen und einmal kommentiert, was fehlt. Sammel- und Epic-Tickets haben eigene Formate. Einführung nach der Transfer-Grundregel: Bestand berichtend, Neues hart.

### 4. Menschliche Stopps

Die Liste aus AGENTS.md (Zuschnitt #1363) steht im Kern-Block der AGENTS.md. Ein Projekt kann ergänzen, nie streichen; das Drift-Gate wird rot bei einer Änderung am Kern-Block. Die Stopps sind nicht abschaltbar. *(Präzisiert durch #1708: kein eigener Block `stopps`, die Kern-Stopps stehen im Kern-Block `kern`, die Projekt-Stopps im Projekt-Block; Fortschreibung #1708 unten.)*

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

Factory-Repo öffentlich oder privat; Marketplace-Eintrag (nur bei Plugin-Verpackung); Lizenz. Danach werden die Folgetickets angelegt. Entschieden am 2026-10-16: [Fortschreibung #1706](#fortschreibung-1706-2026-10-16-veröffentlichungsentscheidung).

## Folgeticket-Entwürfe

Alle `area:harness`, je eine Session unter `check:diffsize`, **angelegt erst nach der Veröffentlichungsentscheidung** wie Epic-Kinder. F1, F2, F7, F9, F12, F14 und F15 haben keine Außenwirkung und taugen auch ohne Veröffentlichung.

| Nr | Titel | Ziel und Akzeptanz (mit Negativfall) | blockiert durch | Ticket |
|---|---|---|---|---|
| F1 | Besitz-Manifest und Kern-Reinheits-Wächter | Wächter zählt Projektliterale je Kern-Datei; Baseline nur sinkend; ein neues Literal ist rot | — | #1610 |
| F2 | Projekt-Config mit Repo-, Owner- und Board-IDs | `board-lib.mjs` und die 7 Dateien lesen die Config; fehlende Config bricht klar ab, kein stiller kubernia-Default | F1 | #1611 |
| F3 | Labels, Branch-/Worktree-Präfix, Commit-Zeilen-Präfix `KQ-`, Agentennamen aus Config | bestehende Nachweise bleiben gültig | F2, #1067 | #1707 |
| F4 | AGENTS.md in Kern- und Projekt-Block | Stopp-Liste im Kern-Block, oberste Regel als Projekt-Leitfrage; Streichen eines Stopps im Projekt-Block ist rot | F1, #1363 | #1708 |
| F5 | Stardew-Regeln aus Planer, Umsetzer, `review-lenses`, Workflow herauslösen | Kern enthält keinen Stardew-Bezug (Wächter) | F4, #1067 | #1709 |
| F6 | Save-Migration ins Projekt | Kern-Registry enthält keinen Spiel-Generator (Wächter) | F4 | #1710 |
| F7 | `layers.cjs` teilen: Daten (Projekt), Ableitung und `pruefeModell` (Kern) | `check:arch`, `check:c4` und docs-gen grün, Fremdrepo-Test; Leitplanken-Pfad, also Audit-Kommentar | F1 | #1612 |
| F8 | Sprache als Projektwert | Kern-Texte bleiben deutsch | F4 | #1711 |
| F9 | Sync-Werkzeug und Drift-Gate | Besitz je Datei, Block, JSON-Schlüssel; idempotent; CRLF-neutral; Probe unter Git Bash und PowerShell; Fremdrepo-Fixture; Projektänderung an Besitz ist rot und nennt den Weg | F1, F2 | #1613 |
| F10 | Factory-Repo anlegen und Kern extrahieren | Pre-Flight, Dogfooding, kubernia per Sync von einem Tag, `check:internalrefs` grün, Langfuse-Erfassung nach #1293 belegt, FAQ-Antwort zur Übertragbarkeit nachziehen | Veröffentlichungsentscheidung, F2–F9, #993, #1067 | #1715 |
| F11 | Zwei Boards | Pre-Flight für Project-Felder und -Ansichten, Board-Liste in Config, Auswahl mit Quote (Fortschreibung ADR 0016), Trennregel in AGENTS.md, Umzug der Sammeltickets; danach trägt das Produkt-Board kein `area:harness`-Item mehr | F2 | #1712 |
| F12 | Spezifikations-Gate als pure Prüffunktion | Überspringen mit einmaligem Kommentar; Bestand berichtend | — | #1615 |
| F13 | Holdout-Abnahme | Szenario-Agent, Abnahme-Agent, Urteil je Kriterium, „nicht prüfbar“ stoppt den Merge | #1067, F12 | #1713 |
| F14 | Factory-Kennzahlen | fehlende Langfuse-Daten erscheinen als Lücke, nicht als 0 | — (Abnahme-Quote: F13) | #1616 |
| F15 | CycloneDX-SBOM in der CI | Werkzeug im Ticket belegen (`npm sbom --sbom-format cyclonedx`, [Doku](https://docs.npmjs.com/cli/v10/commands/npm-sbom)); Dependency-Track bewusst nicht | — | #1617 |

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

## Fortschreibung #1476 (2026-10-08): F11 vor F10, Zwischenzustand

Die Reihenfolge bleibt (F11 vor F10), obwohl F10 das Factory-Repo anlegt. Ein GitHub Project gehört dem Konto oder der Organisation, nicht einem Repository ([About Projects](https://docs.github.com/en/issues/planning-and-tracking-with-projects/learning-about-projects/about-projects): „at the user or organization level“), und die Items sind Issues; das Produkt-Board führt heute schon Items per Filter aus einem Repository. Darum legt F11 das Factory-Board vor dem Factory-Repo an. Bis F10 bleiben Factory-Items (Sammel- und Status-Ticket, `area:harness`) Issues in kubernia und wechseln nur das Board. Ob und wann sie ins Factory-Repo übertragen werden, entscheidet F10 im Pre-Flight (Außenwirkung). F11 bekommt keinen Blocker F10; der Body von F11 nennt diesen Zwischenzustand. Der FAQ-Verweis auf diesen ADR steht schon; F10 ergänzt nur den Repo-Link.

## Fortschreibung #1612 (2026-10-16): Schicht-Kern (F7)

F7 ist umgesetzt. Entscheidungen:

- **Schnitt:** `scripts/layers.cjs` bleibt die Projektdatei und trägt nur Daten (`LAYERS`, `PHASER`, `QUELLWURZEL`, `SCHICHT_MODELL`, `LABEL_TO_LAYER`) sowie die vom Kern abgeleiteten Werte `layerOf`, `NON_DOMAIN`, `COVERAGE_GLOBS`. Neu ist `scripts/schichten-kern.cjs` (Ring `kern`, literalfrei, ohne Importe): `musterAus`, `pruefeModell`, `layerOfAus`, `wurzelnAusserAuffangAus`, `coverageGlobsAus`, `verbotsRegeln`; jede Ableitung prüft das Modell zuerst. CommonJS, weil der dependency-cruiser-Config es per `require` lädt.
- **Prüfung im Kern:** `ladeModell` (docs-gen) prüft mit dem Kern; ein von der Projektdatei mitgelieferter Prüfer wird ignoriert, ein Projekt kann die Prüfung nicht aushebeln. Der Wert: Fremd-Repos bekommen die strenge Kern-Prüfung.
- **Wächter:** `test/harness/kern-reinheit.test.ts` prüft, dass keine Einheit des Besitz-Manifests die Schichtdaten statisch importiert (nur direkte Importe, relativ zur importierenden Datei aufgelöst, Pfad aus `schichten.layers`). Offene Ausnahme: `scripts/check-diffcoverage.mjs` bis #1611 (Pfad aus der Projekt-Config); die Ausnahmeliste darf nur schrumpfen und braucht je ein Ticket.
- **Grenze:** Ein indirekter Import (über ein drittes Modul) und ein zusammengesetzter Pfad bleiben unbemerkt. Die Projektdatei bleibt `scripts/layers.cjs`; ein Umzug ist Sache von F2 und F9.

## Fortschreibung #1610 (2026-10-15): Besitz-Manifest und Kern-Reinheits-Wächter

F1 ist umgesetzt. Entscheidungen:

- **Ort und Format:** `.factory/besitz.json` (werkzeugneutral, ein Leitplanken-Pfad), `{ "version": 1, "eintraege": [ { "pfad", "block"?, "schluessel"?, "ring", "quelle" } ] }`, flache Liste. Eine Einheit ist eine ganze Datei (`pfad`), ein Markdown-Block (`pfad#<block>`, Marker `<!-- factory-besitz:start <id> -->` und `<!-- factory-besitz:ende <id> -->` je genau einmal) oder ein JSON-Schlüssel der obersten Ebene (`pfad#/<schluessel>`). Eine Datei steht ganz oder in Teil-Einheiten, nie beides. `ring` ist `kern` oder `kern-nach-entkopplung`, `quelle` verweist auf die Inventarzeile bzw. den Folgeschritt.
- **Startbestand:** Inventarzeilen „ja“ ohne Werkzeug-Anbindung sind Ring `kern`, „teilweise“ Ring `kern-nach-entkopplung`, dazu die „nein“-Ausnahmen aus §1; eine Bibliothek bekommt den Ring ihres strengsten Importeurs. Module und Projekt-Config stehen nicht im Manifest. Die Regelzeilen des Inventars (Abschnitt C) und die Anonymitätsregel kommen als Markdown-Blöcke mit F4 (Kern/Projekt-Split der AGENTS.md); der Stopps-Block ist bis dahin der einzige Block (Kontext-Budget). *(Präzisiert durch #1708: der Split ist da, ein zusammenhängender Kern-Block `kern`; Inhalt und Zuschnitt in der Fortschreibung #1708 unten.)* `scripts/check-internalrefs.mjs` steht abweichend von §1 im Ring `kern-nach-entkopplung`, weil die Begriffsliste im Skript ein Projektwert ist. Das Manifest ist ab jetzt die Besitz-SSOT, es gibt keinen maschinellen Abgleich mit dem Inventar. Neue Kern-Dateien (F2, F7, F9) kommen ins Manifest und müssen literalfrei sein.
- **Wächter:** `test/harness/kern-reinheit.test.ts` zählt je Einheit die Projektliterale Owner, Repo, Board-ID und Stardew gegen `test/harness/kern-literale-baseline.json`. Ein neues Literal ist rot, ein Wert unter der Baseline verlangt das Senken. Anheben ist rot, sobald der Wert einer geänderten, umbenannten oder neuen Einheit über der Zählung an der Diff-Basis liegt (neue Dateien: 0); in der CI ist eine fehlende Diff-Basis ebenfalls rot.
- **Grenze:** Das Wegfallen eines Eintrags aus dem Manifest zeigt nur der Leitplanken-Diff; Board-Option-IDs (Hex) erkennt die Board-ID-Regel nicht. Auch das Aufnehmen einer unveränderten Datei samt Baseline-Eintrag und eine neue Datei in einem Kern-Verzeichnis, die nicht ins Manifest kommt, bleiben unbemerkt (F9 prüft die Abdeckung). Die Marker-Position in der Zeile prüft der Wächter nicht. Die verbleibenden Literale (vor allem der Repo-Name als Agentenname) räumt F3.

## Fortschreibung #1611 (2026-10-16): Projekt-Config (F2)

F2 ist umgesetzt. Entscheidungen:

- **Ort und Lader:** `.factory/projekt.json` (Leitplanken-Pfad, nicht im Besitz-Manifest) mit den Pflichtschlüsseln `version` (1), `repo` (`owner/name`) und `board` (`besitzer`, `besitzerTyp` `user`|`org`, `nummer`, `projectId`, `statusFeldId`, `statusFeldNodeId`, `todoOptionId`); optional `projektliterale` (Name → Begriff) für Zusatzbegriffe des Wächters. Gelesen wird sie über den literalfreien Kern-Lader `scripts/projekt-config-lib.mjs` mit dem Einstieg `scripts/projekt-config.mjs` (nur Node-Builtins, Ring `kern`; die Trennung folgt der Konvention, dass Einstiegsskripte nicht voneinander importieren). Fehlt die Datei oder ein Pflichtschlüssel, bricht der Lader mit Pfad, Fehlerliste und „Fix:“-Zeile ab, es gibt keinen Standardwert und keinen Env-Override des Pfads (`--config` nur an der Kommandozeile).
- **Board-Besitzer eigene Schlüssel:** Das Board gehört dem Konto, nicht dem Repo (Fortschreibung #1476), darum sind `besitzer` und `besitzerTyp` getrennt von `repo`; daraus entsteht der REST-Pfad `BOARD_PFAD` in `scripts/board-lib.mjs`.
- **Workflows:** Repo und Owner kommen aus dem GitHub-Kontext (`github.repository`, `GITHUB_REPOSITORY`), die Board-ID per `node scripts/projekt-config.mjs board.projectId` aus einem Sparse-Checkout der Config. Fehlt sie, meldet `set_board_top` `::error::` und lässt die Position ungesetzt, das Issue entsteht trotzdem. Eine Repo-Variable wäre eine Repo-Einstellung (Pre-Flight-Stopp) und verteilt sich nicht mit dem Kern.
- **Wächter:** `test/harness/kern-reinheit.test.ts` leitet die Begriffe aus der Config ab (Owner: Repo-Owner und Board-Besitzer, Repo: Repo-Name, plus `projektliterale`); das Board-ID-Muster `PVT…_` bleibt eine generische Kern-Konstante. Begriffsnamen und Baseline-Format bleiben, die Baseline sinkt.
- **Absicherung der Workflows:** `test/harness/projekt-config-workflows.test.ts` ermittelt die Import-Hülle des Einstiegs (nur `node:` und relative Importe) und verlangt, dass jede Sparse-Liste in `ci.yml` und `dependabot-inbox.yml` sie samt Config enthält; der Checkout läuft mit `continue-on-error`, damit das Alarm- bzw. Inbox-Issue auch bei einem gescheiterten Checkout entsteht.
- **Grenze:** `scripts/board-lib.mjs` lädt die Config beim Import (AK3), auch die puren Helfer brauchen sie; ein Projekt ohne Board bräuchte ein lazy Laden (F7/F9). Der Repo-Begriff des Wächters ist ein Teilstring ohne Wortgrenze (gewollt für Zusammensetzungen), bei sehr kurzen Repo-Namen eines anderen Projekts zählt er Fehltreffer. Skills und Agenten benennen den Account und das Repo nur noch über die gh-Platzhalter `{owner}`/`{repo}` bzw. „den eigenen Account“. Die übrigen Repo-Literale in Kern-Dateien (vor allem der Repo-Name als Agentenname) räumt F3; Regeltexte in `AGENTS.md` und Docs F4/F11.

Präzisiert durch #1744: der Checkout in `dependabot-inbox.yml` läuft ohne `continue-on-error`; fehlt `labels.dependabotInbox`, ist der Lauf rot und es entsteht kein Issue (Fortschreibung #1744 unten).

Präzisiert durch #1728: Schema `version` 2 mit der Liste `boards` statt `board`.

Präzisiert durch #1741: Präfixe, Labels und Agentennamen stehen als Pflichtschlüssel in der Config (Fortschreibung #1741 unten).

Präzisiert durch #1628: Die Workflows checken das volle Repo aus und setzen die Position über `scripts/board-place.mjs` (Wiederholung, rot bei endgültigem Scheitern); Sparse-Checkout und `set_board_top` entfallen für die Inbox-Workflows.

## Fortschreibung #1613 (2026-10-16): Sync-Werkzeug und Drift-Gate (F9)

F9 ist umgesetzt. Entscheidungen:

- **Sync:** `scripts/factory-sync.mjs --quelle <pfad> [--ziel <pfad>] [--trocken]` überträgt den Besitz laut Manifest der Quelle: ganze Datei, Markdown-Block zwischen Markern, JSON-Schlüssel der obersten Ebene. Kein Merge: eine Einheit wird ersetzt, alles andere bleibt byte-gleich. Erst wird alles geprüft, dann geschrieben; bei einem Prüffehler bleibt das Ziel unberührt (ein Schreibfehler mitten im Lauf hinterlässt einen Zwischenstand, den ein erneuter Lauf repariert; der Sync-Stand wird zuletzt geschrieben). `.factory/besitz.json` wird mitkopiert, `.factory/projekt.json` nie (steht sie im Manifest, ist das ein Fehler).
- **JSON-Ersatz als Textbereich:** der Werttext des Schlüssels wird wörtlich ersetzt, nicht neu serialisiert, weil `.claude/settings.json` nicht im `JSON.stringify`-Format steht. Eine Selbstprüfung je Datei belegt danach: Besitz-Schlüssel gleich der Quelle, alle anderen gleich dem Vorher. Fehlender Schlüssel wird als letzte Eigenschaft eingefügt, eine fehlende JSON-Datei mit den eigenen Schlüsseln angelegt, ein fehlender Marker im Ziel bricht ab.
- **Zeilenenden:** Hash und Vergleich sind LF-normalisiert; geschrieben wird nur bei inhaltlicher Änderung, im Zeilenende-Stil der Zieldatei, neue Dateien mit LF. Idempotent: ein zweiter Lauf schreibt nichts.
- **Entfallene Einheiten:** was im alten Sync-Stand stand und nicht mehr im Manifest steht, wird gemeldet, nicht gelöscht.
- **Drift-Referenz im Projekt:** `.factory/sync-stand.json` (Quell-Commit mit Flag `sauber`, Hash des Manifests, Hash je Einheit, kein absoluter Pfad), weil die CI ohne Zugriff auf das Factory-Repo prüfen muss. `npm run check:factorydrift` (in `verify`) ist rot bei geändertem Manifest, geänderter, fehlender oder nicht auflösbarer Einheit und bei Einheiten, die Manifest und Sync-Stand verschieden listen; jede Meldung nennt den Weg (upstream ändern und neu syncen, oder den Projektwert nach `.factory/projekt.json` auslagern). Ohne Sync-Stand entfällt die Prüfung mit einer Zeile; dieses Repo ist bis F10 die Quelle.
- **Kern-Abdeckung:** jede getrackte Datei direkt in einem Kern-Verzeichnis (Ordner einer Ganz-Datei-Einheit, nicht rekursiv) ist Besitz oder steht mit Art (`projekt`, `modul`, `offen`) und Grund in `test/harness/kern-abdeckung.json`. Damit wird die Aufnahme einer unveränderten Datei samt Baseline-Eintrag im Leitplanken-Diff sichtbar, weil der Eintrag in `kern-abdeckung.json` verschwinden muss. Die Einordnung der offenen Dateien steht im Sammelticket #1663.
- **Import-Hülle:** jeder lokale Import einer Ganz-Datei-Code-Einheit zeigt auf eine Ganz-Datei-Einheit oder `.factory/projekt.json`. Ausnahmen (`KERN_HUELLE_AUSNAHMEN`) nur für Importeure im Ring `kern-nach-entkopplung`, mit Ticket oder ADR-Schritt; die Liste darf nur schrumpfen. Bestand: die Kern-Registry der Doku-Generatoren importiert zwei Spiel-Generatoren (F6; abgelöst durch [Fortschreibung #1710](#fortschreibung-1710-2026-10-22-kern-registry-ohne-spiel-generator-f6)). Die Schichtdaten-Ausnahme von F7 ist entfallen: `check-diffcoverage.mjs` liest den Pfad aus `scripts/docs-gen/config.json` (`schichten.layers`).
- **Grenzen:** für die Schlüssel `permissions`, `sandbox` und `hooks` gibt es keinen Weg über die Projekt-Config (Claude Code liest sie dort nicht), ein Projekt ändert sie heute nur upstream (F4); die Import-Hülle sieht nur statische Importe, keine Aufrufe über einen Pfad in Text-Einheiten (Beleg und Zuordnung: #1663); `.factory/besitz.json` und `.factory/sync-stand.json` als Einheit des Manifests sind nicht abgewiesen; das Löschen des Sync-Stands schaltet das Gate ab (sichtbar nur im Leitplanken-Diff unter `.factory/`); ein neuer Unterordner (etwa ein neuer Skill) ist von der Abdeckung nicht erfasst; zusammengesetzte oder dynamische Importpfade sieht die Hülle nicht; BOM und Binärdateien sind nicht behandelt; der Ticket-Verweis einer Ausnahme wird nicht auf „offen“ geprüft; der Sync läuft aus einem Arbeitsbaum, nicht von einem Tag (F10). *(Aufgehoben durch [#1871](fortschreibungen/0022-1871-sync-vom-tag.md): der Sync liest aus einem Tag. Für `permissions` aufgehoben durch [#1874](fortschreibungen/0022-1874-berechtigungs-ergaenzung.md): Modulregeln stehen als Ergänzung in der Projekt-Config.)*

## Fortschreibung #1615 (2026-10-16): Spezifikations-Gate (F12)

F12 ist umgesetzt. Entscheidungen:

- **Prüfung:** `scripts/spezifikation-lib.mjs` (Ring `kern`, literalfrei, ohne Importe) liefert die Mängelliste eines Bodys: `## Ziel` mit Inhalt, `## Akzeptanzkriterien` (oder `## Teil-Akzeptanzkriterien`, die Überschrift gebündelter Befund-Issues) als Liste, darin mindestens ein Kriterium mit dem Wort „Negativfall“. Das Wort ist deutsch und deterministisch; bei einem nicht deutschsprachigen Projekt wird es ein Projektwert (§8).
- **Bestand und Neues:** Der Stichtag `spezifikation.hartAb` (Issue-Nummer) steht in `.factory/projekt.json`. Beim Einführen erfüllten 17 von 160 offenen Issues das Format; ohne Stichtag hätte das Gate das Board gesperrt. Darunter wird nur berichtet, ab der Nummer übersprungen. `hartAb` darf nur sinken (Bitte, kein Wächter); eine einmalige Anpassung auf die nächste freie Nummer ist nur vor dem Merge erlaubt, weil zwischen Messung und Merge neue Tickets entstehen (Stand beim Merge: 1673). Fehlt der Schlüssel, ist alles hart.
- **Ausnahmen über §3 hinaus:** alle Kopf-Items (🚨, 🔒, 🤖, Forum, ⏰) haben eigene Formate, dazu Sammel- und Epic-/Phasen-Titel.
- **Einmal-Kommentar:** `naechstes-ticket.mjs` kommentiert (I/O injiziert, Logik pur) nur, wenn die Spezifikation der ausschlaggebende Grund ist, und nur ohne den versteckten Marker `<!-- spezifikations-gate -->` im Kommentar eines vertrauten Autors; ein später anderer Mangel löst bewusst keinen zweiten Kommentar aus.
- **Grenze:** Bei gleichzeitiger Auswahl können zwei Kommentare entstehen (der Marker wird direkt vor dem Posten geprüft, nicht atomar). Ein Ticket, das zwischen Festlegen des Stichtags und Merge entsteht, ist hart.

## Fortschreibung #1616 (2026-10-16): Factory-Kennzahlen (F14)

F14 ist umgesetzt: `scripts/factory-kennzahlen.mjs` erzeugt den Block für den Bericht-Kommentar des Wochen-Status-Tickets (Definition, Lücken, Grenzen: [model-routing.md](../model-routing.md#factory-kennzahlen-1616)). Entscheidungen:

- **Kostenquelle:** Standard ist das Transkript, `--langfuse` schaltet Langfuse ausdrücklich zu; ein stiller Wechsel bei fehlendem Zugang gäbe zwei nicht vergleichbare Reihen. Das weicht vom Wortlaut „Kosten je Ticket mit `--langfuse`“ in §6 ab: Der Agentenlauf hat den Secret-Key nicht, der Standardweg muss dort Zahlen liefern.
- **Verkettung:** Unterprozesse mit `--json` statt Bibliotheks-Extraktion (Einstiegsskripte importieren einander nicht); die Verträge sichern Tests gegen die echten Erzeuger `bewertePrs` und `summarize`, ein fehlendes Vertragsfeld ergibt Exit 2.
- **Ticket → Session** über die Claim-Zeile `gh issue edit <nr> --add-assignee` im lokalen Transkript, bis #1266 Tickets an Traces hängt; Fenster je Ticket: Claim bis Merge, Kosten wie aufgezeichnet.
- **Nacharbeit** über die im Zeitraum fälligen Fenster `[von − 14 T, bis − 14 T]`: nur abgelaufene Fristen gehen in die Quote.
- **Lücken statt 0:** kein Zugang, keine Session, keine Calls oder Calls ohne Preis machen die Kosten eines Tickets zur Lücke (keine Teilsumme); sie gehen weder in den Median noch in eine Summe, „n von N gemessen“ nennt die Abdeckung.
- **Keine Schwellen:** erst nach mindestens 4 Wochen Baseline; die Wiedervorlage `factory-kennzahlen-schwellen` erinnert daran. Die Abnahme-Quote ist eine feste Lücke bis F13.
- **Ring:** `kern-nach-entkopplung` wie die übrigen Messen-Skripte, deren Bibliotheken (`transkript.mjs`, `mess-lib.mjs`, `brain-metrics.mjs`) schon im Manifest stehen.

Präzisiert durch #1756: die Abnahme-Quote ist keine feste Lücke mehr, sie wird aus dem Lauf-Ergebnis gemessen (Fortschreibung #1713, Umsetzungsentscheidungen in #1756).

## Fortschreibung #1698 (2026-10-16): Reparaturweg statt Einmal-Kommentar (F12)

Der Einmal-Kommentar aus #1615 ist abgelöst; das Gate ließ trotzdem Tickets liegen (#1686, #1684, #1678 entstanden ohne Spezifikation, der Bestand lag bei 133 von 175 offenen Issues). Entscheidungen:

- **Melden statt kommentieren:** `naechstes-ticket.mjs` schreibt nichts und liest keine Kommentare mehr (der Kommentar-Abruf wuchs mit jedem Lauf); ein hart übersprungenes, vertrautes Ticket erscheint als Zeile `reparieren #<nr>` (JSON: `reparieren`).
- **Reparieren schreibt ein Skript, ausgedacht hat es der Agent:** `scripts/spezifikation.mjs reparieren` ersetzt den Body nur bei vollständiger Spezifikation, ohne verlorene Zeile des alten Bodys (`verloreneZeilen`) und nie bei einem Fremdeingang (Autor nicht vertraut oder Label `forum`). Die Leitplanken stehen im Code, nicht in einer Bitte.
- **Anlegen nur geprüft:** `spezifikation.mjs anlegen` führt vorab `pruefeEingang` aus und sortiert ein; `gh issue create` ist in `.claude/settings.json` gesperrt, weil die Doku-Regel allein versagte. Grenze: der REST-Weg `gh api -X POST …/issues` bleibt offen.
- **Bestand schrittweise:** `spezifikation.hartAb` steht auf 1; der Bestand wird mit jeder Auswahl um ein Ticket abgebaut, keine Massen-Reparatur.

## Fortschreibung #1706 (2026-10-16): Veröffentlichungsentscheidung

Die Maintainerin hat §10 am 2026-10-16 entschieden; die Folgetickets sind angelegt (Spalte „Ticket“ der [Folgeticket-Tabelle](#folgeticket-entwürfe)). Entscheidungen:

- **Sichtbarkeit:** Das Factory-Repo ist öffentlich, Owner zunächst `fluffels`; es entsteht erst mit F10 (#1715, Pre-Flight dort). Grund: die Entwicklung unter dem anonymen Account wahrt §7, und ein öffentliches Repo behält auf GitHub Free Rulesets und Branch-Schutz, auf denen die Gates aufbauen (Abwägung in #1038). Ob später ein getrenntes Repo nur für Release-Stände entsteht, entscheidet die Maintainerin im Pre-Flight von F10 und #1714 (Außenwirkung).
- **Lizenz:** proprietär wie kubernia: alle Rechte vorbehalten, der Quelltext ist einsehbar, Nutzung, Kopie und Ableitung nur mit Erlaubnis der Rechteinhaberin. Grund: eine Lockerung (etwa Apache-2.0) ist jederzeit möglich, ein Zurücknehmen für verteilte Stände nicht; darum wird zum ersten Release neu entschieden (#1718, Pre-Flight). Lizenzdatei und Selbstbeschreibung liefert #1714. Keine Arbeitgeber- oder Firmennennung im Repo (§7).
- **Marketplace:** kein Eintrag. Grund: ein Plugin trägt weder `permissions` noch `sandbox` noch Kontextdateien, die Verteilung bleibt der Sync; das Plugin bleibt eine spätere optionale Verpackung der Claude-Schicht (Inventar-Urteil „beobachten“, erster Trigger der Re-Evaluierung).
- **Beiträge:** keine externen Beiträge (Showcase-Repo), Feedback über Discussions. Grund: nur die Maintainerin entwickelt; Fork-PRs werden nicht bearbeitet, Text Dritter ist Daten ([Sicherheit der Agenten](../sicherheit-agenten.md)). Gilt für kubernia und das Factory-Repo; README und CONTRIBUTING zieht #1038 nach.
- **Produktanspruch:** Der Harness wird als Produkt gebaut; Maßstab sind prüfbare Kriterien in Produkt-Tickets (P1 bis P5 sind nur hier benannt: P1 #1716, P2 #1717, P3 #1718, P4 #1719, P5 #1714, dazu #1721 und #1722), nicht Adjektive. Grund: abnehmen lässt sich nur ein Kriterium mit Negativfall (§3, Spezifikations-Gate F12, Holdout F13).
- **Folge für §9:** Das zweite Board entsteht mit F11 (#1712, Pre-Flight dort), ein Repo erst mit F10. Ein npm-Paket war nicht Gegenstand der Entscheidung und entsteht nicht ohne neue Entscheidung.

## Fortschreibung #1714 (2026-10-16): Produktname und Lizenz-Entwurf

Die Maintainerin hat den Pre-Flight von #1714 am 2026-10-16 geklärt. Entscheidungen:

- **Name:** „Self-Improving Agent Harness and Factory“, Repo-Name `self-improving-agent-harness-and-factory`, Untertitel „Ein selbstoptimierender Harness für Coding-Agenten mit Claude Code“. Grund: ein beschreibender Name statt eines Fantasienamens; „Harness“ ist 2026 der etablierte Begriff der Gattung, Firmen wie Harness Inc. und Factory AI sitzen im selben Markt, darum steht die Gattung im Untertitel. Kein „Dark“ im Namen und keine Behauptung, der Harness sei eine Dark Factory: die Holdout-Abnahme (F13) fehlt, er strebt sie an. Die Kollisionsrecherche (npm, PyPI, GitHub frei; Wortgruppe rein beschreibend benutzt) steht im Ticket #1714; die Markenregister (DPMAregister, EUIPO, TMview) waren nicht abfragbar und sind offen.
- **Lizenz-Entwurf** (`.factory/produkt/LICENSE`): „Alle Rechte vorbehalten“ nach der Vorlage der Wurzel-`LICENSE`, source-available, keine Fremdbeiträge. Abweichungen mit Grund: Das Recht, Beiträge als Pull Request einzureichen, und der Beitragsabsatz entfallen (Showcase-Repo, Fortschreibung #1706); ausdrücklich nicht gestattet ist das Ausführen oder Einsetzen der Software (der Harness soll nicht ohne Erlaubnis als Harness in fremden Projekten laufen); „Quellcode, Assets, Spielinhalte“ wird zu „Quellcode, Skripte, Prompts, Konfiguration und Dokumentation“. Die Lizenz bindet nur Dritte; die Maintainerin arbeitet als Rechteinhaberin frei daran. Der Text ist ein Entwurf ohne Rechtsberatung.
- **Ablage:** `.factory/produkt/` (README und LICENSE) bis F10 das Factory-Repo anlegt; der Sync fasst den Ordner nicht an.
- **Wächter:** [Selbstbeschreibungs-Wächter](../agent-harness.md#selbstbeschreibungs-wächter-testharnessselbstbeschreibungtestts-1714) lehnt „Open Source“ als Selbstbeschreibung ab. Grenzen stehen dort.

## Fortschreibung #1728 (2026-10-16): Board-Liste und Factory-Board (F11, Teil 1)

Teil 1 von F11 ist umgesetzt: das Factory-Board existiert, die Config führt beide Boards, `board-lib` nimmt das Board als Parameter. Die Auswahl mit Quote, die Trennregel in `AGENTS.md` und der Umzug der Sammeltickets folgen in den Teilen 2 und 3. Entscheidungen:

- **Schema `version` 2:** `.factory/projekt.json` führt `boards` statt `board`: eine Liste von Board-Objekten (die bisherigen Schlüssel plus `rolle`). Rollen sind `produkt` und `factory`, genau ein Board je Rolle. `projectId` ist eindeutig, ebenso der REST-Pfad (Typ, Besitzer, Nummer; die Nummer allein genügt nicht, sie gilt je Besitzer). Eine v1-Config wird abgewiesen statt migriert (Fehler mit Pfad und „Fix:“-Zeile). Die Kommandozeile liest Listeneinträge per Ziffernindex (`boards.1.projectId`), nur innerhalb der Liste.
- **Board als Pflichtparameter:** `scripts/board-lib.mjs` hat keine Board-Konstanten mehr. `boardFuerRolle(rolle)` liefert den Config-Eintrag (unbekannte Rolle wirft), die sieben I/O-Funktionen bekommen das Board als ersten Parameter und prüfen es vor jedem gh-Aufruf. Die Aufrufer binden das Produkt-Board über Wrapper an der Fake-Schnittstelle der Takte; das Verhalten bleibt unverändert. Ein Wächter-Test prüft, dass jeder Aufrufer sein Board ausdrücklich übergibt.
- **Trennregel als pure Funktion:** `boardRolleFuer(labels)` ordnet genau das Label `area:harness` dem Factory-Board zu, alles andere dem Produkt-Board; ohne Label-Liste wirft sie. Eingesetzt wird sie erst in den Folgeteilen.
- **Factory-Board:** privates User-Project „Factory Backlog“, Kopie des Produkt-Boards (gleiches Status-Feld mit Todo, In Progress, Done), ohne die Ansichten „Spiel“ und „Agentic Engineering“; das Produkt-Board heißt jetzt „Kubernia Backlog“. „Auto-add sub-issues“ kann nur die Maintainerin in der Oberfläche einschalten.
- **Grenze:** `board-lib` lädt die Config weiter beim Import, eine kaputte v2-Config bricht damit auch die anderen Board-Werkzeuge (gewollt, laut statt still). Die Option-IDs des kopierten Status-Feldes können denen des Produkt-Boards gleichen; darum gibt es keine Eindeutigkeitsprüfung für sie.

## Fortschreibung #1730 (2026-10-16): Umzug (F11, Teil 3)

Teil 3 von F11 ist umgesetzt: `node scripts/board-place.mjs --umzug [--dry-run]` setzt jedes offene Item, das gegen die Trennregel auf dem falschen Board steht, ans Ende des richtigen Boards und entfernt es danach vom falschen (`deleteProjectV2Item`, das Issue bleibt). Entscheidungen:

- **Reihenfolge der Mutationen:** erst aufnehmen und positionieren, dann entfernen; ein Item steht nie auf keinem Board. Bei einem Fehler bricht der Lauf ab (kein Wiederholen um Mutationen: ein zweites Löschen eines schon gelöschten Items scheitert) und wird per Neustart fortgesetzt, weil der Plan aus dem Ist-Stand beider Boards entsteht (`umzugsPlan`, pur, idempotent).
- **Sonderfälle:** ein Item auf beiden Boards wird nur entfernt; ein Item mit Status ungleich Todo wird gemeldet (Exit 1) statt umgezogen; geschlossene Items bleiben als Historie.
- **Ansichten:** „Spiel“ und „Agentic Engineering“ des Produkt-Boards sind gelöscht (freigegeben im Pre-Flight); beide Boards tragen nur „View 1“.
- **Grenze:** die REST-Liste hinkt gelöschten Items hinterher; vor einem zweiten Live-Lauf `--umzug --dry-run` wiederholen, bis er „nichts zu tun“ meldet.

## Fortschreibung #1741 (2026-10-16): Präfixe, Labels und Agenten in der Projekt-Config (F3, Teil 1)

Teil 1 von F3 ist umgesetzt: das Schema, die Quelle der Commit-Zeilen und die Wächter-Begriffe für alle F3-Werte. Die Teile K2 bis K8 (Epic #1707) senken nur noch die Baseline. Entscheidungen:

- **Schlüssel und Muster, kein Default:** `praefixe.commitZeile` (`^[A-Z][A-Z0-9]*-$`), `praefixe.branch` (Buchstaben, Ziffern, `_`, `-`, `/`) und `praefixe.worktree` (wie Branch, ohne `/`; kein Präfix darf Regex-Sonderzeichen oder Leerraum enthalten), `labels.harness|festgefahren|forum|dependabotInbox` (nicht-leere Texte; weitere Label-Schlüssel sind erlaubt und werden gleich geprüft; das Inbox-Label ist ein eigener Schlüssel, auch wenn es heute den Wert von `harness` trägt) und `agenten.planer|umsetzer|lens|gruppe|ticketSkill` (Name ohne Leerraum und `:`, nicht mit `-` am Anfang). Fehlt ein Schlüssel oder passt das Muster nicht, bricht der Lader mit Pfad, Schlüssel und „Fix:“-Zeile ab. `version` bleibt 2.
- **Commit-Zeilen aus dem Präfix:** `commitZeilen(praefix, planer)` in `scripts/slice-override.mjs` leitet Plan-, Review- und die vier Override-Schlüssel ab. Die puren Parser (`parseNachweis`, `bewerteNachweis`, `nachweisAusCommits`, `bewertePrs`) bekommen die Zeilen als Pflichtparameter, die Gates und Messskripte laden sie über `ladeCommitZeilen()` aus der echten Config (`lauf-ergebnis` über `ladeProjektConfig`, weil es auch `labels.festgefahren` braucht). Der Planer-Name in der Plan-Zeile ist `agenten.planer`. `--config <pfad>` gibt es nur an `check-review-nachweis` (Tests und fremde Projekte); die `KQ_*`-Umgebungsvariablen der Gates behalten ihre Namen.
- **Wächter-Begriffe:** Praefix (Commit-Zeilen-Präfix), Branch, Worktree, Label (nur Werte mit `:`) und Agent, alle groß/klein-genau und wörtlich (Alternativen nach Länge absteigend, damit ein Kurzname nicht im Langnamen mitzählt). Die Baseline erfasst den Bestand und sinkt nur.
- **Grenzen:** Ein Label ohne `:` (etwa `forum`) zählt nicht, weil es als Wort überall vorkommt. Der Worktree-Begriff steckt im Branch-Präfix, beides zählt (gewollte Doppelzählung); der Agent-Begriff deckt sich bei einem Ticket-Skill, der wie das Repo heißt, mit dem Repo-Begriff. Ein Wechsel des Commit-Zeilen-Präfixes lässt alte Zeilen aus `lauf-ergebnis` und `token-baseline` herausfallen (die Gates prüfen nur den Slice des PRs); historische Nachweise bleiben gültig, solange das Präfix gleich bleibt. Die `KQ_*`-Namen der Umgebungsvariablen zählt kein Begriff.

## Fortschreibung #1742 (2026-10-16): Hooks und Guards (F3, Teil 2)

Die neun Hooks und Guards (`worktree-guard-hook`, `stop-verify-hook`, `lens-auftrag-guard`, `lens-edit-guard`, `patch-zugriff`, `sandbox-doctor`, `stdin-skript-guard`, `pretooluse-hook`, `umsetzer-abschluss`) und `.claude/settings.json#/hooks` tragen keine Präfixe und keine Agentennamen mehr. Entscheidungen:

- **`scripts/ticket-namen.mjs` (Ring `kern`):** `ticketNamen(config)` leitet Worktree- und Branchnamen, `ticketAus` (Ticketnummer), `lensNameKern` und die Patch-Muster aus `praefixe` und `agenten` ab; alle Präfixe laufen durch `escapeRegex`. Importiert wird nur `projekt-config-lib.mjs`. Die volle Musterprüfung bleibt im Lader.
- **Fail-closed-Vertrag:** `ticketNamen` wirft mit Schlüssel und „Fix:“-Zeile, wenn `praefixe.branch`, `praefixe.worktree` oder ein Pflicht-Agent fehlt (kein Standardwert). Hooks rufen `namenOderGrund(werkzeug, deps)`, das nie wirft und einen Grund mit Fix-Zeile liefert; daraus wird deny bzw. block. Geladen wird je Aufruf, nie beim Import eines Hook-Moduls (ein Import-Fehler schaltete den Dispatcher samt Worktree-Guard ab). Der Worktree-Guard bleibt ohne Config ein Block, nur die Beispielzeile der Meldung wird zur Fehlermeldung.
- **SubagentStop ohne Matcher:** `hook_event_name` und `agent_type` stehen im Payload; `stop-verify-hook` steigt bei `SubagentStop` mit einem anderen Agenten als `agenten.umsetzer` vor jeder Git-Abfrage aus. Der Stop des Hauptchats braucht die Config in diesem Schritt noch nicht (die Aufräumlogik zieht in K3 um).
- **Label und Probe-Datei:** `umsetzer-abschluss` liest das Festgefahren-Label aus `labels.festgefahren`; der Test bindet den Config-Wert an das Label in `check-festgefahren.mjs` (dessen Literal fällt in K4). Der Probe-Name in `sandbox-doctor` heißt `.factory-sandbox-probe-<pid>`.
- **`patch-zugriff`:** ohne übergebene `namen` lädt es einmal die Config (lazy, wirft ohne Schlüssel); mit `namen` bleibt die Funktion pur.
- **Grenzen:** `ticket-refs.mjs` und `worktree-aufraeumen.mjs` behalten bis K3 ihr eigenes Muster. Ein Agent-Typ mit Plugin-Namensraum (`<plugin>:<name>`) wird exakt verglichen und nicht erkannt (F10). Ein `SubagentHandback`-Deny bei kaputter Config kennt keine `stop_hook_active`-Freigabe: gewollt laut statt still.

Präzisiert durch #1743: `ticket-refs.mjs` und `worktree-aufraeumen.mjs` leiten ihre Muster seitdem aus der Config ab (die Grenze „behalten bis K3“ ist eingelöst), und auch der Stop des Hauptchats braucht `praefixe.worktree` (Fortschreibung #1743 unten). Präzisiert durch #1744: das Festgefahren-Label steht nicht mehr als Literal in `check-festgefahren.mjs`, beide Skripte lesen `labels.festgefahren` (Fortschreibung #1744 unten).

## Fortschreibung #1713 (2026-10-16): Holdout-Abnahme im Skill-Pfad (F13)

ADR 0028 hat den Workflow entfernt, auf den §2 verweist; die Holdout-Abnahme läuft deshalb im Skill-Pfad. Das Epic #1713 ist in vier Tickets geteilt (Format und Auswertung #1753, Agenten im Ablauf #1754, Erzwingung in der PR-CI #1755, Kennzahl #1756). #1753 liefert das Fundament: die Nummerierung K1…KN, die Commit-Zeile `KQ-Abnahme:` und `scripts/abnahme.mjs`. Entscheidungen:

- **Ort und Laufzustand:** der Hauptchat des Skills `kubernia`; die Szenarien leben nur in seinem Kontext, ohne Datei. Er ist die einzige Instanz, die beide Agenten spawnt und selbst weder Planer noch Umsetzer ist. Geht die Session verloren, schreibt ein frischer Szenario-Agent sie neu.
- **Zeitpunkt des PRs:** Entwurfs-PR vor der Abnahme, `gh pr ready` und Auto-Merge erst nach `bestanden`: kein Race in der CI, „nicht prüfbar“ stoppt den Merge schon vor #1755.
- **Spur per Skript:** `abnahme.mjs` schreibt den PR-Kommentar und entscheidet, nicht der Fließtext des Hauptchats; das Marker-Format hat genau eine Quelle (`scripts/slice-override.mjs`).
- **Cap-Kopplung:** `durchgaenge ≤ runden` statt eines eigenen Zählers, weil jede Abnahme-Fix-Runde einen Lens-Pass nach sich zieht.
- **head-Regel:** der Abnahme-head ist Nachfahre (oder gleich) des Review-head, danach nur leere Commits und konfliktfreie Merges.
- **Ausweg:** `entfaellt` nur, wenn das Ticket keine Kriterien hat; Ausnahmen nur über eine Override-Zeile mit Ticket (#1755).
- **Namen und Modell:** `holdout-szenario` und `holdout-abnahme`, beide `opus`, `effort: medium`; der Szenario-Agent liest nur Doku (`Read, Grep, Glob`).
- **CI-Einbindung und Übergang:** ein Schritt im bestehenden Required-Job, kein neuer Required-Check; kein Stichtag-Schlüssel, sondern Override mit Ticket. Der Phasen-Schnitt `pr` liegt nach der bestandenen Abnahme (Wechselwirkung mit der Messung #1593).
- **Ehrliche Grenze:** Transkripte unter `~/.claude/projects` und dasselbe GitHub-Konto für alle Agenten machen die Trennung zu einer Disziplin- und Wächterfrage, nicht zu einer kryptografischen. Der Bericht des Abnahme-Agenten bleibt Selbstauskunft; `abnahme.mjs` prüft Form, Vollständigkeit und den unveränderten Worktree, nicht die Wahrheit der Belege. Präzisiert durch #1781: die drei Laufzeit-Guards stehen (Auftrags-Guard im Dispatcher, Pfad-Hooks der beiden Holdout-Agenten); offen bleibt nur Schreiben über Bash, das die Worktree-Probe abfängt.

Umsetzungsentscheidungen in #1753:

- **Marker und Urteil-Format** liegen in `scripts/slice-override.mjs` (`formatAbnahme`, `formatAbnahmeMarker`, `parseAbnahmeMarker`, `URTEILSWERTE`), nicht im Einstiegsskript: #1755 braucht denselben Parser, Einstiegsskripte importieren einander nicht, und es gibt eine Quelle statt zwei. Der Marker-Name folgt aus dem Commit-Zeilen-Präfix (klein geschrieben), kein Projektliteral im Kern.
- **Durchgang** = gültige Marker vertrauter Autoren auf dem PR plus eins (derselbe Parser wie #1755; Fremde und der Hand-off-Marker zählen nicht). Scheitert nach dem PR-Kommentar der Hand-off-Kommentar, zählt ein Neuversuch als weiterer Durchgang (fail-closed).
- **Kriterium K<i>** ist die Position im Abschnitt, nicht die Ziffer des Autors; Unterpunkte und Folgezeilen gehören zum Oberpunkt.
- **Ticket ohne Kriterien:** `kriterien` liefert die `entfaellt`-Zeile (Exit 0), `auswerten` endet mit Exit 2.
- **Hand-off-Hinweis:** der Reparaturweg `spezifikation.mjs reparieren` greift nur bei unvollständiger Spezifikation (verweigert Tickets mit Assignee und umformulierte Zeilen); ein nicht prüfbares Kriterium präzisiert die Maintainerin, das Verfahren klärt #1754.

Umsetzungsentscheidungen in #1754 (präzisiert: das Marker-Format aus #1753 liegt seit #1762 in `scripts/nachweis-lib.mjs`, nicht mehr in `scripts/slice-override.mjs`):

- **Nachbessern von „nicht prüfbar“ ist Handarbeit:** kein Kriterien-Modus für `spezifikation.mjs reparieren`. Ein Kriterium ist die Anforderung; ein Modus ließe denselben Lauf, der an ihm scheitert, seinen Maßstab umschreiben (Grün-durch-Aufweichen, bricht die Holdout-Trennung). Der Hand-off-Kommentar von `abnahme.mjs` geht an die Maintainerin, sie präzisiert den Body, danach läuft das Ticket weiter.
- **Agentennamen bleiben eine Konstante** (`ABNAHME_AGENT`), nicht in `agenten` der Projekt-Config: jeder `agenten`-Wert zählt in der Kern-Reinheit als Projektliteral, und kein Hook braucht den Typnamen.
- **Hand-off ohne Deduplizierung:** er beendet den Lauf; ein zweiter Kommentar entsteht nur in einem neuen Lauf nach geänderter Spezifikation.
- **Fix-Runde:** eine Abnahme-Fix-Runde nutzt denselben Zähler, dasselbe Cap und denselben Zusatzpass wie der Review; „Cap erschöpft“ heißt nach dem Zusatzpass, dann `festgefahren` mit `FESTGEFAHREN: review`.
  - Präzisiert durch #1808: die Abnahme-Fix-Runde hat ein eigenes Budget von einer Delta-Runde (Review-Feld `abnahmefix=1`), nicht mehr denselben Zähler und dasselbe Cap (Ledger in ADR 0027).
- **Wiederholung:** genau ein Neuversuch je Durchgang bei Abbruch (Werkzeug) oder ungültigem Bericht, danach `FESTGEFAHREN: abnahme` plus Harness-Zeile; fällt der Szenario-Agent aus, läuft die Abnahme nach einem Neuversuch allein gegen die Kriterien.
- **Wächter R8:** `FESTGEFAHREN: abnahme` verlangt einen Entwurf ohne Auto-Merge (statt des Labels); gh-Fehler geben frei. Der Umsetzer setzt das Label trotzdem am PR, weil `claims-pruefen` ein bewusst angehaltenes Ticket nur daran erkennt und es sonst nach der Schwelle als verwaist wieder aufnähme.
- **Übergang:** #1754 selbst läuft ohne Abnahme, weil die neuen Agenten in der laufenden Session nicht geladen sind; die CI erzwingt die Zeile erst mit #1755.
- **Ehrliche Grenze:** erzwungen sind nur die statischen Wächter (Vorlagen, Tool-Mengen, Abschluss-Token) und die Worktree-Prüfung nach der Abnahme; ein Laufzeit-Guard gegen Szenarien in fremden Prompts, gegen Schreibzugriffe des Abnahme-Agenten außerhalb seines Scratchpads und gegen das Lesen von Code durch den Szenario-Agenten steht als Harness-Zeile aus.

Umsetzungsentscheidungen in #1755 (die CI erzwingt die Abnahme):

- **W1, Zählregel bei Änderungen nach der Abnahme:** eine Delta-Lens nach CI-Fix oder Konflikt-Merge hinter einer bestandenen Abnahme zählt als Pass (`runden` + 1, über dem Cap mit `zusatzpass`, einer ohne Rückfrage). Weil nur so `durchgaenge ≤ runden` wörtlich hält: der neue Durchgang ist durch die head-Regel erzwungen, und jede Codeänderung nach der Konvergenz läuft gegen dasselbe Cap. Verworfen: Fix-Durchgänge statt `durchgaenge` zählen, das widerspräche dem Negativfall von K3. Folge für die Messung: Runden und Nacharbeit steigen bei solchen PRs leicht.
- **W2, Schließ-Referenzen:** alle GitHub-Schlüsselwörter zum Schließen zählen (close, fix, resolve in allen Beugungen), nicht nur `Closes`; sonst liefe ein PR mit `Fixes #n` als „kein Ticket“ durch und `entfaellt` wäre eine Umgehung.
- **W3, ein Ticket je PR:** mehr als ein verknüpftes Ticket ist rot (Weg: Override). Belegt an 76 gemergten PRs ohne Dependabot (Stand 2026-10-17, `gh pr list --state merged --limit 80`): alle mit genau einer Schließ-Referenz.
- **W4, Repo und Vertrauensbasis:** `GITHUB_REPOSITORY`, sonst `repo` der Projekt-Config, der Owner steht davor; kein `board-lib` (Ring kern-nach-entkopplung, ein Kern darf es nicht importieren). Dieselbe Vertrauensbasis wie beim Durchgang-Zähler.
- **W5, Entwurf nur Bericht:** auch ein gh-Fehler wird im Entwurf nur gemeldet; maßgeblich ist der Lauf nach `ready_for_review`. Restrisiko: Auto-Merge im kurzen Fenster zwischen grünem Entwurfslauf und neuem Lauf; im dokumentierten Ablauf bricht die Concurrency-Gruppe den Entwurfslauf ab.
- **W6, Details:** head-Vergleich Marker gegen Zeile per Präfix (klein geschrieben, mindestens 7 Hex); eine verknüpfte PR-Nummer statt eines Issues ist rot; ohne PR-Nummer in der Umgebung ist die Spur nicht prüfbar, also rot; der Override wird vor jedem gh-Aufruf ausgewertet.
- **W7, Verdrahtung:** die Prüfung der CI-Verdrahtung steht im bestehenden Block (d) von `test/harness/review-nachweis.test.ts`, kein neuer Wächter.
- **Einführung:** PRs von Sitzungen, die vor dem Laden der Abnahme-Agenten gestartet sind, tragen `KQ-Abnahme-Override: #<ticket> <warum>`; Hand-PRs ohne Ticket die Zeile `entfaellt` mit Grund. Dieser PR trägt seine eigene Abnahme.

Umsetzungsentscheidungen in #1756 (Abnahme-Quote in den Factory-Kennzahlen):

- **Vorrang des Overrides:** `lauf-ergebnis.mjs` wertet `KQ-Abnahme-Override` vor der Abnahme-Zeile aus, wie das Gate; die Zeile ist dann ungeprüft und darf nicht als Urteil zählen. Ein Widerruf hebt den Override auf. Die Logik liegt als `aktiverOverride` in `slice-override.mjs`, statt die Widerruf-Regex zu kopieren (Drift); `sliceOverride` ruft sie auf.
- **Fünftes Kennzahlfeld `override`:** `{gemessen, ersterDurchgang, entfaellt, override, ohne}`, weil Override-PRs genannt werden müssen (K4); das ist bindend gegenüber dem Wortlaut mit vier Feldern.
- **Ungültige Zeile:** zählt als `null` („ohne“), die vier Werte des Tickets bleiben unverändert.
- **Vertrag:** `vertragPruefen` verlangt das Aggregat samt Unterfeldern und je Zeile ein gültiges Abnahme-Feld; fehlt es, endet `factory-kennzahlen` mit Exit 2 (Test gegen das echte `bewertePrs`).
- **Darstellung:** eine Aggregatzeile in `lauf-ergebnis` statt einer Tabellenspalte, keine Spalte in der Verdichtungszeile.

## Fortschreibung #1743 (2026-10-17): Ticket-Lebenszyklus (F3, Teil 3)

`ticket-refs`, `worktree-aufraeumen`, `cleanup-worktrees`, `ticket-lock`, `claims-pruefen`, `naechstes-ticket`, `budget-lib`, `mcp-ausfall`, `haupt-sync` und `.githooks/pre-push` tragen kein Branch- oder Worktree-Präfix und keine Repo-Prosa mehr; die Baseline sinkt, und `ticket-refs`, `haupt-sync`, `mcp-ausfall`, `worktree-aufraeumen`, `stop-verify-hook`, `cleanup-worktrees` und `ticket-lock` sind Ring `kern`. `claims-pruefen` (über `board-lib`) und `naechstes-ticket` bleiben Ring `kern-nach-entkopplung`. *(Präzisiert durch #1745: beide sind Ring `kern`, siehe Fortschreibung #1745.)* Entscheidungen:

- **Form der API:** `namen` bzw. `config` sind optionale Parameter. Fehlen sie, lädt die Funktion die echte Config je Aufruf und wirft ohne Schlüssel (kein Standardwert, Vorbild `patch-zugriff`); die Produktivpfade (`echteDeps`, `echteIo`, `main`) lösen die Namen einmal je Lauf auf und reichen sie weiter. `LENS_WORKTREE_NAME` und `LENS_NAME_KERN` entfallen (eine Konstante bräuchte die Config beim Import); an ihre Stelle tritt `lensWorktreeName(namen)`.
- **Lock-Verzeichnis:** kein eigener Config-Schlüssel; `lockVerzeichnis` leitet es aus `praefixe.worktree` ab (Pfad für das Projekt unverändert).
- **Temp- und Stand-Dateien:** `<Worktree-Präfix>rate-limits.json` (`budget-lib`) und `<Worktree-Präfix>mcp-ausfall-<Slug>.json` (`mcp-ausfall`) behalten für das Projekt ihren Pfad; ein neutraler Name hätte bestehende Stände verwaist. *(Präzisiert durch #1787: der Rate-Limit-Snapshot heißt jetzt `claude-rate-limits.json`, siehe Fortschreibung #1787 unten.)* Die Umgebungsvariablen `KQ_*` gewinnen auch ohne Config.
- **Fail-closed, außer wo das Werkzeug nie stören darf:** `cleanup-worktrees`, `ticket-lock`, `naechstes-ticket` und `budget-pacing` brechen ohne Schlüssel mit Fix-Zeile ab; `stop-verify-hook` blockt den Stop des Hauptchats nur ohne `praefixe.worktree` (`worktreeNamenOderGrund`: ein fehlender Agentenname stört das Aufräumen nicht), `SubagentStop` braucht die volle Config (der zweite Stop mit `stop_hook_active` gibt frei, keine Schleife); `mcp-ausfall` meldet eine Zeile mit Grund und arbeitet ohne Stand-Datei weiter (Exit 0); `haupt-sync` pullt weiter (fail-open), der Grund steht in `notiz` und macht `--streng` rot.
- **Skill-Verzeichnis:** `haupt-sync` leitet es als `.claude/skills/<agenten.ticketSkill>/` ab. Der Fitness-Test in `test/harness/lebenszyklus-namen.test.ts` prüft, dass es existiert, und wird rot, sobald K8 (#1748) das Verzeichnis umbenennt, ohne dass `ticketSkill` mitzieht. *(Präzisiert durch #1748: das Verzeichnis ist ein fester Kern-Pfad, `haupt-sync` braucht dafür keine Config mehr.)*
- **Grenzen:** Das Label-Literal in `naechstes-ticket` (`Label:2`) fällt in K4 (#1744), `subagent-laeufe` ruft `ticketAusRef(prompt)` weiter ohne `namen` auf (lädt die Config je Lauf, K5 #1745), die Umgebungsvariablen `KQ_*` heißen weiter so (#1745). *(Präzisiert durch #1745: `subagent-laeufe` übergibt die Namen; die Umgebungsvariablen sind Teil von #1824.)* Die Statusline lässt den Rate-Limit-Snapshot ohne vollständige Config still weg (ihr catch schluckt den Wurf), `budget-pacing` bricht danach laut ab. Ein Scan-Wächter über alle Skripte entfällt, die Baseline erzwingt die Freiheit von Literalen.

## Fortschreibung #1744 (2026-10-19): Labels in Board-Werkzeugen, Takten und Kern-Workflows (F3, Teil 4)

`board-lib` (`boardRolleFuer`), `board-takt`, `board-place`, `langfuse-takt`, `sammelticket-anlegen`, `spielquote-lib`, `wiedervorlage`, `fremdtext-lib`, `check-festgefahren`, `naechstes-ticket` und die Workflows `festgefahren.yml`, `board-takt.yml` und `dependabot-inbox.yml` tragen kein Label-Literal mehr; die Baseline der Kern-Reinheit sinkt um zwölf Label-Einträge (übrig bleibt der Rest in `kubernia-umsetzer.md`, K7 #1747). `board-lib`, `check-festgefahren`, `langfuse-takt`, `spielquote-lib`, `inbox-lib` und `wiedervorlage` sind Ring `kern`. Entscheidungen:

- **`labelAus(config, schluessel)`** in `projekt-config-lib.mjs` ist die eine Stelle: ein nicht-leerer String oder ein Wurf mit `labels.<k>` und „Fix:“-Zeile, kein Standardwert. Optionale `config`- bzw. Label-Parameter (`boardRolleFuer(labels, config)`, `istFremdeingang(…, { config })`, `stuckLabel(config)`, `imBereich(…, harness)`, `ladeQuoteEcht(lade, harness)`, `fuehreTaktAus({ harnessLabel })`); fehlen sie, gilt die echte Config. *(Abgelöst durch Fortschreibung #1798 unten.)*
- **`FACTORY_LABEL`** bleibt in `board-lib` als aus der Config abgeleitete Konstante (`labelAus(PROJEKT, "harness")`); die Config wird dort weiter beim Import geladen und geprüft. *(Abgelöst durch Fortschreibung #1798 unten.)*
- **`fremdtext-lib`** lädt ohne Config mit `pruefen: false` und prüft nur `labels.forum`: das Sicherheits-Gate soll nicht an fremden Schlüsseln scheitern, ohne den Schlüssel bleibt es geschlossen (Wurf, in `fremdtext.pruefe` Exit 2).
- **`check-festgefahren`** löst das Label als Erstes auf; eine fehlende Config ist rot (Exit 1), die „graceful degradation“ gilt nur für API-Fehler.
- **Workflows:** `dependabot-inbox.yml` liest das Label in einem eigenen Schritt nach dem Checkout (`node scripts/projekt-config.mjs labels.dependabotInbox`, Guard `if ! x=$(…); then echo "::error::…"; exit 1; fi`) und gibt es per `steps.label.outputs.wert` weiter; `continue-on-error` am Checkout fällt weg (ohne Checkout gäbe es kein Label). In den fünf Workflows gab es keine `if:`-Bedingung auf Labels. `test/harness/label-config.test.ts` verlangt für jeden Config-Aufruf in einem Workflow die Guard-Form (kein `|| …`, kein `${…:-…}`, kein `echo "$(…)"`) und scannt die Einheiten auf Werte aus `labels`.
- **URL-Kodierung:** Label-Abfragen der Takte (`labels=area%3Aharness`) werden kodiert, damit ein Label mit Sonderzeichen nicht den Query-String bricht.
- **Grenzen:** Label-Literale in den `permissions` der Settings haben keinen Config-Weg (F9/F4). `forum-inbox.yml` und das Alarm-Label in `ci.yml` sind Projekt-Einheiten außerhalb des Manifests. `fremdtext.mjs` (Kopfkommentar) und `spezifikation.mjs` (Meldungstext) nennen das Forum-Label noch wörtlich (K5 #1745); der Scan zählt sie nicht, weil sie keine Einheiten dieses Schritts sind. *(Präzisiert durch #1745: beide Stellen nennen es nicht mehr wörtlich.)*

## Fortschreibung #1787 (2026-10-19): Snapshot-Name und Nach-Merge-Kriterien

- **Rate-Limit-Snapshot:** `budget-lib` legt ihn kontoweit als `claude-rate-limits.json` im Temp-Ordner ab, ohne Config und ohne Projekt-Präfix; er ist kontoweit, mehrere Projekte pro Maschine teilen ihn. Ein alter `<Präfix>rate-limits.json` verwaist, das ist harmlos (reiner Cache, die Statusline schreibt ihn neu). Das präzisiert den Punkt „Temp- und Stand-Dateien“ der Fortschreibung #1743; `KQ_RATE_LIMITS_SNAPSHOT` gewinnt weiter.
- **Holdout-Abnahme (F13):** Kriterien mit dem Präfix `Nach dem Merge:` sind erst nach dem Merge erfüllbar. Die Abnahme prüft sie nicht, das Skript setzt den Zeilenwert `nach-merge` selbst, der Umsetzer postet den Beleg nach dem Merge als PR-Kommentar. Damit löst ein solches Kriterium keinen Fehl-Hand-off mehr aus (Mechanik: `docs/ticket-reihenfolge.md`, Format-Abschnitt).

## Fortschreibung #1798 (2026-10-21): Config als Pflichtparameter, Abschluss-Wächter fail-closed, Kern-Agenten ohne Config-Schlüssel

- **Config ist Pflicht** für `boardRolleFuer`, `seitenListen`, `umzugsPlan`, `aufnahmePlan`, `zielRolle`, `factoryListe`, `ankerPruefung`, `stuckLabel` sowie die in #1787 umgestellten `istFremdeingang`, `imBereich`, `ladeQuoteEcht`, `fuehreTaktAus({ config })`, `ioAus` und `waehleNaechstes`. Es gibt keinen Rückfall auf die Platte; nur die Einstiegspunkte laden die Config. `FACTORY_LABEL` entfällt. `board-lib` lädt beim Import weiter nur Repo und Boards (F2). Das löst die Punkte „`labelAus(config, schluessel)`“ und „`FACTORY_LABEL`“ der Fortschreibung #1744 ab.
- **Fail-closed im Abschluss-Wächter:** `abschlussBlockade` präzisiert das „Fail-closed“ aus #1743: der Grund einer Blockade wird benannt, ein fehlender oder unlesbarer Stand lässt den Abschluss nicht durch. *(Präzisiert durch #1808: „unlesbarer Stand“ meint eine fehlende oder unvollständige Projekt-Config (Agentennamen, `labels.festgefahren`); Laufzeitfehler (kein gh, kein Netz, keine Nachricht) geben weiter frei, siehe Kopf von `scripts/umsetzer-abschluss.mjs`.)*
- **Kern-Agenten ohne Config-Schlüssel:** `holdout-abnahme` und `holdout-szenario` haben keinen Eintrag unter `agenten.*`. Beide Agenten liegen im Ring `kern` (`.factory/besitz.json`) und heißen in jedem Projekt gleich. Die Kern-Reinheit zählt jeden `agenten.*`-Wert als Projektliteral, die Baseline würde wachsen. Die Quelle bleibt `ABNAHME_EMPFAENGER` in `scripts/holdout-auftrag-guard.mjs`.

## Fortschreibung #1799 (2026-10-21): Harness-Doctor --pruefen

- **Prüfen ohne Modell-Tokens:** `scripts/harness-doctor.mjs --pruefen` (Ring `kern`) meldet je fehlender Voraussetzung eine Zeile `LÜCKE <Punkt>: <Befund> Fix: <Anweisung>`. Exit 0 ohne Lücke, 1 mit mindestens einer, 2 bei Aufruf-Fehler, unlesbarer Config oder unlesbarem Ruleset-Spiegel (dann ohne einen `gh`-Aufruf). `gh` und der Langfuse-Aufruf sind injizierbar. Teil 2 (`--einrichten`) baut auf denselben Prüfpunkten auf.
- **Quelle der Voraussetzungen:** Config-Labels, die Label-Literale der Workflows (`--label`, `--add-label`, Env `*LABEL*:`), `secrets.*` und `vars.*` der Workflows (ohne `GITHUB_TOKEN`) und die Boards der Projekt-Config. Das Alarm-Label der CI bleibt im Workflow (`ci.yml` gehört dem Projekt, #1744). Der Wächter `test/harness/harness-doctor-voraussetzungen.test.ts` verlangt für jede gelesene Voraussetzung einen Prüfpunkt.
- **Required Checks aus dem Ruleset-Spiegel:** neuer optionaler Schlüssel `rulesetSpiegel` der Projekt-Config (Pfad); die Projektwerte bleiben damit in der Config (F2). Ohne Schlüssel reicht ein Required Check auf dem Standardzweig.
- **Fehlerkaskade:** ein `gh`-Fehler ist die Lücke genau seines Prüfpunkts; nur ein nicht angemeldetes `gh` ergibt eine einzige Lücke statt aller GitHub-Punkte. Langfuse läuft als Subprozess von `langfuse-vorbedingung.mjs`.
- **Grenzen:** private Repos auf GitHub Free kennen keine Rulesets, die Lücke nennt das und als Fix Repo öffentlich oder anderer Plan. `allowed_actions: selected` gilt als erlaubt. Geprüft werden Repo- und Org-Secrets und -Variablen der Actions, keine Environment-Secrets. Required Checks zählen nur aus Rulesets, der klassische Branch-Schutz wird nicht gelesen (die Factory setzt Rulesets voraus). Ein fein granulares Token liefert keinen Scope-Header: nur ein Hinweis.

## Fortschreibung #1800 (2026-10-21): Harness-Doctor --einrichten und Wochenlauf

- **Einrichten nur Umkehrbares:** `scripts/harness-doctor.mjs --einrichten [--dry-run]` legt fehlende Labels, die Wochenlauf-Datei `.github/workflows/harness-doctor.yml` und (über das idempotente `sammelticket-anlegen.mjs harness`) das Harness-Sammelticket an. Ruleset, Secrets, Variablen, Project-Felder, Actions, Admin-Recht und Token gibt es nur als `ANLEITUNG <Punkt>: <Befund> Fix: <Schritt> Link: <Seite>`, nie automatisch (Außenwirkung). `--dry-run` gibt nur den Plan aus. Ein zweiter Lauf ändert nichts. Eine abweichende Wochenlauf-Datei bleibt stehen (HINWEIS): andere Kern-Workflows verteilt `factory-sync` (F9), `--einrichten` installiert nur die eigene Datei, deren Vorlage der Doctor trägt (ein Wächter hält Vorlage und Datei gleich).
- **Wochenlauf als eigenes Skript und eigener Workflow:** `harness-doctor-melden.mjs` (statt Flag im Doctor, weil die Board-Libs ihre Config beim Import laden und den Exit-2-Vertrag der Config-Fehler bräche) schreibt Lücken als Zeile ins Harness-Sammelticket; bekannt ist ein Punkt (nicht der Befund), wenn eine offene Zeile eines vertrauten Autors in irgendeinem offenen Harness-Sammelticket ihn nennt. Eigener Workflow statt `board-takt.yml`: der läuft je Push mit `github.token`, der Doctor braucht `PROJECT_TOKEN` und Wochentakt. Fehlt das Secret in Actions, ist genau das die Lücke statt eines stillen Abbruchs. Langfuse wird im Wochenlauf nicht geprüft (nur lokal).
- **Ein Zeiger auf den Ruleset-Spiegel:** Docs-Gen liest den Pfad aus `rulesetSpiegel` der Projekt-Config; `diagramme.ruleset` der docs-gen-Config entfällt, ein fehlender Schlüssel ist ein Fehler mit `Fix:`-Zeile. Offen bleibt der Shadowing-Wächter mit festem Pfad (Zeile im Sammelticket).

## Fortschreibung #1745 (2026-10-21): Messskripte (F3, Teil 5)

`token-baseline`, `subagent-laufzeit`, `subagent-laeufe`, `mess-lib`, `kontext-treiber`, `hauptchat-zerlegung`, `langfuse-abgleich-kern`, `langfuse-otlp`, `kontingent-lib` und `docs-gen/registry` tragen keinen Agentennamen, kein Worktree-Präfix und keinen Repo-Namen mehr; die zehn Baseline-Einträge der Kern-Reinheit entfallen. Für dieses Projekt bleiben alle Ausgaben byte-gleich (Golden `test/mess-ausgaben-golden.test.ts`, erwartete Werte in `test/fixtures/mess-golden.json`, am Stand vor der Umstellung erzeugt; die Commit-Folge ist der Beleg). Entscheidungen:

- **Namen als Parameter, geladen nur im Einstieg:** die reinen Funktionen bekommen `namen` (Ticket-Namen aus `ticket-namen.mjs`), `worktree` oder `repoName` als Pflichtparameter und werfen ohne sie. `laufAus(lauf, namen)` wirft auch bei einem Index als zweitem Argument (`.map(laufAus)` wäre sonst still falsch); alle Aufrufer (`lauf-ergebnis`, `naechstes-ticket`, die Messskripte) reichen `namen` aus. `mess-lib` nimmt `worktree` optional wie `wurzel`: ohne ihn entfällt nur diese Ersetzung. `subagent-laufzeit` und `kontext-treiber` haben ihr CLI als `hauptlauf(argv, deps)` (Exit 0, 1 = Config nicht nutzbar, 2 = Aufruf-Fehler); der Standard-Agent ist `agenten.planer` bzw. `agenten.umsetzer`, ohne ihn endet das CLI mit Meldung und `Fix:`-Zeile, bevor ein Transkript gelesen wird.
- **`istTicketLauf` statt `istKubernia`:** ein Subagent gehört zum Ticketlauf, wenn er verschachtelt ist oder sein Typ in der Menge `agenten.planer|umsetzer|lens|gruppe` steht, kein Präfixvergleich. Für die heutigen Agententypen dieses Projekts zählt dasselbe wie vorher (Ausnahmen unter Grenzen).
- **Repo-Name statt Literal:** der JSON-Schlüssel und das Label der eigenen Subagenten in `hauptchat-zerlegung` (`<Repo-Name>-Subagenten`), Scope, Service-Name und erstes Tag der Langfuse-Abgleich-Spans (`<Repo-Name>-abgleich`) und die Log-Datei der Kontingent-Messung (`<Repo-Name>-gh-kosten.jsonl`) bilden sich aus dem Namensteil von `repo` (`repoName` in `projekt-config-lib.mjs`, wirft ohne `repo` mit `Fix:`-Zeile). Das hält Messreihen und Langfuse-Filter für dieses Projekt unverändert. `KQ_GH_KOSTEN_LOG` gewinnt auch ohne Config.
- **Fail-closed:** `langfuse-abgleich` und `langfuse-nachliefern` lesen die Config im Einstieg (ohne Schema-Prüfung, nur `praefixe.worktree` und `repo`) und enden bei Fehler mit Exit 1 und Text, bevor ein Request oder eine Ledger-Datei entsteht. `mitKontingent` bestimmt den Log-Pfad einmal am Start; ist er nicht bestimmbar, entfällt nur das Protokoll (die Messung ist Beiwerk).
- **Ringe:** `mess-lib` und `kontingent-lib` haben keinen Baseline-Eintrag mehr und importieren nur Kern, der Wächter `ueberfluessigeEntkopplung` verlangt dann Ring `kern`; daraus folgt dasselbe für die Einheiten, die nur sie importierten (`subagent-laeufe`, `subagent-laufzeit`, `kontext-treiber`, `token-baseline`, `hauptchat-zerlegung`, `patch-zugriff`, `lauf-ergebnis`, `naechstes-ticket`, `claims-pruefen`, `board-takt`, `board-place`, `sammelticket-anlegen`, `spezifikation`, `abnahme`, `gh-kontingent`, `factory-kennzahlen`). Der Plan wollte keine Ring-Verschiebung; der Wächter entscheidet.
- **Forum-Label:** `fremdtext.mjs` (Kopfkommentar) und `spezifikation.mjs` (Meldungstext über `labelAus(config, "forum")`) nennen es nicht mehr wörtlich.
- **Umgebungsvariablen:** die `KQ_*`-Namen (21, davon `KQ_DIFF_BASE` an 55 Stellen und in `ci.yml`) sind nicht Teil dieses Schritts, sondern #1824: ein Teil-Umbenennen löst nichts, und kein Wächter-Begriff zählt sie. *(Eingelöst durch #1824, Fortschreibung unten.)*
- **Grenzen:** Transkripte mit den Agentennamen vor einer Umbenennung (K8 #1748) zählen danach nicht mehr als Ticketlauf; eine Umbenennung von `repo` ändert Scope, Tag und Log-Datei (Messbruch). Agententypen außerhalb der vier Rollen (etwa aus Experimenten, `kubernia-lens-ohne-kontext`) zählen nicht mehr als eigene Subagenten, sondern als Forks. Der JSON-Schlüssel der eigenen Subagenten kollidiert, wenn der Repo-Name `rows`, `fenster`, `ohnePreis` oder ein anderer Ergebnisschlüssel ist. `langfuse-abgleich` übergibt das Worktree-Präfix, das Ticket fließt dort aber nicht in die Bewertung (kein Test kann die Durchreichung dort unterscheiden).

## Fortschreibung #1746 (2026-10-21): Projektwert-Block aus der Config, geprüft vom Drift-Gate (F3, Teil 6)

Was eine Datei nicht zur Laufzeit aus der Config lesen kann (Frontmatter, Prompt-Text), steht als **Projektwert-Stelle** in der Datei und wird aus `.factory/projekt.json` erzeugt: ein Markdown-Block zwischen den Markern `factory:projektwerte:start` und `:end` (Tabelle aller Schlüssel von `praefixe`, `agenten` und `labels`) und eine YAML-Zeile direkt nach einem Zeilen-Marker `# factory:projektwert <schlüssel>` im Frontmatter. `scripts/projektwerte.mjs --check | --write` prüft und schreibt; die Logik liegt in `scripts/besitz-lib.mjs`, die der Sync, das Drift-Gate und der Kern-Wächter ohnehin teilen (Erkennen, Leeren, Rendern, Vergleichen sind pure Funktionen; nur `projektwertLauf` liest und schreibt unter der Wurzel). Die `name:`-Zeilen von Planer, Umsetzer, Lens, Gruppe und des Ticket-Skills sind generiert. Entscheidungen:

- **Normalisierter Text:** Hash (Sync-Stand und Drift-Gate) und Literal-Zählung des Wächters rechnen auf dem Text mit geleerten Stellen (`normalisierterEinheitText`: Block ohne Rumpf, Frontmatter-Zeile ohne Wert). So bleibt der Hash gleich, wenn ein Projekt andere Werte einsetzt, und ein Wert zählt nie als Projektliteral. Ein kaputter Marker macht die Einheit nicht auflösbar (Drift rot, Zählung 0).
- **Sync rendert mit der Config des Ziels:** ganze Dateien und Block-Einheiten; die Config wird erst geladen, wenn eine Datei Stellen hat (ein Ziel ohne Stellen braucht keine). Fehlt sie, fehlt ein Schlüssel oder ist ein Marker kaputt, schreibt der Sync nichts. JSON-Schlüssel-Einheiten werden nie gerendert (Grenze).
- **Drift-Gate prüft immer gegen die Config, auch ohne Sync-Stand** (das Projekt ist dann selbst Quelle, die Werte müssen trotzdem zur Config passen). Ist die Config ungültig, ist das Gate rot (fail-closed). Meldung: `Fix: node scripts/projektwerte.mjs --write`.
- **Prüf-Fläche geschlossen:** `.md`-Pfade des Besitz-Manifests, `.claude/agents/*.md`, `.claude/skills/*/*.md` (der Ticket-Skill ist Projektbesitz und wird trotzdem geprüft). Kein `git ls-files`, damit Gate und Sync ohne Git laufen.
- **Erkennung:** ein Markdown-Marker zählt nur allein auf seiner Zeile (Beispiele in Backticks zählen nicht), ein Zeilen-Marker nur im führenden Frontmatter und nur vor einer `schlüssel:`-Zeile; sonst bricht der Lauf mit `pfad:zeile` ab (auch bei einer Zeile, die so beginnt, aber eingerückt ist, keinen Schlüssel hat oder einen Zusatz trägt). Werte mit Backtick, `|` oder Zeilenumbruch lassen sich nicht einsetzen und brechen ab.
- **`patch-abschnitte.mjs` nicht wiederverwendet:** es teilt Review-Patches nach Zeichenbudget und kennt keine Marker. Wiederverwendet sind `normalisiereEol` und `eolVon` der Besitz-Lib.
- **Kein Block im echten Repo in diesem Schritt:** der erste Nutzer des Markdown-Blocks ist #1747; die Mechanik ist getestet.
- **Rückfall Frontmatter:** trüge Claude Code ein Frontmatter mit Kommentarzeile nicht, wäre der Marker ein HTML-Kommentar hinter dem schließenden `---`; der Probe-Lauf zu #1746 (`claude -p`, Session `a98202f9-69e4-415c-bea4-05f996362fd7`) belegt, dass Planer, Umsetzer, Lens, Gruppe und der Ticket-Skill mit der Kommentarzeile geladen werden und von Langfuse erfasst sind (Trace `8fbbfe70405d12fe54c2904c5f8afeb8`, je ein Subagent-Span mit Modell laut Frontmatter: Planer und Lens `claude-opus-5-5`, Umsetzer und Gruppe `claude-sonnet-5-5`).
- **Grenzen:** der Sync rendert in jeder Ganz-Datei-Einheit, das Gate prüft nur die Markdown-Fläche; Marker in Nicht-Markdown-Dateien würden gerendert, aber nicht geprüft (heute gibt es keine). Eine Marker-Zeile in einem Markdown-Codeblock zählt als echter Marker (sonst `pfad:zeile`-Abbruch). Eine Änderung von `agenten.planer` macht das Drift-Gate rot, bis `projektwerte --write` lief. Ein `#`-Kommentar, der mit `# factory:projektwert` beginnt, gilt überall als Marker.

## Fortschreibung #1814 (2026-10-21): Factory-Seiten bleiben unter docs/

Die Factory-Seiten bleiben unter `docs/` (kein Verschieben nach `docs/factory/`, kein Ring `kern`). Gründe: Verweise in ADRs werden nie umgeschrieben, die Seiten mischen Projektwerte mit Kernwissen, und die Regelzeilen kommen laut F4 als Markdown-Blöcke in den Kern, ganze Brain-Seiten sind dafür nicht vorgesehen.

## Fortschreibung #1747 (2026-10-21): Agenten- und Skill-Texte ohne Projektliterale (F3, Teil 7)

Die Agenten-Definitionen (Planer, Umsetzer, Lens, Gruppen-Umsetzer, Explore), der Skill `review-lenses` und der Ticket-Ablauf nennen in der Prosa Rollen („der Umsetzer“). Wo ein echter Wert gebraucht wird (Spawn-Typ, Kopfzeile `PLAN`, Nachweis-Zeilen, Worktree- und Patch-Namen, Label), steht ein Platzhalter `<gruppe.schlüssel>` in Schlüssel-Form (Gruppen `agenten`, `labels`, `praefixe`).

- **Block nur bei Platzhaltern:** fünf Dateien tragen einen Projektwert-Block (Planer, Umsetzer, Lens, `review-lenses`, `ablauf.md`), der Gruppen-Umsetzer und Explore nennen keinen Wert und brauchen keinen. Der Block steht direkt nach Überschrift und Einleitung, mit einem Satz davor: Werte wörtlich einsetzen, nie den Platzhalter.
- **Der Ticket-Ablauf trägt den Block selbst:** der Hauptchat liest `.factory/projekt.json` dafür nicht mehr je Skill-Aufruf (Befund aus #1746); die Kurzformen `<Branch-Präfix>` und `<Commit-Präfix>` sind `<praefixe.branch>` und `<praefixe.commitZeile>`. Die Auslöser im `description:` des Ticket-Skills bleiben (Wortlaut der Maintainerin, Projektbesitz, nicht gezählt).
- **Fitness-Regel „Platzhalter braucht Block, Schlüssel löst auf“** in `test/harness/platzhalter-regel.test.ts` (Wächter), nicht im Drift-Gate: sie prüft nur die Prüf-Fläche von `projektwertDateien` und nur die Schlüssel-Form; `<agenten.…>` mit Auslassungszeichen beschreibt nur und zählt nicht.
- **K2 (Negativfall):** derselbe Test fährt das Drift-Gate auf den echten Texten und auf einer Kopie mit verfälschtem Block bzw. abweichender Config; beide sind rot.
- **Tests lesen mit eingesetzten Werten** (`liesMitProjektwerten` in `test/support/ticket-ablauf.ts`), statt Wortlaute mit Projektnamen zu prüfen.
- **Offen, bleibt für andere Schritte:** `Stardew` für F5, die Dateinamen `kubernia-*.md` für F3h (#1748). Die Baseline sinkt für die sechs Einheiten auf `Stardew` (Planer 2, Umsetzer 1, `review-lenses` 1). *(Präzisiert durch #1748: die Dateinamen sind umbenannt, offen bleibt nur `Stardew` für F5.)*
- **Grenzen:** das Modell muss den Platzhalter beim Spawn und in Nachweis-Zeilen selbst auflösen; setzt es ihn wörtlich ein, scheitert der Spawn („Agent type not found“) oder der Nachweis-Check ist rot (fail-closed). Beim Lens-Spawn kaschiert der Fallback auf `general-purpose` ein wörtlich gesetztes `<agenten.lens>` zunächst. Die Platzhalter-Regel liegt als Wächter im Projekt-Test, nicht in der Kern-Lib: bei der Kern-Verteilung (F10) gehört sie neben `projektwertAbweichungen`, sonst bekommt ein Ziel die Platzhalter ohne die Prüfung. Der Probe-Lauf dieses PRs belegt den Spawn für Planer und Umsetzer.

## Fortschreibung #1748 (2026-10-21): Kern-Pfade ohne Projektnamen (F3, Teil 8)

Die Dateien der Rollen haben feste Pfade ohne Projektwort: `.claude/agents/factory-planer.md`, `factory-umsetzer.md`, `factory-lens.md`, `factory-gruppe.md` und `.claude/skills/factory-ticket/SKILL.md`. Die Identität bleibt das `name:` aus `agenten.*` (Platzhalterzeile vor `name:`), darum bleiben Spawn-Typen, `/kubernia` und die Langfuse-Zeitreihen unverändert.

- **Rollen-Pfad:** `ROLLEN_PFADE` in `scripts/projekt-config-lib.mjs` ist die einzige Quelle der fünf Pfade (Schlüssel wie `PFLICHT_AGENTEN`).
- **`haupt-sync`:** das Skill-Verzeichnis ist die Konstante `TICKET_SKILL_VERZEICHNIS` aus dem Rollen-Pfad, ohne Config und ohne IO (der Hook ist fail-open); eine fehlende Config meldet weiter `notiz` und Exit 1.
- **Lens-Guard:** ein Fallback-Spawn gilt als Lens, wenn der Prompt den Kern-Dateinamen `factory-lens.md` oder (Übergang, fail-closed) `<agenten.lens>.md` nennt.
- **Besitz:** der Ticket-Skill bleibt Projektbesitz (kein Manifest-Eintrag, wie bisher), der Gruppen-Umsetzer wechselt auf Ring `kern`; Planer und Umsetzer bleiben `kern-nach-entkopplung` (F5). `kern-abdeckung.json` und `protected-paths.json` brauchen keine Änderung (`/.claude/` deckt alles ab, `factory-ticket/` ist kein Kern-Verzeichnis). Die Baseline-Schlüssel sind umbenannt, die Werte unverändert.
- **Wächter:** `test/harness/kern-reinheit.test.ts` prüft, dass kein Manifest- und kein Rollen-Pfad ein Projektliteral trägt (Negativfall mit Repo- und Agentennamen im Pfad), dass `ROLLEN_PFADE` genau `PFLICHT_AGENTEN` abdeckt und jede Datei ihren Namen aus `agenten.<rolle>` setzt. `entfernte-pfade.test.ts` meldet die alten Dateinamen und einen Platzhalter als Dateinamen als Rückfall.
- **Nachzügler aus #1747:** `projektDateien` und `PROJEKTWERT_GRUPPEN` sind exportiert (Platzhalter-Regel und Test-Support leiten daraus ab), die Kurzformen `<Präfix>`, `<Branch-Präfix>`, `<Worktree-Präfix>` in Kern-Kommentaren sind durch `<praefixe.…>` ersetzt.
- **Grenzen:** der Repo-Begriff zählt im Pfad ohne Wortgrenze (kurze Repo-Namen können zufällig treffen). Der Skill erscheint in Claude Code zusätzlich unter dem Verzeichnisnamen (`/factory-ticket`); das zählt `hauptchat-zerlegung` nicht als Ticket-Skill. Ein Ziel-Repo, das schon synchronisiert wurde, behält die alten Dateien, bis es sie selbst löscht (der Sync entfernt keine verwaisten Einheiten). Laufende Sessions laden Skilltexte und Definitionen erst nach Neustart; der Guard erkennt beide Formen weiter.
- **Probe-Lauf (#1293):** `claude -p` im Worktree (Claude Code 2.1.306), Session `d1f65d18-676e-4bd0-b5ee-7213c282b33b`: das `system/init`-Event listet `kubernia-planner`, `kubernia-lens`, `kubernia-gruppe`, `kubernia-umsetzer` als Agenten und `factory-ticket` als Skill; ein Skill-Aufruf mit `skill=kubernia` lädt (Session `6459cede-f91a-43ec-aaa4-b4e8e4c6a1a4`). Langfuse, Trace `cbe44ea5ed56c79a064beb93a8eb3aa5`: je ein Subagent-Span mit LLM-Call, Planer und Lens auf `claude-opus-5-5`, Gruppe und Umsetzer auf `claude-sonnet-5-5`, `usageDetails` gesetzt.
- **Stand F3:** bis auf `Stardew` (F5) erledigt.

## Fortschreibung #1824 (2026-10-21): Umgebungsvariablen ohne Projektpräfix (F3, Teil 8)

Jede Umgebungsvariable, die ein Kern-Werkzeug liest, heißt `FACTORY_<NAME>`. Der Kern-Reinheits-Wächter zählt den früheren Präfix als Begriff `Env` (`praefixe.commitZeile` ohne Bindestrich, mit Unterstrich; Wortgrenze davor, damit `VITE_<PRAEFIX>_…` und `__<PRAEFIX>_…__` nicht zählen). Alle Kern-Einheiten stehen auf 0, die Baseline änderte sich nicht.

- **Präfix fest `FACTORY_`, keine Ableitung aus der Config:** die Workflows setzen die Namen im YAML, wo es keine Config gibt; `.factory/` und `factory-sync` heißen schon so. `HARNESS_` kollidiert mit den Umgebungsvariablen der Harness-Plattform.
- **Lesen über `umgebungsWert(env, name)`** in `scripts/projekt-config-lib.mjs`: der volle neue Name steht als Literal im Aufrufer (greppbar). Ein noch gesetzter Altname gilt weiter und warnt mit dem neuen Namen (einmal je Name und Prozess auf stderr); sind beide gesetzt, gewinnt der neue Name, die Warnung sagt „ignoriert“. Gesetzt heißt `!== undefined`, ein leerer Wert zählt. Den Altpräfix liest die Funktion lazy und einmal je Prozess aus der Config (`altEnvPraefix`), ein Ladefehler heißt: keine Alt-Prüfung, nie ein Wurf.
- **Übernehmen statt nur warnen:** sonst fiele eine Einstellung der Maintainerin (Zielquote in der Shell oder in den lokalen Settings) still weg. Der Rückfall bleibt bis zur Extraktion (F10).
- **Messkontinuität bleibt erhalten, kein Bruch:** die Standardpfade ändern sich nicht (`<Temp>/<Repo-Name>-gh-kosten.jsonl`, `<Temp>/claude-rate-limits.json`, `<Temp>/<Worktree-Präfix>mcp-ausfall-<Slug>.json`); nur die Namen der Overrides wechseln.
- **Inventar** (Name, Ring, wer setzt, wer liest): [befehle.md › Umgebungsvariablen](../referenz/befehle.md#umgebungsvariablen). Projektnamen (`KQ_UPDATE_QUIZ_GOLDEN`, `KQ_GIT_SAFECRLF`, `VITE_KQ_DEVPANEL_PW`) bleiben; sie liegen in Projekt-Einheiten.
- **Wächter:** ein Eintrag in `test/harness/entfernte-pfade.test.ts` hält die 15 früheren Kern-Namen aus dem Repo (ADRs ausgenommen).
- **Grenzen:** der Rückfall auf den Altnamen gilt nur für Werkzeuge, die `umgebungsWert` nutzen; ein Fremd-Projekt braucht ihn nicht (Präfix ohne Treffer, Warnung entfällt, wenn die Config nicht lädt). `--config <pfad>` gilt nicht für den Altpräfix: er kommt immer aus der Standard-Config neben dem Skript. Persönliche Settings der Maintainerin außerhalb des Repos können Altnamen tragen; sie wirken mit Warnung weiter.

## Fortschreibung #1708 (2026-10-21): AGENTS.md in Kern- und Projekt-Block (F4)

Die `AGENTS.md` besteht aus dem Kopf, einem zusammenhängenden Kern-Block `kern` (Besitz der Factory, zwischen `factory-besitz`-Markern, Ring `kern-nach-entkopplung`) und einem Projekt-Block (Marker `factory-projekt`). Der Kern ist literalfrei: Commit-Zeilen-, Branch- und Worktree-Präfix, Agentennamen und Label stehen als Platzhalter `<gruppe.schlüssel>`, deren Werte die Projektwert-Tabelle im Kern-Block aus `.factory/projekt.json` einsetzt.

- **Ein Block statt Einzelblöcken:** `setzeBlock` verlangt je Block ein Markerpaar (rund 70 Zeichen je Paar bei 28.000 Zeichen Budget), und die Kern-Regeln hängen zusammen. Der Block `stopps` entfällt.
- **Zuschnitt des Kerns:** Root-Kontextdatei-Regel, Human-in-the-Loop-Checkpoints mit den Kern-Stopps (Löschen, Repo-Einstellungen, Veröffentlichen), Mehr-Perspektiven-Review, Festgefahren-Protokoll, Anonymität, interne Bezüge, Kollisionsschutz, Modellwahl nach Phase. Die Projekt-Stopps (Forum-Antwort, PixelLab-Key) stehen im Projekt-Block als eine Zeile; die Kern-Stopps verweisen auf sie.
- **Projekt-Leitfrage:** die oberste Regel („Größe des fertigen Spiels“) bleibt unter ihrer Überschrift im Projekt-Block, jetzt als Projekt-Leitfrage; der Kern verweist nur darauf. Ein anderes Projekt setzt dort seine eigene Frage.
- **Projektwert-Tabelle in der AGENTS.md:** der Platzhalter-Wächter verlangt sie, und ohne sie kennt der Hauptchat die Werte nicht. Sie kostet etwa 800 Zeichen; das Budget bleibt unverändert, dafür entfielen doppelte Verweise (Abschnitt „Befehle“, Doppelzeilen in den Gates).
- **Stopps im Projekt-Block sind gesichert:** `harness-approval.test.ts` prüft die Kern-Anker im Kern-Block, die Projekt-Anker samt wörtlicher Pin-Zeile im Projekt-Block und verbietet Kern-Anker im Projekt-Block; dazu meldet er jede Zeile des Projekt-Blocks mit einem Stopp-Wort (Stopp, Vorab, Pre-Flight, Löschen, Veröffentlich), die nicht auf einer geschlossenen Erlaubnisliste steht, auch ohne Anker. Eine Änderung am Kern-Block im Projekt ist für `check:factorydrift` rot und der Hinweis nennt, dass Projektergänzungen außerhalb der Besitz-Marker gehören.
- **Bleibt im Projekt-Block:** Regeln ohne Zeile im Inventar (Abschnitt C), etwa Kein-Grün-durch-Aufweichen, Fremdtext, Zwei-Stufen-Prüfung, Harness-Befunde als Zeilen; ihr Zuschnitt folgt mit F5 (#1709). Ausnahmen im Kern trotz fehlender Zeile: die Stopps (§4 verlangt sie im Kern) und die Regel zu internen Bezügen (gehört zur Anonymität).
- **Browser-Prüfung, Skill-Frontmatter-Grenze, Kontext sparen:** die spielunabhängigen Inventarzeilen (Abschnitt C) stehen als kurze Zeilen im Kern; der Projektteil (`kqDev.state()`, Dev-Server-Reload) bleibt im Projekt-Block. Die Planer-Laufzeitregeln stehen in der Planer-Agentendatei, nicht in der AGENTS.md; „Vorlage-Form: Plugin und Mods“ ist eine Entscheidungseingabe und keine Agentenregel, darum nicht im Kern. Platz kam aus gekürzten Verweisen und Doppelungen, das Budget wuchs nicht.
- **Grenzen:** Eine Lockerung in einem Wort außerhalb der Stopp-Wörter fängt kein Wächter, im Projekt-Block nur die Pin-Zeile und die Stopp-Wort-Prüfung; Links im Kern-Block auf Projekt-Docs sind in einem neuen Projekt tot (Befund für F10); die Platzhalter löst das Modell beim Lesen selbst auf.

## Fortschreibung #1837 (2026-10-21): Präzisierungen zu #1748 und #1824

Die Überschrift von #1824 zählt dort als „Teil 8“; gemeint ist F3 **Teil 9** (Teil 8 ist #1748). Die Anker bleiben, ein ADR wird nicht umgeschrieben.

- **Standard-Config neben dem Skript:** gemeint ist `.factory/projekt.json` in der Wurzel des Repos, in dem das Skript liegt (`ROOT` in `scripts/projekt-config-lib.mjs`), nicht im Arbeitsverzeichnis. `--config <pfad>` ändert den Altpräfix der Umgebungsvariablen nicht.
- **Ausnahmen des Wächters `entfernte-pfade.test.ts`, vollständig:** die Pfad-Präfixe `docs/adr/`, `test/harness/model-routing.test.ts`, `test/harness/entfernte-pfade.test.ts` und `docs/lens-gegenprobe-`; Schnappschuss-Blöcke zwischen `<!-- schnappschuss:start -->` und `<!-- schnappschuss:ende -->`; die Regel-Ausnahme für `docs/referenz/befehle.md` (nur die Regel der Kern-Umgebungsvariablen, wegen der Altnamen-Spalte im Inventar).
- **Lens-Guard ohne Übergangs-Zweig:** ein Fallback-Spawn gilt nur noch als Lens, wenn der Prompt den Kern-Dateinamen `factory-lens.md` nennt; `<agenten.lens>.md` zählt nicht mehr (ersetzt den „Übergang, fail-closed“ aus #1748).
- **`hauptchat-zerlegung`:** zählt den Verzeichnisnamen des festen Rollen-Pfads (`factory-ticket`) als Ticket-Skill, per Slash und per Skill-Tool (ersetzt die Grenze „zählt nicht“ aus #1748).
- **`ordneHarnessAenderungen(dateien)`** hat keinen zweiten Parameter mehr: Skill ist `AGENTS.md`, `KERN_SKILL_VERZEICHNIS` oder `TICKET_SKILL_VERZEICHNIS`.
- **Platzhalter-Muster:** `platzhalterMuster()` in `scripts/besitz-lib.mjs` liefert die Regex der `<gruppe.schluessel>`-Platzhalter (frische Instanz je Aufruf); Platzhalter-Regel und Test-Support nutzen sie.
- **Inventar-Wächter:** `test/harness/umgebungsvariablen-inventar.test.ts` hält das Inventar der Umgebungsvariablen und den Quelltext in Einklang. Das Ende des Rückfalls auf den Altnamen steht in #1715 (F10).

## Fortschreibung #1709 (2026-10-22): Stardew-Regeln aus dem Kern (F5)

- **Ort der Regeln:** Leitfrage und Optik-Messlatte stehen im Projekt-Block der `AGENTS.md` (Claude Code lädt sie nativ, ein neuer Pflicht-Schlüssel in der Projekt-Config entfällt). Planer, Umsetzer und `review-lenses` verweisen darauf („Projekt-Leitfrage“, „Optik-Messlatte“); fehlt die Regel im Projekt, entfällt die Prüfung bzw. begründet der Agent die Optik-Weiche ohne.
- **Wächter:** `kern-reinheit.test.ts` zählt `Stardew` (Config-Schlüssel `projektliterale`, groß/klein egal) je Kern-Einheit; die Baseline ist leer, ein eingeschleuster Treffer ist rot. `agents-bloecke.test.ts` weist die Projektregel im Prompt nach, `factory-sync.test.ts` ein Fremdrepo ohne Leitfrage und Optik-Regel.
- **Ringe:** `check-size`, `check-context-size`, `check-docmap` und `check-lockfile` wechseln auf Ring `kern` (kein Baseline-Eintrag mehr, nur Kern-Importe). Planer, Umsetzer und `review-lenses` bleiben `kern-nach-entkopplung` (weitere Projektbezüge, F6).
- **Schon frei:** der Ticket-Workflow (`.claude/skills/factory/*`), `scripts/schichten-kern.cjs` und `scripts/layers.cjs` (Projektbesitz).
- **Präzisiert:** der Zuschnitt der Regeln ohne Inventar-Zeile („ihr Zuschnitt folgt mit F5“) folgt im Sammelticket #1843.
- **Grenzen:** der Wächter zählt nur das Wort; Spielbezüge wie NPCs oder Phaser zählt er nicht, ein Projektwert-Block wird vor dem Zählen entfernt. Der Ring `kern` belegt „literal- und importfrei“, nicht „strukturfrei“.

## Fortschreibung #1848 (2026-10-22): Skill-Quelle und Skill-Zeiger

- **Entscheidung:** Abläufe liegen tool-neutral als Skill-Quelle unter `.agents/skills/<name>/SKILL.md`. `.claude/skills/<name>/SKILL.md` ist ein generierter Skill-Zeiger: das Frontmatter der Quelle wörtlich (auch `model`, `effort` und Projektwert-Zeilen), darunter Marke und Verweis „Lies die Quelle und folge ihr“. Vorgeführt am Skill `forum`; `review-lenses` folgt in #1849, der Ticket-Ablauf in #1850.
- **Generator statt Symlink:** `npm run skills:sync` (`scripts/skills-sync.mjs`, Ring `kern`, läuft in `setup`) erzeugt die Zeiger. Claude Code hat keinen konfigurierbaren Skill-Pfad (anthropics/claude-code#33957, #22902, #25367), und Windows-Clones ohne `core.symlinks` machten aus einem Symlink eine Textdatei.
- **Wächter als Test:** `test/harness/skills-sync.test.ts` prüft über die pure Funktion `pruefeSkills` den echten Stand (Zeiger gleich Quelle, Quelle ohne Zeiger, Zeiger ohne Quelle, nicht gelisteter Volltext-Skill, Quelle ohne `name` oder `description`). Es gibt kein neues Glied in `verify`. Der Umlaut-Wächter (`umlaut-regel.test.ts`) und die anderen Wächter, die Skill-Texte scannen, nehmen die Quelle unter `.agents/skills/` mit.
- **Übergangsliste:** `UEBERGANG` in `scripts/skills-sync.mjs` nennt die noch nicht umgezogenen Volltext-Skills samt Ticket des Umzugs; sie schrumpft nur und ist rot, wenn ein Eintrag schon eine Quelle hat oder kein Ticket nennt.
- **Besitz:** `scripts/skills-sync.mjs` ist Kern. Die Quelle von `forum` ist Projektbesitz; die Besitz-Pfade der Kern-Skills ziehen mit #1849 und #1850 um.
- **Grenzen:** geprüft wird die Gleichheit von Zeiger und Quelle, nicht dass ein Werkzeug dem Zeiger tatsächlich folgt (das belegt ein Probe-Lauf). Der Sync überschreibt nie einen Ordner ohne Marke, er meldet ihn nur.

## Fortschreibung #1829 (2026-10-22): Betrieb ohne Harness im Projekt-Repo (Arbeitsplatz)

Kurzfassung: Für Projekte, in deren Repo vom Harness nichts liegen darf, läuft die Factory in einem **Arbeitsplatz**: ein Ordner über dem Projekt-Klon, der `AGENTS.md`, `.claude/`, `scripts/` und `.factory/` trägt. Claude Code startet dort, der Klon liegt als Unterordner darin. Claude Code lädt diese Dateien von selbst, im Repo des Projekts ändert sich nichts (Probe unten). Die Git-Hooks sollen über die globale Git-Config zu den Repos kommen, nicht über Dateien im Repo; die Config-Doku deckt das, ein praktischer Lauf folgt in #1853. kubernia bleibt **eingebettet**, wie in ADR 0022 beschlossen. Nachteil: die Durchsetzung ist nur lokal, es gibt keinen Server-Check im Projekt.

### Anforderungen (Pre-Flight-Antworten der Maintainerin vom 2026-10-22)

Quelle: [Kommentar im Ticket #1829](https://github.com/fluffels/kubernia/issues/1829#issuecomment-6341813365).

1. Tragender Grund: Eigentum und Vertraulichkeit; Projektspezifisches gehört nicht in die Factory.
2. Vom Harness liegt nichts im Projekt-Repo, auch nichts Git-ignoriertes, wenn vermeidbar. Spricht alles dagegen, steht das hier ehrlich.
3. Läuft lokal, nur mit Claude Code; Sandbox ist entkoppelt ([ADR 0025](0025-sandbox-als-austauschbare-laufumgebung.md)).
4. Das Ticketsystem bleibt vorerst wie heute; die Anbindung anderer Systeme ist ein Folgeticket (#1851).
5. Lokale Durchsetzung ist Pflicht (Hooks, `verify`); Server-Checks sind nur ein Zusatz.
6. Mehrere Projekte und mehrere Repos je Projekt, neben eigenen Projekten.
7. Claude als Cloud-Modell ist erlaubt; Langfuse und Telemetrie gelten je Option und sind bei Kundenrepos strenger zu bewerten.
8. Neue Kern-Versionen kommen als Release mit Tag.

### Belegte Fakten (gelesen 2026-10-22, Claude Code 2.1.308, Git 2.53.0.windows.1)

- **Kontextdateien** ([Memory](https://code.claude.com/docs/en/memory)): `CLAUDE.md`-Dateien oberhalb des Arbeitsverzeichnisses laden beim Start, Dateien in Unterordnern bei Bedarf. `AGENTS.md` lädt aus dem Arbeitsverzeichnis und den Ordnern darüber, wenn dort keine `CLAUDE.md` liegt (ab v2.1.277). Aus `--add-dir` lädt `CLAUDE.md` nur mit `CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD=1`. Eine verwaltete `CLAUDE.md` liegt unter `C:\Program Files\ClaudeCode\CLAUDE.md`, `~/.claude/rules/` gilt global.
- **Hooks und Settings** ([Permissions](https://code.claude.com/docs/en/permissions)): „Hooks and other `.claude/settings.json` keys load from the current working directory's `.claude/` folder with no parent-directory fallback“. Darum muss das Arbeitsverzeichnis der Arbeitsplatz sein. `--add-dir` lädt Skills, Commands und Subagenten, aus den Settings nur `enabledPlugins` und `extraKnownMarketplaces`; `permissions.additionalDirectories` gibt nur Dateizugriff.
- **Settings-Dateien** ([Settings](https://code.claude.com/docs/en/settings)): `.claude/settings.local.json` entsteht bei „Yes, and don't ask again“ im Projekt (unter Windows neben `.claude/settings.json` im Startordner) und trägt sich in die globalen Git-Excludes ein. `--settings` steht über user/project/local und unter managed. `CLAUDE_CONFIG_DIR` verlegt `~/.claude` samt Einstellungen, Verlauf und Plugins. Telemetrie-Variablen aus Projekt-Settings wirken nur als Aus-Wert.
- **CLI** ([Referenz](https://code.claude.com/docs/en/cli-reference)): `--add-dir` entdeckt die meiste `.claude/`-Konfiguration nicht; `--plugin-dir` gilt nur für die Sitzung; `--worktree` legt `<repo>/.claude/worktrees/<name>` an.
- **Plugins** ([Referenz](https://code.claude.com/docs/en/plugins-reference)): tragen Skills, Agenten, Hooks, MCP, LSP, Workflows, Monitore und `bin/`; `settings` wirkt nur für `agent` und `subagentStatusLine`; „A `CLAUDE.md` at the plugin root isn't loaded as context“; Namensraum `<plugin>:<name>`.
- **Agent SDK** ([Übersicht](https://code.claude.com/docs/en/agent-sdk/overview)): „Unless previously approved, Anthropic does not allow third party developers to offer claude.ai login“, es gilt der API-Key; das SDK ist eine Bibliothek ohne Terminal-Oberfläche.
- **Managed Settings** ([Doku](https://code.claude.com/docs/en/managed-settings)): `managed-settings.json` und `managed-settings.d/` liegen unter Windows in `C:\Program Files\ClaudeCode\`; wer Administrator ist, kann sie ändern; sie gelten für alle Projekte der Maschine.
- **Cloud-Sitzungen** ([Doku](https://code.claude.com/docs/en/claude-code-on-the-web), [Settings in cloud sessions](https://code.claude.com/docs/en/settings#settings-in-cloud-sessions)): laufen auf einem frischen Klon des Repos; `~/.claude/settings.json` und `.claude/settings.local.json` werden nicht gelesen; Plugins aus Marketplaces laden nicht.
- **Git** ([git-config](https://git-scm.com/docs/git-config), [githooks](https://git-scm.com/docs/githooks)): `includeIf "gitdir:<muster>"` bindet eine Config-Datei, wenn der Pfad des `.git`-Ordners zum Muster passt; `core.hooksPath` ersetzt `$GIT_DIR/hooks`; `GIT_CONFIG_COUNT` und `GIT_CONFIG_KEY_<n>` setzen Config-Werte für den Prozess. Eingebundene Dateien gelten nach git-config so, „as if they had been found at the location of the include directive“; ein `core.hooksPath` in einer per `includeIf` eingebundenen Datei wirkt also wie in der Hauptdatei. Ein praktischer Lauf fehlt noch (Folgeticket #1853).

### Probe A und A2 (2026-10-22, lokal, `claude -p`, Modell haiku, drei Läufe)

Aufbau: ein Ordner mit `AGENTS.md` (Markersatz), `.claude/settings.json` (PreToolUse-Hook, der ein Log im Ordner schreibt, und `deny: Edit(./AGENTS.md)`), einem Agenten und einem Skill `probe`, dazu ein Unterordner mit einem frischen Git-Repo, einer committeten Datei und einer eigenen `CLAUDE.md`. Claude Code startete im Oberordner. Sitzungen `41c95138-b72c-4e75-a795-0b1388b77264` (Lauf 1) und `b137f8c6-5ff6-44d7-b888-cc8196e4e45e` (Lauf 2); zwei Repos siehe A2 unten.

- Das init-Ereignis listet `probe` als Agent und als Skill, ohne Namensraum.
- Der Marker der `AGENTS.md` des Oberordners war ohne Tool-Aufruf bekannt (Lauf 2).
- Der Hook lief (Log mit 5 Zeilen in Lauf 1); ein Edit auf `AGENTS.md` wurde abgelehnt („File is in a directory that is denied by your permission settings“), der Edit auf eine Datei im Repo ging durch.
- `git status --porcelain --ignored` im Repo zeigte danach nur ` M README.md`: nichts vom Harness.
- Die `CLAUDE.md` im Repo lud nach, als eine Datei dort gelesen wurde (Marker in Lauf 2 genannt).
- **Probe A2 (zwei Repos):** zweites Repo `repo2` mit eigener `CLAUDE.md` neben dem ersten, Sitzung `900fd730-09a7-4482-9e56-b634bbce9885`: die Marker beider Repo-`CLAUDE.md` und der `AGENTS.md` wurden geladen, ein Edit in `repo2` ging durch, `git status --porcelain --ignored` zeigte in beiden Repos nur ` M README.md` (`repo` stammt aus Lauf 1, dessen Edit dort noch im Arbeitsbaum lag; die Marker beider Repo-`CLAUDE.md` wurden durch Lesen je einer Datei in beiden Repos geladen). Damit ist „mehrere Repos je Projekt“ für zwei Repos belegt, mehr wurden nicht geprüft.
- Eine Vertrauens-Warnung („workspace not trusted“) erschien bei `-p` nicht. Grenze: interaktive Läufe wurden nicht geprüft.

### Optionen

„Dateien im Repo“ sind Dateien des Harness; `.git/`-Interna (`.git/worktrees`) zählen nicht. Zellen ohne Quelle sind „unbelegt“. Ticketsystem und Telemetrie stehen unter der Tabelle.

| Option | Dateien im Projekt-Repo | User-Scope bzw. außerhalb | Durchsetzung | Update-Weg | Aufwand | Risiken | Beleg | Urteil |
|---|---|---|---|---|---|---|---|---|
| O1 eingebettet per Sync (heute) | `AGENTS.md`, `.claude/`, `scripts/`, Workflows, `.factory/` | nichts nötig | lokal und Server (Required Checks, wo das Projekt sie erlaubt) | Sync-PR je Projekt | gering, läuft | Harness gehört dem Repo-Eigner | ADR 0022 (dieses Dokument, Stand gelesen 2026-10-22) | **scheidet aus** nach Frage 2; bleibt Betriebsart für eigene Repos |
| O2 `.git/info/exclude` | dieselben Dateien, nur ungetrackt | nichts | lokal | Sync wie O1 | gering | Dateien liegen weiter im Arbeitsbaum des Repos | Dateien liegen im Repo-Ordner (Folge der Definition); Wirkung von `.git/info/exclude`: **unbelegt**, nicht gelesen | **scheidet aus** nach Frage 2 |
| O3 User-Scope `~/.claude/*` | keine | Agenten, Skills, Regeln, Settings in `~/.claude` | lokal; gilt in jedem Projekt der Maschine | Dateien kopieren; eine Version je Rechner | mittel | eine Version für alle Projekte der Maschine, Hooks mit Projektbezug nicht trennbar | Memory, Settings (gelesen 2026-10-22) | nur Baustein, kein Träger |
| O3b `CLAUDE_CONFIG_DIR` je Projekt | keine | eigener Config-Ordner je Projekt | lokal | wie O3, je Ordner | mittel | getrennter Login und Langfuse-Zustand: **unbelegt** | Settings (gelesen 2026-10-22, nur Existenz der Variable) | Variante von O3, nicht empfohlen ohne Beleg |
| O4 Managed Settings, verwaltete `CLAUDE.md` | keine | `C:\Program Files\ClaudeCode\` | lokal, stärkste Stufe; Administrator nötig | Datei ersetzen | gering | wirkt global, ändert sich nur mit Adminrechten | Managed Settings, Memory (gelesen 2026-10-22) | Zusatz für projektneutrale Denies |
| O5 Plugin im User-Scope oder `--plugin-dir` | keine | Plugin-Ordner | lokal | Marketplace oder Ordner | mittel | trägt keine `CLAUDE.md`, keine `permissions`; Namensraum ändert Agentennamen (Guards, Langfuse-Reihen) | Plugins-Referenz (gelesen 2026-10-22) | kein Träger |
| O6 Launcher: Arbeitsverzeichnis = Repo, mit `--add-dir`, `--settings`, `--append-system-prompt-file` | `settings.local.json` und `.claude/worktrees/` landen im Repo | Harness-Ordner außerhalb | lokal | Ordner aktualisieren | mittel | `--add-dir` lädt die meiste `.claude/`-Konfiguration nicht und gibt Schreibzugriff auf den Harness | CLI, Permissions, Settings (gelesen 2026-10-22) | **scheidet aus** nach Frage 2 (legt Dateien im Repo ab) |
| **O7 Arbeitsplatz** (Arbeitsverzeichnis = Arbeitsplatz, Klon als Unterordner) | keine (Probe) | Arbeitsplatz-Ordner mit allen Harness-Dateien | lokal; Hooks per O9 | `factory-sync --ziel <arbeitsplatz>` von einem Tag, ohne PR | mittel (Folgetickets) | Fremdrepo-`.claude/` wirkt nicht (gewollt); nur lokale Durchsetzung; mehrere Repos als Unterordner: Probe A2 | Memory, Permissions (gelesen 2026-10-22); Probe A und A2 (2026-10-22) | **empfohlen** |
| O8 Wrapper-Repo mit Submodul | keine | Wrapper-Repo | lokal | Submodul-Zeiger | mittel | Submodul pinnt SHAs, Pflege je Projekt | Fakten Git (nicht geprüft): **unbelegt** | verworfen, Variante von O7 |
| O9 `core.hooksPath` über `includeIf` | keine | globale Git-Config plus Hooks-Ordner im Arbeitsplatz | lokal (umgehbar mit `--no-verify`) | Hooks-Ordner im Sync | gering | `includeIf` setzt `hooksPath` laut git-config wie eine Hauptdatei; praktischer Lauf in #1853 | git-config, githooks (gelesen 2026-10-22) | Baustein für O7 |
| O10 Agent SDK | keine | eigenes Programm | lokal oder Server | Paketversion | hoch | keine Terminal-Oberfläche, API-Key statt Login (widerspricht Frage 3) | Agent SDK (gelesen 2026-10-22) | beobachten |
| O11 Cloud-Sitzung, Managed Agents | liest `.claude/` aus dem Klon | nicht gelesen (User-Scope) | Server (Anthropic-Umgebung), nicht lokal; selbst gehostete Umgebung: **unbelegt** | je Sitzung | mittel | nicht lokal; Code und Repo laufen beim Anbieter | Cloud-Doku, Settings in cloud sessions (gelesen 2026-10-22) | **scheidet aus** (Frage 3) |
| O12 Devcontainer, Docker Sandboxes | **unbelegt** (Quelle nicht gelesen; üblich ist ein Konfigurationsordner im Repo, eine Ablage außerhalb ist ungeprüft) | **unbelegt** | lokal | Image | hoch | siehe ADR 0025 | ADR 0025 (Stand gelesen 2026-10-22); Container-Konfiguration: **unbelegt** | orthogonal, passt zu O7 |
| O13 eigener CI-Spiegel | keine | Spiegel-Repo mit CI | Server auf dem Spiegel | Push in den Spiegel | hoch | Commit-Status im Fremdrepo wäre Außenwirkung | unbelegt | optionaler Zusatz, nicht Teil der Entscheidung |

Ticketsystem im Projekt nötig: bei O1 bis O13 nein, das Ticketsystem bleibt wie heute (kubernia: GitHub); die Anbindung anderer Systeme ist #1851. Telemetrie: Langfuse läuft über Hooks und das Plugin, nicht über das Repo; nach [ADR 0019](0019-langfuse-plugin-im-user-scope.md) ist das Plugin im User-Scope aktiv und erfasst damit auch Sitzungen im Arbeitsplatz, solange es dort nicht abgeschaltet ist; das Abschalten je Arbeitsplatz ist Teil von #1853. Für Kundenrepos gilt es strenger: Quelltext verlässt die Maschine ohnehin zum Cloud-Modell (Frage 7).

### Ähnliche Ansätze anderer Werkzeuge (gelesen 2026-10-22)

- **Codex** ([AGENTS.md-Anleitung](https://learn.chatgpt.com/docs/agent-configuration/agents-md)): globale Datei im Codex-Home (`~/.codex`, verlegbar mit `CODEX_HOME`), dazu Projektdateien von der Repo-Wurzel abwärts. Ein globaler Ort, kein Ordner über dem Repo.
- **Gemini CLI** ([GEMINI.md](https://geminicli.com/docs/cli/gemini-md/)): `~/.gemini/GEMINI.md`, dazu Dateien in Arbeitsbereichen und deren Elternordnern. Ein Ordner über dem Repo wird gelesen, wie bei Claude Code.
- **Aider** ([Konventionen](https://aider.chat/docs/usage/conventions.html)): `--read` oder `read:` in `.aider.conf.yml`; ein Ort in der Home-Config steht dort nicht: unbelegt.
- Persönliche Anweisungen bei Copilot: nicht gelesen, **unbelegt**.

Nur Gemini liest erwiesenermaßen auch Ordner über dem Repo; Codex liest eine globale Datei und Projektdateien, Aider ist unbelegt. Keines der Werkzeuge belegt, dass ein Ordner über dem Repo Hooks und Berechtigungen trägt. Das belegt nur die Probe.

### Entscheidung

**Entscheidung: Betriebsart Arbeitsplatz (O7) für Projekte ohne Harness im Repo, Git-Hooks über `includeIf` in der globalen Git-Config (O9), kubernia bleibt eingebettet, weil nur O7 zugleich vier Dinge erfüllt: nichts im Projekt-Repo, native Ladeorte ohne Namensraum, mehrere Repos je Projekt und den unveränderten Sync.**

Eine Option, die Dateien im Repo braucht (O1, O2, O6), scheidet nach Frage 2 aus, ebenso O11 (nicht lokal). Eigenschaften ohne Quelle (O3b, O8, O12, O13) tragen keine Empfehlung. Kippkriterium: findet sich bei O7 eine unvermeidbare Datei im Repo, bleibt der Harness im Projekt-Repo, und das steht dann hier; einen Rückfall über O6 gibt es nicht, weil er ebenfalls Dateien im Repo ablegt.

### Wirkung

- **Besitz-Manifest:** der Inhalt bleibt; neu ist eine Betriebsart je Einheit (`eingebettet` oder `Arbeitsplatz`). Workflows und `.githooks` gelten nur eingebettet (#1854).
- **Sync:** `factory-sync --ziel <arbeitsplatz>` von einem Tag; `sync-stand` und das Drift-Gate laufen lokal im Arbeitsplatz, es gibt keinen PR im Projekt (#1854). Eigene Repos bleiben beim bisherigen Sync.
- **AGENTS.md-Aufteilung (F4):** Kern- und Projekt-Block stehen in der `AGENTS.md` des Arbeitsplatzes; die Regel zur einen Root-Kontextdatei gilt dort. Die `CLAUDE.md` eines Fremdrepos bleibt dessen Besitz und lädt bei Bedarf nach.
- **Projekt-Config:** neuer Schlüssel für die Repo-Pfade (#1855).

### Was dagegen spricht

- Die Durchsetzung ist nur lokal: ohne Sandbox stoppt ein Edit-Deny keine Schreibzugriffe über Bash ([ADR 0025](0025-sandbox-als-austauschbare-laufumgebung.md)), Git-Hooks sind mit `--no-verify` umgehbar.
- Die `.claude/`-Konfiguration eines Fremdrepos wirkt nicht automatisch; das ist gewollt, ein Hook oder MCP-Server aus einem Klon läuft nicht.
- Git-abhängige Funktionen beziehen sich auf das Arbeitsverzeichnis, nicht auf das Repo; Pfade müssen aus der Projekt-Config kommen (#1855).
- Commit-Zeilen mit Harness-Präfix würden in der Historie des Fremdrepos landen (#1852).
- Ein Arbeitsplatz ist ein zusätzlicher Ordner je Projekt; ohne Sync-Werkzeug (#1854) wäre er Handarbeit.

### Folgeticket-Entwürfe

| Nr. | Inhalt |
|---|---|
| #1855 | Projekt-Config mit Repo-Pfaden, getrennte Wurzel für Arbeitsplatz und Repo, Worktrees außerhalb des Repos |
| #1854 | Betriebsart im Manifest, Sync und Drift-Gate im Arbeitsplatz |
| #1853 | `includeIf`-Hooks, Doctor gibt nur eine `Fix:`-Zeile aus, Schutz der Harness-Pfade, Langfuse je Arbeitsplatz abschaltbar |
| #1852 | Nachweise ohne Commit-Zeilen im Fremdrepo |
| #1851 | Ticketsystem als Port (GitHub, Trello, Jira per MCP) |

### Re-Evaluierung

Neu bewerten, wenn Claude Code die Ladeorte ändert (Release-Watch #1362) oder Plugins `permissions` oder Kontext tragen.

## Fortschreibung #1711 (2026-10-22): Sprache als Projektwert (F8)

- **Wo der Wert steht:** `sprache` in der Projekt-Config (`.factory/projekt.json`) trägt die Umschrift-Wortliste (`umschrift`) und das Vokabular des Spezifikations-Gates (`spezifikation`: Abschnittsnamen `ziel` und `akzeptanzkriterien`, das Präfix `nachMerge`, je `wort` und `muster` für Negativfall, Begrenzung und Allquantor). Die Form prüft `pruefeProjektConfig`; beim Laden ist der Block optional, beim Gebrauch Pflicht: `spracheAus` und `umschriftAus` brechen mit Fix-Zeile ab, es gibt keinen stillen Deutsch-Standardwert.
- **Was im Kern deutsch bleibt:** die Rahmentexte der Meldungen (§8: Kern-Texte bleiben deutsch). Die Schlüsselwörter werden eingesetzt; mit der echten Config sind alle Meldungen wortgleich zu vorher (Golden-Test). Die Einstiege `spezifikationsMaengel`, `kriterien` und `pruefeEingang` der Lib verlangen `sprache`; `naechstes-ticket.mjs`, `spezifikation.mjs`, `abnahme.mjs` und `check-abnahme-nachweis.mjs` lesen sie aus der Config.
- **Umlaut-Wächter:** `test/harness/umlaut-regel.test.ts` erzwingt die Sprachregel „Deutsch mit echten Umlauten“ für die lebende Doku, Agenten und Skills mit der Wortliste `sprache.umschrift`. Grenze: Code-Kommentare, Spieltexte, Commit-Texte, ADRs und Wörter außerhalb der Liste prüft er nicht; der Scan-Umfang steht im Kopfkommentar des Tests.
- **Kern-Protokoll, nicht Sprache:** der Epic-Titel-Test (`istEpicTitel`), die Szenario-Wörter der Holdout-Abnahme (`holdout-auftrag-guard.mjs`), der Sammelticket-Titel mit „(gesammelt)“ und die Urteilswerte der Abnahme sind feste Protokollwörter und kein Projektwert.
- **Präzisiert:** der Abschnitt zum Spezifikations-Gate (F12) nennt die Abschnittsnamen und Schlüsselwörter fest; sie stammen jetzt aus `sprache.spezifikation`.
- **Re-Evaluierung:** der Trigger „erstes nicht deutschsprachiges Projekt“ bleibt unverändert; die Kern-Texte wären dann zu übersetzen.

## Fortschreibung #1710 (2026-10-22): Kern-Registry ohne Spiel-Generator (F6)

F6 ist umgesetzt. Entscheidungen:

- **Config-Schlüssel `generatoren`:** `scripts/docs-gen/config.json` nennt Projekt-Generatoren als `{ "<marker>": { "datei": "<Pfad relativ zum Repo-Root>", "name": "<Export>" } }`. `ladeGeneratoren` in `scripts/docs-gen/registry.mjs` lädt sie per asynchronem `import()` (die Engine-CLI ist deshalb async) und ergänzt die Kern-Registry `GENERATORS`; ohne den Schlüssel entspricht das Ergebnis genau `GENERATORS`.
- **Fail-closed:** ein Kern-Name als Marker, eine Formverletzung, eine fehlende Datei, ein fehlender oder nicht aufrufbarer Export und ein Fehler beim Laden brechen mit einer Meldung ab, die `config.generatoren.<marker>` nennt; es wird nichts geschrieben.
- **Ort und Ringe:** die Projekt-Generatoren (`save-versionen`, `quest-graph`, `quests-je-thema`) bleiben unter `scripts/docs-gen/` und stehen in `test/harness/kern-abdeckung.json` als `projekt`. *(Aufgehoben durch [#1873](fortschreibungen/0022-1873-kern-ablauf-ohne-projektwissen.md): sie liegen unter `scripts/projekt/docs-gen/`.)* `docs-gen.mjs` und `registry.mjs` wechseln von `kern-nach-entkopplung` auf Ring `kern`; `KERN_HUELLE_AUSNAHMEN` ist leer.
- **Wächter:** „Kern-Registry enthält keinen Spiel-Generator (ADR 0022 F6)“ in `test/harness/kern-reinheit.test.ts` (läuft mit `npm test` in `verify`); Fremdrepo-Fälle (ohne `generatoren`, fehlender Generator) in `test/docgen-fremdrepo.test.ts`.
- **Grenzen:** die Import-Hülle und der Wächter sehen nur statische Importe; der dynamische Import aus der Config bleibt für die Hülle unsichtbar, ihn sichert `ladeGeneratoren` zur Laufzeit. Ein absoluter oder mit Backslash geschriebener Pfad in `datei` wird vom Wächter nicht normalisiert. Die Projekt-Generatoren liegen im Kern-Ordner, ein eigener Projektordner folgt bei F10. *(Aufgehoben durch [#1873](fortschreibungen/0022-1873-kern-ablauf-ohne-projektwissen.md).)*

## Fortschreibung #1843 (2026-10-22): Struktur-Pfade der Kern-Checks aus der Config (F5-Rest)

- **Config-Schlüssel `struktur`:** `.factory/projekt.json` trägt `struktur.quelle` (Wurzel des Quellcodes) und `struktur.moduldoku` (Ordner der Modul-Tiefendocs), beide repo-relative POSIX-Pfade. `pruefeProjektConfig` meldet einen kaputten Block; beim Laden ist er optional.
- **Gebrauchspflicht:** `strukturAus(config)` in `scripts/projekt-config-lib.mjs` wirft ohne beide nicht-leeren Strings mit Schlüssel und `Fix:`-Zeile, es gibt keinen stillen Standardwert (wie `spracheAus`).
- **Betroffene Checks:** `check:size` (`collectSizes`) und `check:docmap` (`collectSrcModules`, `parseDeepDocMaps`, `auditDocMap`) nehmen die Pfade als Parameter und lesen ohne Angabe die Config; ihre Meldungen und Kommentare nennen keine Projektdateien mehr. Die `quellwurzel` des Schicht-Modells bleibt eine eigene Angabe der Schichtdaten.
- **Eine Prüfung der Sprachwerte:** `spracheMaengel` in `scripts/spezifikation-lib.mjs` (importfrei) ist die einzige Prüfung von `sprache.spezifikation`; das Gate wirft bei ihren Mängeln, `pruefeProjektConfig` meldet dieselben Texte. Die Import-Hülle der Config-Lib wächst damit auf vier Dateien.
- **Zuschnitt (Zeilen aus #1709):** In den Kern zogen die projektneutralen Arbeits- und Backlog-Regeln (Gruppen `**Arbeitsweise:**` und `**Backlog:**`, zwölf Anker je genau einmal, neu „Befunde sofort festhalten“) samt Kopf-Zitat; im Projekt-Block bleiben die Spielzeile des Kopfs, die Ticket-Auswahl mit `--bereich` und Spielquote, die Leitfrage und die Optik-Messlatte. Die Prompts nennen statt `kqDev`/`Hafen` den Dev-Helfer und die Anti-Corruption-Layer des Projekts; beide Begriffe stehen als `projektliterale` in der Config. `Phaser`/`scenes` sind bewusst kein Literal: der Wächter zählt Teilstrings ohne Wortgrenzen, und mehrere Kern-Skripte tragen das Wort noch (Befund im Nachfolge-Sammelticket).
- **Ungültige Config am Einstieg:** `board-lib.mjs` sowie `check:size` und `check:docmap` fangen den Ladefehler (beim Import bzw. in `main`) und enden mit `✖`-Zeile, `Fix:` und Exit 1 ohne Stacktrace.

## Fortschreibung #1849 (2026-10-22): review-lenses als Skill-Quelle

- **Umzug:** Die Quelle von `review-lenses` liegt unter `.agents/skills/review-lenses/SKILL.md`, `.claude/skills/review-lenses/SKILL.md` ist der generierte Zeiger; der Eintrag verlässt `UEBERGANG`. Besitz: beide Pfade als Einheiten im Ring `kern-nach-entkopplung`.
- **Prüffläche der Projektwerte:** `projektwertDateien` (`scripts/besitz-lib.mjs`) umfasst zusätzlich `.agents/skills/*/*.md`; die Prüffläche aus der Zeile zur Platzhalter-Regel gilt damit für die Quellen, der Diff-Basis-Wächter scannt sie ebenfalls. Ein verfälschter Projektwert-Block in einer Quelle ist rot.
- **Verweise:** Verweise mit Anker zeigen auf die Quelle (der Zeiger trägt keine Überschriften). Ein Scan-Wächter in `test/harness/skills-sync.test.ts` meldet jeden Verweis auf `.claude/skills/<name>/SKILL.md` einer Quelle (Ausnahmen: ADRs, README.md (ganze Datei, wegen der generierten Tabelle), Besitz-Manifest, Fixtures); `check:docdrift` meldet Anker auf den Zeiger.
- **Übergang:** Die Quelle verlinkt den Ticket-Ablauf noch über `.claude/skills/factory/ablauf.md`, bis `factory` mit #1850 umzieht.

## Weitere Fortschreibungen (als Dateien)

Neue Fortschreibungen dieses ADR stehen nicht mehr am Dateiende, sondern je eine Datei unter [`fortschreibungen/`](fortschreibungen/0022-1860-ausnahmelisten-und-quellwurzel.md) (Konvention: [README](README.md#format)); dort die erste. Weitere: [#1850](fortschreibungen/0022-1850-ticket-skills-als-quellen.md), [#1871](fortschreibungen/0022-1871-sync-vom-tag.md), [#1872](fortschreibungen/0022-1872-kern-reste-vor-dem-schnitt.md), [#1866](fortschreibungen/0022-1866-skill-quelle-und-config-schluessel.md), [#1873](fortschreibungen/0022-1873-kern-ablauf-ohne-projektwissen.md), [#1874](fortschreibungen/0022-1874-berechtigungs-ergaenzung.md), [#1875](fortschreibungen/0022-1875-extraktionsliste.md), [#1876](fortschreibungen/0022-1876-fremd-config.md), [#1877](fortschreibungen/0022-1877-kern-tests-board-tickets.md), [#1878](fortschreibungen/0022-1878-kern-tests-nachweis-review.md), [#1899](fortschreibungen/0022-1899-golden-mit-fremd-config.md), [#1888](fortschreibungen/0022-1888-sandbox-ergaenzung.md), [#1903](fortschreibungen/0022-1903-null-regel-kern-tests.md), [#1923](fortschreibungen/0022-1923-factory-export.md), [#1930](fortschreibungen/0022-1930-ticket-skill-im-export.md), [#1929](fortschreibungen/0022-1929-daten-dateien.md), [#1931](fortschreibungen/0022-1931-config-settings-mcp-tests.md), [#1932](fortschreibungen/0022-1932-kern-jobs-und-regeln.md), [#1933](fortschreibungen/0022-1933-kern-tests-ohne-projektgroesse.md), [#1934](fortschreibungen/0022-1934-projektzeilen-aus-kern-tests.md), [#1935](fortschreibungen/0022-1935-factory-seiten-und-links.md), [#1943](fortschreibungen/0022-1943-bereich-produkt-und-ticket-skill-aus-quelle.md), [#1936](fortschreibungen/0022-1936-projekt-bloecke-und-letzte-probe.md).

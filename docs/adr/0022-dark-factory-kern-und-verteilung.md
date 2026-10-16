# ADR 0022: Dark Factory — Kern-Schnitt des Harness und Verteilung per Sync mit Besitz-Manifest

> Architecture Decision Record. Format: Kontext → Optionen → Entscheidung → Folgeticket-Entwürfe → Konsequenzen → Re-Evaluierung.
> Status: **akzeptiert, Workflow-Pfad entfernt: präzisiert durch ADR 0028, Ring Oberfläche: präzisiert durch ADR 0029** · Datum: 2026-10-08 · Ticket: #1366

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
- **Startbestand:** Inventarzeilen „ja“ ohne Werkzeug-Anbindung sind Ring `kern`, „teilweise“ Ring `kern-nach-entkopplung`, dazu die „nein“-Ausnahmen aus §1; eine Bibliothek bekommt den Ring ihres strengsten Importeurs. Module und Projekt-Config stehen nicht im Manifest. Die Regelzeilen des Inventars (Abschnitt C) und die Anonymitätsregel kommen als Markdown-Blöcke mit F4 (Kern/Projekt-Split der AGENTS.md); der Stopps-Block ist bis dahin der einzige Block (Kontext-Budget). `scripts/check-internalrefs.mjs` steht abweichend von §1 im Ring `kern-nach-entkopplung`, weil die Begriffsliste im Skript ein Projektwert ist. Das Manifest ist ab jetzt die Besitz-SSOT, es gibt keinen maschinellen Abgleich mit dem Inventar. Neue Kern-Dateien (F2, F7, F9) kommen ins Manifest und müssen literalfrei sein.
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
- **Import-Hülle:** jeder lokale Import einer Ganz-Datei-Code-Einheit zeigt auf eine Ganz-Datei-Einheit oder `.factory/projekt.json`. Ausnahmen (`KERN_HUELLE_AUSNAHMEN`) nur für Importeure im Ring `kern-nach-entkopplung`, mit Ticket oder ADR-Schritt; die Liste darf nur schrumpfen. Bestand: die Kern-Registry der Doku-Generatoren importiert zwei Spiel-Generatoren (F6). Die Schichtdaten-Ausnahme von F7 ist entfallen: `check-diffcoverage.mjs` liest den Pfad aus `scripts/docs-gen/config.json` (`schichten.layers`).
- **Grenzen:** für die Schlüssel `permissions`, `sandbox` und `hooks` gibt es keinen Weg über die Projekt-Config (Claude Code liest sie dort nicht), ein Projekt ändert sie heute nur upstream (F4); die Import-Hülle sieht nur statische Importe, keine Aufrufe über einen Pfad in Text-Einheiten (Beleg und Zuordnung: #1663); `.factory/besitz.json` und `.factory/sync-stand.json` als Einheit des Manifests sind nicht abgewiesen; das Löschen des Sync-Stands schaltet das Gate ab (sichtbar nur im Leitplanken-Diff unter `.factory/`); ein neuer Unterordner (etwa ein neuer Skill) ist von der Abdeckung nicht erfasst; zusammengesetzte oder dynamische Importpfade sieht die Hülle nicht; BOM und Binärdateien sind nicht behandelt; der Ticket-Verweis einer Ausnahme wird nicht auf „offen“ geprüft; der Sync läuft aus einem Arbeitsbaum, nicht von einem Tag (F10).

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
- **Ehrliche Grenze:** Transkripte unter `~/.claude/projects` und dasselbe GitHub-Konto für alle Agenten machen die Trennung zu einer Disziplin- und Wächterfrage, nicht zu einer kryptografischen. Der Bericht des Abnahme-Agenten bleibt Selbstauskunft; `abnahme.mjs` prüft Form, Vollständigkeit und den unveränderten Worktree, nicht die Wahrheit der Belege.

Umsetzungsentscheidungen in #1753:

- **Marker und Urteil-Format** liegen in `scripts/slice-override.mjs` (`formatAbnahme`, `formatAbnahmeMarker`, `parseAbnahmeMarker`, `URTEILSWERTE`), nicht im Einstiegsskript: #1755 braucht denselben Parser, Einstiegsskripte importieren einander nicht, und es gibt eine Quelle statt zwei. Der Marker-Name folgt aus dem Commit-Zeilen-Präfix (klein geschrieben), kein Projektliteral im Kern.
- **Durchgang** = gültige Marker vertrauter Autoren auf dem PR plus eins (derselbe Parser wie #1755; Fremde und der Hand-off-Marker zählen nicht). Scheitert nach dem PR-Kommentar der Hand-off-Kommentar, zählt ein Neuversuch als weiterer Durchgang (fail-closed).
- **Kriterium K<i>** ist die Position im Abschnitt, nicht die Ziffer des Autors; Unterpunkte und Folgezeilen gehören zum Oberpunkt.
- **Ticket ohne Kriterien:** `kriterien` liefert die `entfaellt`-Zeile (Exit 0), `auswerten` endet mit Exit 2.
- **Hand-off-Hinweis:** der Reparaturweg `spezifikation.mjs reparieren` greift nur bei unvollständiger Spezifikation (verweigert Tickets mit Assignee und umformulierte Zeilen); ein nicht prüfbares Kriterium präzisiert die Maintainerin, das Verfahren klärt #1754.

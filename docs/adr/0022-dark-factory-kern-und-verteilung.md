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

Präzisiert durch #1628: Die Workflows checken das volle Repo aus und setzen die Position über `scripts/board-place.mjs` (Wiederholung, rot bei endgültigem Scheitern); Sparse-Checkout und `set_board_top` entfallen für die Inbox-Workflows.

## Fortschreibung #1615 (2026-10-16): Spezifikations-Gate (F12)

F12 ist umgesetzt. Entscheidungen:

- **Prüfung:** `scripts/spezifikation-lib.mjs` (Ring `kern`, literalfrei, ohne Importe) liefert die Mängelliste eines Bodys: `## Ziel` mit Inhalt, `## Akzeptanzkriterien` (oder `## Teil-Akzeptanzkriterien`, die Überschrift gebündelter Befund-Issues) als Liste, darin mindestens ein Kriterium mit dem Wort „Negativfall“. Das Wort ist deutsch und deterministisch; bei einem nicht deutschsprachigen Projekt wird es ein Projektwert (§8).
- **Bestand und Neues:** Der Stichtag `spezifikation.hartAb` (Issue-Nummer) steht in `.factory/projekt.json`. Beim Einführen erfüllten 17 von 160 offenen Issues das Format; ohne Stichtag hätte das Gate das Board gesperrt. Darunter wird nur berichtet, ab der Nummer übersprungen. `hartAb` darf nur sinken (Bitte, kein Wächter); eine einmalige Anpassung auf die nächste freie Nummer ist nur vor dem Merge erlaubt, weil zwischen Messung und Merge neue Tickets entstehen (Stand beim Merge: 1673). Fehlt der Schlüssel, ist alles hart.
- **Ausnahmen über §3 hinaus:** alle Kopf-Items (🚨, 🔒, 🤖, Forum, ⏰) haben eigene Formate, dazu Sammel- und Epic-/Phasen-Titel.
- **Einmal-Kommentar:** `naechstes-ticket.mjs` kommentiert (I/O injiziert, Logik pur) nur, wenn die Spezifikation der ausschlaggebende Grund ist, und nur ohne den versteckten Marker `<!-- spezifikations-gate -->` im Kommentar eines vertrauten Autors; ein später anderer Mangel löst bewusst keinen zweiten Kommentar aus.
- **Grenze:** Bei gleichzeitiger Auswahl können zwei Kommentare entstehen (der Marker wird direkt vor dem Posten geprüft, nicht atomar). Ein Ticket, das zwischen Festlegen des Stichtags und Merge entsteht, ist hart.

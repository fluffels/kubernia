# Harness übertragen: Einführungspfad für ein fremdes Bestands-Repo

> 🧭 **Fachlich geprüft am: 2026-10-07.** Evergreen. Zielgruppe: wer den Harness dieses Repos (Agenten-Regeln, Gates, Lebende Doku, Review) in ein **bestehendes** Repo in beliebiger Sprache holen will. Die Regeltexte stehen nicht hier, sondern in [AGENTS.md](../AGENTS.md) und [agent-harness.md](agent-harness.md); diese Seite sagt, **in welcher Reihenfolge** man sie einführt und **was auf dem Weg weh tut**. Das Leitbild „Bitte → Mauer“ (was als Bitte in `AGENTS.md` beginnt, wird ein Gate): [agent-harness.md › Leitplanken-Schichten](agent-harness.md#leitplanken-schichten-bitte-und-mauer). Warum Doku generiert wird: [ADR 0017](adr/0017-lebende-doku-generierte-abschnitte.md). Wie das gewachsen ist: [README › Wie das gewachsen ist](../README.md#wie-das-gewachsen-ist).

## Grundregel: Bestand einfrieren statt sanieren

Ein Brownfield-Repo besteht den ersten Lauf jedes neuen Gates nicht, und ein Gate, das beim Einschalten rot ist, wird ausgeschaltet. Darum gilt für jede Stufe dasselbe Muster, das dieses Repo selbst nutzt:

1. **Ist messen und in eine Baseline-Datei schreiben** (alles, was heute verletzt).
2. **Das Gate ist rot bei Neuem oder Verschlechtertem**, grün bei Bestand.
3. **Stale Einträge werden abgeräumt** (behobene Verletzungen verschwinden aus der Baseline, sonst wächst sie als Altlast zurück).
4. **Schwellen bewegen sich nur in die strenge Richtung** (kein Grün-durch-Aufweichen, [AGENTS.md › Git, PR und Merge](../AGENTS.md#git-pr-und-merge)).

Belege im Repo: [`eslint-suppressions.json`](../eslint-suppressions.json) (Komplexität je Funktion, abräumen mit `npm run lint:prune`), [`any-suppressions.json`](../any-suppressions.json) (Deckel für begründete `any`), die `ALLOWLIST` von `check:size` (Dateien über 800 Zeilen, nur mit offenem Split-Ticket), die Coverage-Floors je Schicht in [`vite.config.ts`](../vite.config.ts) (nur anheben) und [`test/harness/emoji-baseline.json`](../test/harness/emoji-baseline.json). Generierte Zeilen (`GEN:`-Abschnitte) zählen für `check:diffsize` nicht, ein neuer Generator bläht also den Slice-Deckel nicht auf.

## Reifestufen

Aufwand ist qualitativ (klein, mittel, groß) und an den Kubernia-Tickets belegt, die die Stufe eingeführt haben; keine Stundenangaben, die niemand gemessen hat.

| Stufe | Was | Aufwand | Nutzen | Typische Brownfield-Hürde | Bestand einfrieren | Beleg hier |
|---|---|---|---|---|---|---|
| 1 | `AGENTS.md` mit SSOT-Regeln | klein | Agenten (und Menschen) lesen dieselbe Regelquelle; ein Größen-Gate hält sie kurz | verstreute, widersprüchliche Bestandsdoku; niemand weiß, welche Regel gilt | die gelebte Praxis aufschreiben, nicht die gewünschte | [AGENTS.md](../AGENTS.md), `check:contextsize`, [ADR 0013](adr/0013-docs-als-agentengepflegtes-wiki.md), [ADR 0015](adr/0015-projekt-brain.md) |
| 2 | Generierte Doku-Abschnitte + `check:docgen` | mittel | Zählbares und Aufzählungen veralten nicht mehr still | der erste Lauf deckt Drift auf (das ist der Befund, kein Fehler des Werkzeugs) | Abschnitte erst dort einführen, wo die Quelle sauber ist; der Rest bleibt Prosa | #1355 (`110a0b4`), #1392 (`1cd7d63`), [ADR 0017](adr/0017-lebende-doku-generierte-abschnitte.md) |
| 3 | Schichtregel + Diagramm == Regel | mittel bis groß | Architekturregeln sind ein Gate, das Diagramm leitet sich aus derselben Tabelle ab | Bestandsverstöße und Zyklen; das Soll startet grob und wird verfeinert | bekannte Verstöße in die Baseline des Werkzeugs, Soll zuerst auf wenige Grobschichten | #1368 (`10d27a6`), [`scripts/layers.cjs`](../scripts/layers.cjs), [schichtregeln.md](referenz/schichtregeln.md) |
| 4 | PR-Gating + Mehr-Perspektiven-Review | mittel | nichts Rotes erreicht `main`; Review ist nicht der Agent, der den Code schrieb | Branch-Schutz braucht Admin- und Team-Absprache; flakige Tests machen Required Checks unbenutzbar | flakige Tests zuerst isolieren oder aus den Required Checks lassen | [ADR 0009](adr/0009-pr-gating-required-checks.md), [ADR 0012](adr/0012-harness-autonomie-audit-spur.md), [ADR 0014](adr/0014-leitplanken-ohne-label-riegel.md), #1012, #1270 |
| 5 | Modell-Routing + Messung | mittel | Kosten je Phase sichtbar, Modellwahl ist Konfiguration statt Gewohnheit | Telemetrie und Datenschutz; eine belastbare Baseline braucht Wochen an Daten | Messung vor Optimierung: erst Baseline über mehrere Wochen, dann Schwellen | [model-routing.md](model-routing.md), [ADR 0015](adr/0015-projekt-brain.md), [ADR 0016](adr/0016-langfuse-takt-woechentlich.md), [ADR 0019](adr/0019-langfuse-plugin-im-user-scope.md) |

**Stufe 1** ist die billigste und wirkt sofort. Eine Regel steht genau einmal (in `AGENTS.md`), alles andere verlinkt. Die Hürde ist nicht das Schreiben, sondern das Entscheiden, welche der widersprüchlichen Altregeln gilt. **Stufe 2** ist der Hebel für alles Weitere: wer Tabellen und Zählungen aus Code ableitet, muss nicht mehr glauben, dass die Doku stimmt. **Stufe 3** ist der Kern von „Diagramm == Regel“: ein Diagramm, das nicht aus der geprüften Regel erzeugt wird, ist eine Behauptung. **Stufe 4** macht aus Bitten Mauern; ohne Branch-Schutz ist alles davor freiwillig. **Stufe 5** ist die einzige, die man weglassen kann, ohne dass die Stufen davor schlechter werden.

## Werkzeug-Mapping je Sprache (Stufe 3)

Der Schichtgedanke ist sprachneutral, das Werkzeug nicht. Alle Angaben sind an der jeweiligen Werkzeug-Doku belegt.

| Ökosystem | Schichtregel prüfen | Ist-Graph / Diagramm | Bestand einfrieren | Quelle |
|---|---|---|---|---|
| JS/TS | dependency-cruiser, Regeln in der Config (hier abgeleitet aus `SCHICHT_MODELL`) | `--output-type mermaid`, Verdichten mit `--collapse` | `--baseline` (der frühere `depcruise-baseline` ist ein Alias), danach `--ignore-known` | [CLI-Doku](https://github.com/sverweij/dependency-cruiser/blob/main/doc/cli.md) |
| Python | Tach (Modulgrenzen) oder import-linter (Verträge `layers`, `forbidden`, `independence`) | Tach: `tach show --mermaid`, `tach map`, `tach sync` | import-linter: `ignore_imports` je bekanntem Verstoß | [Tach](https://docs.gauge.sh/usage/commands), [import-linter](https://import-linter.readthedocs.io/en/stable/contract_types/) |
| JVM | ArchUnit; ein PlantUML-Komponentendiagramm ist direkt die Regel (`adhereToPlantUmlDiagram`) | das PlantUML-Diagramm selbst ist die Quelle | `FreezingArchRule.freeze(...)` speichert bestehende Verstöße, später melden nur neue | [ArchUnit-Guide](https://www.archunit.org/userguide/html/000_Index.html) |
| sprachneutral | LikeC4 prüft **keinen Code**: `likec4 validate` prüft Syntax und Layout-Drift des Modells, `likec4 build` erzeugt eine statische Seite | Diagramm aus dem Architekturmodell | entfällt; ein handgeschriebenes Modell driftet, wenn kein Test es gegen die Schichtquelle hält | [LikeC4-CLI](https://likec4.dev/tooling/cli/) |

Hinweise zur Wahl: Für **JS/TS** und **Python** liefert das Werkzeug den Graphen mit, Soll und Ist lassen sich vergleichen. Auf der **JVM** ist das Diagramm schon die Regel, ein zweites Soll-Diagramm wäre doppelt. LikeC4 ist ein Darstellungswerkzeug; wer es nutzt, braucht einen eigenen Test, der Modell und Schichtquelle abgleicht, sonst gilt „Diagramm == Regel“ nicht.

**Ist-Adapter:** der Generator `schichten-ist` liest jede JSON-Ausgabe der Form `{ "modules": [ { "source": "…", "dependencies": [ { "resolved": "…" } ] } ] }` (die Form von dependency-cruiser). Für Python genügt ein kleines Skript, das die Import-Zeilen liest und diese Form ausgibt; [`test/docgen-fremdrepo.test.ts`](../test/docgen-fremdrepo.test.ts) macht das mit einem Mini-Repo vor.

## docs-gen in ein anderes Repo übernehmen (Stufe 2 und 3)

Der Generator-Kern hängt nicht an Kubernia. Belegt ist das durch einen Test, der ein Mini-Repo (Python, ohne `package.json`, ohne `src/`) mit eigener Config, eigener Schicht-Definition und eigener Registry durch den Kern fährt ([`test/docgen-fremdrepo.test.ts`](../test/docgen-fremdrepo.test.ts)) und durch einen Wächter, der prüft, dass die Kern-Module nur `node:*` und andere Kern-Module importieren.

**Ist-Zustand ist Übernahme per Kopie, kein Paket.** Zum Kopieren:

- Kern: `scripts/docs-gen.mjs` (Engine), `scripts/docs-gen/markdown.mjs`, `adr.mjs`, `zeitleiste.mjs`, `schichten.mjs`, dazu eine **eigene** `registry.mjs`, die nur wählt, was das Projekt braucht.
- Nicht Kern: `harness-inventar`, `diagramme` und `ruleset-spiegel` setzen Claude Code und GitHub voraus; `gates` setzt npm-Skripte voraus (für einen anderen Task-Runner, etwa Make, ist ein eigener Generator nötig); `save-versionen` und die Quest-Generatoren sind Kubernia-spezifisch. Welche es sonst noch gibt, zeigt die gruppierte [Registry](../scripts/docs-gen/registry.mjs).

**Was das Projekt festlegt (alles in einer Config-Datei, `--config <pfad>`):**

- `markdown`: welche Dateien und Ordner nach `GEN:`-Markern durchsucht werden.
- `adr.ordner`, `zeitleiste.meilensteine`: Quellen für ADR-Liste und Zeitleiste.
- `schichten.layers` (Pfad zur Schicht-Definition) und `schichten.cruise` (Node-Aufruf, der die Import-Graph-JSON auf stdout liefert).
- `befehl` (optional): der Befehl, den Hinweiszeile und `Fix:`-Text nennen, Standard `npm run docs:gen`.

**Vertrag der Schicht-Definition:** eine CommonJS-Datei, die `SCHICHT_MODELL` und `pruefeModell` exportiert. Das Modell trägt `quellwurzel` (das Code-Verzeichnis mit Slash, etwa `wetter/`), `schichten` (je `id`, `label`, `wurzeln`, `muster`, `darf`; genau eine Auffang-Schicht mit `muster: null`) und `extern`. Alles, was nicht in `darf` steht, ist verboten. Die Engine prüft zusätzlich selbst, dass `quellwurzel` gesetzt ist, auch wenn der mitgelieferte Prüfer es nicht tut. Die Regeln des Werkzeugs (hier die von dependency-cruiser) sollten aus derselben Datei abgeleitet werden, wie [`scripts/layers.cjs`](../scripts/layers.cjs) es vormacht.

## Offene Entscheidung: Veröffentlichung

Ob Kern und Harness als eigenes Template-Repo oder npm-Paket veröffentlicht werden, hat Außenwirkung und liegt bei der Maintainerin. Empfehlung: jetzt kein eigenes docs-gen-Paket, die Form des gesamten Harness-Kerns wird zusammen in #1366 entschieden und docs-gen dort als Kern-Baustein mitbedacht; die Übernahme per Kopie trägt bis dahin.

## Gliederung für Artikel oder Vortrag

**These: „Ein Diagramm ist eine Regel.“** Agenten brauchen Mauern statt Bitten, und eine Doku, die aus derselben Quelle entsteht wie die Prüfung, kann nicht lügen.

1. **Vorher.** Die README-Gate-Tabelle nannte 7 von 12 Gates ([ADR 0017](adr/0017-lebende-doku-generierte-abschnitte.md), Kontext); ein Architektur-PNG ohne Quelle, entfernt in `102cb7a` (#1369); falsche Aussagen in der README, die #1354 gesammelt hat.
2. **Das Muster.** Bitte → Mauer ([agent-harness.md › Leitplanken-Schichten](agent-harness.md#leitplanken-schichten-bitte-und-mauer)): jede wiederholte Bitte an einen Agenten wird zum Gate.
3. **Nachher, belegt aus Git.** Generierte Gate-Tabelle und Inventar (`110a0b4`), Schichten Soll und Ist in README und arc42 §5 (`10d27a6`), Agenten-Ablauf, Sequenz und Leitplanken-Schichten (`102cb7a`), Spiel-Diagramme (`1d83039`). Jeder Beleg ist mit `git show <sha> --stat` reproduzierbar.
4. **Diagramme.** Die generierten Schichten- und Agenten-Diagramme in [README](../README.md#wie-das-gewachsen-ist), [arc42](arc42-architektur.md) und [agent-harness.md](agent-harness.md#leitplanken-schichten-bitte-und-mauer) (Quellen: #1368, #1369).
5. **Übertragung.** Die Reifestufen oben, Bestand per Baseline einfrieren, das Werkzeug-Mapping, der Fremd-Repo-Test als Beleg.
6. **Grenzen, ehrlich.** MCP-Server sind nie Quelle eines Gates; der Ist-Graph wird bei Wachstum unleserlich und muss verdichtet werden; ein handgeschriebenes LikeC4-Modell driftet ohne Abgleichtest; ein Generator für Nicht-npm-Task-Runner fehlt.
7. **Öffentliche Quellen zum Weiterlesen:** Cyrille Martraire, *Living Documentation* (Doku aus der Quelle ableiten); OpenAI, „Harness engineering“ (Umgebung statt Prompt als Hebel).

# ADR 0017: Lebende Doku — generierte Abschnitte, und ein Diagramm ist eine Regel

> Architecture Decision Record. Format: Kontext → Problem → Optionen → Entscheidung → Konsequenzen → Re-Evaluierung.
> Status: **akzeptiert** · Datum: 2026-10-07 · Ticket: #1355 (Teil von #1354, Lebende Doku)

## Status

**Akzeptiert.** Die Mechanik steht in [`scripts/docs-gen.mjs`](../../scripts/docs-gen.mjs), die Pfade und Beschreibungen in [`scripts/docs-gen/config.json`](../../scripts/docs-gen/config.json), der Wächter in [docs/agent-harness.md](../agent-harness.md#lebende-doku-wächter-npm-run-checkdocgen-1355).

## Kontext

Handgepflegte Tabellen über Ableitbares veralten still. Die gepflegte Gate-Tabelle in `docs/agent-harness.md` kannte `check:internalrefs` nicht, die der README kannte 7 der 12 Gates in `verify`. Die bestehenden Wächter (`check:docdrift`, `check:docmap`) prüfen Kommandos, Links und Abdeckung, aber nicht, ob eine Tabelle den Code vollständig und richtig wiedergibt.

## Optionen

| Option | Bewertung |
|---|---|
| **Handpflege plus Reviewer-Disziplin** | Skaliert nicht mit Gates, Agenten und Skills; genau das hat die Drift erzeugt. Verworfen. |
| **Ganze Seiten generieren** | Mischt Prosa und Daten; die Prosa lässt sich nicht mehr frei bearbeiten. Verworfen. |
| **Generierte Abschnitte zwischen Markern (gewählt)** | Die Prosa bleibt von Hand, nur die ableitbaren Teile sind Daten. Ein Gate vergleicht. |
| **Wissen über MCP (z. B. Live-Abfragen) als Quelle** | Nicht reproduzierbar, braucht Netz und Zugangsdaten, in der CI nicht verfügbar. Verworfen als Gate-Quelle. |

## Entscheidung

Entscheidung: **generierte Abschnitte zwischen `GEN`-Markern, geprüft von `check:docgen` in `verify`**, weil das Repo selbst die Quelle ist und ein Vergleich im Speicher billig, deterministisch und CI-tauglich ist.

- **Marker-Mechanik:** `<!-- GEN:<name> START -->` und `<!-- GEN:<name> END -->` stehen je auf einer eigenen Zeile, auch eingerückt (etwa in einem Listenpunkt). Der Inhalt dazwischen gehört dem Generator mit dem Namen `<name>`. Marker in Code-Fences oder mitten im Text zählen nicht. `npm run docs:gen` schreibt, `npm run check:docgen` erzeugt im Speicher und meldet Datei, Abschnitt und den Fix `npm run docs:gen`. Rot sind: fehlender oder verwaister Marker, unbekannter Generator, derselbe Name zweimal in einer Datei, veralteter Abschnitt, ein Datenfehler im Generator. Derselbe Generator in mehreren Dateien ist erlaubt. Bei jedem Fehler schreibt `docs:gen` nichts.
- **Nur Quelltext wird verglichen.** Ein Generator liest versionierte Dateien (`package.json`, `.claude/`, `.mcp.json`, `.githooks/`, Workflows), nie lokale Konfiguration, Netz oder laufende Dienste. Gleiche Eingabe, gleiche Ausgabe, unabhängig von Locale, Zeilenende (CRLF/LF) und Dateisystem-Reihenfolge.
- **MCP ist nie Gate-Quelle.** Was ein MCP-Server liefert, ändert sich ohne Commit. Das Inventar liest nur die Konfiguration des Servers (`.mcp.json`), keine Header und keine Tokens, und fragt den Server nie ab.
- **Mermaid als Diagrammformat.** Diagramme in der Doku sind Mermaid-Text im Markdown (GitHub rendert ihn), keine Bilddateien. Ein Diagramm ist damit Quelltext, diffbar und durch einen Generator aus Daten ableitbar.
- **Ein Diagramm ist eine Regel (Diagramm == Regel).** Ein Diagramm, das eine ableitbare Struktur zeigt (Schichten, Abläufe, Ketten), wird generiert oder gegen seine Quelle geprüft. Ein von Hand gezeichnetes Diagramm über Ableitbares ist ein Drift-Bug. Die Folgetickets von #1354 führen das mit eigenen Generatoren ein.
- **Projektneutral.** Pfade, Ketten, Beschreibungen und CI-Gates stehen in der Config, nicht im Code; ein anderes Repo übernimmt Engine und Generatoren mit eigener Config.
- **Reichweite:** nur die konfigurierten Wurzeln (`README.md`, `docs/`). Ein Marker außerhalb wird nicht geprüft, das ist bewusst: so schreibt `docs:gen` nie in fremde Worktrees unter `.claude/worktrees`.

## Konsequenzen

- Wer ein Gate in `verify`/`verify:full` ergänzt oder entfernt, pflegt die Beschreibung in der Config und fährt `npm run docs:gen`; sonst ist `check:docgen` rot.
- Wer einen Subagenten, Skill, Hook oder MCP-Server ergänzt, fährt `npm run docs:gen`; das Inventar in der README zieht nach.
- Neue Generatoren sind je eine Datei unter `scripts/docs-gen/` plus ein Eintrag in der Registry. Engine und Config liegen unter `/scripts/docs-gen*` und sind Leitplanken-Pfade ([ADR 0014](0014-leitplanken-ohne-label-riegel.md)).
- Die Laufzeit wächst linear mit der Zahl der Markdown-Dateien, das Inventar mit dem Harness, nicht mit dem Spielinhalt.

## Re-Evaluierung

Wenn die Zahl der Generatoren so wächst, dass die Registry unübersichtlich wird (Richtwert: über zehn), oder wenn ein Generator Daten außerhalb des Repos braucht: neu entscheiden, ob dafür ein eigener, nicht blockierender Berichtsweg besser passt als ein Gate.

## Fortschreibung #1392 (2026-10-07): Mermaid-Frontmatter, Registry-Datei, ADR-Liste

- **Theme und Layout über Mermaid-Frontmatter.** Ein generiertes oder von Hand gepflegtes Diagramm setzt Theme, Layout und Farben im Frontmatter seines Mermaid-Codeblocks (`config:` mit `theme`, `layout`, `themeVariables`), nicht über `%%{init: …}%%`-Direktiven. Das Frontmatter ist Teil des Diagramm-Quelltexts und wandert mit dem Generator mit; GitHub rendert es in hell und dunkel.
- **Registry in eigener Datei, Config wählbar.** Die Generator-Registry liegt in `scripts/docs-gen/registry.mjs`; die Engine importiert nur diese Datei. Die Config ist per `--config <pfad>` wählbar (Standard `scripts/docs-gen/config.json`). Ein anderes Projekt übernimmt Engine und Generatoren und tauscht Registry und Config. Die geteilten Helfer (Markdown sammeln, Fence-Maske, Frontmatter, Kettenzerlegung) liegen in `scripts/docs-gen/markdown.mjs`; `check:docdrift` nutzt dieselben.
- **Generator `adr-liste`.** `docs/adr/README.md` trägt die ADR-Tabelle (Nummer, Titel, Status, Datum) als generierten Abschnitt; arc42 §9 verweist darauf, statt eine zweite Tabelle von Hand zu führen. Das Kopf-Format (`Status: **…** · Datum: JJJJ-MM-TT`) steht dort samt Vorlage.
- **Verschachtelte npm-Ketten** (ein Schritt, dessen Skript selbst eine `&&`-Kette ist) löst der Generator `gates` auf; ein Zyklus ist ein Fehler.
- **Zeitleiste ohne Filter (bewusst).** Spiel- und Harness-ADRs stehen gemischt in einer Tabelle; ein Filter bräuchte ein Pflichtfeld je ADR, und die bestehenden Köpfe nachzurüsten widerspräche „historisch, nie umschreiben“. **Re-Evaluierungs-Trigger:** überdecken Spiel-ADRs die Harness-Geschichte (Richtwert: mehr als 30 ADRs), entscheidet ein neuer ADR über ein Pflichtfeld `Kategorie` für neue ADRs.

## Fortschreibung #1370 (2026-10-07): Spiel-Diagramme aus Daten

- **Re-Evaluierung der Registry-Größe (zwölf Generatoren, Richtwert zehn):** das Gate bleibt. Die Registry ist nach Bereich gruppiert (Harness, Architektur, Spiel); ein eigener Berichtsweg wäre erst nötig, wenn ein Generator Daten außerhalb des Repos braucht.
- **Spiel-Generatoren sind projektspezifisch.** `save-versionen`, `quest-graph` und `quests-je-thema` kennen das Datenmodell von Kubernia (Migrations-Beschreibungen, Quests, Standplätze) und gehören nicht zum übertragbaren Kern aus Engine und Harness-Generatoren. Ihre Laufzeit wächst mit dem Inhalt.
- **Quest-Graph auf eigener Seite, je Region ein Diagramm.** Die Ausgabe wächst linear mit den Quests (Stardew-Scope), darum steht sie in `docs/module/content-questgraph.md` und nicht im `content.md`, das als Kontext geladen wird. Region ist die Karte des Standplatzes des Gebers; Kanten sind der Lernpfad (`quest-order.json`) und `requires`.
- **Wirtschafts-Loop entfällt.** Die Pod-Einnahmen sind Code (`incomeRate()`), nicht Daten; ein handgemaltes Diagramm ohne Gate gibt es nicht.
- **Quest-Zahlen der README** (`quests-je-thema`) kommen aus den Daten; ein Wächter-Test in `test/readme.test.ts` hält handgeschriebene Zählungen aus dem Lernpfad-Abschnitt.

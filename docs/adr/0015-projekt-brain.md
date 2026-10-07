# ADR 0015: Projekt-Brain — `docs/` nach Second-Brain-Prinzipien, token-sparsam und messbar

> Architecture Decision Record. Format: Kontext → Problem → Optionen → Entscheidung → Konsequenzen → Re-Evaluierung.
> Status: **akzeptiert** · Datum: 2026-10-07 · Tickets: #1205 (Umsetzung, Messung und dieser ADR); Folgearbeit #1098–#1100, #1123

## Status

**Akzeptiert.** Präzisiert [ADR 0013](0013-docs-als-agentengepflegtes-wiki.md) (`docs/` ist das agentengepflegte Wiki): gleicher Ort, gleiche Wissensarten, aber ein Name, ausformulierte Prinzipien, ein Token-Ziel und eine Messung. Die operative Regel steht, sobald #1098 sie einträgt, in [AGENTS.md](../../AGENTS.md); dieser ADR dokumentiert dann nur das *Warum*.

## Kontext

Die Maintainerin will `docs/` bewusst als **Projekt-Brain** aufbauen und so nennen, nach den Prinzipien eines Second Brains (kleine, einzeln auffindbare Seiten, Index vorn). Harte Randbedingung: **Token-Nutzung**, und die Wirkung muss in Langfuse bzw. im Transkript sichtbar sein. „Kein externes Brain“ aus ADR 0013 gilt unverändert; **Projekt-Brain meint ausschließlich `docs/` im Repo.** (Der Hook-Qualifier `[Brain]` in Langfuse-Spannennamen meint einen Bereich außerhalb des Repos, nicht dies.)

## Problem

Ein Brain lohnt sich nur, wenn es Tokens **spart**: weniger Suchen, weniger falsche Wege, weniger Rückfragen. Es kostet aber auch, wenn es gelesen wird (große Seiten bleiben im Cache-Read des restlichen Laufs) und wenn es gepflegt wird. Ohne Messung wüsste niemand, welche Seite überwiegt.

## Optionen

| Option | Bewertung |
|---|---|
| **A — Umzug/Umbenennung nach `brain/`** | Verworfen. Bricht Links, `check:docdrift`, Wächter und Verweise für einen Namen; der Begriff reicht. |
| **B — Begriff und Prinzipien auf `docs/`, Messung im versionierten Skript** (gewählt) | Kein Umbau, sofort wirksam; die Messung ist getestet und liest beide Quellen. |
| **C — Hook-Tagging im lokalen Plugin-Patch als Primärquelle** | Verworfen: unversioniert, User-Scope, mit jedem Plugin-Update weg. Bleibt Ergänzung (Spannenname `[Kubernia-Doku]`, siehe [model-routing.md](../model-routing.md#langfuse-hook-patch-pflegen-10841122)). |
| **D — Deny-Guard „Read statt cat“ für `docs/`** | Vorerst verworfen, nicht erledigt: Brain-Seiten werden überwiegend per Shell gelesen (Baseline vom 07.10.2026: in drei Läufen 40 Shell- gegen 3 `Read`-Zugriffe, siehe model-routing.md §5), und zwar vor allem von Subagenten (Umsetzer, Lenses). Ein Guard ändert das Hook-Verhalten für alle Agenten, und ungemessen ist, ob die Konvention allein in den Subagenten-Prompts (#1099) schon reicht; erst das, der Guard bleibt Re-Evaluierungs-Option. Der ältere Befund „664 Bash- gegen 18 Read-Calls“ ist ein Stand vom 29.09.2026. |
| **E — Frontmatter (`description`) je Seite** | Verworfen: doppelt den „wann lesen“-Halbsatz der Landkarte und driftet; die Landkarte bleibt die einzige Beschreibung. |

## Entscheidung

1. **Begriff:** *Projekt-Brain* = `docs/` plus die Landkarte [`docs/referenz/anlaufstellen.md`](../referenz/anlaufstellen.md) als Index. Dateinamen und Orte bleiben. Neue Texte sagen „Projekt-Brain“, Altdokumente bleiben unverändert.
2. **Prinzipien:**
   - *Atomare Seiten:* eine Seite, ein Thema, sprechender ASCII-Dateiname.
   - *Index zuerst:* die Landkarte nennt je Seite einen Halbsatz „wann lesen“. Der Agent liest Index, dann gezielt eine Seite, keine breite Suche.
   - *Lesen per `Read`, große Seiten abschnittsweise* (Überschrift greppen, dann `Read` mit `offset`/`limit`). Die Konvention steht im Kopf der Landkarte.
   - *Nichts always-loaded:* AGENTS.md trägt nur einen Zeiger auf den Index; `check:contextsize` bleibt der Riegel.
   - *Größenschwelle:* 25.000 Zeichen je Brain-Seite (unter dem AGENTS.md-Budget von 28k), darüber wird aufgeteilt; Grund sind die Cache-Read-Kosten jeder gelesenen Seite. Der Wächter kommt mit #1100 (in `check:contextsize`, Bestand per `ALLOWLIST` mit Split-Zeilen).
   - *Selbstpflege:* Pflegeschritt am Ticket-Ende im selben PR (#1099), Erreichbarkeits-Wächter (#1100), „fachlich geprüft am“ (#1111).
   - *Wissensarten* unverändert wie ADR 0013 Punkt 1.
3. **Messung:** `node scripts/token-baseline.mjs` weist je Lauf die Zeile `Projekt-Brain:` aus (Definition: [model-routing.md §5](../model-routing.md#projekt-brain-kennzahlen-1205)): gelesene Brain-Seiten mit Tokens, Such-Calls mit Tokens, Tokens der Recherche-Subagenten, Calls bis zum ersten Edit, Brain-Schreibzugriffe und Brain-Seiten im PR. Quelle sind Transkript und Langfuse-`TOOL`-Observations, nach derselben Logik (Ergebnisgrößen je nach Serialisierung leicht verschieden) (`scripts/brain-metrics.mjs`). Shell-Lesezugriffe (`cat`, `sed` …) auf `docs/` zählt das Skript mit.
4. **Erfolgskriterium:** Nach #1099 werden 3–5 Läufe gleicher Art gegen die Baseline in model-routing.md §5 gestellt. Erfolg nur, wenn die **Recherche-Last** (Such-Calls und Recherche-Subagenten-Tokens) und die **Calls bis zum ersten Edit** sinken und die Loop-Kennzahlen (CI-Fix, Review-Runden, Rückfragen) nicht schlechter werden. **Pflegekosten** (Marker `pflege:` am Pflegeschritt, Phase „Pflege“) werden je Ticket gegen die Ersparnis gestellt; überwiegen sie, wird der Pflegeschritt verschlankt, nicht das Brain aufgebläht. Der Vergleich läuft über Punkt 5 „Wirkung“ der Checkliste „Langfuse-Status überprüfen“.
5. **Langfuse-Sicht:** Dashboard und Score je Ticket-Lauf gehören zu #1123 und nutzen die Definition aus Punkt 3. Der Spannenname `Tool: Read [Kubernia-Doku]` (lokaler Hook-Patch) umfasst auch AGENTS.md und Skills; die exakte `docs/`-Zählung liefert das Skript.

## Konsequenzen

- Kein Umbau; Baseline und Messung stehen vor dem Pflegeschritt, damit dessen Wirkung vergleichbar ist.
- #1098–#1100 bleiben, werden angepasst: #1098 nennt `docs/` das Projekt-Brain, #1099 setzt den Marker `pflege:`, #1100 ergänzt die Größenschwelle. Heute über 25k: `agent-harness.md`, `model-routing.md`, `arc42-architektur.md`, `agent-harness-faq.md`.
- Grenzen der Messung: Tokens sind Zeichen/4 (Größenordnung); Shell-Schreibzugriffe (`sed -i`, Skripte) sieht das Tool-Zählen nicht, darum ist die Seitenzahl im PR die verlässliche Pflege-Kennzahl.

## Re-Evaluierung

- Die Recherche-Last sinkt nach 3–5 Läufen gleicher Art nicht.
- Die Pflegekosten übersteigen die Ersparnis.
- Die Shell-Lesezugriffe auf `docs/` sinken nach der Prompt-Konvention (#1099) nicht unter die Baseline in model-routing.md §5: dann den Guard aus Option D bewerten.
- Das Brain wächst über 60 Seiten (Trigger aus ADR 0013).

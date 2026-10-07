# ADR 0020: Architekturmodell LikeC4 — zweite Ableitung derselben SSOTs

> Architecture Decision Record. Format: Kontext → Problem → Optionen → Entscheidung → Konsequenzen → Re-Evaluierung.
> Status: **akzeptiert** · Datum: 2026-10-08 · Ticket: #1420 (Teil von #1354, Lebende Doku)

> Präzisiert [ADR 0017](0017-lebende-doku-generierte-abschnitte.md) (Diagramm == Regel): ein Modell, das Ableitbares zeigt, wird gegen seine Quelle geprüft, hier statt generiert.

## Status

**Akzeptiert.** Das Modell liegt unter [`docs/architektur/`](../architektur/spiel.c4), der Wächter ist [`scripts/check-c4.mjs`](../../scripts/check-c4.mjs) (Gate `check:c4` in `verify`), die Beschreibung steht in [docs/agent-harness.md](../agent-harness.md#architekturmodell-wächter-npm-run-checkc4-1420).

## Kontext

Die Schichtdiagramme der Doku entstehen als Mermaid aus `SCHICHT_MODELL` (`scripts/layers.cjs`) und aus dem Ist von dependency-cruiser ([ADR 0017](0017-lebende-doku-generierte-abschnitte.md)). Für Kontext, Container und Hauptmodule gab es nur handgezeichnete C4-Diagramme in arc42 §5. Ein C4-Modell in LikeC4 liefert navigierbare Sichten aus einer Quelle; die Frage ist, wie es ehrlich bleibt.

## Optionen

| Option | Bewertung |
|---|---|
| **Mermaid-Export des LikeC4-Modells ersetzt die Generatoren** | Der Export kennt nur Flowcharts (Sequenz und Schleifen gingen verloren), kein `config:`-Frontmatter (Fortschreibung #1392 von ADR 0017), die Platzhalter-Prüfung gegen die Quellen entfiele, das Schicht-Soll käme aus einem handgeschriebenen Modell statt aus `layers.cjs`, und das Ist (dependency-cruiser) kann LikeC4 nicht liefern. Verworfen. |
| **Ungeprüftes Modell** | Driftet still, genau die Fehlklasse von ADR 0017. Verworfen. |
| **Zweite Ableitung mit Gate `check:c4` (gewählt)** | Eine Quelle, zwei Ableitungen: Generatoren und Modell hängen an derselben SSOT, `check:c4` bindet alles Ableitbare. |

## Entscheidung

Entscheidung: **LikeC4-Modell als zweite Ableitung derselben SSOTs, geprüft von `check:c4` in `verify`**, weil die Schicht-Regeln, die Top-Level-Module und die Kanten aus `scripts/layers.cjs` und `src/` ableitbar sind und ein Gate die Drift sofort rot macht.

- **Bindung über Art + Titel**, nicht über Metadaten: `schicht` und `bibliothek` an die Labels von `SCHICHT_MODELL`, `modul` an die Top-Level-Einträge von `src/` unter der Schicht, die `schichtVon` liefert. Eine Art, die weder gebunden noch als Erzählung (`person`, `system`, `container`, `datenspeicher`) gelistet ist, ist rot (fail-closed). Beziehungen mit einem Modul-Ende sind rot, weil das Ist nur dependency-cruiser liefert.
- **Modul-Granularität = Top-Level von `src/`**: sie wächst bei Stardew-Größe nicht mit dem Inhalt. Ein View-Deckel (`architektur.maxKnotenJeView`, Standard 25, nur senken) hält die Hauptmodule-View lesbar.
- **CLI für `validate` und `format --check`** (prüft auch Layout-Drift), die Model-API nur für den Abgleich, gekapselt in einem Adapter. `check:c4` ist ein einzelnes Node-Skript, das die CLI als Kindprozess ruft: eine Kette mit Rohbefehlen in `verify` lässt `check:docdrift` und die Gate-Tabelle zerfallen.
- **Keine SSOT-Zahlen und keine `technology`-Kopien** an gebundenen Elementen (ungeprüfte Kopien).
- **Exakter Pin `likec4@1.59.4`**, weil der Formatter zwischen Minor-Versionen wechseln kann. Optik: Standard-Theme; die Palette gehört zur Doku-Seite (#1372).

## Konsequenzen

- Wer einen Top-Level-Ordner oder eine `.ts`-Datei unter `src/` anlegt, ergänzt das Modul in `docs/architektur/spiel.c4` unter der Schicht, die `layers.cjs` vorgibt; sonst ist `check:c4` rot (Meldung nennt Datei, Element und Fix).
- Ein likec4-Bump kann den Formatter ändern: `npm run c4:format`. `likec4` zieht eine eigene Playwright-Version (1.60) verschachtelt mit; die top-level-Version von `@playwright/test` bleibt.
- `verify` wird um rund 3 bis 4 Sekunden länger. likec4 verlangt Node ab 22.22.3; `engines.node` in der Wurzel-`package.json` steht darum auf `>=22.22.3`, damit der SessionStart-Hook ein zu altes lokales Node meldet.
- Skript und Config sind Leitplanken-Pfade ([ADR 0014](0014-leitplanken-ohne-label-riegel.md)).

## Re-Evaluierung

Neu entscheiden, wenn der LikeC4-Export Sequenzdiagramme und Frontmatter lernt (dann kann der Export Generatoren ersetzen) oder wenn der View-Deckel reißt.

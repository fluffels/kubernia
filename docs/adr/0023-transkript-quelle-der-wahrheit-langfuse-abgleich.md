# ADR 0023: Das Transkript ist die Quelle der Wahrheit, Langfuse wird abgeglichen

> Architecture Decision Record. Format: Kontext → Entscheidung → Konsequenzen → Re-Evaluierung.
> Status: **akzeptiert** · Datum: 2026-10-09 · Ticket: #1578

## Status

**Akzeptiert.** Präzisiert [ADR 0019](0019-langfuse-plugin-im-user-scope.md) (das Plugin bleibt im User-Scope aktiv, ADR 0019 selbst bleibt unverändert): der Hook des Plugins ist weiter der Erfassungsweg, aber nicht mehr die Vollständigkeitsgarantie.

## Kontext

Die Messung (Token, Kosten, Läufe je Rolle) hängt an Langfuse. Der gepatchte Hook des Plugins `langfuse-observability` verliert aber Calls: Hintergrund-Subagenten, ein zurückgehaltener letzter Turn und Sessions ohne `SessionEnd`. Die Auswertung #1517 fand 28 von 38 geprüften Sessions mit Differenz zwischen Transkript und Langfuse. Die native OTel-Ausgabe von Claude Code ersetzt den Hook nicht, weil Langfuse aus ihr keine Usage übernimmt (Entscheidung 2026-10-09 in [Hook-Patch › Alternative ohne Patch](../langfuse-hook-patch.md#alternative-ohne-patch)).

## Entscheidung

- **Das lokale Claude-Code-Transkript ist die Quelle der Wahrheit** für Calls, Tokens und Kosten; **Langfuse ist die Sicht darauf.** Was dort fehlt, wird aus dem Transkript nachgeliefert, nicht der Hook weiter gepatcht.
- Der Abgleich läuft **automatisch und idempotent** an `SessionStart` und `SessionEnd` (nie an `Stop`), losgelöst vom Claude-Code-Prozess, mit Lock und Log. Idempotenz stammt aus deterministischen Beobachtungs-IDs und der Frage „Ist zuerst“ (Ledger nur als Brücke über den Ingestion-Verzug); ein kaputtes Ledger kostet höchstens Abfragen.
- **Dubletten werden nur gemeldet**, nie gelöscht oder korrigiert: das Schreiben in fremde Daten wäre schwerer rückgängig zu machen als eine gemeldete Doppelzählung.
- Der Zugang kommt für den Hook aus `~/.langfuse-secret` (Secret-Key) und den Plugin-Optionen der User-Settings (öffentlicher Key, URL), nicht aus einer Windows-Benutzervariable (unter nativem Windows sähe sie jede Agenten-Shell). Nur der Hook-Einstieg liest sie.

## Konsequenzen

- Ein Trace-Verlust des Hooks ist kein Datenverlust mehr; die Checkliste „Langfuse-Status überprüfen“ prüft den Abgleich (Log, `erfassung`-Score) statt Sessions von Hand zu zählen.
- Die Kette `langfuse-abgleich-hook`, `langfuse-nachliefern`, `langfuse-otlp`, `langfuse-abgleich`, `langfuse-api`, `preise`, `transkript-calls` steht unter Leitplanken-Schutz (`.github/protected-paths.json`, CODEOWNERS); ein Wächter in `test/harness/langfuse-erfassung.test.ts` hält die Verdrahtung fest.
- Grenzen und Betrieb: [Hook-Patch › Abgleich als Garantie](../langfuse-hook-patch.md#abgleich-als-garantie-1578).

## Re-Evaluierung

Zeigt der Score `erfassung_hook` (Anteil, den der Hook allein erfasste) in drei Status-Läufen in Folge den Wert 1, ist der Hook wieder verlässlich: dann den Abgleich auf reines Prüfen (`langfuse-abgleich.mjs --pruefen`) zurückbauen und diesen ADR per neuem ADR ablösen.

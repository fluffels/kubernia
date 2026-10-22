# Fortschreibung #1860 (2026-10-22): Fortschreibungen als eigene Dateien

Ergänzt [ADR 0013](../0013-docs-als-agentengepflegtes-wiki.md): ein ADR bleibt historisch, Nachträge zu einer laufenden Entscheidung stehen künftig nicht mehr als `## Fortschreibung`-Abschnitt am Ende des ADR, sondern als eigene Datei unter `docs/adr/fortschreibungen/`.

## Kontext

- **Konflikte:** parallele PRs hängten ihren Abschnitt an dasselbe Dateiende; Git meldete jedes Mal einen Merge-Konflikt, obwohl beide Seiten nur Neues anfügten (#1857, #1848). Die Auflösung kostete je PR einen Umsetzer-Durchgang samt erneutem Review.
- **Reihenfolge:** die Abschnitte landeten in Merge-Reihenfolge statt in Datumsreihenfolge, ein ADR las sich nicht mehr chronologisch (#1711, #1710). ADR 0022 trägt den Bestand (über 30 Abschnitte); er bleibt unverändert, weil mehrere Fortschreibungen dasselbe Datum haben und ein Umsortieren das Historische nachträglich umschriebe.

## Entscheidung

Entscheidung: je Fortschreibung eine Datei `docs/adr/fortschreibungen/<NNNN>-<ticket>-<slug>.md`, weil zwei PRs dann verschiedene Dateien anlegen und nichts mehr kollidiert; die Reihenfolge ergibt sich aus Datum und Ticketnummer im Namen, nicht aus der Position.

- **Form:** erste Zeile `# Fortschreibung #<nr>[/#<nr>…] (JJJJ-MM-TT): <Titel>`, `<nr>` ist die Ticketnummer aus dem Dateinamen; das ADR `<NNNN>-*.md` muss existieren und einen Zeiger `fortschreibungen/<NNNN>-` tragen (ein Abschnitt „Weitere Fortschreibungen (als Dateien)“ am Ende).
- **Bestand eingefroren:** die angehängten `## Fortschreibung`-Abschnitte bleiben, wo sie sind. Ein Ratchet in `test/harness/adr-fortschreibung.test.ts` erlaubt je ADR höchstens den heutigen Bestand (neue ADRs: 0); ein Plus ist rot, ein Minus verlangt das Senken der Zahl.
- **Neue ADRs** bekommen ihre Fortschreibungen von Anfang an als Dateien.

## Verworfen

- **`merge=union` in `.gitattributes`:** löst nur Textkonflikte am Dateiende mechanisch, lässt die Reihenfolge-Drift bestehen.
- **Reihenfolge-Wächter (Datum aufsteigend im ADR):** erzwänge das Umsortieren historischer Abschnitte und löste das Konfliktproblem nicht.

## Folgen

- Generatoren (`scripts/docs-gen/adr.mjs`, Zeitleiste) lesen nur Dateien direkt unter `docs/adr/` und übergehen den Unterordner; die ADR-Liste bleibt unverändert.
- Eine Fortschreibung, die den Status des ADR ändert, aktualisiert weiterhin dessen Kopfzeile und die Status-Spalte im Index.

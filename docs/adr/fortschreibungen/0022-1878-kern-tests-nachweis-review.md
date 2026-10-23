# Fortschreibung #1878 (2026-10-23): Kern-Tests Nachweis und Review ohne Projektliterale (F10, Teil 6c)

Ergänzt [ADR 0022](../0022-dark-factory-kern-und-verteilung.md) (F10, Teil 6c, Cluster Nachweis und Review) und [Fortschreibung #1877](0022-1877-kern-tests-board-tickets.md); die Fortschreibung steht als Datei (siehe [Fortschreibung zu ADR 0013](0013-1860-fortschreibungen-als-dateien.md)).

- **Entscheidung (Cluster):** `nachweis-lib.test.ts` gehört zum Cluster, weil `review-nachweis` und `abnahme-nachweis` auf ihm aufbauen; `quote-folge` und `review-staffel` tragen keine Literale und stehen ohne Umbau in `LITERALFREIE_KERN_TESTS`.
- **Entscheidung (Typ und Owner):** `test/support/fremd-config.ts` exportiert den gemeinsamen Typ `ProjektConfig` (statt `FremdConfig`) und `FREMD_OWNER`; `kern-reinheit.test.ts` leitet seinen losen Eingabetyp `BegriffsConfig` daraus ab, ein eigenes Interface entfällt.
- **Entscheidung (Kindprozess):** die CLIs der Wächter bekommen `--config test/fixtures/projekt-fremd.json`; je Skript bleibt ein Standardpfad-Test ohne `--config`, dessen Erwartung aus `projektConfig()` kommt.
- **Entscheidung (Fixture-Texte):** die wörtliche Squash-Message in `review-nachweis.test.ts` ist eine Funktion der Commit-Zeilen und des Planers; ihr übriger Text bleibt wörtlich.
- **Grenzen:** der Tausch von `.factory/projekt.json` gegen die Fremd-Config (einmalige Probe, Ergebnis im PR) lässt alle 9 Dateien grün, sobald die Fremd-Config die Blöcke `sprache` und `skills` der echten Config trägt; die Fixture `projekt-fremd.json` trägt sie nicht, die Tests über `echteSprache()` und die Skill-Platzhalter scheitern ohne sie.

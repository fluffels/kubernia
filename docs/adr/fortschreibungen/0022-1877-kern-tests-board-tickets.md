# Fortschreibung #1877 (2026-10-23): Kern-Tests Board und Tickets ohne Projektliterale (F10, Teil 6b)

Ergänzt [ADR 0022](../0022-dark-factory-kern-und-verteilung.md) (F10, Teil 6b, Cluster Board und Tickets) und [Fortschreibung #1876](0022-1876-fremd-config.md); die Fortschreibung steht als Datei (siehe [Fortschreibung zu ADR 0013](0013-1860-fortschreibungen-als-dateien.md)).

- **Entscheidung (echte Projektdateien):** ein Test, der echte Projektdateien liest (AGENTS.md, Skill, Skriptquelle) oder eine Modulkonstante prüft, die beim Import aus der Projekt-Config entsteht (`REPO`), nimmt die Erwartung aus `projektConfig()`; die gelesenen Texte tragen die Projektwerte. Dasselbe gilt für Gegenproben, die zeigen, dass das eigene Präfix des Projekts unter einer fremden Config nicht durchschlägt (`lebenszyklus-namen`).
- **Entscheidung (Kindprozess):** ein Kindprozess im Temp-Repo bekommt die Fremd-Config als `.factory/projekt.json` kopiert und liest sie wie die Projekt-Config.
- **Entscheidung (Standardpfade):** je Standardpfad `namen = ladeTicketNamen()`, den die umgebauten Tests vorher nebenbei trafen (`ticketAusRef`, `belegteNummern`, `pfadErlaubt`, `sammle` und `raeumeAuf` in `claims-pruefen`), bleibt ein Test ohne übergebene `namen`, dessen Erwartung aus `projektConfig()` kommt; sonst verlöre der Umbau die Abdeckung des Standardpfads.
- **Entscheidung (Rückfall-Prüfung):** sie läuft über jeden Kern-Test ohne Baseline-Eintrag und ist aus der Baseline abgeleitet; die geschlossene Liste `LITERALFREIE_KERN_TESTS` bleibt als Anker.
- **Entscheidung (Testdaten):** Item-IDs heißen `ITEM_…`, Temp-Präfixe sind neutral, der Bereichs-Label-Aufbau `area:<x>` in `spezifikation.mjs` ist fest und wird mit `area:demo` bedient.
- **Grenzen:** der Tausch von `.factory/projekt.json` gegen die Fremd-Config (einmalige Probe, Ergebnis im PR) lässt 17 von 18 Dateien grün; `harness/sammelticket.test.ts` bleibt rot, weil er echte Projekttexte liest.

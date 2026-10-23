# Fortschreibung #1899 (2026-10-23): Golden der Messskripte mit der Fremd-Config (F10, Teil 6d-2)

Ergänzt [ADR 0022](../0022-dark-factory-kern-und-verteilung.md) (F10, Teil 6d, Messskripte und Transkripte) und die Golden-Entscheidung aus F3 (#1745); die Fortschreibung steht als Datei (siehe [Fortschreibung zu ADR 0013](0013-1860-fortschreibungen-als-dateien.md)).

- **Entscheidung (Golden):** `test/fixtures/mess-golden.json` pinnt die Ausgaben der Messskripte für die Fremd-Config `FREMD` statt für dieses Projekt. Die Ausgabeform hängt nur über die Namen (Agenten, Worktree- und Branch-Präfix, Ticket-Skill, Repo-Name) von der Config ab; ein Golden mit Projektnamen wäre selbst ein Projektliteral im Kern-Test. Die Kontinuität für dieses Projekt belegte einmalig die Abbildung der alten Datei auf die Fremd-Namen (Ergebnis im PR).
- **Entscheidung (Neuerzeugung):** nur über `messGoldenFaelle(S, FREMD)` aus einem Wegwerf-Skript (Weg im Kopf von `test/support/mess-golden-faelle.mjs`); einen Schreibmodus im Test gibt es bewusst nicht, er wäre ein Weg, ein rotes Golden grün zu schreiben.
- **Entscheidung (neutral oder `FREMD`):** `FREMD` dort, wo der Code den Wert aus der Config deutet (Agentennamen, Präfixe, Skill, Repo-Schlüssel); neutrale Daten (`wt-1`, `mess-1745-`) dort, wo er den Wert nicht deutet.
- **Grenze:** unterschiedlich lange Namen verschieben Längenmaße: `zz-lens` ist kürzer als der frühere Agentenname, darum liegt im Kontext-Golden `wachstum.eingabe` um 1 niedriger (`rest` um 1 höher); das ist kein Verhaltensunterschied.

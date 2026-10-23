# Fortschreibung #1888 (2026-10-23): Härtungs-Takt nach Füllstand

Ergänzt [ADR 0016](../0016-langfuse-takt-woechentlich.md) und löst dessen [Fortschreibung #1787](../0016-langfuse-takt-woechentlich.md#fortschreibung-1787-2026-10-19-härtungs-takt-nach-fünf-ticket-merges-jeder-art) ab: der Auslöser des Harness-Sammeltickets zählt nicht mehr Ticket-Merges, sondern den Füllstand des Sammeltickets selbst.

## Kontext

- **Falsche Messgröße:** die Zahl der Merges seit dem letzten Abschluss sagt nichts darüber, ob im Sammelticket etwas zu tun ist. Änderungswunsch der Maintainerin: das Sammelticket füllt sich still und rückt erst nach vorn, wenn genug Befunde da sind; dann ist es das nächste Ticket, wie ein Notfall.
- **Zeilengrenze unnötig:** der Umfang je Lauf ist durch die Gruppen-Umsetzer abgefangen ([ADR 0026](../0026-sammelticket-gruppen.md)); eine Obergrenze für Zeilen ist nicht nötig, eine Untergrenze für den Start ist es.

## Entscheidung

Entscheidung: das ungeclaimte Harness-Sammelticket kommt ab 10 Befund-Kommentaren hinter den Kopf des Factory-Boards und wird erst ab dann von der Auswahl genommen, weil der Füllstand direkt misst, ob sich ein Lauf lohnt (`HARNESS_TAKT_KOMMENTARE = 10` in `scripts/spielquote-lib.mjs`).

- **Zählweise:** gezählt werden Kommentare vertrauter Nicht-Bot-Autoren (`befundKommentare`: `istVertraut` aus `fremdtext-lib.mjs`, Login ohne `[bot]`); Kommentare ohne Autor, fremde und Bot-Kommentare zählen nicht. Zeilen je Kommentar sind beliebig, ein Kommentar kann mehrere Befunde tragen.
- **Spitze:** „vorn“ heißt direkt hinter dem zusammenhängenden Kopf (Status-, Notfall-, Dependabot-, Forum-Ticket); die Grundposition laut AGENTS.md bleibt, die Selbstkorrektur (nur nach vorn) ebenso. Ein geclaimtes Sammelticket fasst der Takt nicht an; solange ein Vorgänger in Arbeit ist, holt er das Folgeticket nicht.
- **Still liegen unter der Schwelle** leistet die Auswahl, nicht der Takt: `naechstes-ticket` überspringt das ungeclaimte Harness-Sammelticket unter der Schwelle mit dem Grund `füllt sich (k/10 Befund-Kommentare)`; `--ticket <nr>` umgeht das. Die Kommentare lädt es nur, wenn dieses Ticket Kandidat ist.
- **Fail-closed:** lassen sich die Kommentare nicht laden, bleibt der Takt bei `nichts` (Warnung im Log, Lauf grün) und die Auswahl überspringt das Sammelticket mit `Füllstand nicht prüfbar`; der nächste Lauf versucht es erneut.
- **Unverändert:** die Spielquote 1:3 (Kennzahl, nicht Seitenwahl) und `--bereich spiel`. Das Selbst-Audit misst weiter die Merges seit dem letzten Sammelticket-Abschluss, aber nur als Messung ohne Soll: eine Abweichung ab einer Merge-Zahl widerspräche dem gewollten Stilliegen und füllte das Sammelticket über die Abweichungs-Zeile künstlich auf. `--bereich spiel` bleibt unverändert, weil die Spielquote Kennzahl und nicht Seitenwahl ist; das Sammelticket kommt nur dann an die Spitze, wenn der Lauf den Bereich `agentic` wählt (die Wahl des Bereichs steht beim Aufruf, [Spielquote](../../harness-glossar.md)).

## Verworfen

- **Merge-Zahl beibehalten:** misst die Aktivität des Boards, nicht den Bedarf des Sammeltickets (siehe Kontext).
- **Zeilenzahl statt Kommentarzahl:** Zeilen stehen im Kommentartext, ihr Zählen wäre Parsing von Fremdtext; die Kommentarzahl ist ohne Parsing zählbar und fasst Zusammengehöriges bereits zusammen.

## Folgen

- Das Sammelticket kann länger als eine Woche liegen, wenn wenig auffällt; das ist gewollt. Ein Notfall-Befund geht als eigenes Issue.
- Die Doku nennt die Schwelle an mehreren Stellen ([ticket-reihenfolge](../../ticket-reihenfolge.md#sammelticket-mechanik), Workflow-Kommentar, Glossar, Befehle, Anlaufstellen); ein Wächter in `test/board-takt.test.ts` bindet die Zahl an die Konstante.

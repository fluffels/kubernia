# ADR 0016: Langfuse-Takt — wöchentlicher Workflow statt Board-Position

> Architecture Decision Record. Format: Kontext → Problem → Optionen → Recherche → Entscheidung → Konsequenzen → Re-Evaluierung.
> Status: **akzeptiert** · Datum: 2026-10-07 · Ticket: #1351 (Teil von #1350, Selbstoptimierender Harness)

## Status

**Akzeptiert.** Löst den Takt aus #1293 ab („Nachfolger auf Position 20“, siehe [ADR 0012](0012-harness-autonomie-audit-spur.md)). Die operative Mechanik steht in [docs/ticket-reihenfolge.md](../ticket-reihenfolge.md#wiederkehrendes-ticket-langfuse-status-überprüfen-1293), die Checkliste in [docs/model-routing.md](../model-routing.md#langfuse-status-überprüfen-1293).

## Kontext

Das Status-Ticket „Langfuse-Status überprüfen“ sollte „etwa alle 20 Tickets einmal“ drankommen, indem der Abschluss des alten ein neues auf Board-Position 20 anlegte. #1304 wurde auf Position 20 angelegt und stand am Folgetag auf 21: jedes „prioritätsmäßig einsortierte“ Ticket davor schiebt es nach unten. Der Takt hing an einer Größe, die jeder andere Agent verändert. Dazu waren die Folgetickets „Langfuse-Folgen aus #<nr>“ Einweg: Befunde zwischen zwei Läufen hatten kein festes Ziel.

## Optionen

| Option | Bewertung |
|---|---|
| **Board-Position** (Status quo) | Driftet, siehe Kontext. Verworfen. |
| **Ticket-Zahl** (z. B. alle 10 gemergten Tickets) | Koppelt an Aktivität, aber braucht einen Trigger bei jedem Merge oder einen gespeicherten Zähler, der sich bei parallelen Agenten überschreiben kann. Ohne Zähler aus `git log` ableitbar, doch die Fenster werden ungleich lang, und in der Harness-Phase mit hohem Durchsatz liefe die Auswertung gerade dann am häufigsten. |
| **Größe** (Sammelticket ab N Zeilen vorziehen) | Das Status-Ticket hat keine Zeilen; für das Langfuse-Sammelticket holt es der Status-Lauf nach oben. Als alleiniger Auslöser ungeeignet. |
| **Zeit** (Cron, wöchentlich) | Einfach, ohne Agenten-Tokens, deterministisch, testbar. Läuft auch ohne Aktivität leer. |
| **Zeit + Aktivitäts-Untergrenze (gewählt)** | Wöchentlicher Cron, aber nur anlegen, wenn seit dem letzten Abschluss mindestens 5 Commits auf `main` liegen. |

## Recherche

- **Renovate** (`lockFileMaintenance`, „before 4am on monday … to achieve once-per-week semantics“) und sein Dependency-Dashboard als **ein** lebendes Übersichts-Issue: wiederkehrende Wartung läuft in der Praxis zeitgesteuert, wöchentlich, mit einem festen Ziel-Issue. <https://docs.renovatebot.com/configuration-options/>
- **GitHub Agentic Workflows** fahren Status-Berichte als wöchentliche, zeitlich gestreute Läufe. <https://github.github.com/gh-aw/examples/scheduled>
- **Google SRE, „Eliminating Toil“**: operative Arbeit unter 50 % der Zeit halten. Übertragen: der Wartungsanteil des Harness wird gedeckelt (hier höchstens ein Status-Ticket und ein Sammelticket je Woche), statt mit dem Durchsatz zu wachsen; passt zum Ziel aus ADR 0012, den Harness-Anteil an der Arbeit zu begrenzen. <https://sre.google/sre-book/eliminating-toil/>
- **GitHub Actions, Concurrency**: je Group höchstens ein laufender und ein wartender Run, `cancel-in-progress: false` bricht nichts ab. <https://docs.github.com/en/actions/writing-workflows/choosing-what-your-workflow-does/control-the-concurrency-of-workflows-and-jobs>
- **GitHub Actions, Schedule**: Läufe können sich um Stunden verzögern, und in öffentlichen Repos wird der Schedule nach 60 Tagen ohne Aktivität deaktiviert. <https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows>

## Entscheidung

Entscheidung: **wöchentlicher Cron (montags 05:17 UTC) plus `workflow_dispatch`, mit Aktivitäts-Untergrenze von 5 Commits auf `main` seit dem Abschluss des Vorgängers**, weil

1. das Epic #1350 gegen das **Wochenlimit** des Abos misst; Wochenbudget und Trend gegen die Vorwoche brauchen gleich lange Kalenderwochen;
2. der Takt unabhängig vom Durchsatz kostet und so den Harness-Anteil deckelt;
3. kein Zähler gespeichert wird: Anzahl und Fenster werden bei jedem Lauf aus der Commit-Liste von `main` abgeleitet, das Ergebnis ist idempotent und springt nicht;
4. Doppel-Tickets zwei Absicherungen haben: die Concurrency-Group `langfuse-takt` serialisiert Läufe, und die Titelprüfung auf der REST-Liste der offenen Issues (nicht die Search-API, deren Index verzögert ist) sieht das Ticket des ersten Laufs.

Weitere Festlegungen:

- Findet der Lauf mehrere offene Status-Tickets, warnt er und arbeitet mit dem ältesten weiter; er schließt nichts selbst (kein destruktiver Automatismus).
- Scheitert die Board-Mutation, endet der Lauf mit Exit 1; die Wiederholung ist idempotent. Fehlt `PROJECT_TOKEN`, warnt er nur.
- Die Regel „Nachfolger auf Position 20“ entfällt. Agenten legen das Status-Ticket nicht mehr selbst an.
- Das Sammelticket „Langfuse-Befunde (gesammelt)“ ersetzt die Einweg-Folgetickets (Mechanik in `docs/ticket-reihenfolge.md`). Der Abschluss eines Status-Laufs schiebt es nach oben.
- Wächter: [`test/harness/langfuse-erfassung.test.ts`](../../test/harness/langfuse-erfassung.test.ts) (Workflow-Bedingungen, Doku) und [`test/langfuse-takt.test.ts`](../../test/langfuse-takt.test.ts) (Entscheidungslogik).

## Konsequenzen

**Positiv:** keine Drift mehr, keine Agenten-Tokens für den Takt, deterministisch und testbar; der Harness-Anteil ist auf ein Status-Ticket plus ein Sammelticket je Woche gedeckelt, in langsamen Phasen zusätzlich durch die Untergrenze gebremst.

**Negativ / Trade-offs**
- Cron-Läufe kommen verzögert (Stunden); für einen Wochentakt egal.
- Das Status-Ticket steht am Montag über allem anderen, auch über einem älteren 🚨- oder Forum-Ticket und über dem ungeclaimten Harness-Sammelticket: es ist die benannte Ausnahme von „nie vor das ungeclaimte Sammelticket" (AGENTS.md, `ticket-reihenfolge.md`), weil das Ticket Befunde für das Langfuse-Sammelticket liefert und dieses nach dem Harness-Sammelticket drankommt. „Roter `main` geht vor“ gilt unabhängig von der Position.
- Die Untergrenze zählt Commits auf `main`, nicht nur Ticket-Merges (auch Dependabot).

## Re-Evaluierung

- Drei Läufe in Folge ohne Befund: auf zweiwöchentlich lockern.
- Das Status-Ticket ist beim nächsten Lauf noch ungeclaimt: der Takt ist zu dicht oder die Position zu schwach.
- Ein Status-Lauf kostet mehr als 5 % des Wochenbudgets: Checkliste kürzen.
- GitHub deaktiviert den Schedule nach 60 Tagen Inaktivität: `gh workflow enable`; dann den Takt neu bewerten.
- Ein natives Routine-/Scheduling-Feature von Claude Code ersetzt den Workflow (Release-Watch, #1350).

## Fortschreibung #1349 (2026-10-07): Auslöser nach Aktivität, Harness-Sammelticket

Bei rund 15 Merges am Tag wäre „wöchentlich“ nur alle 70 bis 100 Tickets ein Lauf. Der Workflow läuft deshalb zusätzlich bei jedem Push auf `main`:

- **Status-Ticket:** ein Push legt das Ticket an bzw. holt es nach oben, sobald seit dem Abschluss des Vorgängers mindestens 8 Ticket-Merges (ohne Bots) dazukamen; weniger tut er nichts. Der Cron bleibt bei 5 Commits (`MIN_MERGES`). Ein Ticket, das schon im Kopf des Boards steht, wird nicht erneut bewegt. Das Status-Ticket darf wie bisher an die Spitze (die benannte Ausnahme oben); nur das Harness-Sammelticket bleibt hinter dem Kopf.
- **Harness-Sammelticket:** derselbe Lauf holt das ungeclaimte „Harness-Härtung (gesammelt)“ nach 5 Ticket-Merges seit dem Abschluss des letzten Sammeltickets direkt hinter den Kopf (Status-, 🚨-, Dependabot-, Forum-Ticket). „Roter `main` geht vor“ bleibt unberührt; steht es dort schon, passiert nichts. Das ersetzt die feste Position 4 als Auslöser nicht ganz: neue Tickets klemmt `board-place` weiter hinter den Sammelblock.
- **Zählung ohne Zustand:** Ticket-Merges kommen aus der paginierten Commit-Liste von `main` ab dem Abschluss des Vorgängers (Autoren mit Login auf `[bot]` zählen nicht), die Fenster sind je Ticketart getrennt. Zwei Läufe hintereinander ändern nichts (Concurrency-Group wie bisher).
- **Kosten:** ein Push-Lauf liest Issues, Commits und die Board-Liste und schreibt nur bei Bedarf; die Concurrency-Group hält höchstens einen wartenden Lauf.

Die Zahlen stehen als `MIN_TICKET_MERGES_PUSH` und `HARNESS_TAKT_MERGES` in `scripts/langfuse-takt.mjs` und sind an diese Doku gebunden (`test/langfuse-takt.test.ts`).

## Fortschreibung #1390 (2026-10-07): generischer Board-Takt, Positionskorrektur

- **Umbenennung:** der Workflow heißt jetzt `board-takt.yml` (Concurrency-Group `board-takt`), sein Skript `scripts/board-takt.mjs`. Dort liegen der Lauf, die Commit-Fenster und das Harness-Sammelticket; `scripts/langfuse-takt.mjs` behält die Status-Ticket-Logik (Entscheidung, Body, Anlegen). Die Zahlen stehen als `MIN_TICKET_MERGES_PUSH` (`langfuse-takt.mjs`) und `HARNESS_TAKT_MERGES` (`board-takt.mjs`), gebunden an diese Doku in `test/board-takt.test.ts`. Die frühere Actions-Historie läuft unter dem alten Namen „Langfuse-Takt“ weiter.
- **Positionskorrektur:** steht das ungeclaimte Harness-Sammelticket hinter der Position laut AGENTS.md (Anlass: ein nachträglich angelegtes landete am Board-Ende und klemmte jedes neue `--top`-Ticket dorthin), schiebt der Lauf es zurück, unabhängig von der Aktivität; `board-place.mjs` tut das vor jedem Einsortieren, `sammelticket-anlegen.mjs` beim Anlegen. Die Korrektur geht nur nach vorn und nie in den Kopf. Die Board-Liste lädt der Lauf einmal und zieht sie nach der Status-Aktion im Speicher nach.
- **Notfall-Tabelle:** Art, Titelmarker und Quelle je Notfall stehen einmal in `scripts/board-lib.mjs` (`NOTFAELLE`), auch für Security (`🔒 Security:`); `board-place --notfall` bricht bei fehlendem Marker ab, weil ein unmarkierter Notfall nicht zum Kopf zählt.
- **Verworfen:** nur melden statt zurückschieben (ein Hinweis, den niemand liest, ließe das Ticket am Ende liegen); Korrektur ohne Kopf-Klemme (ein großer Kopf würde durchbrochen); Umbenennen von `test/langfuse-takt.test.ts` (er testet weiter die Status-Logik).

## Fortschreibung #1382 (2026-10-07): Mindestabstand, Wochenbudget nur einmal je Woche

Gemessen im Status-Lauf #1395: Das Ticket entstand 2 h 16 min nach dem Abschluss des Vorgängers #1304, weil der Push-Auslöser bei 11 Ticket-Merges in 4,5 h die Untergrenze von 8 schnell erreicht, und die Wochenbudget-Messung lief doppelt über dieselbe Woche. Zwei Änderungen der Auslöser-Regel, beide mit Rohwerten belegt: #1304 wurde 2026-10-06T12:27:15Z angelegt und 2026-10-07T11:40:04Z geschlossen, #1395 entstand 2026-10-07T13:56:11Z (2,3 h danach). Unter der neuen Regel entstünde #1395 frühestens 2026-10-08T11:40Z, und weil #1304 in derselben Kalenderwoche (ab 2026-10-05) angelegt wurde und die Woche 2026-09-28 bis 10-04 schon gemessen hat, trüge dessen Body „Wochenbudget: entfällt“.

- **Mindestabstand:** ein neues Status-Ticket wird bei beiden Auslösern nur angelegt, wenn der Abschluss des Vorgängers mindestens 24 Stunden zurückliegt (Mindestabstand von 24 Stunden, `MIN_ABSTAND_STUNDEN` in `scripts/langfuse-takt.mjs`). „Nach oben“ eines schon offenen Tickets bleibt davon unberührt. Ohne Vorgänger gibt es keinen Abstand.
- **Wochenbudget:** war der Vorgänger in derselben Kalenderwoche angelegt wie das neue Ticket, hat er die letzte volle Woche schon gemessen; der Body schreibt dann „Wochenbudget: entfällt“ und die Checkliste überspringt Punkt 7. Fehlt `createdAt` des Vorgängers, wird gemessen (sichere Seite).

Verworfen: die Untergrenze 8 anheben (die Aktivität schwankt, der Abstand ist die stabilere Größe).

## Fortschreibung #1425 (2026-10-08): Spielquote im Takt

Anlass wie in [ADR 0012](0012-harness-autonomie-audit-spur.md#fortschreibung-1199-2026-10-05-spielquote-sammelticket-abschlusskriterium): in den 14 Tagen bis 2026-10-07 waren rund 84 von 104 gemergten PRs Harness. Die Maintainerin wünscht höchstens 1 Harness-Ticket auf 3 Spiel-Tickets, **über den bestehenden Takt** statt einer neuen Mechanik.

Entscheidung: die Quote steht in `SPIEL_QUOTE` (`scripts/board-takt.mjs`) und wirkt an der Stelle, die der Takt schon besitzt, dem Auslöser des Harness-Sammeltickets. Der Auslöser holt das Sammelticket nach 3 Spiel-Merges seit dem Abschluss des letzten Sammeltickets hinter den Kopf (präzisiert die 5 Ticket-Merges aus der Fortschreibung #1349) und zählt nur **Spiel-Merges** (Ticket-Merges ohne Bots und ohne Commit-Scope `harness`, `zaehleSpielMerges`) und liegt bei 3 (`HARNESS_TAKT_MERGES = SPIEL_QUOTE`): Harness-Merges verdienen keinen weiteren Harness-Platz. Jeder Lauf schreibt zusätzlich eine Zeile `Spielquote: <h> Harness- auf <s> Spiel-Merges im Fenster`, damit die Einhaltung messbar ist. Notfälle und Security tragen denselben Scope und zählen in dieser Information mit; sie bleiben von der Auswahl her vorrangig (Kopf des Boards).

Bewusst **nicht** gebaut: ein Zurückstufen des Sammeltickets hinter drei Spiel-Tickets. `board-place` und `sammelticket-anlegen` ziehen das Sammelticket auf die Position laut AGENTS.md vor; ein Rückstufen im Takt gegen diese Korrektur wechselte bei jedem Einsortieren hin und her, und die Board-Reihenfolge bliebe nicht mehr rein manuell ([ADR 0012](0012-harness-autonomie-audit-spur.md), #1258). Wer die Quote hart durchsetzen will, braucht eine gemeinsame Positionsregel für alle drei Skripte.

Zusätzlich gibt es im Project zwei Ansichten neben „View 1“: „Spiel“ (Filter `-label:area:harness`) und „Agentic Engineering“ (Filter `label:area:harness`). Die Auswahl bleibt ein Board (View 1, REST-Liste). Harness-Tickets entstehen nur aus Evidenz ([ticket-reihenfolge.md](../ticket-reihenfolge.md#sammelticket-harness-härtung-gesammelt-1199)).

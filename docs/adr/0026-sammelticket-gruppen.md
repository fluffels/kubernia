# ADR 0026: Sammeltickets in Gruppen mit frischem Kontext, Generationsgrenze statt Wachstum

> Architecture Decision Record. Format: Kontext → Optionen → Entscheidung → Konsequenzen → Re-Evaluierung.
> Status: **akzeptiert, Entscheidung 3 abgelöst (#1687), Workflow-Pfad entfernt: präzisiert durch ADR 0028** · Datum: 2026-10-16 · Ticket: #1647

## Status

**Akzeptiert.** Präzisiert [ADR 0016](0016-langfuse-takt-woechentlich.md) (Board-Takt) um die Generationsgrenze. Die operative Mechanik steht in [docs/ticket-reihenfolge.md](../ticket-reihenfolge.md#sammelticket-mechanik), die Messung in [docs/model-routing.md › Sammelticket-Läufe](../model-routing.md#sammelticket-läufe-1647).

## Kontext

Ein Sammelticket („Harness-Härtung (gesammelt)“, „Langfuse-Befunde (gesammelt)“) trägt seine Befunde als Kommentarzeilen und wird komplett in einem PR umgesetzt. Ein Umsetzer-Kontext wächst mit jeder Zeile, und jeder Call liest ihn neu: das Ticket #1628 sammelte 25 Punkte aus 20 Kommentaren. Gemessen (Baseline in model-routing.md): 22 von 33 Sammeltickets brauchten einen `KQ-Diffsize-Override`, drei gingen über das Review-Limit (#1579: 91 Dateien, danach Folge-Fix #1602; #1561; #1311), der Median liegt bei 11 Zeilen und 5,37 $ je Ticket. Die Umsetzung selbst ist nur ein Teil des Umsetzer-Laufs (Laufzeit-Anteile n = 104: Umsetzung 15 %, verify 32 %, Review 25 %, CI-Warten 21 %; [Umsetzer-Kontext](../model-routing.md#umsetzer-kontext)); der Ticket-Body nannte außerdem 61 % feste Kosten je PR, ohne Rohwerte (ungeprüft): mehr PRs wären darum nicht automatisch billiger.

Regeln, die eine Aufteilung in mehrere PRs oder Tickets sperren: ein PR je Ticket, der Ticket-Lock (`feature/kq-<nr>-*`), „komplett, kein Rest-Übertrag“, „nie ein Epic“. Die Zeilen überschneiden sich zudem in vielen Dateien.

## Optionen

| Option | Bewertung |
|---|---|
| Alles in einem Umsetzer (Status quo) | Der Kontext wächst mit den Zeilen; Cache-Reads dominieren die Kosten. |
| `SCHNITT: gruppe` im Übergabe-Vertrag von #1592 | #1592 sieht genau einen Schnitt je Lock vor und ist offen; passt nicht zu n Gruppen. Verworfen, #1592 bleibt unverändert. |
| Workflow-Tool `pipeline()` | Der Workflow-Pfad (`kubernia-ticket.js`) steht auf seinem Größendeckel und läuft im Ein-Umsetzer-Ablauf weiter; kein Gewinn für den Skill-Pfad. Verworfen. |
| Gruppen parallel | Die Gruppen teilen Dateien; parallele Edits im selben Worktree kollidieren. Verworfen. |
| Planer je Gruppe | Jeder Planer zahlt den Sockel erneut, und das Aussortieren von Dubletten braucht den Gesamtblick. Verworfen. |
| Kindertickets je Gruppe | Bricht Lock, „ein PR je Ticket“ und „komplett“; die Gruppen sind keine eigenständigen Mechanismen. Verworfen (Ausnahme unten). |
| **Gruppen-Umsetzer nacheinander im selben Worktree (gewählt)** | Ein Ticket, ein Lock, ein PR. Der Umsetzer orchestriert; je Gruppe ein frischer Subagent. |

## Entscheidung

1. **Subagent `kubernia-gruppe`** (`sonnet`/`medium`, Werkzeuge ohne `Agent`, Playwright, Web): setzt die Zeilen einer Gruppe um, committet, berichtet. Kein Push, kein PR, keine Lenses. Der Umsetzer spawnt ihn je Gruppe nacheinander **ohne `isolation`** im gemeinsamen Worktree und fährt danach verify, Review, PR und Merge im kleinen Kontext. Übergabe nur über Commits und Bericht (keine Chat-Historie). Scheitert der Spawn, setzt der Umsetzer selbst nacheinander um.
2. **Der Planer** bleibt einer je Ticket und schneidet erst ab etwa 6 Zeilen und mindestens 2 Datei-Clustern in höchstens 6 Gruppen (Block `GRUPPEN`).
3. **Generationsgrenze:** erreicht das jüngste ungeclaimte Harness-Sammelticket 12 offene Zeilen (`- [ ]` in Kommentaren vertrauter Autoren), legt der Board-Takt (`sammelticket-anlegen.mjs harness --generation`) einen Nachfolger **direkt hinter** dem vollen Ticket an. Es wird nicht vorgezogen: die Grenze verdrängt die Spielquote 1:3 nicht (der Takt entscheidet unverändert nach den Spiel-Merges) *(Zählweise präzisiert durch #1787, ADR 0016 › Fortschreibung #1787: Ticket-Merges jeder Art)*. Das Sammelticket bleibt „nie ein Epic“.
4. **Kinder nur ausnahmsweise:** eine einzelne Zeile, die allein über Session-Größe geht, wird ein eigenes Issue; Board-Platz per `board-place --after`, nie `--top`. Es zählt in der Spielquote als Harness.
5. **Cache-TTL unverändert** (`subagentPromptCacheTtl: "1h"` ohne Gewinn gemessen, siehe model-routing.md; der Schlüssel bleibt ungesetzt).
6. **Nur das Harness-Sammelticket hat die Grenze:** das Langfuse-Sammelticket bleibt klein (wenige, gebündelte Befunde aus dem Status-Lauf); die Gruppen gelten für beide.

## Konsequenzen

- Kosten je Zeile sinken, falls der kleinere Umsetzer-Kontext die Mehrkosten der Gruppen (je Gruppe Sockel, Plan-Abschnitt, Einlesen) übersteigt. **Ziel −20 % je Zeile ist eine Hypothese, nicht gemessen.** Gegenläufig: ab 12 Zeilen ist die Zeile in der Baseline billiger als darunter (feste Kosten je PR), kleinere Generationen verteuern sich leicht.
- Der Umsetzer wartet auf jede Gruppe; eine Pause über 5 Minuten lässt seinen Prompt-Cache ablaufen.
- Ein neuer Agententyp gilt erst in neuen Sessions; Spawn-Tiefe Hauptchat → Umsetzer → Gruppe ist 2, wie bei den Lenses.
- Der Board-Takt braucht den Project-Scope-Token (`PROJECT_TOKEN`); fehlt er, warnt der Schritt, der Takt läuft weiter.

## Re-Evaluierung

**Wirkt, wenn über die ersten drei Gruppen-Läufe die Kosten je Zeile (Umsetzer plus `kubernia-gruppe`) unter dem Baseline-Median (0,43 $) liegen und Review-Runden und Nacharbeit nicht steigen.** Sonst eine Zeile in „Langfuse-Befunde (gesammelt)“ und eine neue Entscheidung. Auch die Grenze 12 steht dann zur Wahl.

## Fortschreibung #1646 (2026-10-16): Workflow-Pfad nimmt keine Sammeltickets

Die Gruppen-Umsetzung (Plan je Gruppe, frischer Kontext je Gruppe) gibt es nur im Skill-Pfad. Der Workflow-Pfad (`.claude/workflows/kubernia-ticket.js`) setzt ein Sammelticket nicht um: der Auswahl-Prompt verlangt bei einem Ticket mit dem Titel „… (gesammelt)“ das Ergebnis `skill-pfad` ohne Claim (auch bei vorgegebenem Ticket), und eine deterministische Titel-Prüfung direkt nach der Auswahl fängt es auch dann ab, wenn der Agent trotzdem geclaimt hat: ein kurzer Agent gibt Lock und Assignee frei, der Lauf endet mit `{ ergebnis: 'skill-pfad', nummer }`. Der frühere Sammelticket-Absatz im Umsetzen-Prompt des Workflows entfällt. Der Board-Takt zieht außerdem kein Sammelticket vor, solange ein Vorgänger geclaimt in Arbeit ist: die Spielquote zählt ab dessen Abschluss.

## Fortschreibung #1687 (2026-10-16): Generationsgrenze abgeschafft

Entscheidung 3 (Generationsgrenze samt Nachfolger-Anlage im Board-Takt), der Grenz-Teil von Entscheidung 6, die PROJECT_TOKEN-Konsequenz des Takt-Schritts und „die Grenze 12 steht zur Wahl“ sind abgelöst. Es gibt keine Zeilengrenze mehr: ein Sammelticket nimmt beliebig viele Zeilen auf, es gibt höchstens ein ungeclaimtes, und beim Claim entsteht der Nachfolger (`--vorgaenger`).

**Entscheidung: die Grenze entfällt, weil die Maintainerin es so entschieden hat; die Gruppen-Umsetzer (Entscheidung 2) fangen den wachsenden Kontext ab.** Anlass: ein vom Takt angelegter Nachfolger (#1685) musste aus #1663 von Hand zurückgelegt werden. Bleiben: `--vorgaenger`, die Gruppen-Umsetzer und `zaehleBefundZeilen` für die Nachmessung. Der Workflow-Schritt und `--generation` entfallen; ein Wächter (`test/harness/sammelticket.test.ts`) hält sie draußen.

**Re-Evaluierung:** geht ein Sammelticket trotz Gruppen über das Review-Limit oder steigen Review-Runden und Nacharbeit, steht eine Grenze neu zur Wahl.

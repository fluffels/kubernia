# Planer-Gegenprobe 2026-10-16: Opus `high` und Sonnet gegen Opus `xhigh` (#1639)

> 📸 **Momentaufnahme vom 2026-10-16 — wird nicht aktualisiert** ([Lebenszyklus-Regel](referenz/doku-vorlagen.md#schnappschuss-analyse-audit-review)).
>
> Erledigt die Wiedervorlage aus [model-routing.md › Planer-Kosten](model-routing.md#planer-kosten-1558) (Entscheidungen 1 und 2): der Status-Lauf #1629 maß Ø 0,92 $ je Planer-Lauf (n = 14, über der Schwelle 0,82 $, Requests 14 → 20). Die gültige Entscheidung steht in model-routing.md, hier Regel, Aufbau und Rohwerte.

**Frage.** Senkt `high` (Opus) oder Sonnet die Planer-Kosten um mindestens 10 %, ohne dass der Plan Akzeptanzkriterien oder Sammelzeilen verpasst?

**Entscheidungsregel (vor dem ersten Lauf festgelegt, als Kommentar auf #1639 und mit diesem Commit).**

- **Arme:** R = Opus `xhigh` (Definition unverändert, Referenz), H = Opus `high`, S = Sonnet mit `xhigh` (nimmt das Modell den Effort nicht an, läuft S mit Standard-Effort und steht so in der Tabelle).
- **Tickets (n = 5):** #1598 und #1625 (Sammeltickets), #1553 (Spiel, `src`), #1610, #1590. Je Ticket und Arm ein Lauf (15 Läufe). Der Checkout ist der erste Elternteil des Squash-Commits des gemergten PRs; der Prompt ist in allen Armen bytegleich (historischer Planer-Prompt des Tickets plus ein fester Zusatz: Stand = dieser Checkout, Issue-Kommentare nach dem Claim gehören nicht zum Ticket).
- **Richter:** blind, ein Opus-Lauf je Ticket, bekommt Ticket (Akzeptanzkriterien bzw. Sammelzeilen), Dateiliste und Text des gemergten PRs und die drei Pläne gemischt als A/B/C. Er zählt je Plan **Verpasser** (Akzeptanzkriterium oder Sammelzeile ohne Schritt im Plan, oder eine nötige Datei der Dateiliste fehlt) und **Falschspuren** (ein Schritt widerspricht einem Akzeptanzkriterium oder dem gemergten Ergebnis).
- **Wechsel auf H oder S nur, wenn alles zutrifft:** (1) Σ Verpasser ≤ Σ Verpasser von R, (2) in keinem Ticket verpasst der Arm ein Akzeptanzkriterium, das R abdeckt, (3) Falschspuren ≤ die von R, (4) Ø aufgezeichnete Kosten mindestens −10 % gegen R bei nicht höheren geschätzten Kosten. Bestehen H und S, gewinnt der billigere Arm.
- **Deckel** 40 $ aufgezeichnet (Schätzung 20 bis 25 $); wird er erreicht, endet die Gegenprobe als „Deckel“ ohne Entscheidung.

**Ergebnis und Rohwerte:** folgen nach den Läufen.

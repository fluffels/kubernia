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

**Ergebnis: kein Wechsel, der Planer bleibt Opus `xhigh`.** H verpasst Σ 3 Akzeptanzkriterien oder Dateien gegen 1 bei R (Kriterium 1 verfehlt), S Σ 7 (in #1625 alle fünf Sammelzeilen, Kriterium 1 und 2 verfehlt). Die Kosten wären deutlich niedriger (H −51 %, S −64 % im Ø), aber der Plan ist der Hebel für die Requirement-Treue (0,41 → 0,71 Blocker je Lauf, [Planer-Kosten](model-routing.md#planer-kosten-1558)); die Ersparnis von 0,9 $ je Lauf rechtfertigt keinen Wechsel, der Verpasser erzeugt. Kriterium 4 wurde nicht mehr ausgewertet (geschätzte Kosten nicht berechnet).

**Läufe** (Headless, `claude -p --agent kubernia-planner --model <opus|sonnet> --effort <xhigh|high|xhigh>`, `total_cost_usd` aus der Ausgabe, Requests = `num_turns`, „Session“ = Lauf-Session; Projektordner unter dem Scratchpad, nicht der Kubernia-Ordner, die Läufe fallen so nicht in die Statistik, im Langfuse-Projekt stehen sie):

| Ticket | Arm | Kosten ($) | Requests | Minuten | Session |
|---|---|--:|--:|--:|---|
| #1598 | R | 1,95 | 18 | 7,3 | 8de576d4 |
| #1598 | H | 1,17 | 16 | 4,6 | 3f7a8276 |
| #1598 | S | 0,34 | 8 | 1,8 | b10837b9 |
| #1625 | R | 1,96 | 15 | 7,3 | e4f9b6d7 |
| #1625 | H | 0,89 | 13 | 3,7 | 952142ad |
| #1625 | S | 0,35 | 9 | 1,7 | f33b4aeb |
| #1553 | R | 1,64 | 16 | 6,4 | 92249ce3 |
| #1553 | H | 0,74 | 11 | 2,8 | 1cae38c8 |
| #1553 | S | 0,73 | 15 | 4,0 | 48ba0941 |
| #1610 | R | 1,97 | 13 | 8,1 | 7c419288 |
| #1610 | H | 0,96 | 11 | 4,5 | 6490e5c8 |
| #1610 | S | 1,17 | 19 | 7,6 | 551958f3 |
| #1590 | R | 1,78 | 16 | 9,1 | 5949492c |
| #1590 | H | 0,77 | 13 | 2,8 | 6b8a57d6 |
| #1590 | S | 0,72 | 17 | 4,5 | 46b962fb |

Σ R 9,30 $ (Ø 1,86), H 4,53 $ (Ø 0,91), S 3,31 $ (Ø 0,66).

**Richter** (blind, ein Opus-Lauf je Ticket, 0,35 bis 0,44 $, Σ 1,95 $; Zuordnung A/B/C zu Armen zufällig, erst nach dem Urteil aufgelöst). Verpasser / Falschspuren je Ticket:

| Ticket | R | H | S | verpasst (Richter) |
|---|---|---|---|---|
| #1598 | 0 / 1 | 1 / 1 | 0 / 0 | H: Zeile 7c |
| #1625 | 0 / 0 | 1 / 0 | 5 / 0 | H: `docs/model-routing.md`; S: Zeilen 1 bis 5 |
| #1553 | 0 / 1 | 0 / 1 | 0 / 1 | |
| #1610 | 0 / 2 | 1 / 2 | 1 / 1 | H: `.github/CODEOWNERS`; S: `AGENTS.md` |
| #1590 | 1 / 0 | 0 / 1 | 1 / 0 | R: `docs/harness-glossar.md`; S: `README.md` |
| Σ | 1 / 4 | 3 / 5 | 7 / 2 | |

**Kosten der Gegenprobe:** 9,30 + 4,53 + 3,31 + 1,95 = 19,09 $ plus ein verworfener Probelauf (#1610, Arm R, 1,61 $, Checkout mit Git-Historie) = 20,70 $, unter dem Deckel 40 $.

**Grenzen.**
- Ein Lauf je Arm und Ticket, ein Richter je Ticket, n = 5: die Verpasser-Zahlen (1, 3, 7) sind klein; ein Richter kann irren (in #1590 zählt er bei R eine Glossar-Datei als verpasst). Die Regel ist streng gewählt, nicht statistisch belegt; der Abstand von S ist aber deutlich (Sammelticket #1625 ohne einen Schritt für fünf Zeilen).
- Abweichungen vom Rezept der Lens-Gegenprobe: Der Planer lief als Hauptthread-Agent (`--agent`), nicht als gespawnter Subagent (für den Planer gibt es kein `omitClaudeMd`, der Unterschied betrifft nur das Verhalten der Definition); der Effort-Schalter von S (Sonnet `xhigh`) wurde gesetzt, seine Wirkung nicht geprüft; die Checkouts sind Exporte ohne Git-Historie, damit der Planer den gemergten PR nicht im Log sieht. Er fand ihn trotzdem über `gh` (Issue geschlossen, PR verlinkt) und vermerkte es in #1590 und #1553: alle Arme gleich, die Läufe sind kein Blindtest gegen Vorwissen.
- Der Richter bekam nicht die Requirement-Treue-Blocker der Runde 1 (nicht je Ticket verfügbar), nur Ticket, PR-Text und Dateiliste. Das bewertet den Plan gegen das Endergebnis, nicht gegen den Zwischenstand.
- Die Kosten der R-Läufe (Ø 1,86 $) liegen über den Subagenten-Läufen des Status-Laufs (Ø 0,92 $ aufgezeichnet): ein Headless-Lauf ohne den Cache des Hauptchats. Verglichen werden nur die Arme untereinander.

**Wiedervorlage.** Neuer Opus- oder Sonnet-Release ([#1362](https://github.com/fluffels/kubernia/issues/1362)) oder eine geänderte Planer-Definition (Prompt, Tools); Rezept wie hier, die Entscheidungsregel vorher festlegen. Der Ø-Trigger (> 0,82 $) bleibt Berichtszeile des Status-Laufs und löst allein keine Gegenprobe mehr aus.

# Ticket-Auswahl

> **Projektanteil.** Die Auswahl-Mechanik (Reihenfolge im Board, Auswahl-Skript, Sammeltickets, Wiedervorlage, Board-Pflege-Werkzeuge) steht im Factory-Repo: [Ticket-Auswahl](https://github.com/fluffels/self-improving-agent-harness-and-factory/blob/v0.8.0/docs/ticket-reihenfolge.md). Hier bleiben die Projektwerte (Produkt-Board, Spielquote, Board-Literale) und die Board-Pflege dieses Projekts; die Überschriften tragen Anker-Stubs für ADRs, Besitz-Einheiten und Doku, die auf sie zeigen.
>
> Welche Seite Projekt und welche Kern ist: [Inventar](referenz/anlaufstellen.md#factory-seiten-projektanteil-und-kern). Begriffe: [Harness-Glossar](harness-glossar.md).

## Was „nächstes Ticket" heißt

Kern: [Was „nächstes Ticket" heißt](https://github.com/fluffels/self-improving-agent-harness-and-factory/blob/v0.8.0/docs/ticket-reihenfolge.md#was-nächstes-ticket-heißt)

### Spielquote über zwei Boards (#1729)

Kern: [Spielquote über zwei Boards (#1729)](https://github.com/fluffels/self-improving-agent-harness-and-factory/blob/v0.8.0/docs/ticket-reihenfolge.md#produktquote-über-zwei-boards-1729)

<!-- factory-projekt:start -->

**Projektwerte:** `/kubernia --bereich produkt` wählt nur auf dem Produkt-Board (der Name `spiel` gilt als Alias, `bereiche.aliase` in `.factory/projekt.json`); `/factory` läuft im Factory-Repo, dort meldet `--bereich agentic` das fremde Board. Das Factory-Board führt die Issues des Factory-Repos, das Produkt-Board die von kubernia. Soll und Kennzahl, keine Auswahlregel: ein Factory-Merge erst nach 3 Produkt-Merges (Spielquote 1:3) seit dem letzten.

<!-- factory-projekt:ende -->

### Spezifikations-Gate (#1615)

Kern: [Spezifikations-Gate (#1615)](https://github.com/fluffels/self-improving-agent-harness-and-factory/blob/v0.8.0/docs/ticket-reihenfolge.md#spezifikations-gate-1615)

#### Reparaturweg

Kern: [Reparaturweg](https://github.com/fluffels/self-improving-agent-harness-and-factory/blob/v0.8.0/docs/ticket-reihenfolge.md#reparaturweg)

## Wiederaufnahme verwaister Claims

Kern: [Wiederaufnahme verwaister Claims](https://github.com/fluffels/self-improving-agent-harness-and-factory/blob/v0.8.0/docs/ticket-reihenfolge.md#wiederaufnahme-verwaister-claims)

## Sammelticket-Mechanik

Kern: [Sammelticket-Mechanik](https://github.com/fluffels/self-improving-agent-harness-and-factory/blob/v0.8.0/docs/ticket-reihenfolge.md#sammelticket-mechanik)

## Sammelticket „Harness-Härtung (gesammelt)" (#1199)

Kern: [Sammelticket „Harness-Härtung (gesammelt)" (#1199)](https://github.com/fluffels/self-improving-agent-harness-and-factory/blob/v0.8.0/docs/ticket-reihenfolge.md#sammelticket-harness-härtung-gesammelt-1199)

## Wiederkehrendes Ticket „Langfuse-Status überprüfen" (#1293)

Kern: [Wiederkehrendes Ticket „Langfuse-Status überprüfen" (#1293)](https://github.com/fluffels/self-improving-agent-harness-and-factory/blob/v0.8.0/docs/ticket-reihenfolge.md#wiederkehrendes-ticket-langfuse-status-überprüfen-1293)

### Langfuse-Befunde (gesammelt)

Kern: [Langfuse-Befunde (gesammelt)](https://github.com/fluffels/self-improving-agent-harness-and-factory/blob/v0.8.0/docs/ticket-reihenfolge.md#langfuse-befunde-gesammelt)

## Wiedervorlage (#1628)

Kern: [Wiedervorlage (#1628)](https://github.com/fluffels/self-improving-agent-harness-and-factory/blob/v0.8.0/docs/ticket-reihenfolge.md#wiedervorlage-1628)

## Audit-Einordnung (#1628)

Kern: [Audit-Einordnung (#1628)](https://github.com/fluffels/self-improving-agent-harness-and-factory/blob/v0.8.0/docs/ticket-reihenfolge.md#audit-einordnung-1628)

## Code-Scanning-Inbox (#1436)

Kern: [Code-Scanning-Inbox (#1436)](https://github.com/fluffels/self-improving-agent-harness-and-factory/blob/v0.8.0/docs/ticket-reihenfolge.md#code-scanning-inbox-1436)

<!-- factory-projekt:start -->
## Board-Pflege durch den Agenten (nur kubernia)

Die Kurzfassung steht in [AGENTS.md › Wo die TODOs leben](../AGENTS.md#wo-die-todos-leben); hier die volle Regel.

- **GitHub ist die Single Source of Truth für den Stand:** Erledigtes sofort dort schließen (mit Ergebnis-Kommentar), Board-Status aktuell halten.
- **Selbst Issues verwalten** ohne Rückfrage: schließen, kommentieren, labeln, neue Tickets schreiben, wenn etwas auffällt. **Neue Tickets ohne Assignee** (sonst sperren sie fälschlich) nur über `node scripts/spezifikation.mjs anlegen` (Abhängigkeit als Zeile „blockiert durch #X“, `--blocker <nr>`; `gh issue create` ist gesperrt; [Reparaturweg](#reparaturweg)).
- **Neue Issues sofort ins Board einsortieren** (das Skript tut es; Befehle und Notfall-Marker: [Sammelticket-Mechanik](#sammelticket-mechanik)). Nur Notfälle, Wiedervorlagen und das Wochen-Status-Ticket ganz oben; alles andere nach Priorität, **nie vor das ungeclaimte Sammelticket**, **nie einfach ans Ende**.
- **Zu großes Ticket (Epic/Phase) → aufteilen statt umsetzen.** Nicht in einer Session umsetzbar ⇒ in session-große Kindertickets zerlegen (ohne Assignee, `area:`-Label, im Board einsortiert), Übersichts-Kommentar mit Reihenfolge im Epic, Epic schließen (nicht löschen), kein Worktree.
- **🤖 Dependabot-Sammel-Ticket „Dependabot-PRs auflösen" → mergen statt implementieren.** PRs einzeln bei grüner CI mergen, rote reparieren, **nie blind** ([CONTRIBUTING.md](../CONTRIBUTING.md)).
<!-- factory-projekt:ende -->

## Reihenfolge pflegen — im Board, nicht in einer Datei

Kern: [Reihenfolge pflegen — im Board, nicht in einer Datei](https://github.com/fluffels/self-improving-agent-harness-and-factory/blob/v0.8.0/docs/ticket-reihenfolge.md#reihenfolge-pflegen--im-board-nicht-in-einer-datei)

<!-- factory-projekt:start -->

**Board-Literale dieses Projekts** (Lesehilfe; die SSOT ist `.factory/projekt.json`, Lader `scripts/projekt-config.mjs`, ein Boardwechsel ändert zuerst die Config): Produkt-Board `PVT_kwHOD8746c4Barq_`, Status-Feld `PVTSSF_lAHOD8746c4Barq_zhVhdTM`, Option Todo `f75ad846`; Factory-Board `PVT_kwHOD8746c4BnXAE`, Status-Feld `PVTSSF_lAHOD8746c4BnXAEzhl7_i8`, Option Todo `f75ad846`. Status setzen auf dem Produkt-Board: `gh project item-edit --id <ITEM> --project-id PVT_kwHOD8746c4Barq_ --field-id PVTSSF_lAHOD8746c4Barq_zhVhdTM --single-select-option-id f75ad846`.

<!-- factory-projekt:ende -->

## Am Ticket-Ende

Kern: [Am Ticket-Ende](https://github.com/fluffels/self-improving-agent-harness-and-factory/blob/v0.8.0/docs/ticket-reihenfolge.md#am-ticket-ende)

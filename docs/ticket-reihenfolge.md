# Ticket-Auswahl

> **Es zählt die manuelle Board-Reihenfolge.** Das „nächste Ticket" ist das **oberste freie Item im GitHub-Project-Board** — in genau der Reihenfolge, in der die Tickets im Board (View 1) stehen. Die Maintainerin steuert die Reihenfolge **per Ziehen** (Drag & Drop) wie eine Warteschlange; oben wird genommen. Es gibt kein `Prio`-Feld.
>
> Das bleibt kompatibel mit #627 (der Grund, warum es damals *weg von* einer handsortierten Datei ging): Die Reihenfolge lebt im **Board**, nicht in einer Datei — parallele Agenten kollidieren nicht auf ihr (keine Merge-Konflikt-Quelle). Der Kollisionsschutz bleibt der **Assignee-Marker**.

## Vor JEDEM Ticket — bewusst zweifeln (über allem)

Bevor irgendein Ticket angefasst wird, **zuerst zweifeln** — das steht über der Auswahl (voll in [AGENTS.md › Oberste Regel](../AGENTS.md)):

1. **Stardew-Scope-Frage:** „Ist das, was ich hier mache, noch sinnvoll, wenn Kubernia **so groß wie Stardew Valley** wird?" Nur umsetzen, wenn ja.
2. **Bisherige Entscheidungen aktiv anzweifeln** — auch abgeschlossene Tickets, ADRs, „gesetzte" Annahmen dürfen falsch sein.
3. **Auffälliges → sofort festhalten:** echter Defekt (Bug, reale Drift, Datenverlust, Security) als neues Issue an die richtige Board-Stelle; Härtung/Kosmetik als Zeile ins Sammelticket ([AGENTS.md › Nicht jeder Befund wird ein Ticket](../AGENTS.md#wo-die-todos-leben)) — nicht inline mitfixen, nicht „im Kopf" behalten.

## Was „nächstes Ticket" heißt

Rein deterministisch — **kein Abwägen nach Inhalt, kein Vorab-Sichten der ganzen Liste**:

1. **oberstes freies Item in der Board-Reihenfolge** — genau die Reihenfolge, die `gh project item-list` liefert (= was in View 1 von oben nach unten steht). Keine Nachsortierung nach Inhalt oder Nummer.
2. **frei** heißt: **kein Assignee** (der „in Arbeit"-Marker), **kein** offener Branch/Worktree und **kein offener Blocker** (`blockiert durch #X` im Body).

Freie Auswahl in Board-Reihenfolge in einem Befehl (oberste Zeile ist „dran"):

```bash
gh project item-list 1 --owner fluffels --format json --limit 800 --jq '
  .items
  | map(select(.content.type=="Issue" and (.status // "") == "Todo"))
  | .[] | "#\(.content.number)\t\(.title)"'
```

> ⚠️ Die Board-Auswahl braucht **`read:project`-Scope** im `gh`-Token (`gh auth refresh -s project`). ⚠️ Ohne `--limit` liefert `gh project item-list` nur **30** Items — immer `--limit 800` mitgeben, sonst fallen genau die unteren Tickets weg. **Nicht** nach `.content.number` o.ä. sortieren — das würde die Board-Reihenfolge zerstören, die hier gerade das Maßgebliche ist. **`.status == "Todo"` (nicht `!="Done"`)** — „In Progress"-Tickets dürfen gar nicht erst in der Kandidatenliste auftauchen, sonst greifen parallele Agenten irrtümlich dasselbe Ticket.

Dann nur **dieses eine** Kandidaten-Ticket kurz gegen den Live-Stand prüfen (`gh issue view <nr>`). **⛔ Hat das Ticket einen Assignee → sofort weiter zum nächsten, fertig. Kein Worktree inspizieren, kein Prüfen wie weit die Arbeit ist, kein Weiterarbeiten.** Ein Assignee bedeutet: ein anderer Agent arbeitet daran — nicht anfassen. Kein Assignee + offen + kein Blocker → sofort self-assignen (`gh issue edit <nr> --add-assignee @me`) und mit dem normalen Workflow abarbeiten (eigener Worktree → umsetzen → alle Gates grün + im Browser verifizieren → **ein** PR → CI abwarten + bis Merge). Voller Ablauf: [AGENTS.md](../AGENTS.md).

## Sammelticket „Harness-Härtung (gesammelt)" (#1199)

Regel: [AGENTS.md › Nicht jeder Befund wird ein Ticket](../AGENTS.md#wo-die-todos-leben). Es gibt **höchstens ein** ungeclaimtes Sammelticket (`area:harness`); ein geclaimtes (Assignee) läuft daneben weiter.

- **Befund eintragen:** erst suchen, dann als **Kommentar** anhängen (Kommentare kollidieren bei parallelen Agenten nicht, Body-Edits schon):
  ```bash
  gh issue list --state open --search 'in:title "Harness-Härtung (gesammelt)"' --json number,assignees --jq '.[] | select((.assignees|length)==0) | .number'
  gh issue comment <nr> --body "- [ ] <Befund>"
  ```
  Kein ungeclaimter Treffer → anlegen (unten). Zwei offene **ungeclaimte** (Wettlauf) → das jüngere schließen, seine Zeilen ins ältere übertragen.

- **Anlegen auf Position 5** (fehlt ein ungeclaimtes, auch während ein geclaimtes abgearbeitet wird; vorher mit dem Suchbefehl oben prüfen, nie doppelt anlegen):
  ```bash
  NR=$(gh issue create --label area:harness --title "Harness-Härtung (gesammelt)" --body "- [ ] <Befund>" | grep -o '[0-9]*$')
  NODE=$(gh issue view "$NR" --json id --jq .id)
  ITEM=$(gh api graphql -f query='mutation($p:ID!,$c:ID!){ addProjectV2ItemById(input:{projectId:$p,contentId:$c}){ item{ id } } }' \
    -f p=PVT_kwHOD8746c4Barq_ -f c="$NODE" --jq .data.addProjectV2ItemById.item.id)
  AFTER=$(gh project item-list 1 --owner fluffels --format json --limit 800 \
    --jq '[.items[] | select((.status // "")=="Todo")][3].id // empty')   # 4. Item → neues landet auf 5
  # leer (weniger als 4 Todo-Items): afterId weglassen, dann landet es oben
  gh api graphql -f query='mutation($p:ID!,$i:ID!,$a:ID!){ updateProjectV2ItemPosition(input:{projectId:$p,itemId:$i,afterId:$a}){ items(first:1){ nodes{ id } } } }' \
    -f p=PVT_kwHOD8746c4Barq_ -f i="$ITEM" -f a="$AFTER"
  ```
- **Beim Claimen des Sammeltickets** sofort prüfen, ob ein ungeclaimtes existiert; fehlt es, direkt eines anlegen (unten), damit Befunde nie ohne Ziel sind.
- **Abarbeiten:** zuerst der feste **Langfuse-Blick** ([docs/model-routing.md › Langfuse-Blick](model-routing.md#langfuse-blick-beim-sammelticket-1199)) — dessen Befunde werden weitere Zeilen. Dann so viele Zeilen umsetzen, wie in **einen** PR passen (`check:diffsize`). **Vor dem PR** die Kommentare erneut lesen; was offen ist, ins **bestehende ungeclaimte** Sammelticket übertragen, sonst eines auf Position 5 anlegen — nur wenn Zeilen übrig sind, kein leeres. Das alte schließt der PR per `Closes`.
- **Konvergenz-Signal:** Zeilenzahl pro Sammelticket-Generation ([ADR 0012](adr/0012-harness-autonomie-audit-spur.md#fortschreibung-1199-2026-10-05-spielquote-sammelticket-abschlusskriterium)).

## Reihenfolge pflegen — im Board, nicht in einer Datei

Die manuelle Board-Reihenfolge ist die **einzige** Reihenfolge-Quelle; es gibt keine `prio:*`-Labels und kein `Prio`-Feld.

- **Reihenfolge ändern:** im Board (View 1) das Item per **Drag & Drop** hoch-/runterziehen. Weiter oben = früher dran. Das ist das „einpriorisieren".
- **Neues Item ganz nach oben schieben** (per CLI, wenn kein UI-Zugriff) — `afterId` weglassen = an die Spitze:
  ```bash
  # Item-ID des Issues holen, dann an die oberste Board-Position schieben
  ITEM=$(gh project item-list 1 --owner fluffels --format json --limit 800 \
    --jq '.items[] | select(.content.number==<NR>) | .id')
  gh api graphql -f query='mutation($p:ID!,$i:ID!){ updateProjectV2ItemPosition(input:{projectId:$p,itemId:$i}){ items(first:1){ nodes{ id } } } }' \
    -f p=PVT_kwHOD8746c4Barq_ -f i="$ITEM"
  ```
- **Abhängigkeit** („A vor B"): als Notiz `blockiert durch #X` in den **Body** des abhängigen Issues. Die Auswahl fängt das am Kandidaten-Check ab (offener Blocker → überspringen).
- **Unwichtig:** im Board nach unten ziehen, oder schließen bzw. löschen (`gh issue delete` nur mit Rückfrage). Ein Zurückstellen-Label gibt es nicht.
- **Neues Issue:** wandert per „Auto-add to project"-Board-Workflow automatisch aufs Board — danach an die gewünschte Stelle ziehen.
- **Forum-Issues schieben sich selbst nach oben:** die Action [`.github/workflows/forum-inbox.yml`](../.github/workflows/forum-inbox.yml) schiebt ein frisch geflaggtes Forum-Ticket beim Anlegen an die **oberste** Board-Position (#747, GraphQL `addProjectV2ItemById` idempotent + `updateProjectV2ItemPosition`). ⚠️ Das braucht ein Repo-Secret **`PROJECT_TOKEN`** (PAT mit `project`-Scope) — das Standard-`GITHUB_TOKEN` kann kein User-Project V2 beschreiben; fehlt es, warnt die Action nur (Issue steht dann irgendwo im Board). Board-Node-ID: `PVT_kwHOD8746c4Barq_`.
- **Offene Dependabot-PRs sammeln sich selbst ein** (#712): die Action [`.github/workflows/dependabot-inbox.yml`](../.github/workflows/dependabot-inbox.yml) prüft täglich (+ `workflow_dispatch`), ob Dependabot-PRs offen sind, und legt bei Bedarf **ein** Sammel-Issue „🤖 Dependabot-PRs auflösen" an — direkt an die **oberste** Board-Position geschoben (dieselbe GraphQL-Verdrahtung/`PROJECT_TOKEN` wie bei den Forum-Issues), damit es beim nächsten „nächstes Ticket"-Griff sofort oben steht. Bleibt es offen, hängt jeder weitere Lauf nur den aktuellen PR-Stand als Kommentar an (kein Issue-Spam); sind keine Dependabot-PRs mehr offen, schließt die Action das Sammel-Issue automatisch. **Abarbeiten ohne Worktree/Code:** die gelisteten PRs einzeln gegen grüne CI prüfen (`gh pr checks <nr>`) und mergen (`gh pr merge <nr> --squash --delete-branch`), danach das Issue schließen.

## Am Ticket-Ende

Am Ticket-Ende ist **keine** Reihenfolge-Datei mehr zu pflegen. Der Abschluss ist: Issue schließen (via `Closes #<nr>` im gemergten PR), und — falls beim Arbeiten etwas auffiel — einen echten Defekt als Issue an die richtige Board-Stelle, Härtung/Kosmetik als Zeile ins Sammelticket (oben).

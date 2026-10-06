# Ticket-Auswahl

> **Es zählt die manuelle Board-Reihenfolge.** Das „nächste Ticket" ist das **oberste freie Item im GitHub-Project-Board** — in genau der Reihenfolge, in der die Tickets im Board (View 1) stehen. Die Maintainerin steuert die Reihenfolge **per Ziehen** (Drag & Drop) wie eine Warteschlange; oben wird genommen. Es gibt kein `Prio`-Feld.
>
> Das bleibt kompatibel mit #627 (der Grund, warum es damals *weg von* einer handsortierten Datei ging): Die Reihenfolge lebt im **Board**, nicht in einer Datei — parallele Agenten kollidieren nicht auf ihr (keine Merge-Konflikt-Quelle). Der Kollisionsschutz bleibt der **Assignee-Marker**.

## Vor JEDEM Ticket — bewusst zweifeln (über allem)

Bevor irgendein Ticket angefasst wird, **zuerst zweifeln** — das steht über der Auswahl (voll in [AGENTS.md › Oberste Regel](../AGENTS.md)):

1. **Stardew-Scope-Frage:** „Ist das, was ich hier mache, noch sinnvoll, wenn Kubernia **so groß wie Stardew Valley** wird?" Nur umsetzen, wenn ja.
2. **Bisherige Entscheidungen aktiv anzweifeln** — auch abgeschlossene Tickets, ADRs, „gesetzte" Annahmen dürfen falsch sein.
3. **Auffälliges → sofort festhalten:** Spiel-/Inhalts-Befund jeder Art als neues Issue an die richtige Board-Stelle; alles zum Harness (Defekt, Härtung, Kosmetik, Wunsch) als Zeile ins Sammelticket, ein eigenes Harness-Issue nur bei Notfall (roter `main`, Security, Datenverlust) ([AGENTS.md › Harness-Befunde sind Zeilen, keine Tickets](../AGENTS.md#wo-die-todos-leben)) — nicht inline mitfixen, nicht „im Kopf" behalten.

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

## Anlegen auf Position N

Gilt für das Sammelticket (`N` = Position laut AGENTS.md) und das Status-Ticket (`N=20`). `<Titel>`, Body und `N` einsetzen:

```bash
N=<Position>   # Sammelticket: Position laut AGENTS.md; Langfuse-Status: 20
NR=$(gh issue create --label area:harness --title "<Titel>" --body "<Body>" | grep -o '[0-9]*$')
NODE=$(gh issue view "$NR" --json id --jq .id)
ITEM=$(gh api graphql -f query='mutation($p:ID!,$c:ID!){ addProjectV2ItemById(input:{projectId:$p,contentId:$c}){ item{ id } } }' \
  -f p=PVT_kwHOD8746c4Barq_ -f c="$NODE" --jq .data.addProjectV2ItemById.item.id)
gh project item-edit --id "$ITEM" --project-id PVT_kwHOD8746c4Barq_ --field-id PVTSSF_lAHOD8746c4Barq_zhVhdTM --single-select-option-id f75ad846   # Status Todo sofort setzen (der Board-Workflow setzt es erst verzögert)
AFTER=$(gh project item-list 1 --owner fluffels --format json --limit 800 \
  --jq "[.items[] | select((.status // \"\")==\"Todo\" and .id != \"$ITEM\")] | (.[$N-2] // .[-1]).id // empty")   # (N-1). Todo-Item ohne das neue → es landet auf N; kürzeres Board: ans Ende (kein Todo-Item: Mutation überspringen)
gh api graphql -f query='mutation($p:ID!,$i:ID!,$a:ID!){ updateProjectV2ItemPosition(input:{projectId:$p,itemId:$i,afterId:$a}){ items(first:1){ nodes{ id } } } }' \
  -f p=PVT_kwHOD8746c4Barq_ -f i="$ITEM" -f a="$AFTER"
```

Danach die Position prüfen: das Ticket ist das N. Todo-Item der Board-Liste (Auswahl-Befehl oben).

## Sammelticket „Harness-Härtung (gesammelt)" (#1199)

Regel: [AGENTS.md › Harness-Befunde sind Zeilen, keine Tickets](../AGENTS.md#wo-die-todos-leben). Es gibt **höchstens ein** ungeclaimtes Sammelticket (`area:harness`); ein geclaimtes (Assignee) läuft daneben weiter.

- **Befund eintragen:** erst suchen, dann als **Kommentar** anhängen (Kommentare kollidieren bei parallelen Agenten nicht, Body-Edits schon):
  ```bash
  gh issue list --state open --search 'in:title "Harness-Härtung (gesammelt)"' --json number,assignees --jq '.[] | select((.assignees|length)==0) | .number'
  gh issue comment <nr> --body "- [ ] <Befund>"
  ```
  Kein ungeclaimter Treffer → anlegen (unten). Zwei offene **ungeclaimte** (Wettlauf) → das jüngere schließen, seine Zeilen ins ältere übertragen.

- **Anlegen auf der Position laut AGENTS.md** (fehlt ein ungeclaimtes, auch während ein geclaimtes abgearbeitet wird; vorher mit dem Suchbefehl oben prüfen, nie doppelt anlegen). Ablauf und Befehle: [Anlegen auf Position N](#anlegen-auf-position-n), hier mit `N` aus AGENTS.md und dem Titel „Harness-Härtung (gesammelt)".
- **Beim Claimen des Sammeltickets** sofort prüfen, ob ein ungeclaimtes existiert; fehlt es, direkt eines anlegen (unten), damit Befunde nie ohne Ziel sind. Dann die Zeilen in Kommentar-Reihenfolge zählen und die **zweite Hälfte** (bei ungerader Zahl die kleinere) **wörtlich** ins ungeclaimte Sammelticket übertragen; die **erste Hälfte** bleibt im geclaimten und wird in einem PR erledigt.
- **Abarbeiten:** jede Zeile der ersten Hälfte bekommt in **einem** PR ein **Ergebnis**: umgesetzt, geprüft und dokumentiert, oder begründet „bewusst nicht“ (nur bei optionalen Teilen). Ein breiter Slice ist zulässig (Commit-Zeile `KQ-Diffsize-Override: #<nr> warum`, eigener leerer Commit). Zurück ins nächste Sammelticket geht nur, was in der Session **nachweislich nicht machbar** ist, mit konkreter Begründung. **Neue Befunde** während der Arbeit gehören als Kommentar ins **nächste** (ungeclaimte) Sammelticket, nicht in den PR. Das alte schließt der PR per `Closes`; fehlt das nächste, vorher anlegen (Position laut AGENTS.md).
- **Konvergenz-Signal:** Zeilenzahl pro Sammelticket-Generation ([ADR 0012](adr/0012-harness-autonomie-audit-spur.md#fortschreibung-1199-2026-10-05-spielquote-sammelticket-abschlusskriterium)).

## Wiederkehrendes Ticket „Langfuse-Status überprüfen" (#1293)

Die breite, regelmäßige Auswertung der Langfuse-Daten. Es gibt **höchstens ein** offenes (vorher suchen: `gh issue list --state open --search 'in:title "Langfuse-Status überprüfen"'`; zwei offene durch einen Wettlauf: das jüngere schließen). Neu angelegt wird es beim Abschluss des alten auf **Position 20** ([Anlegen auf Position N](#anlegen-auf-position-n), `N=20`) und rückt so von selbst nach oben (etwa alle 20 Tickets einmal). Die Checkliste steht einmal in [docs/model-routing.md › Langfuse-Status überprüfen](model-routing.md#langfuse-status-überprüfen-1293); hier nur die Mechanik.

**Body-Vorlage:** Zeitraum (ab `closedAt` des Vorgängers, beim ersten Ticket ab dem Merge von #1293) · Link auf die Checkliste · Abschluss: Bericht-Kommentar geschrieben, Folgen angelegt, Nachfolger auf Position 20.

**Abschluss, in dieser Reihenfolge:**

1. Bericht als Kommentar im Ticket (Einzelläufe, Zahlen, Befunde je Checklistenpunkt).
2. **Große Befunde** (eng: ein struktureller Defekt in Erfassung oder Prozess, der eigene Planung und einen eigenen PR braucht) als eigene Issues, nach Priorität einsortiert.
3. **Kleine Befunde** gebündelt in **ein** Folgeticket „Langfuse-Folgen aus #<nr>" (`area:harness`, ohne Assignee) **ganz oben** im Board (ohne `afterId`). Gibt es schon ein ungeclaimtes, die Zeilen als Kommentar anhängen und es nach oben schieben. Keine kleinen Befunde, kein Folgeticket.
4. **Danach** das nächste Status-Ticket auf Position 20 anlegen (auch bei unerreichbarem Langfuse).
5. PR mit der Verdichtungszeile in model-routing.md und `Closes #<nr>`.

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
- **Status setzen:** ein per `addProjectV2ItemById` ergänztes Item bekommt Todo vom Board-Workflow „Item added to project" erst verzögert (rund 1 bis 2 Sekunden; Probe in #1309: Status leer bei t+0 s, Todo bei t+1 s); bis dahin fehlt es in der Auswahl (`.status == "Todo"`). Darum nach dem Hinzufügen den Status selbst auf Todo setzen, das gilt sofort und unabhängig vom Workflow (`gh project item-edit --id <ITEM> --project-id PVT_kwHOD8746c4Barq_ --field-id PVTSSF_lAHOD8746c4Barq_zhVhdTM --single-select-option-id f75ad846`). `gh project item-list` liefert frisch hinzugefügte Items verzögert, einen Moment warten. In Git-Bash ist `jq` nicht installiert; die `--jq`-Variante von `gh` genügt.
- **Mehrere Tickets auf einmal einsortieren (z.B. Epic-Aufteilung):** `node scripts/board-place.mjs --top <nr>…` bzw. `--after <ankernr> <nr>…` (`--dry-run` zeigt nur an) lädt die Board-Liste **einmal**, nutzt die Item-IDs wieder und setzt die Positionen nacheinander mit kurzer Pause; nie je Ticket die komplette Liste (`--limit 800`) neu laden. Noch nicht gelistete Nummern meldet das Skript (frische Items kommen verzögert): später erneut aufrufen. Bei `API rate limit exceeded` sofort stoppen, nur REST nutzen (Kommentar, Schließen, Labels) und den Board-Rest als Folgeaufgabe melden statt in einer Schleife weiterzuversuchen.
- **Abhängigkeit** („A vor B"): als Notiz `blockiert durch #X` in den **Body** des abhängigen Issues. Die Auswahl fängt das am Kandidaten-Check ab (offener Blocker → überspringen).
- **Unwichtig:** im Board nach unten ziehen, oder schließen bzw. löschen (`gh issue delete` nur mit Rückfrage). Ein Zurückstellen-Label gibt es nicht.
- **Neues Issue:** kommt **nicht** von selbst aufs Board (das Projekt hat nur „Auto-add sub-issues"). Nach `gh issue create` selbst hinzufügen (`addProjectV2ItemById`), Status Todo setzen (siehe „Status setzen") und einsortieren (`board-place.mjs` bzw. das Snippet oben).
- **Forum-Issues schieben sich selbst nach oben:** die Action [`.github/workflows/forum-inbox.yml`](../.github/workflows/forum-inbox.yml) schiebt ein frisch geflaggtes Forum-Ticket beim Anlegen an die **oberste** Board-Position (#747, GraphQL `addProjectV2ItemById` idempotent + `updateProjectV2ItemPosition`). ⚠️ Das braucht ein Repo-Secret **`PROJECT_TOKEN`** (PAT mit `project`-Scope) — das Standard-`GITHUB_TOKEN` kann kein User-Project V2 beschreiben; fehlt es, warnt die Action nur (Issue steht dann irgendwo im Board). Board-Node-ID: `PVT_kwHOD8746c4Barq_`.
- **Offene Dependabot-PRs sammeln sich selbst ein** (#712): die Action [`.github/workflows/dependabot-inbox.yml`](../.github/workflows/dependabot-inbox.yml) prüft täglich (+ `workflow_dispatch`), ob Dependabot-PRs offen sind, und legt bei Bedarf **ein** Sammel-Issue „🤖 Dependabot-PRs auflösen" an — direkt an die **oberste** Board-Position geschoben (dieselbe GraphQL-Verdrahtung/`PROJECT_TOKEN` wie bei den Forum-Issues), damit es beim nächsten „nächstes Ticket"-Griff sofort oben steht. Bleibt es offen, hängt jeder weitere Lauf nur den aktuellen PR-Stand als Kommentar an (kein Issue-Spam); sind keine Dependabot-PRs mehr offen, schließt die Action das Sammel-Issue automatisch. **Abarbeiten ohne Worktree/Code:** die gelisteten PRs einzeln gegen grüne CI prüfen (`gh pr checks <nr>`) und mergen (`gh pr merge <nr> --squash --delete-branch`), danach das Issue schließen.

## Am Ticket-Ende

Am Ticket-Ende ist **keine** Reihenfolge-Datei mehr zu pflegen. Der Abschluss ist: Issue schließen (via `Closes #<nr>` im gemergten PR), und — falls beim Arbeiten etwas auffiel — Spiel-/Inhalts-Befunde jeder Art als Issue an die richtige Board-Stelle, alles zum Harness als Zeile ins Sammelticket, nur Notfälle als Issue (oben).

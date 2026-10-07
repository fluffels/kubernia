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

1. **oberstes freies Item in der Board-Reihenfolge** — genau die Reihenfolge der Board-Items-Liste (= was in View 1 von oben nach unten steht). Keine Nachsortierung nach Inhalt oder Nummer.
2. **frei** heißt: **kein Assignee** (der „in Arbeit"-Marker), **kein** offener Branch/Worktree und **kein offener Blocker** (`blockiert durch #X` im Body).

Freie Auswahl in Board-Reihenfolge in einem Befehl (oberste Zeile ist „dran"), **über REST** (Core-Kontingent; `gh project item-list` läuft über GraphQL und kostet je Aufruf rund 200 Punkte, das Stunden-Limit war dadurch binnen 25 Minuten leer):

```bash
gh api --paginate "users/fluffels/projectsV2/1/items?per_page=100&fields=358708531" --jq '
  .[] | select(.content_type=="Issue" and (.fields[]? | select(.name=="Status") | .value.name.raw)=="Todo")
  | "#\(.content.number)\t\(.content.title)"'
```

> ⚠️ Die Board-Auswahl braucht **`read:project`-Scope** im `gh`-Token (`gh auth refresh -s project`). `--paginate` ist Pflicht (eine Seite hat nur 100 Items), `fields=358708531` ist die Feld-ID von „Status" (ohne sie fehlt der Status). **Nicht** sortieren — die Board-Reihenfolge ist hier das Maßgebliche. **`== "Todo"` (nicht `!= "Done"`)** — „In Progress"-Tickets dürfen gar nicht erst in der Kandidatenliste auftauchen, sonst greifen parallele Agenten irrtümlich dasselbe Ticket. **GraphQL nur für Mutationen** (Position setzen, Item hinzufügen, Status setzen); bei `API rate limit exceeded` nicht in einer Schleife weiterversuchen (siehe unten).

Dann nur **dieses eine** Kandidaten-Ticket kurz gegen den Live-Stand prüfen (`gh issue view <nr>`). **⛔ Hat das Ticket einen Assignee → sofort weiter zum nächsten, fertig. Kein Worktree inspizieren, kein Prüfen wie weit die Arbeit ist, kein Weiterarbeiten.** Ein Assignee bedeutet: ein anderer Agent arbeitet daran — nicht anfassen. Kein Assignee + offen + kein Blocker → sofort self-assignen (`gh issue edit <nr> --add-assignee @me`) und mit dem normalen Workflow abarbeiten (eigener Worktree → umsetzen → alle Gates grün + im Browser verifizieren → **ein** PR → CI abwarten + bis Merge). Voller Ablauf: [AGENTS.md](../AGENTS.md).

## Anlegen auf Position N

Gilt für das Harness-Sammelticket (`N` = Position laut AGENTS.md). `<Titel>`, Body und `N` einsetzen:

```bash
N=<Position>   # Harness-Sammelticket: Position laut AGENTS.md
NR=$(gh issue create --label area:harness --title "<Titel>" --body "<Body>" | grep -o '[0-9]*$')
NODE=$(gh issue view "$NR" --json id --jq .id)
ITEM=$(gh api graphql -f query='mutation($p:ID!,$c:ID!){ addProjectV2ItemById(input:{projectId:$p,contentId:$c}){ item{ id } } }' \
  -f p=PVT_kwHOD8746c4Barq_ -f c="$NODE" --jq .data.addProjectV2ItemById.item.id)
gh project item-edit --id "$ITEM" --project-id PVT_kwHOD8746c4Barq_ --field-id PVTSSF_lAHOD8746c4Barq_zhVhdTM --single-select-option-id f75ad846   # Status Todo sofort setzen (der Board-Workflow setzt es erst verzögert)
node scripts/board-place.mjs --position "$N" "$NR"   # N. Todo-Item (ohne das neue gezählt), kürzeres Board: ans Ende; Logik getestet in test/board.test.ts
```

Danach die Position prüfen: das Ticket ist das N. Todo-Item der Board-Liste (Auswahl-Befehl oben). Frische Items liefert die Liste teils verzögert: meldet das Skript „Noch nicht in der Board-Liste“, kurz warten und erneut aufrufen.

## Sammelticket „Harness-Härtung (gesammelt)" (#1199)

Regel: [AGENTS.md › Harness-Befunde sind Zeilen, keine Tickets](../AGENTS.md#wo-die-todos-leben). Es gibt **höchstens ein** ungeclaimtes Sammelticket (`area:harness`); ein geclaimtes (Assignee) läuft daneben weiter.

- **Befund eintragen:** erst suchen, dann als **Kommentar** anhängen (Kommentare kollidieren bei parallelen Agenten nicht, Body-Edits schon):
  ```bash
  gh issue list --state open --search 'in:title "Harness-Härtung (gesammelt)"' --limit 500 --json number,assignees --jq '[.[] | select((.assignees|length)==0) | .number] | max'
  gh issue comment <nr> --body "- [ ] <Befund>"
  ```
  Kein ungeclaimter Treffer → anlegen (unten). Zwei offene **ungeclaimte ohne gegenseitigen Blocker-Bezug** (Wettlauf) → das jüngere schließen, seine Zeilen ins ältere übertragen. Ein **Nachfolger** (Body `blockiert durch #<vorgänger>`, angelegt oder freigegeben, während der Vorgänger geclaimt war oder wegen eines Blockers freigegeben wurde) ist kein Wettlauf: beide bleiben, **neue Zeilen kommen ins jüngste ungeclaimte** Sammelticket (den Nachfolger), das ältere trägt weiter seinen Blocker und kommt zuerst dran, sobald der frei ist.

- **Anlegen auf der Position laut AGENTS.md** (fehlt ein ungeclaimtes, auch während ein geclaimtes abgearbeitet wird; vorher mit dem Suchbefehl oben prüfen, nie doppelt anlegen). **Wird es als Nachfolger angelegt, während der Vorgänger geclaimt ist, gehört `blockiert durch #<vorgänger>` gleich in den Body** (sonst ist der Nachfolger das oberste freie Item, obwohl er an den Dateien des Vorgängers hängt). Ablauf und Befehle: [Anlegen auf Position N](#anlegen-auf-position-n), hier mit `N` aus AGENTS.md und dem Titel „Harness-Härtung (gesammelt)".
- **Position:** neue Tickets klemmt `board-place` hinter das Harness-Sammelticket (und den folgenden Sammelblock, s. Abschnitt „Reihenfolge pflegen“); darüber stehen Notfälle und das Wochen-Status-Ticket. Derselbe Workflow wie beim Status-Ticket ([`langfuse-takt.yml`](../.github/workflows/langfuse-takt.yml), Push auf `main`) holt nach 5 Ticket-Merges seit dem Abschluss des letzten Sammeltickets (Commits auf `main` ohne Bots) das ungeclaimte Sammelticket **hinter den Kopf** (Status-, 🚨-, Dependabot-, Forum-Ticket stehen davor); steht es dort schon, tut er nichts, ein gespeicherter Zähler existiert nicht ([ADR 0016](adr/0016-langfuse-takt-woechentlich.md), Fortschreibung #1349). Der Kopf ist in `scripts/board-lib.mjs` (`istKopfItem`) definiert, die Marker stehen in den Inbox-Workflows.
- **Beim Claimen des Sammeltickets** sofort prüfen, ob ein ungeclaimtes existiert; fehlt es, direkt eines anlegen (unten), damit Befunde nie ohne Ziel sind.
- **Abarbeiten:** **alle** Zeilen umsetzen, kein Teil und kein Rest-Übertrag (sonst staut sich Arbeit an). Jede Zeile bekommt in **einem** PR ein **Ergebnis**: umgesetzt, geprüft und dokumentiert (die Entscheidung steht im PR-Text), oder, nur bei optionalen Teilen, begründet „bewusst nicht“. **Vor dem PR** die Kommentare erneut lesen: Zeilen, die während der Arbeit dazukamen, und Befunde, die dir oder den Lenses (`ausserhalbScope`) auffielen, kommen in denselben PR. Ist er dafür zu groß, deckt eine Commit-Zeile `KQ-Diffsize-Override: #<nr> <Grund>` das ab. Nur was wirklich nicht machbar ist, geht als Entscheidung an die Maintainerin; nichts wird still ausgelagert. Der PR löst auch die `ALLOWLIST`-Einträge auf, die auf das Sammelticket verweisen (es zählt als „offenes Ticket“, solange es offen ist), und schließt es per `Closes`. Erst danach entsteht bei neuen Befunden ein neues Sammelticket (Position laut AGENTS.md).
- **Konvergenz-Signal:** Zeilenzahl pro Sammelticket-Generation ([ADR 0012](adr/0012-harness-autonomie-audit-spur.md#fortschreibung-1199-2026-10-05-spielquote-sammelticket-abschlusskriterium)).

## Wiederkehrendes Ticket „Langfuse-Status überprüfen" (#1293)

Die breite, regelmäßige Auswertung der Langfuse-Daten. **Den Takt hält ein Workflow, kein Agent und keine Board-Position:** [`.github/workflows/langfuse-takt.yml`](../.github/workflows/langfuse-takt.yml) läuft **wöchentlich** (montags, zusätzlich per `workflow_dispatch`) und ruft [`scripts/langfuse-takt.mjs`](../scripts/langfuse-takt.mjs). Das Skript leitet jedes Mal aus den offenen Issues und der Commit-Liste von `main` ab, was zu tun ist (kein gespeicherter Zähler, idempotent): kein offenes Status-Ticket und mindestens 5 Commits auf `main` seit dem Abschluss des Vorgängers → anlegen (zusätzlich löst jeder Push auf `main` dieselbe Entscheidung aus, sobald seit dem Abschluss des Vorgängers mindestens 8 Ticket-Merges (ohne Bots) dazukamen; weniger tut er nichts, ein Ticket im Kopf bleibt liegen) (`area:harness`, ohne Assignee) und an die Spitze des Boards schieben; ein offenes ungeclaimtes → an die Spitze schieben; ein geclaimtes oder zu wenig Aktivität → nichts. Eine Concurrency-Group serialisiert gleichzeitige Auslösungen, ein Doppel-Ticket entsteht nicht. Begründung und Verworfenes: [ADR 0016](adr/0016-langfuse-takt-woechentlich.md). Agenten legen das Ticket nie selbst an; es gibt **höchstens ein** offenes (zwei offene durch einen Fehlgriff: das jüngere schließen). Die Checkliste steht einmal in [docs/model-routing.md › Langfuse-Status überprüfen](model-routing.md#langfuse-status-überprüfen-1293); hier nur die Mechanik.

**Body-Vorlage:** liefert `statusBody` im Skript (Zeitraum, Wochenfenster, Links, Abschluss); nicht hier doppeln.

**Abschluss, in dieser Reihenfolge:**

1. Bericht als Kommentar im Ticket (Einzelläufe, Zahlen, Befunde je Checklistenpunkt).
2. **Große Befunde** (eng: ein struktureller Defekt in Erfassung oder Prozess, der eigene Planung und einen eigenen PR braucht) als eigene Issues, nach Priorität einsortiert.
3. **Kleine Befunde** als Kommentar-Zeilen ins Sammelticket „Langfuse-Befunde (gesammelt)" ([Abschnitt unten](#langfuse-befunde-gesammelt-1351)); danach `node scripts/board-place.mjs --top <nr>`, damit es direkt drankommt. Keine kleinen Befunde, kein Sammelticket.
4. PR mit der Verdichtungszeile in model-routing.md und `Closes #<nr>`. Einen Nachfolger legt der Workflow an (auch bei unerreichbarem Langfuse).

### Langfuse-Befunde (gesammelt) (#1351)

Das Sammelticket „Langfuse-Befunde (gesammelt)" (`area:harness`) bündelt Befunde aus Langfuse-Daten, analog zum [Harness-Sammelticket](#sammelticket-harness-härtung-gesammelt-1199). Es ersetzt die früheren Einweg-Folgetickets je Status-Lauf.

- **Was hinein gehört:** Befunde, die aus Langfuse-Daten oder einem Status-Lauf stammen (Kosten, Tokens, Erfassungslücken, Kandidaten zum Lockern eines Gates, einer Lens oder einer Regel). Alles andere zum Harness bleibt im Harness-Sammelticket.
- **Höchstens ein** ungeclaimtes; ein geclaimtes (Assignee) läuft daneben weiter. Jeder Agent darf es jederzeit befüllen:
  ```bash
  gh issue list --state open --limit 1000 --json number,title,assignees --jq '.[] | select(.title=="Langfuse-Befunde (gesammelt)" and (.assignees|length)==0) | .number'
  gh issue comment <nr> --body "- [ ] <Befund>"
  ```
  Zwei ungeclaimte ohne gegenseitigen Blocker-Bezug (Wettlauf): das jüngere schließen, seine Zeilen ins ältere übertragen; ein Nachfolger mit `blockiert durch #<vorgänger>` ist keiner, neue Zeilen kommen ins jüngste ungeclaimte.
- **Anlegen nur bei Bedarf** (kein leeres Ticket, das sonst gezogen würde): wie im Snippet unter [Anlegen auf Position N](#anlegen-auf-position-n), aber ohne die `board-place`-Zeile. Es bleibt bewusst am Board-Ende (die „nie einfach ans Ende"-Regel gilt für Tickets, die sofort drankommen sollen); der Abschluss des nächsten Status-Laufs holt es mit `--top` nach oben, dabei klemmt der Anker hinter das ungeclaimte Harness-Sammelticket. Wer es beim Abschluss selbst anlegt, schiebt es sofort mit `--top`.
- **Abarbeiten:** komplett, wie beim Harness-Sammelticket (alle Zeilen in einem PR, je Zeile ein Ergebnis, nichts still auslagern). Ein **Lockern** (Gate, Lens, Regel) setzt der PR nur mit Messung vorher und nachher um, nie um ein Rot zu verstecken ([AGENTS.md › Kein Grün-durch-Aufweichen](../AGENTS.md#git-pr-und-merge)).

## Reihenfolge pflegen — im Board, nicht in einer Datei

Die manuelle Board-Reihenfolge ist die **einzige** Reihenfolge-Quelle; es gibt keine `prio:*`-Labels und kein `Prio`-Feld.

- **Reihenfolge ändern:** im Board (View 1) das Item per **Drag & Drop** hoch-/runterziehen. Weiter oben = früher dran. Das ist das „einpriorisieren".
- **Neues Item an die Spitze schieben** (per CLI, wenn kein UI-Zugriff; die Liste kommt per REST, nur die Positions-Mutation läuft über GraphQL). **Nie vor das ungeclaimte Sammelticket:** `--top`, `--after` und `--position` klemmen den Anker hinter das am weitesten hinten stehende von (a) dem offenen, nicht zugewiesenen Sammelticket „Harness-Härtung (gesammelt)“, wo es auch steht, und (b) den ungeclaimten Sammeltickets, die ab dem Harness-Sammelticket unmittelbar folgen (dem Sammelblock bis zum nächsten offenen, ungeclaimten Nicht-Sammelticket; dazu zählt auch „Langfuse-Befunde (gesammelt)“, wenn es dort steht; geclaimte und geschlossene Items überspringt der Block) und melden die Klemmung in der Ausgabe; ein geclaimtes oder geschlossenes Sammelticket zählt nicht, ohne ungeclaimtes Sammelticket klemmt nichts. Ganz oben stehen nur echte Notfälle und das Wochen-Status-Ticket, mit `--notfall <art>` (`rot-main`, `security`, `dependabot`, `forum`; nur mit `--top`; das Status-Ticket setzt der Workflow [`langfuse-takt.yml`](../.github/workflows/langfuse-takt.yml) selbst an die Spitze, [ADR 0016](adr/0016-langfuse-takt-woechentlich.md)); unbekannte Art oder andere Kombination ist ein Benutzungsfehler. Das Sammelticket selbst (`--position <N> <nr>`) klemmt nicht:
  ```bash
  node scripts/board-place.mjs --top <NR>                      # landet hinter dem Sammelticket
  node scripts/board-place.mjs --notfall rot-main --top <NR>   # echter Notfall: ganz oben
  ```
- **Status setzen:** ein per `addProjectV2ItemById` ergänztes Item bekommt Todo vom Board-Workflow „Item added to project" erst verzögert (rund 1 bis 2 Sekunden; Probe in #1309: Status leer bei t+0 s, Todo bei t+1 s); bis dahin fehlt es in der Auswahl (`.status == "Todo"`). Darum nach dem Hinzufügen den Status selbst auf Todo setzen, das gilt sofort und unabhängig vom Workflow (`gh project item-edit --id <ITEM> --project-id PVT_kwHOD8746c4Barq_ --field-id PVTSSF_lAHOD8746c4Barq_zhVhdTM --single-select-option-id f75ad846`). Die Board-Liste liefert frisch hinzugefügte Items verzögert, einen Moment warten. In Git-Bash ist `jq` nicht installiert; die `--jq`-Variante von `gh` genügt.
- **Mehrere Tickets auf einmal einsortieren (z.B. Epic-Aufteilung):** `node scripts/board-place.mjs --top <nr>…` bzw. `--after <ankernr> <nr>…` (`--dry-run` zeigt nur an) lädt die Board-Liste **einmal** (REST), nutzt die Item-IDs wieder und setzt die Positionen nacheinander mit kurzer Pause; nie je Ticket die komplette Liste neu laden. `--position <N> <nr>` setzt ein Ticket als N. Todo-Item (nie vor das Sammelticket, s.o.), `--missing` nennt offene Issues ohne Board-Item (nur Bericht; einsortieren ist eine Abwägung der Agentin, danach Status Todo setzen). Nummern, die die REST-Liste nicht liefert (frisch aufgenommene Items fehlen dort teils lange), holt das Skript per GraphQL (`issue.projectItems`, eine Abfrage je Nummer); steht ein Issue wirklich nicht im Board, meldet es das. Bei `API rate limit exceeded` sofort stoppen, nur REST nutzen (Kommentar, Schließen, Labels) und den Board-Rest als Folgeaufgabe melden statt in einer Schleife weiterzuversuchen.
- **Abhängigkeit** („A vor B"): als Notiz `blockiert durch #X` in den **Body** des abhängigen Issues. Die Auswahl fängt das am Kandidaten-Check ab (offener Blocker → überspringen).
- **Unwichtig:** im Board nach unten ziehen, oder schließen bzw. löschen (`gh issue delete` nur mit Rückfrage). Ein Zurückstellen-Label gibt es nicht.
- **Neues Issue:** kommt **nicht** von selbst aufs Board (das Projekt hat nur „Auto-add sub-issues"). Nach `gh issue create` selbst hinzufügen (`addProjectV2ItemById`), Status Todo setzen (siehe „Status setzen") und einsortieren (`board-place.mjs` bzw. das Snippet oben).
- **Forum-Issues schieben sich selbst nach oben:** die Action [`.github/workflows/forum-inbox.yml`](../.github/workflows/forum-inbox.yml) schiebt ein frisch geflaggtes Forum-Ticket beim Anlegen an die **oberste** Board-Position (#747, GraphQL `addProjectV2ItemById` idempotent + `updateProjectV2ItemPosition`). ⚠️ Das braucht ein Repo-Secret **`PROJECT_TOKEN`** (PAT mit `project`-Scope) — das Standard-`GITHUB_TOKEN` kann kein User-Project V2 beschreiben; fehlt es, warnt die Action nur (Issue steht dann irgendwo im Board). Board-Node-ID: `PVT_kwHOD8746c4Barq_`.
- **Offene Dependabot-PRs sammeln sich selbst ein** (#712): die Action [`.github/workflows/dependabot-inbox.yml`](../.github/workflows/dependabot-inbox.yml) prüft täglich (+ `workflow_dispatch`), ob Dependabot-PRs offen sind, und legt bei Bedarf **ein** Sammel-Issue „🤖 Dependabot-PRs auflösen" an — direkt an die **oberste** Board-Position geschoben (dieselbe GraphQL-Verdrahtung/`PROJECT_TOKEN` wie bei den Forum-Issues), damit es beim nächsten „nächstes Ticket"-Griff sofort oben steht. Bleibt es offen, hängt jeder weitere Lauf nur den aktuellen PR-Stand als Kommentar an (kein Issue-Spam); sind keine Dependabot-PRs mehr offen, schließt die Action das Sammel-Issue automatisch. **Abarbeiten ohne Worktree/Code:** die gelisteten PRs einzeln gegen grüne CI prüfen (`gh pr checks <nr>`) und mergen (`gh pr merge <nr> --squash --delete-branch`), danach das Issue schließen.

## Am Ticket-Ende

Am Ticket-Ende ist **keine** Reihenfolge-Datei mehr zu pflegen. Der Abschluss ist: Issue schließen (via `Closes #<nr>` im gemergten PR), und — falls beim Arbeiten etwas auffiel — Spiel-/Inhalts-Befunde jeder Art als Issue an die richtige Board-Stelle, alles zum Harness als Zeile ins Sammelticket, nur Notfälle als Issue (oben).

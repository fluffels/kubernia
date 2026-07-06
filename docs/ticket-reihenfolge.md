# Ticket-Auswahl

> **Seit #627 gibt es keine handsortierte Kopf-Liste mehr.** Die Priorität lebt im **GitHub-Project-Board** im Feld **Prio**, nicht in dieser Datei. Vorteil: Am Ticket-Ende muss **keine** gemeinsame Reihenfolge-Datei mehr gepflegt werden — parallele Agenten kollidieren nicht mehr auf ihr (das war die alte Merge-Konflikt-Quelle).

## Vor JEDEM Ticket — bewusst zweifeln (über allem)

Bevor irgendein Ticket angefasst wird, **zuerst zweifeln** — das steht über der Auswahl (voll in [AGENTS.md › Oberste Regel](../AGENTS.md)):

1. **Stardew-Scope-Frage:** „Ist das, was ich hier mache, noch sinnvoll, wenn Kubernia **so groß wie Stardew Valley** wird?" Nur umsetzen, wenn ja.
2. **Bisherige Entscheidungen aktiv anzweifeln** — auch abgeschlossene Tickets, ADRs, „gesetzte" Annahmen dürfen falsch sein.
3. **Auffälliges → sofort ein neues Issue anlegen** (Bug, Lücke, Tech-Debt, falsche Annahme) und die `Prio` setzen — nicht inline mitfixen, nicht „im Kopf" behalten.

## Was „nächstes Ticket" heißt

Rein deterministisch — **kein Abwägen nach Inhalt, kein Vorab-Sichten der ganzen Liste:**

1. **oberstes freies Ticket** nach **Prio → niedrigste Nummer**, gelesen aus dem Board-Feld `Prio`:
   **Kritisch → Hoch → Mittel → Niedrig → Später → (ohne Prio)**; innerhalb einer Stufe die niedrigste Nummer.
2. **frei** heißt: **kein Assignee** (der „in Arbeit"-Marker), **kein** offener Branch/Worktree, **nicht** `status:zurückgestellt`, und **kein offener Blocker** (`blockiert durch #X` im Body).

Fertig sortierte freie Auswahl in einem Befehl (oberste Zeile ist „dran"):

```bash
gh project item-list 1 --owner fluffels --format json --limit 800 --jq '
  .items
  | map(select(.content.type=="Issue" and (.status // "")!="Done" and (has("assignees")|not) and ((.labels // [])|index("status:zurückgestellt")|not)))
  | map(.r = (if .prio=="Kritisch" then 0 elif .prio=="Hoch" then 1 elif .prio=="Mittel" then 2 elif .prio=="Niedrig" then 3 elif .prio=="Später" then 4 else 5 end))
  | sort_by(.r, .content.number)
  | .[] | "\(.prio // "-")\t#\(.content.number)\t\(.title)"'
```

> ⚠️ Die Board-Auswahl braucht **`read:project`-Scope** im `gh`-Token (`gh auth refresh -s project`). Labels allein reichen nicht mehr — die Prio steckt im Board-Feld.

Dann nur **dieses eine** Kandidaten-Ticket kurz gegen den Live-Stand prüfen (`gh issue view <nr>`: offen? kein Assignee? kein offener Blocker?), zusätzlich `git worktree list` + `git branch -a` gegenchecken, sofort self-assignen (`gh issue edit <nr> --add-assignee @me`) und mit dem normalen Workflow abarbeiten (eigener Worktree → umsetzen → alle Gates grün + im Browser verifizieren → **ein** PR → CI abwarten + bis Merge). Ist der Kandidat schon zu/vergeben, das nächste der Liste nehmen. Voller Ablauf: [AGENTS.md](../AGENTS.md).

## Priorität pflegen — im Board, nicht in einer Datei

Das Board (`Prio`-Feld) ist die **einzige** Prio-Quelle; die früheren `prio:*`-Labels sind entfernt.

- **Prio setzen/ändern:** am Issue im Board das Feld `Prio` wählen (UI) oder per CLI:
  ```bash
  # Item-ID des Issues holen, dann Feld setzen (Option-IDs siehe unten)
  gh project item-edit --project-id PVT_kwHOD8746c4Barq_ \
    --id <ITEM_ID> --field-id PVTSSF_lAHOD8746c4Barq_zhXBLXs \
    --single-select-option-id <OPTION_ID>
  ```
  Option-IDs: Kritisch `0663cd9e` · Hoch `2c80551d` · Mittel `c565e67b` · Niedrig `62c882ac` · Später `32c104a9`.
- **Abhängigkeit** („A vor B"): als Notiz `blockiert durch #X` in den **Body** des abhängigen Issues. Die Auswahl fängt das am Kandidaten-Check ab (offener Blocker → überspringen), nicht im Sortier-Befehl.
- **Zurückstellen:** Label `status:zurückgestellt` (wird übersprungen, **nicht** verworfen). Reaktivieren = Label entfernen.
- **Neues Issue:** wandert per „Auto-add to project"-Board-Workflow automatisch aufs Board — danach **`Prio` setzen nicht vergessen** (ohne Prio landet es ganz unten).
- **Forum-Issues** setzen ihre `Prio` selbst: die Action [`.github/workflows/forum-inbox.yml`](../.github/workflows/forum-inbox.yml) setzt beim Anlegen direkt **Hoch** (#644, GraphQL mit den Feld-/Options-IDs oben). ⚠️ Das braucht ein Repo-Secret **`PROJECT_TOKEN`** (PAT mit `project`-Scope) — das Standard-`GITHUB_TOKEN` kann kein User-Project V2 beschreiben; fehlt es, warnt die Action nur (Issue ohne Prio). Feld-IDs: Projekt `PVT_kwHOD8746c4Barq_`, Prio-Feld `PVTSSF_lAHOD8746c4Barq_zhXBLXs`.

## Kein „puh, fertig"-Schritt mehr

Am Ticket-Ende ist **keine** Reihenfolge-Datei mehr zu pflegen (das war die alte, konfliktträchtige Kopf-Pflege). Der Abschluss ist nur noch: Issue schließen (via `Closes #<nr>` im gemergten PR) und — falls beim Arbeiten etwas auffiel — ein neues Issue mit gesetzter `Prio` anlegen. Das war's.

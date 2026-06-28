# Umsetzungs-Reihenfolge (alle Tickets)

> **Stand: 2026-06-28 — #315 erledigt (Container-ID nach `docker run --detach` im Bo-Lernblock erklärt). Der Backlog ist komplett `prio:niedrig`/ohne (keine `hoch`/`mittel` mehr offen), darum kuratiert der Kopf nach Wert statt nach Prio: jetzt restlicher Docker-Content als Anschluss an den Image-Arc (#369/#309/#218), dann Flavor/Fun (#302/#228/#229/#236/#237), dann tiefer Lernpfad (#281/#282/#430), dann Tech-Debt (#457), zuletzt die ⚠️-Sonderfälle. Alle ⚠️-Grafik-Tickets (#183/#186/#187/#190/#204 u.a.) bleiben bewusst im Auto-Rest, bis Design abgestimmt ist. Nächstes freies Ticket = oberstes des Kopfes (#369). Zuletzt abgeschlossen: #315 (Bo erklärt im `docker-run-options`-Block nach dem `--detach`/`--name`-Teach die lange Zeichenkette als **Container-ID** und stellt sie dem selbst gewählten `--name` gegenüber – Namen statt Hash merken; reine Erklär-Lücke, kein Bug; neuer Dialog-Schritt in `src/content/data/quests/bo.json`). Davor: #360 (Funk-Link wieder lesbar), #361 (Freies-Funken-Text klärt Spielwelt-Wirkung), #364 (Befehls-Badges nie mitten im Befehl umbrechen), #365 (docker-ps-Tabelle bündig), #458 (Quiz-Optionen als HTML statt esc()), #212 (nginx als Webserver in der Warenkunde erklärt), #450 (Bo-Quest `docker-rabbitmq`), #449 (Bo-Quest `docker-registry`), #448 (Bo-Quest `docker-common-images`). npm test 1211 / typecheck / lint / arch / size grün. Phase 9 + 10 komplett.**
> Sie ist die **kuratierte Vorne-Auswahl** über die generische Board-Sortierung (Prio→Nummer aus [AGENTS.md](../AGENTS.md)): das oberste freie Ticket des **Kopfes** ist „dran"; was nicht im Kopf steht, fällt automatisch auf Prio→Nummer zurück.

## Wie diese Liste funktioniert — drei Schichten

1. **Kopf (kuratiert, ~15–20 Tickets).** Die nächsten Tickets in **bewusster** Reihenfolge — abhängigkeitsbewusst und prio-informiert, nicht nur nach Label. **„Nächstes Ticket" = das oberste freie hier.** Siehe Tabelle unten.
2. **Auto-Rest.** Alles, was **nicht** im Kopf steht, wird **nicht** handsortiert, sondern fällt auf die generische, deterministische Board-Sortierung zurück: **Prio (`hoch`→`mittel`→`niedrig`→ohne), innerhalb der Prio niedrigste Nummer** (Befehl unten). So bleibt die Pflege billig und die Liste skaliert Stardew-fest, auch wenn der Backlog wächst.
3. **Reaktivierungs-Pool.** Die `status:zurückgestellt`-Tickets — geparkt, nicht verworfen. Werden **progressiv** wieder hereingeholt, wenn der Kopf sich leert (siehe unten). Bis dahin bei der Auswahl übersprungen.

## Vor JEDEM Ticket — bewusst zweifeln (über allem)

Bevor irgendein Ticket angefasst wird, **zuerst zweifeln** — das steht über der Reihenfolge:

1. **Stardew-Scope-Frage:** „Ist das, was ich hier mache, noch sinnvoll, wenn KubeQuest **so groß wie Stardew Valley** wird?" Nur umsetzen, wenn die Antwort Ja ist. Eine Lösung, die heute reicht, bei 10× Inhalt aber dasselbe Problem reproduziert, ist keine Lösung (oberste Regel, [AGENTS.md](../AGENTS.md)).
2. **Bisherige Entscheidungen aktiv anzweifeln** — nicht nur die eigene neue Arbeit. Auch **abgeschlossene Tickets, ADRs und „gesetzte" Annahmen** dürfen falsch sein. Wenn beim Bearbeiten auffällt, dass eine frühere Weiche bei Stardew-Scope nicht trägt: hinterfragen, nicht stillschweigend fortschreiben.
3. **Auffälliges → sofort Ticket anlegen** (Bug, Lücke, Tech-Debt, falsche Annahme) — nicht inline mitfixen, nicht „im Kopf" behalten. Lieber ein Ticket zu viel.
4. **Diese Liste danach pflegen** — neues/aufgefallenes Ticket an die passende Stelle einsortieren (siehe „Pflege" unten). Die Reihenfolge ist ein lebendes Dokument, kein einmaliger Plan.

## Grundsatz-Reviews (bewusst offen halten, nicht festlegen)

Diese Tickets sind **keine „bau-X"-Tickets**, sondern Entscheidungen, die man *reviewt und offen hält* — sie färben alle anderen und stehen darum **nicht** im sortierten Kopf:

- **#355** ⚠️ — **Auslieferungsform: Web-App vs. Desktop-Download (wie Stardew).** Bewusst **nicht** auf eine Option festlegen. Ergebnis als **ergebnisoffener ADR** (`docs/adr/0005-auslieferungsform.md`) mit Re-Eval-Trigger. → bei jeder save-/asset-/build-nahen Änderung mitdenken.

## Was „nächstes Ticket" heißt

Sagt die Maintainerin **„nächstes Ticket"** (für kubequest), dann:

1. **Direkt aus dem Kopf unten wählen — KEIN Vorab-Abgleich der ganzen Liste.** Das **oberste noch offene** Ticket des Kopfes nehmen, das
   - **kein** Assignee hat (Kollisionsschutz — siehe [AGENTS.md › Board-Workflow](../AGENTS.md)), und
   - keinen offenen Branch/Worktree hat, und
   - **kein** ⚠️-Sonderfall ist, der erst etwas braucht (siehe Flags in der Tabelle).

   Dabei **nur dieses eine Kandidaten-Ticket** kurz gegen den Live-Stand prüfen (`gh issue view <nr>`: offen? kein Assignee? Branch/Worktree-Gegencheck `git worktree list` + `git branch -a`). Ist es schon geschlossen / vergeben, das **nächste** des Kopfes nehmen. Die **ganze Liste wird NICHT vorab gegen GitHub abgeglichen** — Drift wird erst am Ende eingearbeitet (siehe „Pflege"). Das spart bei jeder Auswahl die teure Komplett-Sichtung.
2. **Ist der Kopf leer** (alle erledigt/vergeben), auf den **Auto-Rest** zurückfallen: das oberste freie Ticket nach **Prio→Nummer** (Befehl im nächsten Abschnitt) — und beim Pflege-Schritt den Kopf wieder auffüllen.
3. Das gewählte Ticket mit dem normalen kubequest-Workflow abarbeiten (self-assignen → eigener Worktree → umsetzen → Tests/Typecheck/Lint grün + im Browser verifizieren → nach `main` → Issue schließen). Details: [AGENTS.md](../AGENTS.md).
4. **Erst NACH getaner Arbeit diese Liste pflegen** — der „puh, fertig"-Schritt (siehe ganz unten).

## Reihenfolge — der Kopf

Leitlinie: **Prio zuerst**, innerhalb gleicher Prio nach Abhängigkeit (was etwas anderes ermöglicht, kommt davor), sonst niedrigste Nummer. Content-Arcs (echter Lernpfad-Fortschritt) stehen über QoL-/System-Features. No-dependency-Content-Füller (#218/#219/#228/#229/#236/#237/#239) leben im Auto-Rest — keine Abhängigkeit, kein Grund für den Kopf.

| # | Ticket | Prio | Worum's geht | Warum hier / Abhängigkeit |
|---|--------|------|--------------|---------------------------|
| | **— Docker-Content (knüpft direkt an den eben fertigen Image-Arc an) —** | | | |
| 1 | **#369** | niedrig | Erklären, wofür das „ps" in `docker ps` steht (process status) | Content, gleicher Docker-Bogen; klein. |
| 2 | **#309** | niedrig | Wording „Kiste" vs. „Container" — wann Metapher, wann echter Begriff | Content/Didaktik, betrifft die Docker-Dialoge. |
| 3 | **#218** | niedrig | Stapel-Spiel: mehr Beispiele/Übungsrunden + Cache/Build erklären | Content, baut auf vorhandenem Minispiel auf (kein neues System). |
| 4 | **#219** | niedrig | Spaced Repetition auf Stapel-Spiel/Drills ausweiten (gekonnt/nicht merken) | Lernpfad, baut direkt auf #218 auf (gleiches Minispiel). |
| | **— Flavor-/Fun-Content (Lernspaß, ohne Abhängigkeit) —** | | | |
| 5 | **#302** | niedrig | Bo Quest-1-Abschluss-Dialog: Üben-Hinweis auf Kralle umlenken | Content, kleiner Dialog-Fix (Kralle-Üben ist fertig). |
| 6 | **#228** | niedrig | Fun Fact: woher die 8 in K8s kommt (8 Buchstaben) | Content, schnell, hohe Lernspaß-Dichte. |
| 7 | **#229** | niedrig | Mehr (gute!) Fun Facts & Witze passend zu NPCs/Hafenwelt | Content, Lernspaß; lose Sammlung. |
| 8 | **#236** | niedrig | Kralle-Meilenstein-Sprüche: erwähnt zum wievielten Mal man übt (Zähler + Sprüche) | Content, Lernspaß; baut auf vorhandenem Kralle-Üben auf. |
| 9 | **#237** | niedrig | Kralle = Krabbe ohne Krallen — Running Gag draus machen (oder umbenennen) | Content/Flavor, kleiner Dialog-Bogen um Kralle. |
| | **— Tiefer Lernpfad —** | | | |
| 10 | **#281** | niedrig | Keycloak vertiefen: Realm, Client, User/Rollen/Gruppen, Mapper | Lernpfad-Vertiefung, eigenständiger Content-Block. |
| 11 | **#282** | niedrig | GitLab CI vertiefen: extends/Templates, rules/Trigger, Environments | Lernpfad-Vertiefung, eigenständiger Content-Block. |
| 12 | **#430** | niedrig | Gating-Konsistenz: Singular/Plural im Abkürzungs-Katalog (vs. #308) | Lernpfad-Logik, kleiner Konsistenz-Fix. |
| | **— Tech-Debt (sauber umsetzbar) —** | | | |
| 13 | **#457** | niedrig | `src/content/drills.ts` aufteilen (God-File-Budget 800 LOC, #169) | Tech-Debt, design-frei; hält die Architektur Stardew-fest. |
| | **— Sonderfälle ans Ende —** | | | |
| 14 | **#314** ⚠️ | niedrig | Zentrales Feier-Popup-System (Konfetti + Spruch) | **Optik-Ticket: erst Vorstellung + Referenzbilder mit der Maintainerin abstimmen** (übergreift #223). |
| 15 | **#293** ⚠️ | niedrig | Spiellogik-Review (anlegend) | **ZULETZT** — erst wenn der Backlog weitgehend leer ist (sonst veraltet das Review sofort). Erzeugt Folge-Tickets, kein direkter Fix. |

> ⚠️ **Optik-/Grafik-Tickets** (auch im Auto-Rest, z.B. #183/#186/#187/#190/#204/#223/#238/#289/#303/#311/#318/#336/#341/#342): vor dem Umsetzen die **Vorstellung + Referenzbilder** mit der Maintainerin abstimmen und die Stardew-Referenz lesen ([AGENTS.md › Grafik-Stil](../AGENTS.md), [docs/stardew-referenz.md](stardew-referenz.md)) — nicht selbst das Design festlegen.

## Auto-Rest — alles unterhalb des Kopfes

Steht ein Ticket **nicht** im Kopf, wird es **nicht** hier gepflegt, sondern nach der generischen Regel gewählt: **Prio (`hoch`→`mittel`→`niedrig`→ohne), dann niedrigste Nummer**. Fertig sortierte freie Auswahl in einem Befehl (oberste Zeile ist „dran"):

```bash
gh issue list --state open --limit 500 --json number,title,assignees,labels --jq '
  map(select((.assignees|length)==0))
  | map(select(any(.labels[];.name=="status:zurückgestellt")|not))
  | map(.prio = (if any(.labels[];.name=="prio:hoch") then 0 elif any(.labels[];.name=="prio:mittel") then 1 elif any(.labels[];.name=="prio:niedrig") then 2 else 3 end))
  | sort_by(.prio, .number)
  | .[] | "\(["hoch","mittel","niedrig","ohne"][.prio])\t#\(.number)\t\(.title)"'
```

(Branch/Worktree-Gegencheck trotzdem: `git worktree list` + `git branch -a`.) Diese Tickets müssen **nicht** in den Kopf gehoben werden — der Kopf wächst nur, wenn eine **Abhängigkeit** eine bewusste Vorziehung verlangt.

## Reaktivierungs-Pool — zurückgestellt, nicht verworfen

Die offenen Tickets mit Label **`status:zurückgestellt`** sind **nicht** verworfen. Leert sich der Kopf, werden die passenden **progressiv reaktiviert** (Label entfernen → an dependency-passende Stelle in den Kopf einsortieren). Nicht alles auf einmal — der Kopf wächst kontrolliert.

**Reaktivieren mit Augenmaß:** Manche können bedenkenlos reaktiviert werden. Andere brauchen zuerst eine **Scope-Klärung** (z.B. **#420** NPC-Tagesplan/Routinen, **#421** Item-/Inventar-Modell: was bedeutet „Stardew-Scope" für ein K8s-Lernspiel — Routinen/Crafting, oder vor allem Lern-Tiefe?) — die erst klären, dann reaktivieren.

Bei der Auswahl werden sie **übersprungen**, solange das Label dran ist — **maßgeblich ist immer das Label**, nicht eine Aufzählung hier.

Aktuellen Pool ansehen:

```bash
gh issue list --state open --limit 500 --label "status:zurückgestellt" \
  --json number,title,labels \
  --jq '.[] | "#\(.number)\t\(([.labels[].name]|map(select(startswith("area:")))|join(","))//"-")\t\(.title)"' | sort -n
```

## Pflege dieser Liste — der „puh, fertig"-Schritt

Diese Liste ist **lebendig** — sie wird **am Ende jedes Tickets** fortgeschrieben, **nicht** als Vorab-Check vor der Auswahl. Nach getaner Arbeit einmal den echten GitHub-Stand holen und Drift einarbeiten:

```bash
# Aktive (nicht zurückgestellte) offene Tickets, sortiert Prio→Nummer — Abgleich gegen den Kopf
gh issue list --state open --limit 500 --json number,title,labels,assignees --jq '
  map(select(any(.labels[];.name=="status:zurückgestellt")|not))
  | map(.prio = (if any(.labels[];.name=="prio:hoch") then 0 elif any(.labels[];.name=="prio:mittel") then 1 elif any(.labels[];.name=="prio:niedrig") then 2 else 3 end))
  | sort_by(.prio, .number)
  | .[] | "\(["hoch","mittel","niedrig","ohne"][.prio])\t#\(.number)\tassignee:\([.assignees[].login]|join(","))\t\(.title)"'
```

Dann:

- **Gerade erledigt / sonst geschlossen** → Zeile aus dem Kopf entfernen (GitHub-Issue-Status ist die SSOT für „erledigt"; erledigte Tickets werden hier **entfernt, nicht durchgestrichen**).
- **Kopf zu kurz geworden** (< ~15) → von oben aus dem **Auto-Rest** (Prio→Nummer) **und/oder dem Reaktivierungs-Pool** nachfüllen, bis wieder ~15–20 erreicht sind. Aus dem Pool nur reaktivieren, was wirklich dran ist (Scope-Klärung beachten).
- **Neues offenes Ticket mit echter Abhängigkeit** → an die dependency-passende Stelle in den Kopf einsortieren, nicht unten anhängen. Ein Ticket **ohne** besondere Abhängigkeit muss **nicht** in den Kopf — es lebt im Auto-Rest.
- **Altentscheidung wackelt** → als Grundsatz-Review oben aufnehmen (wie #355), nicht stillschweigend fortschreiben.
- **Driftet die Liste → Doku fixen, Stand-Datum oben aktualisieren, committen** (Doku-only → kein Test-Lauf).
- Bei Unklarheit über die Position: „Ist das okay, wenn KubeQuest Stardew-groß wird?" (oberste Regel, [AGENTS.md](../AGENTS.md)) entscheidet vor dem Prio-Label.

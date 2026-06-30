# Umsetzungs-Reihenfolge (alle Tickets)

> **Stand: 2026-06-30 — zuletzt #336:** Spielstart morgens um 06:00 statt 12:00 — gemeinsamer Start-Offset `START_PHASE = 0.75` in `clock.ts` (`withStartOffset`), aus dem HUD-Uhr UND Tag-Nacht-Schleier ziehen (synchron, keine doppelte Zeit-Verbiegung); Tageszähler bleibt am Start Tag 1, springt erst zur ersten Mitternacht auf Tag 2 (Off-by-one per Test abgesichert). npm test 1309 / typecheck / lint grün, Start-Schleier (alpha 0.195) + 06:00 end-to-end verifiziert. **Nächstes freies Ticket = oberstes des Kopfes** (z.B. #457 `drills.ts` aufteilen).
>
> _Frühere Tickets (Kurzfassung — volle Details in git-History + Brain `Projekte/KubeQuest`):_ #362 freies Funken „Was ist gerade passiert?"-Erklärung · #359 `help` im CLI-Format · #358 `help` zeigt nur Freigeschaltetes · #328 Sandbox-Vertiefungs-Quiz · #278 Sammelalbum/Glossar · #279 Lernkarten-Backfill · #460–#466 Aufbau-Bogen (Epic #239, kubeadm + Terraform-Cluster) · #430 Gating-Konsistenz · #281/#282 Keycloak-/CI-Vertiefung · #237 Kralle-Gag.
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
   - **kein** ⚠️-Sonderfall ist, der erst etwas braucht (siehe Flags in der Tabelle). **🎨-Optik-Tickets sind KEIN solcher Sonderfall** — sie werden ganz normal gewählt; das Aussehen wird WÄHREND der Umsetzung per Rückfrage abgestimmt (Vorschlag/Referenz/Asset vorlegen). ⚠️ bleibt nur für echte Sonderfälle: **Epic → aufteilen** (#317), **riskant → erst evaluieren** (#443), **Review → zuletzt** (#293), **Grundsatz-Review → offen halten** (#355).

   Dabei **nur dieses eine Kandidaten-Ticket** kurz gegen den Live-Stand prüfen (`gh issue view <nr>`: offen? kein Assignee? Branch/Worktree-Gegencheck `git worktree list` + `git branch -a`). Ist es schon geschlossen / vergeben, das **nächste** des Kopfes nehmen. Die **ganze Liste wird NICHT vorab gegen GitHub abgeglichen** — Drift wird erst am Ende eingearbeitet (siehe „Pflege"). Das spart bei jeder Auswahl die teure Komplett-Sichtung.
2. **Ist der Kopf leer** (alle erledigt/vergeben), auf den **Auto-Rest** zurückfallen: das oberste freie Ticket nach **Prio→Nummer** (Befehl im nächsten Abschnitt) — und beim Pflege-Schritt den Kopf wieder auffüllen.
3. Das gewählte Ticket mit dem normalen kubequest-Workflow abarbeiten (self-assignen → eigener Worktree → umsetzen → Tests/Typecheck/Lint grün + im Browser verifizieren → nach `main` → Issue schließen). Details: [AGENTS.md](../AGENTS.md).
4. **Erst NACH getaner Arbeit diese Liste pflegen** — der „puh, fertig"-Schritt (siehe ganz unten).

## Reihenfolge — der Kopf

Leitlinie: **Prio zuerst**, innerhalb gleicher Prio nach Abhängigkeit (was etwas anderes ermöglicht, kommt davor), sonst niedrigste Nummer. Content-Arcs (echter Lernpfad-Fortschritt) stehen über QoL-/System-Features. No-dependency-Content-Füller (#218/#219/#228/#229/#236/#237/#239) lebten im Auto-Rest — keine Abhängigkeit, kein Grund für den Kopf; einige davon sind inzwischen erledigt, der verbleibende design-freie Content (#239/#279/#278) ist hier nach Wert kuratiert, weil der Backlog rein `prio:niedrig`/ohne ist.

| # | Ticket | Prio | Worum's geht | Warum hier / Abhängigkeit |
|---|--------|------|--------------|---------------------------|
| | **— Tiefer Lernpfad (Aufbau-Bogen #239 komplett: #460–#466 erledigt; #279 Backfill + #278 Sammelalbum + #328 Sandbox-Lernthema erledigt) —** | | | |
| | **— Tech-Debt (sauber umsetzbar) —** | | | |
| 1 | **#457** | niedrig | `src/content/drills.ts` aufteilen (God-File-Budget 800 LOC, #169) | Tech-Debt, design-frei; hält die Architektur Stardew-fest. |
| 2 | **#459** | niedrig | kubectl-secrets-Pseudo-Abkürzung überdenken (secret keine echte Kontraktion) | Tech-/Pädagogik-Debt, design-frei; direkte #430-Folge, kleiner Konsistenz-Fix. |
| 3 | **#441** | niedrig | char_knut.png ist 68×68 statt 48² – Knut rendert ~40 % zu groß | Bug, design-frei; Asset auf die etablierte Figurengröße bringen (kein Design-Entscheid). |
| 4 | **#382** | niedrig | Doku-Inkonsistenz: Worktree-Pfad-Konvention (AGENTS.md vs CLAUDE.md vs launch.json) | Tech-Debt/Doku, design-frei; klärt eine widersprüchliche Konvention. |
| 5 | **#296** | niedrig | Reset-Fix (#295) manuell im Browser verifizieren | Verifikation, design-frei; reiner Browser-Check eines schon gefixten Verhaltens. |
| 6 | **#443** ⚠️ | niedrig | Phaser 4 evaluieren/migrieren (Dependabot-Major #433, CI rot) | Tech-Debt, design-frei, aber **groß/riskant** (Major-Migration) — erst evaluieren (Breaking Changes, Aufwand), dann entscheiden; nicht blind mergen. |
| | **— Anlegende / Epic —** | | | |
| 7 | **#277** | niedrig | Ideen-Ticket: weitere Minispiele überlegen & dafür Tickets anlegen | Anlegend, design-frei; erzeugt Folge-Tickets statt direktem Fix. |
| 8 | **#317** ⚠️ | niedrig | EPIC: Komfort-Funktionen im Shop kaufen + Shop-Überarbeitung | **Epic → aufteilen statt umsetzen** (session-große Kinder anlegen, Epic auf done schließen). |
| | **— 🎨 Optik / Grafik (werden GANZ NORMAL automatisch gewählt; das Aussehen stimmt der Agent WÄHREND der Umsetzung per Rückfrage mit der Maintainerin ab — Referenz/Vorschlag/generiertes Asset vorlegen, entscheiden lassen, iterieren; NICHT vorab gaten, NICHT selbst das Design festlegen) —** | | | |
| 9 | **#183** 🎨 | niedrig | Hafen-Kanone als Pixelart-Asset statt Emoji 💣 | Optik — Asset-Look während der Umsetzung abstimmen. |
| 10 | **#186** 🎨 | niedrig | Außen-Türen der Gebäude als Pixelart statt prozeduraler Rechtecke | Optik — Look während der Umsetzung abstimmen. |
| 11 | **#187** 🎨 | niedrig | Interior-Einrichtung (Bullaugen/Türen/Wandschatten) als Pixelart | Optik — Look während der Umsetzung abstimmen. |
| 12 | **#223** 🎨 | niedrig | Rang-Aufstieg mit Feier-Popup (alter → neuer Rang) statt nur Toast | Optik/UX — gehört mit #314 zusammen; Look während der Umsetzung abstimmen. |
| 13 | **#238** 🎨 | niedrig | Container laufen visuell in Pods (Fässer im Schiffsrumpf) | Optik/Visualisierung — Look während der Umsetzung abstimmen. |
| 14 | **#314** 🎨 | niedrig | Zentrales Feier-Popup-System (Konfetti + Spruch) | Optik — Look während der Umsetzung abstimmen (übergreift #223). |
| | **— Zuletzt —** | | | |
| 15 | **#293** ⚠️ | niedrig | Spiellogik-Review (anlegend) | **ZULETZT** — erst wenn der Backlog weitgehend leer ist (sonst veraltet das Review sofort). Erzeugt Folge-Tickets, kein direkter Fix. |

> **Aufbau-Bogen-Optik #467** 🎨 (zerstörter Hafen → Wiederaufbau) wird wie jedes Optik-Ticket normal gewählt; der Look wird während der Umsetzung mit der Maintainerin abgestimmt — kein Vorab-Gate, kein Blocker für den Lerninhalt (#460–#466).

> 🎨 **Optik-/Grafik-Tickets** (z.B. #183/#186/#187/#190/#204/#223/#238/#289/#303/#311/#318/#341/#342/#467): werden **automatisch wie jedes andere Ticket gewählt**. Das konkrete Aussehen legt der Agent **nicht selbst** fest, sondern stimmt es **während der Umsetzung per Rückfrage** mit der Maintainerin ab (Stardew-Referenz lesen — [AGENTS.md › Grafik-Stil](../AGENTS.md), [docs/stardew-referenz.md](stardew-referenz.md) —, dann Vorschlag/Referenz/generiertes Asset vorlegen und entscheiden lassen, iterieren). Also: dranmachen ja, Design-Entscheidung interaktiv.

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

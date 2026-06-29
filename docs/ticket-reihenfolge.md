# Umsetzungs-Reihenfolge (alle Tickets)

> **Stand: 2026-06-29 — #461 erledigt: Sturm-Einstiegsquest des Aufbau-Bogens. Neue Quest `aufbau-sturm` (Geber Ole, Hafenmeister) ans Ende von `quest-order.json`; neues Topic `cluster-aufbau`. Rein Content-as-Data: Sturm-Drama-Dialog → `ls`/`cat lagebericht.txt` (Schaden begutachten) → zwei Choices (warum „connection refused"? womit fängt der Wiederaufbau an?) → Handoff zur Control-Plane (#462). Sim-Wiring: `mergeScenario` honoriert jetzt `{ bareMetal: true }` und zerstört den laufenden Cluster zur Laufzeit (Nodes/Workloads weg, Control-Plane down, Baupläne bleiben) über den puren Helfer `applyBootstrapScenario` (in `sim/kubeadm.ts`, hält `sim.ts` unter 800 LOC). Bewusst KEINE erroring Task-Solution (`quests.test` verlangt `!result.error`) — der „connection refused"-Aha kommt per Choice. 3 neue Tests; README 59→60; savemigration-Test um die angehängte Quest erweitert. npm test 1256 / typecheck / lint / arch / size / smoke grün, im Browser verifiziert. Nächstes freies Ticket = oberstes des Kopfes (#462). — Davor #460 erledigt: Sim-Fundament des Aufbau-Bogens. Neues serialisiertes `ClusterState`-Feld `controlPlane {up,token,node}` + Szenario-Flag `bareMetal` (leerer/zerstörter Cluster: keine Nodes + Control-Plane down; Default `up:true` lässt alle Alt-Szenarien unberührt; Round-trip über snapshot/reset). Neue Befehlsfamilie `src/sim/kubeadm.ts`: `init` (Control-Plane hoch + Join-Token), `join <token>` (Worker anschließen, plant Pending-Pods ein), `reset` (zurück auf bare metal). Zentrales kubectl-Gate: vor `kubeadm init` scheitert jeder kubectl-Befehl mit „connection refused". 14 neue Tests (Happy-Path + Negativfälle join-vor-init/doppeltes-init/kubectl-vor-init/falscher Token + snapshot-Round-trip, Red-Green). npm test 1253 / typecheck / lint / arch / size grün. Pure Domäne, Basis für #461–#466. Nächstes freies Ticket = oberstes des Kopfes (#461). — Davor #239 als Epic aufgeteilt (Lernbogen „Cluster nach Sturm selbst aufbauen", Spät-Spiel). Mit der Maintainerin abgestimmt: groß/umfassend, aber alles in der Spielwelt simuliert (kein lokales kind/minikube) — Tiefe über kubeadm-Konzepte + Terraform-Provisioning; Optik separat als ⚠️-Ticket. In sieben session-große Kinder zerlegt (abhängige Kette, jetzt im Kopf): #460 Sim-Fundament (zuerst) → #461 Sturm-Einstiegsquest → #462 Control-Plane (kubeadm init) → #463 Worker-Knoten (kubeadm join) → #464 Dienste wieder ausbringen → #465 Capstone „Cluster als Code" (Terraform) → #466 Crab-Quiz-Vertiefung; dazu #467 ⚠️ Optik (bleibt im Auto-Rest bis Referenzbild-Abstimmung). Epic #239 auf done geschlossen. Nächstes freies Ticket = oberstes des Kopfes (#460). — Davor #430 erledigt: Gating-Konsistenz Singular/Plural im Abkürzungs-Katalog. Das #308-Prinzip (ausgeschriebene Voll-Formen sind keine Profi-Abkürzung) gilt jetzt einheitlich für alle Ressourcen, Singular wie Plural: nur echte Kontraktionen (po/no/svc/netpol/netpols/ing) sind freischaltpflichtig. `networkpolicy` (Singular) + `ingresses` (Plural) raus aus dem Gating; die netpol-describe/-delete-Musterlösungen wieder auf die natürliche Singularform `kubectl describe/delete networkpolicy <name>` (statt der von #380 erzwungenen Plural-Langform). Bewusste Ausnahme dokumentiert: `secret` bleibt gegated (secrets hat keinen offiziellen kubectl-Kurznamen) → Folgeticket #459 (entfernen vs. behalten). Vier neue Gating-Tests (#430) inkl. Red-Green-Gegenprobe. npm test 1239 / typecheck / lint grün. Nächstes freies Ticket = oberstes des Kopfes (#239). — Davor #282 erledigt: GitLab-CI vertiefen. Fünf Vertiefungs-Quizkarten (`q-ci-4..8`) in `src/content/data/crabquiz/git.json`, freigeschaltet nach der Pipeline-Passage (`chapter=git-pipeline`). Konzepte: `extends`/Templates (DRY), `rules`/`when` (wann läuft ein Job), `when: manual` (Schutz vor versehentlichem Prod-Deploy), `environment` (dev/qs/prod-Buchführung), CI-Variablen/Secrets statt Klartext im Repo. Test #282 sichert Existenz/chapter/correct-Index/Pflicht-Erklärung + Begriffsabdeckung. npm test 1235 / typecheck / lint / smoke grün. Nächstes freies Ticket = oberstes des Kopfes (#430). — Davor #281 erledigt: Keycloak-Vertiefung. Vier Quiz-Karteikarten (`q-keycloak-*`) in `src/content/data/crabquiz/keycloak.json`, freigeschaltet nach der Keycloak-Quest `kraken-boss` (Terraform-als-Code ist dort längst eingeführt). Auf Konzept-Ebene: Realm vs. Client, Rolle vs. Gruppe, Protocol Mapper (was landet im Token), IDP-Config deklarativ als `keycloak_*`-Terraform-Ressourcen. Test #281 sichert Existenz/chapter/correct-Index/Pflicht-Erklärung + Begriffsabdeckung. npm test 1234 / typecheck / lint / smoke grün. Nächstes freies Ticket = oberstes des Kopfes (#282). — Davor #237 erledigt: Kralle-Running-Gag (krallenlose Krabbe wünscht sich Krallen). Kralle ist eine Krabbe ohne Krallen – das wird zum Gag: am Wissensrunden-Endscreen streut sie ab und zu (jede 7. Übungsrunde, nie auf einem Meilenstein) wehmütig-frech ein, dass sie zu gern echte Krallen hätte. Pure Logik `kralleClawAside(count)` in `src/kralle.ts` (dosiert, deterministisch rotierend, Meilenstein #236 hat Vorrang); `recordKrallePractice` liefert nun `{milestone, aside}`; neue `.kralle-aside`-Box (kühl/wehmütig, abgesetzt vom goldenen Meilenstein). Unit-getestet, im Browser verifiziert. Der Backlog ist komplett `prio:niedrig`/ohne (keine `hoch`/`mittel` mehr offen), darum kuratiert der Kopf nach Wert statt nach Prio: jetzt tiefer Lernpfad (#281/#282/#430) + Lernbogen-Content (#239/#279/#278), dann QoL/Didaktik (#358/#359/#362/#363), dann Tech-Debt (#457/#382), zuletzt die anlegenden/⚠️-Sonderfälle. Alle ⚠️-Grafik-Tickets (#183/#186/#187/#190/#204 u.a.) bleiben bewusst im Auto-Rest, bis Design abgestimmt ist. Nächstes freies Ticket = oberstes des Kopfes (#281). Davor: #236 (Kralle-Meilenstein-Sprüche), #229 (Fun Facts & Wortherkünfte), #228, #302, #219, #218, #309, #369, #315, #360/#361/#364/#365/#458/#212. npm test 1233 / typecheck / lint / arch / size grün. Phase 9 + 10 komplett.**
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

Leitlinie: **Prio zuerst**, innerhalb gleicher Prio nach Abhängigkeit (was etwas anderes ermöglicht, kommt davor), sonst niedrigste Nummer. Content-Arcs (echter Lernpfad-Fortschritt) stehen über QoL-/System-Features. No-dependency-Content-Füller (#218/#219/#228/#229/#236/#237/#239) lebten im Auto-Rest — keine Abhängigkeit, kein Grund für den Kopf; einige davon sind inzwischen erledigt, der verbleibende design-freie Content (#239/#279/#278) ist hier nach Wert kuratiert, weil der Backlog rein `prio:niedrig`/ohne ist.

| # | Ticket | Prio | Worum's geht | Warum hier / Abhängigkeit |
|---|--------|------|--------------|---------------------------|
| | **— Tiefer Lernpfad: Aufbau-Bogen (#239 aufgeteilt, abhängige Kette; #460 Fundament + #461 Sturm-Einstieg erledigt) —** | | | |
| 1 | **#462** | niedrig | Quest: Control-Plane aufbauen (`kubeadm init`) | Nutzt #460-Fundament; folgt direkt der Sturm-Quest #461 (Cluster ist bare metal). |
| 2 | **#463** | niedrig | Quest: Worker-Knoten anschließen (`kubeadm join`, Node für Node) | Nach #462. |
| 3 | **#464** | niedrig | Quest: Dienste wieder ausbringen (Workloads Pod für Pod) | Nach #463; vorhandene apply-Mechanik. |
| 4 | **#465** | niedrig | Capstone: Cluster als Code wieder aufbauen (Terraform-Provisioning) | Pointe manuell ↔ als Code; nutzt #460 + Terraform-Familie. |
| 5 | **#466** | niedrig | Crab-Quiz: Bootstrapping-Konzepte vertiefen (#281/#282-Muster) | Braucht ein chapter aus den Aufbau-Quests. |
| | **— Tiefer Lernpfad: weitere —** | | | |
| 6 | **#279** | niedrig | Nachträglich eingeführte Inhalte auch Fortgeschrittene erreichen lassen (Backfill) | Lernpfad-Logik, design-frei; ergänzt #353/#354-Fundament. |
| 7 | **#278** | niedrig | Sammelalbum/Glossar: alle Befehle & Wissen entdecken und sammeln | Content/Lernpfad, design-frei; sammelt vorhandenes Wissen, kein neues Asset. |
| 8 | **#328** | niedrig | Lernthema Sandbox / ephemere Umgebungen: gefahrlos ausprobieren | Content/Lernpfad, design-frei; nutzt das vorhandene Wiederspiel-Feature (#326/#332) als lebendes Beispiel. |
| | **— QoL / Didaktik (design-frei) —** | | | |
| 9 | **#358** | ohne | help zeigt nur freigeschaltete Befehle (zu Spielbeginn: keine/nur help) | UX/Didaktik, design-frei; eng mit #359 (beide am help-Befehl). |
| 10 | **#359** | ohne | help-Ausgabe: console-typisches Format (ein Befehl pro Zeile) | UX, design-frei; gehört zu #358. |
| 11 | **#362** | ohne | Freies Funken: nach Befehlsausführung Erklärung einblenden | Didaktik, design-frei; vertieft das freie Funken-Terminal. |
| 12 | **#363** | ohne | Freies Funken: echte Tool-Namen/Images durch spielweltinterne Begriffe ersetzen | Content/Konsistenz, design-frei; gehört zu #362. |
| | **— Tech-Debt (sauber umsetzbar) —** | | | |
| 13 | **#457** | niedrig | `src/content/drills.ts` aufteilen (God-File-Budget 800 LOC, #169) | Tech-Debt, design-frei; hält die Architektur Stardew-fest. |
| 14 | **#459** | niedrig | kubectl-secrets-Pseudo-Abkürzung überdenken (secret keine echte Kontraktion) | Tech-/Pädagogik-Debt, design-frei; direkte #430-Folge, kleiner Konsistenz-Fix. |
| 15 | **#382** | niedrig | Doku-Inkonsistenz: Worktree-Pfad-Konvention (AGENTS.md vs CLAUDE.md vs launch.json) | Tech-Debt/Doku, design-frei; klärt eine widersprüchliche Konvention. |
| | **— Anlegende / Sonderfälle ans Ende —** | | | |
| 16 | **#277** | niedrig | Ideen-Ticket: weitere Minispiele überlegen & dafür Tickets anlegen | Anlegend, design-frei; erzeugt Folge-Tickets statt direktem Fix. |
| 17 | **#314** ⚠️ | niedrig | Zentrales Feier-Popup-System (Konfetti + Spruch) | **Optik-Ticket: erst Vorstellung + Referenzbilder mit der Maintainerin abstimmen** (übergreift #223). |
| 18 | **#293** ⚠️ | niedrig | Spiellogik-Review (anlegend) | **ZULETZT** — erst wenn der Backlog weitgehend leer ist (sonst veraltet das Review sofort). Erzeugt Folge-Tickets, kein direkter Fix. |

> **Aufbau-Bogen-Optik #467** ⚠️ (zerstörter Hafen → Wiederaufbau) bleibt bewusst im **Auto-Rest**, bis die Vorstellung + Referenzbilder mit der Maintainerin abgestimmt sind — kein Blocker für den Lerninhalt (#460–#466).

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

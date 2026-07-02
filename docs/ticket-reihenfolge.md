# Umsetzungs-Reihenfolge (alle Tickets)

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
   - keinen offenen Branch/Worktree hat.

   **Kein Flag verhindert das Loslegen** — die Flags sagen nur, WIE man loslegt (nicht OB): **🎨 Optik** → dranmachen, den Look während der Umsetzung per Rückfrage abstimmen; **📦 Epic** → mit der **Aufteilung** loslegen (session-große Kinder anlegen, Epic auf done schließen); **⚠️ riskant** → mit dem **Evaluieren** loslegen. Reihenfolge-Hinweise wie „Review zuletzt" (#293) oder „Grundsatz offen halten" (#355) sind reine Positionierung, kein Gate.

   Dabei **nur dieses eine Kandidaten-Ticket** kurz gegen den Live-Stand prüfen (`gh issue view <nr>`: offen? kein Assignee? Branch/Worktree-Gegencheck `git worktree list` + `git branch -a`). Ist es schon geschlossen / vergeben, das **nächste** des Kopfes nehmen. Die **ganze Liste wird NICHT vorab gegen GitHub abgeglichen** — Drift wird erst am Ende eingearbeitet (siehe „Pflege"). Das spart bei jeder Auswahl die teure Komplett-Sichtung.
2. **Ist der Kopf leer** (alle erledigt/vergeben), auf den **Auto-Rest** zurückfallen: das oberste freie Ticket nach **Prio→Nummer** (Befehl im nächsten Abschnitt) — und beim Pflege-Schritt den Kopf wieder auffüllen.
3. Das gewählte Ticket mit dem normalen kubequest-Workflow abarbeiten (self-assignen → eigener Worktree → umsetzen → Tests/Typecheck/Lint grün + im Browser verifizieren → nach `main` → Issue schließen). Details: [AGENTS.md](../AGENTS.md).
4. **Erst NACH getaner Arbeit diese Liste pflegen** — der „puh, fertig"-Schritt (siehe ganz unten).

## Reihenfolge — der Kopf

Leitlinie: **Prio zuerst**, innerhalb gleicher Prio nach Abhängigkeit (was etwas anderes ermöglicht, kommt davor), sonst niedrigste Nummer. Content-Arcs (echter Lernpfad-Fortschritt) stehen über QoL-/System-Features. No-dependency-Content-Füller (#218/#219/#228/#229/#236/#237/#239) lebten im Auto-Rest — keine Abhängigkeit, kein Grund für den Kopf; einige davon sind inzwischen erledigt, der verbleibende design-freie Content (#239/#279/#278) ist hier nach Wert kuratiert, weil der Backlog rein `prio:niedrig`/ohne ist.

> **⭐ Kopf-Reihenfolge (Stand 2026-07-02, #546 erledigt):** Harness-&-Vorzeige-Doku (#525–#533) **und der komplette iSAQB-MITTEL-Block (#514/#498/#502–#506) sind abgearbeitet**, ebenso die Epics **#535/#536** (in Kinder zerlegt). Die **#536-Ordner-Slices sind komplett (#548/#549/#550/#551/#552 ✓)**. Der **save-kritische #535-Rename-Slice #557 ist erledigt (#553/#554/#557 ✓)** — Storage-Keys + IndexedDB-DB-Name heißen jetzt `kubernia`, Alt-Stände werden verlustfrei migriert; offen bleibt nur die Repo-URL-Nachziehung **#558** (geparkt `status:zurückgestellt`, blockiert durch die GitHub-Repo-Rename-Aktion der Maintainerin) sowie die Doku-/Build-Strings **#555/#556** (Auto-Rest niedrig). Oben steht jetzt der **NIEDRIG-God-File-Split-Block #516–#524** (#515 store.ts-Split ✓, **#516 Host-Seams per Pick/ISP ✓**, **#517 loader.ts-Split ✓** — Barrel + generische Helfer `loadGroups`/`assembleUnique`/`makeGlobLoader` + 8 Sammlungs-Leaves, **#518 erledigt ✓** — Sim-Duplizierung eingesammelt (`_makeService` in `argoReconcile`, positions-agnostischer `resolveDeploymentRef`, datengetriebener `SIMPLE_DELETABLE`-Delete-Block + `spliceByName`), **#519 Content-Typ-Dedup ✓** — QuizCard/CmdCard aus dem Loader statt Kopie in validate.ts, entities.ts nutzt die parse.ts-Primitiven, **#521 Content-as-Data-Rest ✓** — PRACTICE nach `data/practice.json` (gruppiert `npc→questId→[drills]`, Loader expandiert in die unveränderte `{drill,after}[]`-Laufzeitform)) vor dem **Burn-down #502 (#542–#547)**, damit die Splits am fertigen Ort landen; danach der Lernpfad-/QoL-Kopf. **#520** ist erledigt; der „Quest-Arbeitskopie nicht mehr persistieren"-Teil war als **#559** ausgelagert und ist **erledigt ✓** — Save-Format v5→v6: der Save trägt nur noch `activeQuests`+`currentQuestId`, `questIdx`/`questStep`/`taskIdx` werden zur Laufzeit über `Game.questIdx()`/`questStep()`/`taskIdx()` abgeleitet (keine Sync-Last mehr, Alt-Stände laden verlustfrei). **#522 erledigt** (Check-DSL: reale Coverage-Lücken geschlossen). **#523 erledigt ✓** — `syncCluster` synchronisiert die Pod-Kisten/Signaturen nur noch bei geänderter `Sim.rev` (Dirty-Marker: bumpt in `exec` + via `Sim.touch()` bei Sturm/Piraten) statt jeden Frame; Pod-Slots dynamisch statt fixe 36 (kein Slot-0-Fallback mehr). **#524 erledigt ✓** — FPS-Budget-Smoke (`e2e/perf-smoke.spec.ts`: FrameSampler-FPS bei `?perf` auf `body[data-kq-fps]` gespiegelt, konservativer Floor) + a11y-Smoke (`e2e/a11y-smoke.spec.ts`: `@axe-core/playwright` über HUD/Overlays, null Verletzungen außer dokumentierter `region`-Ausnahme → Folge-Ticket **#560**); Smoke-Suite auf `workers: 1` (sonst drückt ein paralleler axe-Scan die gemessene FPS). **#542 erledigt ✓** — `kubectl get`/`describe` sind jetzt dünne Dispatcher über eine **Renderer-Registry** (Alias→Renderer, ein kleiner Renderer je Ressourcentyp), `describe pod` in Events-/Container-/Volume-Blöcke zerlegt, `kubectlLogs` über Helfer entzerrt; alle inspect.ts-Komplexitäts-Suppressions weg. **#561 erledigt ✓** — versehentliche Self-Dependency `"kubequest": "file:../../.."` aus package.json + package-lock.json entfernt (via #524-Merge eingeschleppt aus dem `npm --prefix install`-Worktree-Fallstrick). **#544 erledigt ✓** — `helmCommand` (vorher complexity 74 / 277 Zeilen) ist jetzt ein dünner Dispatcher über die Daten-Tabelle `HELM_SUBCOMMANDS` (Alias→Handler), jeder Unterbefehl (repo/search/create/template/lint/package/install/list/upgrade/rollback/uninstall/status/dependency) eine eigene kohäsive Funktion; stale complexity/max-lines-Suppressions via `lint:prune` entfernt. **#543 erledigt ✓** — der kubectl-Lifecycle/Ops-Dispatcher ist entzerrt: `kubectlCommand` → `SUBCOMMANDS`-Tabelle, `kubectlCreate` (complexity 63) → `CREATE_HANDLERS` (ein Handler je Ressourcentyp + `collectRbacSubjects`), `kubectlDelete` (42) → `deleteFromFile`/`deletePod`/`deletePvc` + neue `FILE_DELETABLE`-Tabelle, `kubectlSetResources` (32) → Dimensions-Applier (memory+OOM-Heal/CPU/ephemeral), `applyDeployment`-Arrow (17) → `reconfigureDeployment`/`createDeploymentFromManifest`; stale kubectl-Suppressions geprunt. **#545 erledigt ✓** — der sim-Burn-down war zu breit für einen reviewbaren Slice (Diff-Budget #533), darum in drei session-große Kinder geteilt: **#545 selbst = sim 1/3** (docker+terraform → `DOCKER_SUBCOMMANDS`/`TERRAFORM_SUBCOMMANDS`, 686 Zeilen / 3 Dateien), Rest als **#562** (sim 2/3: argocd/s3/git/net/invariants) + **#563** (sim 3/3: `sim.ts`-Kern mergeScenario/reset/exec). **#546 erledigt ✓** — Content + Persistenz unter das Komplexitäts-Gate geschnitten: `validateContent` (complexity 73 / 135 Zeilen / 2× max-depth) in einen Validator je Abschnitt zerlegt (Quest-Schritte pro Step-Typ ausgelagert → flache Verschachtelung), `compileRule` (21) auf eine `RULE_COMPILERS`-Dispatch-Tabelle umgestellt, `sanitizeState` (49) in kohäsive Sub-Sanitizer (`sanitizeLeitnerMap` für review+mastery, `sanitizeCountMap` für inventory+abbrevUsage, `resolveQuestIdx`/`resolveActiveQuests`), `harborGeometry` (31) in `fillBaseTerrain`/`fillDocks`/`fillPathsAndPlazas`, `spreadLabelsVertically`-max-depth via `highestCollidingTop` entzerrt; alle fünf Suppressions via `lint:prune` weg. Oberstes freies Kopf-Ticket damit **#562**. Volle Begründung je Ticket: [architektur-analyse-2026-07-iSAQB.md](architektur-analyse-2026-07-iSAQB.md).

| # | Ticket | Prio | Worum's geht | Warum hier / Abhängigkeit |
|---|--------|------|--------------|---------------------------|
| | **━━━ Burn-down #502 (Komplexitäts-Gate) — God-Functions/Dispatcher schneiden, prio:niedrig ━━━** | | | |
| A36a | **#562** | niedrig | Burn-down #502 (sim 2/3): übrige sim-Befehlsfamilien (argocd/s3/git/net/invariants) | Kind von #545 (zu breit → 3 geteilt); #545 sim 1/3 (docker+terraform) erledigt. |
| A36b | **#563** | niedrig | Burn-down #502 (sim 3/3): `sim.ts`-Kern (mergeScenario/reset/exec) | Kind von #545; der schwerste Brocken, eigener Slice. |
| A38 | **#547** | niedrig | Burn-down #502: Präsentation + Region-Geometrie entzerren | Fortsetzung #502; Präsentations-Schicht. |
| | **━━━ Bisheriger Kopf (Lernpfad / QoL / Optik) — erst NACH dem Analyse-Block ━━━** | | | |
| | **— Tiefer Lernpfad (Aufbau-Bogen #239 komplett: #460–#466 erledigt; #279 Backfill + #278 Sammelalbum + #328 Sandbox-Lernthema erledigt; #484 Scheduler-Blindplatzierung erledigt) —** | | | |
| 1 | **#485** | niedrig | Lernlücke: initContainer (füllt das emptyDir vor dem Hauptcontainer) | Lernpfad-Content; docktan die storage-ephemeral/emptyDir-Lektion an (Content vor QoL), thematisch direkte Fortsetzung von #484. |
| 2 | **#486** | niedrig | Lernlücke: Image Garbage Collection (kubelet räumt Images, in-use blockt) | Lernpfad-Content; kubelet-/Node-Housekeeping neben Eviction/DiskPressure (Content vor QoL). |
| 3 | **#487** | niedrig | Lernlücke: QoS-Klassen vollständig (BestEffort/Burstable/Guaranteed) + Eviction-Prio | Lernpfad-Content; vertieft genau die requests/limits→Eviction-Reihenfolge aus #484/Knut (Content vor QoL). |
| | **— System / QoL —** | | | |
| 4 | **#318** | niedrig | HUD: Einkommensrate des Hafens/Clusters anzeigen (Dublonen/Stunde) | Auto-Rest hochgezogen (Prio→Nummer); kleines HUD-Feature ohne Abhängigkeit. |
| | **— Anlegende / Epic —** | | | |
| 5 | **#277** | niedrig | Ideen-Ticket: weitere Minispiele überlegen & dafür Tickets anlegen | Anlegend, design-frei; erzeugt Folge-Tickets statt direktem Fix. |
| 6 | **#317** 📦 | niedrig | EPIC: Komfort-Funktionen im Shop kaufen + Shop-Überarbeitung | **Epic → mit der Aufteilung loslegen** (session-große Kinder anlegen, Epic auf done schließen). |
| | **— 🎨 Optik / Grafik (werden GANZ NORMAL automatisch gewählt; das Aussehen stimmt der Agent WÄHREND der Umsetzung per Rückfrage mit der Maintainerin ab — Referenz/Vorschlag/generiertes Asset vorlegen, entscheiden lassen, iterieren; NICHT vorab gaten, NICHT selbst das Design festlegen) —** | | | |
| 7 | **#183** 🎨 | niedrig | Hafen-Kanone als Pixelart-Asset statt Emoji 💣 | Optik — Asset-Look während der Umsetzung abstimmen. |
| 8 | **#186** 🎨 | niedrig | Außen-Türen der Gebäude als Pixelart statt prozeduraler Rechtecke | Optik — Look während der Umsetzung abstimmen. |
| 9 | **#187** 🎨 | niedrig | Interior-Einrichtung (Bullaugen/Türen/Wandschatten) als Pixelart | Optik — Look während der Umsetzung abstimmen. |
| 10 | **#190** 🎨 | niedrig | Overlay-Panels (Funkgerät/Logbuch/Shop/Quiz/Stapel/Menü) im Stardew-Look | Optik — Look während der Umsetzung abstimmen. |
| 11 | **#204** 🎨 | niedrig | HUD-/Panel-Emojis durch PixelLab-Pixel-Icons ersetzen | Optik — Look während der Umsetzung abstimmen. |
| 12 | **#223** 🎨 | niedrig | Rang-Aufstieg mit Feier-Popup (alter → neuer Rang) statt nur Toast | Optik/UX — gehört mit #314 zusammen; Look während der Umsetzung abstimmen. |
| 13 | **#238** 🎨 | niedrig | Container laufen visuell in Pods (Fässer im Schiffsrumpf) | Optik/Visualisierung — Look während der Umsetzung abstimmen. |
| 14 | **#289** 🎨 | niedrig | Kenney-Tilesets (town/dungeon) durch PixelLab ersetzen, dann entfernen | Auto-Rest hochgezogen (Prio→Nummer); Optik — Look während der Umsetzung abstimmen. |
| 15 | **#303** 🎨 | niedrig | Gestoppte Container visuell ins Lager verschieben (statt am Dock) | Auto-Rest hochgezogen (Prio→Nummer); Optik/Visualisierung — Look während der Umsetzung abstimmen. |
| 16 | **#314** 🎨 | niedrig | Zentrales Feier-Popup-System (Konfetti + Spruch) | Optik — Look während der Umsetzung abstimmen (übergreift #223). |
| | **— Zuletzt —** | | | |
| 17 | **#293** | niedrig | Spiellogik-Review (anlegend) | Steht bewusst **zuletzt** (reine Positionierung, kein Gate) — erst wenn der Backlog weitgehend leer ist, sonst veraltet das Review sofort. Erzeugt Folge-Tickets. |

> **#443 (Phaser 4)** ist aus dem Kopf raus: evaluiert und bewusst verschoben (Renderer-Bug in 4.2.0 bei kleine-Welt-Szenen, kein Quick-Fix). Re-Eval läuft über das Folge-Ticket, sobald Phaser 4 reift / der Bug upstream gefixt ist. Details: [ADR 0001](adr/0001-engine-phaser.md).

> **Aufbau-Bogen-Optik #467** 🎨 (zerstörter Hafen → Wiederaufbau) wird wie jedes Optik-Ticket normal gewählt; der Look wird während der Umsetzung mit der Maintainerin abgestimmt — kein Vorab-Gate, kein Blocker für den Lerninhalt (#460–#466).

> 🎨 **Optik-/Grafik-Tickets** (z.B. #183/#186/#187/#190/#204/#223/#238/#289/#303/#318/#341/#342/#467): werden **automatisch wie jedes andere Ticket gewählt**. Das konkrete Aussehen legt der Agent **nicht selbst** fest, sondern stimmt es **während der Umsetzung per Rückfrage** mit der Maintainerin ab (Stardew-Referenz lesen — [AGENTS.md › Grafik-Stil](../AGENTS.md), [docs/stardew-referenz.md](stardew-referenz.md) —, dann Vorschlag/Referenz/generiertes Asset vorlegen und entscheiden lassen, iterieren). Also: dranmachen ja, Design-Entscheidung interaktiv.

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

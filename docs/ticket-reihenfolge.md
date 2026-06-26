# Umsetzungs-Reihenfolge (alle Tickets)

> **Stand: 2026-06-26 — nächstes Ticket: #164. Kopf: 10 Einträge. Phase 9 (Expeditions-Flotte) ist mit #157 KOMPLETT; als nächster dependency-geordneter Content-Arc wurde Phase 10 (Heimat-Werft, #164→#165→#166→#167→#169→#171→#172) aus dem Reaktivierungs-Pool in den Kopf geholt. Zuletzt abgeschlossen: #157 (Expeditions-Flotte: Tests für Phase 9 — dedizierter Szenario-Durchspiel-Test der Modul-Quest #150 (zwei Modul-Aufrufe aus EINEM Bauplan → vier Ressourcen + durchgereichter Output, analog zu den schon vorhandenen #151/#152/#153-Tests); Sim-Fehler-/Grenzfälle `state list` vor apply (State leer), `get` ohne referenziertes Modul, `output` nach apply ohne deklarierte Outputs; Content-Konsistenz PRACTICE.saga deckt alle vier Flotte-Quests mit den fünf Phase-9-Drills gestaffelt ab + fachliche Drill-Setup-Tests (tf-get/tf-apply-flotte/tf-output-list inkl. verborgenem sensiblem Output) + die acht vertiefenden Quiz-Karten #155 hängen je an ihrer Quest; Red-Green bewiesen, npm test 1078 grün, typecheck+lint grün), #156 (Expeditions-Flotte: Wrap-up der Phase 9 — Progression war durch #148–#155 bereits datengesteuert eingehängt (quest-order.json, entities.json, REGION_WARPS), `quests.test.ts` spielt die Sequenz inkl. Flotte grün durch; daher kein Code-Hookup, nur die README-Phasentabelle nachgezogen: Zeile 9 von 🔜 auf ✅ im Spiel (Saga, 4 Quests), Tabellen-Intro „Phase 1" → „Phasen 1–9", Roadmap nennt die Flotte nicht mehr als nächstes; Quest-Zahl 51 bleibt korrekt, `readme.test.ts` grün), #155 (Expeditions-Flotte: 8 vertiefende Quiz-Karten zu Phase 9 in `crabquiz/terraform.json`, zwei je Quest, ergänzen die In-Quest-Review-Karten — Module (mehrfacher Aufruf, `init` holt auch Module), Remote State (`init` richtet Backend ein, `state list` aus dem Lager), Provider (warum `init` zuerst, nordwind/passat = AWS/Azure/GCP), Variablen & Outputs (`var.<name>`-Zugriff, sensiblen Output gezielt roh abrufen); `chapter`-gegated → SR-Pool nach Quest-Abschluss, CRAB_QUIZ 136→144, Wächter #371/#138 decken sie ab), #154 (Expeditions-Flotte: 5 Practice-Drills bei Saga, je einer pro Phase-9-Quest — `tf-get` (Module holen, `terraform get`), `tf-init-flotte` (Provider-Plugins + Remote-Backend, `terraform init`), `tf-apply-flotte` (Multi-Cloud bauen, beide Anbieter, `terraform apply`), `tf-output-read` (Output gezielt, `terraform output <name>`), `tf-output-list` (alle Outputs, sensible verborgen, `terraform output`); PRACTICE-Pool für NPC `saga` gestaffelt nach den vier Quests, Drills setzen tf-State per `mergeScenario` frisch auf; im Browser durchgespielt), #153 (Expeditions-Flotte: vierte & letzte Quest „Die Stellschrauben der Flotte" / Variablen & Outputs bei Saga — variables als zentrale Stellschrauben statt fest verdrahteter Werte, outputs als saubere Rückgaben, sensitive-Output (Übersicht `<sensitive>`, gezielt roh abrufbar); scenarioRef auf vorhandene Konfig `flotte-variablen-outputs`, zwei Review-Choices + 2 Crab-Quiz-Karten; Nebenfix: Konfig leert `tfModules/tfProviders/tfBackend` gegen Alt-State der Vorquests, Guard-Test Red-Green; README-Questzahl 50→51 + Save-Fixture ergänzt — schließt den Phase-9-Quest-Bogen ab), #152 (Expeditions-Flotte: dritte Quest „Provider & Cloud" bei Saga — Multi-Cloud mit zwei Providern (nordwind/passat), `terraform init` lädt beide Plugins, je eine Insel pro Anbieter, `state list`; zwei Review-Choices + Crab-Quiz-Karten; Nebenfix: `flotte-provider`-Konfig leert `tfModules/tfOutputs/tfBackend` gegen Alt-State aus den Vorquests, Guard-Test Red-Green), #151 (Expeditions-Flotte: zweite Quest „Remote State" bei Saga — State ins geteilte „Flotten-Lager" (s3-`backend` + Locking) verlagern, `terraform state list`, State-Locking als Konzept via Review-Choices + Quiz; Nebenfix: `flotte-remote-state`-Konfig leert `tfModules/tfProviders/tfOutputs` gegen Alt-State aus der Modul-Quest, Guard-Test Red-Green), #150 (Expeditions-Flotte: erste Quest „Terraform-Module" bei Saga — Module als wiederverwendbare Bausteine, scenarioRef auf flotte-modul, neuer Befehl `terraform output`; Nebenfix `tfResources:[]` in flotte-modul gegen Alt-State im Story-Durchspiel), #149 (Expeditions-Flotte: neuer NPC „Saga", Flottenkommandantin — PixelLab-Sprite + Smalltalk, Geberin des Phase-9-Arcs), #455 (Boot-Sicherheitsnetz beobachtet den Boot-Flag aktiv statt Einmal-Timer → langsamer-aber-erfolgreicher Boot lässt es nie liegen; behebt auch die Duplikate #437/#453/#454).**
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

Leitlinie: **Prio zuerst**, innerhalb gleicher Prio nach Abhängigkeit (was etwas anderes ermöglicht, kommt davor), sonst niedrigste Nummer. Content-Arcs (echter Lernpfad-Fortschritt) stehen über QoL-/System-Features. No-dependency-Content-Füller (#212/#218/#219/#228/#229/#236/#237/#239/#250) leben im Auto-Rest — keine Abhängigkeit, kein Grund für den Kopf.

| # | Ticket | Prio | Worum's geht | Warum hier / Abhängigkeit |
|---|--------|------|--------------|---------------------------|
| | **— Heimat-Werft (Phase 10: Capstone — eigenen Service bauen → deployen → erreichbar) —** | | | Aus dem Reaktivierungs-Pool geholt (2026-06-26), nachdem Phase 9 komplett war. Dependency-geordnet wie Phase 9: erst Sim-Grundlage, dann Welt/NPC, dann Quest, dann Drills/Progression, Tests zuletzt. (#168/#170 bereits geschlossen.) |
| 1 | **#164** | niedrig | Werft: Sim-Grundlage – eigenen Service bauen→deployen→erreichbar abbilden | **Nächstes Ticket.** Fundament des Arcs — alles Weitere baut darauf. |
| 2 | **#165** | niedrig | Werft: Insel/Bereich „Heimat-Werft" + Anleger/Warp | Braucht die Sim-Grundlage (#164) nicht zwingend, aber sinnvoll danach (Region als Bühne). |
| 3 | **#166** | niedrig | Werft: neuer NPC (Sprite + Smalltalk) | Steht in der Werft-Region (#165). ⚠️ Sprite = Grafik: PixelLab + Stardew-Referenz. |
| 4 | **#167** | niedrig | Werft: Quest „Eigenen Service containerisieren & deployen" | Braucht Sim (#164), Region (#165) und NPC-Geber (#166). |
| 5 | **#169** | niedrig | Werft: Drills (Capstone-Übungen) + PRACTICE-Mapping | Baut auf der Quest (#167) auf — dieselben Befehle als freies Üben. |
| 6 | **#171** | niedrig | Werft: Progression einhängen + README-Phasentabelle (Phase 10) | Nach Quest/Drills — hängt den Arc in den Lernpfad + zieht die README nach. |
| 7 | **#172** | niedrig | Werft: Tests für Capstone-Quests & Werft-Sim | **Zuletzt im Arc** — sichert ab (Red-Green), wie #157 für Phase 9. |
| | **— QoL / System-Features —** | | | |
| 8 | **#334** | niedrig | Dev-Panel per Docker, Passwort zur Laufzeit | Niedrige Dringlichkeit; baut auf #325/#331. |
| | **— Sonderfälle ans Ende —** | | | |
| 9 | **#314** ⚠️ | niedrig | Zentrales Feier-Popup-System (Konfetti + Spruch) | **Optik-Ticket: erst Vorstellung + Referenzbilder mit der Maintainerin abstimmen** (übergreift #223). |
| 10 | **#293** ⚠️ | niedrig | Spiellogik-Review (anlegend) | **ZULETZT** — erst wenn der Backlog weitgehend leer ist (sonst veraltet das Review sofort). Erzeugt Folge-Tickets, kein direkter Fix. |

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

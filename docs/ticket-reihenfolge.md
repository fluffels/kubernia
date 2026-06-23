# Umsetzungs-Reihenfolge (alle Tickets)

> **Stand: 2026-06-23 (#144 erledigt — Lagerhallen-Viertel/Phase 7 in der README-Phasentabelle auf ✅ gesetzt + Roadmap auf die Expeditions-Flotte umgestellt; die Progression war bereits durch #140–#143 verdrahtet, daher Doku-only (1c8c652). Aus dem Kopf entfernt, Kopf jetzt 18 Einträge. Davor 2026-06-23: Phase 3 abschließen vorgezogen — #338 NetworkPolicies als bereits umgesetzt geschlossen, DNS #337 als letzter offener Phase-3-Baustein an den **Kopf** gezogen. Oberstes Kopf-Ticket ist #337 DNS, danach #145 Lagerhallen-Tests).** Diese Liste bestimmt, welches Ticket **als nächstes** drankommt. Sie ersetzt die frühere, auf `area:architektur` beschränkte „Architektur-Reihenfolge" (die ist abgearbeitet) — und **gilt jetzt für den normalen Trigger „nächstes (kubequest-)Ticket"**, nicht mehr nur für Architektur.
> Sie ist die **kuratierte Vorne-Auswahl** über die generische Board-Sortierung (Prio→Nummer aus [AGENTS.md](../AGENTS.md)): das oberste freie Ticket des **Kopfes** ist „dran"; was nicht im Kopf steht, fällt automatisch auf Prio→Nummer zurück.

## Wie diese Liste funktioniert — drei Schichten

1. **Kopf (kuratiert, ~15–20 Tickets).** Die nächsten Tickets in **bewusster** Reihenfolge — abhängigkeitsbewusst und prio-informiert, nicht nur nach Label. **„Nächstes Ticket" = das oberste freie hier.** Siehe Tabelle unten.
2. **Auto-Rest.** Alles, was **nicht** im Kopf steht, wird **nicht** handsortiert, sondern fällt auf die generische, deterministische Board-Sortierung zurück: **Prio (`hoch`→`mittel`→`niedrig`→ohne), innerhalb der Prio niedrigste Nummer** (Befehl unten). So bleibt die Pflege billig und die Liste skaliert Stardew-fest, auch wenn der Backlog wächst.
3. **Reaktivierungs-Pool.** Die `status:zurückgestellt`-Tickets — waren hinter der Architektur/dem Fundament **geparkt**, nicht verworfen. Werden **progressiv** wieder hereingeholt, wenn der Kopf sich leert (siehe unten). Bis dahin bei der Auswahl übersprungen.

> **Warum nicht alle ~70 aktiven Tickets durchsortieren?** Eine handgepflegte Gesamt-Reihenfolge über den ganzen Backlog wäre nach jedem Ticket teuer zu pflegen und würde bei Stardew-Scope veralten. Der Kopf trägt nur die nächste Vorausschau; den langen Schwanz erledigt die deterministische Prio→Nummer-Regel. **(Oberste Regel: skaliert das auch bei 10× Backlog? — ja.)**

## Vor JEDEM Ticket — bewusst zweifeln (über allem)

Bevor irgendein Ticket angefasst wird, **zuerst zweifeln** — das steht über der Reihenfolge:

1. **Stardew-Scope-Frage:** „Ist das, was ich hier mache, noch sinnvoll, wenn KubeQuest **so groß wie Stardew Valley** wird?" Nur umsetzen, wenn die Antwort Ja ist. Eine Lösung, die heute reicht, bei 10× Inhalt aber dasselbe Problem reproduziert, ist keine Lösung (oberste Regel, [AGENTS.md](../AGENTS.md)).
2. **Bisherige Entscheidungen aktiv anzweifeln** — nicht nur die eigene neue Arbeit. Auch **abgeschlossene Tickets, ADRs und „gesetzte" Annahmen** dürfen falsch sein. Wenn beim Bearbeiten auffällt, dass eine frühere Weiche bei Stardew-Scope nicht trägt: hinterfragen, nicht stillschweigend fortschreiben.
3. **Auffälliges → sofort Ticket anlegen** (Bug, Lücke, Tech-Debt, falsche Annahme) — nicht inline mitfixen, nicht „im Kopf" behalten. Lieber ein Ticket zu viel.
4. **Diese Liste danach pflegen** — neues/aufgefallenes Ticket an die passende Stelle einsortieren (siehe „Pflege" unten). Die Reihenfolge ist ein lebendes Dokument, kein einmaliger Plan.

## Grundsatz-Reviews (bewusst offen halten, nicht festlegen)

Diese Tickets sind **keine „bau-X"-Tickets**, sondern Entscheidungen, die man *reviewt und offen hält* — sie färben alle anderen und stehen darum **nicht** im sortierten Kopf:

- **#355** ⚠️ — **Auslieferungsform: Web-App vs. Desktop-Download (wie Stardew).** Bewusst **nicht** auf eine Option festlegen. Recherchieren, ob ein Spiel dieser Größe als reine Web-Anwendung trägt; Ergebnis als **ergebnisoffener ADR** (`docs/adr/0005-auslieferungsform.md`) mit Re-Eval-Trigger. Kein Code, kein Lock-in. Hängt mit der Backend-Frage zusammen ([ADR 0006](adr/0006-backend-und-skalierung.md)). → bei jeder save-/asset-/build-nahen Änderung mitdenken.

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

Leitlinie der Sortierung: **Prio zuerst** (höchste offene Prio oben), **innerhalb gleicher Prio nach Abhängigkeit** (was etwas anderes ermöglicht, kommt davor), sonst niedrigste Nummer. Der **Skalierungs-Enabler-Block** ist bewusst über die anderen `prio:niedrig`-Tickets gezogen, weil „Umbau zuerst, dann der große Content-Push" gilt (Begründung: [architektur-analyse-2026-06.md](architektur-analyse-2026-06.md)). Stand des Blocks: **#198 ✓**, **#428 ✓** (erledigt); **#339 zurückgestellt** (Vite inlinet die kleinen Sprites bereits als Data-URI → Texture-Atlas aktuell ohne messbaren Nutzen, `status:zurückgestellt` mit Re-Eval-Trigger); **#417 aufgeteilt** in **#435 ✓** (Lazy-Content, erledigt) + **#436 ✓** (Save-Laden entzerren, erledigt). Der Skalierungs-Enabler-Block ist damit vollständig abgearbeitet.

**Neu am 2026-06-21 — der „große Content-Push" beginnt:** Mit dem fertigen Enabler-Block wurde die nächste Story-Region **Wachturm-Quartier (Phase 6 — RBAC / ServiceAccounts / Pod-Security)** aus dem Reaktivierungs-Pool geholt (`status:zurückgestellt` von **#130–#139** entfernt; #137 Quiz war schon ✓) und als **zusammenhängender Arc an den Kopf der Liste** gezogen — genau das „dann der große Content-Push" nach „Umbau zuerst". Gut vorbereitet: **Sim-Grundlage** (`auth can-i` #126, Pod-Security #128) ✓ und die **Region-Maschinerie** seit #427 datengetrieben (`RegionScene`/`REGION_CONFIGS`), eine neue Region anzulegen ist also billig. Die früheren **no-dependency-Content-Füller** (#212/#218/#219/#228/#229/#236/#237/#239/#250) sind dafür in den **Auto-Rest** zurückgewandert — sie haben keine Abhängigkeit und gehören damit nicht in den Kopf (Prio→Nummer holt sie dort weiter, sobald sich der Kopf leert). Die Wachturm-Region steht **über** den QoL-/System-Features (#332/#334; #306 erledigt), weil sie echten Lernpfad-Fortschritt bringt, jene nur Komfort.

| # | Ticket | Prio | Worum's geht | Warum hier / Abhängigkeit |
|---|--------|------|--------------|---------------------------|
| | **— Phase 3 abschließen (Ingress / DNS / TLS / NetworkPolicies) — auf Wunsch der Maintainerin ganz nach vorne gezogen 2026-06-23 —** | | | Phase 3 ist sonst komplett: Ingress + TLS („Hafentor" bei Ada) ✓, NetworkPolicies („Hafenmauer" bei Juno, Quest `network-policy` in `quest-order.json`) ✓ → **#338 als bereits umgesetzt geschlossen**. **DNS ist der einzige offene Baustein.** Keine harte Abhängigkeit (Service-/Sim-Konzept steht, `coredns` existiert bereits als kube-system-Pod), einzelne Quest → günstig vorzuziehen, schließt einen sichtbar halbfertigen Bereich ab. |
| 1 | **#337** | niedrig | Quest „DNS im Cluster — CoreDNS, Service-Discovery (`<svc>.<ns>.svc.cluster.local`) & externe Namen (ExternalName)" | **Nächstes Ticket.** Letzter offener Baustein von Phase 3; auf Wunsch der Maintainerin vorgezogen. ⚠️ ggf. Grafik-/NPC-Anteil → Stardew-Referenz beachten. |
| | **— Lagerhallen-Viertel (Phase 7: stateful Workloads & Datendauerhaftigkeit) — progressiv reaktiviert 2026-06-22, vervollständigt die schon bestehende Region —** | | | Region schon im Spiel: Hafenkai + **NPC Knut** ✓, **StatefulSet-Quest** ✓ (`storage-statefulset`), **PVC/PV/StorageClass-Quest** ✓ (`storage-pvc`), **Backup & Restore #140 ✓** (`storage-backup-restore`). **Drills/PRACTICE #142 ✓** (StatefulSet/PVC/Snapshot/Restore-Drills bei Knut + Pending-Negativfall, 38ecf06), **Quiz #143 ✓**, **Reflexions-Quest #141 ✓** (`storage-prod-db-decision`, 6f4af5e) und **Progression/README #144 ✓** (Phase 7 auf ✅, 1c8c652 — Progression war bereits durch #140–#143 verdrahtet). Es fehlt nur noch #145 Tests. Abhängigkeitsordnung wie beim Wachturm-Arc (Quests → Drills → Quiz → Progression → Tests). |
| 2 | **#145** | ohne | Tests für stateful-Quests & StatefulSet/Volume-Sim | Zuletzt im Lagerhallen-Arc — sichert ab (Red-Green). |
| | **— Expeditions-Flotte (Phase 9: Terraform-Module / Remote State / Provider) — dritte progressive Reaktivierung 2026-06-22, neuer Region-Arc —** | | | Sim-Teilgrundlage vorhanden (`src/sim/terraform.ts` deckt `init`/`apply`/`destroy`/`state` bereits ab), Region-Maschinerie datengetrieben (#427). Abhängigkeitsordnung wie bei Wachturm/Lagerhallen: Sim-Grundlage → Region/NPC → Quests → Drills → Quiz → Progression → Tests. |
| 3 | **#146** | ohne | Sim-Grundlage: Module/Remote-State/Provider-Befehle im Simulator | Fundament des Arcs — ohne Sim keine Quests. |
| 4 | **#147** | ohne | Terraform-Konfig-Inhalte (Modul-Struktur, backend.tf, provider.tf, outputs) | Spielinhalt auf der Sim-Grundlage (#146). |
| 5 | **#148** | ohne | Insel/Bereich + Anleger/Warp zur Flotte | Region begehbar machen (RegionScene/#427); ⚠️ Grafik-Anteil — Stardew-Referenz beachten. |
| 6 | **#149** | ohne | Neuer NPC (Sprite + Smalltalk) | Geber der Region; nach Insel. ⚠️ Grafik-Anteil. |
| 7 | **#150** | ohne | Quest „Terraform-Module — wiederverwendbare Bausteine" | Erste Quest; nach Sim + Region + NPC. |
| 8 | **#151** | ohne | Quest „Remote State — gemeinsamer State im Backend" | Baut auf #150. |
| 9 | **#152** | ohne | Quest „Provider & Cloud — Ressourcen bei verschiedenen Anbietern" | Baut auf #151. |
| 10 | **#153** | ohne | Quest „Variablen & Outputs — Konfiguration sauber durchreichen" | Letzte Quest des Arcs. |
| 11 | **#154** | ohne | Drills (Module/Remote-State/Provider-Übungen) + PRACTICE-Mapping | Nach den Quests — übt das Gelernte. |
| 12 | **#155** | ohne | Quiz-Karten (Terraform-Module, Remote State, Provider) | Wissens-Sicherung zur Region. |
| 13 | **#156** | ohne | Progression einhängen + README-Phasentabelle aktualisieren | Verdrahtet die Region in den Lernpfad. |
| 14 | **#157** | ohne | Tests für Terraform-Aufbau-Quests & Modul/Remote-State/Provider-Sim | Zuletzt im Arc — sichert ab (Red-Green). |
| | **— QoL / System-Features (auf Fundament, kein Lernpfad-Fortschritt) —** | | | |
| 15 | **#332** | niedrig | Abgeschlossene Quests wiederspielen (Sandbox) | Baut auf #325/#326; ID-Save (#353) + `repeatable` (#410 ✓) vorhanden. |
| 16 | **#334** | niedrig | Dev-Panel per Docker, Passwort zur Laufzeit | Niedrige Dringlichkeit; baut auf #325/#331. |
| | **— Sonderfälle ans Ende —** | | | |
| 17 | **#314** ⚠️ | niedrig | Zentrales Feier-Popup-System (Konfetti + Spruch) | **Optik-Ticket: erst Vorstellung + Referenzbilder mit der Maintainerin abstimmen** (übergreift #223). |
| 18 | **#293** ⚠️ | niedrig | Spiellogik-Review (anlegend) | **ZULETZT** — erst wenn der Backlog weitgehend leer ist (sonst veraltet das Review sofort). Erzeugt Folge-Tickets, kein direkter Fix. |

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

## Reaktivierungs-Pool — war hinter Architektur geparkt

Die offenen Tickets mit Label **`status:zurückgestellt`** wurden zurückgestellt, weil **erst Architektur + Fundament fertig werden mussten** — sie sind **nicht** verworfen. Jetzt, wo dieses Gate fast fällt, sind sie der **Pool, aus dem der Kopf nachgefüllt wird**: leert sich der Kopf, werden die passenden **progressiv reaktiviert** (Label `status:zurückgestellt` entfernen → an die dependency-passende Stelle in den Kopf einsortieren). Es wird **nicht** alles auf einmal reaktiviert (das würde die Pflege sprengen).

> **Erste progressive Reaktivierung (2026-06-21):** die **Wachturm-Quartier-Gruppe** (#130–#139, Phase 6 — RBAC/Security) als ganze Region-Einheit (Region → NPC → Quests → Drills → Progression → Tests). Bewusst als *eine* Region reaktiviert, nicht der ganze Pool.
>
> **Zweite progressive Reaktivierung (2026-06-22):** die **Lagerhallen-Viertel-Resttickets** (#140–#145, Phase 7 — stateful Workloads) als Region-Einheit, nachdem der Wachturm-Quest-Arc fertig war und der Kopf auf 7 geschrumpft ist. Vervollständigt die schon bestehende Region (NPC Knut + 2 Quests stehen bereits). Steht jetzt im Kopf, siehe oben.
>
> **Dritte progressive Reaktivierung (2026-06-22):** die **Expeditions-Flotte** (#146–#157, Phase 9 — Terraform-Module / Remote State / Provider) als ganze Region-Einheit (Sim-Grundlage → Region/NPC → Quests → Drills → Quiz → Progression → Tests), nachdem #141 erledigt war und der Kopf auf 6 schrumpfte (Refill auf Wunsch der Maintainerin sofort, nicht erst nach dem Lagerhallen-Arc-Ende). Sim-Teilgrundlage steht bereits (`src/sim/terraform.ts`). Steht jetzt im Kopf, siehe oben. Wieder bewusst nur *eine* Region — der Storage-Lernpfad (#240–#246) und der verbliebene Phase-10-Rest bleiben im Pool, bis sich der Kopf erneut leert. **Hinweis Phase 10 (2026-06-22):** der echte-Backend-Track A (#158–#163) wurde als Widerspruch zu [ADR 0002](adr/0002-kein-backend-keine-db.md) geschlossen (kein echtes Backend fürs Spiel; gleiche Begründung wie die früher geschlossenen #168/#170); im Pool bleibt nur noch der **In-Game-Sim-Capstone Track B** (#164–167, 169, 171, 172). #221 (Hosting in K8s) ist eine Auslieferungs-/Hosting-Frage und gehört zum offenen Grundsatz-Review #355 (ADR 0005), nicht zu Phase 10.

Bei der Auswahl werden sie weiterhin **übersprungen**, solange das Label dran ist — **maßgeblich ist immer das Label**, nicht eine Aufzählung hier.

**Reaktivieren mit Augenmaß:** Manche waren *nur* hinter der Architektur geparkt → können bedenkenlos reaktiviert werden. Andere brauchen vorher eine **Scope-Klärung** (z.B. **#420** NPC-Tagesplan/Routinen, **#421** Item-/Inventar-Modell: bedeutet „Stardew-Scope" für ein K8s-Lernspiel überhaupt Routinen/Crafting, oder vor allem Lern-Tiefe?) — die erst klären, dann reaktivieren.

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
- **Neues offenes Ticket mit echter Abhängigkeit** (etwas muss vor etwas anderem passieren) → an die dependency-passende Stelle in den Kopf einsortieren, nicht unten anhängen. Ein neues Ticket **ohne** besondere Abhängigkeit muss **nicht** in den Kopf — es lebt im Auto-Rest.
- **Altentscheidung wackelt** (auch ein abgeschlossenes Ticket/ADR) → als Grundsatz-Review oben aufnehmen (wie #355), nicht stillschweigend fortschreiben.
- **Driftet die Liste → Doku fixen, Stand-Datum oben aktualisieren, committen** (Doku-only → kein Test-Lauf). Hat sich nichts geändert, kein Commit nötig.
- Bei Unklarheit über die Position: „Ist das okay, wenn KubeQuest Stardew-groß wird?" (oberste Regel, [AGENTS.md](../AGENTS.md)) entscheidet vor dem Prio-Label.

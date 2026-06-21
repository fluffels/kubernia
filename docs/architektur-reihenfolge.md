# Architektur-Reihenfolge

> **Stand: 2026-06-21 (nach #419 – `main`-Branch-Protection; #418 LICENSE; davor #388 + Spielsystem-Fundamente #410–#421 → [ADR 0007](adr/0007-spielsystem-fundamente.md)).** Kuratierte Umsetzungs-Reihenfolge für alle offenen Tickets mit Label `area:architektur`.
> Diese Liste **überschreibt** für Architektur-Tickets die generische Board-Auswahl (Prio→Nummer aus AGENTS.md):
> Die Reihenfolge hier ist **abhängigkeitsbewusst** sortiert, nicht nur nach Prio-Label.

## Vor JEDEM Ticket — bewusst zweifeln (über allem)

Bevor irgendein Ticket dieser Liste angefasst wird, **zuerst zweifeln** — das steht über der Reihenfolge:

1. **Stardew-Scope-Frage:** „Ist das, was ich hier mache, noch sinnvoll, wenn KubeQuest **so groß wie Stardew Valley** wird?" Nur umsetzen, wenn die Antwort Ja ist. Eine Lösung, die heute reicht, bei 10× Inhalt aber dasselbe Problem reproduziert, ist keine Lösung (oberste Regel, [AGENTS.md](AGENTS.md)).
2. **Bisherige Entscheidungen aktiv anzweifeln** — nicht nur die eigene neue Arbeit. Auch **abgeschlossene Tickets, ADRs und „gesetzte" Annahmen** dürfen falsch sein. Wenn beim Bearbeiten auffällt, dass eine frühere Weiche bei Stardew-Scope nicht trägt: hinterfragen, nicht stillschweigend fortschreiben.
3. **Auffälliges → sofort Ticket anlegen** (Bug, Lücke, Tech-Debt, falsche Annahme) — nicht inline mitfixen, nicht „im Kopf" behalten. Lieber ein Ticket zu viel.
4. **Diese Liste danach neu sortieren** — neues/aufgefallenes Ticket an die dependency-passende Stelle einsortieren und festhalten, *wann* es dran ist. Die Reihenfolge ist ein lebendes Dokument, kein einmaliger Plan.

## Grundsatz-Reviews (bewusst offen halten, nicht festlegen)

Diese Tickets sind **keine „bau-X"-Tickets**, sondern Entscheidungen, die man *reviewt und offen hält* — sie färben alle anderen:

- **#355** ⚠️ — **Auslieferungsform: Web-App vs. Desktop-Download (wie Stardew).** Bewusst **nicht** auf eine Option festlegen. Die alten Spikes #83/#197 (Tauri, geschlossen) nehmen die Web-Basis als gesetzt an — genau das hier anzweifeln. Recherchieren, ob ein Spiel dieser Größe als reine Web-Anwendung überhaupt trägt; Ergebnis als **ergebnisoffener ADR** (`docs/adr/0005-auslieferungsform.md`) mit Trigger, *wann* neu zu entscheiden ist. Kein Code, kein Lock-in. → bei jeder save-/asset-/build-nahen Änderung mitdenken. **Backend-Implikation liegt jetzt in [ADR 0006](adr/0006-backend-und-skalierung.md):** Desktop-via-Plattform liefert Cloud-Save/Achievements/Updates gratis, eine reine Web-Auslieferung nicht — die Auslieferungs-Entscheidung trägt also auch die Backend-Frage. ADR 0006 stuft zudem den Single-File-Offline-Build vom „Kern-Wert" zur größen-abhängigen Option herab (hier mitentscheiden).
- **#400 ✅ erledigt (2026-06-21) → [ADR 0006 – Backend & Skalierung](adr/0006-backend-und-skalierung.md).** Befund: **kein eigenes Backend** bei Stardew-Scope nötig — Cloud-Save/Achievements/Updates kommen über die **Vertriebsplattform** (→ hängt an #355); die Entscheidung bleibt über die Re-Eval-Trigger im ADR offen. Korrigiert nebenbei die IndexedDB-Begründung von ADR 0004 (echter Engpass ist **Eviction**, nicht Save-Kapazität) → Folge-Ticket **#401** (`navigator.storage.persist()`, in der Tabelle unten). Das **lebende** Dokument ist jetzt ADR 0006, nicht mehr dieses Ticket.

## Was „nächstes Architektur" heißt

Sagt die Maintainerin **„nächstes Architektur"**, dann:

1. **Direkt aus der Liste unten wählen — KEIN Vorab-Abgleich der ganzen Liste.** Das **oberste noch offene** Ticket nehmen, das
   - **nicht** `status:zurückgestellt` ist (die werden ignoriert, siehe unten), und
   - **kein** Assignee hat (Kollisionsschutz — siehe AGENTS.md, „Board-Workflow"), und
   - keinen offenen Branch/Worktree hat.

   Dabei **nur dieses eine Kandidaten-Ticket** kurz gegen den Live-Stand prüfen (`gh issue view <nr>`: offen? kein Assignee? Branch/Worktree-Gegencheck `git worktree list` + `git branch -a`). Ist es schon geschlossen / vergeben / zurückgestellt, das **nächste** der Liste nehmen. Die **ganze Liste wird NICHT vorab gegen GitHub abgeglichen** — Drift wird erst am Ende eingearbeitet (Schritt 4). Das spart bei jeder Auswahl die teure Komplett-Sichtung; die Liste ist gepflegt genug, dass das oberste freie Ticket fast immer stimmt.
2. Dieses Ticket mit dem normalen kubequest-Workflow abarbeiten (self-assignen → eigener Worktree → umsetzen → nach `main` → Issue schließen).
3. **⚠️-Flags beachten** (siehe Liste): manche Tickets werden NICHT direkt umgesetzt (Epic zerlegen, Optik erst abstimmen) oder haben eine harte Voraussetzung.
4. **Erst NACH getaner Arbeit diese Liste pflegen — der „puh, fertig"-Schritt.** Jetzt (nicht vorher) einmal den echten GitHub-Stand der `area:architektur`-Issues holen und Drift einarbeiten:
   ```bash
   gh issue list --label "area:architektur" --state open --limit 300 \
     --json number,title,labels,assignees \
     --jq '.[] | "#\(.number)\t\(([.labels[].name]|map(select(startswith("status:")))|join(","))//"-")\tassignee:\([.assignees[].login]|join(","))\t\(.title)"' | sort -n
   ```
   - **Gerade erledigt / sonst geschlossen / nicht mehr `area:architektur`** → Zeile entfernen.
   - **Neues offenes `area:architektur`-Issue, nicht in der Liste** → an dependency-passender Stelle **einsortieren + einpriorisieren** (nicht unten anhängen).
   - **Jetzt `status:zurückgestellt`** → runter in den Zurückgestellt-Block. **Reaktiviert** (Label weg) → einsortieren.
   - **Driftet die Liste → Doku fixen, Stand-Datum oben aktualisieren, committen** (Doku-only → kein Test-Lauf). Hat sich nichts geändert, kein Commit nötig.

> Erledigte Tickets werden hier **nicht durchgestrichen, sondern entfernt** (GitHub-Issue-Status ist die SSOT für „erledigt"). Diese Datei führt nur die noch offenen Architektur-Tickets in Reihenfolge.

## Reihenfolge

**Neu sortiert nach der Stardew-Architektur-Analyse 2026-06** (Begründung: [architektur-analyse-2026-06.md](architektur-analyse-2026-06.md)). Leitlinie: **Umbau zuerst, dann der große Content-Push.** Reihenfolge der Blöcke:

1. **Fundament** – die Save-Decke heben (blockt Stardew-Scale-Stände). ✅ **erledigt** (#350 IndexedDB auf `main`).
2. **KI-/Dev-Hebel** – Onboarding + schlanke Doku, damit alle weiteren Schritte (gerade KI-getrieben) billig & sicher werden. (**#387 ✅** One-Command-Setup, **#388 ✅ erledigt 2026-06-21** containerisierte Dev-Umgebung – devcontainer + `docker compose up`, ohne lokales Node; Drift-Wächter `test/devcontainer.test.ts`.)
3. **Qualitätsnetz** – Arch-Wächter/Lint/CI-Härtung, *bevor* groß refaktorisiert wird. (Arch-Wächter **#390 ✅ erledigt** – inkl. Zyklen-/Orphan-/Dateigröße-Wächter; **Lint #389 ✅ erledigt** – ESLint + CI-Gate. **Boot-Smoke #391 ist nicht mehr `area:architektur`** (nur noch `area:tests`) → läuft über die generische Board-Auswahl, nicht über diese Liste. **#396** (Dependabot + npm-audit-Gate) ✅ erledigt 2026-06-21 — Dependabot-Config + zweistufiges `npm audit`-Gate (Prod-Deps blockierend, Dev nur berichtend); **#398** (Actions v4→v5) ✅ erledigt 2026-06-21 — dabei `upload-artifact` bis **v7** gehoben, weil dessen `@v5` noch auf node20 lief und die Node-20-Deprecation sonst geblieben wäre. Der Qualitätsnetz-Block ist damit leer.)
4. **God-File-Splits** – unter dem Netz (Schritt 3) gefahrlos. (**game.ts #392 ✅** – Fassade + `src/game/*`-Bündel; **WorldScene.ts #393 ✅** – Systeme in `src/scenes/worldscene/*` (terrain/scenery/clustersync/events/warps); Schwestern zu sim.ts #346 / ui.ts #356. **sim/kubectl.ts #397 ✅** – Dispatch-Barrel + Unterfamilien `src/sim/kubectl/*` (inspect/lifecycle/ops/security/host). Damit ist der God-File-Split-Block abgeschlossen.)
5. **Recht/Schutz (NEU 2026-06-21)** – ✅ **erledigt 2026-06-21**: #418 (proprietäre LICENSE + Copyright-/Nutzungs-Hinweis in README & CONTRIBUTING) und #419 (`main`-Branch-Protection: Force-Push/Löschen blockiert, Owner-Bypass an, damit der direkte-Merge-Workflow weiterläuft). Block ist damit leer.
6. **Save-Härtung/Netz** – Eviction-Schutz (#401) + Save-Migrations-Integrationstest (#414). **Vor** jeder Save-Format-Änderung – schützt bestehende Stände, bevor migriert wird.
7. **Spielsystem-Fundamente (NEU 2026-06-21, [ADR 0007](adr/0007-spielsystem-fundamente.md))** – Quest-Modell erweiterbar, Checks/Freischaltung als Daten, persistente Zeit-Achse (#410–#413). Die Content-**Mechanik**-Schulden, die die Analyse 2026-06 (Infrastruktur-fokussiert) übersah – vor dem Content-Push.
8. **Skalierungs-Enabler** – Assets/Entities/Szenen für viele Welten.
9. **Features** – Save-Slots, Wiederspielen, Dev-Panel.
10. **Sonderfälle** – Optik (abstimmen), Epic (zerlegen), anlegendes Review (zuletzt).

Erst **danach** der große Content-Ausbau (Quests/Orte/Charaktere) – auf dem dann tragfähigen Fundament.

| # | Block | Ticket | Worum's geht | Warum hier / Abhängigkeit |
|---|-------|--------|--------------|---------------------------|
| 1 | Save-Härtung | **#401** | `navigator.storage.persist()` + Quota-Monitoring | **ADR 0006/#400.** Schützt bestehende Stände **jetzt** vor stillem LRU-Löschen. Klein, client-seitig. |
| 2 | Save-Härtung | **#414** | Save-Migrations-Integrationstest (echte Alt-Stand-Fixtures) | **Netz VOR jeder Save-Migration** (#410/#413). „Saves nie brechen" absichern, bevor das Format wächst. `area:tests`, hier als harte Voraussetzung vermerkt. |
| 3 | Spielsystem-Fundament | **#410** | Quest-Modell erweiterbar statt linearem `questIdx` | Tiefster Umbau (Save-Migration über alle Stände) → je früher, desto billiger. **Nach #414.** ADR 0007. |
| 4 | Spielsystem-Fundament | **#411** | Quest-Checks deklarativ (DSL statt 56 Hand-Prädikate) | Vollendet „Content ist Daten" (ADR 0004→0007). Unabhängig; sinnvoll nach dem Quest-Modell. |
| 5 | Spielsystem-Fundament | **#412** | Karten-Freischaltung konsolidieren (`EXTRA_CARDS`+`CONCEPT_INTRO`→JSON) | Kleiner Schwester-Schnitt zu #411. |
| 6 | Spielsystem-Fundament | **#413** | Persistenter Spiel-Kalender im `GameState` | Isoliert; Fundament für saisonalen Content/Routinen. **Nach #414** (Save-Format-Änderung). |
| 7 | Skalierungs-Enabler | **#357** | Entity-Registry auf Objekte/Interaktables (Folge zu #349) | Vor dem Content-Push, wenn Bereiche viele platzierte Objekte/Trigger bekommen. |
| 8 | Skalierungs-Enabler | **#415** | WorldScene auf Map-Registry generalisieren + TS-Inseln datengetrieben | Neue Region ohne Copy-Paste-Szene. Baut auf #57/#193 (✓). |
| 9 | Skalierungs-Enabler | **#198** | Lazy-Asset-Loading pro Insel/Szene *(reaktiviert)* | Vor dem großen Asset-Wachstum, sonst eager-Lade-Bottleneck. |
| 10 | Skalierungs-Enabler | **#339** | Texture-Atlas statt Einzel-Assets *(reaktiviert)* | Draw-Calls/Ladezeit bei vielen Sprites; nach Lazy-Loading. |
| 11 | Skalierungs-Enabler | **#417** | Lazy-Content-Loading + `mergeScenario` entzerren | Content-Pendant zu #198 (Quest-/Karten-Daten statt Assets). |
| 12 | Skalierungs-Enabler | **#416** | Cluster-Tags cullbar/gebündelt (Frame-Performance) | Rendering-Performance bei vielen Entities; unabhängig. |
| 13 | Code-Hygiene | **#423** | Szenen-Layer von `any` befreien (10 no-explicit-any-Warnings, #389-Folge) | Typsicherheit in der Präsentation; unabhängig & niedrig-dringlich, blockt nichts – kann jederzeit nebenbei laufen. |
| 14 | Features | **#306** | Mehrere Spielstände / Save-Slots | Baut auf IndexedDB (#350 ✓ erledigt). |
| 15 | Features | **#332** | Abgeschlossene Quests wiederspielen (Sandbox) | Baut auf #325/#326; ID-basierte Save (#353) vorhanden. |
| 16 | Features | **#334** | Dev-Panel per Docker, Passwort zur Laufzeit | Niedrige Dringlichkeit; baut auf #325/#331. |
| 17 | Sonderfall | **#314** ⚠️ | Zentrales Feier-Popup-System (Konfetti + Spruch) | **Optik-Ticket: erst Vorstellung + Referenzbilder mit der Maintainerin abstimmen.** Übergreift #223. |
| 18 | Sonderfall | **#293** ⚠️ | Spiellogik-Review (anlegend) | **ZULETZT** — erst wenn der restliche Backlog weitgehend leer ist (sonst veraltet das Review sofort). Erzeugt Folge-Tickets, kein direkter Fix. |

> **Hinweis zu #414 (`area:tests`):** Streng genommen läuft es über die generische Board-Auswahl, ist aber als **harte Voraussetzung** für #410/#413 hier mitgeführt – vor diesen beiden Save-Umbauten muss das Netz stehen.

## Zurückgestellt — werden ignoriert

Alle offenen Architektur-Tickets mit Label **`status:zurückgestellt`** sind hier bewusst **nicht** eingeplant und werden bei „nächstes Architektur" übersprungen (Stand 2026-06-21, **23 Stück**, vollständig): „Echter Modus"-Bogen #173/#174/#175/#176/#177/#178, Phase-10-Save-Sync #158/#159/#160, neue Inseln/Bereiche + Progression #130 (Wachturm), #144 (Lagerhallen), #146/#147/#148/#156 (Expeditions-Flotte), Storage-Lernpfad #240/#241, Self-Hosting #221, Tasten-Umbelegung #232, Schiff-Szene #257, Enter/Leertaste-Dialoge #312, **NPC-Tagesplan/Routinen #420** und **Item-/Inventar-Modell #421** (beide neu 2026-06-21, Scope-Klärung nötig: bedeutet „Stardew-Scope" für ein K8s-Lernspiel Routinen/Crafting oder vor allem Lern-Tiefe?). *(#198 Lazy-Asset-Loading und #339 Texture-Atlas wurden am 2026-06-20 reaktiviert und in die Reihenfolge oben aufgenommen.)*

Maßgeblich ist immer das **Label**, nicht diese Aufzählung: bei „nächstes Architektur" gilt jedes Issue mit `status:zurückgestellt` als übersprungen, auch falls die Liste hier mal nicht nachgezogen wurde.

Wird eins davon reaktiviert (Label `status:zurückgestellt` entfernt), gehört es hier einsortiert.

## Pflege dieser Liste

Diese Liste ist **lebendig** — sie wird **am Ende jedes Architektur-Tickets** fortgeschrieben (der „puh, fertig"-Schritt 4 oben), **nicht** als Vorab-Check vor der Auswahl:

- **Erledigtes Ticket** → Zeile entfernen (Issue-Status ist die SSOT).
- **Beim Bearbeiten etwas aufgefallen** (Bug, Tech-Debt, fragwürdige Altentscheidung) → **neues Ticket anlegen** (ohne Assignee, passende Labels) und hier an der dependency-passenden Stelle einsortieren — festhalten, *wann* es dran ist.
- **Neues `area:architektur`-Ticket** → an der dependency-passenden Stelle einsortieren, nicht einfach unten anhängen.
- **Reaktiviertes Ticket** (zurückgestellt-Label weg) → einsortieren.
- **Altentscheidung wackelt** (auch ein abgeschlossenes Ticket/ADR) → als Grundsatz-Review oben aufnehmen (wie #355), nicht stillschweigend fortschreiben.
- Bei Unklarheit über die Position: „Ist das okay, wenn KubeQuest Stardew-groß wird?" (oberste Regel, AGENTS.md) entscheidet vor Prio-Label.

# ADR 0008: KI-Agenten-Harness als Entwicklungsmodell

> Architecture Decision Record. Format: Kontext → Problem → Optionen → Entscheidung → Konsequenzen → Re-Evaluierung.
> Status: **akzeptiert** · Datum: 2026-07-01 · Ticket: #530

## Status

**Akzeptiert.** KubeQuest wird durch **autonome KI-Coding-Agenten** weitergebaut — kein Mensch tippt die Implementierung. Dieser ADR hält das **Entwicklungsmodell** als bewusste Architekturentscheidung fest. Er ist die formale Grundsatzentscheidung; die erklärende Gesamtsicht („wie + warum" im Detail, alle fünf Bausteine, jede Fitness-Function) liegt bereits vor in [`docs/agent-harness.md`](../agent-harness.md) (#526). Dieser ADR **verweist** dorthin, statt zu doppeln — dieselbe Arbeitsteilung wie [AGENTS.md](../../AGENTS.md) (operativ) ↔ agent-harness.md (erklärend).

## Kontext

KubeQuest wird von **einer** Maintainerin verantwortet, die den Weiterbau bewusst an KI-Agenten delegiert: DevOps-Lernspiel als eigenes Weiterbildungsprojekt, Solo, ohne Team-Review-Kapazität. Der komplette Code entsteht so.

Das ist selbst ein **Architekturziel** (arc42-Qualitätsziel §1.4: „eine KI ändert das billig **und** sicher"), gleichrangig neben Testbarkeit, Erweiterbarkeit und Datensicherheit. Anders als die prägenden Nachbar-Entscheidungen — Engine ([ADR 0001](0001-engine-phaser.md)), kein Backend ([0002](0002-kein-backend-keine-db.md)), kein Multiplayer ([0003](0003-multiplayer-coop-out-of-scope.md)), Skalierung ([0004](0004-skalierungs-fundament.md)) — war dieses Entwicklungsmodell bisher **nirgends als ADR** festgehalten, sondern nur in AGENTS.md/CLAUDE.md gelebt. Dieser ADR schließt die Lücke iSAQB-konform (mit explizitem Re-Eval-Trigger wie die anderen).

## Das Problem

Ein LLM-Agent ist ein **unzuverlässiger Ausführender**: mal brillant, mal halluziniert er eine API, vergisst eine Save-Migration oder reißt eine Schichtgrenze ein. Zwei klassische Wege, das aufzufangen, tragen bei einer Solo-Maintainerin mit KI-getriebenem Weiterbau nicht:

1. **Manuelles Review jeder Änderung** setzt menschliche Kapazität voraus, die genau nicht da ist — es wäre der Flaschenhals, den die Delegation an Agenten vermeiden soll.
2. **Auf „der Agent macht's schon richtig" vertrauen** ist bei einem unzuverlässigen Ausführenden fahrlässig — besonders gegenüber der harten Regel „ein Update bricht nie einen bestehenden Spielstand".

Die Verlässlichkeit muss also **nicht am Modell**, sondern an der **Umgebung** hängen: der Agent soll alles Nötige *finden*, sich auf *genau eine* Aufgabe konzentrieren, parallelen Agenten *nicht in die Quere* kommen und jeden Fehler *an einer automatischen Grenze* vorgeführt bekommen, bevor er auf `main` landet.

## Optionen

| Option | Bewertung |
|---|---|
| **Agenten-Harness (Status quo, hier festgehalten)** | Leitplanken um den Agenten: selbstdokumentierendes Repo (SSOT im Code) + board-getriebener Ein-Ticket-Worktree-Workflow + Kollisionsschutz + **Fitness-Functions als automatische Gates** statt Review-Disziplin. Keine menschliche Review-Kapazität nötig; jede Fehlklasse hat ihre eigene Grenze. |
| **Klassisches manuelles Review** | Jede Agenten-Änderung wird von Hand geprüft, bevor sie mergt. Höchste Kontrolle, aber genau der Flaschenhals, den die Solo-Maintainerin nicht bedienen kann — und Review-Disziplin allein hält Grenzen ohnehin nicht (Befund #292: `game.ts → sfx.ts`-Schichtbruch schlich sich unbemerkt ein). |
| **PR mit Required Checks auf `main`** | Agent arbeitet auf Branch, PR, GitHub blockt den Merge bis alle Checks grün sind — der „saubere" Weg. Aber Required Checks **verbieten den Direkt-Push auf `main`**, auf dem der billige Ein-Ticket-Fluss (und GitHub-natives Auto-Merge für Dependabot) heute beruht; für eine Solo-Maintainerin mit vertrauenswürdigen, gegateten Agenten ist die PR-Zeremonie Overhead ohne Zusatznutzen. Bleibt der natürliche Umstieg, sobald mehrere (auch fremde) Beitragende dazukommen — siehe Re-Eval-Trigger. |

## Entscheidung

**Der Agenten-Harness ist das Entwicklungsmodell.** Konkret festgehalten:

1. **Selbstdokumentierendes Repo (SSOT im Code).** Alles, was ein Agent braucht, liegt versioniert im Repo — kein externes Notiz-/Wissenssystem als Voraussetzung, damit auch ein frischer Clone / Cloud-Agent arbeiten kann. Die Doku ist bewusst als **Kontext-Selektor** gebaut (schlanker Always-Index in CLAUDE.md + on-demand-Tiefendocs + modul-lokale `AGENTS.md`), damit sie bei Stardew-Scope nicht zum unlesbaren Monolithen wird.
2. **Board-getriebener Ein-Ticket-Worktree-Workflow.** Der Backlog lebt als GitHub Issues + Board; was als Nächstes dran ist, sagt die kuratierte [Umsetzungs-Reihenfolge](../ticket-reihenfolge.md) — der Agent **wägt nicht ab**. Ein Agent nimmt **genau ein** Ticket und arbeitet es end-to-end in einem **eigenen `git worktree`** ab. Der enge Fokus ist Absicht: ein kleiner, abgeschlossener Diff ist verifizierbar.
3. **Fitness-Functions als Leitplanken statt Review-Disziplin.** Das eigentliche Sicherheitsnetz sind **automatische Gates** (lokal + CI), die `main` grün halten: Tests, Typecheck, Lint, Architektur-Wächter, Dateigröße, Doku-Drift (`check:docmap`/`check:docdrift`), Boot-/Interaktions-Smoke, Security-Audit — gebündelt hinter `npm run verify` (#527) und vorgelagert durch den pre-push-Hook (#528). Jede Fehlklasse hat ihre eigene Grenze; kein Fehler verlässt sich darauf, dass „der Lauf schon gut war". Details je Gate: [agent-harness.md §3](../agent-harness.md#3-die-fitness-functions-im-detail).
4. **Kollisionsschutz für parallele Agenten.** Self-assign als „in Arbeit"-Marker (verifiziert, blockierend) + eigener Worktree pro Ticket, damit sich mehrere gleichzeitig laufende Agenten nie dasselbe Ticket oder Arbeitsverzeichnis greifen.

### Was bewusst *nicht* entschieden wird

- **Kein Wechsel auf PR-mit-Required-Checks — noch nicht.** Der Direkt-Push auf `main` bleibt, solange die Maintainerin solo mit vertrauenswürdigen, gegateten Agenten arbeitet. Der Umstieg ist als Re-Eval-Trigger dokumentiert, nicht verbaut.
- **Menschliches Urteil bleibt für das, was Gates nicht prüfen können:** didaktische Richtigkeit (ist die simulierte Cluster-Mechanik pädagogisch sinnvoll?) und Spielspaß/Look — darum der Browser-Verifizierungs-Schritt und die interaktive Optik-Abstimmung per Rückfrage.

## Konsequenzen

**Positiv**
- **Billig:** der Agent sucht nichts (SSOT-Doku als Kontext-Selektor), wägt nichts ab (Reihenfolge entscheidet), und ein kleiner Ein-Ticket-Diff braucht wenig Kontext.
- **Sicher ohne menschliches Review:** jede Fehlklasse hat ihre automatische Grenze; ein Schichtbruch, ein `any`, ein God-File, eine veraltete Doku-Landkarte oder eine gebrochene Save-Migration wird rot, bevor sie schadet.
- **Parallelisierbar:** mehrere Agenten laufen gleichzeitig, ohne sich zu stören.
- **Der Harness verbessert sich über denselben Workflow** (dogfooding): seine eigenen Schwachstellen sind Tickets (#527/#528/#529/#531/#492 …).

**Negativ / Trade-offs**
- **Direkt-Push-auf-`main`-Lücke:** die CI-Gates laufen *nach* dem Push (post-hoc). Die lokalen Gates sind die eigentliche Vorab-Prüfung — ein vergessener lokaler Lauf ist die reale Netzlücke. Gegenmittel: der pre-push-Hook (#528) fährt die schnellen Gates lokal vor dem Push.
- **Doku-als-Kontext-Kosten:** die SSOT-Doku (AGENTS.md/CLAUDE.md/Landkarte) muss **aktuell** gehalten werden — sie ist der Kontext-Selektor jeder Session; driftet sie leise, führt sie Agenten in die Irre. Darum ist „die Doku stimmt" selbst maschinell gegated (`check:docmap` #482, `check:docdrift` #529), nicht nur Disziplin.
- **Prompt-Injection-Vektor:** der Forum-Eingang (GitHub Discussions → auto-erzeugte Issues) ist der einzige Pfad, auf dem unvertrauter externer Text in die Agenten-Queue gelangt (Härtung: #531).
- **Gates sind nur so gut wie ihre Abdeckung:** was kein Gate prüft (Determinismus ist erst teilweise erzwungen #492, Coverage ungemessen #495), kann durchrutschen — die bekannten Lücken sind erfasst ([agent-harness.md §5](../agent-harness.md#5-roadmap--bekannte-lücken)).

## Re-Evaluierungs-Trigger

Diese Entscheidung wird neu aufgemacht, wenn **einer** dieser Fälle eintritt:

- **Mehrere (oder fremde) Beitragende** kommen dazu — dann wird der Umstieg auf **PR mit Required Checks auf `main`** wahrscheinlich nötig (Review/Absicherung fremder Änderungen), und der Direkt-Push-Workflow wird abgelöst.
- **Required Checks werden aus anderem Grund nötig** (z.B. GitHub-natives Auto-Merge für Dependabot, das heute wegen des Direkt-Push-Workflows zurückgestellt ist — siehe [CONTRIBUTING.md › PR-Policy](../../CONTRIBUTING.md#pull-requests--abhängigkeits-updates-policy)).
- **Der Direkt-Push auf `main` verursacht wiederholt roten `main`** trotz pre-push-Hook — dann trägt das Post-hoc-CI-Modell nicht mehr und ein blockierender PR-Gate ist fällig.
- **Ein Mensch übernimmt die Implementierung** in nennenswertem Umfang — dann verschiebt sich das Gleichgewicht der Leitplanken (Review wird verfügbar, Fitness-Functions weniger alleiniges Netz).

Tritt ein Trigger ein: neuen/abgelösten ADR schreiben (`0009-…`), diesen hier auf „abgelöst durch 0009" setzen.

## Verwandte ADRs & Dokumente

- [`docs/agent-harness.md`](../agent-harness.md) (#526): die **kanonische, erklärende** Gesamtsicht auf den Harness (fünf Bausteine, jede Fitness-Function mit WAS/WARUM/Red-Green, Autonomie-Schleife, Roadmap). Dieser ADR ist die formale Grundsatzentscheidung daneben.
- [AGENTS.md](../../AGENTS.md) / [CLAUDE.md](../../CLAUDE.md): die operative Arbeitsanweisung + der Schnellstart, die der Harness voraussetzt. *Bei Konflikt maßgeblich.*
- [ADR 0004 – Skalierungs-Fundament](0004-skalierungs-fundament.md): der Harness muss unter derselben obersten Regel tragen („trägt das bei Stardew-Scope?") — ein Harness, der bei 10× Content/parallelen Agenten zusammenbricht, ist keiner.
- [docs/arc42-architektur.md](../arc42-architektur.md): §1.4 (KI-Entwickel-Effizienz als Qualitätsziel), §9 (ADR-Übersicht), §10 (Qualitätsszenario „Wartbarkeit (KI)").

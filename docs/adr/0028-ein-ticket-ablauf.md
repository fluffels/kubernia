# ADR 0028: Genau ein Ticket-Ablauf, der Workflow-Pfad entfällt

> Architecture Decision Record. Format: Kontext → Optionen → Entscheidung → Konsequenzen → Re-Evaluierung.
> Status: **akzeptiert** · Datum: 2026-10-16 · Ticket: #1067

## Status

**Akzeptiert.** Präzisiert [ADR 0022](0022-dark-factory-kern-und-verteilung.md) (Kern-Schnitt) und [ADR 0026](0026-sammelticket-gruppen.md) (Gruppen) um die Entfernung des Workflow-Pfads. Beruft sich für das Verhältnis zum Lockern auf [ADR 0027](0027-regeln-lockern.md). [AGENTS.md](../../AGENTS.md) bleibt unverändert.

## Kontext

Der Ticket-Ablauf existierte zweimal: als Skill `kubernia` mit den Subagenten Planer, Umsetzer, Gruppen-Umsetzer und Lens, und als orchestriertes Workflow-Skript samt Einstiegs-Skill. Beide mussten bei jeder Änderung am Ablauf nachgezogen werden. Gezählt seit 2026-09-28 (Stand 2026-10-16, `git log --since=2026-09-28 origin/main --numstat -- .claude/workflows/kubernia-ticket.js` bzw. `-- .claude/skills/kubernia .claude/agents/kubernia-umsetzer.md .claude/agents/kubernia-planner.md`; der Plan zählte am Tag davor 63 und 68): rund 64 Commits (+868/−487 Zeilen) am Workflow-Skript, rund 69 Commits an Skill, Umsetzer und Planer.

Der Workflow hatte drei Lücken, die der Skill-Pfad nicht hat:

- **Keine Sammeltickets in Gruppen** ([ADR 0026](0026-sammelticket-gruppen.md)): der Workflow kannte keinen Gruppen-Umsetzer.
- **Kein Phasen-Schnitt** (#1592): der Umsetzer-Schnitt des Skill-Pfads fehlte.
- **Keine harte Autor-Prüfung** ([Sicherheit der Agenten](../sicherheit-agenten.md)): nur der Planer verweigerte bei Fremdeingang.

Zwei Pfade bedeuten doppelte Pflege und einen Pfad, der hinter dem anderen zurückbleibt.

## Optionen

| Option | Bewertung |
|---|---|
| **Entfernen (gewählt)** | Ein Ablauf, keine Doppelpflege. Reversibel per `git revert`. Die Garantien, die nur der Workflow deterministisch hielt, brauchen einen Ersatz (siehe Entscheidung). |
| **Zeiger-Skill** | Ein Einstieg, der nur auf den Skill-Pfad verweist: bliebe ein totes Artefakt, das gepflegt und von Wächtern geprüft werden müsste, ohne etwas zu tun. |
| **Workflow schlank schneiden** | Die drei Lücken schließen und das Skript verkleinern: ändert nichts an der Doppelpflege, der Workflow müsste jede Skill-Änderung weiter spiegeln. |

## Entscheidung

Entscheidung: **Der Workflow-Pfad wird entfernt, der Skill `kubernia` ist der einzige Ticket-Ablauf**, weil die Doppelpflege den Nutzen übersteigt und der Workflow hinter dem Skill zurückliegt.

**Verhältnis zu ADR 0027.** Das ist kein Lockern im Sinne von [ADR 0027](0027-regeln-lockern.md): keine Regel und kein Gate entfällt, ein zweiter Pfad zum selben Ablauf entfällt. Die einzige Garantie, die nur der Workflow deterministisch hielt (das Leitplanken-Audit), hat einen Ersatz.

**Ersatz der deterministischen Garantien:**

| Garantie | Ersatz |
|---|---|
| Review-Pflicht und Cap | Commit-Zeilen `KQ-Plan:`/`KQ-Review:` als Required-Check in der PR-CI |
| Festgefahren-Protokoll | [`festgefahren.yml`](../../.github/workflows/festgefahren.yml) nach 4 roten Commits |
| Leitplanken-Audit-Kommentar | Abschluss-Wächter `scripts/umsetzer-abschluss.mjs` |
| Fortsetzung nach Abbruch | `ticket-lock` mit übernehmbarem Claim |

Die generische Mechanik bleibt: Deckel-Logik in `check:size`, der AGENTS.md-Satz zu Workflow-Skripten, die Binder der Architektursichten und die `.gitignore`-Negation. Sie gilt für jedes künftige Skript unter `.claude/workflows/`. **Bekannte Grenze:** die Wächter für feste Modell-IDs, absolute Pfade, rohes Kommentar-Lesen und `npm ci` im Worktree sowie die Routing-Prüfung je `agent()`-Aufruf scannen den Ordner nicht mehr; ein neues Workflow-Skript bindet sie in seinem Ticket wieder ein. Der Abschluss-Wächter prüft den Audit-Kommentar nur für den Umsetzer-Subagenten (nicht für PRs, die der Hauptchat mergt) und gibt bei `gh`-Fehlern frei. Präzisiert durch #1740: die Kontext-Wächter scannen `.claude/workflows/` wieder.

## Konsequenzen

- Eine Quelle für den Ablauf; Änderungen am Ablauf gehen an einer Stelle durch.
- Sammeltickets, Phasen-Schnitt und Autor-Prüfung gelten für jeden Lauf.
- Die Spalten und Zeilen zum Workflow in [model-routing](../model-routing.md), [agent-harness](../agent-harness.md), [Glossar](../harness-glossar.md) und [Sicherheit der Agenten](../sicherheit-agenten.md) entfallen; ältere ADRs bleiben als Historie unverändert.
- Textreste des entfernten Pfads fängt der Wächter `test/harness/entfernte-pfade.test.ts` (Namen und Umschreibungen in allen getrackten Dateien, Ausnahmen mit Grund: ADRs, der Absenz-Test, der Wächter selbst); dass die Dateien fehlen, prüft `test/harness/model-routing.test.ts`.
- Rückweg: `git revert` des Entfernungs-PR (#1067).

## Re-Evaluierung

Wenn eine zweite Ablauf-Variante nachweislich gebraucht wird (ein Anwendungsfall, den der Skill-Pfad nicht abdeckt, belegt an Läufen oder einem Ticket), wird ein neuer ADR geschrieben, der den Mehrwert gegen die Doppelpflege dieses ADR abwägt.

## Fortschreibung #1806 (2026-10-21): Zwei Ticket-Skills, ein Ablauf

Anlass: `/kubernia` zog je nach Spielquote ein Spiel- oder ein Agentic-Ticket, und der Bereich kam aus einem Auslöser-Wort oder aus der Quote. Spiel und Agentic haben getrennte Boards, Quoten und Reviews, und der Harness wird als eigenes Repo herausgelöst ([ADR 0022](0022-dark-factory-kern-und-verteilung.md)); ein Ticket-Skill gehört dann zum Kern.

Entscheidung:

- Es gibt zwei Einstiege, die nur Bereich und Auslöser festlegen: der Produkt-Skill `kubernia` (`--bereich spiel`, nur Produkt-Board) und `factory` (`--bereich agentic`, nur Factory-Board). Die Notfälle 🚨 und 🔒 gelten auf beiden Boards. Die Einstiege setzen den Bereich, darum sind sie keine Zeiger-Skills im Sinn der Optionstabelle oben.
- Der Ablauf steht einmal in `.claude/skills/factory/ablauf.md` (Ring `kern`, ohne Frontmatter, ohne Projektliterale: Agentennamen als Platzhalter `<agenten.…>`, die der Hauptchat aus `.factory/projekt.json` einsetzt). Der Wächter `test/harness/ticket-ablauf.test.ts` meldet Ablauf-Werkzeuge und wortgleiche Ablaufsätze in den Einstiegen.
- Der Produkt-Skill gehört dem Projekt (Name und Auslöser sind Projektwerte) und steht nicht im Besitz-Manifest; `factory` und der Ablauf sind Kern.
- Name `factory`: Kurzform des Repo-Namens des Harness, im Repo schon etabliert (`.factory/`, Factory-Board), klar von `/kubernia` zu unterscheiden, kein Projektliteral.

Konsequenzen: Factory-Arbeit entsteht nur noch über `/factory`; die Spielquote ist Soll und Kennzahl (Selbst-Audit), siehe [ADR 0016](0016-langfuse-takt-woechentlich.md). Laufende Sessions sehen `/factory` womöglich erst nach einem Neustart.

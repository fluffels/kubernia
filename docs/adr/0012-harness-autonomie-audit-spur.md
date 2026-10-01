# ADR 0012: Harness-Autonomie — Audit-Spur statt Merge-Freigabe, Fokus der Harness-Phase

> Architecture Decision Record. Format: Kontext → Problem → Optionen → Entscheidung → Konsequenzen → Re-Evaluierung.
> Status: **akzeptiert** · Datum: 2026-09-28 · Tickets: #1069 (Umsetzung), #1072 (dieser ADR)

## Status

**Akzeptiert.** Präzisiert [ADR 0008](0008-ki-agenten-harness.md) (Entwicklungsmodell) und [ADR 0009](0009-pr-gating-required-checks.md) (Integrationsweg) an einer Stelle: wer einen PR merged, der die **Leitplanken selbst** ändert. Nimmt den Merge-Checkpoint aus #1012 zurück. Umgesetzt mit #1069 (PR #1071); die operative Regel steht in [AGENTS.md › Human-in-the-Loop-Checkpoints](../../AGENTS.md), die Erklärung in [docs/agent-harness.md](../agent-harness.md).

## Kontext

Seit #1012 galt ein **Merge-Checkpoint**: fasste ein Diff Harness-/Leitplanken-Dateien (`AGENTS.md`, `CLAUDE.md`, `.claude/`, `.agents/`, `docs/agent-harness*`) oder die Goodhart-Gate-Config an, durfte der Agent **nicht selbst mergen** — PR öffnen, CI grün bringen, an die Maintainerin übergeben. Dazu hielt die Pre-Flight-Klärung bei jedem solchen Ticket schon **vor dem Coden** an.

Eine Backlog-Triage am 2026-09-28 zeigte zwei Dinge:

1. **Der Harness hatte das Spiel verdrängt.** Seit Ende Juli waren fast nur noch Harness-/Gate-Tickets gelandet; rund die Hälfte des offenen Backlogs betraf den Harness, viele Tickets entstanden aus Befunden anderer Harness-Tickets. 24 Einzeltickets wurden in vier Sammeltickets gebündelt (#1064–#1067), dazu die Token-Baseline #1068.
2. **Der Checkpoint band die Maintainerin an genau diese Tickets.** Bei einer bewusst gewählten Harness-Phase (s.u.) wäre sie bei **jedem** Ticket zweimal im Loop gewesen (Pre-Flight + Merge). Ein fertiger Datenverlust-Fix (#1059 zu #1051) lag so einen Monat unbemerkt offen.

## Das Problem

Menschliche Freigabe ist die stärkste Absicherung gegen einen Agenten, der seine eigenen Leitplanken aufweicht — aber sie skaliert nicht, wenn gerade die Leitplanken das Arbeitsgebiet sind. Im Single-Account-Modell greift der CODEOWNERS-Pflichtreview nicht (#723), und das Label `maintainer-approved` des `gate-change-guard` (#1012/#1015) ist ebenso selbst setzbar; der echte menschliche Schritt war nur der **Nicht-Self-Merge**. Gesucht ist ein Ersatz, der Autonomie erlaubt, ohne Leitplanken-Änderungen unsichtbar zu machen.

## Optionen

| Option | Bewertung |
|---|---|
| **Status quo (Merge-Checkpoint)** | Maximale Sicherheit, aber die Maintainerin ist bei jedem Harness-Ticket im Loop; genau das Ziel der Harness-Phase wird verfehlt. |
| **Alles außer Gate-Aufweichung** (Empfehlung des Agenten) | Agent merged Harness-/Doku-/Skill-Änderungen selbst; nur PRs, die Gates/Schwellen/Permissions/Hooks/CI abschwächen, bleiben menschlich. Fast kein Bremsen im Alltag, die eine gefährliche Klasse bliebe gegatet. |
| **Komplett alles (gewählt)** | Agent merged auch Gate-/CI-Änderungen selbst. Minimaler Loop; das Restrisiko (Agent schwächt eigene Leitplanken) wird über Sichtbarkeit + Verhaltensregel statt über einen Stopp adressiert. |
| **Nur Doku/Skills** | Agent merged nur Markdown-Änderungen selbst; Workflow-Skript, Scripts, Tests, CI bleiben menschlich. Zu eng für eine Harness-Phase, deren Kern Skript-/Gate-Arbeit ist. |

## Entscheidung

Die Maintainerin wählt **„komplett alles"**:

1. **Kein Merge-Checkpoint mehr.** Bei Harness-/Leitplanken-/Gate-Diffs setzt der Agent `maintainer-approved` **selbst** und merged wie jeden anderen PR — Voraussetzung unverändert: CI grün + Mehr-Perspektiven-Review bestanden.
2. **Label-Reihenfolge schützt den Guard:** das Label erst setzen, wenn alle anderen Checks grün sind, und vor jedem weiteren Fix-Push wieder entfernen. Sonst sähe der `gate-change-guard` eine später im selben PR nachgeschobene Gate-Änderung nicht mehr.
3. **Audit-Spur ersetzt die Freigabe:** direkt nach dem Merge ein PR-Kommentar „🛡️ Leitplanken-Änderung selbst gemergt" — *was* sich an den Leitplanken ändert, *warum*, *wie reverten* (`git revert <squash-sha>` per PR). Die Maintainerin liest asynchron gegen. Im Workflow als Schema-Feld `auditKommentar` mit lauter Warnung, wenn er fehlt.
4. **Pre-Flight nur noch für echte Entscheidungen:** 🎨 Optik, ⚠️ riskante Weiche, offene Plan-Weiche. Harness-/Gate-Dateien allein sind kein Stopp-Grund.
5. **Unverändert:** `gate-change-guard` + CODEOWNERS (das Label markiert jede Leitplanken-Änderung im PR-Log), der Mehr-Perspektiven-Review vor dem Merge, die Goodhart-Verhaltensregel (nie ein Gate abschwächen, nur um grün zu werden).

**Fokus der Harness-Phase.** Parallel entschieden: erst das KI-Gerüst fertig machen, dann wieder Spielentwicklung. Ziele: **wenig Human-in-the-Loop, wenig Tokens, hohe Qualität.** Umgesetzt über die Board-Reihenfolge — Windows-Start des Workflows (#1026), Token-/Loop-Baseline (#1068), dann die Sammeltickets (AGENTS.md kürzen #1064, genau ein Ablauf #1067 mit Folgepunkten #1070, Modell-Routing #1065, native Worktree-Isolation #1066), die Qualitäts-Gates #1023/#1022, danach Security/Repo-Tickets und das Spiel. Ein separates „Projekt-Brain" oder Wiki neben dem Repo wurde bewusst nicht angelegt: das Repo selbst (AGENTS.md, ADRs, `docs/`, Issues) ist der Wissensspeicher; nur übertragbare Konzepte und persönliche Arbeitskonventionen (z.B. der Chat-Abschlusssatz, #935) gehören ins persönliche Brain der Maintainerin.

## Konsequenzen

**Positiv**
- Harness-Tickets laufen durch, ohne dass die Maintainerin pro Ticket freigeben muss; liegengebliebene grüne PRs wie #1059 entstehen nicht mehr.
- Jede Leitplanken-Änderung bleibt sichtbar (Label + Audit-Kommentar) und ist per Revert-PR zurückholbar.
- Die Regel ist tool-neutral in AGENTS.md verankert und per Fitness-Function bewacht ([`test/harness/harness-approval.test.ts`](../../test/harness/harness-approval.test.ts), Marker „Leitplanken-Änderung selbst gemergt").

**Negativ / Trade-offs**
- **Kein Mensch mehr vor dem Merge einer Leitplanken-Änderung.** Ein Agent könnte eine eigene Leitplanke aufweichen; die Absicherung ist nachgelagert (Audit + Revert) und die Goodhart-Regel ist eine Verhaltensregel, kein technischer Riegel.
- **Harness-Erkennung ist Selbstauskunft** des Umsetzungs-Agenten (`beruehrtHarness`); fasst eine Fix-Runde neu Leitplanken an, merkt die Merge-Phase das nicht — offen in #1070.
- **Der Auto-Modus von Claude Code kann trotzdem bremsen.** Unabhängig von der Repo-Regel kann dessen Klassifikator Änderungen an `.claude/`-Dateien, Hooks oder Permissions als Self-Modification blocken (vgl. [docs/agent-harness.md](../agent-harness.md)); bei der Umsetzung von #1069 blockte er genau die Prompt-Stellen, die den Merge-Checkpoint entfernten, und vereinzelt auch GitHub-Schreib- und Warte-Befehle. Solche Tickets brauchen die Maintainerin weiter kurz im normalen Modus; bei Spiel-Tickets entfällt das weitgehend.

## Re-Evaluierungs-Trigger

- **Ein selbst gemergter PR hat eine Leitplanke tatsächlich aufgeweicht** (per Audit-Kommentar oder später entdeckt) — dann auf „alles außer Gate-Aufweichung" zurückgehen oder einen technischen Riegel für Gate-Schwellen einziehen.
- **Audit-Kommentare fehlen wiederholt** oder werden nicht gelesen — dann ist die Audit-Spur kein Ersatz mehr für die Freigabe.
- **Die Harness-Phase ist abgeschlossen** (Sammeltickets erledigt, Baseline aus #1068 zeigt die Wirkung) — Fokus zurück aufs Spiel, diesen ADR um das Ergebnis fortschreiben.
- **Die Solo-Konstellation ändert sich** (weitere Beitragende) — dann den Merge-Checkpoint neu bewerten, wie schon in ADR 0009 für Pflicht-Reviews vorgesehen.

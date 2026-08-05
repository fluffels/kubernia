---
name: kubernia-workflow
description: Arbeitet EIN offenes kubernia-Ticket end-to-end ab wie der kubernia-Skill, aber als orchestrierter Phasen-Workflow — mit sichtbarem Fortschritt in /workflows, Resume nach Abbruch, den drei Review-Lenses parallel und erzwungener Fix-Versuchsgrenze. Nur unter Claude Code; der normale kubernia-Skill bleibt der tool-neutrale Weg. Auslösen bei "kubernia als Workflow", "Ticket als Workflow", "kubernia-Workflow", "Ticket mit Workflow abarbeiten", "starte den Ticket-Workflow", oder wenn beim Abarbeiten eines kubernia-Tickets der Phasen-Fortschritt in /workflows mitlaufen soll.
---

# Kubernia-Ticket als Workflow abarbeiten

Dieser Skill ist **nur der Einstieg** in den Workflow [`kubernia-ticket`](../../workflows/kubernia-ticket.js) — er beschreibt den Ablauf **absichtlich nicht**. Der Ablauf ist und bleibt die Repo-SSOT ([`AGENTS.md`](../../../AGENTS.md), [`CLAUDE.md`](../../../CLAUDE.md)); das Workflow-Skript ist nur die Orchestrierung darüber und schickt jeden Phasen-Agenten auf den passenden Abschnitt.

**Aufruf** (der Skill-Aufruf ist gleichzeitig das nötige Opt-in für das Workflow-Tool):

```
Workflow({ name: "kubernia-ticket" })
```

Soll ein **bestimmtes** Ticket laufen statt des obersten freien Board-Items, die Nummer als `args` mitgeben (sie wird genauso auf frei/offen geprüft):

```
Workflow({ name: "kubernia-ticket", args: 815 })
```

Der Workflow läuft im Hintergrund. Danach: den zurückgegebenen Endstand knapp berichten — was gelaufen ist, welche Nummer, ob gemergt. Sonderausgänge (#1012):
- **`wartet-auf-klaerung`** — die Pre-Flight-Klärung hält an: die `offeneFragen` der Maintainerin vorlegen (z.B. per `AskUserQuestion`), dann `Workflow({ name: "kubernia-ticket", resumeFromRunId, args: { klaerungAntworten: [...] } })`.
- **`wartet-auf-freigabe`** — Harness-/Leitplanken-Diff: PR offen + CI grün, aber bewusst **nicht** self-gemergt. Der Maintainerin zum Review + `maintainer-approved` + Merge übergeben; Worktree bleibt bis dahin stehen.
- **`festgefahren` / `review-festgefahren`** — die Entscheidungsoptionen zeigen, statt weiter zu probieren.

## Wann dieser Skill statt `/kubernia`?

| | `/kubernia` (Skill) | dieser Workflow |
|---|---|---|
| Läuft mit | **jedem** Agenten/Tool (liest nur `AGENTS.md`) | **nur** Claude Code |
| Fortschritt | Chat-Verlauf | Phasen-Baum in `/workflows` |
| Rückfragen mitten drin | ja (live `AskUserQuestion`) | **ja, via Halt → `resumeFromRunId`** (kein Live-Prompt; #1012) |
| Human-in-the-Loop (#1012) | Pre-Flight + Merge per `AskUserQuestion`/Hand-off | Pre-Flight **hält an + gibt Fragen zurück**; Harness-Diff → kein Self-Merge |
| Abbruch/Absturz | von vorn | `resumeFromRunId` — unveränderte Phasen kommen aus dem Cache |
| Review-Lenses (#532) | Konvergenzschleife (Cap 2) | **parallel**, als Konvergenzschleife (Cap 2, #1012) |
| Fix-Versuchsgrenze (#710) | Verhaltensregel | **Schleifengrenze im Skript** |

✅ **Auch heikle Tickets laufen jetzt über den Workflow (#1012).** Weil das Ticket automatisch gezogen wird, weiß man vorab nicht, ob es eine Rückfrage braucht — der Workflow **klassifiziert das selbst** (Pre-Flight): braucht ein Ticket eine Entscheidung (🎨 Optik/Grafik, ⚠️ riskante Weiche, Harness-/Gate-Datei, offene Plan-Weiche), **hält er an und gibt die Fragen zurück**, statt zu codieren. Das Workflow-Tool hat kein Mid-Run-Ask-Primitiv: die Fragen der Maintainerin vorlegen, dann per `resumeFromRunId` mit den Antworten in `args.klaerungAntworten` fortsetzen (Auswahl + Plan kommen aus dem Cache, kaum Extra-Tokens). Am Merge übergibt er Harness-/Leitplanken-Diffs bewusst an die Maintainerin (kein Self-Merge). Epics und das 🤖-Dependabot-Sammelticket steigen wie bisher nach dem Claimen in eine eigene Phase aus (kein Code, kein Worktree).

## Warum es beides gibt

Das Repo ist bewusst **selbstdokumentierend für jedes Tool** — ein Codex-/Cursor-/Gemini-Agent liest `.claude/` gar nicht. Ein Workflow-Skript ist deshalb **niemals** der Ort für den Ablauf, sondern nur eine additive Claude-Code-Optimierung: dieselbe Zweischichtigkeit wie bei der Modellwahl (portabler Kern in `AGENTS.md`, Automatik additiv obendrauf) — Begründung in [docs/agent-harness.md § 2.5](../../../docs/agent-harness.md).

**Ablauf-Änderungen gehören in `AGENTS.md`.** Ins Skript gehört nur, was echte *Orchestrierung* ist: Reihenfolge, Parallelität, Abbruchbedingungen.

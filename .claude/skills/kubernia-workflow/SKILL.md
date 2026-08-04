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

Der Workflow läuft im Hintergrund. Danach: den zurückgegebenen Endstand knapp berichten — was gelaufen ist, welche Nummer, ob gemergt. Bei `festgefahren` die Entscheidungsoptionen zeigen, statt weiter zu probieren.

## Wann dieser Skill statt `/kubernia`?

| | `/kubernia` (Skill) | dieser Workflow |
|---|---|---|
| Läuft mit | **jedem** Agenten/Tool (liest nur `AGENTS.md`) | **nur** Claude Code |
| Fortschritt | Chat-Verlauf | Phasen-Baum in `/workflows` |
| Rückfragen mitten drin | ja | **nein** (Workflow ist nicht-interaktiv) |
| Abbruch/Absturz | von vorn | `resumeFromRunId` — unveränderte Phasen kommen aus dem Cache |
| Review-Lenses (#532) | nacheinander | **parallel** |
| Fix-Versuchsgrenze (#710) | Verhaltensregel | **Schleifengrenze im Skript** |

⚠️ **Nicht-interaktiv ist der eine echte Nachteil:** ein Ticket, das laut [AGENTS.md § Immer loslegen](../../../AGENTS.md#konventionen) eine Rückfrage braucht (🎨 Optik/Grafik — das Aussehen stimmt der Agent per Rückfrage ab; ⚠️ riskant — echte Weichen abstimmen), gehört über `/kubernia`, nicht hierher. Epics und das 🤖-Dependabot-Sammelticket kann der Workflow, er steigt dafür nach dem Claimen in eine eigene Phase aus (kein Code, kein Worktree).

## Warum es beides gibt

Das Repo ist bewusst **selbstdokumentierend für jedes Tool** — ein Codex-/Cursor-/Gemini-Agent liest `.claude/` gar nicht. Ein Workflow-Skript ist deshalb **niemals** der Ort für den Ablauf, sondern nur eine additive Claude-Code-Optimierung: dieselbe Zweischichtigkeit wie bei der Modellwahl (portabler Kern in `AGENTS.md`, Automatik additiv obendrauf) — Begründung in [docs/agent-harness.md § 2.5](../../../docs/agent-harness.md).

**Ablauf-Änderungen gehören in `AGENTS.md`.** Ins Skript gehört nur, was echte *Orchestrierung* ist: Reihenfolge, Parallelität, Abbruchbedingungen.

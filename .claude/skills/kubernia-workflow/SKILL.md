---
name: kubernia-workflow
description: Arbeitet EIN kubernia-Ticket als orchestrierten Phasen-Workflow ab (Fortschritt in /workflows, Resume, Lenses parallel); nur Claude Code. Auslösen bei "kubernia als Workflow", "Ticket als Workflow", "kubernia-Workflow", "starte den Ticket-Workflow".
---

# Kubernia-Ticket als Workflow abarbeiten

Dieser Skill ist **nur der Einstieg** in den Workflow [`kubernia-ticket`](../../workflows/kubernia-ticket.js) — er beschreibt den Ablauf **absichtlich nicht**. Der Ablauf ist und bleibt die Repo-SSOT [`AGENTS.md`](../../../AGENTS.md); das Workflow-Skript ist nur die Orchestrierung darüber und schickt jeden Phasen-Agenten auf den passenden Abschnitt.

**Aufruf** (der Skill-Aufruf ist gleichzeitig das nötige Opt-in für das Workflow-Tool):

```
Workflow({ name: "kubernia-ticket" })
```

Soll ein **bestimmtes** Ticket laufen statt des obersten freien Board-Items, die Nummer als `args` mitgeben (sie wird genauso auf frei/offen geprüft):

```
Workflow({ name: "kubernia-ticket", args: 815 })
```

**Die Form ist egal.** Die Laufzeit reicht `args` als **String** durch — auch ein übergebenes Objekt kommt als JSON-String an (gemessen). Das Skript normalisiert an **einer** Stelle die ganze `args`-Grenze: `815`, `"815"`, `"#815"`, `{nummer: 815}` und `'{"nummer": "815"}'` führen alle zum selben Ticket. **Lässt sich aus einem gesetzten `args` weder eine Nummer noch Klärungsantworten ableiten, bricht der Lauf ab** (`ergebnis: "ungueltige-args"`) statt still auf das Board-Item zurückzufallen — ein stiller Fremd-Claim ist teurer als ein Abbruch. Ein reines Resume-`args` (`{klaerungAntworten: [...]}`) trägt bewusst keine Nummer und läuft normal weiter. Bewacht von [`test/harness/workflow-args.test.ts`](../../../test/harness/workflow-args.test.ts).

Der Workflow läuft im Hintergrund. Danach: den zurückgegebenen Endstand knapp berichten — was gelaufen ist, welche Nummer, ob gemergt. Sonderausgänge (#1012):
- **`wartet-auf-klaerung`** — die Pre-Flight-Klärung hält an: die `offeneFragen` der Maintainerin vorlegen (z.B. per `AskUserQuestion`), dann `Workflow({ name: "kubernia-ticket", resumeFromRunId, args: { klaerungAntworten: [...] } })`. **Lief der Ursprungslauf auf einer vorgegebenen Nummer, diese mitgeben** — `args: { nummer: 815, klaerungAntworten: [...] }` —, sonst fehlt sie dem Auswahl-Prompt beim Resume.
- **`ungueltige-args`** — aus `args` ließ sich keine Ticketnummer ableiten; der Lauf bricht bewusst ab, statt still das oberste Board-Item zu claimen (#1027). `args` korrigieren und neu starten (kein Resume nötig, es wurde noch kein Agent gestartet).
- **`festgefahren` / `review-festgefahren`** — die Entscheidungsoptionen zeigen, statt weiter zu probieren.

## Wann dieser Skill statt `/kubernia`?

| | `/kubernia` (Skill) | dieser Workflow |
|---|---|---|
| Läuft mit | **jedem** Agenten/Tool (liest nur `AGENTS.md`) | **nur** Claude Code |
| Fortschritt | Chat-Verlauf | Phasen-Baum in `/workflows` |
| Rückfragen mitten drin | ja (live `AskUserQuestion`) | **ja, via Halt → `resumeFromRunId`** (kein Live-Prompt; #1012) |
| Human-in-the-Loop (#1012/#1069) | Pre-Flight per `AskUserQuestion`; Harness-Diff → Label selbst + Audit-Kommentar | Pre-Flight **hält an + gibt Fragen zurück**; Harness-Diff → Label selbst + Audit-Kommentar |
| Abbruch/Absturz | von vorn | `resumeFromRunId` — unveränderte Phasen kommen aus dem Cache |
| Review-Lenses (#532) | Konvergenzschleife (Cap 2) | **parallel**, als Konvergenzschleife (Cap 2, #1012) |
| Fix-Versuchsgrenze (#710) | Verhaltensregel | **Schleifengrenze im Skript** |

✅ **Auch heikle Tickets laufen über den Workflow (#1012).** Weil das Ticket automatisch gezogen wird, weiß man vorab nicht, ob es eine Rückfrage braucht — der Workflow **klassifiziert das selbst** (Pre-Flight): braucht ein Ticket eine Entscheidung (🎨 Optik/Grafik, ⚠️ riskante Weiche, offene Plan-Weiche), **hält er an und gibt die Fragen zurück**, statt zu codieren. Das Workflow-Tool hat kein Mid-Run-Ask-Primitiv: die Fragen der Maintainerin vorlegen, dann per `resumeFromRunId` mit den Antworten in `args.klaerungAntworten` fortsetzen (Auswahl + Plan kommen aus dem Cache, kaum Extra-Tokens). Harness-/Leitplanken-Diffs mergt er selbst (Label selbst gesetzt, danach Audit-Kommentar auf dem PR). Epics und das 🤖-Dependabot-Sammelticket steigen wie bisher nach dem Claimen in eine eigene Phase aus (kein Code, kein Worktree).

## Warum es beides gibt

Das Repo ist bewusst **selbstdokumentierend für jedes Tool** — ein Codex-/Cursor-/Gemini-Agent liest `.claude/` gar nicht. Ein Workflow-Skript ist deshalb **niemals** der Ort für den Ablauf, sondern nur eine additive Claude-Code-Optimierung: dieselbe Zweischichtigkeit wie bei der Modellwahl (portabler Kern in `AGENTS.md`, Automatik additiv obendrauf) — Begründung in [docs/agent-harness.md § 2.5](../../../docs/agent-harness.md).

**Ablauf-Änderungen gehören in `AGENTS.md`.** Ins Skript gehört nur, was echte *Orchestrierung* ist: Reihenfolge, Parallelität, Abbruchbedingungen.

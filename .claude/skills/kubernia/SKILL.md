---
name: kubernia
description: Arbeitet EIN kubernia-Ticket end-to-end ab (claimen, planen, klären, Umsetzung bis zum Merge im Subagenten kubernia-umsetzer); zu große Epics werden aufgeteilt. Auslösen bei "arbeite ein kubernia-Ticket ab", "nimm das nächste kubernia-Ticket", "mehrere kubernia-Tickets".
model: sonnet
effort: medium
---

# Kubernia-Ticket abarbeiten

**Dieses Repo ist selbstdokumentierend.** Das komplette Vorgehen lebt versioniert im Repo, damit **jeder Agent — egal welches Tool und welcher Account** — es nutzen kann. Quellen:

```
AGENTS.md     ← SSOT: harte Regeln, Board-Workflow, Konventionen — jede Regel genau einmal
docs/referenz/ ← Nachschlage-Referenz on-demand (Befehle, Repo-Landkarte, Schichtregeln, Anlaufstellen)
```

**Lies `AGENTS.md` und folge ihr** – der **Ablauf** steht ausschließlich dort; `docs/referenz/` nur bei Bedarf nachschlagen. Bei Konflikt gilt `AGENTS.md`. Dieser Skill legt nur fest, **wer** welchen Teil macht: der Hauptchat alles, was eine Rückfrage an die Maintainerin braucht, der Subagent `kubernia-umsetzer` den Rest.

## Im Hauptchat

1. **Auswählen und claimen.** **Genau EIN** offenes Issue, das **nicht** schon bearbeitet wird (kein Assignee/Branch/Worktree) — rein deterministisch das **oberste freie Item der manuellen Board-Reihenfolge**, nie nach Inhalt aussuchen und **nicht nachsortieren**; Auswahl-Befehl (`gh project item-list`, braucht `read:project`-Scope) + Sonderfälle in `docs/ticket-reihenfolge.md`. **Claimen per `gh issue edit <nr> --add-assignee @me` und mit `gh issue view <nr>` verifizieren ist Pflicht und blockierend.** Direkt danach eine kopierfertige Zeile `/rename kq-<nr> <Kurztitel>` (ASCII, max. ~40 Zeichen) ausgeben, weil nur die Userin eine Session umbenennen kann (#1213).
2. **Planen.** Den Planungs-Subagenten rufen und auf seinen Bericht warten:
   ```
   Agent({
     subagent_type: "kubernia-planner",
     description: "Planungspass für #<nr>",
     prompt: "Ticket #<nr>: <Titel>. Body:\n<Volltext des gh issue view>"
   })
   ```
   Ist der Agent nicht verfügbar, skizziert der Hauptchat den Plan kurz selbst und gibt ihn dem Umsetzer mit.
3. **Pre-Flight-Klärung** nach AGENTS.md § Human-in-the-Loop-Checkpoints: braucht das Ticket eine menschliche Entscheidung (🎨 Optik, ⚠️ riskante Weiche, offene Weiche im Plan), **jetzt** per `AskUserQuestion` klären. Optik-Iterationen mit PixelLab laufen hier (der Umsetzer hat PixelLab nicht in seiner Whitelist); das gewählte Asset liegt als Datei im Temp-Ordner, der Umsetzer bekommt den Pfad (eine Job-ID nützt ihm nichts).
4. **Umsetzer spawnen** (nächster Abschnitt) und sein Ergebnis behandeln.

Solange der Umsetzer läuft, fasst der Hauptchat weder Repo noch Worktree an und startet keinen zweiten Umsetzer.

**Sonderfall zu großes Epic/Phase:** nicht umsetzen. Die Aufteilung ist Planungsarbeit: nach dem Claimen den `kubernia-planner` (Opus) mit dem Aufruf oben rufen, im Prompt der Hinweis „Epic: liefere die Aufteilung“. Du legst genau die vorgeschlagenen session-großen Kindertickets an (ohne Assignee, `area:`-Label, im Board einsortiert; offene Weichen des Plans in den Body des betroffenen Kindes), postest im Epic einen Übersichts-Kommentar mit Reihenfolge und schließt das Epic mit `gh issue close <nr> --reason completed` (nicht löschen), Schließung verifizieren. Kein Worktree, kein Umsetzer. Ist der Planer nicht verfügbar, teilst du selbst auf. **🤖 Dependabot-Sammelticket:** ebenfalls im Hauptchat nach AGENTS.md, ohne Planer und Umsetzer.

## Umsetzung als Subagent

```
Agent({
  subagent_type: "kubernia-umsetzer",
  description: "Umsetzung #<nr>",
  prompt: "Ticket #<nr>: <Titel>. Body:\n<Volltext>\n\n--- Plan ---\n<Plan des kubernia-planner bzw. Skizze des Hauptchats>\n--- Ende Plan ---\n\n--- Pre-Flight-Antworten (verbindlich) ---\n<Antworten der Maintainerin, sonst: keine>\n--- Ende ---"
})
```

Kein `model:` am Spawn: Modell und Effort stehen im Frontmatter des Umsetzers und gelten unabhängig vom Modell der Session. Der Umsetzer setzt um, fährt `npm run verify`, den [review-lenses](../review-lenses/SKILL.md)-Review (spawnt selbst die `kubernia-lens`-Subagenten), PR, CI-Fix, Merge und Cleanup. Seine letzte Nachricht beginnt mit `ERGEBNIS:`:

- **`gemergt`** — der Maintainerin kurz berichten (Ticket, PR, Entscheidungen, Befunde).
- **`entscheidung-noetig`** — die `FRAGEN` per `AskUserQuestion` vorlegen, dann denselben Umsetzer mit der Antwort fortsetzen: `SendMessage({ to: "<agentId aus dem Spawn>", message: "Antwort der Maintainerin: …" })`. Sein Kontext bleibt erhalten. Ist die Session inzwischen verloren, startet ein neuer Umsetzer; er übernimmt vorhandenen Worktree und Branch.
- **`festgefahren`** — die Optionen vorlegen (aus dem PR-Kommentar bzw. bei Review-Blockern nach Cap 2, ohne PR, aus der Zusammenfassung), nicht selbst weiterprobieren.
- **`abgebrochen`** — Grund melden; das Ticket bleibt zugewiesen.

**Mehrere Tickets:** Anzahl N aus der Auslöse-Nachricht übernehmen, sonst kurz fragen. Dann nacheinander je Ticket der ganze Ablauf oben mit einem frischen Umsetzer, nie parallel (Merge-Kollision auf `main`); kein freies Ticket mehr ⇒ sofort aufhören. Im Stapel statt einer `/rename`-Zeile je Ticket nur eine am Ende (`/rename kq-<erste>-<letzte>`), sonst überschreibt jede die vorige. Zum Schluss eine Übersicht: erledigte Tickets, wie viele von N. Der Hauptchat wächst pro Ticket nur um Plan und Bericht.

## Warum so

- **Modell-Routing (#1035/#1065/#1280).** Skill-Frontmatter (`model`/`effort` oben) gilt laut Claude-Code-Doku nur für den laufenden Turn und greift beim Skill-Tool nicht verlässlich (anthropics/claude-code#98898); ein Projekt-Default ließe sich per `/model` überstimmen und ist darum nicht gesetzt. Verlässlich wirkt nur Agent-Frontmatter: darum Umsetzer (`sonnet`), Planer und Lenses (`opus`) als Subagenten. Matrix, Beleg und Grenzen: [docs/model-routing.md](../../../docs/model-routing.md).
- **Rückfragen bleiben möglich.** Subagenten können nicht fragen (`AskUserQuestion` ist dort entfernt); die Pflicht-Rückfrage liegt aber vor dem Coden im Hauptchat, und spätere Fragen laufen über `entscheidung-noetig` und `SendMessage`.
- **Kein Self-Grading (#1012).** Der Review läuft im Umsetzer über eigene Lens-Subagenten, nie inline. Regel-Heimat: AGENTS.md › Mehr-Perspektiven-Review.

**Variante mit Phasen-Fortschritt (nur Claude Code, optional).** Denselben Ablauf gibt es als orchestrierten Workflow — [`kubernia-workflow`](../kubernia-workflow/SKILL.md) bzw. [`.claude/workflows/kubernia-ticket.js`](../../workflows/kubernia-ticket.js): sichtbarer Phasen-Fortschritt (`/workflows`), Resume nach Abbruch, die Fix-Versuchsgrenze aus #710 als Schleifengrenze; Rückfragen nur per Halt und `resumeFromRunId`. **Dieser Skill bleibt der maßgebliche Weg**, weil eine fremde KI `.claude/` nicht liest und den Ablauf dann einfach aus `AGENTS.md` in einem Agenten fährt.

**Inhaltliche Änderungen am Ablauf immer in der Repo-`AGENTS.md` machen, nicht in dieser Skill-Datei** — und erst recht nicht im Workflow-Skript, das bewusst nur Orchestrierung enthält (Reihenfolge, Parallelität, Abbruchbedingungen).

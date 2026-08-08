---
name: kubernia
description: Arbeitet eigenständig EIN offenes kubernia-Ticket end-to-end ab (auswählen → per Assignee claimen → eigener git-Worktree → umsetzen → ggf. Doku im selben Branch anpassen → EINEN PR öffnen und bis zum Merge bringen (CI abwarten, Rot fixen) → Worktree/Branch aufräumen), kollisionssicher neben parallel laufenden Agenten. Ist das Ticket ein zu großes Epic/eine Phase, wird es stattdessen in viele konkrete neue Tickets aufgeteilt und das Epic auf done geschlossen (nicht selbst umgesetzt). Auslösen bei "arbeite ein kubernia-Ticket ab", "neues kubernia-Ticket", "starte ein kubernia-Ticket", "nimm dir ein kubernia-Ticket", "setz das nächste kubernia-Ticket um", "nimm das nächste kubernia-Ticket", "mach das nächste kubernia-Ticket", "nächstes Ticket für kubernia", oder wenn autonom das nächste offene kubernia-Issue umgesetzt werden soll.
model: sonnet
effort: medium
---

# Kubernia-Ticket abarbeiten

**Dieses Repo ist selbstdokumentierend.** Das komplette Vorgehen lebt versioniert im Repo, damit **jeder Agent — egal welches Tool und welcher Account** — es nutzen kann. Quellen im Repo-Root:

```
AGENTS.md     ← SSOT: harte Regeln, Board-Workflow, Konventionen — jede Regel genau einmal
CLAUDE.md     ← Brücke dorthin (@AGENTS.md-Import) + Referenz-Tabellen (Befehle, Repo-Landkarte, Schichtregeln)
```

**Lies diese beiden und folge ihnen Schritt für Schritt** – den **Ablauf** ausschließlich aus `AGENTS.md` (seit #992 steht er nicht mehr zusätzlich in `CLAUDE.md`). Bei Konflikt gilt `AGENTS.md`.

Kurzfassung: **Genau EIN** offenes Issue, das **nicht** schon bearbeitet wird (kein Assignee/Branch/Worktree) — rein deterministisch ausgewählt als **oberstes freies Item der manuellen Board-Reihenfolge** (die, die `gh project item-list` liefert; `status:zurückgestellt` überspringen), nie nach Inhalt aussuchen und **nicht nachsortieren**; fertig gefilterter Auswahl-Befehl (`gh project item-list`, braucht `read:project`-Scope) + Sonderfälle in `docs/ticket-reihenfolge.md`. **Claimen per `gh issue edit <nr> --add-assignee @me` und mit `gh issue view <nr>` verifizieren ist Pflicht und blockierend** — ohne bestätigte Zuweisung kein Implementieren. Dann **eigener `git worktree`** (Pflicht, sonst Kollision mit Parallel-Agenten), umsetzen, `npm test` + `npm run typecheck` grün, im Browser verifizieren, committen mit `(#<nr>)`. **Integration läuft über EINEN Pull Request** (seit #592 ist `main` PR-gegated, kein Direkt-Push): ggf. Doku-Anpassung in denselben Branch, `gh pr create` (Body `Closes #<nr>`), dann **den PR bis zum Merge bringen** — CI abwarten (Auto-Merge via `gh pr merge --auto` + `gh pr checks --watch`), grün → mergt, **rot → auf demselben Branch fixen bis grün** (#618); **ein Ticket ist erst fertig, wenn sein PR gemergt ist**. Danach Worktree+Branch entfernen **und verifizieren**; das `Closes #<nr>` schließt das Issue automatisch (mit `gh issue view` verifizieren).

**Board managen statt Datei pflegen:** die Auswahl läuft über die **manuelle Board-Reihenfolge** (oberstes freies Item, Befehl in `docs/ticket-reihenfolge.md`). Seit #627 gibt es **keinen kuratierten Kopf und keinen „puh, fertig"-Pflege-Schritt mehr** — am Ticket-Ende ist **keine** Reihenfolge-Datei mehr zu editieren (das war die alte Merge-Konflikt-Quelle). Fällt beim Arbeiten was auf, sofort ein neues Issue mit passendem `area:`-Label anlegen und im Board an die richtige Stelle ziehen (echte Abhängigkeit als „blockiert durch #X"-Notiz im Body).

**Sonderfall zu großes Epic/Phase:** nicht selbst umsetzen — nach dem Claimen in viele konkrete, session-große Kindertickets (ohne Assignee) aufteilen, im Epic einen Übersichts-Kommentar mit Reihenfolge posten und das Epic mit `gh issue close <nr> --reason completed` auf **done** setzen (nicht löschen), Schließung verifizieren. Kein Worktree/Code nötig.

**Planungs-Subagent (Opus, opt-in automatisch, #745).** Direkt nach dem Claimen und **vor dem Coden** den Planungs-Subagenten rufen:

```
Agent({
  subagent_type: "kubernia-planner",
  description: "Planungspass für #<nr>",
  prompt: "Ticket #<nr>: <Titel>. Body:\n<Volltext des gh issue view>",
  run_in_background: false
})
```

Den zurückgegebenen Plan als Orientierung nutzen (betroffene Dateien, TDD-Schritte, Gate-Check, Risiken); er ersetzt nicht das eigene Urteil. Ist der Agent nicht verfügbar (Modell nicht im Account), den Plan kurz selbst skizzieren und weitermachen.

**Modell-Routing dieses Skills (#1035).** Das Frontmatter oben setzt `model: sonnet` + `effort: medium`: die **Umsetzung** tippt damit auf dem Coding-Tier, statt das Session-Modell zu erben (aus einer Opus-Session liefe sonst die komplette Umsetzung auf Opus — die Regel „Umsetzung schnell" griff auf diesem Pfad bis #1035 ins Leere, weil hier der **Hauptagent** codet und nicht ein `model:`-fähiger Subagent). Die zwei Phasen, die den **starken** Tier brauchen, laufen bewusst als **eigene Subagenten** und sind vom Coding-Tier unberührt: die **Planung** über `kubernia-planner` (Opus 5 / `high`, oben) und der **Review** über die Lens-Subagenten des [review-lenses](../review-lenses/SKILL.md)-Skills (Opus / `high`). ⚠️ **Ehrliche Grenze:** der Frontmatter-Override gilt laut Claude-Code-Doku für den **Rest des Turns** (im Repo nicht testbar — der Wächter belegt nur, dass die Zeilen da sind). Hält der Lauf für eine Pre-Flight-Rückfrage an, beginnt mit der Antwort der Maintainerin ein **neuer** Turn auf dem Session-Modell — dann den Skill erneut aufrufen, damit das Routing wieder greift. Tier-Strategie + Pin-Checkliste: [docs/model-routing.md](../../../docs/model-routing.md).

**Human-in-the-Loop-Checkpoints (#1012) — verbindlich, Regel-Heimat [AGENTS.md › Human-in-the-Loop-Checkpoints](../../../AGENTS.md).** Zwei Pflicht-Stopps: **(a) Pre-Flight-Klärung** — direkt nach Claim + Plan klassifizieren, ob das Ticket eine menschliche Entscheidung braucht (Harness-/Gate-Dateien, 🎨 Optik, ⚠️ riskante Weiche, oder der Plan meldet eine offene Weiche); trifft das zu, **vor dem Coden per `AskUserQuestion` mit der Maintainerin klären** statt zu raten. **(b) Merge-Checkpoint** — fasst der Diff Harness-/Leitplanken-Dateien an (`AGENTS.md`, `CLAUDE.md`, `.claude/`, `.agents/`, `docs/agent-harness*`, plus die Goodhart-Gate-Config), **nicht selbst mergen**: PR öffnen, CI grün, dann an die Maintainerin übergeben (sie setzt `maintainer-approved` und mergt).

**Mehr-Perspektiven-Review vor dem PR (#1012) — Pflichtschritt, kein Self-Grading.** Nach grünem `npm run verify` den [review-lenses](../review-lenses/SKILL.md)-Skill fahren (Architektur / Requirement-Treue / Test-Adäquanz). Wird nachgebessert, den Review **erneut** laufen lassen — beschränkte review↔fix-Schleife, **Cap 2**, Ausstieg bei null Blockern; der finale Blick liegt so nie beim Fixer selbst. Regel-Heimat: [AGENTS.md › Mehr-Perspektiven-Review](../../../AGENTS.md).

**Variante mit Phasen-Fortschritt (nur Claude Code, optional).** Denselben Ablauf gibt es zusätzlich als orchestrierten Workflow — [`kubernia-workflow`](../kubernia-workflow/SKILL.md) bzw. [`.claude/workflows/kubernia-ticket.js`](../../workflows/kubernia-ticket.js). Er bringt sichtbaren Phasen-Fortschritt (`/workflows`), Resume nach Abbruch, die drei Review-Lenses parallel und die Fix-Versuchsgrenze aus #710 als echte Schleifengrenze; er ist dafür **nicht-interaktiv** (Tickets mit nötiger Rückfrage — 🎨 Optik, ⚠️ riskante Weichen — laufen über diesen Skill hier). **Dieser Skill bleibt der maßgebliche, tool-neutrale Weg**, weil eine fremde KI `.claude/` nicht liest.

**Inhaltliche Änderungen am Ablauf immer in der Repo-`AGENTS.md` machen, nicht in dieser Skill-Datei** — und erst recht nicht im Workflow-Skript, das bewusst nur Orchestrierung enthält (Reihenfolge, Parallelität, Abbruchbedingungen).

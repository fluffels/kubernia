---
name: kubequest
description: Arbeitet eigenständig EIN offenes kubequest-Ticket end-to-end ab (auswählen → per Assignee claimen → eigener git-Worktree → umsetzen → über Remote integrieren → Issue schließen+verifizieren → Worktree/Branch aufräumen), kollisionssicher neben parallel laufenden Agenten. Ist das Ticket ein zu großes Epic/eine Phase, wird es stattdessen in viele konkrete neue Tickets aufgeteilt und das Epic auf done geschlossen (nicht selbst umgesetzt). Auslösen bei "arbeite ein kubequest-Ticket ab", "neues kubequest-Ticket", "starte ein kubequest-Ticket", "nimm dir ein kubequest-Ticket", "setz das nächste kubequest-Ticket um", "nimm das nächste kubequest-Ticket", "mach das nächste kubequest-Ticket", "nächstes Ticket für kubequest", oder wenn autonom das nächste offene kubequest-Issue umgesetzt werden soll.
---

# Kubequest-Ticket abarbeiten

**Dieses Repo ist selbstdokumentierend.** Das komplette Vorgehen lebt versioniert im Repo, damit **jeder Agent — egal welches Tool und welcher Account** — es nutzen kann. Quellen im Repo-Root:

```
AGENTS.md     ← SSOT: harte Regeln, Board-Workflow, Konventionen
CLAUDE.md     ← Schnellstart (10-Schritte-Checkliste) + Repo-Landkarte
```

**Lies diese beiden und folge ihnen Schritt für Schritt.** Bei Konflikt gilt `AGENTS.md`.

Kurzfassung: **Genau EIN** offenes Issue, das **nicht** schon bearbeitet wird (kein Assignee/Branch/Worktree) — ausgewählt aus dem **Kopf** der gepflegten Umsetzungs-Reihenfolge `docs/ticket-reihenfolge.md` (oberstes freies Ticket; ⚠️-Sonderfälle dort beachten). Ist der Kopf leer, generisch als **Auto-Rest** nach **Priorität** (`prio:hoch` → `mittel` → `niedrig` → ohne Label) und **niedrigster Nummer** — nie nach Inhalt aussuchen. **Claimen per `gh issue edit <nr> --add-assignee @me` und mit `gh issue view <nr>` verifizieren ist Pflicht und blockierend** — ohne bestätigte Zuweisung kein Implementieren. Dann **eigener `git worktree`** (Pflicht, sonst Kollision mit Parallel-Agenten), umsetzen, `npm test` + `npm run typecheck` grün, im Browser verifizieren, committen mit `(#<nr>)`, **über das Remote nach `main` integrieren und pushen** (in kubequest freigegeben), Issue schließen **und Schließung mit `gh issue view` verifizieren**, Worktree+Branch entfernen **und verifizieren**.

**Zum Schluss die Umsetzungs-Reihenfolge pflegen** (der „puh, fertig"-Schritt, erst NACH getaner Arbeit): erledigtes Ticket aus dem Kopf von `docs/ticket-reihenfolge.md` entfernen, den Kopf aus Auto-Rest/Reaktivierungs-Pool auf ~15–20 nachfüllen, neue Tickets mit echter Abhängigkeit einsortieren, Stand-Datum aktualisieren, committen (Doku-only → kein Test). Hat sich nichts geändert, kein Commit nötig.

**Sonderfall zu großes Epic/Phase:** nicht selbst umsetzen — nach dem Claimen in viele konkrete, session-große Kindertickets (ohne Assignee) aufteilen, im Epic einen Übersichts-Kommentar mit Reihenfolge posten und das Epic mit `gh issue close <nr> --reason completed` auf **done** setzen (nicht löschen), Schließung verifizieren. Kein Worktree/Code nötig.

**Inhaltliche Änderungen am Ablauf immer in der Repo-`AGENTS.md` machen, nicht in dieser Skill-Datei.**

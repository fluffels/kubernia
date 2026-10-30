---
name: factory
description: Arbeitet EIN Agentic-Ticket im Factory-Repo (dessen Issues das Factory-Board führt) end-to-end ab (claimen, planen, Umsetzung bis zum Merge); Epics werden aufgeteilt. Auslösen bei „nächstes Agentic-Ticket“, „nimm das nächste Factory-Ticket“, „nächstes Harness-Ticket“, „mehrere Agentic-Tickets“.
model: sonnet
effort: medium
---

# Agentic-Ticket abarbeiten

Codex: [Einstieg](../../../docs/codex/einstieg.md).

**Bereich: `agentic`.** Die Auswahl läuft mit `--bereich agentic` und sieht nur das Factory-Board (im Repo, dessen Issues es führt: Factory-Repo); die Notfälle (CI rot auf `main`, Security) gelten auf beiden Boards. Kein Ausweichen auf das andere Board, keine Rückfrage.

**Lies `.agents/skills/factory/ablauf.md` und folge ihm mit diesem Bereich.** Dort steht der ganze Ablauf (Claim, Planer, Umsetzer, Übergabe, Abnahme, Abschluss); diese Datei legt nur Bereich und Auslöser fest.

Nennt der Auslöser Tickets des Produkt-Boards, gilt der Produkt-Skill (Name `agenten.ticketSkill` in `.factory/projekt.json`).

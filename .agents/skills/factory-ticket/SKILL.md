---
# factory:projektwert agenten.ticketSkill
name: kubernia
description: Arbeitet EIN Spiel-Ticket des Produkt-Boards end-to-end ab (claimen, planen, Umsetzung bis zum Merge); Epics werden aufgeteilt. Auslösen bei "nimm das nächste kubernia-Ticket", "mehrere kubernia-Tickets", "nächstes Spiel-Ticket", "mach mit #<nr> weiter".
model: sonnet
effort: medium
---

# Spiel-Ticket abarbeiten

**Bereich: `spiel`.** Die Auswahl läuft mit `--bereich spiel` und sieht nur das Produkt-Board; die Notfälle (CI rot auf `main`, Security) gelten auf beiden Boards. Es wird nie ein Harness-Ticket gezogen, keine Rückfrage, keine Spielquote.

**Lies `.agents/skills/factory/ablauf.md` und folge ihm mit diesem Bereich.** Dort steht der ganze Ablauf (Claim, Planer, Umsetzer, Übergabe, Abnahme, Abschluss); diese Datei legt nur Bereich und Auslöser fest. Die Fortsetzung „mach mit #<nr> weiter“ gehört diesem Skill; eine Ticketnummer braucht keinen Bereich.

Agentic-, Factory- oder Harness-Tickets: Skill `factory`.

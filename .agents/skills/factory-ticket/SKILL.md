---
# factory:projektwert agenten.ticketSkill
name: kubernia
description: Arbeitet EIN Ticket des Produkt-Boards end-to-end ab (claimen, planen, Umsetzung bis zum Merge); Epics werden aufgeteilt. Auslösen bei "nimm das nächste Produkt-Ticket", "nächstes Produkt-Ticket", "mehrere Produkt-Tickets", "mach mit #<nr> weiter".
model: sonnet
effort: medium
---

# Produkt-Ticket abarbeiten

**Bereich: `produkt`.** Die Auswahl läuft mit `--bereich produkt` und sieht nur das Produkt-Board; die Notfälle (CI rot auf `main`, Security) gelten auf beiden Boards. Es wird nie ein Harness-Ticket gezogen, keine Rückfrage.

**Lies `.agents/skills/factory/ablauf.md` und folge ihm mit diesem Bereich.** Dort steht der ganze Ablauf (Claim, Planer, Umsetzer, Übergabe, Abnahme, Abschluss); diese Datei legt nur Bereich und Auslöser fest. Die Fortsetzung „mach mit #<nr> weiter“ gehört diesem Skill; eine Ticketnummer braucht keinen Bereich.

Agentic-, Factory- oder Harness-Tickets: Skill `factory`.

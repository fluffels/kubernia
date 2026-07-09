---
name: plan-feature
description: Plant ein Feature oder eine größere Änderung für kubequest gründlich VOR der Umsetzung — denkt Anforderung, Architektur, Stardew-Scope und den Schnitt in session-große Schritte durch und liefert einen konkreten Umsetzungsplan (welche Dateien, welche Reihenfolge, welche Tests), aber schreibt noch keinen Produktivcode. Läuft bewusst auf dem stärksten Modell mit hohem Reasoning; die eigentliche Umsetzung passiert danach auf dem normalen (schnelleren) Modell. Auslösen bei "plane ein Feature", "plan für", "wie setze ich ... um", "zerlege ... in Tickets", "Umsetzungsplan für", oder wenn vor dem Coden erst ein durchdachter Plan gebraucht wird.
model: claude-opus-4-8
effort: high
---

# Feature planen (stark denken, dann schnell umsetzen)

Dies ist die **Planungsphase** der Modellwahl-Konvention aus [AGENTS.md](../../../AGENTS.md) (#741): der Skill läuft über sein Frontmatter (`model: claude-opus-4-8` + `effort: high`) auf dem **stärksten Modell mit hohem Reasoning**, damit das Durchdenken dort passiert, wo es am meisten zählt. **Nach dem Skill fällt die Session automatisch aufs normale Modell zurück** — dort wird dann umgesetzt (fürs Tippen reicht das schnellere Modell).

> ⚠️ Feste Versions-ID (`claude-opus-4-8`) wird beim nächsten Release **stale** — gelegentlich nachziehen (ein Alias wie `opus` zöge automatisch mit, ist hier aber bewusst gepinnt). Aktueller schneller Umsetzungs-Default ist `claude-sonnet-5`.

**Nur planen, nicht umsetzen.** Ergebnis ist ein konkreter Plan, kein Produktivcode.

Vorgehen:

1. **Oberste Regel zuerst (Stardew-Scope):** „Trägt das noch, wenn Kubernia so groß wie Stardew Valley wird?" — Granularität und Struktur mitdenken, nicht nur das Format. Nur weiterplanen, wenn die Antwort Ja ist. Details: [AGENTS.md](../../../AGENTS.md).
2. **Anforderung schärfen:** Was genau soll erreicht werden, was ist explizit NICHT im Scope? Offene Fragen an die Maintainerin sammeln (lieber früh fragen als falsch bauen).
3. **Ist-Stand lesen:** betroffene Module über die Repo-Landkarte in [CLAUDE.md](../../../CLAUDE.md) finden; die Schichtregeln (pure Domäne ↔ Anwendung ↔ Präsentation) beachten.
4. **Schnitt:** in **session-große** Schritte zerlegen (ein PR pro Schritt, das Diff-Budget aus #533 im Blick). Ist es ein Epic, sind das mehrere neue Tickets — nicht ein Riesen-Commit.
5. **Plan ausgeben:** je Schritt konkret — welche Dateien, welche Reihenfolge, welche Tests (TDD: erst der rote Test), welche Gates berührt werden; Risiken und Migrationen (v.a. Save-Format!) benennen.

Danach normal umsetzen — für ein Board-Ticket über den `kubequest`-Skill, sonst direkt coden.

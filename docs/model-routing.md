# Modell-Routing im Kubernia-Harness (#910, #1065)

> **Projektanteil.** SSOT für Modell- und Effort-Routing (Phasen-Matrix, Messung, Budget-Pacing) ist die Factory-Seite: [Modell-Routing](https://github.com/fluffels/self-improving-agent-harness-and-factory/blob/v0.6.0/docs/model-routing.md). Hier bleiben die Projekt-Phase Forum-Triage, der Projekt-Default und die Belege zum Trace-Tag; die Überschriften tragen Anker-Stubs für ADRs, Schnappschüsse und Wächter, die auf sie zeigen.
>
> Welche Seite Projekt und welche Kern ist: [Inventar](referenz/anlaufstellen.md#factory-seiten-projektanteil-und-kern). Begriffe: [Harness-Glossar](harness-glossar.md).

## 1. Phasen-Matrix

Kern: [1. Phasen-Matrix](https://github.com/fluffels/self-improving-agent-harness-and-factory/blob/v0.6.0/docs/model-routing.md#1-phasen-matrix)

<!-- factory-projekt:start -->

Projekt-Rollen, die nicht zum Kern gehören, stehen in dieser Tabelle (bewacht von `test/harness/forum-anteile-projekt.test.ts`):

| Projekt-Phase | Alias | Effort Skill-Pfad | Skill-Pfad |
|---|---|---|---|
| Forum-Triage (Quarantäne) | `sonnet` | `medium` | Subagent `forum-leser`, vom `forum`-Skill gespawnt (Frontmatter; nur `Read` auf die Quarantäne-Datei) |

**Projekt-Default:** Der Hauptchat läuft per `"model": "sonnet"` in `.claude/settings.json` auf `sonnet` (#1557), nie auf einer festen Modell-ID; bewacht von `test/harness/modell-projekt.test.ts`.

<!-- factory-projekt:ende -->

### Review-Staffel (#1265)

Kern: [Review-Staffel (#1265)](https://github.com/fluffels/self-improving-agent-harness-and-factory/blob/v0.6.0/docs/model-routing.md#review-staffel-1265)

## 2. Wie das Routing in Claude Code wirkt

Kern: [2. Wie das Routing in Claude Code wirkt](https://github.com/fluffels/self-improving-agent-harness-and-factory/blob/v0.6.0/docs/model-routing.md#2-wie-das-routing-in-claude-code-wirkt)

## 5. Token- und Loop-Baseline (#1068)

Kern: [5. Token- und Loop-Baseline (#1068)](https://github.com/fluffels/self-improving-agent-harness-and-factory/blob/v0.6.0/docs/model-routing.md#5-token--und-loop-baseline-1068)

### Messen

Kern: [Messen](https://github.com/fluffels/self-improving-agent-harness-and-factory/blob/v0.6.0/docs/model-routing.md#messen)

### Ergebnis je Ticket-Lauf (#1123)

Kern: [Ergebnis je Ticket-Lauf (#1123)](https://github.com/fluffels/self-improving-agent-harness-and-factory/blob/v0.6.0/docs/model-routing.md#ergebnis-je-ticket-lauf-1123)

### Factory-Kennzahlen (#1616)

Kern: [Factory-Kennzahlen (#1616)](https://github.com/fluffels/self-improving-agent-harness-and-factory/blob/v0.6.0/docs/model-routing.md#factory-kennzahlen-1616)

### Langfuse-Hook-Patch pflegen (#1084/#1122)

Kern: [Langfuse-Hook-Patch pflegen (#1084/#1122)](https://github.com/fluffels/self-improving-agent-harness-and-factory/blob/v0.6.0/docs/model-routing.md#langfuse-hook-patch-pflegen-10841122)

### Zuordnung in Langfuse (#1266)

Kern: [Zuordnung in Langfuse (#1266)](https://github.com/fluffels/self-improving-agent-harness-and-factory/blob/v0.6.0/docs/model-routing.md#zuordnung-in-langfuse-1266)

<!-- factory-projekt:start -->

**Projektwerte:** Der Trace-Tag ist `kubernia` (`CC_LANGFUSE_TRACE_TAGS` in `.claude/settings.json`, je Session beim Start an allen Traces); `environment` ist `kubernia` für getaggte Sessions und `dev` für die übrigen. Projektfilter der Auswertung ist der Tag. Bewacht von `test/harness/trace-tag-projekt.test.ts`.

<!-- factory-projekt:ende -->

### Baseline (Stand 2026-09-29, alle vier Läufe vor #1065/#1067)

Kern: [Baseline (Stand 2026-09-29, alle vier Läufe vor #1065/#1067)](https://github.com/fluffels/self-improving-agent-harness-and-factory/blob/v0.6.0/docs/model-routing.md#baseline-stand-2026-09-29-alle-vier-läufe-vor-10651067)

### Lens-Gegenprobe (#1580)

Kern: [Lens-Gegenprobe (#1580)](https://github.com/fluffels/self-improving-agent-harness-and-factory/blob/v0.6.0/docs/model-routing.md#lens-gegenprobe-1580)

### Lens-Kostenstruktur (#1582)

Kern: [Lens-Kostenstruktur (#1582)](https://github.com/fluffels/self-improving-agent-harness-and-factory/blob/v0.6.0/docs/model-routing.md#lens-kostenstruktur-1582)

### Projekt-Brain-Kennzahlen (#1205)

Kern: [Projekt-Brain-Kennzahlen (#1205)](https://github.com/fluffels/self-improving-agent-harness-and-factory/blob/v0.6.0/docs/model-routing.md#projekt-brain-kennzahlen-1205)

### Hauptchat nach Tätigkeit (#1356)

Kern: [Hauptchat nach Tätigkeit (#1356)](https://github.com/fluffels/self-improving-agent-harness-and-factory/blob/v0.6.0/docs/model-routing.md#hauptchat-nach-tätigkeit-1356)

### Planer-Laufzeit (#1349)

Kern: [Planer-Laufzeit (#1349)](https://github.com/fluffels/self-improving-agent-harness-and-factory/blob/v0.6.0/docs/model-routing.md#planer-laufzeit-1349)

### Planer-Kosten (#1558)

Kern: [Planer-Kosten (#1558)](https://github.com/fluffels/self-improving-agent-harness-and-factory/blob/v0.6.0/docs/model-routing.md#planer-kosten-1558)

### Umsetzer-Kontext

Kern: [Umsetzer-Kontext](https://github.com/fluffels/self-improving-agent-harness-and-factory/blob/v0.6.0/docs/model-routing.md#umsetzer-kontext)

#### Phasen-Schnitt: Vertrag, A/B-Regel, Messrezept

Kern: [Phasen-Schnitt: Vertrag, A/B-Regel, Messrezept](https://github.com/fluffels/self-improving-agent-harness-and-factory/blob/v0.6.0/docs/model-routing.md#phasen-schnitt-vertrag-ab-regel-messrezept)

### Sammelticket-Läufe (#1647)

Kern: [Sammelticket-Läufe (#1647)](https://github.com/fluffels/self-improving-agent-harness-and-factory/blob/v0.6.0/docs/model-routing.md#sammelticket-läufe-1647)

### Langfuse-Status überprüfen (#1293)

Kern: [Langfuse-Status überprüfen (#1293)](https://github.com/fluffels/self-improving-agent-harness-and-factory/blob/v0.6.0/docs/model-routing.md#langfuse-status-überprüfen-1293)

### Langfuse-Erfassung belegen (#1293)

Kern: [Langfuse-Erfassung belegen (#1293)](https://github.com/fluffels/self-improving-agent-harness-and-factory/blob/v0.6.0/docs/model-routing.md#langfuse-erfassung-belegen-1293)

<!-- factory-projekt:start -->

**Projektwert:** Der Beleg-Probe-Lauf muss in Langfuse einen Trace mit dem Tag `kubernia` zeigen. Den projekteigenen Tag prüft `test/harness/trace-tag-projekt.test.ts`.

<!-- factory-projekt:ende -->

## 6. Budget-Pacing (#1358)

Kern: [6. Budget-Pacing (#1358)](https://github.com/fluffels/self-improving-agent-harness-and-factory/blob/v0.6.0/docs/model-routing.md#6-budget-pacing-1358)

# Modell-Routing im Kubernia-Harness (#910)

> **SSOT für alle Modell-Pins.** Wenn Anthropic ein neues Modell released und die Pins nachgezogen werden müssen, genügt es, diese Datei zu lesen — sie listet die **zwei Dateien** mit harten Modell-IDs und erklärt die Strategie.

## 1. Die drei Tiers

| Rolle | Tier | Modell-ID | Effort | Warum |
|---|---|---|---|---|
| **Plan + Review** (Planungs-Subagent, plan-feature-Skill) | stark | `claude-opus-5` | `high` | Fehler hier sind teuer — schlechte Architektur-Entscheidungen kosten viele Sessions; das stärkste Modell mit hohem Reasoning amortisiert sich schnell (#741, #745). |
| **Umsetzung** (kubernia-Skill, Workflow-/Loop-Subagenten) | Coding-Sweet-Spot | Tier-Alias `sonnet` (kein hartes Pin) | `medium` | Sonnet ist der Coding-Sweet-Spot: schnell und günstig genug, um viele Tickets zu tippen, wenn der Plan schon steht; `medium` reicht für Tipparbeit nach fertigem Plan, lässt aber genug Reasoning für die CI-Fix-Schleife. **Muss explizit gesetzt werden:** wer aus einer Opus-Session startet, tippt seinen Code ohne Override auf Opus — „Umsetzung schnell" passiert nicht von allein. Der Alias profitiert trotzdem automatisch von einem neuen Sonnet. |
| **Explore / Recherche** (reine Lesereisen, Codebase-Suche) | günstig | `claude-haiku-4-5-20251001` | default | Explore-Agenten lesen und suchen — kein komplexes Reasoning nötig; Haiku ist 10–20× billiger als Opus und für reine Code-Navigation mehr als ausreichend. |

## 2. Claude Code hat keine Runtime-Aliases

In Claude Code steuert das `model:`-Feld im Skill-/Agent-Frontmatter den Modell-Aufruf — es gibt **keine zentral konfigurierbaren Aliases**, die zur Laufzeit aufgelöst werden. Das bedeutet:
- Ein Modell-Update (z.B. Opus 5 → 6) erfordert manuelle Anpassung der gepinnten Dateien.
- **Diese Datei ist der Alias:** sie ist die eine Stelle, die einem sagt, WO nachzuziehen ist.

## 3. Gepinnte Dateien — das "Update hier"-Checkliste

Bei einem Modell-Wechsel (neuer Opus, neuer Haiku) diese **zwei Dateien** anpassen:

| Datei | Was steckt drin | Welcher Tier |
|---|---|---|
| [`.claude/agents/kubernia-planner.md`](../.claude/agents/kubernia-planner.md) | `model: claude-opus-5` + `effort: high` | Plan |
| [`.claude/skills/plan-feature/SKILL.md`](../.claude/skills/plan-feature/SKILL.md) | `model: claude-opus-5` + `effort: high` im Frontmatter | Plan |

Explore-Agenten (wenn in Skills explizit geroutet) stehen ebenfalls hier, sobald welche hinzukommen.

**Nicht nachzuziehen — bewusst per Alias statt Pin:** der `kubernia`-Skill (`model: sonnet` im Frontmatter) und `review-lenses` (`model: "opus"` an seinen Lens-Subagenten) seit #1035, sowie der Phasen-Workflow [`.claude/workflows/kubernia-ticket.js`](../.claude/workflows/kubernia-ticket.js): sie routen über die **Tier-Aliase** (`opus`/`sonnet`/`haiku`), nicht über Modell-IDs — die drei Review-Lens-Agenten mit `model: 'opus'` + `effort: 'high'`, die Umsetzungsphase mit `model: 'sonnet'`. Er profitiert damit automatisch von einem neuen Opus bzw. Sonnet und taucht in der Checkliste oben absichtlich **nicht** auf. Seine Planungsphase setzt kein Modell, sondern ruft den `kubernia-planner`-Agenten (Zeile 1) — der Pin bleibt so an genau einer Stelle; nur `effort: 'high'` steht am Aufruf, weil das kein Modell-Pin ist. Wo ein Alias zur Verfügung steht, ist er dem harten Pin vorzuziehen: er ist die einzige Form von Routing, die einen Modellwechsel ohne Wartung übersteht.

⚠️ **Der Alias kennt keine Generation.** `model: 'opus'` löst auf „irgendein Opus" auf — welchen, entscheidet das Tool, nicht diese Datei. Wo eine **bestimmte** Generation zwingend ist (die Planung: Opus 5), muss es der harte Pin im Frontmatter sein; der Alias taugt nur, wo „das jeweils aktuelle Modell dieses Tiers" die richtige Antwort ist (Review, Umsetzung).

## 4. Konvention im Ticket-Workflow

- **Ticket claimen → Planungs-Subagent** → Opus 5 mit `effort: high` (`kubernia-planner`-Agent, aufgerufen vom `kubernia`-Skill bzw. der Plan-Phase des `kubernia-ticket`-Workflows)
- **Review (die drei Lenses)** → Opus mit `effort: 'high'`, per Alias (kein Pin, siehe Kasten oben) — **auf beiden Pfaden als eigene Subagenten**: im Workflow am `agent()`-Aufruf, auf dem Skill-Pfad spawnt [`review-lenses`](../.claude/skills/review-lenses/SKILL.md) seine drei Lenses selbst so (#1035). Inline im Hauptagenten dürfen sie **nicht** laufen: dort gilt der Coding-Tier der Umsetzung, der Review rutschte still auf Sonnet — und der finale Blick wäre ein Self-Grading des eigenen Fixes (#1012).
- **Ticket umsetzen** → Sonnet, per Alias `model: 'sonnet'` (kein Pin). Im **Workflow** am `agent()`-Aufruf; auf dem **Skill-Pfad** seit #1035 im **Frontmatter** von [`.claude/skills/kubernia/SKILL.md`](../.claude/skills/kubernia/SKILL.md) — dort schreibt der **Hauptagent** den Code, es gibt also gar keinen Subagenten, an dem ein `model:` hinge. ⚠️ **Muss explizit gesetzt sein:** ohne Override erbt beides das Session-Modell — aus einer Opus-Session wäre die „schnelle" Umsetzung sonst Opus. ⚠️ **Turn-Scope des Frontmatters:** der Skill-Override gilt für den Rest des Turns und ist nach einer Rückfrage-Pause (neuer Turn) weg — dann den Skill erneut aufrufen.
- **Codebase-Suche / Explore** → explizit `model: claude-haiku-4-5-20251001` setzen, wenn in einem Skill ein reiner Explore-Subagent gespawnt wird; der `subagent_type: Explore` aus dem Agent-Registry hat seinen eigenen Overhead — alternativ einen `Agent({model: "haiku", …})`-Call verwenden

> Details zur Modellwahl-Philosophie (Planung stark, Umsetzung schnell): [docs/agent-harness.md § Skills + Setup](agent-harness.md#25-skills--setup-als-reproduzierbare-abläufe) (#741, #745).

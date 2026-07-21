# Modell-Routing im Kubernia-Harness (#910)

> **SSOT für alle Modell-Pins.** Wenn Anthropic ein neues Modell released und die Pins nachgezogen werden müssen, genügt es, diese Datei zu lesen — sie listet die **zwei Dateien** mit harten Modell-IDs und erklärt die Strategie.

## 1. Die drei Tiers

| Rolle | Tier | Modell-ID | Effort | Warum |
|---|---|---|---|---|
| **Plan + Review** (Planungs-Subagent, plan-feature-Skill) | stark | `claude-opus-4-8` | `high` | Fehler hier sind teuer — schlechte Architektur-Entscheidungen kosten viele Sessions; das stärkste Modell mit hohem Reasoning amortisiert sich schnell (#741, #745). |
| **Umsetzung** (kubernia-Skill, kubernia-loop-Subagenten) | Coding-Sweet-Spot | *(kein hartes Pin — läuft auf dem Session-Default)* | default | Der Session-Default ist der kuratierte Coding-Sweet-Spot des jeweiligen Tools; ihn nicht hart zu pinnen bedeutet, dass Releases automatisch von besseren Coding-Modellen profitieren. |
| **Explore / Recherche** (reine Lesereisen, Codebase-Suche) | günstig | `claude-haiku-4-5-20251001` | default | Explore-Agenten lesen und suchen — kein komplexes Reasoning nötig; Haiku ist 10–20× billiger als Opus und für reine Code-Navigation mehr als ausreichend. |

## 2. Claude Code hat keine Runtime-Aliases

In Claude Code steuert das `model:`-Feld im Skill-/Agent-Frontmatter den Modell-Aufruf — es gibt **keine zentral konfigurierbaren Aliases**, die zur Laufzeit aufgelöst werden. Das bedeutet:
- Ein Modell-Update (z.B. Opus 4.8 → 5.0) erfordert manuelle Anpassung der gepinnten Dateien.
- **Diese Datei ist der Alias:** sie ist die eine Stelle, die einem sagt, WO nachzuziehen ist.

## 3. Gepinnte Dateien — das "Update hier"-Checkliste

Bei einem Modell-Wechsel (neuer Opus, neuer Haiku) diese **zwei Dateien** anpassen:

| Datei | Was steckt drin | Welcher Tier |
|---|---|---|
| [`.claude/agents/kubernia-planner.md`](../.claude/agents/kubernia-planner.md) | `model: claude-opus-4-8` + `effort: high` | Plan |
| [`.claude/skills/plan-feature/SKILL.md`](../.claude/skills/plan-feature/SKILL.md) | `model: claude-opus-4-8` + `effort: high` im Frontmatter | Plan |

Explore-Agenten (wenn in Skills explizit geroutet) stehen ebenfalls hier, sobald welche hinzukommen.

## 4. Konvention im Ticket-Workflow

- **Ticket claimen → Planungs-Subagent** → Opus (`kubernia-planner`-Agent, aufgerufen vom `kubernia`-Skill)
- **Ticket umsetzen** → Session-Default (kein Pin nötig, kubernia-loop spawnt `general-purpose` ohne Modell-Override)
- **Codebase-Suche / Explore** → explizit `model: claude-haiku-4-5-20251001` setzen, wenn in einem Skill ein reiner Explore-Subagent gespawnt wird; der `subagent_type: Explore` aus dem Agent-Registry hat seinen eigenen Overhead — alternativ einen `Agent({model: "haiku", …})`-Call verwenden

> Details zur Modellwahl-Philosophie (Planung stark, Umsetzung schnell): [docs/agent-harness.md § Skills + Setup](agent-harness.md#25-skills--setup-als-reproduzierbare-abläufe) (#741, #745).

# Sicherheit der Agenten: Fremdtext und OWASP-Abgleich (#1433)

> Projektanteil: der Forum-Kanal. Quellen, Vertrauensmodell, OWASP-Abgleich und die übrigen Kanäle stehen in [Sicherheit der Agenten](https://github.com/fluffels/self-improving-agent-harness-and-factory/blob/v0.2.0/docs/sicherheit-agenten.md) im Factory-Repo; Inventar: [Factory-Seiten](referenz/anlaufstellen.md#factory-seiten-projektanteil-und-kern).

## Kanäle für Fremdtext

Kern: [Kanäle für Fremdtext](https://github.com/fluffels/self-improving-agent-harness-and-factory/blob/v0.2.0/docs/sicherheit-agenten.md#kanäle-für-fremdtext)

<!-- factory-projekt:start -->

| Kanal | Heutiges Gate |
|---|---|
| Forum (GitHub Discussions) | Label `forum` gilt als Fremdeingang; die Action legt das Inbox-Issue ohne Fremdtext an, `scripts/forum-sanitize.mjs` entschärft und rahmt den Text in der Quarantäne; Rule-of-Two-Audit im [Forum-Skill](../.agents/skills/forum/SKILL.md); Quarantäne: den Thread liest nur der Subagent [`forum-leser`](../.claude/agents/forum-leser.md) (nur `Read` auf die Quarantäne-Datei, `scripts/forum-quarantaene.mjs`, `scripts/forum-leser-guard.mjs`), der privilegierte Lauf sieht nur das feste Ergebnisformat; Antwort nur nach Freigabe der Maintainerin |

- **Quarantäne-Muster (#1435):** Die Doku ([Subagenten-Frontmatter, Fehlerseite](https://code.claude.com/docs/en/errors), gelesen 2026-10-16) erlaubt für `forum-leser` auch eine leere `tools`-Liste (Subagent ohne Tools). Gewählt ist trotzdem `tools: Read` plus `disallowedTools` plus Read-Guard: ein werkzeugloser Agent bekäme den Thread nur über den Prompt des privilegierten Hauptagenten, und `tools:` ohne Wert ist YAML null und heißt „alle erben“. Frontmatter-Hooks laufen nur in vertrauten Ordnern; ohne Vertrauen bleiben die Whitelist und die Read-Denies aus `.claude/settings.json`. Der **Entwurf** und der Ticketvorschlag sind abgeleiteter Fremdtext im privilegierten Lauf (Zitat-Laundering): Gegenmittel ist der Freigabe-Stopp der Maintainerin, der Rest steht in #1447 d.

<!-- factory-projekt:ende -->

## Grenzen (ehrlich)

Kern: [Grenzen (ehrlich)](https://github.com/fluffels/self-improving-agent-harness-and-factory/blob/v0.2.0/docs/sicherheit-agenten.md#grenzen-ehrlich)

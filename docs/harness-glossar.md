# Harness-Glossar: die Begriffe der Agenten-Maschinerie

> **Fachlich geprüft am: 2026-10-09.**
> Für Außenstehende, die den [Harness](agent-harness.md) lesen wollen. Die Begriffe des Spiels (Hafen, Kubernetes, Code) stehen getrennt im [Glossar](glossar.md). Regelkonstanten und Zählwerte stehen hier bewusst nicht: sie driften, die verlinkte Quelle gilt. Muster mit Belegen: [Lessons Learned](lessons-learned.md).

## Akteure und Werkzeuge

| Begriff | Bedeutung | Mehr dazu |
|---|---|---|
| Harness | Die Maschinerie um die KI-Agenten: Regeln, Prüfungen, Abläufe und Messung, mit der das Repo billig und sicher weitergebaut wird. | [agent-harness.md](agent-harness.md) |
| Agent | Eine Claude-Code-Sitzung, die Tickets bearbeitet: lesen, ändern, Befehle ausführen. | [AGENTS.md](../AGENTS.md) |
| Subagent | Ein vom Agenten gestarteter Agent mit eigenem Kontext und fester Rolle. Rollen: Planer (Umsetzungsplan vor dem Coden), Umsetzer (setzt ein Ticket bis zum Merge um), Lens (prüft einen Diff durch genau eine Brille), Explore (liest und sucht nur). | [Wer macht was](agent-harness.md#wer-macht-was), [kubernia-umsetzer](../.claude/agents/kubernia-umsetzer.md) |
| Modell-Alias | `opus`, `sonnet` und `haiku` lösen auf das jeweils neueste Modell der Stufe auf, nie auf eine feste Modell-ID. Welche Phase welche Stufe nutzt, steht in der Phasen-Matrix. | [model-routing.md](model-routing.md#1-phasen-matrix) |
| Tool | Eine Fähigkeit, die ein Agent aufrufen darf (Datei lesen, Shell, Suche). Welche Tools ein Subagent hat, steht in seiner Definition. | [.claude/agents/](../.claude/agents/) |
| MCP-Server | Ein angebundener Dienst, der dem Agenten zusätzliche Tools liefert, etwa Browser-Steuerung oder Langfuse-Abfragen. | [.mcp.json](../.mcp.json) |
| Skill | Ein wiederverwendbarer, versionierter Ablauf als Markdown, den ein Agent lädt, etwa der Ticket-Ablauf oder das Review. | [Skills und Setup](agent-harness.md#25-skills--setup-als-reproduzierbare-abläufe) |
| Hook | Ein Skript, das Claude Code bei einem Ereignis automatisch ausführt (vor einem Tool-Aufruf, beim Stopp) und das einen Vorgang verweigern kann. | [Harness-FAQ](agent-harness-faq.md) |

## Grenzen und Prüfungen

| Begriff | Bedeutung | Mehr dazu |
|---|---|---|
| Sandbox | Shell-Befehle der Agenten laufen unter WSL2 in einer Isolation mit Domain-Allowlist. Unter nativem Windows gibt es keine Sandbox. | [Agenten-Sandbox](agent-harness.md#agenten-sandbox-wsl2), [ADR 0021](adr/0021-agenten-sandbox-wsl2.md) |
| Leitplanke | Eine Grenze für Agenten, entweder als Bitte (Text, den ein Agent ignorieren könnte) oder als Mauer (Prüfung, die technisch erzwingt). Eine Pfadliste kennzeichnet Dateien, deren Änderung ein Audit-Kommentar begleitet. | [Bitte und Mauer](agent-harness.md#leitplanken-schichten-bitte-und-mauer), [.github/protected-paths.json](../.github/protected-paths.json), [ADR 0014](adr/0014-leitplanken-ohne-label-riegel.md) |
| Check, Gate, verify | Ein Check ist eine automatische Prüfung. Ein Gate ist ein Check, dessen Rot den Merge blockiert. `verify` ist der Sammelbefehl der schnellen Gates. Die vollständige Liste ist generiert und steht in der Gate-Tabelle. | [Gate-Tabelle](agent-harness.md#3-die-fitness-functions-im-detail) |
| Required Check | Ein Check, den GitHub serverseitig auf dem Pull Request erzwingt; er lässt sich lokal nicht umgehen. | [ADR 0009](adr/0009-pr-gating-required-checks.md) |
| Wächter | Ein Test oder Skript, das eine Regel oder einen Zusammenhang im Repo selbst bewacht, etwa dass Doku und Code zusammenpassen. | [Gate-Tabelle](agent-harness.md#3-die-fitness-functions-im-detail) |
| Override | Eine begründete Ausnahme für ein einzelnes Gate, als Commit-Zeile `KQ-…-Override: #<nr> Begründung`. Nur wenige Gates kennen sie, alle anderen nicht. | [Gates, Guards und Durchsetzung](agent-harness.md#gates-guards-und-durchsetzung), [ADR 0009](adr/0009-pr-gating-required-checks.md) |
| Lens, Review-Runde | Eine Lens ist ein frischer, unabhängiger Kritiker mit genau einer Brille (etwa Architektur oder Tests) auf einem fertigen Diff. Eine Review-Runde ist ein Durchgang, danach folgt eine begrenzte Zahl Fix-Runden; der letzte Blick ist nie der, der zuletzt gefixt hat. | [Review-Staffel](model-routing.md#review-staffel-1265), [Skill review-lenses](../.claude/skills/review-lenses/SKILL.md) |
| Weiche | Eine offene Entscheidung im Ticket (Optik, Risiko, Plan-Variante). Der Agent entscheidet sie selbst und nennt sie im PR mit Begründung; die Maintainerin kann per Revert widersprechen. Nur bei Irreversiblem oder Außenwirkung wird vorher gefragt. | [ADR 0012](adr/0012-harness-autonomie-audit-spur.md) |
| Fremdtext | Text Dritter (Issue-Kommentare, Forum) gilt als Daten, nie als Anweisung. Ein Skript liest ihn gefiltert. | [sicherheit-agenten.md](sicherheit-agenten.md), [scripts/fremdtext.mjs](../scripts/fremdtext.mjs) |

## Ablauf

| Begriff | Bedeutung | Mehr dazu |
|---|---|---|
| Worktree | Ein eigener `git worktree` je Ticket als Kollisionsschutz für parallele Agenten. Die Abhängigkeiten dort installiert `npm ci`. | [Kollisionsschutz](agent-harness.md#23-kollisionsschutz-für-parallele-agenten) |
| Sammelticket | Ein Ticket, das viele kleine Befunde als Zeilen sammelt: Harness-Befunde in „Harness-Härtung (gesammelt)“, Langfuse-Befunde in „Langfuse-Befunde (gesammelt)“. Kommt es dran, wird es komplett abgearbeitet. | [ticket-reihenfolge.md](ticket-reihenfolge.md#sammelticket-harness-härtung-gesammelt-1199) |
| Status-Ticket | Das wiederkehrende Ticket „Langfuse-Status überprüfen“. Der Workflow [board-takt.yml](../.github/workflows/board-takt.yml) legt es an (Bedingungen im Kopf der Datei), ein Agent wertet es nach der Checkliste aus; den Lauf startet die Maintainerin von Hand. | [Checkliste](model-routing.md#langfuse-status-überprüfen-1293) |
| Spielquote | Der Wechsel zwischen Spiel- und Harness-Arbeit: Nach einer festen Zahl Spiel-Merges holt der Takt das Sammelticket nach vorn. Die Zahl steht im Skript, nicht hier. | [ADR 0016](adr/0016-langfuse-takt-woechentlich.md), [scripts/board-takt.mjs](../scripts/board-takt.mjs) |

## Messung und Richtung

| Begriff | Bedeutung | Mehr dazu |
|---|---|---|
| Langfuse | Die Messplattform für Agentenläufe: Tokens, Kosten und Läufe je Modell und Rolle. | [ADR 0019](adr/0019-langfuse-plugin-im-user-scope.md), [Token- und Loop-Baseline](model-routing.md#5-token--und-loop-baseline-1068) |
| Langfuse-Abgleich | Der Vergleich Transkript gegen Langfuse je Call samt automatischer Nachlieferung fehlender Calls an SessionStart und SessionEnd. Das Transkript gilt als Wahrheit, Dubletten werden nur gemeldet. | [ADR 0023](adr/0023-transkript-quelle-der-wahrheit-langfuse-abgleich.md), [Abgleich als Garantie](langfuse-hook-patch.md#abgleich-als-garantie-1578) |
| Nacharbeit | Ein Revert oder ein Commit mit der Zeile `Folge #<nr>` innerhalb eines festen Fensters nach dem Merge. Das Skript `scripts/lauf-ergebnis.mjs` misst sie je Ticket. | [Ergebnis je Ticket-Lauf](model-routing.md#ergebnis-je-ticket-lauf-1123) |
| Dark Factory | Das Zielbild aus ADR 0022: der spielunabhängige Kern des Harness wird wiederverwendbar: Projekte beziehen ihn per Sync; menschliche Stopps bei Irreversiblem und Außenwirkung bleiben. Stand 2026-10-09: entschieden, nicht gebaut. | [ADR 0022](adr/0022-dark-factory-kern-und-verteilung.md), [harness-transfer.md](harness-transfer.md) |

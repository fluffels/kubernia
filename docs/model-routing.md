# Modell-Routing im Kubernia-Harness (#910, #1065)

> **SSOT für Modell- und Effort-Routing.** Es gibt keine festen Modell-IDs mehr im Harness, nur die Tier-Aliase `opus`, `sonnet` und `haiku`. Sie lösen auf das jeweils neueste Modell der Stufe auf ([Claude-Code-Doku › Model configuration](https://code.claude.com/docs/en/model-config)). Ein neues Modell braucht deshalb keine Wartung.

## 1. Phasen-Matrix

Gültige Effort-Stufen: `low`, `medium`, `high`, `xhigh`, `max`. Bei Sonnet 5+ und Opus 4.7+ ist der Effort die Obergrenze des adaptiven Reasonings; ohne explizite Angabe gilt bei Opus 5.5 und Sonnet 5.5 `medium` ([Claude-Code-Doku › Model configuration](https://code.claude.com/docs/en/model-config), Stand 2026-10-05). Spalte „Skill-Pfad" nennt, was dort tatsächlich greift.

| Phase | Alias | Effort | Workflow (`kubernia-ticket.js`) | Skill-Pfad (`kubernia`) | Loop (`kubernia-loop`) |
|---|---|---|---|---|---|
| Auswahl + Claim | `sonnet` | `medium` | `agent()`-Optionen | Hauptagent (Session-Modell) | im Ticket-Subagenten |
| Sonderfall (Epic-Split, Dependabot) | `sonnet` | `medium` | `agent()`-Optionen (vorerst; Opus-Tier: #1207) | Hauptagent | im Ticket-Subagenten |
| **Planung** | `opus` | `xhigh` | `agentType: 'kubernia-planner'` + `effort` | Subagent `kubernia-planner` (Frontmatter) | über den Skill im Subagenten |
| Pre-Flight | `sonnet` | `medium` | `agent()`-Optionen | Hauptagent | im Ticket-Subagenten |
| Umsetzung | `sonnet` | `medium` | `agent()`-Optionen | Hauptagent | Spawn mit `model` (Effort = Sonnet-Default `medium`, deckt sich mit dem Ziel) |
| **Review (3 Lenses)** | `opus` | `high` | `agent()`-Optionen je Lens (`high` wirkt) | Subagenten aus `review-lenses`; Effort faktisch Opus-Default (`medium`), `high` nur per Folgeticket #1209 | über den Skill (Effort wie Skill-Pfad) |
| Nachbessern, CI-Fix | `sonnet` | `medium` | `agent()`-Optionen | Hauptagent | im Ticket-Subagenten |
| PR + Merge, Festgefahren, Cleanup | `sonnet` | `medium` | `agent()`-Optionen | Hauptagent | im Ticket-Subagenten |
| Explore / Recherche | `haiku` | `low` | n/a | keine feste Aufrufstelle; Empfehlung `Agent({model: "haiku"})`, Effort nicht per Tool setzbar (§2, #1209) | n/a |

**Warum so:** Fehler in Planung und Review sind teuer (schlechte Architektur kostet viele Sessions), dort lohnt das stärkste Modell mit hohem Reasoning (#741, #745). Tippen nach fertigem Plan ist Sonnet-Arbeit, `medium` lässt genug Reasoning für die CI-Fix-Schleife. Explore liest und sucht nur, Haiku genügt.

**Ehrlich zum Skill-Pfad:** Auswahl, Pre-Flight, Umsetzung, Nachbessern, CI-Fix und Merge laufen dort im einen Hauptagenten, also auf dem Session-Modell (per `.claude/settings.json` Sonnet) und mit dem Effort-Default der Session (Sonnet 5.5: `medium`). Explizit pro Phase gesetzt wird nur im Workflow und an Subagent-Spawns.

## 2. Wie das Routing in Claude Code wirkt

- **Aliase gibt es.** `opus`, `sonnet`, `haiku` (dazu `opusplan`, `best`, `fable`) lösen auf das neueste Modell der Stufe auf. Es gibt keinen Modus, der nach kubernia-Phasen wechselt. `opusplan` wechselt nur zwischen dem Claude-Code-Plan-Modus (opus) und der Ausführung (sonnet) und passt nicht zum Ticket-Ablauf.
- **Subagenten:** `model:` im Agent-Frontmatter bzw. an `Agent({…})`/`agent({…})` greift nachweislich. Ohne Angabe erbt ein Subagent das Session-Modell.
- **Das Agent-Tool hat keinen `effort`-Parameter.** Sein Schema kennt `description`, `isolation`, `model`, `prompt`, `subagent_type`, `run_in_background`. `effort` greift nur im Agent-/Skill-Frontmatter (Skill-Frontmatter nur bei `/slash`, siehe nächster Punkt) und als Option von `agent()` in Workflow-Skripten. Darum sind `effort`-Angaben an `Agent({…})`-Spawns wirkungslos und stehen dort nicht: Lenses laufen auf dem Skill-Pfad mit dem Opus-Standard-Effort (Opus 5.5: `medium`), im Workflow mit `high`; der Loop-Spawn mit dem Sonnet-Default (`medium`). Behebung über eigene Agent-Definitionen mit `effort`-Frontmatter (Lenses, Explore): #1209.
- **Skill-Frontmatter greift beim Skill-Tool nicht.** Claude-Code-Bug [anthropics/claude-code#98898](https://github.com/anthropics/claude-code/issues/98898) (offen, reproduzierbar): `model:`/`effort:` im `SKILL.md` wirkt nur beim Aufruf per `/skill-name`, nicht wenn Claude den Skill per Skill-Tool lädt. Belegt durch Langfuse (siehe §5): in rund 22 `skill:kubernia`-Traces kein einziger Sonnet-Call.
- **Konsequenz:** Der Hebel für den Hauptagenten ist der Projekt-Default `"model": "sonnet"` in [`.claude/settings.json`](../.claude/settings.json). Interaktiv per `/model` überschreibbar. Das Frontmatter `model: sonnet`/`effort: medium` im `kubernia`-Skill greift nur bei `/kubernia`. Planer und Review bleiben Opus, weil sie Subagenten sind.
- **Turn-Scope:** Ein Skill-Override gälte laut Doku nur für den Rest des Turns. Darum laufen die starken Phasen (Planung, Review) bewusst als eigene Subagenten, auch das Self-Grading-Verbot (#1012) hängt daran: Lenses nie inline im Hauptagenten.

## 3. Keine Pins mehr

Der Harness enthält keine festen Modell-IDs (`claude-opus-…` und Verwandte) in `model:`-Feldern. Es gibt deshalb keine Update-Checkliste. [`test/harness/model-routing.test.ts`](../test/harness/model-routing.test.ts) verbietet harte IDs in `.claude/agents`, `.claude/skills`, `.claude/workflows` und `.claude/settings.json`. Wer eine bestimmte Generation braucht, muss den Wächter bewusst (per reviewtem Commit mit Begründung) anpassen, nicht still pinnen.

## 4. Konvention im Ticket-Workflow

- Ticket claimen, dann **Planung** durch den `kubernia-planner` (`opus`, `xhigh`), aufgerufen vom `kubernia`-Skill bzw. der Plan-Phase des Workflows. Er ist auch der Weg für Handplanung („plane das Ticket"). Es gibt keine zweite Planungs-Oberfläche.
- **Review** durch drei Lens-Subagenten (`opus`; `high` nur im Workflow wirksam, §2), auf beiden Pfaden, nie inline ([`review-lenses`](../.claude/skills/review-lenses/SKILL.md)).
- **Umsetzung** auf `sonnet`: Workflow per `agent()`-Optionen, Skill-Pfad per Projekt-Default, Loop per Spawn-Parameter.
- **Explore** als `Agent({model: "haiku"})`; Effort ist dort nicht per Tool setzbar (§2).
- Der Wächter [`test/harness/model-routing.test.ts`](../test/harness/model-routing.test.ts) prüft, dass die Angaben da sind (jeder Workflow-`agent()` mit `effort` und `model` oder `agentType`, Plan-Effort im Workflow gleich dem Planer-Frontmatter, settings-Default, Planer, Loop-Spawn mit `model`, Lenses mit `model`), nicht dass Claude Code sie zur Laufzeit anwendet.

> Details zur Modellwahl-Philosophie (Planung stark, Umsetzung schnell): [docs/agent-harness.md § Skills + Setup](agent-harness.md#25-skills--setup-als-reproduzierbare-abläufe) (#741, #745).

## 5. Token- und Loop-Baseline (#1068)

Bezugspunkt für die Token-Optimierungen **#1065** (Modell-/Effort-Routing) und **#1067** (ein Ablauf): Wer dort etwas ändert, misst den eigenen Lauf mit demselben Skript und stellt ihn im PR neben diese Tabelle. #1064 ist bewusst **nicht** Teil des Vergleichs (Maintainerin-Entscheidung 2026-09-29), weil sein erster Teil schon vor der Baseline gemergt war.

### Messen

```bash
node scripts/token-baseline.mjs --session <claude-session-id> --issue <nr> --pr <pr-nr>
# Session mit mehreren Tickets: immer ab dem Claim des Tickets schneiden (Zeit aus dem assigned-Event)
node scripts/token-baseline.mjs --session <id> --issue <nr> --pr <pr-nr> --from <ISO-Zeit des Claims>
```

- **Quelle ist das lokale Claude-Code-Transkript** (`~/.claude/projects/<projekt>/<session>.jsonl` + `subagents/`). `--langfuse` liest stattdessen die Langfuse-v2-Observations-API (braucht `LANGFUSE_PUBLIC_KEY`/`LANGFUSE_SECRET_KEY`, liefert zusätzlich Kosten). Für die Baseline zählt das Transkript, weil die Langfuse-Aufzeichnung zum Messzeitpunkt **unvollständig** war (für #1064 nur 11 der Hauptagent-Calls und 2 von 7 Subagenten). Mit lokalem Hook-Patch ist `--langfuse` gleichwertig (siehe nächster Punkt). Transkripte rotieren nach einigen Wochen: **direkt nach dem Merge messen.**
- **Langfuse-Hook-Patch (#1084).** Ursache der Lücke ist ein Bug im Hook des Plugins `langfuse-observability`: Folgearbeit nach Hintergrund-Subagenten und als `queued_command` angehängte Meldungen gehen verloren. Mit lokalem Patch an drei Ticket-Läufen vom 30.09./01.10.2026 verifiziert (Plugin 1.0.0, je ganze Session inkl. Subagenten, ohne `--issue`/`--from`): Calls (122/122, 141/141, 152/152) und alle vier Token-Summen (Input, Cache-Write, Cache-Read, Output) stimmen zwischen Transkript und Langfuse-`GENERATION`s exakt überein. ⚠️ Gilt nur für gepatchte Installationen; Pflege und Stand: [Langfuse-Hook-Patch pflegen](#langfuse-hook-patch-pflegen-10841122).
- **Phasen** ohne Marker im Lauf: Subagenten nach `agentType`, Workflow-Label (`umsetzen:`, `ci-fix` …) bzw. Beschreibung (Planer → Planung, Lens/Kritiker → Review, Explore → Recherche); der Hauptagent und nicht zuordenbare Subagenten über GitHub-Zeitstempel — vor dem Claim **Auswahl**, bis zum PR **Umsetzung**, bis zum Merge **CI/Merge**, danach **Nachlauf** (wird gezeigt, zählt nicht zum Ticket).
- **Loop-Kennzahlen:** Review-Runden (Heuristik: 3 Lenses = 1 Runde, jeder weitere Kritiker +1), CI-Fix-Runden (distinct `head_sha` mit rotem CI, dieselbe Zählung wie #904), Rückfragen (`AskUserQuestion`), gemergt ohne Nacharbeit (Merge und 0 rote Pushes).

### Langfuse-Hook-Patch pflegen (#1084/#1122)

Der Patch bleibt **bewusst lokal** im Plugin-Cache (`~/.claude/plugins/cache/langfuse-observability/…/hooks/langfuse_hook.py`, User-Scope, wirkt damit für alle Projekte), nicht im Repo versioniert und nicht upstream gemeldet (Maintainerin-Entscheidung). Jedes Plugin-Update überschreibt ihn.

- **Prüfregel (gilt dauerhaft):** `grep -c "LOCAL PATCH" langfuse_hook.py` → `2`. Neben der Datei liegt das unveränderte Original als `langfuse_hook.py.orig`.
- **Stand (seit #1122):** Plugin 1.2.0 (upstream `main` `8870487`), Patch portiert. Inhaltlich gleich wie unter 1.0.0, nur übernimmt die umgewandelte Meldung zusätzlich `sessionId`/`uuid`, damit der neue Fork-Filter (`is_row_from_another_session`) greift. Upstream hat beide Bugs auch dort noch. Per Probe-Session belegt: Tool-Fehler als `ERROR`, `project`-Metadatum, Tags. Zählvergleich unter 1.2.0 (#1187, Session `14dfbfb5-1f2f-439a-8f23-f2135cfa563a` mit Ticket-Lauf #1181 vom 05.10.2026, Planer und drei Lenses): gemessen ab Session-Start bis zum Ende des #1181-Turns, weil die Session danach noch weiterlief. Ergebnis: 57/57 Calls (Hauptagent 41, Subagenten 16), Input 124, Cache-Write 404 901, Cache-Read 5 066 237, Output 23 324, auf beiden Seiten identisch. Direkt nach dem Turn standen in Langfuse erst 56 Calls; der letzte kam beim nächsten Stop nach (siehe Log-Meldung).
- **Trace-Tag:** `.claude/settings.json` setzt `CC_LANGFUSE_TRACE_TAGS=kubernia`, damit sich kubernia-Läufe in Langfuse neben `claude-code` und `skill:<name>` filtern lassen.
- **Log-Meldung:** Seit 1.2.0 meldet der Stop-Hook den letzten Turn als „Processed 0 turns … Holding trailing open turn“, schreibt seine Observations aber trotzdem; das ist kein Datenverlust. ⚠️ **Verzögert, nicht verloren:** Der **letzte Call eines Turns** kann in Langfuse bis zum nächsten Hook-Lauf fehlen, weil Claude Code ihn erst ins Transkript schreibt, nachdem der Stop-Hook gelesen hat (in #1187 begann er genau am gespeicherten Lese-Offset und kam beim nächsten Stop an). Ob `SessionEnd` ihn am Session-Ende ebenso nachliefert, ist plausibel (der Hook ist dort registriert), aber nicht beobachtet. **Messregel:** erst vergleichen, wenn nach dem gemessenen Turn noch ein Stop gelaufen ist. Den Abgleich Transkript ↔ Langfuse über die ganze Session fahren; ist ein Zeitschnitt nötig, ihn mit mindestens einer Minute Abstand hinter den letzten gemessenen Call legen, denn Langfuse führt einen Call unter seiner Startzeit, das Transkript unter seiner Schreibzeit (in #1187 13 s später).
- **Alternative ohne Patch:** gibt es derzeit nicht. Der native OTel-Export von Claude Code liefert Tokens nicht als `gen_ai.usage.*`, und Langfuse übernimmt sie deshalb nicht als Usage (#1185).

**Nach einem Plugin-Update:**

1. Beide Scopes heben: `claude plugin update langfuse-observability@langfuse-observability` aktualisiert nur einen Scope, also zusätzlich mit `--scope user` aufrufen.
2. Das neue Original als `langfuse_hook.py.orig` sichern.
3. Den Patch an einer Kopie portieren, gegen die Plugin-Tests prüfen (mit und ohne Patch dieselben Ergebnisse), dann einspielen.
4. Prüfregel oben, danach Zählvergleich wie unter [Messen](#messen) (Erwartung ±0, Messregel unter „Log-Meldung“ beachten).

### Baseline (Stand 2026-09-29, alle vier Läufe vor #1065/#1067)

„Tokens" = Input + Cache-Write + Cache-Read + Output ohne Nachlauf; Input allein liegt je Lauf unter 300 und ist weggelassen. Die Phasen-Spalten zeigen den Anteil an diesen Tokens in %.

| Lauf | Calls | Tokens | davon Cache-Read | Cache-Write | Output | Auswahl | Planung | Umsetzung | Review | CI/Merge | Recherche | Modell Umsetzung | Review-Runden | CI-Fix | Rückfragen | ohne Nacharbeit |
|---|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|---|--:|--:|--:|---|
| #1026 (Workflow-Bugfix) | 60 | 6.781k | 95 % | 320k | 21k | 12 | – | 60 | 17 | 12 | – | `claude-opus-5-5` | 1 | 0 | 0 | ja |
| #1064 (Kontext-Gate) | 133 | 20.514k | 95 % | 883k | 49k | 3 | 9 | 65 | 12 | 3 | 8 | `claude-opus-5-5` | 2 | 0 | 1 | ja |
| #1069 (Harness-Regel)¹ | 84 | 18.592k | 96 % | 678k | 72k | –¹ | – | 64 | 30 | 6 | – | `claude-opus-5-5` | 2 | 0 | 1 | ja |
| #1072 (ADR, Doku)¹ | 22 | 6.542k | 98 % | 140k | 18k | –¹ | – | 65 | 8 | 27 | – | `claude-opus-5-5` | 1 | 0 | 1 | ja |

¹ #1069 und #1072 liefen in derselben Session und sind ab dem jeweiligen Claim geschnitten (`--from`); ihre Auswahl ist deshalb nicht gemessen.

**Was die Baseline zeigt:**
- **Die Umsetzung lief in allen vier Läufen auf Opus 5.5, nie auf Sonnet.** #1026 und #1064 hatten den `kubernia`-Skill geladen (`model: sonnet` im Frontmatter; der Hebel ist seitdem `settings.json`, §2), trotzdem kam **kein einziger** Hauptagent-Call von Sonnet. Die Modelle an **Subagenten** greifen dagegen: in #1064 lief der Planer auf `claude-opus-5`, die Recherche auf `claude-sonnet-5-5`. Es hakt also am Frontmatter-Override des Hauptagenten — der größte Hebel für #1065. (`test/harness/model-routing.test.ts` prüft nur, dass die Zeile da ist, nicht, dass sie wirkt.)
- **95–98 % der Tokens sind Cache-Reads**, also der pro Call neu gelesene Kontext. Weniger Calls und ein kleinerer Grundkontext sparen mehr als kürzere Antworten.
- **Loops sind schon billig:** kein einziger roter CI-Push, 1–2 Review-Runden, höchstens eine Rückfrage. Die Kosten stecken in der Umsetzung (60–65 %) und im Review (bis 30 %).
- **Die Planung fehlt bei drei von vier Läufen.** Nur #1064 hat den `kubernia-planner` gerufen; #1026 lief über den Skill und übersprang ihn trotzdem.
- **Grenze der Baseline:** alle vier sind Harness-/Doku-Tickets ohne Spielcode unter `src/`. Ein `src/`-Lauf wird bei Gelegenheit ergänzt; bis dahin nur Harness-Tickets gegen diese Zeilen vergleichen.

### Langfuse-Nachmessung 28.09.–05.10.2026 (vor #1065)

Quelle: Langfuse, alle Calls der Woche nach Modell.

| Modell | Rolle | Calls | Kosten | Anteil |
|---|---|--:|--:|--:|
| `claude-opus-5-5` | Hauptagent | 3.399 | 209,60 $ | 88 % |
| `claude-opus-5` | Planer, Lenses | 272 | 27,56 $ | 12 % |
| `claude-haiku-4-5` | Recherche | 39 | 0,64 $ | <1 % |
| `claude-sonnet-5-5` | ein Trace (29.09.) | 45 | 0 $¹ | 0 % |

¹ Langfuse hat für `claude-sonnet-5-5` keinen Preis hinterlegt (#1123).

In rund 22 Traces mit Tag `skill:kubernia`: 1.284 Calls Opus 5.5, 257 Opus 5, 9 Haiku, **0 Sonnet**. Das belegt Bug #98898 (§2): das Skill-Frontmatter wirkt beim Skill-Tool nicht, daher der Projekt-Default in `settings.json`.

**Erwartete Ersparnis** durch den Sonnet-Hauptagenten: etwa ein Viertel, nicht die Hälfte. Cache-Reads kosten bei Opus 5.5 und Sonnet 5.5 gleich viel (0,20 $/Mio) und machen 44 % der Kosten aus. Die Nachmessung des ersten Laufs unter dem neuen Routing läuft in #1206.

### Grundkontext pro Session (#1198)

**Metrik:** Sockel = `input + cache_creation + cache_read` des ersten Assistant-Calls einer Session bzw. eines Subagenten. Er steht vor jeder Nutzereingabe im Kontext und wird bei jedem der 100–250 Calls neu gelesen.

**Befund:** Die 55k aus dem Ticket sind der Sockel der **Subagenten** (Planer 56–57k, Lens 54–57k). Der Hauptagent liegt in echten Sessions bei **ca. 70k** (Transkripte 02.–05.10.2026, stabil über 10 Sessions). Zum Vergleich: ein Agent mit nur 5 Tools und ohne Skill-/MCP-Listen liegt bei 28k, Explore (Haiku) bei 31k.

**Quellen des Hauptagenten** (Zeichen aus den Transkript-Attachments vor dem ersten Call; Tool-Schemas stehen nicht im Transkript und machen den Rest von ca. 40k Tokens aus):

| Quelle | Zeichen | Scope |
|---|--:|---|
| Skill-Listing (73 Skills) | 29,9k | Repo 3,9k, Rest User/claude.ai/Plugins/Claude Code |
| `AGENTS.md` | 27,0k | Repo (gegated, `check:contextsize`) |
| Namen der verzögerten Tools (261) | 8,8k | PixelLab 3,2k (Repo `.mcp.json`), Langfuse 2,8k, Chrome 0,8k, übrige User |
| MCP-Instruktionen | 6,6k | User/claude.ai, PixelLab 1,0k |
| Systemprompt-Snapshot, Agent-Listing, SessionStart-Hook | 12,8k | Claude Code/User |

**Messung vorher/nachher** (`claude -p` im Projekt, Sonnet, gleicher Prompt; Headless liegt unter den interaktiven Werten, weil weniger Hooks und Tools laden, die Differenzen sind aber übertragbar):

| Variante | Sockel |
|---|--:|
| Hauptagent vorher | 52,3k |
| `disableClaudeAiConnectors` | −2,5k |
| `enabledPlugins` data/cowork aus | −2,6k |
| `skillListingMaxDescChars: 300` | −3,4k |
| **Hauptagent nachher** (alle drei) | **45,6k** (−6,7k, −13 %) |
| Planer vorher (volle Tool-Liste) | 40,2k |
| **Planer nachher** (`tools:`-Whitelist) | **27,0k** (−33 %) |
| Gegenprobe ohne Skills / ohne MCP / ohne User-Scope | 46,3k / 45,5k / 37,9k |

Ohne Wirkung gemessen und deshalb **nicht** gesetzt: `enableArtifact: false` (0), `deniedMcpServers` für einen User-Server (±0).

**Umgesetzt:** Tool-Whitelist für den Planer; Beschreibungen aller Repo-Skills, des Planers und des Workflows auf höchstens 300 Zeichen; die drei wirksamen Schalter in `.claude/settings.json`; Wächter `test/harness/kontext-sockel.test.ts` (Whitelist ohne `*`/`Skill`/`Artifact`, Längenobergrenze, Schalter bleiben).

**Grenzen:** Das Ziel „unter 40k" erreicht der **Planer** (27k). Der Hauptagent liegt headless bei 45,6k; weiter geht es nur im User-Scope (siehe unten) oder durch weniger `AGENTS.md`. Lens- und Explore-Agenten haben noch keine Whitelist (Sockel ca. 55k bzw. 31k) und gehören zu #1209; der Wächter erzwingt die Whitelist dort automatisch, sobald die Agenten angelegt sind. PixelLab bleibt in `.mcp.json`; ob es in einer Session lädt, entscheidet `enabledMcpjsonServers` in der lokalen `.claude/settings.local.json` der Maintainerin.

**Hinweise für den User-Scope** (nur die Maintainerin kann das ändern): persönliche Skills, die claude.ai-Skills doppeln, aus `~/.claude/skills` entfernen; Trello- und Langfuse-MCP nur in den Projekten aktivieren, die sie brauchen; `/mcp` bzw. `disabledMcpServers` für nicht benötigte Server; SessionStart-Hooks und den Chrome-Default prüfen; Server mit dauerhaftem Verbindungsfehler entfernen.

**Nachmessen:** frische Session starten, danach das Transkript unter `~/.claude/projects/<projekt>/<session>.jsonl` lesen: erster Assistant-Call mit `usage`, Summe aus `input_tokens`, `cache_creation_input_tokens`, `cache_read_input_tokens`; Subagenten liegen unter `<session>/subagents/`. Alternativ in Langfuse `usageDetails` der ersten Generation einer Session.

### Nach einer Optimierung vergleichen

Die Nachmessung läuft in #1206: das Skript für 1–3 neue Läufe fahren, die Zeilen unter diese Tabelle hängen und die Veränderung von **Tokens**, **Modell Umsetzung** und den Loop-Spalten im PR-Text benennen. Eine Einsparung gilt nur, wenn die Loop-Spalten nicht schlechter werden (mehr CI-Fix-Runden oder Nacharbeit fressen den Gewinn).

### Langfuse-Blick beim Sammelticket (#1199)

Kommt das Sammelticket „Harness-Härtung (gesammelt)" dran ([Mechanik](ticket-reihenfolge.md#sammelticket-harness-härtung-gesammelt-1199)), steht **vor** dem Abarbeiten ein fester, kurzer Blick in Langfuse auf die Läufe seit dem letzten Sammelticket (Tag `kubernia`). Genau drei Fragen, kein freies Stöbern:

1. **Wirkung:** Tokens und Kosten pro Ticket gegen die [Baseline](#baseline-stand-2026-09-29-alle-vier-läufe-vor-10651067) — haben die seitdem gemergten Harness-Änderungen gewirkt? Je Lauf eine Zeile unter die Tabelle (Skript oben, `--langfuse`).
2. **Tokenfresser:** der teuerste Lauf des Zeitraums und woran es lag (Phase, Subagent, wiederholtes Lesen großer Dateien).
3. **Prozess:** Läufe mit auffällig vielen CI-Fix- oder Review-Runden bzw. Nacharbeit.

Jeder Befund wird eine Zeile im Sammelticket; ein eigenes Issue nur bei einem echten Defekt (AGENTS.md § Nicht jeder Befund wird ein Ticket). Ohne erreichbares Langfuse (Keys fehlen, Server aus) den Punkt im PR als „übersprungen" melden, nicht raten.

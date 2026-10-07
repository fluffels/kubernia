# Modell-Routing im Kubernia-Harness (#910, #1065)

> **SSOT für Modell- und Effort-Routing.** Es gibt keine festen Modell-IDs mehr im Harness, nur die Tier-Aliase `opus`, `sonnet` und `haiku`. Sie lösen auf das jeweils neueste Modell der Stufe auf ([Claude-Code-Doku › Model configuration](https://code.claude.com/docs/en/model-config)). Ein neues Modell braucht deshalb keine Wartung.

## 1. Phasen-Matrix

Gültige Effort-Stufen: `low`, `medium`, `high`, `xhigh`, `max`. Bei Sonnet 5+ und Opus 4.7+ ist der Effort die Obergrenze des adaptiven Reasonings; ohne explizite Angabe gilt bei Opus 5.5 und Sonnet 5.5 `medium` ([Claude-Code-Doku › Model configuration](https://code.claude.com/docs/en/model-config), Stand 2026-10-05). Spalte „Skill-Pfad" nennt, was dort tatsächlich greift.

| Phase | Alias | Effort | Workflow (`kubernia-ticket.js`) | Skill-Pfad (`kubernia`) |
|---|---|---|---|---|
| Auswahl + Claim | `sonnet` | `medium` | `agent()`-Optionen | Hauptagent (Session-Modell) |
| **Epic-Aufteilung** (Schnitt der Kinder; ohne verfügbaren Planer teilt der Anlege-Agent selbst auf) | `opus` | `xhigh` | dieselbe Plan-Aufrufstelle (`kubernia-planner`) mit Epic-Hinweis im Prompt | Subagent `kubernia-planner` schlägt vor |
| Epic-Kinder anlegen | `sonnet` | `medium` | `agent()`-Optionen (`epic-anlegen`) | Hauptagent (Session-Modell) |
| Dependabot-Sammelticket | `sonnet` | `medium` | `agent()`-Optionen (ohne Planer) | Hauptagent (Session-Modell) |
| **Planung** | `opus` | `xhigh` | `agentType: 'kubernia-planner'` + `effort` | Subagent `kubernia-planner` (Frontmatter) |
| Pre-Flight (Weichen selbst entscheiden) | `sonnet` | `medium` | `agent()`-Optionen | Hauptagent (Session-Modell; übernimmt die Entscheidungen des Planers, `AskUserQuestion` nur bei Irreversiblem/Außenwirkung) |
| Umsetzung | `sonnet` | `medium` | `agent()`-Optionen | Subagent [`kubernia-umsetzer`](../.claude/agents/kubernia-umsetzer.md) (Frontmatter, unabhängig vom Session-Modell) |
| **Review (1–3 Lenses, [Staffel](#review-staffel-1265))** | `opus` | `high` | `agentType: 'kubernia-lens'` + `effort` | Subagenten `kubernia-lens`, vom Umsetzer über `review-lenses` gespawnt (Frontmatter, `high` wirkt) |
| Nachbessern, CI-Fix | `sonnet` | `medium` | `agent()`-Optionen | im Umsetzer |
| PR + Merge, Festgefahren, Cleanup | `sonnet` | `medium` | `agent()`-Optionen | im Umsetzer |
| Explore / Recherche | `haiku` | `low` | n/a | Agent `Explore` (Projekt-Override des eingebauten Explore, Frontmatter); `low` ist deklariert, wirkt aber nicht: Haiku unterstützt laut Claude-Code-Doku keinen Effort (§2) |

**Warum so:** Fehler in Planung und Review sind teuer (schlechte Architektur kostet viele Sessions), dort lohnt das stärkste Modell mit hohem Reasoning (#741, #745). Auch der Schnitt eines Epics in Kindertickets ist Planung (#1207): ein schlechter Schnitt kostet viele Sessions, das Anlegen per `gh` ist dagegen Tipparbeit. Tippen nach fertigem Plan ist Sonnet-Arbeit, `medium` lässt genug Reasoning für die CI-Fix-Schleife. Explore liest und sucht nur, Haiku genügt.

### Review-Staffel (#1265)

Der Review war nach #1065 der größte Kostenblock je Ticket (38–40 %, bei kleinen Doku-Tickets 55 % und mehr), unabhängig von der Diffgröße. Etwa 80–85 % einer Lens sind Cache-Write des festen Sockels; parallel gestartete Lenses teilen nur den kleinen Anfang des Prompts (gemessen, siehe unten „Lens-Cache“). Gespart wird darum an der **Zahl** der Lenses. Die Maintainerin hat die Abwägung an den Agenten übergeben; entschieden ist:

1. **Staffel nach Diff-Art, nicht nach Größe.** Ein reiner `*.md`-Diff (auch Harness-Markdown wie `AGENTS.md` oder Skills) bekommt **eine Doku-Lens** (Requirement-Treue, SSOT/Drift, Wächter-Kopplung, oberste Regel); jeder andere Diff alle drei Brillen. Begründung: ohne Code hat die Test-Lens nichts zu sabotieren, die Architektur-Fragen einer Doku (Regel doppelt? Wächter mitgezogen?) übernimmt die Doku-Lens. Die teuren Doku-Tickets waren Harness-Doku; ohne sie bliebe kaum Ersparnis. Keine Größenschwelle für Code: auch ein kleiner `src`-Diff kann das Save-Format brechen. Die Zuordnung der ersten Runde ist eine Tabelle (`LENS_SAETZE` im Workflow), eine weitere Diff-Art ist dort eine Zeile; die Delta-Regel ab Runde 2 muss dann mitgedacht werden.
2. **Ab Runde 2 nur die blockierten Brillen auf dem Delta** des Fixes, mit ihren Vorrunden-Blockern als Prüfliste. Ändert der Fix Nicht-Markdown, läuft **Test-Adäquanz immer mit**: ein Code-Fix ohne passenden Test ist der wahrscheinlichste neue Fehler, und `check:diffcoverage` gatet die Präsentation nicht. Ein Delta allein spart je Lens nur 20–30 %; erst das Weglassen ganzer Lenses spart den Sockel.
3. **Patch einmal lesen** (Prompt-Regel in der Kontext-Diät, im Skill und in `kubernia-lens`): einmal vollständig, und zwar in den Abschnitten, die `node scripts/patch-abschnitte.mjs <patch>` nennt (Budget 32.000 Zeichen je Abschnitt; ein größeres `limit` scheitert am Token-Limit des Read-Tools und kostet Wiederholversuche), danach gezielt. Kein Patch-Text im Prompt: die Workflow-Sandbox kann keine Dateien lesen, und der Hauptagent müsste den Patch sonst selbst lesen.
4. **Sonnet für einzelne Lenses: zurückgestellt.** Kein Messbeleg, und gerade die Test-Lens fand den einzigen harten Blocker (#1034). Wiedervorlage erst mit einer Lens-Nutzen-Metrik (#1123) und einer Gegenprobe Opus gegen Sonnet auf denselben Patches (n ≥ 5, darunter `src`-Tickets). Aus demselben Grund bleibt der Lens-Effort `high`.

**Fail-closed:** Fehlt die Dateiliste, gab es keinen Vorrunden-Pass (`verify` rot), fiel eine Lens aus, wechselte die Diff-Art oder fehlt das Delta (der Nachbesserer lässt es nach Merge/Rebase von `main` leer; vergisst er das, enthält das Delta die `main`-Änderungen, also mehr Review, nicht weniger), läuft der volle Satz auf dem vollen Patch. Implementiert als `lensPlan` in [`.claude/workflows/kubernia-ticket.js`](../.claude/workflows/kubernia-ticket.js), auf dem Skill-Pfad als Regel in [`review-lenses`](../.claude/skills/review-lenses/SKILL.md); bewacht von [`test/harness/review-staffel.test.ts`](../test/harness/review-staffel.test.ts). Die Nachmessung muss Lenses je Ticket und Kosten je Lens getrennt ausweisen, weil #1209 parallel den Sockel je Lens senkt.

**Lens-Cache (#1309, gemessen am 2026-10-06 in den Lens-Gruppen der Transkripte).** Kalter erster Call einer Lens: `cache_read` 0, `cache_write` rund 26k. Ein warmer erster Call liest genau **8.765 Tokens** (System-Prompt und Tool-Liste) und schreibt weiter rund 17,4k: nur dieser vorderste Teil ist zwischen Lenses geteilt, `AGENTS.md` und der Auftrag stehen dahinter und werden je Lens neu geschrieben. Zeitlich versetzte Starts (+67 s, +125 s, +149 s) lasen ebenfalls nur diese 8,8k. Die mögliche Ersparnis eines versetzten Starts ist darum höchstens 8,8k × (5,00 − 0,20) $/M, also **rund 0,04 $ je Lens** und nur bei kalter Runde. Entscheidung: kein versetzter Start in `parallel()`, der Aufwand und die Wartezeit stehen in keinem Verhältnis.

**Ehrlich zum Skill-Pfad:** Im Hauptagenten bleiben nur Auswahl, Claim, Pre-Flight (übernimmt die Planer-Entscheidungen, Rückfrage nur bei Irreversiblem/Außenwirkung), Epic-Kinder und Dependabot, auf dem Session-Modell, das die Maintainerin wählt (`.claude/settings.json` pinnt bewusst keins), im Normalfall also Opus. Bewusst in Kauf genommen: Auswahl und Pre-Flight sind kurz und profitieren vom Abwägen, Epic-Kinder und Dependabot sind selten; wer dort sparen will, stellt vorher `/model sonnet`. Alles Teure von der Umsetzung bis zum Cleanup läuft im Subagenten `kubernia-umsetzer` mit `sonnet`/`medium` aus seinem Frontmatter, egal auf welchem Modell die Session steht.

## 2. Wie das Routing in Claude Code wirkt

- **Aliase gibt es.** `opus`, `sonnet`, `haiku` (dazu `opusplan`, `best`, `fable`) lösen auf das neueste Modell der Stufe auf. Es gibt keinen Modus, der nach kubernia-Phasen wechselt. `opusplan` wechselt nur zwischen dem Claude-Code-Plan-Modus (opus) und der Ausführung (sonnet) und passt nicht zum Ticket-Ablauf.
- **Subagenten:** `model:` im Agent-Frontmatter bzw. an `Agent({…})`/`agent({…})` greift nachweislich. Ohne Angabe erbt ein Subagent das Session-Modell.
- **Das Agent-Tool kennt `effort`, die Konvention setzt ihn trotzdem nicht am Spawn.** Sein Schema kennt `description`, `effort`, `isolation`, `model`, `prompt` und `subagent_type`; `run_in_background` gibt es nicht mehr, jeder Subagent läuft im Hintergrund und der Aufrufer wird benachrichtigt (am eigenen Tool-Schema belegt, #1342). Laut Tool-Beschreibung ist `effort` nur auf ausdrücklichen Wunsch der Maintainerin oder eines Skills zu setzen; sonst gilt der Frontmatter-Wert, und ein Wert am Spawn überstimmte ihn. Darum steht der Effort im Frontmatter des Repo-Agenten (beim Skill-Frontmatter nur bei `/slash`, siehe nächster Punkt, und als Option von `agent()` in Workflow-Skripten) und die `Agent({…})`-Spawns der Skills setzen weder `model:` noch `effort:` (bewacht vom Wächter unten). Lenses laufen auf beiden Pfaden über [`kubernia-lens`](../.claude/agents/kubernia-lens.md) (`opus`, `high`); der Spawn setzt kein `model:`, weil es das Frontmatter überstimmte. Explore ist ein Projekt-Agent mit exakt `name: Explore` ([`explore.md`](../.claude/agents/explore.md)) und ersetzt laut Claude-Code-Doku den eingebauten (Projekt-Agent vor Built-in; `omitClaudeMd: true` lässt ihm die Kontextdateien weg, wie dem eingebauten; der Schlüssel steht in der Frontmatter-Tabelle der Claude-Code-Subagent-Doku (ab v2.1.271, installiert 2.1.291) und bleibt; gemessener Erfolg: Explore-Sockel 10,8k gegen Lens 26,3k, siehe §5 „Sockel von Lens und Explore“); die Wirkung zur Laufzeit ist per Modell im Transkript bzw. Langfuse nachzuprüfen; Haiku kennt keinen Effort, `low` wirkt erst, wenn der Alias `haiku` auf ein Modell mit Effort zeigt. Der Umsetzer wird ebenfalls ohne `model:` gespawnt, Modell und Effort stehen in [`kubernia-umsetzer`](../.claude/agents/kubernia-umsetzer.md).
- **Grenzen von Subagenten** ([Claude-Code-Doku › Subagents](https://code.claude.com/docs/en/sub-agents), Stand 2026-10-06): `AskUserQuestion` ist in Subagenten immer entfernt; der Umsetzer meldet `entscheidung-noetig`, der Hauptagent fragt und setzt ihn per `SendMessage` mit vollem Kontext fort. Subagenten dürfen bis drei Ebenen tief selbst spawnen (`CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH`); Hauptagent → Umsetzer → Lens braucht zwei. Eine `tools:`-Whitelist ohne `mcp__`-Einträge nimmt alle MCP-Tools; darum führt der Umsetzer die Playwright-MCP-Tools (Browser-Prüfung) und die Langfuse-Lesetools (Status-Ticket) einzeln auf, PixelLab bleibt im Hauptagenten. Verschachtelte Subagenten (Umsetzer → Lens) legt Claude Code flach in `<session>/subagents/` ab, mit `parentAgentId` und `spawnDepth` in der `meta.json`: das Messskript erfasst sie im Transkript-Modus, Langfuse nur mit dem lokalen Hook-Patch (§5, #1291). Subagenten schreiben den Prompt-Cache mit 5 Minuten TTL statt einer Stunde; ob lange CI-Wartezeiten im Umsetzer dadurch teure Cache-Neuaufbauten auslösen, ist gemessen (2026-10-06, 7 Umsetzer-Läufe #1270, #1303, #1308, #1293, #1276, #1284, #1139): in allen Läufen `cache_creation.ephemeral_1h_input_tokens` = 0 (5m bestätigt); drei Läufe hatten Neuaufbauten nach Pausen über 5 Minuten (#1293: 3 Neuaufbauten mit 466.530 Tokens, #1139: einer nach 543 s mit 286.836 Tokens, #1308: einer nach 345 s mit 278.210 Tokens). Rechnung mit dem Messskript-Zähler (`Cache-Neuaufbauten` im Report): alle 7 Läufe schrieben zusammen 2,73 Mio Tokens Cache; die Neuaufbauten machen davon 1,03 Mio. Mit 1h-TTL (Sonnet 5.5: 4 $/M statt 2,5 $/M) entfielen sie als Write und würden zu Reads (0,2 $/M): 1,70 Mio × 4 $ + 1,03 Mio × 0,2 $ ≈ 7,00 $ gegen 2,73 Mio × 2,5 $ ≈ 6,82 $ heute, also **+0,18 $ über 7 Läufe**. Die 1h-TTL lohnt sich nicht; `experimental.cacheTtl` bleibt bewusst ungesetzt, der Zähler bleibt als Messpunkt.
- **Skill-Frontmatter greift beim Skill-Tool nicht.** Claude-Code-Bug [anthropics/claude-code#98898](https://github.com/anthropics/claude-code/issues/98898) (offen, reproduzierbar): `model:`/`effort:` im `SKILL.md` wirkt nur beim Aufruf per `/skill-name`, nicht wenn Claude den Skill per Skill-Tool lädt. Belegt durch Langfuse (siehe §5): in rund 22 `skill:kubernia`-Traces kein einziger Sonnet-Call.
- **Konsequenz:** Verlässlich ist nur Agent-Frontmatter: darum laufen Umsetzung (`sonnet`), Planung und Review (`opus`) als Subagenten. Ein Projekt-Default in `.claude/settings.json` ließe sich per `/model` überschreiben und überstimmte nur die Modellwahl der Maintainerin für den Hauptchat; es gibt darum keinen. Das Frontmatter `model: sonnet`/`effort: medium` im `kubernia`-Skill greift nur bei `/kubernia` und dann für die kurzen Orchestrator-Schritte.
- **Turn-Scope:** Ein Skill-Override gilt laut Doku nur für den Rest des Turns. Darum laufen alle langen Phasen (Planung, Umsetzung, Review) als eigene Subagenten, auch das Self-Grading-Verbot (#1012) hängt daran: Lenses nie inline, weder im Hauptagenten noch im Umsetzer.

## 3. Keine Pins mehr

Der Harness enthält keine festen Modell-IDs (`claude-opus-…` und Verwandte) in `model:`-Feldern. Es gibt deshalb keine Update-Checkliste. [`test/harness/model-routing.test.ts`](../test/harness/model-routing.test.ts) verbietet harte IDs in `.claude/agents`, `.claude/skills`, `.claude/workflows` und `.claude/settings.json`. Wer eine bestimmte Generation braucht, muss den Wächter bewusst (per reviewtem Commit mit Begründung) anpassen, nicht still pinnen.

## 4. Konvention im Ticket-Workflow

- Ticket claimen, dann **Planung** durch den `kubernia-planner` (`opus`, `xhigh`), aufgerufen vom `kubernia`-Skill bzw. der Plan-Phase des Workflows. Er ist auch der Weg für Handplanung („plane das Ticket") und für die Aufteilung eines Epics (er schlägt die Kinder vor, der Aufrufer legt sie an). Es gibt keine zweite Planungs-Oberfläche.
- **Review** durch Lens-Subagenten `kubernia-lens` (Zahl nach der [Staffel](#review-staffel-1265)) (`opus`, `high` im Frontmatter), auf beiden Pfaden, nie inline ([`review-lenses`](../.claude/skills/review-lenses/SKILL.md)).
- **Umsetzung** auf `sonnet`: Workflow per `agent()`-Optionen, Skill-Pfad über den Subagenten `kubernia-umsetzer`. Mehrere Tickets laufen nacheinander mit je einem frischen Umsetzer; einen eigenen Stapel-Skill gibt es nicht mehr.
- **Explore** über den Projekt-Agenten `Explore` (`haiku`, `low`), den jede Explore-Delegation automatisch nutzt (§2).
- Der Wächter [`test/harness/model-routing.test.ts`](../test/harness/model-routing.test.ts) prüft, dass die Angaben da sind (jeder Workflow-`agent()` mit `effort` und `model` oder `agentType`, jeder `agentType` im Workflow mit Agent-Definition, gleichem `effort` und ohne `model:`, kein Modell-Pin in settings.json, Planer, Umsetzer `sonnet`/`medium` mit `Agent`-Tool und vorgeladenem `review-lenses`, Umsetzer-Spawn ohne `model:`, Umsetzer mit Playwright- und Langfuse-MCP-Tools, Lens-Spawn über `kubernia-lens` ohne `model:`, `Explore` mit `haiku`/`low`), nicht dass Claude Code sie zur Laufzeit anwendet.

> Details zur Modellwahl-Philosophie (Planung stark, Umsetzung schnell): [docs/agent-harness.md § Skills + Setup](agent-harness.md#25-skills--setup-als-reproduzierbare-abläufe) (#741, #745).

## 5. Token- und Loop-Baseline (#1068)

Bezugspunkt für die Token-Optimierungen **#1065** (Modell-/Effort-Routing) und **#1067** (ein Ablauf): Wer dort etwas ändert, misst den eigenen Lauf mit demselben Skript und stellt ihn im PR neben diese Tabelle. #1064 ist bewusst **nicht** Teil des Vergleichs (Maintainerin-Entscheidung 2026-09-29), weil sein erster Teil schon vor der Baseline gemergt war.

### Messen

```bash
node scripts/token-baseline.mjs --session <claude-session-id> --issue <nr> --pr <pr-nr>
# Session mit mehreren Tickets: immer ab dem Claim des Tickets schneiden (Zeit aus dem assigned-Event)
node scripts/token-baseline.mjs --session <id> --issue <nr> --pr <pr-nr> --from <ISO-Zeit des Claims>
```

- **Quelle ist das lokale Claude-Code-Transkript** (`~/.claude/projects/<projekt>/<session>.jsonl` + `subagents/`). `--langfuse` liest stattdessen die Langfuse-v2-Observations-API (braucht `LANGFUSE_PUBLIC_KEY`/`LANGFUSE_SECRET_KEY`, liefert dieselben Calls inkl. der Cache-TTL-Aufteilung). Für die Baseline zählt das Transkript, weil die Langfuse-Aufzeichnung zum Messzeitpunkt **unvollständig** war (für #1064 nur 11 der Hauptagent-Calls und 2 von 7 Subagenten). Mit lokalem Hook-Patch ist `--langfuse` gleichwertig (siehe nächster Punkt). Transkripte rotieren nach einigen Wochen: **direkt nach dem Merge messen.**
- **Langfuse-Hook-Patch (#1084).** Ursache der Lücke ist ein Bug im Hook des Plugins `langfuse-observability`: Folgearbeit nach Hintergrund-Subagenten und als `queued_command` angehängte Meldungen gehen verloren. Mit lokalem Patch an drei Ticket-Läufen vom 30.09./01.10.2026 verifiziert (Plugin 1.0.0, je ganze Session inkl. Subagenten, ohne `--issue`/`--from`): Calls (122/122, 141/141, 152/152) und alle vier Token-Summen (Input, Cache-Write, Cache-Read, Output) stimmen zwischen Transkript und Langfuse-`GENERATION`s exakt überein. ⚠️ Gilt nur für gepatchte Installationen; Pflege und Stand: [Langfuse-Hook-Patch pflegen](langfuse-hook-patch.md).
- **Phasen:** Subagenten nach `agentType`, Workflow-Label (`umsetzen:`, `ci-fix` …) bzw. Beschreibung (Planer → Planung, Lens/Kritiker → Review, Explore → Recherche); `kubernia-umsetzer` bewusst ohne feste Phase, weil er Umsetzung und CI/Merge abdeckt, er läuft über den Zeitschnitt. Der Hauptagent und nicht zuordenbare Subagenten über GitHub-Zeitstempel — vor dem Claim **Auswahl**, bis zum PR **Umsetzung**, bis zum Merge **CI/Merge**, danach **Nachlauf** (wird gezeigt, zählt nicht zum Ticket). **Pflege** ist die einzige Phase mit Marker im Lauf (Pflegeschritt, AGENTS.md § Projekt-Brain pflegen): sie umfasst die Calls desselben Agenten von seinem Shell-Befehl `echo "pflege: start #<nr>"` bis `echo "pflege: ende #<nr>"` (Grenzen inklusive) und gilt vor allen Regeln außer dem Nachlauf. Beide Quellen werten dieselben Tool-Events aus (Transkript: je Subagenten-Datei, Langfuse: TOOL unter dem Subagent-Span); ein Marker ohne Gegenstück zählt nicht und steht als Warnzeile im Report. Fehlt der Marker ganz, landen die Pflegekosten in „Umsetzung“ und der Report warnt („Kein Pflege-Marker“, sobald ein `kubernia-umsetzer` im Fenster lief).
- **Kosten** kommen in beiden Modi aus der Preistabelle `PRICES` im Skript (Quelle und Stand dort), nicht aus Langfuse: Langfuse rechnet nur bei der Ingestion, ein später angelegter Preis gilt nicht rückwirkend. Cache-Writes werden nach 5m- und 1h-TTL getrennt bepreist. Ein Modell ohne Eintrag ist „ohne Preis" (Hinweis im Report), nie 0 $; ein neues Modell gehört in `PRICES`. Der Report nennt den Stand der Tabelle (`PRICES_STAND`). Eine Preisänderung kommt als neue **Periode** (`validFrom`) an den Eintrag, nicht als Überschreiben: alte Transkripte behalten so den Preis ihres Zeitpunkts. Der Hauptagent schreibt den Cache mit 1h-TTL, Subagenten mit 5m, darum liest das Skript `cache_creation.ephemeral_1h_input_tokens`. Auch mit `--langfuse` kommen die Kosten aus `PRICES` (eine Preisquelle, beide Modi vergleichbar; Langfuse-`totalCost` wird nicht genutzt). Die Cache-Writes liest das Skript aus `input_cache_creation_5m`/`input_cache_creation_1h` der Observation, bei älteren Aufzeichnungen aus `cache_creation_input_tokens` (zählt als 5m).
- **Summe und Nachlauf:** `rows` (alle Zeilen) = `total` (Ticket) + `nachlauf` (Calls und Kosten); die Nachlauf-Zeilen stehen im Report unter der Summe („Nachlauf (nicht in der Summe)“). Eine Phasen-Summe über der Summe-Zeile ist der Nachlauf, keine Doppelzählung.
- **Werkzeug-Zeilen (nur mit Tool-Events, Modul `scripts/tool-metriken.mjs`):** `Tool-Fehler:` zählt Fehler nach Art aus dem Anfang des Fehlertexts (Hook, Guard = `Blocked:`-Muster, Permission, zu groß = Read über dem Token-Limit, sonst; `Exit≠0` ist kein Fehlersignal, sondern oft erwartet). `Lesen:` zählt Reads je Agent und Datei: Wiederlesen **voll** (ohne `offset`/`limit`) und **gezielt** (mit) sind getrennt von abschnittsweisem Erst-Lesen (Bereiche ohne Überlappung); eigenes Edit setzt die Datei zurück, Tokens sind eine obere Schranke (Ergebnisgröße / 4). Im Transkript-Modus exakt (`is_error`, Eingabe vollständig); mit `--langfuse` stammt der Fehlertext aus `statusMessage` der `ERROR`-Observation (ersatzweise `output` der `io`-Stufe, nur für die Tools aus `EINGABE_TOOLS`; sonst `sonst`) und `offset`/`limit` aus der `io`-Eingabe der Read-Observations.
- **Zusatzzeilen im Report:** Sockel (erster Call des Hauptagenten, unabhängig von `--from`; Median der Planer bzw. Lenses nur im Ticket-Fenster), Median-Kontext, Kostenanteile (Input / Cache-Write / Cache-Read / Output) und **Cache-Neuaufbauten** (Zähler: Pause über 5 Minuten beim Subagenten bzw. 60 Minuten beim Hauptchat, und `cache_read` unter der Hälfte des Kontexts; gerechnet wird mit den dabei neu geschriebenen Tokens, Messpunkt zur Cache-TTL, siehe §2). Läuft ein Ticket in einer Session mit Arbeit an einem anderen Ticket, immer `--from <Claim>` setzen, sonst zählt der Planer des anderen Tickets mit.
- **Nachweis statt Heuristik (#1309):** mit `--pr` liest das Skript die `KQ-Review:`- und `KQ-Plan:`-Zeilen der PR-Commits; der Report nennt dann „Review-Runden: N (Nachweis)“ und „Planer: ja/nein (KQ-Plan)“, ohne Zeilen „(Heuristik)“. Ein Call ohne gültigen Zeitpunkt bei Preisperioden gilt als „ohne Preis“, nicht als neuester Preis.
- **Projekt-Brain (#1205):** die Zeile `Projekt-Brain:` im Report (und `brain` in `--json`) zeigt, was der Lauf aus dem Brain liest und sucht; Definition und Baseline: [Projekt-Brain-Kennzahlen](#projekt-brain-kennzahlen-1205).
- **Messregel Transkript ↔ Langfuse:** erst vergleichen, wenn nach dem gemessenen Turn noch ein Stop gelaufen ist, denn der letzte Call eines Turns kommt in Langfuse erst beim nächsten Hook-Lauf an ([Hook-Mechanik](langfuse-hook-patch.md#hook-mechanik-und-messregel)). Den Abgleich über die ganze Session fahren; ist ein Zeitschnitt nötig, ihn mit mindestens einer Minute Abstand hinter den letzten gemessenen Call legen, denn Langfuse führt einen Call unter seiner Startzeit, das Transkript unter seiner Schreibzeit.
- **Loop-Kennzahlen:** Review-Runden (höchster Runden-Marker `lens:<brille>:r<n>` bzw. `… R<n>`; ältere Läufe ohne Marker per Heuristik 3 Lenses = 1 Runde; jeder weitere Kritiker +1), CI-Fix-Runden (distinct `head_sha` mit rotem CI, dieselbe Zählung wie #904), Rückfragen (`AskUserQuestion`), gemergt ohne Nacharbeit (Merge und 0 rote Pushes).

### Langfuse-Hook-Patch pflegen (#1084/#1122)

Die Pflege des lokalen Hook-Patches am Plugin `langfuse-observability` steht auf einer eigenen Seite (Prüfregel, Bestandteile des Patches, Diagnose hängender Turns, Schritte nach einem Plugin-Update): [langfuse-hook-patch.md](langfuse-hook-patch.md). Hier bleiben nur die Verträge, die Konfiguration und Auswertung voraussetzen:

- **User-Scope-MCP-Server, deren Namen das Repo voraussetzt:** `langfuse`. Der Server liegt im User-Scope (nicht in `.mcp.json`), seine Namen stehen aber in `.claude/settings.json` (`allow`) und in `tools:` des Umsetzers. Wer ihn umbenennt, lässt diese Namen still ins Leere laufen; der Name ist Vertrag. `test/harness/model-routing.test.ts` bewacht, dass jeder `mcp__<server>__`-Name ein Server aus `.mcp.json` oder diese Zeile ist; ob `langfuse` wirklich verbunden ist, prüft Punkt 2 der Checkliste (`claude mcp list`), kein Test (er machte Mitwirkende ohne Langfuse rot).
- **Trace-Tag:** `.claude/settings.json` setzt `CC_LANGFUSE_TRACE_TAGS=kubernia`, damit sich kubernia-Läufe in Langfuse neben `claude-code` und `skill:<name>` filtern lassen.

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
- **Die Umsetzung lief in allen vier Läufen auf Opus 5.5, nie auf Sonnet.** #1026 und #1064 hatten den `kubernia`-Skill geladen (`model: sonnet` im Frontmatter; der Hebel war ab #1065 `settings.json`, seit #1280 der Subagent `kubernia-umsetzer`, §2), trotzdem kam **kein einziger** Hauptagent-Call von Sonnet. Die Modelle an **Subagenten** greifen dagegen: in #1064 lief der Planer auf `claude-opus-5`, die Recherche auf `claude-sonnet-5-5`. Es hakt also am Frontmatter-Override des Hauptagenten — der größte Hebel für #1065. (`test/harness/model-routing.test.ts` prüft nur, dass die Zeile da ist, nicht, dass sie wirkt.)
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

In rund 22 Traces mit Tag `skill:kubernia`: 1.284 Calls Opus 5.5, 257 Opus 5, 9 Haiku, **0 Sonnet**. Das belegt Bug #98898 (§2): das Skill-Frontmatter wirkt beim Skill-Tool nicht, daher (von #1065 bis #1280) der Projekt-Default in `settings.json`.

**Erwartete Ersparnis** durch den Sonnet-Hauptagenten: etwa ein Viertel, nicht die Hälfte. Cache-Reads kosten bei Opus 5.5 und Sonnet 5.5 gleich viel (0,20 $/Mio) und machen 44 % der Kosten aus. Gemessen: [Nachmessung nach #1065/#1198](#nachmessung-nach-10651198-1206).

### Nachmessung nach #1065/#1198 (#1206)

Gemessen am 2026-10-06 mit `scripts/token-baseline.mjs` über die lokalen Transkripte, Kosten aus der `PRICES`-Tabelle im Skript (Stand 2026-10-06). Ein Langfuse-Vergleich wäre schief: Langfuse rechnet Kosten bei der Ingestion, und der Sonnet-Preis wurde erst am 05.10. um 07:37 angelegt. Alle 14 Läufe sind vollständig bepreist (0 Calls ohne Preis). Die Gruppen nach Merge-Zeit: **vorher** vor #1065 (09:41Z), **A** nur #1065 aktiv, **B** #1065 und #1198 aktiv (nach 14:48Z).

| Gruppe | Läufe | Calls (Median) | Kosten (Median) | $ je Call (Median) | Kostenanteil Sonnet / Opus (Median) | Sockel Haupt / Planer / Lens | Median-Kontext Haupt | Review-Runden (Median) | CI-Fix (Summe) | Rückfragen (Summe) | ohne Nacharbeit |
|---|--:|--:|--:|--:|---|---|--:|--:|--:|--:|--:|
| vorher¹ | 3 | 119 | 7,86 $ | 0,066 | 0 % / 99 % (Hauptagent 60 %)¹ | 70,0k / 56,6k² / 56,1k | 159k | 1 | 0 | 3 | 3/3 |
| A (#1065) | 6 | 112 | 5,33 $ | 0,047 | 44 % / 56 % (Hauptagent 0 %) | 71,1k / 57,2k³ / 56,5k | 123k | 2 | 0 | 3 | 6/6 |
| B (#1065 + #1198) | 5 | 51 | 2,55 $ | 0,050 | 59 % / 41 % (Hauptagent 0 %) | 64,6k / 28,1k⁴ / 51,1k | 134k | 1 | 2 | 2 | 4/5 |
| C (Umsetzer-Subagent, #1280) | 6 | 199 | 8,85 $ | 0,046 | 47 % / 53 % (Umsetzung im Subagenten) | 65,3k / 29,3k / 26,2k | 79k | 2,5 | 1 | 1 | 5/6 |

**Gruppe C und „Haupt“:** C sind die Läufe, in denen der Subagent `kubernia-umsetzer` (#1280) umsetzt; **„Haupt“ und „Sockel Haupt“ meinen ab #1280 den dünnen Hauptchat, die Umsetzung zählt als Subagent**, Vergleiche mit A und B gelten darum nur für Läufe vor #1280. Der Hauptchat-Sockel ist über die Läufe praktisch konstant (64,5k bis 65,6k über alle Läufe der Nachträge, er hängt nicht vom Ticket ab); je Lauf belegt der [Nachtrag auf #1276](https://github.com/fluffels/kubernia/issues/1276#issuecomment-6019725674). Neue Läufe werden hier unter C fortgeführt: eine Zeile in der Läufe-Tabelle, die Gruppenzeile wird neu berechnet (Medianwerte über alle C-Läufe).

¹ #1201, #1199 und #1065. In #1065 selbst lief ein Teil schon auf Sonnet (42 Sonnet-Calls: 20 im Hauptagenten, 22 im Review); die Null-Prozent-Angabe gilt für #1201 und #1199.

Planer-Sockel: ² Median über 2 Läufe mit Planer (der Planer fehlt in 1 von 3 Läufen). ³ 3 Läufe (fehlt in 3 von 6). ⁴ 1 Lauf (#1221, fehlt in 4 von 5), also keine Streuung, nur ein Messpunkt. Sockel Planer und Lens zählen nur Subagenten im Ticket-Fenster (nach `--from`, vor dem Merge), der Sockel des Hauptagenten ist die Größe der Session.

| Lauf | Gruppe | Art | Calls | Kosten | Review | CI-Fix | Planer |
|---|---|---|--:|--:|--:|--:|---|
| #1201 | vorher | Harness | 71 | 5,53 $ | 1 | 0 | nein |
| #1199 | vorher | Harness | 119 | 7,86 $ | 1 | 0 | ja |
| #1065 | vorher | Harness | 154 | 8,91 $ | 2 | 0 | ja |
| #1218 | A | Doku | 41 | 1,95 $ | 2 | 0 | nein |
| #1215 | A | Harness | 75 | 3,97 $ | 2 | 0 | nein |
| #1110 | A | Doku | 111 | 5,13 $ | 2 | 0 | ja |
| #1211 | A | Harness | 122 | 5,53 $ | 2 | 0 | ja |
| #1208 | A | Doku | 112 | 5,85 $ | 2 | 0 | nein |
| #1198 | A | Harness | 150 | 6,41 $ | 2 | 0 | ja |
| #1258 | B | Harness | 22 | 0,74 $⁵ | 0 | 0 | nein⁵ |
| #1213 | B | Harness | 32 | 1,69 $ | 1 | 0 | nein |
| #1254 | B | Doku | 51 | 2,55 $⁵ | 2 | 0 | nein |
| #1221 | B | Grafik | 108 | 4,59 $ | 1 | 0 | ja |
| #1217 | B | Sammelticket | 179 | 9,79 $ | 3⁶ | 2 | nein |
| #1284 | C | Harness | 192 | 6,77 $ | 3 | 0 | ja |
| #1270 | C | Harness | 188 | 7,83 $ | 3 | 0 | ja |
| #1293 | C | Harness | 172 | 7,89 $ | 2 | 0 | ja |
| #1139 | C | Sim | 328 | 14,81 $ | 2 | 1 | ja |
| #1276 | C | Harness | 364 | 17,11 $ | 5 | 0 | ja |
| #1303 | C | Harness | 206 | 9,81 $ | 2 | 0 | ja |

⁵ #1258 und #1254 liefen in Sessions mit mehreren Tickets, ab dem Claim geschnitten (`--from`). In der Session von #1258 lief die Planung für ein anderes Ticket (#1222), sie zählt hier nicht.
⁶ Drei Pässe sind 2 Fix-Runden und damit innerhalb der Obergrenze (Cap 2 = höchstens 2 Fix-Runden = höchstens 3 Pässe, AGENTS.md › Mehr-Perspektiven-Review).

**Befunde:**
- **Abweichung zu den Ticket-Bezugswerten:** das Ticket nennt aus Langfuse ca. 55k als ersten Call und 125k Median. Das sind Mischwerte über alle Agenten bzw. Calls; die Transkript-Messung trennt: erster Call des Hauptagenten 70,0k, Planer und Lens 56–57k, Median-Kontext des Hauptagenten vorher 159k. Beide Gruppen sind hier mit demselben Skript gemessen, nur diese sind untereinander vergleichbar.
- **#1065 wirkt.** Im Ticket-Fenster (Auswahl, Umsetzung, CI/Merge) läuft der Hauptagent in allen 11 Läufen danach zu 100 % auf Sonnet, vorher zu 0 % (außer in #1065 selbst, siehe ¹). Planer und Lenses bleiben auf Opus. Der Preis je Call sinkt von 0,066 $ auf 0,047 $ (−29 %), die Erwartung aus der Langfuse-Nachmessung (etwa ein Viertel) trifft zu. Der Planer lief vorher auf `claude-opus-5` und läuft jetzt auf `claude-opus-5-5` (Cache-Read 0,20 statt 0,50 $ je Mio); die Lenses liefen schon auf `claude-opus-5-5`. Der Modellwechsel des Planers erklärt darum nur einen kleinen Teil des Rückgangs.
- **#1198 wirkt beim Sockel, nicht beim Preis je Call.** Der Sockel fällt beim Hauptagenten von 71,1k auf 64,6k (−9 %), beim Planer von 57,2k auf 28,1k (−51 %, nur ein B-Lauf mit Planer), bei der Lens von 56,5k auf 51,1k (−10 %). Der Preis je Call bleibt bei 0,050 $ (A: 0,047 $), der Median-Kontext des Hauptagenten steigt sogar (123k → 134k): der Sockel bestimmt nur den Anfang einer Session, danach wächst der Kontext mit der Arbeit. Ob #1198 den Preis je Call senkt, lässt sich mit n = 5 nicht entscheiden.
- **Kosten je PR sind nicht vergleichbar.** Der Median fällt von 7,86 $ über 5,33 $ auf 2,55 $, aber die Gruppe B besteht zu drei Fünfteln aus kleinen Tickets (22 bis 51 Calls), die Gruppe „vorher" aus mittleren bis großen. Belastbar ist nur der Preis je Call. Mit n = 3, 6 und 5 und gemischten Ticketarten (Harness, Doku, Grafik, Sammelticket) trägt keine Zahl mehr als eine Tendenz.
- **Kostenverteilung** (über alle Läufe einer Gruppe summiert): Cache-Write 44–49 % und Cache-Read 41–46 %, Output 8–14 %, Input unter 1 %. Rund 90 % der Kosten hängen am Kontext, der bei jedem Call geschrieben bzw. gelesen wird. Wirksam sind Hebel, die Calls oder den Kontext je Call senken.
- **Loop-Kennzahlen sind nicht besser, in B teils schlechter.** Gemergt ohne Nacharbeit: 4 von 5 statt 3 von 3 bzw. 6 von 6. #1217 brauchte 2 CI-Fix-Runden und 3 Review-Runden. In #1258 gab es keine Review-Runde, in 4 von 5 B-Läufen keinen Planer. Ein Teil der Ersparnis in B stammt also aus übersprungenen Schritten und ist keine Einsparung im Sinne des Tickets.

### Grundkontext pro Session (#1198)

**Metrik:** Sockel = `input + cache_creation + cache_read` des ersten Assistant-Calls einer Session bzw. eines Subagenten. Er steht vor jeder Nutzereingabe im Kontext und wird bei jedem der 100–250 Calls neu gelesen.

**Befund:** Die 55k aus dem Ticket sind der Sockel der **Subagenten** (Planer 56–57k, Lens 54–57k). Der Hauptagent liegt in echten Sessions bei **ca. 70k** (Transkripte 02.–05.10.2026, stabil über 10 Sessions). Zum Vergleich: ein Agent mit nur 5 Tools und ohne Skill-/MCP-Listen liegt bei 28k, Explore (Haiku) bei 31k.

**Quellen des Hauptagenten** (Zeichen aus den Transkript-Attachments vor dem ersten Call; Tool-Schemas stehen nicht im Transkript und machen den Rest von ca. 40k Tokens aus):

| Quelle | Zeichen | Scope |
|---|--:|---|
| Skill-Listing (73 Skills) | 29,9k | Repo 3,9k, Rest User/claude.ai/Plugins/Claude Code |
| `AGENTS.md` | 27,0k | Repo (gegated, `check:contextsize`) |
| Namen der verzögerten Tools (261) | 8,8k | PixelLab 3,2k und Playwright rund 1,4k (beide Repo `.mcp.json`), Langfuse 2,8k, Chrome 0 (Stand vor `deny`: 0,8k; seit `deny` fehlen die Namen, siehe „Sockel von Lens und Explore“), übrige User |
| MCP-Instruktionen | 6,6k | User/claude.ai, PixelLab 1,0k |
| Systemprompt-Snapshot, Agent-Listing, SessionStart-Hook | 12,8k | Claude Code/User |

**Messung vorher/nachher** (`claude -p` im Projekt, Sonnet, gleicher Prompt; Headless liegt unter den interaktiven Werten, weil weniger Hooks und Tools laden, die Differenzen sind aber übertragbar):

| Variante (Einzeleffekte gegen „vorher“, sie überlappen sich) | Sockel |
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

**Grenzen:** Das Ziel „unter 40k" erreicht der **Planer** headless (27k); interaktiv liegt er bei 28,1k (1 Lauf, [Nachmessung](#nachmessung-nach-10651198-1206)). Der Hauptagent liegt headless bei 45,6k, interaktiv bei 64,6k (5 Läufe); weiter geht es nur im User-Scope (siehe unten) oder durch weniger `AGENTS.md`. Die Lens- und Explore-Agenten tragen eine `tools:`-Whitelist (gemessen: siehe „Sockel von Lens und Explore“); der Wächter erzwingt sie. **Playwright nur am Umsetzer (`mcpServers:` im Agent-Frontmatter) geprüft und verworfen (#1311):** Die Ersparnis wäre nur der Namen-Block der verzögerten Tools im Hauptchat: der Server liefert mit den Args aus `.mcp.json` (`--isolated --caps devtools`) **38** Tools (Messung: Handshake `initialize` + `tools/list` gegen den Launcher, 06.10.2026), mit Präfix `mcp__playwright__` und einem Zeilenumbruch je Name rund 1,4k Zeichen, also etwa 0,35k Tokens (rund 16 % der 8,8k Zeichen der Tabelle oben, unter 1 % des Sockels). Die 16 Namen der Umsetzer-Whitelist sind davon nur ein Teil und die falsche Messgröße. Dagegen: die Phasen-Agenten des Workflows (ohne `agentType`) und der Hauptchat brauchen den Browser für Verifikation und Pre-Flight, ein inline im Agent definierter Server liefe außerhalb des vertrauten `.mcp.json`-Pfads (Ordner-Vertrauen, `enabledMcpjsonServers`, der Launcher `scripts/playwright-mcp.mjs` und sein Wächter `test/harness/playwright-mcp.test.ts` hängen an `.mcp.json`), und zwei Definitionen desselben Servers drifteten. Playwright bleibt darum in `.mcp.json`. PixelLab bleibt ebenfalls in `.mcp.json`; ob es in einer Session lädt, entscheidet `enabledMcpjsonServers` in der lokalen `.claude/settings.local.json` der Maintainerin.

**Hinweise für den User-Scope** (nur die Maintainerin kann das ändern): persönliche Skills, die claude.ai-Skills doppeln, aus `~/.claude/skills` entfernen; Trello- und Langfuse-MCP nur in den Projekten aktivieren, die sie brauchen; `/mcp` bzw. `disabledMcpServers` für nicht benötigte Server; SessionStart-Hooks und den Chrome-Default prüfen; Server mit dauerhaftem Verbindungsfehler entfernen.

**Nachmessen:** frische Session starten, danach das Transkript unter `~/.claude/projects/<projekt>/<session>.jsonl` lesen: erster Assistant-Call mit `usage`, Summe aus `input_tokens`, `cache_creation_input_tokens`, `cache_read_input_tokens`; Subagenten liegen unter `<session>/subagents/`. Alternativ in Langfuse `usageDetails` der ersten Generation einer Session.

### Sockel von Lens und Explore (#1309)

Gemessen am 2026-10-06 aus den Subagenten-Transkripten, erster Call je Subagent (Skript: `~/.claude/projects/<projekt>/<session>/subagents/agent-*.jsonl` plus `*.meta.json`):

| Agent | Modell | n | Sockel (Median) | Spanne | vorher |
|---|---|--:|--:|---|--:|
| `kubernia-lens` (Whitelist) | `claude-opus-5-5` | 68 | **26,3k** | 25,8k–28,6k | 51,1k |
| `Explore` (Override, Whitelist, `omitClaudeMd`) | `claude-haiku-4-5` | 1 | **10,8k** | – | 31k (eingebauter Explore) |

- **Override belegt:** Die Agenten-Liste der Session zeigt für `Explore` Beschreibung und Tools aus [`explore.md`](../.claude/agents/explore.md) („… Ersetzt den eingebauten Explore.“, gesehen mit Claude Code 2.1.291), der gemessene Call lief auf Haiku und mit dem kleinen Sockel; die Doku sagt: ein Projekt-Subagent namens `Explore` überschreibt den eingebauten.
- **Chrome:** In der Planung gemessen (Session 129f8154): die Liste der verzögerten Tools (261 Namen) enthält keine `mcp__claude-in-chrome__*`-Namen, weil `deny` sie entfernt; der Systemprompt-Abschnitt „Claude in Chrome browser automation“ (4.107 Zeichen, rund 1k Tokens) bleibt im Hauptchat und lässt sich nur im User-Scope abschalten.

### Gesamtabgleich Transkript und Langfuse (#1309)

Lauf #1303 (Session `21b17653-783a-4c23-a284-a4e16c2fba79`, PR #1310; Hauptchat → Planer → Umsetzer → Lens R1/R2), gemessen am 2026-10-06. Langfuse per MCP-Metrik (`queryMetrics`, Session-Filter, GENERATIONs; die Keys für `--langfuse` standen nicht im Environment) gegen `node scripts/token-baseline.mjs --session … --issue 1303 --pr 1310` (Transkript):

| | Calls | Input+Cache gesamt | Output |
|---|--:|--:|--:|
| Opus 5.5, Transkript (alle Phasen inkl. Nachlauf) | 137 | 14.135.992 | 28.450 |
| Opus 5.5, Langfuse | 137 | 14.135.992 | 28.450 |
| Sonnet 5.5, Transkript | 84 | 13.658.333 | 4.190 |
| Sonnet 5.5, Langfuse | 84 | 13.658.333 | 4.190 |

Calls und Token-Summen stimmen exakt überein, auch für Planer, Umsetzer und beide Lens-Runden (kein Verlust bei der Kette Hauptchat → Umsetzer → Lens). Die Lücken bleiben die bekannten: fortgesetzte Subagenten (`SendMessage`, Befund #1311) schreibt der Hook nicht nach; dieser Lauf hatte keinen. Die Phasenzuordnung ist nicht Teil dieses Abgleichs (er lief per MCP-Metrik ohne Phasen). `token-baseline.mjs --langfuse` ordnet Phasen wie der Transkript-Modus zu: Subagenten über `metadata.agent_type` des umschließenden Subagent-Spans (`callsFromLangfuse` → `spanInfo` → `classifySubagent`), der Hauptagent über die GitHub-Zeitstempel (Report-Zeile: 2 Review-Runden (Nachweis), Planer ja).

### Projekt-Brain-Kennzahlen (#1205)

Messung für [ADR 0015](adr/0015-projekt-brain.md), Code in `scripts/brain-metrics.mjs`. Die Zeile `Projekt-Brain:` im Report des Skripts (Transkript und `--langfuse` nutzen dieselbe Logik; Ergebnisgrößen weichen je nach Serialisierung leicht ab, Abgleich siehe unten) enthält:

- **gelesen N× (S Seiten, ≈ T Tokens):** Lesezugriffe auf Brain-Seiten (`docs/**.md`) per `Read` oder Shell (`cat`, `sed`, `head`, `Get-Content` …, auch `git show <rev>:docs/x.md`, #1331); Tokens ≈ Zeichen des Ergebnisses / 4.
- **Suche:** `Grep`, `Glob` und Shell-Suche (`grep`, `rg`, `find`, `git grep`, `Select-String`); `grep … docs/x.md` zählt als Suche.
- **Recherche-Subagenten:** alle Tokens der Phase „Recherche“.
- **Calls bis erster Edit:** Tool-Calls im Ticket-Fenster vor dem ersten Edit/Write außerhalb von Temp/Scratchpad; `–` ohne Edit.
- **Brain-Pflege:** Schreibzugriffe per Edit/Write auf Brain-Seiten, dazu die Brain-Seiten im PR (aus `gh pr view`, +/− Zeilen). Shell-Schreibzugriffe (`sed -i`, Skripte) sieht das Tool-Zählen nicht, darum ist die PR-Zahl die verlässliche.

Grenzen: Tokens sind eine Größenordnung; Läufe in geteilten Sessions sind nur über `--from` getrennt. Die Pflegekosten selbst stehen als Phase „Pflege“ in der Tabelle; sie hängen an den Markern des Umsetzers.

**Baseline vor dem Pflegeschritt (#1099)**, Stand 2026-10-07, Transkript-Modus:

| Lauf | Brain gelesen (Zugriffe / Seiten / ≈Tok) | Suche (Calls / ≈Tok) | Recherche-Subagenten | Calls bis 1. Edit | Brain-Pflege (Schreibzugriffe / PR) | Review-Runden | CI-Fix |
|---|---|---|--:|--:|---|--:|--:|
| #1303 (PR #1310) | 17 / 8 / 17.821 | 81 / 84.776 | 0 | 77 | 1 / 5 Seiten (+58/−10) | 2 | 0 |
| #1308 (PR #1314, Session `3c41607a`) | 16 / 8 / 14.649 | 176 / 71.937 | 0 | 73 | 7 / 3 Seiten (+9/−6) | 9 | 0 |
| #1311 (PR #1317, Session `129f8154`) | 65 / 7 / 53.277 | 789 / 308.399 | 0 | 116 | 1 / 2 Seiten (+6/−4) | nicht vergleichbar (zwei PRs, 15 Pässe) | 0 |

Die Session je Zeile ist über die Claim-Zeile zugeordnet; #1308 und #1311 sind mit dem aktuellen Skript gemessen (`token-baseline.mjs --session <id> --issue <nr> --pr <pr>`, mit AST-Walker und `git show`-Zählung), #1303 mit dem Stand vor dem Walker (81 statt 82 Such-Calls, siehe unten). #1311 umfasst die ganze Session mit beiden PRs (obere Schranke).

Lesart: #1303 und #1308 liegen bei 16–17 Brain-Lesezugriffen und 81–176 Such-Calls; die Such-Tokens (72–85k) übersteigen die gelesenen Brain-Tokens (15–18k) um ein Mehrfaches, dort liegt die Ersparnis, die das Brain heben soll. #1311 ist die ganze Session mit zwei PRs und 15 Review-Pässen und liegt als obere Schranke weit darüber; #1308 hatte ungewöhnlich viele Review-Runden (Sonderfreigabe). Zählprobe #1303: 17 Lesezugriffe im Skript, gleich dem unabhängig per Muster gezählten Wert (17 `cat`/`sed`/`head` auf `docs/*.md`, 0 `Read`). Seit dem AST-Walker (`einfacheKommandos` in `scripts/bash-parser.mjs`) erkennt die Zählung auch Env-Präfixe (`LANG=C cat …`), Ersetzungen im Heredoc und in PowerShell `(Get-Content …)` samt Quotes; für #1303 ergibt das 17 Lesezugriffe, 82 Such-Calls und 85.379 Such-Tokens (Tabelle oben: Stand vor dem Walker). Grenzen: Wörter in Strings (`bash -c '…'`) bleiben Text, `sed -i` zählt als Lesen.

**Abgleich Transkript gegen Langfuse (#1322)**, Session `21b17653-783a-4c23-a284-a4e16c2fba79` (Lauf #1303, ganze Session inkl. Subagenten, kein Zeitfilter; ihre Events liegen zwischen 2026-10-06 13:35 und 14:19 UTC), gemessen am 2026-10-07 über die Langfuse-MCP-Tools (`queryMetrics` nach Tool-Name, `listObservations` mit `input`/`metadata`) gegen `readTranscriptSession`:

| Tool | tool_use im Transkript | TOOL-Observations in Langfuse |
|---|--:|--:|
| Bash | 138 | 138 |
| PowerShell | 24 | 24 |
| Read | 29 | 29 |
| Write | 10 | 10 |
| Agent / SubagentHandback | 7 / 7 | 7 / 7 |
| TaskStop / Monitor | 4 / 2 | 4 / 2 |
| Edit, Skill, SendMessage, ToolSearch | je 1 | je 1 |

Jede Zählung stimmt, 225 Events auf beiden Seiten. Stichprobe `Read`: Pfad und Zeitstempel (auf die Millisekunde) dreier Lesezugriffe außerhalb des Repos stimmen, `metadata.output_meta.orig_len` (9825, 9506, 6396) liegt bei der Transkript-Ergebnisgröße (9826, 9510, 6396) mit Abweichung höchstens 4 Zeichen. Nicht abgeglichen: die Shell-Eingaben (`Bash`/`PowerShell`, 162 Aufrufe) und die Brain-Zahlen aus der Langfuse-Seite als Ganzes; der HTTP-Pfad von `--langfuse` (`ladeLangfuseSession`: zwei Abrufstufen, die Namen der zweiten aus der ersten, weil der Hook Datei-Tools mit Bereichs-Qualifier benennt) ist über `fetchImpl`-Mock-Tests mit exakter `name`-Filterung gedeckt, ein Lauf mit echten Schlüsseln ist für Agenten nicht möglich (die Schlüssel stehen nicht in der Umgebung, sie aus der Plugin-Konfiguration zu lesen wäre Credential-Harvesting). Zum Nachholen durch die Maintainerin: `node scripts/token-baseline.mjs --session 21b17653-783a-4c23-a284-a4e16c2fba79 --langfuse` mit gesetzten `LANGFUSE_PUBLIC_KEY`/`LANGFUSE_SECRET_KEY` und die Zeile `Projekt-Brain:` gegen den Transkript-Lauf halten.

Abgleich der Pflege-Phase gegen Langfuse (#1342, gemessen am 2026-10-07; zwei abgeschlossene Umsetzer-Läufe, Transkript-Seite per `readTranscriptSession` + `pflegeIntervals`, Langfuse-Seite per `listObservations` mit Session-/Trace-Filter): **#1099** (Session `66ff572e-45f3-4c38-a2c8-b4140f190fd8`, Umsetzer `agent-af38c89736e7a46c2`, Trace `3d32bb15b71ee1bdb96bb5da824d20cf`): 2 Marker (08:11:51.586Z Start, 08:11:56.468Z Ende), 1 Intervall, `unpaired` 0, 1 Call und 3 Tool-Events im Intervall; Langfuse zeigt dieselben zwei `Tool: Bash`-Observationen auf die Millisekunde, dazu ein `Tool: Grep` (3 Tool-Events) und eine `Subagent LLM Call`-Generation im Intervall (1 Call), alle im Umsetzer-Trace. **#1331** (Session `efa67219-a462-4d45-a3e5-4e8b84e53b31`, Umsetzer `agent-ae0ab95a794a59417`, Trace `66ad4a52ddd204bd4406ad17e00e0c00`): 3 Marker (09:19:35.901Z, 09:19:40.073Z, 09:19:40.241Z; der erste liegt in einem kombinierten Befehl mit beiden Markern), 1 Intervall, `unpaired` 1 (der Start des kombinierten Befehls, der nicht zählt), 0 Calls und 2 Tool-Events im Intervall; Langfuse zeigt alle drei Marker-Observationen auf die Millisekunde, zwei Tool-Events und keine Generation im Intervall. Marker, Zeitstempel, Zuordnung zum Umsetzer und Zählung stimmen auf beiden Seiten überein. Die Marker gehören je in einen eigenen Befehl (Umsetzer-Definition); der Hook schreibt die Observationen eines laufenden Subagenten erst am Turn-Ende, abgleichbar sind darum nur abgeschlossene Läufe.

Guard „Read statt cat“ (ADR 0015 Option D): In den drei Baseline-Läufen stehen 46 Shell-Lesezugriffe auf `docs/` gegen 3 `Read` (neu gezählt am 2026-10-07 über die ganzen Sessions, je Lauf 17 / 15 / 14 Shell gegen 0 / 1 / 2 `Read`; bei den zwei geteilten Sessions eine obere Schranke; die Baseline-Tabelle oben zählt mit anderer Zuordnung 98 Lesezugriffe, 17 + 16 + 65, deren Aufteilung Shell gegen `Read` nicht neu gezählt ist); 43 der 46 Shell-Zugriffe kommen aus Subagenten (Umsetzer, Lenses), auch die drei `Read` stehen in Subagenten. Darum steht die Konvention in den Prompts von Umsetzer und Lenses (Agenten-Definitionen, Workflow-Prompts Umsetzen und Nachbessern); sinken die Shell-Zugriffe danach nicht, den Guard bewerten. Ein solcher Guard muss `git show <rev>:docs/…` zulassen: es ist die Ausnahme der Lese-Konvention, wenn der Hauptcheckout hinter `origin/main` liegt (Planer-Definition, Abschnitt „Stand prüfen“), und das Messskript zählt es als Shell-Lesezugriff.

### Nach einer Optimierung vergleichen

Das Skript für 1–3 neue Läufe fahren, die Zeilen unter die Tabelle der [Nachmessung](#nachmessung-nach-10651198-1206) hängen und die Veränderung von **Preis je Call**, **Sockel**, **Modell Umsetzung** und den Loop-Spalten im PR-Text benennen (Kosten je PR nur zwischen Tickets gleicher Art vergleichen). Eine Einsparung gilt nur, wenn die Loop-Spalten nicht schlechter werden (mehr CI-Fix-Runden oder Nacharbeit fressen den Gewinn).

### Planer-Laufzeit (#1349)

**Schnappschuss 2026-10-07, vor den Maßnahmen** (lokale Transkripte, 52 `kubernia-planner`-Läufe): Median 5,4 min (05.10., n=9), 10,4 min (06.10., n=18), 11,5 min (07.10., n=25), Max 22,4 min. Tool-Zeit nur 1 bis 3 min je Lauf, der Rest ist Modellzeit (Ø 37 Requests mal Ø 17 s auf Opus/xhigh, Kontext wächst auf 150 bis 250k). Auffällig: Ø rund 10 `git show origin/main:`-Zugriffe je Lauf (oft einzeln), Wechsel per `cd` in fremde Worktrees und nach `~/.claude/projects`/Plugin-Cache, Sammeltickets am längsten (13 bis 16 min).

**Maßnahmen (#1349):** der Skill `kubernia` hebt den Hauptcheckout vor dem Planer per `node scripts/haupt-sync.mjs` (der SessionStart-Hook tut es beim Sitzungsstart); der Planer holt abweichende Dateien einmal gebündelt (`git archive`), liest nicht in fremden Worktrees, `~/.claude/projects` und Plugin-Cache, liest Dateien über rund 300 Zeilen nie vollständig und gruppiert Sammelticket-Zeilen nach Datei (Definition: `.claude/agents/kubernia-planner.md`).

**Nachmessung:** die Definitionen greifen erst in neuen Sessions. Beim nächsten Status-Lauf (Checkliste Punkt 3) den Median der Planer-Laufzeit je Tag wie im Schnappschuss messen und hier als datierte Zeile ergänzen; Ziel: Median unter dem Wert vom 06.10. (10,4 min), Sammeltickets unter 13 min. Verfehlt der Lauf das Ziel, ist das eine Zeile im Sammelticket „Langfuse-Befunde (gesammelt)“.

### Langfuse-Status überprüfen (#1293)

Die regelmäßige, breite Auswertung der Langfuse-Daten (Tag `kubernia`) läuft als eigenes wiederkehrendes Ticket „Langfuse-Status überprüfen" (`area:harness`); der Takt ist wöchentlich (Workflow `board-takt.yml`, [ADR 0016](adr/0016-langfuse-takt-woechentlich.md)), Mechanik und Sammelticket „Langfuse-Befunde (gesammelt)": [ticket-reihenfolge.md](ticket-reihenfolge.md#wiederkehrendes-ticket-langfuse-status-überprüfen-1293). Dies ist die **einzige** Checkliste; jeder Punkt hat eine feste Quelle, kein freies Stöbern. Zeitraum: seit dem letzten Status-Lauf. Läufe des Zeitraums sind die darin gemergten PRs (`gh pr list --state merged --limit 1000 --search "merged:<Start>..<Ende>"`); die Session je Lauf steht in der Claim-Zeile `gh issue edit <nr> --add-assignee` in den Haupttranskripten unter `~/.claude/projects/` des Hauptrepos (nur Dateien mit Änderungszeit ab Start), gegengeprüft per PR-URL. Das gilt nur im Status-Lauf; für Planer und Lens gilt die Regel in ihren Agenten-Definitionen, bis #1266 Tickets an Traces hängt.

1. **Datenvollständigkeit:** Für 1–2 Sessions des Zeitraums Calls und die vier Token-Summen aus Transkript (`node scripts/token-baseline.mjs --session <id>`) und Langfuse (`--langfuse`) vergleichen ([Messen](#messen), Messregel zum verzögerten letzten Call beachten). Sind Haupt-Agent, Subagenten (auch verschachtelte), Workflow-Agenten da, tragen die Traces Tag `kubernia` und das Metadatum `project`? Per `queryMetrics` Usage und Kosten je Modell: Usage ohne Kosten heißt, Langfuse hat keinen Preis; fehlt ein neues Modell in `PRICES` des Skripts? Bekannte Lücken verlinken statt neu melden (#1266 Kosten je Ticket).
2. **Funktioniert alles?** `claude mcp list` zeigt `langfuse` verbunden (der Name ist Vertrag, siehe [Langfuse-Anbindung](#langfuse-hook-patch-pflegen-10841122)), Hook-Patch intakt (Prüfregel unter [Hook-Patch pflegen](langfuse-hook-patch.md#prüfregel)), Tool-Fehler nach Art (Zeile `Tool-Fehler:` der Skript-Reports der Läufe aus Punkt 3; `ERROR` allein ist kein Signal, der Hook setzt es bei jedem Exit ≠ 0, harmlose Exit-Codes und Guard-Blockaden stehen darin neben echten Fehlern), Traces ohne Abschluss (abgebrochen).
3. **Tokenfresser:** die teuersten Läufe, Phasen und Subagenten des Zeitraums, die Planer-Laufzeit (Median je Tag aus den Transkripten der `kubernia-planner`-Läufe, `node scripts/token-baseline.mjs`; Schnappschuss und Ziel unter [Planer-Laufzeit](#planer-laufzeit-1349)), mehrfach gelesene große Dateien (Zeile `Lesen:` der Skript-Reports: Wiederlesen voll, gezielt und abschnittsweise Lesen sind getrennt; Tool-Fehler `zu groß` zählt vergebliche Reads), der Sockel je Agent ([Grundkontext](#grundkontext-pro-session-1198)).
4. **Wiederkehrende Fehlschläge:** CI-Fix- und Review-Runden je Ticket, Zahl der `status:festgefahren`-Fälle, immer gleiche Tool-Fehler (Zeile `Tool-Fehler:`, nach Art getrennt: Hook, Guard, Permission, zu groß), Permission-Blockaden.
5. **Wirkung:** die seit dem letzten Lauf gemergten Harness-PRs gegen die [Baseline](#baseline-stand-2026-09-29-alle-vier-läufe-vor-10651067) bzw. die [Nachmessung](#nachmessung-nach-10651198-1206), mit Preis je Call, Sockel, Review- und CI-Fix-Runden, dazu die Zeile `Projekt-Brain:` gegen die [Projekt-Brain-Baseline](#projekt-brain-kennzahlen-1205) (Recherche-Last und Calls bis zum ersten Edit sinken, Loop-Kennzahlen nicht schlechter) und die Pflegekosten (Phase „Pflege“) gegen die Ersparnis. Läufe mit der Report-Warnzeile „Kein Pflege-Marker“ fallen aus dieser Bewertung; Ursache prüfen: lief der Lauf mit einem veralteten Haupt-Checkout (`git reflog main` gegen die Laufzeit, die Marker-Regel fehlt dann im Umsetzer-Prompt)?
6. **Code-Qualität/Prozess:** was die Läufe über Ticket-Schnitt (`KQ-Diffsize-Override`, zu breite PRs), Nacharbeit, Modellwahl und Rückfragen an die Maintainerin sagen.
7. **Wochenbudget:** Kosten und Tokens der letzten vollen Kalenderwoche (Mo–So UTC, das Datum nennt der Body des Status-Tickets) gegen die Woche davor. Quelle: `queryMetrics`, View `observations`, Dimensionen `providedModelName` und `name`, Metriken `totalTokens` und `totalCost` (jeweils `sum`), Filter `type = GENERATION` und `tags` any of `kubernia`, **der Tag-Filter nur für Zeiträume ab 2026-10-05**: davor hing der Tag nicht durchgängig an den Generations, und der Filter erzeugt ein Messartefakt (Rohwerte W1 aus #1304: rund 6 $ mit Filter gegen 229,89 $ ohne). Für ältere Wochen ohne Filter abfragen und das im Bericht vermerken. Rolle zuerst aus dem Namen, dann aus dem Modell: „LLM Call" ist der Hauptchat (egal welches Modell, er ist nicht gepinnt); „Subagent LLM Call" mit Opus sind Planer, Lenses und Forks, mit Sonnet der Umsetzer, mit Haiku Explore. Die Kosten sind der API-Preis-Äquivalent aus Langfuse (kein Abo-Verbrauch); Usage ohne Kosten ist ein Befund unter Punkt 1. Ergebnis: eine Zeile je Rolle mit Trend gegen die Vorwoche, die Summe in die Verdichtungstabelle. **Datenbasis vor dem Vergleich prüfen:** beide Wochen müssen voll mit `kubernia` getaggt sein (der Tag hängt durchgängig erst ab 2026-10-05 an den Generations, die erste Observation stammt vom 2026-09-28). Sonst steht `Δ –` mit dem Grund in „Woche (Δ Vorwoche)“; nie gegen ungefilterte Summen aller Projekte vergleichen und nie den Filter lockern, um eine Zahl zu bekommen. Erster vergleichbarer Lauf: Woche 2026-10-12 bis 10-18. Fehlt das Metadatum `project` (Punkt 1), auf #1266 verweisen. **Namensvarianten:** vor 2026-10-06 tragen Namen einen Zähler (`LLM Call 7`, `Subagent LLM Call 3`) und es gibt neben `claude-opus-5-5` den Modellnamen `claude-opus-5`; beides gehört zur selben Rolle. Darum je Rolle den Filter `name` `starts with` (`LLM Call` trifft `Subagent LLM Call` nicht, `Subagent LLM Call` trifft die Zähler-Varianten) und das Modell nach Familie (`opus`/`sonnet`/`haiku` im `providedModelName`) zusammenfassen.
8. **Kosten gegen Nutzen je Gate, Lens und Regel:** Was kostet eine Lens-Runde (Subagent-Calls der Review-Phase aus Punkt 7 bzw. den Subagenten-Spans), und wie oft fand Runde 1 einen echten Blocker (Anteil der PRs mit `KQ-Review: … runden≥2` im Zeitraum, aus `git log`)? Für Gates: rote Checks je Name; für Hooks: Tool-Fehler nach Art (Punkt 2; `ERROR` je Tool allein trägt kein Signal). **Lockern-Kandidat** ist, was in drei Status-Läufen in Folge Kosten verursacht und nichts findet: als Zeile ins Sammelticket „Langfuse-Befunde (gesammelt)"; umgesetzt wird es nur per reviewtem PR mit Messung vorher und nachher, nie um ein Rot zu verstecken.

Einzelläufe stehen nur im Bericht-Kommentar des Status-Tickets; hierher kommt je Lauf **eine** Verdichtungszeile:

| Zeitraum | Läufe | Median Kosten/Ticket | Preis je Call | Sockel | Review-Runden | CI-Fix-Runden | ohne Nacharbeit | Woche (Δ Vorwoche) | Datenvollständigkeit |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| #1278-Merge bis #1276-Claim (2026-10-06) | 8 | 7,65 $ | 0,061 $ | Hauptchat 64,7k (je Lauf: [Nachtrag](https://github.com/fluffels/kubernia/issues/1276#issuecomment-6019725674)) | 1,5 | 0 | 8/8 | – | Transkript-Modus, Langfuse nicht je Lauf abgeglichen; Einzelläufe: [Bericht](https://github.com/fluffels/kubernia/issues/1276#issuecomment-6016995875) |
| #1293-Merge bis #1304-Claim (2026-10-06/07) | 21 (22 PRs) | 8,98 $ | 0,058 $ | Hauptchat 64,4k | 2 | 0 (Σ 2) | 19/21 | W1 229,89 $ ohne Tag-Filter (Tag erst ab 2026-10-05 durchgängig, Δ nicht berechenbar: W0 ohne Daten) | Langfuse 17 von 21 Läufen +0 bis +13 % über dem Transkript, 3 Lücken (#1334 nur 8 %, [#1378](https://github.com/fluffels/kubernia/issues/1378)), #1309 nicht gefunden; Einzelläufe: [Bericht](https://github.com/fluffels/kubernia/issues/1304#issuecomment-6036914549) |

⚠️ **Langfuse nicht erreichbar** (Keys fehlen, Server aus) ist selbst ein Befund unter Punkt 1. Die übrigen Punkte laufen dann im Transkript-Modus des Skripts, das Status-Ticket wird trotzdem abgeschlossen (den Nachfolger legt der Workflow an).

### Langfuse-Erfassung belegen (#1293)

**Wann:** Ein Diff fügt einen Agenten oder Subagenten hinzu, ändert dessen `tools`/`model`, den Spawn-Weg oder die Verschachtelung, ändert `.mcp.json`, `hooks`/`env`/`enabledPlugins` in `.claude/settings.json` oder hebt ein Plugin. Reiner Prompt-Text eines Agenten ist ausgenommen. Bei einem Plugin-Update gilt zusätzlich die Liste unter [Hook-Patch pflegen](langfuse-hook-patch.md#nach-einem-plugin-update), nicht doppelt führen.

**Wie:** Einen Probe-Lauf im Worktree fahren (`claude -p --allowedTools "Agent,SendMessage" "<kleiner Auftrag, der den geänderten Agenten bzw. das Tool benutzt>"`, nicht im Bypass-Modus; Aufruf und Warten auf das Ergebnis: [FAQ](agent-harness-faq.md#wie-fahre-ich-einen-probe-lauf-und-warte-auf-sein-ergebnis)). Danach in Langfuse (Langfuse-MCP oder `node scripts/token-baseline.mjs --session <id> --langfuse`, verglichen mit dem Transkript-Modus) prüfen: Trace mit Tag `kubernia` da, Observation des neuen Agenten bzw. Tools da, `usageDetails` gesetzt. Der letzte Call eines Turns kann bis zum nächsten Hook-Lauf fehlen (siehe [Hook-Mechanik](langfuse-hook-patch.md#hook-mechanik-und-messregel)); ein Probe-Lauf mit Resume per `SendMessage` zusätzlich nach dem Stop (nicht nur am Ende) prüfen, weil der Flush von `SessionEnd` einen hängenden Turn nachliefert. Session-ID und Ergebnis kommen in die PR-Beschreibung.

Bewacht von [`test/harness/langfuse-erfassung.test.ts`](../test/harness/langfuse-erfassung.test.ts): Regel, Checkliste, Ticket-Mechanik und die Konfiguration, die die Erfassung trägt (Plugin aktiv, Tag `kubernia`, Hooks nicht abgeschaltet).

**Fallback:** Ist ein Probe-Lauf nicht möglich (z.B. Agent-Verschachtelung nur interaktiv), das im PR begründen und eine Zeile als Kommentar ins offene Status-Ticket (sonst ins Sammelticket „Langfuse-Befunde (gesammelt)") schreiben; dessen Datenvollständigkeits-Punkt prüft es dann nach.

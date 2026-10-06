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
| Pre-Flight | `sonnet` | `medium` | `agent()`-Optionen | Hauptagent (Session-Modell, fragt per `AskUserQuestion`) |
| Umsetzung | `sonnet` | `medium` | `agent()`-Optionen | Subagent [`kubernia-umsetzer`](../.claude/agents/kubernia-umsetzer.md) (Frontmatter, unabhängig vom Session-Modell) |
| **Review (1–3 Lenses, [Staffel](#review-staffel-1265))** | `opus` | `high` | `agentType: 'kubernia-lens'` + `effort` | Subagenten `kubernia-lens`, vom Umsetzer über `review-lenses` gespawnt (Frontmatter, `high` wirkt) |
| Nachbessern, CI-Fix | `sonnet` | `medium` | `agent()`-Optionen | im Umsetzer |
| PR + Merge, Festgefahren, Cleanup | `sonnet` | `medium` | `agent()`-Optionen | im Umsetzer |
| Explore / Recherche | `haiku` | `low` | n/a | Agent `Explore` (Projekt-Override des eingebauten Explore, Frontmatter); `low` ist deklariert, wirkt aber nicht: Haiku unterstützt laut Claude-Code-Doku keinen Effort (§2) |

**Warum so:** Fehler in Planung und Review sind teuer (schlechte Architektur kostet viele Sessions), dort lohnt das stärkste Modell mit hohem Reasoning (#741, #745). Auch der Schnitt eines Epics in Kindertickets ist Planung (#1207): ein schlechter Schnitt kostet viele Sessions, das Anlegen per `gh` ist dagegen Tipparbeit. Tippen nach fertigem Plan ist Sonnet-Arbeit, `medium` lässt genug Reasoning für die CI-Fix-Schleife. Explore liest und sucht nur, Haiku genügt.

### Review-Staffel (#1265)

Der Review war nach #1065 der größte Kostenblock je Ticket (38–40 %, bei kleinen Doku-Tickets 55 % und mehr), unabhängig von der Diffgröße. Etwa 80–85 % einer Lens sind Cache-Write des festen Sockels; parallel gestartete Lenses teilen keinen Cache. Gespart wird darum an der **Zahl** der Lenses. Die Maintainerin hat die Abwägung an den Agenten übergeben; entschieden ist:

1. **Staffel nach Diff-Art, nicht nach Größe.** Ein reiner `*.md`-Diff (auch Harness-Markdown wie `AGENTS.md` oder Skills) bekommt **eine Doku-Lens** (Requirement-Treue, SSOT/Drift, Wächter-Kopplung, oberste Regel); jeder andere Diff alle drei Brillen. Begründung: ohne Code hat die Test-Lens nichts zu sabotieren, die Architektur-Fragen einer Doku (Regel doppelt? Wächter mitgezogen?) übernimmt die Doku-Lens. Die teuren Doku-Tickets waren Harness-Doku; ohne sie bliebe kaum Ersparnis. Keine Größenschwelle für Code: auch ein kleiner `src`-Diff kann das Save-Format brechen. Die Zuordnung der ersten Runde ist eine Tabelle (`LENS_SAETZE` im Workflow), eine weitere Diff-Art ist dort eine Zeile; die Delta-Regel ab Runde 2 muss dann mitgedacht werden.
2. **Ab Runde 2 nur die blockierten Brillen auf dem Delta** des Fixes, mit ihren Vorrunden-Blockern als Prüfliste. Ändert der Fix Nicht-Markdown, läuft **Test-Adäquanz immer mit**: ein Code-Fix ohne passenden Test ist der wahrscheinlichste neue Fehler, und `check:diffcoverage` gatet die Präsentation nicht. Ein Delta allein spart je Lens nur 20–30 %; erst das Weglassen ganzer Lenses spart den Sockel.
3. **Patch einmal lesen** (Prompt-Regel in der Kontext-Diät, im Skill und in `kubernia-lens`): einmal vollständig, danach gezielt. Kein Patch-Text im Prompt: die Workflow-Sandbox kann keine Dateien lesen, und der Hauptagent müsste den Patch sonst selbst lesen.
4. **Sonnet für einzelne Lenses: zurückgestellt.** Kein Messbeleg, und gerade die Test-Lens fand den einzigen harten Blocker (#1034). Wiedervorlage erst mit einer Lens-Nutzen-Metrik (#1123) und einer Gegenprobe Opus gegen Sonnet auf denselben Patches (n ≥ 5, darunter `src`-Tickets). Aus demselben Grund bleibt der Lens-Effort `high`.

**Fail-closed:** Fehlt die Dateiliste, gab es keinen Vorrunden-Pass (`verify` rot), fiel eine Lens aus, wechselte die Diff-Art oder fehlt das Delta (der Nachbesserer lässt es nach Merge/Rebase von `main` leer; vergisst er das, enthält das Delta die `main`-Änderungen, also mehr Review, nicht weniger), läuft der volle Satz auf dem vollen Patch. Implementiert als `lensPlan` in [`.claude/workflows/kubernia-ticket.js`](../.claude/workflows/kubernia-ticket.js), auf dem Skill-Pfad als Regel in [`review-lenses`](../.claude/skills/review-lenses/SKILL.md); bewacht von [`test/harness/review-staffel.test.ts`](../test/harness/review-staffel.test.ts). Die Nachmessung muss Lenses je Ticket und Kosten je Lens getrennt ausweisen, weil #1209 parallel den Sockel je Lens senkt.

**Ehrlich zum Skill-Pfad:** Im Hauptagenten bleiben nur Auswahl, Claim, Pre-Flight (mit Rückfrage), Epic-Kinder und Dependabot, auf dem Session-Modell, das die Maintainerin wählt (`.claude/settings.json` pinnt bewusst keins), im Normalfall also Opus. Bewusst in Kauf genommen: Auswahl und Pre-Flight sind kurz und profitieren vom Abwägen, Epic-Kinder und Dependabot sind selten; wer dort sparen will, stellt vorher `/model sonnet`. Alles Teure von der Umsetzung bis zum Cleanup läuft im Subagenten `kubernia-umsetzer` mit `sonnet`/`medium` aus seinem Frontmatter, egal auf welchem Modell die Session steht.

## 2. Wie das Routing in Claude Code wirkt

- **Aliase gibt es.** `opus`, `sonnet`, `haiku` (dazu `opusplan`, `best`, `fable`) lösen auf das neueste Modell der Stufe auf. Es gibt keinen Modus, der nach kubernia-Phasen wechselt. `opusplan` wechselt nur zwischen dem Claude-Code-Plan-Modus (opus) und der Ausführung (sonnet) und passt nicht zum Ticket-Ablauf.
- **Subagenten:** `model:` im Agent-Frontmatter bzw. an `Agent({…})`/`agent({…})` greift nachweislich. Ohne Angabe erbt ein Subagent das Session-Modell.
- **Das Agent-Tool hat keinen `effort`-Parameter.** Sein Schema kennt `description`, `isolation`, `model`, `prompt`, `subagent_type`, `run_in_background`. `effort` greift nur im Agent-/Skill-Frontmatter (Skill-Frontmatter nur bei `/slash`, siehe nächster Punkt) und als Option von `agent()` in Workflow-Skripten. Darum sind `effort`-Angaben an `Agent({…})`-Spawns wirkungslos und stehen dort nicht: der Effort steht im Frontmatter des Repo-Agenten. Lenses laufen auf beiden Pfaden über [`kubernia-lens`](../.claude/agents/kubernia-lens.md) (`opus`, `high`); der Spawn setzt kein `model:`, weil es das Frontmatter überstimmte. Explore ist ein Projekt-Agent mit exakt `name: Explore` ([`explore.md`](../.claude/agents/explore.md)) und ersetzt laut Claude-Code-Doku den eingebauten (Projekt-Agent vor Built-in; `omitClaudeMd: true` lässt ihm die Kontextdateien weg, wie dem eingebauten); die Wirkung zur Laufzeit ist per Modell im Transkript bzw. Langfuse nachzuprüfen; Haiku kennt keinen Effort, `low` wirkt erst, wenn der Alias `haiku` auf ein Modell mit Effort zeigt. Der Umsetzer wird ebenfalls ohne `model:` gespawnt, Modell und Effort stehen in [`kubernia-umsetzer`](../.claude/agents/kubernia-umsetzer.md).
- **Grenzen von Subagenten** ([Claude-Code-Doku › Subagents](https://code.claude.com/docs/en/sub-agents), Stand 2026-10-06): `AskUserQuestion` ist in Subagenten immer entfernt; der Umsetzer meldet `entscheidung-noetig`, der Hauptagent fragt und setzt ihn per `SendMessage` mit vollem Kontext fort. Subagenten dürfen bis drei Ebenen tief selbst spawnen (`CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH`); Hauptagent → Umsetzer → Lens braucht zwei. Eine `tools:`-Whitelist ohne `mcp__`-Einträge nimmt alle MCP-Tools; darum führt der Umsetzer die Playwright-MCP-Tools (Browser-Prüfung) und die Langfuse-Lesetools (Sammelticket-Blick) einzeln auf, PixelLab bleibt im Hauptagenten. Verschachtelte Subagenten (Umsetzer → Lens) legt Claude Code flach in `<session>/subagents/` ab, mit `parentAgentId` und `spawnDepth` in der `meta.json`: das Messskript erfasst sie im Transkript-Modus, Langfuse nur mit dem lokalen Hook-Patch (§5, #1291). Subagenten schreiben den Prompt-Cache mit 5 Minuten TTL statt einer Stunde; ob lange CI-Wartezeiten im Umsetzer dadurch teure Cache-Neuaufbauten auslösen, zeigt erst die Messung (§5), `experimental.cacheTtl` ist bewusst nicht gesetzt.
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
- **Langfuse-Hook-Patch (#1084).** Ursache der Lücke ist ein Bug im Hook des Plugins `langfuse-observability`: Folgearbeit nach Hintergrund-Subagenten und als `queued_command` angehängte Meldungen gehen verloren. Mit lokalem Patch an drei Ticket-Läufen vom 30.09./01.10.2026 verifiziert (Plugin 1.0.0, je ganze Session inkl. Subagenten, ohne `--issue`/`--from`): Calls (122/122, 141/141, 152/152) und alle vier Token-Summen (Input, Cache-Write, Cache-Read, Output) stimmen zwischen Transkript und Langfuse-`GENERATION`s exakt überein. ⚠️ Gilt nur für gepatchte Installationen; Pflege und Stand: [Langfuse-Hook-Patch pflegen](#langfuse-hook-patch-pflegen-10841122).
- **Phasen** ohne Marker im Lauf: Subagenten nach `agentType`, Workflow-Label (`umsetzen:`, `ci-fix` …) bzw. Beschreibung (Planer → Planung, Lens/Kritiker → Review, Explore → Recherche); `kubernia-umsetzer` bewusst ohne feste Phase, weil er Umsetzung und CI/Merge abdeckt, er läuft über den Zeitschnitt. Der Hauptagent und nicht zuordenbare Subagenten über GitHub-Zeitstempel — vor dem Claim **Auswahl**, bis zum PR **Umsetzung**, bis zum Merge **CI/Merge**, danach **Nachlauf** (wird gezeigt, zählt nicht zum Ticket).
- **Kosten** kommen in beiden Modi aus der Preistabelle `PRICES` im Skript (Quelle und Stand dort), nicht aus Langfuse: Langfuse rechnet nur bei der Ingestion, ein später angelegter Preis gilt nicht rückwirkend. Cache-Writes werden nach 5m- und 1h-TTL getrennt bepreist. Ein Modell ohne Eintrag ist „ohne Preis" (Hinweis im Report), nie 0 $; ein neues Modell gehört in `PRICES`. Der Report nennt den Stand der Tabelle (`PRICES_STAND`). Eine Preisänderung kommt als neue **Periode** (`validFrom`) an den Eintrag, nicht als Überschreiben: alte Transkripte behalten so den Preis ihres Zeitpunkts. Der Hauptagent schreibt den Cache mit 1h-TTL, Subagenten mit 5m, darum liest das Skript `cache_creation.ephemeral_1h_input_tokens`. Auch mit `--langfuse` kommen die Kosten aus `PRICES` (eine Preisquelle, beide Modi vergleichbar; Langfuse-`totalCost` wird nicht genutzt). Die Cache-Writes liest das Skript aus `input_cache_creation_5m`/`input_cache_creation_1h` der Observation, bei älteren Aufzeichnungen aus `cache_creation_input_tokens` (zählt als 5m).
- **Zusatzzeilen im Report:** Sockel (erster Call des Hauptagenten, unabhängig von `--from`; Median der Planer bzw. Lenses nur im Ticket-Fenster), Median-Kontext und Kostenanteile (Input / Cache-Write / Cache-Read / Output). Läuft ein Ticket in einer Session mit Arbeit an einem anderen Ticket, immer `--from <Claim>` setzen, sonst zählt der Planer des anderen Tickets mit.
- **Loop-Kennzahlen:** Review-Runden (höchster Runden-Marker `lens:<brille>:r<n>` bzw. `… R<n>`; ältere Läufe ohne Marker per Heuristik 3 Lenses = 1 Runde; jeder weitere Kritiker +1), CI-Fix-Runden (distinct `head_sha` mit rotem CI, dieselbe Zählung wie #904), Rückfragen (`AskUserQuestion`), gemergt ohne Nacharbeit (Merge und 0 rote Pushes).

### Langfuse-Hook-Patch pflegen (#1084/#1122)

Der Patch bleibt **bewusst lokal** im Plugin-Cache (`~/.claude/plugins/cache/langfuse-observability/…/hooks/langfuse_hook.py`, User-Scope, wirkt damit für alle Projekte), nicht im Repo versioniert und nicht upstream gemeldet (Maintainerin-Entscheidung). Jedes Plugin-Update überschreibt ihn.

- **Prüfregel (gilt dauerhaft):** `grep -c "LOCAL PATCH" langfuse_hook.py` → `4`. Neben der Datei liegt das unveränderte Original als `langfuse_hook.py.orig`.
- **Stand (seit #1122):** Plugin 1.2.0 (upstream `main` `8870487`), Patch portiert. Die beiden Bugfixes aus #1084 sind inhaltlich gleich wie unter 1.0.0, nur übernimmt die umgewandelte Meldung zusätzlich `sessionId`/`uuid`, damit der neue Fork-Filter (`is_row_from_another_session`) greift. Upstream hat beide Bugs auch dort noch. Per Probe-Session belegt: Tool-Fehler als `ERROR`, `project`-Metadatum, Tags. Zählvergleich unter 1.2.0 (#1187, Session `14dfbfb5-1f2f-439a-8f23-f2135cfa563a` mit Ticket-Lauf #1181 vom 05.10.2026, Planer und drei Lenses): gemessen ab Session-Start bis zum Ende des #1181-Turns, weil die Session danach noch weiterlief. Ergebnis: 57/57 Calls (Hauptagent 41, Subagenten 16), Input 124, Cache-Write 404 901, Cache-Read 5 066 237, Output 23 324, auf beiden Seiten identisch. Direkt nach dem Turn standen in Langfuse erst 56 Calls; der letzte kam beim nächsten Stop nach (siehe Log-Meldung).
- **Patch-Teil verschachtelte Subagenten (#1291):** Upstream verarbeitet die Züge eines Subagenten ohne Launch-Zuordnung; Subagenten, die ein Subagent startet (die Lenses unter `kubernia-umsetzer`), kämen nie in Langfuse an. Der Patch (`find_child_subagents`, Rekursion in `emit_subagent_observations` mit Zyklusschutz) sendet sie als Kind-Spans unter ihrem Eltern-Subagenten, gefunden über `parentAgentId`. Belegt mit vier Plugin-Unit-Tests in `tests/unit/test_nested_subagents.py` neben dem Patch (Kind und Enkel als Kind-Spans, Geschwister mit fremdem Elternteil bleibt draußen, Agent-ID aus dem Dateinamen, Zyklus, kaputte `meta.json`), gleichen Ergebnissen der übrigen Plugin-Tests mit und ohne Patch, und einer Probe am 06.10.2026 (Session `cbc89d16-2923-4f96-840f-d6619707a08e`): der Ebene-2-Subagent steht in Langfuse als Kind seines Eltern-Subagenten, 1 Call, Tokens identisch mit dem Transkript (Mini-Probe, kein Gesamtabgleich wie bei #1187). Upstream hält das nicht-rekursive Verhalten in `test_nested_subagents_document_current_non_recursive_emission_behavior` fest; sein Fixture trägt kein `parentAgentId`, der Test bleibt mit Patch grün. Nach einem Plugin-Update prüfen, ob Upstream Verschachtelung inzwischen selbst sendet (dann doppelt). ⚠️ **Lücke:** Ein per `SendMessage` fortgesetzter Subagent (beim Umsetzer nach `entscheidung-noetig`) schreibt in dasselbe Transkript weiter, der Hook sendet einen Subagenten aber nur einmal beim ersten Abschluss: alles nach der Fortsetzung fehlt in Langfuse, der Transkript-Modus des Messskripts erfasst es. Für solche Läufe den Transkript-Modus nehmen.
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
| Namen der verzögerten Tools (261) | 8,8k | PixelLab 3,2k (Repo `.mcp.json`), Langfuse 2,8k, Chrome 0,8k, übrige User |
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

**Grenzen:** Das Ziel „unter 40k" erreicht der **Planer** headless (27k); interaktiv liegt er bei 28,1k (1 Lauf, [Nachmessung](#nachmessung-nach-10651198-1206)). Der Hauptagent liegt headless bei 45,6k, interaktiv bei 64,6k (5 Läufe); weiter geht es nur im User-Scope (siehe unten) oder durch weniger `AGENTS.md`. Die Lens- und Explore-Agenten tragen eine `tools:`-Whitelist (Sockel nicht nachgemessen); der Wächter erzwingt sie. PixelLab bleibt in `.mcp.json`; ob es in einer Session lädt, entscheidet `enabledMcpjsonServers` in der lokalen `.claude/settings.local.json` der Maintainerin.

**Hinweise für den User-Scope** (nur die Maintainerin kann das ändern): persönliche Skills, die claude.ai-Skills doppeln, aus `~/.claude/skills` entfernen; Trello- und Langfuse-MCP nur in den Projekten aktivieren, die sie brauchen; `/mcp` bzw. `disabledMcpServers` für nicht benötigte Server; SessionStart-Hooks und den Chrome-Default prüfen; Server mit dauerhaftem Verbindungsfehler entfernen.

**Nachmessen:** frische Session starten, danach das Transkript unter `~/.claude/projects/<projekt>/<session>.jsonl` lesen: erster Assistant-Call mit `usage`, Summe aus `input_tokens`, `cache_creation_input_tokens`, `cache_read_input_tokens`; Subagenten liegen unter `<session>/subagents/`. Alternativ in Langfuse `usageDetails` der ersten Generation einer Session.

### Nach einer Optimierung vergleichen

Das Skript für 1–3 neue Läufe fahren, die Zeilen unter die Tabelle der [Nachmessung](#nachmessung-nach-10651198-1206) hängen und die Veränderung von **Preis je Call**, **Sockel**, **Modell Umsetzung** und den Loop-Spalten im PR-Text benennen (Kosten je PR nur zwischen Tickets gleicher Art vergleichen). Eine Einsparung gilt nur, wenn die Loop-Spalten nicht schlechter werden (mehr CI-Fix-Runden oder Nacharbeit fressen den Gewinn).

### Langfuse-Blick beim Sammelticket (#1199)

Kommt das Sammelticket „Harness-Härtung (gesammelt)" dran ([Mechanik](ticket-reihenfolge.md#sammelticket-harness-härtung-gesammelt-1199)), steht **vor** dem Abarbeiten ein fester, kurzer Blick in Langfuse auf die Läufe seit dem letzten Sammelticket (Tag `kubernia`). Genau drei Fragen, kein freies Stöbern:

1. **Wirkung:** Tokens und Kosten pro Ticket gegen die [Baseline](#baseline-stand-2026-09-29-alle-vier-läufe-vor-10651067) — haben die seitdem gemergten Harness-Änderungen gewirkt? Je Lauf eine Zeile unter die Tabelle (Skript oben, `--langfuse`).
2. **Tokenfresser:** der teuerste Lauf des Zeitraums und woran es lag (Phase, Subagent, wiederholtes Lesen großer Dateien).
3. **Prozess:** Läufe mit auffällig vielen CI-Fix- oder Review-Runden bzw. Nacharbeit.

Jeder Befund wird eine Zeile im Sammelticket; ein eigenes Issue nur bei einem Notfall (AGENTS.md § Harness-Befunde sind Zeilen, keine Tickets). Ohne erreichbares Langfuse (Keys fehlen, Server aus) den Punkt im PR als „übersprungen" melden, nicht raten.

# Modell-Routing im Kubernia-Harness (#910)

> **SSOT für alle Modell-Pins.** Wenn Anthropic ein neues Modell released und die Pins nachgezogen werden müssen, genügt es, diese Datei zu lesen — sie listet die **zwei Dateien** mit harten Modell-IDs und erklärt die Strategie.

## 1. Die drei Tiers

| Rolle | Tier | Modell-ID | Effort | Warum |
|---|---|---|---|---|
| **Plan + Review** (Planungs-Subagent, plan-feature-Skill) | stark | `claude-opus-5` | `high` | Fehler hier sind teuer — schlechte Architektur-Entscheidungen kosten viele Sessions; das stärkste Modell mit hohem Reasoning amortisiert sich schnell (#741, #745). |
| **Umsetzung** (kubernia-Skill, Workflow-/Loop-Subagenten) | Coding-Sweet-Spot | Tier-Alias `sonnet` (kein hartes Pin) | `medium` — **bislang nur im kubernia-Skill gesetzt** (Frontmatter); Workflow und Loop setzen `model`, aber noch keinen `effort` (#1010) | Sonnet ist der Coding-Sweet-Spot: schnell und günstig genug, um viele Tickets zu tippen, wenn der Plan schon steht; `medium` reicht für Tipparbeit nach fertigem Plan, lässt aber genug Reasoning für die CI-Fix-Schleife. **Muss explizit gesetzt werden:** wer aus einer Opus-Session startet, tippt seinen Code ohne Override auf Opus — „Umsetzung schnell" passiert nicht von allein. Der Alias profitiert trotzdem automatisch von einem neuen Sonnet. |
| **Explore / Recherche** (reine Lesereisen, Codebase-Suche) | günstig | `claude-haiku-4-5-20251001` | default | Explore-Agenten lesen und suchen — kein komplexes Reasoning nötig; Haiku ist 10–20× billiger als Opus und für reine Code-Navigation mehr als ausreichend. |

## 2. Claude Code hat keine Runtime-Aliases

In Claude Code steuert das `model:`-Feld im Skill-/Agent-Frontmatter den Modell-Aufruf. Es gibt **keine repo-eigenen Aliases**, die zur Laufzeit aufgelöst werden — wir können also nicht zentral definieren, was „unser Coding-Modell" heißt. (Die **Tier-Aliase des Tools** — `opus`/`sonnet`/`haiku` — gibt es sehr wohl und wir nutzen sie; sie zeigen auf „das jeweils aktuelle Modell dieses Tiers", lassen sich aber nicht umkonfigurieren.) Das bedeutet:
- Ein Modell-Update (z.B. Opus 5 → 6) erfordert manuelle Anpassung der gepinnten Dateien.
- **Diese Datei ist der Alias:** sie ist die eine Stelle, die einem sagt, WO nachzuziehen ist.

## 3. Gepinnte Dateien — das "Update hier"-Checkliste

Bei einem Modell-Wechsel (neuer Opus, neuer Haiku) diese **zwei Dateien** anpassen:

| Datei | Was steckt drin | Welcher Tier |
|---|---|---|
| [`.claude/agents/kubernia-planner.md`](../.claude/agents/kubernia-planner.md) | `model: claude-opus-5` + `effort: high` | Plan |
| [`.claude/skills/plan-feature/SKILL.md`](../.claude/skills/plan-feature/SKILL.md) | `model: claude-opus-5` + `effort: high` im Frontmatter | Plan |

Explore-Agenten (wenn in Skills explizit geroutet) stehen ebenfalls hier, sobald welche hinzukommen.

**Nicht nachzuziehen — bewusst per Alias statt Pin:** drei Stellen routen über die **Tier-Aliase** (`opus`/`sonnet`/`haiku`) statt über Modell-IDs und tauchen in der Checkliste oben deshalb absichtlich **nicht** auf — sie profitieren automatisch von einem neuen Opus bzw. Sonnet:

- der **`kubernia`-Skill**: `model: sonnet` im Frontmatter (Umsetzung, seit #1035),
- **`review-lenses`**: `model: "opus"` an seinen drei Lens-Subagenten (seit #1035),
- der **Phasen-Workflow** [`.claude/workflows/kubernia-ticket.js`](../.claude/workflows/kubernia-ticket.js): Lens-Agenten mit `model: 'opus'` + `effort: 'high'`, Umsetzungsphase mit `model: 'sonnet'`. Seine **Planungsphase** setzt bewusst kein Modell, sondern ruft den `kubernia-planner`-Agenten (Checklisten-Zeile 1) — so bleibt dieser Pin an genau einer Stelle; nur `effort: 'high'` steht am Aufruf, weil das kein Modell-Pin ist.

Wo ein Alias zur Verfügung steht, ist er dem harten Pin vorzuziehen: er ist die einzige Form von Routing, die einen Modellwechsel ohne Wartung übersteht.

⚠️ **Der Alias kennt keine Generation.** `model: 'opus'` löst auf „irgendein Opus" auf — welchen, entscheidet das Tool, nicht diese Datei. Wo eine **bestimmte** Generation zwingend ist (die Planung: Opus 5), muss es der harte Pin im Frontmatter sein; der Alias taugt nur, wo „das jeweils aktuelle Modell dieses Tiers" die richtige Antwort ist (Review, Umsetzung).

## 4. Konvention im Ticket-Workflow

- **Ticket claimen → Planungs-Subagent** → Opus 5 mit `effort: high` (`kubernia-planner`-Agent, aufgerufen vom `kubernia`-Skill bzw. der Plan-Phase des `kubernia-ticket`-Workflows)
- **Review (die drei Lenses)** → Opus mit `effort: 'high'`, per Alias (kein Pin, siehe Kasten oben) — **auf beiden Pfaden als eigene Subagenten**: im Workflow am `agent()`-Aufruf, auf dem Skill-Pfad spawnt [`review-lenses`](../.claude/skills/review-lenses/SKILL.md) seine drei Lenses selbst so (#1035). Inline im Hauptagenten dürfen sie **nicht** laufen: dort gilt der Coding-Tier der Umsetzung, der Review rutschte still auf Sonnet — und der finale Blick wäre ein Self-Grading des eigenen Fixes (#1012).
- **Ticket umsetzen** → Sonnet, per Alias `model: 'sonnet'` (kein Pin). Im **Workflow** am `agent()`-Aufruf; auf dem **Skill-Pfad** seit #1035 im **Frontmatter** von [`.claude/skills/kubernia/SKILL.md`](../.claude/skills/kubernia/SKILL.md) — dort schreibt der **Hauptagent** den Code, es gibt also gar keinen Subagenten, an dem ein `model:` hinge. ⚠️ **Muss explizit gesetzt sein:** ohne Override erbt beides das Session-Modell — aus einer Opus-Session wäre die „schnelle" Umsetzung sonst Opus. ⚠️ **Turn-Scope des Frontmatters:** der Skill-Override gilt für den **Rest des Turns** und ist nach einer Rückfrage-Pause (neuer Turn) weg — dann den Skill erneut aufrufen. Die Tier-Grenze ist damit ehrlicherweise „**ab Skill-Load bis Turn-Ende**", nicht „Code vs. Urteil": auch die **Epic-Aufteilung**, die **Pre-Flight-Risikoklassifikation** und das Festgefahren-Urteil des `kubernia`-Skills laufen auf dem Coding-Tier. Vertretbar, weil das Denken davor im Opus-Planungs-Subagenten passiert — wandert künftig mehr Urteilsarbeit in den Skill, gehört sie wie Planung und Review in einen eigenen Subagenten. ⚠️ **Beleg-Grenze, ehrlich:** dass `model:`/`effort:` im Frontmatter greifen, ist im Repo belegt (`plan-feature`, `kubernia-planner` nutzen es seit #741/#910); die **Turn-Scope-Semantik** stammt aus der Claude-Code-Doku und lässt sich hier **nicht** testen — [`test/harness/model-routing.test.ts`](../test/harness/model-routing.test.ts) prüft nur, dass die Zeilen da sind. Ändert das Tool sein Verhalten, fällt es keinem Gate auf; die Konsequenz daraus (starke Phasen als eigene Subagenten) ist deshalb bewusst so gebaut, dass sie **auch dann** noch richtig ist.
- **Codebase-Suche / Explore** → explizit `model: claude-haiku-4-5-20251001` setzen, wenn in einem Skill ein reiner Explore-Subagent gespawnt wird; der `subagent_type: Explore` aus dem Agent-Registry hat seinen eigenen Overhead — alternativ einen `Agent({model: "haiku", …})`-Call verwenden

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
- **Die Umsetzung lief in allen vier Läufen auf Opus 5.5, nie auf Sonnet.** #1026 und #1064 hatten den `kubernia`-Skill geladen (`model: sonnet` im Frontmatter, §4), trotzdem kam **kein einziger** Hauptagent-Call von Sonnet. Die Modelle an **Subagenten** greifen dagegen: in #1064 lief der Planer auf `claude-opus-5`, die Recherche auf `claude-sonnet-5-5`. Es hakt also am Frontmatter-Override des Hauptagenten — der größte Hebel für #1065. (`test/harness/model-routing.test.ts` prüft nur, dass die Zeile da ist, nicht, dass sie wirkt.)
- **95–98 % der Tokens sind Cache-Reads**, also der pro Call neu gelesene Kontext. Weniger Calls und ein kleinerer Grundkontext sparen mehr als kürzere Antworten.
- **Loops sind schon billig:** kein einziger roter CI-Push, 1–2 Review-Runden, höchstens eine Rückfrage. Die Kosten stecken in der Umsetzung (60–65 %) und im Review (bis 30 %).
- **Die Planung fehlt bei drei von vier Läufen.** Nur #1064 hat den `kubernia-planner` gerufen; #1026 lief über den Skill und übersprang ihn trotzdem.
- **Grenze der Baseline:** alle vier sind Harness-/Doku-Tickets ohne Spielcode unter `src/`. Ein `src/`-Lauf wird bei Gelegenheit ergänzt; bis dahin nur Harness-Tickets gegen diese Zeilen vergleichen.

### Nach einer Optimierung vergleichen

Im PR von #1065/#1067 (bzw. im ersten Ticket-Lauf danach): das Skript für 1–3 neue Läufe fahren, die Zeilen unter diese Tabelle hängen und die Veränderung von **Tokens**, **Modell Umsetzung** und den Loop-Spalten im PR-Text benennen. Eine Einsparung gilt nur, wenn die Loop-Spalten nicht schlechter werden (mehr CI-Fix-Runden oder Nacharbeit fressen den Gewinn).

### Langfuse-Blick beim Sammelticket (#1199)

Kommt das Sammelticket „Harness-Härtung (gesammelt)" dran ([Mechanik](ticket-reihenfolge.md#sammelticket-harness-härtung-gesammelt-1199)), steht **vor** dem Abarbeiten ein fester, kurzer Blick in Langfuse auf die Läufe seit dem letzten Sammelticket (Tag `kubernia`). Genau drei Fragen, kein freies Stöbern:

1. **Wirkung:** Tokens und Kosten pro Ticket gegen die [Baseline](#baseline-stand-2026-09-29-alle-vier-läufe-vor-10651067) — haben die seitdem gemergten Harness-Änderungen gewirkt? Je Lauf eine Zeile unter die Tabelle (Skript oben, `--langfuse`).
2. **Tokenfresser:** der teuerste Lauf des Zeitraums und woran es lag (Phase, Subagent, wiederholtes Lesen großer Dateien).
3. **Prozess:** Läufe mit auffällig vielen CI-Fix- oder Review-Runden bzw. Nacharbeit.

Jeder Befund wird eine Zeile im Sammelticket; ein eigenes Issue nur bei einem echten Defekt (AGENTS.md § Nicht jeder Befund wird ein Ticket). Ohne erreichbares Langfuse (Keys fehlen, Server aus) den Punkt im PR als „übersprungen" melden, nicht raten.

# ADR 0012: Harness-Autonomie — Audit-Spur statt Merge-Freigabe, Fokus der Harness-Phase

> Architecture Decision Record. Format: Kontext → Problem → Optionen → Entscheidung → Konsequenzen → Re-Evaluierung.
> Status: **akzeptiert** · Datum: 2026-09-28 · Tickets: #1069 (Umsetzung), #1072 (dieser ADR)

## Status

**Akzeptiert.** Der Label-/Guard-Teil (Entscheidung 1 „Label selbst setzen“, 2 und 5) ist abgelöst durch [ADR 0014](0014-leitplanken-ohne-label-riegel.md) (#1303). Präzisiert [ADR 0008](0008-ki-agenten-harness.md) (Entwicklungsmodell) und [ADR 0009](0009-pr-gating-required-checks.md) (Integrationsweg) an einer Stelle: wer einen PR merged, der die **Leitplanken selbst** ändert. Nimmt den Merge-Checkpoint aus #1012 zurück. Die Pflicht-Stopps sind inventarisiert und zugeschnitten durch die Fortschreibung #1363 unten. Umgesetzt mit #1069 (PR #1071); die operative Regel steht in [AGENTS.md › Human-in-the-Loop-Checkpoints](../../AGENTS.md), die Erklärung in [docs/agent-harness.md](../agent-harness.md).

## Kontext

Seit #1012 galt ein **Merge-Checkpoint**: fasste ein Diff Harness-/Leitplanken-Dateien (`AGENTS.md`, `CLAUDE.md`, `.claude/`, `.agents/`, `docs/agent-harness*`) oder die Goodhart-Gate-Config an, durfte der Agent **nicht selbst mergen** — PR öffnen, CI grün bringen, an die Maintainerin übergeben. Dazu hielt die Pre-Flight-Klärung bei jedem solchen Ticket schon **vor dem Coden** an.

Eine Backlog-Triage am 2026-09-28 zeigte zwei Dinge:

1. **Der Harness hatte das Spiel verdrängt.** Seit Ende Juli waren fast nur noch Harness-/Gate-Tickets gelandet; rund die Hälfte des offenen Backlogs betraf den Harness, viele Tickets entstanden aus Befunden anderer Harness-Tickets. 24 Einzeltickets wurden in vier Sammeltickets gebündelt (#1064–#1067), dazu die Token-Baseline #1068.
2. **Der Checkpoint band die Maintainerin an genau diese Tickets.** Bei einer bewusst gewählten Harness-Phase (s.u.) wäre sie bei **jedem** Ticket zweimal im Loop gewesen (Pre-Flight + Merge). Ein fertiger Datenverlust-Fix (#1059 zu #1051) lag so einen Monat unbemerkt offen.

## Das Problem

Menschliche Freigabe ist die stärkste Absicherung gegen einen Agenten, der seine eigenen Leitplanken aufweicht — aber sie skaliert nicht, wenn gerade die Leitplanken das Arbeitsgebiet sind. Im Single-Account-Modell greift der CODEOWNERS-Pflichtreview nicht (#723), und das Label `maintainer-approved` des `gate-change-guard` (#1012/#1015) ist ebenso selbst setzbar; der echte menschliche Schritt war nur der **Nicht-Self-Merge**. Gesucht ist ein Ersatz, der Autonomie erlaubt, ohne Leitplanken-Änderungen unsichtbar zu machen.

## Optionen

| Option | Bewertung |
|---|---|
| **Status quo (Merge-Checkpoint)** | Maximale Sicherheit, aber die Maintainerin ist bei jedem Harness-Ticket im Loop; genau das Ziel der Harness-Phase wird verfehlt. |
| **Alles außer Gate-Aufweichung** (Empfehlung des Agenten) | Agent merged Harness-/Doku-/Skill-Änderungen selbst; nur PRs, die Gates/Schwellen/Permissions/Hooks/CI abschwächen, bleiben menschlich. Fast kein Bremsen im Alltag, die eine gefährliche Klasse bliebe gegatet. |
| **Komplett alles (gewählt)** | Agent merged auch Gate-/CI-Änderungen selbst. Minimaler Loop; das Restrisiko (Agent schwächt eigene Leitplanken) wird über Sichtbarkeit + Verhaltensregel statt über einen Stopp adressiert. |
| **Nur Doku/Skills** | Agent merged nur Markdown-Änderungen selbst; Workflow-Skript, Scripts, Tests, CI bleiben menschlich. Zu eng für eine Harness-Phase, deren Kern Skript-/Gate-Arbeit ist. |

## Entscheidung

Die Maintainerin wählt **„komplett alles"**:

1. **Kein Merge-Checkpoint mehr.** Bei Harness-/Leitplanken-/Gate-Diffs setzt der Agent `maintainer-approved` **selbst** und merged wie jeden anderen PR — Voraussetzung unverändert: CI grün + Mehr-Perspektiven-Review bestanden.
2. (abgelöst durch ADR 0014) **Label-Reihenfolge schützt den Guard:** das Label erst setzen, wenn alle anderen Checks grün sind, und vor jedem weiteren Fix-Push wieder entfernen. Sonst sähe der `gate-change-guard` eine später im selben PR nachgeschobene Gate-Änderung nicht mehr.
3. **Audit-Spur ersetzt die Freigabe:** direkt nach dem Merge ein PR-Kommentar „🛡️ Leitplanken-Änderung selbst gemergt" — *was* sich an den Leitplanken ändert, *warum*, *wie reverten* (`git revert <squash-sha>` per PR). Die Maintainerin liest asynchron gegen. Im Workflow als Schema-Feld `auditKommentar` mit lauter Warnung, wenn er fehlt.
4. **Pre-Flight nur noch für echte Entscheidungen (abgelöst durch #1279, siehe Fortschreibung unten):** 🎨 Optik, ⚠️ riskante Weiche, offene Plan-Weiche. Harness-/Gate-Dateien allein sind kein Stopp-Grund.
5. (abgelöst durch ADR 0014) **Unverändert:** `gate-change-guard` + CODEOWNERS (das Label markiert jede Leitplanken-Änderung im PR-Log), der Mehr-Perspektiven-Review vor dem Merge, die Goodhart-Verhaltensregel (nie ein Gate abschwächen, nur um grün zu werden).

**Fokus der Harness-Phase.** Parallel entschieden: erst das KI-Gerüst fertig machen, dann wieder Spielentwicklung. Ziele: **wenig Human-in-the-Loop, wenig Tokens, hohe Qualität.** Umgesetzt über die Board-Reihenfolge — Windows-Start des Workflows (#1026), Token-/Loop-Baseline (#1068), dann die Sammeltickets (AGENTS.md kürzen #1064, genau ein Ablauf #1067 mit Folgepunkten #1070, Modell-Routing #1065, native Worktree-Isolation #1066), die Qualitäts-Gates #1023/#1022, danach Security/Repo-Tickets und das Spiel. Ein separates „Projekt-Brain" oder Wiki neben dem Repo wurde bewusst nicht angelegt: das Repo selbst (AGENTS.md, ADRs, `docs/`, Issues) ist der Wissensspeicher; nur übertragbare Konzepte und persönliche Arbeitskonventionen (z.B. der Chat-Abschlusssatz, #935) gehören ins persönliche Brain der Maintainerin.

## Konsequenzen

**Positiv**
- Harness-Tickets laufen durch, ohne dass die Maintainerin pro Ticket freigeben muss; liegengebliebene grüne PRs wie #1059 entstehen nicht mehr.
- Jede Leitplanken-Änderung bleibt sichtbar (Label + Audit-Kommentar) und ist per Revert-PR zurückholbar.
- Die Regel ist tool-neutral in AGENTS.md verankert und per Fitness-Function bewacht ([`test/harness/harness-approval.test.ts`](https://github.com/fluffels/self-improving-agent-harness-and-factory/blob/v0.1.0/test/harness/harness-approval.test.ts), Marker „Leitplanken-Änderung selbst gemergt").

**Negativ / Trade-offs**
- **Kein Mensch mehr vor dem Merge einer Leitplanken-Änderung.** Ein Agent könnte eine eigene Leitplanke aufweichen; die Absicherung ist nachgelagert (Audit + Revert) und die Goodhart-Regel ist eine Verhaltensregel, kein technischer Riegel.
- **Harness-Erkennung ist Selbstauskunft** des Umsetzungs-Agenten (`beruehrtHarness`); fasst eine Fix-Runde neu Leitplanken an, merkt die Merge-Phase das nicht — offen in #1070.
- **Der Auto-Modus von Claude Code kann trotzdem bremsen.** Unabhängig von der Repo-Regel kann dessen Klassifikator Änderungen an `.claude/`-Dateien, Hooks oder Permissions als Self-Modification blocken (vgl. [docs/agent-harness.md](../agent-harness.md)); bei der Umsetzung von #1069 blockte er genau die Prompt-Stellen, die den Merge-Checkpoint entfernten, und vereinzelt auch GitHub-Schreib- und Warte-Befehle. Solche Tickets brauchen die Maintainerin weiter kurz im normalen Modus; bei Spiel-Tickets entfällt das weitgehend.

## Fortschreibung #1199 (2026-10-05): Spielquote, Sammelticket, Abschlusskriterium

**Befund.** Seit dem 28.09.2026 waren alle rund 40 gemergten PRs Harness-PRs; der letzte Spiel-PR war #964 (24.07.). Auf dem Board standen die Positionen 1–45 ausschließlich Harness/Infra/Security/Doku, das erste Spielticket auf Position 46. Ursache war ein Kreislauf: Lens-Befunde „außerhalb des Scopes" wurden nach „lieber ein Ticket zu viel" Einzeltickets, oben einsortiert, und jedes davon erzeugte im eigenen Review neue Befunde. Viele härteten Wächter gegen hypothetische Umgehungen. Die Menge der Befunde war damit kein Maß für die Güte des Harness — ein Reviewer findet in jedem neuen Diff etwas, und jeder Härtungs-PR ist neuer Diff.

**Entscheidung (Ideen der Maintainerin, Details von ihr an den Agenten delegiert und kritisch abgewogen).**
1. **Spielquote (abgelöst durch #1258: kein Rhythmus-Schritt mehr, die Board-Reihenfolge ist rein manuell):** jedes dritte Ticket ist ein Spielticket (`area:inhalt`/`lernpfad`/`grafik`); Notfälle (`🚨`, Security, `🤖`, Forum) behalten Vorrang. Gibt es keins mehr, meldet der Agent das und legt ein Planungsticket an. Verworfen: „alle neuen Harness-Tickets unter den Spiel-Block" — hätte bei Position 46 faktisch „ans Board-Ende" bedeutet und auch berechtigte Harness-Arbeit geparkt.
2. **Harness-Befunde sind Zeilen, keine Tickets** (erweitert durch #1286: auch Defekte und Wünsche zum Harness, vorher nur Härtung und Kosmetik; ein eigenes Issue nur noch für Notfälle und Befunde außerhalb des Harness): als Zeile in **ein** Sammelticket auf Board-Position (aktuelle Zahl: AGENTS.md; Historie: anfangs 5, dann 7 auf Wunsch der Maintainerin #1264, dann 6 #1276), das pro Durchgang komplett in einem PR abgearbeitet wird (Fortschreibung #1311: früher nur, was in einen PR passte, mit Rest-Übertrag ins nächste Sammelticket; das ließ Arbeit anstauen, jetzt gilt „komplett“, zu große PRs deckt `KQ-Diffsize-Override:`). Die Härtung geht also nicht verloren, sie wird nur gebündelt und in der Frequenz begrenzt.
3. **Langfuse-Blick beim Sammelticket** (abgelöst durch #1293: die Auswertung läuft jetzt als eigenes wiederkehrendes Ticket „Langfuse-Status überprüfen" mit breiterer Checkliste, Takt seit #1351 wöchentlich per Workflow ([ADR 0016](0016-langfuse-takt-woechentlich.md)), [docs/model-routing.md](../model-routing.md#langfuse-status-überprüfen-1293)): vorher drei feste Fragen vor dem Abarbeiten des Sammeltickets (Wirkung, Tokenfresser, Prozess) — so entstehen Befunde aus echten Läufen statt nur aus Review-Hypothesen.

Regeln: [AGENTS.md › Wo die TODOs leben](../../AGENTS.md#wo-die-todos-leben), Mechanik: [docs/ticket-reihenfolge.md](../ticket-reihenfolge.md).

**Abschlusskriterium der Harness-Phase (messbar).** Die Phase ist abgeschlossen, wenn
- **#1065** (Modell-/Effort-Routing), **#1120** (Zwei-Stufen-Prüfung), **#1121** (nicht blockierend auf CI warten) und **#1198** (Grundkontext) geschlossen sind **und**
- die Nachmessung **#1206** als Zeilen unter der Baseline in [docs/model-routing.md §5](../model-routing.md#5-token--und-loop-baseline-1068) steht.

Bewusst **keine** harte Token-Schwelle als Bedingung: eine nie erreichte Schwelle würde die Phase endlos verlängern — genau der Kreislauf, den diese Fortschreibung bremst. Das Messergebnis wird hier festgehalten; fällt es schlecht aus, ist das eine eigene Entscheidung, keine Verlängerung der Phase. **Danach: Fokus zurück aufs Spiel** — die Maintainerin sortiert das Board spielzuerst, die Spielquote bleibt als Untergrenze, Harness-Arbeit läuft über das Sammelticket und Notfälle.

**Konvergenz-Signal.** Die Zeilenzahl pro Sammelticket-Generation zeigt, ob der Harness besser wird. Sinkt sie nicht, wird dieser ADR neu bewertet.

## Fortschreibung #1279/#1276 (2026-10-06): Weichen entscheidet der Agent selbst

**Anlass.** Die Maintainerin wollte nach #1265 „keine Entscheidungen mehr“ vom Agenten vorgelegt bekommen. Punkt 4 der Entscheidung oben (Pre-Flight für 🎨 Optik, ⚠️ riskante Weiche, offene Plan-Weiche) wird dadurch **abgelöst**.

**Entscheidung.** Der Planer wägt jede Weiche in Abschnitt 7 ab und entscheidet, der Umsetzer dokumentiert sie im PR-Text („Entscheidung: X, weil Y“); Optik misst der Agent an `docs/stardew-referenz.md` und deren Checkliste und zeigt Screenshots im PR. Die Maintainerin widerspricht per Revert. Eine Rückfrage vor dem Coden bleibt nur bei **Irreversiblem oder Außenwirkung** (Löschen, Ruleset/Secrets/Repo-Einstellungen, Veröffentlichen/Forum). Das passt zum Ziel „wenig Human-in-the-Loop“ dieses ADR: die Audit-Spur (PR-Text, Revert) trägt die Kontrolle, nicht ein Vorab-Stopp.

**Trade-off.** Ein falsch entschiedener Optik-Punkt kostet einen Revert-PR statt einer Rückfrage; bei Optik trägt die Messlatte (Stardew-Referenz) das Urteil, nicht Geschmack.

## Fortschreibung #1309 (2026-10-06): Sammelticket halbieren

**Anlass.** Das Konvergenz-Signal oben schlug an: Generation #1276 hatte 66 offene Harness-Zeilen, Generation #1308 wieder 66, weil „abarbeiten, was in einen PR passt“ in jeder Generation Zeilen übrig ließ und Reviews neue erzeugten.

**Entscheidung (Vorgabe der Maintainerin).** Beim Claimen wird die Zeilenliste halbiert: die zweite Hälfte (bei ungerader Zahl die kleinere) wandert sofort wörtlich ins nächste Sammelticket, die erste wird in **einem** PR vollständig erledigt (jede Zeile mit Ergebnis: umgesetzt, geprüft und dokumentiert, oder begründet „bewusst nicht“ (nur bei optionalen Teilen); zurück nur, was nachweislich nicht machbar ist). Der PR darf breit sein (`KQ-Diffsize-Override`). Neue Befunde gehen ins nächste Sammelticket, nie in den laufenden PR. Bei ungerader Zeilenzahl bleibt die größere Hälfte im aktuellen Ticket.

**Trade-off.** Ein breiter PR ist schwerer zu reviewen und zu reverten als mehrere kleine; dafür sinkt die Liste je Generation planbar, statt dass jede Generation nur umschichtet.

## Fortschreibung #1311 (2026-10-06): Sammelticket komplett statt halbiert

**Entscheidung (Vorgabe der Maintainerin, löst die Halbierung aus #1309 ab).** Ein Sammelticket wird, wenn es drankommt, immer komplett umgesetzt: kein Teil, kein Rest-Übertrag ins nächste Sammelticket, weil sich sonst zu viel anstaut. Was beim Arbeiten dazukommt oder auffällt (neue Zeilen-Kommentare, eigene Befunde, Lens-`ausserhalbScope`), kommt in denselben PR. Ist er dafür zu groß, deckt die begründete Commit-Zeile `KQ-Diffsize-Override:` das ab. Nur was wirklich nicht machbar ist, geht als Entscheidung an die Maintainerin, nichts wird still ausgelagert. Jede Zeile bekommt ein Ergebnis (umgesetzt, geprüft und dokumentiert, oder begründet „bewusst nicht“ bei optionalen Teilen).

**Trade-off.** Der PR wird breit und schwerer zu reviewen (mehr Lens-Runden, größerer Revert); dafür bleibt kein Rest, und die Zeilenzahl je Generation sinkt auf null, statt umgeschichtet zu werden.

## Fortschreibung #1363 (2026-10-21): Human-in-the-Loop-Inventar

**Anlass.** Die Konsequenz „Der Auto-Modus kann trotzdem bremsen“ und mehrere Skill-Texte ließen offen, an welchen Stellen ein Lauf wirklich auf die Maintainerin wartet. Besonders `festgefahren` hielt auch einen Lauf über mehrere Tickets an, obwohl das Protokoll (assigned bleiben, Label, PR-Kommentar) die Entscheidung ohnehin asynchron macht.

**Entscheidung.** Pflicht-Stopps bleiben nur bei Irreversiblem und Außenwirkung, als geschlossene Liste im Block `stopps` der AGENTS.md (§ Human-in-the-Loop-Checkpoints): Löschen (auch `gh issue delete`), Ruleset/Secrets/Repo-Einstellungen samt Project-Ansichten und -Feldern, Veröffentlichen, Forum-Antwort posten, PixelLab-Key. `festgefahren` hält den Mehr-Ticket-Lauf nicht mehr an: das Protokoll bleibt unverändert, der Lauf nimmt das nächste freie Ticket, das festgefahrene zählt zu N, und die Schlussübersicht nennt es mit PR und `FESTGEFAHREN:`-Art. Ein Werkzeug- oder Session-Defekt beendet den Lauf weiter, weil er beim nächsten Ticket dieselben Tokens verbrennen würde.

**Inventar** (Stand 2026-10-21; „bleibt“ = fester Stopp oder externe Grenze, „asynchron“ = der Lauf geht weiter, die Maintainerin entscheidet später, „entfällt“ = kein Warten mehr):

| # | Fundstelle | Wartepunkt | Kategorie | Entscheidung |
|---|---|---|---|---|
| 1 | AGENTS.md § Human-in-the-Loop-Checkpoints (Block `stopps`), `ablauf.md` Schritt 3 | Pre-Flight-Klärung | Irreversibel/Außenwirkung | bleibt, geschlossene Liste |
| 2 | AGENTS.md § Forum-Eingang, Skill `forum` Schritt 4 | Antwort-Freigabe vor dem Posten | Außenwirkung | bleibt |
| 3 | AGENTS.md § Kein Parken, `docs/ticket-reihenfolge.md`, `permissions.ask` | `gh issue delete` | irreversibel | bleibt (ask-Regel für Bash und PowerShell) |
| 4 | AGENTS.md § Konventionen (PixelLab) | Key trägt die Maintainerin ein | Secret | bleibt |
| 5 | Ruleset/Secrets/Repo-Einstellungen, Veröffentlichen (`deny` für `npm publish`, `gh repo delete`) | Pre-Flight | Außenwirkung/irreversibel | bleibt |
| 6 | AGENTS.md § Festgefahren-Protokoll, `festgefahren.yml` samt `check-festgefahren.mjs` (Kommentar), `ablauf.md` Punkt `festgefahren` | der Lauf hielt an | Kostendeckel/Qualität | asynchron |
| 7 | `ablauf.md` `FESTGEFAHREN: abnahme` „nicht prüfbar“ | Kriterium präzisieren | Spezifikation | asynchron |
| 8 | `ablauf.md` Abnahme-Abbruch/unbekannter Agenten-Typ, `kubernia-umsetzer.md` Punkt `handoff` | Werkzeug reparieren, Session neu starten | externe Restgrenze | bleibt, der Lauf endet |
| 9 | Skill `review-lenses` › Cap (mehr als 3 Zusatzpässe) | Freigabe | Kostendeckel | asynchron, über Zeile 6 |
| 10 | `ablauf.md` `entscheidung-noetig` | `FRAGEN` per `AskUserQuestion` | nur Irreversibles/Außenwirkung | bleibt; ein PixelLab-Asset erzeugt der Hauptchat selbst |
| 11 | `kubernia-umsetzer.md` (Klassifikator „Create Unsafe Agents“) | `entscheidung-noetig` | externe Restgrenze | bleibt |
| 12 | Auto-Modus-Klassifikator bei `.claude/`-Änderungen (Konsequenzen oben, FAQ) | Wechsel in den normalen Modus | externe Restgrenze | bleibt, siehe unten |
| 13 | `ablauf.md` Schritt 0 `haupt-sync --streng` Exit 1 | stoppen, melden | Schutz fremder Arbeit im geteilten Checkout | bleibt |
| 14 | AGENTS.md § Langfuse-Erfassung, `ablauf.md` Schritt 0 | stoppen, melden | Vorbedingung, die der Agent nicht herstellen kann | bleibt |
| 15 | `ablauf.md` Schritt 1 Exit 2/Exit 5 | stoppen | technischer Abbruch/API-Kontingent | bleibt, kein Entscheidungs-Stopp |
| 16 | `ablauf.md` Reparaturweg („der Maintainerin melden und weitermachen“) | keiner | kein Wartepunkt | schon asynchron |
| 17 | `ablauf.md` Schritt 2 Blocker („stoppen, kein Griff zum nächsten Ticket“) | der Lauf endet | Board-Hoheit, ausdrücklicher Wunsch der Maintainerin | bleibt, neu bewerten mit #1365 |
| 18 | `ablauf.md` „Mehrere Tickets“ (Anzahl N) | Rückfrage ohne Zahl | Pacing | bleibt bis #1365 |
| 19 | `ablauf.md` Budget-Pacing Exit 3/4 | Pause bis Reset | Kostendeckel | bleibt, wartet auf keine Entscheidung |
| 20 | AGENTS.md § Kollisionsschutz (Worktree entfernen: „sonst stoppen und melden“) | stoppen | Datenverlust-Schutz | bleibt |
| 21 | AGENTS.md § Mehr-Perspektiven-Review (strittige Blocker) | Hand-off | Entscheidung | entfällt: der Hauptchat entscheidet nach dem Entscheidungsprotokoll |
| 22 | Skill `kubernia-workflow`, Workflow-Ausgänge `wartet-auf-klaerung`/`festgefahren` | entfallen | Ablauf | entfallen mit #1067; Nachfolger sind Zeile 6 und 10 (`ERGEBNIS`-Token `festgefahren`/`entscheidung-noetig`) |
| 23 | Skill `kubernia` | keiner | kein Wartepunkt | delegiert an `ablauf.md` |

Zeile 8, Abnahme-Abbruch: präzisiert durch #1821, siehe [Werkzeug-Abbruch der Abnahme](../factory/entscheidungsprotokoll.md#werkzeug-abbruch-der-abnahme): fehlt der Abnahme ein Werkzeug, entscheidet der Hauptchat nach dem Entscheidungsprotokoll; ein Abbruch, der die ganze Session betrifft, beendet den Lauf weiter.

**Wächter.** `test/harness/harness-approval.test.ts` (Abschnitt „Feste Stopps bleiben“) prüft die fünf Anker im Block `stopps`, den Freigabe-Stopp im Skill `forum` und die Permission-Regeln (`ask` für `gh issue delete`, `deny` für `npm publish` und `gh repo delete`, je Bash und PowerShell). Ein gestrichener fester Stopp wird damit rot. Grenze: der Wächter prüft Anker und Einträge, nicht die Bedeutung; ein Abschwächen im Wortlaut bei erhaltenem Anker fängt er nicht.

**Auto-Modus bei `.claude/`-Änderungen (Recherche 2026-10-21).** Keine Regel im Repo vermeidet die Sperre; sie bleibt eine externe Restgrenze.
- [Permission-Modi › Protected paths](https://code.claude.com/docs/en/permission-modes): `.claude` ist ein geschützter Pfad, `permissions.allow` gibt Schreibzugriffe dort nicht vorab frei; im Auto-Modus entscheidet der Klassifikator. Die Worktrees unter `.claude/worktrees/` sind ausgenommen, der Klassifikator blockt dort laut [FAQ](../agent-harness-faq.md) trotzdem (Self-Modification).
- [Auto-Modus-Konfiguration](https://code.claude.com/docs/en/auto-mode-config): `autoMode` liest der Klassifikator nicht aus `.claude/settings.json` oder `.claude/settings.local.json`, nur aus den Nutzer-Settings, Managed Settings und `--settings`. Explizite `ask`-/`deny`-Regeln gelten vor dem Klassifikator.
- Der einzige Hebel ist ein persönlicher `autoMode.allow`-Eintrag in `~/.claude/settings.json`: außerhalb des Repos, er lockert eine Sicherheitsprüfung und lässt sich nicht verteilen. Das entscheidet allein die Maintainerin; Agenten setzen ihn nicht. Bis dahin gilt der Rückfall: nicht umformulieren, `entscheidung-noetig` melden.

**Trade-off.** Weiterlaufen nach `festgefahren` kostet Tokens für das nächste Ticket; gedeckelt durch N und das Budget-Pacing vor jedem Ticket. Ein festgefahrenes Ticket zählt zu N, weil N der Kosten- und Zeitdeckel ist, keine Erfolgsquote.

## Re-Evaluierungs-Trigger

- **Ein selbst gemergter PR hat eine Leitplanke tatsächlich aufgeweicht** (per Audit-Kommentar oder später entdeckt) — dann auf „alles außer Gate-Aufweichung" zurückgehen oder einen technischen Riegel für Gate-Schwellen einziehen.
- **Audit-Kommentare fehlen wiederholt** oder werden nicht gelesen — dann ist die Audit-Spur kein Ersatz mehr für die Freigabe.
- **Die Harness-Phase ist abgeschlossen** (Kriterium: [Fortschreibung #1199](#fortschreibung-1199-2026-10-05-spielquote-sammelticket-abschlusskriterium)) — Fokus zurück aufs Spiel, diesen ADR um das Messergebnis fortschreiben.
- **Die Zeilenzahl der Sammeltickets sinkt über mehrere Generationen nicht** — dann erzeugen die Reviews nur Arbeit; Lens-Umfang oder Sammelticket-Takt neu bewerten.
- **Die Solo-Konstellation ändert sich** (weitere Beitragende) — dann den Merge-Checkpoint neu bewerten, wie schon in ADR 0009 für Pflicht-Reviews vorgesehen.

**Nachtrag #1215 (2026-10-05): Rhythmus im Board statt Rechnung aus der Historie.** Die Quote wurde zunächst aus den Labels der letzten zwei gemergten PRs berechnet. Das machte die Auswahl undurchsichtig und entwertete die Board-Reihenfolge. Jetzt ist das Board die einzige Wahrheit: auf höchstens zwei Nicht-Spieltickets folgt ein Spielticket (bewusst als Invariante statt fester Positionen 3/6/9: feste Slots zögen nach jedem Merge weitere Spieltickets nach oben), gepflegt nur im Kopf des Boards, am Ticket-Ende und bei jedem Einsortieren (**abgelöst durch #1258:** der Rhythmus-Schritt entfällt, die Board-Reihenfolge ist wieder rein manuell). „Nächstes Ticket" ist wieder schlicht das oberste freie Item.

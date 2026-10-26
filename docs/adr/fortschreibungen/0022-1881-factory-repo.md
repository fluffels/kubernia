# Fortschreibung #1881 (2026-10-26): Das Factory-Repo ist angelegt (F10, Teil 8)

Ergänzt [ADR 0022](../0022-dark-factory-kern-und-verteilung.md) (F10, Verteilung) und löst die Zeilen „CodeQL, Scorecard … entfällt im Anfangsstand“ der Fortschreibungen [#1925](0022-1925-gate-satz.md) und [#1942](0022-1942-messbasis.md) ab; die Fortschreibung steht als Datei (siehe [Fortschreibung zu ADR 0013](0013-1860-fortschreibungen-als-dateien.md)).

## Ergebnis

Das öffentliche Repo `fluffels/self-improving-agent-harness-and-factory` steht. Sein `main` trägt den Bootstrap-Commit und den als Pull Request #1 gemergten Export eines genannten Quell-Commits, geschützt vom Ruleset `main-schutz` ohne Bypass, mit dem annotierten Tag `v0.1.0`.

| Stück | Wert |
| --- | --- |
| Export-SHA (`main` dieses Repos vor dem Ticket) | `ddf01ed1c99802bb087c290959506ac38f57fa13` |
| Bootstrap-Commit (genau ein Direkt-Push: LICENSE und README) | `83ff3f843d4afc4323b5ab738cd9aab2070abb19` |
| Ruleset `main-schutz` im Factory-Repo | ID 25905018, `bypass_actors: []` |
| Pull Request #1 (Squash-Merge) | `e800f2747d24041a38fde208fb0fd3fbe90d90c2` |
| Tag `v0.1.0` (annotiert, kein GitHub-Release) | zeigt auf den Merge-Commit von #1 |

## Entscheidungen

- **Markenprüfung (F1):** bewusst ohne amtliche Prüfung. Als Beleg dient eine Vorprüfung per Websuche am 2026-10-26: der Name „Self-Improving Agent Harness and Factory“ taucht nirgends als Marke oder Produktname auf, „self-improving agent harness“ ist ein beschreibender Fachbegriff. Das ist keine Registerabfrage.
- **Repo (F2):** öffentlich, Beschreibung gleich dem Untertitel der README, Issues an, Wiki aus. Discussions sind erst nach dem Anlegen von Pull Request #1 eingeschaltet worden, damit die Nummer 1 an den Import geht (Issues, Pull Requests und Discussions teilen einen Nummernraum). Squash-Merge mit den Branch-Messages als Commit-Text (sonst fehlten auf `main` die Override-Zeilen), Auto-Merge, Branch-Löschen nach dem Merge; Merge-Commit und Rebase aus. Erlaubte Actions: GitHub-eigene und `ossf/scorecard-action`; der Workflow-Token ist `read`.
- **Bootstrap (F3, F4):** LICENSE und README stehen byte-gleich aus `.factory/produkt/` im Bootstrap-Commit, unter der lokalen Git-Identität mit der noreply-Adresse. Der Vermerk „Entwurf ohne Rechtsberatung“ stand dort nicht; er kam mit der Abweichung D2 in die README.
- **Ruleset (F5):** `deletion`, `non_fast_forward`, `pull_request` (nur Squash, null Pflicht-Reviews) und `required_status_checks` mit den drei Kontexten des Spiel-Repos. Es wurde vor dem Import angelegt. Ein Direkt-Push auf `main` wurde abgewiesen („Changes must be made through a pull request“ und „3 of 3 required status checks are expected“). Das Ruleset steht als Ruleset-Spiegel `.github/ruleset-main-schutz.json` im Factory-Repo (Abweichung D1).
- **Sicherheit (F6):** Secret-Scanning mit Push-Schutz vor dem Import; CodeQL (`javascript-typescript` und `actions`), Scorecard und Dependabot-Versionsupdates als versionierte Dateien, nicht als Default-Setup (der Default-Setup-Status ist `not-configured`); Dependabot-Alerts und -Sicherheitsupdates nach dem Merge. Ein CodeQL-Alert `js/incomplete-sanitization` in `scripts/docs-gen/markdown.mjs` ist mit derselben Begründung geschlossen wie im Spiel-Repo („won’t fix“: maskiertes `|` für GFM-Tabellenzellen, Eingabe sind Repo-Daten). **`PROJECT_TOKEN` fehlt noch:** die Maintainerin legt ihn selbst an, am besten mit K10 ([#1883](https://github.com/fluffels/kubernia/issues/1883)).
- **Tag (F7):** `v0.1.0`, annotiert, kein Release.
- **Boards (F8):** keine Verknüpfung des Repos mit den Projekt-Boards; den Ansichten-Filter setzt K10 (#1883).
- **Geplante Schreib-Workflows aus (W7):** `board-takt.yml`, `wiedervorlage.yml`, `dependabot-inbox.yml` und `harness-doctor.yml` sind per `gh workflow disable` abgeschaltet, weil sie Issues, Labels oder Boards schreiben und das Repo weder Labels noch `PROJECT_TOKEN` hat. K10 schaltet sie wieder ein (`gh workflow enable`), sobald beides steht.
- **Nachweiszeilen:** im Factory-Repo gilt der Präfix `SIH-` (nicht `SH-`, wie das Ticket schrieb: `SH-` kommt als Teilstring in Kern-Dateien vor, Fortschreibung #1923). PR #1 trägt `SIH-Diffsize-Override: #1 …`, `SIH-Diffcov-Override: #1 …`, `SIH-Plan: ohne — …` (geplant im Quell-Repo) und `SIH-Abnahme: entfaellt — …`; der Review lief als echte Lens-Runde (zwei Pässe, drei Brillen), nicht als Override.

## Abweichungen des Imports vom Export (PR #1, Commit 2 und 3)

Commit 1 ist der reine Export (Baum gleich dem zweimal erzeugten Export). Alles andere ist diese geschlossene Liste:

| Nr | Änderung | Grund |
| --- | --- | --- |
| D1 | `.github/ruleset-main-schutz.json`: ID und Stand | der Spiegel zeigt das neue Ruleset |
| D2 | README: Entwurfsvermerk und Inkubations-Status ersetzt durch den Vorab-Stand `v0.1.0`, Holdout-Satz entfernt, Lizenzvermerk | Ist-Stand (die Holdout-Abnahme gibt es) |
| D3 | `vite.config.ts`: Coverage-Floors 89 (Zeilen) und 87 (Zweige) statt 90 und 88 | erste Messung mit `include` unter 90 und 88: Zeilen 89,33 Prozent, Zweige 87,71 Prozent (Windows); in der CI unter Linux 89,32 und 87,73 Prozent. Die Fortschreibung #1942 nennt die erste Messung maßgeblich; die Floors bewegen sich ab jetzt nur nach oben |
| D4 | `codeql.yml`, `scorecard.yml`, `dependabot.yml`, dazu `test/harness/sicherheits-workflows.test.ts` (ohne den Teil für den Code-Scanning-Inbox-Workflow, den das Factory-Repo nicht hat), je ein Eintrag in `test/harness/kern-abdeckung.json`, generierte Kennzahl der Workflows | Code-Scanning als Dateien; Dependabot nur für npm und GitHub-Actions; die Wächter-Regeln der Workflows bleiben durchgesetzt |
| D5 | Glossar: Factory-Repo, Factory-Export (Export-SHA), Produktname, neu Bootstrap-Commit, repo-neutral; die Spalte „Mehr dazu“ verweist auf die Fortschreibung #1706, weil diese Fortschreibung nur hier liegt | ein Glossar, zwei Repos |
| D6 | `test/diffcoverage.test.ts` (Pfad außerhalb der Quellwurzel nicht mehr als `scripts/` fest), `test/harness/harness-inventar.test.ts` (Test der Vorlage des Spiel-Repos samt Rollen-Literalen entfernt), `.factory/projekt.json` (`gates.nichtInVerify` nennt `check:docmap`), Ausführbits `100755` für `.githooks/pre-push` und `.githooks/post-commit` | diese vier waren im Klon rot; die Ausführbits verlor der Export unter Windows (`factory-export.mjs` setzt sie nur dort nicht), der Test dafür ist unter Windows übersprungen und fiel erst in der CI auf |

## Messwerte und Nachweise

- Lokal (Windows): `verify:kompakt` 13 von 13 Gates grün, 5808 Tests; `npm audit --audit-level=high` ohne Fund; `check:factorydrift` meldet „entfällt“ (Quelle des Besitzes).
- Diff-Abdeckung je Schicht (mit großem Puffer gemessen, siehe Grenzen): Domäne 88,58 Prozent (Floor 90), Anwendung 100 Prozent, Präsentation 98,52 Prozent; deshalb `SIH-Diffcov-Override`.
- Kern-Reinheits-Wächter: ein Projektliteral in einem Kern-Test macht `test/harness/kern-reinheit.test.ts` rot (lokal sabotiert und zurückgesetzt, in der CI läuft der Test mit); der Direkt-Push ist abgewiesen, `bypass_actors` ist leer (AK8).
- Langfuse-Probe nach #1293 im Klon (`claude -p`, Arbeitsordner der Klon des Factory-Repos auf `main` = `e800f27`, Transkript unter dem Projektordner des Klons): Session `74daa659-a424-4a4b-89ae-97ddff057292`. **Rollen und Skill in Langfuse** (Observation-Namen): `Tool: Agent [sih-planer]` mit Span `Subagent: Planer-Probe`, `Tool: Agent [sih-umsetzer]` mit `Subagent: Umsetzer-Probe`, `Tool: Agent [sih-lens]` mit `Subagent: Lens-Probe` und `Tool: Skill [review-lenses]`, dazu `Subagent LLM Call` und `LLM Call` mit gesetzten `usageDetails` (Input, Output, Cache) und `Tool: SubagentHandback`. **Hooks:** Langfuse bildet Hooks nicht als eigene Observation ab; die Erfassung selbst ist der Stop-Hook des Plugins `langfuse-observability`. Belege, dass er und die Projekt-Hooks des Klons liefen: (a) `langfuse_hook.log` meldet für die Session „Processed 1 turns“; (b) die Trace-Metadaten (`source: claude-code`, `transcript_path`, `turn_number`, `scope.name: langfuse-sdk`) stammen aus diesem Hook; (c) im Transkript stehen drei `hook_success` des Ereignisses `SessionStart`, darunter zwei Projekt-Hooks des Klons (`${CLAUDE_PROJECT_DIR}/scripts/sandbox-doctor.mjs` und `…/haupt-sync.mjs`, dieser startet `langfuse-abgleich-hook.mjs`); (d) das Abgleich-Log hat zu `sessionstart` und `sessionend` je eine Zeile mit `stand: e800f27` (der Stand des Klons), `geprueft: 1`, `gesendet: 0`, `uebrig: 0`, `fehler: []`, also keine fehlenden Calls. Nicht belegt: der Trace-Tag `factory` (die Beobachtungsliste zeigt ihn nicht) und eine Repo-Zuordnung im Trace selbst; die Umgebung der Spans heißt `kubernia`, weil sie aus der Nutzer-Konfiguration kommt, nicht aus dem Klon.

## Bekannte Grenzen

- **Export und Quelle bleiben bis K9 ([#1882](https://github.com/fluffels/kubernia/issues/1882)) getrennt.** Die Abweichungen D1 bis D6 stehen nur im Factory-Repo; ein erneuter Export aus dieser Quelle verlöre sie, D6 machte ihn rot. Das Werkzeug ist einmalig; vor K9 gehören die Fixes in die Quelle.
- **`check:diffcoverage` liest den Diff mit dem Standard-Puffer von `execFileSync`.** Der Diff dieses Imports (1,49 MB) überschreitet ihn, das Gate meldete „übersprungen“, statt zu messen; die Messwerte oben stammen aus einem Lauf mit großem Puffer.
- **Scorecard-Alerts:** nach dem ersten Lauf sind 29 Alerts offen (meist angepinnte Abhängigkeiten, Branch-Schutz, Sicherheitsrichtlinie). Das Factory-Repo hat keine Code-Scanning-Inbox; K10 ([#1883](https://github.com/fluffels/kubernia/issues/1883)) entscheidet, wie sie triagiert werden.
- **Ticket-Nummern des Spiel-Repos** stehen in Export-Dateien und verlinken im Factory-Repo auf nichts oder auf Fremdes.

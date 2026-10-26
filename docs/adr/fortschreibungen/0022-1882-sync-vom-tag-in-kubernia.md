# Fortschreibung #1882 (2026-10-26): kubernia bezieht den Kern per Sync vom Tag (F10, Teil 9)

Ergänzt [ADR 0022](../0022-dark-factory-kern-und-verteilung.md) (F10, Verteilung) und löst ab: die Zeile „`.factory/produkt/` … bis F10“ im ADR (Entwürfe von README und Lizenz; sie leben seit [#1881](0022-1881-factory-repo.md) im Factory-Repo) und die Grenze „Export und Quelle bleiben bis K9 getrennt“ der Fortschreibung [#1881](0022-1881-factory-repo.md). kubernia ist ab jetzt Bezieher des Kerns, nicht mehr seine Quelle; die Fortschreibung steht als Datei (siehe [Fortschreibung zu ADR 0013](0013-1860-fortschreibungen-als-dateien.md)).

## Ergebnis

| Stück | Wert |
| --- | --- |
| Export-SHA (Quelle des Anfangsstands) | `ddf01ed1c99802bb087c290959506ac38f57fa13` |
| Tag `v0.1.0` (annotiert) | Commit `e800f2747d24041a38fde208fb0fd3fbe90d90c2`, „Anfangsstand aus kubernia@ddf01ed1“ |
| AK1: `git diff ddf01ed1..origin/main` über alle Pfade der Besitz-Liste | leer (der einzige Commit seit dem Export berührt nur `docs/adr/` und das Glossar), kein Upstream-Nachzug und kein neues Tag nötig |
| Sync | `factory-sync --quelle <klon> --tag v0.1.0`: 2 geändert, 147 unverändert; `.factory/sync-stand.json` (Version 2) trägt `quelle: { commit, tag: "v0.1.0", sauber: true }` |
| `check:factorydrift` | 149 Einheiten ohne Drift |

Die zwei Änderungen des Syncs: der neue Sync-Stand und `.claude/settings.json` (nur das Format: vier `{name, mode}`-Objekte im Schlüssel `sandbox` stehen mehrzeilig, inhaltlich gleich).

## Entscheidungen

- **Löschumfang:** entfernt sind die 166 Dateien der Art `kern-test` (Liste aus der Extraktionsliste, vor deren Löschung erzeugt), `scripts/factory-export.mjs` samt `-lib`, die Extraktionsliste, `.factory/produkt/` (README, Lizenz, 19 Vorlagen), die Tests `extraktion`, `factory-export`, `gate-satz`, `ci-vorlage-projekt` und `produkt-entwurf` (Gegenstand entfällt), die Daten ihrer Leser (`kern-abdeckung.json`, `kern-literale-baseline.json`, `kern-links-baseline.json`), Test-Hilfen und Fixtures ohne verbliebenen Importeur (`echte-sprache`, `struktur-quelle`, `env-alt`, `mess-golden-faelle`, `mess-golden.json`, `projekt-probe.json`) und das npm-Skript für die Fremd-Config-Probe. Es bleiben die Projekt-Tests und die Hilfen, die sie importieren. Das Probe-Skript selbst ist Besitz und bleibt.
- **Wächter für die Reste (W1):** `entfernte-pfade-projekt.test.ts` trägt vier Regeln (Export-Werkzeug, Extraktionsliste, Produkt-Entwürfe, Probe-Skript; ausgenommen sind ADRs und Besitz-Pfade) und die generische Regel „jeder in Markdown genannte Testpfad existiert“ statt einer festen Liste mit rund 180 Pfaden. Grenzen: nur `*.md` und `*.mmd` außerhalb von ADRs, Besitz, datierten Schnappschüssen und Schnappschuss-Blöcken; Pfade in URLs und Platzhalter zählen nicht; Nicht-Markdown prüft nur die Breitensuche.
- **Wächter für den Sync-Stand (W9):** `sync-stand-projekt.test.ts` hält fest, dass der Sync-Stand existiert, ein Tag nennt und `sauber: true` trägt, und belegt per Negativfall, dass eine von Hand geänderte Kern-Datei das Drift-Gate rot macht (Meldung mit „upstream“ und `--tag`). Das Drift-Gate allein meldet ohne Sync-Stand nur „entfällt“; der Test schließt diese Lücke. Das Tag wird nicht wörtlich geprüft, sonst bräche jeder spätere Sync.
- **Doku (W2):** nur Zeilen mit toten Pfaden und Abschnitte, deren Gegenstand kubernia verlässt (Extraktionsliste, Kern-Tests, Gate-Satz, Fremd-Config-Probe), werden zu kurzen Verweisen auf das Factory-Repo; Einzelnennungen von Kern-Tests verlinken den Test am Tag `v0.1.0`. Die Kürzung auf den Projektanteil bleibt bei [#1885](https://github.com/fluffels/kubernia/issues/1885).
- **Plugin-Namensraum (#1742):** die Grenze entfällt, weil es keine Plugin-Verpackung gibt ([#1706](https://github.com/fluffels/kubernia/issues/1706)).
- **Formatänderung der Settings (W8):** übernommen; das Drift-Gate ist danach grün.

## Messwerte und Nachweise

- Testdateien 407 auf 237, Tests 11912 auf 5907 (vollständiger Lauf, Windows). Der Diff löscht rund 62 000 Zeilen.
- Red-Green: der Sync-Stand-Test war vor dem Sync rot (Datei fehlt) und wird rot, wenn `sauber` oder die Drift-Meldung gebrochen wird; die Reste-Regeln und die Existenzprüfung wurden einzeln sabotiert (Regelmuster, Existenzprüfung, ADR-Ausnahme, Schnappschuss-Block, Besitz-Ausnahme) und waren jeweils rot.
- Langfuse-Probe nach #1293 im Worktree nach dem Sync (`claude -p`, Subagenten und Skill, Tools `Agent,SendMessage,Skill`): Session `4d235988-b178-400e-b9c9-6e3d069ccad6`. **Rollen und Skill in Langfuse** (Observation-Namen, per `queryMetrics` nach Session): `Tool: Agent [kubernia-planner]` mit Span `Subagent: Planer-Probe`, `Tool: Agent [kubernia-umsetzer]` mit `Subagent: Umsetzer-Probe`, `Tool: Agent [kubernia-lens]` mit `Subagent: Lens-Probe`, `Tool: Skill [review-lenses]`, dazu `Subagent LLM Call` (4) und `LLM Call` (5) mit Tokens sowie `Tool: SubagentHandback` und `Conversational Turn`. **Hooks:** Langfuse bildet Hooks nicht als eigene Observation ab; dass der Stop-Hook des Plugins lief, belegt der Trace selbst. Der SessionEnd-Hook meldete im `-p`-Lauf „Hook cancelled“ (Prozessende, die Daten waren schon da).

## Grenzen

- **Kern-Änderungen gehen nur noch über das Factory-Repo:** eine Änderung an Besitz-Dateien in kubernia macht `check:factorydrift` rot; der Weg ist upstream ändern, taggen, neu syncen. Offene Branches, die Besitz ändern, müssen vor dem Merge so umgezogen werden. Einen Befund-Weg ins Factory-Repo gibt es bis K11 ([#1884](https://github.com/fluffels/kubernia/issues/1884)) nicht.
- **Besitz-Texte nennen weiter Kern-Test-Pfade** (etwa Kommentare in Besitz-Skripten, Prompt-Texte); sie liegen im Besitz und lassen sich nur upstream ändern (Sammelticket-Zeile).
- **Der Wegtext des Drift-Gates** nennt „neu taggen“ nicht ausdrücklich (Besitz, upstream).

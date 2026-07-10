# Häufig gestellte Fragen zum Agenten-Harness (FAQ)

> Fragen, die im Umfeld dieses Projekts wiederkehrend zum Agenten-Harness aufkommen — hier einmal zentral beantwortet statt einzeln immer wieder neu. Ergänzt [agent-harness.md](agent-harness.md) (die erklärende Gesamtsicht) um konkrete Einzelfragen, ohne sie zu duplizieren. Bei Konflikt gelten [AGENTS.md](../AGENTS.md)/[CLAUDE.md](../CLAUDE.md).

## Wie kommt das CI-Ergebnis zum Agenten zurück? Läuft dafür ein GitHub-MCP-Server?

Kein MCP-Server nötig. Der Agent öffnet den PR und ruft danach blockierend `gh pr checks <nr> --watch` auf (normale `gh`-CLI über die Shell) — der Befehl wartet, bis alle Checks durchgelaufen sind, und liefert den Status zurück. Es gibt keinen Push-Mechanismus (die CI meldet sich nicht aktiv beim Agenten); das Warten läuft als blockierendes Polling im selben Aufruf. Ist die CI grün, mergt `gh pr merge --auto` von selbst; ist sie rot, liest der Agent die Fehlerausgabe aus demselben `gh`-Aufruf, fixt auf dem Branch und stößt den nächsten Push + `--watch`-Lauf an. Dieselbe normale Shell + `gh`-CLI reicht für den gesamten Workflow (Issue claimen, Worktree, Board pflegen, PR mergen) — kein projektspezifischer MCP-Server nötig.

## Ist Kubernia irgendwo deploybar, oder läuft es nur lokal?

Beides. Der Standard-Build (`npm run build`) ist schon ein statisches Bundle ohne eigenes Backend/DB ([ADR 0002](adr/0002-kein-backend-keine-db.md)) — es lässt sich auf jedem Webserver hosten, der statische Dateien ausliefert. Zusätzlich gibt es `npm run build:offline`: eine einzige self-contained `dist-offline/index.html` (alle Assets inline), die sich per Doppelklick lokal öffnen lässt. Beide Wege entstehen aus derselben Quelle; welcher Vertriebsweg (Web-Hosting vs. Desktop-Distribution) am Ende der bevorzugte ist, ist bewusst offen gehalten ([ADR 0005](adr/0005-auslieferungsform.md)).

## Lässt sich der komplette Agenten-Harness 1:1 auf ein anderes Projekt übertragen?

Nein, nicht 1:1 — die projektspezifische Qualitäts-Harness (§2 in [agent-harness.md](agent-harness.md)) hat zwei Unter-Schichten mit unterschiedlicher Portabilität:

- **Workflow-/Orchestrierungs-Schicht (voll portabel, stack-unabhängig):** Board-getriebene Ticket-Auswahl, `git worktree` pro Agent als Kollisionsschutz, Skills als kodifizierte Abläufe. Läuft über Git/CLI/`gh`, kennt die Programmiersprache des Zielprojekts gar nicht.
- **Verifikations-/Gate-Schicht (Konzept portabel, Tooling stack-gebunden):** dependency-cruiser, die ESLint-Komplexitätsregeln, die handgeschriebenen Node-Skripte (`check:docmap`, `check:size` …) sind auf Kubernias TypeScript/Vite-Stack zugeschnitten. Für ein anderes Zielprojekt trägt das *Prinzip* (Schichtung erzwingen, Doku-Drift verhindern), das *Werkzeug* muss für den Zielstack ausgetauscht werden (z. B. ArchUnit statt dependency-cruiser bei Java/Kotlin).

Kurzformel: das Prinzip kopieren, nicht den Code.

## Warum prüft die Mauer erst im PR-Gate (CI) und nicht direkt als Hook nach jedem Edit?

Drei Gründe, warum die Naht bewusst am PR liegt und nicht am einzelnen Tool-Call:

- **Granularität.** Viele Gates urteilen über einen kohärenten fertigen Zustand, nicht über einen einzelnen Edit: `check:arch` prüft den ganzen Dependency-Graph, `check:docmap` die Doku-Landkarte gegen den ganzen Code, `check:diffsize` den PR gegen die Basis. Ein Hook nach jedem Edit würde ständig auf völlig legitimen Zwischenständen rot werden, etwa wenn eine neue Datei noch nicht in der Doku steht oder man mitten im Refactoring kurz eine Schicht verletzt.
- **Zentralisierung über parallele Worktrees.** Mehrere Agenten arbeiten in eigenen `git worktree`s (§2.3 in [agent-harness.md](agent-harness.md)); ein lokaler Dev-Hook müsste in jedem Worktree gleich konfiguriert sein, sonst driftet er. Der Required Check auf dem PR gilt dagegen zentral serverseitig, einmal definiert, egal welcher Agent den Branch gebaut hat.
- **Kosten.** Ein paar Gates sind schlicht teuer (Coverage-Instrumentierung kostet gemessen +6 Sekunden); das nach jedem Edit statt einmal pro PR zu fahren, würde sich aufsummieren.

Lokal gibt es trotzdem etwas Ähnliches: `npm run verify` fährt der Agent selbst vor dem PR, plus der pre-push-Hook (siehe [AGENTS.md](../AGENTS.md)) als Netz — ausgelöst durch „fertig", nicht durch jeden einzelnen Edit.

**Nachfrage: Wäre ein Stop-Hook (feuert, wenn der Agent seinen Turn beendet, nicht bei jedem Edit) nicht näher dran?** Das Kosten-Argument oben gilt nur für einen Hook nach jedem einzelnen Edit — bei „einmal pro Stop" fällt es weg, das ist genauso günstig wie einmal pro PR. Trotzdem bleibt ein Stop-Hook strukturell eine sehr elaborierte Bitte, keine Mauer: er läuft nur, wenn die Hook-Konfiguration im jeweiligen Worktree vorhanden ist und der Prozess nicht abstürzt, und er ist unklar darin, ob „Stop" beim autonomen Agenten zuverlässig genau dann feuert, wenn der Code wirklich PR-reif ist. Der Required Check auf dem PR bleibt die eigentliche Mauer, weil GitHub den Merge ohne ihn strukturell verweigert, unabhängig davon, ob und wie lokal geprüft wurde. Ein Stop-Hook wäre trotzdem ein sinnvoller zusätzlicher Frühindikator (Upgrade von „`npm run verify` läuft, weil es in der Anweisung steht" zu „läuft garantiert, sobald der Agent fertig ist") — er ersetzt die CI nicht, er ergänzt sie nur um schnelleres lokales Feedback. Noch nicht umgesetzt, siehe [#708](https://github.com/fluffels/kubequest/issues/708).

**Widerspricht der Worktree-Guard-Hook (#735) dann nicht Punkt 2 oben?** Nein, er löst genau das Drift-Problem, statt es zu ignorieren: `.claude/settings.json` ist bewusst NICHT gitignored (Ausnahme wie `.claude/skills/`), landet also als getrackte Datei automatisch in jedem Checkout/Worktree — kein separater Verteilschritt, kein Drift-Risiko. Das ändert nichts an Punkt 1/3 oben (Granularität/Kosten sprechen weiterhin gegen Hooks für die großen Mehrdatei-Gates wie `check:arch`/`check:diffsize`) — #735 ist bewusst schmal geschnitten: EIN Hook für EINE irreversible Fehlaktion (Commit/Push vom falschen Ort), nicht ein Ersatz für den PR-Gate.

## Was passiert, wenn der Agent bei einem roten PR nach mehreren Versuchen nicht weiterkommt?

Bis vor Kurzem: nichts Definiertes. Die Regel war nur „auf demselben Branch fixen, bis grün" — ohne Obergrenze. Blieb ein Agent an derselben roten Prüfung hängen, gab es keinen Stopp-Punkt außer einem zufällig bemerkten offenen oder roten PR.

Seit dem **Festgefahren-Protokoll** ([AGENTS.md](../AGENTS.md), #710) gilt: nach drei erfolglosen Versuchen, denselben Check zu fixen (push → rot → fixen → push, dreimal ohne dass der ursprüngliche Fehler behoben wird), bricht der Agent die Fix-Schleife ab. Er postet **einen** konsolidierten Kommentar auf dem PR (was versucht wurde, der aktuelle Fehler, 2-3 konkrete Entscheidungsoptionen), setzt das Label `status:festgefahren` und bleibt **assigned**, damit kein anderer Agent das Ticket parallel greift.

Wichtig dabei: das ist eine **Verhaltensregel, kein Gate**. Nichts erzwingt technisch, dass der Agent nach drei Versuchen wirklich aufhört — ein echter, erzwungener Stopp bräuchte einen Zähler außerhalb der Agenten-Session (z. B. ein Wrapper-Skript, das fehlgeschlagene `gh pr checks`-Läufe von außen mitzählt). Das existiert bisher nicht, siehe [agent-harness.md › Wo die Grenzen sind](agent-harness.md).

## Verwandte Dokumente

- [agent-harness.md](agent-harness.md) — die erklärende Gesamtsicht auf den Harness
- [AGENTS.md](../AGENTS.md) — operative Arbeitsanweisung
- [CLAUDE.md](../CLAUDE.md) — Schnellstart + Repo-Landkarte

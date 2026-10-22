# 🛠️ Befehle

> **Kanonische Heimat der Befehlsliste** (nicht doppelt gepflegt, #1078): [AGENTS.md](../../AGENTS.md), [CONTRIBUTING.md](../../CONTRIBUTING.md) und die [README](../../README.md) verweisen hierher, statt eigene Listen zu führen. On-demand-Referenz — nur lesen, wenn du einen Befehl nachschlägst. Manche Skripte sind **nur** hier dokumentiert — eine Zeile entfernen ⇒ `check:docdrift` wird rot (diese Datei ist ein `CORE_DOCS`-Eintrag in [`scripts/check-docdrift.mjs`](../../scripts/check-docdrift.mjs)).
>
> Die Gate-Markierungen („hart", „blockt") geben die **maschinelle** SSOT wieder (die `scripts/check-*.mjs`, CI) — wann welches Gate grün sein muss und dass es **kein Grün-durch-Aufweichen** gibt, steht ausschließlich in [AGENTS.md](../../AGENTS.md#das-wichtigste-zuerst-harte-regeln).

## ⚡ Erste Minute (nur Mechanik – der Ablauf steht in AGENTS.md)

```bash
npm run setup   # einmalig: Node-Check, Skill-Zeiger, npm install, Git-Hooks, alle Checks (Minimalweg: npm install)
npm run dev     # Dev-Server – angezeigte Adresse im Browser öffnen
npm run verify  # alle schnellen Gates auf einmal (wann sie grün sein müssen: AGENTS.md)
```

Der verbindliche Ticket-Ablauf steht in [AGENTS.md › Das Wichtigste zuerst](../../AGENTS.md#das-wichtigste-zuerst-harte-regeln) und [AGENTS.md › Wo die TODOs leben](../../AGENTS.md#wo-die-todos-leben), nicht hier.

⚠️ **Die rohe `index.html` im Root ist die Dev-Version** und braucht den Vite-Server; per Doppelklick geöffnet bleibt die Seite leer. Zum Offline-Spielen `npm run build:offline`, dann `dist-offline/index.html` doppelklicken. (Dass eine JS/TS-Änderung im Dev-Server **keinen** Auto-Reload auslöst, steht in [AGENTS.md › Im Browser verifizieren](../../AGENTS.md#das-wichtigste-zuerst-harte-regeln).)

## Alle Befehle

| Zweck | Befehl |
|---|---|
| One-Command-Setup (Node-Check + Skill-Zeiger + install + Git-Hooks + alle Checks, #387/#528) | `npm run setup` |
| Skill-Zeiger unter `.claude/skills/` aus den Skill-Quellen `.agents/skills/` erzeugen oder prüfen (#1848): `--check` schreibt nie, `--prune` entfernt den Zeiger-Ordner eines gelöschten Quell-Skills (nie Volltext oder fremde Dateien, es meldet sie nur; `--check` ist bei Volltext und losen Dateien rot), `--tool claude` ist Default | `npm run skills:sync` |
| **Alle Gates auf einmal – das eine Kommando vor dem Merge (#527)** | `npm run verify` (die Kette steht in `package.json` › `scripts.verify`, nicht hier kopiert; ohne `check:bundle`, das braucht die Builds) |
| Bundle-Budget vorab prüfen (#1331): nötig, wenn der Diff ausgelieferten Code, Assets oder Dependencies hinzufügt (`src/**` ohne reine Tests, auch Content-JSON unter `src/content/data/`, `assets/**`, `package.json`); `verify` deckt es nicht ab, erst `verify:full`/CI | `npm run verify:bundle` (= `build` + `build:offline` + `check:bundle`) |
| Voller Vor-Push-Check inkl. beider Builds + Boot-Smoke (#527) | `npm run verify:full` (= `verify` + `test:coverage` + `check:diffcoverage` + Builds + `check:bundle` + `test:smoke`) |
| Volle Gate-Kette kompakt (#1120): dieselbe Kette wie `verify`, jeder Schritt einzeln, alle Gates ohne Abbruch, bei Grün eine Zeile, bei Rot nur die roten Blöcke; der Abschluss-Lauf der Agenten | `npm run verify:kompakt` |
| Gezielt iterieren (#1120): Lint und Tests nur für den Slice samt Tests, die eine geänderte Datei lesen, alle anderen Gates voll; kein Gate, ersetzt nie den vollen Lauf | `npm run verify:changed` |
| Required-Checks auf dem PR = maßgeblicher Gate (server-seitig, seit #592) | `gh pr merge <nr> --squash --delete-branch --auto` + `gh pr checks <nr> --watch --interval 30` (der Umsetzer-Subagent: `node scripts/pr-warten.mjs <nr>`, bei Exit 2 erneut; Regel-Heimat: [AGENTS.md](../../AGENTS.md#das-wichtigste-zuerst-harte-regeln)) |
| pre-push-Hook (fährt `verify`; seit #592 nur noch sekundäres Netz) | verdrahtet via `npm run setup`; auf `main` das volle `verify`, bei anderen Branches nur `check:diffsize` (Abbruch bei Rot, Hinweis auf `KQ-Diffsize-Override`) |
| `gh`-Abfragen und Zählungen: Standardgrenzen beachten (#1349) | `gh issue list` ohne `--limit` liefert nur 30 Treffer (`--limit 500`), `gh api` ohne `--paginate` nur die erste Seite (`--paginate --slurp`); jede neue Abfrage oder Zählung darauf prüfen, auch im Delta eines Fixes (Architektur-Lens); für `gh issue|pr list` in Workflows und Skripten erzwingt `test/harness/gh-list-limit.test.ts` das `--limit` |
| Agenten-Sandbox prüfen (#1432, berichtend, Exit 0): Plattform, `bwrap`/`socat`, `wsl.conf`, User-Settings, Verhaltensprobe; `--vorlage` druckt die User-Settings-Vorlage (ohne Secret-Werte) | `node scripts/sandbox-doctor.mjs --check` / `--vorlage` / `--sessionstart` (SessionStart-Hook, meldet die Windows-Sperre) ([Doku](../agent-harness.md#agenten-sandbox-wsl2)) |
| MCP-Ausfälle belegen (#1634, berichtend, Exit 0): wertet die Claude-Code-Logs der Server aus `.mcp.json` aus (Reconnect, npx-Ersatzweg, Abbruch, Server-stderr); `--seit <ISO\|Nh>` (Standard 24 h), `--json` Rohzeilen; der SessionStart-Hook ruft es mit `--sessionstart` | `node scripts/mcp-ausfall.mjs` |
| Langfuse-Vorbedingung prüfen (#1663): `GET <LANGFUSE_BASE_URL>/api/public/health` mit 3 s Frist, Exit 0 erreichbar, 1 aus (der Ticket-Skill stoppt dann); mit `--sessionstart` immer Exit 0 und Warnung auf stdout (SessionStart-Hook); mit `--json` stdout `{"erreichbar":bool,"grund":string|null}` bei gleichen Exit-Codes (Cockpit, nicht mit `--sessionstart` kombinierbar) | `node scripts/langfuse-vorbedingung.mjs [--sessionstart | --json]` |
| Erstinstallation | `npm install` |
| Dev-Server | `npm run dev` |
| Host-/Prod-Build (Multi-File nach `dist/`) | `npm run build` |
| Offline-Build (self-contained `dist-offline/index.html`) | `npm run build:offline` |
| Dev-Panel-Build (#331, Panel MIT, passwortgated, `dist-devpanel/`) | `npm run build:devpanel` |
| Tests (lokal auf 25 % der Kerne begrenzt, #1331: parallele Läufe von Lenses/Playwright/anderen Worktrees ließen sonst die store-Tests ins Timeout laufen; die CI nutzt den Standard) | `npm test` (Vitest); mehr Worker: `npm test -- --maxWorkers=<n>` |
| Coverage-Gate (v8, Schwellen PRO Schicht statt Repo-Mittel, #495) | `npm run test:coverage` |
| Boot-Smoke-Test (headless, gegen Offline- und Host-Build, #391/#1408) | `npm run smoke` (baut Host + Offline + Playwright) bzw. `npm run test:smoke` (nur Lauf, beide Builds müssen da sein); meldet Playwright `Executable doesn't exist ... chromium_headless_shell-<build>`: `npm ci`, dann `npx playwright install chromium` |
| Typen prüfen (voll strict) | `npm run typecheck` |
| Linter (ESLint, #389; Komplexitäts-Gates complexity/max-lines-per-function/max-depth #502) | `npm run lint` |
| Stale Suppressions prunen / Baseline neu aufbauen (Komplexität #502 + Typsicherheit #868) | `npm run lint:prune` / `npm run lint:suppress` |
| Quiz-Korrektheits-Golden nach bewusstem Review aktualisieren (#597) | `npm run quiz:golden` |
| Sprite-Sheets aus Quell-PNGs neu packen (nach Asset-Änderung, #339) | `npm run pack:sprites` |
| Architektur-Wächter (Schichtung + Zyklen + Orphans, #347/#390) | `npm run check:arch` |
| Dateigröße-Wächter (God-File-Budget 800 LOC, #390) | `npm run check:size` |
| Kontextdatei-Wächter (Zeichen-Budget für jede AGENTS.md, Wurzel + modul-lokal, #719/#1064/#1088) | `npm run check:contextsize` |
| Tiefendoc-Abdeckungs-Wächter (jede `src/`-Datei in einem `docs/module/`-Tiefendoc, #482/#907) | `npm run check:docmap` |
| Factory-Besitz in ein Projekt übertragen (nur Besitz laut `.factory/besitz.json`, kein Merge, idempotent; Trockenlauf mit `--trocken`, #1613; liest aus einem Tag der Quelle, ohne `--tag` bricht der Sync ab, nur `--entwurf` liest den Arbeitsbaum, #1871) | `npm run factory:sync -- --quelle <pfad> (--tag <name> \| --entwurf) [--ziel <pfad>] [--trocken]` |
| Drift-Wächter (Besitz laut Sync-Stand unverändert, entfällt ohne `.factory/sync-stand.json`, #1613; rot auch ohne `tag` oder bei `sauber: false` im Stand, #1871) | `npm run check:factorydrift` |
| Projektwert-Stellen aus der Config prüfen oder erzeugen (Markdown-Block und Frontmatter-Zeile, #1746; `check:factorydrift` prüft sie immer gegen `.factory/projekt.json`, auch ohne Sync-Stand) | `node scripts/projektwerte.mjs --check` bzw. `--write` |
| Harness-Drift-Wächter (dokumentierte `npm run`-Kommandos + interne Doku-Links/Anker, #529) | `npm run check:docdrift` |
| Lebende-Doku-Wächter (generierte Abschnitte `<!-- GEN:<name> START/END -->` in README/docs gegen das Repo, #1355, [ADR 0017](../adr/0017-lebende-doku-generierte-abschnitte.md)) | `npm run check:docgen` |
| Architekturmodell-Wächter (LikeC4-Modell `docs/architektur/` validiert, formatiert und gegen `scripts/layers.cjs`, `src/`, die hexagonale Sicht in arc42 und die Harness-Quellen (`.claude/`, Hooks, Gates, CI, `.mcp.json`) abgeglichen, Pflicht-Views, #1420, [ADR 0020](../adr/0020-architekturmodell-likec4.md)) | `npm run check:c4` (Format reparieren: `npm run c4:format`; im Browser ansehen: `npm run c4:serve`) |
| Generierte Doku-Abschnitte neu schreiben (nach Änderung an `package.json`-Ketten, `.claude/`, `.mcp.json`, `scripts/layers.cjs`, der Config `scripts/docs-gen/config.json`, nach der ersten oder letzten Importkante zwischen zwei Schichten, einem neuen ADR oder `docs/meilensteine.json`, den Vorlagen `docs/diagramme/*.mmd`, den Konstanten-Dateien der Agenten-Diagramme, den CI-Job-Namen, den Quest-Daten (`src/content/data/quests/*.json`, `quest-order.json`, `quest-topics.json`, `entities.json`, `npcs.json`) oder `src/store/save-versionen.json` und `CURRENT_SAVE_VERSION`, #1355, #1367, #1369, #1370) | `npm run docs:gen` |
| Steuerbyte-Wächter (jede getrackte Textdatei auf NUL und andere C0-Steuerbytes außer Tab/LF/CR, #1428, #1460) | `npm run check:steuerbytes` |
| Interne-Referenzen-Wächter (Arbeitgeber-/Kundenbezüge aus dem öffentlichen Repo halten, #990) | `npm run check:internalrefs` (prüft getrackte Dateien und die Commit-Messages des Branches; Herkunftsbegriff ergänzen: `node scripts/check-internalrefs.mjs --add "<begriff>"`, Namensbezug als Wortstamm: `--add-name "<begriff>"`; PR-Titel/-Body (manuell, nicht in CI): `… \| node scripts/check-internalrefs.mjs --text`) |
| Sammelticket anlegen und Position prüfen, idempotent (#1390) | `node scripts/sammelticket-anlegen.mjs harness [--vorgaenger <nr>]` / `langfuse [--top]` (`--dry-run` zeigt nur an) |
| Ticket-Lock gegen doppelte Sessions am selben Ticket (#1561) | `node scripts/ticket-lock.mjs claim <nr> [--wiederaufnahme]` / `lebenszeichen <nr> --nonce <x> [--schritt <text>]` und `lebenszeichen --commit` / `pruefe <nr> [--nonce <x>]` / `uebernehmen <nr> --nonce <x> --nachfolger` / `uebergeben <nr> --nonce <x>` / `gestoppt <nr> --nonce <x>` / `freigeben <nr> --nonce <x>` (Exit 0 ok, 4 belegt/fremd/aktiv/schon übergeben, 2 Aufruffehler; Semantik: [agent-harness §2.3](../agent-harness.md#23-kollisionsschutz-für-parallele-agenten)) |
| Verwaiste Claims melden und Erledigtes aufräumen (#1699): Locks und saubere Worktrees geschlossener Issues mit gemergtem PR, Zeilen `WIEDERAUFNAHME #<nr>`; `--json` liest nur (Exit 0 ok, 1 Aufräumschritt gescheitert, 2 Aufruf-/git-/gh-Fehler, 5 Kontingent knapp) | `node scripts/claims-pruefen.mjs [--json] [--stunden <n>]` |
| Projektwert aus der Projekt-Config lesen (#1611): Repo, Board-Besitzer, Board-IDs, `praefixe.*`, `labels.*`, `agenten.*` aus `.factory/projekt.json`; Exit 1 bei fehlender oder unlesbarer Config oder bei einem Schlüssel, der fehlt oder kein Skalar ist, 2 bei Aufruf-Fehler (ohne Schlüssel, mit zweitem Positionsargument, unbekanntem Flag oder `--config` ohne Wert) | `node scripts/projekt-config.mjs [--config <pfad>] <schluessel.pfad>` (z.B. `boards.0.projectId`; Listenindex als Ziffer, 0 = Rolle `produkt`, 1 = Rolle `factory`) |
| Voraussetzungen der Factory im Projekt prüfen (#1799, ADR 0022): Actions, Admin-Recht, Project-Scope, Secrets, Boards und Felder, Labels, Ruleset samt Required Checks, Langfuse und gesetzte Altnamen der Kern-Umgebungsvariablen (nur `--pruefen`); je Lücke eine Zeile mit `Fix:`, Exit 0 ohne Lücke, 1 mit, 2 bei Aufruf-Fehler, unlesbarer Config oder unlesbarem Ruleset-Spiegel | `node scripts/harness-doctor.mjs --pruefen [--config <pfad>]` |
| Voraussetzungen der Factory einrichten (#1800): legt nur Umkehrbares an (fehlende Labels, `.github/workflows/harness-doctor.yml`, Harness-Sammelticket über `sammelticket-anlegen.mjs`); Ruleset, Secrets, Variablen, Project-Felder, Actions, Admin-Recht und Token nur als `ANLEITUNG … Link: …` (Langfuse prüft nur `--pruefen`); bei einer anderen `--config` als `.factory/projekt.json` legt es kein Sammelticket an (`ANLEITUNG Sammelticket`); `--dry-run` gibt nur den Plan aus (`PLAN …`); idempotent, Exit 0 nichts offen, 1 Anleitung/Plan/Fehler, 2 Aufruf-Fehler oder Config | `node scripts/harness-doctor.mjs --einrichten [--dry-run] [--config <pfad>]` |
| Wochenlauf des Doctors von Hand ansehen (#1800): schreibt jede noch nicht gemeldete Lücke als Zeile ins Harness-Sammelticket (`--dry-run`: nur anzeigen); in CI läuft er montags als `harness-doctor.yml`; Exit 0 nichts Neues oder gemeldet, 1 Doctor nicht lauffähig, kein ungeclaimtes Sammelticket oder Post-Fehler, 2 Aufruf-Fehler | `node scripts/harness-doctor-melden.mjs [--dry-run]` |
| Harness-Cockpit starten (#1764, ADR 0029): lokale, nur lesende Seite auf 127.0.0.1 mit einem Panel je Quelle (zuerst Langfuse-Erreichbarkeit); `--projekt` setzt die Projektwurzel (Standard cwd), `--port` den Port (Standard 4180, 0 = frei); Exit 2 Aufruf-Fehler, 1 Startfehler (z.B. Port belegt) | `npm run cockpit [-- --projekt <pfad>] [--port <n>]` |
| Fremdtext eines Issues/PRs sicher lesen: Autor-Prüfung, Fremdes ausgeblendet (#1433) | `node scripts/fremdtext.mjs --issue <nr>` / `--pr <nr>` (Exit 3 = Fremdeingang, 2 = Fehler) |
| Board-Takt (Status-Ticket, Harness-Sammelticket, Positionskorrektur) ansehen, ohne zu ändern (#1390) | `PROJECT_TOKEN=$(gh auth token) node scripts/board-takt.mjs --dry-run` |
| Oberstes freies Ticket der Board-Auswahl samt übersprungenen Kandidaten (Assignee, Blocker, Messfenster, Spezifikation, Branch, Worktree, PR; #1428, #1615; meldet `reparieren #<nr>`-Zeilen, schreibt nichts) | `node scripts/naechstes-ticket.mjs [--config <pfad>] [--json] (--bereich agentic\|spiel \| --ticket <nr>)` (eines von beiden ist Pflicht, sonst Exit 2; `--ticket`: Einzelprüfung einer vorgegebenen Nummer, nicht mit `--bereich`; `--config`: andere Projekt-Config, ein Ladefehler endet mit Exit 2; Exit 0 gefunden, 1 keins frei, 2 Fehler, 5 API-Kontingent knapp). `--maengel [--bereich …] [--json]` listet stattdessen freie, vertraute, unblockierte Tickets mit Spezifikations-Mangel in Board-Reihenfolge (Exit 0, #1860) |
| Neues Issue geprüft anlegen, Spezifikation prüfen, vertrautes Ticket reparieren (#1698; Exit 0 ok, 1 Spezifikation unvollständig oder Inhaltsverlust, 2 Aufruf-/gh-Fehler, 3 Fremdeingang) | `node scripts/spezifikation.mjs [--config <pfad>] pruefen\|anlegen\|reparieren\|gescheitert …` (`anlegen --titel <t> --body-datei <pfad> --label area:<x> (--nach <nr> \| --notfall <art>)`, `reparieren <nr> --body-datei <pfad>`, `gescheitert <nr> --mangel "<text>"`: scheiternde Reparatur als Zeile ins Harness-Sammelticket, #1860) |
| Holdout-Abnahme: Kriterien K1…KN eines Tickets ausgeben bzw. den Bericht des Abnahme-Agenten prüfen, den Spur-Kommentar posten und bestanden, fix oder handoff entscheiden (#1753; Exit 0 ok, 1 Bericht oder Worktree ungültig, 2 Aufruf-/gh-Fehler, 3 Fremdeingang, 5 API-Kontingent knapp) | `node scripts/abnahme.mjs [--config <pfad>] kriterien <nr>` / `auswerten <nr> --pr <pr> --bericht <datei> --worktree <pfad> --head <sha>` |
| GitHub-API-Kontingent anzeigen (Exit 5 bei < 10 %) bzw. Kosten je Skript aus dem Lauf-Log (#1549) | `node scripts/gh-kontingent.mjs [--bericht]` |
| Budget-Pacing: darf das nächste Ticket starten? (Wochenlimit des Kontos, #1358; Exit 0 ok, 3 knapp, 4 stopp) | `node scripts/budget-pacing.mjs [--json] [--ohne-probe]` |
| Neue Advisories aus `npm audit` und Dependabot einordnen: Zeile im Sammelticket, Alarm nur bei critical und Produktiv-Abhängigkeit (Trockenlauf mit `--dry-run`; läuft täglich als Workflow, #1628) | `node scripts/audit-einordnung.mjs [--dry-run]` |
| Offene Code-Scanning-Alerts (CodeQL, Scorecard) einordnen: CodeQL high/critical ein Ticket an der Board-Spitze, sonst Zeilen im Sammelticket (Trockenlauf mit `--dry-run`; läuft wöchentlich als Workflow, #1436) | `node scripts/codescanning-inbox.mjs [--dry-run]` |
| Fällige Wiedervorlagen als Ticket ganz oben anlegen (Trockenlauf mit `--dry-run`; läuft täglich als Workflow, Exit 1 bei fälligem Eintrag ohne Ticket, #1628) | `node scripts/wiedervorlage.mjs [--dry-run]` |
| Mehrere Tickets einsortieren, eine Listenabfrage (#1217) | `node scripts/board-place.mjs --top <nr>…` / `--after <ankernr> <nr>…` (klemmt hinter das ungeclaimte Sammelticket; ganz oben nur `--notfall <art> --top`); `--umzug [--dry-run]` zieht Items vom falschen aufs richtige Board (Trennregel, #1730); alle Board-Skripte laden die Projekt-Config beim Import (`ladeProjektOderAbbruch` in `board-lib.mjs`): fehlt sie oder ist sie ungültig, folgt eine `✖`-Zeile samt Fix und Exit 2 (wie ein Aufruf-Fehler) |
| Doku-Aktualitäts-Wächter (offen-markierte Roadmap-Tickets und die Ausnahmelisten `ausnahmen.*` der Config gegen den gh-Status, non-blocking, braucht `gh`, #610) | `npm run check:doctickets` |
| TS-7-Freigabe-Wächter (npm-Registry: erlaubt typescript-eslint schon TS 7? non-blocking, braucht Netz, #847) | `npm run check:tseslint-ts7` |
| Diff-Größenbudget-Wächter (max. 20 Dateien / 800 geänderte Zeilen gegen main, #533) | `npm run check:diffsize` |
| Ergebnis je Ticket-Lauf aus git und GitHub (#1123; Doku: model-routing › Ergebnis je Ticket-Lauf), `--start-agent <typ>` wählt die PRs über den ersten Lauf je Ticket (#1646) | `node scripts/lauf-ergebnis.mjs --von <ISO> --bis <ISO> [--ticket <nr>…] [--ohne <nr>…] [--start-agent <typ>] [--json]` |
| Langfuse-Abgleich je Call, nur lesend: welche Calls des Transkripts fehlen in Langfuse oder stehen doppelt (#1562; Doku: model-routing › Checkliste Punkt 1) | `node scripts/langfuse-abgleich.mjs --pruefen [--seit <ISO>] [--session <id>] [--ist <datei>…] [--json]` (ohne Secret-Key `--ist` mit einem `queryMetrics`-Export) |
| Fehlende Calls per OTLP nachliefern, idempotent, Dubletten nur gemeldet (#1577; Doku: model-routing › Checkliste Punkt 1) | `node scripts/langfuse-nachliefern.mjs [--session <id>] [--seit <ISO>] [--aktuell <id>] [--beendet <id>] [--ausloeser sessionstart\|sessionend] [--trocken] [--json]` (braucht `LANGFUSE_SECRET_KEY`; `--trocken` sendet nichts, ohne `--trocken` nimmt der Lauf den Lock; automatisch an SessionStart/SessionEnd über `scripts/langfuse-abgleich-hook.mjs`, #1578: [Hook-Patch › Abgleich als Garantie](../langfuse-hook-patch.md#abgleich-als-garantie-1578)) |
| Review-/Plan-Nachweis prüfen (Commit-Zeilen `KQ-Plan:`/`KQ-Review:`, #1270; Präfix und Planer aus der Projekt-Config; kein `npm run`, nicht in `verify`) | `node scripts/check-review-nachweis.mjs [--config <pfad>]` |
| Abnahme-Nachweis prüfen (Commit-Zeile `KQ-Abnahme:` plus vertrauter PR-Kommentar mit Marker, ADR 0022 F13, #1755; liest `FACTORY_PR_BODY`, `FACTORY_PR_NUMBER`, `FACTORY_PR_DRAFT` und `GH_TOKEN` aus der Umgebung; kein `npm run`, nicht in `verify`) | `node scripts/check-abnahme-nachweis.mjs [--config <pfad>]` |
| Verwaiste Worktree-Ordner finden und mit `--fix` entfernen (#908); mit `--branches` lokale `feature/kq-*`-Branches nach dem Squash-Merge aufräumen, auch fremde (verlustfrei: Muster `feature/kq-*`, nur `[gone]`, nicht ausgecheckt, Spitze = gemergter PR-Kopf), ohne `--fix` nur die Liste; vorher holt es selbst `git fetch --prune origin` (scheitert der Fetch oder `gh`, wird nichts gelöscht) (#1579) | `node scripts/cleanup-worktrees.mjs [--fix]` / `--branches [--fix]` |
| Merge von `origin/main` auf verlorene Tests prüfen: Testtitel gegen beide Eltern, bei Konflikt vor dem Merge-Commit, sonst danach; Exit 1 = ein Test fehlt im Ergebnis, Exit 2 = kein Merge, nichts zu prüfen (#1579) | `node scripts/merge-testabgleich.mjs` |
| Diff-Coverage-Wächter (geänderte Zeilen pro Slice getestet; **hart** für Domäne/Anwendung, Präsentation/Einstieg nur berichtend; läuft **NACH `test:coverage`**, #1021) | `npm run check:diffcoverage` |
| `no-explicit-any`-Suppression-Ratchet (per-Datei-Baseline, #604) | `npm run check:anysuppress` (neu ziehen: `node scripts/check-any-suppressions.mjs --write`) |
| Lockfile-Integritäts-Wächter (package-lock.json ↔ package.json, gegen Lockfile-Drift, #593) | `npm run check:lockfile` |
| Bundle-Byte-Budget-Wächter (je Chunk-Art: Offline-HTML ohne Content, Spielcode, Content-Chunks, Phaser-vendor, NACH den Builds, #503/#595/#1408) | `npm run check:bundle` |
| CycloneDX-SBOM aus dem Lockfile erzeugen und prüfen (CI-Artefakt `kubernia-sbom-cyclonedx`, #1617) | `npm run sbom` |
| Duplikations-Report (jscpd, **weich/nicht-blockierend** — kein Gate, nur CI-Artefakt, #612) | `npm run check:duplication` |
| Security-Audit (Produktiv-Deps, CI-Gate blockt bei high+, #396) | `npm audit --omit=dev --audit-level=high` |

> Aus IntelliJ/WebStorm gibt es dieselben Befehle als Ein-Klick-Run-Configs: [CONTRIBUTING.md › Aus IntelliJ starten](../../CONTRIBUTING.md#aus-intellij-starten-ein-klick).

## Umgebungsvariablen

Welche Umgebungsvariable ein Werkzeug liest (#1824, [ADR 0022](../adr/0022-dark-factory-kern-und-verteilung.md#fortschreibung-1824-2026-10-21-umgebungsvariablen-ohne-projektpräfix-f3-teil-8)). Eine Variable, die ein Kern-Werkzeug liest, heißt `FACTORY_<NAME>` und wird über `umgebungsWert` aus `scripts/projekt-config-lib.mjs` gelesen. **Altname:** derselbe Name mit dem Commit-Zeilen-Präfix ohne Bindestrich statt `FACTORY_`. Er wird nicht mehr gelesen; `harness-doctor --pruefen` meldet einen noch gesetzten Altnamen mit einer `Fix:`-Zeile. Die Kern-Reinheit zählt den Altnamen als Begriff `Env`, in Kern-Einheiten steht er nicht. Bewacht wird das Inventar von `test/harness/umgebungsvariablen-inventar.test.ts` (Ring `Kern`, beide Richtungen gegen die `umgebungsWert`-Literale in `scripts/`).

| Name | Ring | Wer setzt ihn | Wer liest ihn |
| --- | --- | --- | --- |
| `FACTORY_DIFF_BASE` | Kern | Workflow `ci.yml` (Schritt „Diff-Basis bestimmen“); lokal optional die Maintainerin; in Tests `test/diffsize.test.ts`, `test/diffcoverage.test.ts`, `test/review-nachweis.test.ts`, `test/abnahme-nachweis.test.ts`, `test/slice-override.test.ts` | `resolveBase` (`scripts/check-basis.mjs`): `check-diffsize`, `check-diffcoverage`, `check-lockfile`, `check-review-nachweis`, `check-abnahme-nachweis`, `verify-lauf` |
| `FACTORY_DIFFSIZE_MAX_FILES` | Kern | Testskript `test/diffsize.test.ts` | `check-diffsize` |
| `FACTORY_DIFFSIZE_MAX_LINES` | Kern | Testskript `test/diffsize.test.ts` | `check-diffsize` |
| `FACTORY_PR_NUMBER` | Kern | Workflow `ci.yml`; Testskript `test/abnahme-nachweis.test.ts` | `check-abnahme-nachweis` |
| `FACTORY_PR_DRAFT` | Kern | Workflow `ci.yml`; Testskript `test/abnahme-nachweis.test.ts` | `check-abnahme-nachweis` |
| `FACTORY_PR_BODY` | Kern | Workflow `ci.yml`; Testskript `test/abnahme-nachweis.test.ts` | `check-abnahme-nachweis` |
| `FACTORY_GH_KOSTEN_LOG` | Kern | die Maintainerin (optional); Testskripte `test/messskripte-namen.test.ts`, `test/support/mess-golden-faelle.mjs` | `kontingent-lib`, `gh-kontingent` |
| `FACTORY_MCP_LOG_DIR` | Kern | Testskripte `test/harness/mcp-ausfall.test.ts`, `test/harness/lebenszyklus-namen.test.ts` | `mcp-ausfall` |
| `FACTORY_MCP_AUSFALL_STAND` | Kern | Testskript `test/harness/mcp-ausfall.test.ts` | `mcp-ausfall` |
| `FACTORY_PACING_ZIELQUOTE` | Kern | die Maintainerin (Shell oder `env` in `.claude/settings.local.json`); Testskript `test/budget-pacing.test.ts` | `budget-lib` |
| `FACTORY_PACING_PROBE_SKRIPT` | Kern | Testskript `test/budget-pacing.test.ts` | `budget-pacing` |
| `FACTORY_RATE_LIMITS_SNAPSHOT` | Kern | Testskripte `test/budget-pacing.test.ts`, `test/statusline.test.ts` | `budget-lib` |
| `FACTORY_STATUSLINE_DURCHREICHEN` | Kern | Skript `statusline` (Schleifenschutz für die durchgereichte Statusline) | `statusline` |
| `FACTORY_USER_SETTINGS` | Kern | Testskript `test/statusline.test.ts` | `statusline` |
| `FACTORY_TEST_FEHLT` | Kern | nie gesetzt (Absenz-Fixture im Testskript `test/harness/mcp-ausfall.test.ts`) | `mcp-ausfall` (Test des Fehlerpfads) |
| `KQ_UPDATE_QUIZ_GOLDEN` | Projekt | Skript `quiz-golden` | Test `quizcheck` |
| `KQ_GIT_SAFECRLF` | Projekt | Testskript `test/support/git-umgebung.ts` (Guard) | `test/support/git-umgebung.ts` (liest und setzt) |
| `VITE_KQ_DEVPANEL_PW` | Projekt | die Maintainerin (Repo-Variable, `docker run -e`) | Vite-Build |

**Zählung:** 18 Variablen (15 Kern, 3 Projekt), eine Zeile je Variable.

`__KQ_DEVPANEL__` und `__KQ_CONFIG__` sind Vite-Konstanten, keine Umgebungsvariablen. Die Override-Variablen der Slice-Gates sind entfallen: dafür gibt es Commit-Zeilen (siehe [agent-harness](../agent-harness.md)).

# 🛠️ Befehle

> **Kanonische Heimat der Befehlsliste** (nicht doppelt gepflegt, #1078): [AGENTS.md](../../AGENTS.md), [CONTRIBUTING.md](../../CONTRIBUTING.md) und die [README](../../README.md) verweisen hierher, statt eigene Listen zu führen. On-demand-Referenz — nur lesen, wenn du einen Befehl nachschlägst. Manche Skripte sind **nur** hier dokumentiert — eine Zeile entfernen ⇒ `check:docdrift` wird rot (diese Datei ist ein `CORE_DOCS`-Eintrag in [`scripts/check-docdrift.mjs`](../../scripts/check-docdrift.mjs)).
>
> Die Gate-Markierungen („hart", „blockt") geben die **maschinelle** SSOT wieder (die `scripts/check-*.mjs`, CI) — wann welches Gate grün sein muss und dass es **kein Grün-durch-Aufweichen** gibt, steht ausschließlich in [AGENTS.md](../../AGENTS.md#das-wichtigste-zuerst-harte-regeln).

## ⚡ Erste Minute (nur Mechanik – der Ablauf steht in AGENTS.md)

```bash
npm run setup   # einmalig: Node-Check, npm install, Git-Hooks, alle Checks (Minimalweg: npm install)
npm run dev     # Dev-Server – angezeigte Adresse im Browser öffnen
npm run verify  # alle schnellen Gates auf einmal (wann sie grün sein müssen: AGENTS.md)
```

Der verbindliche Ticket-Ablauf steht in [AGENTS.md › Das Wichtigste zuerst](../../AGENTS.md#das-wichtigste-zuerst-harte-regeln) und [AGENTS.md › Wo die TODOs leben](../../AGENTS.md#wo-die-todos-leben), nicht hier.

⚠️ **Die rohe `index.html` im Root ist die Dev-Version** und braucht den Vite-Server; per Doppelklick geöffnet bleibt die Seite leer. Zum Offline-Spielen `npm run build:offline`, dann `dist-offline/index.html` doppelklicken. (Dass eine JS/TS-Änderung im Dev-Server **keinen** Auto-Reload auslöst, steht in [AGENTS.md › Im Browser verifizieren](../../AGENTS.md#das-wichtigste-zuerst-harte-regeln).)

## Alle Befehle

| Zweck | Befehl |
|---|---|
| One-Command-Setup (Node-Check + install + Git-Hooks + alle Checks, #387/#528) | `npm run setup` |
| **Alle Gates auf einmal – das eine Kommando vor dem Merge (#527)** | `npm run verify` (typecheck → lint → check:arch → check:size → check:contextsize → check:anysuppress → check:docmap → check:docdrift → check:internalrefs → check:lockfile → check:diffsize → test) |
| Voller Vor-Push-Check inkl. beider Builds + Boot-Smoke (#527) | `npm run verify:full` (= `verify` + `test:coverage` + `check:diffcoverage` + Builds + `check:bundle` + `test:smoke`) |
| Required-Checks auf dem PR = maßgeblicher Gate (server-seitig, seit #592) | `gh pr merge <nr> --squash --delete-branch --auto` + `gh pr checks <nr> --watch` (Regel-Heimat: [AGENTS.md](../../AGENTS.md#das-wichtigste-zuerst-harte-regeln)) |
| pre-push-Hook (fährt `verify`; seit #592 nur noch sekundäres Netz) | verdrahtet via `npm run setup`; greift nur bei Push auf `main` (server-seitig ohnehin blockiert) |
| Erstinstallation | `npm install` |
| Dev-Server | `npm run dev` |
| Host-/Prod-Build (Multi-File nach `dist/`) | `npm run build` |
| Offline-Build (self-contained `dist-offline/index.html`) | `npm run build:offline` |
| Dev-Panel-Build (#331, Panel MIT, passwortgated, `dist-devpanel/`) | `npm run build:devpanel` |
| Tests | `npm test` (Vitest) |
| Coverage-Gate (v8, Schwellen PRO Schicht statt Repo-Mittel, #495) | `npm run test:coverage` |
| Boot-Smoke-Test (headless, gegen den Offline-Build, #391) | `npm run smoke` (baut Offline + Playwright) bzw. `npm run test:smoke` (nur Lauf, Build muss da sein) |
| Typen prüfen (voll strict) | `npm run typecheck` |
| Linter (ESLint, #389; Komplexitäts-Gates complexity/max-lines-per-function/max-depth #502) | `npm run lint` |
| Stale Suppressions prunen / Baseline neu aufbauen (Komplexität #502 + Typsicherheit #868) | `npm run lint:prune` / `npm run lint:suppress` |
| Quiz-Korrektheits-Golden nach bewusstem Review aktualisieren (#597) | `npm run quiz:golden` |
| Sprite-Sheets aus Quell-PNGs neu packen (nach Asset-Aenderung, #339) | `npm run pack:sprites` |
| Architektur-Wächter (Schichtung + Zyklen + Orphans, #347/#390) | `npm run check:arch` |
| Dateigröße-Wächter (God-File-Budget 800 LOC, #390) | `npm run check:size` |
| Kontextdatei-Wächter (Zeichen-Budget für jede AGENTS.md, Wurzel + modul-lokal, #719/#1064/#1088) | `npm run check:contextsize` |
| Tiefendoc-Abdeckungs-Wächter (jede `src/`-Datei in einem `docs/module/`-Tiefendoc, #482/#907) | `npm run check:docmap` |
| Harness-Drift-Wächter (dokumentierte `npm run`-Kommandos + interne Doku-Links/Anker, #529) | `npm run check:docdrift` |
| Interne-Referenzen-Wächter (Arbeitgeber-/Kundenbezüge aus dem öffentlichen Repo halten, #990) | `npm run check:internalrefs` (prüft getrackte Dateien und die Commit-Messages des Branches; Herkunftsbegriff ergänzen: `node scripts/check-internalrefs.mjs --add "<begriff>"`, Namensbezug als Wortstamm: `--add-name "<begriff>"`; PR-Titel/-Body: `… \| node scripts/check-internalrefs.mjs --text`) |
| Spielrhythmus im Board pflegen (#1215) | `node scripts/board-rhythm.mjs` (`--dry-run`) |
| Mehrere Tickets einsortieren, eine Listenabfrage (#1217) | `node scripts/board-place.mjs --top <nr>…` / `--after <ankernr> <nr>…` |
| Doku-Aktualitäts-Wächter (offen-markierte Roadmap-Tickets gegen den gh-Status, non-blocking, braucht `gh`, #610) | `npm run check:doctickets` |
| TS-7-Freigabe-Wächter (npm-Registry: erlaubt typescript-eslint schon TS 7? non-blocking, braucht Netz, #847) | `npm run check:tseslint-ts7` |
| Diff-Größenbudget-Wächter (max. 20 Dateien / 800 geänderte Zeilen gegen main, #533) | `npm run check:diffsize` |
| Diff-Coverage-Wächter (geänderte Zeilen pro Slice getestet; **hart** für Domäne/Anwendung, Präsentation/Einstieg nur berichtend; läuft **NACH `test:coverage`**, #1021) | `npm run check:diffcoverage` |
| `no-explicit-any`-Suppression-Ratchet (per-Datei-Baseline, #604) | `npm run check:anysuppress` (neu ziehen: `node scripts/check-any-suppressions.mjs --write`) |
| Lockfile-Integritäts-Wächter (package-lock.json ↔ package.json, gegen Lockfile-Drift, #593) | `npm run check:lockfile` |
| Bundle-Byte-Budget-Wächter (Offline-HTML + Spielcode- + Phaser-vendor-Chunk, NACH den Builds, #503/#595) | `npm run check:bundle` |
| Duplikations-Report (jscpd, **weich/nicht-blockierend** — kein Gate, nur CI-Artefakt, #612) | `npm run check:duplication` |
| Security-Audit (Produktiv-Deps, CI-Gate blockt bei high+, #396) | `npm audit --omit=dev --audit-level=high` |

> Aus IntelliJ/WebStorm gibt es dieselben Befehle als Ein-Klick-Run-Configs: [CONTRIBUTING.md › Aus IntelliJ starten](../../CONTRIBUTING.md#aus-intellij-starten-ein-klick).

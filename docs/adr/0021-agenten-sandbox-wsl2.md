# ADR 0021: Agenten-Sandbox über eine eigene WSL2-Distribution

> Architecture Decision Record. Format: Kontext → Entscheidung → Konsequenzen.
> Status: **akzeptiert** · Datum: 2026-10-08 · Ticket: #1432

## Status

**Akzeptiert.** Erster Baustein des Epics #1429 (Sandbox für Agenten-Shell-Befehle). Die Reihenfolge der weiteren Bausteine steht dort; dieses ADR legt Weg und Konfiguration fest, Probe und Durchsetzung folgen in #1434 und #1437.

## Kontext

Die Agenten laufen mit weitreichenden Rechten (`gh`, `git`, `npm`, Shell) auf dem Rechner der Maintainerin, auf dem auch Alltagsdaten und Zugangsdaten liegen. Least-Privilege über `permissions` ([agent-harness.md](../agent-harness.md#agenten-sandbox-wsl2)) ist ein Prefix-Match, kein Zaun: ein Shell-Befehl kann überall lesen, schreiben und ins Netz.

Die offizielle Doku ([Sandboxing](https://code.claude.com/docs/en/sandboxing)) sagt: „The sandbox runs on macOS, Linux, and WSL2. On native Windows, Claude Code runs commands unsandboxed.“ Sie deckt nur Shell-Befehle (Bash, PowerShell, Monitor) ab; Read/Edit/WebFetch, Hooks und MCP-Server laufen außerhalb. `sandbox.credentials`, `mask`, `tlsTerminate` und `strictAllowlist` wirken nur im User-Scope oder per `--settings`. Der eingebaute Schreibschutz deckt die Hook-Skripte unter `scripts/` nicht ab.

**Probe auf nativem Windows** (Claude Code 2.1.293, 2026-10-08):

```
$ claude --settings '{"sandbox":{"enabled":true,"failIfUnavailable":true}}' -p "echo probe"
Error: sandbox required but unavailable: sandbox is enabled but the Windows sandbox is not active on this session (feature gate off)
  sandbox.failIfUnavailable is set — refusing to start without a working sandbox.
EXIT=1
```

Claude Code kennt also eine native Windows-Sandbox, sie liegt hinter einem Feature-Gate und ist aus. Das README von sandbox-runtime nennt sie „alpha“: eigener `srt-sandbox`-Account, WFP-Egress-Filter, NTFS-ACLs, ein erhöhter `windows-install`-Schritt; Werkzeuge im User-Profil (Node über nvm, `gh`) erreicht sie nicht, und DNS ist nicht abgeschottet.

## Entscheidung

**Eine eigene WSL2-Distribution nur für Agenten, darin die native Claude-Code-Sandbox (bubblewrap + Proxy).** Aufteilung:

- **Projekt** (`.claude/settings.json`, versioniert): `sandbox.enabled: true`, `allowUnsandboxedCommands: false`, Netz-Allowlist ohne Voll-Wildcard, `filesystem.denyRead` für `/mnt` und Secret-Pfade, `filesystem.denyWrite` für Hook-Skripte, `.githooks`, `node_modules` und Lockfile, dazu dieselben Secret-Pfade als `Read(...)`-deny. **Kein** `failIfUnavailable`: es würde jede native Windows-Session aussperren; auf nativem Windows startet die Session unverändert.
- **User-Vorlage** (`node scripts/sandbox-doctor.mjs --vorlage`, nichts davon im Repo): `failIfUnavailable: true`, `strictAllowlist`, `tlsTerminate`, Token-Maskierung (`GH_TOKEN`, Langfuse-Secret) mit `injectHosts`, Deny für Token-Variablen. Die Vorlage führt die Projekt-Allowlist vollständig mit (`strictAllowlist` ignoriert die Liste des Repos). Der Langfuse-Host kommt aus `LANGFUSE_BASE_URL`, nie ins Repo.
- **Zweite Grenze** in der Distribution: `[automount] enabled=false`, `[interop] enabled=false`, `appendWindowsPath=false`, damit auch ein Ausbruch aus bubblewrap nicht auf Windows-Daten oder -Programme trifft.
- Der Doktor prüft das alles berichtend (Exit 0); als Gate wird er erst nach erfolgreicher Probe (#1437).

**Invariante:** kein `allowWrite` auf Orte, aus denen ungesandboxte Prozesse Code laden (`~/.npm`, `~/.cache/ms-playwright`, `~/.claude`, jeder `denyWrite`-Eintrag); der Wächter `test/harness/sandbox-settings.test.ts` hält sie fest. Secret-Inhalte fasst das Repo nie an.

### Alternativen

- **Devcontainer mit iptables-Firewall.** Funktioniert überall, aber die Firewall filtert nach IP statt Domain, es gibt kein Credential-Masking, und die Claude-Code-Sandbox wäre doppelt oder gar nicht im Spiel. Bleibt **Fallback**, falls bubblewrap in #1434 grundsätzlich scheitert (dann neues ADR).
- **Eine vorhandene Alltags-WSL-Distribution.** Dort liegen fremde Daten, und `bwrap`/`socat`/`node`/`gh` fehlen. Eine eigene Distribution ist billig und sauber trennbar.
- **Native Windows-Sandbox (alpha, Gate aus).** Heute nicht nutzbar (Probe oben) und mit den genannten Lücken (kein User-Profil-Zugriff, DNS offen). **Revisit-Trigger:** gibt Anthropic sie offiziell frei, wird neu entschieden (neues ADR); der Block greift dann auch nativ, Notausgang `claude --settings '{"sandbox":{"enabled":false}}'`.
- **Status quo (nur `permissions` und Hooks).** Kein Schutz gegen beliebige Shell-Zugriffe; für ein Repo, das Agenten autonom mergen lässt, zu dünn.

## Konsequenzen

- **Ehrliche Reichweite:** nur Shell-Befehle sind eingesperrt. Read/Edit/WebFetch, Hooks und MCP-Server laufen außerhalb; dafür stehen Read-deny, `denyWrite` und die geschützten Pfade (ADR 0014) als zweite Linie.
- Die Maintainerin richtet die Distribution einmal ein (Checkliste in [agent-harness.md](../agent-harness.md#agenten-sandbox-wsl2)); Agenten arbeiten dort in Worktrees, weil `./node_modules` im Hauptcheckout schreibgeschützt ist.
- Offen und in Folgetickets belegt: `haupt-sync` schreibt `scripts/` per Fast-Forward und kollidiert mit `denyWrite` (Lösung in #1434 per engem `excludedCommands`); ob die Maskierung bei Basic-Auth (`git push` per HTTPS) greift (#1434; ein Fehlschlag wäre sicher); die Download-Hosts von PixelLab (#1434).
- Scheitert bubblewrap in #1434 grundsätzlich oder wird die Windows-Sandbox freigegeben, wird dieses ADR nicht umgeschrieben, sondern durch ein neues abgelöst.

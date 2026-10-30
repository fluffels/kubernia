# Sandbox anbinden

> Evergreen. Der Harness setzt keine bestimmte Sandbox voraus, sondern den Vertrag in [ADR 0025](adr/0025-sandbox-als-austauschbare-laufumgebung.md) (Zeilen V0 bis V7). Diese Seite sagt, wie man ihn erfüllt; die Vertragszeilen stehen nur dort. Standard- und Rückfallweg: ADR 0025, Abschnitt Fortschreibung #1827. Den WSL2-Weg von Kubernia beschreibt [agent-harness.md](https://github.com/fluffels/self-improving-agent-harness-and-factory/blob/v0.4.2/docs/agent-harness.md#agenten-sandbox-wsl2).

## Docker Sandboxes (`sbx`)

Die offiziell dokumentierte Variante und der vorläufige Rückfallweg, nicht empfohlen bis Probe [#1657](https://github.com/fluffels/kubernia/issues/1657). Fakten und Quellen („gelesen 2026-10-16“): [ADR 0025](adr/0025-sandbox-als-austauschbare-laufumgebung.md#docker-sandboxes-fakten-mit-quelle-gelesen-2026-10-16). Schritte, die nicht per Probe belegt sind, sind markiert.

1. **Installieren:** Windows 11 x64: Windows Hypervisor Platform aktivieren (erhöhte PowerShell, `Enable-WindowsOptionalFeature -Online -FeatureName HypervisorPlatform -All`), dann `winget install -h Docker.sbx`. macOS: Sonoma 14+ auf Apple Silicon. Linux: Ubuntu 24.04+ mit KVM.
2. **Netz (V2):** Preset „Locked Down“ wählen, dann nur die nötigen Ziele freigeben (`sbx policy allow network <host>`: GitHub, npm-Registry, Langfuse-Host, Anthropic). Nie Preset „Open“. Danach `sbx policy ls` prüfen: Standard-Domains können breite Wildcards enthalten, die zur Allowlist gehören.
3. **Zugangsdaten (V3):** `sbx secret set github` (Wert z.B. aus `gh auth token`) und `sbx secret set anthropic`; die Sandbox sieht nur den Platzhalter `proxy-managed`. Ob der Proxy ein Langfuse-Secret einsetzen kann, ist **unbelegt**; solange das offen ist, verletzt ein Langfuse-Schlüssel im Klartext in der Sandbox V3.
4. **Merkmal (V6):** `AGENT_SANDBOX=docker-sbx` über die Environment-Datei der Sandbox setzen (**unbelegt**), nie über das Repo.
5. **Ladeorte (V7):** den geteilten Skills-Speicher abwählen (`--skills=off`, Standardmodus mit `sbx settings set skills.defaultMode off`); ein geteilter Speicher im Modus `readwrite` lässt eine Sandbox Skills für andere ändern.
6. **Workspace (V1):** Mount (Standard, rw) oder Klonmodus. Ohne Host-Workspace (Claude Desktop über `sbx setup ssh --auto-create`, Host `claude.sbx`) wird das Projekt in der Sandbox geklont. Im Klonmodus bleiben nicht getrackte Dateien wie `.env` lesbar: keine Geheimnisse dort ablegen (V3). Ein Klon hat ein eigenes `.git` und damit eigene Ticket-Locks: Claims des Hosts sind dort unsichtbar, über Maschinen hinweg trennt nur der Assignee, und ein reiner Remote-Branch ist für `claims-pruefen` keine lokale Spur ([Wiederaufnahme](ticket-reihenfolge.md#wiederaufnahme-verwaister-claims)).
7. **Prüfen:** `node scripts/sandbox-doctor.mjs --check` (später `--streng`, [#1437](https://github.com/fluffels/kubernia/issues/1437)).

Eine Kubernia-Session in `sbx` ist nicht per Probe belegt (Liste „Unbelegt“ im ADR).

## Cloud-Sitzung (Claude Code im Web)

Nicht empfohlen bis Probe [#1831](https://github.com/fluffels/kubernia/issues/1831). Der Vertrag verlangt dort: Netzstufe „Custom“ ohne Voll-Wildcard (V2), kein Token in den Umgebungsvariablen (V3), GitHub über den Proxy, weitere Schlüssel als Network Secrets.
Hürden: `gh pr` und `gh issue` scheitern (GraphQL), Ersatz ist `gh api` per REST; User-Plugins fehlen; ein Remote außerhalb GitHub geht nur ohne Push zurück.
Die Fakten mit Quelle stehen nur im ADR, Abschnitt Fortschreibung #1827.

## Eigene Container-Sandbox anbinden

Probe: [#1832](https://github.com/fluffels/kubernia/issues/1832). Gliederung des Leitfadens. Gemeint ist jede Container-Umgebung, die der Betreiber selbst baut. Am Ende muss sie den Vertrag erfüllen, sonst ist sie **nicht gesandboxt**.

1. **Mounts.** Workspace lesend und schreibend (V1). Kontextdateien (`AGENTS.md`), Hooks, User-Settings, Skills und Plugins müssen in den Container: entweder read-only mounten oder ins Image backen. Nichts davon beschreibbar mounten (V7).
2. **Settings greifen oft nur beim ersten Start.** Der Init-Schritt vieler Images kopiert die Einstellungen in ein Volume und liest sie danach nicht mehr vom Mount. Abhilfe: Einstellungsdatei als read-only Bind-Mount oder das Volume neu anlegen.
3. **`host.docker.internal` ist ein Loch.** Es macht jeden Dienst auf dem Host erreichbar (V1, V2). Langfuse darum als Dienst ins interne Netz des Containers legen (Compose-Service-Name als Host), nicht über den Host.
4. **Egress.** Ausgehender Verkehr nur über einen Domain-Proxy mit Allowlist (V2). Egress-Einträge und Zugangsdaten kommen aus dem eigenen Secret-Store, nicht aus Image, Repo oder Klartext-ENV (V3).
5. **Werkzeuge im Image (V4).** `git`, `gh`, `node`/`npm` und für Browser-Prüfungen die Playwright-Systempakete.
6. **Merkmal (V6).** `AGENT_SANDBOX=container` im Image-ENV (kein Geheimnis, nur die Variante).
7. **Git-Eigenheit.** Worktree-Pfade sind absolut: ein im Container angelegter Worktree ist auf dem Host kaputt und umgekehrt. Worktrees nur auf einer Seite anlegen.
8. **Prüfen.** `node scripts/sandbox-doctor.mjs --check` (später `--streng`); als Vorlage für Negativproben (nicht freigegebenes Ziel scheitert, Host-Pfade nicht lesbar, kein Token in der Umgebung) dienen die Proben aus [#1434](https://github.com/fluffels/kubernia/issues/1434).

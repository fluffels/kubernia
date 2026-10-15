# ADR 0025: Sandbox als austauschbare Laufumgebung

> Architecture Decision Record. Format: Kontext → Entscheidung → Konsequenzen.
> Status: **akzeptiert** · Datum: 2026-10-16 · Ticket: #1614

## Status

**Akzeptiert.** Präzisiert [ADR 0021](0021-agenten-sandbox-wsl2.md) (dessen Entscheidung bleibt) und gehört zum Kern-Schnitt aus [ADR 0022](0022-dark-factory-kern-und-verteilung.md) (Inventarzeile „Permissions und Sandbox“, Schritt F9). Freigabe der Maintainerin: 2026-10-15.

## Kontext

ADR 0021 setzt WSL2 mit der Claude-Code-Sandbox voraus. Der Harness-Kern soll aber in fremde Projekte übertragen werden ([Transfer](../harness-transfer.md)), und dort ist WSL2 nicht gesetzt. Es gibt drei Familien von Laufumgebungen:

1. **Claude-Code-Sandbox** (bubblewrap unter Linux/WSL2): umschließt nur Shell-Befehle, der Agent-Prozess selbst läuft außerhalb.
2. **microVM um die ganze Agent-Session** (Docker Sandboxes, `sbx`).
3. **Eigene Container-Sandbox** mit Egress-Proxy.

Was der Harness von einer Sandbox braucht, ist ein Verhalten, kein Produkt. Ein Vertrag lässt sich prüfen (`sandbox-doctor`, #1437), ein Produktname nicht.

## Optionen

- **A. Alles auf WSL2.** Verworfen: gilt nur für Windows mit WSL2; ein fremdes Projekt auf macOS oder Linux hätte keinen Weg.
- **B. Alles auf Docker Sandboxes.** Verworfen: Windows 11 mit Hypervisor Platform, Linux nur Ubuntu 24.04+; für Kubernia fehlt der Probe-Lauf (siehe „Unbelegt“).
- **C. Vertrag plus Doktor, Variante frei (gewählt).** Der Harness fordert die Vertragszeilen unten; welche Laufumgebung sie erfüllt, wählt das Projekt.
- **D. Kein Sandbox-Anspruch im Kern.** Verworfen: widerspricht dem Epic #1429 und ADR 0021.

## Entscheidung

Option C. Der Harness setzt **keine bestimmte Sandbox** voraus, sondern den folgenden **Sandbox-Vertrag**. Offiziell dokumentiert für Nutzer des Harness wird **Docker Sandboxes (`sbx`)**; WSL2 mit der Claude-Code-Sandbox (ADR 0021) bleibt eine Variante, und Kubernia selbst bleibt bei WSL2. Wie man eine eigene Container-Sandbox anbindet, steht in [Sandbox anbinden](../sandbox-anbinden.md).

### Vertrag

| Zeile | Anforderung | Prüfweg für `--streng` (#1437) |
|---|---|---|
| V0 Reichweite | Die Grenze umschließt mindestens jeden Shell-Befehl des Agenten (Bash, PowerShell, Monitor); besser die ganze Agent-Session. | Variante liefert den Nachweis (Merkmal V6 plus Verhaltensproben). |
| V1 Workspace | Der Repo-Checkout ist per Mount lesend und schreibend verfügbar; ein Klon in der Sandbox gilt als gleichwertig (strenger als „per Mount“, bewusste Erweiterung). Sonst ist kein Host-Pfad sichtbar (keine Windows-Laufwerke, kein Host-Home). | Schreib-/Leseprobe im Workspace; `/mnt/c` bzw. Host-Home nicht lesbar. |
| V2 Egress | Allowlist nach Domain: GitHub, npm-Registry, Langfuse-Host. Anthropic nur, wenn der Agent-Prozess selbst in der Grenze läuft (`sbx`), nicht bei WSL2. Sonst nur benannte, projektbedingte Domains. **Keine Voll-Wildcard** (`*`, `**`, `sbx`-Preset „Open“) und keine Wildcard auf geteilte Cloud-Speicher-Domains. Die konkreten Kubernia-Hosts stehen nur in `.claude/settings.json` und der Tabelle in [agent-harness.md](../agent-harness.md#agenten-sandbox-wsl2), nicht hier. | Ein nicht freigegebenes Ziel scheitert, `api.github.com` geht durch. |
| V3 Zugangsdaten | Kein Token im Klartext in der Sandbox (nicht in Umgebungsvariablen, nicht in lesbaren Dateien). Erlaubt sind nur **Proxy-Injection** (`sbx`: Platzhalter `proxy-managed`) oder **Maskierung** (Claude Code: `credentials.mask` samt `injectHosts`). | Variablen nach `SECRET_MUSTER` (`scripts/sandbox-doctor.mjs`) ohne echte Token-Präfixe (`ghp_`, `gho_`, `github_pat_`, `sk-ant-`, `sk-lf-`); bekannte Token-Dateien nicht lesbar. |
| V4 Werkzeuge | `git`, `gh`, `node`/`npm` im PATH. | `--version` je Werkzeug. |
| V5 Langfuse | Der Host aus `LANGFUSE_BASE_URL` antwortet aus der Grenze. | Health-Endpunkt des Hosts. |
| V6 Merkmal | Die Laufumgebung setzt `AGENT_SANDBOX=<variante>` (`wsl2-bubblewrap`, `docker-sbx`, `container`). Gesetzt wird es nie vom Repo, sondern von der User-Vorlage (`env`), der `sbx`-Environment-Datei oder dem Image-ENV. | `sandbox-doctor` erkennt die Variante daran. |
| V7 Ladeorte | Es gibt keinen beschreibbaren Ort, aus dem Code außerhalb der Grenze oder in anderen Sandboxen geladen wird (die Invariante aus ADR 0021, verallgemeinert; bei `sbx` der geteilte Skills-Speicher). | Konfigurationsprüfung der Variante. |

**Das Merkmal V6 wählt nur die Variante.** Grün macht eine Sandbox allein die Verhaltensprobe der Zeilen V0 bis V5 und V7. Eine Umgebung mit gesetztem `AGENT_SANDBOX`, aber roter Probe, ist nicht gesandboxt.

### Nicht gesandboxt

Der Status ist binär. **Verletzt eine Laufumgebung auch nur eine Vertragszeile, gilt sie als „nicht gesandboxt“**, und `sandbox-doctor --streng` endet mit Exit ≠ 0. Beispiele:

- natives Windows ohne Sandbox;
- WSL2 ohne aktive Claude-Code-Sandbox;
- `sbx` mit Preset „Open“ oder einer Allow-Regel auf alles (V2);
- ein Token als ENV im Container-Image (V3);
- pauschaler Zugriff auf `host.docker.internal` (V1, V2);
- Merkmal gesetzt, aber eine Probe rot (V6).

### Varianten

„belegt“ heißt: Quelle oder Probe liegt vor. „unbelegt“: nur Behauptung oder ungeprüft.

| Zeile | WSL2 + Claude-Code-Sandbox | Docker Sandboxes (`sbx`) | Eigene Container-Sandbox |
|---|---|---|---|
| V0 | belegt (ADR 0021: nur Shell-Befehle) | belegt (microVM um die Session, Quelle unten) | Sache des Projekts |
| V1 | Konfiguration belegt, Probe offen bis #1434 | belegt (Mount rw, Klonmodus, Quelle unten) | Sache des Projekts |
| V2 | Konfiguration belegt, Probe offen bis #1434 | belegt (`sbx policy`); Preset „Locked Down“ plus explizite Allow-Liste | Domain-Proxy nötig |
| V3 | Maskierung, Probe offen bis #1434 | belegt für unterstützte Anbieter; für Langfuse unbelegt | Secret-Store des Projekts |
| V4 | belegt | unbelegt (Image-Inhalt) | Sache des Images |
| V5 | belegt (Host-Dienst) | unbelegt | internes Netz, kein `host.docker.internal` |
| V6 | wsl2-bubblewrap, User-Vorlage | unbelegt (Environment-Datei) | Image-ENV |
| V7 | belegt (ADR 0021) | belegt als Risiko (geteilter Skills-Speicher, Abwahl `--skills=off`) | Sache des Projekts |

### Docker Sandboxes: Fakten mit Quelle (gelesen 2026-10-16)

- Eigenständige CLI `sbx`, Docker Desktop oder Docker Engine sind nicht nötig. Windows 11 x64 mit aktivierter Windows Hypervisor Platform (`Enable-WindowsOptionalFeature`), Installation `winget install -h Docker.sbx`; macOS Sonoma 14+ auf Apple Silicon; Ubuntu 24.04+ mit KVM und Gruppe `kvm`, Derivate nicht unterstützt. Quelle: <https://docs.docker.com/ai/sandboxes/install.md>
- Je Sandbox eine microVM mit eigenem Dateisystem, Docker-Daemon und Netz; der Workspace wird standardmäßig mit Schreibrechten gemountet, ein Klonmodus gibt dem Agenten einen eigenen Klon; Presets „Open“ (alles erlaubt), „Balanced“, „Locked Down“ (alles gesperrt, bis freigegeben). Quelle: <https://docs.docker.com/ai/sandboxes/get-started.md>
- Die microVM ist die Vertrauensgrenze, der Agent läuft darin als Nutzer mit `sudo`; ausgehender TCP läuft über einen Richtlinien-Proxy, ein weitergeleiteter SSH-Agent ist Standard, im Klonmodus bleiben nicht getrackte Dateien wie `.env` lesbar. Quelle: <https://docs.docker.com/ai/sandboxes/security/isolation.md>
- Regeln per `sbx policy` (`allow network <host>`, `ls`); UDP und ICMP sind standardmäßig blockiert; Standard-Domains enthalten breite Wildcards (z.B. `*.googleapis.com`), darum mit `sbx policy ls` prüfen; bei aktiver Org-Governance gelten nur Org-Allow-Regeln, lokale Allow-Regeln nicht mehr. Quellen: <https://docs.docker.com/ai/sandboxes/security/defaults.md>, <https://docs.docker.com/ai/sandboxes/governance.md>. `deny`, `rm` und die Bedeutung von `**` stehen in den gelesenen Seiten nicht (die CLI-Referenzseite lieferte nur die Überschrift): unbelegt.
- Credential-Proxy auf dem Host ersetzt in der Anfrage einen Platzhalter (`proxy-managed`) durch die echten Zugangsdaten, nachdem sie die microVM verlassen hat; `sbx secret set <dienst>` legt sie im OS-Schlüsselbund ab; unterstützt sind u.a. `anthropic` und `github`; Schlüssel direkt in der Sandbox zu setzen, wird nicht empfohlen. Quellen: <https://docs.docker.com/ai/sandboxes/configuration/credentials.md>, <https://docs.docker.com/ai/sandboxes/architecture/>
- `sbx skills import` (experimentell, `--dry-run`) liest u.a. `~/.claude/skills` in einen geteilten Speicher, der in der Sandbox unter `/home/agent/.claude/skills` erscheint; im Modus `readwrite` kann ein Agent Skills auch für andere Sandboxes ändern; abschaltbar mit `--skills=off` (ein Flag `--no-share-skills` steht in der Doku nicht). Quelle: <https://docs.docker.com/ai/sandboxes/workflows/agent-skills.md>
- `sbx setup ssh` macht jede Sandbox unter `<name>.sbx` per SSH erreichbar; für Claude Desktop (macOS und Windows) legt `sbx setup ssh --auto-create` (ab v0.48.0) die Verbindung mit Host `claude.sbx` an, ohne Host-Workspace: das Projekt wird in der Sandbox geklont. Quelle: <https://docs.docker.com/ai/sandboxes/integrations.md>

### Unbelegt (kein Probe-Lauf der Maintainerin)

Die folgenden Aussagen sind ungeprüft, bis die Maintainerin einen Probe-Lauf gemacht hat:

- eine Kubernia-Session in `sbx` (Worktree, `npm ci`, `verify`, Playwright, `gh pr`);
- `git push` über HTTPS mit dem Proxy-Credential;
- Erreichbarkeit einer lokalen Langfuse-Instanz aus der microVM;
- ob der Proxy das Langfuse-Secret einsetzen kann (Langfuse fehlt in der Anbieterliste der gelesenen Seite; sonst verletzt `sbx` für Langfuse die Zeile V3);
- `AGENT_SANDBOX` über die Environment-Datei;
- ob `AGENTS.md`, Hooks und das Langfuse-Plugin aus dem User-Scope (ADR 0019) in `sbx` geladen werden.

## Konsequenzen

- **#1437:** `sandbox-doctor --check --streng` prüft den Vertrag statt WSL2-spezifischer Merkmale; `wsl.conf`, bubblewrap und `socat` bleiben berichtende Variantenprüfungen unter `--check`. Merkmal allein macht nie grün.
- **#1434:** die WSL2-Proben belegen die Variante gegen V0 bis V7; der Fallback ist jede vertragskonforme Variante, ein Wechsel der Kubernia-Variante löst ADR 0021 per neuem ADR ab.
- Ein Harness-Nutzer schließt eine vertragskonforme Sandbox an ([Transfer](../harness-transfer.md)); sein Weg ist [Sandbox anbinden](../sandbox-anbinden.md).
- Vertragsänderungen stehen als `## Fortschreibung #<nr> (Datum)` in diesem ADR.

## Re-Evaluierung

Neu bewerten, wenn: ein Probe-Lauf in `sbx` vorliegt; `sbx` Credential-Modell oder Plattformen ändert; Claude Code eine Sandbox für natives Windows freigibt; #1434 grundsätzlich scheitert.

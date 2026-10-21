# ADR 0025: Sandbox als austauschbare Laufumgebung

> Architecture Decision Record. Format: Kontext → Entscheidung → Konsequenzen.
> Status: **akzeptiert** · Datum: 2026-10-16 · Ticket: #1614

## Status

**Akzeptiert.** Präzisiert [ADR 0021](0021-agenten-sandbox-wsl2.md) (dessen Entscheidung bleibt) und gehört zum Kern-Schnitt aus [ADR 0022](0022-dark-factory-kern-und-verteilung.md) (Inventarzeile „Permissions und Sandbox“, Schritt F9). Freigabe der Maintainerin: 2026-10-15. Fortgeschrieben durch #1827 (2026-10-21): Spalte Cloud-Sitzung, Grenzen je Variante, vorläufiger Standard- und Rückfallweg, siehe Abschnitt „Fortschreibung #1827“ unten.

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
| V3 Zugangsdaten | Kein Token im Klartext in der Sandbox (nicht in Umgebungsvariablen, nicht in lesbaren Dateien). Erlaubt sind nur **Proxy-Injection** (`sbx`: Platzhalter `proxy-managed`) oder **Maskierung** (Claude Code: `sandbox.credentials.envVars[].mode: "mask"` samt `injectHosts`). | Variablen nach `SECRET_MUSTER` (`scripts/sandbox-doctor.mjs`) ohne echte Token-Präfixe (`ghp_`, `gho_`, `github_pat_`, `sk-ant-`, `sk-lf-`); bekannte Token-Dateien nicht lesbar. |
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
- Merkmal gesetzt, aber eine Probe rot (das Merkmal allein macht nicht grün, siehe V6).

### Varianten

Präzisiert durch die Fortschreibung #1827 (2026-10-21) unten: Tabelle mit Cloud-Spalte und Quellen.

„belegt“ heißt: Quelle oder Probe liegt vor. „unbelegt“: nur Behauptung oder ungeprüft.

| Zeile | WSL2 + Claude-Code-Sandbox | Docker Sandboxes (`sbx`) | Eigene Container-Sandbox |
|---|---|---|---|
| V0 | belegt (ADR 0021: nur Shell-Befehle) | belegt (microVM um die Session, Quelle unten) | Sache des Projekts |
| V1 | Konfiguration belegt, Probe offen bis #1434 | belegt (Mount rw, Klonmodus, Quelle unten) | Sache des Projekts |
| V2 | Konfiguration belegt, Probe offen bis #1434 | belegt (`sbx policy`); Preset „Locked Down“ plus explizite Allow-Liste | Domain-Proxy nötig |
| V3 | Maskierung, Probe offen bis #1434 | belegt für unterstützte Anbieter; für Langfuse unbelegt | Secret-Store des Projekts |
| V4 | belegt | unbelegt (Image-Inhalt) | Sache des Images |
| V5 | belegt (Host-Dienst) | unbelegt | internes Netz, kein `host.docker.internal` |
| V6 | `wsl2-bubblewrap`; offen bis #1437 (die Vorlage setzt noch kein `env`) | unbelegt (Environment-Datei) | Image-ENV |
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

- **#1437:** `sandbox-doctor --check --streng` prüft den Vertrag statt WSL2-spezifischer Merkmale; `wsl.conf`, bubblewrap und `socat` bleiben berichtende Variantenprüfungen unter `--check`. Merkmal allein macht nie grün. `--vorlage` setzt zusätzlich `env.AGENT_SANDBOX=wsl2-bubblewrap`; solange das fehlt, erfüllt Kubernias WSL2 V6 nicht.
- **#1434:** die WSL2-Proben belegen die Variante gegen V0 bis V7; der Fallback ist jede vertragskonforme Variante, ein Wechsel der Kubernia-Variante löst ADR 0021 per neuem ADR ab.
- Ein Harness-Nutzer schließt eine vertragskonforme Sandbox an ([Transfer](../harness-transfer.md)); sein Weg ist [Sandbox anbinden](../sandbox-anbinden.md).
- Vertragsänderungen stehen als `## Fortschreibung #<nr> (Datum)` in diesem ADR.

## Re-Evaluierung

Neu bewerten, wenn: ein Probe-Lauf in `sbx` vorliegt; `sbx` Credential-Modell oder Plattformen ändert; Claude Code eine Sandbox für natives Windows freigibt; #1434 grundsätzlich scheitert.

## Fortschreibung #1827 (2026-10-21): Cloud-Sitzung, Grenzen je Variante, vorläufiger Standard- und Rückfallweg

Diese Wahl ist **vorläufig**: sie legt fest, worauf die Proben zielen, und wird nach ihnen als weitere Fortschreibung endgültig. Kubernia bleibt bis dahin bei WSL2 (ADR 0021).

### Beleg-Klassen und Quellen

Klassen: `ja (Probe)`, `ja (Doku/Konfiguration)`, `nein` (laut Quelle nicht machbar, ohne den Ticket-Ablauf umzubauen), `unbelegt`.

- [S] <https://code.claude.com/docs/en/sandboxing>, [C1] <https://code.claude.com/docs/en/claude-code-on-the-web>, [C2] <https://code.claude.com/docs/en/cloud-environments>: alle gelesen 2026-10-21.
- [D] Docker-Quellen dieses ADR (gelesen 2026-10-16).
- [R] Repo: ADR 0021, [agent-harness.md](../agent-harness.md#agenten-sandbox-wsl2) (Abschnitte Agenten-Sandbox und Natives Windows, Probe 2026-10-08), [Sandbox anbinden](../sandbox-anbinden.md), Stand 2026-10-21.
- [E] Erfahrungswerte aus einer eigenen Container-Sandbox mit Egress-Proxy, Stand 2026-10-05, nicht an Kubernia geprobt (#1832).

### Vertragszeilen je Variante

| Zeile | WSL2 + Claude-Code-Sandbox | Docker Sandboxes (`sbx`) | Eigene Container-Sandbox | Cloud-Sitzung |
|---|---|---|---|---|
| V0 | belegt [S]: nur Shell-Befehle und Kindprozesse; Read/Edit/WebFetch, Hooks und lokale MCP-Server laufen außerhalb | belegt [D] | unbelegt, Sache des Projekts (#1832) | belegt [C1]: isolierte, von Anthropic verwaltete VM je Sitzung um die ganze Session |
| V1 | Konfiguration belegt [R] (`denyRead /mnt`, `wsl.conf`); Schreibrecht im Arbeitsverzeichnis, `config`/`hooks` in `.git` geschützt [S]; Probe #1434 | belegt [D] | unbelegt (#1832) | belegt [C1, C2]: frischer Klon in der VM, kein Zugriff auf den eigenen Rechner, ungetrackte Dateien kommen nicht mit |
| V2 | Konfiguration belegt [R]; der Proxy lehnt Namen ab, die nur auf lokale Adressen auflösen, `localhost` ist erlaubt [S]; Probe #1434 | belegt [D] | unbelegt, Domain-Proxy nötig (#1832) | Konfiguration belegt [C2]; Probe #1831. „Custom“ ist eine eigene Domain-Liste, `*.` passt auf Subdomains; „Full“ verletzt V2; die Standardliste von „Trusted“ enthält breite Wildcards. Unabhängig von der Stufe erreichbar: GitHub über den eigenen Proxy, MCP-Connectoren (laufen über Anthropic), Hosts der Network Secrets, die Anthropic-API |
| V3 | Maskierung über die Vorlage [R]; braucht das experimentelle `network.tlsTerminate`, ohne es scheitert die Maskierung ohne Preisgabe [S]; Probe #1434 | wie in der Tabelle „Varianten“ oben | unbelegt, Sache des Projekts (#1832) | belegt erfüllbar [C1, C2]: GitHub-Zugangsdaten bleiben außerhalb der VM, `GH_TOKEN` liest als Platzhalter `proxy-injected`; weitere Schlüssel als Network Secrets über den Proxy; ein selbst gesetzter Token in den Umgebungsvariablen verletzt V3, weil jeder Nutzer der Umgebung ihn lesen kann. Ob ein Network Secret den Langfuse-Schlüssel setzen kann: unbelegt |
| V4 | belegt [R] | unbelegt [D] | Sache des Images; `gh` fehlte im Basis-Image [E] | belegt [C2]: git, gh, Node 22 mit npm vorinstalliert |
| V5 | ja (Doku/Konfiguration) [S, R]: Langfuse-Host in der Vorlage, `localhost` erlaubt, `networkingMode=mirrored`; Probe #1434 | unbelegt (#1657) | Host-`localhost` nicht erreichbar, Weg: Dienst im internen Netz [E, R] | nein für eine Instanz auf dem eigenen Rechner [C1]; ein öffentlich erreichbarer Host über die Custom-Liste unbelegt; Export über `OTEL_*`-Variablen als Mechanismus belegt [C2]; Probe #1831 |
| V6 | wie in der Tabelle „Varianten“ oben | wie oben | wie oben | kein Wert vergeben; setzbar über eine Umgebungsvariable der Umgebung [C2]; Wert und Erkennung kommen mit #1831 und #1437 |
| V7 | wie in der Tabelle „Varianten“ oben | wie oben | wie oben | spätere Sitzungen starten von einem Dateisystem-Schnappschuss nach dem Setup-Skript [C2]; ob eine Sitzung den Schnappschuss ändern kann: unbelegt |

### Grenzen und Ticket-Ablauf je Variante

| Zeile | WSL2 + Claude-Code-Sandbox | Docker Sandboxes (`sbx`) | Eigene Container-Sandbox | Cloud-Sitzung |
|---|---|---|---|---|
| Aufwand | mittel, Setup-Checkliste mit 10 Schritten [R] | gering laut Doku [D] | hoch [E] | gering [C1, C2]: GitHub-App bzw. `/web-setup`, Umgebung |
| Natives Windows | nein [S, R]; die Sandbox läuft auf macOS, Linux, WSL2 [S] | ja [D] | ja über eine Container-Laufzeit; Dateizugriff auf Windows-Laufwerke sehr langsam [E] | ja als Client (Browser, Desktop, Mobil, `claude --cloud`); Sitzung in Ubuntu 24.04 x86_64; Pläne Pro/Max/Team/Enterprise [C1, C2] |
| Kosten und Limits | keine Zusatzkosten; Tokens unbelegt (#1833) | Tokens unbelegt (#1833) | eigene Wartung; Tokens unbelegt (#1833) | keine VM-Gebühr, zählt zum Nutzungslimit, parallele Sitzungen proportional [C1]; ca. 4 vCPU/16 GB/30 GB; Befehle 2 min Standard, bis 10 min, dann Hintergrund; Setup-Cache nur bei weniger als ca. 5 min, ca. 7 Tage [C2]; frühere Kompaktierung [C1]; Tokens unbelegt (#1833) |
| Außerhalb der Grenze | Read/Edit/WebFetch, Hooks, lokale MCP-Server (auch Playwright-MCP), Plugin-Monitore [S] | unbelegt | Einstellungen greifen nur beim ersten Start; MCP im Container registrieren, Sidecar braucht `NO_PROXY` [E] | lokal nichts; GitHub über Proxy, Connectoren über Anthropic; Repo-Hooks und `.mcp.json` nur bei genau einem Repo je Sitzung; `~/.claude`, User-Plugins und Repo-`enabledPlugins` werden nicht geladen [C2] |
| Playwright | ja (Doku/Konfiguration) [S, R]: MCP außerhalb, Browser außerhalb installiert | unbelegt | Image hat nur Systembibliotheken, keine Browser [E] | nur `chromedriver` [C2]; Browser und MCP unbelegt |
| Langfuse-Erfassung | ja (Doku) [S]: Hooks laufen außerhalb | unbelegt | nein im erfahrenen Fall [E] | nein über das Plugin [C2]; OTel unbelegt |
| Worktree, `npm ci`, `verify` | ja (Doku/Konfiguration), Ergänzung unten | unbelegt | unbelegt; Worktrees nur auf einer Seite anlegen [R] | ja (Doku) [C2]: Werkzeuge vorinstalliert; `verify` über 2 min läuft im Hintergrund |
| `gh issue`, `gh pr` | ja (Konfiguration) [R]: `github.com`, `api.github.com` freigegeben | unbelegt | nein im erfahrenen Fall [E] | nein [C2]: der GitHub-Proxy weist GraphQL mit 403 ab, `gh api` per REST geht |
| Auto-Merge | ja (Konfiguration): derselbe `gh`-Weg; Probe #1434 | unbelegt | unbelegt | nein [C1, C2], Ergänzung unten |

Ergänzungen:

- **WSL2, Worktree:** benannte Lücke: `config`/`hooks` in `.git` bleiben schreibgeschützt [S]; das betrifft den Upstream bei `git worktree add -b … origin/main` und `push -u`. Abhilfe: ein eng gefasstes `excludedCommands` [S], entschieden in #1434 (AK4). `npm ci` nur im Worktree [R]; wohin der npm-Cache gehört, ist unbelegt (klärt #1434).
- **WSL2, `gh` und Auto-Merge:** Probe #1434 (AK3).
- **Cloud, Auto-Merge:** nein über `gh pr merge --auto` (GraphQL); Branch-Löschungen weist der Proxy ab [C2]. Auto-fix für PRs gibt es, braucht die Claude-GitHub-App [C1].

### Entscheidung (vorläufig)

Eine Variante, in der mindestens eine Ticket-Ablauf-Zeile (Worktree/`npm ci`/`verify`, `gh`, Auto-Merge, Playwright-MCP, Langfuse-Erfassung) „unbelegt“ oder „nein“ ist, ist **nicht empfohlen bis Probe**. „ja (Doku/Konfiguration)“ trägt nur die vorläufige Wahl, endgültig wird sie mit „ja (Probe)“. „Offiziell dokumentiert“ für `sbx` (Abschnitt Entscheidung oben) bleibt bestehen und heißt nicht „empfohlen“.

- **Standardweg: WSL2 mit der Claude-Code-Sandbox.** Entscheidung: WSL2, weil sie als einzige Variante keine Ticket-Ablauf-Zeile „unbelegt“ oder „nein“ hat (Agent, Hooks, MCP, Playwright-MCP und Langfuse-Plugin laufen laut [S] wie heute außerhalb, nur Shell-Befehle laufen innen gegen eine belegte Allowlist) und Kubernia sie schon trägt (ADR 0021). Bestätigung durch #1434.
- **Rückfallweg: `sbx`, nicht empfohlen bis Probe #1657.** Sie umschließt die ganze Session (V0) und deckt natives Windows 11, macOS auf Apple Silicon und Ubuntu 24.04+ ab; ein Wechsel geschieht per neuem ADR, das ADR 0021 ablöst.
- **Eigene Container-Sandbox und Cloud-Sitzung: nicht empfohlen bis Probe** (#1832, #1831). Bei der Cloud-Sitzung sind `gh pr`, `gh issue` und Auto-Merge als „nein“ belegt (GraphQL 403), User-Plugins fehlen, Playwright ist unbelegt.

### Offene Fragen

- Remotes außerhalb GitHub: Klonen und PR brauchen GitHub (für Team und Enterprise auch GitHub Enterprise Server); ein anderes Remote geht nur als Bundle-Upload (`CCR_FORCE_BUNDLE=1`), die Sitzung kann dann nicht zurück pushen [C1]. Ob der Ticket-Ablauf damit trägt, klärt #1831.
- Ob Projektcode in einer Anbieter-VM liegen darf, entscheidet das Projekt (Kubernia ist öffentlich).
- Die Claude-Code-Sandbox läuft laut [S] auch auf macOS und Linux; V6 kennt dafür keinen Wert (#1437).
- Tokenkosten sind für alle Varianten unbelegt (#1833).

### Proben und Messung

#1434 bestätigt den Standardweg, #1657 den Rückfallweg, #1831 die Cloud-Sitzung, #1832 die eigene Container-Sandbox; #1833 misst über alle Varianten plus einen Lauf unter nativem Windows.

### Neu entscheiden, wenn

#1434 und #1657 vorliegen (dann die endgültige Wahl als weitere Fortschreibung); #1831, #1832 oder #1833 ein Ergebnis bringen; der Cloud-GitHub-Proxy GraphQL zulässt; Claude Code natives Windows sandboxt; `sbx` sein Credential-Modell ändert.

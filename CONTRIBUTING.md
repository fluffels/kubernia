# Mitentwickeln an Kubernia

Willkommen! Diese Seite bringt dich – Mensch **oder** KI-Agent – in **einem Schritt** auf einen lauffähigen Stand. Was das Spiel selbst _ist_ (Story, Steuerung, Lernpfad), steht in der [README.md](README.md).

## Voraussetzungen

- **Node ≥ 22** – die erwartete Version steht in [`.nvmrc`](.nvmrc) (mit [`nvm`](https://github.com/nvm-sh/nvm): `nvm install && nvm use`).
- **git**; für den Ticket-Workflow zusätzlich die [GitHub-CLI](https://cli.github.com/) (`gh`).

## In einem Befehl startklar

```bash
git clone <repo-url> kubernia
cd kubernia
npm run setup
```

`npm run setup` prüft die Node-Version, verdrahtet die **Git-Hooks** (#528: der versionierte pre-push-Hook fährt `npm run verify` vor jedem Push auf `main`), installiert die Abhängigkeiten und lässt einmal **Tests, Typecheck und den Architektur-Wächter** laufen. Steht am Ende „Alles grün", bist du startklar. Danach den Dev-Server starten:

```bash
npm run dev   # lokaler Server (Vite) – angezeigte Adresse im Browser öffnen
```

> Lieber von Hand? Statt `npm run setup` reicht zum Loslegen `npm install`; die Checks unten dann bei Bedarf einzeln.

### Git-Identität (Anonymität, #418)

Commits in diesem Repo laufen unter der anonymen Identität `fluffels`, nie unter einem Klarnamen oder einer dienstlichen Mail (siehe [AGENTS.md › Anonymität wahren](AGENTS.md#das-wichtigste-zuerst-harte-regeln)). Bei einem **frischen Klon** einmalig **lokal** setzen (nicht global, sonst betrifft es auch andere Repos):

```bash
git config --local user.name fluffels
git config --local user.email 265222377+fluffels@users.noreply.github.com
```

Worktrees übernehmen die lokale Config automatisch mit.

## Im Container entwickeln (optional, ohne lokales Node)

Wer **kein Node lokal installieren** will (oder eine garantiert reproduzierbare Umgebung braucht – auch für Cloud-/CI-KI-Agenten), entwickelt im Container. Zwei Wege, beide nur fürs **Entwickeln** (das ausgelieferte Spiel bleibt die offline-fähige Single-File-Web-App, kein Server-Betrieb – siehe [ADR 0002](docs/adr/0002-kein-backend-keine-db.md)):

- **Schnell per docker compose:**
  ```bash
  docker compose up
  ```
  startet den Vite-Dev-Server im Container; danach **http://localhost:5173** im Browser öffnen. Das Repo ist live eingebunden – Edits auf dem Host wirken sofort. (Konfig: [`docker-compose.yml`](docker-compose.yml).)

- **VS Code Dev Container:** Ordner öffnen → „Reopen in Container". VS Code baut die Umgebung aus [`.devcontainer/devcontainer.json`](.devcontainer/devcontainer.json) (Node 22 + `gh`-CLI), installiert die Abhängigkeiten automatisch und leitet Port 5173 weiter; den Dev-Server dann wie gewohnt mit `npm run dev` starten.

> Beides ist reine Entwicklungs-Tooling. Node-Version (Node 22, aus [`.nvmrc`](.nvmrc)) und Dev-Port bleiben über einen Test ([`test/devcontainer.test.ts`](test/devcontainer.test.ts)) mit Container-Konfig und CI konsistent.

### Dev-Panel als Docker-Image (Passwort zur Laufzeit, #334)

Das passwortgegatete Dev-/Test-Panel (#325) gibt es zusätzlich als schlankes Serve-Image, in das das Passwort erst **beim Containerstart** injiziert wird – ein Image, viele Passwörter, kein Rebuild:

```bash
docker build -f Dockerfile.devpanel -t kubequest-devpanel .
docker run --rm -p 8080:80 -e VITE_KQ_DEVPANEL_PW=meinGeheimes kubequest-devpanel
```

Vollständige Erklärung (Runtime-Config-Hook, Sicherheitshinweise): [`docs/devpanel-docker.md`](docs/devpanel-docker.md). Das Passwort steckt **nie** im Image – nur in der Laufzeit-Env-Var. Reiner Distributionsweg fürs Dev-Panel, kein Spiel-Betrieb (ADR 0002).

## Die wichtigsten Befehle

| Zweck | Befehl |
|---|---|
| One-Command-Setup (Node-Check + Git-Hooks + install + alle Checks) | `npm run setup` |
| Dev-Server (Code-Änderung → manuell neu laden) | `npm run dev` |
| Tests (Vitest) | `npm test` |
| Typen prüfen (strict) | `npm run typecheck` |
| Architektur-Wächter (Schichtung) | `npm run check:arch` |
| Offline-Build (eine self-contained Datei zum Doppelklicken) | `npm run build:offline` |

Die **vollständige** Befehlsliste (alle Build-Wege) steht in [CLAUDE.md › Befehle](CLAUDE.md) – hier bewusst nur die Alltags-Befehle, nicht doppelt gepflegt.

## Wo finde ich was?

Damit nichts doppelt gepflegt wird, lebt jedes Thema an **genau einer** Stelle:

- **Datei-für-Datei-Landkarte** (welches Modul macht was): [CLAUDE.md › Repo-Landkarte](CLAUDE.md)
- **Wie hier gearbeitet wird** (harte Regeln, Board-/Ticket-Workflow, Konventionen): [AGENTS.md](AGENTS.md)
- **Was das Spiel ist** (Story, Steuerung, Lernpfad): [README.md](README.md)
- **Architektur-Stand & Ticket-Auswahl** (Stardew-Scope): [docs/architektur-analyse-2026-06.md](docs/architektur-analyse-2026-06.md) + [docs/ticket-reihenfolge.md](docs/ticket-reihenfolge.md)

## Bevor du committest

- `npm test`, `npm run typecheck` und `npm run check:arch` müssen **grün** sein – genau das, was `npm run setup` einmal durchspielt. **Änderungen gehen über einen Pull Request** (seit #592 ist `main` PR-gegated, kein Direkt-Push); fahr vor dem PR einmal `npm run verify` lokal für schnelle Rückmeldung – die **Required-Checks auf dem PR** sind der maßgebliche, server-seitig nicht umgehbare Gate.
- Neue/geänderte Logik bekommt **Tests, auch für Negativfälle** (Red-Green absichern, bei Bugfixes test-first).
- Sicht- oder spielbare Änderungen **im Browser** verifizieren, nicht nur „sollte gehen".
- Der komplette Ablauf inkl. Branch-/Worktree-Workflow und Test-Disziplin: [AGENTS.md](AGENTS.md).

## Pull Requests & Abhängigkeits-Updates (Policy)

Dieses Repo ist **öffentlich – aber zur Sichtbarkeit für Kollegen**, nicht als offene Einladung für beliebige Fremdbeiträge. Aktiver Code kommt von der Maintainerin (+ KI-Agent); `main` ist seit #419 geschützt (Force-Push/Löschen blockiert) und seit **#592 PR-gegated**: Merge nur über einen Pull Request mit **grünen Required-Checks**, `enforce_admins` **an** (gilt auch für die Maintainerin und die Agenten – kein Direkt-Push, kein `--no-verify`-Schlupf). Für eingehende PRs gilt:

### Dependabot-PRs (Bot, vertrauenswürdig – kein Fremd-Menschen-Code)

1. **Grün (CI durch) → annehmen.** Patch/Minor-Updates zeitnah mergen, damit sie nicht liegenbleiben.
2. **Rot (CI failt) → NICHT blind mergen.** Ein rotes Update bricht gerade etwas – erst Code anpassen (eigenes Ticket) oder zurückstellen. Gilt vor allem für **Major-Bumps**.
3. **Gekoppelte Pakete zusammen behandeln.** Eslint + `@eslint/js`, vite + vitest, ein Tool + sein Plugin – einzeln gemergt entstehen inkonsistente Versionen (genau das passierte mit #405 eslint 9→10 grün / #409 `@eslint/js` 9→10 rot). Darum bündelt [`.github/dependabot.yml`](.github/dependabot.yml) die Dev-Toolchain in **Gruppen** (`eslint`, `vite-vitest`, `github-actions`) – inklusive ihrer Majors, sodass ein gekoppeltes Major-Upgrade als **ein** koordinierter PR kommt. Sonstige Majors (z.B. phaser) bleiben bewusst Einzel-PRs zum Einzel-Review. Grouping ist **kein** Auto-Merge: ein roter Gruppen-PR wird weiter manuell geprüft.

> **Auto-Merge – jetzt möglich (seit #592).** GitHub-natives Auto-Merge für grüne Patch/Minor-PRs setzt **Required Status Checks** auf `main` voraus. Die sind seit **#592** gesetzt (der frühere Direkt-Push-Workflow, der das blockierte, ist auf PR-Gating umgestellt) — die Voraussetzung ist also erfüllt. Der Merge grüner Updates bleibt bis auf Weiteres ein **bewusster Handgriff** (`gh pr merge --squash`, sobald die Required-Checks grün sind); das Grouping oben senkt das PR-Aufkommen bereits deutlich. **Wenn voll automatisiert gewünscht:** `allow_auto_merge` am Repo aktivieren und via `dependabot/fetch-metadata` + `gh pr merge --auto` nur Patch/Minor automatisieren (Majors bleiben manuell im Review).

> **Damit offene Dependabot-PRs nicht vergessen werden (#712):** die Action [`dependabot-inbox.yml`](.github/workflows/dependabot-inbox.yml) sammelt sie täglich in einem Board-Ticket „🤖 Dependabot-PRs auflösen" an der **obersten** Board-Position — der bewusste Merge-Handgriff oben bleibt, aber er wird nicht mehr übersehen.

### PRs von fremden GitHub-Nutzern (Menschen)

4. **Nie blind mergen.** Fremder Logik-Code wird **nur nach Review** der Maintainerin übernommen. Jeder darf forken und einen PR stellen – das ist zum Mitlesen erwünscht, aber Beiträge werden bewusst geprüft (public zur **Sichtbarkeit**, nicht als offene Beitrags-Einladung).

## Lizenz & Rechte an Beiträgen

Kubernia ist **proprietär**: © 2026 [fluffels](https://github.com/fluffels), **alle Rechte vorbehalten** (verbindlich ist die [`LICENSE`](LICENSE) im Repo-Root). Beiträge sind ausdrücklich willkommen – aber: mit dem Einreichen eines Pull Requests räumst du dem Rechteinhaber das nicht-exklusive, unbefristete Recht ein, deinen Beitrag unter dieser Lizenz zu nutzen und zu verbreiten; die Rechte am Gesamtwerk bleiben bei der Maintainerin. Forken/Klonen zur eigenständigen Weiterführung außerhalb von Beiträgen an dieses Repository ist nicht gestattet.

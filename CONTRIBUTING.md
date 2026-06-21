# Mitentwickeln an KubeQuest

Willkommen! Diese Seite bringt dich – Mensch **oder** KI-Agent – in **einem Schritt** auf einen lauffähigen Stand. Was das Spiel selbst _ist_ (Story, Steuerung, Lernpfad), steht in der [README.md](README.md).

## Voraussetzungen

- **Node ≥ 22** – die erwartete Version steht in [`.nvmrc`](.nvmrc) (mit [`nvm`](https://github.com/nvm-sh/nvm): `nvm install && nvm use`).
- **git**; für den Ticket-Workflow zusätzlich die [GitHub-CLI](https://cli.github.com/) (`gh`).

## In einem Befehl startklar

```bash
git clone <repo-url> kubequest
cd kubequest
npm run setup
```

`npm run setup` prüft die Node-Version, installiert die Abhängigkeiten und lässt einmal **Tests, Typecheck und den Architektur-Wächter** laufen. Steht am Ende „Alles grün", bist du startklar. Danach den Dev-Server starten:

```bash
npm run dev   # lokaler Server (Vite) – angezeigte Adresse im Browser öffnen
```

> Lieber von Hand? Statt `npm run setup` reicht zum Loslegen `npm install`; die Checks unten dann bei Bedarf einzeln.

## Im Container entwickeln (optional, ohne lokales Node)

Wer **kein Node lokal installieren** will (oder eine garantiert reproduzierbare Umgebung braucht – auch für Cloud-/CI-KI-Agenten), entwickelt im Container. Zwei Wege, beide nur fürs **Entwickeln** (das ausgelieferte Spiel bleibt die offline-fähige Single-File-Web-App, kein Server-Betrieb – siehe [ADR 0002](docs/adr/0002-kein-backend-keine-db.md)):

- **Schnell per docker compose:**
  ```bash
  docker compose up
  ```
  startet den Vite-Dev-Server im Container; danach **http://localhost:5173** im Browser öffnen. Das Repo ist live eingebunden – Edits auf dem Host wirken sofort. (Konfig: [`docker-compose.yml`](docker-compose.yml).)

- **VS Code Dev Container:** Ordner öffnen → „Reopen in Container". VS Code baut die Umgebung aus [`.devcontainer/devcontainer.json`](.devcontainer/devcontainer.json) (Node 22 + `gh`-CLI), installiert die Abhängigkeiten automatisch und leitet Port 5173 weiter; den Dev-Server dann wie gewohnt mit `npm run dev` starten.

> Beides ist reine Entwicklungs-Tooling. Node-Version (Node 22, aus [`.nvmrc`](.nvmrc)) und Dev-Port bleiben über einen Test ([`test/devcontainer.test.ts`](test/devcontainer.test.ts)) mit Container-Konfig und CI konsistent.

## Die wichtigsten Befehle

| Zweck | Befehl |
|---|---|
| One-Command-Setup (Node-Check + install + alle Checks) | `npm run setup` |
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
- **Architektur-Stand & Umsetzungs-Reihenfolge** (Stardew-Scope): [docs/architektur-analyse-2026-06.md](docs/architektur-analyse-2026-06.md) + [docs/ticket-reihenfolge.md](docs/ticket-reihenfolge.md)

## Bevor du committest

- `npm test`, `npm run typecheck` und `npm run check:arch` müssen **grün** sein – genau das, was `npm run setup` einmal durchspielt.
- Neue/geänderte Logik bekommt **Tests, auch für Negativfälle** (Red-Green absichern, bei Bugfixes test-first).
- Sicht- oder spielbare Änderungen **im Browser** verifizieren, nicht nur „sollte gehen".
- Der komplette Ablauf inkl. Branch-/Worktree-Workflow und Test-Disziplin: [AGENTS.md](AGENTS.md).

## Lizenz & Rechte an Beiträgen

KubeQuest ist **proprietär**: © 2026 [fluffels](https://github.com/fluffels), **alle Rechte vorbehalten** (verbindlich ist die [`LICENSE`](LICENSE) im Repo-Root). Beiträge sind ausdrücklich willkommen – aber: mit dem Einreichen eines Pull Requests räumst du dem Rechteinhaber das nicht-exklusive, unbefristete Recht ein, deinen Beitrag unter dieser Lizenz zu nutzen und zu verbreiten; die Rechte am Gesamtwerk bleiben bei der Maintainerin. Forken/Klonen zur eigenständigen Weiterführung außerhalb von Beiträgen an dieses Repository ist nicht gestattet.

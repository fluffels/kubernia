# 📚 Weitere Anlaufstellen

> On-demand-Referenz (#1078): wo welche Doku liegt. Die harten Regeln stehen ausschließlich in [AGENTS.md](../../AGENTS.md).

| Was | Wo |
|---|---|
| 📋 **Agenten-Regeln, Board-Workflow, Konventionen (SSOT)** | **[AGENTS.md](../../AGENTS.md)** – bei Konflikt maßgeblich |
| 🛠️ Befehle · 🗺️ Repo-Landkarte · 🧭 Schichtregeln | [befehle.md](befehle.md) · [repo-landkarte.md](repo-landkarte.md) · [schichtregeln.md](schichtregeln.md) |
| 🤝 Mitentwickeln (Einstieg + One-Command-Setup `npm run setup`, IntelliJ-Run-Configs) | [CONTRIBUTING.md](../../CONTRIBUTING.md) |
| 🐳 Im Container entwickeln (devcontainer / `docker compose up`, #388) | [CONTRIBUTING.md › Im Container entwickeln](../../CONTRIBUTING.md) · [`.devcontainer/`](../../.devcontainer/devcontainer.json) · [`docker-compose.yml`](../../docker-compose.yml) |
| 🚀 Container-Deploy (Spiel-Image bauen + lokal starten, #752) | [docs/deploy.md](../deploy.md) |
| 📖 Spiel-Doku (Story, Steuerung, Lernpfad) | [README.md](../../README.md) |
| ❓ Häufige Fragen zum Agenten-Harness (FAQ) | [docs/agent-harness-faq.md](../agent-harness-faq.md) |
| 🏗️ Architektur (arc42 + C4/Mermaid-Diagramme §5) | [docs/arc42-architektur.md](../arc42-architektur.md) |
| 🗣️ Glossar (Hafen↔K8s↔Code) + Kontext-Landkarte der Subdomänen | [docs/glossar.md](../glossar.md) – welche Sprache/welcher Context gilt in welchem Verzeichnis (Token-lokal arbeiten) |
| 🎨 PixelLab-Assets (Liste + IDs) | [assets/pixellab/README.md](../../assets/pixellab/README.md) |
| 🔤 Pixelschrift fürs HUD (`KQPixel`/Silkscreen) | [`fonts.css`](../../fonts.css) (base64-`@font-face`) + Quelle/Lizenz in [`assets/fonts/`](../../assets/fonts/) (#189) |
| 🗺️ Tiled-Maps (`.tmj`) + Workflow | [assets/maps/README.md](../../assets/maps/README.md) |
| 🧪 Tests (Vitest) | [`test/`](../../test/) – Kern/Dispatch in `sim.test.ts`; die Simulator-Befehlsfamilien gespiegelt zu den `sim/`-Modulen unter [`test/sim/`](../../test/sim/) (docker/kubectl/rbac/helm/git/terraform/argocd/glab, #383); dazu `content.test.ts`, `quests.test.ts` u.a. **Geteiltes Harness (#475):** Querschnitts-Umgebung (window/localStorage-Stub + Spiel-Stack laden) in [`test/support/`](../../test/support/), valide Domänen-Eingaben/Factories in [`test/factories/`](../../test/factories/) (`freshSim`; `test/sim/helpers.ts` re-exportiert daraus). Verhaltens-Tests prüfen die öffentliche API/beobachtbares Verhalten, nicht Interna – die Architektur-**Fitness-Functions** (`layering.test.ts`/`filesize.test.ts`/`docmap.test.ts`/`claude-bridge.test.ts`/`harness-approval.test.ts`/`review-context.test.ts`/`model-routing.test.ts`/`agents-refs.test.ts`, #482/#992/#1012/#1034/#1035/#1079) sind bewusst eine eigene Kategorie. |
| 🚦 Boot- & Interaktions-Smokes (Playwright, E2E) | [`e2e/`](../../e2e/) – lädt den gebauten Offline-Build headless: Boot fehlerfrei (#391) **plus** schlanke Interaktions-Smokes (#480: Terminal-Eingabe, Overlay auf/zu, ein Quest-Durchlauf) **plus** ein FPS-Budget- und ein a11y-Smoke (#524: `perf-smoke.spec.ts` liest die auf `body[data-kq-fps]` gespiegelten FrameSampler-FPS bei `?perf`; `a11y-smoke.spec.ts` scannt HUD + Overlays mit axe-core) über Tastatur/DOM ohne Test-Hintertür; geteilte Helfer in [`e2e/support.ts`](../../e2e/support.ts). **Plus** der Lern-Loop-Smoke (#602: `learning-loop.spec.ts` spielt Onboarding → Docker-Quest bei Bo (Terminal-Aufgabe/Drill/Inline-Quiz) → Kralle-Quiz über die echte UI) – als EINZIGER Smoke gegen den **Dev-Build** (nutzt `window.kqGame` nur, um die Figur an den NPC zu setzen, weil Blind-Navigation headless nicht robust ist; Details im Datei-Kopf), Playwright startet dafür den Vite-Dev-Server (`webServer`). Config: [`playwright.config.ts`](../../playwright.config.ts) (`workers: 1`, damit die FPS-Messung nicht durch parallele Runs einbricht). Bewusst getrennt von den Vitest-Unit-Tests (`npm run smoke`). |
| ✅ Backlog / TODOs | GitHub Issues + Project-Board (`gh issue list --state open --limit 500`, `gh project list --owner fluffels`) |
| 🥇 Nächstes Ticket (Auswahl-Regel) | [docs/ticket-reihenfolge.md](../ticket-reihenfolge.md) – oberstes freies Item der Board-Reihenfolge; **verbindlich** in [AGENTS.md › Wo die TODOs leben](../../AGENTS.md#wo-die-todos-leben) |
| 🚀 Spiel deployen (Helm-Chart, lokaler Cluster) | [docs/deploy.md](../deploy.md) – `helm install kubernia ./deploy/chart`, kind/minikube, values |
| 🧩 Kopfzeilen-Vorlagen für Wiki-Seiten („fachlich geprüft am", Schnappschuss-Hinweis) | [doku-vorlagen.md](doku-vorlagen.md) – Lebenszyklus-Regel aus [ADR 0013](../adr/0013-docs-als-agentengepflegtes-wiki.md) |

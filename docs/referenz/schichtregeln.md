# 🧭 Schichtregeln beim Arbeiten im Verzeichnis (welche Imports gelten wo, #472)

Die [Repo-Landkarte](repo-landkarte.md) sagt, **wo** ein Modul liegt; diese Tabelle sagt, **was du importieren darfst**, sobald du in einem Bereich arbeitest. On-demand-Referenz (#1078). Die **harten** Regeln (❌) sind keine Bitte, sondern werden von **`npm run check:arch`** (dependency-cruiser, #347) als CI-Gate erzwungen — eine Verletzung ist **rot**, nicht nur unschön. EINE Quelle der Schicht-Grenzen: [`scripts/layers.cjs`](../../scripts/layers.cjs) — diese Tabelle liest sie nur ab. Das *Warum* der Schichtung: [AGENTS.md › Architektur](../../AGENTS.md#architektur); wie mit einem roten Gate umzugehen ist (**kein Grün-durch-Aufweichen**): [AGENTS.md](../../AGENTS.md#das-wichtigste-zuerst-harte-regeln).

| Wenn du hier arbeitest | Schicht | Darf importieren | ❌ Verboten (hart, `check:arch`) |
|---|---|---|---|
| `src/sim/*`, `src/content/*`, `src/world/*`, `src/core/*`, `src/hud/*`, `src/types.ts` … (= alles unter `src/`, das **nicht** in den drei Zeilen darunter steht) | **pure Domäne** | nur andere pure Domäne | `phaser`, `scenes`/`ui`/`sfx`, Anwendung/Persistenz, Einstieg |
| `src/game/*`, `src/runtime.ts`, `src/devpanel.ts`, `src/store/*` | **Anwendung/Persistenz** | pure Domäne (nur „nach unten") | `phaser`, `scenes`/`ui`/`sfx`, Einstieg |
| `src/scenes/*`, `src/ui/*`, `src/sfx.ts` | **Präsentation** | alles (nach unten offen) | *(keine Import-Regel — aber ACL beachten, s.u.)* |
| `src/main.ts`, `src/assets-data.ts` | **Einstieg/Assets** | alles (bootet Phaser + Szenen) | *(bewusst ausgenommen)* |

**Zusätzlich überall hart (`check:arch`, #390):** keine **Import-Zyklen** (geteilten Zustand nach [`src/runtime.ts`](../../src/runtime.ts) ziehen bzw. ein Host-Interface einführen — nicht die Regel aufweichen) und keine **verwaisten Module** (toter Code: einbinden oder löschen).

**Weiche Konvention für die Präsentation (kein `check:arch`, aber gewollt):** Die Präsentation *darf* technisch nach unten alles importieren — die Übersetzung Hafen ↔ Sim läuft aber bewusst nur über die **Anti-Corruption-Layer** an genau zwei Stellen ([`src/scenes/worldscene/clustersync.ts`](../../src/scenes/worldscene/clustersync.ts) für den Cluster→Welt-Sync, [`src/hud/markup.ts`](../../src/hud/markup.ts) für Content-Texte), **nicht** als verstreute Sim-Zugriffe quer durch die UI. Warum: [docs/glossar.md](../glossar.md).

**Tiefe Bereichs-Konventionen liegen modul-lokal** — `src/<bereich>/AGENTS.md`, die du **nur liest, wenn du dort arbeitest** (Kontext-Selektor #483; Vorbild [`src/content/AGENTS.md`](../../src/content/AGENTS.md), Content-as-Data). Die Auslagerungs-Regel dazu steht in [AGENTS.md](../../AGENTS.md#das-wichtigste-zuerst-harte-regeln).

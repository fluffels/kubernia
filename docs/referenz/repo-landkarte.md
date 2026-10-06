# 🗺️ Repo-Landkarte – wo finde ich was?

> **Kanonische Heimat** (#394/#907/#1078): AGENTS.md, README, CONTRIBUTING, das Glossar, arc42 und alle `docs/module/`-Köpfe verweisen hierher — die Datei-Landkarte gibt es genau einmal. On-demand-Referenz, nicht in jeder Session geladen.

**Code** (`src/`, gebaut mit Vite + TypeScript + Phaser 4). Gliederung nach Subsystem — alle Module je Subsystem im zugehörigen Tiefendoc unter [`docs/module/`](../module/) (on-demand, nur lesen wenn du dort arbeitest):

| Subsystem | Schicht(en) | Tiefendoc |
|---|---|---|
| `src/sim.ts` + `src/sim/` | pure Domäne | [sim.md](../module/sim.md) — Cluster-Simulator-Kern + Befehlsfamilien, Split #346/#372–#385 |
| `src/content.ts` + `src/content/` | pure Domäne | [content.md](../module/content.md) — Content-as-Data (#348/#349/#352/#368): Loader/Schema/Checks/Drills |
| `src/world/` + `src/core/` + `src/hud/` + `src/crashreport.ts` + `src/devtools/` | pure Domäne | [world.md](../module/world.md) — Welt/Karten/HUD-Logik: Geometrie, Autotile #340, Hitbox, Inseln |
| `src/game.ts` + `src/game/` + `src/store.ts` + `src/store/` + `src/runtime.ts` + `src/devpanel.ts` + `src/types.ts` | Anwendung/Persistenz | [app.md](../module/app.md) — `game.ts`/`sanitizeState`, SaveStore/IndexedDB #350, Spiel-Zeit #413 |
| `src/scenes.ts` + `src/scenes/` + `src/ui.ts` + `src/ui/` + `src/sfx.ts` + `src/main.ts` + `src/assets-data.ts` | Präsentation/Einstieg | [presentation.md](../module/presentation.md) — Szenen-Split #345, UI-Split #356, SFX/Assets |

> **Konvention (Stardew-skalierbar, #907):** Neues `src/`-Modul → Backtick-Pfad-Zeile im passenden [`docs/module/`](../module/)-Tiefendoc (Datei · kurzer Zweck). Diese Übersicht bleibt Subsystem-granular (wächst sub-linear zur Modul-Zahl). Was du in welchem Bereich importieren darfst: [Schichtregeln](schichtregeln.md). Tiefe Begründung der Schichtung: [AGENTS.md › Architektur](../../AGENTS.md#architektur). **Maschinell bewacht (#482/#907):** `npm run check:docmap` (CI-Gate + `test/docmap.test.ts`) meldet jede `src/`-Datei ohne Tiefendoc-Erwähnung — die Abdeckung kann nicht mehr leise veralten.

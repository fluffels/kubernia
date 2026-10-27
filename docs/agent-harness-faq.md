# Häufig gestellte Fragen zum Agenten-Harness (FAQ)

> Projektanteil der FAQ: Deploybarkeit, Browser-Prüfung im Spiel, Architekturmodell, AGE-Werte, Perf-Smoke und das Mermaid-Werkzeug. Die übrigen Fragen stehen in der [Kern-FAQ](https://github.com/fluffels/self-improving-agent-harness-and-factory/blob/v0.2.0/docs/agent-harness-faq.md); Inventar: [Factory-Seiten](referenz/anlaufstellen.md#factory-seiten-projektanteil-und-kern).

<!-- factory-projekt:start -->

## Ist Kubernia irgendwo deploybar, oder läuft es nur lokal?

Beides. Der Standard-Build (`npm run build`) ist schon ein statisches Bundle ohne eigenes Backend/DB ([ADR 0002](adr/0002-kein-backend-keine-db.md)) — es lässt sich auf jedem Webserver hosten, der statische Dateien ausliefert. Zusätzlich gibt es `npm run build:offline`: eine einzige self-contained `dist-offline/index.html` (alle Assets inline), die sich per Doppelklick lokal öffnen lässt. Beide Wege entstehen aus derselben Quelle; welcher Vertriebsweg (Web-Hosting vs. Desktop-Distribution) am Ende der bevorzugte ist, ist bewusst offen gehalten ([ADR 0005](adr/0005-auslieferungsform.md)).

<!-- factory-projekt:ende -->

## Der Auto-Mode blockt die Sabotage-Probe der Test-Lens („Self-Modification“): was tun?

Kern: [Der Auto-Mode blockt die Sabotage-Probe der Test-Lens („Self-Modification“): was tun?](https://github.com/fluffels/self-improving-agent-harness-and-factory/blob/v0.2.0/docs/agent-harness-faq.md#der-auto-mode-blockt-die-sabotage-probe-der-test-lens-self-modification-was-tun)

## Wie entferne ich einen Worktree unter Windows sauber (und was ist mit `node_modules`)?

Kern: [Wie entferne ich einen Worktree unter Windows sauber (und was ist mit `node_modules`)?](https://github.com/fluffels/self-improving-agent-harness-and-factory/blob/v0.2.0/docs/agent-harness-faq.md#wie-entferne-ich-einen-worktree-unter-windows-sauber-und-was-ist-mit-nodemodules)

## Wie verifiziere ich im Browser?

Kern: [Wie verifiziere ich im Browser?](https://github.com/fluffels/self-improving-agent-harness-and-factory/blob/v0.2.0/docs/agent-harness-faq.md#wie-verifiziere-ich-im-browser)

<!-- factory-projekt:start -->

- **Ablauf im Spiel:** Dev-Server mit einem Port aus der Ticketnummer starten, Port = 5173 + (Ticketnummer mod 1000), z.B. #1283 → `npx vite --port 5456 --strictPort` (parallele Worktrees kollidieren sonst auf 5173, `--strictPort` macht eine Kollision laut) → `browser_navigate` → per `browser_evaluate` warten, bis `window.kqDev.ready === true` (erster Frame mit Spielfigur) → Zustand lesen mit `kqDev.state()` (JSON: Szene, Spieler samt Kachel `tx`/`ty`, Quest-ID + Schritt, Dialog, offene Overlays, Uhr, Münzen/XP, aktive Gefahren; Format: `src/devtools/snapshot.ts`). Der Accessibility-Snapshot zeigt vom Canvas-Spiel nur die DOM-Overlays (Dialog, Terminal, HUD); für die Optik `browser_take_screenshot`.
- **Tasten:** `browser_press_key` tippt nur kurz an (Dialog weiterblättern mit `r`). **Laufen** braucht eine gehaltene Taste, per `browser_evaluate` in der Seite, ohne Echtzeit zu warten: `(() => { const o = { key: "ArrowLeft", code: "ArrowLeft", keyCode: 37, bubbles: true }; window.dispatchEvent(new KeyboardEvent("keydown", o)); const s = kqDev.advanceTime(1000); window.dispatchEvent(new KeyboardEvent("keyup", o)); return s.player; })()`. `kqDev.advanceTime(ms)` steppt Phaser synchron frame-weise vor (1000 ms ≈ 75 px Laufweg, Deckel 600 000 ms, optional `{ frameMs }` bis 50) und liefert den neuen Snapshot; `kqDev.setClock("HH:MM")` stellt die Tageszeit direkt auf die nächste Uhrzeit vor (nur vorwärts, z.B. `"21:00"` für den Nachtschleier) und liefert ebenfalls den Snapshot; `advanceTime` funktioniert auch im verdeckten Tab, wo `requestAnimationFrame` ruht. **Grenzen:** Tweens und `setTimeout`/`setInterval` laufen dabei nicht mit (sie hängen an der Echtzeit), nur die Frame-getriebene Spielzeit (Uhr, Wirtschaft, Bewegung). `game.loop.frame` zählt dabei nicht mit (der Vorlauf ruft `game.step`/`headlessStep` direkt, am Phaser-Loop vorbei). `browser_keydown`/`keyup` kennt `@playwright/mcp` (0.0.83) zwar, markiert sie aber als `skillOnly` (nur für die CLI, im Paket belegt): der MCP-Server filtert sie aus, auch mit `--caps`, und stellt sie nicht bereit, der Umweg über `KeyboardEvent` und `advanceTime` bleibt; `browser_run_code_unsafe` (Node-Code im Serverprozess) steht bewusst auf `ask`. Szenen, die Tasten per Polling in `update()` lesen (Menüs), brauchen denselben Weg: `browser_press_key` ist kürzer als ein Frame, `kqDev.advanceTime(200)` zwischen keydown und keyup genügt. Ist Navigation nicht das Prüfziel, die Figur lieber per `kqGame` setzen (wie `e2e/learning-loop.spec.ts`).
- **Szene gezielt ins Bild holen:** die Szene per `kqGame.scene.getScene("World")` ansteuern, mit `camera.centerOn(...)`/`setZoom(...)` ausrichten und dann den Screenshot machen. (Der SceneManager kennt `getScene`/`getScenes`/`run`, kein `get`.) Bleibt das Bild leer, siehe unten.
- **Leerer Canvas oder Screenshot-Timeout (#1290):** Ursache ist meist `document.visibilityState === "hidden"` (Fenster minimiert oder verdeckt): Phaser rendert dann nicht, und `kqGame.scene.getScenes(true)` ist leer. Abhilfe: das Browserfenster sichtbar halten. `kqDev.state()` und `kqDev.advanceTime` gehen auch verdeckt. Bleibt eine Taste hängen (ein `keydown` ohne `keyup`), den passenden `keyup` per `browser_evaluate` dispatchen.

<!-- factory-projekt:ende -->

<!-- factory-projekt:start -->

## Wie frage ich das Architekturmodell ab?

Über den **LikeC4-MCP** (Server `likec4` in [`.mcp.json`](../.mcp.json), Modell: `docs/architektur/`, Glossar: Architekturmodell). Gestartet wird er über [`scripts/likec4-mcp.mjs`](../scripts/likec4-mcp.mjs) und die gemeinsame Startlogik [`scripts/mcp-launch.mjs`](../scripts/mcp-launch.mjs): die Version kommt aus dem Lockfile (devDependency `likec4`); ist die Installation lokal da, startet sie (bei abweichender Version mit einer Warnung auf stderr), fehlt sie, `npx -y likec4@<exakte Version>` (erster Start lang; Abhilfe: im Haupt-Checkout einmal `npm ci`).

- **Tools:** `search-element` (Element nach Text suchen), `read-element`, `read-view`, `find-relationships`, `query-graph`. `apply-semantic-layout` schreibt Layout in die Modelldateien und steht darum auf `ask`; ein Wächter (`test/harness/likec4-mcp.test.ts`) verlangt für jedes Tool ohne `readOnlyHint` einen `ask`-Eintrag.
- **Grenze Worktree:** Der Server liest `docs/architektur/` des Checkouts, in dem die Session gestartet wurde (meist der Haupt-Checkout, ggf. hinter `origin/main`, siehe `scripts/haupt-sync.mjs`), **nicht** den Branch-Worktree. Änderungen am Modell im Worktree prüfst du mit `npm run check:c4` bzw. siehst sie mit `npm run c4:serve`, nicht über den MCP.
- **Kein Gate:** Der MCP ist Abfragewerkzeug, nie Gate-Quelle ([ADR 0017](adr/0017-lebende-doku-generierte-abschnitte.md)); die Gates laufen über `check:c4`.
- **Wo verfügbar:** im Hauptchat ohne `tools:`-Whitelist; Subagenten mit Whitelist (Planer, Umsetzer, Lens) bekommen `mcp__likec4` bewusst nicht. Ein neu eingetragener Server lädt erst mit der nächsten Session. **Fehlerbild:** `claude mcp list` zeigt `likec4` als Failed, und die `mcp__likec4__*`-Tools fehlen.

## Warum unterscheiden sich die AGE-Werte zweier kubectl-Aufrufe?

Jede Eingabe im Terminal lässt den Sim-Takt weiterlaufen: `src/sim.ts` zählt `clock` je Eingabe hoch (rund 20 s Spielzeit), die AGE-Spalte und andere zeitabhängige Werte rechnen daraus. Zwei Aufrufe nie direkt vergleichen; in Tests auf zeitunabhängige Spalten (Name, READY, STATUS) prüfen oder die Ausgabe nur auf die Form (`\d+[smhd]`) testen.

## Warum meldet der Perf-Smoke 60 FPS und die CI später 16?

Phasers Zeitgeber klemmt die ersten 120 Frames (`panicMax`) auf 16,7 ms: der `FrameSampler` zeigt dort immer rund 60, egal wie schnell der Rechner ist. Der scheinbare Abfall nach ca. 3,5 s in der CI-Reihe (60, 35, 21, 16, 16) ist das Ende dieses Anlaufs, kein Einbruch im Spiel: der Runner rendert per Software und liegt eingeschwungen bei 16 bis 31 FPS (lokal deutlich höher; mit gedrosselter CPU und Software-Rendering reproduzierbar, ein eigener rAF-Zähler zeigt dort von Anfang an den niedrigen Wert). Darum prüft `e2e/perf-smoke.spec.ts` den frühen Wert nur als Lebenszeichen (Median aus drei Proben, nur solange höchstens 120 Frames gezählt sind; liegt schon die erste dahinter, entfällt dieser Boden) und den eingeschwungenen (nach ≥ 200 Frames, Median aus fünf Werten) gegen einen am Runner kalibrierten Boden.

<!-- factory-projekt:ende -->

## Wie hänge ich ein Bild an einen PR, und wie prüfe ich ein Mermaid-Diagramm?

Kern: [Wie hänge ich ein Bild an einen PR, und wie prüfe ich ein Mermaid-Diagramm?](https://github.com/fluffels/self-improving-agent-harness-and-factory/blob/v0.2.0/docs/agent-harness-faq.md#wie-hänge-ich-ein-bild-an-einen-pr-und-wie-prüfe-ich-ein-mermaid-diagramm)

<!-- factory-projekt:start -->

**Mermaid hell und dunkel.** Die GitHub-Vorschau lässt sich im MCP-Browser nicht öffnen. Statt dessen rendert [`scripts/mermaid-vorschau.mjs`](../scripts/mermaid-vorschau.mjs) die `mermaid`-Blöcke einer Markdown-Datei mit mermaid 11 hinter einem localhost-Server, je Block auf hellem und dunklem Grund (GitHub-Farben), und zeigt Parse-Fehler als Text:

```bash
npm install --prefix <tmp-ordner> mermaid@11     # einmalig, außerhalb des Repos, kein Eintrag in package.json
node scripts/mermaid-vorschau.mjs README.md --mermaid <tmp-ordner> --port 4173
```

Dann `browser_navigate` auf `http://127.0.0.1:4173/`, per `browser_evaluate` warten, bis `document.body.dataset.fertig === "ja"` (die Seite zählt `pre.mermaid svg` und `.fehler`), Screenshot, danach den Server beenden. Geprüft am 2026-10-07 mit der README (zwei Blöcke, vier Flächen, keine Fehler).

**Bewusst nicht:** ein Dunkelmodus-Schalter im MCP (`colorScheme: dark` global würde jede Spielprüfung verfälschen) und `browser_run_code_unsafe` (führt beliebigen Node-Code aus). Ob die echte GitHub-Darstellung stimmt, bleibt eine Sichtung der Maintainerin; das Skript prüft nur, dass mermaid den Text parst und die Farben auf beiden Gründen lesbar bleiben.

<!-- factory-projekt:ende -->

## Windows und Git-Bash: was geht beim Skripten verloren?

Kern: [Windows und Git-Bash: was geht beim Skripten verloren?](https://github.com/fluffels/self-improving-agent-harness-and-factory/blob/v0.2.0/docs/agent-harness-faq.md#windows-und-git-bash-was-geht-beim-skripten-verloren)

## Wie fahre ich einen Probe-Lauf und warte auf sein Ergebnis?

Kern: [Wie fahre ich einen Probe-Lauf und warte auf sein Ergebnis?](https://github.com/fluffels/self-improving-agent-harness-and-factory/blob/v0.2.0/docs/agent-harness-faq.md#wie-fahre-ich-einen-probe-lauf-und-warte-auf-sein-ergebnis)

## Wie räume ich Scratch auf, wenn Befehle blockiert werden?

Kern: [Wie räume ich Scratch auf, wenn Befehle blockiert werden?](https://github.com/fluffels/self-improving-agent-harness-and-factory/blob/v0.2.0/docs/agent-harness-faq.md#wie-räume-ich-scratch-auf-wenn-befehle-blockiert-werden)

## Verwandte Dokumente

<!-- factory-projekt:start -->

- [Kern-FAQ](https://github.com/fluffels/self-improving-agent-harness-and-factory/blob/v0.2.0/docs/agent-harness-faq.md) — die projektneutralen Fragen zum Harness
- [agent-harness.md](agent-harness.md) — die erklärende Gesamtsicht auf den Harness
- [AGENTS.md](../AGENTS.md) — operative Arbeitsanweisung
- [`docs/referenz/`](referenz/anlaufstellen.md) — Nachschlage-Referenz on-demand (Befehle, Repo-Landkarte, Schichtregeln, Anlaufstellen)

<!-- factory-projekt:ende -->

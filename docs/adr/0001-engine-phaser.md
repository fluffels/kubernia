# ADR 0001: Engine-Wahl – Phaser 3 behalten (vs. Godot/Unity/MonoGame)

> Architecture Decision Record. Format: Kontext → Optionen → Entscheidung → Konsequenzen → Re-Evaluierung.
> Status: **akzeptiert** · Datum: 2026-06-16 · Ticket: #84

## Status

**Akzeptiert.** Phaser 3 bleibt die Engine von KubeQuest.

## Kontext

Mit wachsendem Ambitions-Level (Richtung Stardew-Politur, siehe #44 und die
Architektur-Analyse [`docs/architektur-analyse-stardew.md`](../architektur-analyse-stardew.md))
kommt regelmäßig die Frage auf: „Sollten wir nicht eine richtige Game-Engine
nehmen?" Diese Diskussion taucht in fast jedem zweiten Chat neu auf und kostet
jedes Mal Zeit. Dieses ADR hält die Entscheidung **einmal sauber fest**, damit
sie nicht ständig neu verhandelt wird.

Der Kern-Wert von KubeQuest ist:

- **Läuft offline im Browser**, als **eine einzige Datei** (`dist-offline/index.html`)
  per Doppelklick startbar, einfach verschenkbar.
- Ist ein **Lern-Tool** für Docker/K8s/Helm/Terraform – kein AAA-Spiel.
- Bleibt ein **2D-Spiel** mit überschaubarer Asset-Menge.

## Optionen

| Option | Bewertung |
|---|---|
| **Phaser 3 (Status quo)** | 2D-Web-Engine, npm-Paket, läuft nativ im Browser. Bereits voll integriert, getestete Phaser-freie Domänen-Schicht, Single-File-Offline-Build vorhanden. |
| **Godot** | Mächtig, gut für 2D, kostenlos. Aber: kompletter Rewrite; Web-Export ist groß und kein „eine HTML-Datei zum Verschenken"; Sprache/Workflow (GDScript/Scenes) komplett anders als die heutige TS-Domänenlogik. |
| **Unity** | Großes Ökosystem, aber für ein 2D-Lernspiel massiv überdimensioniert; WebGL-Build schwergewichtig; Lizenz-/Tooling-Overhead. Kompletter Rewrite. |
| **MonoGame** | Code-zentriert (C#), aber kein einfacher Web-/Offline-Pfad; kompletter Rewrite ohne nennenswerten Gewinn für 2D-Web. |

## Entscheidung

**Phaser 3 behalten.** Begründung:

- Der Kern-Wert (offline, eine Datei, verschenkbar, Lern-Tool) ist **genau
  Phasers Stärke** – jede Alternative würde ihn schwächen.
- Godot/Unity/MonoGame wären ein **kompletter Rewrite** für nur marginalen
  Gewinn bei einem 2D-Lernspiel.
- Die heutige Architektur trägt das Wachstum bereits: Die Spiellogik ist
  **Phaser-frei und unit-testbar** (Domäne ↔ Anwendung ↔ Präsentation), nur
  `scenes.ts`/`ui.ts` fassen Phaser an. Ein Engine-Wechsel wäre also vor allem
  ein Austausch der Präsentationsschicht – aber dafür gibt es heute keinen
  zwingenden Grund.
- **Native Distribution** („doppelklicken wie Stardew", Steam) ist über einen
  **Wrapper** erreichbar (#83 Tauri-Evaluierung), **ohne** die Engine zu
  wechseln.

## Konsequenzen

**Positiv**

- Schluss mit der wiederkehrenden „Engine wechseln?"-Diskussion – auf dieses ADR
  verweisen.
- Investitionen fließen in Inhalt, Politur und Asset-Pipeline statt in einen
  Rewrite.
- Der Offline-Single-File-Build bleibt als Alleinstellungsmerkmal erhalten.

**Negativ / Grenzen**

- An echte 3D-Anforderungen oder sehr hohe native Performance kommt Phaser nicht
  heran – das ist bewusst außerhalb des Scopes von KubeQuest.
- Wir binden uns an das Phaser-/Web-Ökosystem (Browser-Rendering-Grenzen).

## Re-Evaluierungs-Trigger

Diese Entscheidung wird neu aufgemacht, wenn **einer** dieser Fälle eintritt:

- **3D wird zwingend** für ein Spielziel (nicht nur „nice to have").
- **Native Performance** wird zum harten Blocker, den der Browser nicht mehr
  schafft (große Welten, viele Entities) und der auch durch Optimierung nicht
  lösbar ist.
- Der **Offline-eine-Datei-Wert** entfällt als Anforderung – dann öffnet sich
  der Optionsraum wieder.
- Phaser 3 wird **nicht mehr gepflegt** / verliert den Web-Support.
- Die **Content-Pipeline** (Schema-Validierung, Hot-Reload, Tooling für
  Nicht-Entwickler) erfordert einen eigenen Backend- oder Server-Prozess, den
  Phaser/Browser allein nicht mehr bedienen kann. Dieser Trigger tritt erst ein,
  wenn Content-as-Data (#348) und Entity-Registry (#349) _trotz Umsetzung_ auf
  Phaser-Grenzen stoßen – nicht vorher. Vorher ist es kein Phaser-Problem,
  sondern ein fehlendes Fundament.

Tritt ein Trigger ein: neues ADR (`0005-…`) mit aktualisierter Abwägung
schreiben, dieses hier auf „abgelöst durch 0005" setzen.

## Bestätigte Re-Evaluierung – 2026-06-19 (#291)

Alle vier Trigger geprüft – **kein Trigger erfüllt**, Entscheidung bestätigt:

- **3D:** kein Spielziel erfordert 3D; Scope bleibt 2D.
- **Native Performance:** kein Blocker. Culling/FPS-Budget (#82) und Bundle-Splitting (#199) zeigen, dass Phaser die Wachstumskurve trägt. Die Domänen-Schicht (sim.ts, content.ts, world.ts, …) bleibt Phaser-frei und unit-testbar – ein Engine-Tausch wäre nur ein Präsentationsschicht-Austausch ohne zwingenden Grund.
- **Offline-eine-Datei-Wert:** weiterhin Kern-Anforderung; `dist-offline/index.html` ist das primäre Verteilformat.
- **Phaser 3:** aktiv gepflegt, kein Wartungs-Risiko erkennbar.

Nächste Re-Evaluierung: wenn einer der Trigger eintritt (kein Termin).

ADR 0004 (2026-06-19) hält die Skalierungsstrategie fest, die Phaser 3 bis zum Content-Pipeline-Trigger trägt: Content-as-Data, Entity-Registry, IndexedDB. Solange diese Fundamente gebaut werden, ist kein Engine-Wechsel nötig.

## Phaser 4 evaluiert – bewusst verschoben (2026-06-30, #443)

Dependabot wollte `phaser` von **3.90 → 4.2.0** heben (Major, CI dabei rot). Das ist **kein** Engine-Wechsel im Sinne der Trigger oben (Phaser bleibt Phaser), aber ein Breaking-Major, der eine bewusste Abwägung verdient. Ergebnis der Evaluierung im eigenen Worktree:

- **Code-Aufwand ist trivial.** Der einzige Bruch in unserem Code ist `RenderTexture.drawFrame()` (in Phaser 4 entfernt). Ersatz: `stamp(key, frame, x, y, { originX: 0, originY: 0 })` (default zentriert, daher Ursprung oben-links setzen) + ein `render()`-Flush nach der Back-Schleife (v4 puffert Zeichenbefehle). Betrifft nur 5 Präsentations-Dateien (`InteriorScene`, `RegionScene`, `worldscene/terrain`, `worldscene/scenery`). Dazu `roundPixels: true` explizit in der Game-Config (v4-Default geändert). **`npm test` (1313), `typecheck`, `lint`, `check:arch`, `smoke` alle grün; World + alle Regionen rendern im Browser einwandfrei.** Patch liegt am Ticket #443.
- **Blocker ist ein Renderer-Bug in Phaser 4.2.0 selbst, nicht in unserem Code.** Bei Szenen, deren Welt **kleiner als der Kamera-Viewport** ist (die `InteriorScene`, 176×128 px), füllt/cleart der neue WebGL-Renderer den Bereich **außerhalb der Welt-Bounds nicht** → es bleibt alter Framebuffer-Inhalt am Rand stehen. Belegt: gl-Viewport/drawingBuffer/Canvas alle voll, nur die Interior-Szene rendert, Kamera-Hintergrund opak und voller Viewport. **7 App-seitige Workarounds getestet** (Bounds entfernen/aufziehen, World-Space- & Screen-Space-Backdrop-Rechteck, dedizierte Backdrop-Kamera Zoom 1, `forceComposite`, Viewport-Refresh, World `stop()` statt `sleep()`) — **keiner** deckt die Region ab, weil der Renderer sie nie bezeichnet. Eine saubere Lösung bräuchte einen Patch an Phasers Renderer-Internas (nicht wartbar) oder einen Upstream-Fix.
- **Kontext:** Phaser 4 ist sehr jung (4.0.0 = 2026-04-10, 4.2.0 = 2026-06-19, ~2,5 Monate, Renderer komplett neu geschrieben). Es gibt **keine neuere 4.x** zum Ausweichen und **kein offenes GitHub-Issue**, das diesen Fall beschreibt (also noch nicht auf Phasers Reparaturliste).

**Entscheidung:** Auf **Phaser 3.90.x** bleiben (rendert alle Szenen korrekt, null Risiko), der 4er-Sprung wird **verschoben**, nicht verworfen. Re-Eval, wenn der Renderer-Bug upstream gefixt ist bzw. 4.x reift (Folge-Ticket). Der fertige Migrations-Patch (drawFrame→stamp etc.) hängt an #443 und ist gegen ein gefixtes Phaser 4 in Minuten erneut anwendbar.

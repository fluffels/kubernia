# ADR 0018: Content-Chunks je Datei — der Spielcode-Chunk wächst nicht mehr mit dem Inhalt

> Architecture Decision Record. Format: Kontext → Problem → Optionen → Recherche → Entscheidung → Konsequenzen → Re-Evaluierung.
> Status: **akzeptiert** · Datum: 2026-10-07 · Ticket: #1408

> Offline-Budget präzisiert durch #1411 (PR #1427, 2026-10-07): beide Builds tragen einen Content-Stempel (Hash der Content-Quellen als Meta-Tag `kq-content-stempel`), `check:bundle` vergleicht ihn, ein fehlender oder abweichender Stempel ist rot ([Beschreibung](../agent-harness.md#3a-langfassung-der-harten-regeln-ausgelagert-aus-agentsmd-1064)).

## Status

**Akzeptiert.** Ergänzt [ADR 0004](0004-skalierungs-fundament.md) (Content-as-Data) und [ADR 0005](0005-auslieferungsform.md) (Auslieferungsform) um die Frage, wie der Content ausgeliefert wird. Die Verteilungssicht steht in [arc42 §7](../arc42-architektur.md#7-verteilungssicht), die Gate-Mechanik in [docs/agent-harness.md](../agent-harness.md#3a-langfassung-der-harten-regeln-ausgelagert-aus-agentsmd-1064).

## Kontext

Der Spielcode-Chunk des Host-Builds (alle JS-Chunks ohne Phaser-`vendor`) lag bei 1.417.352 B gegen ein Budget von 1.418.000 B: 648 B Luft. Jedes Content-Ticket musste Text kürzen oder das Budget anheben. Bei Stardew-Größe (10× Inhalt) wächst der Chunk linear mit, Anheben ist keine Strategie.

Messung (Stand `bd0ef34`, Host-Build, vor der Änderung):

| Anteil am Haupt-Chunk (minifiziert) | Bytes | Quote |
|---|---|---|
| `JSON.parse`-Strings der 25 Content-JSONs | 608.373 | 42,9 % |
| `data:image`-URIs (86 PNGs unter 4 KB, `assetsInlineLimit`-Default) | 157.416 | 11,1 % |
| Rest (Code und kleine JSON-Literale) | 651.563 | 46,0 % |

Vor dem Minifizieren (Rollup-Modulgrößen): `src/content/data` 46,1 %, PNG und `.tmj` inline 11,5 %, Code 42,4 %. Größte Einzeldateien: `quests/knut.json` 99 KB, `quests/ole.json` 73 KB, `quests/ada.json` 61 KB, `crabquiz/storage.json` 31 KB. Über die Hälfte des Chunks sind also Daten, die mit jedem Content-Ticket wachsen, nicht Code.

## Problem

Wie bleibt der Spielcode-Chunk stabil, wenn der Inhalt wächst, ohne den Offline-Einzeldatei-Build (arc42 §7) oder den synchronen Content-Zugriff (`getQuests()` in Save, Fortschritt, Logbuch, Album, Wiederholung, Boot-Validierung) zu brechen?

## Optionen

- **A. Budget anheben.** Verworfen: verschiebt das Problem, wächst mit jedem Ticket.
- **B. Ein großer Content-Chunk.** Verworfen: der Chunk wüchse selbst unbegrenzt, jede Content-Änderung invalidiert den ganzen Cache, kein Deckel je Datei.
- **C. Statische Chunks je Content-Datei (gewählt, Stufe 1).** Jede Datei unter `src/content/data/` (und jede Karte unter `assets/maps/`) ist ein eigener Chunk. Der Loader bleibt synchron, weil die Chunks statisch importiert und vor dem Spielcode ausgewertet werden.
- **D. Echtes Lazy-Load je Region (dynamischer `import()`), sofort.** Verworfen für jetzt: alle Konsumenten lesen ganze Sammlungen synchron, Lazy-Load bräuchte einen asynchronen Boot und einen Index/Body-Split der Content-API (ein Epic ohne heutigen Nutzen: der gesamte Content ist 770 KB, 222 KB gzip). Bleibt als Stufe 2 mit hartem Auslöser (unten).
- **E. Größen-Bins per Rolldown-`maxSize`.** Verworfen: Chunk-Namen wären nicht stabil an Quelldateien gebunden, das Gate könnte die erwartete Menge nicht ableiten.

## Recherche

Ein Probe-Build mit der Zielkonfiguration (`manualChunks` je Content-Datei, `assetsInlineLimit: 0`) ergab: `index-*.js` 501.640 B (reiner Code), 54 Content-Chunks zusammen 770.281 B (größter `content-quests-knut` 95.216 B, `content-core` 22.084 B), Content gzip 222.235 B, Code gzip 157.097 B. Die Content-Chunks importieren nur die winzige Rolldown-Runtime (kein Chunk-Zyklus mit `index`). `vite-plugin-singlefile` (v2.3.3) setzt `codeSplitting: false` und inlined alle Assets und dynamischen Imports, der Offline- und der Devpanel-Build bleiben unverändert.

## Entscheidung

**Stufe 1 jetzt: Option C.** Die Namensregel ist eine einzige Quelle, [`scripts/content-chunks.cjs`](../../scripts/content-chunks.cjs): `src/content/data/<dir>/<name>.json` wird `content-<dir>-<name>`, Dateien direkt unter `data/` teilen sich `content-core`, `assets/maps/<name>.tmj` wird `content-maps-<name>`. `vite.config.ts` nutzt sie für `manualChunks` (nur Host-Build; Ausgabe unter `dist/assets/content/`), `scripts/check-bundle.mjs` leitet daraus die erwartete Menge ab. Kleine PNGs werden im Host-Build nicht mehr inline eingebettet (`assetsInlineLimit: 0`); im Offline-Build inlined `singlefile` ohnehin alles.

Budgets je Chunk-Art (`scripts/check-bundle.mjs`):

| Chunk-Art | Budget | Herleitung |
|---|---|---|
| Spielcode (ohne `vendor`, ohne Content) | 530.000 B | Ist 501.798 B +5 %, auf 10.000 aufgerundet |
| Content-Chunk je Datei | 128.000 B | größter Ist 95.216 B; reißt eine Datei den Deckel, wird sie gesplittet |
| Content-Chunks gesamt | 2.000.000 B | Ist 770.281 B; Auslöser für Stufe 2, nicht anhebbar |
| Offline-HTML ohne Content | 2.529.000 B | altes Budget 3.300.000 B minus Content-Ist 770.281 B, abgerundet |
| Phaser-`vendor` | 1.450.000 B | unverändert |

Das Gate wird rot bei: fehlendem erwartetem Chunk, unerwartetem Chunk (ohne Quelldatei), Chunk über dem Deckel, Summe über dem Auslöser. Ein Host-Boot-Smoke (`e2e/host-boot-smoke.spec.ts`) startet den echten Multi-File-Build über Vites `preview` und prüft, dass das Spiel bootet und die Content-Chunks mit 200 ausgeliefert werden.

## Konsequenzen

- Der Spielcode-Chunk wächst nur noch mit Code. Neue Quests, NPCs, Crabquiz-Fragen oder Karten wachsen ihren eigenen Chunk und das Offline-Budget bleibt unberührt, solange der Content im Content-Budget bleibt.
- Mehr Requests beim Boot (54 `modulepreload`, 109 PNG-Dateien statt Inline): unter HTTP/2 und einem `immutable`-Cache vertretbar; Content-Änderungen invalidieren nur den betroffenen Chunk.
- Split-Regel für Autoren (`src/content/AGENTS.md`): reißt eine Datei den Deckel, in Unterdateien aufteilen (z.B. `quests/knut-dns.json`); der Loader ist dateinamen-agnostisch.
- Die globalen Dateien `smalltalk.json`, `entities.json` und `npcs.json` liegen gemeinsam in `content-core`; der Deckel erzwingt dort einen Split nach NPC/Region, bevor sie zum Monolithen werden.
- Der Offline-Build enthält weiterhin alles; sein Rest-Puffer (28 KB gegenüber dem Gesamtbudget) wird von der PixelLab-Icon-Welle (#1245 bis #1253) aufgebraucht. Dann ist das Offline-Budget eine bewusste Anhebung wert, nicht der Content-Chunk.
- Die Chunk-Auswertungsreihenfolge hängt am Bundler (Rolldown/Vite); der Host-Boot-Smoke fängt eine Änderung dort.
- Lockerung ausdrücklich: Das Offline-Budget misst den Offline-Build abzüglich der Chunk-Summe des Host-Builds. Die Offline-Datei darf damit bis etwa Offline-Budget plus Content-Summe wachsen (rund 4,5 MB statt bisher 3,3 MB); dafür trägt der Content seinen eigenen, strengeren Deckel. `dist/` und `dist-offline/` müssen vom selben Stand sein.
- Messwerte sind lokal unter Windows gemessen; die CI (Linux) liegt etwa 1 KB niedriger.
- Das Gate erkennt Namenskollisionen der Namensregel (verschiedene Dateien, gleicher Chunk-Name) und begrenzt die Chunk-Zahl auf 200.
- Keine Save-Migration: Content-IDs und Save-Format bleiben unberührt.

## Re-Evaluierung

**Stufe 2 (Lazy-Load je Region per `import()`, asynchroner Boot, Index/Body-Split)** wird gebaut, sobald eines davon eintritt: die Content-Summe erreicht 2 MB (das Gate wird rot), es gibt mehr als etwa 200 Content-Chunks, oder die Auslieferungsform ändert sich ([ADR 0005](0005-auslieferungsform.md)). Die Chunk-Grenzen von Stufe 1 sind die späteren Lazy-Grenzen; Stufe 2 bleibt offline-tauglich, weil `singlefile` dynamische Imports inlined. Das Summen-Budget wird dafür nicht angehoben.

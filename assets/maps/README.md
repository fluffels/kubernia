# Tiled-Maps (`assets/maps/`)

Hier liegen die Spielkarten als **Tiled-JSON** (`.tmj`). Begonnen als Teil 1 der
Tiled-Migration ([#191](https://github.com/fluffels/kubequest/issues/191), Epic
[#57](https://github.com/fluffels/kubequest/issues/57)) – das Fundament:
ein Export-Format + ein generischer Loader, der **eine** Map rendert.

Seit **Teil 2 ([#192](https://github.com/fluffels/kubequest/issues/192))** liegt
zusätzlich die **echte Hafenkarte** als Daten vor (`harbor.tmj`, 52×40): mit
`?tiledmap` in der URL kommt der Hafen-Boden + die Kollision aus der Datei statt
aus der prozeduralen `buildMap()`. Das ist **pixelgleich** – derselbe Renderer
(`renderGround()`), nur die Geometrie-Quelle wechselt. `buildMap()` bleibt der
Default (Umschalt-Pfad); abgelöst wird sie erst in
[#196](https://github.com/fluffels/kubequest/issues/196).

## Format-Konvention

- **Export aus Tiled als `.tmj`** (JSON, *nicht* `.tmx`/XML). In Tiled:
  *Map → Export As… → JSON map files (`*.tmj`)*. So bleibt die Datei direkt
  parsbar (kein XML-Parser nötig) und gut im Diff lesbar.
- **Orthogonal, 16×16 px Tiles.** Teil 1 unterstützt bewusst nur orthogonale
  Maps mit 16er-Raster (passt zum `pixelArt`-Renderer und zu `TILE = 16` in
  [`src/world/world.ts`](../../src/world/world.ts)).
- **Eingebettete Tilesets** (kein „Embed in map"-Häkchen weglassen). Externe
  `.tsx`-Tilesets sind in Teil 1 noch nicht unterstützt – der Validator lehnt
  Tilesets ohne `image`-Feld ab.
- **Tileset-Name = Asset-Schlüssel.** Der `name` eines Tilesets im `.tmj` muss
  exakt einem Schlüssel im `ASSET_MANIFEST`
  ([`src/assets-data.ts`](../../src/assets-data.ts)) entsprechen (z. B. `town`).
  Darüber hängt der Loader die bereits geladene Textur per
  `addTilesetImage(name, key)` an – kein zweites Mal laden, kein Pfad-Raten.
- **Layer:** mindestens ein Tile-Layer fürs Sichtbare und ein Tile-Layer für die
  Kollision. Im Kollisionslayer gilt jede gesetzte Kachel (`gid != 0`) als
  solide; leere Kacheln (`0`) sind begehbar. Layer-Namen sind frei wählbar, der
  Loader spricht sie über den Namen an (Beispiel hier: `Boden` + `Kollision`).

## Wer lädt das?

- Reine, Phaser-freie Logik (Typen, Validierung, Kollisions-Raster,
  Tileset→Asset-Mapping): [`src/world/maps/tilemap.ts`](../../src/world/maps/tilemap.ts), getestet in
  [`test/tilemap.test.ts`](../../test/tilemap.test.ts) (parst u. a. das echte
  `test-map.tmj` und prüft die Fehlerfälle).
- Hafenkarte-Geometrie + Tiled-Serialisierung (Phaser-frei):
  [`src/world/maps/harbormap.ts`](../../src/world/maps/harbormap.ts), getestet in
  [`test/harbormap.test.ts`](../../test/harbormap.test.ts). Dieselbe Quelle
  erzeugt `harbor.tmj` (Generator, s. u.) und decodiert es im Datenpfad zurück.
- Phaser-Rendering der Loader-Demo (`make.tilemap` / `addTilesetImage` /
  `createLayer` + Kollision): die `TilemapTestScene` in
  [`src/scenes.ts`](../../src/scenes.ts). Die **Hafenkarte** rendert dagegen über
  den bestehenden `renderGround()`/`renderStatics()` (Wang-Autotiling + PixelLab)
  – ein Kachel-Sheet-`createLayer` könnte den Look nicht 1:1 reproduzieren; darum
  trägt `harbor.tmj` die Geometrie als **Daten** (Boden = semantische
  Terrain-Codes, leicht offset-kodiert für Tileds gid≥1; Kollision = solide
  Kacheln) und der Terrain-Lader (`loadMapTerrain`, #425) speist damit denselben Renderer.

## Im Browser ansehen

`npm run dev` starten und die angezeigte Adresse öffnen:

- **`?maptest`** (z. B. `http://localhost:5173/?maptest`) – die
  `TilemapTestScene` (#191): `test-map.tmj` mit Boden-Layer + rot eingefärbtem
  Kollisions-Ring.
- **`?tiledmap`** (z. B. `http://localhost:5173/?tiledmap`) – die normale
  `WorldScene`, aber Boden + Kollision kommen aus `harbor.tmj` statt aus
  `buildMap()` (#192). Sieht identisch zum Standard-Start aus – das ist der Beweis.

## Generieren / aktualisieren

`harbor.tmj` ist ein **generiertes Artefakt** aus `harborTiledMap()` in
`src/world/maps/harbormap.ts`. Neu erzeugen nach einer Geometrie-Änderung:

```
GEN_HARBOR=1 npx vitest run test/harbormap.test.ts
```

Ein Test vergleicht die ausgelieferte Datei gegen `harborTiledMap()` und schlägt
fehl, sobald sie auseinanderlaufen (Drift-Schutz).

## Dateien

| Datei | Inhalt |
|---|---|
| `test-map.tmj` | minimale 8×6-Demo-Map: Tileset `town`, Layer `Boden` + `Kollision` (Rand-Ring solide). Dient als Loader-Beweis und als Fixture für `test/tilemap.test.ts`. |
| `harbor.tmj` | die echte 52×40-Hafenkarte als Daten (#192): Tile-Layer `Boden` (Terrain-Codes) + `Kollision` (Wasser/Struktur) sowie die Objektlayer `Türen` (Türen/Warps, #194) und `NPCs` (feste NPC-Standplätze, #195). Generiert aus `src/harbormap.ts` (neu erzeugen: `GEN_HARBOR=1 npx vitest run test/harbormap.test.ts`); geladen via `?tiledmap`. |

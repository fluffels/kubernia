/* Tests für #148 – Expeditions-Flotte: Flaggschiff-Deck + Anleger/Warp.
 *
 * scenes.ts ist Phaser-gekoppelt und nicht im Node-Lauf importierbar; geprüft wird daher die
 * pure Deck-Mathe aus src/flotte.ts, aus der die datengetriebene RegionScene (#427) die Region
 * baut. Bewusst auch Grenz-/Negativfälle: Deck rundum von Meer umschlossen, Wasser solide (man
 * läuft nicht hinein), kein Re-Trigger-Loop am Anleger, vertäute Schiffe NICHT begehbar, und –
 * der wichtigste Fall – die Deck-Mitte muss vom Ankunfts-Steg aus wirklich erreichbar sein,
 * sonst wäre die Flotte eine hübsche, aber tote Karte.
 */
import { test, expect } from "vitest";
import { TILE } from "../src/world";
import {
  FW, FH, WATER, DOCK, DX0, DX1, DY0, DY1,
  buildFlotte, warpAt,
  WORLD_JETTY_FL, WORLD_TO_FLOTTE, WORLD_RETURN_FL,
  FLOTTE_TO_WORLD, FLOTTE_ARRIVAL,
} from "../src/flotte";

const map = buildFlotte();
const CENTER_TX = FLOTTE_TO_WORLD.tx;   // Mittelachse (Steg) = CX

/** 4er-Nachbar-Flood-Fill über begehbare Kacheln (solid==0) ab einer Startkachel. */
function reachable(startTx: number, startTy: number): Set<number> {
  const seen = new Set<number>();
  const stack: [number, number][] = [[startTx, startTy]];
  const passable = (x: number, y: number) =>
    x >= 0 && y >= 0 && x < map.W && y < map.H && map.solid[y * map.W + x] === 0;
  while (stack.length) {
    const [x, y] = stack.pop()!;
    const i = y * map.W + x;
    if (seen.has(i) || !passable(x, y)) continue;
    seen.add(i);
    stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
  }
  return seen;
}

test("Deck-Raster hat die erwartete Größe und vollständige Boden-/Solid-Arrays", () => {
  expect(map.W).toBe(FW);
  expect(map.H).toBe(FH);
  expect(map.ground).toHaveLength(FW * FH);
  expect(map.solid).toHaveLength(FW * FH);
});

test("Deck ist rundum von Meer umschlossen (kein Holz am Kartenrand)", () => {
  for (let x = 0; x < FW; x++) {
    expect(map.ground[0 * FW + x]).toBe(WATER);
    expect(map.ground[(FH - 1) * FW + x]).toBe(WATER);
  }
  for (let y = 0; y < FH; y++) {
    expect(map.ground[y * FW + 0]).toBe(WATER);
    expect(map.ground[y * FW + (FW - 1)]).toBe(WATER);
  }
});

test("Wasser ist solide, Holz-Deck/-Steg begehbar (Negativ-/Positivfall der Kollision)", () => {
  for (let i = 0; i < map.ground.length; i++) {
    if (map.ground[i] === WATER) expect(map.solid[i]).toBe(1);   // ins Meer läuft man nicht
    if (map.ground[i] === DOCK) expect(map.solid[i]).toBe(0);    // Deck/Steg-Planken begehbar
  }
});

test("das Deck besteht aus genug Holz-Planken und hat einen Steg-Anteil", () => {
  const dock = map.ground.filter((c) => c === DOCK).length;
  const deckArea = (DX1 - DX0 + 1) * (DY1 - DY0 + 1);
  expect(dock).toBeGreaterThan(deckArea);   // Deck-Rechteck + Steg-Planken
});

test("Anleger, Ankunft und Rück-Warp liegen im Raster und sind begehbar", () => {
  for (const { tx, ty } of [FLOTTE_TO_WORLD, FLOTTE_ARRIVAL]) {
    expect(tx >= 0 && tx < FW && ty >= 0 && ty < FH, `(${tx},${ty}) im Raster`).toBe(true);
    expect(map.solid[ty * FW + tx], `(${tx},${ty}) muss begehbar sein`).toBe(0);
  }
});

test("die Deck-Mitte ist vom Anleger aus erreichbar – die Flotte ist nicht tot", () => {
  const reach = reachable(FLOTTE_ARRIVAL.tx, FLOTTE_ARRIVAL.ty);
  // Deck-Mitte (CY=6) – stellvertretend für „man kommt aufs Deck".
  expect(reach.has(6 * FW + CENTER_TX), "Deck-Mitte erreichbar").toBe(true);
  // Auch die Deck-Ecken (begehbare Planken) müssen vom Anleger aus erreichbar sein.
  expect(reach.has(DY0 * FW + DX0), "Deck-Ecke NW erreichbar").toBe(true);
  expect(reach.has(DY1 * FW + DX1), "Deck-Ecke SO erreichbar").toBe(true);
});

test("warpAt trifft die Warp-Kachel und nur diese (Negativfall: Nachbarkachel zählt nicht)", () => {
  expect(warpAt(WORLD_TO_FLOTTE.tx * TILE + 8, WORLD_TO_FLOTTE.ty * TILE + 8, WORLD_TO_FLOTTE)).toBe(true);
  expect(warpAt(WORLD_TO_FLOTTE.tx * TILE + 1, WORLD_TO_FLOTTE.ty * TILE + 15, WORLD_TO_FLOTTE)).toBe(true);
  expect(warpAt((WORLD_TO_FLOTTE.tx - 1) * TILE + 8, WORLD_TO_FLOTTE.ty * TILE + 8, WORLD_TO_FLOTTE)).toBe(false);
  expect(warpAt(WORLD_TO_FLOTTE.tx * TILE + 8, (WORLD_TO_FLOTTE.ty + 1) * TILE + 8, WORLD_TO_FLOTTE)).toBe(false);
});

test("kein Re-Trigger-Loop: die Ankunfts-/Rückkehrkacheln sind NICHT selbst die Warp-Kachel", () => {
  // Flotte: man landet eine Kachel landwärts vom Rück-Anleger
  expect(warpAt(FLOTTE_ARRIVAL.tx * TILE + 8, FLOTTE_ARRIVAL.ty * TILE + 8, FLOTTE_TO_WORLD)).toBe(false);
  // Hauptkarte: man landet eine Kachel vor dem Anleger, nicht auf der Warp-Kachel
  expect(warpAt(WORLD_RETURN_FL.tx * TILE + 8, WORLD_RETURN_FL.ty * TILE + 8, WORLD_TO_FLOTTE)).toBe(false);
});

test("Rückkehr auf der Hauptkarte landet eine Kachel landwärts (nördlich) über dem Anleger", () => {
  expect(WORLD_RETURN_FL.tx).toBe(WORLD_TO_FLOTTE.tx);
  expect(WORLD_RETURN_FL.ty).toBe(WORLD_TO_FLOTTE.ty - 1);
  // Rückkehr-Kachel liegt auf den Stegplanken (zwischen y0 und y1 des Stegs)
  expect(WORLD_RETURN_FL.ty >= WORLD_JETTY_FL.y0 && WORLD_RETURN_FL.ty <= WORLD_JETTY_FL.y1).toBe(true);
});

test("Ankunft auf der Flotte liegt eine Kachel landwärts (nördlich) über dem Rück-Anleger", () => {
  expect(FLOTTE_ARRIVAL.tx).toBe(FLOTTE_TO_WORLD.tx);
  expect(FLOTTE_ARRIVAL.ty).toBe(FLOTTE_TO_WORLD.ty - 1);
});

test("vertäute Flotten-Schiffe stehen auf Wasser (nicht begehbar) und im Raster", () => {
  expect(map.ships.length).toBeGreaterThan(0);
  for (const s of map.ships) {
    expect(s.x >= 0 && s.x < FW && s.y >= 0 && s.y < FH, `Schiff (${s.x},${s.y}) im Raster`).toBe(true);
    const i = s.y * FW + s.x;
    expect(map.ground[i], `Schiff (${s.x},${s.y}) auf Wasser`).toBe(WATER);
    expect(map.solid[i], `Schiff (${s.x},${s.y}) bleibt solide (nicht begehbar)`).toBe(1);
  }
});

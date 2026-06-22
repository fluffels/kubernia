/* Tests für #130 – Wachturm-Quartier: Festungs-Bailey + Anleger/Warp.
 *
 * scenes.ts ist Phaser-gekoppelt und nicht im Node-Lauf importierbar; geprüft wird daher die
 * pure Hof-Mathe aus src/watchtower.ts, aus der die datengetriebene RegionScene (#427) die
 * Region baut. Bewusst auch Grenz-/Negativfälle: Hof rundum von Meer umschlossen, Wachturm
 * solide (man läuft nicht hindurch), kein Re-Trigger-Loop am Anleger, und – der wichtigste
 * Fall – die Hof-Mitte muss vom Ankunfts-Steg aus wirklich begehbar erreichbar sein, sonst
 * wäre das Quartier eine hübsche, aber tote Karte.
 */
import { test, expect } from "vitest";
import { TILE } from "../src/world";
import {
  WTW, WTH, WATER, DOCK, PATH, STONE_CODES,
  buildWatchtower, warpAt, watchtowerFootprint, WATCHTOWER_TOWER,
  WORLD_JETTY_WT, WORLD_TO_WATCHTOWER, WORLD_RETURN_WT,
  WATCHTOWER_TO_WORLD, WATCHTOWER_ARRIVAL,
} from "../src/watchtower";

const map = buildWatchtower();
const isStone = (c: number) => (STONE_CODES as readonly number[]).includes(c);
const CENTER_TX = WATCHTOWER_TO_WORLD.tx;   // Mittelachse (Tor/Steg) = CX

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

test("Hof-Raster hat die erwartete Größe und vollständige Boden-/Solid-Arrays", () => {
  expect(map.W).toBe(WTW);
  expect(map.H).toBe(WTH);
  expect(map.ground).toHaveLength(WTW * WTH);
  expect(map.solid).toHaveLength(WTW * WTH);
});

test("Hof ist rundum von Meer umschlossen (kein Land am Kartenrand)", () => {
  for (let x = 0; x < WTW; x++) {
    expect(map.ground[0 * WTW + x]).toBe(WATER);
    expect(map.ground[(WTH - 1) * WTW + x]).toBe(WATER);
  }
  for (let y = 0; y < WTH; y++) {
    expect(map.ground[y * WTW + 0]).toBe(WATER);
    expect(map.ground[y * WTW + (WTW - 1)]).toBe(WATER);
  }
});

test("Wasser ist solide, Pfad + Holz-Steg begehbar (Negativ-/Positivfall der Kollision)", () => {
  for (let i = 0; i < map.ground.length; i++) {
    if (map.ground[i] === WATER) expect(map.solid[i]).toBe(1);   // ins Meer läuft man nicht
    if (map.ground[i] === PATH) expect(map.solid[i]).toBe(0);    // Tor/Pfad begehbar
    if (map.ground[i] === DOCK) expect(map.solid[i]).toBe(0);    // Steg-Planken begehbar
  }
});

test("der Hof besteht aus Stein-Wehrmauer + Gras-Bailey (genug von beidem) und hat einen Holz-Steg", () => {
  const grass = map.ground.filter((c) => c === 0 || c === 1 || c === 2).length;
  const stone = map.ground.filter((c) => isStone(c)).length;
  const dock = map.ground.filter((c) => c === DOCK).length;
  expect(grass).toBeGreaterThan(60);
  expect(stone).toBeGreaterThan(20);
  expect(dock).toBeGreaterThan(2);   // Anleger-Planken im Süden
});

test("Anleger, Ankunft und Rück-Warp liegen im Raster und sind begehbar", () => {
  for (const { tx, ty } of [WATCHTOWER_TO_WORLD, WATCHTOWER_ARRIVAL]) {
    expect(tx >= 0 && tx < WTW && ty >= 0 && ty < WTH, `(${tx},${ty}) im Raster`).toBe(true);
    expect(map.solid[ty * WTW + tx], `(${tx},${ty}) muss begehbar sein`).toBe(0);
  }
});

test("die Hof-Mitte ist vom Anleger aus erreichbar – das Quartier ist nicht tot", () => {
  const reach = reachable(WATCHTOWER_ARRIVAL.tx, WATCHTOWER_ARRIVAL.ty);
  // Mittelachse oben am Pfad-Ende (CY=7) – stellvertretend für „man kommt in den Hof".
  expect(reach.has(7 * WTW + CENTER_TX), "Hof-Mitte erreichbar").toBe(true);
  // Auch eine Kachel direkt unter dem Wachturm-Fuß muss erreichbar sein (man kommt an ihn heran).
  const belowTower = (WATCHTOWER_TOWER.y + 1) * WTW + WATCHTOWER_TOWER.x;
  expect(reach.has(belowTower), "Wachturm von unten erreichbar").toBe(true);
});

test("der Wachturm-Fußabdruck (2×2) ist vollständig solide (man läuft nicht hindurch)", () => {
  const foot = watchtowerFootprint();
  expect(foot).toHaveLength(WATCHTOWER_TOWER.w * WATCHTOWER_TOWER.h);
  for (const t of foot) {
    expect(t.x >= 0 && t.x < WTW && t.y >= 0 && t.y < WTH, `(${t.x},${t.y}) im Raster`).toBe(true);
    expect(map.solid[t.y * WTW + t.x], `(${t.x},${t.y}) muss solide sein`).toBe(1);
  }
});

test("der Wachturm steht auf Gras-Bailey, nicht auf Pfad/Steg/Ankunft (Aufgang bleibt frei)", () => {
  const reserved = new Set<number>([
    WATCHTOWER_ARRIVAL.ty * WTW + WATCHTOWER_ARRIVAL.tx,
    WATCHTOWER_TO_WORLD.ty * WTW + WATCHTOWER_TO_WORLD.tx,
  ]);
  for (const t of watchtowerFootprint()) {
    const i = t.y * WTW + t.x;
    expect(map.ground[i]).not.toBe(PATH);
    expect(map.ground[i]).not.toBe(DOCK);
    expect(reserved.has(i), `Turm auf reserviertem Feld (${t.x},${t.y})`).toBe(false);
    expect([0, 1, 2]).toContain(map.ground[i]);   // Gras-Bailey
  }
});

test("warpAt trifft die Warp-Kachel und nur diese (Negativfall: Nachbarkachel zählt nicht)", () => {
  expect(warpAt(WORLD_TO_WATCHTOWER.tx * TILE + 8, WORLD_TO_WATCHTOWER.ty * TILE + 8, WORLD_TO_WATCHTOWER)).toBe(true);
  expect(warpAt(WORLD_TO_WATCHTOWER.tx * TILE + 1, WORLD_TO_WATCHTOWER.ty * TILE + 15, WORLD_TO_WATCHTOWER)).toBe(true);
  expect(warpAt((WORLD_TO_WATCHTOWER.tx - 1) * TILE + 8, WORLD_TO_WATCHTOWER.ty * TILE + 8, WORLD_TO_WATCHTOWER)).toBe(false);
  expect(warpAt(WORLD_TO_WATCHTOWER.tx * TILE + 8, (WORLD_TO_WATCHTOWER.ty + 1) * TILE + 8, WORLD_TO_WATCHTOWER)).toBe(false);
});

test("kein Re-Trigger-Loop: die Ankunfts-/Rückkehrkacheln sind NICHT selbst die Warp-Kachel", () => {
  // Quartier: man landet eine Kachel landwärts vom Anleger
  expect(warpAt(WATCHTOWER_ARRIVAL.tx * TILE + 8, WATCHTOWER_ARRIVAL.ty * TILE + 8, WATCHTOWER_TO_WORLD)).toBe(false);
  // Hauptkarte: man landet eine Kachel vor dem Anleger, nicht auf der Warp-Kachel
  expect(warpAt(WORLD_RETURN_WT.tx * TILE + 8, WORLD_RETURN_WT.ty * TILE + 8, WORLD_TO_WATCHTOWER)).toBe(false);
});

test("Rückkehr auf der Hauptkarte landet eine Kachel landwärts (nördlich) über dem Anleger", () => {
  expect(WORLD_RETURN_WT.tx).toBe(WORLD_TO_WATCHTOWER.tx);
  expect(WORLD_RETURN_WT.ty).toBe(WORLD_TO_WATCHTOWER.ty - 1);
  // Rückkehr-Kachel liegt auf den Stegplanken (zwischen y0 und y1 des Stegs)
  expect(WORLD_RETURN_WT.ty >= WORLD_JETTY_WT.y0 && WORLD_RETURN_WT.ty <= WORLD_JETTY_WT.y1).toBe(true);
});

test("Ankunft im Quartier liegt eine Kachel landwärts (nördlich) über dem Rück-Anleger", () => {
  expect(WATCHTOWER_ARRIVAL.tx).toBe(WATCHTOWER_TO_WORLD.tx);
  expect(WATCHTOWER_ARRIVAL.ty).toBe(WATCHTOWER_TO_WORLD.ty - 1);
});

/* Tests für #124 – Lagerhallen-Viertel: Hafenkai-Bereich + Anleger/Warp.
 *
 * scenes.ts ist Phaser-gekoppelt und nicht im Node-Lauf importierbar; geprüft wird
 * daher die pure Kai-Mathe aus src/warehouse.ts, aus der die datengetriebene RegionScene
 * (#427) die Lager-Region baut. Bewusst auch
 * Grenz-/Negativfälle: Kai rundum von Meer umschlossen, kein Re-Trigger-Loop am Anleger,
 * und – der wichtigste Fall – NPC-Standplatz + Quest-Trigger müssen vom Ankunfts-Steg aus
 * wirklich begehbar erreichbar sein, sonst wäre das Viertel eine hübsche, aber tote Karte.
 */
import { test, expect } from "vitest";
import { TILE } from "../src/world";
import {
  WW, WH, WATER, DOCK, PATH, STONE_CODES,
  buildWarehouse, warpAt,
  WORLD_JETTY_WH, WORLD_TO_WAREHOUSE, WORLD_RETURN_WH,
  WAREHOUSE_TO_WORLD, WAREHOUSE_ARRIVAL,
  WAREHOUSE_NPC, WAREHOUSE_QUEST_TRIGGER, WAREHOUSE_CRANES, WAREHOUSE_CONTAINERS,
} from "../src/warehouse";

const map = buildWarehouse();
const isStone = (c: number) => (STONE_CODES as readonly number[]).includes(c);

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

test("Kai-Raster hat die erwartete Größe und vollständige Boden-/Solid-Arrays", () => {
  expect(map.W).toBe(WW);
  expect(map.H).toBe(WH);
  expect(map.ground).toHaveLength(WW * WH);
  expect(map.solid).toHaveLength(WW * WH);
});

test("Kai ist rundum von Meer umschlossen (kein Land am Kartenrand)", () => {
  for (let x = 0; x < WW; x++) {
    expect(map.ground[0 * WW + x]).toBe(WATER);
    expect(map.ground[(WH - 1) * WW + x]).toBe(WATER);
  }
  for (let y = 0; y < WH; y++) {
    expect(map.ground[y * WW + 0]).toBe(WATER);
    expect(map.ground[y * WW + (WW - 1)]).toBe(WATER);
  }
});

test("Wasser ist solide, Pfad + Holz-Steg begehbar (Negativ-/Positivfall der Kollision)", () => {
  for (let i = 0; i < map.ground.length; i++) {
    if (map.ground[i] === WATER) expect(map.solid[i]).toBe(1);   // ins Meer läuft man nicht
    if (map.ground[i] === PATH) expect(map.solid[i]).toBe(0);    // Pfad begehbar
    if (map.ground[i] === DOCK) expect(map.solid[i]).toBe(0);    // Steg-Planken begehbar
  }
});

test("der Kai besteht aus Stein-Wand + Gras-Quay (genug von beidem) und hat einen Holz-Steg", () => {
  const grass = map.ground.filter((c) => c === 0 || c === 1 || c === 2).length;
  const stone = map.ground.filter((c) => isStone(c)).length;
  const dock = map.ground.filter((c) => c === DOCK).length;
  expect(grass).toBeGreaterThan(60);
  expect(stone).toBeGreaterThan(20);
  expect(dock).toBeGreaterThan(2);   // Anleger-Planken im Süden
});

test("Anleger, NPC-Standplatz, Kontor und Ankunft liegen im Raster und sind begehbar", () => {
  for (const p of [WAREHOUSE_TO_WORLD, WAREHOUSE_ARRIVAL, WAREHOUSE_NPC, WAREHOUSE_QUEST_TRIGGER]) {
    const tx = "tx" in p ? p.tx : p.x;
    const ty = "ty" in p ? p.ty : p.y;
    expect(tx >= 0 && tx < WW && ty >= 0 && ty < WH, `${JSON.stringify(p)} im Raster`).toBe(true);
    expect(map.solid[ty * WW + tx], `(${tx},${ty}) muss begehbar sein`).toBe(0);
  }
});

test("NPC-Standplatz + Quest-Trigger sind vom Anleger aus erreichbar – das Viertel ist nicht tot", () => {
  const reach = reachable(WAREHOUSE_ARRIVAL.tx, WAREHOUSE_ARRIVAL.ty);
  expect(reach.has(WAREHOUSE_NPC.y * WW + WAREHOUSE_NPC.x), "NPC-Standplatz erreichbar").toBe(true);
  expect(reach.has(WAREHOUSE_QUEST_TRIGGER.y * WW + WAREHOUSE_QUEST_TRIGGER.x), "Quest-Trigger erreichbar").toBe(true);
});

test("Kräne + Container sind solide (man läuft nicht durch sie hindurch)", () => {
  for (const c of [...WAREHOUSE_CRANES, ...WAREHOUSE_CONTAINERS]) {
    expect(c.x >= 0 && c.x < WW && c.y >= 0 && c.y < WH, `(${c.x},${c.y}) im Raster`).toBe(true);
    expect(map.solid[c.y * WW + c.x], `(${c.x},${c.y}) muss solide sein`).toBe(1);
  }
});

test("kein Lager-Gut steht auf Pfad, Steg, Kran/Container oder dem Kontor-Korridor", () => {
  const blocked = new Set<number>([
    ...[...WAREHOUSE_CRANES, ...WAREHOUSE_CONTAINERS].map((c) => c.y * WW + c.x),
  ]);
  for (let x = WAREHOUSE_NPC.x; x <= WAREHOUSE_QUEST_TRIGGER.x; x++) blocked.add(WAREHOUSE_NPC.y * WW + x);
  for (const g of map.goods) {
    const i = g.y * WW + g.x;
    expect(map.ground[i]).not.toBe(PATH);
    expect(map.ground[i]).not.toBe(DOCK);
    expect(blocked.has(i), `Gut auf reserviertem Feld (${g.x},${g.y})`).toBe(false);
  }
});

test("Lager-Güter sind nur Kisten oder Fässer und liegen im Raster", () => {
  for (const g of map.goods) {
    expect(["crate", "barrel"]).toContain(g.kind);
    expect(map.solid[g.y * WW + g.x], `Gut (${g.x},${g.y}) ist solide`).toBe(1);
  }
});

test("warpAt trifft die Warp-Kachel und nur diese (Negativfall: Nachbarkachel zählt nicht)", () => {
  expect(warpAt(WORLD_TO_WAREHOUSE.tx * TILE + 8, WORLD_TO_WAREHOUSE.ty * TILE + 8, WORLD_TO_WAREHOUSE)).toBe(true);
  expect(warpAt(WORLD_TO_WAREHOUSE.tx * TILE + 1, WORLD_TO_WAREHOUSE.ty * TILE + 15, WORLD_TO_WAREHOUSE)).toBe(true);
  expect(warpAt((WORLD_TO_WAREHOUSE.tx - 1) * TILE + 8, WORLD_TO_WAREHOUSE.ty * TILE + 8, WORLD_TO_WAREHOUSE)).toBe(false);
  expect(warpAt(WORLD_TO_WAREHOUSE.tx * TILE + 8, (WORLD_TO_WAREHOUSE.ty + 1) * TILE + 8, WORLD_TO_WAREHOUSE)).toBe(false);
});

test("kein Re-Trigger-Loop: die Ankunfts-/Rückkehrkacheln sind NICHT selbst die Warp-Kachel", () => {
  // Viertel: man landet eine Kachel landwärts vom Anleger
  expect(warpAt(WAREHOUSE_ARRIVAL.tx * TILE + 8, WAREHOUSE_ARRIVAL.ty * TILE + 8, WAREHOUSE_TO_WORLD)).toBe(false);
  // Hauptkarte: man landet eine Kachel vor dem Anleger, nicht auf der Warp-Kachel
  expect(warpAt(WORLD_RETURN_WH.tx * TILE + 8, WORLD_RETURN_WH.ty * TILE + 8, WORLD_TO_WAREHOUSE)).toBe(false);
});

test("Rückkehr auf der Hauptkarte landet eine Kachel landwärts (nördlich) über dem Anleger", () => {
  expect(WORLD_RETURN_WH.tx).toBe(WORLD_TO_WAREHOUSE.tx);
  expect(WORLD_RETURN_WH.ty).toBe(WORLD_TO_WAREHOUSE.ty - 1);
  // Rückkehr-Kachel liegt auf den Stegplanken (zwischen y0 und y1 des Stegs)
  expect(WORLD_RETURN_WH.ty >= WORLD_JETTY_WH.y0 && WORLD_RETURN_WH.ty <= WORLD_JETTY_WH.y1).toBe(true);
});

test("Ankunft im Viertel liegt eine Kachel landwärts (nördlich) über dem Rück-Anleger", () => {
  expect(WAREHOUSE_ARRIVAL.tx).toBe(WAREHOUSE_TO_WORLD.tx);
  expect(WAREHOUSE_ARRIVAL.ty).toBe(WAREHOUSE_TO_WORLD.ty - 1);
});

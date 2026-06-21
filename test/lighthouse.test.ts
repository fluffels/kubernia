/* Tests für #111 – Monitoring-Leuchtturm: Klippen-Bereich + Aufgang/Warp.
 *
 * scenes.ts ist Phaser-gekoppelt und nicht im Node-Lauf importierbar; geprüft wird
 * daher die pure Klippen-Mathe aus src/lighthouse.ts, aus der die datengetriebene
 * RegionScene (#427) die Leuchtturm-Region baut.
 * Bewusst auch Grenz-/Negativfälle: Klippe rundum von Meer umschlossen, kein
 * Re-Trigger-Loop am Aufgang, und – der wichtigste Fall – die Monitoring-Station
 * + der NPC-Standplatz müssen vom Ankunfts-Pfad aus wirklich begehbar erreichbar
 * sein, sonst wäre die Klippe eine hübsche, aber tote Karte.
 */
import { test, expect } from "vitest";
import { TILE } from "../src/world";
import {
  LW, LH, WATER, PATH, STONE_CODES,
  buildLighthouse, warpAt,
  WORLD_TO_LIGHTHOUSE, WORLD_RETURN_LH,
  LIGHTHOUSE_TO_WORLD, LIGHTHOUSE_ARRIVAL,
  LIGHTHOUSE_NPC, LIGHTHOUSE_QUEST_TRIGGER, LIGHTHOUSE_TOWER,
  LIGHTHOUSE_GRAFANA, LIGHTHOUSE_BELL,
} from "../src/lighthouse";

const map = buildLighthouse();
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

test("Klippenraster hat die erwartete Größe und vollständige Boden-/Solid-Arrays", () => {
  expect(map.W).toBe(LW);
  expect(map.H).toBe(LH);
  expect(map.ground).toHaveLength(LW * LH);
  expect(map.solid).toHaveLength(LW * LH);
});

test("Klippe ist rundum von Meer umschlossen (kein Land am Kartenrand)", () => {
  for (let x = 0; x < LW; x++) {
    expect(map.ground[0 * LW + x]).toBe(WATER);
    expect(map.ground[(LH - 1) * LW + x]).toBe(WATER);
  }
  for (let y = 0; y < LH; y++) {
    expect(map.ground[y * LW + 0]).toBe(WATER);
    expect(map.ground[y * LW + (LW - 1)]).toBe(WATER);
  }
});

test("Wasser ist solide, Pfad begehbar (Negativ-/Positivfall der Kollision)", () => {
  for (let i = 0; i < map.ground.length; i++) {
    if (map.ground[i] === WATER) expect(map.solid[i]).toBe(1);   // ins Meer läuft man nicht
    if (map.ground[i] === PATH) expect(map.solid[i]).toBe(0);    // Aufgangs-Pfad begehbar
  }
});

test("die Klippe besteht aus Fels + Gras (genug Stein-Rand und Gras-Hochebene)", () => {
  const grass = map.ground.filter((c) => c === 0 || c === 1 || c === 2).length;
  const stone = map.ground.filter((c) => isStone(c)).length;
  expect(grass).toBeGreaterThan(40);
  expect(stone).toBeGreaterThan(20);
});

test("Aufgang, NPC-Standplatz, Station und Ankunft liegen im Raster und sind begehbar", () => {
  for (const p of [LIGHTHOUSE_TO_WORLD, LIGHTHOUSE_ARRIVAL, LIGHTHOUSE_NPC, LIGHTHOUSE_QUEST_TRIGGER]) {
    const tx = "tx" in p ? p.tx : p.x;
    const ty = "ty" in p ? p.ty : p.y;
    expect(tx >= 0 && tx < LW && ty >= 0 && ty < LH, `${JSON.stringify(p)} im Raster`).toBe(true);
    expect(map.solid[ty * LW + tx], `(${tx},${ty}) muss begehbar sein`).toBe(0);
  }
});

test("die Monitoring-Station + der NPC-Standplatz sind vom Aufgang aus erreichbar – Klippe ist nicht tot", () => {
  const reach = reachable(LIGHTHOUSE_ARRIVAL.tx, LIGHTHOUSE_ARRIVAL.ty);
  expect(reach.has(LIGHTHOUSE_NPC.y * LW + LIGHTHOUSE_NPC.x), "NPC-Standplatz erreichbar").toBe(true);
  expect(reach.has(LIGHTHOUSE_QUEST_TRIGGER.y * LW + LIGHTHOUSE_QUEST_TRIGGER.x), "Quest-Trigger erreichbar").toBe(true);
});

test("Leuchtturm + Monitoring-Deko sind solide (man läuft nicht durch sie hindurch)", () => {
  for (const [tx, ty] of [[LIGHTHOUSE_TOWER.x, LIGHTHOUSE_TOWER.y], [LIGHTHOUSE_GRAFANA.x, LIGHTHOUSE_GRAFANA.y], [LIGHTHOUSE_BELL.x, LIGHTHOUSE_BELL.y]]) {
    expect(map.solid[ty * LW + tx], `(${tx},${ty}) muss solide sein`).toBe(1);
  }
});

test("kein Felsbrocken steht auf Pfad, NPC-Standplatz oder Quest-Trigger", () => {
  const blocked = new Set([
    LIGHTHOUSE_NPC.y * LW + LIGHTHOUSE_NPC.x,
    LIGHTHOUSE_QUEST_TRIGGER.y * LW + LIGHTHOUSE_QUEST_TRIGGER.x,
  ]);
  for (const r of map.rocks) {
    const i = r.y * LW + r.x;
    expect(map.ground[i]).not.toBe(PATH);
    expect(blocked.has(i), `Fels auf reserviertem Feld (${r.x},${r.y})`).toBe(false);
  }
});

test("warpAt trifft die Warp-Kachel und nur diese (Negativfall: Nachbarkachel zählt nicht)", () => {
  // Mittelpunkt der Kachel trifft
  expect(warpAt(WORLD_TO_LIGHTHOUSE.tx * TILE + 8, WORLD_TO_LIGHTHOUSE.ty * TILE + 8, WORLD_TO_LIGHTHOUSE)).toBe(true);
  // beliebiger Punkt innerhalb derselben Kachel trifft
  expect(warpAt(WORLD_TO_LIGHTHOUSE.tx * TILE + 1, WORLD_TO_LIGHTHOUSE.ty * TILE + 15, WORLD_TO_LIGHTHOUSE)).toBe(true);
  // Nachbarkacheln treffen nicht
  expect(warpAt((WORLD_TO_LIGHTHOUSE.tx - 1) * TILE + 8, WORLD_TO_LIGHTHOUSE.ty * TILE + 8, WORLD_TO_LIGHTHOUSE)).toBe(false);
  expect(warpAt(WORLD_TO_LIGHTHOUSE.tx * TILE + 8, (WORLD_TO_LIGHTHOUSE.ty + 1) * TILE + 8, WORLD_TO_LIGHTHOUSE)).toBe(false);
});

test("kein Re-Trigger-Loop: die Ankunfts-/Rückkehrkacheln sind NICHT selbst die Warp-Kachel", () => {
  // Klippe: man landet eine Kachel landwärts vom Abstieg
  expect(warpAt(LIGHTHOUSE_ARRIVAL.tx * TILE + 8, LIGHTHOUSE_ARRIVAL.ty * TILE + 8, LIGHTHOUSE_TO_WORLD)).toBe(false);
  // Hauptkarte: man landet eine Kachel vor dem Aufgang, nicht auf der Warp-Kachel
  expect(warpAt(WORLD_RETURN_LH.tx * TILE + 8, WORLD_RETURN_LH.ty * TILE + 8, WORLD_TO_LIGHTHOUSE)).toBe(false);
});

test("Aufgang ↔ Rückkehr auf der Hauptkarte: Rückkehr landet eine Kachel landwärts unter dem Aufgang", () => {
  expect(WORLD_RETURN_LH.tx).toBe(WORLD_TO_LIGHTHOUSE.tx);
  expect(WORLD_RETURN_LH.ty).toBe(WORLD_TO_LIGHTHOUSE.ty + 1);
});

test("Ankunft auf der Klippe liegt eine Kachel landwärts (nördlich) über dem Abstieg", () => {
  expect(LIGHTHOUSE_ARRIVAL.tx).toBe(LIGHTHOUSE_TO_WORLD.tx);
  expect(LIGHTHOUSE_ARRIVAL.ty).toBe(LIGHTHOUSE_TO_WORLD.ty - 1);
});

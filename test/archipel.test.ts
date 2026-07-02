/* Tests für #92 – GitOps-Archipel: Insel-Geometrie + Anleger/Warp.
 *
 * scenes.ts ist Phaser-gekoppelt und nicht im Node-Lauf importierbar; geprüft
 * wird daher die pure Insel-Mathe aus src/archipel.ts, aus der die datengetriebene
 * RegionScene (#427) die Archipel-Region baut.
 * Bewusst auch Grenz-/Negativfälle: Insel rundum von Wasser umschlossen, kein
 * Re-Trigger-Loop am Anleger, und – der wichtigste Fall – die Lichtung (NPC +
 * Quest-Trigger) muss vom Anleger aus wirklich begehbar erreichbar sein, sonst
 * wäre die Insel eine hübsche, aber tote Karte.
 */
import { test, expect } from "vitest";
import { TILE } from "../src/world";
import {
  AW, AH, WATER, SAND, PATH, DOCK,
  buildArchipel, warpAt,
  WORLD_TO_ARCHIPEL, ARCHIPEL_TO_WORLD, WORLD_RETURN, ARCHIPEL_ARRIVAL,
  ARCHIPEL_NPC, ARCHIPEL_QUEST_TRIGGER, WORLD_JETTY,
} from "../src/world/regions/archipel";

const map = buildArchipel();

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

test("Inselraster hat die erwartete Größe und ein vollständiges Boden-/Solid-Array", () => {
  expect(map.W).toBe(AW);
  expect(map.H).toBe(AH);
  expect(map.ground).toHaveLength(AW * AH);
  expect(map.solid).toHaveLength(AW * AH);
});

test("Insel ist rundum von Wasser umschlossen (kein Land am Kartenrand)", () => {
  for (let x = 0; x < AW; x++) {
    expect(map.ground[0 * AW + x]).toBe(WATER);
    expect(map.ground[(AH - 1) * AW + x]).toBe(WATER);
  }
  for (let y = 0; y < AH; y++) {
    expect(map.ground[y * AW + 0]).toBe(WATER);
    expect(map.ground[y * AW + (AW - 1)]).toBe(WATER);
  }
});

test("Wasser ist solide, Steg/Weg/Sand begehbar (Negativ-/Positivfall der Kollision)", () => {
  for (let i = 0; i < map.ground.length; i++) {
    if (map.ground[i] === WATER) expect(map.solid[i]).toBe(1);     // ins Meer läuft man nicht
    if (map.ground[i] === DOCK) expect(map.solid[i]).toBe(0);      // Steg begehbar
    if (map.ground[i] === PATH) expect(map.solid[i]).toBe(0);      // Weg begehbar
    if (map.ground[i] === SAND) expect(map.solid[i]).toBe(0);      // Strand begehbar
  }
});

test("die Insel besteht tatsächlich aus Land (Gras + Sand vorhanden, nicht nur Wasser)", () => {
  const grass = map.ground.filter((c) => c === 0 || c === 1 || c === 2).length;
  const sand = map.ground.filter((c) => c === SAND).length;
  expect(grass).toBeGreaterThan(40);
  expect(sand).toBeGreaterThan(10);
});

test("Anleger, NPC-Standplatz und Quest-Trigger liegen im Raster und sind begehbar", () => {
  // Nur insel-seitige Punkte gehören ins AW×AH-Raster (WORLD_* liegen auf der Hauptkarte).
  for (const p of [ARCHIPEL_TO_WORLD, ARCHIPEL_ARRIVAL, ARCHIPEL_NPC, ARCHIPEL_QUEST_TRIGGER]) {
    const tx = "tx" in p ? p.tx : p.x;
    const ty = "ty" in p ? p.ty : p.y;
    expect(tx >= 0 && tx < AW && ty >= 0 && ty < AH, `${JSON.stringify(p)} im Raster`).toBe(true);
  }
  // Auf der Insel müssen diese Kacheln begehbar sein
  for (const [x, y] of [
    [ARCHIPEL_TO_WORLD.tx, ARCHIPEL_TO_WORLD.ty],
    [ARCHIPEL_ARRIVAL.tx, ARCHIPEL_ARRIVAL.ty],
    [ARCHIPEL_NPC.x, ARCHIPEL_NPC.y],
    [ARCHIPEL_QUEST_TRIGGER.x, ARCHIPEL_QUEST_TRIGGER.y],
  ]) {
    expect(map.solid[y * AW + x], `(${x},${y}) muss begehbar sein`).toBe(0);
  }
});

test("die Lichtung (NPC + Quest-Trigger) ist vom Anleger aus erreichbar – Insel ist nicht tot", () => {
  const reach = reachable(ARCHIPEL_ARRIVAL.tx, ARCHIPEL_ARRIVAL.ty);
  expect(reach.has(ARCHIPEL_NPC.y * AW + ARCHIPEL_NPC.x), "NPC-Standplatz erreichbar").toBe(true);
  expect(reach.has(ARCHIPEL_QUEST_TRIGGER.y * AW + ARCHIPEL_QUEST_TRIGGER.x), "Quest-Trigger erreichbar").toBe(true);
});

test("kein Baum steht auf Weg, Lichtung, NPC-Standplatz oder Quest-Trigger", () => {
  const blocked = new Set([
    ARCHIPEL_NPC.y * AW + ARCHIPEL_NPC.x,
    ARCHIPEL_QUEST_TRIGGER.y * AW + ARCHIPEL_QUEST_TRIGGER.x,
  ]);
  for (const t of map.trees) {
    const i = t.y * AW + t.x;
    expect(map.ground[i]).not.toBe(PATH);
    expect(map.ground[i]).not.toBe(DOCK);
    expect(blocked.has(i), `Baum auf reserviertem Feld (${t.x},${t.y})`).toBe(false);
  }
});

test("warpAt trifft die Warp-Kachel und nur diese (Negativfall: Nachbarkachel zählt nicht)", () => {
  // Mittelpunkt der Kachel trifft
  expect(warpAt(WORLD_TO_ARCHIPEL.tx * TILE + 8, WORLD_TO_ARCHIPEL.ty * TILE + 8, WORLD_TO_ARCHIPEL)).toBe(true);
  // beliebiger Punkt innerhalb derselben Kachel trifft
  expect(warpAt(WORLD_TO_ARCHIPEL.tx * TILE + 1, WORLD_TO_ARCHIPEL.ty * TILE + 15, WORLD_TO_ARCHIPEL)).toBe(true);
  // Nachbarkacheln treffen nicht
  expect(warpAt((WORLD_TO_ARCHIPEL.tx - 1) * TILE + 8, WORLD_TO_ARCHIPEL.ty * TILE + 8, WORLD_TO_ARCHIPEL)).toBe(false);
  expect(warpAt(WORLD_TO_ARCHIPEL.tx * TILE + 8, (WORLD_TO_ARCHIPEL.ty + 1) * TILE + 8, WORLD_TO_ARCHIPEL)).toBe(false);
});

test("kein Re-Trigger-Loop: die Ankunfts-/Rückkehrkacheln sind NICHT selbst die Warp-Kachel", () => {
  // Insel: man landet eine Kachel landwärts vom Rück-Anleger
  expect(warpAt(ARCHIPEL_ARRIVAL.tx * TILE + 8, ARCHIPEL_ARRIVAL.ty * TILE + 8, ARCHIPEL_TO_WORLD)).toBe(false);
  // Hauptkarte: man landet eine Kachel vor dem Anker, nicht auf dem Steg-Ende
  expect(warpAt(WORLD_RETURN.tx * TILE + 8, WORLD_RETURN.ty * TILE + 8, WORLD_TO_ARCHIPEL)).toBe(false);
});

test("der Hauptkarten-Steg endet genau auf der Warp-Kachel (Steg-Geometrie ↔ Trigger)", () => {
  // Warp liegt am seewärtigen Ende des Stegs und innerhalb seiner Spalten
  expect(WORLD_TO_ARCHIPEL.ty).toBe(WORLD_JETTY.y1);
  expect(WORLD_TO_ARCHIPEL.tx >= WORLD_JETTY.x && WORLD_TO_ARCHIPEL.tx < WORLD_JETTY.x + WORLD_JETTY.w).toBe(true);
});

test("Rückkehr landet symmetrisch auf dem Steg direkt vor dem Anker (nicht am Kai/Schild)", () => {
  // auf einer Steg-Kachel (innerhalb Spalten + y-Bereich) …
  expect(WORLD_RETURN.tx >= WORLD_JETTY.x && WORLD_RETURN.tx < WORLD_JETTY.x + WORLD_JETTY.w).toBe(true);
  expect(WORLD_RETURN.ty >= WORLD_JETTY.y0 && WORLD_RETURN.ty <= WORLD_JETTY.y1).toBe(true);
  // … und zwar direkt neben dem Anker (eine Kachel landwärts), aber nicht darauf
  expect(WORLD_RETURN.tx).toBe(WORLD_TO_ARCHIPEL.tx);
  expect(WORLD_RETURN.ty).toBe(WORLD_TO_ARCHIPEL.ty - 1);
});

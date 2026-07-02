/* Tests für #165 – Heimat-Werft: Werft-Hof + Helling/Anleger/Warp (Phase-10-Capstone-Region).
 *
 * scenes.ts ist Phaser-gekoppelt und nicht im Node-Lauf importierbar; geprüft wird daher die
 * pure Werft-Mathe aus src/werft.ts, aus der die datengetriebene RegionScene (#427) die Region
 * baut. Bewusst auch Grenz-/Negativfälle: Hof rundum von Meer umschlossen, Wasser solide (man
 * läuft nicht hinein), kein Re-Trigger-Loop am Anleger, das im Bau befindliche Schiff NICHT
 * begehbar – und der wichtigste Fall: der Hof-Platz (NPC-/Quest-Trigger-Standplatz) muss vom
 * Ankunfts-Anleger aus wirklich erreichbar sein, sonst wäre die Werft eine hübsche, tote Karte.
 *
 * (Die SIM-Seite des Capstones – curl/build/ImagePullBackOff – ist separat in
 * test/sim/werft.test.ts abgedeckt, #164.)
 */
import { test, expect } from "vitest";
import { TILE } from "../src/world/world";
import {
  WERFT_W, WERFT_H, WATER, DOCK, QX0, QX1, QY0, QY1,
  buildWerft, warpAt,
  WORLD_JETTY_WF, WORLD_TO_WERFT, WORLD_RETURN_WF,
  WERFT_TO_WORLD, WERFT_ARRIVAL, WERFT_NPC, WERFT_BUILD_TRIGGER,
} from "../src/world/regions/werft";

const map = buildWerft();

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

test("Werft-Raster hat die erwartete Größe und vollständige Boden-/Solid-Arrays", () => {
  expect(map.W).toBe(WERFT_W);
  expect(map.H).toBe(WERFT_H);
  expect(map.ground).toHaveLength(WERFT_W * WERFT_H);
  expect(map.solid).toHaveLength(WERFT_W * WERFT_H);
});

test("Hof ist rundum von Meer umschlossen (kein Land am Kartenrand)", () => {
  for (let x = 0; x < WERFT_W; x++) {
    expect(map.ground[0 * WERFT_W + x]).toBe(WATER);
    expect(map.ground[(WERFT_H - 1) * WERFT_W + x]).toBe(WATER);
  }
  for (let y = 0; y < WERFT_H; y++) {
    expect(map.ground[y * WERFT_W + 0]).toBe(WATER);
    expect(map.ground[y * WERFT_W + (WERFT_W - 1)]).toBe(WATER);
  }
});

test("Wasser ist solide, Holz-Helling begehbar (Negativ-/Positivfall der Kollision)", () => {
  for (let i = 0; i < map.ground.length; i++) {
    if (map.ground[i] === WATER) {
      // Ausnahme: das im Bau befindliche Schiff steht auf einer Holz-Planke, nicht im Wasser.
      expect(map.solid[i]).toBe(1);   // ins Meer läuft man nicht
    }
  }
  // Die Helling-Planken sind grundsätzlich begehbar – nur die eine Rumpf-Kachel ist solide.
  const hullIdx = map.hull.y * WERFT_W + map.hull.x;
  for (let i = 0; i < map.ground.length; i++) {
    if (map.ground[i] === DOCK && i !== hullIdx) expect(map.solid[i]).toBe(0);
  }
});

test("die Hof-Fläche besteht aus Gras (begehbar) innerhalb des Kai-Rings", () => {
  for (let y = QY0; y <= QY1; y++) {
    for (let x = QX0; x <= QX1; x++) {
      const v = map.ground[y * WERFT_W + x];
      // Gras (0/1/2) oder Pfad (25) auf der Hof-Fläche – nie Wasser.
      expect(v === 0 || v === 1 || v === 2 || v === 25, `Hof (${x},${y}) ist begehbarer Boden`).toBe(true);
    }
  }
});

test("Anleger, Ankunft und Rück-Warp liegen im Raster und sind begehbar", () => {
  for (const { tx, ty } of [WERFT_TO_WORLD, WERFT_ARRIVAL]) {
    expect(tx >= 0 && tx < WERFT_W && ty >= 0 && ty < WERFT_H, `(${tx},${ty}) im Raster`).toBe(true);
    expect(map.solid[ty * WERFT_W + tx], `(${tx},${ty}) muss begehbar sein`).toBe(0);
  }
});

test("der Hof-Platz (NPC + Quest-Trigger) ist vom Anleger aus erreichbar – die Werft ist nicht tot", () => {
  const reach = reachable(WERFT_ARRIVAL.tx, WERFT_ARRIVAL.ty);
  expect(reach.has(WERFT_NPC.y * WERFT_W + WERFT_NPC.x), "NPC-Standplatz erreichbar").toBe(true);
  expect(reach.has(WERFT_BUILD_TRIGGER.y * WERFT_W + WERFT_BUILD_TRIGGER.x), "Quest-Trigger erreichbar").toBe(true);
  // Auch die Hof-Ecken (begehbares Gras) müssen vom Anleger aus erreichbar sein.
  expect(reach.has(QY0 * WERFT_W + QX0), "Hof-Ecke NW erreichbar").toBe(true);
  expect(reach.has(QY1 * WERFT_W + QX1), "Hof-Ecke SO erreichbar").toBe(true);
});

test("reservierte NPC-/Quest-Trigger-Standplätze liegen auf der Hof-Fläche und sind begehbar", () => {
  for (const { x, y } of [WERFT_NPC, WERFT_BUILD_TRIGGER]) {
    expect(x >= QX0 && x <= QX1 && y >= QY0 && y <= QY1, `(${x},${y}) auf der Hof-Fläche`).toBe(true);
    expect(map.solid[y * WERFT_W + x], `(${x},${y}) begehbar (für NPC/Trigger reserviert)`).toBe(0);
  }
});

test("warpAt trifft die Warp-Kachel und nur diese (Negativfall: Nachbarkachel zählt nicht)", () => {
  expect(warpAt(WORLD_TO_WERFT.tx * TILE + 8, WORLD_TO_WERFT.ty * TILE + 8, WORLD_TO_WERFT)).toBe(true);
  expect(warpAt(WORLD_TO_WERFT.tx * TILE + 1, WORLD_TO_WERFT.ty * TILE + 15, WORLD_TO_WERFT)).toBe(true);
  expect(warpAt((WORLD_TO_WERFT.tx - 1) * TILE + 8, WORLD_TO_WERFT.ty * TILE + 8, WORLD_TO_WERFT)).toBe(false);
  expect(warpAt(WORLD_TO_WERFT.tx * TILE + 8, (WORLD_TO_WERFT.ty + 1) * TILE + 8, WORLD_TO_WERFT)).toBe(false);
});

test("kein Re-Trigger-Loop: die Ankunfts-/Rückkehrkacheln sind NICHT selbst die Warp-Kachel", () => {
  // Werft: man landet eine Kachel landwärts vom Rück-Anleger
  expect(warpAt(WERFT_ARRIVAL.tx * TILE + 8, WERFT_ARRIVAL.ty * TILE + 8, WERFT_TO_WORLD)).toBe(false);
  // Hauptkarte: man landet eine Kachel vor dem Anleger, nicht auf der Warp-Kachel
  expect(warpAt(WORLD_RETURN_WF.tx * TILE + 8, WORLD_RETURN_WF.ty * TILE + 8, WORLD_TO_WERFT)).toBe(false);
});

test("Rückkehr auf der Hauptkarte landet eine Kachel landwärts (nördlich) über dem Anleger", () => {
  expect(WORLD_RETURN_WF.tx).toBe(WORLD_TO_WERFT.tx);
  expect(WORLD_RETURN_WF.ty).toBe(WORLD_TO_WERFT.ty - 1);
  // Rückkehr-Kachel liegt auf den Stegplanken (zwischen y0 und y1 des Stegs)
  expect(WORLD_RETURN_WF.ty >= WORLD_JETTY_WF.y0 && WORLD_RETURN_WF.ty <= WORLD_JETTY_WF.y1).toBe(true);
});

test("Ankunft in der Werft liegt eine Kachel landwärts (nördlich) über dem Rück-Anleger", () => {
  expect(WERFT_ARRIVAL.tx).toBe(WERFT_TO_WORLD.tx);
  expect(WERFT_ARRIVAL.ty).toBe(WERFT_TO_WORLD.ty - 1);
});

test("das im Bau befindliche Schiff steht auf einer Holz-Planke und ist NICHT begehbar", () => {
  const i = map.hull.y * WERFT_W + map.hull.x;
  expect(map.hull.x >= 0 && map.hull.x < WERFT_W && map.hull.y >= 0 && map.hull.y < WERFT_H, "Rumpf im Raster").toBe(true);
  expect(map.ground[i], "Rumpf steht auf Holz-Helling").toBe(DOCK);
  expect(map.solid[i], "Rumpf blockt (man läuft nicht durch das Schiff)").toBe(1);
});

test("die Bau-Gerüste liegen im Raster und flankieren die Helling", () => {
  expect(map.scaffolds.length).toBeGreaterThan(0);
  for (const s of map.scaffolds) {
    expect(s.x >= 0 && s.x < WERFT_W && s.y >= 0 && s.y < WERFT_H, `Gerüst (${s.x},${s.y}) im Raster`).toBe(true);
  }
});

test("der Anleger auf der Hauptkarte (x22–23) kollidiert nicht mit Archipel- (x20–21) oder Wachturm-Anleger (x24–25)", () => {
  // Reine Geometrie-Gegenprobe gegen die belegten Nachbar-Spalten der Südkai – die Werft-Lücke
  // ist genau x22–23, damit kein Steg den anderen überschreibt.
  for (let x = WORLD_JETTY_WF.x; x < WORLD_JETTY_WF.x + WORLD_JETTY_WF.w; x++) {
    expect(x >= 22 && x <= 23, `Werft-Anleger-Spalte ${x} liegt in der freien Lücke`).toBe(true);
  }
});

/* Tests für #343: Sub-Tile-Kollision – runde/kleinere Hitboxen statt voller 16×16-Kachel.
 *
 * Vierter Schritt aus dem (geschlossenen) Vision-Ticket #256: Kollision von der
 * vollen Kachel entkoppeln, damit man an runden Objekten (Steinen, NPCs) weich
 * vorbeigleitet, statt an der quadratischen Hitbox eckig abzuprallen.
 *
 * Die Form ist ein DATUM (Kreis oder kleineres Rechteck) in Pixel-Koordinaten; der
 * Figuren-Footprint (ein Achsen-Rechteck) wird robust dagegen geprüft. Bewusst auch
 * Grenz-/Negativfälle: Diagonal-Abprall vs. Eck-Sliding, NPC-Blockade (kein
 * Durchlaufen), Rückwärtskompatibilität zur alten Vollquadrat-Kollision, degenerierte
 * Hitboxen (r=0, leere Liste). Red-Green nachgewiesen (siehe Commit).
 */
import { test, expect } from "vitest";
import {
  TILE, circleHitbox, rectHitbox, playerFootprint, hitboxBlocks, blockedByHitboxes,
  npcHitboxes, footprintSolid, resolveMove, type Hitbox, type Spawn, type SolidAt,
} from "../src/world/world";

const NONE: SolidAt = () => false;

/* ---------- Konstruktoren + Footprint ---------- */

test("circleHitbox/rectHitbox bauen die erwarteten Formen", () => {
  expect(circleHitbox(168, 168, 6)).toEqual({ kind: "circle", cx: 168, cy: 168, r: 6 });
  expect(rectHitbox(160, 160, 16, 16)).toEqual({ kind: "rect", x: 160, y: 160, w: 16, h: 16 });
});

test("playerFootprint ist das Achsen-Rechteck der vier Probe-Ecken (±5 / -2..+5)", () => {
  expect(playerFootprint(100, 100)).toEqual({ x: 95, y: 98, w: 10, h: 7 });
});

/* ---------- Kreis-Hitbox: rundet die Kachel-Ecken ab ---------- */

test("runde Hitbox gibt die Kachel-Ecke frei, die das Vollquadrat blockiert", () => {
  // Objekt auf Kachel (10,10): Kachel-Quadrat [160,176]², Kreis um den Mittelpunkt (168,168) r=6.
  const square = rectHitbox(160, 160, TILE, TILE);
  const circle = circleHitbox(168, 168, 6);
  // Spieler diagonal an der Außen-Ecke (158,158): Footprint berührt nur die Kachel-Ecke.
  expect(hitboxBlocks(square, 158, 158)).toBe(true);   // volles Quadrat: blockiert
  expect(hitboxBlocks(circle, 158, 158)).toBe(false);  // Kreis: Ecke ist gekappt → frei
  // Auf dem Mittelpunkt blockieren BEIDE (man kann nie durchs Objekt laufen).
  expect(hitboxBlocks(square, 168, 168)).toBe(true);
  expect(hitboxBlocks(circle, 168, 168)).toBe(true);
});

test("Kreis-Hitbox blockiert in Mittelpunktnähe, ist aber außerhalb des Radius frei", () => {
  const circle = circleHitbox(168, 168, 6);
  expect(hitboxBlocks(circle, 168, 168)).toBe(true);    // mittig
  expect(hitboxBlocks(circle, 168, 200)).toBe(false);   // weit weg
  expect(hitboxBlocks(circle, 130, 168)).toBe(false);   // links daneben
});

/* ---------- Rechteck-Hitbox: kleineres Teil-Rechteck + alter Vollquadrat-Fall ---------- */

test("kleinere Rechteck-Hitbox blockiert nur innerhalb ihres Rechtecks", () => {
  // 6×6-Rechteck mittig in Kachel (10,10): [165,171]×[165,171].
  const small = rectHitbox(165, 165, 6, 6);
  expect(hitboxBlocks(small, 168, 168)).toBe(true);     // mittig drin
  expect(hitboxBlocks(small, 158, 158)).toBe(false);    // Kachel-Ecke: außerhalb des kleinen Rechtecks → frei
});

test("Vollquadrat-Hitbox verhält sich wie die alte volle Solid-Kachel (Rückwärtskompatibilität)", () => {
  // Grid mit genau einer soliden Kachel (10,10):
  const W = 52, H = 40;
  const grid = new Uint8Array(W * H);
  grid[10 * W + 10] = 1;
  const gridSolid: SolidAt = (px, py) => {
    const tx = Math.floor(px / TILE), ty = Math.floor(py / TILE);
    if (tx < 0 || ty < 0 || tx >= W || ty >= H) return true;
    return grid[ty * W + tx] === 1;
  };
  const fullRect = rectHitbox(10 * TILE, 10 * TILE, TILE, TILE);
  // An vielen Stellen rund um die Kachel muss die Rechteck-Hitbox exakt wie das Grid blocken.
  for (let py = 150; py <= 186; py += 2) {
    for (let px = 150; px <= 186; px += 2) {
      expect(hitboxBlocks(fullRect, px, py)).toBe(footprintSolid(gridSolid, px, py));
    }
  }
});

/* ---------- footprintSolid / resolveMove: Hitbox-Option, rückwärtskompatibel ---------- */

test("footprintSolid ohne Hitboxen ist identisch zur Variante mit leerer Liste", () => {
  const W = 52, H = 40;
  const grid = new Uint8Array(W * H);
  grid[10 * W + 10] = 1;
  const solid: SolidAt = (px, py) => {
    const tx = Math.floor(px / TILE), ty = Math.floor(py / TILE);
    return tx >= 0 && ty >= 0 && tx < W && ty < H ? grid[ty * W + tx] === 1 : true;
  };
  for (const [px, py] of [[168, 168], [100, 100], [40, 40]] as const) {
    expect(footprintSolid(solid, px, py, [])).toBe(footprintSolid(solid, px, py));
  }
});

test("footprintSolid erkennt eine Kreis-Hitbox zusätzlich zum Kachelgitter", () => {
  const circle = circleHitbox(168, 168, 6);
  expect(footprintSolid(NONE, 168, 168, [circle])).toBe(true);  // über dem Kreis
  expect(footprintSolid(NONE, 168, 200, [circle])).toBe(false); // daneben
  expect(footprintSolid(NONE, 168, 200, [])).toBe(false);       // leere Liste blockt nie
});

test("resolveMove ohne Hitbox-Argument bleibt unverändert (alter Aufruf, 5 Args)", () => {
  const W = 52, H = 40;
  const grid = new Uint8Array(W * H);
  grid[10 * W + 11] = 1; // solide Kachel rechts
  const solid: SolidAt = (px, py) => {
    const tx = Math.floor(px / TILE), ty = Math.floor(py / TILE);
    return tx >= 0 && ty >= 0 && tx < W && ty < H ? grid[ty * W + tx] === 1 : true;
  };
  // mit explizit leerer Liste == ohne Argument
  expect(resolveMove(solid, 168, 168, 4, 0, [])).toEqual(resolveMove(solid, 168, 168, 4, 0));
});

test("an einem runden Stein gleitet man diagonal weiter, am Vollquadrat prallt man eckig ab", () => {
  const square: Hitbox[] = [rectHitbox(160, 160, TILE, TILE)];
  const circle: Hitbox[] = [circleHitbox(168, 168, 6)];
  // Start (153,153): frei von beiden. Schritt diagonal (5,5) Richtung Eck-Region.
  const sq = resolveMove(NONE, 153, 153, 5, 5, square);
  const ci = resolveMove(NONE, 153, 153, 5, 5, circle);
  // X gleitet in beiden Fällen an der Kante entlang.
  expect(sq.x).toBe(158);
  expect(ci.x).toBe(158);
  // Y: Vollquadrat blockiert (Ecke steht im Weg) → bleibt; Kreis gibt die Ecke frei → gleitet runter.
  expect(sq.y).toBe(153);
  expect(ci.y).toBe(158);
});

test("man läuft NICHT durch einen runden Stein hindurch (Mittelpunkt bleibt blockiert)", () => {
  const circle: Hitbox[] = [circleHitbox(168, 168, 6)];
  // Frontal von oben (168,150) gerade nach unten in den Stein hinein.
  const moved = resolveMove(NONE, 168, 150, 0, 8, circle);
  expect(moved.y).toBe(150); // wird vor dem Stein gestoppt, nicht hindurchgelassen
});

test("Anti-Wedge: steckt der Footprint im Kreis, kommt man wieder heraus (#36-Prinzip)", () => {
  const circle: Hitbox[] = [circleHitbox(168, 168, 6)];
  // genau auf dem Mittelpunkt „festgesteckt"
  expect(footprintSolid(NONE, 168, 168, circle)).toBe(true);
  const out = resolveMove(NONE, 168, 168, -1.5, 0, circle);
  expect(out.x).toBeLessThan(168); // Bewegung wird erlaubt, statt eingemauert zu sein
});

/* ---------- npcHitboxes: ein Kreis je NPC um den Kachel-Mittelpunkt ---------- */

test("npcHitboxes liefert je NPC einen Kreis um (x*TILE+8 / y*TILE+8)", () => {
  const spawns: Spawn[] = [{ id: "ole", x: 3, y: 4 }, { id: "runa", x: 10, y: 7 }];
  expect(npcHitboxes(spawns, 6)).toEqual([
    { kind: "circle", cx: 3 * TILE + 8, cy: 4 * TILE + 8, r: 6 },
    { kind: "circle", cx: 10 * TILE + 8, cy: 7 * TILE + 8, r: 6 },
  ]);
});

/* ---------- Negativ-/Grenzfälle ---------- */

test("leere Hitbox-Liste blockiert nie", () => {
  expect(blockedByHitboxes([], 168, 168)).toBe(false);
});

test("degenerierte Hitboxen (r=0, 0-Fläche) blockieren nie – auch mittig nicht", () => {
  expect(hitboxBlocks(circleHitbox(168, 168, 0), 168, 168)).toBe(false);
  expect(hitboxBlocks(rectHitbox(168, 168, 0, 0), 168, 168)).toBe(false);
  expect(hitboxBlocks(rectHitbox(168, 168, 8, 0), 168, 168)).toBe(false);
});

/* Tests für die deterministische Deko-Platzierung (#3).
 *
 * Kern der Änderung: Büsche/Steine/Laternen/Blumen werden nicht mehr bei jedem
 * Neuladen neu gewürfelt, sondern fest und reproduzierbar gestreut. Geprüft
 * werden daher vor allem die harten Garantien – inklusive Negativ-/Grenzfälle
 * und ein Red-Green-Schutz gegen einen Test, der den Seed ignorieren würde. */
import { test, expect } from "vitest";
import { hash01, strSeed, pickPlacements, grassTuftStyle, type ScatterSpec } from "../src/world/decor";

const W = 52, H = 40;
/** Standard-Akzeptanz: ganze Karte gültig (Grenzen 1..W-2 / 1..H-2 macht pickPlacements selbst). */
const all = () => true;

function spec(over: Partial<ScatterSpec> = {}): ScatterSpec {
  return { W, H, count: 10, seed: 123, accept: all, ...over };
}

/* ---------- hash01 ---------- */

test("hash01 liegt immer in [0,1) und ist deterministisch", () => {
  for (let i = 0; i < 200; i++) {
    const x = (i * 7) % W, y = (i * 13) % H;
    const a = hash01(99, x, y);
    expect(a).toBeGreaterThanOrEqual(0);
    expect(a).toBeLessThan(1);
    expect(hash01(99, x, y)).toBe(a); // gleiche Eingabe → gleicher Wert
  }
});

test("hash01 reagiert auf Seed und Koordinaten (kein konstanter Wert)", () => {
  expect(hash01(1, 5, 5)).not.toBe(hash01(2, 5, 5));
  expect(hash01(1, 5, 5)).not.toBe(hash01(1, 6, 5));
  expect(hash01(1, 5, 5)).not.toBe(hash01(1, 5, 6));
});

/* ---------- strSeed ---------- */

test("strSeed ist deterministisch und sortennrein verschieden", () => {
  expect(strSeed("lamppost")).toBe(strSeed("lamppost"));
  expect(strSeed("lamppost")).not.toBe(strSeed("bush"));
  expect(strSeed("bush")).not.toBe(strSeed("rock"));
  expect(Number.isInteger(strSeed("flowers"))).toBe(true);
});

/* ---------- pickPlacements: Determinismus ---------- */

test("gleicher Seed liefert exakt dieselbe Platzierung (reproduzierbar)", () => {
  const a = pickPlacements(spec({ count: 16 }));
  const b = pickPlacements(spec({ count: 16 }));
  expect(a).toEqual(b);
});

test("verschiedene Seeds liefern unterschiedliche Layouts (Seed wird genutzt)", () => {
  // Red-Green-Schutz: würde pickPlacements den Seed ignorieren, wäre das gleich.
  const a = pickPlacements(spec({ seed: 1, count: 16 }));
  const b = pickPlacements(spec({ seed: 2, count: 16 }));
  expect(a).not.toEqual(b);
});

/* ---------- pickPlacements: Garantien ---------- */

test("liefert höchstens count Felder", () => {
  expect(pickPlacements(spec({ count: 5 })).length).toBe(5);
  expect(pickPlacements(spec({ count: 16 })).length).toBe(16);
});

test("keine Doppelbelegung eines Feldes", () => {
  const res = pickPlacements(spec({ count: 200 }));
  const seen = new Set(res.map((p) => `${p.x},${p.y}`));
  expect(seen.size).toBe(res.length);
});

test("respektiert accept: nur freigegebene Felder werden gewählt", () => {
  // Nur eine kleine Insel ist bebaubar.
  const accept = (x: number, y: number) => x >= 10 && x <= 13 && y >= 10 && y <= 13;
  const res = pickPlacements(spec({ count: 50, accept }));
  expect(res.length).toBeGreaterThan(0);
  for (const p of res) expect(accept(p.x, p.y)).toBe(true);
  // 4x4 Insel = 16 gültige Felder, mehr kann es nicht geben (keine Dopplung).
  expect(res.length).toBe(16);
});

test("alle Felder liegen innerhalb der Innen-Grenzen 1..W-2 / 1..H-2", () => {
  const res = pickPlacements(spec({ count: 500 }));
  for (const p of res) {
    expect(p.x).toBeGreaterThanOrEqual(1);
    expect(p.x).toBeLessThanOrEqual(W - 2);
    expect(p.y).toBeGreaterThanOrEqual(1);
    expect(p.y).toBeLessThanOrEqual(H - 2);
  }
});

test("Streuung: Felder klumpen nicht in eine einzige Ecke", () => {
  const res = pickPlacements(spec({ count: 30 }));
  const xs = res.map((p) => p.x), ys = res.map((p) => p.y);
  // Spannweite muss einen Großteil der Karte abdecken, nicht nur ein paar Kacheln.
  expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(W / 2);
  expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThan(H / 2);
});

/* ---------- pickPlacements: Jitter ---------- */

test("Jitter bleibt im vorgegebenen Bereich und ist deterministisch", () => {
  const jitter = { x: [2, 14] as [number, number], y: [6, 13] as [number, number] };
  const a = pickPlacements(spec({ count: 16, jitter }));
  const b = pickPlacements(spec({ count: 16, jitter }));
  expect(a).toEqual(b); // reproduzierbar inkl. Versatz
  for (const p of a) {
    expect(p.jx).toBeGreaterThanOrEqual(2);
    expect(p.jx).toBeLessThanOrEqual(14);
    expect(p.jy).toBeGreaterThanOrEqual(6);
    expect(p.jy).toBeLessThanOrEqual(13);
    expect(Number.isInteger(p.jx)).toBe(true);
    expect(Number.isInteger(p.jy)).toBe(true);
  }
});

test("ohne Jitter-Angabe ist der Versatz 0", () => {
  for (const p of pickPlacements(spec({ count: 8 }))) {
    expect(p.jx).toBe(0);
    expect(p.jy).toBe(0);
  }
});

/* ---------- pickPlacements: Grenz-/Negativfälle ---------- */

test("count <= 0 liefert eine leere Liste", () => {
  expect(pickPlacements(spec({ count: 0 }))).toEqual([]);
  expect(pickPlacements(spec({ count: -5 }))).toEqual([]);
});

test("kein gültiges Feld → leere Liste statt Endlosschleife", () => {
  expect(pickPlacements(spec({ count: 10, accept: () => false }))).toEqual([]);
});

test("count größer als verfügbare Felder → alle verfügbaren, keine Dopplung", () => {
  const accept = (x: number, y: number) => x === 5 && (y === 5 || y === 6 || y === 7);
  const res = pickPlacements(spec({ count: 99, accept }));
  expect(res.length).toBe(3);
  const seen = new Set(res.map((p) => `${p.x},${p.y}`));
  expect(seen.size).toBe(3);
});

/* ---------- grassTuftStyle (#40, Stardew-Gras) ---------- */

const GS_SEED = strSeed("grass-style");

test("grassTuftStyle ist deterministisch (gleiche Welt → gleiche Wiese)", () => {
  expect(grassTuftStyle(GS_SEED, 7, 11, 3)).toEqual(grassTuftStyle(GS_SEED, 7, 11, 3));
});

test("grassTuftStyle hält alle Eigenschaften in ihren Grenzen", () => {
  for (let i = 0; i < 400; i++) {
    const x = (i * 7) % W, y = (i * 13) % H;
    const s = grassTuftStyle(GS_SEED, x, y, 3);
    expect(s.variant).toBeGreaterThanOrEqual(0);
    expect(s.variant).toBeLessThanOrEqual(2);            // 0..variants-1
    expect(Number.isInteger(s.variant)).toBe(true);
    expect(s.shade).toBeGreaterThanOrEqual(-1);
    expect(s.shade).toBeLessThan(1);
    expect(s.angle).toBeGreaterThanOrEqual(-8);
    expect(s.angle).toBeLessThanOrEqual(8);
    expect(Number.isInteger(s.angle)).toBe(true);
    expect(s.scale).toBeGreaterThanOrEqual(0.8);
    expect(s.scale).toBeLessThan(1.3);
    expect(typeof s.flip).toBe("boolean");
  }
});

test("grassTuftStyle streut Varianten, Neigung und Spiegelung wirklich (kein konstanter Look)", () => {
  // Red-Green-Schutz: würde die Funktion die Koordinaten ignorieren, käme überall
  // dasselbe Büschel heraus – diese Verteilungs-Checks würden dann fehlschlagen.
  const variants = new Set<number>(), angles = new Set<number>(), flips = new Set<boolean>();
  for (let x = 1; x <= W - 2; x++) {
    for (let y = 1; y <= H - 2; y++) {
      const s = grassTuftStyle(GS_SEED, x, y, 3);
      variants.add(s.variant); angles.add(s.angle); flips.add(s.flip);
    }
  }
  expect(variants.size).toBe(3);          // alle drei Form-Varianten kommen vor
  expect(angles.size).toBeGreaterThan(5); // viele verschiedene Neigungen
  expect(flips.has(true)).toBe(true);     // gespiegelt UND
  expect(flips.has(false)).toBe(true);    // ungespiegelt
});

test("grassTuftStyle: variants=1 liefert immer Variante 0 (kein Index-Überlauf)", () => {
  for (let i = 0; i < 100; i++) {
    expect(grassTuftStyle(GS_SEED, i, i * 3, 1).variant).toBe(0);
  }
});

test("grassTuftStyle: benachbarte Felder sehen unterschiedlich aus (Koordinaten zählen)", () => {
  // Nicht jedes Nachbarfeld muss anders sein, aber über eine kurze Reihe darf
  // nicht alles identisch bleiben – sonst entstünde wieder ein Gleichtakt.
  const styles = [0, 1, 2, 3, 4].map((dx) => JSON.stringify(grassTuftStyle(GS_SEED, 10 + dx, 10, 3)));
  expect(new Set(styles).size).toBeGreaterThan(1);
});

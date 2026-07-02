/* Tests für #340: Autotile-Auswahl-Funktion (Blob-/Wang-47er-Set) in world.ts.
 *
 * Erster Schritt aus dem (geschlossenen) Vision-Ticket #256: die PURE Logik, die
 * beim Aufbau der Welt aus der 8er-Nachbarschaft einer Kachel die passende
 * Übergangskachel wählt (gerade / Außenkurve / Innenkurve / Endstück / Kreuzung /
 * Uferkante). Noch ohne neue Assets – nur die Auswahl-Mathematik, Phaser-frei.
 *
 * Bewusst auch Grenz-/Negativfälle: isolierte Kachel, „tote" Eck-Bits ohne ihre
 * beiden Kanten, ungültige Maske. Red-Green nachgewiesen (siehe Commit).
 */
import { test, expect } from "vitest";
import {
  NB, reduceBlobMask, maskFromNeighbors, autotileIndex, autotileIndexFromMask,
  neighbors8, BLOB_MASKS, AUTOTILE_BLOB_COUNT, type Neighbors8,
} from "../src/world/world";

const NONE: Neighbors8 = { n: false, ne: false, e: false, se: false, s: false, sw: false, w: false, nw: false };
/** Bequemer Maskenbau im Test: nur die genannten Nachbarn sind „gleicher Typ". */
const nb = (p: Partial<Neighbors8>): Neighbors8 => ({ ...NONE, ...p });

/* ---------- maskFromNeighbors: Bit-Verdrahtung ---------- */

test("maskFromNeighbors verdrahtet jede Richtung auf ihr Bit", () => {
  expect(maskFromNeighbors(NONE)).toBe(0);
  expect(maskFromNeighbors(nb({ n: true }))).toBe(NB.N);
  expect(maskFromNeighbors(nb({ e: true }))).toBe(NB.E);
  expect(maskFromNeighbors(nb({ s: true }))).toBe(NB.S);
  expect(maskFromNeighbors(nb({ w: true }))).toBe(NB.W);
  expect(maskFromNeighbors(nb({ ne: true }))).toBe(NB.NE);
  expect(maskFromNeighbors(nb({ se: true }))).toBe(NB.SE);
  expect(maskFromNeighbors(nb({ sw: true }))).toBe(NB.SW);
  expect(maskFromNeighbors(nb({ nw: true }))).toBe(NB.NW);
  // alle acht → volle 8-Bit-Maske
  expect(maskFromNeighbors({ n: true, ne: true, e: true, se: true, s: true, sw: true, w: true, nw: true })).toBe(255);
});

/* ---------- reduceBlobMask: Eck-Bit zählt nur mit BEIDEN Kanten ---------- */

test("reduceBlobMask verwirft ein Eck-Bit ohne seine beiden Kanten", () => {
  // NE allein (ohne N und E) → fällt weg
  expect(reduceBlobMask(NB.NE)).toBe(0);
  // NE mit nur einer Kante → fällt weg
  expect(reduceBlobMask(NB.NE | NB.N)).toBe(NB.N);
  expect(reduceBlobMask(NB.NE | NB.E)).toBe(NB.E);
  // NE mit BEIDEN Kanten → bleibt erhalten
  expect(reduceBlobMask(NB.NE | NB.N | NB.E)).toBe(NB.NE | NB.N | NB.E);
});

test("reduceBlobMask: jede Ecke an ihren eigenen beiden Kanten geprüft", () => {
  expect(reduceBlobMask(NB.SE | NB.S | NB.E)).toBe(NB.SE | NB.S | NB.E);
  expect(reduceBlobMask(NB.SW | NB.S | NB.W)).toBe(NB.SW | NB.S | NB.W);
  expect(reduceBlobMask(NB.NW | NB.N | NB.W)).toBe(NB.NW | NB.N | NB.W);
  // „Hut" N + NE + NW: beide Ecken brauchen zusätzlich E bzw. W → beide weg, nur N bleibt
  expect(reduceBlobMask(NB.N | NB.NE | NB.NW)).toBe(NB.N);
  // reine Kanten bleiben unangetastet
  expect(reduceBlobMask(NB.N | NB.E | NB.S | NB.W)).toBe(NB.N | NB.E | NB.S | NB.W);
  // voll umringt: alle Bits bleiben
  expect(reduceBlobMask(255)).toBe(255);
  // leer bleibt leer
  expect(reduceBlobMask(0)).toBe(0);
});

test("reduceBlobMask ist idempotent (reduzierte Maske bleibt stabil)", () => {
  for (let m = 0; m < 256; m++) {
    const r = reduceBlobMask(m);
    expect(reduceBlobMask(r)).toBe(r);
  }
});

/* ---------- 47er-Set: genau 47 Varianten, lückenlos 0..46 ---------- */

test("es gibt genau 47 Blob-Varianten (kanonische, sortierte, reduzierte Masken)", () => {
  expect(AUTOTILE_BLOB_COUNT).toBe(47);
  expect(BLOB_MASKS).toHaveLength(47);
  // aufsteigend sortiert, paarweise verschieden, alle bereits reduziert
  for (let i = 1; i < BLOB_MASKS.length; i++) expect(BLOB_MASKS[i]).toBeGreaterThan(BLOB_MASKS[i - 1]);
  expect(new Set(BLOB_MASKS).size).toBe(47);
  for (const m of BLOB_MASKS) expect(reduceBlobMask(m)).toBe(m);
});

test("über alle 256 Eingabe-Masken decken die Indizes genau {0..46} ab", () => {
  const seen = new Set<number>();
  for (let m = 0; m < 256; m++) {
    const i = autotileIndexFromMask(m);
    expect(i).toBeGreaterThanOrEqual(0);
    expect(i).toBeLessThan(47);
    seen.add(i);
  }
  expect(seen.size).toBe(47);
  // lückenlos: jeder Index 0..46 kommt vor
  for (let i = 0; i < 47; i++) expect(seen.has(i)).toBe(true);
});

test("Index = Position der reduzierten Maske in BLOB_MASKS", () => {
  for (let m = 0; m < 256; m++) {
    expect(autotileIndexFromMask(m)).toBe(BLOB_MASKS.indexOf(reduceBlobMask(m)));
  }
});

/* ---------- die im Ticket geforderten Kachel-Formen sind unterscheidbar ---------- */

test("Grundformen liefern jeweils eigene Indizes (isoliert/gerade/Enden)", () => {
  const isolated = autotileIndex(NONE);
  const straightH = autotileIndex(nb({ w: true, e: true }));
  const straightV = autotileIndex(nb({ n: true, s: true }));
  const endN = autotileIndex(nb({ n: true })); // Pfad kommt von Norden
  const endE = autotileIndex(nb({ e: true }));
  const endS = autotileIndex(nb({ s: true }));
  const endW = autotileIndex(nb({ w: true }));
  const all = [isolated, straightH, straightV, endN, endE, endS, endW];
  expect(new Set(all).size).toBe(all.length); // alle verschieden
});

test("Außenkurve (Ecke gekappt) ≠ Innenkurve (Ecke gefüllt)", () => {
  const outer = autotileIndex(nb({ e: true, s: true }));            // L-Knick, Diagonale fehlt → Außenkurve
  const inner = autotileIndex(nb({ e: true, s: true, se: true }));  // Diagonale gefüllt → Innenkurve
  expect(outer).not.toBe(inner);
  // alle vier Außenkurven verschieden
  const corners = [
    autotileIndex(nb({ e: true, s: true })),
    autotileIndex(nb({ s: true, w: true })),
    autotileIndex(nb({ w: true, n: true })),
    autotileIndex(nb({ n: true, e: true })),
  ];
  expect(new Set(corners).size).toBe(4);
});

test("Kreuzung mit gekappten Ecken ≠ vollständig umringt; T-Stück eigenständig", () => {
  const plusCut = autotileIndex(nb({ n: true, e: true, s: true, w: true }));     // + ohne Diagonalen
  const full = autotileIndex(nb({ n: true, ne: true, e: true, se: true, s: true, sw: true, w: true, nw: true }));
  const tee = autotileIndex(nb({ n: true, e: true, w: true, ne: true, nw: true })); // T nach unten offen
  expect(new Set([plusCut, full, tee]).size).toBe(3);
  // vollständig umringt entspricht der Maske 255
  expect(full).toBe(autotileIndexFromMask(255));
});

test("tote Eck-Bits ohne ihre Kanten ändern den Index nicht", () => {
  // SE allein → wie isoliert
  expect(autotileIndex(nb({ se: true }))).toBe(autotileIndex(NONE));
  // N|S plus „totes" NE (E fehlt) → wie reines vertikales Geradestück
  expect(autotileIndex(nb({ n: true, s: true, ne: true }))).toBe(autotileIndex(nb({ n: true, s: true })));
});

/* ---------- neighbors8: aus einem Gitter-Prädikat (so nutzt es scenes.ts) ---------- */

test("neighbors8 liest die 8 Nachbarn über ein 'gleicher Typ?'-Prädikat", () => {
  // Pfad-Kacheln waagerecht bei (0,0) und (1,0); alles andere (inkl. außerhalb) kein Pfad.
  const path = new Set(["0,0", "1,0"]);
  const same = (x: number, y: number) => path.has(`${x},${y}`);
  // Kachel (0,0): einziger gleicher Nachbar ist Osten (1,0)
  expect(neighbors8(same, 0, 0)).toEqual(nb({ e: true }));
  // Out-of-bounds links/oben liefert das Prädikat false → kein Pfad an den Rändern
  expect(autotileIndex(neighbors8(same, 0, 0))).toBe(autotileIndex(nb({ e: true })));
  // Kachel (1,0): gleicher Nachbar im Westen (0,0)
  expect(neighbors8(same, 1, 0)).toEqual(nb({ w: true }));
});

test("isolierte Kachel: Prädikat überall false → Maske 0", () => {
  const same = () => false;
  expect(neighbors8(same, 5, 5)).toEqual(NONE);
  expect(autotileIndex(neighbors8(same, 5, 5))).toBe(autotileIndex(NONE));
});

/* ---------- Negativfälle: ungültige Maske wird hart abgelehnt ---------- */

test("autotileIndexFromMask lehnt ungültige Masken ab (Bereich/Ganzzahl)", () => {
  expect(() => autotileIndexFromMask(256)).toThrow();
  expect(() => autotileIndexFromMask(-1)).toThrow();
  expect(() => autotileIndexFromMask(1.5)).toThrow();
  expect(() => autotileIndexFromMask(NaN)).toThrow();
  // gültige Ränder werfen NICHT
  expect(() => autotileIndexFromMask(0)).not.toThrow();
  expect(() => autotileIndexFromMask(255)).not.toThrow();
});

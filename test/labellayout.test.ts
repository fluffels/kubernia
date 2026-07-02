/* Tests für das deterministische Entzerren überlappender In-Welt-Beschriftungen (#207).
 *
 * Kern der Änderung: Pod-/Container-Tags und feste Holz-Schilder, die sich dicht
 * überlagern, werden vertikal nach oben auseinandergeschoben, sodass jeder Text
 * lesbar bleibt. Geprüft werden die harten Garantien – inklusive Negativ-/Grenzfälle
 * (kein Überlapp → keine Bewegung, feste Hindernisse bleiben fix, Determinismus) und
 * ein Red-Green-Schutz gegen einen Test, der die Entzerrung gar nicht fordert. */
import { test, expect } from "vitest";
import { spreadLabelsVertically, type LayoutBox } from "../src/hud/labellayout";

/** Wendet die berechneten Versätze an und liefert die finalen Boxen (Mittelpunkt verschoben). */
function applied(boxes: LayoutBox[], gap?: number) {
  const dy = spreadLabelsVertically(boxes, gap);
  return boxes.map((b, i) => ({ ...b, y: b.y + dy[i] }));
}

/** Überschneiden sich zwei finale Boxen sowohl horizontal als auch vertikal? */
function boxesOverlap(a: LayoutBox, b: LayoutBox): boolean {
  return Math.abs(a.x - b.x) < (a.w + b.w) / 2 && Math.abs(a.y - b.y) < (a.h + b.h) / 2;
}

/** Prüft die zentrale Garantie: kein Paar der finalen Boxen überlappt. */
function noOverlaps(boxes: LayoutBox[]): boolean {
  for (let i = 0; i < boxes.length; i++)
    for (let j = i + 1; j < boxes.length; j++)
      if (boxesOverlap(boxes[i], boxes[j])) return false;
  return true;
}

/* ---------- Grenzfälle ---------- */

test("leere Liste und Einzel-Box: keine Versätze", () => {
  expect(spreadLabelsVertically([])).toEqual([]);
  expect(spreadLabelsVertically([{ x: 0, y: 0, w: 10, h: 10 }])).toEqual([0]);
});

test("horizontal getrennte Boxen bleiben unverändert (kein Überlapp → dy = 0)", () => {
  const boxes: LayoutBox[] = [
    { x: 0, y: 100, w: 20, h: 12 },
    { x: 100, y: 100, w: 20, h: 12 }, // weit rechts, teilt keine Spalte
  ];
  expect(spreadLabelsVertically(boxes)).toEqual([0, 0]);
});

test("vertikal bereits ausreichend getrennte Boxen bleiben unverändert", () => {
  const boxes: LayoutBox[] = [
    { x: 0, y: 0, w: 20, h: 10 },
    { x: 0, y: 100, w: 20, h: 10 }, // gleiche Spalte, aber 100px Abstand
  ];
  expect(spreadLabelsVertically(boxes)).toEqual([0, 0]);
});

/* ---------- Kern: Entzerren ---------- */

test("zwei deckungsgleiche Boxen werden mit Luft getrennt", () => {
  const gap = 2;
  const boxes: LayoutBox[] = [
    { x: 0, y: 50, w: 30, h: 12 },
    { x: 0, y: 50, w: 30, h: 12 },
  ];
  const out = applied(boxes, gap);
  expect(noOverlaps(out)).toBe(true);
  // Genau ein Element bleibt unten (dy 0), das andere wird um h+gap nach oben gehoben.
  const dy = spreadLabelsVertically(boxes, gap);
  expect(dy.filter(d => d === 0).length).toBe(1);
  expect(Math.min(...dy)).toBe(-(12 + gap));
});

test("Tags werden nach OBEN geschoben (negatives dy), nie nach unten", () => {
  const boxes: LayoutBox[] = [
    { x: 0, y: 50, w: 30, h: 12 },
    { x: 5, y: 52, w: 30, h: 12 },
    { x: 2, y: 48, w: 30, h: 12 },
  ];
  for (const d of spreadLabelsVertically(boxes)) expect(d).toBeLessThanOrEqual(0);
});

test("ganze Spalte aus drei dichten Tags wird komplett entzerrt", () => {
  const boxes: LayoutBox[] = [
    { x: 0, y: 60, w: 40, h: 12 },
    { x: 0, y: 66, w: 40, h: 12 },
    { x: 0, y: 72, w: 40, h: 12 },
  ];
  expect(noOverlaps(applied(boxes))).toBe(true);
});

test("realistischer Dock-Cluster (Pods in 2 Spalten × 3 Reihen) ist danach überlappungsfrei", () => {
  // Zwei Spalten 32px auseinander, Reihen 16px – Tags sind breiter als der Spaltenabstand.
  const boxes: LayoutBox[] = [];
  for (let row = 0; row < 3; row++)
    for (const col of [0, 32]) boxes.push({ x: col, y: 456 + row * 16, w: 60, h: 13 });
  const out = applied(boxes);
  expect(noOverlaps(out)).toBe(true);
});

/* ---------- Feste Hindernisse (Schilder) ---------- */

test("feste Schilder bleiben stehen (dy = 0), bewegliche Tags weichen ihnen aus", () => {
  const boxes: LayoutBox[] = [
    { x: 0, y: 438, w: 50, h: 18, movable: false }, // Holz-Schild „ahoi-control"
    { x: 8, y: 444, w: 60, h: 13 },                  // Pod-Tag direkt darunter, überlappt
  ];
  const dy = spreadLabelsVertically(boxes);
  expect(dy[0]).toBe(0);          // Schild unbewegt
  expect(dy[1]).toBeLessThan(0);  // Tag ist ausgewichen
  expect(noOverlaps(applied(boxes))).toBe(true);
});

test("Tag weicht einem Schild auch dann aus, wenn das Schild ÜBER ihm liegt", () => {
  // „Bos Dock"-Schild oberhalb, Service-Tag knapp darunter – Tag muss weiter hoch.
  const boxes: LayoutBox[] = [
    { x: 104, y: 374, w: 56, h: 18, movable: false },
    { x: 104, y: 366, w: 40, h: 13 },
  ];
  const dy = spreadLabelsVertically(boxes);
  expect(dy[0]).toBe(0);
  expect(noOverlaps(applied(boxes))).toBe(true);
});

/* ---------- Determinismus ---------- */

test("gleiche Eingabe liefert reproduzierbar gleiche Versätze", () => {
  const mk = (): LayoutBox[] => [
    { x: 0, y: 50, w: 30, h: 12 },
    { x: 4, y: 52, w: 30, h: 12 },
    { x: 80, y: 50, w: 30, h: 12 },
  ];
  expect(spreadLabelsVertically(mk())).toEqual(spreadLabelsVertically(mk()));
});

/* ---------- Red-Green-Schutz ----------
 * Beweist, dass die Test-Helfer wirklich anschlagen: ohne Entzerrung (rohe Boxen)
 * MUSS noOverlaps für einen dichten Cluster false sein. Bliebe das grün, wäre der
 * Überlappungs-Test wertlos. */
test("Red-Green: rohe (nicht entzerrte) dichte Boxen überlappen nachweislich", () => {
  const raw: LayoutBox[] = [
    { x: 0, y: 50, w: 30, h: 12 },
    { x: 0, y: 50, w: 30, h: 12 },
  ];
  expect(noOverlaps(raw)).toBe(false); // roh: Überlapp vorhanden …
  expect(noOverlaps(applied(raw))).toBe(true); // … nach Entzerrung weg
});

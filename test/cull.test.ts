/* Tests fürs Off-screen-Culling & die FPS-Messung (#82).
 *
 * Geprüft werden die harten Garantien des puren Culling-Kerns: erweitertes
 * Sichtfeld, Sichtbar-Toggle, korrekte Sichtbar-Zählung – inklusive Grenz-/
 * Negativfällen (Kante, leere Liste, pausierter Tab) und Red-Green-Schutz
 * (ein Objekt weit draußen MUSS ausgeblendet werden, sonst cullt nichts). */
import { test, expect } from "vitest";
import { expandRect, inView, cull, selectVisibleTags, FrameSampler, type Cullable, type Rect, type TagAnchor } from "../src/hud/cull";

const view: Rect = { x: 100, y: 100, width: 200, height: 120 };

/* ---------- expandRect ---------- */

test("expandRect wächst um margin nach allen Seiten", () => {
  const r = expandRect(view, 16);
  expect(r).toEqual({ x: 84, y: 84, width: 232, height: 152 });
});

test("expandRect mit margin 0 lässt das Rechteck unverändert", () => {
  expect(expandRect(view, 0)).toEqual(view);
});

/* ---------- inView ---------- */

test("inView: Punkt mittig drin ist sichtbar, Punkt weit weg nicht", () => {
  expect(inView(150, 150, view)).toBe(true);
  expect(inView(5000, 5000, view)).toBe(false);
  expect(inView(-50, 150, view)).toBe(false);
});

test("inView: Kanten zählen als drin (inklusive)", () => {
  expect(inView(100, 100, view)).toBe(true);           // obere linke Ecke
  expect(inView(300, 220, view)).toBe(true);           // untere rechte Ecke (x+w, y+h)
  expect(inView(99.9, 150, view)).toBe(false);         // knapp links daneben
  expect(inView(300.1, 150, view)).toBe(false);        // knapp rechts daneben
});

test("inView: der Rand aus expandRect rettet knapp-draußen-Objekte (Pop-in-Schutz)", () => {
  // 20px links der linken Kante -> ohne Rand draußen, mit 32px-Rand sichtbar.
  expect(inView(80, 150, view)).toBe(false);
  expect(inView(80, 150, expandRect(view, 32))).toBe(true);
});

/* ---------- cull ---------- */

function mk(x: number, y: number, visible = true): Cullable {
  return { x, y, obj: { visible } };
}

test("cull blendet Draußen aus, Drinnen ein – und zählt die Sichtbaren", () => {
  const items = [mk(150, 150), mk(290, 200), mk(-100, 150), mk(150, 9999)];
  const visible = cull(items, view);
  expect(visible).toBe(2);
  expect(items.map((i) => i.obj.visible)).toEqual([true, true, false, false]);
});

test("cull schaltet bereits ausgeblendete Objekte wieder sichtbar, wenn sie hereinscrollen", () => {
  // Red-Green-Schutz: Würde cull nur ein-Weg ausblenden (visible nie zurück auf
  // true), bliebe dieses Objekt für immer unsichtbar.
  const it = mk(150, 150, false);
  expect(cull([it], view)).toBe(1);
  expect(it.obj.visible).toBe(true);
});

test("cull: ein Objekt weit draußen MUSS ausgeblendet werden (Red-Green)", () => {
  const it = mk(10000, 10000, true);
  expect(cull([it], view)).toBe(0);
  expect(it.obj.visible).toBe(false);
});

test("cull auf leerer Liste liefert 0 und wirft nicht", () => {
  expect(cull([], view)).toBe(0);
});

/* ---------- selectVisibleTags (#416) ---------- */

// Großzügiges Sichtfeld; die meisten Tests steuern über die NÄHE zur Figur.
const bigView: Rect = { x: 0, y: 0, width: 1000, height: 1000 };
const opts = { full: 42, fade: 84, cap: 64 };

test("selectVisibleTags: ein Tag im Sichtfeld und im Voll-Radius wird gewählt (alpha 1) – Red-Green", () => {
  // Würde die Auswahl nichts durchlassen, wäre KEIN Tag je sichtbar.
  const tags: TagAnchor[] = [{ ax: 100, ay: 100 }];
  const r = selectVisibleTags(tags, { x: 100, y: 100 }, bigView, opts);
  expect(r).toEqual([{ i: 0, alpha: 1, dist: 0 }]);
});

test("selectVisibleTags: außerhalb des Sichtfelds wird NICHT gewählt, selbst wenn nah an der Figur", () => {
  // Tag direkt bei der Figur, aber beide außerhalb von `view` → nicht rendern.
  const tags: TagAnchor[] = [{ ax: -500, ay: -500 }];
  expect(selectVisibleTags(tags, { x: -500, y: -500 }, view, opts)).toEqual([]);
});

test("selectVisibleTags: außerhalb des Aufdeck-Radius (>= fade) fällt raus", () => {
  const tags: TagAnchor[] = [{ ax: 200, ay: 100 }]; // 100 px entfernt, fade=84
  expect(selectVisibleTags(tags, { x: 100, y: 100 }, bigView, opts)).toEqual([]);
});

test("selectVisibleTags: alpha fadet linear zwischen full und fade", () => {
  const mid = (opts.full + opts.fade) / 2; // 63 px → genau halb ausgeblendet
  const tags: TagAnchor[] = [{ ax: 100 + mid, ay: 100 }];
  const r = selectVisibleTags(tags, { x: 100, y: 100 }, bigView, opts);
  expect(r).toHaveLength(1);
  expect(r[0].alpha).toBeCloseTo(0.5, 5);
});

test("selectVisibleTags: deckelt auf die `cap` NÄCHSTEN Tags", () => {
  // Vier Tags in steigender Distanz; cap 2 → die zwei nächsten (i=0,1).
  const tags: TagAnchor[] = [
    { ax: 100, ay: 100 }, // d 0
    { ax: 110, ay: 100 }, // d 10
    { ax: 130, ay: 100 }, // d 30
    { ax: 140, ay: 100 }, // d 40
  ];
  const r = selectVisibleTags(tags, { x: 100, y: 100 }, bigView, { full: 42, fade: 84, cap: 2 });
  expect(r.map((v) => v.i)).toEqual([0, 1]);
});

test("selectVisibleTags: nach Distanz sortiert (nächste zuerst), stabil bei Gleichstand", () => {
  const tags: TagAnchor[] = [
    { ax: 130, ay: 100 }, // d 30
    { ax: 110, ay: 100 }, // d 10
    { ax: 110, ay: 100 }, // d 10 (gleich wie i=1 → kleinerer Index zuerst)
  ];
  const r = selectVisibleTags(tags, { x: 100, y: 100 }, bigView, opts);
  expect(r.map((v) => v.i)).toEqual([1, 2, 0]);
});

test("selectVisibleTags: leere Liste liefert [] und wirft nicht", () => {
  expect(selectVisibleTags([], { x: 0, y: 0 }, bigView, opts)).toEqual([]);
});

/* ---------- FrameSampler ---------- */

test("FrameSampler: konstante 16.67ms-Frames ergeben ~60 FPS", () => {
  const s = new FrameSampler(10);
  for (let i = 0; i < 10; i++) s.push(1000 / 60);
  expect(s.fps).toBe(60);
  expect(s.frames).toBe(10);
});

test("FrameSampler: 50ms-Frames ergeben ~20 FPS", () => {
  const s = new FrameSampler();
  for (let i = 0; i < 30; i++) s.push(50);
  expect(s.fps).toBe(20);
});

test("FrameSampler hält nur die letzten `size` Frames (gleitendes Fenster)", () => {
  const s = new FrameSampler(5);
  for (let i = 0; i < 4; i++) s.push(50);   // 20 FPS …
  for (let i = 0; i < 5; i++) s.push(1000 / 60); // … dann 5x 60 FPS, verdrängt die alten
  expect(s.frames).toBe(5);
  expect(s.fps).toBe(60);
});

test("FrameSampler ohne Frames meldet 0 FPS (kein NaN/Division durch 0)", () => {
  expect(new FrameSampler().fps).toBe(0);
});

test("FrameSampler ignoriert nicht-positive Deltas (pausierter Tab, erster Frame)", () => {
  const s = new FrameSampler();
  s.push(0);
  s.push(-5);
  expect(s.frames).toBe(0);
  expect(s.fps).toBe(0);
  s.push(1000 / 60);
  expect(s.fps).toBe(60);
});

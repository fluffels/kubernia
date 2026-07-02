/* Deterministische Deko-Platzierung – pure Domäne, ohne Phaser (#3).
 *
 * Büsche, Steine, Hafenlaternen und Wildblumen wurden bisher über Phasers
 * globalen Zufall (`Phaser.Math.Between`) gestreut – also bei JEDEM Neuladen
 * woanders. Das sieht unruhig aus und steht dem Wunsch „Laternen an feste
 * Stellen statt zufällig" entgegen. Diese Schicht wählt die Felder rein
 * deterministisch (gleicher Seed → exakt gleiche Welt), bleibt dabei aber
 * gut über die Karte verteilt. scenes.ts ist Phaser-gekoppelt und im Node-Lauf
 * nicht importierbar – die Streu-Logik lebt deshalb hier und wird in
 * test/decor.test.ts abgetestet (genau wie die Geometrie in world.ts). */

/** Deterministischer 0..1-Hash aus Seed + Koordinaten (FNV-/xorshift-artig).
 *  Kein globaler Zustand: gleiche Eingabe liefert immer denselben Wert. */
export function hash01(seed: number, x: number, y: number): number {
  let h = (seed | 0) ^ 0x9e3779b9;
  h = Math.imul(h ^ (x | 0), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13) ^ (y | 0), 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296; // immer im Bereich [0, 1)
}

/** Stabiler Integer-Seed aus einem Text (z.B. dem Textur-Namen), damit jede
 *  Deko-Sorte ihr eigenes, reproduzierbares Streumuster bekommt. */
export function strSeed(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  return h >>> 0;
}

export interface ScatterSpec {
  /** Kartenbreite/-höhe in Kacheln */
  W: number;
  H: number;
  /** Wie viele Objekte maximal platziert werden sollen */
  count: number;
  /** Streu-Seed (z.B. via strSeed aus dem Textur-Namen) */
  seed: number;
  /** true, wenn das Feld (x,y) bebaubar ist (passender Untergrund, nicht solide,
   *  nicht an Wege grenzend, Spieler-Start frei – die Regeln bleiben beim Aufrufer) */
  accept(x: number, y: number): boolean;
  /** Pixel-Versatz innerhalb der Kachel, jeweils [min, max] (inklusive). Optional. */
  jitter?: { x: [number, number]; y: [number, number] };
}

export interface Placement {
  /** Kachel-Koordinaten */
  x: number;
  y: number;
  /** deterministischer Pixel-Versatz innerhalb der Kachel */
  jx: number;
  jy: number;
}

/** Wählt bis zu `count` Felder deterministisch und gut verteilt aus.
 *
 *  Garantien (siehe Tests):
 *  - nur Felder, die `accept` durchlassen
 *  - keine Doppelbelegung
 *  - höchstens `count` (und höchstens so viele, wie es gültige Felder gibt)
 *  - reproduzierbar: gleicher Seed + gleiche `accept` → exakt gleiche Liste
 *  - Streuung: die Felder werden nach ihrem Hash-Wert sortiert und vorne
 *    abgeschnitten – die ersten `count` liegen damit pseudozufällig über die
 *    ganze Karte verteilt statt zu klumpen, aber eben fest statt bei jedem
 *    Laden neu gewürfelt. */
export function pickPlacements(spec: ScatterSpec): Placement[] {
  const { W, H, count, seed, accept } = spec;
  if (count <= 0) return [];

  const cells: { x: number; y: number; key: number; idx: number }[] = [];
  let idx = 0;
  for (let y = 1; y <= H - 2; y++) {
    for (let x = 1; x <= W - 2; x++) {
      if (!accept(x, y)) continue;
      cells.push({ x, y, key: hash01(seed, x, y), idx: idx++ });
    }
  }
  // Nach Hash sortieren; bei Gleichstand stabil über den Laufindex (sort ist
  // sonst nicht garantiert stabil) – hält das Ergebnis plattformunabhängig fest.
  cells.sort((a, b) => (a.key - b.key) || (a.idx - b.idx));

  const jx = spec.jitter?.x ?? [0, 0];
  const jy = spec.jitter?.y ?? [0, 0];
  const span = (r: [number, number], h: number) => {
    const lo = r[0], hi = Math.max(r[0], r[1]);
    return lo + Math.floor(h * (hi - lo + 1));
  };

  return cells.slice(0, count).map((c) => ({
    x: c.x,
    y: c.y,
    jx: span(jx, hash01(seed ^ 0x1111, c.x, c.y)),
    jy: span(jy, hash01(seed ^ 0x2222, c.x, c.y)),
  }));
}

/** Aussehen eines einzelnen Gras-Büschels (#40, Stardew-Look). */
export interface GrassTuft {
  /** Form-Variante (0 .. variants-1) – verschiedene Büschel-Silhouetten */
  variant: number;
  /** Grün-Nuance als Offset in [-1, 1) – leichte Helligkeits-/Farbvariation pro Büschel */
  shade: number;
  /** feste Neigung in Grad (ganzzahlig, -8 .. 8) – bricht den Gleichtakt ohne Bewegung */
  angle: number;
  /** Skalierung um 1.0 herum (0.8 .. 1.3) */
  scale: number;
  /** horizontal gespiegelt? – verdoppelt die optische Vielfalt der Silhouetten */
  flip: boolean;
}

/** Leitet rein deterministisch (Seed + Koordinaten, kein globaler Zufall) das
 *  Aussehen eines Gras-Büschels auf Feld (x,y) ab. Gleiche Welt → exakt gleiche
 *  Wiese (#3-Prinzip). Jede Eigenschaft zieht aus einem eigenen Hash-Strom, damit
 *  Variante, Farbe, Neigung und Skalierung voneinander unabhängig streuen.
 *  `variants` (>= 1) ist die Anzahl verfügbarer Form-Texturen. */
export function grassTuftStyle(seed: number, x: number, y: number, variants: number): GrassTuft {
  const n = Math.max(1, Math.floor(variants));
  return {
    variant: Math.min(n - 1, Math.floor(hash01(seed ^ 0x3333, x, y) * n)),
    shade: hash01(seed ^ 0x4444, x, y) * 2 - 1,
    angle: Math.round((hash01(seed ^ 0x5555, x, y) * 2 - 1) * 8),
    scale: 0.8 + hash01(seed ^ 0x6666, x, y) * 0.5,
    flip: hash01(seed ^ 0x7777, x, y) < 0.5,
  };
}

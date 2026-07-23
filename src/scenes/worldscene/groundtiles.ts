/* ===== Kubernia – Wang-Autotile-Klassifikation (worldscene/groundtiles.ts) =====
 * #958 (Kind von #870): SSOT der Boden-Kachel-Wahl, vorher fast-duplikat in
 * worldscene/terrain.ts (Hafen) und RegionScene.ts (Regionen). Bewusst Phaser-frei
 * (nur die reine Eck-/Rand-Berechnung + die daraus abgeleitete Sheet/Frame-Wahl),
 * damit im Node-Test prüfbar; der dünne Phaser-`stamp`-Teil liegt in
 * worldscene/renderground.ts.
 *
 * Wichtig (#866/#914): das grass-dirt-Tileset wurde getauscht (lower=Weg,
 * upper=Gras, „Gras wächst über die Wegkante"). Der Weg-Zweig braucht darum einen
 * invertierten Eck-Code (`^ 15`), damit die Wang-Frames auf das getauschte Sheet
 * passen – der Hafen hatte diesen Fix, die Regionen nie (genau die Divergenz, die
 * dieses Ticket schließt).
 */
import { WATER, SAND, PATH, DOCK } from "../../world/regions/terraincodes";
import { STONE } from "../../world/maps/harbormap";

/** PixelLab Wang-Tileset (Wasser->Sand): Eck-Code (NW,NE,SW,SE; Bit=1 => Land/oben)
 *  -> Frame im 4x4-Sheet "coast" (SSOT, #958 – vorher wortgleich dupliziert in
 *  scenes/shared.ts, die es seither von hier re-exportiert). */
export const WANG = [6, 7, 10, 9, 2, 11, 4, 15, 5, 14, 1, 8, 3, 0, 13, 12];

/** Minimale Sicht auf ein Boden-Raster, die die Klassifikation braucht – von
 *  WorldSceneLike UND RegionScene gleichermaßen erfüllt. */
export interface GroundReader {
  W: number;
  H: number;
  ground: number[];
}

/** #866/#914: Eck-Code-Transform für den Weg-Zweig – der Hafen hatte ihn, die
 *  Regionen nicht (die zu reconcilende Divergenz aus #958). */
const PATH_CORNER_TRANSFORM = 15;

function clampedGround(host: GroundReader, cx: number, cy: number): number {
  const ix = cx < 0 ? 0 : cx >= host.W ? host.W - 1 : cx;
  const iy = cy < 0 ? 0 : cy >= host.H ? host.H - 1 : cy;
  return host.ground[iy * host.W + ix];
}

/** PixelLab-Terrain-Stufe: Wasser(0) < Sand(1) < Land(2) < Weg(3). Dock-/Stein-Kai-
 *  Codes zählen als Land (Stufe 2) – sie werden weiter unten als eigene volle
 *  Kacheln behandelt, nicht über diese Stufen-Grenze. */
export function groundLevel(raw: number): number {
  return raw === WATER ? 0 : raw === SAND ? 1 : raw === PATH ? 3 : 2;
}

/** Eck-Code (NW,NE,SW,SE) gegen Schwelle `hi`: Ecke >= hi => „oben" (Bit gesetzt). */
export function cornerCode(host: GroundReader, x: number, y: number, hi: number): number {
  const lv = (cx: number, cy: number) => groundLevel(clampedGround(host, cx, cy));
  return (
    ((lv(x - 1, y - 1) >= hi ? 1 : 0) << 3) |
    ((lv(x, y - 1) >= hi ? 1 : 0) << 2) |
    ((lv(x - 1, y) >= hi ? 1 : 0) << 1) |
    (lv(x, y) >= hi ? 1 : 0)
  );
}

/** Ob eine der vier Eck-Nachbarn genau die Stufe `level` hat. */
export function touchesLevel(host: GroundReader, x: number, y: number, level: number): boolean {
  const lv = (cx: number, cy: number) => groundLevel(clampedGround(host, cx, cy));
  return (
    lv(x - 1, y - 1) === level || lv(x, y - 1) === level ||
    lv(x - 1, y) === level || lv(x, y) === level
  );
}

/** Stein-Kai/-Klippe (Boden-Codes 96–98, `STONE` in world/maps/harbormap.ts). Der
 *  Cast auf `readonly number[]` löst nur die literale Tupel-Typisierung von
 *  `.includes` – der geprüfte Wert bleibt ein beliebiger Boden-Code. */
function isStoneCode(raw: number): boolean {
  return (STONE as readonly number[]).includes(raw);
}

/** Wasser-Rand-Set nach Nachbar-Material: Holz (Steg/Schiff) > Stein (Kai) > Sand (Küste). */
export function edgeMaterial(host: GroundReader, x: number, y: number): "dock" | "kai" | "coast" {
  const cs = [
    clampedGround(host, x - 1, y - 1), clampedGround(host, x, y - 1),
    clampedGround(host, x - 1, y), clampedGround(host, x, y),
  ];
  if (cs.some((c) => c === DOCK)) return "dock";
  if (cs.some(isStoneCode)) return "kai";
  return "coast";
}

/** Ob die Kachel selbst Wasser ist – für die Sparkle-/Wellen-Platzierung in
 *  renderground.ts (Aufrufer bleibt dabei immer im Raster, kein Clamping nötig). */
export function isWaterCell(host: GroundReader, x: number, y: number): boolean {
  return host.ground[y * host.W + x] === WATER;
}

/** Sheet + Wang-Frame einer Kachel. */
export interface GroundTile {
  sheet: string;
  frame: number;
}

/** Die geteilte Kachel-Kaskade (vorher fast-identisch dupliziert in terrain.ts und
 *  RegionScene.ts): Wasser-Rand -> Dock/Stein-Kai voll -> Weg -> Gras/Sand. */
export function groundTile(host: GroundReader, x: number, y: number): GroundTile {
  if (touchesLevel(host, x, y, 0)) {
    return { sheet: edgeMaterial(host, x, y), frame: WANG[cornerCode(host, x, y, 1)] };
  }
  const raw = host.ground[y * host.W + x];
  if (raw === DOCK) return { sheet: "dock", frame: WANG[15] };
  if (isStoneCode(raw)) return { sheet: "kai", frame: WANG[15] };
  if (touchesLevel(host, x, y, 3)) {
    return { sheet: "path", frame: WANG[cornerCode(host, x, y, 3) ^ PATH_CORNER_TRANSFORM] };
  }
  return { sheet: "meadow", frame: WANG[cornerCode(host, x, y, 2)] };
}

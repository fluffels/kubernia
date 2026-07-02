/* ===== Region-Geometrie: geteilte pure Bausteine (#566) =====
 * Die drei Nachbar-Regionen (Archipel/Leuchtturm/Lager) bauen ihr Kachelraster
 * nach demselben Muster: Grundterrain aus einer landLevel-Funktion füllen, den
 * deterministischen Gras-Frame wählen, Registry-Objekte als Kachel-Solid
 * markieren. Diese Bausteine lagen vorher byte-gleich in JEDER Region-Datei
 * (#502-Burn-down aus #547) – hier EINMAL, damit eine weitere Region
 * (Stardew-Scope) sie nicht ein viertes Mal dupliziert. Region-Eigenes bleibt in
 * der jeweiligen Datei: die konkrete `landLevel`-Form, Steg/Pfad und das Streuen
 * von Bäumen/Fels/Gütern.
 */
import { objectsForMap, objectFootprint, type EntityObject } from "../../content/entities";

/** Wasser-Bodencode – identisch zur Hauptkarte (renderGround) in allen Regionen. */
const WATER = -2;

/** Deterministischer Gras-Frame-Index (0/1/2) wie auf der Hauptkarte: meist 0,
 *  seltener 1/2 für etwas Textur. Aus (x,y) gehasht, also stabil pro Kachel. */
export function grassFrame(x: number, y: number): number {
  const h = (((x * 73856093) ^ (y * 19349663)) >>> 0) % 100;
  return h < 80 ? 0 : h < 93 ? 1 : 2;
}

/**
 * Füllt das Grundterrain aus einer Höhenstufe (mutiert `ground`/`solid` in place):
 * 2 = Gras (`grassFrame`), 1 = region-eigener Rand (`level1At` – Sandstrand ODER
 * Stein-Kai), 0 = Wasser (blockt). Die konkrete Höhenstufe je Kachel liefert die
 * region-eigene `landLevel`.
 */
export function fillTerrain(
  W: number,
  H: number,
  ground: number[],
  solid: Uint8Array,
  landLevel: (x: number, y: number) => 0 | 1 | 2,
  level1At: (x: number, y: number) => number,
): void {
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const lvl = landLevel(x, y);
      const i = y * W + x;
      if (lvl === 0) { ground[i] = WATER; solid[i] = 1; }   // Wasser blockt
      else if (lvl === 1) ground[i] = level1At(x, y);        // Rand (Sand/Stein) begehbar
      else ground[i] = grassFrame(x, y);                     // Gras begehbar
    }
  }
}

/**
 * Markiert alle soliden Registry-Objekte einer Karte (#357) als Kachel-Solid
 * (Quest-Trigger sind begehbar → übersprungen) und liefert sie zurück, damit ein
 * Aufrufer (z.B. das Lager für die Güter-Streuung) sie zusätzlich als „belegt"
 * nutzen kann, ohne die Registry ein zweites Mal zu filtern.
 */
export function markRegistrySolids(map: string, W: number, solid: Uint8Array): EntityObject[] {
  const solids = objectsForMap(map).filter((o) => o.type !== "quest_trigger");
  for (const o of solids) for (const t of objectFootprint(o)) solid[t.y * W + t.x] = 1;
  return solids;
}

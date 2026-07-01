/* ===== Inhalte: kleine Helfer =====
 * Zufalls-Helfer, die von mehreren Inhalts-Modulen (Drills, …) gebraucht werden.
 * Der Zufall kommt aus dem globalen Strom in `src/rng.ts` (SSOT, #492) – KEIN
 * `Math.random` mehr in `src/content/**` (seedbar → reproduzierbare Drill-Auswahl).
 */
import { nextRandom } from "../rng";

/** Ein zufälliges Element aus einem Array. */
export const pick = <T>(arr: T[]): T => arr[Math.floor(nextRandom() * arr.length)];

/** Zufallszahl im geschlossenen Intervall [a, b]. */
export const rnd = (a: number, b: number) => a + Math.floor(nextRandom() * (b - a + 1));

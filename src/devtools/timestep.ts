/* Dev-Zeit-Stepping (#1284): reine Planung für `kqDev.advanceTime(ms)`.
 *
 * Die Präsentation (scenes/devapi.ts) steppt Phaser frame-weise vor; wie viele Frames
 * in welcher Länge, ist reine Arithmetik und darum hier Node-testbar. */

/** Standard-Frame-Länge (60 fps). */
export const DEV_FRAME_MS = 1000 / 60;
/** Größte erlaubte Frame-Länge: die Bewegung in den Szenen deckelt dt auf 50 ms, darüber
 *  wäre das Stepping kein 1:1-Vorlauf mehr. */
export const MAX_DEV_FRAME_MS = 50;
/** Deckel für einen Vorlauf: er blockiert synchron den Main-Thread. */
export const MAX_ADVANCE_MS = 600_000;

export interface AdvancePlan {
  frames: number;
  frameMs: number;
  /** Zeit, die nach `frames` ganzen Frames übrig bleibt (< frameMs). */
  remainderMs: number;
}

/** Teilt `ms` in ganze Frames der Länge `frameMs` plus Rest. Wirft RangeError bei
 *  ungültiger Eingabe (0, negativ, nicht endlich, über Deckel). */
export function planAdvance(ms: number, frameMs: number = DEV_FRAME_MS): AdvancePlan {
  if (!Number.isFinite(ms) || ms <= 0 || ms > MAX_ADVANCE_MS) {
    throw new RangeError(`advanceTime: ms muss endlich sein und in (0, ${MAX_ADVANCE_MS}] liegen, war ${ms}`);
  }
  if (!Number.isFinite(frameMs) || frameMs <= 0 || frameMs > MAX_DEV_FRAME_MS) {
    throw new RangeError(`advanceTime: frameMs muss in (0, ${MAX_DEV_FRAME_MS}] liegen, war ${frameMs}`);
  }
  // Epsilon gegen Float-Rauschen: 1000 / (1000/60) darf nicht 59.999… ergeben.
  const frames = Math.floor(ms / frameMs + 1e-9);
  const rest = ms - frames * frameMs;
  // Eine Klemme für beides: Float-Rauschen (±) und negativer Rest werden zu 0.
  return { frames, frameMs, remainderMs: rest > 1e-6 ? rest : 0 };
}

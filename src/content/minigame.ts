/* ===== Inhalte: Minispiel & Sturm-Helfer =====
 * Stapel-Spiel (Docker-Image-Schichten in die richtige Reihenfolge bringen)
 * und ein kleiner Helfer, der Image-Namen für Sturm-Events verfälscht.
 *
 * Die Stapel-Runden sind seit #583 Content-as-Data: reine Daten in `./data/stack-
 * rounds.json` statt TS-Objekt-Literal (wie NPCs #348) – `corruptImage` bleibt
 * echter Code (Mechanik, keine Inhalte) und steht darum weiterhin hier.
 */
import stackRoundsData from "./data/stack-rounds.json";
import { fail, asArray, asRecord, asNonEmptyString, asNonEmptyStringArray, assertNoUnknownKeys } from "./parse";

/* ---------- Stapel-Spiel: Docker-Image-Schichten ---------- */
/** Eine Stapel-Runde: Schichten AUFSTEIGEND nach Anzahl sortiert (#218, geprüft von
 *  `content/validate.ts`) – erst wenige Schichten (Anfänger nicht überfordern), dann
 *  mehr. `cacheTip` ist eine konkrete Cache-/Build-Lektion an genau diesem Beispiel,
 *  die nach geschaffter Runde gezeigt wird, damit „Cache" und „Build" nicht nur im
 *  Merksatz fallen, sondern durch Wiederholung wirklich sitzen. */
export interface StackRound {
  name: string;
  layers: string[];
  cacheTip: string;
}

const STACK_ROUND_KEYS = ["name", "layers", "cacheTip"] as const;

/** Validiert die rohen Stapel-Runden-Daten. Wirft `ContentValidationError` beim ersten
 *  Verstoß; die Business-Regel „nach Schichtzahl aufsteigend sortiert" prüft weiterhin
 *  `content/validate.ts` (referenzielle/Business-Prüfung, nicht Schema). */
export function parseStackRounds(raw: unknown): StackRound[] {
  const arr = asArray(raw, "stack-rounds");
  if (arr.length === 0) fail("stack-rounds", "mindestens eine Runde erwartet");
  return arr.map((v, i) => {
    const o = asRecord(v, `stack-rounds[${i}]`);
    assertNoUnknownKeys(o, `stack-rounds[${i}]`, STACK_ROUND_KEYS);
    return {
      name: asNonEmptyString(o.name, `stack-rounds[${i}].name`),
      layers: asNonEmptyStringArray(o.layers, `stack-rounds[${i}].layers`),
      cacheTip: asNonEmptyString(o.cacheTip, `stack-rounds[${i}].cacheTip`),
    };
  });
}

/** Validierte Stapel-Runden – Quelle: `./data/stack-rounds.json`. */
export const STACK_ROUNDS: StackRound[] = parseStackRounds(stackRoundsData);

/** Buchstabendreher für Sturm-Events: macht aus jedem Image-Namen garantiert einen anderen. */
export function corruptImage(img: string) {
  for (let i = 1; i < img.length - 1; i++) {
    if (img[i] !== img[i + 1]) return img.slice(0, i) + img[i + 1] + img[i] + img.slice(i + 2);
  }
  return img + "x";
}

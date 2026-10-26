/* Projekt-Block einer AGENTS.md (zwischen den Markern, die die Verteilung nie anfasst) für Wächter-Tests. Eine Quelle statt vier Ausschneider. */
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import { PROJEKT_BLOCK_ENDE, PROJEKT_BLOCK_START } from "../../scripts/besitz-lib.mjs";

const START = PROJEKT_BLOCK_START as string;
const ENDE = PROJEKT_BLOCK_ENDE as string;

/** Inhalt zwischen `PROJEKT_BLOCK_START` und dem ersten `PROJEKT_BLOCK_ENDE` danach (ohne Marker); `null`, wenn der Start fehlt, das Ende fehlt oder nur vor dem Start steht. Pur. */
export function projektBlock(text: string): string | null {
  const von = text.indexOf(START);
  if (von < 0) return null;
  const inhalt = von + START.length;
  const bis = text.indexOf(ENDE, inhalt);
  return bis < 0 ? null : text.slice(inhalt, bis);
}

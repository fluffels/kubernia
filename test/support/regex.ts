/* Regex-Hilfen der Kern-Tests (#1906): ein gemeinsamer Escape und der Ganzes-Wort-Matcher, damit die Wächter-Tests
 * keine eigenen Kopien führen. */
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import { escapeRegex } from "../../scripts/ticket-namen.mjs";

/** Maskiert jedes Regex-Metazeichen, damit `text` in einem Muster nur als Text wirkt. */
export const escapeRe = (text: string): string => (escapeRegex as (t: string) => string)(text);

/** Muster-Quelltext (für `new RegExp(…, "u")`) für „eines der Wörter als ganzes Wort“: Unicode-Wortgrenzen, ein Umlaut grenzt als Buchstabe. */
export const ganzesWortMuster = (woerter: readonly string[]): string => `(?<![\\p{L}\\p{N}_])(?:${woerter.map(escapeRe).join("|")})(?![\\p{L}\\p{N}_])`;

/** Regex für „eines der Wörter als ganzes Wort“; `flags` müssen `u` enthalten (Standard `iu`). */
export const ganzesWortRe = (woerter: readonly string[], flags = "iu"): RegExp => {
  // Ohne `u` liest der Ausdruck `\p{L}` als Literal und der Matcher irrt still.
  if (!flags.includes("u")) throw new Error(`ganzesWortRe: flags müssen "u" enthalten (war "${flags}")`);
  return new RegExp(ganzesWortMuster(woerter), flags);
};

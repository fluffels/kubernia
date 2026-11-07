/**
 * Regex-Helfer ohne Importe (Blatt): die eine Quelle für `escapeRegex`, das Entfernen von ANSI-Farbcodes (factory#202) und die Zeichenklasse des npm-Schrittnamens `SCHRITT_NAME` (factory#208).
 * Jeder Verbraucher importiert direkt von hier, es gibt keinen Re-Export (wie factory#114). `schichten-kern.cjs` (CommonJS ohne Importe)
 * maskiert ohne diese Quelle nur den Punkt (Endungsform) und trägt keine Kopie der Escape-Klasse.
 */

/** Maskiert alle Regex-Metazeichen samt `/` und `-`. Pur. */
export function escapeRegex(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\/-]/g, String.raw`\$&`);
}

/** Zeichenklasse eines npm-Skriptnamens (Quelltext für RegExp-Bausteine, factory#208): verify-lauf, check:docdrift und die Doku-Erkennung nutzen dieselbe. Endet nie auf einen Punkt (ein Satzpunkt hinter `npm run x.` gehört nicht zum Namen). */
export const SCHRITT_NAME = "[\\w:.-]*[\\w:-]";

/** Ganzer Schrittname als Regex (factory#215): die Prüfform für einen Gate-/Skriptnamen in der Config, ohne Kopie der Zeichenklasse. */
export const GATE_FORM = new RegExp(`^${SCHRITT_NAME}$`);

/** ANSI-Farbcode (`ESC[…m`). */
export const FARBCODE = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");

/** Text ohne ANSI-Farbcodes. Pur. */
export const ohneFarbcodes = (text) => String(text ?? "").replace(FARBCODE, "");

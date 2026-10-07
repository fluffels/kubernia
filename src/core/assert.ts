/* ===== Kubernia – Exhaustiveness-Helfer (core/assert.ts, #1426) =====
 * `default: return assertNever(x, "ort")` in einem `switch` über eine Union: eine neue
 * Variante ist ein Compile-Fehler (x ist nicht mehr `never`), und eine zur Laufzeit
 * gefälschte oder veraltete Variante wirft mit Ort und Variante statt still `undefined`
 * zu liefern. Nur für Anzeige-/Befehlslogik; Validierung und Save-Pfad sammeln Fehler bzw.
 * heilen und werfen nie.
 *
 * Phaser-frei (pure Domäne), keine Imports. */

const MAX_LEN = 200;

function kurz(value: unknown): string {
  let s: string;
  try { s = JSON.stringify(value) ?? String(value); } catch { s = String(value); }
  return s.length > MAX_LEN ? s.slice(0, MAX_LEN) + "…" : s;
}

/** Wirft immer: `wo` nennt die Stelle, der Wert (gekürzt) die unbehandelte Variante. */
export function assertNever(value: never, wo: string): never {
  throw new Error(`${wo}: unbehandelte Variante ${kurz(value)}`);
}

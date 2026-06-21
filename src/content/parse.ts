/* ===== Inhalte: gemeinsame Parse-/Validier-Primitiven (#411) =====
 * Kleines, abhängigkeitsfreies Leaf-Modul: die `ContentValidationError`-Klasse,
 * der `fail`-Abbruch und die `as*`-Primitiv-Validatoren. Lag früher in `loader.ts`,
 * ist aber jetzt geteilt: sowohl der Loader (`loader.ts`) als auch die Check-DSL
 * (`check-dsl.ts`) brauchen genau dieselben Bausteine. Sie hier zu bündeln bricht
 * den Import-Zyklus, der sonst entstünde (loader → check-dsl → loader), den der
 * Architektur-Wächter (#390, `keine-zyklen`) verbietet. `loader.ts` re-exportiert
 * `ContentValidationError` weiter, damit bestehende `import … from "./loader"`
 * (z.B. entities.ts, Tests) unverändert laufen.
 */

/** Wird geworfen, wenn eine Daten-Datei nicht zum erwarteten Schema passt.
 *  Eigene Klasse, damit Tests gezielt darauf prüfen können (statt nur „Error"). */
export class ContentValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ContentValidationError";
  }
}

/** Bricht die Validierung mit einer menschenlesbaren Pfadangabe ab.
 *  `never`-Rückgabe → der Aufrufer weiß danach, dass der Wert gültig ist. */
export function fail(path: string, msg: string): never {
  throw new ContentValidationError(`Content „${path}": ${msg}`);
}

export function asRecord(v: unknown, path: string): Record<string, unknown> {
  if (typeof v !== "object" || v === null || Array.isArray(v)) fail(path, "Objekt erwartet");
  return v as Record<string, unknown>;
}

export function asNonEmptyString(v: unknown, path: string): string {
  if (typeof v !== "string") fail(path, "String erwartet");
  if (v.trim() === "") fail(path, "nicht-leerer String erwartet");
  return v;
}

export function asInt(v: unknown, path: string): number {
  if (typeof v !== "number" || !Number.isInteger(v)) fail(path, "Ganzzahl erwartet");
  return v;
}

export function asNonEmptyStringArray(v: unknown, path: string): string[] {
  if (!Array.isArray(v)) fail(path, "Array erwartet");
  if (v.length === 0) fail(path, "nicht-leeres Array erwartet");
  return v.map((x, i) => asNonEmptyString(x, `${path}[${i}]`));
}

export function asBool(v: unknown, path: string): boolean {
  if (typeof v !== "boolean") fail(path, "Boolean erwartet");
  return v;
}

export function asArray(v: unknown, path: string): unknown[] {
  if (!Array.isArray(v)) fail(path, "Array erwartet");
  return v;
}

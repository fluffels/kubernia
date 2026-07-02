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

/** Schema-Drift-Wächter für Content-JSON (#498, Vorbild `reviveScenario` #494).
 *  Prüft ein Roh-Objekt gegen ein GESCHLOSSENES Schema: jeder Schlüssel MUSS in `known`
 *  stehen (= wird von seinem `revive*` konsumiert). Ohne diese Prüfung wird ein JSON-
 *  Schlüssel, den KEIN Reviver liest, beim Laden still verworfen – und die ~13k Zeilen
 *  JSON driften unbemerkt von den TS-Typen ab. Genau diese eine Kopplung Form↔Typ war
 *  vorher nur handgepflegt (loader.ts lädt die JSON als `unknown`). Jetzt scheitert die
 *  Drift hart mit Pfadangabe: ein Tippfehler in einem Optionalfeld (`introducdIn`), ein
 *  umbenanntes/entferntes Typ-Feld oder ein hand-hinzugefügtes Feld ohne Loader-Anschluss
 *  fällt beim Laden auf – im Browser wie im Node-Test. `known` steht bewusst direkt neben
 *  den Feld-Lesezugriffen des Revivers (eine Quelle der Wahrheit je Objektform). */
export function assertNoUnknownKeys(o: Record<string, unknown>, path: string, known: readonly string[]): void {
  const allowed = new Set<string>(known);
  for (const k of Object.keys(o)) {
    if (!allowed.has(k)) {
      fail(`${path}.${k}`, `unbekannter Schlüssel „${k}" – kein Reviver liest ihn (Tippfehler? veraltetes oder neues Typ-Feld ohne Loader-Anschluss?)`);
    }
  }
}

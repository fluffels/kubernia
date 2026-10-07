/* Wiederverwendbare Erwartungen (#1342): Helfer, die statt eines bedingten `expect` (if/continue/catch) eine
 * unbedingte Prüfung machen. Ein `expect` im Zweig, der nie läuft, wird nie rot (Regel `vitest/no-conditional-expect`).
 * Jeder Helfer prüft selbst per `expect` und schlägt damit sichtbar fehl; kein stilles Überspringen. */
import { expect } from "vitest";

/** Verengt eine Union nach `outcome`: prüft den Wert (rot bei Abweichung) und gibt die passende Variante typisiert zurück. */
export function erwarteFall<T extends { outcome: string }, V extends T["outcome"]>(v: T, wert: V): Extract<T, { outcome: V }> {
  expect(v.outcome).toBe(wert);
  return v as Extract<T, { outcome: V }>;
}

/** Wie `erwarteFall`, für Unions mit dem Schlüssel `kind`. */
export function erwarteVariante<T extends { kind: string }, V extends T["kind"]>(v: T, wert: V): Extract<T, { kind: V }> {
  expect(v.kind).toBe(wert);
  return v as Extract<T, { kind: V }>;
}

export interface BodenErwartung {
  /** Boden-Kachelwert (z.B. `WATER`). */
  boden: number;
  /** Erwarteter `solid`-Wert dieses Bodens (1 = solide, 0 = begehbar). */
  solid: 0 | 1;
  /** Name für die Fehlermeldung. */
  name: string;
}

/**
 * Kollisions-Erwartung je Bodentyp ohne bedingtes `expect`: jeder genannte Boden kommt auf dem Raster vor (sonst wäre die
 * Prüfung leer) und trägt überall den erwarteten `solid`-Wert; `ausnahmen` sind Indizes, die nicht geprüft werden.
 */
export function erwarteSolidJeBoden(
  map: { ground: ArrayLike<number>; solid: ArrayLike<number> },
  erwartet: readonly BodenErwartung[],
  ausnahmen: ReadonlySet<number> = new Set(),
): void {
  for (const e of erwartet) {
    const indizes = Array.from({ length: map.ground.length }, (_, i) => i).filter((i) => map.ground[i] === e.boden && !ausnahmen.has(i));
    expect(indizes.length, `${e.name} kommt vor`).toBeGreaterThan(0);
    expect(
      indizes.filter((i) => map.solid[i] !== e.solid),
      `${e.name}: Kacheln mit falschem solid-Wert (erwartet ${e.solid})`,
    ).toEqual([]);
  }
}

/* Gemeinsames Test-Harness: die Browser-Umgebung, die die Anwendungs-/Persistenz-
 * Schicht im Node-Testlauf erwartet (window.localStorage), plus das frische Laden
 * des Spiel-Stacks. Bewusst NUR Umgebung + Modul-Laden – kein Domänenwissen und
 * keine Gucklöcher in Interna; Verhaltens-Tests bauen darauf ihr eigenes Setup auf.
 *
 * Vorher war genau dieses Stück wortgleich in game.test.ts und sandbox.test.ts
 * kopiert (und als eigene Helfer in store.test.ts) – zusammengeführt in #475. */
import { vi } from "vitest";

/** Map-gestützter localStorage-Stub. `_map` liegt bewusst offen, damit die
 *  Persistenz-Tests den rohen Speicher inspizieren können (Schlüsselanzahl
 *  prüfen, eine Roh-/Alt-Datei direkt setzen). Verhaltens-Tests ignorieren es. */
export interface LocalStorageStub {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  _map: Map<string, string>;
}

export function makeLocalStorageStub(): LocalStorageStub {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: (k: string, v: string) => { map.set(k, String(v)); },
    removeItem: (k: string) => { map.delete(k); },
    _map: map,
  };
}

/** Stubbt `window` mit einem localStorage (Default: frischer Stub) und gibt ihn
 *  zurück. Kurzform für das wiederkehrende `vi.stubGlobal("window", …)`. */
export function stubWindowLocalStorage(
  ls: LocalStorageStub = makeLocalStorageStub(),
): LocalStorageStub {
  vi.stubGlobal("window", { localStorage: ls });
  return ls;
}

/** Wärmt den Spiel-Stack einmal vor (#1309): der erste dynamische Import transformiert alle Module kalt und
 *  lief unter Last (voller `npm run verify`, Windows) in den 5000-ms-Testtimeout. Tests, die den Stack nach
 *  `vi.resetModules()` frisch laden, rufen das einmal in `beforeAll(warmupGameStack, 60_000)` auf; danach zahlt
 *  jeder Test nur noch den warmen Re-Import. Räumt hinter sich auf (kein gestubbtes `window`, leerer Modul-Cache). */
export async function warmupGameStack(): Promise<void> {
  stubWindowLocalStorage();
  await import("../../src/game");
  await import("../../src/sim");
  await import("../../src/store");
  await import("../../src/runtime");
  vi.unstubAllGlobals();
  vi.resetModules();
}

/** Lädt den Spiel-Stack FRISCH. Erst aufrufen, NACHDEM `window` gestubbt ist –
 *  game.ts setzt beim Import `(window as any).Game` und store.ts greift auf
 *  window.localStorage zu, deshalb der dynamische Import statt eines top-level. */
export async function loadGameStack() {
  const { Game } = await import("../../src/game");
  const { Sim } = await import("../../src/sim");
  const { SaveStore } = await import("../../src/store");
  return { Game, Sim, SaveStore };
}

/* Test-Harness-Wächter (#1309): `warmupGameStack()` lädt den Spiel-Stack vor und räumt restlos auf.
 * Hinterließe es ein gestubbtes `window` oder einen vollen Modul-Cache, bekäme jeder nachfolgende Test in
 * derselben Datei eine verseuchte Umgebung (und `resetModules`-basierte Isolation wäre wirkungslos). */
import { test, expect, vi, beforeAll } from "vitest";
import { warmupGameStack } from "./support/browser-env";

beforeAll(warmupGameStack, 60_000);

test("nach dem Warmup ist kein window gestubbt", () => {
  expect(typeof window).toBe("undefined");
});

test("nach dem Warmup ist der Modul-Cache leer: ein frischer Import liefert eine neue Instanz", async () => {
  vi.stubGlobal("window", { localStorage: { getItem: () => null, setItem: () => undefined, removeItem: () => undefined } });
  const a = await import("../src/runtime");
  vi.resetModules();
  const b = await import("../src/runtime");
  vi.unstubAllGlobals();
  expect(a).not.toBe(b);
});

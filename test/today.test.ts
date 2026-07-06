/* Test für den reinen Tageszähler `today()` (src/game/shared.ts, #587).
 *
 * `today()` ist die SSOT für den Tages-Index, auf dem die persistierte Leitner-Fälligkeit
 * (`due`) und der Streak (`lastDay`) rechnen. Er MUSS zeitzonenunabhängig sein (UTC-Tageszähler):
 * ein lokal-zeitzonengebundener Zähler verschiebt bei Reise/Zeitzonenwechsel jede Fälligkeit
 * um ±1 Tag (der Bug aus #587). Deterministisch & plattformunabhängig getestet, indem der
 * gemeldete Zeitzonen-Offset gezielt verfälscht wird – das Ergebnis darf sich NICHT ändern.
 */
import { test, expect, afterEach, vi } from "vitest";
import { today } from "../src/game/shared";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

test("today() liefert den UTC-Tageszähler", () => {
  vi.useFakeTimers();
  const instant = "2026-01-01T00:30:00.000Z";
  vi.setSystemTime(new Date(instant));
  expect(today()).toBe(Math.floor(Date.parse(instant) / 86400000));
});

test("today() ist zeitzonenunabhängig (egal welcher Offset gemeldet wird)", () => {
  vi.useFakeTimers();
  // Instant kurz nach UTC-Mitternacht: genau hier weicht ein lokal gebundener Tageszähler
  // in West-Zeitzonen um einen Tag ab (Vortag) – der klassische ±1-Fehler aus #587.
  const instant = "2026-01-01T00:30:00.000Z";
  vi.setSystemTime(new Date(instant));
  const utcDay = Math.floor(Date.parse(instant) / 86400000);

  const spy = vi.spyOn(Date.prototype, "getTimezoneOffset");
  spy.mockReturnValue(-720); // UTC+12 (Osten, Offset negativ)
  expect(today()).toBe(utcDay);
  spy.mockReturnValue(720); // UTC-12 (Westen, Offset positiv) – hier riss der alte Zähler ab
  expect(today()).toBe(utcDay);
  spy.mockReturnValue(0); // UTC
  expect(today()).toBe(utcDay);
});

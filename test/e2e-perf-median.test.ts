import { describe, expect, test } from "vitest";
import { anlaufMedian, medianAus } from "../e2e/perf-median";

describe("medianAus (Perf-Smoke, #1821)", () => {
  test("ungerade Anzahl: der mittlere Wert nach Sortierung, Eingabe bleibt unverändert", () => {
    const werte = [38, 60, 12];
    expect(medianAus(werte)).toBe(38);
    expect(werte).toEqual([38, 60, 12]);
  });
  test("ein Ausreißer nach unten kippt den Median nicht", () => {
    expect(medianAus([60, 3, 58])).toBe(58);
  });
  test("leere Liste ist ein Fehler, kein stilles NaN", () => {
    expect(() => medianAus([])).toThrow();
  });
});

describe("anlaufMedian: nur Proben innerhalb von Phasers Anlauf zählen", () => {
  const proben = [
    { fps: 60, frames: 40 },
    { fps: 50, frames: 80 },
    { fps: 38, frames: 119 },
    { fps: 20, frames: 121 },
  ];
  test("Proben mit mehr als 120 Frames bleiben außen vor", () => {
    expect(anlaufMedian(proben, 120)).toBe(50);
  });
  test("Grenzwert: genau 120 Frames zählt noch zum Anlauf", () => {
    expect(anlaufMedian([{ fps: 44, frames: 120 }], 120)).toBe(44);
  });
  test("keine Probe im Anlauf: null (der Anlauf-Boden greift dann nicht)", () => {
    expect(anlaufMedian([{ fps: 38, frames: 154 }], 120)).toBeNull();
    expect(anlaufMedian([], 120)).toBeNull();
  });
});

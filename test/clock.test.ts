/* Tests für die HUD-Uhr/-Datums-Ableitung (#39).
 *
 * Kern: aus der laufenden Spielzeit + Zykluslänge eine Uhrzeit (HH:MM) und ein
 * Stardew-Datum (Tag/Saison/Wochentag) ableiten – synchron zum Tag-Nacht-Schleier
 * (phase 0 = Mittag, 0.5 = Mitternacht). Geprüft werden die Eckpunkte des Zyklus,
 * der Tageswechsel exakt um Mitternacht, Saison-/Wochentags-Rollover sowie
 * harte Invarianten und ein Red-Green-Schutz gegen eine konstante Ausgabe. */
import { test, expect } from "vitest";
import { gameClock, DAY_CYCLE_MS } from "../src/clock";

const CYCLE = 1440000; // wie in scenes.ts: 24 min realer Zeit = ein Spieltag

test("DAY_CYCLE_MS ist die SSOT der Zykluslänge (Schleier + Kalender leiten daraus ab, #413)", () => {
  // Wächter gegen erneutes Hartcodieren: der lokale CYCLE-Erwartungswert und die exportierte
  // Konstante müssen übereinstimmen – sonst liefen scenery.ts und clock.ts auseinander.
  expect(DAY_CYCLE_MS).toBe(CYCLE);
});

/* ---------- Uhrzeit-Eckpunkte (phase → HH:MM) ---------- */

test("Spielstart (phase 0) ist Mittag 12:00 an Tag 1", () => {
  const c = gameClock(0, CYCLE);
  expect(c.hhmm).toBe("12:00");
  expect(c.day).toBe(1);
});

test("phase 0.5 ist Mitternacht 00:00", () => {
  expect(gameClock(0.5 * CYCLE, CYCLE).hhmm).toBe("00:00");
});

test("phase 0.25 ist 18:00 (Abend), phase 0.75 ist 06:00 (Morgen)", () => {
  expect(gameClock(0.25 * CYCLE, CYCLE).hhmm).toBe("18:00");
  expect(gameClock(0.75 * CYCLE, CYCLE).hhmm).toBe("06:00");
});

/* ---------- Tageswechsel exakt um Mitternacht ---------- */

test("Tag erhöht sich genau bei Mitternacht (phase 0.5), nicht davor", () => {
  expect(gameClock(0.5 * CYCLE - 1, CYCLE).day).toBe(1); // kurz vor Mitternacht
  expect(gameClock(0.5 * CYCLE, CYCLE).day).toBe(2);     // Mitternacht
  expect(gameClock(1.5 * CYCLE, CYCLE).day).toBe(3);     // nächste Mitternacht
});

/* ---------- Stardew-Datum: Saison & Wochentag ---------- */

test("Tag 1 ist 🌱 Frühling, Montag, dayOfSeason 1", () => {
  const c = gameClock(0, CYCLE);
  expect(c.seasonName).toBe("Frühling");
  expect(c.weekday).toBe("Mo");
  expect(c.dayOfSeason).toBe(1);
  expect(c.dateLabel).toBe("🌱 Mo, Tag 1");
});

test("Saison wechselt nach 28 Tagen, Wochentag rolliert nach 7 Tagen", () => {
  const day29 = gameClock(28 * CYCLE, CYCLE); // day = floor(28+0.5)+1 = 29
  expect(day29.day).toBe(29);
  expect(day29.seasonName).toBe("Sommer");
  expect(day29.dayOfSeason).toBe(1);
  // Tag 8 hat wieder Wochentag "Mo" ((8-1) % 7 === 0)
  expect(gameClock(7 * CYCLE, CYCLE).weekday).toBe("Mo");
});

/* ---------- Invarianten über den ganzen Zyklus ---------- */

test("hhmm ist über den ganzen Zyklus eine gültige Zeit (minutengenau, #121)", () => {
  for (let i = 0; i < 1440; i++) { // jede angezeigte Minute abtasten
    const c = gameClock((i / 1440) * CYCLE, CYCLE);
    expect(c.hhmm).toMatch(/^([01]\d|2[0-3]):[0-5]\d$/);
  }
});

/* ---------- #121: Uhr läuft im Sekundentakt, minutengenau ---------- */

test("#121 1 reale Sekunde = 1 angezeigte Minute (cycle = 24 reale Minuten/Tag)", () => {
  // Bei CYCLE = 1_440_000 ms entspricht 1 reale Sekunde (1000 ms) genau einer
  // angezeigten Minute: ab Mittag tickt die Anzeige 12:00 → 12:01 → 12:02 …
  expect(gameClock(0, CYCLE).hhmm).toBe("12:00");
  expect(gameClock(1000, CYCLE).hhmm).toBe("12:01");
  expect(gameClock(2000, CYCLE).hhmm).toBe("12:02");
  // 1 reale Minute (60 s) später ist genau 1 angezeigte Stunde vergangen
  expect(gameClock(60_000, CYCLE).hhmm).toBe("13:00");
});

test("#121 Minuten erscheinen einzeln, nicht nur in 10er-Schritten", () => {
  // Genau das, was die alte 10-Min-Rundung verhindert hat: Zwischenminuten sind sichtbar.
  const minuten = new Set<string>();
  for (let s = 0; s < 60; s++) minuten.add(gameClock(s * 1000, CYCLE).hhmm.split(":")[1]);
  // Eine volle reale Minute durchläuft 60 verschiedene Anzeige-Minuten (00..59 ab 12:00).
  expect(minuten.size).toBe(60);
  // Auch „krumme" Minuten wie :07 oder :13, die durch /10-Rundung nie auftraten.
  expect(gameClock(7000, CYCLE).hhmm).toBe("12:07");
  expect(gameClock(13_000, CYCLE).hhmm).toBe("12:13");
});

/* ---------- Grenzfälle: Mitternacht, kein Rückwärtssprung ---------- */

test("#121 Mitternachts-Übergang ist sauber: 23:59 → 00:00, Tag +1, kein Sprung rückwärts", () => {
  const vorMitternacht = gameClock(0.5 * CYCLE - 1000, CYCLE); // 1 reale Sekunde vor Mitternacht
  expect(vorMitternacht.hhmm).toBe("23:59");
  expect(vorMitternacht.day).toBe(1);
  const mitternacht = gameClock(0.5 * CYCLE, CYCLE);
  expect(mitternacht.hhmm).toBe("00:00");
  expect(mitternacht.day).toBe(2);
});

test("#121 innerhalb eines Tages läuft die Anzeige-Minute monoton vorwärts (kein Flackern/Rücksprung)", () => {
  // Sekunde für Sekunde von Mittag bis kurz vor Mitternacht: totalMin darf nie
  // rückwärts springen. (Über die Mitternacht hinweg ist der Reset auf 0 gewollt.)
  const toTotal = (t: number) => { const [h, m] = gameClock(t, CYCLE).hhmm.split(":").map(Number); return h * 60 + m; };
  let prev = toTotal(0);
  for (let s = 1; s < 720; s++) { // 720 reale Sekunden = 12 angezeigte Stunden (Mittag→Mitternacht)
    const cur = toTotal(s * 1000);
    expect(cur).toBeGreaterThanOrEqual(prev);
    prev = cur;
  }
});

/* ---------- Red-Green-Schutz ---------- */

test("verschiedene Zeitpunkte liefern verschiedene Uhrzeiten (keine Konstante)", () => {
  const morgen = gameClock(0.7 * CYCLE, CYCLE).hhmm;
  const abend = gameClock(0.3 * CYCLE, CYCLE).hhmm;
  expect(morgen).not.toBe(abend);
});

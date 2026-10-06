/* Tests für die HUD-Uhr/-Datums-Ableitung (#39, Spielstart-Offset #336).
 *
 * Kern: aus der laufenden Spielzeit + Zykluslänge eine Uhrzeit (HH:MM) und ein
 * Stardew-Datum (Tag/Saison/Wochentag) ableiten – synchron zum Tag-Nacht-Schleier
 * (phase 0 = Mittag, 0.5 = Mitternacht, 0.75 = 06:00). Seit #336 ist `time = 0` der
 * SPIELSTART und zeigt den frühen Morgen (06:00), nicht mehr Mittag: gameClock verschiebt
 * die rohe Zeit intern um START_PHASE. Die `time`-Argumente hier sind also „seit Spielstart
 * vergangene Zeit". Geprüft werden die Eckpunkte des Zyklus, der Tageswechsel exakt um
 * Mitternacht (inkl. Off-by-one-Schutz beim ERSTEN Übergang), Saison-/Wochentags-Rollover
 * sowie harte Invarianten und ein Red-Green-Schutz gegen eine konstante Ausgabe. */
import { test, expect } from "vitest";
import { gameClock, daysUntilClock, DAY_CYCLE_MS, START_PHASE, withStartOffset } from "../src/core/clock";

const CYCLE = 1440000; // wie in scenes.ts: 24 min realer Zeit = ein Spieltag

test("DAY_CYCLE_MS ist die SSOT der Zykluslänge (Schleier + Kalender leiten daraus ab, #413)", () => {
  // Wächter gegen erneutes Hartcodieren: der lokale CYCLE-Erwartungswert und die exportierte
  // Konstante müssen übereinstimmen – sonst liefen scenery.ts und clock.ts auseinander.
  expect(DAY_CYCLE_MS).toBe(CYCLE);
});

/* ---------- #336: Spielstart-Offset (06:00 statt 12:00) ---------- */

test("#336 START_PHASE ist 06:00 (phase 0.75), der gemeinsame Offset für Uhr + Schleier", () => {
  expect(START_PHASE).toBe(0.75);
  // withStartOffset verschiebt die rohe Zeit um genau diese Phase.
  expect(withStartOffset(0, CYCLE)).toBe(0.75 * CYCLE);
  expect(withStartOffset(0.25 * CYCLE, CYCLE)).toBe(CYCLE);
});

test("#336 Spielstart (time 0) ist 06:00 (früher Morgen) an Tag 1, NICHT mehr Mittag", () => {
  const c = gameClock(0, CYCLE);
  expect(c.hhmm).toBe("06:00");
  expect(c.day).toBe(1);
});

/* ---------- Uhrzeit-Eckpunkte (seit Spielstart vergangene Zeit → HH:MM) ---------- */

test("Tageszeit-Eckpunkte ab dem 06:00-Start: +6h Mittag, +12h Abend, +18h Mitternacht, +24h wieder Morgen", () => {
  expect(gameClock(0, CYCLE).hhmm).toBe("06:00");              // Start
  expect(gameClock(0.25 * CYCLE, CYCLE).hhmm).toBe("12:00");   // +6h Mittag (phase 0)
  expect(gameClock(0.5 * CYCLE, CYCLE).hhmm).toBe("18:00");    // +12h Abend (phase 0.25)
  expect(gameClock(0.75 * CYCLE, CYCLE).hhmm).toBe("00:00");   // +18h Mitternacht (phase 0.5)
  expect(gameClock(CYCLE, CYCLE).hhmm).toBe("06:00");          // +24h wieder Morgen
});

/* ---------- Tageswechsel exakt um Mitternacht (Off-by-one-Schutz, #336) ---------- */

test("#336 Tag bleibt am Start 1 und springt erst zur ERSTEN Mitternacht (18h nach 06:00-Start) auf 2", () => {
  expect(gameClock(0, CYCLE).day).toBe(1);                  // Spielstart-Morgen
  expect(gameClock(0.25 * CYCLE, CYCLE).day).toBe(1);       // Mittag desselben Tages
  expect(gameClock(0.75 * CYCLE - 1, CYCLE).day).toBe(1);   // kurz vor der ersten Mitternacht
  expect(gameClock(0.75 * CYCLE, CYCLE).day).toBe(2);       // erste Mitternacht → Tag 2
  expect(gameClock(1.75 * CYCLE, CYCLE).day).toBe(3);       // zweite Mitternacht → Tag 3
});

/* ---------- Stardew-Datum: Saison & Wochentag ---------- */

test("Tag 1 ist Frühling (Saison-Index 0), Montag, dayOfSeason 1", () => {
  const c = gameClock(0, CYCLE);
  expect(c.seasonName).toBe("Frühling");
  expect(c.seasonIndex).toBe(0);
  expect(c.weekday).toBe("Mo");
  expect(c.dayOfSeason).toBe(1);
  // #645: das Datums-Label trägt KEIN Emoji mehr (reiner Text) – das HUD rendert das
  // Saison-Pixel-Icon separat über seasonIndex. dateLabel/timeLabel bleiben icon-frei.
  expect(c.dateLabel).toBe("Mo, Tag 1");
  expect(c.timeLabel).toBe("06:00");
  expect(c.dateLabel).not.toMatch(/🌱|☀️|🍂|❄️/);
  expect(c.timeLabel).not.toContain("🕐");
});

test("Saison wechselt nach 28 Tagen, Wochentag rolliert nach 7 Tagen", () => {
  // Bei vollen Tages-Vielfachen ist der Anzeige-Tag unverändert (der Start-Offset hebt sich
  // im Tageszähler heraus): nach 28 vollen Tagen ist es Tag 29.
  const day29 = gameClock(28 * CYCLE, CYCLE);
  expect(day29.day).toBe(29);
  expect(day29.seasonName).toBe("Sommer");
  expect(day29.dayOfSeason).toBe(1);
  // Tag 8 hat wieder Wochentag "Mo" ((8-1) % 7 === 0)
  expect(gameClock(7 * CYCLE, CYCLE).weekday).toBe("Mo");
});

test("#645 seasonIndex rolliert 0→1→2→3→0 im Gleichtakt mit seasonName (wählt das HUD-Icon)", () => {
  // Je Saison 28 Tage; der Index muss exakt zu seasonName passen (er indexiert
  // HUD_SEASON_ICONS in assets-data.ts) und nach Winter wieder auf Frühling springen.
  const expected: [number, number, string][] = [
    [0, 0, "Frühling"], [28, 1, "Sommer"], [56, 2, "Herbst"], [84, 3, "Winter"], [112, 0, "Frühling"],
  ];
  for (const [days, idx, name] of expected) {
    const c = gameClock(days * CYCLE, CYCLE);
    expect(c.seasonIndex).toBe(idx);
    expect(c.seasonName).toBe(name);
  }
});

/* ---------- Invarianten über den ganzen Zyklus ---------- */

test("hhmm ist über den ganzen Zyklus eine gültige Zeit (minutengenau, #121)", () => {
  for (let i = 0; i < 1440; i++) { // jede angezeigte Minute abtasten
    const c = gameClock((i / 1440) * CYCLE, CYCLE);
    expect(c.hhmm).toMatch(/^([01]\d|2[0-3]):[0-5]\d$/);
  }
});

/* ---------- #121: Uhr läuft im Sekundentakt, minutengenau ---------- */

test("#121 1 reale Sekunde = 1 angezeigte Minute (cycle = 24 reale Minuten/Tag), ab dem 06:00-Start", () => {
  // Bei CYCLE = 1_440_000 ms entspricht 1 reale Sekunde (1000 ms) genau einer
  // angezeigten Minute: ab dem Start (06:00) tickt die Anzeige 06:00 → 06:01 → 06:02 …
  expect(gameClock(0, CYCLE).hhmm).toBe("06:00");
  expect(gameClock(1000, CYCLE).hhmm).toBe("06:01");
  expect(gameClock(2000, CYCLE).hhmm).toBe("06:02");
  // 1 reale Minute (60 s) später ist genau 1 angezeigte Stunde vergangen
  expect(gameClock(60_000, CYCLE).hhmm).toBe("07:00");
});

test("#121 Minuten erscheinen einzeln, nicht nur in 10er-Schritten", () => {
  // Genau das, was die alte 10-Min-Rundung verhindert hat: Zwischenminuten sind sichtbar.
  const minuten = new Set<string>();
  for (let s = 0; s < 60; s++) minuten.add(gameClock(s * 1000, CYCLE).hhmm.split(":")[1]);
  // Eine volle reale Minute durchläuft 60 verschiedene Anzeige-Minuten (00..59 ab 06:00).
  expect(minuten.size).toBe(60);
  // Auch „krumme" Minuten wie :07 oder :13, die durch /10-Rundung nie auftraten.
  expect(gameClock(7000, CYCLE).hhmm).toBe("06:07");
  expect(gameClock(13_000, CYCLE).hhmm).toBe("06:13");
});

/* ---------- Grenzfälle: Mitternacht, kein Rückwärtssprung ---------- */

test("#121 Mitternachts-Übergang ist sauber: 23:59 → 00:00, Tag +1, kein Sprung rückwärts", () => {
  // Erste Mitternacht liegt 18h nach dem 06:00-Start, also bei phase 0.75 der Zeit-Achse.
  const vorMitternacht = gameClock(0.75 * CYCLE - 1000, CYCLE); // 1 reale Sekunde vor Mitternacht
  expect(vorMitternacht.hhmm).toBe("23:59");
  expect(vorMitternacht.day).toBe(1);
  const mitternacht = gameClock(0.75 * CYCLE, CYCLE);
  expect(mitternacht.hhmm).toBe("00:00");
  expect(mitternacht.day).toBe(2);
});

test("#121 innerhalb eines Tages läuft die Anzeige-Minute monoton vorwärts (kein Flackern/Rücksprung)", () => {
  // Sekunde für Sekunde vom Start (06:00) bis kurz vor Mitternacht: totalMin darf nie
  // rückwärts springen. (Über die Mitternacht hinweg ist der Reset auf 0 gewollt.)
  const toTotal = (t: number) => { const [h, m] = gameClock(t, CYCLE).hhmm.split(":").map(Number); return h * 60 + m; };
  let prev = toTotal(0);
  for (let s = 1; s < 1080; s++) { // 1080 reale Sekunden = 18 angezeigte Stunden (06:00 → Mitternacht)
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

/* ---------- #1311: daysUntilClock (kqDev.setClock) ---------- */

const hhmmAfter = (days: number, add: number) => gameClock((days + add) * DAY_CYCLE_MS, DAY_CYCLE_MS).hhmm;

test("daysUntilClock: Spielstart 06:00 → 21:00 am selben Tag, 00:00 und 05:59", () => {
  expect(daysUntilClock(0, "21:00") * 24).toBeCloseTo(15 + 0.5 / 60, 6); // Mitte der Zielminute
  for (const t of ["21:00", "00:00", "05:59", "12:30"]) expect(hhmmAfter(0, daysUntilClock(0, t)), t).toBe(t);
});

test("daysUntilClock: nur vorwärts – 21:00 → 06:00 ist der Folgetag, gleiche Minute bleibt 0", () => {
  const abends = daysUntilClock(0, "21:00");
  const d = daysUntilClock(abends, "06:00");
  expect(d * 24).toBeCloseTo(9, 6);
  expect(gameClock((abends + d) * DAY_CYCLE_MS, DAY_CYCLE_MS).day).toBe(2);
  expect(daysUntilClock(0, "06:00")).toBe(0);
  expect(daysUntilClock(abends, "21:00")).toBe(0);
});

test("daysUntilClock: Zielminute wird auch bei krummen Startwerten exakt getroffen (kein Float-Kippen)", () => {
  for (const start of [0.1234567, 3.3333333, 0.5, 12.999999]) {
    for (const t of ["00:00", "06:00", "13:37", "23:59"]) expect(hhmmAfter(start, daysUntilClock(start, t)), `${start}→${t}`).toBe(t);
  }
});

test("daysUntilClock: ungültiges Format wirft RangeError", () => {
  for (const bad of ["25:00", "7:5", "", "12:60", "12-30", "ab:cd", "24:00", "12:30 "]) {
    expect(() => daysUntilClock(0, bad), JSON.stringify(bad)).toThrow(RangeError);
  }
});

test("daysUntilClock: Starts genau auf dem Minutenraster verfehlen die Zielminute nicht (Repro #1311, Test-Lens R3)", () => {
  // Echte Fehlschläge des ersten Entwurfs: der Start liegt per Float knapp unter der Minutengrenze.
  expect(hhmmAfter(21.9625, daysUntilClock(21.9625, "19:17"))).toBe("19:17");
  expect(hhmmAfter(4.960416666666666, daysUntilClock(4.960416666666666, "09:37"))).toBe("09:37");
});

test("daysUntilClock: Eigenschaft über das Minutenraster – immer genau die Zielminute, vorwärts, höchstens ein Tag", () => {
  const ziele = ["00:00", "06:00", "09:37", "12:00", "19:17", "23:59"];
  for (let k = 0; k < 1440 * 30; k += 37) {
    for (const start of [k / 1440, k / 1440 + 1e-12, k / 1440 - 1e-12]) {
      if (start < 0) continue;
      for (const t of ziele) {
        const d = daysUntilClock(start, t);
        expect(hhmmAfter(start, d), `${start} → ${t}`).toBe(t);
        expect(d, `${start} → ${t}: nur vorwärts`).toBeGreaterThanOrEqual(0);
        expect(d, `${start} → ${t}: höchstens ein Tag`).toBeLessThan(1 + 1e-6);
      }
    }
  }
});

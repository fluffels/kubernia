// Reine Zeit-/Datums-Ableitung für die HUD-Anzeige (#39).
// Speist sich aus derselben time/CYCLE-Quelle wie der Tag-Nacht-Lichtschleier
// (scenes.ts, updateDayNight) – darum läuft die Anzeige garantiert synchron zum
// Schleier. Bewusst ohne Phaser gehalten, damit unit-testbar (vgl. world.ts/decor.ts).
//
// Seit #413 ist diese „time" KEINE flüchtige Frame-Zeit mehr, sondern die PERSISTENTE
// Spiel-Zeit-Achse aus dem Spielstand (`GameState.gameDays`, in ms umgerechnet): der
// Tageszähler/die Saison/die Uhrzeit überleben damit einen Reload. Die Ableitung hier
// bleibt unverändert rein (time → Uhr/Datum); wer sie speist (Frame-Zeit vs. Spielstand),
// ist Sache des Aufrufers (game/clock.ts › advanceClock + scenes/worldscene/scenery.ts).

/** Länge eines vollen Spiel-Tags in realen Millisekunden (Stardew-Tempo, #4).
 *  Einzige Quelle dieser Konstante – Tag-Nacht-Schleier (scenery.ts) und der
 *  persistente Kalender (game/clock.ts) leiten BEIDE hieraus ab, statt 1_440_000
 *  mehrfach hartzucodieren. Tempo justieren = nur diesen Wert ändern. Wichtig (#413):
 *  `GameState.gameDays` ist bewusst in TAGEN gespeichert, NICHT in ms – ein Tempo-Wechsel
 *  hier ändert also nur, wie schnell die Zeit künftig läuft, und schreibt KEINEN
 *  bestehenden Spielstand auf ein anderes Kalenderdatum um (Saves nie brechen). */
export const DAY_CYCLE_MS = 1440000;             // 24 Minuten realer Zeit = ein voller Tag

const SEASONS: [string, string][] = [
  ["🌱", "Frühling"], ["☀️", "Sommer"], ["🍂", "Herbst"], ["❄️", "Winter"],
];
const WEEKDAYS = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];

export interface GameClock {
  hhmm: string;        // "14:30"
  day: number;         // fortlaufender Tageszähler ab 1
  dayOfSeason: number; // 1..28 (Stardew: 28 Tage je Saison)
  weekday: string;     // "Mo".."So"
  seasonName: string;  // "Frühling".."Winter"
  dateLabel: string;   // "🌱 Mo, Tag 3"  (HUD)
  timeLabel: string;   // "🕐 14:30"      (HUD)
  title: string;       // "Frühling – Tag 3, 14:30 Uhr" (Tooltip)
}

/** Leitet aus der laufenden Spielzeit (ms) und der Zykluslänge cycle (ms je Tag)
 *  Uhrzeit + Stardew-Datum ab. phase 0 = Mittag … 0.5 = Mitternacht – identisch
 *  zur Schleier-Berechnung. */
export function gameClock(time: number, cycle: number): GameClock {
  // Angezeigte Minuten seit Mittag (phase 0 = Mittag). Minutengenau abgeschnitten
  // (floor), damit die Minute im Sekundentakt sichtbar hochzählt wie auf einer
  // Digitaluhr (#121): bei cycle = 24 realen Minuten/Tag entspricht 1 reale Sekunde =
  // 1 angezeigte Minute, 1 reale Minute = 1 angezeigte Stunde. Schleier & Uhr teilen
  // weiterhin dieselbe time/cycle-Quelle, bleiben also synchron.
  // Multiplikation VOR der Division hält ganze Minutengrenzen exakt (kein Float-Drift,
  // der z.B. 00:00 als 23:59 zeigen würde); 1440 = Minuten/Tag, +720 = 12:00 als Anker.
  const minutesFromNoon = Math.floor(((time % cycle) * 1440) / cycle);
  const totalMin = (minutesFromNoon + 720) % 1440;
  const hhmm = String(Math.floor(totalMin / 60)).padStart(2, "0") + ":" +
               String(totalMin % 60).padStart(2, "0");
  // Tageszähler springt bei Mitternacht (phase 0.5) auf den nächsten Tag.
  const day = Math.floor(time / cycle + 0.5) + 1;
  const [emoji, seasonName] = SEASONS[Math.floor((day - 1) / 28) % 4];
  const dayOfSeason = ((day - 1) % 28) + 1;
  const weekday = WEEKDAYS[(day - 1) % 7];
  return {
    hhmm, day, dayOfSeason, weekday, seasonName,
    dateLabel: `${emoji} ${weekday}, Tag ${dayOfSeason}`,
    timeLabel: `🕐 ${hhmm}`,
    title: `${seasonName} – Tag ${dayOfSeason}, ${hhmm} Uhr`,
  };
}

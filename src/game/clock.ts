/* Persistente Spiel-Zeit / Kalender (#413, Anwendungsschicht, Phaser-frei).
 * Die EINE Stelle, die die Zeit-Achse aus `GameState.gameDays` vorrückt und daraus den
 * abgeleiteten Kalender (Tag/Saison/Uhrzeit) liefert. Bewusst eigenes Bündel statt in
 * progression/economy: der Kalender ist die Wachstums-Säule für saisonalen Content,
 * Festivals und NPC-Routinen (Stardew-Scope) – hier liegt später die Query-API dafür.
 *
 * Trennung der Verantwortung:
 *  - `src/clock.ts` (pure Domäne): reine Ableitung time→Uhr/Datum + die Tempo-Konstante.
 *  - hier (Anwendung): hält die persistente Achse `state.gameDays` und rückt sie vor.
 *  - `scenes/worldscene/scenery.ts` (Präsentation): malt den Tag-Nacht-Schleier aus
 *    derselben Achse und ruft die HUD-Uhr.
 */
import { gameClock, DAY_CYCLE_MS, type GameClock } from "../clock";
import { part } from "./shared";

/** Obergrenze für den Zeit-Zuwachs EINES Frames (ms). Ein in den Hintergrund gelegter Tab
 *  oder ein Lade-Hänger liefert beim Wiederkommen ein riesiges `delta`; ohne Deckel würde
 *  der Kalender dann Stunden auf einmal überspringen. Mit Deckel läuft die Zeit einfach dort
 *  weiter, wo sie war (minimal langsamer bei Rucklern – für eine kosmetische Tag-Nacht-Uhr
 *  völlig unkritisch). */
const MAX_FRAME_MS = 1000;

/** Persistente Spiel-Zeit/Kalender der Game-Fassade (#413). */
export const clockBundle = part({
  /** Rückt die persistente Spiel-Zeit-Achse um die real vergangene Frame-Zeit `deltaMs` vor.
   *  Pro Frame aus der WorldScene-Update-Schleife aufgerufen. Speichert in TAGEN (entkoppelt
   *  vom Tempo `DAY_CYCLE_MS`, siehe types.ts › gameDays). Unsinnige Deltas (NaN/≤0) werden
   *  ignoriert, große gegen `MAX_FRAME_MS` gedeckelt. Der 5-s-Auto-Save persistiert den Wert
   *  dann automatisch mit. */
  advanceClock(deltaMs: number) {
    if (!Number.isFinite(deltaMs) || deltaMs <= 0) return;
    this.state.gameDays += Math.min(deltaMs, MAX_FRAME_MS) / DAY_CYCLE_MS;
  },

  /** Der aus der persistenten Achse abgeleitete Kalender (Anzeige-Tag, Saison, Wochentag,
   *  Uhrzeit + fertige HUD-Labels). Query-Seam für UI und späteren saisonalen Content –
   *  „welcher Tag/welche Saison ist es?" fragt man hierüber, nicht über die Frame-Zeit. */
  calendar(): GameClock {
    return gameClock(this.state.gameDays * DAY_CYCLE_MS, DAY_CYCLE_MS);
  },
});

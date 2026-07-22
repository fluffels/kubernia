/* ===== Kubernia 3.0 – Spiel-Logik (Orchestrator/Barrel, #392) =====
 * Die öffentliche `Game`-Fassade entsteht aus den fokussierten Bündeln unter src/game/
 * (Persistenz/Wirtschaft/Progression/Freischaltungen/Spaced-Repetition); der veränderliche
 * Spielzustand (this.*) ist hier zentral deklariert, gemeinsame Helfer liegen in
 * src/game/shared.ts. Schwester-Refactor zu #345 (scenes.ts), #346 (sim.ts) und #356 (ui.ts).
 * Persistenz läuft über die SaveStore-Schicht (IndexedDB seit #350; localStorage/In-Memory
 * als Fallback). Anwendungsschicht – bewusst Phaser-frei und im Node-Test prüfbar.
 *
 * Die öffentliche API ist unverändert: kein Aufrufer wurde angefasst. Die Konstante
 * ABBREV_EARN_THRESHOLD bleibt hier importierbar (ui/radio.ts + game.test.ts) – re-exportiert
 * aus src/game/shared.ts. ALL_ABBREV_UNLOCKED wird seit #574 nur noch von der Save-Migration
 * (store/versioning.ts) gebraucht – die importiert ihn direkt aus game/shared.ts statt über
 * diese Fassade. */
import { Sim as KQSim } from "./sim";
import type { GameState } from "./types";
import { makeDefaultState, type GameApi } from "./game/shared";
import { saveBundle } from "./game/save";
import { economyBundle } from "./game/economy";
import { progressionBundle } from "./game/progression";
import { unlocksBundle } from "./game/unlocks";
import { spacedRepetitionBundle } from "./game/spaced-repetition";
import { clockBundle } from "./game/clock";
import { tickBundle } from "./game/tick";
import { hazardsBundle } from "./game/hazards";
import { sandboxBundle } from "./game/sandbox";
import { autosaveBundle } from "./game/autosave";

export { ABBREV_EARN_THRESHOLD } from "./game/shared";

/* Die Annotation `: GameApi` ist der Drift-Wächter (#513): der Compiler prüft, dass die
 * komponierte Fassade GENAU die deklarierte Oberfläche erfüllt. Fehlt eine Bündel-Methode in
 * GameApi (oder weicht ihre Signatur ab), schlägt der Typecheck hier fehl – die Liste in
 * shared.ts kann also nicht mehr still veralten. */
export const Game: GameApi = {
  // state & sim sind ab Modul-Init gesetzt (und werden von load() ersetzt) –
  // nie null. Das spart Null-Prüfungen in der gesamten Spiel-/Szenen-Logik.
  state: makeDefaultState(),
  sim: new KQSim({}),
  incomeAcc: 0,
  offlineEarnings: 0,
  // #279: beim Laden gesetzt (Backfill nachgeschobener Lernkarten) – flüchtig, kein Save.
  newLearnCards: 0,
  // Wiederspiel-Sandbox (#332): Lesezeichen des Live-Stands während eines Replays –
  // bewusst flüchtig im RAM (NICHT Teil von GameState/Save). null = kein Wiederspiel.
  replayBookmark: null as GameState | null,
  // Autosave-Baseline (#869): Startwert vor dem ersten load()/save() – wird von save() sofort
  // auf den echten Stand gezogen (load() endet mit save()), hier nur ein gültiger Platzhalter.
  autosaveBaseline: { rev: 0, coins: 0, playerX: null, playerY: null, savedAt: 0 },
  autosavePendingSince: null,
  ...saveBundle,
  ...economyBundle,
  ...progressionBundle,
  ...unlocksBundle,
  ...spacedRepetitionBundle,
  ...clockBundle,
  ...tickBundle,
  ...hazardsBundle,
  ...sandboxBundle,
  ...autosaveBundle,
};

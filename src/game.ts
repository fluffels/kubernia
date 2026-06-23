/* ===== KubeQuest 3.0 – Spiel-Logik (Orchestrator/Barrel, #392) =====
 * Die öffentliche `Game`-Fassade entsteht aus den fokussierten Bündeln unter src/game/
 * (Persistenz/Wirtschaft/Progression/Freischaltungen/Spaced-Repetition); der veränderliche
 * Spielzustand (this.*) ist hier zentral deklariert, gemeinsame Helfer liegen in
 * src/game/shared.ts. Schwester-Refactor zu #345 (scenes.ts), #346 (sim.ts) und #356 (ui.ts).
 * Persistenz läuft über die SaveStore-Schicht (IndexedDB seit #350; localStorage/In-Memory
 * als Fallback). Anwendungsschicht – bewusst Phaser-frei und im Node-Test prüfbar.
 *
 * Die öffentliche API ist unverändert: kein Aufrufer wurde angefasst. Auch die Konstanten
 * ALL_ABBREV_UNLOCKED/ABBREV_EARN_THRESHOLD/CMD_HISTORY_UNLOCK_AT bleiben hier importierbar
 * (ui/radio.ts + game.test.ts) – re-exportiert aus src/game/shared.ts. */
import { Sim as KQSim } from "./sim";
import type { GameState } from "./types";
import { makeDefaultState } from "./game/shared";
import { saveBundle } from "./game/save";
import { economyBundle } from "./game/economy";
import { progressionBundle } from "./game/progression";
import { unlocksBundle } from "./game/unlocks";
import { spacedRepetitionBundle } from "./game/spaced-repetition";
import { clockBundle } from "./game/clock";
import { sandboxBundle } from "./game/sandbox";

export { ALL_ABBREV_UNLOCKED, ABBREV_EARN_THRESHOLD, CMD_HISTORY_UNLOCK_AT } from "./game/shared";

export const Game = {
  // state & sim sind ab Modul-Init gesetzt (und werden von load() ersetzt) –
  // nie null. Das spart Null-Prüfungen in der gesamten Spiel-/Szenen-Logik.
  state: makeDefaultState(),
  sim: new KQSim({}),
  incomeAcc: 0,
  offlineEarnings: 0,
  // Wiederspiel-Sandbox (#332): Lesezeichen des Live-Stands während eines Replays –
  // bewusst flüchtig im RAM (NICHT Teil von GameState/Save). null = kein Wiederspiel.
  replayBookmark: null as GameState | null,
  ...saveBundle,
  ...economyBundle,
  ...progressionBundle,
  ...unlocksBundle,
  ...spacedRepetitionBundle,
  ...clockBundle,
  ...sandboxBundle,
};

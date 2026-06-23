/* Wiederspiel-Sandbox für abgeschlossene Quests (#332, Stufe 2 aus #326).
 *
 * Eine abgeschlossene Quest erneut spielen, OHNE den Live-Stand zu zerstören:
 *  1. Lesezeichen setzen: Beim Reinspringen wird der komplette Live-Spielstand
 *     als tiefe Kopie in den ARBEITSSPEICHER geklont (`replayBookmark`) – bewusst
 *     NICHT in den Save geschrieben.
 *  2. Sandbox-Modus: Solange das Lesezeichen gesetzt ist, ist `save()` ein No-Op
 *     (Guard in game/save.ts): kein Auto-Save, keine doppelte XP/Wirtschaft,
 *     `completedQuests`/`questIdx`/Cluster des echten Stands bleiben unangetastet.
 *  3. Zurück zur aktuellen Quest: Das Lesezeichen wird 1:1 zurückgespielt und
 *     EINMAL persistiert – man landet exakt an der gemerkten Live-Position
 *     (Position + questIdx + questStep + …).
 *
 * Das eigentliche Springen wiederverwendet `jumpToQuest` (progression.ts); dessen
 * `save(false)` läuft im Wiederspiel durch den Guard leer (kein Store-Write).
 *
 * Bewusst VOLLER State-Klon als Lesezeichen (nicht nur Position+Index): so darf
 * das Wiederspiel intern beliebig mutieren (Rewards, Cluster, Review-Boxen) – beim
 * Beenden wird alles verworfen. Das ist die robuste Sandbox-Garantie. Und bewusst
 * UNABHÄNGIG vom `repeatable`-Flag (#410, das den Live-`startQuest`-Pfad steuert):
 * die Review-Sandbox darf jede je abgeschlossene Quest nachspielen, weil sie den
 * echten Fortschritt gar nicht berührt (Stardew-Scope: jede Lektion nachschlagbar).
 *
 * Phaser-frei, unit-testbar (Anwendungsschicht). Die DOM-/Welt-Anbindung
 * (Reposition, Banner) liegt dünn in ui/questlog.ts + ui/hud.ts. */
import { Sim as KQSim } from "../sim";
import { KQContent } from "../content";
import type { GameState } from "../types";
import { part } from "./shared";

/** Tiefer, serialisierungstreuer Klon des Spielstands – genau der Save-Vertrag:
 *  GameState ist vollständig JSON-serialisierbar (clusterSnapshot ist reine Daten).
 *  Kein geteilter Verweis zwischen Lesezeichen und Live-Stand. */
function cloneState(s: GameState): GameState {
  return JSON.parse(JSON.stringify(s)) as GameState;
}

/** Wiederspiel-Sandbox der Game-Fassade (#332). */
export const sandboxBundle = part({
  /** Läuft gerade ein Wiederspiel (Lesezeichen gesetzt)? */
  isReplaying(): boolean {
    return this.replayBookmark !== null;
  },

  /** Springt zum Anfang einer ABGESCHLOSSENEN Quest und merkt den Live-Stand als
   *  Lesezeichen (RAM). Gibt `false` zurück (und lässt den Stand unangetastet),
   *  wenn die Quest nicht existiert, nicht abgeschlossen ist oder bereits ein
   *  Wiederspiel läuft (erst beenden). Unabhängig vom `repeatable`-Flag. */
  startReplay(questIdx: number): boolean {
    if (this.isReplaying()) return false;
    const quest = KQContent.QUESTS[questIdx];
    if (!quest) return false;
    if (!this.state.completedQuests.includes(quest.id)) return false;

    // Aktuellen Live-Cluster in den Stand falten, dann komplett klonen = Lesezeichen.
    this.state.clusterSnapshot = this.sim.snapshot();
    this.replayBookmark = cloneState(this.state);
    // Ab jetzt schreibt save() nicht mehr in den Store (Guard in game/save.ts).
    // jumpToQuest mutiert Stand + Cluster live; sein save(false) läuft dadurch leer.
    this.jumpToQuest(questIdx);
    return true;
  },

  /** Beendet das Wiederspiel: stellt das Lesezeichen 1:1 wieder her (Position +
   *  questIdx + questStep + completedQuests + Cluster …) und persistiert EINMAL.
   *  Man landet exakt an der gemerkten Live-Position. `false`, wenn gar kein
   *  Wiederspiel lief. */
  endReplay(): boolean {
    const bm = this.replayBookmark;
    if (!bm) return false;
    this.replayBookmark = null;                       // Guard lösen, BEVOR save() wieder schreibt
    this.state = cloneState(bm);
    this.sim = new KQSim(this.state.clusterSnapshot || {});
    // save(false): die gemerkte Live-Position NICHT von der noch lebenden Replay-Szene
    // überschreiben lassen (gleiche Falle wie jumpToQuest, #335/#295).
    this.save(false);
    return true;
  },
});

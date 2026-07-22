/* Dirty-gegateter, debounced Autosave (#869, Anwendungsschicht, Phaser-frei).
 * Ersetzt den blinden 5-s-Vollserialisierungs-Autosave (früher `setInterval(() => Game.save(), 5000)`
 * in main.ts): Der GameState mutiert praktisch JEDEN Frame (`gameDays` in advanceClock, gelegentlich
 * `coins` in economyTick) – ein reiner Inhalts-Diff wäre darum fast immer „dirty" und würde die
 * Serialisierungskosten, die dieses Ticket gerade vermeiden soll, selbst verursachen. Stattdessen
 * prüft `shouldAutosave` nur BILLIGE Skalare (Cluster-Revision, Münzstand, Live-Spielerposition) –
 * keine Serialisierung zum Prüfen nötig.
 *
 * Die diskreten, wichtigen Mutationen (addXp/addCoins/buy/…) rufen `save()` weiterhin selbst sofort
 * auf; die Baseline dafür pflegt `save()` an EINER Stelle (game/save.ts, SSOT), damit der Scheduler
 * danach nicht doppelt speichert. Die Ceiling deckt Fälle ab, in denen NUR die kontinuierlich
 * driftende Spiel-Uhr (`gameDays`) fortgeschritten ist – die ist bewusst KEIN Dirty-Signal (rein
 * kosmetisch, self-healt beim nächsten Laden über die Offline-Einnahmen), soll aber nicht beliebig
 * lange ungesichert bleiben. */
import { worldScene } from "../runtime";
import { part, type AutosaveBaseline, type AutosaveSignals } from "./shared";

export interface AutosaveConfig {
  /** Erzwingt ein Speichern spätestens nach dieser Zeit ohne Sicherung (Ceiling, ms) – auch ohne
   *  Dirty-Signal (deckt die kosmetisch driftende Spiel-Uhr ab). */
  maxIntervalMs: number;
  /** Settle-Verzögerung (ms) nach der ERSTEN erkannten Änderung, bevor gespeichert wird (Debounce);
   *  koalesziert mehrere Änderungen kurz hintereinander (z.B. mehrere Terminal-Befehle) in EIN
   *  Speichern. 0 = beim nächsten Tick sofort. */
  debounceMs: number;
}

/** Produktions-Konfiguration: 5 Minuten Ceiling (die Spiel-Uhr driftet sonst zu lange unsichtbar
 *  ungespeichert), 1 s Debounce (koalesziert Bursts, ohne gegenüber dem alten 5-s-Takt spürbar an
 *  Latenz zu verlieren). Bewusst konservativ gewählt (kein Datenverlust-Risiko) – siehe #869. */
export const AUTOSAVE_CONFIG: AutosaveConfig = { maxIntervalMs: 5 * 60 * 1000, debounceMs: 1000 };

/** Kadenz, mit der `autosaveTick` aus main.ts gerufen wird. Die PRÜFUNG selbst ist billig (nur
 *  Skalar-Vergleiche, keine Serialisierung) – ein enger Takt kostet darum praktisch nichts. */
export const AUTOSAVE_CHECK_MS = 1000;

/** Hat sich seit der Baseline etwas geändert, das eine Sicherung rechtfertigt? */
function isDirty(signals: AutosaveSignals, baseline: AutosaveBaseline): boolean {
  return signals.rev !== baseline.rev
    || signals.coins !== baseline.coins
    || signals.playerX !== baseline.playerX
    || signals.playerY !== baseline.playerY;
}

/** Reine Entscheidung: soll JETZT gespeichert werden?
 *  - dirty (Signale weichen von der Baseline ab) UND seit `pendingSince` mindestens `debounceMs`
 *    vergangen (Settle) → ja.
 *  - sonst, wenn seit der letzten Sicherung (`baseline.savedAt`) `maxIntervalMs` vergangen ist
 *    (Ceiling) → ja.
 *  - sonst → nein.
 * `pendingSince` ist der Zeitpunkt, seit dem der aktuelle Dirty-Zustand ansteht (null = gerade erst
 * erkannt); der Aufrufer (`autosaveTick`) pflegt ihn zwischen den Ticks. */
export function shouldAutosave(
  signals: AutosaveSignals,
  baseline: AutosaveBaseline,
  pendingSince: number | null,
  now: number,
  cfg: AutosaveConfig,
): boolean {
  if (isDirty(signals, baseline)) {
    return now - (pendingSince ?? now) >= cfg.debounceMs;
  }
  return now - baseline.savedAt >= cfg.maxIntervalMs;
}

/** Aktuelle Signale aus dem laufenden Zustand lesen. Die Spielerposition kommt bewusst aus der
 *  LIVE-WorldScene (nicht aus `state.player`, das nur `save()` selbst schreibt – sonst wäre das
 *  Signal zirkulär und nie „dirty"). Ohne laufende Szene (Boot, Region ohne Spielerreferenz) → null,
 *  kein Crash. */
function currentSignals(coins: number, rev: number): AutosaveSignals {
  const ws = worldScene();
  return {
    rev,
    coins,
    playerX: ws?.player ? ws.player.x : null,
    playerY: ws?.player ? ws.player.y : null,
  };
}

/** Autosave-Bündel der Game-Fassade (#869). */
export const autosaveBundle = part({
  /** Regelmäßig (aus main.ts) gerufen: prüft billige Skalare und speichert nur, wenn nötig
   *  (Dirty-Gate + Debounce) oder die Ceiling erreicht ist. */
  autosaveTick(now: number) {
    const signals = currentSignals(this.state.coins, this.sim.rev);
    if (isDirty(signals, this.autosaveBaseline)) {
      if (this.autosavePendingSince === null) this.autosavePendingSince = now;
    } else {
      this.autosavePendingSince = null;
    }
    if (shouldAutosave(signals, this.autosaveBaseline, this.autosavePendingSince, now, AUTOSAVE_CONFIG)) {
      this.save();
    }
  },

  /** Erzwingt ein sofortiges Sichern OHNE Debounce (Tab-Wechsel/Schließen, #869) – das
   *  Sicherheitsnetz gegen die Settle-Verzögerung des normalen Autosave-Takts. */
  autosaveFlush() {
    this.save();
  },
});

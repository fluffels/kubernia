/* Tests für den dirty-gegateten, debounced Autosave (#869): erst die reine Entscheidungsfunktion
 * shouldAutosave() isoliert (kein Game-Stack nötig), dann ein Integrationstest über die komponierte
 * Game-Fassade (SaveStore.writeState-Spy), der beweist, dass ein Idle-Tick NICHT mehr serialisiert,
 * während ein echter Zustandswechsel (Cluster-Befehl) weiterhin gesichert wird und die diskreten
 * Sofort-Saves (addCoins) den Scheduler nicht zu einem Doppel-Save verleiten. */
import { test, expect, describe, beforeAll, beforeEach, vi } from "vitest";
import { stubWindowLocalStorage, loadGameStack } from "./support/browser-env";
import { shouldAutosave, AUTOSAVE_CONFIG, type AutosaveConfig } from "../src/game/autosave";
import type { AutosaveBaseline } from "../src/game/shared";

describe("shouldAutosave (reine Entscheidung, kein Game-Stack)", () => {
  const cfg: AutosaveConfig = { maxIntervalMs: 10_000, debounceMs: 2_000 };
  const baseline: AutosaveBaseline = { rev: 1, coins: 40, playerX: 100, playerY: 200, savedAt: 1_000 };
  const unchanged = { rev: 1, coins: 40, playerX: 100, playerY: 200 };

  test("unverändert & Ceiling nicht erreicht -> kein Speichern", () => {
    expect(shouldAutosave(unchanged, baseline, null, 5_000, cfg)).toBe(false);
  });

  test("Cluster-Revision geändert -> dirty, aber erst nach Ablauf des Debounce-Fensters", () => {
    const signals = { ...unchanged, rev: 2 };
    expect(shouldAutosave(signals, baseline, 5_000, 6_000, cfg)).toBe(false); // erst 1s seit pendingSince
    expect(shouldAutosave(signals, baseline, 5_000, 7_000, cfg)).toBe(true);  // genau 2s (debounceMs) erreicht
  });

  test("Münzstand geändert -> dirty", () => {
    const signals = { ...unchanged, coins: 99 };
    expect(shouldAutosave(signals, baseline, 5_000, 7_000, cfg)).toBe(true);
  });

  test("Spielerposition geändert -> dirty", () => {
    const signals = { ...unchanged, playerX: 150 };
    expect(shouldAutosave(signals, baseline, 5_000, 7_000, cfg)).toBe(true);
  });

  test("pendingSince=null (gerade erst dirty) mit debounceMs=0 -> sofort speichern", () => {
    const zero: AutosaveConfig = { maxIntervalMs: 10_000, debounceMs: 0 };
    const signals = { ...unchanged, rev: 2 };
    expect(shouldAutosave(signals, baseline, null, 1_000, zero)).toBe(true);
  });

  test("unverändert, aber Ceiling GENAU erreicht -> trotzdem speichern (z.B. für die driftende Spiel-Uhr)", () => {
    expect(shouldAutosave(unchanged, baseline, null, baseline.savedAt + cfg.maxIntervalMs, cfg)).toBe(true);
  });

  test("unverändert, knapp UNTER der Ceiling -> noch kein Speichern", () => {
    expect(shouldAutosave(unchanged, baseline, null, baseline.savedAt + cfg.maxIntervalMs - 1, cfg)).toBe(false);
  });
});

describe("autosaveTick / autosaveFlush (Integration über die Game-Fassade)", () => {
  let Game: typeof import("../src/game").Game;
  let Sim: typeof import("../src/sim").Sim;
  let SaveStore: typeof import("../src/store").SaveStore;

  beforeAll(async () => {
    stubWindowLocalStorage();
    ({ Game, Sim, SaveStore } = await loadGameStack());
  });

  beforeEach(() => {
    Game.reset();
    Game.sim = new Sim({});
    Game.save(); // Baseline explizit synchronisieren (reset() pflegt sie bewusst nicht, s. save.ts)
  });

  test("autosaveTick ohne jede Änderung schreibt NICHT erneut (Idle-Fall, Kern des Tickets)", () => {
    const spy = vi.spyOn(SaveStore, "writeState");
    const now = Date.now();
    Game.autosaveTick(now);
    Game.autosaveTick(now + 500);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  test("autosaveTick speichert nach einem Cluster-Befehl (rev-Bump), aber erst nach Ablauf des Debounce", () => {
    const spy = vi.spyOn(SaveStore, "writeState");
    Game.sim.touch(); // #523: externe Rev-Erhöhung, wie bei Zufalls-Gefahren
    const now = Date.now();
    Game.autosaveTick(now);              // dirty erkannt, Debounce (1s) noch nicht abgelaufen
    expect(spy).not.toHaveBeenCalled();
    Game.autosaveTick(now + AUTOSAVE_CONFIG.debounceMs + 500); // Debounce abgelaufen
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  test("addCoins (Sofort-Save) aktualisiert die Baseline; ein direkt folgender Tick speichert NICHT erneut", () => {
    Game.addCoins(5); // ruft intern bereits this.save() -> Baseline ist danach „clean"
    const spy = vi.spyOn(SaveStore, "writeState");
    Game.autosaveTick(Date.now() + 10);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  test("autosaveFlush speichert sofort, auch innerhalb des Debounce-Fensters (Tab-Wechsel/Schließen)", () => {
    Game.sim.touch();
    const spy = vi.spyOn(SaveStore, "writeState");
    Game.autosaveFlush();
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  test("autosaveTick ohne laufende WorldScene wirft nicht (Player-Signal bleibt neutral)", () => {
    // Kein setWorldScene() in diesem Test -> worldScene() liefert null (Boot-/Region-Fall).
    expect(() => Game.autosaveTick(Date.now())).not.toThrow();
  });
});

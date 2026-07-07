/* Wunschzustand-Minispiel „Self-Heal/Drift" (#570): Domänen-Tests für den Reconcile-Kern. */
import { test, expect, describe } from "vitest";
import {
  DRIFT_HEAL_ROUNDS,
  startState,
  applyDriftEvent,
  applyImperativeFix,
  applyDeclarativeFix,
  isSynced,
  resolveChoice,
  type DriftEvent,
  type DriftHealRound,
} from "../src/content/driftheal";

const round = (desired: number, driftEvents: DriftEvent[] = [{ label: "Drift", delta: -1 }]): DriftHealRound => ({
  name: "Testrunde",
  desired,
  driftEvents,
  imperativeLabel: "imperativ",
  declarativeLabel: "deklarativ",
  tip: "Tipp",
});

describe("startState", () => {
  test("Runden-Start: Ist == Soll, Loop noch AUS", () => {
    expect(startState(round(3))).toEqual({ current: 3, enforced: false });
  });
});

describe("applyDriftEvent", () => {
  test("ohne Loop schlägt das Ereignis durch: Ist weicht um delta vom Soll ab", () => {
    const r = round(3);
    const drifted = applyDriftEvent(startState(r), r.driftEvents[0], r);
    expect(drifted).toEqual({ current: 2, enforced: false });
  });

  test("mit laufendem Loop (enforced) heilt der Cluster sofort selbst – kein Einbruch", () => {
    const r = round(3);
    const enforced = { current: 3, enforced: true };
    expect(applyDriftEvent(enforced, r.driftEvents[0], r)).toEqual({ current: 3, enforced: true });
  });

  test("Red-Green-Kontrolle: enforced==true unterscheidet sich wirklich vom Nicht-Loop-Fall (sonst gäbe es hier keinen Unterschied)", () => {
    const r = round(3);
    const notEnforced = applyDriftEvent({ current: 3, enforced: false }, r.driftEvents[0], r);
    const enforced = applyDriftEvent({ current: 3, enforced: true }, r.driftEvents[0], r);
    expect(notEnforced.current).not.toBe(enforced.current);
  });
});

describe("applyImperativeFix / applyDeclarativeFix", () => {
  test("imperativ behebt das Symptom (Ist == Soll), aber der Loop bleibt AUS", () => {
    const r = round(3);
    expect(applyImperativeFix({ current: 1, enforced: false }, r)).toEqual({ current: 3, enforced: false });
  });

  test("deklarativ behebt das Symptom UND schaltet den Loop EIN", () => {
    const r = round(3);
    expect(applyDeclarativeFix({ current: 1, enforced: false }, r)).toEqual({ current: 3, enforced: true });
  });
});

describe("isSynced", () => {
  test("Ist == Soll -> true", () => expect(isSynced({ current: 3, enforced: false }, round(3))).toBe(true));
  test("Ist != Soll -> false", () => expect(isSynced({ current: 2, enforced: false }, round(3))).toBe(false));
});

describe("resolveChoice (#570-Kernfall: hält imperativ NICHT gegen erneuten Drift?)", () => {
  test("deklarativ: hält – Ist bleibt beim Soll UND der Loop ist an", () => {
    const r = round(3);
    const result = resolveChoice(startState(r), r.driftEvents[0], r, "declarative");
    expect(result).toEqual({ current: 3, enforced: true });
    expect(isSynced(result, r)).toBe(true);
  });

  test("imperativ: hält NICHT – derselbe Drift schlägt sofort wieder zu, Ist sinkt erneut unter Soll", () => {
    const r = round(3);
    const result = resolveChoice(startState(r), r.driftEvents[0], r, "imperative");
    expect(result).toEqual({ current: 2, enforced: false });
    expect(isSynced(result, r)).toBe(false);
  });

  test("Red-Green-Kontrolle: ohne die Unterscheidung imperativ/deklarativ wären beide Ergebnisse synced (Test würde den Unterschied nicht fangen)", () => {
    const r = round(3);
    const declarative = resolveChoice(startState(r), r.driftEvents[0], r, "declarative");
    const imperative = resolveChoice(startState(r), r.driftEvents[0], r, "imperative");
    expect(isSynced(declarative, r)).toBe(true);
    expect(isSynced(imperative, r)).toBe(false);
  });

  test("nach deklarativ hält auch ein ZWEITES Drift-Ereignis (Loop bleibt an) – die eigentliche Self-Heal-Lektion", () => {
    const r = round(4, [{ label: "erster Drift", delta: -1 }, { label: "zweiter Drift", delta: -1 }]);
    const afterFirst = resolveChoice(startState(r), r.driftEvents[0], r, "declarative");
    const afterSecond = applyDriftEvent(afterFirst, r.driftEvents[1], r);
    expect(isSynced(afterSecond, r)).toBe(true);
    expect(afterSecond.enforced).toBe(true);
  });

  test("nach imperativ trifft ein ZWEITES Drift-Ereignis erneut ungebremst (Loop war nie an)", () => {
    const r = round(4, [{ label: "erster Drift", delta: -1 }, { label: "zweiter Drift", delta: -1 }]);
    const afterFirst = resolveChoice(startState(r), r.driftEvents[0], r, "imperative");
    expect(isSynced(afterFirst, r)).toBe(false);
  });
});

describe("DRIFT_HEAL_ROUNDS (Content)", () => {
  test("mindestens 2 Runden, jede mit Soll > 0, mindestens einem Drift-Ereignis und einer Lektion", () => {
    expect(DRIFT_HEAL_ROUNDS.length).toBeGreaterThanOrEqual(2);
    for (const r of DRIFT_HEAL_ROUNDS) {
      expect(r.desired).toBeGreaterThan(0);
      expect(r.driftEvents.length).toBeGreaterThanOrEqual(1);
      for (const e of r.driftEvents) expect(e.delta).toBeLessThan(0);
      expect(r.tip.trim().length).toBeGreaterThan(0);
      expect(r.imperativeLabel.trim().length).toBeGreaterThan(0);
      expect(r.declarativeLabel.trim().length).toBeGreaterThan(0);
    }
  });

  test("Schwierigkeit steigt: die Zahl der Drift-Ereignisse je Runde ist nie absteigend", () => {
    for (let i = 1; i < DRIFT_HEAL_ROUNDS.length; i++) {
      expect(DRIFT_HEAL_ROUNDS[i].driftEvents.length).toBeGreaterThanOrEqual(DRIFT_HEAL_ROUNDS[i - 1].driftEvents.length);
    }
  });

  test("erste Runde hat genau EIN Ereignis (Self-Heal-Einstieg), eine spätere Runde mehrere (GitOps-Drift-Wiederholung)", () => {
    expect(DRIFT_HEAL_ROUNDS[0].driftEvents.length).toBe(1);
    expect(DRIFT_HEAL_ROUNDS.some((r) => r.driftEvents.length > 1)).toBe(true);
  });

  test("jede Runde ist tatsächlich spielbar: durchgängig deklarativ gewählt endet synced UND enforced", () => {
    for (const r of DRIFT_HEAL_ROUNDS) {
      let state = startState(r);
      for (let i = 0; i < r.driftEvents.length; i++) {
        state = applyDriftEvent(state, r.driftEvents[i], r);
        if (!isSynced(state, r)) state = resolveChoice(state, r.driftEvents[i], r, "declarative");
      }
      expect(isSynced(state, r), `Runde „${r.name}": endet nicht synced`).toBe(true);
      expect(state.enforced, `Runde „${r.name}": Loop ist am Ende nicht aktiv`).toBe(true);
    }
  });
});

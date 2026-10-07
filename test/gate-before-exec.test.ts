/* Integration #1297: das Abkürzungs-Gating greift VOR sim.exec. Echter Content + echte Sim:
 * ein gesperrter Befehl lässt den Cluster-Zustand unverändert (kein Container, keine Sackgasse). */
import { test, expect } from "vitest";
import { execUnlessLocked, evaluateSubmission } from "../src/hud/viewdecide";
import { freshSim } from "./factories/sim";
import { findQuestTask } from "./factories/quest-task";

const locked = { isAbbrevUnlocked: () => false };
const open = { isAbbrevUnlocked: () => true };

function prepared(id: string) {
  const { task, scenarios } = findQuestTask(id);
  const sim = freshSim();
  for (const sc of scenarios) sim.mergeScenario(sc);
  return { task, sim };
}
const state = (sim: ReturnType<typeof freshSim>) => JSON.stringify({ s: sim.snapshot(), c: sim.clock, r: sim.rev });
const hasContainer = (sim: ReturnType<typeof freshSim>, name: string) =>
  JSON.stringify(sim.snapshot()).includes(`"${name}"`);

test("Bo t-run-named: gesperrtes -d wird nicht ausgeführt, Zustand unverändert", () => {
  const { task, sim } = prepared("t-run-named");
  const before = state(sim);
  const cmd = "docker run -d --name webserver nginx";
  const r = execUnlessLocked(cmd, task, locked, () => sim.exec(cmd));
  expect("locked" in r).toBe(true);
  expect(state(sim)).toBe(before);
  expect(hasContainer(sim, "webserver")).toBe(false);
});

test("Sackgassen-Regression: danach löst die Langform den Schritt", () => {
  const { task, sim } = prepared("t-run-named");
  const bad = "docker run -d --name webserver nginx";
  execUnlessLocked(bad, task, locked, () => sim.exec(bad));
  const good = "docker run --detach --name webserver nginx";
  const r = execUnlessLocked(good, task, locked, () => sim.exec(good));
  expect("result" in r).toBe(true);
  const result = "result" in r ? r.result : { error: true };
  const v = evaluateSubmission(good, task, {
    ...locked,
    simError: !!result.error,
    checkOk: !task.check || !!task.check(sim),
    failCount: 0,
  });
  expect(v.outcome).toBe("solved");
});

test("Red-Green: mit freigeschaltetem -d läuft der Befehl und erzeugt den Container", () => {
  const { task, sim } = prepared("t-run-named");
  const cmd = "docker run -d --name webserver nginx";
  const r = execUnlessLocked(cmd, task, open, () => sim.exec(cmd));
  expect("result" in r).toBe(true);
  expect(hasContainer(sim, "webserver")).toBe(true);
});

test("Modus check (t-j24-3): gesperrtes -n sperrt vor dem Ausführen", () => {
  const { task, sim } = prepared("t-j24-3");
  expect(task.solvedBy).toBe("check");
  const before = state(sim);
  const cmd = "kubectl expose deployment kombuese --port=80 -n default";
  const r = execUnlessLocked(cmd, task, locked, () => sim.exec(cmd));
  expect("locked" in r).toBe(true);
  expect(state(sim)).toBe(before);
  expect(sim.services.some((s) => s.name === "kombuese")).toBe(false);
});

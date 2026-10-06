/* Integration #891: echte Quest-Aufgabe (juno/t-j24-3, Modus solvedBy: "check") + echte Sim +
 * evaluateSubmission. Beweist, dass ein alternativer gültiger Weg zählt und dass der Modus
 * (nicht etwas anderes) dafür verantwortlich ist (Red-Green über solvedBy: undefined). */
import { test, expect } from "vitest";
import { KQContent } from "../src/content";
import { evaluateSubmission, type SubmissionContext, type SubmissionTask } from "../src/hud/viewdecide";
import { freshSim } from "./factories/sim";
import type { QuestTask } from "../src/types";
import type { Scenario } from "../src/sim/state";

/** Aufgabe + die Szenarien der Quest-Schritte bis zu ihr (der Weltzustand, den der Schritt vorfindet). */
function findTask(id: string): { task: QuestTask; scenarios: Scenario[] } {
  for (const q of KQContent.QUESTS) {
    const scenarios: Scenario[] = [];
    for (const step of q.steps) {
      if (step.scenario) scenarios.push(step.scenario);
      if (step.type !== "terminal") continue;
      const task = step.tasks.find(t => t.id === id);
      if (task) return { task, scenarios };
    }
  }
  throw new Error("Aufgabe nicht gefunden: " + id);
}

const ctx = (over: Partial<SubmissionContext>): SubmissionContext => ({
  simError: false,
  checkOk: false,
  isAbbrevUnlocked: () => true,
  failCount: 0,
  ...over,
});

function submit(input: string, task: SubmissionTask) {
  const { task: real, scenarios } = findTask("t-j24-3");
  const sim = freshSim();
  for (const sc of scenarios) sim.mergeScenario(sc);
  const result = sim.exec(input);
  const checkOk = !real.check || Boolean(real.check(sim));
  return evaluateSubmission(input, task, ctx({ simError: Boolean(result.error), checkOk }));
}

test("t-j24-3: alternativer Weg (deployment/kombuese) löst im Modus check", () => {
  const { task } = findTask("t-j24-3");
  expect(task.solvedBy).toBe("check");
  const alt = "kubectl expose deployment/kombuese --port=80";
  expect(task.accept.some(re => re.test(alt))).toBe(false); // accept kennt den Weg nicht
  expect(submit(alt, task).outcome).toBe("solved");
  // Red-Green: ohne den Modus wäre derselbe Weg falsch.
  expect(submit(alt, { ...task, solvedBy: undefined }).outcome).toBe("failed");
});

test("t-j24-3: falscher Port erreicht das Ziel nicht → failed", () => {
  const { task } = findTask("t-j24-3");
  expect(submit("kubectl expose deployment kombuese --port=9999", task).outcome).toBe("failed");
});

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

function submit(input: string, task: SubmissionTask, prepare?: (sim: ReturnType<typeof freshSim>) => void) {
  const { task: real, scenarios } = findTask("t-j24-3");
  const sim = freshSim();
  for (const sc of scenarios) sim.mergeScenario(sc);
  prepare?.(sim);
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

const svcYaml = (port: number) => `apiVersion: v1
kind: Service
metadata:
  name: kombuese
spec:
  ports:
    - port: ${port}
`;

test("t-j24-3: gleicher Zielzustand über zwei Wege wird gleich bewertet (#1296)", () => {
  const { task: real, scenarios } = findTask("t-j24-3");
  const portOf = (sim: ReturnType<typeof freshSim>) => sim.services.find(s => s.name === "kombuese")?.port;
  const run = (input: string, prepare?: (sim: ReturnType<typeof freshSim>) => void) => {
    const sim = freshSim();
    for (const sc of scenarios) sim.mergeScenario(sc);
    prepare?.(sim);
    const result = sim.exec(input);
    return { sim, result };
  };
  // Weg A: expose → Port als String
  const a = run("kubectl expose deployment kombuese --port=80");
  // Vorbedingung des Repros; normalisiert die Sim später selbst, darf sie entfallen
  expect(typeof portOf(a.sim)).toBe("string");
  expect(real.check?.(a.sim)).toBe(true);
  // Weg B: apply -f Manifest → Port als Zahl
  const b = run("kubectl apply -f kombuese-svc.yaml", sim => { sim.files["kombuese-svc.yaml"] = svcYaml(80); });
  expect(b.result.error).toBeFalsy();
  // Vorbedingung des Repros; normalisiert die Sim später selbst, darf sie entfallen
  expect(typeof portOf(b.sim)).toBe("number");
  expect(real.check?.(b.sim)).toBe(true);
  expect(submit("kubectl apply -f kombuese-svc.yaml", real, sim => { sim.files["kombuese-svc.yaml"] = svcYaml(80); }).outcome).toBe("solved");
  // Negativ: falscher Port im Manifest
  expect(submit("kubectl apply -f kombuese-svc.yaml", real, sim => { sim.files["kombuese-svc.yaml"] = svcYaml(81); }).outcome).toBe("failed");
});

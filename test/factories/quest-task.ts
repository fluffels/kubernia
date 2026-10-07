/* Test-Factory: eine echte Quest-Aufgabe (Content) samt den Szenarien der Schritte bis zu ihr,
 * also dem Weltzustand, den der Schritt vorfindet. Deckt terminal- UND teach-Schritte ab,
 * wie `Game.stepTasks`. */
import { KQContent } from "../../src/content";
import type { QuestTask } from "../../src/types";
import type { Scenario } from "../../src/sim/state";

export function findQuestTask(id: string): { task: QuestTask; scenarios: Scenario[] } {
  for (const q of KQContent.QUESTS) {
    const scenarios: Scenario[] = [];
    for (const step of q.steps) {
      if (step.scenario) scenarios.push(step.scenario);
      const tasks = step.type === "terminal" ? step.tasks : step.type === "teach" ? [step.cmd] : [];
      const task = tasks.find((t) => t.id === id);
      if (task) return { task, scenarios };
    }
  }
  throw new Error("Aufgabe nicht gefunden: " + id);
}

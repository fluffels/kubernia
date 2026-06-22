/* Durchspiel-Test: spielt ALLE Quest-Schritte (teach/drill/terminal) in
 * Story-Reihenfolge gegen eine dauerhafte Welt – wie im echten Spiel.
 * Ausführen mit:  node --test test/
 */
import { test } from "vitest";
import assert from "node:assert/strict";
import { Sim as KQSim } from "../src/sim";
import { KQContent } from "../src/content";

function resolvePlaceholder(cmd: string, sim: KQSim) {
  if (!cmd.includes("<")) return cmd;
  const findPod = (prefix: string) => {
    const dep = sim.deployments.find(d => d.name === prefix) || sim.deployments[0];
    return dep.pods[0].name;
  };
  if (/leuchtfeuer/.test(cmd)) return cmd.replace(/<[^>]+>/, findPod("leuchtfeuer"));
  if (/funkboje/.test(cmd)) return cmd.replace(/<[^>]+>/, findPod("funkboje"));
  if (/frachtplaner/.test(cmd)) return cmd.replace(/<[^>]+>/, findPod("frachtplaner"));
  if (/kombuese/.test(cmd)) return cmd.replace(/<[^>]+>/, findPod("kombuese"));
  if (/kartograf/.test(cmd)) return cmd.replace(/<[^>]+>/, findPod("kartograf"));
  if (/signalgeber/.test(cmd)) return cmd.replace(/<[^>]+>/, findPod("signalgeber"));
  if (/bakenbote/.test(cmd)) return cmd.replace(/<[^>]+>/, findPod("bakenbote"));
  if (/wachposten/.test(cmd)) return cmd.replace(/<[^>]+>/, findPod("wachposten"));
  if (/describe/.test(cmd)) return cmd.replace(/<[^>]+>/, findPod("kantine"));
  if (/delete pod/.test(cmd)) return cmd.replace(/<[^>]+>/, findPod("kasse"));
  if (/docker stop/.test(cmd)) {
    const c = sim.docker.containers.find(c => c.running);
    return cmd.replace(/<[^>]+>/, c ? c.name : "fehlt");
  }
  return cmd;
}

/** Gemeinsamer Nenner aus Teach-Befehl, Terminal-Aufgabe und Drill-Aufgabe –
 *  genau die Felder, die runTask braucht (check ist nur bei Quest-Aufgaben da). */
type RunnableTask = { accept: RegExp[]; solution: string; check?: (sim: KQSim) => unknown };

function runTask(sim: KQSim, task: RunnableTask, label: string) {
  const cmd = resolvePlaceholder(task.solution, sim);
  const norm = cmd.trim().replace(/\s+/g, " ");
  const result = sim.exec(cmd);
  assert.ok(task.accept.some((re: RegExp) => re.test(norm)), label + ": Lösung matcht Regex nicht: " + norm);
  assert.ok(!result.error, label + ": Simulator-Fehler: " + result.output);
  assert.ok(!task.check || task.check(sim), label + ": check() nicht erfüllt");
}

test("Komplette Story ist mit den Musterlösungen durchspielbar", () => {
  const sim = new KQSim({});
  for (const quest of KQContent.QUESTS) {
    for (const step of quest.steps) {
      if (step.scenario) sim.mergeScenario(step.scenario);
      if (step.type === "teach") {
        runTask(sim, step.cmd, quest.id + "/" + step.cmd.id);
      } else if (step.type === "terminal") {
        for (const task of step.tasks) runTask(sim, task, quest.id + "/" + task.id);
      } else if (step.type === "drill") {
        for (let i = 0; i < step.count; i++) {
          const drillId = step.pool[i % step.pool.length];
          runTask(sim, KQContent.DRILLS[drillId](sim), quest.id + "/drill:" + drillId);
        }
      }
    }
  }
});

test("Alle Drill-Generatoren liefern lösbare Zufallsaufgaben (je 5x)", () => {
  const sim = new KQSim({});
  sim.exec("kubectl create deployment kantine --image=nginx");
  for (const [id, gen] of Object.entries(KQContent.DRILLS)) {
    for (let i = 0; i < 5; i++) {
      const task = gen(sim);
      assert.ok(task.text && task.hint && task.solution, "Drill " + id + ": Felder fehlen");
      runTask(sim, task, "DRILL " + id + " #" + i);
    }
  }
});

test("Sturm-Szenario: Buchstabendreher-Image lässt sich immer heilen", () => {
  // simuliert, was das Sturm-Event im Spiel anrichtet
  for (const img of ["nginx", "redis", "httpd", "postgres", "rabbitmq", "aa", "abba"]) {
    const sim = new KQSim({});
    sim.exec("kubectl create deployment app --image=" + img);
    const dep = sim.deployments[0];
    const bad = KQContent.corruptImage(img);
    dep.broken = { type: "imagepull", badImage: bad };
    dep.image = bad;
    assert.notEqual(bad, img, img + ": der Buchstabendreher verändert den Namen wirklich");
    sim.exec("kubectl set image deployment/app app=" + img);
    assert.equal(dep.broken, null, img + ": Heilung klappt");
  }
});

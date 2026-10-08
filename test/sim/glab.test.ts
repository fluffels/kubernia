/* Unit-Tests: glab/CI-Familie (sim/glab.ts) – Teil des sim.test.ts-Splits (#383).
 * Diese Tests bauen ihren eigenen push-bereiten Simulator (ciSim) und nutzen daher
 * NICHT das geteilte beforeEach. Fahren über sim.exec("git push")/("glab ci …"). */
import { test } from "vitest";
import assert from "node:assert/strict";
import { KQSim } from "./helpers";

/* ===================== glab / CI-Pipeline (#385, sim/glab.ts) ===================== */
// Ein push-bereites Repo MIT .gitlab-ci.yml + ciDeploy auf dem gewünschten Branch.
// Daraus löst 'git push' die Pipeline aus (runPipeline), die wir dann via glab prüfen.
function ciSim(branch: string): KQSim {
  return new KQSim({
    gitInitialized: true,
    gitBranch: branch,
    gitBranches: ["main", branch].filter((b, i, a) => a.indexOf(b) === i),
    gitCommits: [{ hash: "c0ffee0", msg: "init", branch, files: ["app.txt"] }],
    files: { ".gitlab-ci.yml": "stages: [build, test, deploy]" },
    ciDeploy: { name: "funkdienst", image: "nginx", replicas: 2 },
  });
}

test("#385 glab/CI: push auf main startet die Pipeline und rollt die deploy-Stage aus", () => {
  const s = ciSim("main");
  const push = s.exec("git push");
  assert.ok(!push.error, "push auf main geht durch");
  assert.match(push.output!, /Pipeline #1001/, "die .gitlab-ci.yml startet eine Pipeline");
  // glab ci status zeigt alle drei Stages grün und meldet den Auto-Rollout.
  const status = s.exec("glab ci status");
  assert.match(status.output!, /Pipeline #1001\s+\(Branch main\)/);
  assert.match(status.output!, /passed ✅/);
  for (const stage of ["build", "test", "deploy"]) assert.match(status.output!, new RegExp(stage));
  assert.match(status.output!, /deploy-Stage hat den Dienst automatisch ausgerollt/);
  // Der Beweis: die deploy-Stage hat funkdienst wirklich in den Cluster gerollt.
  assert.ok(s.deployments.some(d => d.name === "funkdienst"), "deploy-Stage hat funkdienst angelegt");
  // glab ci list führt die Pipeline auf.
  const list = s.exec("glab ci list");
  assert.match(list.output!, /#1001/);
  assert.match(list.output!, /main/);
  assert.match(list.output!, /passed/);
});

test("#385 glab/CI: auf einem Feature-Branch wird deploy übersprungen (only: main)", () => {
  const s = ciSim("feature/funk");
  assert.ok(!s.exec("git push").error);
  const status = s.exec("glab ci status").output!;
  assert.match(status, /\(Branch feature\/funk\)/);
  assert.match(status, /deploy übersprungen \('only: main'\)/);
  // Gegenprobe (Red-Green): auf einem Nicht-main-Branch darf NICHTS deployt werden.
  assert.ok(!s.deployments.some(d => d.name === "funkdienst"), "Feature-Branch rollt nichts aus");
});

test("#385 glab/CI: Negativfälle (kein 'ci', keine Pipeline, unbekannte Aktion, leere Liste)", () => {
  const s = ciSim("main");
  // Nur 'glab ci ...' wird unterstützt.
  const noCi = s.exec("glab mr list");
  assert.ok(noCi.error);
  assert.match(noCi.output!, /Nicht simuliert: 'glab mr'/);
  // Vor dem ersten Push gibt es keine Pipeline.
  const noPipe = s.exec("glab ci status");
  assert.ok(noPipe.error);
  assert.match(noPipe.output!, /Keine Pipeline gefunden/);
  // Leere Liste, solange noch nichts lief.
  assert.match(s.exec("glab ci list").output!, /Keine Pipelines/);
  // Unbekannte Unteraktion wird abgefangen.
  const bogus = s.exec("glab ci wackelpudding");
  assert.ok(bogus.error);
  assert.match(bogus.output!, /unbekannter Unterbefehl 'wackelpudding'/);
});

test("#385 glab/CI: ohne .gitlab-ci.yml startet ein push keine Pipeline", () => {
  const s = new KQSim({
    gitInitialized: true,
    gitBranch: "main",
    gitCommits: [{ hash: "c0ffee0", msg: "init", branch: "main", files: ["app.txt"] }],
  });
  const push = s.exec("git push");
  assert.ok(!push.error);
  assert.doesNotMatch(push.output!, /Pipeline/, "ohne .gitlab-ci.yml läuft keine Pipeline");
  assert.match(s.exec("glab ci status").output!, /Keine Pipeline gefunden/);
});

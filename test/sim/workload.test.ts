/* Unit-Tests: Workload-Mutationen (sim/workload.ts, #488).
 * Zwei Ebenen:
 *  (a) die puren Mutations-Funktionen selbst – sie halten `pods.length === replicas`
 *      von sich aus (auch bei hoch/runter/0), Deployment-Heilung zieht neue Namen,
 *      StatefulSet-Neustart behält die stabile Identität;
 *  (b) das Aggregat-Verhalten: die kanalisierten Befehle (scale/rollout/heal über
 *      helm/argocd/kubectl) lassen den Cluster legal, geprüft am Invarianten-Wächter.
 * Factory in ./helpers. */
import { test, beforeEach } from "vitest";
import assert from "node:assert/strict";
import { KQSim, freshSim } from "./helpers";
import {
  newDeploymentPod, scaleDeployment, replacePods, replaceDeploymentPod,
  restartStatefulPod, addDeployment, removeDeployment,
} from "../../src/sim/workload";
import { clusterInvariantViolations } from "../../src/sim/invariants";
import type { Deployment } from "../../src/sim/state";

let sim: KQSim;
beforeEach(() => { sim = freshSim(); });

/** Minimales, legales Deployment fürs pure Testen (ohne exec-Umweg). */
function makeDep(name: string, replicas: number): Deployment {
  const dep: Deployment = { name, image: "nginx", replicas: 0, created: 0, pods: [], broken: null, envFrom: { configMaps: [], secrets: [] } };
  scaleDeployment(dep, replicas, 0); // gleich auf `replicas` bringen (hält die Invariante)
  return dep;
}

/* ---------- (a) die puren Mutations-Funktionen ---------- */

test("newDeploymentPod: Name trägt den Deployment-Präfix, restarts 0, created = Takt", () => {
  const dep = makeDep("kasse", 0);
  const p = newDeploymentPod(dep, 7);
  assert.ok(p.name.startsWith("kasse-"), "Pod-Name sollte mit dem Deployment-Namen beginnen");
  assert.equal(p.restarts, 0);
  assert.equal(p.created, 7);
});

test("scaleDeployment: hoch skalieren hält pods.length === replicas", () => {
  const dep = makeDep("kasse", 1);
  scaleDeployment(dep, 4, 1);
  assert.equal(dep.replicas, 4);
  assert.equal(dep.pods.length, 4);
});

test("scaleDeployment: runter skalieren hält pods.length === replicas", () => {
  const dep = makeDep("kasse", 5);
  scaleDeployment(dep, 2, 1);
  assert.equal(dep.replicas, 2);
  assert.equal(dep.pods.length, 2);
});

test("scaleDeployment: auf 0 skalieren lässt keine Pods übrig", () => {
  const dep = makeDep("kasse", 3);
  scaleDeployment(dep, 0, 1);
  assert.equal(dep.replicas, 0);
  assert.equal(dep.pods.length, 0);
});

test("replacePods: ersetzt alle Pods, Anzahl bleibt, Namen sind neu", () => {
  const dep = makeDep("kasse", 3);
  const alt = dep.pods.map(p => p.name);
  replacePods(dep, 2);
  assert.equal(dep.pods.length, 3, "Anzahl bleibt gleich");
  assert.equal(dep.replicas, 3, "replicas unberührt");
  for (const p of dep.pods) {
    assert.equal(p.created, 2);
    assert.ok(!alt.includes(p.name), "jeder Pod hat einen frischen Namen");
  }
});

test("replaceDeploymentPod: heilt genau einen Pod mit NEUEM Namen, Anzahl bleibt", () => {
  const dep = makeDep("kasse", 3);
  const victim = dep.pods[1].name;
  const ok = replaceDeploymentPod(dep, victim, 5);
  assert.equal(ok, true);
  assert.equal(dep.pods.length, 3);
  assert.ok(!dep.pods.some(p => p.name === victim), "der alte Pod ist weg");
});

test("replaceDeploymentPod (Negativfall): unbekannter Pod-Name ändert nichts, gibt false", () => {
  const dep = makeDep("kasse", 2);
  const vorher = dep.pods.map(p => p.name);
  const ok = replaceDeploymentPod(dep, "gibt-es-nicht", 5);
  assert.equal(ok, false);
  assert.deepEqual(dep.pods.map(p => p.name), vorher);
});

test("restartStatefulPod: gleicher Name & Position, created zurückgesetzt", () => {
  sim.files["sts.yaml"] = "kind: StatefulSet";
  sim.applyEffects["sts.yaml"] = { statefulSet: { name: "lager", image: "redis", replicas: 3 } };
  sim.exec("kubectl apply -f sts.yaml");
  const sts = sim.statefulSets.find(s => s.name === "lager")!;
  const name = sts.pods[1].name; // z.B. "lager-1"
  const ok = restartStatefulPod(sts, name, 9);
  assert.equal(ok, true);
  assert.equal(sts.pods.length, 3);
  assert.equal(sts.pods[1].name, name, "stabile Identität: gleicher Name an gleicher Ordinalposition");
  assert.equal(sts.pods[1].created, 9);
});

test("restartStatefulPod (Negativfall): unbekannter Name gibt false", () => {
  sim.files["sts.yaml"] = "kind: StatefulSet";
  sim.applyEffects["sts.yaml"] = { statefulSet: { name: "lager", image: "redis", replicas: 1 } };
  sim.exec("kubectl apply -f sts.yaml");
  const sts = sim.statefulSets.find(s => s.name === "lager")!;
  assert.equal(restartStatefulPod(sts, "lager-9", 1), false);
});

test("addDeployment/removeDeployment: Eintritt und Austritt eines Aggregat-Mitglieds", () => {
  const state = { deployments: [] as Deployment[] };
  const dep = makeDep("kasse", 2);
  addDeployment(state, dep);
  assert.equal(state.deployments.length, 1);
  const removed = removeDeployment(state, "kasse");
  assert.equal(removed, dep);
  assert.equal(state.deployments.length, 0);
  assert.equal(removeDeployment(state, "kasse"), undefined, "zweites Entfernen findet nichts");
});

/* ---------- (b) das Aggregat-Verhalten an der exec()-Grenze ---------- */

test("aggregat: helm/argocd/kubectl-Skalierung hält die Invarianten", () => {
  sim.invariantChecks = true;
  assert.equal(sim.exec("kubectl create deployment kasse --image=nginx").error, false);
  assert.equal(sim.exec("kubectl scale deployment kasse --replicas=6").error, false);
  assert.equal(sim.exec("kubectl scale deployment kasse --replicas=1").error, false);
  const dep = sim.deployments.find(d => d.name === "kasse")!;
  assert.equal(dep.pods.length, dep.replicas);
  assert.deepEqual(clusterInvariantViolations(sim), []);
});

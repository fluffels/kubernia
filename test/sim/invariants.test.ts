/* Unit-Tests: Cluster-Invarianten (sim/invariants.ts, #478).
 * Zwei Ebenen:
 *  (a) das reine Regel-Modul selbst – grün auf legalen, ROT auf hand-verbogenen
 *      Zuständen (Red-Green-Absicherung: der Wächter fängt echte Verletzungen);
 *  (b) das Aggregat-Verhalten: normale Befehlsfolgen halten die Invarianten, und
 *      eine an exec() vorbei verbogene Verletzung wird an der Grenze laut.
 * Fahren über sim.exec("…"); Factory in ./helpers. */
import { test, beforeEach } from "vitest";
import assert from "node:assert/strict";
import { KQSim, freshSim } from "./helpers";
import { clusterInvariantViolations, assertClusterInvariants, ClusterInvariantError } from "../../src/sim/invariants";

let sim: KQSim;
beforeEach(() => { sim = freshSim(); });

/* ---------- (a) das reine Regel-Modul ---------- */

test("invariants: frischer Cluster ist legal (keine Verletzung)", () => {
  assert.deepEqual(clusterInvariantViolations(sim), []);
  assert.doesNotThrow(() => assertClusterInvariants(sim));
});

test("invariants: ein normal bespielter Cluster bleibt legal", () => {
  sim.exec("kubectl create deployment kasse --image=nginx");
  sim.exec("kubectl scale deployment kasse --replicas=4");
  sim.exec("kubectl expose deployment kasse --port=80");
  assert.deepEqual(clusterInvariantViolations(sim), []);
});

test("invariants (ROT): Deployment mit Replica-Soll ≠ Pod-Anzahl wird erkannt", () => {
  sim.exec("kubectl create deployment kasse --image=nginx");
  const dep = sim.deployments.find(d => d.name === "kasse")!;
  dep.replicas = 3; // Soll verbogen, Pods bleiben bei 1 → illegaler Zustand
  const viol = clusterInvariantViolations(sim);
  assert.equal(viol.length, 1);
  assert.match(viol[0], /Deployment "kasse".*Soll 3.*1 Pod/);
});

test("invariants (ROT): StatefulSet mit Replica-Soll ≠ Pod-Anzahl wird erkannt", () => {
  sim.files["sts.yaml"] = "kind: StatefulSet";
  sim.applyEffects["sts.yaml"] = { statefulSet: { name: "lager", image: "redis", replicas: 2 } };
  sim.exec("kubectl apply -f sts.yaml");
  const sts = sim.statefulSets.find(s => s.name === "lager")!;
  sts.pods.pop(); // ein Pod fehlt → Soll 2, Ist 1
  assert.match(clusterInvariantViolations(sim).join(), /StatefulSet "lager".*Soll 2.*1 Pod/);
});

test("invariants (ROT): Pod an unbekannten Node gepinnt wird erkannt", () => {
  sim.exec("kubectl create deployment kasse --image=nginx");
  const dep = sim.deployments.find(d => d.name === "kasse")!;
  dep.node = "geister-node"; // gibt es nicht in sim.nodes
  assert.match(clusterInvariantViolations(sim).join(), /unbekannten Node "geister-node"/);
});

test("invariants: an einen existierenden Node gepinnter Pod ist legal", () => {
  sim.exec("kubectl create deployment kasse --image=nginx");
  const dep = sim.deployments.find(d => d.name === "kasse")!;
  dep.node = sim.nodes[0].name; // realer Node
  assert.deepEqual(clusterInvariantViolations(sim), []);
});

test("invariants (ROT): PVC Bound ohne Volume wird erkannt", () => {
  // ein Bound-PVC ohne Volume ist ein illegaler Zustand
  sim.pvcs.push({ name: "daten", status: "Bound", volume: "", capacity: "1Gi", storageClass: "", accessModes: "RWO", created: 0 });
  assert.match(clusterInvariantViolations(sim).join(), /PVC "daten".*Bound.*kein Volume/);
});

test("invariants: PVC Pending ohne Volume ist legal (kein passender Speicher)", () => {
  sim.pvcs.push({ name: "wartend", status: "Pending", volume: "", capacity: "1Gi", storageClass: "", accessModes: "RWO", created: 0 });
  assert.deepEqual(clusterInvariantViolations(sim), []);
});

test("invariants (ROT): PV Bound ohne Claim wird erkannt", () => {
  sim.pvs.push({ name: "pv-x", capacity: "1Gi", status: "Bound", claim: "", storageClass: "", accessModes: "RWO", reclaimPolicy: "Retain", created: 0 });
  assert.match(clusterInvariantViolations(sim).join(), /PV "pv-x".*Bound.*ohne Claim/);
});

test("invariants: mehrere gleichzeitige Verletzungen werden alle gemeldet", () => {
  sim.exec("kubectl create deployment a --image=nginx");
  sim.exec("kubectl create deployment b --image=nginx");
  sim.deployments.find(d => d.name === "a")!.replicas = 5;
  sim.deployments.find(d => d.name === "b")!.node = "nirgendwo";
  assert.equal(clusterInvariantViolations(sim).length, 2);
});

test("invariants: ClusterInvariantError trägt die Verletzungsliste", () => {
  sim.deployments.push({ name: "kaputt", image: "x", replicas: 2, created: 0, pods: [], broken: null, envFrom: { configMaps: [], secrets: [] } });
  try {
    assertClusterInvariants(sim);
    assert.fail("hätte werfen müssen");
  } catch (e) {
    assert.ok(e instanceof ClusterInvariantError);
    assert.equal((e as ClusterInvariantError).violations.length, 1);
  }
});

/* ---------- (b) das Aggregat-Verhalten an der exec()-Grenze ---------- */

test("aggregat: eine an exec() vorbei verbogene Verletzung wird an der Grenze laut", () => {
  sim.invariantChecks = true; // in Tests/Dev ohnehin an, hier explizit
  sim.exec("kubectl create deployment kasse --image=nginx");
  // Zustand hinter dem Rücken des Aggregats verbiegen …
  sim.deployments.find(d => d.name === "kasse")!.replicas = 9;
  // … der nächste Befehl (Transaktion) fällt an der Invarianten-Grenze auf:
  const res = sim.exec("kubectl get pods");
  assert.equal(res.error, true);
  assert.match(res.output!, /Invariante/i);
});

test("aggregat: alle normalen kubectl-Lebenszyklus-Befehle halten die Invarianten", () => {
  sim.invariantChecks = true;
  // create → scale hoch → scale runter → delete pod (self-heal) → rollout restart
  assert.equal(sim.exec("kubectl create deployment kasse --image=nginx").error, false);
  assert.equal(sim.exec("kubectl scale deployment kasse --replicas=5").error, false);
  assert.equal(sim.exec("kubectl scale deployment kasse --replicas=2").error, false);
  const victim = sim.deployments.find(d => d.name === "kasse")!.pods[0].name;
  assert.equal(sim.exec("kubectl delete pod " + victim).error, false);
  assert.equal(sim.exec("kubectl rollout restart deployment kasse").error, false);
  assert.deepEqual(clusterInvariantViolations(sim), []);
});

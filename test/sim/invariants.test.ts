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

/* ---------- (6) Namens-Eindeutigkeit je Ressourcentyp (#509) ---------- */

test("invariants (ROT): zwei Deployments mit gleichem Namen werden erkannt", () => {
  sim.exec("kubectl create deployment kasse --image=nginx");
  // ein zweites, gleichnamiges Deployment hinter dem Rücken des Aggregats
  sim.deployments.push({ name: "kasse", image: "redis", replicas: 1, created: 0,
    pods: [], broken: null, envFrom: { configMaps: [], secrets: [] } });
  // (das zweite hat 0 Pods → auch Invariante 1 schlägt an; die Eindeutigkeit muss dabei sein)
  assert.match(clusterInvariantViolations(sim).join(), /Deployment "kasse".*doppelt/);
});

test("invariants (ROT): doppelter Service-Name wird genau EINMAL gemeldet", () => {
  sim.services.push({ name: "web", type: "ClusterIP", clusterIP: "10.0.0.1", port: 80 });
  sim.services.push({ name: "web", type: "ClusterIP", clusterIP: "10.0.0.2", port: 80 });
  const viol = clusterInvariantViolations(sim).filter(m => /Service "web".*doppelt/.test(m));
  assert.equal(viol.length, 1); // ein Duplikat = eine Meldung, nicht pro Vorkommen
});

test("invariants: gleiche Namen über VERSCHIEDENE Ressourcentypen sind legal", () => {
  // ein Deployment "web" und ein Service "web" dürfen koexistieren (je Typ eindeutig)
  sim.exec("kubectl create deployment web --image=nginx");
  sim.exec("kubectl expose deployment web --port=80");
  assert.deepEqual(clusterInvariantViolations(sim), []);
});

/* ---------- (7) Referenzielle Integrität PVC↔PV (#509) ---------- */

test("invariants (ROT): Bound-PVC an ein nicht existierendes Volume wird erkannt", () => {
  sim.pvs.push({ name: "pv-echt", capacity: "1Gi", status: "Available", claim: "", storageClass: "", accessModes: "RWO", reclaimPolicy: "Retain", created: 0 });
  sim.pvcs.push({ name: "daten", status: "Bound", volume: "pv-geist", capacity: "1Gi", storageClass: "", accessModes: "RWO", created: 0 });
  assert.match(clusterInvariantViolations(sim).join(), /PVC "daten".*nicht existierendes Volume "pv-geist"/);
});

test("invariants (ROT): Bound-PV mit Claim auf ein nicht existierendes PVC wird erkannt", () => {
  sim.pvs.push({ name: "pv-x", capacity: "1Gi", status: "Bound", claim: "default/geist", storageClass: "", accessModes: "RWO", reclaimPolicy: "Retain", created: 0 });
  assert.match(clusterInvariantViolations(sim).join(), /PV "pv-x".*nicht existierendes PVC "default\/geist"/);
});

test("invariants: eine konsistente PVC↔PV-Bindung ist legal", () => {
  sim.pvs.push({ name: "pv-1", capacity: "1Gi", status: "Bound", claim: "default/daten", storageClass: "", accessModes: "RWO", reclaimPolicy: "Retain", created: 0 });
  sim.pvcs.push({ name: "daten", status: "Bound", volume: "pv-1", capacity: "1Gi", storageClass: "", accessModes: "RWO", created: 0 });
  assert.deepEqual(clusterInvariantViolations(sim), []);
});

/* ---------- (8) StatefulSet-Ordinalnamen (#509) ---------- */

function makeSts(sim: KQSim, name: string, replicas: number) {
  sim.files[name + ".yaml"] = "kind: StatefulSet";
  sim.applyEffects[name + ".yaml"] = { statefulSet: { name, image: "redis", replicas } };
  sim.exec("kubectl apply -f " + name + ".yaml");
  return sim.statefulSets.find(s => s.name === name)!;
}

test("invariants: frisch angelegtes StatefulSet hat legale Ordinalnamen", () => {
  makeSts(sim, "lager", 3); // Pods lager-0, lager-1, lager-2
  assert.deepEqual(clusterInvariantViolations(sim), []);
});

test("invariants (ROT): StatefulSet-Pod mit falschem (nicht-ordinalem) Namen wird erkannt", () => {
  const sts = makeSts(sim, "lager", 2);
  // stabile Identität verbogen: ein Pod bekommt einen Zufallsnamen wie ein Deployment-Pod
  sts.pods[1] = { ...sts.pods[1], name: "lager-abc123" as typeof sts.pods[1]["name"] };
  assert.match(clusterInvariantViolations(sim).join(), /StatefulSet "lager".*lager-0 … lager-1/);
});

test("invariants (ROT): StatefulSet mit doppeltem Ordinalnamen wird erkannt", () => {
  const sts = makeSts(sim, "lager", 2);
  // beide Pods heißen lager-0 (Ist-Zahl stimmt, Menge nicht) → nur die Ordinal-Regel greift
  sts.pods[1] = { ...sts.pods[1], name: sts.pods[0].name };
  const viol = clusterInvariantViolations(sim).join();
  assert.match(viol, /StatefulSet "lager".*lager-0 … lager-1/);
  assert.doesNotMatch(viol, /Soll 2/); // Invariante (2) NICHT ausgelöst – Ist-Zahl = Soll
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

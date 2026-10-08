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
  newDeploymentPod, newStatefulPod, scaleDeployment, replacePods, replaceDeploymentPod,
  restartStatefulPod, addDeployment, removeDeployment,
  addStatefulSet, removeStatefulSet, statefulPodVolumePending, statefulPodClaimName, statefulPodNode,
  changeImage, setMemoryLimit, setCpuLimit, seedPodTemplate, snapshotPodTemplate,
  MEM_HEALED_NOTE, CPU_THROTTLED_NOTE,
} from "../../src/sim/workload";
import { clusterInvariantViolations } from "../../src/sim/invariants";
import type { Deployment, StatefulSetRes, PodInstance, PodTemplateSpec } from "../../src/sim/state";
import { asPodName, InvalidSpecError } from "../../src/sim/names";
import { makeRng } from "../../src/core/rng";

let sim: KQSim;
beforeEach(() => { sim = freshSim(); });

// Ein fortlaufender Instanz-Strom (#580) für die puren Mutations-Funktionen: er wird über
// die Aufrufe hinweg WEITERGEDREHT (nicht neu geseedet), damit ein Neustart frische Pod-
// Namen zieht (wie in der echten Sim, wo `sim.rng` durchgereicht wird).
const rng = makeRng(0xF00D);

/** Minimales, legales Deployment fürs pure Testen (ohne exec-Umweg). */
function makeDep(name: string, replicas: number): Deployment {
  const dep: Deployment = { name, image: "nginx", replicas: 0, created: 0, pods: [], broken: null, envFrom: { configMaps: [], secrets: [] } };
  scaleDeployment(dep, replicas, 0, rng); // gleich auf `replicas` bringen (hält die Invariante)
  return dep;
}

test("newStatefulPod (#577): stabile Ordinal-Identität, restarts 0, created gesetzt", () => {
  const pod = newStatefulPod("lager-0", 42);
  assert.equal(pod.name, "lager-0", "Name ist der übergebene Ordinal-Name (kein Zufallssuffix)");
  assert.equal(pod.restarts, 0);
  assert.equal(pod.created, 42);
});

/* ---------- (a) die puren Mutations-Funktionen ---------- */

test("newDeploymentPod: Name trägt den Deployment-Präfix, restarts 0, created = Takt", () => {
  const dep = makeDep("kasse", 0);
  const p = newDeploymentPod(dep, 7, rng);
  assert.ok(p.name.startsWith("kasse-"), "Pod-Name sollte mit dem Deployment-Namen beginnen");
  assert.equal(p.restarts, 0);
  assert.equal(p.created, 7);
});

test("scaleDeployment: hoch skalieren hält pods.length === replicas", () => {
  const dep = makeDep("kasse", 1);
  scaleDeployment(dep, 4, 1, rng);
  assert.equal(dep.replicas, 4);
  assert.equal(dep.pods.length, 4);
});

test("scaleDeployment: runter skalieren hält pods.length === replicas", () => {
  const dep = makeDep("kasse", 5);
  scaleDeployment(dep, 2, 1, rng);
  assert.equal(dep.replicas, 2);
  assert.equal(dep.pods.length, 2);
});

test("scaleDeployment: auf 0 skalieren lässt keine Pods übrig", () => {
  const dep = makeDep("kasse", 3);
  scaleDeployment(dep, 0, 1, rng);
  assert.equal(dep.replicas, 0);
  assert.equal(dep.pods.length, 0);
});

test("replacePods: ersetzt alle Pods, Anzahl bleibt, Namen sind neu", () => {
  const dep = makeDep("kasse", 3);
  const alt = dep.pods.map(p => p.name);
  replacePods(dep, 2, rng);
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
  const ok = replaceDeploymentPod(dep, victim, 5, rng);
  assert.equal(ok, true);
  assert.equal(dep.pods.length, 3);
  assert.ok(!dep.pods.some(p => p.name === victim), "der alte Pod ist weg");
});

test("replaceDeploymentPod (Negativfall): unbekannter Pod-Name ändert nichts, gibt false", () => {
  const dep = makeDep("kasse", 2);
  const vorher = dep.pods.map(p => p.name);
  const ok = replaceDeploymentPod(dep, "gibt-es-nicht", 5, rng);
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

/** Minimales, legales StatefulSet fürs pure Testen (ohne exec-Umweg). */
function makeSts(name: string, replicas: number): StatefulSetRes {
  const pods: PodInstance[] = [];
  for (let i = 0; i < replicas; i++) pods.push({ name: asPodName(name + "-" + i), created: 0, restarts: 0 });
  return { name, image: "redis", replicas, serviceName: name, volumeClaimName: "data", storage: "1Gi", pods, created: 0 };
}

test("addStatefulSet/removeStatefulSet: Eintritt und Austritt eines Aggregat-Mitglieds", () => {
  const state = { statefulSets: [] as StatefulSetRes[] };
  const sts = makeSts("lager", 3);
  addStatefulSet(state, sts);
  assert.equal(state.statefulSets.length, 1);
  const removed = removeStatefulSet(state, "lager");
  assert.equal(removed, sts);
  assert.equal(state.statefulSets.length, 0);
});

test("removeStatefulSet (Negativfall): unbekannter Name ändert nichts, gibt undefined", () => {
  const state = { statefulSets: [makeSts("lager", 1)] };
  const removed = removeStatefulSet(state, "gibt-es-nicht");
  assert.equal(removed, undefined);
  assert.equal(state.statefulSets.length, 1, "das vorhandene StatefulSet bleibt unangetastet");
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

test("aggregat: StatefulSet anlegen + löschen läuft über den Kanal und lässt den Cluster legal", () => {
  sim.invariantChecks = true;
  sim.files["sts.yaml"] = "kind: StatefulSet";
  sim.applyEffects["sts.yaml"] = { statefulSet: { name: "lager", image: "redis", replicas: 3 } };
  assert.equal(sim.exec("kubectl apply -f sts.yaml").error, false);
  assert.equal(sim.statefulSets.find(s => s.name === "lager")!.pods.length, 3);
  assert.deepEqual(clusterInvariantViolations(sim), []);
  // löschen (per Namen) – der Kanal entfernt das Mitglied, PVCs bleiben (#122)
  assert.equal(sim.exec("kubectl delete statefulset lager").error, false);
  assert.equal(sim.statefulSets.some(s => s.name === "lager"), false);
  assert.deepEqual(clusterInvariantViolations(sim), []);
});

test("aggregat: kubectl delete statefulset (Negativfall) meldet NotFound und lässt den Bestand", () => {
  sim.files["sts.yaml"] = "kind: StatefulSet";
  sim.applyEffects["sts.yaml"] = { statefulSet: { name: "lager", image: "redis", replicas: 1 } };
  sim.exec("kubectl apply -f sts.yaml");
  const res = sim.exec("kubectl delete statefulset gibt-es-nicht");
  assert.equal(res.error, true);
  assert.match(res.output!, /NotFound/);
  assert.equal(sim.statefulSets.length, 1, "das vorhandene StatefulSet bleibt");
});

test("aggregat: helm uninstall entfernt das Deployment über den Kanal und lässt den Cluster legal", () => {
  sim.invariantChecks = true;
  assert.equal(sim.exec("helm repo add bitnami https://charts.bitnami.com/bitnami").error, false);
  assert.equal(sim.exec("helm install shop bitnami/nginx").error, false);
  const rel = sim.releases.find(r => r.name === "shop")!;
  assert.equal(sim.deployments.some(d => d.name === rel.depName), true);
  assert.equal(sim.exec("helm uninstall shop").error, false);
  assert.equal(sim.deployments.some(d => d.name === rel.depName), false, "das Deployment ist weg");
  assert.deepEqual(clusterInvariantViolations(sim), []);
});

test("statefulPodVolumePending: nur ein Pod mit Pending-PVC wartet (#1301)", () => {
  const sts = { name: "db", volumeClaimName: "data" };
  const pod = newStatefulPod("db-1", 0);
  const pvc = (status: "Pending" | "Bound") => [{ name: "data-db-1", status, volume: "", capacity: "1Gi", storageClass: "", accessModes: "RWO", created: 0 }];
  assert.equal(statefulPodVolumePending(sts, pod, pvc("Pending")), true);
  assert.equal(statefulPodVolumePending(sts, pod, pvc("Bound")), false);
  assert.equal(statefulPodVolumePending(sts, pod, []), false, "ohne PVC-Eintrag kein Pending");
});

test("statefulPodClaimName: stimmt mit dem real angelegten PVC überein (#1404)", () => {
  const s = new KQSim({ statefulSets: [{ name: "speicher", image: "postgres:16", replicas: 2, serviceName: "speicher", volumeClaimName: "daten" }] });
  const set = s.statefulSets[0];
  for (const p of set.pods) assert.equal(s.pvcs.some(v => v.name === statefulPodClaimName(set, p)), true);
  assert.equal(statefulPodClaimName(set, set.pods[1]), "daten-speicher-1");
});

const nd = (name: string, roles: string) => ({ name, status: "Ready", roles, version: "v1.30.2" });
const podN = (i: number) => newStatefulPod("db-" + i, 0);

test("statefulPodNode: Round-Robin über die Worker nach Ordinal, Control-Plane nie (#1404)", () => {
  const nodes = [nd("cp", "control-plane"), nd("w1", "<none>"), nd("w2", "<none>")];
  assert.deepEqual([0, 1, 2, 3].map(i => statefulPodNode(nodes, podN(i))), ["w1", "w2", "w1", "w2"]);
});

test("statefulPodNode: Rückfälle ohne Worker bzw. ohne Nodes (#1404)", () => {
  assert.equal(statefulPodNode([nd("cp", "control-plane")], podN(1)), "cp");
  assert.equal(statefulPodNode([], podN(0)), "");
  const nodes = [nd("cp", "control-plane"), nd("w1", "<none>")];
  assert.equal(statefulPodNode(nodes, { name: "kaputt" }), "w1", "Name ohne Ordinal: erster Worker statt Absturz");
  assert.equal(statefulPodNode(nodes, { name: "" }), "w1");
});

/* ---------- Pod-Template-Primitive (#1300): Heil-/Drossel-Regeln an einer Stelle ---------- */

test("changeImage: heilt den imagepull-Fehler nur mit einem anderen Image", () => {
  const dep = makeDep("kasse", 1);
  dep.broken = { type: "imagepull", badImage: "ngnix" };
  assert.equal(changeImage(dep, "ngnix"), false, "gleiches kaputtes Image heilt nicht");
  assert.deepEqual(dep.broken, { type: "imagepull", badImage: "ngnix" });
  assert.equal(changeImage(dep, "nginx"), true);
  assert.equal(dep.broken, null);
  assert.equal(dep.image, "nginx");
});

test("changeImage: ohne Fehler wird nur das Image gesetzt (nichts geheilt)", () => {
  const dep = makeDep("kasse", 1);
  assert.equal(changeImage(dep, "nginx:2"), false);
  assert.equal(dep.image, "nginx:2");
});

test("setMemoryLimit: genau memNeeded heilt OOMKilled, memNeeded-1 nicht", () => {
  const dep = makeDep("kartograf", 1);
  dep.broken = { type: "oomkilled", memNeeded: 256 };
  assert.equal(setMemoryLimit(dep, 255), false);
  assert.equal(dep.memLimit, 255);
  assert.notEqual(dep.broken, null);
  assert.equal(setMemoryLimit(dep, 256), true);
  assert.equal(dep.broken, null);
});

test("setMemoryLimit: ohne OOMKilled-Fehler heilt nichts, setzt aber das Limit", () => {
  const dep = makeDep("kartograf", 1);
  assert.equal(setMemoryLimit(dep, 512), false);
  assert.equal(dep.memLimit, 512);
});

test("setCpuLimit: unter 500 m drosselt die Dauerlast weg, ab 500 m nicht", () => {
  const dep = makeDep("rechner", 1);
  dep.cpuHeavy = true;
  assert.equal(setCpuLimit(dep, 500), false);
  assert.equal(dep.cpuHeavy, true);
  assert.equal(dep.cpuLimitMilli, 500);
  assert.equal(setCpuLimit(dep, 499), true);
  assert.equal(dep.cpuHeavy, false);
  assert.equal(setCpuLimit(dep, 100), false, "ohne Dauerlast nichts zu drosseln");
});

test("seedPodTemplate: übernimmt nur gesetzte Felder und kopiert den securityContext", () => {
  const dep = makeDep("kasse", 1);
  dep.memLimit = 64;
  const sc = { runAsNonRoot: true };
  seedPodTemplate(dep, { cpuLimitMilli: 250, securityContext: sc });
  assert.equal(dep.memLimit, 64, "nicht gesetzt = unverändert");
  assert.equal(dep.cpuLimitMilli, 250);
  assert.deepEqual(dep.securityContext, sc);
  assert.notEqual(dep.securityContext, sc, "Kopie statt geteilter Referenz");
  seedPodTemplate(dep, { memLimit: 300 });
  assert.equal(dep.memLimit, 300);
});

// ALLE Template-Felder gesetzt: `Required` bricht den Typecheck, sobald PodTemplateSpec wächst und
// diese Probe das neue Feld nicht kennt – dann muss Seed/Snapshot es mitnehmen.
const FULL: Required<PodTemplateSpec> = {
  serviceAccountName: "wachtturm-sa", containerPort: 8080, memLimit: 256, cpuLimitMilli: 250,
  securityContext: { runAsNonRoot: true, allowPrivilegeEscalation: false },
  node: "ahoi-worker-2", emptyDir: { data: "cache", usedMi: 40 }, ephemeralLimit: 512, ephemeralUsedMi: 30,
  initContainer: { fillsMi: 300, doubleStage: true },
};

test("seedPodTemplate/snapshotPodTemplate: Roundtrip über ALLE Template-Felder", () => {
  const dep = makeDep("kasse", 1);
  seedPodTemplate(dep, FULL);
  assert.deepEqual(snapshotPodTemplate(dep), FULL);
});

test("seedPodTemplate/snapshotPodTemplate: Objektfelder kommen als Kopie an, nicht als Referenz", () => {
  const dep = makeDep("kasse", 1);
  seedPodTemplate(dep, FULL);
  assert.notEqual(dep.securityContext, FULL.securityContext);
  assert.notEqual(dep.emptyDir, FULL.emptyDir);
  assert.notEqual(dep.initContainer, FULL.initContainer);
  const snap = snapshotPodTemplate(dep);
  assert.notEqual(snap.securityContext, dep.securityContext);
  assert.notEqual(snap.emptyDir, dep.emptyDir);
  assert.notEqual(snap.initContainer, dep.initContainer);
});

test("seedPodTemplate: leere Spec ändert nichts; Teilangaben werden normalisiert (kein NaN)", () => {
  const dep = makeDep("kasse", 1);
  const before = JSON.stringify(dep);
  seedPodTemplate(dep, {});
  assert.equal(JSON.stringify(dep), before);
  seedPodTemplate(dep, { initContainer: {}, emptyDir: {} });
  assert.deepEqual(dep.initContainer, { fillsMi: 0, doubleStage: false });
  assert.deepEqual(dep.emptyDir, { data: "", usedMi: 0 });
});

test("snapshotPodTemplate: ein nacktes Deployment liefert keine Template-Werte", () => {
  const snap = snapshotPodTemplate(makeDep("kasse", 1));
  assert.deepEqual(Object.values(snap).filter(v => v !== undefined), []);
});

test("Heil-Notizen liegen bei den Primitiven (Wortlaut unverändert)", () => {
  assert.equal(MEM_HEALED_NOTE, "💡 Genug Speicher! Die Pods starten neu und bleiben diesmal stehen – kein OOMKilled mehr.");
  assert.equal(CPU_THROTTLED_NOTE, "💡 CPU-Limit gesetzt! Die Pods werden gedrosselt – der HighPodCPU-Alert fällt auf resolved.");
});

/* ---------- #1459: Replica-Guard an der Fabrik ---------- */

test("#1459 scaleDeployment lehnt nicht ganzzahlige Replicas ab (2.5, NaN, Infinity) und mutiert nichts", () => {
  const dep = sim.deployments[0] ?? sim._makeDeployment("web", "nginx", 2);
  const vorher = dep.pods.length;
  for (const bad of [2.5, NaN, Infinity]) {
    assert.throws(() => scaleDeployment(dep, bad, sim.clock, rng), InvalidSpecError, String(bad));
  }
  assert.equal(dep.pods.length, vorher);
  assert.equal(dep.replicas, vorher);
});

test("#1459 scaleDeployment: 0 und 3 sind gültige Grenzfälle, die Invariante bleibt", () => {
  const dep = sim.deployments[0] ?? sim._makeDeployment("web", "nginx", 2);
  scaleDeployment(dep, 0, sim.clock, rng);
  assert.equal(dep.pods.length, 0);
  scaleDeployment(dep, 3, sim.clock, rng);
  assert.equal(dep.pods.length, 3);
  assert.equal(dep.replicas, 3);
});

test("#1459 Fehlertext im apiserver-Stil mit Tipp", () => {
  const dep = sim.deployments[0] ?? sim._makeDeployment("web", "nginx", 2);
  try { scaleDeployment(dep, 2.5, sim.clock, rng); assert.fail("sollte werfen"); } catch (e) {
    assert.ok(e instanceof InvalidSpecError);
    assert.match(e.message, /The Deployment "[a-z0-9-]+" is invalid: spec\.replicas: Invalid value: 2\.5/);
    assert.ok(e.tip);
  }
});

test("#1459 die Fabriken lehnen ungültige Replicas ab (Deployment und StatefulSet, Szenario-Aufbau)", () => {
  assert.throws(() => new KQSim({ deployments: [{ name: "a", image: "nginx", replicas: 2.5 }] }), InvalidSpecError);
  assert.throws(() => new KQSim({ statefulSets: [{ name: "db", image: "postgres", replicas: 2.5 }] }), InvalidSpecError);
  assert.throws(() => new KQSim({ statefulSets: [{ name: "db", image: "postgres", replicas: -1 }] }), InvalidSpecError);
  assert.doesNotThrow(() => new KQSim({ statefulSets: [{ name: "db", image: "postgres", replicas: 0 }] }));
});

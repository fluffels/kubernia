/* Unit-Tests für die Stateful-Workload-/Speicher-Grundlage im Simulator (#122):
 * StatefulSet mit stabiler Pod-Identität, PVC/PV/StorageClass, dynamische vs. statische
 * Bindung (Pending→Bound) und die spürbare Datendauerhaftigkeit beim Pod-Löschen.
 * Reine Mechanik – deterministisch geprüft, inkl. Negativ-/False-Positive-Fällen (Red-Green).
 */
import { test, beforeEach } from "vitest";
import assert from "node:assert/strict";
import { Sim as KQSim } from "../src/sim";

let sim: KQSim;
beforeEach(() => { sim = new KQSim({}); });

/* Hilfsfunktion: legt ein StatefulSet per echtem `kubectl apply -f` an (nicht nur per Szenario-Seed),
 * damit auch der apply-Handler mitgetestet wird. */
function applyStatefulSet(spec: { name: string; image?: string; replicas: number; volumeClaimName?: string; storage?: string; storageClass?: string }) {
  const file = spec.name + ".yaml";
  sim.mergeScenario({
    files: { [file]: "kind: StatefulSet\n" },
    applyEffects: { [file]: { statefulSet: { name: spec.name, image: spec.image || "postgres", replicas: spec.replicas, volumeClaimName: spec.volumeClaimName, storage: spec.storage, storageClass: spec.storageClass } } },
  });
  return sim.exec("kubectl apply -f " + file);
}

/* ===================== StorageClass: Default vorhanden ===================== */

test("kubectl get storageclass: ohne Vorgabe gibt es die Default-StorageClass 'standard'", () => {
  const r = sim.exec("kubectl get storageclass");
  assert.ok(!r.error);
  assert.match(r.output!, /standard \(default\)/, "Default-StorageClass ist als (default) markiert");
  assert.match(r.output!, /rancher\.io\/local-path/, "Provisioner steht in der Tabelle");
  // Kurzform sc
  assert.match(sim.exec("kubectl get sc").output!, /standard/);
});

/* ===================== StatefulSet: stabile Identität ===================== */

test("StatefulSet anlegen: Pods heißen stabil <name>-0/-1, je Replica ein gebundenes PVC", () => {
  const r = applyStatefulSet({ name: "datenbank", replicas: 2, volumeClaimName: "data", storage: "2Gi" });
  assert.ok(!r.error, "apply darf kein Fehler sein");
  assert.match(r.output!, /statefulset\.apps\/datenbank created/);

  // stabile Pod-Namen (kein Zufallssuffix wie bei Deployments)
  const pods = sim.exec("kubectl get pods").output!;
  assert.match(pods, /datenbank-0/, "Pod -0 existiert");
  assert.match(pods, /datenbank-1/, "Pod -1 existiert");
  assert.doesNotMatch(pods, /datenbank-[a-z0-9]{9}-/, "KEIN Deployment-artiger Zufallsname (False-Positive-Schutz)");

  // get statefulset zeigt READY
  assert.match(sim.exec("kubectl get statefulset").output!, /datenbank\s+2\/2/);
  assert.match(sim.exec("kubectl get sts").output!, /datenbank/);

  // ein PVC pro Replica, Namensschema <vct>-<name>-<ordinal>, beide Bound
  const pvc = sim.exec("kubectl get pvc").output!;
  assert.match(pvc, /data-datenbank-0\s+Bound/, "PVC -0 ist Bound");
  assert.match(pvc, /data-datenbank-1\s+Bound/, "PVC -1 ist Bound");
  assert.equal(sim.pvcs.length, 2, "genau zwei PVCs (eins je Replica)");
  // dynamisch provisioniert -> zwei PVs
  assert.equal(sim.pvs.filter(p => p.status === "Bound").length, 2, "zwei dynamisch provisionierte, gebundene PVs");
});

test("StatefulSet idempotent: zweites apply meldet 'unchanged' und legt keine weiteren PVCs an", () => {
  applyStatefulSet({ name: "kasse", replicas: 1 });
  const again = sim.exec("kubectl apply -f kasse.yaml");
  assert.match(again.output!, /statefulset\.apps\/kasse unchanged/);
  assert.equal(sim.pvcs.length, 1, "kein doppeltes PVC");
});

/* ===================== PVC-Bindung: dynamisch / statisch / Pending ===================== */

test("PVC ohne StorageClass-Angabe wird über die Default-StorageClass dynamisch gebunden", () => {
  sim.mergeScenario({ files: { "claim.yaml": "kind: PVC\n" }, applyEffects: { "claim.yaml": { pvc: { name: "daten-claim", storage: "5Gi" } } } });
  const r = sim.exec("kubectl apply -f claim.yaml");
  assert.match(r.output!, /persistentvolumeclaim\/daten-claim created/);
  assert.match(r.output!, /Bound/, "Hinweistext meldet Bound");
  const claim = sim.pvcs.find(p => p.name === "daten-claim")!;
  assert.equal(claim.status, "Bound");
  assert.notEqual(claim.volume, "", "ein PV-Name ist gebunden");
  assert.equal(claim.capacity, "5Gi");
});

test("PVC mit storageClass='' und ohne passendes PV bleibt Pending (kein False Positive)", () => {
  sim = new KQSim({ pvcs: [{ name: "wartet", storage: "1Gi", storageClass: "" }] });
  const claim = sim.pvcs.find(p => p.name === "wartet")!;
  assert.equal(claim.status, "Pending", "ohne Provisioner und ohne freies PV -> Pending");
  assert.equal(claim.volume, "", "kein Volume gebunden");
  // get pvc zeigt Pending, OHNE Capacity/Volume
  const out = sim.exec("kubectl get pvc").output!;
  assert.match(out, /wartet\s+Pending/);
});

test("PVC mit storageClass='' bindet statisch an ein vorhandenes freies PV", () => {
  sim = new KQSim({
    pvs: [{ name: "pv-handarbeit", capacity: "1Gi", storageClass: "manuell", reclaimPolicy: "Retain" }],
    pvcs: [{ name: "claim-manuell", storage: "1Gi", storageClass: "manuell" }],
  });
  const claim = sim.pvcs.find(p => p.name === "claim-manuell")!;
  assert.equal(claim.status, "Bound", "bindet an das vorhandene PV");
  assert.equal(claim.volume, "pv-handarbeit");
  const pv = sim.pvs.find(p => p.name === "pv-handarbeit")!;
  assert.equal(pv.status, "Bound");
  assert.equal(pv.claim, "default/claim-manuell");
});

/* ===================== Datendauerhaftigkeit ===================== */

test("StatefulSet-Pod löschen: kommt mit GLEICHEM Namen + GLEICHEM Volume zurück (Daten bleiben)", () => {
  applyStatefulSet({ name: "speicher", replicas: 2, volumeClaimName: "data" });
  const volBefore = sim.pvcs.find(p => p.name === "data-speicher-0")!.volume;
  assert.notEqual(volBefore, "");

  const r = sim.exec("kubectl delete pod speicher-0");
  assert.ok(!r.error);
  assert.match(r.output!, /pod "speicher-0" deleted/);

  // gleicher Name kommt zurück (stabile Identität) – kein Zufallssuffix
  const pods = sim.exec("kubectl get pods").output!;
  assert.match(pods, /speicher-0/, "Pod -0 ist mit gleichem Namen zurück");
  assert.doesNotMatch(pods, /speicher-0-[a-z0-9]/, "kein angehängtes Zufallssuffix (kein Deployment-Verhalten)");

  // PVC bleibt bestehen, mit demselben Volume
  const pvcAfter = sim.pvcs.find(p => p.name === "data-speicher-0")!;
  assert.ok(pvcAfter, "PVC überlebt das Pod-Löschen");
  assert.equal(pvcAfter.volume, volBefore, "dasselbe Volume hängt wieder dran – Daten bleiben");
});

test("Deployment-Pod löschen bleibt Zufalls-Self-Healing (Abgrenzung gegen StatefulSet)", () => {
  sim = new KQSim({ deployments: [{ name: "web", image: "nginx", replicas: 1 }] });
  const before = sim.deployments[0].pods[0].name;
  sim.exec("kubectl delete pod " + before);
  const after = sim.deployments[0].pods[0].name;
  assert.notEqual(after, before, "Deployment ersetzt den Pod mit NEUEM (zufälligem) Namen – anders als StatefulSet");
});

test("StatefulSet löschen: die PVCs bleiben bestehen (Datendauerhaftigkeit)", () => {
  applyStatefulSet({ name: "archiv", replicas: 2, volumeClaimName: "data" });
  assert.equal(sim.pvcs.length, 2);
  const r = sim.exec("kubectl delete statefulset archiv");
  assert.ok(!r.error);
  assert.match(r.output!, /statefulset\.apps "archiv" deleted/);
  assert.equal(sim.statefulSets.length, 0, "StatefulSet weg");
  assert.equal(sim.pvcs.length, 2, "PVCs bleiben – die Daten überleben");
  assert.match(sim.exec("kubectl get pvc").output!, /data-archiv-0\s+Bound/);
});

/* ===================== PVC/PV löschen & Reclaim ===================== */

test("PVC löschen: Delete-Policy entfernt das PV, Retain hinterlässt es als 'Released'", () => {
  // dynamisch (Default-SC, reclaim Delete)
  sim.mergeScenario({ files: { "c.yaml": "x" }, applyEffects: { "c.yaml": { pvc: { name: "fluechtig", storage: "1Gi" } } } });
  sim.exec("kubectl apply -f c.yaml");
  const pvName = sim.pvcs.find(p => p.name === "fluechtig")!.volume;
  assert.ok(sim.pvs.some(p => p.name === pvName));
  sim.exec("kubectl delete pvc fluechtig");
  assert.ok(!sim.pvcs.some(p => p.name === "fluechtig"), "PVC weg");
  assert.ok(!sim.pvs.some(p => p.name === pvName), "Delete-Policy: PV ebenfalls weg");

  // statisch an Retain-PV
  sim = new KQSim({
    pvs: [{ name: "pv-bleibt", capacity: "1Gi", storageClass: "manuell", reclaimPolicy: "Retain" }],
    pvcs: [{ name: "claim", storage: "1Gi", storageClass: "manuell" }],
  });
  sim.exec("kubectl delete pvc claim");
  const pv = sim.pvs.find(p => p.name === "pv-bleibt")!;
  assert.equal(pv.status, "Released", "Retain-PV bleibt als Released stehen");
  assert.equal(pv.claim, "", "Anspruch ist gelöst");
});

test("kubectl delete: unbekanntes PVC/PV/StatefulSet -> NotFound (Negativfall)", () => {
  assert.ok(sim.exec("kubectl delete pvc gibtsnicht").error);
  assert.match(sim.exec("kubectl delete pvc gibtsnicht").output!, /NotFound/);
  assert.ok(sim.exec("kubectl delete pv gibtsnicht").error);
  assert.ok(sim.exec("kubectl delete statefulset gibtsnicht").error);
});

/* ===================== get: leere Listen ===================== */

test("kubectl get pvc/pv: leer, solange nichts existiert (kein Crash, kein Fehler)", () => {
  const pvc = sim.exec("kubectl get pvc");
  assert.ok(!pvc.error);
  assert.match(pvc.output!, /No resources found/);
  const pv = sim.exec("kubectl get pv");
  assert.ok(!pv.error);
  assert.match(pv.output!, /No resources found/);
  assert.match(sim.exec("kubectl get statefulset").output!, /No resources found/);
});

/* ===================== Persistenz über Speichern/Laden ===================== */

test("snapshot/Reload: StatefulSet + gebundenes PVC überleben, ohne PVs zu verdoppeln", () => {
  applyStatefulSet({ name: "persistenz", replicas: 1, volumeClaimName: "data" });
  const pvCountBefore = sim.pvs.length;
  const volBefore = sim.pvcs[0].volume;

  const snap = sim.snapshot();
  const sim2 = new KQSim(snap);

  assert.equal(sim2.statefulSets.length, 1, "StatefulSet kommt zurück");
  assert.match(sim2.exec("kubectl get pods").output!, /persistenz-0/, "stabiler Pod-Name nach Reload");
  assert.equal(sim2.pvcs.length, 1, "genau ein PVC (nicht verdoppelt)");
  assert.equal(sim2.pvcs[0].status, "Bound");
  assert.equal(sim2.pvcs[0].volume, volBefore, "dasselbe Volume wie vor dem Speichern");
  assert.equal(sim2.pvs.length, pvCountBefore, "kein zusätzliches PV beim Reload provisioniert");
});

/* ===================== Backup & Restore: VolumeSnapshot (#140) ===================== */

/* Legt ein PVC mit Inhalt per echtem `kubectl apply -f` an (testet den apply-Handler inkl. data-Seed). */
function applyDataPvc(name: string, data: string, storage = "5Gi") {
  const file = name + ".yaml";
  sim.mergeScenario({
    files: { [file]: "kind: PersistentVolumeClaim\n" },
    applyEffects: { [file]: { pvc: { name, storage, storageClass: "standard", accessModes: "RWO", data } } },
  });
  return sim.exec("kubectl apply -f " + file);
}

/* Legt einen VolumeSnapshot eines Quell-PVC per apply an. */
function applySnapshot(name: string, sourcePvc: string) {
  const file = name + ".yaml";
  sim.mergeScenario({
    files: { [file]: "kind: VolumeSnapshot\n" },
    applyEffects: { [file]: { volumeSnapshot: { name, sourcePvc } } },
  });
  return sim.exec("kubectl apply -f " + file);
}

/* Stellt ein PVC aus einem Snapshot wieder her (spec.dataSource). */
function applyRestore(name: string, fromSnapshot: string, storage = "5Gi") {
  const file = "restore-" + name + ".yaml";
  sim.mergeScenario({
    files: { [file]: "kind: PersistentVolumeClaim\n" },
    applyEffects: { [file]: { pvc: { name, storage, storageClass: "standard", accessModes: "RWO", dataSource: fromSnapshot } } },
  });
  return sim.exec("kubectl apply -f " + file);
}

test("VolumeSnapshot anlegen: friert den Inhalt des Quell-PVC ein, ist readyToUse", () => {
  applyDataPvc("kai-datenbank", "stammkundenverzeichnis");
  const r = applySnapshot("kai-snap", "kai-datenbank");
  assert.ok(!r.error, "apply darf kein Fehler sein");
  assert.match(r.output!, /volumesnapshot\.snapshot\.storage\.k8s\.io\/kai-snap created/);

  assert.equal(sim.volumeSnapshots.length, 1);
  assert.equal(sim.volumeSnapshots[0].data, "stammkundenverzeichnis", "Inhalt zum Snapshot-Zeitpunkt gesichert");
  assert.equal(sim.volumeSnapshots[0].readyToUse, true);
  assert.equal(sim.volumeSnapshots[0].restoreSize, "5Gi", "restoreSize = Kapazität der Quelle");

  const got = sim.exec("kubectl get volumesnapshot").output!;
  assert.match(got, /kai-snap\s+true\s+kai-datenbank\s+5Gi/, "get zeigt READYTOUSE/SOURCEPVC/RESTORESIZE");
  assert.match(sim.exec("kubectl get vs").output!, /kai-snap/, "Kurzform vs");
});

test("Snapshot eines NICHT existierenden PVC scheitert und legt nichts an (Negativfall)", () => {
  const r = applySnapshot("geister-snap", "gibt-es-nicht");
  assert.ok(r.error, "muss ein Fehler sein");
  assert.match(r.output!, /source PVC "gibt-es-nicht" does not exist/);
  assert.equal(sim.volumeSnapshots.length, 0, "kein Snapshot angelegt (kein False Positive)");
});

test("Snapshot ist eine KOPIE: spätere Datenänderung am PVC ändert den Snapshot nicht", () => {
  applyDataPvc("kai-datenbank", "stand-A");
  applySnapshot("kai-snap", "kai-datenbank");
  // PVC-Inhalt nachträglich verändern (simuliert weiteres Schreiben nach dem Backup)
  sim.pvcs.find(p => p.name === "kai-datenbank")!.data = "stand-B";
  assert.equal(sim.volumeSnapshots[0].data, "stand-A", "Snapshot hält den eingefrorenen Stand, nicht die Live-Daten");
});

test("Restore: Datenverlust (PVC weg) – Snapshot überlebt – Wiederherstellung bringt die Daten zurück", () => {
  applyDataPvc("kai-datenbank", "stammkundenverzeichnis");
  applySnapshot("kai-snap", "kai-datenbank");

  // Datenverlust: PVC samt Volume löschen
  assert.ok(!sim.exec("kubectl delete pvc kai-datenbank").error);
  assert.equal(sim.pvcs.find(p => p.name === "kai-datenbank"), undefined, "PVC ist weg");
  // das Backup lebt unabhängig weiter
  assert.equal(sim.volumeSnapshots.length, 1, "Snapshot überlebt den Verlust des Quell-PVC");
  assert.equal(sim.volumeSnapshots[0].readyToUse, true);

  // Restore aus dem Snapshot
  const r = applyRestore("kai-datenbank", "kai-snap");
  assert.ok(!r.error, "Restore darf kein Fehler sein");
  assert.match(r.output!, /aus Snapshot 'kai-snap' wiederhergestellt/);
  const restored = sim.pvcs.find(p => p.name === "kai-datenbank");
  assert.ok(restored, "PVC ist wieder da");
  assert.equal(restored!.data, "stammkundenverzeichnis", "die gesicherten Daten sind zurück");
  assert.equal(restored!.status, "Bound");
});

test("Red-Green: ein frisches PVC OHNE dataSource hat KEINE Daten (Restore tut wirklich etwas)", () => {
  applyDataPvc("kai-datenbank", "stammkundenverzeichnis");
  applySnapshot("kai-snap", "kai-datenbank");
  sim.exec("kubectl delete pvc kai-datenbank");
  // Ein leeres PVC gleichen Namens anlegen (kein dataSource) → bleibt ohne Daten
  sim.mergeScenario({
    files: { "leer.yaml": "kind: PersistentVolumeClaim\n" },
    applyEffects: { "leer.yaml": { pvc: { name: "leer-pvc", storage: "5Gi", storageClass: "standard", accessModes: "RWO" } } },
  });
  sim.exec("kubectl apply -f leer.yaml");
  const leer = sim.pvcs.find(p => p.name === "leer-pvc")!;
  assert.ok(!leer.data, "ohne dataSource bleibt das Volume leer – sonst wäre die Restore-Prüfung ein False Positive");
});

test("Restore aus unbekanntem Snapshot scheitert und legt kein PVC an (Negativfall)", () => {
  const r = applyRestore("kai-datenbank", "gibt-es-nicht");
  assert.ok(r.error, "muss ein Fehler sein");
  assert.match(r.output!, /dataSource VolumeSnapshot "gibt-es-nicht" was not found/);
  assert.equal(sim.pvcs.find(p => p.name === "kai-datenbank"), undefined, "kein PVC aus einem nicht existierenden Backup");
});

test("Restore aus einem noch nicht fertigen Snapshot scheitert (readyToUse=false)", () => {
  applyDataPvc("kai-datenbank", "daten");
  applySnapshot("kai-snap", "kai-datenbank");
  sim.volumeSnapshots[0].readyToUse = false; // noch nicht fertig
  sim.exec("kubectl delete pvc kai-datenbank");
  const r = applyRestore("kai-datenbank", "kai-snap");
  assert.ok(r.error, "ein unfertiger Snapshot darf nicht wiederherstellbar sein");
  assert.match(r.output!, /not readyToUse yet/);
});

test("kubectl delete volumesnapshot: löscht das Backup; Unbekanntes -> NotFound (Negativfall)", () => {
  applyDataPvc("kai-datenbank", "daten");
  applySnapshot("kai-snap", "kai-datenbank");
  assert.match(sim.exec("kubectl delete vs kai-snap").output!, /volumesnapshot\.snapshot\.storage\.k8s\.io "kai-snap" deleted/);
  assert.equal(sim.volumeSnapshots.length, 0);
  const r = sim.exec("kubectl delete volumesnapshot fehlt");
  assert.ok(r.error);
  assert.match(r.output!, /NotFound.*volumesnapshots.*"fehlt" not found/);
});

test("snapshot/Reload: VolumeSnapshot + PVC-Daten überleben den Roundtrip", () => {
  applyDataPvc("kai-datenbank", "stammkundenverzeichnis");
  applySnapshot("kai-snap", "kai-datenbank");

  const sim2 = new KQSim(sim.snapshot());
  assert.equal(sim2.volumeSnapshots.length, 1, "Snapshot kommt zurück");
  assert.equal(sim2.volumeSnapshots[0].data, "stammkundenverzeichnis");
  assert.equal(sim2.volumeSnapshots[0].readyToUse, true);
  assert.equal(sim2.pvcs.find(p => p.name === "kai-datenbank")!.data, "stammkundenverzeichnis", "PVC-Inhalt überlebt Reload");
});

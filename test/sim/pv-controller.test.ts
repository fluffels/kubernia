import { describe, expect, test } from "vitest";
import { bindPvc, decidePvcBinding, pvcPendingEvent, resyncPendingPvcs, accessModesLong, MSG_FAILED_BINDING, MSG_PROVISIONING_FAILED, MSG_EXTERNAL_PROVISIONING } from "../../src/sim/pv-controller";
import type { PvRes, PvcRes, StorageClassRes } from "../../src/sim/state";
import { pvRes, pvcRes, storageClassRes } from "../factories/storage";

type World = { pvs: PvRes[]; storageClasses: StorageClassRes[]; pvcs: PvcRes[]; clock: number; rng: () => number };
const world = (o: Partial<World> = {}): World => ({ pvs: [], storageClasses: [], pvcs: [], clock: 7, rng: () => 0.5, ...o });

describe("accessModesLong", () => {
  test("Kurz- und Langform, Unbekanntes bleibt", () => {
    expect(accessModesLong("RWO, RWX")).toEqual(["ReadWriteOnce", "ReadWriteMany"]);
    expect(accessModesLong("ReadWriteMany")).toEqual(["ReadWriteMany"]);
    expect(accessModesLong("")).toEqual([]);
  });
});

describe("decidePvcBinding", () => {
  test("gebundenes PVC: bound", () => {
    expect(decidePvcBinding(world(), pvcRes({ status: "Bound", volume: "pv-x" }))).toEqual({ kind: "bound" });
  });
  test("statisch: leere Klasse passt zu leerer Klasse", () => {
    const pv = pvRes();
    expect(decidePvcBinding(world({ pvs: [pv] }), pvcRes())).toEqual({ kind: "bind", pv });
  });
  test("negativ: PVC ohne Klasse bindet kein PV mit Klasse -> FailedBinding", () => {
    const d = decidePvcBinding(world({ pvs: [pvRes({ storageClass: "manuell" })] }), pvcRes());
    expect(d).toEqual({ kind: "pending", event: { type: "Normal", reason: "FailedBinding", message: MSG_FAILED_BINDING } });
  });
  test("statisch vor dynamisch: freies passendes PV schlägt Provisionieren", () => {
    const pv = pvRes({ storageClass: "schnell" });
    const d = decidePvcBinding(world({ pvs: [pv], storageClasses: [storageClassRes()] }), pvcRes({ storageClass: "schnell" }));
    expect(d).toEqual({ kind: "bind", pv });
  });
  test("belegtes PV zählt nicht", () => {
    const d = decidePvcBinding(world({ pvs: [pvRes({ status: "Bound" })] }), pvcRes());
    expect(d.kind).toBe("pending");
  });
  test("Kapazität: zu kleines PV passt nicht, kleinstes passendes gewinnt, unlesbar blockiert nicht", () => {
    expect(decidePvcBinding(world({ pvs: [pvRes({ capacity: "1Gi" })] }), pvcRes({ capacity: "5Gi" })).kind).toBe("pending");
    const klein = pvRes({ name: "klein", capacity: "5Gi" });
    const gross = pvRes({ name: "gross", capacity: "10Gi" });
    expect(decidePvcBinding(world({ pvs: [gross, klein] }), pvcRes({ capacity: "3Gi" }))).toEqual({ kind: "bind", pv: klein });
    const unlesbar = pvRes({ capacity: "viel" });
    expect(decidePvcBinding(world({ pvs: [unlesbar] }), pvcRes())).toEqual({ kind: "bind", pv: unlesbar });
  });
  test("Gleichstand: das erste im Array", () => {
    const a = pvRes({ name: "a" });
    const b = pvRes({ name: "b" });
    expect(decidePvcBinding(world({ pvs: [a, b] }), pvcRes())).toEqual({ kind: "bind", pv: a });
  });
  test("Access Modes: Obermenge erfüllt, RWO erfüllt RWX nicht, Kurz-/Langform gleich", () => {
    expect(decidePvcBinding(world({ pvs: [pvRes({ accessModes: "RWO,RWX" })] }), pvcRes({ accessModes: "RWX" })).kind).toBe("bind");
    expect(decidePvcBinding(world({ pvs: [pvRes({ accessModes: "RWO" })] }), pvcRes({ accessModes: "RWX" })).kind).toBe("pending");
    expect(decidePvcBinding(world({ pvs: [pvRes({ accessModes: "ReadWriteMany" })] }), pvcRes({ accessModes: "RWX" })).kind).toBe("bind");
  });
  test("Access Modes: fordert das PVC zwei Modi, muss das PV beide bieten", () => {
    expect(decidePvcBinding(world({ pvs: [pvRes({ accessModes: "RWO" })] }), pvcRes({ accessModes: "RWO,RWX" })).kind).toBe("pending");
    expect(decidePvcBinding(world({ pvs: [pvRes({ accessModes: "RWX,RWO" })] }), pvcRes({ accessModes: "RWO,RWX" })).kind).toBe("bind");
  });
  test("StorageClass fehlt und kein PV: ProvisioningFailed; vorhanden: provision", () => {
    const pvc = pvcRes({ storageClass: "schnell" });
    expect(decidePvcBinding(world(), pvc)).toEqual({ kind: "pending", event: { type: "Warning", reason: "ProvisioningFailed", message: 'storageclass.storage.k8s.io "schnell" not found' } });
    const sc = storageClassRes();
    expect(decidePvcBinding(world({ storageClasses: [sc] }), pvc)).toEqual({ kind: "provision", storageClass: sc });
  });
  test("falsche StorageClass (PV hat eine andere): kein Treffer", () => {
    expect(decidePvcBinding(world({ pvs: [pvRes({ storageClass: "langsam" })] }), pvcRes({ storageClass: "schnell" })).kind).toBe("pending");
  });
});

describe("pvcPendingEvent", () => {
  test("die drei Texte wörtlich", () => {
    expect(pvcPendingEvent(world(), pvcRes())).toEqual({ type: "Normal", reason: "FailedBinding", message: "no persistent volumes available for this claim and no storage class is set" });
    expect(MSG_PROVISIONING_FAILED("x")).toBe('storageclass.storage.k8s.io "x" not found');
    const ev = pvcPendingEvent(world({ storageClasses: [storageClassRes({ provisioner: "ebs.csi" })] }), pvcRes({ storageClass: "schnell" }));
    expect(ev).toEqual({ type: "Normal", reason: "ExternalProvisioning", message: MSG_EXTERNAL_PROVISIONING("ebs.csi") });
    expect(ev?.message).toBe("Waiting for a volume to be created either by the external provisioner 'ebs.csi' or manually by the system administrator. If volume creation is delayed, please verify that the provisioner is running and correctly registered.");
  });
  test("gebunden oder bindbar: null", () => {
    expect(pvcPendingEvent(world(), pvcRes({ status: "Bound", volume: "v" }))).toBeNull();
    expect(pvcPendingEvent(world({ pvs: [pvRes()] }), pvcRes())).toBeNull();
  });
});

describe("bindPvc", () => {
  test("provisioniert: PV pvc-<8>, Claim, reclaimPolicy aus der Klasse", () => {
    const w = world({ storageClasses: [storageClassRes({ reclaimPolicy: "Retain" })] });
    const pvc = pvcRes({ storageClass: "schnell", capacity: "2Gi" });
    expect(bindPvc(w, pvc)).toBe(true);
    expect(pvc.status).toBe("Bound");
    expect(pvc.volume).toMatch(/^pvc-.{8}$/);
    expect(w.pvs).toEqual([expect.objectContaining({ name: pvc.volume, claim: "default/daten", reclaimPolicy: "Retain", capacity: "2Gi", status: "Bound", created: 7 })]);
  });
  test("statisch: PV wird Bound mit Claim, PVC übernimmt die PV-Kapazität", () => {
    const pv = pvRes({ capacity: "5Gi" });
    const pvc = pvcRes();
    expect(bindPvc(world({ pvs: [pv] }), pvc)).toBe(true);
    expect(pv).toMatchObject({ status: "Bound", claim: "default/daten" });
    expect(pvc).toMatchObject({ status: "Bound", volume: "pv-a", capacity: "5Gi" });
  });
  test("Pending bleibt unverändert", () => {
    const w = world();
    const pvc = pvcRes({ storageClass: "fehlt" });
    expect(bindPvc(w, pvc)).toBe(false);
    expect(pvc).toMatchObject({ status: "Pending", volume: "" });
    expect(w.pvs).toEqual([]);
  });
});

describe("resyncPendingPvcs", () => {
  test("zwei wartende PVCs, ein PV: das erste bekommt es, das zweite bleibt Pending", () => {
    const a = pvcRes({ name: "a" });
    const b = pvcRes({ name: "b" });
    const w = world({ pvs: [pvRes()], pvcs: [a, b] });
    expect(resyncPendingPvcs(w)).toEqual([a]);
    expect(b.status).toBe("Pending");
  });
  test("gebundenes PVC bleibt unberührt, kein neues PV; zweiter Lauf ist leer", () => {
    const bound = pvcRes({ name: "g", status: "Bound", volume: "pv-g", storageClass: "schnell" });
    const w = world({ storageClasses: [storageClassRes()], pvcs: [bound] });
    expect(resyncPendingPvcs(w)).toEqual([]);
    expect(w.pvs).toEqual([]);
    const wartend = pvcRes({ storageClass: "schnell" });
    w.pvcs.push(wartend);
    expect(resyncPendingPvcs(w)).toEqual([wartend]);
    expect(resyncPendingPvcs(w)).toEqual([]);
    expect(w.pvs).toHaveLength(1);
  });
});

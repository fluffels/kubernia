// Sim-Fassung des PV-Controllers (#1494): die EINE Stelle, die entscheidet, ob ein PVC
// dynamisch provisioniert, statisch an ein vorhandenes PV gebunden wird oder Pending bleibt,
// und warum. Binden, Resync (spätere StorageClass/PV) und `describe pvc` nutzen sie gemeinsam.
// Reihenfolge wie `syncUnboundClaim` im echten Controller: erst `findBestMatchForClaim`
// (statisch), dann `provisionClaim`. Pure Domäne, keine Mutation in den Entscheidungsfunktionen.

import { DEFAULT_NAMESPACE, type ClusterState, type PvcRes, type PvRes, type StorageClassRes } from "./state";
import { parseMem, randSuffix } from "./util";

const ACCESS_MODES: Readonly<Record<string, string>> = {
  RWO: "ReadWriteOnce", ROX: "ReadOnlyMany", RWX: "ReadWriteMany", RWOP: "ReadWriteOncePod",
};

/** Die Access-Modes als Langform (`RWO` → `ReadWriteOnce`); Langformen und Unbekanntes bleiben. */
export function accessModesLong(modes: string): string[] {
  return modes.split(",").map(m => m.trim()).filter(m => m !== "").map(m => ACCESS_MODES[m] ?? m);
}

// Event-Texte aus pkg/controller/volume/persistentvolume/pv_controller.go (master).
export const MSG_FAILED_BINDING = "no persistent volumes available for this claim and no storage class is set";
export const MSG_PROVISIONING_FAILED = (storageClass: string): string => 'storageclass.storage.k8s.io "' + storageClass + '" not found';
export const MSG_EXTERNAL_PROVISIONING = (provisioner: string): string =>
  "Waiting for a volume to be created either by the external provisioner '" + provisioner +
  "' or manually by the system administrator. If volume creation is delayed, please verify that the provisioner is running and correctly registered.";

export type PvcEvent = { type: "Normal" | "Warning"; reason: string; message: string };

export type PvcBindingDecision =
  | { kind: "bound" }
  | { kind: "bind"; pv: PvRes }
  | { kind: "provision"; storageClass: StorageClassRes }
  | { kind: "pending"; event: PvcEvent };

type BindingView = Pick<ClusterState, "pvs" | "storageClasses">;
type BindingHost = BindingView & Pick<ClusterState, "clock"> & { rng: () => number };

/** Passt das PV zur Anforderung? Exakt gleiche Klasse (`""` nur zu `""`), Modi des PV als
 *  Obermenge der angeforderten, Kapazität mindestens die Anforderung (nicht lesbar = passt). */
function pvMatches(pv: PvRes, pvc: PvcRes): boolean {
  if (pv.status !== "Available" || pv.storageClass !== pvc.storageClass) return false;
  const offered = accessModesLong(pv.accessModes);
  if (!accessModesLong(pvc.accessModes).every(m => offered.includes(m))) return false;
  const have = parseMem(pv.capacity);
  const want = parseMem(pvc.capacity);
  return have === null || want === null || have >= want;
}

/** Das am besten passende freie PV: das kleinste, bei Gleichstand das erste im Array. */
function findStaticMatch(view: BindingView, pvc: PvcRes): PvRes | undefined {
  let best: PvRes | undefined;
  let bestSize = Infinity;
  for (const pv of view.pvs) {
    if (!pvMatches(pv, pvc)) continue;
    const size = parseMem(pv.capacity) ?? Infinity;
    if (!best || size < bestSize) { best = pv; bestSize = size; }
  }
  return best;
}

/** Entscheidet die Bindung eines PVC: bereits gebunden, statisch binden, provisionieren
 *  oder Pending samt Grund. Rein: kein rng, keine Mutation. */
export function decidePvcBinding(view: BindingView, pvc: PvcRes): PvcBindingDecision {
  if (pvc.status === "Bound" && pvc.volume) return { kind: "bound" };
  const pv = findStaticMatch(view, pvc);
  if (pv) return { kind: "bind", pv };
  if (pvc.storageClass === "") return { kind: "pending", event: { type: "Normal", reason: "FailedBinding", message: MSG_FAILED_BINDING } };
  const storageClass = view.storageClasses.find(s => s.name === pvc.storageClass);
  if (!storageClass) return { kind: "pending", event: { type: "Warning", reason: "ProvisioningFailed", message: MSG_PROVISIONING_FAILED(pvc.storageClass) } };
  return { kind: "provision", storageClass };
}

/** Das Event, das `describe pvc` für ein noch ungebundenes PVC zeigt; sonst `null`.
 *  `provision` bei noch Pending = der externe Provisioner ist am Zug (ExternalProvisioning). */
export function pvcPendingEvent(view: BindingView, pvc: PvcRes): PvcEvent | null {
  if (pvc.status !== "Pending") return null;
  const d = decidePvcBinding(view, pvc);
  if (d.kind === "pending") return d.event;
  if (d.kind === "provision") return { type: "Normal", reason: "ExternalProvisioning", message: MSG_EXTERNAL_PROVISIONING(d.storageClass.provisioner) };
  return null;
}

/** Wendet die Entscheidung an. `true`, wenn das PVC dabei gebunden wurde. */
export function bindPvc(host: BindingHost, pvc: PvcRes): boolean {
  const d = decidePvcBinding(host, pvc);
  const claim = DEFAULT_NAMESPACE + "/" + pvc.name;
  if (d.kind === "provision") {
    const pvName = "pvc-" + randSuffix(8, host.rng);
    host.pvs.push({ name: pvName, capacity: pvc.capacity, status: "Bound", claim, storageClass: d.storageClass.name, accessModes: pvc.accessModes, reclaimPolicy: d.storageClass.reclaimPolicy, created: host.clock });
    pvc.status = "Bound";
    pvc.volume = pvName;
    return true;
  }
  if (d.kind === "bind") {
    d.pv.status = "Bound";
    d.pv.claim = claim;
    pvc.status = "Bound";
    pvc.volume = d.pv.name;
    if (d.pv.capacity) pvc.capacity = d.pv.capacity;
    return true;
  }
  return false;
}

/** Resync des PV-Controllers: bindet wartende PVCs nach, wenn StorageClass oder PV später
 *  entstanden sind. Array-Reihenfolge; gibt die neu gebundenen PVCs zurück (idempotent). */
export function resyncPendingPvcs(host: BindingHost & Pick<ClusterState, "pvcs">): PvcRes[] {
  return host.pvcs.filter(p => p.status === "Pending" && bindPvc(host, p));
}

/* Test-Factory: PVC, PV und StorageClass mit sinnvollen Defaults; Overrides nur für das, was
 * die jeweilige Assertion braucht. */
import type { PvRes, PvcRes, StorageClassRes } from "../../src/sim/state";

export const pvcRes = (o: Partial<PvcRes> = {}): PvcRes =>
  ({ name: "daten", status: "Pending", volume: "", capacity: "1Gi", storageClass: "", accessModes: "RWO", created: 0, ...o });

export const pvRes = (o: Partial<PvRes> = {}): PvRes =>
  ({ name: "pv-a", capacity: "1Gi", status: "Available", claim: "", storageClass: "", accessModes: "RWO", reclaimPolicy: "Retain", created: 0, ...o });

export const storageClassRes = (o: Partial<StorageClassRes> = {}): StorageClassRes =>
  ({ name: "schnell", provisioner: "rancher.io/local-path", reclaimPolicy: "Delete", isDefault: false, created: 0, ...o });

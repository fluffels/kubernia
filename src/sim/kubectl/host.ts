/* ===== KubeQuest – KubectlHost-Interface (sim/kubectl/host.ts) =====
 * Das schmale Interface, das alle kubectl-Unterfamilien (inspect/lifecycle/ops/
 * security) vom Simulator brauchen. Bewusst ein eng umrissenes Interface statt der
 * ganzen `Sim`-Klasse: es dokumentiert die (große) Kopplung von kubectl an den
 * Cluster-Zustand und vermeidet einen Import-Zyklus kubectl ↔ sim.
 *
 * Leaf-Modul der kubectl-Mappe: hängt nur an den Domänentypen aus ../state, wird von
 * allen Familien + dem Barrel (../kubectl.ts) importiert. Kein Rückimport (kein Zyklus).
 */
import type {
  ClusterState, Deployment, PodInstance, PodStatus, PvcRes, StatefulSetRes,
  ServiceRes, Broken, NodeMetrics, Alert,
} from "../state";

/** Was die kubectl-Befehle vom Simulator brauchen (von der `Sim`-Klasse erfüllt).
 *  Die Daten-Felder kommen über `extends ClusterState` (sim/state.ts, #372); hinzu
 *  kommen der transiente Sitzungs-Marker `lastDeletedPod` und die in `sim.ts`
 *  verbleibenden Helfer/öffentlichen Methoden, die kubectl ruft. */
export interface KubectlHost extends ClusterState {
  // Transienter Sitzungs-Marker (kein Cluster-Zustand → nicht in ClusterState).
  lastDeletedPod: string | null;
  // Geteilte Sim-Helfer (bleiben in sim.ts): Fehler, Alter, Pods/Readiness, Fabriken.
  // Flag-/Vorschlags-Parsing ist seit #499 pure Funktionen in ../util (flagValue/multiFlag/suggest).
  _err(msg: string, tip?: string): string;
  _age(created: number): string;
  _allPods(): PodInstance[];
  _findDeploymentOfPod(podName: string): Deployment | undefined;
  _podStatus(d: Deployment): PodStatus;
  _podReady(d: Deployment): boolean;
  _reschedulePending(): void;
  _recheckReadiness(): void;
  _imageAvailable(image: string): boolean; // #164: ist das Image lokal gebaut/gezogen?
  // Ephemeral-Storage & Eviction (#240): Platzierung, Disk-Bilanz, Scratch-Freigabe.
  _nodeOf(d: Deployment): string;
  _depEphemeralUsed(d: Deployment): number;
  _nodeEphemeralUsed(nodeName: string): number;
  _resetEphemeral(d: Deployment): void;
  _makeDeployment(name: string, image: string, replicas: number, broken?: Broken | null, envFrom?: { configMaps: string[]; secrets: string[] }, cpuHeavy?: boolean): Deployment;
  _makeService(spec: { name: string; type?: string; port: string | number; targetPort?: string | number; externalName?: string }): ServiceRes;
  _makePvc(name: string, storage: string, storageClass?: string, accessModes?: string): PvcRes;
  _makeStatefulSet(spec: { name: string; image: string; replicas: number; serviceName?: string; volumeClaimName?: string; storage?: string; storageClass?: string }): StatefulSetRes;
  // Observability-API (öffentlich, bleibt in sim.ts): top/get lesen daraus.
  podMetrics(): Array<{ name: string; cpuMilli: number; memMi: number }>;
  nodeMetrics(): NodeMetrics[];
  alerts(): Alert[];
}

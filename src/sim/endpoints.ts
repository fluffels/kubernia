/* ===== Kubernia – Service→Pod-Auflösung (sim/endpoints.ts, #1318) =====
 * Die EINE Stelle, die beantwortet: welche Pods (mit welcher IP, bereit oder nicht) stehen
 * hinter einem Service? `kubectl get endpoints`, `curl`, `nslookup` (headless + Pod-Record)
 * und die Prometheus-Scrape-Targets lesen nur noch hieraus. Selektoren sind in der Sim nicht
 * modelliert; der Name ist die Verdrahtung: das Deployment gleichen Namens plus jedes
 * StatefulSet, das den Service als `serviceName` führt (#1301). Später ändern Selektoren/
 * EndpointSlices genau diese Funktion.
 *
 * Rein lesend und Phaser-frei: nur Domänentypen aus ./state, `podIP` aus ./util und die
 * PVC-Ableitung aus ./workload und das Pod-Inventar ./pods; kein Rückimport nach sim.ts (kein Zyklus). Das Nachführen
 * (`_reschedulePending`/`_recheckReadiness`) bleibt bei den aufrufenden Befehlen.
 */
import { isExternalNameService, type ClusterState, type Deployment, type PvcRes, type ServiceRes } from "./state";
import { clusterPods, type ClusterPod } from "./pods";
import { podIP } from "./util";
import { statefulPodVolumePending } from "./workload";

/** Was die Auflösung vom Simulator braucht (von `Sim` erfüllt). */
export type EndpointsHost = Pick<ClusterState, "deployments" | "statefulSets" | "pvcs"> & {
  _podReady(d: Deployment): boolean;
};

/** Ein Pod hinter einem Service. `ip === null`: der Pod ist nicht eingeplant (noch ohne IP). */
export interface ServiceBackend {
  pod: string;
  ip: string | null;
  ready: boolean;
  owner: "Deployment" | "StatefulSet";
  /** Nur Deployments kennen den containerPort (aus dem Manifest). */
  containerPort?: number;
}

/** Die Pod-IP eines Pods: `null`, solange er nicht eingeplant ist (Deployment `broken: pending`,
 *  StatefulSet mit Pending-PVC), sonst die stabile `podIP(name)`. Die EINE Quelle für
 *  „eingeplant“; auch `describe pod` nutzt sie. */
export function podAddress(c: ClusterPod, pvcs: readonly PvcRes[]): string | null {
  switch (c.owner) {
    case "Deployment":
      return c.dep.broken && c.dep.broken.type === "pending" ? null : podIP(c.pod.name);
    case "StatefulSet":
      return statefulPodVolumePending(c.sts, c.pod, pvcs) ? null : podIP(c.pod.name);
  }
}

/** Gehört der Pod hinter diesen Service? Die Verdrahtung über den Namen (siehe Kopf). */
function selects(svc: ServiceRes, c: ClusterPod): boolean {
  switch (c.owner) {
    case "Deployment": return c.dep.name === svc.name;
    case "StatefulSet": return c.sts.serviceName === svc.name;
  }
}

function backendOf(host: EndpointsHost, c: ClusterPod): ServiceBackend {
  const ip = podAddress(c, host.pvcs);
  switch (c.owner) {
    case "Deployment":
      return { pod: c.pod.name, ip, ready: host._podReady(c.dep), owner: "Deployment", containerPort: c.dep.containerPort };
    case "StatefulSet":
      return { pod: c.pod.name, ip, ready: ip !== null, owner: "StatefulSet" };
  }
}

/** Alle Pods hinter einem Service, bereit oder nicht. ExternalName hat keine Pods. */
export function serviceBackends(host: EndpointsHost, svc: ServiceRes): ServiceBackend[] {
  if (isExternalNameService(svc)) return [];
  return clusterPods(host).filter(c => selects(svc, c)).map(c => backendOf(host, c));
}

/** Nur die bereiten Backends, also die echten Endpoints. */
export function readyBackends(host: EndpointsHost, svc: ServiceRes): ServiceBackend[] {
  return serviceBackends(host, svc).filter(b => b.ready);
}

/** Der Ziel-Port der Endpoints: `targetPort`, sonst der Service-Port (#164). */
export function endpointPort(svc: ServiceRes): number | string {
  return svc.targetPort !== undefined ? svc.targetPort : svc.port;
}

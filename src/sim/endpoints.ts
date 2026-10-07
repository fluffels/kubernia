/* ===== Kubernia – Service→Pod-Auflösung (sim/endpoints.ts, #1318) =====
 * Die EINE Stelle, die beantwortet: welche Pods (mit welcher IP, bereit oder nicht) stehen
 * hinter einem Service? `kubectl get endpoints`, `curl`, `nslookup` (headless + Pod-Record)
 * und die Prometheus-Scrape-Targets lesen nur noch hieraus. Selektoren sind in der Sim nicht
 * modelliert; der Name ist die Verdrahtung: das Deployment gleichen Namens plus jedes
 * StatefulSet, das den Service als `serviceName` führt (#1301). Später ändern Selektoren/
 * EndpointSlices genau diese Funktion.
 *
 * Rein lesend und Phaser-frei: nur Domänentypen aus ./state, `podIP` aus ./util und die
 * PVC-Ableitung aus ./workload; kein Rückimport nach sim.ts (kein Zyklus). Das Nachführen
 * (`_reschedulePending`/`_recheckReadiness`) bleibt bei den aufrufenden Befehlen.
 */
import type { ClusterState, Deployment, ServiceRes } from "./state";
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

/** Die Pod-IP eines Deployment-Pods (StatefulSet-Pods kennen kein `pending` und nutzen `podIP` direkt): `null`, solange das Deployment nicht eingeplant ist (`broken: pending`),
 *  sonst die stabile `podIP(name)`. Auch `describe pod` nutzt diese Stelle. */
export function podAddress(dep: Pick<Deployment, "broken">, pod: { name: string }): string | null {
  return dep.broken && dep.broken.type === "pending" ? null : podIP(pod.name);
}

/** Alle Pods hinter einem Service, bereit oder nicht. ExternalName hat keine Pods. */
export function serviceBackends(host: EndpointsHost, svc: ServiceRes): ServiceBackend[] {
  if (svc.type === "ExternalName") return [];
  const out: ServiceBackend[] = [];
  const dep = host.deployments.find(d => d.name === svc.name);
  if (dep) {
    const ready = host._podReady(dep);
    for (const p of dep.pods) {
      out.push({ pod: p.name, ip: podAddress(dep, p), ready, owner: "Deployment", containerPort: dep.containerPort });
    }
  }
  for (const sts of host.statefulSets) {
    if (sts.serviceName !== svc.name) continue;
    for (const p of sts.pods) {
      out.push({ pod: p.name, ip: podIP(p.name), ready: !statefulPodVolumePending(sts, p, host.pvcs), owner: "StatefulSet" });
    }
  }
  return out;
}

/** Nur die bereiten Backends, also die echten Endpoints. */
export function readyBackends(host: EndpointsHost, svc: ServiceRes): ServiceBackend[] {
  return serviceBackends(host, svc).filter(b => b.ready);
}

/** Der Ziel-Port der Endpoints: `targetPort`, sonst der Service-Port (#164). */
export function endpointPort(svc: ServiceRes): number | string {
  return svc.targetPort !== undefined ? svc.targetPort : svc.port;
}

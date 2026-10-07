/* ===== Kubernia – Pod-Status und Pod-Sicht (sim/podstatus.ts, #1414) =====
 * Die EINE Stelle, die aus einem `ClusterPod` den ANGEZEIGTEN Status ableitet: `get pods`,
 * `describe pod`, Welt-Kisten und HUD-Inspect lesen alle von hier. Der Status eines
 * StatefulSet-Pods kommt aus `podAddress` (eingeplant ja/nein, dieselbe Quelle wie Endpoints
 * und Metriken), nicht aus einer eigenen PVC-Abfrage. Eine neue Workload-Art ist hier eine
 * neue `switch`-Variante ohne `default`: der Rückgabetyp erzwingt die Behandlung.
 *
 * Phaser-frei (pure Domäne): ./state, ./pods (nur Typ), ./endpoints; kein Zyklus. */
import { BROKEN_STATUS, type ClusterState, type Deployment, type PodStatus } from "./state";
import type { ClusterPod } from "./pods";
import { podAddress } from "./endpoints";

/** Was die Ableitung braucht: PVCs und die Deployment-Statustabelle (Sim und KubectlHost erfüllen es). */
export type PodStatusHost = Pick<ClusterState, "pvcs"> & { _podStatus(d: Deployment): PodStatus };

/** Status, Ready und Restarts eines Pods, wie `kubectl get pods` sie zeigt. */
export function clusterPodStatus(host: PodStatusHost, c: ClusterPod): PodStatus {
  switch (c.owner) {
    case "Deployment": {
      const st = host._podStatus(c.dep);
      return { status: st.status, ready: st.ready, restarts: st.restarts || c.pod.restarts };
    }
    case "StatefulSet": {
      const pending = podAddress(c, host.pvcs) === null;
      return { status: pending ? "Pending" : "Running", ready: pending ? "0/1" : "1/1", restarts: c.pod.restarts };
    }
  }
}

/** Alles, was Welt und HUD über einen Pod zeigen. */
export interface PodView {
  name: string;
  kind: ClusterPod["owner"];
  workload: string;
  image: string;
  /** Kurzer Status für Tag/Panel (Deployment: auch „NotReady“, das `status` als Running führt). */
  label: string;
  healthy: boolean;
  restarts: number;
  created: number;
}

export function podView(host: PodStatusHost, c: ClusterPod): PodView {
  const st = clusterPodStatus(host, c);
  const healthy = st.ready === "1/1";
  const base = { name: c.pod.name as string, healthy, restarts: st.restarts, created: c.pod.created };
  switch (c.owner) {
    case "Deployment": {
      const label = !c.dep.evicted && c.dep.broken ? BROKEN_STATUS[c.dep.broken.type].label : st.status;
      return { ...base, kind: "Deployment", workload: c.dep.name, image: c.dep.image, label };
    }
    case "StatefulSet":
      return { ...base, kind: "StatefulSet", workload: c.sts.name, image: c.sts.image, label: st.status };
  }
}

/** Eine Zeile je Workload für das Tag in der Welt. */
export interface WorkloadSummary {
  kind: PodView["kind"];
  workload: string;
  firstPod: string;
  ready: number;
  total: number;
  /** Label des ersten nicht bereiten Pods, sonst `null`. */
  problem: string | null;
}

/** Gruppiert Pod-Sichten je Workload (Art + Name) in der Reihenfolge des ersten Auftretens. */
export function workloadSummaries(views: readonly PodView[]): WorkloadSummary[] {
  const out = new Map<string, WorkloadSummary>();
  for (const v of views) {
    const key = v.kind + "/" + v.workload;
    let s = out.get(key);
    if (!s) { s = { kind: v.kind, workload: v.workload, firstPod: v.name, ready: 0, total: 0, problem: null }; out.set(key, s); }
    s.total++;
    if (v.healthy) s.ready++;
    else if (s.problem === null) s.problem = v.label;
  }
  return [...out.values()];
}

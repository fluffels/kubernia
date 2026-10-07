/* ===== Kubernia – Pod-Status und Pod-Sicht (sim/podstatus.ts, #1414) =====
 * Die EINE Stelle, die aus einem `ClusterPod` den ANGEZEIGTEN Status ableitet: `get pods`,
 * `describe pod`, Welt-Kisten und HUD-Inspect lesen alle von hier. Der Status eines
 * StatefulSet-Pods kommt aus `podAddress` (eingeplant ja/nein, dieselbe Quelle wie Endpoints
 * und Metriken), nicht aus einer eigenen PVC-Abfrage. Eine neue Workload-Art ist hier eine
 * neue `switch`-Variante; `default: assertNever` erzwingt sie beim Kompilieren und wirft zur
 * Laufzeit statt still `undefined` zu liefern. Die Ableitung je Deployment (Evicted, gesund,
 * `BROKEN_STATUS`) und die Restarts-Regel stehen je genau einmal hier.
 *
 * Phaser-frei (pure Domäne): ./state, ./pods (nur Typ), ./endpoints, ../core/assert; kein Zyklus. */
import { BROKEN_STATUS, type ClusterState, type Deployment, type PodStatus } from "./state";
import { assertNever } from "../core/assert";
import type { ClusterPod } from "./pods";
import { podAddress } from "./endpoints";

/** Was die Ableitung braucht: die PVCs (Sim und KubectlHost erfüllen es). */
export type PodStatusHost = Pick<ClusterState, "pvcs">;

/** Status, Ready, Restarts und Label der Pods eines Deployments. Evicted überschreibt alles (#240):
 *  der kubelet hat den Pod beendet, er läuft nicht und ist nicht bereit. Sonst gesund oder der
 *  `BROKEN_STATUS`-Eintrag (eine Kopie: Aufrufer dürfen sie ändern). */
export function deploymentPodStatus(d: Pick<Deployment, "evicted" | "broken">): PodStatus {
  if (d.evicted) return { status: "Evicted", ready: "0/1", restarts: 0, label: "Evicted" };
  if (!d.broken) return { status: "Running", ready: "1/1", restarts: 0, label: "Running" };
  return { ...BROKEN_STATUS[d.broken.type] };
}

/** Bereit, wenn alle Container bereit sind (`n/n` mit n > 0, auch bei Sidecars). */
export function isReady(st: Pick<PodStatus, "ready">): boolean {
  const m = /^(\d+)\/(\d+)$/.exec(st.ready);
  return m !== null && m[1] === m[2] && Number(m[2]) > 0;
}

/** Status, Ready und Restarts eines Pods, wie `kubectl get pods` sie zeigt. */
export function clusterPodStatus(host: PodStatusHost, c: ClusterPod): PodStatus {
  switch (c.owner) {
    case "Deployment": {
      const st = deploymentPodStatus(c.dep);
      return { ...st, restarts: st.restarts || c.pod.restarts };
    }
    case "StatefulSet": {
      const pending = podAddress(c, host.pvcs) === null;
      const status = pending ? "Pending" : "Running";
      return { status, ready: pending ? "0/1" : "1/1", restarts: c.pod.restarts, label: status };
    }
    default:
      return assertNever(c, "clusterPodStatus");
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
  const healthy = isReady(st);
  const base = { name: c.pod.name as string, healthy, restarts: st.restarts, created: c.pod.created };
  switch (c.owner) {
    case "Deployment":
      return { ...base, kind: "Deployment", workload: c.dep.name, image: c.dep.image, label: st.label };
    case "StatefulSet":
      return { ...base, kind: "StatefulSet", workload: c.sts.name, image: c.sts.image, label: st.label };
    default:
      return assertNever(c, "podView");
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

/* ===== Kubernia – Pod-Inventar (sim/pods.ts, #1339) =====
 * Die EINE Stelle, die alle Pods des Clusters samt Besitzer aufzählt. Verbraucher
 * (`get pods`, `top`, Metriken) lesen von hier statt je eine eigene Schleife über
 * `deployments` zu führen. Eine neue Workload-Art (DaemonSet/Job) ist hier eine neue
 * Union-Variante; jeder `switch (c.owner)` ohne `default` wird dann zum Compile-Fehler
 * statt die neuen Pods still auszulassen.
 *
 * Bewusst ohne abgeleiteten Status: Laufen (Metriken), Bereitsein (Endpoints) und
 * Eingeplantsein (IP) sind verschiedene Begriffe und bleiben bei ihren Quellen.
 *
 * Phaser-frei (pure Domäne): nur Typen aus ./state, kein Zyklus. */
import type { ClusterState, Deployment, PodInstance, StatefulSetRes } from "./state";

export type ClusterPod =
  | { owner: "Deployment"; pod: PodInstance; dep: Deployment }
  | { owner: "StatefulSet"; pod: PodInstance; sts: StatefulSetRes };

/** Alle Pods: erst die der Deployments, dann die der StatefulSets, je in Array-Reihenfolge
 *  (die Reihenfolge von `kubectl get pods`). */
export function clusterPods(host: Pick<ClusterState, "deployments" | "statefulSets">): ClusterPod[] {
  const out: ClusterPod[] = [];
  for (const dep of host.deployments) for (const pod of dep.pods) out.push({ owner: "Deployment", pod, dep });
  for (const sts of host.statefulSets) for (const pod of sts.pods) out.push({ owner: "StatefulSet", pod, sts });
  return out;
}

/** Der Pod mit diesem Namen samt Besitzer, oder `undefined`. Die EINE Namensauflösung für
 *  `describe pod`, `logs`, `delete pod` und `top` (Pod-Namen sind clusterweit eindeutig). */
export function findClusterPod(host: Pick<ClusterState, "deployments" | "statefulSets">, name: string): ClusterPod | undefined {
  return clusterPods(host).find(c => c.pod.name === name);
}

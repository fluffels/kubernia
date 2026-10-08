/* ===== Kubernia – Node-Aggregat-Mutationen (sim/nodes.ts) =====
 * EIN Zuhause für das Cluster-**Node**-Aggregat, analog zu workload.ts für Deployments/
 * StatefulSets (#478/#488/#508). Angelegt für #534 (iSAQB-Domänen-Analyse, Nachtrag
 * Rest-Sim-Familien): die Node-Provisionierung war über vier Dateien dupliziert –
 * `terraform.ts` (apply hafen_server/hafen_cluster), `kubeadm.ts` (init/join), plus die
 * Control-Plane-Rollen-Prüfung in `observability.ts`/`eviction.ts` –, jeweils mit rohem
 * `nodes.push({name,status:"Ready",roles,version})`, einer inline wiederholten K8s-Version
 * und ZWEI verschiedenen Schreibweisen für „ist Control-Plane?". Das reproduziert sich bei
 * Stardew-Scope (mehr Aufbau-Quests/Cluster-Topologien) – darum die EINE Stelle hier.
 *
 * Reine Domäne: hängt nur an den Domänentypen aus ./state, ./util und core/rng – kein Phaser, kein Rückimport
 * nach sim.ts (kein Zyklus), vom Architektur-Wächter (#347) als Domäne geschützt und im
 * Node-Test prüfbar.
 */
import type { ClusterNode } from "./state";
import { hashStr } from "../core/rng";
import { CONTROL_PLANE_IP } from "./util";

/** Einheitliche Kubernetes-Version aller simulierten Knoten. EINE Wahrheit statt der
 *  inline wiederholten `"v1.30.2"` in kubeadm/terraform/sim-Default (#534). */
export const NODE_VERSION = "v1.30.2";

/** Ist dieser Knoten (auch) eine Control-Plane? Das EINE Rollen-Prädikat (#534) – vorher
 *  gab es zwei Schreibweisen nebeneinander (`/control-plane/.test(n.roles)` in kubeadm/
 *  terraform vs. `.roles.includes("control-plane")` in observability/eviction). Ein Knoten
 *  kann mehrere kommagetrennte Rollen tragen, darum `includes` statt Gleichheit. */
export function isControlPlane(node: ClusterNode): boolean {
  return node.roles.includes("control-plane");
}

/** Nimmt einen Knoten **idempotent per Name** in den Cluster auf – der EINE Eintrittspunkt
 *  (Pendant zu `addDeployment` in workload.ts). Fehlende Felder bekommen die Cluster-
 *  Defaults (Worker `roles:"<none>"`, `status:"Ready"`, `version:NODE_VERSION`); `spec`
 *  überschreibt sie. Ein bereits vorhandener Knoten gleichen Namens bleibt unverändert –
 *  spiegelt das `if (!nodes.some(n => n.name === name)) nodes.push(...)`-Idiom, das vorher
 *  an jeder Anlege-Stelle stand. Gibt den neu angelegten Knoten zurück, oder `undefined`,
 *  wenn schon einer dieses Namens existierte (der Aufrufer unterscheidet daran „neu" von
 *  „war schon da"). */
export function provisionNode(
  state: { nodes: ClusterNode[] },
  spec: Partial<ClusterNode> & { name: string },
): ClusterNode | undefined {
  if (state.nodes.some(n => n.name === spec.name)) return undefined;
  const node: ClusterNode = { status: "Ready", roles: "<none>", version: NODE_VERSION, ...spec };
  state.nodes.push(node);
  return node;
}

/** Entfernt einen Knoten (per Name) aus dem Cluster – der EINE Austrittspunkt (spiegelt
 *  `removeDeployment`). Gibt den entfernten Knoten zurück, oder `undefined`, wenn keiner
 *  passt (der Aufrufer unterscheidet daran „entfernt" von „nicht gefunden"). Bewusst
 *  Per-Member: das komplette Leeren des Node-Aggregats auf „bare metal" (kubeadm reset,
 *  terraform destroy eines ganzen Clusters) bleibt eine distinkte „Aggregat leeren"-
 *  Semantik und läuft weiterhin roh (`nodes.length = 0`), analog zur bewussten
 *  Entscheidung für StatefulSets in #508. */
export function removeNode(state: { nodes: ClusterNode[] }, name: string): ClusterNode | undefined {
  const idx = state.nodes.findIndex(n => n.name === name);
  if (idx < 0) return undefined;
  return state.nodes.splice(idx, 1)[0];
}

/** Node-Adresse (`INTERNAL-IP` in `get nodes -o wide`). Die Control-Plane trägt `CONTROL_PLANE_IP` (die Adresse,
 *  die `kubeadm join` nennt); ein Worker bekommt eine aus dem Namen abgeleitete Adresse im Node-Netz 10.0.0.0/16
 *  (drittes Oktett ab 1, nie 10.0.0.10; kein Überlapp mit Pods 10.244/16, Services 10.96/16, 203.0.113/24).
 *  Abgeleitet statt gespeichert: kein Save-Format, nach `kubeadm reset` und erneutem join dieselbe Adresse.
 *  Grenze: mehrere Control-Planes (HA) teilten sich die CP-Adresse; das modelliert die Sim heute nicht. */
export function nodeInternalIP(node: ClusterNode): string {
  if (isControlPlane(node)) return CONTROL_PLANE_IP;
  const h = hashStr(node.name);
  return "10.0." + (1 + (h % 254)) + "." + (10 + ((h >>> 8) % 240));
}

/** Systeminfo aller simulierten Knoten (`OS-IMAGE`, `KERNEL-VERSION`, `CONTAINER-RUNTIME`): eine Quelle neben
 *  `NODE_VERSION`, damit `get nodes -o wide` und künftig `describe node` dieselben Werte zeigen. */
export const NODE_SYSTEM_INFO = Object.freeze({
  osImage: "Ubuntu 22.04.4 LTS",
  kernelVersion: "5.15.0-112-generic",
  containerRuntimeVersion: "containerd://1.7.18",
});

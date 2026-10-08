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
 * Reine Domäne: hängt nur an den Domänentypen aus ./state und core/rng – kein Phaser, kein Rückimport
 * nach sim.ts (kein Zyklus), vom Architektur-Wächter (#347) als Domäne geschützt und im
 * Node-Test prüfbar.
 */
import type { ClusterNode, NodeSpec } from "./state";
import { hashStr } from "../core/rng";

/** Adresse und Name der Control-Plane: kubeadm-Static-Pods laufen mit hostNetwork und teilen sich ihre IP (#1466);
 *  dieselbe Adresse nennt `kubeadm join` als API-Server. */
export const CONTROL_PLANE_IP = "10.0.0.10";
export const CONTROL_PLANE_NODE = "ahoi-control";

/** Namenskonvention der Worker (`ahoi-worker-<n>`, ab 1): die EINE der Sim (#1483). */
const WORKER_PREFIX = "ahoi-worker-";
export const workerNodeName = (n: number): string => WORKER_PREFIX + n;

/** Umkehrung von `workerNodeName`: der Index n (ab 1) eines Namens der Konvention, sonst `undefined`
 *  (`ahoi-worker-0`, `-01`, `-x`, `-1.5`, Namen ohne Präfix und unsichere Ganzzahlen zählen nicht). */
export function workerIndex(name: string): number | undefined {
  if (!name.startsWith(WORKER_PREFIX)) return undefined;
  const rest = name.slice(WORKER_PREFIX.length);
  if (!/^[1-9]\d*$/.test(rest)) return undefined;
  const n = Number(rest);
  return Number.isSafeInteger(n) ? n : undefined;
}

/** Einheitliche Kubernetes-Version aller simulierten Knoten. EINE Wahrheit statt der
 *  inline wiederholten `"v1.30.2"` in kubeadm/terraform/sim-Default (#534). */
export const NODE_VERSION = "v1.37.1";

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
  spec: NodeSpec,
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

/** Kapazität der Konventions-Adressen: 240 Hosts je /24 (.10-.249), dritte Oktette 1-127. */
const WORKER_IP_SLOTS = 127 * 240;

/** Node-Adresse (`INTERNAL-IP` in `get nodes -o wide`). Die Control-Plane trägt `CONTROL_PLANE_IP` (die Adresse,
 *  die `kubeadm join` nennt); `10.0.0.x` bleibt ihr vorbehalten. Ein Worker der Namenskonvention (`workerIndex`)
 *  bekommt eine aus dem Index abgeleitete Adresse, die bis 30.480 Knoten eindeutig ist (`ahoi-worker-1` → 10.0.1.10);
 *  jeder andere Name fällt auf einen Hash im getrennten Bereich 10.0.128-254 (Kollisionen dort möglich, aber nie
 *  mit der Konvention). Kein Überlapp mit Pods 10.244/16, Services 10.96/16, 203.0.113/24.
 *  Abgeleitet statt gespeichert: kein Save-Format, nach `kubeadm reset` und erneutem join dieselbe Adresse.
 *  Grenze: mehrere Control-Planes (HA) teilten sich die CP-Adresse; das modelliert die Sim heute nicht. */
export function nodeInternalIP(node: ClusterNode): string {
  if (isControlPlane(node)) return CONTROL_PLANE_IP;
  const i = workerIndex(node.name);
  if (i !== undefined && i <= WORKER_IP_SLOTS) return "10.0." + (1 + Math.floor((i - 1) / 240)) + "." + (10 + ((i - 1) % 240));
  const h = hashStr(node.name);
  return "10.0." + (128 + (h % 127)) + "." + (10 + ((h >>> 8) % 240));
}

/** Systeminfo aller simulierten Knoten (`OS-IMAGE`, `KERNEL-VERSION`, `CONTAINER-RUNTIME`): eine Quelle neben
 *  `NODE_VERSION`, damit `get nodes -o wide` und künftig `describe node` dieselben Werte zeigen. */
export const NODE_SYSTEM_INFO = Object.freeze({
  osImage: "Ubuntu 22.04.4 LTS",
  kernelVersion: "5.15.0-112-generic",
  /** Seit Kubernetes v1.36 hängt `get nodes -o wide` die Architektur an die KERNEL-VERSION (#132402). */
  architecture: "amd64",
  /** containerd 1.x wird ab Kubernetes v1.36 nicht mehr unterstützt; 2.3 ist die LTS-Linie (bis 04/2028). */
  containerRuntimeVersion: "containerd://2.3.6",
  operatingSystem: "linux",
});

/** Knoten für den gespeicherten Schnappschuss: ohne `created` (Sim-Tick des Beitritts gilt nur im laufenden Lauf;
 *  nach dem Laden zählt der Takt ab 0, ein gespeicherter Stempel ergäbe ein negatives Alter) und ohne `version`,
 *  solange sie `NODE_VERSION` ist (#1496): sonst bliebe die Version eines alten Stands für immer im Spielstand und
 *  die Knoten folgten nie einer neuen Sim-Version. Eine bewusste Abweichung bleibt erhalten. */
export function nodeSnapshot(node: ClusterNode): NodeSpec {
  const { created: _created, version, ...rest } = node;
  return version === NODE_VERSION ? rest : { ...rest, version };
}

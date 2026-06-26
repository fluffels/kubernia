/* ===== KubeQuest – Ephemeral Storage & Eviction (sim/eviction.ts, #240) =====
 * Die flüchtige-Speicher-Mechanik des Simulators: emptyDir + Container-Writable-Layer
 * zählen als ephemeral storage auf Pod und Node. Zwei deterministische Eviction-Auslöser,
 * genau wie in echtem Kubernetes:
 *   1. **Pod-Limit gesprengt:** belegt ein Pod mehr ephemeral storage als sein eigenes Limit,
 *      evictet ihn der kubelet sofort (unabhängig vom Node).
 *   2. **Node-Disk voll:** überschreitet die belegte Disk eines Knotens dessen Kapazität, setzt
 *      der kubelet die Condition DiskPressure und evictet Pods, bis wieder Platz ist – zuerst die
 *      ohne Limit (BestEffort), dann die größten Verbraucher.
 *
 * Phaser-frei (pure Domäne): rechnet nur auf dem Cluster-Zustand (`nodes`/`deployments`). Wird
 * von der Sim-Klasse aus `exec()` + `reset()` aufgerufen (analog `reconcileAutoSync` aus argocd)
 * und über dünne Delegations-Methoden dem `KubectlHost`-Interface zugänglich gemacht (#240).
 */
import type { ClusterNode, Deployment } from "./state";

/** Der minimale Zustand, den die Eviction-Auswertung braucht (von der Sim-Klasse erfüllt). */
export interface EvictionHost {
  nodes: ClusterNode[];
  deployments: Deployment[];
}

/** Wie viel flüchtigen Speicher die Pods eines Deployments belegen (Mi): emptyDir +
 *  Container-Writable-Layer/Logs. Genau das zählt gegen das ephemeral-storage-Limit des
 *  Pods UND gegen die Disk des Knotens. */
export function depEphemeralUsed(d: Deployment): number {
  return (d.emptyDir?.usedMi || 0) + (d.ephemeralUsedMi || 0);
}

/** Auf welchem Knoten die Pods eines Deployments laufen: ein gesetzter `node`-Pin gewinnt,
 *  sonst deterministisch round-robin über die Worker (kein Zufall – per Deployment-Index).
 *  Ohne Worker fällt es auf den ersten Knoten zurück. */
export function nodeOf(host: EvictionHost, d: Deployment): string {
  if (d.node && host.nodes.some(n => n.name === d.node)) return d.node;
  const workers = host.nodes.filter(n => !n.roles.includes("control-plane"));
  if (workers.length === 0) return host.nodes[0]?.name || "";
  const idx = host.deployments.indexOf(d);
  return workers[(idx < 0 ? 0 : idx) % workers.length].name;
}

/** Aktuell belegte Disk eines Knotens (Mi): System-Baseline + ephemeral-Nutzung aller NICHT
 *  evicteten Pods, die hier laufen. Evictete Pods geben ihren Platz frei. */
export function nodeEphemeralUsed(host: EvictionHost, nodeName: string): number {
  let used = host.nodes.find(n => n.name === nodeName)?.ephemeralBaseMi || 0;
  for (const d of host.deployments) {
    if (!d.evicted && nodeOf(host, d) === nodeName) used += depEphemeralUsed(d);
  }
  return used;
}

/** Leitet DiskPressure (je Node) und Evicted (je Pod) deterministisch aus dem aktuellen Zustand
 *  ab – läuft vor jedem Befehl (exec) und am Ende von reset(). Rein abgeleitet: fällt der Grund
 *  weg (Limit erhöht / Disk freigegeben / Pod neugestartet), verschwindet die Markierung wieder. */
export function evaluateEviction(host: EvictionHost) {
  for (const n of host.nodes) n.diskPressure = false;
  for (const d of host.deployments) d.evicted = null;

  // (1) Eigenes ephemeral-storage-Limit gesprengt → Pod evicted.
  for (const d of host.deployments) {
    if (d.ephemeralLimit === undefined) continue;
    const used = depEphemeralUsed(d);
    if (used > d.ephemeralLimit) {
      d.evicted = { reason: "Pod ephemeral local storage usage exceeds the total limit of containers " + d.ephemeralLimit + "Mi (verbraucht " + used + "Mi)." };
    }
  }

  // (2) Node-Disk über Kapazität → DiskPressure + Eviction der hiesigen Pods.
  for (const node of host.nodes) {
    if (node.ephemeralCapacityMi === undefined) continue; // unbegrenzt → nie Druck
    let used = nodeEphemeralUsed(host, node.name);
    if (used < node.ephemeralCapacityMi) continue;
    node.diskPressure = true;
    // Reihenfolge der Opfer: BestEffort (kein Limit) zuerst, dann größter Verbraucher, dann Name.
    const here = host.deployments
      .filter(d => !d.evicted && nodeOf(host, d) === node.name)
      .sort((a, b) => {
        const al = a.ephemeralLimit === undefined ? 0 : 1, bl = b.ephemeralLimit === undefined ? 0 : 1;
        if (al !== bl) return al - bl;
        const diff = depEphemeralUsed(b) - depEphemeralUsed(a);
        if (diff !== 0) return diff;
        return a.name < b.name ? -1 : 1;
      });
    for (const v of here) {
      if (used < node.ephemeralCapacityMi) break;
      v.evicted = { reason: "The node was low on resource: ephemeral-storage. Threshold quantity: " + node.ephemeralCapacityMi + "Mi, node " + node.name + "." };
      used -= depEphemeralUsed(v);
    }
  }
}

/** Gibt den flüchtigen Speicher eines Pods frei (emptyDir + Writable-Layer): bei jedem
 *  Pod-Neustart (delete pod / rollout restart) ist das Scratch-Volume leer – das ist der Kern
 *  von emptyDir („weg, sobald der Pod weg ist"). PVCs überleben dagegen (#122). */
export function resetEphemeral(d: Deployment) {
  if (d.emptyDir) d.emptyDir = { data: "", usedMi: 0 };
  if (d.ephemeralUsedMi) d.ephemeralUsedMi = 0;
}

/* ===== Kubernia – kubectl top (sim/kubectl/top.ts) =====
 * `top pods|nodes` (Pod-/Node-Metriken, #109). Die Observability-Mechanik (podMetrics/nodeMetrics)
 * liegt in ../observability.ts, `top` liest sie nur über das Host-Interface.
 *
 * Phaser-frei (pure Domäne).
 */
import { table } from "../util";
import type { KubectlHost } from "./host";
import { DEFAULT_NAMESPACE } from "../state";
import { resolveKind } from "./resources";
import { positionals } from "./args";
import { findClusterPod } from "../pods";
import { noResourcesIn } from "./inspect";

export function kubectlTop(host: KubectlHost, t: string[]) {
  const [what = "", name = null] = positionals("top", t);
  const kind = resolveKind(what)?.plural;
  host._reschedulePending();
  host._recheckReadiness();

  if (kind === "pods") {
    let rows = host.podMetrics();
    if (name) {
      rows = rows.filter(r => r.name === name);
      if (rows.length === 0) {
        const exists = findClusterPod(host, name) !== undefined;
        return exists
          ? host._err("error: Metrics not available for pod " + DEFAULT_NAMESPACE + "/" + name, "Metriken gibt es nur für laufende Pods – Status prüfen mit 'kubectl get pods'.")
          : host._err('Error from server (NotFound): pods "' + name + '" not found', "Pod-Namen siehst du mit 'kubectl get pods'.");
      }
    }
    if (rows.length === 0) return noResourcesIn();
    return table(["NAME", "CPU(cores)", "MEMORY(bytes)"], rows.map(r => [r.name, r.cpuMilli + "m", r.memMi + "Mi"]));
  }

  if (kind === "nodes") {
    let nodes = host.nodeMetrics();
    if (name) {
      nodes = nodes.filter(nd => nd.name === name);
      if (nodes.length === 0) return host._err('Error from server (NotFound): nodes "' + name + '" not found', "Node-Namen siehst du mit 'kubectl get nodes'.");
    }
    return table(["NAME", "CPU(cores)", "CPU%", "MEMORY(bytes)", "MEMORY%"],
      nodes.map(nd => [nd.name, nd.cpuMilli + "m", nd.cpuPct + "%", nd.memMi + "Mi", nd.memPct + "%"]));
  }

  if (!what) return host._err("kubectl top: pods oder nodes?", "z.B. 'kubectl top pods' oder 'kubectl top nodes'");
  // Echtes `kubectl top` kennt nur pod und node als Unterbefehle, alles andere ist ein unbekannter Befehl.
  return host._err('error: unknown command "' + what + '" for "kubectl top"', "z.B. 'kubectl top nodes'");
}

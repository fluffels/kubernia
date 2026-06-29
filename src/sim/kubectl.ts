/* ===== KubeQuest – kubectl-Befehlsfamilie (sim/kubectl.ts) =====
 * Dünner Dispatch-Barrel der kompletten `kubectl`-Familie. Die eigentliche Logik
 * liegt seit #397 in fokussierten Unterfamilien unter src/sim/kubectl/ (analog zum
 * sim.ts-Split #346 und zum WorldScene.ts-Split #393) – kleine, je-für-sich testbare
 * Module statt eines 1220-LOC-God-Files (Befund #390):
 *   - kubectl/inspect.ts   – get / describe / top / logs (lesend)
 *   - kubectl/lifecycle.ts – create / apply -f / delete (Ressourcen-Lebenszyklus)
 *   - kubectl/ops.ts       – scale / expose / set / rollout (laufende Workloads tunen)
 *   - kubectl/security.ts  – auth can-i (RBAC #126) + label (Pod-Security #128)
 *   - kubectl/host.ts      – das schmale KubectlHost-Interface (von der Sim-Klasse erfüllt)
 *
 * Phaser-frei (pure Domäne): kein Rückimport nach sim.ts (kein Zyklus). Aufgerufen aus
 * dem `exec`-Dispatch in `sim.ts` per `kubectlCommand(this, …)`.
 */
import { kubectlGet, kubectlDescribe, kubectlTop, kubectlLogs } from "./kubectl/inspect";
import { kubectlCreate, kubectlApply, kubectlDelete } from "./kubectl/lifecycle";
import { kubectlScale, kubectlExpose, kubectlSet, kubectlRollout } from "./kubectl/ops";
import { kubectlAuth, kubectlLabel } from "./kubectl/security";
import type { KubectlHost } from "./kubectl/host";

// KubectlHost bleibt über den gewohnten Pfad (./sim/kubectl) erreichbar.
export type { KubectlHost } from "./kubectl/host";

export function kubectlCommand(host: KubectlHost, t: string[], raw: string): string {
  // Aufbau-Bogen (#460): Ohne laufende Control-Plane gibt es keinen apiserver, an den kubectl
  // sich wenden könnte – genau wie in echtem Kubernetes vor `kubeadm init`. Das Gate sitzt hier,
  // damit es ALLE kubectl-Unterbefehle gleichermaßen trifft. Im laufenden Cluster (Default
  // up:true) bleibt alles unverändert.
  if (!host.controlPlane.up) {
    return host._err(
      "The connection to the server localhost:8080 was refused - did you specify the right host or port?",
      "Es läuft noch keine Control-Plane. Zieh sie zuerst mit 'kubeadm init' hoch.");
  }
  const sub = t[1];
  if (!sub) return host._err("kubectl: Unterbefehl fehlt.", "Probier z.B. 'kubectl get pods'.");

  if (sub === "get") return kubectlGet(host, t);
  if (sub === "describe") return kubectlDescribe(host, t);
  if (sub === "create") return kubectlCreate(host, t, raw);
  if (sub === "scale") return kubectlScale(host, t, raw);
  if (sub === "expose") return kubectlExpose(host, t, raw);
  if (sub === "delete") return kubectlDelete(host, t);
  if (sub === "apply") return kubectlApply(host, t);
  if (sub === "logs") return kubectlLogs(host, t);
  if (sub === "top") return kubectlTop(host, t);
  if (sub === "set") return kubectlSet(host, t, raw);
  if (sub === "rollout") return kubectlRollout(host, t);
  if (sub === "auth") return kubectlAuth(host, t, raw);
  if (sub === "label") return kubectlLabel(host, t, raw);

  return host._err("kubectl: unbekannter Unterbefehl '" + sub + "'", "Tippe 'help' für alle Befehle.");
}

/* ===== Kubernia – kubectl-Befehlsfamilie (sim/kubectl.ts) =====
 * Dünner Dispatch-Barrel der kompletten `kubectl`-Familie. Die eigentliche Logik
 * liegt seit #397 in fokussierten Unterfamilien unter src/sim/kubectl/ (analog zum
 * sim.ts-Split #346 und zum WorldScene.ts-Split #393) – kleine, je-für-sich testbare
 * Module statt eines 1220-LOC-God-Files (Befund #390):
 *   - kubectl/get.ts       – get (Anfrage lesen: Komma-Liste, all, typ/name, Namensfilter)
 *   - kubectl/inspect.ts   – die get-Renderer je Ressourcentyp + describe / top / logs (lesend)
 *   - kubectl/args.ts      – Flag-Tabelle je Unterbefehl, Parser, der eine „nicht simuliert“-Text (#1444)
 *   - kubectl/resources.ts – die Ressourcentyp-Registry (Plural, Singular, echte Kurznamen)
 *   - kubectl/lifecycle.ts – create / apply -f / delete (Ressourcen-Lebenszyklus)
 *   - kubectl/ops.ts       – scale / expose / set / rollout (laufende Workloads tunen)
 *   - kubectl/security.ts  – auth can-i (RBAC #126) + label (Pod-Security #128)
 *   - kubectl/host.ts      – das schmale KubectlHost-Interface (von der Sim-Klasse erfüllt)
 *
 * Phaser-frei (pure Domäne): kein Rückimport nach sim.ts (kein Zyklus). Aufgerufen aus
 * dem `exec`-Dispatch in `sim.ts` per `kubectlCommand(this, …)`.
 */
import { kubectlDescribe, kubectlTop, kubectlLogs } from "./kubectl/inspect";
import { kubectlGet } from "./kubectl/get";
import { checkArgs, isKubectlSub, notSimulated, KUBECTL_SUBS, REAL_KUBECTL_COMMANDS, type KubectlSub } from "./kubectl/args";
import { kubectlCreate, kubectlApply, kubectlDelete } from "./kubectl/lifecycle";
import { kubectlScale, kubectlExpose, kubectlSet, kubectlRollout } from "./kubectl/ops";
import { kubectlAuth, kubectlLabel } from "./kubectl/security";
import type { KubectlHost } from "./kubectl/host";

// KubectlHost bleibt über den gewohnten Pfad (./sim/kubectl) erreichbar.
export type { KubectlHost } from "./kubectl/host";

/** Ein kubectl-Unterbefehl-Handler. Alle bekommen dieselbe Signatur (host, t, raw);
 *  wer `raw` nicht braucht, ignoriert es einfach. So ist der Dispatch eine reine
 *  Tabelle statt einer if-Kette – ein neuer Unterbefehl = ein Eintrag (Stardew-Scope:
 *  der Dispatcher wächst nicht in der Komplexität, egal wie viele Unterbefehle dazukommen). */
type SubCommand = (host: KubectlHost, t: string[], raw: string) => string;

const SUBCOMMANDS: Readonly<Record<KubectlSub, SubCommand>> = {
  get: (host, t) => kubectlGet(host, t),
  describe: (host, t) => kubectlDescribe(host, t),
  create: (host, t, raw) => kubectlCreate(host, t, raw),
  scale: (host, t, raw) => kubectlScale(host, t, raw),
  expose: (host, t, raw) => kubectlExpose(host, t, raw),
  delete: (host, t) => kubectlDelete(host, t),
  apply: (host, t) => kubectlApply(host, t),
  logs: (host, t) => kubectlLogs(host, t),
  top: (host, t) => kubectlTop(host, t),
  set: (host, t, raw) => kubectlSet(host, t, raw),
  rollout: (host, t) => kubectlRollout(host, t),
  auth: (host, t, raw) => kubectlAuth(host, t, raw),
  label: (host, t, raw) => kubectlLabel(host, t, raw),
};

/** Unbekannter erster Token: ein echter kubectl-Befehl, den die Sim nicht kann, ist „nicht simuliert“,
 *  alles andere ein echter Tippfehler (wie `unknown command` in kubectl). */
function unknownSub(host: KubectlHost, sub: string): string {
  const kann = ["kubectl " + KUBECTL_SUBS.join(", ")];
  if (sub.startsWith("-")) return notSimulated(host, "das Flag '" + sub + "' vor dem Unterbefehl.", kann, "Setz Flags hinter den Unterbefehl, z.B. 'kubectl get pods -n kube-system'.");
  if (REAL_KUBECTL_COMMANDS.includes(sub)) return notSimulated(host, "'kubectl " + sub + "'.", kann);
  return host._err('error: unknown command "' + sub + '" for "kubectl"', "Tippe 'help' für alle Befehle.");
}

/** Die registrierten Unterbefehle (Treue-Matrix, docs/sim-treue/: ein neuer Unterbefehl braucht eine Zeile). */
export const KUBECTL_SUBCOMMANDS: readonly string[] = Object.keys(SUBCOMMANDS);

export function kubectlCommand(host: KubectlHost, t: string[], raw: string): string {
  // Eingabe-Prüfung zuerst: unbekannter Unterbefehl und unbekannte Flags prüft auch echtes kubectl
  // clientseitig, noch bevor es den apiserver fragt (also vor dem Control-Plane-Gate).
  const sub = t[1];
  const known = sub !== undefined && isKubectlSub(sub) ? sub : undefined;
  if (sub && !known) return unknownSub(host, sub);
  const badArgs = known ? checkArgs(host, known, t) : null;
  if (badArgs) return badArgs;
  // Aufbau-Bogen (#460): Ohne laufende Control-Plane gibt es keinen apiserver, an den kubectl
  // sich wenden könnte – genau wie in echtem Kubernetes vor `kubeadm init`. Das Gate sitzt hier,
  // damit es ALLE kubectl-Unterbefehle gleichermaßen trifft. Im laufenden Cluster (Default
  // up:true) bleibt alles unverändert.
  if (!host.controlPlane.up) {
    return host._err(
      "The connection to the server localhost:8080 was refused - did you specify the right host or port?",
      "Es läuft noch keine Control-Plane. Zieh sie zuerst mit 'kubeadm init' hoch.");
  }
  if (!known) return host._err("kubectl: Unterbefehl fehlt.", "Probier z.B. 'kubectl get pods'.");
  return SUBCOMMANDS[known](host, t, raw);
}

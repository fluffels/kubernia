/* ===== Kubernia – kubectl-Befehlsfamilie (sim/kubectl.ts) =====
 * Dünner Dispatch-Barrel der kompletten `kubectl`-Familie. Die eigentliche Logik
 * liegt seit #397 in fokussierten Unterfamilien unter src/sim/kubectl/ (analog zum
 * sim.ts-Split #346 und zum WorldScene.ts-Split #393) – kleine, je-für-sich testbare
 * Module statt eines 1220-LOC-God-Files (Befund #390):
 *   - kubectl/targets.ts   – der EINE Ziel-Leser (typ a b, typ/name, Komma-Liste, all) für get, describe, delete, scale, rollout
 *   - kubectl/get.ts       – get (Namespace-Wache, Namensfilter, Zusammensetzen)
 *   - kubectl/inspect.ts   – die get-Renderer je Ressourcentyp (lesend)
 *   - kubectl/describe.ts  – describe: Dispatcher (ohne Namen, Namenspräfix) + Renderer-Registry (Pod: describe-pod.ts)
 *   - kubectl/top.ts, kubectl/logs.ts – top (Metriken) und logs
 *   - kubectl/args.ts      – Flag-Tabelle je Unterbefehl, Parser, Wertprüfer, der eine „nicht simuliert“-Text (#1444)
 *   - kubectl/resources.ts – die Ressourcentyp-Registry (Plural, Singular, echte Kurznamen)
 *   - kubectl/lifecycle.ts – create / apply -f / delete (Ressourcen-Lebenszyklus)
 *   - kubectl/ops.ts       – scale / expose / set / rollout (laufende Workloads tunen)
 *   - kubectl/security.ts  – auth can-i (RBAC #126) + label (Pod-Security #128)
 *   - kubectl/host.ts      – das schmale KubectlHost-Interface (von der Sim-Klasse erfüllt)
 *
 * Phaser-frei (pure Domäne): kein Rückimport nach sim.ts (kein Zyklus). Aufgerufen aus
 * dem `exec`-Dispatch in `sim.ts` per `kubectlCommand(this, …)`.
 */
import { kubectlTop } from "./kubectl/top";
import { kubectlLogs } from "./kubectl/logs";
import { kubectlDescribe } from "./kubectl/describe";
import { kubectlGet } from "./kubectl/get";
import {
  FILE, FLAG_HINTS, FROM_FLAG, LIMITS_FLAG, LITERAL_FLAG, NS, PORT_FLAG, REAL_KUBECTL_COMMANDS, REQUESTS_FLAG, REVISION_FLAG,
  SERVICEACCOUNT_FLAG,
} from "./kubectl/args";
import { OUTPUT_FLAG } from "./kubectl/output";
import { kubectlCreate, kubectlApply, kubectlDelete } from "./kubectl/lifecycle";
import { kubectlScale, kubectlExpose, kubectlSet, kubectlRollout } from "./kubectl/ops";
import { kubectlAuth, kubectlLabel } from "./kubectl/security";
import { dispatchSub, flag, type Call, type Dispatch, type SubEntry } from "./cliargs";
import type { KubectlHost } from "./kubectl/host";

// KubectlHost bleibt über den gewohnten Pfad (./sim/kubectl) erreichbar.
export type { KubectlHost } from "./kubectl/host";

/** Ein kubectl-Unterbefehl-Handler. Alle bekommen dieselbe Signatur (host, c): der Dispatcher parst die Zeile EINMAL
 *  (`dispatchSub`), Flags und Positionsargumente liest nur der `Call` (#1488); die Rohzeile bekommt keiner. So ist
 *  der Dispatch eine reine Tabelle statt einer if-Kette – ein neuer Unterbefehl = ein Eintrag (Stardew-Scope:
 *  der Dispatcher wächst nicht in der Komplexität, egal wie viele Unterbefehle dazukommen). */
type SubCommand = (host: KubectlHost, c: Call) => string;

/** Die Dispatch-Tabelle: Handler + die Flags, die die Sim je Unterbefehl auswertet (`-n/--namespace` gilt überall, die
 *  Semantik regelt namespace.ts). `real` (alle echten Top-Level-Befehle) macht „kenne ich, kann ich nicht“ zu
 *  „Nicht simuliert“; alles andere ist ein Tippfehler wie `unknown command` in kubectl. */
export const KUBECTL: Dispatch<SubEntry<SubCommand>> = {
  cmd: "kubectl",
  table: {
    get: { run: kubectlGet, flags: [NS, flag(false, "-A", "--all-namespaces"), OUTPUT_FLAG] },
    describe: { run: kubectlDescribe, flags: [NS] },
    create: {
      run: kubectlCreate,
      flags: [
        NS, LITERAL_FLAG, SERVICEACCOUNT_FLAG,
        ...["--image", "--replicas", "--cert", "--key", "--verb", "--resource", "--role", "--clusterrole", "--user"].map(n => flag(true, n)),
      ],
    },
    scale: { run: kubectlScale, flags: [NS, flag(true, "--replicas")] },
    expose: { run: kubectlExpose, flags: [NS, PORT_FLAG, flag(true, "--target-port"), flag(true, "--type")] },
    delete: { run: kubectlDelete, flags: [NS, FILE] },
    apply: { run: kubectlApply, flags: [NS, FILE] },
    logs: { run: kubectlLogs, flags: [NS, flag(false, "-f", "--follow"), flag(false, "-p", "--previous")] },
    top: { run: kubectlTop, flags: [NS] },
    set: { run: kubectlSet, flags: [NS, FROM_FLAG, LIMITS_FLAG, REQUESTS_FLAG] },
    rollout: { run: kubectlRollout, flags: [NS, REVISION_FLAG] },
    auth: { run: kubectlAuth, flags: [NS, flag(true, "--as")] },
    label: { run: kubectlLabel, flags: [NS, flag(false, "--overwrite")] },
  },
  real: REAL_KUBECTL_COMMANDS,
  hints: FLAG_HINTS,
  unknown: sub => 'error: unknown command "' + sub + '" for "kubectl"',
};

/** Die registrierten Unterbefehle (Treue-Matrix, docs/sim-treue/: ein neuer Unterbefehl braucht eine Zeile). */
export const KUBECTL_SUBCOMMANDS: readonly string[] = Object.keys(KUBECTL.table);

export function kubectlCommand(host: KubectlHost, t: string[]): string {
  // Eingabe-Prüfung zuerst: unbekannter Unterbefehl und unbekannte Flags prüft auch echtes kubectl
  // clientseitig, noch bevor es den apiserver fragt (also vor dem Control-Plane-Gate).
  const r = dispatchSub(host, KUBECTL, t, 1);
  if (typeof r === "string") return r;
  // Aufbau-Bogen (#460): Ohne laufende Control-Plane gibt es keinen apiserver, an den kubectl
  // sich wenden könnte – genau wie in echtem Kubernetes vor `kubeadm init`. Das Gate sitzt hier,
  // damit es ALLE kubectl-Unterbefehle gleichermaßen trifft. Im laufenden Cluster (Default
  // up:true) bleibt alles unverändert.
  if (!host.controlPlane.up) {
    return host._err(
      "The connection to the server localhost:8080 was refused - did you specify the right host or port?",
      "Es läuft noch keine Control-Plane. Zieh sie zuerst mit 'kubeadm init' hoch.");
  }
  return r.entry.run(host, r.call);
}

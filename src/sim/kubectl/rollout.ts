/* ===== Kubernia – der eine Weg „neue Deployment-Pods erzeugen“ (sim/kubectl/rollout.ts, #1327) =====
 * Jeder kubectl-Befehl, der Pods eines Deployments neu erzeugt (apply, set image, scale hoch,
 * rollout restart, die Heil-Rollouts von set resources, create deployment), geht hier durch:
 * ERST die Pod-Security-Admission, DANN die Mutation, DANN der Rollout. Wird abgewiesen, bleibt
 * alles unverändert (Forbidden wie beim Anlegen; die Sim kennt kein Soll≠Ist, Invariante 1).
 *
 * Bewusst AUSGENOMMEN: die Selbstheilung beim `delete pod` (`replaceDeploymentPod` in ./lifecycle) –
 * ein abgewiesener Ersatz-Pod bräche Invariante 1. Ein Fitness-Test (test/sim/rollout-admission.test.ts)
 * hält `replacePods`/`scaleDeployment`/`admitPod` in src/sim/kubectl/ außerhalb dieser Datei bei null.
 *
 * Phaser-frei (pure Domäne): hängt nur an ../workload, ./security und ./host (Typ). */
import type { Deployment, PodSecurityLevel, SecurityContext } from "../state";
import { ensureReplicaSet, replacePods, scaleDeployment } from "../workload";
import { admitPod, podSecurityViolations } from "./security";
import type { KubectlHost } from "./host";

/** Was der Rollout vom Host braucht (schmal, damit auch andere Familien ihn nutzen können). */
export type RolloutHost = Pick<KubectlHost, "podSecurity" | "clock" | "rng" | "_err" | "_resetEphemeral">;

const ADMISSION_HINT = "Härte das Pod-Template per Manifest (securityContext, z.B. runAsNonRoot: true) und roll es mit 'kubectl apply' aus – oder senke die enforce-Stufe.";

/** Pod-Security-Admission für neue Pods: `null` = zugelassen, sonst der gesetzte Fehlertext.
 *  `_err` (setzt `lastError`) wird nur bei Ablehnung gerufen. */
export function admitNewPods(host: RolloutHost, name: string, sc: SecurityContext | undefined): string | null {
  const denied = admitPod(host, name, sc);
  return denied ? host._err(denied, ADMISSION_HINT) : null;
}

/** Pur: würden neue Pods mit diesem securityContext unter `level` zugelassen? (für die Gefahren-Opferwahl) */
export function admitsNewPods(level: PodSecurityLevel, sc: SecurityContext | undefined): boolean {
  return podSecurityViolations(level, sc).length === 0;
}

/** Template-Änderung ausrollen: Admission (mit `sc`, Default der aktuelle securityContext) → `change()`
 *  → emptyDir freigeben → alle Pods ersetzen. Fehlertext bei Ablehnung (dann unverändert), sonst `null`. */
export function rollOut(host: RolloutHost, dep: Deployment, change?: () => void, sc: SecurityContext | undefined = dep.securityContext): string | null {
  const denied = admitNewPods(host, dep.name, sc);
  if (denied) return denied;
  // Das ReplicaSet erfasst sein Template, BEVOR change() es ändert (auch ein Deployment mit 0 Replicas hält Revision 1).
  ensureReplicaSet(dep, host.clock);
  change?.();
  // Neue Pods geben das flüchtige Scratch-Volume frei (#240).
  host._resetEphemeral(dep);
  replacePods(dep, host.clock, host.rng);
  return null;
}

/** Auf `target` skalieren. Nur HOCHskalieren erzeugt Pods und wird geprüft; runter und gleich nicht. */
export function scaleTo(host: RolloutHost, dep: Deployment, target: number): string | null {
  if (target > dep.replicas) {
    const denied = admitNewPods(host, dep.name, dep.securityContext);
    if (denied) return denied;
  }
  scaleDeployment(dep, target, host.clock, host.rng);
  return null;
}

/* ===== Kubernia – Workload-Mutationen (sim/workload.ts) =====
 * Getippte Aggregat-Mutationen für den Workload-Kern (Deployments/Pods/StatefulSets),
 * Fortsetzung von #478 im Rahmen des taktischen DDD (#488).
 *
 * #478 hat einen Wächter an die `exec()`-Aggregat-Grenze gesetzt, der jede
 * Invarianten-Verletzung LAUT macht (fail-loud). Aber die Befehlsfamilien mutierten
 * den Zustand weiterhin per direktem Array-Zugriff (`dep.pods.push(…)`, `dep.pods.pop()`,
 * `dep.replicas = n`) – die Regel „ein Deployment hält genau so viele Pods wie sein
 * `replicas`-Soll" (Invariante 1 in ./invariants.ts) lebte verstreut in jeder
 * Mutationsstelle. Ein neuer Sim-Befehl konnte sie unbemerkt umgehen.
 *
 * Hier stehen die Zustandsübergänge des Workloads gebündelt hinter getippten
 * Funktionen, die die Invariante **von sich aus** halten: `scaleDeployment` setzt
 * `replicas` und die Pod-Anzahl immer gemeinsam, `replacePods`/`replaceDeploymentPod`
 * halten die Zahl beim Neustart konstant. So ist der illegale Zustand „Soll ≠ Ist"
 * an den kanalisierten Stellen by-construction nicht mehr erzeugbar; der Wächter
 * bleibt das Netz für alles Un-Kanalisierte. Das ist der skalierende (Stardew-Scope)
 * Weg: die Workload-Regel wird an EINER Stelle gepflegt, nicht in jeder Familie neu.
 *
 * Reine Domäne: hängt nur an den Domänentypen aus ./state und den Namens-Helfern
 * (./util, ./names) – kein Phaser, kein Rückimport nach sim.ts (kein Zyklus), vom
 * Architektur-Wächter (#347) als Domäne geschützt und im Node-Test prüfbar.
 */
import type { Deployment, PodInstance, PvcRes, SecurityContext, StatefulSetRes } from "./state";
import { makePodName } from "./util";
import { asPodName } from "./names";

/** Eine frische Pod-Instanz für ein Deployment: neuer Zufallsname im K8s-Stil,
 *  `restarts: 0`, `created` = aktueller Sim-Takt. Die EINE Stelle, an der ein
 *  Deployment-Pod entsteht – scale/rollout/heal gehen alle darüber. Der Zufallsstrom
 *  `rng` kommt von der Sim-Instanz durch (wie der `clock`), damit die Pod-Namen
 *  instanz-lokal reproduzierbar sind (#580). */
export function newDeploymentPod(dep: Deployment, clock: number, rng: () => number): PodInstance {
  return { name: makePodName(dep.name, rng), created: clock, restarts: 0 };
}

/** Eine StatefulSet-Pod-Instanz mit STABILER Identität (`<sts>-<ordinal>`), anders als
 *  der Zufallsname eines Deployment-Pods. Die EINE Stelle, an der ein Stateful-Pod
 *  entsteht – Bau (`_makeStatefulSet`) und Neustart (`restartStatefulPod`) gehen darüber,
 *  damit die Ordinal-Namensregel (Invariante 8) an einer Stelle lebt statt roh dupliziert. */
export function newStatefulPod(ordinalName: string, clock: number): PodInstance {
  return { name: asPodName(ordinalName), created: clock, restarts: 0 };
}

/** Wartet das PVC dieses StatefulSet-Pods noch auf Speicher (`Pending`)? Dann läuft der Pod
 *  nicht: `get pods` zeigt ihn `0/1 Pending`, DNS führt ihn nicht als Endpoint (#811, #1301).
 *  Die EINE Stelle für diese Ableitung (PVC-Name `<vct>-<sts>-<ordinal>`). */
export function statefulPodVolumePending(
  sts: Pick<StatefulSetRes, "name" | "volumeClaimName">, pod: PodInstance, pvcs: readonly PvcRes[],
): boolean {
  const ordinal = String(pod.name).split("-").pop() ?? "0";
  const pvcName = sts.volumeClaimName + "-" + sts.name + "-" + ordinal;
  return pvcs.find(pv => pv.name === pvcName)?.status === "Pending";
}

/** Skaliert ein Deployment auf `target` Replicas und hält dabei die Invariante
 *  `pods.length === replicas`: fehlende Pods kommen frisch dazu, überzählige fallen
 *  weg, und `replicas` wird gemeinsam gesetzt – nie das eine ohne das andere. */
export function scaleDeployment(dep: Deployment, target: number, clock: number, rng: () => number): void {
  while (dep.pods.length < target) dep.pods.push(newDeploymentPod(dep, clock, rng));
  while (dep.pods.length > target) dep.pods.pop();
  dep.replicas = target;
}

/** Ersetzt ALLE Pods eines Deployments durch frische (Rollout / Heilung nach Fix).
 *  Die Anzahl bleibt erhalten, `replicas` unberührt – `pods.length === replicas`
 *  gilt vor und nach dem Neustart. */
export function replacePods(dep: Deployment, clock: number, rng: () => number): void {
  dep.pods = dep.pods.map(() => newDeploymentPod(dep, clock, rng));
}

/** Ersetzt genau EINEN Pod (per Name) durch einen frischen – die Selbstheilung eines
 *  Deployments beim Pod-Verlust (`kubectl delete pod`). Der Ersatz-Pod bekommt einen
 *  NEUEN Zufallsnamen (anders als beim StatefulSet, siehe `restartStatefulPod`); die
 *  Pod-Anzahl bleibt gleich. Gibt `false` zurück, wenn kein Pod dieses Namens da ist. */
export function replaceDeploymentPod(dep: Deployment, oldName: string, clock: number, rng: () => number): boolean {
  const idx = dep.pods.findIndex(p => p.name === oldName);
  if (idx < 0) return false;
  dep.pods.splice(idx, 1);
  dep.pods.push(newDeploymentPod(dep, clock, rng));
  return true;
}

/** Startet einen StatefulSet-Pod neu – mit STABILER Identität: gleicher Name, gleiche
 *  Ordinalposition (anders als beim Deployment, das einen neuen Zufallsnamen zieht).
 *  `restarts` und `created` werden zurückgesetzt. Die Pod-Anzahl bleibt gleich.
 *  Gibt `false` zurück, wenn kein Pod dieses Namens da ist. */
export function restartStatefulPod(sts: StatefulSetRes, name: string, clock: number): boolean {
  const idx = sts.pods.findIndex(p => p.name === name);
  if (idx < 0) return false;
  sts.pods.splice(idx, 1, newStatefulPod(name, clock));
  return true;
}

/** Nimmt ein Deployment in den Cluster auf – der EINE Eintrittspunkt für ein
 *  Aggregat-Mitglied (das übergebene Deployment ist per Fabrik bereits legal gebaut).
 *  Bündelt den Zugriff, damit künftige Eintritts-Invarianten (z.B. Namens-Eindeutigkeit)
 *  genau hier landen, statt in jeder Familie neu. */
export function addDeployment(state: { deployments: Deployment[] }, dep: Deployment): void {
  state.deployments.push(dep);
}

/** Entfernt ein Deployment (per Name) aus dem Cluster – der EINE Austrittspunkt.
 *  Gibt das entfernte Deployment zurück, oder `undefined`, wenn keins passt (der
 *  Aufrufer unterscheidet daran „gelöscht" von „nicht gefunden"). */
export function removeDeployment(state: { deployments: Deployment[] }, name: string): Deployment | undefined {
  const idx = state.deployments.findIndex(d => d.name === name);
  if (idx < 0) return undefined;
  return state.deployments.splice(idx, 1)[0];
}

/** Nimmt ein StatefulSet in den Cluster auf – der EINE Eintrittspunkt (Pendant zu
 *  `addDeployment`). Das StatefulSet trägt dieselbe Replica-Invariante wie ein
 *  Deployment (`pods.length === replicas`, Invariante 1 in ./invariants.ts) und ist
 *  per Fabrik (`_makeStatefulSet`) bereits legal gebaut. Bündelt den Zugriff, damit
 *  künftige Eintritts-Invarianten genau hier landen, statt in jeder Familie neu. */
export function addStatefulSet(state: { statefulSets: StatefulSetRes[] }, sts: StatefulSetRes): void {
  state.statefulSets.push(sts);
}

/** Entfernt ein StatefulSet (per Name) aus dem Cluster – der EINE Austrittspunkt
 *  (Pendant zu `removeDeployment`). Gibt das entfernte StatefulSet zurück, oder
 *  `undefined`, wenn keins passt (der Aufrufer unterscheidet daran „gelöscht" von
 *  „nicht gefunden"). Die zugehörigen PVCs bleiben absichtlich bestehen (#122) – das
 *  ist Sache des Aufrufers, nicht dieses Aggregat-Austritts. */
export function removeStatefulSet(state: { statefulSets: StatefulSetRes[] }, name: string): StatefulSetRes | undefined {
  const idx = state.statefulSets.findIndex(s => s.name === name);
  if (idx < 0) return undefined;
  return state.statefulSets.splice(idx, 1)[0];
}

/* ===== Pod-Template-Primitive (#1300) =====
 * Heil-/Drossel-Regeln für Image und Limits an EINER Stelle: `kubectl set image|resources`
 * und das Re-apply eines Manifests (sim/kubectl/apply-deployment.ts) gehen beide darüber.
 * Sie mutieren nur das Deployment und melden, ob dadurch ein Fehler geheilt wurde; den
 * Pod-Austausch (`replacePods`) und die Notiz entscheidet der Aufrufer. */

/** CPU-Limit-Schwelle in Milli-Cores: darunter werden die Pods gedrosselt (Dauerlast fällt weg). */
export const CPU_THROTTLE_MILLI = 500;

/** Setzt das Image. Heilt den imagepull-Fehler, wenn das neue Image nicht das kaputte ist. */
export function changeImage(dep: Deployment, image: string): boolean {
  const oldBad = dep.broken && dep.broken.type === "imagepull" ? dep.broken.badImage : null;
  dep.image = image;
  if (oldBad === null || image === oldBad) return false;
  dep.broken = null;
  return true;
}

/** Setzt das memory-Limit (Mi). Heilt OOMKilled, wenn es für `memNeeded` reicht (>=). */
export function setMemoryLimit(dep: Deployment, mi: number): boolean {
  dep.memLimit = mi;
  if (dep.broken && dep.broken.type === "oomkilled" && mi >= (dep.broken.memNeeded || 0)) {
    dep.broken = null;
    return true;
  }
  return false;
}

/** Setzt das CPU-Limit (Milli-Cores). Unter `CPU_THROTTLE_MILLI` fällt die Dauerlast weg. */
export function setCpuLimit(dep: Deployment, milli: number): boolean {
  dep.cpuLimitMilli = milli;
  if (milli < CPU_THROTTLE_MILLI && dep.cpuHeavy) {
    dep.cpuHeavy = false;
    return true;
  }
  return false;
}

/** Übernimmt die Template-Felder memory-/CPU-Limit und securityContext aus einem Snapshot bzw.
 *  Szenario – nur gesetzte Felder (der securityContext als Kopie). */
export function seedPodTemplate(dep: Deployment, s: { memLimit?: number; cpuLimitMilli?: number; securityContext?: SecurityContext }): void {
  if (s.memLimit !== undefined) dep.memLimit = s.memLimit;
  if (s.cpuLimitMilli !== undefined) dep.cpuLimitMilli = s.cpuLimitMilli;
  if (s.securityContext) dep.securityContext = { ...s.securityContext };
}

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
import type { ClusterNode, Deployment, PodInstance, PodTemplateSpec, PvcRes, StatefulSetRes } from "./state";
import { makePodName } from "./util";
import { asPodName } from "./names";
import { isControlPlane } from "./nodes";

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
 *  Der PVC-Name kommt aus `statefulPodClaimName`. */
export function statefulPodVolumePending(
  sts: Pick<StatefulSetRes, "name" | "volumeClaimName">, pod: PodInstance, pvcs: readonly PvcRes[],
): boolean {
  return pvcs.find(pv => pv.name === statefulPodClaimName(sts, pod))?.status === "Pending";
}

/** Der PVC-Name eines StatefulSet-Pods: `<volumeClaimTemplate>-<sts>-<ordinal>`. Die EINE
 *  Stelle, die ihn ableitet (Bau, Pending-Prüfung, Apply-Hinweis, `describe pod`). */
export function statefulPodClaimName(
  sts: Pick<StatefulSetRes, "name" | "volumeClaimName">, pod: { name: string },
): string {
  const ordinal = String(pod.name).split("-").pop() ?? "0";
  return sts.volumeClaimName + "-" + sts.name + "-" + ordinal;
}

/** Der Node eines StatefulSet-Pods: deterministisch Round-Robin über die Worker nach Ordinal
 *  (Control-Plane nie, solange es Worker gibt). Ohne Worker der erste Node, ohne Nodes `""`
 *  (wie `nodeOf` für Deployments). Gemeinsame Platzierung je Owner: #1145. */
export function statefulPodNode(nodes: readonly ClusterNode[], pod: { name: string }): string {
  const workers = nodes.filter(n => !isControlPlane(n));
  if (workers.length === 0) return nodes[0]?.name ?? "";
  const ordinal = Number(String(pod.name).split("-").pop());
  return workers[(Number.isNaN(ordinal) ? 0 : ordinal) % workers.length].name;
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

/** Heilt ein memory-Limit von `mi` einen OOMKilled-Fehler? (pur, `>=` memNeeded) */
export function healsOom(dep: Deployment, mi: number): boolean {
  return !!dep.broken && dep.broken.type === "oomkilled" && mi >= (dep.broken.memNeeded || 0);
}

/** Drosselt ein CPU-Limit von `milli` die Dauerlast weg? (pur, unter `CPU_THROTTLE_MILLI`) */
export function throttlesCpu(dep: Deployment, milli: number): boolean {
  return milli < CPU_THROTTLE_MILLI && !!dep.cpuHeavy;
}

/** Setzt das memory-Limit (Mi). Heilt OOMKilled, wenn es für `memNeeded` reicht (>=). */
export function setMemoryLimit(dep: Deployment, mi: number): boolean {
  const heals = healsOom(dep, mi);
  dep.memLimit = mi;
  if (heals) dep.broken = null;
  return heals;
}

/** Setzt das CPU-Limit (Milli-Cores). Unter `CPU_THROTTLE_MILLI` fällt die Dauerlast weg. */
export function setCpuLimit(dep: Deployment, milli: number): boolean {
  const throttles = throttlesCpu(dep, milli);
  dep.cpuLimitMilli = milli;
  if (throttles) dep.cpuHeavy = false;
  return throttles;
}

/** Notiz nach geheiltem OOMKilled (set resources und apply teilen sie). */
export const MEM_HEALED_NOTE = "💡 Genug Speicher! Die Pods starten neu und bleiben diesmal stehen – kein OOMKilled mehr.";
/** Notiz nach weggedrosselter Dauerlast. */
export const CPU_THROTTLED_NOTE = "💡 CPU-Limit gesetzt! Die Pods werden gedrosselt – der HighPodCPU-Alert fällt auf resolved.";

/** Template-Felder, die als einfacher Wert (Zahl/String) gespiegelt werden. Die Objektfelder
 *  (securityContext, emptyDir, initContainer) laufen einzeln, weil sie als Kopie ankommen. */
const SCALAR_TEMPLATE_KEYS = ["serviceAccountName", "containerPort", "memLimit", "cpuLimitMilli", "node", "ephemeralLimit", "ephemeralUsedMi"] as const;

/** Kopiert die gesetzten Skalarfelder von `from` nach `to`. */
function copyScalars(from: PodTemplateSpec, to: PodTemplateSpec): void {
  for (const k of SCALAR_TEMPLATE_KEYS) {
    if (from[k] !== undefined) Object.assign(to, { [k]: from[k] });
  }
}

/** Übernimmt ALLE Pod-Template-Felder aus einem Snapshot, Szenario oder Manifest-Effekt – nur gesetzte
 *  Felder, Objektfelder als Kopie, emptyDir/initContainer mit Defaults. Der EINE Seed-Weg. */
export function seedPodTemplate(dep: Deployment, s: PodTemplateSpec): void {
  copyScalars(s, dep);
  if (s.securityContext) dep.securityContext = { ...s.securityContext };
  if (s.emptyDir) dep.emptyDir = { data: s.emptyDir.data || "", usedMi: s.emptyDir.usedMi || 0 };
  if (s.initContainer) dep.initContainer = { fillsMi: s.initContainer.fillsMi ?? 0, doubleStage: !!s.initContainer.doubleStage };
}

/** Gegenstück zu `seedPodTemplate`: die Template-Felder eines Deployments für den Snapshot (Kopien). */
export function snapshotPodTemplate(dep: Deployment): PodTemplateSpec {
  const out: PodTemplateSpec = {};
  copyScalars(dep, out);
  if (dep.securityContext) out.securityContext = { ...dep.securityContext };
  if (dep.emptyDir) out.emptyDir = { ...dep.emptyDir };
  if (dep.initContainer) out.initContainer = { ...dep.initContainer };
  return out;
}

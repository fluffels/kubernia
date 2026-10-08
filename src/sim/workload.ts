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
 * Reine Domäne: hängt nur an den Domänentypen aus ./state, den Namens-Helfern
 * (./util, ./names), ./replicasets (pod-template-hash, ReplicaSet-Historie) und ./nodes
 * (isControlPlane) – kein Phaser, kein Rückimport nach sim.ts (kein Zyklus), vom
 * Architektur-Wächter (#347) als Domäne geschützt und im Node-Test prüfbar.
 */
import type { ClusterNode, Deployment, PodInstance, PodTemplateSpec, PvcRes, ReplicaSetRecord, RolloutHistorySpec, RsTemplate, StatefulSetRes } from "./state";
import { makePodName } from "./util";
import { POD_TEMPLATE_KEYS, REVISION_HISTORY_LIMIT, switchReplicaSet, templateHash } from "./replicasets";
import { asPodName, InvalidSpecError } from "./names";
import { isControlPlane } from "./nodes";

/** Eine frische Pod-Instanz für ein Deployment: neuer Zufallsname im K8s-Stil,
 *  `restarts: 0`, `created` = aktueller Sim-Takt. Die EINE Stelle, an der ein
 *  Deployment-Pod entsteht – scale/rollout/heal gehen alle darüber. Der Zufallsstrom
 *  `rng` kommt von der Sim-Instanz durch (wie der `clock`), damit die Pod-Namen
 *  instanz-lokal reproduzierbar sind (#580). */
export function newDeploymentPod(dep: Deployment, clock: number, rng: () => number, taken: readonly PodInstance[] = dep.pods): PodInstance {
  const { hash } = ensureReplicaSet(dep, clock);
  // Nur 5 Zufallszeichen im Namen (wie in Kubernetes): bei einer Kollision neu würfeln.
  let name = makePodName(dep.name, hash, rng);
  for (let i = 0; i < 8 && taken.some(p => p.name === name); i++) name = makePodName(dep.name, hash, rng);
  return { name, created: clock, restarts: 0 };
}

/** Das Template, das ein ReplicaSet besitzt: Kopie von Image, envFrom und den Template-Feldern des Deployments
 *  (ohne Laufzeitwert `ephemeralUsedMi`; ein emptyDir zählt nur als Deklaration). */
export function rsTemplateOf(dep: Deployment): RsTemplate {
  return { image: dep.image, envFrom: { configMaps: dep.envFrom.configMaps.slice(), secrets: dep.envFrom.secrets.slice() }, spec: rsSpecOf(dep) };
}

/** Die Template-Felder, die ein ReplicaSet besitzt: Kopie ohne Laufzeitwert `ephemeralUsedMi`, ein emptyDir nur als Deklaration. Die EINE Normalisierung (Deployment und Historien-Eintrag). */
function rsSpecOf(src: PodTemplateSpec): PodTemplateSpec {
  const spec = snapshotPodTemplate(src);
  delete spec.ephemeralUsedMi;
  if (spec.emptyDir) spec.emptyDir = {};
  return spec;
}

/** Stellt sicher, dass das Deployment sein aktuelles ReplicaSet (Revision 1, Template des Deployments) kennt.
 *  Muss VOR jeder Template-Änderung laufen, damit das ReplicaSet sein altes Template behält. */
export function ensureReplicaSet(dep: Deployment, clock: number): ReplicaSetRecord {
  if (!dep.replicaSet) {
    const template = rsTemplateOf(dep);
    dep.replicaSet = { hash: templateHash(dep.name, template), created: clock, revision: 1, template };
  }
  return dep.replicaSet;
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

/** Die Access-Modes der PVCs aus dem volumeClaimTemplate (Kurzform). */
export const STATEFUL_CLAIM_ACCESS_MODES = "RWO";

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

/** Der Replica-Guard (#1459): nur ganze Zahlen ≥ 0 sind ein gültiges Soll. Eine negative Zahl ließe
 *  `scaleDeployment` endlos `pop()`en, eine Bruchzahl bräche `pods.length === replicas`. Wirft vor jeder
 *  Mutation (wie der apiserver: `spec.replicas: Invalid value`); jede Fabrik und jeder künftige Aufrufer
 *  läuft hier durch, nicht nur der Rand von `kubectl scale`. */
export function assertReplicas(kind: "Deployment" | "StatefulSet", name: string, replicas: number): void {
  if (Number.isInteger(replicas) && replicas >= 0) return;
  const grund = Number.isInteger(replicas) ? "must be greater than or equal to 0" : "must be a whole number";
  throw new InvalidSpecError(
    "The " + kind + ' "' + name + '" is invalid: spec.replicas: Invalid value: ' + replicas + ": " + grund,
    "Replicas sind eine ganze Zahl ab 0, z.B. 'kubectl scale deployment " + name + " --replicas=3'.");
}

/** Skaliert ein Deployment auf `target` Replicas und hält dabei die Invariante
 *  `pods.length === replicas`: fehlende Pods kommen frisch dazu, überzählige fallen
 *  weg, und `replicas` wird gemeinsam gesetzt – nie das eine ohne das andere. */
export function scaleDeployment(dep: Deployment, target: number, clock: number, rng: () => number): void {
  assertReplicas("Deployment", dep.name, target);
  while (dep.pods.length < target) dep.pods.push(newDeploymentPod(dep, clock, rng));
  while (dep.pods.length > target) dep.pods.pop();
  dep.replicas = target;
}

/** Ersetzt ALLE Pods eines Deployments durch frische (Rollout / Heilung nach Fix).
 *  Die Anzahl bleibt erhalten, `replicas` unberührt – `pods.length === replicas`
 *  gilt vor und nach dem Neustart. */
export function replacePods(dep: Deployment, clock: number, rng: () => number): void {
  // Neues Template → neues ReplicaSet (neuer Hash); gleiches Template behält es (#1468).
  ensureReplicaSet(dep, clock); // das bisherige ReplicaSet behält sein Template, bevor es abgelöst wird
  const template = rsTemplateOf(dep);
  const hash = templateHash(dep.name, template); // EIN Hash-Weg: derselbe wie im Eintrag
  if (dep.replicaSet?.hash !== hash) switchReplicaSet(dep, { hash, created: clock, template });
  const fresh: PodInstance[] = [];
  for (let i = 0; i < dep.pods.length; i++) fresh.push(newDeploymentPod(dep, clock, rng, [...dep.pods, ...fresh]));
  dep.pods = fresh;
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
const SCALAR_TEMPLATE_KEYS = ["serviceAccountName", "containerPort", "memLimit", "cpuLimitMilli", "node", "ephemeralLimit", "ephemeralUsedMi", "restartedAt"] as const;

/** Kopiert die gesetzten Skalarfelder von `from` nach `to`. */
function copyScalars(from: PodTemplateSpec, to: PodTemplateSpec): void {
  for (const k of SCALAR_TEMPLATE_KEYS) {
    if (from[k] !== undefined) Object.assign(to, { [k]: from[k] });
  }
}

/** Übernimmt ALLE Pod-Template-Felder aus einem Snapshot, Szenario oder Manifest-Effekt – nur gesetzte
 *  Felder, Objektfelder als Kopie, emptyDir/initContainer mit Defaults. Der EINE Seed-Weg. */
export function seedPodTemplate(dep: PodTemplateSpec, s: PodTemplateSpec): void {
  copyScalars(s, dep);
  if (s.securityContext) dep.securityContext = { ...s.securityContext };
  if (s.emptyDir) dep.emptyDir = { data: s.emptyDir.data || "", usedMi: s.emptyDir.usedMi || 0 };
  if (s.initContainer) dep.initContainer = { fillsMi: s.initContainer.fillsMi ?? 0, doubleStage: !!s.initContainer.doubleStage };
}

/** Gegenstück zu `seedPodTemplate`: die Template-Felder eines Deployments für den Snapshot (Kopien). */
export function snapshotPodTemplate(dep: PodTemplateSpec): PodTemplateSpec {
  const out: PodTemplateSpec = {};
  copyScalars(dep, out);
  if (dep.securityContext) out.securityContext = { ...dep.securityContext };
  if (dep.emptyDir) out.emptyDir = { ...dep.emptyDir };
  if (dep.initContainer) out.initContainer = { ...dep.initContainer };
  return out;
}

/* ===== Rollout-Historie: Rollback, Laden, Speichern (#1471) ===== */

/** Rollback: legt das Template eines alten ReplicaSets wieder auf das Deployment (Mutation, Admission und Rollout
 *  macht der Aufrufer). Felder, die das alte Template nicht hatte, fallen weg. Image-Heilung wie `set image`,
 *  Limit-Heilung wie `set resources`; die Notizen der Heilungen kommen zurück. */
export function restoreRsTemplate(dep: Deployment, t: RsTemplate): string[] {
  const notes: string[] = [];
  for (const k of POD_TEMPLATE_KEYS) if (k !== "ephemeralUsedMi") Reflect.deleteProperty(dep, k);
  dep.envFrom = { configMaps: t.envFrom.configMaps.slice(), secrets: t.envFrom.secrets.slice() };
  changeImage(dep, t.image);
  const { memLimit, cpuLimitMilli, ...rest } = t.spec;
  seedPodTemplate(dep, rest);
  if (memLimit !== undefined && setMemoryLimit(dep, memLimit)) notes.push("\n" + MEM_HEALED_NOTE);
  if (cpuLimitMilli !== undefined && setCpuLimit(dep, cpuLimitMilli)) notes.push("\n" + CPU_THROTTLED_NOTE);
  return notes;
}

/** Ein Historien-Eintrag aus einem Szenario/Save: nur gültig mit ganzzahliger Revision ≥ 1 und Image. */
function validHistoryEntry(e: unknown): e is NonNullable<RolloutHistorySpec["rsHistory"]>[number] {
  if (typeof e !== "object" || e === null) return false;
  const { revision, image } = e as { revision?: unknown; image?: unknown };
  return typeof revision === "number" && Number.isInteger(revision) && revision >= 1 && typeof image === "string" && image !== "";
}

/** Ein Historien-Eintrag als ReplicaSet (Template normalisiert); `null` bei kaputtem Inhalt (wirft nie). */
function recordFromEntry(dep: Deployment, e: NonNullable<RolloutHistorySpec["rsHistory"]>[number]): ReplicaSetRecord | null {
  try {
    const geseedet: PodTemplateSpec = {};
    seedPodTemplate(geseedet, e);
    const spec = rsSpecOf(geseedet);
    const envFrom = { configMaps: [...(e.envFrom?.configMaps ?? [])].map(String), secrets: [...(e.envFrom?.secrets ?? [])].map(String) };
    const template: RsTemplate = { image: e.image, envFrom, spec };
    return { hash: templateHash(dep.name, template), created: dep.created, revision: e.revision, template };
  } catch {
    return null;
  }
}

/** Die gültigen Historien-Einträge: eindeutige Revision und eindeutiger Hash (≠ aktuell), Revision unter der aktuellen. */
function validRecords(dep: Deployment, entries: unknown[], currentHash: string, maxRevision: number): ReplicaSetRecord[] {
  const out: ReplicaSetRecord[] = [];
  for (const e of entries) {
    const rec = validHistoryEntry(e) ? recordFromEntry(dep, e) : null;
    if (!rec || rec.revision >= maxRevision || rec.hash === currentHash) continue;
    if (out.some(o => o.revision === rec.revision || o.hash === rec.hash)) continue;
    out.push(rec);
  }
  return out.sort((a, b) => a.revision - b.revision).slice(-REVISION_HISTORY_LIMIT);
}

/** Übernimmt die Rollout-Historie aus einem Szenario/Save (nach dem Template-Seed, vor den Pods). Wirft NIE:
 *  ein kaputter Eintrag wird verworfen, sonst verwürfe `sanitizeSnapshot` den ganzen Cluster. Ohne
 *  `revision`/`rsHistory` (Alt-Stand, unberührtes Deployment) passiert nichts. */
export function seedRolloutHistory(dep: Deployment, s: RolloutHistorySpec, clock: number): void {
  if (s.revision === undefined && s.rsHistory === undefined) return;
  const entries: unknown[] = Array.isArray(s.rsHistory) ? s.rsHistory : [];
  const gesetzt = typeof s.revision === "number" && Number.isInteger(s.revision) && s.revision >= 1 ? s.revision : null;
  const template = rsTemplateOf(dep);
  const hash = templateHash(dep.name, template);
  const alle = validRecords(dep, entries, hash, gesetzt ?? Infinity);
  const revision = gesetzt ?? Math.max(0, ...alle.map(r => r.revision)) + 1;
  dep.replicaSet = { hash, created: clock, revision, template };
  if (alle.length > 0) dep.oldReplicaSets = alle;
}

/** Gegenstück zu `seedRolloutHistory`: nur, was von Revision 1 ohne Historie abweicht (sonst `{}`, unberührte Stände bleiben unverändert). */
export function snapshotRolloutHistory(dep: Deployment): RolloutHistorySpec {
  const alte = dep.oldReplicaSets ?? [];
  const revision = dep.replicaSet?.revision ?? 1;
  if (alte.length === 0 && revision === 1) return {};
  return {
    revision,
    rsHistory: alte.map(r => ({
      revision: r.revision, image: r.template.image,
      envFrom: { configMaps: r.template.envFrom.configMaps.slice(), secrets: r.template.envFrom.secrets.slice() },
      ...snapshotPodTemplate(r.template.spec),
    })),
  };
}

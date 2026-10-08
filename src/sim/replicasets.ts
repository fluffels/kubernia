/* ===== Kubernia – ReplicaSets und ihre Historie (sim/replicasets.ts, #1468, #1471) =====
 * Das ReplicaSet eines Deployments ist aus dem Pod-Template ABGELEITET. Sein Name ist
 * `<deployment>-<pod-template-hash>`, und alle Pods des Deployments tragen genau diesen Hash im Namen
 * (`<dep>-<hash>-<suffix>`), wie in echtem Kubernetes. Ein neues Pod-Template (Image, Limits,
 * Rollout-Neustart …) ergibt beim Ausrollen einen neuen Hash, also ein neues ReplicaSet; Skalieren und
 * `delete pod` lassen es unberührt.
 *
 * Die Historie (#1471): jedes ReplicaSet besitzt sein eigenes Template (`ReplicaSetRecord.template`),
 * das beim Entstehen erfasst wird. Das ersetzte ReplicaSet bleibt als altes (0/0/0) in
 * `Deployment.oldReplicaSets`, höchstens `REVISION_HISTORY_LIMIT` (wie `revisionHistoryLimit`). Ein
 * Rollback auf ein altes Template findet sein ReplicaSet über den Hash wieder und nutzt es weiter
 * (gleicher Name, gleicher Hash), nur mit neuer Revision. Der Hash ist FNV-32a über das kanonisierte
 * Template, kodiert wie `rand.SafeEncodeString` – nur die Werte sind Sim-intern, nicht die echten.
 * Hash und `created` werden nie persistiert; nur Revisionen und Templates (`RolloutHistorySpec`).
 *
 * Reine Domäne: hängt nur an ./state, ../core/rng und ./util – NIE an ./workload (Zyklus).
 */
import { hashStr } from "../core/rng";
import { SECURITY_CONTEXT_KEYS, type Deployment, type PodTemplateSpec, type ReplicaSetRecord, type RsTemplate } from "./state";
import { safeEncode, workloadLabels, type Labels } from "./util";

/** `spec.revisionHistoryLimit` von Kubernetes (Default 10): so viele alte ReplicaSets bleiben. */
export const REVISION_HISTORY_LIMIT = 10;

/** Alles, was in den Hash eingeht: Name, Image, envFrom und die Template-Felder. */
export type HashInput = Pick<Deployment, "name" | "image" | "envFrom"> & PodTemplateSpec;

/** Pro Template-Feld die normalisierte Form für den Hash (fehlend → null); `null` = geht nicht ein
 *  (`ephemeralUsedMi` ist ein Laufzeitwert). Die Schlüsselreihenfolge ist die Reihenfolge im Hash;
 *  `satisfies` bricht den Typecheck, sobald ein neues `PodTemplateSpec`-Feld hier nicht entschieden ist. */
const HASH_FORM = {
  serviceAccountName: t => t.serviceAccountName ?? null,
  containerPort: t => t.containerPort ?? null,
  memLimit: t => t.memLimit ?? null,
  cpuLimitMilli: t => t.cpuLimitMilli ?? null,
  // Der securityContext in fester Schlüsselreihenfolge (fehlend → null).
  securityContext: t => t.securityContext ? SECURITY_CONTEXT_KEYS.map(k => t.securityContext?.[k] ?? null) : null,
  node: t => t.node ?? null,
  // emptyDir zählt nur als deklariert, nicht mit seinem Inhalt.
  emptyDir: t => t.emptyDir ? true : null,
  ephemeralLimit: t => t.ephemeralLimit ?? null,
  ephemeralUsedMi: null,
  initContainer: t => t.initContainer ? [t.initContainer.fillsMi ?? 0, !!t.initContainer.doubleStage] : null,
  restartedAt: t => t.restartedAt ?? null,
} satisfies Record<keyof PodTemplateSpec, ((t: HashInput) => unknown) | null>;

/** Alle Pod-Template-Felder (typgewacht über `HASH_FORM`). */
export const POD_TEMPLATE_KEYS = Object.keys(HASH_FORM) as (keyof PodTemplateSpec)[];

const HASH_FORMEN = Object.values(HASH_FORM).filter((f): f is Exclude<typeof f, null> => f !== null);

/** Der pod-template-hash eines Pod-Templates (pur, deterministisch). Nicht im Hash:
 *  replicas, broken, cpuHeavy, evicted, created und alle Laufzeitwerte. */
export function podTemplateHash(t: HashInput): string {
  const canon = JSON.stringify([t.name, t.image, t.envFrom.configMaps, t.envFrom.secrets, HASH_FORMEN.map(f => f(t))]);
  return safeEncode(String(hashStr(canon)));
}

/** Der Hash eines gespeicherten ReplicaSet-Templates. */
export function templateHash(depName: string, t: RsTemplate): string {
  return podTemplateHash({ name: depName, image: t.image, envFrom: t.envFrom, ...t.spec });
}

/** Das ReplicaSet, dem die laufenden Pods des Deployments gehören (nur lesend). Ohne gesetztes
 *  Laufzeitfeld (frisch geladen, noch kein Pod gebaut) leitet es sich aus dem Template ab. */
export function currentReplicaSet(dep: Deployment): { name: string; hash: string; created: number; revision: number } {
  const hash = dep.replicaSet?.hash ?? podTemplateHash(dep);
  return { name: dep.name + "-" + hash, hash, created: dep.replicaSet?.created ?? dep.created, revision: dep.replicaSet?.revision ?? 1 };
}

/** Ein ReplicaSet in der Liste: `template` ist `null` beim aktuellen (dessen Template ist das lebende Deployment). */
export interface ReplicaSetView { name: string; hash: string; created: number; revision: number; current: boolean; image: string; template: RsTemplate | null }

/** Alle ReplicaSets des Deployments (aktuelles + alte), nach Namen sortiert wie `kubectl get rs`. */
export function replicaSetsOf(dep: Deployment): ReplicaSetView[] {
  const cur = currentReplicaSet(dep);
  const alte: ReplicaSetView[] = (dep.oldReplicaSets ?? []).map(r => ({
    name: dep.name + "-" + r.hash, hash: r.hash, created: r.created, revision: r.revision, current: false, image: r.template.image, template: r.template,
  }));
  const alle: ReplicaSetView[] = [...alte, { ...cur, current: true, image: dep.image, template: null }];
  return alle.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

/** Die Revisionen des Deployments, aufsteigend (alte + aktuelle). */
export function rolloutRevisions(dep: Deployment): number[] {
  return [...(dep.oldReplicaSets ?? []).map(r => r.revision), currentReplicaSet(dep).revision].sort((a, b) => a - b);
}

/** Ziel eines `rollout undo`: das alte ReplicaSet, nichts zu tun (Revision ist schon die aktuelle) oder ein Fehler. */
export type UndoTarget =
  | { record: ReplicaSetRecord }
  | { skip: true; revision: number }
  | { error: "keine-historie" }
  | { error: "unbekannt"; revision: number };

/** Wohin `rollout undo [--to-revision=N]` zurückgeht. `0`/fehlend = die vorherige Revision (die höchste alte). */
export function undoTarget(dep: Deployment, toRevision?: number): UndoTarget {
  const alte = dep.oldReplicaSets ?? [];
  if (alte.length === 0) return { error: "keine-historie" };
  const rev = toRevision || Math.max(...alte.map(r => r.revision));
  if (rev === currentReplicaSet(dep).revision) return { skip: true, revision: rev };
  const record = alte.find(r => r.revision === rev);
  return record ? { record } : { error: "unbekannt", revision: rev };
}

/** Das aktuelle ReplicaSet wird durch `next` abgelöst: das bisherige rückt in die Historie, ein schon
 *  bekanntes ReplicaSet gleichen Hashes wird wiederverwendet (Name, Alter, Template), die neue Revision ist
 *  max+1, die Historie wird auf `REVISION_HISTORY_LIMIT` gekürzt. `next` ist der fertige Eintrag (kein Import
 *  von ./workload nötig). */
export function switchReplicaSet(dep: Deployment, next: Omit<ReplicaSetRecord, "revision">): void {
  const alte = [...(dep.oldReplicaSets ?? [])];
  if (dep.replicaSet) alte.push(dep.replicaSet);
  const revision = Math.max(0, ...alte.map(r => r.revision)) + 1;
  const idx = alte.findIndex(r => r.hash === next.hash);
  const basis = idx >= 0 ? alte.splice(idx, 1)[0] : next;
  dep.replicaSet = { hash: basis.hash, created: basis.created, template: basis.template, revision };
  dep.oldReplicaSets = alte.sort((a, b) => a.revision - b.revision).slice(-REVISION_HISTORY_LIMIT);
}

/** Der größte `restartedAt`-Wert über das aktuelle Template und alle alten (für einen eindeutigen Neustart-Hash). */
export function maxRestartedAt(dep: Deployment): number {
  const alte = (dep.oldReplicaSets ?? []).map(r => r.template.spec.restartedAt ?? -1);
  return Math.max(dep.restartedAt ?? -1, dep.replicaSet?.template.spec.restartedAt ?? -1, ...alte);
}

/** Die Labels der Pods (und der Selektor) eines ReplicaSets (Default das aktuelle): Workload-Label plus `pod-template-hash`. */
export function podTemplateLabels(dep: Deployment, hash: string = currentReplicaSet(dep).hash): Labels {
  return { ...workloadLabels(dep.name), "pod-template-hash": hash };
}


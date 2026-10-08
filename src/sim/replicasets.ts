/* ===== Kubernia – ReplicaSets als abgeleitete Ressource (sim/replicasets.ts, #1468) =====
 * Die Sim hält kein eigenes ReplicaSet-Objekt: das ReplicaSet eines Deployments ist aus dem
 * Pod-Template ABGELEITET. Sein Name ist `<deployment>-<pod-template-hash>`, und alle Pods des
 * Deployments tragen genau diesen Hash im Namen (`<dep>-<hash>-<suffix>`), wie in echtem Kubernetes.
 * Ein neues Pod-Template (Image, Limits, Rollout-Neustart …) ergibt beim Ausrollen einen neuen Hash,
 * also ein neues ReplicaSet; Skalieren und `delete pod` lassen es unberührt.
 *
 * Der Hash wird nur beim Ausrollen (`replacePods`) neu berechnet und als Laufzeitwert in
 * `Deployment.replicaSet` gehalten (nicht serialisiert: ein geladener Stand baut die Pods ohnehin
 * neu auf und leitet den Hash aus dem Template ab). Der Hash ist FNV-32a über das kanonisierte
 * Template, kodiert wie `rand.SafeEncodeString` – nur die Werte sind Sim-intern, nicht die echten.
 *
 * Reine Domäne: hängt nur an ./state, ../core/rng und ./util – NIE an ./workload (Zyklus).
 */
import { hashStr } from "../core/rng";
import { SECURITY_CONTEXT_KEYS, type Deployment, type PodTemplateSpec } from "./state";
import { safeEncode, workloadLabels, type Labels } from "./util";

/** Welche Template-Felder in den Hash eingehen. `satisfies` bricht den Typecheck, sobald ein neues
 *  `PodTemplateSpec`-Feld hier nicht entschieden ist. `ephemeralUsedMi` ist ein Laufzeitwert. */
const IM_HASH = {
  serviceAccountName: true,
  containerPort: true,
  memLimit: true,
  cpuLimitMilli: true,
  securityContext: true,
  node: true,
  emptyDir: true,
  ephemeralLimit: true,
  ephemeralUsedMi: false,
  initContainer: true,
  restartedAt: true,
} satisfies Record<keyof PodTemplateSpec, boolean>;

/** Der securityContext in fester Schlüsselreihenfolge (fehlend → null). */
function normSecurityContext(dep: Deployment): unknown {
  const sc = dep.securityContext;
  return sc ? SECURITY_CONTEXT_KEYS.map(k => sc[k] ?? null) : null;
}

/** emptyDir zählt nur als deklariert, nicht mit seinem Inhalt. */
function normEmptyDir(dep: Deployment): unknown {
  return dep.emptyDir ? true : null;
}

/** initContainer: nur das, was das Template vorgibt. */
function normInit(dep: Deployment): unknown {
  return dep.initContainer ? [dep.initContainer.fillsMi, !!dep.initContainer.doubleStage] : null;
}

/** Pro Template-Feld die normalisierte Form für den Hash (fehlend → null). Der Record ist vollständig
 *  typgewacht wie `IM_HASH`; `ephemeralUsedMi` steht nur der Vollständigkeit halber da. */
const NORMALISIERT: Record<keyof PodTemplateSpec, (dep: Deployment) => unknown> = {
  serviceAccountName: d => d.serviceAccountName ?? null,
  containerPort: d => d.containerPort ?? null,
  memLimit: d => d.memLimit ?? null,
  cpuLimitMilli: d => d.cpuLimitMilli ?? null,
  securityContext: normSecurityContext,
  node: d => d.node ?? null,
  emptyDir: normEmptyDir,
  ephemeralLimit: d => d.ephemeralLimit ?? null,
  ephemeralUsedMi: () => null,
  initContainer: normInit,
  restartedAt: d => d.restartedAt ?? null,
};

const IM_HASH_FELDER = (Object.keys(IM_HASH) as (keyof PodTemplateSpec)[]).filter(k => IM_HASH[k]);

/** Die Hash-relevanten Felder in fester Reihenfolge. */
function templateFields(dep: Deployment): unknown[] {
  return IM_HASH_FELDER.map(k => NORMALISIERT[k](dep));
}

/** Der pod-template-hash des aktuellen Pod-Templates (pur, deterministisch). Nicht im Hash:
 *  replicas, broken, cpuHeavy, evicted, created und alle Laufzeitwerte. */
export function podTemplateHash(dep: Deployment): string {
  const canon = JSON.stringify([dep.name, dep.image, dep.envFrom.configMaps, dep.envFrom.secrets, templateFields(dep)]);
  return safeEncode(String(hashStr(canon)));
}

/** Das ReplicaSet, dem die laufenden Pods des Deployments gehören (nur lesend). Ohne gesetztes
 *  Laufzeitfeld (frisch geladen, noch kein Pod gebaut) leitet es sich aus dem Template ab. */
export function currentReplicaSet(dep: Deployment): { name: string; hash: string; created: number } {
  const hash = dep.replicaSet?.hash ?? podTemplateHash(dep);
  return { name: dep.name + "-" + hash, hash, created: dep.replicaSet?.created ?? dep.created };
}

/** Die Labels der Pods (und der Selektor) des aktuellen ReplicaSets: Workload-Label plus `pod-template-hash`. */
export function podTemplateLabels(dep: Deployment): Labels {
  return { ...workloadLabels(dep.name), "pod-template-hash": currentReplicaSet(dep).hash };
}

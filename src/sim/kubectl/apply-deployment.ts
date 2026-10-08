/* ===== Kubernia – kubectl apply für Deployments (sim/kubectl/apply-deployment.ts, #1300) =====
 * Der apply-Handler für `kind: Deployment`: legt ein neues Deployment aus dem Manifest an oder gleicht
 * ein bestehendes deklarativ ab. Die Pod-Template-Felder stehen in EINER Tabelle (`TEMPLATE_FIELD_TABLE`, typgewacht gegen `PodTemplateSpec`):
 * ein neues Feld = ein Eintrag, Anlegen und Re-apply nutzen dieselbe Tabelle. Jede Template-Änderung
 * rollt neue Pods aus (wie in echtem Kubernetes); eine reine replicas-Änderung skaliert ohne Rollout.
 * Beides läuft über ./rollout (Pod-Security-Admission inklusive).
 * Heil-/Drossel-Regeln (Image, Limits) kommen als Primitive aus ../workload, genau wie bei
 * `kubectl set image|resources`.
 *
 * Semantik beim Re-apply: Fehlt ein Feld im Manifest, bleibt der Ist-Wert (konservativ: es gibt kein
 * last-applied). Nur der securityContext ist deklarativ – ein fehlender Kontext heißt „keiner“, damit
 * die Pod-Security-Admission den Wert prüft, den der Pod danach wirklich hat.
 *
 * Phaser-frei (pure Domäne). Aufgerufen aus ./lifecycle (apply-Handler-Registry). */
import { SECURITY_CONTEXT_KEYS, type ApplyEffect, type Deployment, type PodTemplateSpec, type SecurityContext } from "../state";
import { addDeployment, changeImage, CPU_THROTTLED_NOTE, MEM_HEALED_NOTE, setCpuLimit, setMemoryLimit } from "../workload";
import { admitNewPods, rollOut, scaleTo } from "./rollout";
import type { KubectlHost } from "./host";

type DepEffect = NonNullable<ApplyEffect["deployment"]>;

/** Ein Pod-Template-Feld: Abweichung erkennen und den Manifest-Wert übernehmen. */
interface TemplateField {
  differs(dep: Deployment, eff: DepEffect): boolean;
  take(host: KubectlHost, dep: Deployment, eff: DepEffect, notes: string[]): void;
}

function sameSecurityContext(a: SecurityContext | undefined, b: SecurityContext | undefined): boolean {
  return SECURITY_CONTEXT_KEYS.every(k => a?.[k] === b?.[k]);
}

/** Ein noch nicht gebautes eigenes Image (#164, Werft-Capstone) landet im ImagePullBackOff – genau wie
 *  im echten Cluster. `needsBuild` heilt von selbst, sobald 'docker build'/'docker pull' es bereitstellt. */
function flagUnbuiltImage(host: KubectlHost, dep: Deployment, eff: DepEffect, notes: string[]): void {
  if (!eff.requireBuiltImage || host._imageAvailable(eff.image)) return;
  dep.broken = { type: "imagepull", badImage: eff.image, needsBuild: true };
  notes.push("💡 Pod im ImagePullBackOff: das Image '" + eff.image + "' gibt es noch nicht. Erst 'docker build -t " + eff.image + " .', dann 'kubectl rollout restart deployment " + eff.name + "'.");
}

/** Der initContainer, wie ihn Anlegen und Re-apply normalisiert ablegen (fillsMi-Default 0). */
function normalizedInit(e: DepEffect): Deployment["initContainer"] {
  return e.initContainer ? { fillsMi: e.initContainer.fillsMi ?? 0, doubleStage: !!e.initContainer.doubleStage } : undefined;
}

/** Eine Tabelle über ALLE Template-Felder (`image` plus `PodTemplateSpec`). Der Typ-Wächter `satisfies`
 *  bricht den Typecheck, sobald ein neues Feld hier nicht entschieden ist. `null` = kein Template-Wert:
 *  `ephemeralUsedMi` ist ein Laufzeitwert, jeder Rollout setzt ihn auf 0 – ein Wertvergleich wäre nie
 *  idempotent. Das Anlegen setzt den Startwert weiter (siehe `createDeploymentFromManifest`). Beim
 *  emptyDir zählt nur die Deklaration, nicht der Inhalt. Die Reihenfolge bestimmt die der Notizen. */
const TEMPLATE_FIELD_TABLE = {
  image: {
    differs: (d, e) => d.image !== e.image,
    take(host, d, e, notes) {
      changeImage(d, e.image);
      flagUnbuiltImage(host, d, e, notes);
    },
  },
  containerPort: {
    differs: (d, e) => e.containerPort !== undefined && d.containerPort !== e.containerPort,
    take(_host, d, e) { d.containerPort = e.containerPort; },
  },
  securityContext: {
    differs: (d, e) => !sameSecurityContext(d.securityContext, e.securityContext),
    take(_host, d, e) {
      if (e.securityContext) d.securityContext = { ...e.securityContext };
      else delete d.securityContext;
    },
  },
  serviceAccountName: {
    differs: (d, e) => !!e.serviceAccountName && d.serviceAccountName !== e.serviceAccountName,
    take(_host, d, e) { d.serviceAccountName = e.serviceAccountName; },
  },
  memLimit: {
    differs: (d, e) => e.memLimit !== undefined && d.memLimit !== e.memLimit,
    take(_host, d, e, notes) { if (e.memLimit !== undefined && setMemoryLimit(d, e.memLimit)) notes.push(MEM_HEALED_NOTE); },
  },
  cpuLimitMilli: {
    differs: (d, e) => e.cpuLimitMilli !== undefined && d.cpuLimitMilli !== e.cpuLimitMilli,
    take(_host, d, e, notes) { if (e.cpuLimitMilli !== undefined && setCpuLimit(d, e.cpuLimitMilli)) notes.push(CPU_THROTTLED_NOTE); },
  },
  ephemeralLimit: {
    differs: (d, e) => e.ephemeralLimit !== undefined && d.ephemeralLimit !== e.ephemeralLimit,
    take(_host, d, e) { d.ephemeralLimit = e.ephemeralLimit; },
  },
  node: {
    differs: (d, e) => e.node !== undefined && d.node !== e.node,
    take(_host, d, e) { d.node = e.node; },
  },
  emptyDir: {
    // Nur die Deklaration: ein vorhandenes Volume bleibt (sein Inhalt ist Laufzeitwert).
    differs: (d, e) => !!e.emptyDir && !d.emptyDir,
    take(_host, d, e) { d.emptyDir = { data: e.emptyDir?.data || "", usedMi: e.emptyDir?.usedMi || 0 }; },
  },
  initContainer: {
    differs: (d, e) => {
      const want = normalizedInit(e);
      return !!want && (d.initContainer?.fillsMi !== want.fillsMi || !!d.initContainer?.doubleStage !== !!want.doubleStage);
    },
    take(_host, d, e) { d.initContainer = normalizedInit(e); },
  },
  ephemeralUsedMi: null,
  // Die Annotation `restartedAt` setzt nur `rollout restart`; apply verwaltet sie nicht.
  restartedAt: null,
} satisfies Record<"image" | keyof PodTemplateSpec, TemplateField | null>;

const TEMPLATE_FIELDS: readonly TemplateField[] = Object.values<TemplateField | null>(TEMPLATE_FIELD_TABLE).filter((f): f is TemplateField => f !== null);

/** Ein bestehendes Deployment deklarativ abgleichen (idempotentes apply): jede abweichende
 *  Template-Eigenschaft wird übernommen und löst EINEN Rollout aus, `spec.replicas` skaliert ohne
 *  Rollout. Ändert sich das Template, prüft die Pod-Security-Admission den neuen securityContext;
 *  bei Ablehnung wird nichts übernommen. Ohne Änderung: `unchanged`. */
function reconfigureDeployment(host: KubectlHost, dep: Deployment, eff: DepEffect, out: string[]): string | void {
  const changed = TEMPLATE_FIELDS.filter(f => f.differs(dep, eff));
  const notes: string[] = [];
  if (changed.length > 0) {
    // Admission mit dem NEUEN securityContext; bei Ablehnung wird nichts übernommen.
    const denied = rollOut(host, dep, () => { for (const f of changed) f.take(host, dep, eff, notes); }, eff.securityContext);
    if (denied) return denied;
  }
  // Hochskalieren erzeugt Pods und wird geprüft (nach einem Rollout mit demselben, schon zugelassenen Kontext).
  const scaled = dep.replicas !== eff.replicas;
  if (scaled) {
    const denied = scaleTo(host, dep, eff.replicas);
    if (denied) return denied;
  }
  out.push("deployment.apps/" + eff.name + (changed.length > 0 || scaled ? " configured" : " unchanged"), ...notes);
}

/** Ein neues Deployment aus dem Manifest bauen. Gibt bei Pod-Security-Abweisung (#126) den
 *  Fehlertext zurück (early return in `kubectlApply`). */
function createDeploymentFromManifest(host: KubectlHost, eff: DepEffect, out: string[]): string | void {
  // Pod-Security-Admission (#126): unsichere Pods werden unter baseline/restricted
  // schon beim Anlegen abgewiesen – der Rest des Manifests wird nicht angewandt.
  const denied = admitNewPods(host, eff.name, eff.securityContext);
  if (denied) return denied;
  // Erst ohne Pods bauen, Template übernehmen, dann hochskalieren: die Pods tragen den Hash des fertigen
  // Templates (#1468). Die Admission oben hat den Kontext schon zugelassen.
  const dep = host._makeDeployment(eff.name, eff.image, 0);
  const notes: string[] = [];
  for (const f of TEMPLATE_FIELDS) if (f.differs(dep, eff)) f.take(host, dep, eff, notes);
  // Nur beim Anlegen: die Zusatznutzung (#240) ist ein Laufzeitwert und steht nicht in der Tabelle.
  if (eff.ephemeralUsedMi !== undefined) dep.ephemeralUsedMi = eff.ephemeralUsedMi;
  flagUnbuiltImage(host, dep, eff, notes);
  scaleTo(host, dep, eff.replicas);
  addDeployment(host, dep);
  out.push("deployment.apps/" + eff.name + " created", ...notes);
}

/** apply-Handler für Deployments: bestehendes nach-konfigurieren, sonst neu aus dem Manifest bauen. */
export function applyDeployment(host: KubectlHost, eff: ApplyEffect, out: string[]): string | void {
  const effDep = eff.deployment;
  if (!effDep) return;
  const existing = host.deployments.find(d => d.name === effDep.name);
  if (existing) return reconfigureDeployment(host, existing, effDep, out);
  return createDeploymentFromManifest(host, effDep, out);
}

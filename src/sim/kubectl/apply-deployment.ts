/* ===== Kubernia – kubectl apply für Deployments (sim/kubectl/apply-deployment.ts, #1300) =====
 * Der apply-Handler für `kind: Deployment`: legt ein neues Deployment aus dem Manifest an oder gleicht
 * ein bestehendes deklarativ ab. Die Pod-Template-Felder stehen in EINER Tabelle (`TEMPLATE_FIELDS`):
 * ein neues Feld = ein Eintrag, Anlegen und Re-apply nutzen dieselbe Tabelle. Jede Template-Änderung
 * rollt neue Pods aus (wie in echtem Kubernetes); eine reine replicas-Änderung skaliert ohne Rollout.
 * Heil-/Drossel-Regeln (Image, Limits) kommen als Primitive aus ../workload, genau wie bei
 * `kubectl set image|resources`.
 *
 * Semantik beim Re-apply: Fehlt ein Feld im Manifest, bleibt der Ist-Wert (konservativ: es gibt kein
 * last-applied). Nur der securityContext ist deklarativ – ein fehlender Kontext heißt „keiner“, damit
 * die Pod-Security-Admission den Wert prüft, den der Pod danach wirklich hat.
 *
 * Phaser-frei (pure Domäne). Aufgerufen aus ./lifecycle (apply-Handler-Registry). */
import { SECURITY_CONTEXT_KEYS, type ApplyEffect, type Deployment, type SecurityContext } from "../state";
import { addDeployment, changeImage, replacePods, scaleDeployment, setCpuLimit, setMemoryLimit } from "../workload";
import { CPU_THROTTLED_NOTE, MEM_HEALED_NOTE } from "./ops";
import { admitPod } from "./security";
import type { KubectlHost } from "./host";

type DepEffect = NonNullable<ApplyEffect["deployment"]>;

const PSA_HINT = "Ergänze im Manifest einen passenden securityContext (z.B. runAsNonRoot: true) oder senke die enforce-Stufe.";

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

const TEMPLATE_FIELDS: readonly TemplateField[] = [
  {
    differs: (d, e) => d.image !== e.image,
    take(host, d, e, notes) {
      changeImage(d, e.image);
      flagUnbuiltImage(host, d, e, notes);
    },
  },
  {
    differs: (d, e) => e.containerPort !== undefined && d.containerPort !== e.containerPort,
    take(_host, d, e) { d.containerPort = e.containerPort; },
  },
  {
    differs: (d, e) => !sameSecurityContext(d.securityContext, e.securityContext),
    take(_host, d, e) {
      if (e.securityContext) d.securityContext = { ...e.securityContext };
      else delete d.securityContext;
    },
  },
  {
    differs: (d, e) => !!e.serviceAccountName && d.serviceAccountName !== e.serviceAccountName,
    take(_host, d, e) { d.serviceAccountName = e.serviceAccountName; },
  },
  {
    differs: (d, e) => e.memLimit !== undefined && d.memLimit !== e.memLimit,
    take(_host, d, e, notes) { if (e.memLimit !== undefined && setMemoryLimit(d, e.memLimit)) notes.push(MEM_HEALED_NOTE); },
  },
  {
    differs: (d, e) => e.cpuLimitMilli !== undefined && d.cpuLimitMilli !== e.cpuLimitMilli,
    take(_host, d, e, notes) { if (e.cpuLimitMilli !== undefined && setCpuLimit(d, e.cpuLimitMilli)) notes.push(CPU_THROTTLED_NOTE); },
  },
  {
    differs: (d, e) => e.ephemeralLimit !== undefined && d.ephemeralLimit !== e.ephemeralLimit,
    take(_host, d, e) { d.ephemeralLimit = e.ephemeralLimit; },
  },
];

/** Ein bestehendes Deployment deklarativ abgleichen (idempotentes apply): jede abweichende
 *  Template-Eigenschaft wird übernommen und löst EINEN Rollout aus, `spec.replicas` skaliert ohne
 *  Rollout. Ändert sich das Template, prüft die Pod-Security-Admission den neuen securityContext;
 *  bei Ablehnung wird nichts übernommen. Ohne Änderung: `unchanged`. */
function reconfigureDeployment(host: KubectlHost, dep: Deployment, eff: DepEffect, out: string[]): string | void {
  const changed = TEMPLATE_FIELDS.filter(f => f.differs(dep, eff));
  if (changed.length > 0) {
    const denied = admitPod(host, eff.name, eff.securityContext);
    if (denied) return host._err(denied, PSA_HINT);
  }
  const notes: string[] = [];
  for (const f of changed) f.take(host, dep, eff, notes);
  if (changed.length > 0) {
    // Neue Pods geben das flüchtige Scratch-Volume frei (#240), wie beim rollout restart.
    host._resetEphemeral(dep);
    replacePods(dep, host.clock, host.rng);
  }
  const scaled = dep.replicas !== eff.replicas;
  if (scaled) scaleDeployment(dep, eff.replicas, host.clock, host.rng);
  out.push("deployment.apps/" + eff.name + (changed.length > 0 || scaled ? " configured" : " unchanged"), ...notes);
}

/** Ein neues Deployment aus dem Manifest bauen. Gibt bei Pod-Security-Abweisung (#126) den
 *  Fehlertext zurück (early return in `kubectlApply`). */
function createDeploymentFromManifest(host: KubectlHost, eff: DepEffect, out: string[]): string | void {
  // Pod-Security-Admission (#126): unsichere Pods werden unter baseline/restricted
  // schon beim Anlegen abgewiesen – der Rest des Manifests wird nicht angewandt.
  const denied = admitPod(host, eff.name, eff.securityContext);
  if (denied) return host._err(denied, PSA_HINT);
  const dep = host._makeDeployment(eff.name, eff.image, eff.replicas);
  const notes: string[] = [];
  for (const f of TEMPLATE_FIELDS) if (f.differs(dep, eff)) f.take(host, dep, eff, notes);
  // Nur beim Anlegen: Node-Pin, emptyDir, Zusatznutzung (#240) und initContainer (#485), der beim
  // Ausrollen das emptyDir vorfüllt; der (bei Doppelablage doppelte) Peak entscheidet über die Eviction.
  if (eff.node !== undefined) dep.node = eff.node;
  if (eff.emptyDir) dep.emptyDir = { data: eff.emptyDir.data || "", usedMi: eff.emptyDir.usedMi || 0 };
  if (eff.ephemeralUsedMi !== undefined) dep.ephemeralUsedMi = eff.ephemeralUsedMi;
  if (eff.initContainer) dep.initContainer = { fillsMi: eff.initContainer.fillsMi ?? 0, doubleStage: !!eff.initContainer.doubleStage };
  flagUnbuiltImage(host, dep, eff, notes);
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

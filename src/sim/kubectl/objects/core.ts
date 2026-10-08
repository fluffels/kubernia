/* ===== Kubernia – YAML-Bausteine der Kern-API v1 (sim/kubectl/objects/core.ts, #1467) =====
 * Die Objekte für `kubectl get <typ> -o yaml` der Gruppe `v1`: Pod, Service, PersistentVolumeClaim, dazu der
 * gemeinsame Pod-Spec-Bauer (auch für Deployment, ReplicaSet und StatefulSet in ./apps). Gespiegelt wird das
 * Mapper-Paar in ../../manifest/core.ts: was der Mapper aus einem Manifest liest, schreibt dieser Baustein wieder
 * hin; der Round-Trip-Test (`apply -f` → `get -o yaml` → `effectsFromManifest`) wacht darüber.
 *
 * Nur modellierte Felder, nichts erfunden: kein uid, keine resourceVersion am Objekt, kein managedFields, kein
 * creationTimestamp (die Sim hat nur relative Ticks), keine ownerReferences. Der Status ist eine Teilmenge
 * (Phase, IP, Container-Zustände), und zwar nur das, was `describe pod` bzw. `get` schon zeigt.
 * Die `omitempty`-Regeln folgen k8s.io/api (core/v1): leere Status-Felder fehlen.
 *
 * Phaser-frei (pure Domäne); importiert nie ./get-yaml oder ../get (kein Zyklus). */
import type { YamlValue } from "../../yaml";
import type { YamlMap } from "../../yaml-emit";
import type { KubectlHost } from "../host";
import {
  DEFAULT_NAMESPACE, VOLUME_MODE, SECURITY_CONTEXT_KEYS, isExternalNameService,
  type Broken, type Deployment, type PodTemplateSpec, type PvcRes, type RsTemplate, type ServiceRes,
} from "../../state";
import { servicesWithDefault, serviceSelector, isKubernetesService } from "../../endpoints";
import { clusterPods, type ClusterPod } from "../../pods";
import { BROKEN_POD, clusterPodStatus, isReady } from "../../podstatus";
import { podTemplateLabels } from "../../replicasets";
import { workloadLabels, type Labels } from "../../util";
import { statefulPodClaimName, snapshotPodTemplate } from "../../workload";
import { accessModesLong } from "../../pv-controller";
import { podPlacement } from "../inspect";

/** Ein Objekt-Baustein: alle Objekte einer Art, nach Name (in der Reihenfolge der Tabelle). */
export type ObjectsOf = (host: KubectlHost) => Map<string, YamlMap>;

/** Das Mapping ohne die `undefined`-Werte (fehlende Felder erscheinen nicht in der Ausgabe). */
export function compact(o: Record<string, YamlValue | undefined>): YamlMap {
  const out: YamlMap = {};
  for (const [k, v] of Object.entries(o)) if (v !== undefined) out[k] = v;
  return out;
}

/** `metadata` mit Name, Namespace und optionalen Labels und Annotationen. */
export function metaOf(name: string, labels?: Labels, annotations?: Record<string, string>): YamlMap {
  return compact({ annotations, labels, name, namespace: DEFAULT_NAMESPACE });
}

// ===== Mengenangaben =====

/** Mi als kubectl-Quantity: ganze Gi als `NGi`, sonst `NMi`. */
export function memQuantity(mi: number): string {
  return mi >= 1024 && mi % 1024 === 0 ? mi / 1024 + "Gi" : mi + "Mi";
}

/** Milli-Cores als Quantity: ganze Cores als `N`, sonst `Nm`. */
export function cpuQuantity(milli: number): string {
  return milli >= 1000 && milli % 1000 === 0 ? String(milli / 1000) : milli + "m";
}

/** Eine Port-Zahl (die Helm-Ausgabe speichert `"80"` als Text): Ganzzahl-Text wird zur Zahl, ein Port-Name bleibt Text. */
export function portValue(v: string | number): string | number {
  return typeof v === "string" && /^\d+$/.test(v) ? Number(v) : v;
}

// ===== Pod-Spec aus dem Template =====

/** Was ein Template-Feld zur Pod-Spec beiträgt: Pod-Ebene, Container-Ebene, Limits. */
interface SpecParts { pod: YamlMap; container: YamlMap; limits: YamlMap }
type FieldWriter = (tpl: PodTemplateSpec, parts: SpecParts) => void;

/** EIN Eintrag je `PodTemplateSpec`-Feld (`satisfies` bricht den Typecheck, sobald ein neues Feld hier
 *  nicht entschieden ist, Muster `HASH_FORM` in ../../replicasets.ts). Laufzeitwerte (`ephemeralUsedMi`,
 *  `restartedAt`) und Sim-Sonderfelder gehören nicht in ein Manifest-YAML. */
const FIELD_WRITERS = {
  serviceAccountName: (t, p) => { if (t.serviceAccountName !== undefined) p.pod.serviceAccountName = t.serviceAccountName; },
  containerPort: (t, p) => { if (t.containerPort !== undefined) p.container.ports = [{ containerPort: t.containerPort }]; },
  memLimit: (t, p) => { if (t.memLimit !== undefined) p.limits.memory = memQuantity(t.memLimit); },
  cpuLimitMilli: (t, p) => { if (t.cpuLimitMilli !== undefined) p.limits.cpu = cpuQuantity(t.cpuLimitMilli); },
  securityContext: (t, p) => {
    const set = SECURITY_CONTEXT_KEYS.filter(k => t.securityContext?.[k] !== undefined);
    if (set.length > 0) p.container.securityContext = Object.fromEntries(set.map(k => [k, t.securityContext?.[k] ?? null]));
  },
  node: (t, p) => { if (t.node !== undefined) p.pod.nodeName = t.node; },
  emptyDir: (t, p) => { if (t.emptyDir) p.pod.volumes = [{ emptyDir: {}, name: "scratch" }]; },
  ephemeralLimit: (t, p) => { if (t.ephemeralLimit !== undefined) p.limits["ephemeral-storage"] = memQuantity(t.ephemeralLimit); },
  ephemeralUsedMi: () => undefined,
  initContainer: (t, p) => { if (t.initContainer) p.pod.initContainers = [{ name: "vorbereiter" }]; },
  restartedAt: () => undefined,
} satisfies Record<keyof PodTemplateSpec, FieldWriter>;

/** `envFrom` des Containers aus den eingebundenen ConfigMaps und Secrets (leer → fehlt). */
function envFromOf(envFrom: RsTemplate["envFrom"]): YamlValue | undefined {
  const refs: YamlValue[] = [
    ...envFrom.configMaps.map(name => ({ configMapRef: { name } })),
    ...envFrom.secrets.map(name => ({ secretRef: { name } })),
  ];
  return refs.length > 0 ? refs : undefined;
}

/** Die Pod-Spec eines Deployments (Template des Deployments und seines aktuellen ReplicaSets, Grundlage der Pods). */
export function deploymentPodSpec(dep: Deployment): YamlMap {
  return podSpecOf(dep.name, { image: dep.image, envFrom: dep.envFrom, spec: snapshotPodTemplate(dep) });
}

/** Die Pod-Spec aus einem Template (auch dem eines alten ReplicaSets, #1471); `name` ist der Container-Name. */
export function podSpecOf(name: string, t: RsTemplate): YamlMap {
  const tpl = t.spec;
  const parts: SpecParts = { pod: {}, container: {}, limits: {} };
  for (const write of Object.values(FIELD_WRITERS) as FieldWriter[]) write(tpl, parts);
  const container = compact({
    ...parts.container,
    envFrom: envFromOf(t.envFrom),
    image: t.image,
    name,
    resources: Object.keys(parts.limits).length > 0 ? { limits: parts.limits } : undefined,
  });
  return { ...parts.pod, containers: [container] };
}

// ===== Pod =====

/** Wie sich ein Pod im Status zeigt: Phase, Bereitschaft, Container-Zustand (nur, was `describe pod` schon zeigt). */
interface PodShape { phase: string; ready: boolean; state?: YamlMap; lastState?: YamlMap; noContainer?: boolean }

const WAITING = (reason: string): YamlMap => ({ waiting: { reason } });

/** Die Form eines kaputten Pods, abgeleitet aus dem EINEN Eintrag in `BROKEN_POD` (../../podstatus.ts). */
function brokenShape(type: Broken["type"]): PodShape {
  const e = BROKEN_POD[type];
  const c = e.container;
  return {
    phase: e.phase,
    ready: isReady(e.status),
    noContainer: c === null,
    state: c === null ? undefined : c.waiting ? WAITING(c.waiting) : { running: {} },
    lastState: c?.lastTerminated ? { terminated: { exitCode: c.lastTerminated.exitCode, reason: c.lastTerminated.reason } } : undefined,
  };
}
const HEALTHY_SHAPE: PodShape = { phase: "Running", ready: true, state: { running: {} } };
const EVICTED_SHAPE: PodShape = { phase: "Failed", ready: false, noContainer: true };
const STS_PENDING_SHAPE: PodShape = { phase: "Pending", ready: false, noContainer: true };

function podShape(c: ClusterPod, scheduled: boolean): PodShape {
  if (c.owner === "StatefulSet") return scheduled ? HEALTHY_SHAPE : STS_PENDING_SHAPE;
  if (c.dep.evicted) return EVICTED_SHAPE;
  return c.dep.broken ? brokenShape(c.dep.broken.type) : HEALTHY_SHAPE;
}

function podStatus(host: KubectlHost, c: ClusterPod, ip: string | null): YamlMap {
  const shape = podShape(c, ip !== null);
  const st = clusterPodStatus(host, c);
  const workload = c.owner === "Deployment" ? c.dep : c.sts;
  const evicted = c.owner === "Deployment" ? c.dep.evicted : null;
  return compact({
    containerStatuses: shape.noContainer
      ? undefined
      : [{ image: workload.image, lastState: shape.lastState ?? {}, name: workload.name, ready: shape.ready, restartCount: st.restarts, state: shape.state ?? {} }],
    message: evicted ? evicted.reason : undefined,
    phase: shape.phase,
    podIP: ip ?? undefined,
    reason: evicted ? "Evicted" : undefined,
  });
}

function podSpec(c: ClusterPod, node: string | null): YamlMap {
  if (c.owner === "Deployment") {
    return compact({ ...deploymentPodSpec(c.dep), nodeName: node ?? undefined });
  }
  return compact({
    containers: [{ image: c.sts.image, name: c.sts.name }],
    nodeName: node ?? undefined,
    volumes: [{ name: c.sts.volumeClaimName, persistentVolumeClaim: { claimName: statefulPodClaimName(c.sts, c.pod) } }],
  });
}

function podObject(host: KubectlHost, c: ClusterPod): YamlMap {
  const { ip, node } = podPlacement(host, c);
  const labels = c.owner === "Deployment" ? podTemplateLabels(c.dep) : workloadLabels(c.sts.name);
  return {
    apiVersion: "v1", kind: "Pod", metadata: metaOf(c.pod.name, labels),
    spec: podSpec(c, node), status: podStatus(host, c, ip),
  };
}

export const podObjects: ObjectsOf = host => new Map(clusterPods(host).map(c => [c.pod.name, podObject(host, c)]));

// ===== Service =====

function servicePorts(svc: ServiceRes): YamlValue[] | undefined {
  if (isExternalNameService(svc)) return undefined;
  return [compact({
    name: isKubernetesService(svc) ? "https" : undefined,
    port: portValue(svc.port),
    protocol: "TCP",
    targetPort: svc.targetPort === undefined ? undefined : portValue(svc.targetPort), // nur wenn gesetzt: die Sim wertet einen fehlenden targetPort anders als `port` (net.ts), der Round-Trip bleibt exakt
  })];
}

function serviceObject(host: KubectlHost, svc: ServiceRes): YamlMap {
  const external = isExternalNameService(svc);
  return {
    apiVersion: "v1", kind: "Service",
    metadata: metaOf(svc.name, isKubernetesService(svc) ? { component: "apiserver", provider: "kubernetes" } : undefined),
    spec: compact({
      clusterIP: external ? undefined : svc.clusterIP,
      externalName: external ? svc.externalName : undefined,
      ports: servicePorts(svc),
      selector: serviceSelector(host, svc) ?? undefined,
      type: svc.type,
    }),
    status: { loadBalancer: {} },
  };
}

export const serviceObjects: ObjectsOf = host => new Map(servicesWithDefault(host).map(s => [s.name, serviceObject(host, s)]));

// ===== PersistentVolumeClaim =====

function pvcObject(pvc: PvcRes): YamlMap {
  const bound = pvc.status === "Bound";
  const modes = accessModesLong(pvc.accessModes);
  return {
    apiVersion: "v1", kind: "PersistentVolumeClaim", metadata: metaOf(pvc.name),
    spec: compact({
      accessModes: modes.length > 0 ? modes : undefined,
      resources: { requests: { storage: pvc.capacity } },
      storageClassName: pvc.storageClass,
      volumeMode: VOLUME_MODE,
      volumeName: pvc.volume !== "" ? pvc.volume : undefined,
    }),
    status: compact({
      accessModes: bound && modes.length > 0 ? modes : undefined,
      capacity: bound ? { storage: pvc.capacity } : undefined,
      phase: pvc.status,
    }),
  };
}

export const pvcObjects: ObjectsOf = host => new Map(host.pvcs.map(p => [p.name, pvcObject(p)]));

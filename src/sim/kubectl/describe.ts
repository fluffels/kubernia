/* ===== Kubernia – kubectl describe (sim/kubectl/describe.ts, #1465) =====
 * Der `describe`-Dispatcher und die Renderer für Deployment, Service, PVC und StatefulSet. Die
 * Renderer für Node, Ingress, NetworkPolicy, Role und ServiceAccount; der Pod-Renderer liegt in ./describe-pod.ts.
 *
 * Echtes `kubectl describe TYPE [NAME_PREFIX]`: ohne Namen alle Objekte der Art, mit einem Namen der
 * exakte Treffer, sonst jedes Objekt mit diesem Präfix; die Slash-Form `typ/name` gilt nur exakt. Die
 * Trenner folgen dem kubectl-Quelltext: ohne Namen zwei Leerzeilen zwischen den Objekten, beim Präfix eine.
 * Mehrere Namen (`describe pods a b`): jeder Name gilt exakt (die Präfix-Suche nur bei genau einem), die Treffer stehen
 * hintereinander, je fehlendem Namen folgt am Ende ein NotFound.
 *
 * Ein neuer beschreibbarer Typ ist ein neuer Eintrag in `DESCRIBE_ENTRIES` (Namensliste + Renderer);
 * der Dispatcher wächst nicht mit. Nur modellierte Felder: nichts wird erfunden (Selektoren gibt es
 * nicht, der Name ist die Verdrahtung, siehe ../endpoints.ts).
 *
 * Phaser-frei (pure Domäne); importiert nur die get-Hilfen aus ./inspect; inspect importiert nie describe*, top oder logs (kein Zyklus).
 */
import type { KubectlHost } from "./host";
import { DEFAULT_NAMESPACE, VOLUME_MODE, isExternalNameService, type ClusterNode, isHeadlessService, type Deployment, type PvcRes, type ServiceRes, type StatefulSetRes } from "../state";
import { RESOURCE_KINDS, resolveKind, qualified, type ResourceKind, type ResourcePlural } from "./resources";
import { positionals, typeAndName, notSimulated, unknownResourceType } from "./args";
import { workloadSelector } from "../util";
import { clusterPods } from "../pods";
import { clusterPodStatus } from "../podstatus";
import { endpointAddresses, serviceSelector, servicesWithDefault } from "../endpoints";
import { statefulPodClaimName } from "../workload";
import { availableReplicas, noResourcesIn, INGRESS_ADDRESS } from "./inspect";
import { describePod, podLimitLines, podSecurityLines } from "./describe-pod";
import { sameRbac } from "../rbac";
import { nodeInternalIP, NODE_SYSTEM_INFO } from "../nodes";

/** Eine beschreibbare Art: ihre Objektnamen (ohne Nebenwirkung) und der Renderer für ein Objekt. */
interface DescribeEntry {
  names(host: KubectlHost, kind: ResourceKind): string[];
  render(host: KubectlHost, name: string, kind: ResourceKind): string;
}

/** `Schlüssel:` auf eine feste Spalte gebracht, ohne hängende Leerzeichen bei leerem Wert. */
function kv(key: string, value: string | number, width = 19): string {
  return ((key + ":").padEnd(width) + value).trimEnd();
}

function notFound(host: KubectlHost, kind: ResourceKind, name: string): string {
  return host._err("Error from server (NotFound): " + qualified(kind, "plural") + ' "' + name + '" not found',
    "Tipp: Namen aus 'kubectl get " + kind.plural + "' kopieren.");
}

// ===== Deployment =====

function deploymentConditions(desired: number, available: number): string[] {
  const minAvailable = desired - Math.floor(desired / 4); // Default maxUnavailable 25 %, abgerundet
  const up = available >= minAvailable;
  return [
    "Conditions:",
    "  Type         Status  Reason",
    "  ----         ------  ------",
    "  Available    " + (up ? "True    MinimumReplicasAvailable" : "False   MinimumReplicasUnavailable"),
    "  Progressing  True    " + (available >= desired ? "NewReplicaSetAvailable" : "ReplicaSetUpdated"),
  ];
}

function deploymentEnvFrom(dep: Deployment): string[] {
  const { configMaps, secrets } = dep.envFrom;
  if (configMaps.length + secrets.length === 0) return [];
  return [
    "    Environment Variables from:",
    ...configMaps.map(n => "      " + n + "  ConfigMap  Optional: false"),
    ...secrets.map(n => "      " + n + "  Secret     Optional: false"),
  ];
}

function deploymentTemplate(host: KubectlHost, dep: Deployment): string[] {
  return [
    "Pod Template:",
    "  Labels:  " + workloadSelector(dep.name),
    ...(dep.serviceAccountName ? ["  Service Account:  " + dep.serviceAccountName] : []),
    "  Containers:",
    "   " + dep.name + ":",
    "    Image:  " + dep.image,
    "    Port:   " + (dep.containerPort !== undefined ? dep.containerPort + "/TCP" : "<none>"),
    ...podLimitLines(host, dep),
    ...podSecurityLines(dep),
    ...deploymentEnvFrom(dep),
    ...(dep.emptyDir
      ? ["  Volumes:", "   scratch:", "    Type:  EmptyDir (a temporary directory that shares a pod's lifetime)"]
      : ["  Volumes:  <none>"]),
  ];
}

function describeDeployment(host: KubectlHost, name: string, kind: ResourceKind): string {
  const dep = host.deployments.find(d => d.name === name);
  if (!dep) return notFound(host, kind, name);
  const available = availableReplicas(host, dep);
  const total = dep.pods.length;
  return [
    kv("Name", dep.name, 24),
    kv("Namespace", DEFAULT_NAMESPACE, 24),
    kv("Selector", workloadSelector(dep.name), 24),
    kv("Replicas", dep.replicas + " desired | " + total + " updated | " + total + " total | " + available + " available | " + Math.max(0, dep.replicas - available) + " unavailable", 24),
    kv("StrategyType", "RollingUpdate", 24),
    ...deploymentTemplate(host, dep),
    ...deploymentConditions(dep.replicas, available),
    kv("Events", "<none>", 24),
  ].join("\n");
}

// ===== Service =====

function describeService(host: KubectlHost, name: string, kind: ResourceKind): string {
  const svc: ServiceRes | undefined = servicesWithDefault(host).find(s => s.name === name);
  if (!svc) return notFound(host, kind, name);
  const external = isExternalNameService(svc);
  const ip = external ? "" : isHeadlessService(svc) ? "None" : svc.clusterIP;
  const endpoints = endpointAddresses(host, svc);
  return [
    kv("Name", svc.name),
    kv("Namespace", DEFAULT_NAMESPACE),
    kv("Selector", serviceSelector(host, svc) ?? "<none>"),
    kv("Type", svc.type),
    kv("IP", ip),
    ...(external ? [kv("External Name", svc.externalName ?? "")] : [
      kv("Port", "<unset>  " + svc.port + "/TCP"),
      kv("TargetPort", (svc.targetPort ?? svc.port) + "/TCP"),
      kv("Endpoints", endpoints.length ? endpoints.join(",") : "<none>"),
    ]),
    kv("Events", "<none>"),
  ].join("\n");
}

// ===== PersistentVolumeClaim =====

const eventRow = (type: string, reason: string, age: string, message: string): string =>
  "  " + type.padEnd(9) + reason.padEnd(20) + age.padEnd(6) + message;

/** Die Events eines Pending-PVC, je nach Ursache (Wortlaut aus dem Kubernetes-PV-Controller). */
function pvcEvents(host: KubectlHost, pvc: PvcRes): string[] {
  if (pvc.status !== "Pending") return [];
  const age = host._age(pvc.created);
  const head = [eventRow("Type", "Reason", "Age", "Message"), eventRow("----", "------", "----", "-------")];
  if (pvc.storageClass === "") {
    return [...head, eventRow("Normal", "FailedBinding", age, "no persistent volumes available for this claim and no storage class is set")];
  }
  if (!host.storageClasses.some(c => c.name === pvc.storageClass)) {
    return [...head, eventRow("Warning", "ProvisioningFailed", age, 'storageclass.storage.k8s.io "' + pvc.storageClass + '" not found')];
  }
  return [];
}

function describePvc(host: KubectlHost, name: string, kind: ResourceKind): string {
  const pvc = host.pvcs.find(p => p.name === name);
  if (!pvc) return notFound(host, kind, name);
  const bound = pvc.status === "Bound";
  const usedBy = host.statefulSets.flatMap(s => s.pods.filter(p => statefulPodClaimName(s, p) === pvc.name).map(p => String(p.name)));
  const events = pvcEvents(host, pvc);
  return [
    kv("Name", pvc.name, 15),
    kv("Namespace", DEFAULT_NAMESPACE, 15),
    kv("StorageClass", pvc.storageClass, 15),
    kv("Status", pvc.status, 15),
    kv("Volume", pvc.volume, 15),
    kv("Capacity", bound ? pvc.capacity : "", 15),
    kv("Access Modes", bound ? pvc.accessModes : "", 15),
    kv("VolumeMode", VOLUME_MODE, 15),
    kv("Used By", usedBy.length ? usedBy.join("\n" + " ".repeat(15)) : "<none>", 15),
    ...(events.length ? ["Events:", ...events] : [kv("Events", "<none>", 15)]),
  ].join("\n");
}

// ===== StatefulSet =====

function podsStatus(host: KubectlHost, sts: StatefulSetRes): string {
  const pods = clusterPods(host).filter(c => c.owner === "StatefulSet" && c.sts.name === sts.name);
  const running = pods.filter(c => clusterPodStatus(host, c).status === "Running").length;
  return running + " Running / " + (pods.length - running) + " Waiting / 0 Succeeded / 0 Failed";
}

function describeStatefulSet(host: KubectlHost, name: string, kind: ResourceKind): string {
  const sts = host.statefulSets.find(s => s.name === name);
  if (!sts) return notFound(host, kind, name);
  return [
    kv("Name", sts.name, 24),
    kv("Namespace", DEFAULT_NAMESPACE, 24),
    kv("Selector", workloadSelector(sts.name), 24),
    kv("Replicas", sts.replicas + " desired | " + sts.pods.length + " total", 24),
    kv("Update Strategy", "RollingUpdate", 24),
    "  Partition:  0",
    kv("Pods Status", podsStatus(host, sts), 24),
    "Pod Template:",
    "  Labels:  " + workloadSelector(sts.name),
    "  Containers:",
    "   " + sts.name + ":",
    "    Image:  " + sts.image,
    "  Volumes:  <none>",
    "Volume Claims:",
    kv("  Name", sts.volumeClaimName, 17),
    kv("  StorageClass", sts.storageClass ?? "", 17),
    kv("  Capacity", sts.storage, 17),
    kv("  Access Modes", "[ReadWriteOnce]", 17),
    kv("Events", "<none>", 24),
  ].join("\n");
}

// ===== Node, Ingress, NetworkPolicy, Role, ServiceAccount =====

/** Addresses-Block von `describe node`: InternalIP (dieselbe Adresse wie `get nodes -o wide`) und Hostname. */
function nodeAddressLines(node: ClusterNode): string[] {
  return ["Addresses:", "  InternalIP:  " + nodeInternalIP(node), "  Hostname:    " + node.name];
}

/** System-Info-Block von `describe node`, aus `NODE_SYSTEM_INFO` und der Knoten-Version. Machine ID, System UUID und
 *  Boot ID fehlen bewusst (Grenze `describe-gekuerzt`). */
function nodeSystemInfoLines(node: ClusterNode): string[] {
  const i = NODE_SYSTEM_INFO;
  const row = (k: string, v: string) => "  " + (k + ":").padEnd(28) + v;
  return ["System Info:", row("Kernel Version", i.kernelVersion), row("OS Image", i.osImage), row("Operating System", i.operatingSystem),
    row("Architecture", i.architecture), row("Container Runtime Version", i.containerRuntimeVersion),
    row("Kubelet Version", node.version), row("Kube-Proxy Version", node.version)];
}

export function describeNode(host: KubectlHost, name: string): string {
  const node = host.nodes.find(n => n.name === name);
  if (!node) return host._err('Error from server (NotFound): nodes "' + name + '" not found', "Tipp: Namen aus 'kubectl get nodes' kopieren.");
  const lines = [
    "Name:               " + node.name,
    "Roles:              " + node.roles,
    "Conditions:",
    "  Type             Status",
    "  ----             ------",
    "  MemoryPressure   False",
    // DiskPressure ist die Lern-Pointe (#240): True = der kubelet evictet Pods, um Disk zu schaffen.
    "  DiskPressure     " + (node.diskPressure ? "True" : "False"),
    "  Ready            True",
    ...nodeAddressLines(node),
  ];
  // Ephemeral-Storage-Bilanz nur zeigen, wenn der Knoten eine Kapazität hat (sonst „unbegrenzt").
  const capacity = node.ephemeralCapacityMi !== undefined;
  if (capacity) lines.push("Capacity:", "  ephemeral-storage:  " + node.ephemeralCapacityMi + "Mi");
  lines.push(...nodeSystemInfoLines(node));
  if (capacity) {
    const used = host._nodeEphemeralUsed(node.name);
    lines.push(
      "Allocated resources:",
      "  Resource           Used",
      "  --------           ----",
      "  ephemeral-storage  " + used + "Mi" + (node.diskPressure ? "  (über der Schwelle – DiskPressure!)" : ""),
    );
  }
  // Evictete Pods dieses Knotens auflisten – so wird sichtbar, wen der Druck getroffen hat.
  const evicted = host.deployments.filter(d => d.evicted && host._nodeOf(d) === node.name);
  if (evicted.length) {
    lines.push("Evicted pods:");
    for (const d of evicted) for (const p of d.pods) lines.push("  " + p.name + "  (" + d.evicted!.reason + ")");
  }
  return lines.join("\n");
}

export function describeIngress(host: KubectlHost, name: string): string {
  const ing = host.ingresses.find(i => i.name === name);
  if (!ing) return host._err('Error from server (NotFound): ingresses.networking.k8s.io "' + name + '" not found', "Tipp: Namen aus 'kubectl get ingress' kopieren.");
  const svcExists = host.services.some(s => s.name === ing.service);
  const secretExists = ing.tls ? host.secrets.some(s => s.name === ing.tls!.secretName) : true;
  return [
    "Name:             " + ing.name,
    "Namespace:        " + DEFAULT_NAMESPACE,
    "Address:          " + INGRESS_ADDRESS,
    "Ingress Class:    " + ing.className,
    ...(ing.tls ? [
      "TLS:",
      "  " + ing.tls.secretName + " terminates " + ing.host +
        (secretExists ? "" : "  (⚠ Secret '" + ing.tls.secretName + "' gibt es nicht – HTTPS bleibt zu!)"),
    ] : []),
    "Rules:",
    "  Host        Path  Backends",
    "  ----        ----  --------",
    "  " + ing.host + "  " + ing.path + "   " + ing.service + ":" + ing.port +
      (svcExists ? "" : "  (⚠ Service '" + ing.service + "' gibt es nicht – der Ingress lotst ins Leere!)"),
  ].join("\n");
}

export function describeNetworkPolicy(host: KubectlHost, name: string): string {
  const np = host.networkPolicies.find(n => n.name === name);
  if (!np) return host._err('Error from server (NotFound): networkpolicies.networking.k8s.io "' + name + '" not found', "Tipp: Namen aus 'kubectl get networkpolicies' kopieren.");
  return [
    "Name:         " + np.name,
    "Namespace:    " + DEFAULT_NAMESPACE,
    "PodSelector:  " + (np.podSelector ? workloadSelector(np.podSelector) : "<none> (gilt für alle Pods im Namespace)"),
    "PolicyTypes:  Ingress",
    "Allowing ingress traffic:",
    np.allowFrom
      ? "  From: Pods mit Label " + workloadSelector(np.allowFrom)
      : "  <none> (default-deny: niemand darf rein, bis du eine Quelle erlaubst)",
  ].join("\n");
}

export function describeRole(host: KubectlHost, name: string, kind: ResourceKind): string {
  const cluster = kind.plural === "clusterroles";
  const role = host.roles.find(r => sameRbac(r, { name, cluster }));
  if (!role) return host._err('Error from server (NotFound): ' + qualified(kind, "plural") + ' "' + name + '" not found', "Tipp: Namen aus 'kubectl get " + kind.plural + "' kopieren.");
  const lines = [
    "Name:         " + role.name,
    ...(cluster ? [] : ["Namespace:    " + DEFAULT_NAMESPACE]),
    "PolicyRule:",
    "  Resources  Verbs",
    "  ---------  -----",
  ];
  for (const rule of role.rules) lines.push("  " + rule.resources.join(",") + "  [" + rule.verbs.join(" ") + "]");
  return lines.join("\n");
}

export function describeServiceAccount(host: KubectlHost, name: string): string {
  const acc = host.serviceAccounts.find(s => s.name === name);
  if (!acc) return host._err('Error from server (NotFound): serviceaccounts "' + name + '" not found', "Tipp: Namen aus 'kubectl get sa' kopieren.");
  return ["Name:         " + acc.name, "Namespace:    " + DEFAULT_NAMESPACE, "Mountable secrets:  <none>"].join("\n");
}

// ===== Registry + Dispatcher =====

const fromList = (list: (host: KubectlHost) => readonly { name: string }[]) =>
  (host: KubectlHost): string[] => list(host).map(o => o.name);

/** Die beschreibbaren Typen (Schlüssel = Plural aus ./resources). */
export const DESCRIBE_ENTRIES: ReadonlyMap<ResourcePlural, DescribeEntry> = new Map<ResourcePlural, DescribeEntry>([
  ["nodes", { names: fromList(h => h.nodes), render: describeNode }],
  ["ingresses", { names: fromList(h => h.ingresses), render: describeIngress }],
  ["networkpolicies", { names: fromList(h => h.networkPolicies), render: describeNetworkPolicy }],
  ["roles", { names: (h, k) => h.roles.filter(r => !!r.cluster === (k.plural === "clusterroles")).map(r => r.name), render: describeRole }],
  ["clusterroles", { names: (h, k) => h.roles.filter(r => !!r.cluster === (k.plural === "clusterroles")).map(r => r.name), render: describeRole }],
  ["serviceaccounts", { names: fromList(h => h.serviceAccounts), render: describeServiceAccount }],
  ["pods", { names: h => clusterPods(h).map(c => String(c.pod.name)), render: describePod }],
  ["deployments", { names: fromList(h => h.deployments), render: describeDeployment }],
  ["services", { names: fromList(servicesWithDefault), render: describeService }],
  ["persistentvolumeclaims", { names: fromList(h => h.pvcs), render: describePvc }],
  ["statefulsets", { names: fromList(h => h.statefulSets), render: describeStatefulSet }],
]);

/** Die Hilfe-Liste „was kann describe“, aus der Registry abgeleitet (Singular je Typ). */
function describableTypes(): string {
  return RESOURCE_KINDS.filter(k => DESCRIBE_ENTRIES.has(k.plural)).map(k => k.singular).join("|");
}

/** Mehrere Namen: ohne Namen zwei Leerzeilen zwischen den Objekten, beim Präfix eine (wie kubectl). */
function renderAll(host: KubectlHost, entry: DescribeEntry, kind: ResourceKind, names: string[], separator: string): string {
  return names.map(n => entry.render(host, n, kind)).join(separator);
}

/** `describe <typ> a b …`: jeder Name exakt, Treffer hintereinander, am Ende je fehlendem Namen ein NotFound. */
function describeMany(host: KubectlHost, entry: DescribeEntry, kind: ResourceKind, wanted: string[]): string {
  const have = entry.names(host, kind);
  const found = wanted.filter(n => have.includes(n));
  const missing = wanted.filter(n => !have.includes(n)).map(n => notFound(host, kind, n));
  return [renderAll(host, entry, kind, found, "\n\n"), ...missing].filter(Boolean).join("\n");
}

export function kubectlDescribe(host: KubectlHost, t: string[]) {
  const pos = positionals("describe", t);
  const { typ, name, error } = typeAndName(pos);
  if (error) return host._err(error);
  if (!typ) return host._err("error: You must specify the type of resource to describe.", "z.B. 'kubectl describe pod <name>'.");
  const kind = resolveKind(typ);
  if (!kind) return unknownResourceType(host, typ);
  const entry = DESCRIBE_ENTRIES.get(kind.plural);
  if (!entry) return notSimulated(host, "'kubectl describe " + kind.plural + "'.", ["kubectl describe " + describableTypes() + " [<name>]"]);
  host._recheckReadiness();
  if (pos[0].includes("/")) return entry.render(host, name!, kind); // Slash-Form: nur exakt (typeAndName lieferte sonst error)
  if (pos.length > 2) return describeMany(host, entry, kind, pos.slice(1));
  const names = entry.names(host, kind);
  if (!name) return names.length ? renderAll(host, entry, kind, names, "\n\n\n") : noResourcesIn(DEFAULT_NAMESPACE);
  if (names.includes(name)) return entry.render(host, name, kind);
  const prefixed = names.filter(n => n.startsWith(name));
  return prefixed.length ? renderAll(host, entry, kind, prefixed, "\n\n") : entry.render(host, name, kind);
}

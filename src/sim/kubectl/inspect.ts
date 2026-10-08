/* ===== Kubernia – kubectl Inspect (sim/kubectl/inspect.ts) =====
 * Die `get`-Renderer (alle Ressourcen-Listen; der `get`-Dispatcher liegt in ./get.ts, `describe` in
 * ./describe.ts und ./describe-pod.ts, `top` in ./top.ts, `logs` in ./logs.ts). Lesend: kein Cluster-Zustand
 * wird verändert. Die Observability-Mechanik (podMetrics/nodeMetrics/alerts) liegt in ../observability.ts.
 *
 * Phaser-frei (pure Domäne): Tabellen-Ausgabe aus ../util, Zustand über das
 * KubectlHost-Interface (./host). Aufgerufen aus dem kubectl-Dispatch (../kubectl.ts).
 *
 * Aufbau gegen God-Functions (#542, Burn-down #502): `get` ist ein dünner
 * Dispatcher über eine **Renderer-Registry** (Ressourcentyp aus ./resources → Renderer-Funktion).
 * Jeder Ressourcentyp ist ein eigener kleiner Renderer; ein 10× größerer Ressourcensatz
 * wächst als 10× Einträge, ohne dass Dispatcher-Komplexität/-Länge mitwächst.
 */
import { effectiveDefaultStorageClass, podIP, BUILTIN_AGE, workloadSelector, formatLabels } from "../util";
import { endpointAddresses, podAddress, servicesWithDefault, serviceSelector, isKubernetesService } from "../endpoints";
import type { KubectlHost } from "./host";
import type { Call } from "../cliargs";
import { DEFAULT_NAMESPACE, VOLUME_MODE, isExternalNameService, type Deployment, type RbacSubject } from "../state";
import { currentReplicaSet, podTemplateLabels } from "../replicasets";
import { nodeInternalIP, NODE_SYSTEM_INFO, CONTROL_PLANE_IP, CONTROL_PLANE_NODE } from "../nodes";
import { requestedNamespace, allNamespaces } from "./namespace";
import { RESOURCE_KINDS, type ResourcePlural } from "./resources";
import { clusterPods, type ClusterPod } from "../pods";
import { statefulPodNode } from "../workload";
import { clusterPodStatus } from "../podstatus";

// Alle Ingresses teilen sich die Adresse des einen Ingress-Controllers (wie im echten
// Cluster). Nur die kubectl-Ausgaben (get/describe ingress) brauchen sie, darum hier.
export const INGRESS_ADDRESS = "203.0.113.10";

// ===== kubectl get – ein Renderer je Ressourcentyp =====
// Die Renderer liefern eine `GetTable` (Kopf, Zeilen, Objektnamen); Leermeldung, Namensfilter,
// Namespace-Wache und Mehrfach-Typen macht der Dispatcher in ./get.ts über die Registry (./resources).

/** Was ein get-Renderer liefert. `names[i]` ist der Objektname von `rows[i]` (für `get <typ> <name>`). */
export interface GetTable {
  header: string[]; rows: string[][]; names: string[];
  /** Anzahl der Endspalten, die nur `-o wide` zeigt (#1466); `get.ts` entfernt sie sonst. */
  wide?: number;
}

/** Die Tabelle mit `n` Endspalten, die nur `-o wide` zeigt. */
function withWide(t: GetTable, n: number): GetTable {
  return { ...t, wide: n };
}

/** Tabelle aus Kopf + Zeilen; die Objektnamen kommen aus der NAME-Spalte, außer sie werden mitgegeben
 *  (StorageClass zeigt `name (default)` in der Zelle). */
function tableOf(header: string[], rows: string[][], names?: string[]): GetTable {
  const col = header.indexOf("NAME");
  return { header, rows, names: names ?? rows.map(r => r[col]) };
}

type GetRenderer = (host: KubectlHost, c: Call) => GetTable;

/** Wo ein Pod läuft: IP und Node, beide `null`, solange er nicht eingeplant ist. Die EINE Quelle für
 *  `get pods -o wide` und `describe pod` (Deployment: `_nodeOf`, StatefulSet: `statefulPodNode`). */
export function podPlacement(host: KubectlHost, c: ClusterPod): { ip: string | null; node: string | null } {
  const ip = podAddress(c, host.pvcs);
  if (ip === null) return { ip, node: null };
  return { ip, node: c.owner === "Deployment" ? host._nodeOf(c.dep) : statefulPodNode(host.nodes, c.pod) };
}

/** Die vier Zusatzspalten von `get pods -o wide`: IP, NODE, NOMINATED NODE, READINESS GATES. */
const wideCells = (ip: string | null, node: string | null): string[] => [ip ?? "<none>", node ?? "<none>", "<none>", "<none>"];

/** Eine Pod-Zeile (NAME READY STATUS RESTARTS AGE + wide) – die EINE Quelle für `get pods` mit und
 *  ohne `-A`. Der Status kommt aus `clusterPodStatus` (Deployment: `deploymentPodStatus` plus die
 *  Restarts-Regel, StatefulSet: über `podAddress`). */
function podRow(host: KubectlHost, c: ClusterPod): string[] {
  const st = clusterPodStatus(host, c);
  const { ip, node } = podPlacement(host, c);
  return [c.pod.name, st.ready, st.status, String(st.restarts), host._age(c.pod.created), ...wideCells(ip, node)];
}

/** Die System-Pods von kube-system. kubeadm-Static-Pods laufen mit hostNetwork: sie teilen die IP der
 *  Control-Plane (dieselbe Adresse nennt `kubeadm join`); CoreDNS ist ein normaler Pod im Pod-Netz. */
const SYSTEM_PODS: readonly { name: string; hostNetwork: boolean }[] = [
  { name: "coredns-7db6d8ff4d-x2x9p", hostNetwork: false },
  { name: "etcd-" + CONTROL_PLANE_NODE, hostNetwork: true },
  { name: "kube-apiserver-" + CONTROL_PLANE_NODE, hostNetwork: true },
  { name: "kube-scheduler-" + CONTROL_PLANE_NODE, hostNetwork: true },
];

function systemPodRow(p: { name: string; hostNetwork: boolean }): string[] {
  return [p.name, "1/1", "Running", "0", BUILTIN_AGE, ...wideCells(p.hostNetwork ? CONTROL_PLANE_IP : podIP(p.name), CONTROL_PLANE_NODE)];
}

/** `kubectl get`-Leermeldung für einen Namespace (echtes kubectl: „No resources found in <ns> namespace."). */
export function noResourcesIn(ns: string = DEFAULT_NAMESPACE): string {
  return "No resources found in " + ns + " namespace.";
}

const POD_HEADER = ["NAME", "READY", "STATUS", "RESTARTS", "AGE", "IP", "NODE", "NOMINATED NODE", "READINESS GATES"];

function getPods(host: KubectlHost, c: Call): GetTable {
  const ns = requestedNamespace(c);
  const allNs = allNamespaces(c);
  host._reschedulePending();
  if (ns === "kube-system" || allNs) {
    const sysPods = SYSTEM_PODS.map(systemPodRow);
    if (!allNs) return withWide(tableOf(POD_HEADER, sysPods), 4);
    const rows = sysPods.map(r => ["kube-system", ...r]).concat(clusterPods(host).map(c => [DEFAULT_NAMESPACE, ...podRow(host, c)]));
    return withWide(tableOf(["NAMESPACE", ...POD_HEADER], rows), 4);
  }
  return withWide(tableOf(POD_HEADER, clusterPods(host).map(c => podRow(host, c))), 4);
}

/** Die verfügbaren Replicas eines Deployments: alle Pods, solange sie bereit sind, sonst keiner. */
export function availableReplicas(host: Pick<KubectlHost, "_podReady">, d: Deployment): number {
  return host._podReady(d) ? d.pods.length : 0;
}

function getDeployments(host: KubectlHost): GetTable {
  return withWide(tableOf(["NAME", "READY", "UP-TO-DATE", "AVAILABLE", "AGE", "CONTAINERS", "IMAGES", "SELECTOR"],
    host.deployments.map(d => {
      const ready = availableReplicas(host, d);
      return [d.name, ready + "/" + d.replicas, String(d.replicas), String(ready), host._age(d.created), d.name, d.image, workloadSelector(d.name)];
    })), 3);
}

/** ReplicaSets (#1468): abgeleitet, je Deployment das aktuelle (`sim/replicasets.ts`). */
function getReplicaSets(host: KubectlHost): GetTable {
  return withWide(tableOf(["NAME", "DESIRED", "CURRENT", "READY", "AGE", "CONTAINERS", "IMAGES", "SELECTOR"],
    host.deployments.map(d => {
      const rs = currentReplicaSet(d);
      return [rs.name, String(d.replicas), String(d.pods.length), String(host._podReady(d) ? d.pods.length : 0), host._age(rs.created),
        d.name, d.image, formatLabels(podTemplateLabels(d))];
    })), 3);
}

function getServices(host: KubectlHost): GetTable {
  const rows: string[][] = [];
  for (const s of servicesWithDefault(host)) {
    // ExternalName-Service (#337): keine ClusterIP, dafür der externe DNS-Name in
    // EXTERNAL-IP – genau so zeigt echtes kubectl einen ExternalName-Service.
    const isExt = isExternalNameService(s);
    rows.push([
      s.name, s.type,
      isExt ? "<none>" : s.clusterIP,
      isExt ? (s.externalName || "<none>") : "<none>",
      isExt ? "<none>" : (s.port + "/TCP"),
      isKubernetesService(s) ? BUILTIN_AGE : host._age(s.created || 0),
      formatLabels(serviceSelector(host, s)),
    ]);
  }
  return withWide(tableOf(["NAME", "TYPE", "CLUSTER-IP", "EXTERNAL-IP", "PORT(S)", "AGE", "SELECTOR"], rows), 1);
}

function getEndpoints(host: KubectlHost): GetTable {
  // Endpoints = die IPs der BEREITEN Pods hinter einem Service. Genau hier
  // wird die Readiness-Probe sichtbar: ein nicht-bereiter Pod fehlt in der
  // Liste, der Service leitet keinen Verkehr an ihn weiter.
  return tableOf(["NAME", "ENDPOINTS", "AGE"], servicesWithDefault(host).map(s => {
    // Endpoints zeigen den Ziel-Port (targetPort), an den weitergeleitet wird – fehlt er,
    // gilt der Service-Port (#164). So bleibt der Port-Abgleich auch hier sichtbar.
    // Die Pods kommen aus der gemeinsamen Service→Pod-Auflösung (#1318).
    const ips = endpointAddresses(host, s);
    return [s.name, ips.length ? ips.join(",") : "<none>", isKubernetesService(s) ? BUILTIN_AGE : host._age(s.created || 0)];
  }));
}

function getNodes(host: KubectlHost): GetTable {
  // Echtes `kubectl get nodes` zeigt unter Disk-Druck weiter STATUS "Ready" (DiskPressure ist eine
  // eigene Condition, sichtbar erst per describe). Im Lernspiel hängen wir sie sichtbar an die
  // STATUS-Spalte, damit der Druck im Überblick auffällt – Detail dann in `describe node` (#240).
  const { osImage, kernelVersion, architecture, containerRuntimeVersion } = NODE_SYSTEM_INFO;
  return withWide(tableOf(["NAME", "STATUS", "ROLES", "AGE", "VERSION", "INTERNAL-IP", "EXTERNAL-IP", "OS-IMAGE", "KERNEL-VERSION", "CONTAINER-RUNTIME"],
    host.nodes.map(n => [n.name, n.diskPressure ? n.status + ",DiskPressure" : n.status, n.roles, n.created === undefined ? BUILTIN_AGE : host._age(n.created), n.version,
      nodeInternalIP(n), "<none>", osImage, kernelVersion + " (" + architecture + ")", containerRuntimeVersion])), 5);
}

function getSecrets(host: KubectlHost): GetTable {
  return tableOf(["NAME", "TYPE", "DATA", "AGE"],
    host.secrets.map(s => [s.name, s.type || "Opaque", String(s.keys.length), host._age(s.created || 0)]));
}

function getConfigMaps(host: KubectlHost): GetTable {
  return tableOf(["NAME", "DATA", "AGE"],
    host.configMaps.map(c => [c.name, String(c.keys.length), host._age(c.created || 0)]));
}

function getIngress(host: KubectlHost): GetTable {
  return tableOf(["NAME", "CLASS", "HOSTS", "ADDRESS", "PORTS", "AGE"],
    host.ingresses.map(i => [i.name, i.className, i.host, INGRESS_ADDRESS, i.tls ? "80, 443" : "80", host._age(i.created || 0)]));
}

function getNetworkPolicies(host: KubectlHost): GetTable {
  return tableOf(["NAME", "POD-SELECTOR", "AGE"],
    host.networkPolicies.map(n => [n.name, n.podSelector ? workloadSelector(n.podSelector) : "<none>", host._age(n.created || 0)]));
}

function getServiceMonitors(host: KubectlHost): GetTable {
  return tableOf(["NAME", "SELECTOR", "ENDPOINT", "AGE"],
    host.serviceMonitors.map(s => [s.name, workloadSelector(s.selector), s.port + " @ " + s.interval, host._age(s.created || 0)]));
}

function getPrometheusRules(host: KubectlHost): GetTable {
  return tableOf(["NAME", "ALERT", "SEVERITY", "AGE"],
    host.prometheusRules.map(r => [r.name, r.alert, r.severity, host._age(r.created || 0)]));
}

function getGrafanaDatasources(host: KubectlHost): GetTable {
  return tableOf(["NAME", "TYPE", "AGE"],
    host.grafanaDatasources.map(d => [d.name, d.dsType, host._age(d.created || 0)]));
}

function getGrafanaDashboards(host: KubectlHost): GetTable {
  return tableOf(["NAME", "TITLE", "PANELS", "AGE"],
    host.grafanaDashboards.map(d => [d.name, d.title, String(d.panels), host._age(d.created || 0)]));
}

function getStatefulSets(host: KubectlHost): GetTable {
  return withWide(tableOf(["NAME", "READY", "AGE", "CONTAINERS", "IMAGES"],
    host.statefulSets.map(s => [s.name, s.pods.length + "/" + s.replicas, host._age(s.created), s.name, s.image])), 2);
}

function getPvcs(host: KubectlHost): GetTable {
  return withWide(tableOf(["NAME", "STATUS", "VOLUME", "CAPACITY", "ACCESS MODES", "STORAGECLASS", "AGE", "VOLUMEMODE"],
    host.pvcs.map(p => [p.name, p.status, p.volume || "", p.status === "Bound" ? p.capacity : "", p.accessModes, p.storageClass || "", host._age(p.created), VOLUME_MODE])), 1);
}

function getPvs(host: KubectlHost): GetTable {
  return withWide(tableOf(["NAME", "CAPACITY", "ACCESS MODES", "RECLAIM POLICY", "STATUS", "CLAIM", "STORAGECLASS", "AGE", "VOLUMEMODE"],
    host.pvs.map(p => [p.name, p.capacity, p.accessModes, p.reclaimPolicy, p.status, p.claim || "", p.storageClass || "", host._age(p.created), VOLUME_MODE])), 1);
}

/** Ab Kubernetes v1.37 trägt nur die effektive Default-StorageClass „(default)“ (#135964), Regel: `effectiveDefaultStorageClass`. */
function getStorageClasses(host: KubectlHost): GetTable {
  const standard = effectiveDefaultStorageClass(host.storageClasses)?.name;
  return tableOf(["NAME", "PROVISIONER", "RECLAIMPOLICY", "AGE"],
    host.storageClasses.map(s => [s.name + (s.name === standard ? " (default)" : ""), s.provisioner, s.reclaimPolicy, host._age(s.created)]),
    host.storageClasses.map(s => s.name));
}

function getVolumeSnapshots(host: KubectlHost): GetTable {
  return tableOf(["NAME", "READYTOUSE", "SOURCEPVC", "RESTORESIZE", "AGE"],
    host.volumeSnapshots.map(v => [v.name, String(v.readyToUse), v.sourcePvc, v.restoreSize, host._age(v.created)]));
}

function getServiceAccounts(host: KubectlHost): GetTable {
  // Die Spalte SECRETS fiel mit Kubernetes v1.35 weg (#117160): ServiceAccounts tragen keine Token-Secrets mehr.
  return tableOf(["NAME", "AGE"],
    host.serviceAccounts.map(s => [s.name, host._age(s.created)]));
}

function getRoles(host: KubectlHost): GetTable {
  return tableOf(["NAME", "AGE"], host.roles.filter(r => !r.cluster).map(r => [r.name, host._age(r.created)]));
}

function getClusterRoles(host: KubectlHost): GetTable {
  return tableOf(["NAME", "AGE"], host.roles.filter(r => r.cluster).map(r => [r.name, host._age(r.created)]));
}

/** Die Subjekt-Spalten von `-o wide` (USERS, GROUPS, SERVICEACCOUNTS): SubjectsStrings des echten kubectl, die
 *  ServiceAccounts als `<namespace>/<name>`. GROUPS bleibt leer (die Sim kennt nur User und ServiceAccounts). */
function subjectCells(subjects: RbacSubject[]): string[] {
  const join = (kind: RbacSubject["kind"], f: (s: RbacSubject) => string) => subjects.filter(s => s.kind === kind).map(f).join(", ");
  return [join("User", s => s.name), "", join("ServiceAccount", s => (s.namespace ?? DEFAULT_NAMESPACE) + "/" + s.name)];
}

function getBindings(host: KubectlHost, cluster: boolean): GetTable {
  return withWide(tableOf(["NAME", "ROLE", "AGE", "USERS", "GROUPS", "SERVICEACCOUNTS"],
    host.roleBindings.filter(b => b.cluster === cluster).map(b => [b.name, b.roleRef.kind + "/" + b.roleRef.name, host._age(b.created), ...subjectCells(b.subjects)])), 3);
}

const getRoleBindings = (host: KubectlHost): GetTable => getBindings(host, false);
const getClusterRoleBindings = (host: KubectlHost): GetTable => getBindings(host, true);

function getAlerts(host: KubectlHost): GetTable {
  return tableOf(["NAME", "SEVERITY", "STATE", "SUMMARY"], host.alerts().map(a => [a.name, a.severity, a.state, a.summary]));
}

/** Der Renderer je Ressourcentyp (Schlüssel = Plural aus ./resources); `extraNamespaces`: weitere
 *  Namespaces, in denen die Ressource etwas zeigt (Pods in kube-system). Typen ohne Eintrag
 *  (`namespaces`) kennt die Registry, aber der Simulator kann sie nicht auflisten. */
interface GetEntry { extraNamespaces?: readonly string[]; render: GetRenderer }

export const GET_RENDERERS: ReadonlyMap<ResourcePlural, GetEntry> = new Map<ResourcePlural, GetEntry>([
  ["pods", { extraNamespaces: ["kube-system"], render: getPods }],
  ["deployments", { render: getDeployments }],
  ["replicasets", { render: getReplicaSets }],
  ["services", { render: getServices }],
  ["endpoints", { render: getEndpoints }],
  ["nodes", { render: getNodes }],
  ["secrets", { render: getSecrets }],
  ["configmaps", { render: getConfigMaps }],
  ["ingresses", { render: getIngress }],
  ["networkpolicies", { render: getNetworkPolicies }],
  ["servicemonitors", { render: getServiceMonitors }],
  ["prometheusrules", { render: getPrometheusRules }],
  ["grafanadatasources", { render: getGrafanaDatasources }],
  ["grafanadashboards", { render: getGrafanaDashboards }],
  ["statefulsets", { render: getStatefulSets }],
  ["persistentvolumeclaims", { render: getPvcs }],
  ["persistentvolumes", { render: getPvs }],
  ["storageclasses", { render: getStorageClasses }],
  ["volumesnapshots", { render: getVolumeSnapshots }],
  ["serviceaccounts", { render: getServiceAccounts }],
  ["roles", { render: getRoles }],
  ["clusterroles", { render: getClusterRoles }],
  ["rolebindings", { render: getRoleBindings }],
  ["clusterrolebindings", { render: getClusterRoleBindings }],
  ["alerts", { render: getAlerts }],
]);

/** Geltungsbereich je `get`-Ressource (Registry + Renderer) – für den Fitness-Test. */
export const GET_RESOURCE_SCOPES = RESOURCE_KINDS.filter(k => GET_RENDERERS.has(k.plural)).map(k => ({
  aliases: [k.plural, k.singular, ...k.short], namespaced: k.namespaced, extraNamespaces: GET_RENDERERS.get(k.plural)?.extraNamespaces,
}));

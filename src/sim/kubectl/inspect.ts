/* ===== Kubernia – kubectl Inspect (sim/kubectl/inspect.ts) =====
 * Die lesenden kubectl-Befehle (kein Cluster-Zustand wird verändert): die `get`-Renderer
 * (alle Ressourcen-Listen; der `get`-Dispatcher liegt in ./get.ts), `describe` (Detail zu Pod/Ingress/NetworkPolicy/Role/SA),
 * `top` (Pod-/Node-Metriken, #109) und `logs` (#…). Die eigentliche
 * Observability-Mechanik (podMetrics/nodeMetrics/alerts) liegt in ../observability.ts –
 * `top`/`get` lesen sie nur über das Host-Interface.
 *
 * Phaser-frei (pure Domäne): Tabellen-Ausgabe aus ../util, Zustand über das
 * KubectlHost-Interface (./host). Aufgerufen aus dem kubectl-Dispatch (../kubectl.ts).
 *
 * Aufbau gegen God-Functions (#542, Burn-down #502): `get` und `describe` sind dünne
 * Dispatcher über eine **Renderer-Registry** (Ressourcentyp aus ./resources → Renderer-Funktion).
 * Jeder Ressourcentyp ist ein eigener kleiner Renderer; ein 10× größerer Ressourcensatz
 * wächst als 10× Einträge, ohne dass Dispatcher-Komplexität/-Länge mitwächst.
 */
import { table } from "../util";
import { readyBackends, endpointPort, podAddress } from "../endpoints";
import type { KubectlHost } from "./host";
import { DEFAULT_NAMESPACE, SECURITY_CONTEXT_KEYS, isExternalNameService, type Deployment, type PodInstance, type PodStatus } from "../state";
import { requestedNamespace, allNamespaces } from "./namespace";
import { RESOURCE_KINDS, resolveKind, qualified, type ResourceKind } from "./resources";
import { positionals, typeAndName, notSimulated, unknownResourceType } from "./args";
import { sameRbac } from "../rbac";
import { clusterPods, findClusterPod, type ClusterPod } from "../pods";
import { statefulPodClaimName, statefulPodNode } from "../workload";
import { clusterPodStatus } from "../podstatus";

// Alle Ingresses teilen sich die Adresse des einen Ingress-Controllers (wie im echten
// Cluster). Nur die kubectl-Ausgaben (get/describe ingress) brauchen sie, darum hier.
const INGRESS_ADDRESS = "203.0.113.10";

// ===== kubectl get – ein Renderer je Ressourcentyp =====
// Die Renderer liefern eine `GetTable` (Kopf, Zeilen, Objektnamen); Leermeldung, Namensfilter,
// Namespace-Wache und Mehrfach-Typen macht der Dispatcher in ./get.ts über die Registry (./resources).

/** Was ein get-Renderer liefert. `names[i]` ist der Objektname von `rows[i]` (für `get <typ> <name>`). */
export interface GetTable { header: string[]; rows: string[][]; names: string[] }

/** Tabelle aus Kopf + Zeilen; die Objektnamen kommen aus der NAME-Spalte, außer sie werden mitgegeben
 *  (StorageClass zeigt `name (default)` in der Zelle). */
function tableOf(header: string[], rows: string[][], names?: string[]): GetTable {
  const col = header.indexOf("NAME");
  return { header, rows, names: names ?? rows.map(r => r[col]) };
}

type GetRenderer = (host: KubectlHost, t: string[]) => GetTable;

/** Eine Pod-Zeile (NAME READY STATUS RESTARTS AGE) – die EINE Quelle für `get pods` mit und
 *  ohne `-A`. Der Status kommt aus `clusterPodStatus` (Deployment: `deploymentPodStatus` plus die
 *  Restarts-Regel, StatefulSet: über `podAddress`). */
function podRow(host: KubectlHost, c: ClusterPod): string[] {
  const st = clusterPodStatus(host, c);
  return [c.pod.name, st.ready, st.status, String(st.restarts), host._age(c.pod.created)];
}

/** `kubectl get`-Leermeldung für einen Namespace (echtes kubectl: „No resources found in <ns> namespace."). */
export function noResourcesIn(ns: string = DEFAULT_NAMESPACE): string {
  return "No resources found in " + ns + " namespace.";
}

const POD_HEADER = ["NAME", "READY", "STATUS", "RESTARTS", "AGE"];

function getPods(host: KubectlHost, t: string[]): GetTable {
  const ns = requestedNamespace(t);
  const allNs = allNamespaces(t);
  host._reschedulePending();
  if (ns === "kube-system" || allNs) {
    const sysPods = [
      ["coredns-7db6d8ff4d-x2x9p", "1/1", "Running", "0", "3d"],
      ["etcd-ahoi-control", "1/1", "Running", "0", "3d"],
      ["kube-apiserver-ahoi-control", "1/1", "Running", "0", "3d"],
      ["kube-scheduler-ahoi-control", "1/1", "Running", "0", "3d"],
    ];
    if (!allNs) return tableOf(POD_HEADER, sysPods);
    const rows = sysPods.map(r => ["kube-system"].concat(r)).concat(clusterPods(host).map(c => [DEFAULT_NAMESPACE, ...podRow(host, c)]));
    return tableOf(["NAMESPACE", ...POD_HEADER], rows);
  }
  return tableOf(POD_HEADER, clusterPods(host).map(c => podRow(host, c)));
}

function getDeployments(host: KubectlHost): GetTable {
  return tableOf(["NAME", "READY", "UP-TO-DATE", "AVAILABLE", "AGE"],
    host.deployments.map(d => {
      const ready = host._podReady(d) ? d.pods.length : 0;
      return [d.name, ready + "/" + d.replicas, String(d.replicas), String(ready), host._age(d.created)];
    }));
}

function getServices(host: KubectlHost): GetTable {
  const rows = [["kubernetes", "ClusterIP", "10.96.0.1", "<none>", "443/TCP", "3d"]];
  for (const s of host.services) {
    // ExternalName-Service (#337): keine ClusterIP, dafür der externe DNS-Name in
    // EXTERNAL-IP – genau so zeigt echtes kubectl einen ExternalName-Service.
    const isExt = isExternalNameService(s);
    rows.push([
      s.name, s.type,
      isExt ? "<none>" : s.clusterIP,
      isExt ? (s.externalName || "<none>") : "<none>",
      isExt ? "<none>" : (s.port + "/TCP"),
      host._age(s.created || 0),
    ]);
  }
  return tableOf(["NAME", "TYPE", "CLUSTER-IP", "EXTERNAL-IP", "PORT(S)", "AGE"], rows);
}

function getEndpoints(host: KubectlHost): GetTable {
  // Endpoints = die IPs der BEREITEN Pods hinter einem Service. Genau hier
  // wird die Readiness-Probe sichtbar: ein nicht-bereiter Pod fehlt in der
  // Liste, der Service leitet keinen Verkehr an ihn weiter.
  return tableOf(["NAME", "ENDPOINTS", "AGE"], host.services.map(s => {
    // Endpoints zeigen den Ziel-Port (targetPort), an den weitergeleitet wird – fehlt er,
    // gilt der Service-Port (#164). So bleibt der Port-Abgleich auch hier sichtbar.
    // Die Pods kommen aus der gemeinsamen Service→Pod-Auflösung (#1318).
    const ips = readyBackends(host, s).flatMap(b => (b.ip ? [b.ip + ":" + endpointPort(s)] : []));
    return [s.name, ips.length ? ips.join(",") : "<none>", host._age(s.created || 0)];
  }));
}

function getNodes(host: KubectlHost): GetTable {
  // Echtes `kubectl get nodes` zeigt unter Disk-Druck weiter STATUS "Ready" (DiskPressure ist eine
  // eigene Condition, sichtbar erst per describe). Im Lernspiel hängen wir sie sichtbar an die
  // STATUS-Spalte, damit der Druck im Überblick auffällt – Detail dann in `describe node` (#240).
  return tableOf(["NAME", "STATUS", "ROLES", "AGE", "VERSION"],
    host.nodes.map(n => [n.name, n.diskPressure ? n.status + ",DiskPressure" : n.status, n.roles, "3d", n.version]));
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
    host.networkPolicies.map(n => [n.name, n.podSelector ? "app=" + n.podSelector : "<none>", host._age(n.created || 0)]));
}

function getServiceMonitors(host: KubectlHost): GetTable {
  return tableOf(["NAME", "SELECTOR", "ENDPOINT", "AGE"],
    host.serviceMonitors.map(s => [s.name, "app=" + s.selector, s.port + " @ " + s.interval, host._age(s.created || 0)]));
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
  return tableOf(["NAME", "READY", "AGE"],
    host.statefulSets.map(s => [s.name, s.pods.length + "/" + s.replicas, host._age(s.created)]));
}

function getPvcs(host: KubectlHost): GetTable {
  return tableOf(["NAME", "STATUS", "VOLUME", "CAPACITY", "ACCESS MODES", "STORAGECLASS", "AGE"],
    host.pvcs.map(p => [p.name, p.status, p.volume || "", p.status === "Bound" ? p.capacity : "", p.accessModes, p.storageClass || "", host._age(p.created)]));
}

function getPvs(host: KubectlHost): GetTable {
  return tableOf(["NAME", "CAPACITY", "ACCESS MODES", "RECLAIM POLICY", "STATUS", "CLAIM", "STORAGECLASS", "AGE"],
    host.pvs.map(p => [p.name, p.capacity, p.accessModes, p.reclaimPolicy, p.status, p.claim || "", p.storageClass || "", host._age(p.created)]));
}

function getStorageClasses(host: KubectlHost): GetTable {
  return tableOf(["NAME", "PROVISIONER", "RECLAIMPOLICY", "AGE"],
    host.storageClasses.map(s => [s.name + (s.isDefault ? " (default)" : ""), s.provisioner, s.reclaimPolicy, host._age(s.created)]),
    host.storageClasses.map(s => s.name));
}

function getVolumeSnapshots(host: KubectlHost): GetTable {
  return tableOf(["NAME", "READYTOUSE", "SOURCEPVC", "RESTORESIZE", "AGE"],
    host.volumeSnapshots.map(v => [v.name, String(v.readyToUse), v.sourcePvc, v.restoreSize, host._age(v.created)]));
}

function getServiceAccounts(host: KubectlHost): GetTable {
  return tableOf(["NAME", "SECRETS", "AGE"],
    host.serviceAccounts.map(s => [s.name, "0", host._age(s.created)]));
}

function getRoles(host: KubectlHost): GetTable {
  return tableOf(["NAME", "AGE"], host.roles.filter(r => !r.cluster).map(r => [r.name, host._age(r.created)]));
}

function getClusterRoles(host: KubectlHost): GetTable {
  return tableOf(["NAME", "AGE"], host.roles.filter(r => r.cluster).map(r => [r.name, host._age(r.created)]));
}

function getRoleBindings(host: KubectlHost): GetTable {
  return tableOf(["NAME", "ROLE", "AGE"], host.roleBindings.filter(b => !b.cluster).map(b => [b.name, b.roleRef.kind + "/" + b.roleRef.name, host._age(b.created)]));
}

function getClusterRoleBindings(host: KubectlHost): GetTable {
  return tableOf(["NAME", "ROLE", "AGE"], host.roleBindings.filter(b => b.cluster).map(b => [b.name, b.roleRef.kind + "/" + b.roleRef.name, host._age(b.created)]));
}

function getAlerts(host: KubectlHost): GetTable {
  return tableOf(["NAME", "SEVERITY", "STATE", "SUMMARY"], host.alerts().map(a => [a.name, a.severity, a.state, a.summary]));
}

/** Der Renderer je Ressourcentyp (Schlüssel = Plural aus ./resources); `extraNamespaces`: weitere
 *  Namespaces, in denen die Ressource etwas zeigt (Pods in kube-system). Typen ohne Eintrag
 *  (`namespaces`) kennt die Registry, aber der Simulator kann sie nicht auflisten. */
interface GetEntry { extraNamespaces?: readonly string[]; render: GetRenderer }

export const GET_RENDERERS: ReadonlyMap<string, GetEntry> = new Map<string, GetEntry>([
  ["pods", { extraNamespaces: ["kube-system"], render: getPods }],
  ["deployments", { render: getDeployments }],
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

// ===== kubectl describe – ein Renderer je Ressourcentyp =====

function describeNode(host: KubectlHost, name: string | undefined): string {
  if (!name) return host._err("kubectl describe node: Welcher Knoten?", "Die Namen siehst du mit 'kubectl get nodes'.");
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
  ];
  // Ephemeral-Storage-Bilanz nur zeigen, wenn der Knoten eine Kapazität hat (sonst „unbegrenzt").
  if (node.ephemeralCapacityMi !== undefined) {
    const used = host._nodeEphemeralUsed(node.name);
    lines.push(
      "Capacity:",
      "  ephemeral-storage:  " + node.ephemeralCapacityMi + "Mi",
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

function describeIngress(host: KubectlHost, name: string | undefined): string {
  if (!name) return host._err("kubectl describe ingress: Welcher Ingress?", "Die Namen siehst du mit 'kubectl get ingress'.");
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

function describeNetworkPolicy(host: KubectlHost, name: string | undefined): string {
  if (!name) return host._err("kubectl describe networkpolicy: Welche NetworkPolicy?", "Die Namen siehst du mit 'kubectl get networkpolicies'.");
  const np = host.networkPolicies.find(n => n.name === name);
  if (!np) return host._err('Error from server (NotFound): networkpolicies.networking.k8s.io "' + name + '" not found', "Tipp: Namen aus 'kubectl get networkpolicies' kopieren.");
  return [
    "Name:         " + np.name,
    "Namespace:    " + DEFAULT_NAMESPACE,
    "PodSelector:  " + (np.podSelector ? "app=" + np.podSelector : "<none> (gilt für alle Pods im Namespace)"),
    "PolicyTypes:  Ingress",
    "Allowing ingress traffic:",
    np.allowFrom
      ? "  From: Pods mit Label app=" + np.allowFrom
      : "  <none> (default-deny: niemand darf rein, bis du eine Quelle erlaubst)",
  ].join("\n");
}

function describeRole(host: KubectlHost, name: string | undefined, kind: ResourceKind): string {
  const cluster = kind.plural === "clusterroles";
  if (!name) return host._err("kubectl describe " + kind.singular + ": Welche Rolle?", "Die Namen siehst du mit 'kubectl get " + kind.plural + "'.");
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

function describeServiceAccount(host: KubectlHost, name: string | undefined): string {
  if (!name) return host._err("kubectl describe serviceaccount: Welche SA?", "Die Namen siehst du mit 'kubectl get sa'.");
  const acc = host.serviceAccounts.find(s => s.name === name);
  if (!acc) return host._err('Error from server (NotFound): serviceaccounts "' + name + '" not found', "Tipp: Namen aus 'kubectl get sa' kopieren.");
  return ["Name:         " + acc.name, "Namespace:    " + DEFAULT_NAMESPACE, "Mountable secrets:  <none>"].join("\n");
}

// --- describe pod: in kohäsive Blöcke zerlegt (Events / Container / Volumes) ---

// Baut die Event-Zeilen je nach (kaputtem) Pod-Zustand – die Lern-Pointe steht in den Events.
function podDescribeEvents(host: KubectlHost, pod: PodInstance, dep: Deployment): string[] {
  const events = ["  Type    Reason     Age   Message", "  ----    ------     ----  -------"];
  if (dep.evicted) {
    // Evicted (#240): der kubelet hat den Pod beendet, um Disk freizugeben bzw. weil er sein
    // ephemeral-storage-Limit gesprengt hat. Der Grund steht – wie in echtem K8s – im Event.
    events.push("  Normal   Scheduled  " + host._age(pod.created) + "   Successfully assigned " + DEFAULT_NAMESPACE + "/" + pod.name);
    events.push("  Warning  Evicted    " + host._age(pod.created) + "   " + dep.evicted.reason);
    events.push("  Normal   Killing    " + host._age(pod.created) + "   Stopping container " + dep.name);
  } else if (!dep.broken) {
    events.push("  Normal  Scheduled  " + host._age(pod.created) + "   Successfully assigned " + DEFAULT_NAMESPACE + "/" + pod.name);
    events.push("  Normal  Pulled     " + host._age(pod.created) + "   Container image \"" + dep.image + "\" already present");
    events.push("  Normal  Started    " + host._age(pod.created) + "   Started container " + dep.name);
  } else if (dep.broken.type === "imagepull") {
    events.push("  Normal   Scheduled  " + host._age(pod.created) + "   Successfully assigned " + DEFAULT_NAMESPACE + "/" + pod.name);
    events.push("  Warning  Failed     " + host._age(pod.created) + "   Failed to pull image \"" + dep.image + "\": repository does not exist or may require authorization");
    events.push("  Warning  Failed     " + host._age(pod.created) + "   Error: ImagePullBackOff");
  } else if (dep.broken.type === "crashloop") {
    events.push("  Normal   Scheduled  " + host._age(pod.created) + "   Successfully assigned " + DEFAULT_NAMESPACE + "/" + pod.name);
    events.push("  Normal   Started    " + host._age(pod.created) + "   Started container " + dep.name);
    events.push("  Warning  BackOff    " + host._age(pod.created) + "   Back-off restarting failed container (Tipp: kubectl logs " + pod.name + ")");
  } else if (dep.broken.type === "pending") {
    events.push("  Warning  FailedScheduling  " + host._age(pod.created) + "   0/" + host.nodes.length + " nodes are available: insufficient capacity.");
  } else if (dep.broken.type === "notready") {
    events.push("  Normal   Scheduled  " + host._age(pod.created) + "   Successfully assigned " + DEFAULT_NAMESPACE + "/" + pod.name);
    events.push("  Normal   Started    " + host._age(pod.created) + "   Started container " + dep.name);
    events.push("  Warning  Unhealthy  " + host._age(pod.created) + "   Readiness probe failed: HTTP probe returned statuscode 503 (Liveness probe ok – der Pod LÄUFT, ist aber nicht bereit)");
  } else if (dep.broken.type === "oomkilled") {
    events.push("  Normal   Scheduled  " + host._age(pod.created) + "   Successfully assigned " + DEFAULT_NAMESPACE + "/" + pod.name);
    events.push("  Normal   Pulled     " + host._age(pod.created) + "   Container image \"" + dep.image + "\" already present");
    events.push("  Warning  BackOff    " + host._age(pod.created) + "   Back-off restarting failed container (zuletzt OOMKilled – Limit zu knapp)");
  }
  return events;
}

// Limits-Block (EIN Kopf): cpu, ephemeral-storage, memory – jeweils nur, wenn gesetzt. Dazu die
// ephemeral-storage-Zeilen (#240): sie machen sichtbar, woran ein Evicted-Pod sein Limit gesprengt hat.
function podLimitLines(host: KubectlHost, dep: Deployment): string[] {
  const rows: string[] = [];
  if (dep.cpuLimitMilli !== undefined) rows.push("      cpu:                " + dep.cpuLimitMilli + "m");
  if (dep.ephemeralLimit !== undefined) rows.push("      ephemeral-storage:  " + dep.ephemeralLimit + "Mi");
  if (dep.memLimit !== undefined) rows.push("      memory:             " + dep.memLimit + "Mi");
  if (rows.length === 0) return [];
  const lines = ["    Limits:", ...rows];
  if (dep.ephemeralLimit === undefined) return lines;
  lines.push("    ephemeral-storage verbraucht: " + host._depEphemeralUsed(dep) + "Mi");
  // Init-Peak (#485): reißt ein Pod sein Limit nur WÄHREND des initContainers, ist genau der Peak
  // (nicht die Dauer-Belegung) der Eviction-Grund – darum hier gesondert sichtbar.
  if (dep.initContainer) lines.push("    ephemeral-storage Spitze (initContainer): " + host._depEphemeralPeak(dep) + "Mi");
  return lines;
}

// Security Context: nur die gesetzten Schlüssel; ohne Wert keine Kopfzeile (nichts erfinden). Echtes
// `describe pod` zeigt das nicht – die Sim hat kein `get -o yaml`, hier ist die einzige Sichtstelle.
function podSecurityLines(dep: Deployment): string[] {
  const sc = dep.securityContext;
  const set = SECURITY_CONTEXT_KEYS.filter(k => sc?.[k] !== undefined);
  if (set.length === 0) return [];
  return ["    Security Context:", ...set.map(k => "      " + (k + ":").padEnd(26) + String(sc?.[k]))];
}

// Container-Block: Image/State/Restart-Count + OOM- und ephemeral-storage-Sonderfälle.
function podContainerBlock(host: KubectlHost, dep: Deployment, st: PodStatus): string[] {
  // OOMKilled zeigt sich NICHT im State (der ist gerade wieder Waiting), sondern im
  // Last State + Reason und am memory-Limit – genau das ist die Lern-Pointe.
  const oom = !!dep.broken && dep.broken.type === "oomkilled";
  return [
    "  " + dep.name + ":",
    "    Image:        " + dep.image,
    "    State:        " + (oom ? "Waiting (CrashLoopBackOff)" : st.status),
    ...(oom ? [
      "    Last State:   Terminated",
      "      Reason:     OOMKilled",
      "      Exit Code:  137",
    ] : []),
    ...podLimitLines(host, dep),
    ...podSecurityLines(dep),
    "    Restart Count: " + st.restarts,
  ];
}

// Init-Containers-Abschnitt (#485): zeigt den Vorbereitungs-Container, was er ins emptyDir füllt und
// – bei Doppelablage – dass sein Peak kurzzeitig doppelt so hoch ist wie die Dauer-Belegung.
function podInitContainerBlock(host: KubectlHost, dep: Deployment): string[] {
  const ic = dep.initContainer;
  if (!ic) return [];
  const peak = ic.fillsMi * (ic.doubleStage ? 2 : 1);
  return [
    "Init Containers:",
    "  vorbereiter:",
    "    State:    Terminated (Reason: Completed – lief vor den Hauptcontainern)",
    "    Prepares: " + ic.fillsMi + "Mi in das emptyDir",
    "    Staging:  " + (ic.doubleStage
      ? "erst in den Writable-Layer entpackt, dann ins emptyDir kopiert → Peak " + peak + "Mi (doppelt)"
      : "direkt ins emptyDir entpackt → Peak " + peak + "Mi"),
  ];
}

// Volumes-Abschnitt (#240): zeigt das flüchtige emptyDir-Scratch-Volume samt belegtem Platz.
// Der Inhalt ist nach einem Pod-Neustart weg – genau das ist die emptyDir-Lern-Pointe.
function podVolumeBlock(dep: Deployment): string[] {
  return dep.emptyDir ? [
    "Volumes:",
    "  scratch:",
    "    Type:     EmptyDir (a temporary directory that shares a pod's lifetime)",
    "    Used:     " + dep.emptyDir.usedMi + "Mi",
    "    Content:  " + (dep.emptyDir.data || "(leer)"),
  ] : [];
}

type DeploymentPod = Extract<ClusterPod, { owner: "Deployment" }>;
type StatefulPod = Extract<ClusterPod, { owner: "StatefulSet" }>;

function describeDeploymentPod(host: KubectlHost, c: DeploymentPod): string {
  const { pod, dep } = c;
  const st = clusterPodStatus(host, c);
  // Evictete Pods melden Status Failed / Reason: Evicted – genau so zeigt es echtes Kubernetes (#240).
  const statusLine = dep.evicted ? "Failed" : (st.status === "Running" ? "Running" : st.status === "Pending" ? "Pending" : "Waiting (" + st.status + ")");
  const ip = podAddress(c, host.pvcs);
  return [
    "Name:         " + pod.name,
    "Namespace:    " + DEFAULT_NAMESPACE,
    "Node:         " + (ip === null ? "<none>" : host._nodeOf(dep)),
    "Status:       " + statusLine,
    ...(dep.evicted ? ["Reason:       Evicted", "Message:      " + dep.evicted.reason] : []),
    "Ready:        " + st.ready,
    "IP:           " + (ip ?? "<none>"),
    "Controlled By: ReplicaSet/" + dep.name,
    // ServiceAccount-Identität des Pods (#132): die per spec.serviceAccountName gesetzte SA,
    // sonst die default-SA des Namespaces – genau wie in echtem `kubectl describe pod`.
    "Service Account: " + (dep.serviceAccountName || "default"),
    ...podInitContainerBlock(host, dep),
    "Containers:",
    ...podContainerBlock(host, dep, st),
    ...podVolumeBlock(dep),
    "Events:",
  ].concat(podDescribeEvents(host, pod, dep)).join("\n");
}

// StatefulSet-Pod (#1404): Status aus der PVC-Bindung, Volume ist der Claim des volumeClaimTemplates.
function describeStatefulPod(host: KubectlHost, c: StatefulPod): string {
  const { pod, sts } = c;
  const ip = podAddress(c, host.pvcs);
  const scheduled = ip !== null;
  const st = clusterPodStatus(host, c);
  const age = host._age(pod.created);
  const events = scheduled
    ? [
      "  Normal  Scheduled  " + age + "   Successfully assigned " + DEFAULT_NAMESPACE + "/" + pod.name,
      "  Normal  Pulled     " + age + "   Container image \"" + sts.image + "\" already present",
      "  Normal  Started    " + age + "   Started container " + sts.name,
    ]
    : ["  Warning  FailedScheduling  " + age + "   0/" + host.nodes.length + " nodes are available: pod has unbound immediate PersistentVolumeClaims."];
  return [
    "Name:         " + pod.name,
    "Namespace:    " + DEFAULT_NAMESPACE,
    "Node:         " + (scheduled ? statefulPodNode(host.nodes, pod) : "<none>"),
    "Status:       " + st.status,
    "Ready:        " + st.ready,
    "IP:           " + (ip ?? "<none>"),
    "Controlled By: StatefulSet/" + sts.name,
    // StatefulSetRes kennt kein serviceAccountName; ohne spec.serviceAccountName heißt es im
    // echten Kubernetes `default`. Ausblick: siehe #1142.
    "Service Account: default",
    "Containers:",
    "  " + sts.name + ":",
    "    Image:        " + sts.image,
    "    State:        " + (scheduled ? "Running" : "Waiting (Pending)"),
    "    Restart Count: " + pod.restarts,
    "Volumes:",
    "  " + sts.volumeClaimName + ":",
    "    Type:       PersistentVolumeClaim (a reference to a PersistentVolumeClaim in the same namespace)",
    "    ClaimName:  " + statefulPodClaimName(sts, pod),
    "Events:",
    "  Type    Reason     Age   Message",
    "  ----    ------     ----  -------",
    ...events,
  ].join("\n");
}

function describePod(host: KubectlHost, name: string | undefined): string {
  if (!name) return host._err("kubectl describe pod: Welcher Pod?", "Die Namen siehst du mit 'kubectl get pods'.");
  const c = findClusterPod(host, name);
  if (!c) return host._err('Error from server (NotFound): pods "' + name + '" not found', "Tipp: Pod-Namen kannst du aus 'kubectl get pods' kopieren.");
  switch (c.owner) {
    case "Deployment": return describeDeploymentPod(host, c);
    case "StatefulSet": return describeStatefulPod(host, c);
  }
}

/** Ein describe-Renderer bekommt den Objektnamen (oder undefined) und den aufgelösten Typ. */
type DescribeRenderer = (host: KubectlHost, name: string | undefined, kind: ResourceKind) => string;

/** Die beschreibbaren Typen (Schlüssel = Plural aus ./resources). */
const DESCRIBE_RENDERERS: ReadonlyMap<string, DescribeRenderer> = new Map<string, DescribeRenderer>([
  ["nodes", describeNode],
  ["ingresses", describeIngress],
  ["networkpolicies", describeNetworkPolicy],
  ["roles", describeRole],
  ["clusterroles", describeRole],
  ["serviceaccounts", describeServiceAccount],
  ["pods", describePod],
]);

export function kubectlDescribe(host: KubectlHost, t: string[]) {
  const { typ, name } = typeAndName(positionals("describe", t));
  if (!typ) return host._err("error: You must specify the type of resource to describe.", "z.B. 'kubectl describe pod <name>'.");
  const kind = resolveKind(typ);
  if (!kind) return unknownResourceType(host, typ);
  const render = DESCRIBE_RENDERERS.get(kind.plural);
  if (!render) return notSimulated(host, "'kubectl describe " + kind.plural + "'.", ["kubectl describe pod|node|ingress|networkpolicy|role|clusterrole|serviceaccount <name>"]);
  return render(host, name, kind);
}


export function kubectlTop(host: KubectlHost, t: string[]) {
  const [what = "", name = null] = positionals("top", t);
  const kind = resolveKind(what)?.plural;
  host._reschedulePending();
  host._recheckReadiness();

  if (kind === "pods") {
    let rows = host.podMetrics();
    if (name) {
      rows = rows.filter(r => r.name === name);
      if (rows.length === 0) {
        const exists = findClusterPod(host, name) !== undefined;
        return exists
          ? host._err("error: Metrics not available for pod " + DEFAULT_NAMESPACE + "/" + name, "Metriken gibt es nur für laufende Pods – Status prüfen mit 'kubectl get pods'.")
          : host._err('Error from server (NotFound): pods "' + name + '" not found', "Pod-Namen siehst du mit 'kubectl get pods'.");
      }
    }
    if (rows.length === 0) return noResourcesIn();
    return table(["NAME", "CPU(cores)", "MEMORY(bytes)"], rows.map(r => [r.name, r.cpuMilli + "m", r.memMi + "Mi"]));
  }

  if (kind === "nodes") {
    let nodes = host.nodeMetrics();
    if (name) {
      nodes = nodes.filter(nd => nd.name === name);
      if (nodes.length === 0) return host._err('Error from server (NotFound): nodes "' + name + '" not found', "Node-Namen siehst du mit 'kubectl get nodes'.");
    }
    return table(["NAME", "CPU(cores)", "CPU%", "MEMORY(bytes)", "MEMORY%"],
      nodes.map(nd => [nd.name, nd.cpuMilli + "m", nd.cpuPct + "%", nd.memMi + "Mi", nd.memPct + "%"]));
  }

  if (!what) return host._err("kubectl top: pods oder nodes?", "z.B. 'kubectl top pods' oder 'kubectl top nodes'");
  // Echtes `kubectl top` kennt nur pod und node als Unterbefehle, alles andere ist ein unbekannter Befehl.
  return host._err('error: unknown command "' + what + '" for "kubectl top"', "z.B. 'kubectl top nodes'");
}


// --- kubectl logs: die (kaputt-abhängigen) Log-Texte + Vorab-Checks ausgelagert ---

// Die synthetischen Log-Texte für die beiden Zustände, die einen Vorgänger-Container hinterlassen.
function brokenLogText(dep: Deployment): string | null {
  if (dep.broken && dep.broken.type === "crashloop") {
    return [
      "[start] Dienst " + dep.name + " startet …",
      "[start] Lese Konfiguration …",
      "FATAL: Secret '" + (dep.broken.needsSecret || "") + "' nicht gefunden – Dienst kann nicht starten!",
      "[exit] Prozess beendet mit Code 1",
    ].join("\n");
  }
  // Tückisch: Die App-Logs sehen normal aus und brechen einfach ab – den OOM-Kill
  // macht der Kernel von außen, die App schreibt dazu nichts. Die Wahrheit steht
  // in 'kubectl describe pod' (Last State: Terminated, Reason: OOMKilled).
  if (dep.broken && dep.broken.type === "oomkilled") {
    return [
      "[start] Dienst " + dep.name + " startet …",
      "[info]  Lade Datensätze in den Arbeitsspeicher …",
      "[info]  Baue Index auf …",
      "(Log endet hier abrupt – kein Fehler, kein Stacktrace.)",
    ].join("\n");
  }
  return null;
}

// Nie gestartete Container (Image fehlt / Pod ungescheduled) haben gar keine Logs.
function logsNotStartedError(host: KubectlHost, dep: Deployment, name: string): string | null {
  if (dep.broken && dep.broken.type === "imagepull") {
    return host._err('Error from server (BadRequest): container "' + dep.name + '" in pod "' + name + '" is waiting to start: trying and failing to pull image',
      "Keine Logs ohne Image! Die Ursache steht in den Events: kubectl describe pod " + name);
  }
  if (dep.broken && dep.broken.type === "pending") {
    return host._err('Error from server (BadRequest): pod "' + name + '" is not scheduled yet', "Der Pod wartet auf einen freien Node. Schau in die Events: kubectl describe pod " + name);
  }
  return null;
}

/** Was `kubectl logs` über einen Pod wissen muss: Fehler vor dem Start, Log des abgestürzten
 *  Vorgängers, Containername und der normale Log. Je Owner aus seiner Wahrheit. */
interface LogSource { notStarted: string | null; crashLog: string | null; container: string; normal: string }

function logSource(host: KubectlHost, c: ClusterPod, name: string): LogSource {
  switch (c.owner) {
    case "Deployment":
      return {
        notStarted: logsNotStartedError(host, c.dep, name),
        crashLog: brokenLogText(c.dep),
        container: c.dep.name,
        normal: [
          "10.244.1.1 - - [12/Jun/2026:09:14:02 +0000] \"GET / HTTP/1.1\" 200 615",
          "10.244.1.1 - - [12/Jun/2026:09:14:05 +0000] \"GET /gesundheit HTTP/1.1\" 200 2",
          "10.244.2.7 - - [12/Jun/2026:09:14:11 +0000] \"GET /favicon.ico HTTP/1.1\" 404 153",
        ].join("\n"),
      };
    case "StatefulSet":
      return {
        notStarted: podAddress(c, host.pvcs) === null
          ? host._err('Error from server (BadRequest): pod "' + name + '" is not scheduled yet',
            "Der Pod wartet auf sein Volume. Schau in die Events: kubectl describe pod " + name + " – und prüfe den Claim mit: kubectl get pvc")
          : null,
        crashLog: null,
        container: c.sts.name,
        normal: [
          "[start] " + c.sts.name + " startet als " + name + " …",
          "[info]  Datenverzeichnis ist der Claim " + statefulPodClaimName(c.sts, c.pod),
          "[info]  Bereit für Verbindungen",
        ].join("\n"),
      };
  }
}

/** Das Log-Ziel eines Tokens: `<pod>`, `pod/<pod>` oder `deploy|deployment|deployments/<name>` (der erste
 *  Pod des Deployments; bei mehreren sagt `note`, welcher es ist – wie das echte „Found N pods, using …“).
 *  Ein String als `error` ist die fertige Fehlerausgabe. */
function logsTarget(host: KubectlHost, tok: string): { name: string; note?: string } | { error: string } {
  const slash = tok.indexOf("/");
  if (slash < 0) return { name: tok };
  const typ = tok.slice(0, slash);
  const name = tok.slice(slash + 1);
  const kind = resolveKind(typ);
  if (!kind) return { error: unknownResourceType(host, typ) };
  if (kind.plural === "pods") return { name };
  if (kind.plural !== "deployments") return { error: notSimulated(host, "'kubectl logs " + kind.plural + "/<name>'.", ["kubectl logs <pod>", "kubectl logs pod/<pod>", "kubectl logs deploy/<deployment>"]) };
  if (!host.deployments.some(d => d.name === name)) return { error: host._err('Error from server (NotFound): ' + qualified(kind, "plural") + ' "' + name + '" not found', "Welche Deployments es gibt: 'kubectl get deployments'") };
  const pods = clusterPods(host).filter(c => c.owner === "Deployment" && c.dep.name === name);
  if (pods.length === 0) return { error: host._err("error: timed out waiting for the condition", "Das Deployment '" + name + "' hat keine Pods (Replicas 0?). Prüfe 'kubectl get pods'.") };
  const first = pods[0].pod.name;
  return { name: first, ...(pods.length > 1 ? { note: "Found " + pods.length + " pods, using pod/" + first } : {}) };
}

export function kubectlLogs(host: KubectlHost, t: string[]) {
  // Flags können vor oder hinter dem Pod-Namen stehen: -f/--follow (live folgen),
  // -p/--previous (Logs des abgestürzten Vorgänger-Containers).
  const follow = t.includes("-f") || t.includes("--follow");
  const previous = t.includes("-p") || t.includes("--previous");
  const tok = positionals("logs", t)[0];
  if (!tok) return host._err("kubectl logs: Welcher Pod?", "Pod-Namen siehst du mit 'kubectl get pods'.");
  const target = logsTarget(host, tok);
  if ("error" in target) return target.error;
  const out = logsOf(host, target.name, previous, follow);
  return target.note ? target.note + "\n" + out : out;
}

function logsOf(host: KubectlHost, name: string, previous: boolean, follow: boolean): string {
  const c = findClusterPod(host, name);
  if (!c) return host._err('Error from server (NotFound): pods "' + name + '" not found');
  const src = logSource(host, c, name);
  if (src.notStarted) return src.notStarted;

  if (previous) {
    // --previous zeigt die Logs des ABGESTÜRZTEN Vorgänger-Containers.
    // Nur sinnvoll, wenn der Pod überhaupt schon neugestartet ist.
    if (src.crashLog) return src.crashLog;
    return host._err('Error from server (BadRequest): previous terminated container "' + src.container + '" in pod "' + name + '" not found',
      "--previous zeigt den abgestürzten Vorgänger-Container – dieser Pod ist aber nie neugestartet.");
  }

  let out = src.crashLog ?? src.normal;
  // -f würde im echten Cluster live weiterlaufen; im Simulator endet der Strom hier.
  if (follow) out += "\n^C  (--follow würde live weiterlaufen; im Simulator endet der Stream hier.)";
  return out;
}

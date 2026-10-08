/* ===== Kubernia – kubectl describe pod (sim/kubectl/describe-pod.ts) =====
 * Der `describe pod`-Renderer, in kohäsive Blöcke zerlegt (Events / Container / Init / Volumes), je ein
 * Zweig für Deployment- und StatefulSet-Pods. Echtes `describe pod` zeigt den Security Context nicht;
 * die Sim druckt ihn hier, und `get pods -o yaml` zeigt ihn zusätzlich in `spec.containers`.
 * Die Limit- und Security-Zeilen nutzt auch `describe deployment` (./describe.ts).
 *
 * Phaser-frei (pure Domäne); importiert nur ./inspect (podPlacement), nie zurück (kein Zyklus).
 */
import type { KubectlHost } from "./host";
import { DEFAULT_NAMESPACE, SECURITY_CONTEXT_KEYS, type Deployment, type PodInstance, type PodStatus } from "../state";
import { currentReplicaSet } from "../replicasets";
import { findClusterPod, type ClusterPod } from "../pods";
import { statefulPodClaimName } from "../workload";
import { clusterPodStatus } from "../podstatus";
import { podPlacement } from "./inspect";

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
export function podLimitLines(host: KubectlHost, dep: Deployment): string[] {
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
// `describe pod` zeigt das nicht – die Sim zeigt ihn hier und in `get pods -o yaml`.
export function podSecurityLines(dep: Deployment): string[] {
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
  const { ip, node } = podPlacement(host, c);
  return [
    "Name:         " + pod.name,
    "Namespace:    " + DEFAULT_NAMESPACE,
    "Node:         " + (node ?? "<none>"),
    "Status:       " + statusLine,
    ...(dep.evicted ? ["Reason:       Evicted", "Message:      " + dep.evicted.reason] : []),
    "Ready:        " + st.ready,
    "IP:           " + (ip ?? "<none>"),
    "Controlled By: ReplicaSet/" + currentReplicaSet(dep).name,
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
  const { ip, node } = podPlacement(host, c);
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
    "Node:         " + (node ?? "<none>"),
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

export function describePod(host: KubectlHost, name: string): string {
  const c = findClusterPod(host, name);
  if (!c) return host._err('Error from server (NotFound): pods "' + name + '" not found', "Tipp: Pod-Namen kannst du aus 'kubectl get pods' kopieren.");
  switch (c.owner) {
    case "Deployment": return describeDeploymentPod(host, c);
    case "StatefulSet": return describeStatefulPod(host, c);
  }
}

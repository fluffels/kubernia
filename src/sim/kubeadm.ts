/* ===== KubeQuest – kubeadm-Befehlsfamilie (sim/kubeadm.ts) =====
 * Das Sim-Fundament des Aufbau-Bogens (#460, Lernbogen #239 „Cluster nach Sturm selbst
 * neu aufbauen", Spät-Spiel). Alles in der Spielwelt simuliert – kein echtes kind/minikube.
 *
 * `kubeadm` bringt einen leeren/zerstörten Cluster Schritt für Schritt zurück:
 *   - `kubeadm init`        → zieht die **Control-Plane** auf einem Knoten hoch (apiserver,
 *                             etcd, scheduler, controller-manager als Sim-Komponenten),
 *                             macht den Cluster ansprechbar und erzeugt einen Join-Token.
 *   - `kubeadm join <token>`→ hängt einen **Worker-Knoten** an die Control-Plane (er taucht
 *                             danach in `kubectl get nodes` auf). Token muss zum init-Token passen.
 *   - `kubeadm reset`       → räumt den Cluster wieder auf „bare metal" ab (keine Nodes,
 *                             Control-Plane down) – die Sturm-Lage als Befehl.
 *
 * Vor `kubeadm init` (bzw. nach dem Sturm) ist `controlPlane.up` false – dann scheitern
 * alle kubectl-Befehle mit „connection refused" (Gate sitzt im kubectl-Barrel).
 *
 * Phaser-frei (pure Domäne): Domänentypen aus ./state, Zufalls-IDs aus ./util – kein
 * Rückimport nach sim.ts (kein Zyklus). Aufgerufen aus dem `exec`-Dispatch in `sim.ts`
 * per `kubeadmCommand(this, …)`.
 */
import type { ClusterState, ClusterNode, Scenario } from "./state";
import { randSuffix, flagValue } from "./util";
import { provisionNode, isControlPlane, NODE_VERSION } from "./nodes";

const APISERVER = "10.0.0.10:6443";

/** Was die kubeadm-Befehle vom Simulator brauchen (von der `Sim`-Klasse erfüllt). Schmales
 *  Interface statt der ganzen Klasse – dokumentiert die Kopplung und vermeidet den
 *  Import-Zyklus kubeadm ↔ sim. `nodes`/`controlPlane` kommen über `extends ClusterState`. */
export interface KubeadmHost extends ClusterState {
  _err(msg: string, tip?: string): string;
  _reschedulePending(): void; // ein neuer Worker kann wartende Pods einplanen
}

/** Join-Token im echten kubeadm-Format `abcdef.0123456789abcdef` (6 . 16 Zeichen). */
function genToken(): string {
  return randSuffix(6) + "." + randSuffix(16);
}

/** Bootstrap-Lage der Control-Plane aus dem Szenario ableiten (#460), von `Sim.reset()` genutzt.
 *  Ein gespeicherter Stand bringt `controlPlane` direkt mit (Round-trip aus snapshot); sonst
 *  ergibt sie sich aus `bareMetal`: bare metal = down + kein Token; der laufende Cluster ist
 *  ansprechbar und zeigt `node` auf seinen Control-Plane-Knoten (sofern es einen gibt). */
export function deriveControlPlane(sc: Scenario, nodes: ClusterNode[]): { up: boolean; token: string | null; node: string | null } {
  if (sc.controlPlane) {
    return { up: !!sc.controlPlane.up, token: sc.controlPlane.token ?? null, node: sc.controlPlane.node ?? null };
  }
  const cp = nodes.find(isControlPlane);
  return { up: !sc.bareMetal, token: null, node: sc.bareMetal ? null : (cp ? cp.name : null) };
}

/** Bootstrap-/Sturm-Anteil eines Quest-Szenarios auf den LAUFENDEN Cluster anwenden (#461),
 *  von `Sim.mergeScenario()` genutzt. `bareMetal` = der große Sturm: räumt den Cluster auf
 *  bare metal ab (keine Nodes/Workloads, Control-Plane down) – die lokalen Baupläne (`files`)
 *  bleiben absichtlich, der Sturm nimmt den Cluster, nicht deine Manifeste. Eine explizite
 *  `controlPlane`-Lage übernimmt den Bootstrap-Stand (z.B. ein gespeicherter Zwischenstand).
 *  Bewusst ein gewollter Reset-Punkt (kein additives Merge); reload-sicher, weil seit #436 der
 *  Voll-Snapshot den neuen Stand hält und erreichte Szenarien nicht erneut eingemischt werden. */
export function applyBootstrapScenario(state: ClusterState, sc: Scenario): void {
  if (sc.bareMetal) {
    state.nodes.length = 0;
    state.deployments.length = 0;
    state.services.length = 0;
    state.ingresses.length = 0;
    state.networkPolicies.length = 0;
    state.statefulSets.length = 0;
    state.controlPlane = { up: false, token: null, node: null };
  }
  if (sc.controlPlane) state.controlPlane = deriveControlPlane(sc, state.nodes);
}

export function kubeadmCommand(host: KubeadmHost, t: string[]): string {
  const sub = (t[1] || "").toLowerCase();
  if (!sub) return host._err("kubeadm: Unterbefehl fehlt.", "Probier 'kubeadm init', dann 'kubeadm join <token>'.");
  if (sub === "init") return kubeadmInit(host);
  if (sub === "join") return kubeadmJoin(host, t);
  if (sub === "reset") return kubeadmReset(host);
  return host._err("kubeadm: unbekannter Unterbefehl '" + sub + "'", "Es gibt 'kubeadm init', 'kubeadm join <token>' und 'kubeadm reset'.");
}

/** Control-Plane hochziehen. Doppeltes init wird abgelehnt (der Cluster läuft schon). */
function kubeadmInit(host: KubeadmHost): string {
  if (host.controlPlane.up) {
    return host._err(
      "[init] error: a control plane is already running on this host\n" +
      "[ERROR Port-6443]: Port 6443 is in use\n" +
      "[ERROR FileAvailable--etc-kubernetes-manifests]: /etc/kubernetes/manifests is not empty",
      "Die Control-Plane läuft bereits. Worker hängst du mit 'kubeadm join <token>' an, abräumen geht mit 'kubeadm reset'.");
  }
  const token = genToken();
  // Der Knoten, auf dem init läuft, wird die Control-Plane. Gibt es schon einen Control-Plane-
  // Knoten (z.B. aus dem Szenario), nimm ihn; sonst lege "ahoi-control" an. Idempotent über Name.
  const cpName = host.nodes.find(isControlPlane)?.name ?? "ahoi-control";
  provisionNode(host, { name: cpName, roles: "control-plane" }); // idempotent per Name
  host.controlPlane = { up: true, token, node: cpName };
  return [
    "[init] Using Kubernetes version: " + NODE_VERSION,
    "[preflight] Running pre-flight checks",
    "[certs] Generating certificates and keys",
    "[control-plane] Creating static Pod manifests for kube-apiserver, kube-controller-manager and kube-scheduler",
    "[etcd] Creating static Pod manifest for local etcd",
    "[bootstrap-token] Using token: " + token,
    "",
    "Your Kubernetes control-plane has initialized successfully!",
    "",
    "Then you can join any number of worker nodes by running the following on each as root:",
    "",
    "  kubeadm join " + APISERVER + " --token " + token + " \\",
    "          --discovery-token-ca-cert-hash sha256:" + randSuffix(64),
    "",
    "💡 Die Control-Plane (" + cpName + ") läuft jetzt – kubectl ist wieder ansprechbar. Häng Worker mit dem obigen 'kubeadm join'-Befehl an.",
  ].join("\n");
}

/** Worker an die Control-Plane anschließen. Negativfälle: vor init (Control-Plane down),
 *  ohne Token, mit falschem Token. */
function kubeadmJoin(host: KubeadmHost, t: string[]): string {
  if (!host.controlPlane.up) {
    return host._err(
      "[preflight] Running pre-flight checks\n" +
      "error execution phase preflight: couldn't validate the identity of the API Server: " +
      "Get \"https://" + APISERVER + "/api/v1/...\": dial tcp " + APISERVER + ": connect: connection refused",
      "Es läuft noch keine Control-Plane, an die sich der Worker hängen könnte. Zieh sie zuerst mit 'kubeadm init' hoch.");
  }
  // Token akzeptieren als `--token <tok>` ODER positional `kubeadm join <tok>` (beide Schreibweisen).
  const flagToken = flagValue(t, "--token");
  const positional = t.slice(2).find(a => !a.startsWith("-") && /^\w+\.\w+$/.test(a));
  const token = flagToken || positional || null;
  if (!token) {
    return host._err("[preflight] error: --token is required",
      "Den Token zeigt 'kubeadm init' an. Aufruf z.B.: kubeadm join --token <token>");
  }
  if (token !== host.controlPlane.token) {
    return host._err(
      "[preflight] error: couldn't validate the identity of the API Server: invalid bootstrap token \"" + token + "\"",
      "Der Token passt nicht zur Control-Plane. Nimm genau den Token, den 'kubeadm init' ausgegeben hat.");
  }
  // Nächster freier Worker-Name: ahoi-worker-<n>, fortlaufend über die schon vorhandenen Worker.
  const workerCount = host.nodes.filter(n => !isControlPlane(n)).length;
  const name = "ahoi-worker-" + (workerCount + 1);
  provisionNode(host, { name }); // Worker-Default: roles "<none>", version NODE_VERSION
  // Ein neuer Knoten kann wartende (Pending) Pods einplanen – wie ein echter Worker, der dazukommt.
  host._reschedulePending();
  return [
    "[preflight] Running pre-flight checks",
    "[preflight] Reading configuration from the cluster",
    "[kubelet-start] Starting the kubelet",
    "",
    "This node has joined the cluster:",
    "* Certificate signing request was sent to apiserver and a response was received.",
    "* The Kubelet was informed of the new secure connection details.",
    "",
    "Run 'kubectl get nodes' on the control-plane to see this node (" + name + ") join the cluster.",
    "💡 Worker '" + name + "' hängt jetzt am Cluster. Wiederhol den Befehl für jeden weiteren Knoten.",
  ].join("\n");
}

/** Cluster auf „bare metal" zurückräumen: keine Nodes, Control-Plane down, kein Token.
 *  Macht die Sturm-/Neuanfang-Lage als Befehl verfügbar (und ist der Gegenpart zu init). */
function kubeadmReset(host: KubeadmHost): string {
  const wasUp = host.controlPlane.up;
  host.nodes.length = 0;
  host.controlPlane = { up: false, token: null, node: null };
  return [
    "[reset] Reading configuration from the cluster",
    "[reset] Stopping the kubelet service",
    "[reset] Removing kubernetes-managed containers",
    "[reset] Deleting contents of config directories: [/etc/kubernetes/manifests /etc/kubernetes/pki]",
    "",
    "The reset process does not clean CNI configuration. To do so, you must remove /etc/cni/net.d",
    "💡 Der Cluster ist abgeräumt – " + (wasUp ? "bare metal" : "war schon leer") + ". kubectl meldet jetzt wieder „connection refused“, bis du 'kubeadm init' fährst.",
  ].join("\n");
}

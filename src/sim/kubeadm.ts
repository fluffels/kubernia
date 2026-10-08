/* ===== Kubernia – kubeadm-Befehlsfamilie (sim/kubeadm.ts) =====
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
import { randSuffix, suggest } from "./util";
import { flag, isFlagToken, notSimulated, parseCall, specOfSub, subEntry, type Call, type SubEntry } from "./cliargs";
import { provisionNode, isControlPlane, NODE_VERSION, CONTROL_PLANE_IP, CONTROL_PLANE_NODE, workerNodeName } from "./nodes";

const APISERVER = CONTROL_PLANE_IP + ":6443";

/** Was die kubeadm-Befehle vom Simulator brauchen (von der `Sim`-Klasse erfüllt). Schmales
 *  Interface statt der ganzen Klasse – dokumentiert die Kopplung und vermeidet den
 *  Import-Zyklus kubeadm ↔ sim. Statt des ganzen `ClusterState` (Leaky Abstraction
 *  #516) nur die berührten `nodes`/`controlPlane` per `Pick` (ISP), typgebunden an die
 *  SSOT (sim/state.ts, #372). */
export interface KubeadmHost extends Pick<ClusterState, "nodes" | "controlPlane" | "clock"> {
  rng: () => number; // Instanz-eigener Zufallsstrom (#580): Bootstrap-Token/CA-Hash statt globaler Strom
  _err(msg: string, tip?: string): string;
  _reschedulePending(): void; // ein neuer Worker kann wartende Pods einplanen
}

/** Join-Token im echten kubeadm-Format `abcdef.0123456789abcdef` (6 . 16 Zeichen). */
function genToken(rng: () => number): string {
  return randSuffix(6, rng) + "." + randSuffix(16, rng);
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

type KubeadmHandler = (host: KubeadmHost, c: Call) => string;

// `--discovery-token-ca-cert-hash` wird angenommen, aber nicht ausgewertet: der von `init` gedruckte Join-Befehl trägt
// ihn, und die Sim hat nur EINE Control-Plane – es gibt nichts, wogegen der Hash zu prüfen wäre.
const SUB: Record<string, SubEntry<KubeadmHandler>> = {
  init: { run: kubeadmInit, flags: [flag(true, "--pod-network-cidr")] },
  join: { run: kubeadmJoin, flags: [flag(true, "--token"), flag(true, "--discovery-token-ca-cert-hash")] },
  reset: { run: kubeadmReset, flags: [flag(false, "-f", "--force")] },
};

/** Die registrierten Unterbefehle (Treue-Matrix, docs/sim-treue/: ein neuer Unterbefehl braucht eine Zeile). */
export const KUBEADM_SUBCOMMANDS: readonly string[] = Object.keys(SUB);

/** Echte kubeadm-Unterbefehle, die die Sim nicht kann. */
const NOT_SIMULATED = ["token", "upgrade", "certs", "config", "kubeconfig", "version", "completion", "alpha"];
const KANN = ["kubeadm init [--pod-network-cidr <cidr>]", "kubeadm join <token>", "kubeadm reset [-f]"];

export function kubeadmCommand(host: KubeadmHost, t: string[]): string {
  const sub = (t[1] || "").toLowerCase();
  if (!sub) return host._err("kubeadm: Unterbefehl fehlt.", "Probier 'kubeadm init', dann 'kubeadm join <token>'.");
  if (isFlagToken(sub)) return notSimulated(host, "das Flag '" + sub + "' vor dem Unterbefehl.", KANN);
  const entry = subEntry(SUB, sub);
  if (!entry) {
    if (NOT_SIMULATED.includes(sub)) return notSimulated(host, "'kubeadm " + sub + "'.", KANN);
    const guess = suggest(sub, [...Object.keys(SUB), ...NOT_SIMULATED]);
    return host._err("kubeadm: unbekannter Unterbefehl '" + sub + "'",
      (guess ? "Meintest du 'kubeadm " + guess + "'? " : "") + "Es gibt 'kubeadm init', 'kubeadm join <token>' und 'kubeadm reset'.");
  }
  const call = parseCall(host, specOfSub("kubeadm " + sub, entry), t, 2);
  return typeof call === "string" ? call : entry.run(host, call);
}

/** Ein IPv4-CIDR (`10.244.0.0/16`)? */
function isIpv4Cidr(v: string): boolean {
  const m = v.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\/(\d{1,2})$/);
  return !!m && m.slice(1, 5).every(o => Number(o) <= 255) && Number(m[5]) <= 32;
}

/** `--pod-network-cidr` prüfen (kommagetrennte IPv4-CIDRs): `null` = ok oder nicht gesetzt, sonst die Fehlerausgabe. */
function podCidrError(host: KubeadmHost, cidr: string | null): string | null {
  if (cidr === null) return null;
  const bad = cidr.split(",").find(c => !c.includes(":") && !isIpv4Cidr(c));
  if (bad !== undefined) return host._err('networking.podSubnet: Invalid value: "' + bad + '": couldn\'t parse subnet', "Ein Pod-Netz ist ein CIDR, z.B. '--pod-network-cidr=10.244.0.0/16'.");
  if (cidr.includes(":")) return notSimulated(host, "IPv6-Pod-Netze (" + cidr + ").", ["--pod-network-cidr=10.244.0.0/16"]);
  return null;
}

/** Control-Plane hochziehen. Doppeltes init wird abgelehnt (der Cluster läuft schon). */
function kubeadmInit(host: KubeadmHost, c: Call): string {
  const cidr = c.value("--pod-network-cidr");
  const cidrErr = podCidrError(host, cidr);
  if (cidrErr) return cidrErr;
  if (host.controlPlane.up) {
    return host._err(
      "[init] error: a control plane is already running on this host\n" +
      "[ERROR Port-6443]: Port 6443 is in use\n" +
      "[ERROR FileAvailable--etc-kubernetes-manifests]: /etc/kubernetes/manifests is not empty",
      "Die Control-Plane läuft bereits. Worker hängst du mit 'kubeadm join <token>' an, abräumen geht mit 'kubeadm reset'.");
  }
  const token = genToken(host.rng);
  // Der Knoten, auf dem init läuft, wird die Control-Plane. Gibt es schon einen Control-Plane-
  // Knoten (z.B. aus dem Szenario), nimm ihn; sonst lege den Standard-Control-Plane-Knoten an. Idempotent über Name.
  const cpName = host.nodes.find(isControlPlane)?.name ?? CONTROL_PLANE_NODE;
  provisionNode(host, { name: cpName, roles: "control-plane", created: host.clock }); // idempotent per Name
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
    "          --discovery-token-ca-cert-hash sha256:" + randSuffix(64, host.rng),
    "",
    "💡 Die Control-Plane (" + cpName + ") läuft jetzt – kubectl ist wieder ansprechbar." + (cidr ? " Pod-Netz: " + cidr + " (der Simulator merkt es sich nicht)." : "") + " Häng Worker mit dem obigen 'kubeadm join'-Befehl an.",
  ].join("\n");
}

/** Worker an die Control-Plane anschließen. Negativfälle: vor init (Control-Plane down),
 *  ohne Token, mit falschem Token. */
function kubeadmJoin(host: KubeadmHost, c: Call): string {
  if (!host.controlPlane.up) {
    return host._err(
      "[preflight] Running pre-flight checks\n" +
      "error execution phase preflight: couldn't validate the identity of the API Server: " +
      "Get \"https://" + APISERVER + "/api/v1/...\": dial tcp " + APISERVER + ": connect: connection refused",
      "Es läuft noch keine Control-Plane, an die sich der Worker hängen könnte. Zieh sie zuerst mit 'kubeadm init' hoch.");
  }
  // Token akzeptieren als `--token <tok>` ODER positional `kubeadm join <tok>` (Sim-Vereinfachung, die die Quests nutzen);
  // dazu optional der Endpoint `host:port` (so druckt ihn `kubeadm init`). Mehr als zwei Argumente gibt es nicht.
  const tokenLike = (a: string) => /^\w+\.\w+$/.test(a);
  const bad = c.args.find(a => !a.includes(":") && !tokenLike(a));
  const tooMany = c.args.filter(a => a.includes(":")).length > 1 || c.args.filter(tokenLike).length > 1;
  if (bad !== undefined || tooMany) {
    return host._err(bad !== undefined ? 'error: "' + bad + '" ist weder ein API-Server-Endpoint (host:port) noch ein Bootstrap-Token' : "accepts at most 1 arg(s), received " + c.args.length,
      "Muster: kubeadm join " + APISERVER + " --token <token>");
  }
  const endpoint = c.args.find(a => a.includes(":"));
  if (endpoint !== undefined && endpoint !== APISERVER) {
    return host._err('error execution phase preflight: couldn\'t validate the identity of the API Server: Get "https://' + endpoint + '/api/v1/namespaces/kube-public/configmaps/cluster-info?timeout=10s": dial tcp ' + endpoint + ": connect: connection refused",
      "Die Control-Plane lauscht auf " + APISERVER + " – das ist der Endpoint aus 'kubeadm init'.");
  }
  const token = c.value("--token") || c.args.find(tokenLike) || null;
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
  const name = workerNodeName(workerCount + 1);
  provisionNode(host, { name, created: host.clock }); // Worker-Default: roles "<none>", version NODE_VERSION
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
function kubeadmReset(host: KubeadmHost): string { // -f/--force: der Simulator fragt nie nach
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

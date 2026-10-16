/* ===== Kubernia – kubectl logs (sim/kubectl/logs.ts) =====
 * `logs <pod>|pod/<pod>|deploy/<name>` mit `-f` und `-p`: die (kaputt-abhängigen) Log-Texte und die
 * Vorab-Checks je Pod-Owner.
 *
 * Phaser-frei (pure Domäne).
 */
import type { KubectlHost } from "./host";
import type { Broken, Deployment } from "../state";
import { deploymentPodState } from "../podstatus";
import { resolveKind, qualified } from "./resources";
import { slashRef, notSimulated, unknownResourceType } from "./args";
import type { Call } from "../cliargs";
import { podAddress } from "../endpoints";
import { clusterPods, findClusterPod, type ClusterPod } from "../pods";
import { statefulPodClaimName, containerNameOf } from "../workload";

// --- kubectl logs: die (kaputt-abhängigen) Log-Texte + Vorab-Checks ausgelagert ---

// Was `kubectl logs` über ein Deployment-Pod wissen muss, nach dem Vorrang `deploymentPodState` (#1648): Evicted > gesund > Broken.
// Wertliefernde `switch`e ohne `default`: ein neuer Zustand oder Broken-Typ ohne Zweig ist ein TS-Fehler (TS2366), kein stiller Normal-Log.
//  - noLogs: Container, die keine Logs haben: nie gestartet (Image fehlt / Pod ungescheduled) oder evicted (Pod beendet, Logs weg).
//  - crashLog: die Log-Texte der Zustände, die einen Vorgänger-Container hinterlassen.
//  - notready: der Container LÄUFT (Liveness ok), nur die Readiness schlägt fehl: normaler Log, nie neugestartet.
function deploymentLogFacts(host: KubectlHost, dep: Deployment, name: string): Pick<LogSource, "noLogs" | "crashLog"> {
  const s = deploymentPodState(dep);
  switch (s.kind) {
    case "evicted":
      // Evicted = Phase Failed, Container beendet; der kubelet räumt tote Container samt Logs ab (wie bei Disk-Druck).
      return {
        noLogs: host._err('Error from server (BadRequest): container "' + containerNameOf(dep) + '" in pod "' + name + '" is terminated',
          "Der kubelet hat den Pod evicted: sein Container läuft nicht mehr, seine Logs sind weg. Den Grund zeigen die Events: kubectl describe pod " + name),
        crashLog: null,
      };
    case "healthy":
      return { noLogs: null, crashLog: null };
    case "broken":
      return brokenLogFacts(host, dep, s.broken, name);
  }
}

function brokenLogFacts(host: KubectlHost, dep: Deployment, b: Broken, name: string): Pick<LogSource, "noLogs" | "crashLog"> {
  switch (b.type) {
    case "imagepull":
      return {
        noLogs: host._err('Error from server (BadRequest): container "' + containerNameOf(dep) + '" in pod "' + name + '" is waiting to start: trying and failing to pull image',
          "Keine Logs ohne Image! Die Ursache steht in den Events: kubectl describe pod " + name),
        crashLog: null,
      };
    case "pending":
      return {
        noLogs: host._err('Error from server (BadRequest): pod "' + name + '" is not scheduled yet', "Der Pod wartet auf einen freien Node. Schau in die Events: kubectl describe pod " + name),
        crashLog: null,
      };
    case "crashloop":
      return {
        noLogs: null,
        crashLog: [
          "[start] Dienst " + dep.name + " startet …",
          "[start] Lese Konfiguration …",
          "FATAL: Secret '" + (b.needsSecret || "") + "' nicht gefunden – Dienst kann nicht starten!",
          "[exit] Prozess beendet mit Code 1",
        ].join("\n"),
      };
    case "oomkilled":
      // Tückisch: Die App-Logs sehen normal aus und brechen einfach ab – den OOM-Kill
      // macht der Kernel von außen, die App schreibt dazu nichts. Die Wahrheit steht
      // in 'kubectl describe pod' (Last State: Terminated, Reason: OOMKilled).
      return {
        noLogs: null,
        crashLog: [
          "[start] Dienst " + dep.name + " startet …",
          "[info]  Lade Datensätze in den Arbeitsspeicher …",
          "[info]  Baue Index auf …",
          "(Log endet hier abrupt – kein Fehler, kein Stacktrace.)",
        ].join("\n"),
      };
    case "notready":
      return { noLogs: null, crashLog: null };
  }
}

/** Was `kubectl logs` über einen Pod wissen muss: Fehler vor dem Start, Log des abgestürzten
 *  Vorgängers, Containername und der normale Log. Je Owner aus seiner Wahrheit. */
interface LogSource { noLogs: string | null; crashLog: string | null; container: string; normal: string }

function logSource(host: KubectlHost, c: ClusterPod, name: string): LogSource {
  switch (c.owner) {
    case "Deployment":
      return {
        ...deploymentLogFacts(host, c.dep, name),
        container: containerNameOf(c.dep),
        normal: [
          "10.244.1.1 - - [12/Jun/2026:09:14:02 +0000] \"GET / HTTP/1.1\" 200 615",
          "10.244.1.1 - - [12/Jun/2026:09:14:05 +0000] \"GET /gesundheit HTTP/1.1\" 200 2",
          "10.244.2.7 - - [12/Jun/2026:09:14:11 +0000] \"GET /favicon.ico HTTP/1.1\" 404 153",
        ].join("\n"),
      };
    case "StatefulSet":
      return {
        noLogs: podAddress(c, host.pvcs) === null
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
  const ref = slashRef(tok);
  if (!ref) return { name: tok };
  if ("error" in ref) return { error: host._err(ref.error) };
  const { typ, name } = ref;
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

export function kubectlLogs(host: KubectlHost, c: Call) {
  // Flags können vor oder hinter dem Pod-Namen stehen: -f/--follow (live folgen),
  // -p/--previous (Logs des abgestürzten Vorgänger-Containers).
  const follow = c.has("-f", "--follow");
  const previous = c.has("-p", "--previous");
  const tok = c.args[0];
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
  if (src.noLogs) return src.noLogs;

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

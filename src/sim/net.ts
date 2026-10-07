/* ===== Kubernia – Netzwerk-/Erreichbarkeits-Befehle (sim/net.ts) =====
 * Die beiden „frag einen Service"-Welt-Befehle, die KEINE kubectl-Unterbefehle sind:
 *   - `nslookup <name>`  – Namensauflösung über CoreDNS (#337)
 *   - `curl [http://]<service>[:port][/pfad]` – Erreichbarkeit (#164, Werft-Capstone)
 * Beide sind rein lesend und in der Spielwelt bewusst eigene Befehle (statt `kubectl
 * exec … nslookup/curl`), damit Namensauflösung und Erreichbarkeit greifbar werden;
 * im echten Cluster liefen sie aus einem Pod.
 *
 * Ausgelagert aus sim.ts (#164), als die Datei das God-File-Budget sprengte – analog
 * zum docker/kubectl-Split (#346/#397). Phaser-frei: nutzt nur Domänentypen aus ./state
 * über das schmale NetHost-Interface; kein Rückimport nach sim.ts (kein Zyklus).
 */
import { isHeadlessService, type ServiceRes } from "./state";
import { serviceBackends, readyBackends, type EndpointsHost } from "./endpoints";

/** Was die net-Befehle vom Simulator brauchen (von der `Sim`-Klasse erfüllt). */
export interface NetHost extends EndpointsHost {
  services: ServiceRes[];
  _err(msg: string, tip?: string): string;
  _reschedulePending(): void;
  _recheckReadiness(): void;
}

/** nslookup <name>: fragt CoreDNS (den Cluster-DNS-Server) nach der Adresse hinter
 *  einem Namen (#337). Löst die Service-Discovery-Formen `<svc>`, `<svc>.<ns>` und den
 *  vollen FQDN `<svc>.<ns>.svc.cluster.local` zur ClusterIP des Service auf; ein
 *  ExternalName-Service liefert stattdessen den CNAME auf seinen externen DNS-Namen.
 *  Ein headless Service (`clusterIP: None`, #1301) hat keine Service-IP: CoreDNS liefert
 *  die IPs der bereiten Pods dahinter, und `<pod>.<svc>` löst einen einzelnen StatefulSet-Pod auf. */
export function nslookupCommand(host: NetHost, t: string[]): string {
  const COREDNS = "10.96.0.10";          // ClusterIP des CoreDNS-Service (kube-system)
  const EXTERNAL_RESOLVE_IP = "203.0.113.55"; // Beispiel-Adresse (TEST-NET-3) hinter dem externen Namen
  const arg = t[1];
  if (!arg || arg.startsWith("-")) {
    return host._err("nslookup: Welchen Namen soll ich auflösen?",
      "z.B. 'nslookup kasse' oder voll 'nslookup kasse.default.svc.cluster.local'.");
  }
  const header = ["Server:\t\t" + COREDNS, "Address:\t" + COREDNS + "#53", ""];
  const query = arg.replace(/\.$/, "");      // optionalen abschließenden Punkt entfernen
  const svcName = query.split(".")[0];       // erstes Label = Service-Name (NS/Domain folgt)
  const fqdn = svcName + ".default.svc.cluster.local";
  // Der eingebaute kubernetes-API-Service ist immer da und hat eine feste ClusterIP.
  if (svcName === "kubernetes") {
    return header.concat(["Name:\t" + "kubernetes.default.svc.cluster.local", "Address: 10.96.0.1"]).join("\n");
  }
  const svc = host.services.find(s => s.name === svcName);
  if (!svc) {
    const pod = podRecordAnswer(host, query.split("."));
    if (pod) return header.concat(pod).join("\n");
    return host._err(header.join("\n") + "\n** server can't find " + fqdn + ": NXDOMAIN",
      "Kennt CoreDNS den Namen nicht? Prüfe mit 'kubectl get services', ob der Service existiert (richtig geschrieben?).");
  }
  if (svc.type === "ExternalName" && svc.externalName) {
    // ExternalName hat KEINE ClusterIP: CoreDNS antwortet mit einem CNAME auf den externen Namen.
    return header.concat([
      fqdn + "\tcanonical name = " + svc.externalName + ".",
      "Name:\t" + svc.externalName,
      "Address: " + EXTERNAL_RESOLVE_IP,
    ]).join("\n");
  }
  if (isHeadlessService(svc)) {
    const ips = headlessAnswer(host, svc);
    if (ips.length === 0) {
      return host._err(header.join("\n") + "\n** server can't find " + fqdn + ": NXDOMAIN",
        "Der headless Service '" + svc.name + "' hat keine bereiten Pods dahinter (kein Deployment/StatefulSet gleichen Namens, oder die Pods sind nicht bereit). Schau mit 'kubectl get pods'.");
    }
    return header.concat(ips.flatMap(ip => ["Name:\t" + fqdn, "Address: " + ip])).join("\n");
  }
  return header.concat(["Name:\t" + fqdn, "Address: " + svc.clusterIP]).join("\n");
}

/** Die Pod-IPs hinter einem headless Service (#1301): die bereiten Backends aus der
 *  gemeinsamen Service→Pod-Auflösung (#1318). Vorher den Cluster nachführen (wie curl). */
function headlessAnswer(host: NetHost, svc: ServiceRes): string[] {
  host._reschedulePending();
  host._recheckReadiness();
  return readyBackends(host, svc).flatMap(b => (b.ip ? [b.ip] : []));
}

/** `<pod>.<svc>[.<ns>.svc.cluster.local]`: der stabile DNS-Name eines StatefulSet-Pods hinter
 *  einem headless Service (#1301). Nur wenn `<svc>` headless ist, das StatefulSet ihn als
 *  `serviceName` führt und der Pod bereit ist; sonst `null` (→ NXDOMAIN). */
function podRecordAnswer(host: NetHost, labels: string[]): string[] | null {
  const [podName, svcName] = labels;
  const svc = svcName ? host.services.find(s => s.name === svcName) : undefined;
  if (!svc || !isHeadlessService(svc)) return null;
  host._reschedulePending();
  host._recheckReadiness();
  const pod = serviceBackends(host, svc).find(b => b.owner === "StatefulSet" && b.ready && b.pod === podName);
  return pod?.ip ? ["Name:\t" + podName + "." + svc.name + ".default.svc.cluster.local", "Address: " + pod.ip] : null;
}

/** curl [http(s)://]<service>[:port][/pfad]: fragt einen Service im Cluster ab und
 *  macht „läuft mein Dienst und ist er erreichbar?" greifbar (#164, Werft-Capstone).
 *  Rein lesend. Hier zahlen sich die Troubleshooting-Haken aus – jeder Fehlerfall
 *  endet in „Connection refused" mit einem Tipp, wo man nachschaut:
 *   - Service kennt der DNS nicht                → (6) Could not resolve host
 *   - falscher Port in der URL                   → (7) refused (nennt den echten Port)
 *   - keine bereiten Pods (ImagePull/CrashLoop/  → (7) refused (Verweis auf get pods/
 *     NotReady/Pending oder gar kein Deployment)    describe/endpoints)
 *   - targetPort ≠ containerPort (Manifest)      → (7) refused (Ports angleichen) */
/** Zerlegt die curl-Adresse `[http(s)://]<host>[:port][/pfad]` in ihre Teile. Als eigener
 *  Parser gehalten, damit `curlCommand` unter dem Komplexitäts-Budget bleibt (#502). */
function parseCurlUrl(arg: string): { hostName: string; reqPort: string | null; path: string; svcName: string } {
  let rest = arg.replace(/^https?:\/\//, "");
  const slash = rest.indexOf("/");
  const path = slash >= 0 ? rest.slice(slash) : "/";
  if (slash >= 0) rest = rest.slice(0, slash);
  const colon = rest.indexOf(":");
  const reqPort = colon >= 0 ? rest.slice(colon + 1) : null;
  const hostName = colon >= 0 ? rest.slice(0, colon) : rest;
  const svcName = hostName.split(".")[0]; // erstes Label (svc / svc.ns / FQDN)
  return { hostName, reqPort, path, svcName };
}

/** Warum curl ins Leere läuft (Tipp-Text), oder `null`, wenn mindestens ein bereites Backend
 *  den Service-Verkehr annimmt (#1318, Backends aus ./endpoints). */
function refusedReason(host: NetHost, svc: ServiceRes): string | null {
  const backends = serviceBackends(host, svc);
  if (backends.length === 0) {
    return "Der Service hat keine Endpoints – kein passendes Deployment/StatefulSet dahinter. Prüfe 'kubectl get endpoints " + svc.name + "' und 'kubectl get deployments'.";
  }
  const ready = backends.filter(b => b.ready);
  if (ready.length === 0) {
    return "Die Pods sind nicht bereit (READY 0/1). Schau warum mit 'kubectl get pods' und 'kubectl describe pod <pod>' (z.B. ImagePullBackOff/CrashLoopBackOff).";
  }
  // Port-Verdrahtung: targetPort des Service ≠ containerPort. Der Service HAT Endpoints (Pod ist
  // bereit), leitet aber ins Leere – tückisch. Refused nur, wenn KEIN bereites Backend den Port annimmt.
  const tp = svc.targetPort;
  const accepts = (b: { containerPort?: number }) => tp === undefined || b.containerPort === undefined || String(tp) === String(b.containerPort);
  if (!ready.some(accepts)) {
    return "Der Service leitet auf targetPort " + tp + ", aber dein Container lauscht auf containerPort " + ready[0].containerPort + ". Gleich die Ports im Manifest an (targetPort = containerPort).";
  }
  return null;
}

export function curlCommand(host: NetHost, t: string[]): string {
  // Vor der Abfrage den Cluster nachführen (wie get/top): notready-Pods, die durch ein
  // inzwischen vorhandenes Secret bereit wurden, und nachgeschobene Nodes berücksichtigen.
  host._reschedulePending();
  host._recheckReadiness();

  const arg = t.find((tok, i) => i > 0 && !tok.startsWith("-")) || null;
  if (!arg) return host._err("curl: Welche Adresse soll ich abfragen?", "z.B. 'curl http://kasse' oder 'curl kasse:8080'.");
  const { hostName, reqPort, path, svcName } = parseCurlUrl(arg);

  const svc = host.services.find(s => s.name === svcName);
  if (!svc) {
    return host._err("curl: (6) Could not resolve host: " + hostName,
      "Kennt der Cluster-DNS den Namen nicht? Prüfe mit 'kubectl get services', ob der Service '" + svcName + "' existiert (richtig geschrieben?).");
  }
  const svcPort = String(svc.port);
  // 1) Falscher Port in der URL – der Service lauscht auf einem anderen Port.
  if (reqPort && reqPort !== svcPort) {
    return host._err("curl: (7) Failed to connect to " + hostName + " port " + reqPort + ": Connection refused",
      "Der Service '" + svc.name + "' lauscht auf Port " + svcPort + ", nicht auf " + reqPort + ". Schau mit 'kubectl get services'.");
  }
  // 2) + 3) Keine bereiten Endpoints bzw. Port-Verdrahtung im Manifest falsch.
  const refused = refusedReason(host, svc);
  if (refused) {
    return host._err("curl: (7) Failed to connect to " + hostName + " port " + svcPort + ": Connection refused", refused);
  }
  // Erreichbar! Der eigene Dienst antwortet mit HTTP 200.
  return [
    "HTTP/1.1 200 OK",
    "server: kubequest",
    "content-type: text/plain",
    "",
    'Ahoi! Dein Dienst "' + svc.name + '" läuft und ist über ' + hostName + ":" + svcPort + path + " erreichbar. ⚓",
  ].join("\n");
}

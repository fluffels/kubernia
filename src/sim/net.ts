/* ===== Kubernia – Netzwerk-/Erreichbarkeits-Befehle (sim/net.ts) =====
 * Die beiden „frag einen Service"-Welt-Befehle, die KEINE kubectl-Unterbefehle sind:
 *   - `nslookup [-type=A] <name> [10.96.0.10]`  – Namensauflösung über CoreDNS (#337)
 *   - `curl [Flags] [http(s)://]<service>[:port][/pfad]` – Erreichbarkeit (#164, Werft-Capstone)
 * Beide lesen ihre Eingabe über `parseCall` (#1510) und sind rein lesend (bis auf `curl -o`, das ins
 * Arbeitsverzeichnis schreibt) und in der Spielwelt bewusst eigene Befehle (statt `kubectl
 * exec … nslookup/curl`), damit Namensauflösung und Erreichbarkeit greifbar werden;
 * im echten Cluster liefen sie aus einem Pod.
 *
 * Ausgelagert aus sim.ts (#164), als die Datei das God-File-Budget sprengte – analog
 * zum docker/kubectl-Split (#346/#397). Phaser-frei: nutzt nur Domänentypen aus ./state
 * über das schmale NetHost-Interface; kein Rückimport nach sim.ts (kein Zyklus).
 */
import { DEFAULT_NAMESPACE, isHeadlessService, type ServiceRes } from "./state";
import { parseServiceName, resolveService } from "./dns";
import { serviceBackends, readyBackends, KUBERNETES_SERVICE, type EndpointsHost } from "./endpoints";
import { parseCall, notSimulated, flag, checkedFlag, isFlagToken, type ArgSpec, type Call, type ErrHost } from "./cliargs";

/** Was die net-Befehle vom Simulator brauchen (von der `Sim`-Klasse erfüllt). `files` ist das
 *  Arbeitsverzeichnis: `curl -o <datei>` schreibt dorthin (`ls`/`cat`/`git status` sehen die Datei). */
export interface NetHost extends EndpointsHost {
  services: ServiceRes[];
  files: Record<string, string>;
  _err(msg: string, tip?: string): string;
  _reschedulePending(): void;
  _recheckReadiness(): void;
}

const COREDNS = "10.96.0.10";            // ClusterIP des CoreDNS-Service (kube-system)

/** Die Eintragsarten, die echtes nslookup kennt (BIND-Namen); der Simulator beantwortet nur `A`. */
const ECHTE_ARTEN = ["AAAA", "ANY", "CNAME", "MX", "NS", "PTR", "SOA", "SRV", "TXT"];

/** `-type=<art>`: nur A ist gültig; andere echte Arten sind nicht simuliert, alles andere ist der echte Fehler. */
function checkType(host: ErrHost, value: string): string | null {
  const art = value.toUpperCase();
  if (art === "A") return null;
  if (ECHTE_ARTEN.includes(art)) {
    return notSimulated(host, "die Eintragsart '" + value + "'.", ["nslookup -type=A <name>"], "Im Cluster beantwortet der Simulator nur A-Einträge.");
  }
  return host._err("unknown query type: " + value);
}

/** nslookup (goflag-Stil wie BIND: `-type=A`). Alle anderen Optionen (`-debug`, `-port=…`, `-timeout=…`) sind
 *  nicht simuliert. Die Aliase `-ty`, `-querytype`, `-query`, `-qu`, `-q` kennt BIND (nslookup.c, setoption). */
export const NSLOOKUP_ARGS: ArgSpec = {
  cmd: "nslookup",
  style: "goflag",
  flags: [checkedFlag(checkType, "-type", "-ty", "-querytype", "-query", "-qu", "-q")],
};

/** Optionsnamen sind bei nslookup nicht groß-/kleinschreibungsabhängig (`strncasecmp`): nur der Namensteil
 *  eines Option-Tokens wird kleingeschrieben, der Wert nach `=` bleibt. */
function lowerOption(tok: string): string {
  const eq = tok.indexOf("=");
  return eq < 0 ? tok.toLowerCase() : tok.slice(0, eq).toLowerCase() + tok.slice(eq);
}

/** Liest `nslookup [-type=A] <name> [10.96.0.10]`: den Namen oder die fertige Fehlerausgabe. */
function readNslookup(host: NetHost, t: string[]): { query: string } | string {
  const c = parseCall(host, NSLOOKUP_ARGS, t.map((tok, i) => (i > 0 && isFlagToken(tok) ? lowerOption(tok) : tok)), 1);
  if (typeof c === "string") return c;
  const [name, server, ...rest] = c.args;
  if (!name) {
    return host._err("nslookup: Welchen Namen soll ich auflösen?",
      "z.B. 'nslookup kasse' oder voll 'nslookup kasse.default.svc.cluster.local'.");
  }
  if (rest.length > 0) {
    return notSimulated(host, "mehr als zwei Argumente.", ["nslookup <name> [" + COREDNS + "]"]);
  }
  if (server !== undefined && server !== COREDNS) {
    return notSimulated(host, "der DNS-Server '" + server + "'.", ["nslookup <name> [" + COREDNS + "]"],
      "Im Cluster beantwortet CoreDNS (" + COREDNS + ") die Namen.");
  }
  return { query: name.replace(/\.$/, "") };      // optionalen abschließenden Punkt entfernen
}

/** nslookup [-type=A] <name> [10.96.0.10]: fragt CoreDNS (den Cluster-DNS-Server) nach der Adresse hinter
 *  einem Namen (#337). Löst die Service-Discovery-Formen `<svc>`, `<svc>.<ns>` und den
 *  vollen FQDN `<svc>.<ns>.svc.cluster.local` zur ClusterIP des Service auf; ein
 *  ExternalName-Service liefert stattdessen den CNAME auf seinen externen DNS-Namen.
 *  Ein headless Service (`clusterIP: None`, #1301) hat keine Service-IP: CoreDNS liefert
 *  die IPs der bereiten Pods dahinter, und `<pod>.<svc>` löst einen einzelnen StatefulSet-Pod auf.
 *  Die Namespace-Auflösung liegt in `resolveService` (sim/dns.ts): ein Name in einem anderen
 *  Namespace (`<svc>.<ns>`) ist NXDOMAIN; existiert der Service, nennt der Tipp `default`. */
export function nslookupCommand(host: NetHost, t: string[]): string {
  const read = readNslookup(host, t);
  if (typeof read === "string") return read;
  const { query } = read;
  const header = ["Server:\t\t" + COREDNS, "Address:\t" + COREDNS + "#53", ""];
  // Der eingebaute kubernetes-API-Service ist immer da und hat eine feste ClusterIP.
  const parsed = parseServiceName(query);
  if (parsed?.svc === "kubernetes" && parsed.ns === DEFAULT_NAMESPACE) {
    return header.concat(["Name:\t" + parsed.fqdn, "Address: " + KUBERNETES_SERVICE.clusterIP]).join("\n");
  }
  const ans = resolveService(host.services, query);
  if (!ans.ok) {
    const pod = podRecordAnswer(host, query);
    if (pod) return header.concat(pod).join("\n");
    return host._err(header.join("\n") + "\n** server can't find " + ans.fqdn + ": NXDOMAIN", ans.tip);
  }
  const { svc, fqdn, cname } = ans;
  if (cname) {
    // ExternalName hat KEINE ClusterIP: CoreDNS antwortet mit einem CNAME auf den externen Namen.
    return header.concat([
      fqdn + "\tcanonical name = " + cname.name + ".",
      "Name:\t" + cname.name,
      "Address: " + cname.ip,
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
function podRecordAnswer(host: NetHost, query: string): string[] | null {
  const [podName, ...rest] = query.split(".");
  const ans = resolveService(host.services, rest.join("."));
  if (!ans.ok || !isHeadlessService(ans.svc)) return null;
  host._reschedulePending();
  host._recheckReadiness();
  const pod = serviceBackends(host, ans.svc).find(b => b.owner === "StatefulSet" && b.ready && b.pod === podName);
  return pod?.ip ? ["Name:\t" + podName + "." + ans.fqdn, "Address: " + pod.ip] : null;
}

/** Zerlegt die curl-Adresse `[http(s)://]<host>[:port][/pfad]` in ihre Teile. Als eigener
 *  Parser gehalten, damit `curlCommand` unter dem Komplexitäts-Budget bleibt (#502). */
function parseCurlUrl(arg: string): { hostName: string; reqPort: string | null; defaultPort: string; path: string } {
  const defaultPort = /^https:\/\//.test(arg) ? "443" : "80";
  let rest = arg.replace(/^https?:\/\//, "");
  const slash = rest.indexOf("/");
  const path = slash >= 0 ? rest.slice(slash) : "/";
  if (slash >= 0) rest = rest.slice(0, slash);
  const colon = rest.indexOf(":");
  const reqPort = colon >= 0 ? rest.slice(colon + 1) : null;
  const hostName = colon >= 0 ? rest.slice(0, colon) : rest;
  return { hostName, reqPort, defaultPort, path };
}

/** Eine fertige curl-Antwort: Statuszeile + Header, dann der Body (wie `-i`). */
interface Reply { head: string[]; body: string }

/** curl auf einen ExternalName-Service: folgt dem CNAME auf den externen Dienst (#1338). Der Port ist
 *  der aus der URL, sonst der Schema-Default (80/443); der Service-Port spielt keine Rolle. */
function curlExternalName(
  hostName: string, cname: { name: string; ip: string }, url: ReturnType<typeof parseCurlUrl>,
): Reply {
  const port = url.reqPort || url.defaultPort;
  return {
    head: ["HTTP/1.1 200 OK", "server: " + cname.name, "content-type: text/plain"],
    body: hostName + " → " + cname.name + " (" + cname.ip + "): " + hostName + ":" + port + url.path,
  };
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

/** Der Dateiname im Arbeitsverzeichnis: ein führendes `./` fällt weg. */
const workName = (value: string): string => value.replace(/^\.\//, "");

/** `-o <datei>`: ein Dateiname im Arbeitsverzeichnis (ein führendes `./` fällt weg), `/dev/null` (verwirft die
 *  Antwort) oder `-` (stdout). Alles andere (Unterordner, leerer Wert) ist nicht simuliert. */
function checkOutput(host: ErrHost, value: string): string | null {
  const name = workName(value);
  if (value === "-" || value === "/dev/null" || (name !== "" && !name.includes("/"))) return null;
  return notSimulated(host, "'-o " + value + "'.", ["curl -o <datei> <adresse> (nur Dateien im Arbeitsverzeichnis, 'ls')", "-o /dev/null", "-o -"],
    "Schreib in eine Datei direkt im Arbeitsverzeichnis.");
}

/** curl-Flags. -s, -S, -v, -I, -i, -H, -X und -d werden angenommen, ändern aber nichts (Grenzen curl-antwort und
 *  curl-anfrage): jeder Dienst antwortet gleich. -o schreibt die Antwort in eine Datei. */
export const CURL_ARGS: ArgSpec = {
  cmd: "curl",
  flags: [
    flag(false, "-s", "--silent"), flag(false, "-S", "--show-error"), flag(false, "-v", "--verbose"),
    flag(false, "-I", "--head"), flag(false, "-i", "--include"),
    flag(true, "-H", "--header"), flag(true, "-X", "--request"), flag(true, "-d", "--data"),
    checkedFlag(checkOutput, "-o", "--output"),
  ],
  hints: {
    "-k": "TLS simuliert der Simulator nicht: https:// prüft nur Port 443.",
    "--insecure": "TLS simuliert der Simulator nicht: https:// prüft nur Port 443.",
    "-L": "Im Simulator gibt es keine Weiterleitungen.",
    "--location": "Im Simulator gibt es keine Weiterleitungen.",
    "-w": "Die Statuszeile zeigt curl ohnehin.",
    "--write-out": "Die Statuszeile zeigt curl ohnehin.",
  },
};

/** Die Fortschrittsanzeige, die curl bei `-o` auf dem Terminal zeigt (feste Werte für Geschwindigkeit und Zeit). */
function progress(bytes: number): string {
  const n = String(bytes).padStart(5);
  return [
    "  % Total    % Received % Xferd  Average Speed   Time    Time     Time  Current",
    "                                 Dload  Upload   Total   Spent    Left  Speed",
    "100 " + n + "  100 " + n + "    0     0   4333      0 --:--:-- --:--:-- --:--:--  4333",
  ].join("\n");
}

/** Gibt die Antwort aus oder schreibt sie bei `-o` (nur den Body, wie echt) in `host.files`. */
function deliver(host: NetHost, c: Call, r: Reply): string {
  const out = c.value("-o", "--output");
  if (out === null || out === "-") return r.head.concat(["", r.body]).join("\n");
  if (out !== "/dev/null") host.files[workName(out)] = r.body;
  return c.has("-s") ? "" : progress(r.body.length);
}

/** Beantwortet die Abfrage `[http(s)://]<service>[:port][/pfad]`: die Antwort oder die fertige Fehlerausgabe. */
function curlRequest(host: NetHost, arg: string): Reply | string {
  const url = parseCurlUrl(arg);
  const { hostName, reqPort, path, defaultPort } = url;

  const ans = resolveService(host.services, hostName);
  if (!ans.ok) return host._err("curl: (6) Could not resolve host: " + hostName, ans.tip);
  const { svc } = ans;
  // ExternalName ist DNS-Ebene (CNAME, kein Port-Mapping, keine Endpoints): vor Port- und Endpoint-Prüfung.
  if (ans.cname) return curlExternalName(hostName, ans.cname, url);
  const svcPort = String(svc.port);
  const port = reqPort || defaultPort;
  // 1) Falscher Port: der Service lauscht auf einem anderen als dem der URL (ohne Port: 80, bei https 443).
  if (port !== svcPort) {
    const https = !reqPort && defaultPort === "443" ? " https:// fragt Port 443 – nimm http:// oder den Port in der URL." : "";
    return host._err("curl: (7) Failed to connect to " + hostName + " port " + port + ": Connection refused",
      "Der Service '" + svc.name + "' lauscht auf Port " + svcPort + ", nicht auf " + port + ". Schau mit 'kubectl get services'." + https);
  }
  // 2) + 3) Keine bereiten Endpoints bzw. Port-Verdrahtung im Manifest falsch.
  const refused = refusedReason(host, svc);
  if (refused) {
    return host._err("curl: (7) Failed to connect to " + hostName + " port " + svcPort + ": Connection refused", refused);
  }
  // Erreichbar! Der eigene Dienst antwortet mit HTTP 200.
  return {
    head: ["HTTP/1.1 200 OK", "server: kubequest", "content-type: text/plain"],
    body: 'Ahoi! Dein Dienst "' + svc.name + '" läuft und ist über ' + hostName + ":" + svcPort + path + " erreichbar. ⚓",
  };
}

/** curl [Flags] [http(s)://]<service>[:port][/pfad]: fragt einen Service im Cluster ab und
 *  macht „läuft mein Dienst und ist er erreichbar?" greifbar (#164, Werft-Capstone).
 *  Rein lesend (außer `-o`, das die Antwort ins Arbeitsverzeichnis schreibt, #1510). Hier zahlen
 *  sich die Troubleshooting-Haken aus – jeder Fehlerfall endet in „Connection refused" mit einem Tipp:
 *   - Service kennt der DNS nicht                → (6) Could not resolve host
 *   - falscher Port in der URL (ohne Port: 80,   → (7) refused (nennt den echten Port)
 *     bei https:// 443)
 *   - keine bereiten Pods (ImagePull/CrashLoop/  → (7) refused (Verweis auf get pods/
 *     NotReady/Pending oder gar kein Deployment)    describe/endpoints)
 *   - targetPort ≠ containerPort (Manifest)      → (7) refused (Ports angleichen)
 *   - ExternalName-Service                       → folgt dem CNAME (200, keine Endpoints-Suche) */
export function curlCommand(host: NetHost, t: string[]): string {
  const c = parseCall(host, CURL_ARGS, t, 1);
  if (typeof c === "string") return c;
  if (c.args.length === 0) return host._err("curl: Welche Adresse soll ich abfragen?", "z.B. 'curl http://kasse' oder 'curl kasse:8080'.");
  if (c.args.length > 1) return notSimulated(host, "mehrere Adressen in einem Aufruf.", ["curl <adresse>"]);
  // Vor der Abfrage den Cluster nachführen (wie get/top): notready-Pods, die durch ein
  // inzwischen vorhandenes Secret bereit wurden, und nachgeschobene Nodes berücksichtigen.
  host._reschedulePending();
  host._recheckReadiness();
  const r = curlRequest(host, c.args[0]);
  return typeof r === "string" ? r : deliver(host, c, r);
}

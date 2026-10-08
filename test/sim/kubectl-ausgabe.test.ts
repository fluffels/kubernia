/* kubectl get -o wide und die Prüfung der Ausgabeformate (#1466), dazu der eingebaute Service `kubernetes`.
 *   (a) der Wert von -o wird clientseitig geprüft (bekannt, aber nicht simuliert / unbekannt / leer),
 *   (b) wide hängt die Zusatzspalten an (pods, deployments, replicasets, services, statefulsets, nodes), alle anderen Arten bleiben gleich,
 *   (c) wide mit -A, Komma-Liste, all und Namensfilter,
 *   (d) der Service `kubernetes`: get endpoints, describe, SELECTOR.
 * Tabellengetrieben, mit Negativfällen; die Sabotage-Nachweise (Red-Green) stehen im PR-Text. */
import { describe, test, expect } from "vitest";
import { KQSim } from "./helpers";
import { checkOutputFormat, OUTPUT_FORMATS } from "../../src/sim/kubectl/output";
import { GET_RENDERERS } from "../../src/sim/kubectl/inspect";
import { podIP } from "../../src/sim/util";
import { NODE_SYSTEM_INFO, NODE_VERSION } from "../../src/sim/nodes";
import { currentReplicaSet } from "../../src/sim/replicasets";
import { simGrenzen } from "../../src/hud/helptext";
import { KUBERNETES_SERVICE, isKubernetesService, serviceBackends, serviceSelector } from "../../src/sim/endpoints";
import type { ResourcePlural } from "../../src/sim/kubectl/resources";
import type { Scenario } from "../../src/sim/state";

const NICHT_SIMULIERT = "Nicht simuliert:";
const ERLAUBT = "custom-columns,custom-columns-file,go-template,go-template-file,json,jsonpath,jsonpath-as-json,jsonpath-file,kyaml,name,template,templatefile,wide,yaml";

function szenario(): Scenario {
  return {
    deployments: [{ name: "web", image: "nginx:1.27", replicas: 2 }, { name: "wartend", image: "nginx", replicas: 1, broken: { type: "pending" } }],
    services: [
      { name: "web", type: "ClusterIP", clusterIP: "10.96.0.7", port: 80 },
      { name: "bank", type: "ExternalName", clusterIP: "<none>", port: "", externalName: "api.bank.example.com" },
    ],
    statefulSets: [{ name: "db", image: "postgres:16", replicas: 2, serviceName: "db", volumeClaimName: "daten" }],
  };
}

const lauf = (cmd: string, sim: KQSim = new KQSim(szenario())) => {
  const r = sim.exec(cmd);
  return { out: r.output ?? "", error: r.error, sim };
};
/** Die Zeile zu einem Namen (erstes Wort), als Zellen an Mehrfach-Leerzeichen getrennt. */
const zeile = (out: string, name: string) => out.split("\n").find(l => l.startsWith(name + " "))?.trim().split(/\s{2,}/);
const kopf = (out: string) => out.split("\n")[0].trim().split(/\s{2,}/);

/* ---------- (a) die Wertprüfung ---------- */
describe("(a) -o: Formate werden wie in kubectl geprüft", () => {
  test.each([
    "json", "JSON", "kyaml", "name", "NAME", "jsonpath={.items[0].metadata.name}", "jsonpath", "jsonpath-as-json={.x}",
    "jsonpath-file=f", "go-template={{.x}}", "go-template-file=f", "template={{.x}}", "templatefile=f", "custom-columns=A:.x", "custom-columns-file=f",
  ])("-o %s → Nicht simuliert, mit Lernhinweis", fmt => {
    const r = lauf("kubectl get pods -o " + fmt);
    expect(r.error).toBe(true);
    expect(r.out).toContain(NICHT_SIMULIERT);
    expect(r.out).toContain("'-o " + fmt + "'");
    expect(r.out).toContain("-o wide");
    expect(r.out).toContain("-o yaml");
    expect(r.out).toContain("kubectl describe");
    expect(r.out).not.toContain("READY");
  });
  test.each([["foo", "foo"], ["WIDE", "WIDE"], ["Wide", "Wide"], ["jsonpathx", "jsonpathx"], ["jsonpath-x=1", "jsonpath-x=1"], ["yml", "yml"]])(
    "-o %s → der echte kubectl-Fehler mit der Liste der erlaubten Formate", (fmt, quoted) => {
      const r = lauf("kubectl get pods -o " + fmt);
      expect(r.error).toBe(true);
      expect(r.out).toContain('error: unable to match a printer suitable for the output format "' + quoted + '", allowed formats are: ' + ERLAUBT);
      expect(r.out).not.toContain(NICHT_SIMULIERT);
    });
  test("die Formatliste im Fehler ist sortiert und entspricht der Tabelle", () => {
    const namen = OUTPUT_FORMATS.map(f => f.name);
    expect(namen).toEqual([...namen].sort());
    expect(namen.join(",")).toBe(ERLAUBT);
  });
  test.each(["-o=", "--output="])("%s (leerer Wert) ist die normale Tabelle", flag => {
    const out = lauf("kubectl get pods " + flag).out;
    expect(kopf(out)).toEqual(["NAME", "READY", "STATUS", "RESTARTS", "AGE"]);
  });
  test.each(["-Ao wide", "-Aowide", "-Ao=wide"])("%s (Wert-Flag in einer Kette) wird gelesen, nicht still als normale Tabelle gedruckt", flag => {
    const r = lauf("kubectl get pods " + flag);
    expect(r.error).toBeFalsy();
    expect(r.out).toContain("NOMINATED NODE");
  });
  test("kubectl get pods -o json -w: der unbekannte Schalter wird zuerst gemeldet, nicht das Format", () => {
    const r = lauf("kubectl get pods -o json -w");
    expect(r.error).toBe(true);
    expect(r.out).toContain("das Flag '-w'");
  });
  test("-Ao json in einer Kette: das Format wird geprüft und abgelehnt", () => {
    const r = lauf("kubectl get pods -Ao json");
    expect(r.error).toBe(true);
    expect(r.out).toContain("Nicht simuliert");
  });
  test.each(["-o wide", "-o=wide", "-owide", "--output wide", "--output=wide"])("%s ist ein Flag mit Wert (wide, nicht ein Positionsargument)", flag => {
    const r = lauf("kubectl get pods " + flag);
    expect(r.error).toBeFalsy();
    expect(r.out).toContain("NOMINATED NODE");
  });
  test("-o wide vor dem Typ: get -o wide pods", () => {
    expect(lauf("kubectl get -o wide pods").out).toContain("READINESS GATES");
  });
  test("-o ohne Wert: fehlender Flag-Wert", () => {
    expect(lauf("kubectl get pods -o").out).toContain("flag needs an argument: 'o' in -o");
  });
  test("checkOutputFormat direkt: leer und wide sind gültig, nichts sonst", () => {
    const host = { _err: (m: string) => m };
    expect(checkOutputFormat(host, "")).toBeNull();
    expect(checkOutputFormat(host, "wide")).toBeNull();
    expect(checkOutputFormat(host, "yaml")).toBeNull();
    expect(checkOutputFormat(host, "YAML")).toBeNull();
    expect(checkOutputFormat(host, "json")).toContain(NICHT_SIMULIERT);
    expect(checkOutputFormat(host, "x")).toContain("unable to match");
  });
  test("die Prüfung greift VOR dem Control-Plane-Gate; -o wide läuft ins Gate", () => {
    const sim = new KQSim({ ...szenario(), controlPlane: { up: false } });
    expect(sim.exec("kubectl get pods -o json").output).toContain(NICHT_SIMULIERT);
    expect(sim.exec("kubectl get pods -o foo").output).toContain("unable to match a printer");
    expect(sim.exec("kubectl get pods -o wide").output).toContain("connection to the server");
  });
  test("bei anderen Unterbefehlen bleibt -o abgelehnt (mit dem neuen Hinweis)", () => {
    const r = lauf("kubectl describe pod x -o wide");
    expect(r.error).toBe(true);
    expect(r.out).toContain("'-o'");
    expect(r.out).toContain("nur bei 'kubectl get'");
  });
});

/* ---------- (b) die Zusatzspalten je Art ---------- */
describe("(b) wide: pods", () => {
  test("Kopf und Zeile: IP, NODE, NOMINATED NODE, READINESS GATES", () => {
    const sim = new KQSim(szenario());
    const out = lauf("kubectl get pods -o wide", sim).out;
    expect(kopf(out)).toEqual(["NAME", "READY", "STATUS", "RESTARTS", "AGE", "IP", "NODE", "NOMINATED NODE", "READINESS GATES"]);
    const name = sim.deployments[0].pods[0].name as string;
    const z = zeile(out, name)!;
    expect(z.slice(5)).toEqual([podIP(name), sim._nodeOf(sim.deployments[0]), "<none>", "<none>"]);
  });
  test("nicht eingeplant (Pending): IP und NODE sind <none>", () => {
    const sim = new KQSim(szenario());
    const name = sim.deployments[1].pods[0].name as string;
    expect(zeile(lauf("kubectl get pods -o wide", sim).out, name)!.slice(5)).toEqual(["<none>", "<none>", "<none>", "<none>"]);
  });
  test("StatefulSet-Pod: IP und Node aus der Platzierung, mit Pending-PVC <none>", () => {
    const bound = new KQSim(szenario());
    const pvc = bound.pvcs.find(v => v.name === "daten-db-1")!;
    pvc.storageClass = "gibt-es-nicht"; // sonst bindet der PV-Resync es vor dem Befehl nach
    pvc.status = "Pending";
    pvc.volume = "";
    const out = lauf("kubectl get pods -o wide", bound).out;
    const z0 = zeile(out, "db-0")!;
    const z1 = zeile(out, "db-1")!;
    expect(z0[5]).toBe(podIP("db-0"));
    expect(z0[6]).not.toBe("<none>");
    expect(z1.slice(5)).toEqual(["<none>", "<none>", "<none>", "<none>"]);
  });
  test("System-Pods: Static-Pods mit der Control-Plane-IP (hostNetwork), CoreDNS mit podIP, Node ahoi-control", () => {
    const out = lauf("kubectl get pods -n kube-system -o wide").out;
    for (const n of ["etcd-ahoi-control", "kube-apiserver-ahoi-control", "kube-scheduler-ahoi-control"]) {
      expect(zeile(out, n)!.slice(5), n).toEqual(["10.0.0.10", "ahoi-control", "<none>", "<none>"]);
    }
    const dns = zeile(out, "coredns-7db6d8ff4d-x2x9p")!;
    expect(dns.slice(5)).toEqual([podIP("coredns-7db6d8ff4d-x2x9p"), "ahoi-control", "<none>", "<none>"]);
    expect(dns[5]).not.toBe("10.0.0.10");
  });
  test("-A: NAMESPACE vorne, die wide-Spalten hinten (System- und eigene Pods)", () => {
    const out = lauf("kubectl get pods -A -o wide").out;
    expect(kopf(out)).toEqual(["NAMESPACE", "NAME", "READY", "STATUS", "RESTARTS", "AGE", "IP", "NODE", "NOMINATED NODE", "READINESS GATES"]);
    expect(zeile(out, "kube-system")!.at(-3)).toBe("ahoi-control");
    expect(out.split("\n").filter(l => l.startsWith("default ")).length).toBeGreaterThan(0);
  });
  test("Namensfilter: ein Pod, fehlende melden NotFound", () => {
    const sim = new KQSim(szenario());
    const name = sim.deployments[0].pods[0].name as string;
    const r = lauf("kubectl get pods " + name + " nix -o wide", sim);
    expect(r.out).toContain("NOMINATED NODE");
    expect(r.out).toContain('pods "nix" not found');
    expect(r.out.split("\n").filter(l => l.startsWith(name + " "))).toHaveLength(1);
  });
});

describe("(b) wide: deployments, services, statefulsets", () => {
  test("deployments: CONTAINERS IMAGES SELECTOR", () => {
    const out = lauf("kubectl get deploy -o wide").out;
    expect(kopf(out)).toEqual(["NAME", "READY", "UP-TO-DATE", "AVAILABLE", "AGE", "CONTAINERS", "IMAGES", "SELECTOR"]);
    expect(zeile(out, "web")!.slice(5)).toEqual(["web", "nginx:1.27", "app=web"]);
  });
  test("services: SELECTOR; kubernetes und ExternalName zeigen <none>", () => {
    const out = lauf("kubectl get svc -o wide").out;
    expect(kopf(out)).toEqual(["NAME", "TYPE", "CLUSTER-IP", "EXTERNAL-IP", "PORT(S)", "AGE", "SELECTOR"]);
    expect(zeile(out, "web")!.at(-1)).toBe("app=web");
    expect(zeile(out, "bank")!.at(-1)).toBe("<none>");
    expect(zeile(out, "kubernetes")!.at(-1)).toBe("<none>");
  });
  test("statefulsets: CONTAINERS IMAGES", () => {
    const out = lauf("kubectl get sts -o wide").out;
    expect(kopf(out)).toEqual(["NAME", "READY", "AGE", "CONTAINERS", "IMAGES"]);
    expect(zeile(out, "db")!.slice(3)).toEqual(["db", "postgres:16"]);
  });
});

/* ---------- (c) Regression und übrige Arten ---------- */
describe("(b) wide: replicasets und nodes (#1483)", () => {
  const hashIm = (out: string) => out.match(/pod-template-hash=(\w+)/)![1];
  test("replicasets: CONTAINERS IMAGES SELECTOR mit pod-template-hash", () => {
    const sim = new KQSim(szenario());
    const out = lauf("kubectl get rs -o wide", sim).out;
    expect(kopf(out)).toEqual(["NAME", "DESIRED", "CURRENT", "READY", "AGE", "CONTAINERS", "IMAGES", "SELECTOR"]);
    const rs = currentReplicaSet(sim.deployments.find(d => d.name === "web")!);
    expect(zeile(out, rs.name)!.slice(5)).toEqual(["web", "nginx:1.27", "app=web,pod-template-hash=" + rs.hash]);
  });
  test("der Hash im SELECTOR ist der im ReplicaSet- und im Pod-Namen und wechselt mit einem Rollout", () => {
    const sim = new KQSim(szenario());
    const vorher = hashIm(lauf("kubectl get rs -o wide", sim).out);
    expect(lauf("kubectl get pods", sim).out).toContain("web-" + vorher + "-");
    expect(lauf("kubectl get rs", sim).out).toContain("web-" + vorher);
    sim.exec("kubectl set image deployment/web web=nginx:1.28");
    expect(hashIm(lauf("kubectl get rs -o wide", sim).out)).not.toBe(vorher);
  });
  test("nodes: INTERNAL-IP EXTERNAL-IP OS-IMAGE KERNEL-VERSION CONTAINER-RUNTIME", () => {
    const out = lauf("kubectl get nodes -o wide").out;
    expect(kopf(out)).toEqual(["NAME", "STATUS", "ROLES", "AGE", "VERSION", "INTERNAL-IP", "EXTERNAL-IP", "OS-IMAGE", "KERNEL-VERSION", "CONTAINER-RUNTIME"]);
    const cp = zeile(out, "ahoi-control")!;
    expect(cp.slice(4)).toEqual([NODE_VERSION, "10.0.0.10", "<none>", NODE_SYSTEM_INFO.osImage, NODE_SYSTEM_INFO.kernelVersion, NODE_SYSTEM_INFO.containerRuntimeVersion]);
    expect(zeile(out, "ahoi-worker-1")!.slice(6)).toEqual(["<none>", NODE_SYSTEM_INFO.osImage, NODE_SYSTEM_INFO.kernelVersion, NODE_SYSTEM_INFO.containerRuntimeVersion]);
  });
  test("die CP-Adresse ist die des Endpoints kubernetes; Worker-IPs sind stabil über Sims und verschieden", () => {
    const sim = new KQSim(szenario());
    const ep = zeile(lauf("kubectl get endpoints", sim).out, "kubernetes")![1];
    expect(ep.split(":")[0]).toBe(zeile(lauf("kubectl get nodes -o wide", sim).out, "ahoi-control")![5]);
    const ip = (s: KQSim, n: string) => zeile(lauf("kubectl get nodes -o wide", s).out, n)![5];
    expect(ip(new KQSim(szenario()), "ahoi-worker-1")).toBe(ip(sim, "ahoi-worker-1"));
    expect(ip(sim, "ahoi-worker-1")).not.toBe(ip(sim, "ahoi-worker-2"));
  });
  test("DiskPressure bleibt in STATUS", () => {
    const sim = new KQSim(szenario());
    sim.nodes[1].ephemeralCapacityMi = 0;
    expect(zeile(lauf("kubectl get nodes -o wide", sim).out, "ahoi-worker-1")![1]).toBe("Ready,DiskPressure");
  });
  test("Bare-Metal: nach init und join hat der Worker eine IP, nach reset und neuem init/join dieselbe", () => {
    const sim = new KQSim({ bareMetal: true });
    const aufbau = () => { sim.exec("kubeadm init"); sim.exec("kubeadm join 10.0.0.10:6443 --token " + sim.controlPlane.token! + " --discovery-token-ca-cert-hash sha256:deadbeef"); };
    aufbau();
    const ip = zeile(lauf("kubectl get nodes -o wide", sim).out, "ahoi-worker-1")![5];
    expect(ip).toMatch(/^10\.0\./);
    sim.exec("kubeadm reset");
    aufbau();
    expect(zeile(lauf("kubectl get nodes -o wide", sim).out, "ahoi-worker-1")![5]).toBe(ip);
  });
  test("Hilfe: wide-auswahl nennt jede Art mit wide-Spalten", () => {
    const text = simGrenzen("kubectl").find(g => g.id === "wide-auswahl")!.text;
    for (const art of ["pods", "deployments", "replicasets", "services", "statefulsets", "nodes"]) expect(text).toContain(art);
  });
});

describe("(c) ohne wide bleibt jede Ausgabe wie zuvor; Arten ohne wide-Spalten ändern sich nicht", () => {
  const MIT_WIDE: ResourcePlural[] = ["pods", "deployments", "replicasets", "services", "statefulsets", "nodes"];
  const ohneZeit = (s?: string | null) => (s ?? "").replace(/\b\d+[smhd]\b/g, "T");   // jeder exec lässt die Uhr weiterlaufen
  const beide = (plural: string) => {
    const sim = new KQSim({ ...szenario(), secrets: [{ name: "s", keys: ["k"] }] });
    return { normal: ohneZeit(sim.exec("kubectl get " + plural).output), wide: ohneZeit(sim.exec("kubectl get " + plural + " -o wide").output) };
  };
  test.each([...GET_RENDERERS.keys()].filter(p => !MIT_WIDE.includes(p)))("%s: -o wide ist ohne wide-Spalten identisch zur normalen Tabelle", plural => {
    const { normal, wide } = beide(plural);
    expect(wide).toBe(normal);
  });
  test.each(MIT_WIDE)("%s: -o wide ist breiter als die normale Tabelle", plural => {
    const { normal, wide } = beide(plural);
    expect(wide).not.toBe(normal);
    expect(wide.split("\n")[0].length).toBeGreaterThan(normal.split("\n")[0].length);
  });
  test.each([
    ["pods", ["NAME", "READY", "STATUS", "RESTARTS", "AGE"]], ["deployments", ["NAME", "READY", "UP-TO-DATE", "AVAILABLE", "AGE"]],
    ["services", ["NAME", "TYPE", "CLUSTER-IP", "EXTERNAL-IP", "PORT(S)", "AGE"]], ["statefulsets", ["NAME", "READY", "AGE"]],
    ["replicasets", ["NAME", "DESIRED", "CURRENT", "READY", "AGE"]], ["nodes", ["NAME", "STATUS", "ROLES", "AGE", "VERSION"]],
  ])("ohne -o wide hat %s den bisherigen Kopf (keine wide-Spalte sickert durch)", (plural, header) => {
    expect(kopf(lauf("kubectl get " + plural).out)).toEqual(header);
  });
  test("-n kube-system und -A ohne wide: keine IP-Spalten", () => {
    expect(lauf("kubectl get pods -n kube-system").out).not.toContain("NOMINATED");
    expect(lauf("kubectl get pods -A").out).not.toContain("NOMINATED");
  });
});

describe("(c) wide mit Komma-Liste, all und Namensfilter", () => {
  test("get pods,svc -o wide: Präfix pod/ bzw. service/, je Block die eigenen Spalten", () => {
    const out = lauf("kubectl get pods,svc -o wide").out;
    expect(out).toContain("pod/web-");
    expect(out).toContain("service/web");
    expect(out).toContain("NOMINATED NODE");
    expect(out).toContain("SELECTOR");
  });
  test("get all -o wide: ReplicaSets mit CONTAINERS IMAGES SELECTOR", () => {
    const out = lauf("kubectl get all -o wide").out;
    const rs = out.split("\n\n").find(b => b.startsWith("NAME") && b.includes("replicaset.apps/"))!;
    expect(rs).toBeDefined();
    expect(kopf(rs)).toEqual(["NAME", "DESIRED", "CURRENT", "READY", "AGE", "CONTAINERS", "IMAGES", "SELECTOR"]);
    expect(out).toContain("IMAGES");
  });
  test("get svc web bank -o wide (Namensfilter) und get deploy web -o wide", () => {
    const out = lauf("kubectl get svc web -o wide").out;
    expect(zeile(out, "web")!.at(-1)).toBe("app=web");
    expect(out).not.toContain("bank");
    expect(zeile(lauf("kubectl get deploy web -o wide").out, "web")!.at(-1)).toBe("app=web");
  });
  test("get svc nix -o wide: NotFound, keine Tabelle", () => {
    const r = lauf("kubectl get svc nix -o wide");
    expect(r.error).toBe(true);
    expect(r.out).toContain('services "nix" not found');
  });
});

/* ---------- (d) der eingebaute Service kubernetes ---------- */
describe("(d) Service kubernetes: get endpoints, describe, Selektor", () => {
  test("get endpoints zeigt kubernetes mit der Control-Plane, auch ganz ohne Spieler-Services", () => {
    const out = lauf("kubectl get endpoints", new KQSim({})).out;
    expect(zeile(out, "kubernetes")!.slice(0, 2)).toEqual(["kubernetes", "10.0.0.10:6443"]);
  });
  test("describe svc kubernetes: Selector <none>, IP 10.96.0.1, TargetPort 6443/TCP, Endpoints 10.0.0.10:6443", () => {
    const r = lauf("kubectl describe svc kubernetes", new KQSim({}));
    expect(r.error).toBeFalsy();
    expect(r.out).toMatch(/^Selector:\s+<none>$/m);
    expect(r.out).toMatch(/^IP:\s+10\.96\.0\.1$/m);
    expect(r.out).toMatch(/^TargetPort:\s+6443\/TCP$/m);
    expect(r.out).toMatch(/^Endpoints:\s+10\.0\.0\.10:6443$/m);
  });
  test("describe svc ohne Namen beginnt mit kubernetes; das Präfix k findet ihn", () => {
    expect(lauf("kubectl describe svc").out.startsWith("Name:")).toBe(true);
    expect(lauf("kubectl describe svc").out).toMatch(/^Name:\s+kubernetes$/m);
    expect(lauf("kubectl describe svc k", new KQSim({})).out).toMatch(/^Name:\s+kubernetes$/m);
  });
  test("get svc zählt kubernetes genau einmal; describe svc nix bleibt NotFound", () => {
    expect(lauf("kubectl get svc", new KQSim({})).out.split("\n").filter(l => l.startsWith("kubernetes "))).toHaveLength(1);
    expect(lauf("kubectl describe svc nix").out).toContain('services "nix" not found');
  });
  test("NEGATIV: ein Deployment namens kubernetes gerät nicht hinter den Service (kein Pod-Endpoint)", () => {
    const sim = new KQSim({ deployments: [{ name: "kubernetes", image: "nginx", replicas: 2 }] });
    expect(zeile(lauf("kubectl get endpoints", sim).out, "kubernetes")![1]).toBe("10.0.0.10:6443");
    expect(lauf("kubectl describe svc kubernetes", sim).out).toMatch(/^Endpoints:\s+10\.0\.0\.10:6443$/m);
    expect(lauf("kubectl describe svc kubernetes", sim).out).toMatch(/^Selector:\s+<none>$/m);
  });
  test("NEGATIV: die Auflösung (curl, Scrape) findet hinter kubernetes keinen Pod, auch nicht den eines gleichnamigen Deployments", () => {
    const sim = new KQSim({ deployments: [{ name: "kubernetes", image: "nginx", replicas: 2 }] });
    expect(serviceBackends(sim, KUBERNETES_SERVICE)).toEqual([]);
    expect(serviceSelector(sim, KUBERNETES_SERVICE)).toBeNull();
  });
  test("ein Spieler-Service gleichen Namens ist NICHT der eingebaute (Identität, nicht Name)", () => {
    const sim = new KQSim({ deployments: [{ name: "kubernetes", image: "nginx", replicas: 1 }] });
    const eigener = { name: "kubernetes", type: "ClusterIP" as const, clusterIP: "10.96.9.9", port: 80 };
    expect(isKubernetesService(eigener)).toBe(false);
    expect(serviceBackends(sim, eigener)).toHaveLength(1);
  });
  test("der Service steht nie im Spielstand (host.services bleibt leer)", () => {
    const sim = new KQSim({});
    sim.exec("kubectl get svc");
    sim.exec("kubectl describe svc kubernetes");
    expect(sim.services).toEqual([]);
  });
  test("nslookup bleibt bei 10.96.0.1, kubeadm init nennt weiter den API-Server 10.0.0.10:6443", () => {
    expect(lauf("nslookup kubernetes.default.svc.cluster.local", new KQSim({})).out).toContain("10.96.0.1");
    const bare = new KQSim({ bareMetal: true });
    expect(bare.exec("kubeadm init").output).toContain("kubeadm join 10.0.0.10:6443");
  });
  test("der eingebaute Service ist 3d alt (get svc und get endpoints)", () => {
    expect(zeile(lauf("kubectl get svc", new KQSim({})).out, "kubernetes")![5]).toBe("3d");
    expect(zeile(lauf("kubectl get endpoints", new KQSim({})).out, "kubernetes")![2]).toBe("3d");
  });
});

describe("(d) Version: v1 Endpoints (#1483)", () => {
  test("get endpoints druckt keine Deprecation-Warnung, solange die Sim unter v1.33 bleibt", () => {
    expect(lauf("kubectl get endpoints", new KQSim({})).out).not.toMatch(/^Warning:/m);
  });
  test("WÄCHTER: ab v1.33 warnt der API-Server vor v1 Endpoints (KEP-4974); dann die Warnung nachbilden", () => {
    const minor = Number(NODE_VERSION.split(".")[1]);
    expect(minor, "NODE_VERSION " + NODE_VERSION + " ist >= v1.33: Warnung nachbilden (KEP-4974: 'Warning: v1 Endpoints is deprecated in v1.33+; use discovery.k8s.io/v1 EndpointSlice'), Matrixzeile get endpoints prüfen").toBeLessThan(33);
  });
});

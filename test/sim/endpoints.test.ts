/* Service→Pod-Auflösung (#1318): Endpoints, curl, nslookup und Prometheus-Targets lesen
 * dieselbe Backend-Funktion (src/sim/endpoints.ts). Alles über die öffentliche Sim-API. */
import { describe, test, expect } from "vitest";
import { KQSim } from "./helpers";
import { podIP } from "../../src/sim/util";
import { podAddress, serviceBackends, readyBackends, endpointPort } from "../../src/sim/endpoints";

const HEADLESS = "apiVersion: v1\nkind: Service\nmetadata:\n  name: speicher\nspec:\n  clusterIP: None\n  selector:\n    app: speicher\n  ports:\n    - port: 5432\n";
const NORMAL_STS = "apiVersion: v1\nkind: Service\nmetadata:\n  name: speicher\nspec:\n  ports:\n    - port: 5432\n";
const EXTERNAL = "apiVersion: v1\nkind: Service\nmetadata:\n  name: speicher\nspec:\n  type: ExternalName\n  externalName: db.example.com\n";
const sts = (extra: object = {}) => ({ name: "speicher", image: "postgres:16", replicas: 3, serviceName: "speicher", ...extra });
const ep = (sim: KQSim, name: string) => (sim.exec("kubectl get endpoints " + name).output || "").split("\n")[1] ?? "";

describe("kubectl get endpoints", () => {
  test("Deployment: podIP(pod.name):port je Pod", () => {
    const sim = new KQSim({
      deployments: [{ name: "kasse", image: "nginx", replicas: 2 }],
      services: [{ name: "kasse", type: "ClusterIP", clusterIP: "10.96.0.20", port: 80, targetPort: 8080 }],
    });
    const d = sim.deployments.find(x => x.name === "kasse")!;
    const row = ep(sim, "kasse");
    for (const p of d.pods) expect(row).toContain(podIP(p.name) + ":8080");
    expect(row).not.toContain("10.244.1.20:");
  });

  test("headless + StatefulSet: drei Pod-IPs (statt <none>)", () => {
    const sim = new KQSim({ statefulSets: [sts()], files: { "h.yaml": HEADLESS } });
    sim.exec("kubectl apply -f h.yaml");
    const row = ep(sim, "speicher");
    for (const i of [0, 1, 2]) expect(row).toContain(podIP("speicher-" + i) + ":5432");
    expect(row).not.toContain("<none>");
  });

  test("ClusterIP-Service vor einem StatefulSet führt die Pod-IPs", () => {
    const sim = new KQSim({ statefulSets: [sts()], files: { "n.yaml": NORMAL_STS } });
    sim.exec("kubectl apply -f n.yaml");
    expect(ep(sim, "speicher")).toContain(podIP("speicher-0") + ":5432");
  });

  test("StatefulSet mit Pending-PVC: <none>", () => {
    const sim = new KQSim({ statefulSets: [sts({ storageClass: "" })], files: { "h.yaml": HEADLESS } });
    sim.exec("kubectl apply -f h.yaml");
    expect(ep(sim, "speicher")).toContain("<none>");
  });

  test("Negativ: StatefulSet mit fremdem serviceName erscheint nicht", () => {
    const sim = new KQSim({ statefulSets: [sts({ serviceName: "anderer" })], files: { "h.yaml": HEADLESS } });
    sim.exec("kubectl apply -f h.yaml");
    expect(ep(sim, "speicher")).toContain("<none>");
  });

  test("Negativ: ExternalName neben gleichnamigem Deployment bleibt <none>", () => {
    const sim = new KQSim({ deployments: [{ name: "speicher", image: "nginx", replicas: 1 }], files: { "e.yaml": EXTERNAL } });
    sim.exec("kubectl apply -f e.yaml");
    expect(ep(sim, "speicher")).toContain("<none>");
  });

  test("Negativ: nicht bereites Deployment: <none>", () => {
    const sim = new KQSim({
      deployments: [{ name: "kasse", image: "nginx", replicas: 1, broken: { type: "crashloop", needsSecret: "key" } }],
      services: [{ name: "kasse", type: "ClusterIP", clusterIP: "10.96.0.20", port: 80 }],
    });
    expect(ep(sim, "kasse")).toContain("<none>");
  });

  test("Konsistenz: describe pod, get endpoints und nslookup nennen dieselbe Pod-IP", () => {
    const sim = new KQSim({ deployments: [{ name: "speicher", image: "nginx", replicas: 1 }], files: { "h.yaml": HEADLESS } });
    sim.exec("kubectl apply -f h.yaml");
    const pod = sim.deployments.find(d => d.name === "speicher")!.pods[0].name;
    const ip = podIP(pod);
    expect(sim.exec("kubectl describe pod " + pod).output).toContain("IP:           " + ip);
    expect(ep(sim, "speicher")).toContain(ip + ":5432");
    expect(sim.exec("nslookup speicher").output).toContain("Address: " + ip);
  });
});

describe("curl", () => {
  test("ClusterIP-Service vor einem StatefulSet ist erreichbar", () => {
    const sim = new KQSim({ statefulSets: [sts()], files: { "n.yaml": NORMAL_STS } });
    sim.exec("kubectl apply -f n.yaml");
    const r = sim.exec("curl speicher");
    expect(r.error).toBe(false);
    expect(r.output).toContain("200 OK");
  });

  test("StatefulSet mit Pending-PVC: refused, Pods nicht bereit", () => {
    const sim = new KQSim({ statefulSets: [sts({ storageClass: "" })], files: { "n.yaml": NORMAL_STS } });
    sim.exec("kubectl apply -f n.yaml");
    const r = sim.exec("curl speicher");
    expect(r.error).toBe(true);
    expect(r.output).toContain("nicht bereit");
  });

  test("Service ohne Backend: keine Endpoints", () => {
    const sim = new KQSim({ files: { "n.yaml": NORMAL_STS } });
    sim.exec("kubectl apply -f n.yaml");
    const r = sim.exec("curl speicher");
    expect(r.error).toBe(true);
    expect(r.output).toContain("keine Endpoints");
  });

  test("targetPort ≠ containerPort: refused", () => {
    const sim = new KQSim({
      deployments: [{ name: "kasse", image: "nginx", replicas: 1, containerPort: 80 }],
      services: [{ name: "kasse", type: "ClusterIP", clusterIP: "10.96.0.20", port: 80, targetPort: 8080 }],
    });
    const r = sim.exec("curl kasse");
    expect(r.error).toBe(true);
    expect(r.output).toContain("targetPort");
  });
});

describe("scrapeTargets", () => {
  const appTargets = (sim: KQSim) => sim.scrapeTargets().filter(t => t.job !== "kubelet");

  test("headless + StatefulSet: ein Target je Pod mit Pod-IP", () => {
    const sim = new KQSim({ statefulSets: [sts()], files: { "h.yaml": HEADLESS } });
    sim.exec("kubectl apply -f h.yaml");
    const t = appTargets(sim);
    expect(t.map(x => x.instance)).toStrictEqual([0, 1, 2].map(i => podIP("speicher-" + i) + ":5432"));
    expect(t.every(x => x.health === "up" && x.job === "speicher")).toBe(true);
  });

  test("Negativ: weder None: noch <none>: als Target; ExternalName ohne Target", () => {
    const sim = new KQSim({
      statefulSets: [sts()],
      services: [{ name: "extern", type: "ExternalName", clusterIP: "<none>", port: 80, externalName: "db.example.com" }],
      files: { "h.yaml": HEADLESS },
    });
    sim.exec("kubectl apply -f h.yaml");
    const t = appTargets(sim);
    expect(t.some(x => /^(None|<none>):/.test(x.instance))).toBe(false);
    expect(t.some(x => x.job === "extern")).toBe(false);
  });

  test("CrashLoop-Deployment: down-Target mit Pod-IP", () => {
    const sim = new KQSim({
      deployments: [{ name: "lager", image: "nginx", replicas: 1, broken: { type: "crashloop", needsSecret: "key" } }],
      services: [{ name: "lager", type: "ClusterIP", clusterIP: "10.96.0.21", port: 80 }],
    });
    const pod = sim.deployments[0].pods[0].name;
    expect(appTargets(sim)).toStrictEqual([{ job: "lager", instance: podIP(pod) + ":80", health: "down" }]);
  });

  test("Negativ: Deployment broken pending: kein Target; Service ohne Workload: kein Target", () => {
    const sim = new KQSim({
      deployments: [{ name: "lager", image: "nginx", replicas: 1, broken: { type: "pending" } }],
      services: [
        { name: "lager", type: "ClusterIP", clusterIP: "10.96.0.21", port: 80 },
        { name: "leer", type: "ClusterIP", clusterIP: "10.96.0.22", port: 80 },
      ],
    });
    expect(appTargets(sim)).toStrictEqual([]);
  });
});

describe("serviceBackends / podAddress (Einheit)", () => {
  test("Zweige: owner, ip null, containerPort, ExternalName leer", () => {
    const sim = new KQSim({
      deployments: [{ name: "a", image: "nginx", replicas: 1, containerPort: 9000 }, { name: "b", image: "nginx", replicas: 1, broken: { type: "pending" } }],
      statefulSets: [sts({ serviceName: "a" })],
      services: [
        { name: "a", type: "ClusterIP", clusterIP: "10.96.0.1", port: 80 },
        { name: "b", type: "ClusterIP", clusterIP: "10.96.0.2", port: 80, targetPort: 81 },
        { name: "x", type: "ExternalName", clusterIP: "<none>", port: 80, externalName: "e.com" },
      ],
    });
    const a = serviceBackends(sim, sim.services[0]);
    expect(a.map(b => b.owner)).toStrictEqual(["Deployment", "StatefulSet", "StatefulSet", "StatefulSet"]);
    expect(a[0].containerPort).toBe(9000);
    expect(a[1].containerPort).toBeUndefined();
    const b = serviceBackends(sim, sim.services[1]);
    expect(b[0].ip).toBeNull();
    expect(b[0].ready).toBe(false);
    expect(readyBackends(sim, sim.services[1])).toStrictEqual([]);
    expect(serviceBackends(sim, sim.services[2])).toStrictEqual([]);
    expect(endpointPort(sim.services[1])).toBe(81);
    expect(endpointPort(sim.services[0])).toBe(80);
    expect(podAddress({ broken: { type: "pending" } }, { name: "p" })).toBeNull();
    expect(podAddress({ broken: null }, { name: "p" })).toBe(podIP("p"));
  });
});

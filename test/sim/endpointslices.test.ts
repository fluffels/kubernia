/* kubectl get endpointslices (#1505): die EndpointSlice ist eine Sicht auf dieselben Backends wie
 * `get endpoints`, führt aber auch nicht bereite Pods. Alles über die öffentliche Sim-API. */
import { describe, test, expect } from "vitest";
import { KQSim } from "./helpers";
import { podIP, generatedName, K8S_ALPHANUMS } from "../../src/sim/util";
import { CONTROL_PLANE_IP } from "../../src/sim/nodes";
import { endpointSliceOf, serviceBackends } from "../../src/sim/endpoints";

const svc = (name: string, extra: object = {}) => ({ name, type: "ClusterIP" as const, clusterIP: "10.96.0.20", port: 80, ...extra });
const zeilen = (sim: KQSim, cmd = "kubectl get endpointslices") => (sim.exec(cmd).output || "").split("\n").filter(l => !l.startsWith("Warning:") && l.trim() !== "");
const spalten = (zeile: string) => zeile.trim().split(/\s{2,}/);
const ageVon = (zeile: string) => spalten(zeile)[4];
const zeileVon = (sim: KQSim, name: string) => zeilen(sim).find(l => l.startsWith(name + "-") || l.startsWith(name + " ")) ?? "";

describe("kubectl get endpointslices", () => {
  test("Kopfzeile und die eingebaute kubernetes-Slice auch ohne Spieler-Services", () => {
    const z = zeilen(new KQSim({}));
    expect(spalten(z[0])).toEqual(["NAME", "ADDRESSTYPE", "PORTS", "ENDPOINTS", "AGE"]);
    expect(spalten(z[1]).slice(0, 4)).toEqual(["kubernetes", "IPv4", "6443", CONTROL_PLANE_IP]);
  });

  test("Deployment: Name <service>-<5 Zeichen>, Port = targetPort, ENDPOINTS = Pod-IPs ohne Port", () => {
    const sim = new KQSim({ deployments: [{ name: "kasse", image: "nginx", replicas: 2 }], services: [svc("kasse", { targetPort: 8080 })] });
    const c = spalten(zeileVon(sim, "kasse"));
    expect(c[0]).toMatch(new RegExp("^kasse-[" + K8S_ALPHANUMS + "]{5}$"));
    expect(c[2]).toBe("8080");
    const ips = sim.deployments[0].pods.map(p => podIP(p.name));
    expect(c[3]).toBe(ips.join(","));
    expect(c[3]).not.toContain(":");
  });

  test("ohne targetPort gilt der Service-Port", () => {
    const sim = new KQSim({ deployments: [{ name: "kasse", image: "nginx", replicas: 1 }], services: [svc("kasse")] });
    expect(spalten(zeileVon(sim, "kasse"))[2]).toBe("80");
  });

  test("Kernfall: nicht bereiter Pod fehlt in get endpoints, steht aber in der Slice", () => {
    for (const type of ["crashloop", "imagepull"] as const) {
      const broken = type === "crashloop" ? { type, needsSecret: "key" } : { type };
      const sim = new KQSim({ deployments: [{ name: "kasse", image: "nginx", replicas: 1, broken }], services: [svc("kasse")] });
      expect(sim.exec("kubectl get endpoints kasse").output).toMatch(/^kasse\s+<none>\s/m);
      expect(spalten(zeileVon(sim, "kasse"))[3], type).toBe(podIP(sim.deployments[0].pods[0].name));
    }
  });

  test("pending (keine IP) und Service ohne Workload: Platzhalter <unset> <unset>", () => {
    const sim = new KQSim({ deployments: [{ name: "a", image: "nginx", replicas: 1, broken: { type: "pending" } }], services: [svc("a"), svc("leer")] });
    for (const n of ["a", "leer"]) expect(spalten(zeileVon(sim, n)).slice(2, 4), n).toEqual(["<unset>", "<unset>"]);
  });

  test("evictetes Deployment: kein Pod in der Slice", () => {
    const sim = new KQSim({ deployments: [{ name: "kasse", image: "nginx", replicas: 1, ephemeralLimit: 512, emptyDir: { data: "x", usedMi: 600 } }], services: [svc("kasse")] });
    expect(sim.deployments[0].evicted).toBeTruthy();
    expect(spalten(zeileVon(sim, "kasse")).slice(2, 4)).toEqual(["<unset>", "<unset>"]);
  });

  test("ExternalName bekommt keine Slice", () => {
    const sim = new KQSim({ services: [{ name: "extern", type: "ExternalName", clusterIP: "", port: 80, externalName: "db.example.com" } as never] });
    expect(zeilen(sim).some(l => l.startsWith("extern"))).toBe(false);
  });

  test("StatefulSet hinter Service: drei Pod-IPs", () => {
    const sim = new KQSim({ statefulSets: [{ name: "speicher", image: "postgres:16", replicas: 3, serviceName: "speicher" }], services: [svc("speicher", { port: 5432 })] });
    const ips = [0, 1, 2].map(i => podIP("speicher-" + i)).join(",");
    expect(spalten(zeileVon(sim, "speicher"))[3]).toBe(ips);
  });

  test("mehr als drei Endpunkte: a,b,c + 1 more...", () => {
    const sim = new KQSim({ deployments: [{ name: "kasse", image: "nginx", replicas: 4 }], services: [svc("kasse")] });
    const ips = sim.deployments[0].pods.map(p => podIP(p.name));
    expect(spalten(zeileVon(sim, "kasse"))[3]).toBe(ips.slice(0, 3).join(",") + " + 1 more...");
  });

  test("AGE: eingebaute Slice 3d, Spieler-Service wie get svc", () => {
    const sim = new KQSim({ services: [svc("kasse")] });
    sim.clock += 130;
    expect(ageVon(zeileVon(sim, "kubernetes"))).toBe("3d");
    const alterSvc = spalten(sim.exec("kubectl get svc").output!.split(String.fromCharCode(10)).find(l => l.startsWith("kasse "))!)[5];
    expect(alterSvc).not.toBe("3d");
    expect(ageVon(zeileVon(sim, "kasse"))).toBe(alterSvc);
  });

  test("Name stabil über Aufrufe und Instanzen, je Service verschieden", () => {
    const cfg = { services: [svc("a"), svc("b")] };
    const sim = new KQSim(cfg);
    const name = (s: KQSim, n: string) => spalten(zeileVon(s, n))[0];
    expect(name(sim, "a")).toBe(name(sim, "a"));
    expect(name(new KQSim(cfg), "a")).toBe(name(sim, "a"));
    expect(name(sim, "a").slice(2)).not.toBe(name(sim, "b").slice(2));
  });

  test("NotFound, voller Name und Singular", () => {
    const sim = new KQSim({ services: [svc("kasse")] });
    const r = sim.exec("kubectl get endpointslices kasse");
    expect(r.error).toBe(true);
    expect(r.output).toMatch(/^Error from server \(NotFound\): endpointslices\.discovery\.k8s\.io "kasse" not found$/m);
    const name = spalten(zeileVon(sim, "kasse"))[0];
    for (const t of ["endpointslices.discovery.k8s.io", "endpointslice"]) expect(spalten(zeilen(sim, `kubectl get ${t} ${name}`)[1])[0], t).toBe(name);
  });

  test("Warnungen: get endpointslices ohne, get ep,endpointslices genau eine, mit Präfix", () => {
    const sim = new KQSim({ services: [svc("kasse")] });
    expect(sim.exec("kubectl get endpointslices").output).not.toContain("Warning:");
    const out = sim.exec("kubectl get ep,endpointslices").output || "";
    expect(out.split("\n").filter(l => l.startsWith("Warning:"))).toHaveLength(1);
    expect(out).toMatch(/^endpointslice\.discovery\.k8s\.io\//m);
  });

  test("fremder Namespace: leer", () => {
    expect(new KQSim({ services: [svc("kasse")] }).exec("kubectl get endpointslices -n anderer-ns").output).toMatch(/^No resources found in anderer-ns namespace\.$/m);
  });

  test("-o yaml ist ehrlich nicht simuliert", () => {
    const sim = new KQSim({ services: [svc("kasse")] });
    const name = spalten(zeileVon(sim, "kasse"))[0];
    expect(sim.exec(`kubectl get endpointslices ${name} -o yaml`).output).toMatch(/nicht simuliert/i);
  });
});

describe("generatedName", () => {
  test("Basis plus 5 Zeichen aus dem K8s-Alphabet, deterministisch, seed-abhängig", () => {
    const n = generatedName("kasse-", "x");
    expect(n).toMatch(new RegExp("^kasse-[" + K8S_ALPHANUMS + "]{5}$"));
    expect(generatedName("kasse-", "x")).toBe(n);
    expect(generatedName("kasse-", "y")).not.toBe(n);
  });
  test("Basis wird auf 58 Zeichen gekürzt (Gesamtlänge höchstens 63)", () => {
    const n = generatedName("a".repeat(63) + "-", "x");
    expect(n).toHaveLength(63);
    expect(n.startsWith("a".repeat(58))).toBe(true);
  });
});

describe("endpointSliceOf: ready und terminal (#1538)", () => {
  test("endpoints[].ready: Crashloop false, gesund true", () => {
    const krank = new KQSim({ deployments: [{ name: "kasse", image: "nginx", replicas: 1, broken: { type: "crashloop", needsSecret: "key" } }], services: [svc("kasse")] });
    expect(endpointSliceOf(krank, krank.services[0])!.endpoints.map(e => e.ready)).toEqual([false]);
    const gesund = new KQSim({ deployments: [{ name: "kasse", image: "nginx", replicas: 2 }], services: [svc("kasse")] });
    expect(endpointSliceOf(gesund, gesund.services[0])!.endpoints.map(e => e.ready)).toEqual([true, true]);
  });

  test("serviceBackends: terminal nur für evictetes Deployment, nie für gesund oder StatefulSet", () => {
    const evict = new KQSim({ deployments: [{ name: "kasse", image: "nginx", replicas: 1, ephemeralLimit: 512, emptyDir: { data: "x", usedMi: 600 } }], services: [svc("kasse")] });
    expect(serviceBackends(evict, evict.services[0]).map(b => b.terminal)).toEqual([true]);
    const ok = new KQSim({ deployments: [{ name: "kasse", image: "nginx", replicas: 1 }], statefulSets: [{ name: "x", image: "postgres:16", replicas: 2, serviceName: "kasse" }], services: [svc("kasse")] });
    expect(serviceBackends(ok, ok.services[0]).map(b => b.terminal)).toEqual([false, false, false]);
  });
});

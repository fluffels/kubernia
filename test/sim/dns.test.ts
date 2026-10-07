/* DNS / Service-Discovery im Simulator (#337): der `nslookup`-Befehl löst Cluster-DNS-Namen
 * auf (Service-Discovery via <svc>.<ns>.svc.cluster.local) und ExternalName-Services (CNAME
 * auf einen externen DNS-Namen). CoreDNS ist der Resolver. Teilt sich den frischen Sim mit
 * den übrigen sim-Modul-Tests (test/sim/helpers.ts). */
import { describe, test, beforeEach, expect } from "vitest";
import { KQSim, freshSim } from "./helpers";
import { podIP } from "../../src/sim/util";

const COREDNS = "10.96.0.10";

describe("nslookup – Service-Discovery", () => {
  let sim: KQSim;
  beforeEach(() => {
    sim = new KQSim({ services: [{ name: "kasse", type: "ClusterIP", clusterIP: "10.96.0.50", port: 80 }] });
  });

  test("löst einen ClusterIP-Service auf seine ClusterIP auf (mit CoreDNS-Server + FQDN)", () => {
    const r = sim.exec("nslookup kasse");
    expect(r.error).toBe(false);
    expect(r.output).toContain("Server:");
    expect(r.output).toContain(COREDNS);
    expect(r.output).toContain("kasse.default.svc.cluster.local");
    expect(r.output).toContain("10.96.0.50");
  });

  test("kurzer Name, <svc>.<ns> und voller FQDN lösen identisch auf", () => {
    const ip = "10.96.0.50";
    for (const name of ["kasse", "kasse.default", "kasse.default.svc.cluster.local", "kasse.default.svc.cluster.local."]) {
      const r = sim.exec("nslookup " + name);
      expect(r.error, name).toBe(false);
      expect(r.output, name).toContain(ip);
      expect(r.output, name).toContain("kasse.default.svc.cluster.local");
    }
  });

  test("der eingebaute kubernetes-API-Service löst auf 10.96.0.1 auf", () => {
    const r = sim.exec("nslookup kubernetes");
    expect(r.error).toBe(false);
    expect(r.output).toContain("10.96.0.1");
  });

  test("ein unbekannter Name ergibt NXDOMAIN und gilt als Fehler", () => {
    const r = sim.exec("nslookup gibt-es-nicht");
    expect(r.error).toBe(true);
    expect(r.output).toContain("NXDOMAIN");
  });

  test("ohne Argument: hilfreiche Fehlermeldung", () => {
    const r = sim.exec("nslookup");
    expect(r.error).toBe(true);
  });
});

describe("ExternalName-Service – CNAME auf externen Namen", () => {
  let sim: KQSim;
  beforeEach(() => {
    sim = new KQSim({
      files: { "externalname.yaml": "apiVersion: v1\nkind: Service\nmetadata:\n  name: bank-extern\nspec:\n  type: ExternalName\n  externalName: api.bank.example.com" },
    });
  });

  test("apply legt einen ExternalName-Service an (kein ClusterIP)", () => {
    const r = sim.exec("kubectl apply -f externalname.yaml");
    expect(r.error).toBe(false);
    expect(r.output).toContain("service/bank-extern created");
    const svc = sim.services.find(s => s.name === "bank-extern");
    expect(svc).toBeDefined();
    expect(svc!.type).toBe("ExternalName");
    expect(svc!.externalName).toBe("api.bank.example.com");
  });

  test("kubectl get services zeigt ExternalName mit externem Namen statt ClusterIP", () => {
    sim.exec("kubectl apply -f externalname.yaml");
    const out = sim.exec("kubectl get services").output || "";
    expect(out).toContain("bank-extern");
    expect(out).toContain("ExternalName");
    expect(out).toContain("api.bank.example.com");
  });

  test("nslookup zeigt den CNAME auf den externen DNS-Namen (kein Sim-Fehler)", () => {
    sim.exec("kubectl apply -f externalname.yaml");
    const r = sim.exec("nslookup bank-extern");
    expect(r.error).toBe(false);
    expect(r.output).toContain("canonical name");
    expect(r.output).toContain("api.bank.example.com");
  });
});

describe("nslookup – greift nicht in den Cluster ein (rein lesend)", () => {
  test("verändert den Service-Bestand nicht", () => {
    const sim = freshSim();
    sim.exec("kubectl create deployment kasse --image=nginx");
    sim.exec("kubectl expose deployment kasse --port=80");
    const before = sim.services.length;
    sim.exec("nslookup kasse");
    expect(sim.services.length).toBe(before);
  });
});

describe("Headless Service (#1301)", () => {
  const HEADLESS = "apiVersion: v1\nkind: Service\nmetadata:\n  name: speicher\nspec:\n  clusterIP: None\n  selector:\n    app: speicher\n  ports:\n    - port: 5432\n";
  const NORMAL = "apiVersion: v1\nkind: Service\nmetadata:\n  name: kasse\nspec:\n  ports:\n    - port: 80\n";
  const sts = (extra: object = {}) => ({ name: "speicher", image: "postgres:16", replicas: 3, serviceName: "speicher", ...extra });
  const podIps = (o: string) => [...o.matchAll(/^Address: (10\.244\.\S+)$/gm)].map(m => m[1]);

  function withSts(extra: object = {}): KQSim {
    const sim = new KQSim({ statefulSets: [sts(extra)], files: { "headless.yaml": HEADLESS, "normal.yaml": NORMAL } });
    expect(sim.exec("kubectl apply -f headless.yaml").error).toBe(false);
    return sim;
  }

  test("AK1: get svc zeigt None als CLUSTER-IP (aus echtem YAML, ohne applyEffects)", () => {
    const sim = withSts();
    const row = (sim.exec("kubectl get svc").output || "").split("\n").find(l => l.startsWith("speicher"))!;
    expect(row).toMatch(/^speicher\s+ClusterIP\s+None\s+<none>\s+5432\/TCP/);
    expect(sim.services.find(s => s.name === "speicher")!.clusterIP).toBe("None");
  });

  test("Negativ: ein normaler Service behält seine abgeleitete 10.96.x.y-ClusterIP", () => {
    const sim = withSts();
    sim.exec("kubectl apply -f normal.yaml");
    const row = (sim.exec("kubectl get svc").output || "").split("\n").find(l => l.startsWith("kasse"))!;
    expect(row).toMatch(/^kasse\s+ClusterIP\s+10\.96\.\d+\.\d+\s/);
    expect(row).not.toContain("None");
  });

  test("AK2: nslookup liefert die Pod-IPs des StatefulSets statt einer Service-IP", () => {
    const sim = withSts();
    const r = sim.exec("nslookup speicher");
    expect(r.error).toBe(false);
    const expected = [0, 1, 2].map(i => podIP("speicher-" + i));
    expect(podIps(r.output || "")).toStrictEqual(expected);
    expect(r.output).not.toMatch(/^Address: 10.96./m); // der Kopf nennt nur CoreDNS (Tab, nicht Leerzeichen)
    expect(r.output).toContain("speicher.default.svc.cluster.local");
  });

  test("headless Service vor einem Deployment gleichen Namens liefert dessen Pod-IPs", () => {
    const sim = freshSim();
    sim.exec("kubectl create deployment web --image=nginx --replicas=2");
    sim.mergeScenario({ files: { "w.yaml": HEADLESS.replace(/speicher/g, "web") } });
    sim.exec("kubectl apply -f w.yaml");
    const dep = sim.deployments.find(d => d.name === "web")!;
    const r = sim.exec("nslookup web");
    expect(r.error).toBe(false);
    expect(podIps(r.output || "")).toStrictEqual(dep.pods.map(p => podIP(p.name)));
    expect(dep.pods.length).toBeGreaterThan(0);
  });

  test("ohne bereiten Pod (PVCs Pending) und ohne Backend: NXDOMAIN-Fehler", () => {
    const pending = withSts({ storageClass: "" });
    const r = pending.exec("nslookup speicher");
    expect(r.error).toBe(true);
    expect(r.output).toContain("NXDOMAIN");
    const lonely = freshSim();
    lonely.mergeScenario({ files: { "h.yaml": HEADLESS } });
    lonely.exec("kubectl apply -f h.yaml");
    expect(lonely.exec("nslookup speicher").error).toBe(true);
  });

  test("Negativ: ein normaler ClusterIP-Service mit StatefulSet liefert weiter seine ClusterIP", () => {
    const sim = new KQSim({ statefulSets: [sts({ serviceName: "kasse", name: "kasse" })], files: { "normal.yaml": NORMAL } });
    sim.exec("kubectl apply -f normal.yaml");
    const ip = sim.services.find(s => s.name === "kasse")!.clusterIP;
    const r = sim.exec("nslookup kasse");
    expect(r.error).toBe(false);
    expect(r.output).toContain("Address: " + ip);
    expect(podIps(r.output || "")).toStrictEqual([]);
  });

  test("Pro-Pod-DNS: <pod>.<svc> und voller FQDN lösen auf die Pod-IP auf", () => {
    const sim = withSts();
    for (const name of ["speicher-0.speicher", "speicher-0.speicher.default.svc.cluster.local"]) {
      const r = sim.exec("nslookup " + name);
      expect(r.error, name).toBe(false);
      expect(r.output, name).toContain("Address: " + podIP("speicher-0"));
      expect(r.output, name).toContain("speicher-0.speicher.default.svc.cluster.local");
    }
    expect(sim.exec("nslookup speicher-2.speicher").output).toContain("Address: " + podIP("speicher-2"));
  });

  test("Pro-Pod-DNS: unbekanntes Ordinal, nicht-headless Service und Pending-Pod sind NXDOMAIN", () => {
    const sim = withSts();
    expect(sim.exec("nslookup speicher-7.speicher").error).toBe(true);
    const normal = new KQSim({ statefulSets: [sts({ serviceName: "kasse", name: "kasse" })], files: { "normal.yaml": NORMAL } });
    normal.exec("kubectl apply -f normal.yaml");
    const r = normal.exec("nslookup kasse-0.kasse");
    expect(r.error).toBe(true);
    expect(r.output).toContain("NXDOMAIN");
    expect(withSts({ storageClass: "" }).exec("nslookup speicher-0.speicher").error).toBe(true);
  });

  test("Negativ: ein StatefulSet mit anderem serviceName erscheint weder in der Service- noch in der Pod-Antwort", () => {
    const sim = new KQSim({
      statefulSets: [sts(), sts({ name: "fremd", serviceName: "anderer", replicas: 2 })],
      files: { "headless.yaml": HEADLESS },
    });
    sim.exec("kubectl apply -f headless.yaml");
    const r = sim.exec("nslookup speicher");
    expect(podIps(r.output || "")).toStrictEqual([0, 1, 2].map(i => podIP("speicher-" + i)));
    expect(r.output).not.toContain(podIP("fremd-0"));
    expect(sim.exec("nslookup fremd-0.speicher").error).toBe(true);
  });

  test("Ein nicht bereites Deployment hinter dem headless Service liefert keine Pod-IPs (NXDOMAIN)", () => {
    const sim = new KQSim({ deployments: [{ name: "speicher", image: "nginx", replicas: 1, broken: { type: "pending" } }], files: { "headless.yaml": HEADLESS } });
    sim.exec("kubectl apply -f headless.yaml");
    const r = sim.exec("nslookup speicher");
    expect(r.error).toBe(true);
    expect(r.output).toContain("NXDOMAIN");
  });
});

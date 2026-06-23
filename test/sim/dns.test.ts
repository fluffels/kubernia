/* DNS / Service-Discovery im Simulator (#337): der `nslookup`-Befehl löst Cluster-DNS-Namen
 * auf (Service-Discovery via <svc>.<ns>.svc.cluster.local) und ExternalName-Services (CNAME
 * auf einen externen DNS-Namen). CoreDNS ist der Resolver. Teilt sich den frischen Sim mit
 * den übrigen sim-Modul-Tests (test/sim/helpers.ts). */
import { describe, test, beforeEach, expect } from "vitest";
import { KQSim, freshSim } from "./helpers";

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
      files: { "externalname.yaml": "kind: Service\nmetadata:\n  name: bank-extern\nspec:\n  type: ExternalName\n  externalName: api.bank.example.com" },
      applyEffects: { "externalname.yaml": { service: { name: "bank-extern", externalName: "api.bank.example.com", port: "" } } },
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

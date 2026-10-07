/* Reine DNS-Auflösung des Simulators (#1403): Prädikat, externalIP, Namens-Parser, Resolver. */
import { describe, test, expect } from "vitest";
import { allocatesNodePort, isExternalNameService, type ServiceRes } from "../../src/sim/state";
import { externalIP } from "../../src/sim/util";
import { parseServiceName, resolveService } from "../../src/sim/dns";

const kasse: ServiceRes = { name: "kasse", type: "ClusterIP", clusterIP: "10.96.0.50", port: 80 };
const bank: ServiceRes = { name: "bank", type: "ExternalName", clusterIP: "<none>", port: "", externalName: "api.bank.example.com" };
const kaputt: ServiceRes = { name: "kaputt", type: "ExternalName", clusterIP: "<none>", port: "" };
const services = [kasse, bank, kaputt];

describe("isExternalNameService", () => {
  test("nur der exakte Typ ExternalName", () => {
    expect(isExternalNameService({ type: "ExternalName" })).toBe(true);
    expect(isExternalNameService({ type: "ClusterIP" })).toBe(false);
    expect(isExternalNameService({ type: "externalname" })).toBe(false);
    expect(isExternalNameService({})).toBe(false);
  });
});

describe("resolveService: Fallback-FQDN", () => {
  test("unlesbarer Name: ok false, FQDN ohne Schlusspunkt", () => {
    const a = resolveService(services, "kasse.default.foo.");
    expect(a.ok).toBe(false);
    expect(a.fqdn).toBe("kasse.default.foo");
  });
});

describe("allocatesNodePort", () => {
  test("nur LoadBalancer und NodePort", () => {
    expect(allocatesNodePort({ type: "LoadBalancer" })).toBe(true);
    expect(allocatesNodePort({ type: "NodePort" })).toBe(true);
    expect(allocatesNodePort({ type: "ClusterIP" })).toBe(false);
    expect(allocatesNodePort({ type: "ExternalName" })).toBe(false);
    expect(allocatesNodePort({ type: "nodeport" })).toBe(false);
    expect(allocatesNodePort({})).toBe(false);
  });
});

describe("externalIP", () => {
  test("stabil je Name, verschieden je Ziel, nie die Ingress-Adresse .10", () => {
    expect(externalIP("api.bank.example.com")).toBe(externalIP("api.bank.example.com"));
    expect(externalIP("api.bank.example.com")).not.toBe(externalIP("api.post.example.com"));
    for (let i = 0; i < 500; i++) {
      const m = /^203\.0\.113\.(\d+)$/.exec(externalIP("host" + i + ".example.com"));
      expect(m).not.toBeNull();
      const last = Number(m![1]);
      expect(last).toBeGreaterThanOrEqual(100);
      expect(last).toBeLessThanOrEqual(249);
    }
  });
});

describe("parseServiceName", () => {
  test.each([
    "kasse", "kasse.", "kasse.default", "kasse.default.svc", "kasse.default.svc.cluster.local", "kasse.default.svc.cluster.local.",
  ])("gültige Form %s", q => {
    expect(parseServiceName(q)).toEqual({ svc: "kasse", ns: "default", fqdn: "kasse.default.svc.cluster.local" });
  });
  test("anderer Namespace bleibt erhalten", () => {
    expect(parseServiceName("kasse.anderer-ns")?.ns).toBe("anderer-ns");
  });
  test.each(["kasse.default.foo", "kasse.default.svc.cluster", "kasse..default", "", "kasse.default.svc.cluster.local.x"])(
    "ungültige Endung/Labels %j → null", q => {
      expect(parseServiceName(q)).toBeNull();
    });
});

describe("resolveService", () => {
  test("ClusterIP-Service in default", () => {
    const r = resolveService(services, "kasse.default.svc");
    expect(r).toMatchObject({ ok: true, svc: kasse, fqdn: "kasse.default.svc.cluster.local" });
    expect(r.ok && r.cname).toBeUndefined();
  });
  test("ExternalName liefert normalisierten CNAME samt eigener IP", () => {
    const r = resolveService([{ ...bank, externalName: "api.bank.example.com." }], "bank");
    expect(r.ok && r.cname).toEqual({ name: "api.bank.example.com", ip: externalIP("api.bank.example.com") });
  });
  test("ExternalName ohne Ziel scheitert mit spec.externalName-Tipp", () => {
    const r = resolveService(services, "kaputt");
    expect(r.ok).toBe(false);
    expect(!r.ok && r.tip).toContain("spec.externalName");
  });
  test("falscher Namespace: FQDN nennt ihn, Tipp verweist auf default", () => {
    for (const q of ["kasse.anderer-ns", "kasse.anderer-ns.svc.cluster.local", "bank.anderer-ns"]) {
      const r = resolveService(services, q);
      expect(r.ok, q).toBe(false);
      expect(r.fqdn).toContain("anderer-ns");
      expect(!r.ok && r.tip).toContain("'default'");
    }
  });
  test("unbekannter Name und kaputte Endung → allgemeiner Tipp", () => {
    for (const q of ["gibtsnicht", "kasse.default.foo"]) {
      const r = resolveService(services, q);
      expect(r.ok, q).toBe(false);
      expect(!r.ok && r.tip).toContain("kubectl get services");
    }
  });
});

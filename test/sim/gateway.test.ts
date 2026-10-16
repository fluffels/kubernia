/* Gateway API Teil 1 (#1664): der abgeleitete Status (pure Funktionen in sim/gateway.ts) und der Mapper für
 * `gateway.networking.k8s.io/v1` GatewayClass und Gateway (über die öffentliche `effectsFromManifest`). */
import { describe, test, expect } from "vitest";
import {
  SIM_GATEWAY_CONTROLLER, gatewayAddress, gatewayClassConditions, gatewayStatus, listenerConditions, tlsRuleViolation,
  type GatewayClassRes, type GatewayListener, type GatewayRes, type GatewayStatusEnv,
} from "../../src/sim/gateway";
import { effectsFromManifest, type ManifestFailure } from "../../src/sim/manifest/registry";
import type { ApplyEffect } from "../../src/sim/state";

const klasse = (extra: Partial<GatewayClassRes> = {}): GatewayClassRes => ({ name: "envoy", controllerName: SIM_GATEWAY_CONTROLLER, ...extra });
const tor = (extra: Partial<GatewayRes> = {}): GatewayRes => ({ name: "tor", className: "envoy", listeners: [{ name: "http", port: 80, protocol: "HTTP" }], ...extra });
const env = (extra: Partial<GatewayStatusEnv> = {}): GatewayStatusEnv => ({ gatewayClasses: [klasse()], secrets: [], httpRoutes: [], ...extra });
const https = (extra: Partial<GatewayListener> = {}): GatewayListener => ({ name: "https", port: 443, protocol: "HTTPS", tlsSecret: "tls", ...extra });

describe("Status der GatewayClass", () => {
  test("der simulierte Controller nimmt die Klasse an", () => {
    expect(gatewayClassConditions(klasse())).toEqual([{ type: "Accepted", status: "True", reason: "Accepted", message: "Valid GatewayClass" }]);
  });
  test("ein fremder Controller bleibt Unknown / Pending", () => {
    const [c] = gatewayClassConditions(klasse({ controllerName: "example.com/anderer" }));
    expect(c).toMatchObject({ type: "Accepted", status: "Unknown", reason: "Pending" });
  });
});

describe("Status des Gateways", () => {
  test("mit akzeptierter Klasse: Accepted und Programmed True, Adresse im TEST-NET-3", () => {
    const st = gatewayStatus(tor(), env());
    expect(st.listeners).not.toBeNull();
    expect(st.conditions.map(c => c.type + "=" + c.status + "/" + c.reason)).toEqual(["Accepted=True/Accepted", "Programmed=True/Programmed"]);
    expect(st.address).toBe(gatewayAddress("tor"));
  });
  test("unbekannte Klasse: Unknown / Pending, keine Adresse", () => {
    const st = gatewayStatus(tor(), env({ gatewayClasses: [] }));
    expect(st.listeners).toBeNull();
    expect(st.address).toBeNull();
    expect(st.conditions.map(c => c.status + "/" + c.reason)).toEqual(["Unknown/Pending", "Unknown/Pending"]);
  });
  test("Klasse mit fremdem Controller zählt wie nicht akzeptiert", () => {
    const st = gatewayStatus(tor(), env({ gatewayClasses: [klasse({ controllerName: "example.com/anderer" })] }));
    expect(st.listeners).toBeNull();
    expect(st.address).toBeNull();
  });
  test("Eigenschaft: die Adresse ist stabil und liegt für jeden Namen in .20 bis .99", () => {
    for (let i = 0; i < 200; i++) {
      const name = "gw-" + i;
      const a = gatewayAddress(name);
      expect(a).toBe(gatewayAddress(name));
      expect(a).toMatch(/^203\.0\.113\.\d+$/);
      const last = Number(a.split(".")[3]);
      expect(last, name).toBeGreaterThanOrEqual(20);
      expect(last, name).toBeLessThanOrEqual(99);
    }
  });
});

describe("tlsRuleViolation (die eine TLS-Regel)", () => {
  test("HTTPS/TLS braucht ein Zertifikat, HTTP/TCP/UDP darf keins tragen, eigene Protokolle sind frei", () => {
    expect(tlsRuleViolation("HTTPS", false)).toBe("fehlt");
    expect(tlsRuleViolation("TLS", false)).toBe("fehlt");
    expect(tlsRuleViolation("HTTP", true)).toBe("verboten");
    expect(tlsRuleViolation("TCP", true)).toBe("verboten");
    expect(tlsRuleViolation("UDP", true)).toBe("verboten");
    expect(tlsRuleViolation("HTTPS", true)).toBeNull();
    expect(tlsRuleViolation("TLS", true)).toBeNull();
    expect(tlsRuleViolation("HTTP", false)).toBeNull();
    expect(tlsRuleViolation("example.com/x", true)).toBeNull();
    expect(tlsRuleViolation("example.com/x", false)).toBeNull();
  });
});

describe("Gateway-Accepted bei ungültigen Listenern (ListenersNotValid)", () => {
  const ok = { name: "http", port: 80, protocol: "HTTP" };
  const accepted = (gw: GatewayRes) => gatewayStatus(gw, env()).conditions.find(c => c.type === "Accepted");
  test("gemischt: Accepted True, ListenersNotValid nennt nur die ungültigen", () => {
    const c = accepted(tor({ listeners: [ok, https({ name: "tls" })] }));
    expect(c).toMatchObject({ status: "True", reason: "ListenersNotValid", message: "Listeners not valid: tls" });
  });
  test("alle ungültig: Accepted False, Namen sortiert und mit Komma getrennt", () => {
    const c = accepted(tor({ listeners: [https({ name: "zeta" }), https({ name: "alpha" })] }));
    expect(c).toMatchObject({ status: "False", reason: "ListenersNotValid", message: "No listeners are valid: alpha, zeta" });
  });
  test("keine Listener: Accepted True / Accepted; Programmed bleibt True", () => {
    const st = gatewayStatus(tor({ listeners: [] }), env());
    expect(st.conditions[0]).toMatchObject({ status: "True", reason: "Accepted" });
    expect(st.conditions[1]).toMatchObject({ type: "Programmed", status: "True" });
    expect(st.listeners).toEqual([]);
  });
  test("alle gültig: Accepted wie bisher", () => {
    expect(accepted(tor())).toMatchObject({ status: "True", reason: "Accepted" });
  });
  test("ohne akzeptierte Klasse gibt es weder Listener-Status noch ListenersNotValid", () => {
    const st = gatewayStatus(tor({ listeners: [https()] }), env({ gatewayClasses: [] }));
    expect(st.listeners).toBeNull();
    expect(st.conditions.some(c => c.reason === "ListenersNotValid")).toBe(false);
  });
});

describe("Listener-Conditions", () => {
  test("HTTP-Listener ohne Zertifikat: ResolvedRefs True, Programmed True", () => {
    const c = listenerConditions({ name: "http", port: 80, protocol: "HTTP" }, []);
    expect(c.map(x => x.type + "=" + x.status + "/" + x.reason)).toEqual(["Programmed=True/Programmed", "ResolvedRefs=True/ResolvedRefs"]);
  });
  test("HTTPS-Listener mit vorhandenem TLS-Secret ist gültig (Secret ohne Typ gilt als gültig)", () => {
    expect(listenerConditions(https(), [{ name: "tls" }]).every(c => c.status === "True")).toBe(true);
    expect(listenerConditions(https(), [{ name: "tls", type: "kubernetes.io/tls" }]).every(c => c.status === "True")).toBe(true);
  });
  test("fehlendes Secret: ResolvedRefs False / InvalidCertificateRef, Programmed False / Invalid", () => {
    const c = listenerConditions(https(), []);
    expect(c.find(x => x.type === "ResolvedRefs")).toMatchObject({ status: "False", reason: "InvalidCertificateRef" });
    expect(c.find(x => x.type === "Programmed")).toMatchObject({ status: "False", reason: "Invalid" });
  });
  test("Secret vom falschen Typ (Opaque) ist ein ungültiger certificateRef", () => {
    const c = listenerConditions(https(), [{ name: "tls", type: "Opaque" }]);
    expect(c.find(x => x.type === "ResolvedRefs")?.reason).toBe("InvalidCertificateRef");
  });
  test("ein Listener ohne TLS-Protokoll, aber mit tlsSecret (Szenario-Daten, eigenes Protokoll) braucht das Secret trotzdem", () => {
    for (const protocol of ["HTTP", "GRPC"]) {
      const l = { name: "x", port: 80, protocol, tlsSecret: "fehlt" };
      expect(listenerConditions(l, []).some(c => c.reason === "InvalidCertificateRef")).toBe(true);
      expect(listenerConditions(l, [{ name: "fehlt" }]).every(c => c.status === "True")).toBe(true);
    }
  });
  test("HTTPS ohne tlsSecret ist ungültig, ein anderes Secret als das genannte hilft nicht", () => {
    expect(listenerConditions(https({ tlsSecret: undefined }), [{ name: "tls" }]).some(c => c.status === "False")).toBe(true);
    expect(listenerConditions(https({ tlsSecret: "anders" }), [{ name: "tls" }]).some(c => c.status === "False")).toBe(true);
  });
});

/* ---------- Mapper ---------- */

const CLS = (extra = ""): string => "apiVersion: gateway.networking.k8s.io/v1\nkind: GatewayClass\nmetadata:\n  name: envoy\nspec:\n  controllerName: " + SIM_GATEWAY_CONTROLLER + "\n" + extra;
const GW = (spec = "  gatewayClassName: envoy\n  listeners:\n    - name: http\n      port: 80\n      protocol: HTTP\n", name = "tor"): string =>
  "apiVersion: gateway.networking.k8s.io/v1\nkind: Gateway\nmetadata:\n  name: " + name + "\nspec:\n" + spec;
const effect = (yaml: string): ApplyEffect => {
  const r = effectsFromManifest(yaml, "g.yaml");
  if (!Array.isArray(r)) throw new Error(r.error);
  return r[0];
};
const fail = (yaml: string): ManifestFailure => {
  const r = effectsFromManifest(yaml, "g.yaml");
  if (Array.isArray(r)) throw new Error("erwartet einen Fehler");
  return r;
};

describe("Mapper GatewayClass", () => {
  test("controllerName und optionale description", () => {
    expect(effect(CLS())).toEqual({ gatewayClass: { name: "envoy", controllerName: SIM_GATEWAY_CONTROLLER } });
    expect(effect(CLS("  description: Hafentor\n")).gatewayClass?.description).toBe("Hafentor");
  });
  test("fehlender controllerName nennt den Feldpfad", () => {
    const f = fail("apiVersion: gateway.networking.k8s.io/v1\nkind: GatewayClass\nmetadata:\n  name: envoy\nspec:\n  description: x\n");
    expect(f.error).toContain("spec.controllerName: Pflichtfeld fehlt");
  });
  test("ungültiger Name: kubectl-Text der Art", () => {
    const f = fail(CLS().replace("name: envoy", "name: Envoy_1"));
    expect(f.error).toMatch(/^The GatewayClass "Envoy_1" is invalid: metadata\.name/);
  });
});

describe("Mapper Gateway", () => {
  test("Listener mit allen Feldern: hostname und TLS-Secret", () => {
    const e = effect(GW("  gatewayClassName: envoy\n  listeners:\n    - name: https\n      port: 443\n      protocol: HTTPS\n      hostname: hafen.example\n      tls:\n        mode: Terminate\n        certificateRefs:\n          - kind: Secret\n            name: hafen-tls\n"));
    expect(e.gateway).toEqual({ name: "tor", className: "envoy", listeners: [{ name: "https", port: 443, protocol: "HTTPS", hostname: "hafen.example", tlsSecret: "hafen-tls" }] });
  });
  test("ein im Manifest mitgelieferter status wird ignoriert", () => {
    const e = effect(GW() + "status:\n  conditions:\n    - type: Accepted\n      status: \"False\"\n");
    expect(e.gateway?.listeners).toHaveLength(1);
  });
  test("fehlender gatewayClassName", () => {
    expect(fail(GW("  listeners:\n    - name: a\n      port: 80\n      protocol: HTTP\n")).error).toContain("spec.gatewayClassName: Pflichtfeld fehlt");
  });
  test("listeners fehlt oder ist leer: mindestens ein Listener Pflicht", () => {
    expect(fail(GW("  gatewayClassName: envoy\n")).error).toContain("spec.listeners: Pflichtfeld fehlt");
    expect(fail(GW("  gatewayClassName: envoy\n  listeners: []\n")).error).toContain("spec.listeners: Pflichtfeld fehlt");
  });
  test.each([
    ["name", "  gatewayClassName: envoy\n  listeners:\n    - port: 80\n      protocol: HTTP\n", "spec.listeners[0].name: Pflichtfeld fehlt"],
    ["port", "  gatewayClassName: envoy\n  listeners:\n    - name: a\n      protocol: HTTP\n", "spec.listeners[0].port: Pflichtfeld fehlt"],
    ["protocol", "  gatewayClassName: envoy\n  listeners:\n    - name: a\n      port: 80\n", "spec.listeners[0].protocol: Pflichtfeld fehlt"],
  ])("Listener ohne %s", (_f, spec, text) => {
    expect(fail(GW(spec)).error).toContain(text);
  });
  test.each([[0, "greater than or equal to 1"], [70000, "less than or equal to 65535"]])("Port %i liegt außerhalb 1 bis 65535", (port, grenze) => {
    const f = fail(GW("  gatewayClassName: envoy\n  listeners:\n    - name: a\n      port: " + port + "\n      protocol: HTTP\n"));
    expect(f.error).toBe("The Gateway \"tor\" is invalid: spec.listeners[0].port: Invalid value: " + port + ": spec.listeners[0].port in body should be " + grenze);
  });
  const LST = (protocol: string, port: number, rest = ""): string =>
    "  gatewayClassName: envoy\n  listeners:\n    - name: a\n      port: " + port + "\n      protocol: " + protocol + "\n" + rest;
  test("Ports 1 und 65535 sind gültig", () => {
    for (const port of [1, 65535]) expect(effect(GW(LST("HTTP", port))).gateway?.listeners[0].port).toBe(port);
  });
  test("tls ohne certificateRefs wird abgelehnt (leer, mode Terminate), Passthrough ist nicht simuliert", () => {
    const CEL = "certificateRefs or options must be specified when mode is Terminate";
    expect(fail(GW(LST("HTTPS", 443, "      tls: {}\n"))).error).toContain(CEL);
    expect(fail(GW(LST("HTTPS", 443, "      tls:\n        mode: Terminate\n"))).error).toContain(CEL);
    expect(fail(GW(LST("TLS", 443, "      tls:\n        mode: Passthrough\n"))).error).toContain("Passthrough wird vom Simulator nicht abgebildet");
  });
  test("unbekannter tls.mode: Server-Wortlaut mit Tipp", () => {
    const f = fail(GW(LST("HTTPS", 443, "      tls:\n        mode: Foo\n        certificateRefs:\n          - name: x\n")));
    expect(f.error).toBe("The Gateway \"tor\" is invalid: spec.listeners[0].tls.mode: Unsupported value: \"Foo\": supported values: \"Terminate\", \"Passthrough\"");
    expect(f.hint).toContain("Terminate");
    expect(effect(GW(LST("HTTPS", 443, "      tls:\n        mode: Terminate\n        certificateRefs:\n          - name: x\n"))).gateway?.listeners[0].tlsSecret).toBe("x");
  });
  test("tls.options ohne certificateRefs wird vom Simulator nicht abgebildet", () => {
    const f = fail(GW(LST("HTTPS", 443, "      tls:\n        options:\n          a.b/c: d\n")));
    expect(f.error).toContain("spec.listeners[0].tls.options: ohne certificateRefs wird vom Simulator nicht abgebildet");
    expect(f.hint).toContain("certificateRefs");
    expect(effect(GW(LST("HTTPS", 443, "      tls:\n        options:\n          a.b/c: d\n        certificateRefs:\n          - name: x\n"))).gateway?.listeners[0].tlsSecret).toBe("x");
  });
  test("tls an einem HTTP-Listener wird abgelehnt", () => {
    for (const protocol of ["HTTP", "TCP", "UDP"]) {
      const f = fail(GW(LST(protocol, 80, "      tls:\n        certificateRefs:\n          - name: x\n")));
      expect(f.error).toContain("tls must not be specified for protocols ['HTTP', 'TCP', 'UDP']");
    }
  });
  test("tls-Zertifikatsverweis ohne name: Pflichtfeld", () => {
    const f = fail(GW(LST("HTTPS", 443, "      tls:\n        certificateRefs:\n          - kind: Secret\n")));
    expect(f.error).toContain("name: Pflichtfeld fehlt");
  });
  test("HTTPS und TLS ohne tls-Block werden abgelehnt, HTTP braucht keinen", () => {
    for (const protocol of ["HTTPS", "TLS"]) {
      const f = fail(GW("  gatewayClassName: envoy\n  listeners:\n    - name: a\n      port: 443\n      protocol: " + protocol + "\n"));
      expect(f.error).toBe("The Gateway \"tor\" is invalid: spec.listeners: Invalid value: \"array\": tls must be specified for protocols ['HTTPS', 'TLS']");
    }
  });
  test("doppelte Listener-Namen werden abgelehnt", () => {
    const f = fail(GW("  gatewayClassName: envoy\n  listeners:\n    - name: a\n      port: 80\n      protocol: HTTP\n    - name: a\n      port: 81\n      protocol: HTTP\n"));
    expect(f.error).toBe("The Gateway \"tor\" is invalid: spec.listeners: Invalid value: \"array\": Listener name must be unique within the Gateway");
  });
  test("ungültiger Name", () => {
    expect(fail(GW(undefined, "Tor_1")).error).toMatch(/^The Gateway "Tor_1" is invalid: metadata\.name/);
  });
  test("Gateway und Ingress in einer Datei: no matches, der Hinweis nennt die Gateway-Arten", () => {
    const ing = "apiVersion: networking.k8s.io/v1\nkind: Ingress\nmetadata:\n  name: tor\nspec:\n  rules: []\n";
    const f = fail(GW() + "---\n" + ing);
    expect(f.error).toContain('no matches for kind "Ingress" in version "networking.k8s.io/v1"');
    expect(f.hint).toContain("GatewayClass (gateway.networking.k8s.io/v1)");
    expect(f.hint).toContain("Gateway (gateway.networking.k8s.io/v1)");
  });
});

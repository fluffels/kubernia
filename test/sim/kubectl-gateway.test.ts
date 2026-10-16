/* Gateway API Teil 1 (#1664) über die öffentliche Sim-API (`exec`): apply (created/configured/unchanged/immutable),
 * get (auch -o wide, nicht in `all`), describe, delete (Name und -f), Invarianten, bare-metal-Reset. */
import { describe, test, expect, beforeEach } from "vitest";
import { KQSim, freshSim } from "./helpers";
import { SIM_GATEWAY_CONTROLLER, gatewayAddress } from "../../src/sim/gateway";
import { reviveScenario } from "../../src/content/scenario";

let sim: KQSim;
beforeEach(() => { sim = freshSim(); });

const run = (cmd: string) => sim.exec("kubectl " + cmd);
const out = (cmd: string): string => run(cmd).output ?? "";
const CLS = (extra = "", controller = SIM_GATEWAY_CONTROLLER, name = "envoy"): string =>
  "apiVersion: gateway.networking.k8s.io/v1\nkind: GatewayClass\nmetadata:\n  name: " + name + "\nspec:\n  controllerName: " + controller + "\n" + extra;
const GW = (listeners = "    - name: http\n      port: 80\n      protocol: HTTP\n", cls = "envoy", name = "tor"): string =>
  "apiVersion: gateway.networking.k8s.io/v1\nkind: Gateway\nmetadata:\n  name: " + name + "\nspec:\n  gatewayClassName: " + cls + "\n  listeners:\n" + listeners;
const HTTPS = "    - name: https\n      port: 443\n      protocol: HTTPS\n      hostname: hafen.example\n      tls:\n        certificateRefs:\n          - name: hafen-tls\n";
const apply = (file: string, content: string) => { sim.files[file] = content; return run("apply -f " + file); };

describe("apply GatewayClass", () => {
  test("created, dann unchanged, dann configured bei neuer description", () => {
    expect(apply("c.yaml", CLS()).output).toBe("gatewayclass.gateway.networking.k8s.io/envoy created");
    expect(apply("c.yaml", CLS()).output).toBe("gatewayclass.gateway.networking.k8s.io/envoy unchanged");
    expect(apply("c.yaml", CLS("  description: Hafentor\n")).output).toBe("gatewayclass.gateway.networking.k8s.io/envoy configured");
    expect(sim.gatewayClasses[0].description).toBe("Hafentor");
    expect(apply("c.yaml", CLS("  description: Hafentor\n")).output).toContain("unchanged");
    expect(apply("c.yaml", CLS()).output).toContain("configured");
    expect(sim.gatewayClasses[0].description).toBeUndefined();
  });
  test("der controllerName einer vorhandenen Klasse ist unveränderlich, der Zustand bleibt", () => {
    apply("c.yaml", CLS());
    const r = apply("c.yaml", CLS("", "example.com/anderer"));
    expect(r.error).toBe(true);
    expect(r.output).toContain('The GatewayClass "envoy" is invalid: spec.controllerName: Invalid value: "example.com/anderer": Value is immutable');
    expect(sim.gatewayClasses[0].controllerName).toBe(SIM_GATEWAY_CONTROLLER);
  });
  test("fehlender controllerName: Fehler, nichts angelegt", () => {
    const r = apply("c.yaml", "apiVersion: gateway.networking.k8s.io/v1\nkind: GatewayClass\nmetadata:\n  name: envoy\nspec: {}\n");
    expect(r.error).toBe(true);
    expect(sim.gatewayClasses).toEqual([]);
  });
});

describe("apply Gateway", () => {
  test("created, unchanged, configured bei geändertem Listener oder geänderter Klasse", () => {
    expect(apply("g.yaml", GW()).output).toBe("gateway.gateway.networking.k8s.io/tor created");
    expect(apply("g.yaml", GW()).output).toBe("gateway.gateway.networking.k8s.io/tor unchanged");
    expect(apply("g.yaml", GW("    - name: http\n      port: 8080\n      protocol: HTTP\n")).output).toBe("gateway.gateway.networking.k8s.io/tor configured");
    expect(sim.gateways[0].listeners[0].port).toBe(8080);
    expect(apply("g.yaml", GW("    - name: http\n      port: 8080\n      protocol: HTTP\n", "andere")).output).toContain("configured");
    expect(sim.gateways[0].className).toBe("andere");
  });
  test("unchanged auch bei anderer Schlüssel-Reihenfolge eines Szenario-Gateways", () => {
    sim.gateways.push({ name: "tor", className: "envoy", listeners: [{ protocol: "HTTP", port: 80, name: "http" }] });
    expect(apply("g.yaml", GW()).output).toBe("gateway.gateway.networking.k8s.io/tor unchanged");
  });
  test("ein Gateway auf eine unbekannte Klasse wird angelegt", () => {
    expect(apply("g.yaml", GW(undefined, "gibt-es-nicht")).output).toContain("created");
    expect(sim.gateways).toHaveLength(1);
  });
  test("leere Listener-Liste und fehlender Klassenname: Fehler, nichts angelegt", () => {
    expect(apply("g.yaml", "apiVersion: gateway.networking.k8s.io/v1\nkind: Gateway\nmetadata:\n  name: tor\nspec:\n  gatewayClassName: envoy\n  listeners: []\n").error).toBe(true);
    expect(apply("g.yaml", "apiVersion: gateway.networking.k8s.io/v1\nkind: Gateway\nmetadata:\n  name: tor\nspec:\n  listeners: []\n").error).toBe(true);
    expect(sim.gateways).toEqual([]);
  });
  test("Gateway und Ingress in einer Datei: no matches, kein Gateway angelegt", () => {
    const r = apply("m.yaml", GW() + "---\napiVersion: networking.k8s.io/v1\nkind: Ingress\nmetadata:\n  name: tor\nspec:\n  rules: []\n");
    expect(r.error).toBe(true);
    expect(r.output).toContain('no matches for kind "Ingress"');
    expect(sim.gateways).toEqual([]);
  });
});

describe("get", () => {
  beforeEach(() => {
    apply("c.yaml", CLS("  description: Hafentor\n"));
    apply("g.yaml", GW());
  });
  test("get gatewayclasses: NAME CONTROLLER ACCEPTED AGE, Kurzname gc", () => {
    for (const cmd of ["get gatewayclasses", "get gc", "get gatewayclass envoy"]) {
      const lines = out(cmd).split("\n");
      expect(lines[0].split(/\s+/), cmd).toEqual(["NAME", "CONTROLLER", "ACCEPTED", "AGE"]);
      expect(lines[1].split(/\s+/).slice(0, 3), cmd).toEqual(["envoy", SIM_GATEWAY_CONTROLLER, "True"]);
    }
  });
  test("get gc -o wide hängt DESCRIPTION an", () => {
    const lines = out("get gc -o wide").split("\n");
    expect(lines[0].trim().endsWith("DESCRIPTION")).toBe(true);
    expect(lines[1].trim().endsWith("Hafentor")).toBe(true);
  });
  test("Klasse mit fremdem Controller: ACCEPTED Unknown", () => {
    apply("f.yaml", CLS("", "example.com/anderer", "fremd"));
    expect(out("get gc fremd").split("\n")[1].split(/\s+/)[2]).toBe("Unknown");
  });
  test("get gateways: Adresse und PROGRAMMED True mit akzeptierter Klasse, Kurzname gtw", () => {
    for (const cmd of ["get gateways", "get gtw", "get gateway tor"]) {
      const lines = out(cmd).split("\n");
      expect(lines[0].split(/\s+/), cmd).toEqual(["NAME", "CLASS", "ADDRESS", "PROGRAMMED", "AGE"]);
      expect(lines[1].split(/\s+/).slice(0, 4), cmd).toEqual(["tor", "envoy", gatewayAddress("tor"), "True"]);
    }
  });
  test("ohne akzeptierte Klasse: ADDRESS leer, PROGRAMMED Unknown", () => {
    apply("g2.yaml", GW(undefined, "gibt-es-nicht", "waise"));
    apply("f.yaml", CLS("", "example.com/anderer", "fremd"));
    apply("g3.yaml", GW(undefined, "fremd", "fremdes-tor"));
    for (const name of ["waise", "fremdes-tor"]) {
      const cells = out("get gateway " + name).split("\n")[1].trim().split(/\s+/);
      expect(cells[0]).toBe(name);
      expect(cells).not.toContain(gatewayAddress(name));
      expect(cells[2]).toBe("Unknown");
    }
  });
  test("get all zeigt weder Klassen noch Gateways", () => {
    expect(out("get all")).not.toMatch(/gateway/i);
  });
  test("ein fehlender Name: NotFound mit Gruppe", () => {
    const r = run("get gateway nichtda");
    expect(r.error).toBe(true);
    expect(r.output).toContain('Error from server (NotFound): gateways.gateway.networking.k8s.io "nichtda" not found');
  });
  test("leer: No resources found in default namespace.", () => {
    expect(new KQSim({}).exec("kubectl get gateways").output).toBe("No resources found in default namespace.");
  });
});

describe("describe", () => {
  test("GatewayClass: Controller, Description, Accepted", () => {
    apply("c.yaml", CLS("  description: Hafentor\n"));
    const d = out("describe gatewayclass envoy");
    expect(d).toMatch(/^Name:\s+envoy$/m);
    expect(d).not.toMatch(/^Namespace:/m);
    expect(d).toMatch(/^Kind:\s+GatewayClass$/m);
    expect(d).toContain("  Controller Name:  " + SIM_GATEWAY_CONTROLLER);
    expect(d).toContain("  Description:      Hafentor");
    expect(d).toMatch(/Reason:\s+Accepted\s+Status:\s+True\s+Type:\s+Accepted/);
  });
  test("Gateway mit vorhandenem TLS-Secret: Listener, Adresse, alle Conditions True", () => {
    apply("c.yaml", CLS());
    sim.secrets.push({ name: "hafen-tls", keys: ["tls.crt", "tls.key"], type: "kubernetes.io/tls" });
    apply("g.yaml", GW(HTTPS));
    const d = out("describe gateway tor");
    expect(d).toMatch(/^Namespace:\s+default$/m);
    expect(d).toContain("Gateway Class Name:  envoy");
    expect(d).toContain("Hostname:  hafen.example");
    expect(d).toContain("Name:  hafen-tls");
    expect(d).toContain("Value:  " + gatewayAddress("tor"));
    expect(d).not.toContain("InvalidCertificateRef");
    expect(d).toContain("Reason:   ResolvedRefs");
  });
  test("fehlendes Secret am HTTPS-Listener: ResolvedRefs False / InvalidCertificateRef", () => {
    apply("c.yaml", CLS());
    apply("g.yaml", GW(HTTPS));
    const d = out("describe gateway tor");
    expect(d).toMatch(/Reason:\s+InvalidCertificateRef\s+Status:\s+False\s+Type:\s+ResolvedRefs/);
    expect(d).toMatch(/Message:\s+No listeners are valid: https/);
    expect(d).toMatch(/Reason:\s+ListenersNotValid/);
    expect(out("get gateway tor -o yaml")).toMatch(/reason: ListenersNotValid/);
  });
  test("Opaque-Secret statt kubernetes.io/tls: ebenfalls InvalidCertificateRef", () => {
    apply("c.yaml", CLS());
    sim.secrets.push({ name: "hafen-tls", keys: ["k"], type: "Opaque" });
    apply("g.yaml", GW(HTTPS));
    expect(out("describe gateway tor")).toContain("InvalidCertificateRef");
  });
  test("ohne akzeptierte Klasse: keine Adresse, Pending, keine Listener-Conditions", () => {
    apply("g.yaml", GW(HTTPS, "gibt-es-nicht"));
    const d = out("describe gateway tor");
    expect(d).not.toContain("Addresses:");
    expect(d).toMatch(/Reason:\s+Pending\s+Status:\s+Unknown\s+Type:\s+Accepted/);
    expect(d).not.toContain("InvalidCertificateRef");
  });
  test("Unbekanntes: NotFound", () => {
    for (const [cmd, plural] of [["describe gateway nichtda", "gateways"], ["describe gatewayclass nichtda", "gatewayclasses"]]) {
      const r = run(cmd);
      expect(r.error, cmd).toBe(true);
      expect(r.output).toContain("Error from server (NotFound): " + plural + '.gateway.networking.k8s.io "nichtda" not found');
    }
  });
});

describe("delete", () => {
  beforeEach(() => {
    apply("c.yaml", CLS());
    apply("g.yaml", GW());
  });
  test("per Name", () => {
    expect(out("delete gateway tor")).toBe('gateway.gateway.networking.k8s.io "tor" deleted');
    expect(out("delete gatewayclass envoy")).toBe('gatewayclass.gateway.networking.k8s.io "envoy" deleted');
    expect(sim.gateways).toEqual([]);
    expect(sim.gatewayClasses).toEqual([]);
  });
  test("eine Klasse lässt sich trotz Gateways löschen (kein Finalizer), das Gateway wird Unknown", () => {
    expect(run("delete gc envoy").error).toBe(false);
    // ADDRESS ist leer, die Zeile hat danach nur noch Name, Klasse, PROGRAMMED, AGE.
    expect(out("get gtw tor").split("\n")[1].trim().split(/\s+/).slice(0, 3)).toEqual(["tor", "envoy", "Unknown"]);
  });
  test("Unbekanntes: NotFound", () => {
    const r = run("delete gtw nichtda");
    expect(r.error).toBe(true);
    expect(r.output).toContain('Error from server (NotFound): gateways.gateway.networking.k8s.io "nichtda" not found');
    expect(run("delete gc nichtda").output).toContain('gatewayclasses.gateway.networking.k8s.io "nichtda" not found');
  });
  test("per -f mit beiden Arten in einer Datei", () => {
    sim.files["beide.yaml"] = CLS() + "---\n" + GW();
    const r = run("delete -f beide.yaml");
    expect(r.error).toBeFalsy();
    expect(r.output).toContain('gatewayclass.gateway.networking.k8s.io "envoy" deleted');
    expect(r.output).toContain('gateway.gateway.networking.k8s.io "tor" deleted');
    expect(sim.gateways).toEqual([]);
    expect(sim.gatewayClasses).toEqual([]);
  });
});

describe("bare metal", () => {
  test("der Sturm räumt Klassen und Gateways ab", () => {
    apply("c.yaml", CLS());
    apply("g.yaml", GW());
    sim.mergeScenario({ bareMetal: true });
    expect(sim.gatewayClasses).toEqual([]);
    expect(sim.gateways).toEqual([]);
  });
});

describe("Szenario-Gateway (#1686)", () => {
  test("ein validiertes Szenario-Gateway überlebt get -o yaml → apply ohne Fehler", () => {
    const sc = reviveScenario({
      gatewayClasses: [{ name: "envoy", controllerName: SIM_GATEWAY_CONTROLLER }],
      gateways: [{ name: "tor", className: "envoy", listeners: [
        { name: "http", port: 80, protocol: "HTTP" },
        { name: "https", port: 443, protocol: "HTTPS", hostname: "hafen.example", tlsSecret: "hafen-tls" },
      ] }],
    }, "x");
    const s = new KQSim(sc);
    sim.files["g.yaml"] = s.exec("kubectl get gateway tor -o yaml").output ?? "";
    const r = run("apply -f g.yaml");
    expect(r.error).toBeFalsy();
    expect(r.output).toContain("gateway.gateway.networking.k8s.io/tor created");
  });
});

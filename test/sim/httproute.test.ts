/* Gateway API Teil 2 (#1665): HTTPRoute. Pure Statusfunktionen (sim/gateway.ts), der Mapper (über die öffentliche
 * `effectsFromManifest`) und kubectl über `exec` (apply, get, describe, delete, -o yaml, Round-Trip). */
import { describe, test, expect, beforeEach } from "vitest";
import { KQSim, freshSim } from "./helpers";
import {
  SIM_GATEWAY_CONTROLLER, attachedRoutes, hostnamesIntersect, httpRouteStatus,
  type GatewayClassRes, type GatewayRes, type HttpRouteRes,
} from "../../src/sim/gateway";
import { effectsFromManifest, type ManifestFailure } from "../../src/sim/manifest/registry";
import type { ApplyEffect } from "../../src/sim/state";

const klasse: GatewayClassRes = { name: "envoy", controllerName: SIM_GATEWAY_CONTROLLER };
const tor = (extra: Partial<GatewayRes> = {}): GatewayRes => ({ name: "tor", className: "envoy", listeners: [{ name: "http", port: 80, protocol: "HTTP" }], ...extra });
const route = (extra: Partial<HttpRouteRes> = {}): HttpRouteRes => ({
  name: "r", parentRefs: ["tor"], hostnames: [], rules: [{ path: "/", pathType: "PathPrefix", backends: [{ service: "web", port: 80 }] }], ...extra,
});
const web = [{ name: "web" }];
const cond = (r: HttpRouteRes, gws: GatewayRes[], services = web) => httpRouteStatus(r, gws, [klasse], services).parents[0]?.conditions.map(c => c.type + "=" + c.status + "/" + c.reason);

describe("hostnamesIntersect", () => {
  test.each([
    [undefined, ["a.de"], true], ["a.de", [], true], ["a.de", ["a.de"], true], ["a.de", ["b.de"], false],
    ["*.hafen.de", ["lager.hafen.de"], true], ["*.hafen.de", ["hafen.de"], false], ["*.hafen.de", ["x.de"], false],
    ["lager.hafen.de", ["*.hafen.de"], true], ["hafen.de", ["*.hafen.de"], false],
  ])("Listener %s gegen %j: %s", (l, routeHosts, erwartet) => {
    expect(hostnamesIntersect(l, routeHosts)).toBe(erwartet);
  });
});

describe("attachedRoutes", () => {
  test("zählt Routen, die das Gateway nennen, nur bei HTTP/HTTPS-Listenern", () => {
    const g = tor({ listeners: [{ name: "http", port: 80, protocol: "HTTP" }, { name: "tcp", port: 9000, protocol: "TCP" }] });
    const routen = [route(), route({ name: "r2" }), route({ name: "fremd", parentRefs: ["anderes"] })];
    expect(attachedRoutes(g, g.listeners[0], routen)).toBe(2);
    expect(attachedRoutes(g, g.listeners[1], routen)).toBe(0);
  });
  test("zählt auch, wenn die Route nicht angenommen ist (Hostname passt nicht)", () => {
    const g = tor({ listeners: [{ name: "http", port: 80, protocol: "HTTP", hostname: "a.de" }] });
    expect(attachedRoutes(g, g.listeners[0], [route({ hostnames: ["b.de"] })])).toBe(1);
  });
});

describe("httpRouteStatus", () => {
  test("alles verdrahtet: Accepted und ResolvedRefs True", () => {
    expect(cond(route(), [tor()])).toEqual(["Accepted=True/Accepted", "ResolvedRefs=True/ResolvedRefs"]);
  });
  test("Backend-Service fehlt: ResolvedRefs False / BackendNotFound, Meldung nennt Regel und backendRef", () => {
    const st = httpRouteStatus(route(), [tor()], [klasse], []);
    const c = st.parents[0].conditions[1];
    expect(c).toMatchObject({ type: "ResolvedRefs", status: "False", reason: "BackendNotFound" });
    expect(c.message).toContain("Service web not found (rule 1, backendRef 1)");
  });
  test("zwei Backends, eines fehlt: trotzdem False", () => {
    const r = route({ rules: [{ path: "/", pathType: "PathPrefix", backends: [{ service: "web", port: 80 }, { service: "weg", port: 80 }] }] });
    const c = httpRouteStatus(r, [tor()], [klasse], web).parents[0].conditions[1];
    expect(c.status).toBe("False");
    expect(c.message).toContain("weg");
    expect(c.message).toContain("backendRef 2");
  });
  test("Route ohne Regeln: beide Conditions True", () => {
    expect(cond(route({ rules: [] }), [tor()])).toEqual(["Accepted=True/Accepted", "ResolvedRefs=True/ResolvedRefs"]);
  });
  test("parentRef auf unbekanntes Gateway: kein Parent-Status, unattached NotFound", () => {
    const st = httpRouteStatus(route({ parentRefs: ["nix"] }), [tor()], [klasse], web);
    expect(st.parents).toEqual([]);
    expect(st.unattached).toEqual([{ gateway: "nix", reason: "NotFound" }]);
  });
  test("Gateway ohne angenommene Klasse: kein Parent-Status, unattached NoController", () => {
    const st = httpRouteStatus(route(), [tor({ className: "fremd" })], [klasse], web);
    expect(st.parents).toEqual([]);
    expect(st.unattached).toEqual([{ gateway: "tor", reason: "NoController" }]);
  });
  test("nur TCP-Listener: Accepted False / NotAllowedByListeners", () => {
    expect(cond(route(), [tor({ listeners: [{ name: "t", port: 1, protocol: "TCP" }] })])[0]).toBe("Accepted=False/NotAllowedByListeners");
  });
  test("Hostname passt nicht: NoMatchingListenerHostname; Wildcard passt auf Subdomain", () => {
    const g = tor({ listeners: [{ name: "h", port: 80, protocol: "HTTP", hostname: "*.hafen.de" }] });
    expect(cond(route({ hostnames: ["lager.hafen.de"] }), [g])[0]).toBe("Accepted=True/Accepted");
    expect(cond(route({ hostnames: ["hafen.de"] }), [g])[0]).toBe("Accepted=False/NoMatchingListenerHostname");
  });
});

// ===== Mapper =====
const RT = (spec: string, name = "r"): string => "apiVersion: gateway.networking.k8s.io/v1\nkind: HTTPRoute\nmetadata:\n  name: " + name + "\nspec:\n" + spec;
const effect = (yaml: string): ApplyEffect => {
  const r = effectsFromManifest(yaml, "r.yaml");
  if (!Array.isArray(r)) throw new Error(r.error);
  return r[0];
};
const fail = (yaml: string): ManifestFailure => {
  const r = effectsFromManifest(yaml, "r.yaml");
  if (Array.isArray(r)) throw new Error("erwartet einen Fehler");
  return r;
};
const VOLL = "  parentRefs:\n    - name: tor\n  hostnames:\n    - hafen.de\n  rules:\n    - matches:\n        - path:\n            type: Exact\n            value: /api\n      backendRefs:\n        - name: web\n          port: 80\n";

describe("Mapper HTTPRoute", () => {
  test("alle Felder", () => {
    expect(effect(RT(VOLL)).httpRoute).toEqual({
      name: "r", parentRefs: ["tor"], hostnames: ["hafen.de"],
      rules: [{ path: "/api", pathType: "Exact", backends: [{ service: "web", port: 80 }] }],
    });
  });
  test("Regel ohne matches: Default PathPrefix /; matches ohne Typ: PathPrefix", () => {
    const a = effect(RT("  rules:\n    - backendRefs:\n        - name: web\n          port: 80\n")).httpRoute;
    expect(a?.rules).toEqual([{ path: "/", pathType: "PathPrefix", backends: [{ service: "web", port: 80 }] }]);
    const b = effect(RT("  rules:\n    - matches:\n        - path:\n            value: /x\n")).httpRoute;
    expect(b?.rules[0]).toMatchObject({ path: "/x", pathType: "PathPrefix" });
  });
  test("ohne rules: eine Default-Regel ohne Backends; rules [] bleibt leer", () => {
    expect(effect(RT("  parentRefs:\n    - name: tor\n")).httpRoute?.rules).toEqual([{ path: "/", pathType: "PathPrefix", backends: [] }]);
    expect(effect(RT("  rules: []\n")).httpRoute?.rules).toEqual([]);
  });
  test("ein mitgelieferter status und ignorierte Felder (weight, filters) stören nicht", () => {
    const e = effect(RT("  rules:\n    - backendRefs:\n        - name: web\n          port: 80\n          weight: 5\n      filters: []\n") + "status:\n  parents: []\n");
    expect(e.httpRoute?.rules[0].backends).toEqual([{ service: "web", port: 80 }]);
  });
  test.each([
    ["parentRef mit fremdem namespace", "  parentRefs:\n    - name: tor\n      namespace: andere\n", "ReferenceGrant"],
    ["parentRef mit kind != Gateway", "  parentRefs:\n    - name: tor\n      kind: Mesh\n", "nur kind 'Gateway'"],
    ["parentRef mit sectionName", "  parentRefs:\n    - name: tor\n      sectionName: http\n", "sectionName: wird vom Simulator nicht abgebildet"],
    ["parentRef mit port", "  parentRefs:\n    - name: tor\n      port: 80\n", "port: wird vom Simulator nicht abgebildet"],
    ["backendRef mit fremdem namespace", "  rules:\n    - backendRefs:\n        - name: web\n          port: 80\n          namespace: andere\n", "ReferenceGrant"],
    ["backendRef mit kind != Service", "  rules:\n    - backendRefs:\n        - name: web\n          port: 80\n          kind: Bucket\n", "nur kind 'Service'"],
    ["backendRef ohne port", "  rules:\n    - backendRefs:\n        - name: web\n", "Must have port for Service reference"],
    ["mehr als ein match", "  rules:\n    - matches:\n        - path:\n            value: /a\n        - path:\n            value: /b\n", "mehr als ein match"],
    ["RegularExpression", "  rules:\n    - matches:\n        - path:\n            type: RegularExpression\n            value: /a.*\n", "RegularExpression wird vom Simulator nicht abgebildet"],
    ["Tippfehler im Pfad-Typ", "  rules:\n    - matches:\n        - path:\n            type: Prefix\n            value: /a\n", "Unsupported value: \"Prefix\""],
    ["Pfad ohne führenden Schrägstrich", "  rules:\n    - matches:\n        - path:\n            value: a\n", "must be an absolute path"],
  ])("lehnt ab: %s", (_n, spec, text) => {
    expect(fail(RT(spec)).error).toContain(text);
  });
  test("ungültiger Name", () => {
    expect(fail(RT(VOLL, "Rt_1")).error).toMatch(/^The HTTPRoute "Rt_1" is invalid: metadata\.name/);
  });
});

// ===== kubectl =====
let sim: KQSim;
beforeEach(() => { sim = freshSim(); });
const run = (cmd: string) => sim.exec("kubectl " + cmd);
const out = (cmd: string): string => run(cmd).output ?? "";
const apply = (file: string, content: string) => { sim.files[file] = content; return run("apply -f " + file); };
const CLS = "apiVersion: gateway.networking.k8s.io/v1\nkind: GatewayClass\nmetadata:\n  name: envoy\nspec:\n  controllerName: " + SIM_GATEWAY_CONTROLLER + "\n";
const GW = "apiVersion: gateway.networking.k8s.io/v1\nkind: Gateway\nmetadata:\n  name: tor\nspec:\n  gatewayClassName: envoy\n  listeners:\n    - name: http\n      port: 80\n      protocol: HTTP\n";

describe("apply HTTPRoute", () => {
  test("created, unchanged, configured (auch nur der Pfad-Typ), die Route landet im Zustand", () => {
    expect(apply("r.yaml", RT(VOLL)).output).toBe("httproute.gateway.networking.k8s.io/r created");
    expect(apply("r.yaml", RT(VOLL)).output).toBe("httproute.gateway.networking.k8s.io/r unchanged");
    expect(sim.httpRoutes[0]).toMatchObject({ name: "r", parentRefs: ["tor"], hostnames: ["hafen.de"] });
    expect(apply("r.yaml", RT(VOLL.replace("Exact", "PathPrefix"))).output).toBe("httproute.gateway.networking.k8s.io/r configured");
    expect(sim.httpRoutes[0].rules[0].pathType).toBe("PathPrefix");
  });
  test("ein Fehler im Manifest legt nichts an", () => {
    expect(apply("r.yaml", RT("  rules:\n    - backendRefs:\n        - name: web\n")).error).toBe(true);
    expect(sim.httpRoutes).toEqual([]);
  });
  test("configured verändert das Szenario nicht (flacher Klon)", () => {
    const szenario = { httpRoutes: [{ name: "r", parentRefs: ["tor"], hostnames: ["a.de"], rules: [{ path: "/", pathType: "PathPrefix" as const, backends: [] }] }] };
    const s = new KQSim(szenario);
    s.files["r.yaml"] = RT(VOLL);
    expect(s.exec("kubectl apply -f r.yaml").output).toContain("configured");
    expect(szenario.httpRoutes[0]).toEqual({ name: "r", parentRefs: ["tor"], hostnames: ["a.de"], rules: [{ path: "/", pathType: "PathPrefix", backends: [] }] });
  });
});

describe("get httproute", () => {
  test("NAME HOSTNAMES AGE; leer: No resources found", () => {
    expect(out("get httproute")).toBe("No resources found in default namespace.");
    apply("r.yaml", RT(VOLL));
    apply("o.yaml", RT("  parentRefs:\n    - name: tor\n", "ohne-host"));
    const lines = out("get httproutes").split("\n");
    expect(lines[0].split(/\s+/)).toEqual(["NAME", "HOSTNAMES", "AGE"]);
    expect(lines[1]).toMatch(/^r\s+\["hafen\.de"\]\s+\S+$/);
    expect(lines[2]).toMatch(/^ohne-host\s+\S+$/);
  });
  test("steht nicht in get all", () => {
    apply("r.yaml", RT(VOLL));
    expect(out("get all")).not.toContain("httproute");
  });
});

describe("describe httproute und die Hinweise", () => {
  beforeEach(() => {
    apply("c.yaml", CLS);
    apply("g.yaml", GW);
    run("create deployment web --image=nginx");
    run("expose deployment web --port=80");
  });
  test("verdrahtet: Parent mit Accepted und ResolvedRefs True, kein Hinweis", () => {
    apply("r.yaml", RT(VOLL));
    const d = out("describe httproute r");
    expect(d).toMatch(/Name:\s+r\n/);
    expect(d).toMatch(/Kind:\s+HTTPRoute/);
    expect(d).toContain("Type:   Exact");
    expect(d).toContain("Value:  /api");
    expect(d).toMatch(/Type:\s+Accepted/);
    expect(d).toMatch(/Status:\s+True\n\s+Type:\s+ResolvedRefs/);
    expect(d).toContain("Controller Name:  " + SIM_GATEWAY_CONTROLLER);
    expect(d).not.toContain("an keinem Tor");
  });
  test("Backend fehlt, auch nachdem der Service gelöscht wurde", () => {
    apply("r.yaml", RT(VOLL));
    run("delete service web");
    const d = out("describe httproute r");
    expect(d).toMatch(/Reason:\s+BackendNotFound/);
    expect(d).toMatch(/Status:\s+False\n\s+Type:\s+ResolvedRefs/);
  });
  test("parentRef auf unbekanntes Gateway: kein Parent-Status, deutscher Hinweis", () => {
    apply("r.yaml", RT(VOLL.replace("name: tor", "name: nix")));
    const d = out("describe httproute r");
    expect(d).not.toMatch(/Type:\s+Accepted/);
    expect(d).toContain("Gateway „nix“ gibt es nicht: die Route hängt dort an keinem Tor.");
  });
  test("Gateway später gelöscht: die Route bleibt, der Hinweis erscheint", () => {
    apply("r.yaml", RT(VOLL));
    run("delete gateway tor");
    expect(sim.httpRoutes).toHaveLength(1);
    expect(out("describe httproute r")).toContain("an keinem Tor");
  });
  test("Gateway mit nicht angenommener Klasse: anderer Hinweis", () => {
    apply("g2.yaml", GW.replace("name: tor", "name: fremd").replace("gatewayClassName: envoy", "gatewayClassName: gibtsnicht"));
    apply("r.yaml", RT(VOLL.replace("name: tor", "name: fremd")));
    expect(out("describe httproute r")).toContain("keine angenommene GatewayClass");
  });
  test("Route ohne parentRefs: eigener Hinweis", () => {
    apply("r.yaml", RT("  rules: []\n"));
    expect(out("describe httproute r")).toContain("Ohne parentRefs hängt die Route an keinem Tor.");
  });
  test("describe: unbekannter Name ist NotFound", () => {
    expect(run("describe httproute nix").error).toBe(true);
  });
  test("describe gateway zeigt Attached Routes je Listener", () => {
    expect(out("describe gateway tor")).toMatch(/Attached Routes:\s+0/);
    apply("r.yaml", RT(VOLL));
    apply("r2.yaml", RT(VOLL, "r2"));
    expect(out("describe gateway tor")).toMatch(/Attached Routes:\s+2/);
  });
});

describe("delete httproute", () => {
  test("per Name und per -f, ein zweites Löschen ist NotFound", () => {
    apply("r.yaml", RT(VOLL));
    expect(out("delete httproute r")).toBe('httproute.gateway.networking.k8s.io "r" deleted');
    expect(sim.httpRoutes).toEqual([]);
    apply("r.yaml", RT(VOLL));
    expect(out("delete -f r.yaml")).toBe('httproute.gateway.networking.k8s.io "r" deleted');
    expect(run("delete httproute r").error).toBe(true);
  });
});

describe("get httproute -o yaml", () => {
  const ROUND = [
    ["Exact bleibt Exact", VOLL],
    ["Default-Regel", "  parentRefs:\n    - name: tor\n"],
    ["rules leer", "  parentRefs:\n    - name: tor\n  rules: []\n"],
    ["mehrere Regeln und Backends", "  parentRefs:\n    - name: tor\n    - name: zwei\n  rules:\n    - backendRefs:\n        - name: a\n          port: 1\n        - name: b\n          port: 2\n    - matches:\n        - path:\n            type: Exact\n            value: /x\n"],
  ] as const;
  test.each(ROUND)("%s: Mapper(Ausgabe) = Mapper(Original)", (_n, spec) => {
    apply("r.yaml", RT(spec));
    expect(effectsFromManifest(out("get httproute r -o yaml"), "b.yaml")).toEqual(effectsFromManifest(RT(spec), "a.yaml"));
  });
  test("Status: Parent-Conditions nur mit vorhandenem Gateway, attachedRoutes im Gateway-Status", () => {
    apply("c.yaml", CLS);
    apply("g.yaml", GW);
    apply("r.yaml", RT(VOLL));
    const y = out("get httproute r -o yaml");
    expect(y).toContain("controllerName: " + SIM_GATEWAY_CONTROLLER);
    expect(y).toContain("type: ResolvedRefs");
    expect(y).toContain("reason: BackendNotFound");
    expect(out("get gateway tor -o yaml")).toMatch(/attachedRoutes: 1/);
    run("delete gateway tor");
    expect(out("get httproute r -o yaml")).not.toContain("type: Accepted");
  });
  test("Exact überlebt, PathPrefix bleibt PathPrefix (kein stilles Umschreiben)", () => {
    apply("r.yaml", RT(VOLL));
    expect(out("get httproute r -o yaml")).toContain("type: Exact");
    apply("r.yaml", RT(VOLL.replace("Exact", "PathPrefix")));
    expect(out("get httproute r -o yaml")).toContain("type: PathPrefix");
  });
});

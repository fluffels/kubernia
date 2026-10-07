/* Wortlaut der Namespace-Ausgaben (#1417): helm, describe, Events und der PV-Claim nennen
 * den Default-Namespace so, wie echtes kubectl/helm es tut. Schützt vor stillem Drift,
 * wenn die Konstante DEFAULT_NAMESPACE oder einer der Ausgabetexte angefasst wird. */
import { describe, test, expect } from "vitest";
import { KQSim } from "./helpers";
import { DEFAULT_NAMESPACE, type Scenario } from "../../src/sim/state";

const scenario: Scenario = {
  deployments: [{ name: "web", image: "web:1", replicas: 1 }],
  services: [{ name: "kasse", type: "ClusterIP", clusterIP: "10.96.0.1", port: 80 }],
  ingresses: [{ name: "tor", className: "nginx", host: "h.de", path: "/", service: "kasse", port: 80 }],
  networkPolicies: [{ name: "deny-all", podSelector: "", allowFrom: "" }],
  serviceAccounts: ["ada"],
  roles: [{ name: "leser", rules: [{ verbs: ["get"], resources: ["pods"] }] }],
  storageClasses: [{ name: "fast", isDefault: true }],
  pvcs: [{ name: "daten", storage: "1Gi", storageClass: "fast" }],
};

describe("Namespace-Wortlaut", () => {
  test("Default-Namespace heißt default", () => {
    expect(DEFAULT_NAMESPACE).toBe("default");
  });

  test.each([
    ["describe ingress tor", "Namespace:        default"],
    ["describe networkpolicy deny-all", "Namespace:    default"],
    ["describe role leser", "Namespace:    default"],
    ["describe serviceaccount ada", "Namespace:    default"],
  ])("kubectl %s nennt den Namespace", (cmd, zeile) => {
    expect(new KQSim(scenario).exec("kubectl " + cmd).output).toContain(zeile);
  });

  test("describe pod nennt Namespace und Scheduled-Event mit default/<pod>", () => {
    const sim = new KQSim(scenario);
    const pod = sim.deployments[0].pods[0].name;
    const out = sim.exec("kubectl describe pod " + pod).output ?? "";
    expect(out).toContain("Namespace:    default");
    expect(out).toContain("Successfully assigned default/" + pod);
  });

  test("helm install/list/status nennen den Namespace default", () => {
    const sim = new KQSim(scenario);
    sim.exec("helm repo add bitnami https://charts.bitnami.com/bitnami");
    expect(sim.exec("helm install rel bitnami/nginx").output).toContain("NAMESPACE: default");
    expect(sim.exec("helm status rel").output).toContain("NAMESPACE: default");
    expect(sim.exec("helm list").output).toMatch(/rel\s+default\s+1\s+deployed/);
  });

  test("PV-Claim trägt den Default-Namespace als Präfix", () => {
    const sim = new KQSim(scenario);
    const claims = sim.pvs.map(p => p.claim).filter(Boolean);
    expect(claims.length).toBeGreaterThan(0);
    for (const c of claims) expect(c).toBe(DEFAULT_NAMESPACE + "/daten");
  });
});

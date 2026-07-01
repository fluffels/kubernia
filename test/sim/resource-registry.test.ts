/* Resource-Registry (#499): die „einfach additiven" Ressourcentypen (services/ingresses/
 * networkPolicies/serviceMonitors/prometheusRules/grafana*) laufen in reset(), mergeScenario()
 * und snapshot() über EINE Registry statt drei triplizierter Blöcke. Diese Tests sichern das
 * beobachtbare Verhalten der drei Wege ab: Seeden aus dem Szenario, additives Einmischen (per
 * `.name` dedupliziert) und der verlustfreie snapshot→reset-Roundtrip. Die restlichen (nicht
 * registry-getriebenen) Ressourcen prüfen die bestehenden Familien-Tests. */
import { describe, test, expect } from "vitest";
import { KQSim } from "./helpers";
import type { Scenario } from "../../src/sim/state";

const scenario: Scenario = {
  services: [{ name: "kasse", type: "ClusterIP", clusterIP: "10.96.0.1", port: 80 }],
  ingresses: [{ name: "tor", className: "nginx", host: "hafen.de", path: "/", service: "kasse", port: 80 }],
  networkPolicies: [{ name: "deny-all", podSelector: "", allowFrom: "" }],
  serviceMonitors: [{ name: "kasse-mon", selector: "app=kasse", port: "metrics", interval: "30s" }],
  prometheusRules: [{ name: "kasse-rule", alert: "Down", expr: "up==0", forDuration: "5m", severity: "warning" }],
  grafanaDatasources: [{ name: "prom", dsType: "prometheus", url: "http://prom" }],
  grafanaDashboards: [{ name: "board", title: "Hafen", panels: 3 }],
};

describe("Resource-Registry – reset() seedet aus dem Szenario", () => {
  test("alle sieben einfachen Typen werden übernommen", () => {
    const sim = new KQSim(scenario);
    expect(sim.services.map(s => s.name)).toEqual(["kasse"]);
    expect(sim.ingresses.map(i => i.name)).toEqual(["tor"]);
    expect(sim.networkPolicies.map(n => n.name)).toEqual(["deny-all"]);
    expect(sim.serviceMonitors.map(s => s.name)).toEqual(["kasse-mon"]);
    expect(sim.prometheusRules.map(r => r.name)).toEqual(["kasse-rule"]);
    expect(sim.grafanaDatasources.map(d => d.name)).toEqual(["prom"]);
    expect(sim.grafanaDashboards.map(d => d.name)).toEqual(["board"]);
  });

  test("Klon, keine geteilte Referenz auf die Szenario-Spec", () => {
    const sim = new KQSim(scenario);
    sim.services[0].clusterIP = "10.96.9.9";
    expect(scenario.services![0].clusterIP).toBe("10.96.0.1"); // Original unberührt
  });
});

describe("Resource-Registry – mergeScenario() ist additiv + dedupliziert per .name", () => {
  test("neuer Service kommt dazu, vorhandener wird nicht dupliziert", () => {
    const sim = new KQSim(scenario);
    sim.mergeScenario({
      services: [
        { name: "kasse", type: "ClusterIP", clusterIP: "10.96.5.5", port: 8080 }, // schon da → ignorieren
        { name: "lager", type: "ClusterIP", clusterIP: "10.96.0.2", port: 80 },    // neu → anhängen
      ],
    });
    expect(sim.services.map(s => s.name)).toEqual(["kasse", "lager"]);
    // Der bestehende „kasse" bleibt unverändert (nicht überschrieben).
    expect(sim.services.find(s => s.name === "kasse")!.port).toBe(80);
  });
});

describe("Resource-Registry – snapshot→reset-Roundtrip ist verlustfrei", () => {
  test("alle sieben Typen überleben den Reload identisch", () => {
    const sim = new KQSim(scenario);
    const restored = new KQSim(JSON.parse(JSON.stringify(sim.snapshot())));
    for (const key of ["services", "ingresses", "networkPolicies", "serviceMonitors", "prometheusRules", "grafanaDatasources", "grafanaDashboards"] as const) {
      expect(restored[key]).toEqual(sim[key]);
    }
  });
});

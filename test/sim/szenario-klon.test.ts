/* Szenario, Zustand und Snapshot teilen keine verschachtelten Objekte (#1686): `reset()` und
 * `mergeScenario()` kopieren die einfachen Ressourcen-Listen tief. Ein Eingriff in den Zustand
 * (z.B. ein Listener per `apply`) darf das Szenario nicht verändern, sonst stellt `reset()` den
 * veränderten Stand wieder her. */
import { describe, test, expect } from "vitest";
import { KQSim } from "./helpers";
import type { Scenario } from "../../src/sim/state";
import { SIM_GATEWAY_CONTROLLER } from "../../src/sim/gateway";

const szenario = (): Scenario => ({
  gatewayClasses: [{ name: "envoy", controllerName: SIM_GATEWAY_CONTROLLER }],
  gateways: [{ name: "tor", className: "envoy", listeners: [{ name: "http", port: 80, protocol: "HTTP" }] }],
  ingresses: [{ name: "web", className: "nginx", host: "a.de", path: "/", service: "web", port: 80, tls: { secretName: "x" } }],
});

describe("tiefe Kopie der einfachen Ressourcen", () => {
  test("reset: ein Eingriff in den Zustand ändert das Szenario nicht (Gateway-Listener, Ingress-tls)", () => {
    const sc = szenario();
    const sim = new KQSim(sc);
    sim.gateways[0].listeners.push({ name: "neu", port: 81, protocol: "HTTP" });
    sim.ingresses[0].tls!.secretName = "y";
    expect(sc).toEqual(szenario());
    sim.reset();
    expect(sim.gateways[0].listeners.map(l => l.name)).toEqual(["http"]);
    expect(sim.ingresses[0].tls?.secretName).toBe("x");
  });
  test("snapshot: eine spätere Zustandsänderung verändert den Snapshot nicht", () => {
    const sim = new KQSim(szenario());
    const snap = sim.snapshot();
    const vorher = JSON.stringify(snap);
    sim.gateways[0].listeners.push({ name: "neu", port: 81, protocol: "HTTP" });
    sim.ingresses[0].tls!.secretName = "y";
    expect(JSON.stringify(snap)).toBe(vorher);
  });
  test("mergeScenario: das gemergte Szenario teilt nichts mit dem Zustand", () => {
    const sim = new KQSim({});
    const sc = szenario();
    sim.mergeScenario(sc);
    sim.gateways[0].listeners.push({ name: "neu", port: 81, protocol: "HTTP" });
    sim.ingresses[0].tls!.secretName = "y";
    expect(sc).toEqual(szenario());
  });
  test("der Snapshot bleibt per structuredClone kopierbar (nur Daten, keine Funktionen)", () => {
    const sim = new KQSim(szenario());
    expect(() => structuredClone(sim.snapshot())).not.toThrow();
  });
});

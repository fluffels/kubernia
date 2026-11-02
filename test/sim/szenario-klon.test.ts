/* Szenario, Zustand und Snapshot teilen keine verschachtelten Objekte (#1686): `reset()` und
 * `mergeScenario()` kopieren die einfachen Ressourcen-Listen tief. Ein Eingriff in den Zustand
 * (z.B. ein Listener per `apply`) darf das Szenario nicht verändern, sonst stellt `reset()` den
 * veränderten Stand wieder her. */
import { describe, test, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
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

/* #1751: auch Secret-/ConfigMap-Keys und applyEffects sind tief entkoppelt. */
const reich = (): Scenario => ({
  secrets: [{ name: "s", keys: ["a"] }],
  configMaps: [{ name: "c", keys: ["a"] }],
  applyEffects: { "a.yaml": { deployment: { name: "web", image: "nginx", replicas: 2 } } },
});

describe("tiefe Kopie: Keys und applyEffects", () => {
  test("reset: Eingriffe in secrets-/configMaps-Keys und applyEffects ändern das Szenario nicht", () => {
    const sc = reich();
    const sim = new KQSim(sc);
    sim.secrets[0].keys.push("x");
    sim.configMaps[0].keys.push("x");
    sim.applyEffects["a.yaml"].deployment!.replicas = 9;
    expect(sc).toEqual(reich());
    sim.reset();
    expect(sim.applyEffects["a.yaml"].deployment!.replicas).toBe(2);
    expect(sim.secrets[0].keys).toEqual(["a"]);
  });
  test("mergeScenario: das gemergte Szenario teilt configMaps-Keys und applyEffects nicht mit dem Zustand", () => {
    const sim = new KQSim({});
    const sc = reich();
    sim.mergeScenario(sc);
    sim.configMaps[0].keys.push("x");
    sim.applyEffects["a.yaml"].deployment!.replicas = 9;
    expect(sc).toEqual(reich());
  });
  test("snapshot: spätere Änderungen an Keys und applyEffects verändern den Snapshot nicht", () => {
    const sim = new KQSim(reich());
    const snap = sim.snapshot();
    const vorher = JSON.stringify(snap);
    sim.secrets[0].keys.push("x");
    sim.applyEffects["a.yaml"].deployment!.replicas = 9;
    expect(JSON.stringify(snap)).toBe(vorher);
  });
});

/* Fitness (#1751): src/sim.ts kopiert Ressourcen mit EINER Strategie (`structuredClone`). Der
 * Wächter kennt eine geschlossene Musterliste (`Object.assign({}` und die JSON-Rundreise) in
 * `src/sim.ts`; Spread-Kopien und Merge-Into (`Object.assign(ziel, quelle)`) deckt das
 * Verhaltens-Set oben ab, `src/sim/**` ist nicht erfasst. */
const FLACHE_KOPIE = [/Object\.assign\(\s*\{\s*\}/, /JSON\.parse\(\s*JSON\.stringify\(/];
export function flacheKopien(quelltext: string): string[] {
  return quelltext.split("\n")
    .map((z, i) => ({ z: z.trim(), n: i + 1 }))
    .filter(({ z }) => !/^(\/\/|\/\*|\*)/.test(z) && FLACHE_KOPIE.some(re => re.test(z)))
    .map(({ z, n }) => `${n}: ${z.slice(0, 80)}`);
}

describe("Fitness: eine Klon-Strategie in src/sim.ts", () => {
  test("src/sim.ts enthält keine flache Kopie (Object.assign({}, …), JSON-Rundreise)", () => {
    const text = readFileSync(join(__dirname, "../../src/sim.ts"), "utf8");
    expect(flacheKopien(text)).toEqual([]);
  });
  test("Selbsttest: Code-Treffer zählen, Kommentarzeilen nicht", () => {
    const beispiel = [
      "// Object.assign({}, x) im Kommentar",
      " * JSON.parse(JSON.stringify(x))",
      "const a = Object.assign({}, x);",
      "const b = JSON.parse(JSON.stringify(x));",
      "Object.assign(ziel, quelle);",
      "const c = structuredClone(x);",
    ].join("\n");
    expect(flacheKopien(beispiel)).toHaveLength(2);
  });
});

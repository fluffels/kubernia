/* Sim-Tests (#1334): erneutes `kubectl apply -f` gleicht auch nodeName, emptyDir und initContainer ab
 * (Änderung → configured + übernommen + Rollout, sonst unchanged). `ephemeralUsedMi` und der
 * emptyDir-INHALT sind Laufzeitwerte (jeder Rollout setzt sie auf 0) und werden bewusst NICHT
 * verglichen – sonst wäre ein Re-apply nach `rollout restart` nie idempotent. */
import { test, beforeEach, expect, describe } from "vitest";
import { KQSim, freshSim } from "./helpers";
import { MEM_HEALED_NOTE, CPU_THROTTLED_NOTE } from "../../src/sim/workload";
import { deploymentYaml, type DeploymentYamlOpts } from "../factories/manifests";

let sim: KQSim;
beforeEach(() => { sim = freshSim(); });

const apply = (o: DeploymentYamlOpts) => {
  sim.files["web.yaml"] = deploymentYaml(o);
  return sim.exec("kubectl apply -f web.yaml");
};
const web = () => sim.deployments.find(d => d.name === "web")!;
const podNames = () => web().pods.map(p => p.name);

describe("nodeName", () => {
  test("Wechsel → configured, übernommen, Pods ersetzt", () => {
    apply({ name: "web", nodeName: "ahoi-worker-1" });
    const before = podNames();
    expect(apply({ name: "web", nodeName: "ahoi-worker-2" }).output).toMatch(/^deployment\.apps\/web configured$/m);
    expect(web().node).toBe("ahoi-worker-2");
    expect(podNames()).not.toEqual(before);
  });
  test("gleicher nodeName → unchanged, gleiche Pods; fehlender nodeName behält den Pin", () => {
    apply({ name: "web", nodeName: "ahoi-worker-1" });
    const before = podNames();
    expect(apply({ name: "web", nodeName: "ahoi-worker-1" }).output).toMatch(/unchanged/);
    expect(apply({ name: "web" }).output).toMatch(/unchanged/);
    expect(web().node).toBe("ahoi-worker-1");
    expect(podNames()).toEqual(before);
  });
});

describe("emptyDir", () => {
  test("neu deklariert → configured, Volume leer, Pods ersetzt", () => {
    apply({ name: "web" });
    const before = podNames();
    expect(apply({ name: "web", emptyDir: true }).output).toMatch(/configured/);
    expect(web().emptyDir).toStrictEqual({ data: "", usedMi: 0 });
    expect(podNames()).not.toEqual(before);
  });
  test("vorhandenes Volume (Inhalt per Rollout geleert) → Re-apply unchanged, Pods bleiben", () => {
    sim.applyEffects["web.yaml"] = { deployment: { name: "web", image: "nginx", replicas: 1, emptyDir: { data: "alt", usedMi: 50 } } };
    apply({ name: "web", emptyDir: true });
    expect(web().emptyDir).toStrictEqual({ data: "alt", usedMi: 50 });
    sim.exec("kubectl rollout restart deployment web");
    expect(web().emptyDir).toStrictEqual({ data: "", usedMi: 0 });
    const before = podNames();
    expect(apply({ name: "web", emptyDir: true }).output).toMatch(/unchanged/);
    expect(web().emptyDir).toStrictEqual({ data: "", usedMi: 0 });
    expect(podNames()).toEqual(before);
  });
  test("fehlt emptyDir im Manifest, bleibt das Volume", () => {
    apply({ name: "web", emptyDir: true });
    expect(apply({ name: "web" }).output).toMatch(/unchanged/);
    expect(web().emptyDir).toBeDefined();
  });
});

describe("initContainer", () => {
  const effect = (doubleStage: boolean) => {
    sim.applyEffects["web.yaml"] = { deployment: { name: "web", image: "nginx", replicas: 1, initContainer: { fillsMi: 300, doubleStage } } };
  };
  test("Doppelablage per Re-apply abgestellt → configured, Init-Peak halbiert", () => {
    effect(true);
    apply({ name: "web", initContainer: true });
    expect(web().initContainer).toStrictEqual({ fillsMi: 300, doubleStage: true });
    effect(false);
    expect(apply({ name: "web", initContainer: true }).output).toMatch(/configured/);
    expect(web().initContainer).toStrictEqual({ fillsMi: 300, doubleStage: false });
  });
  test("identisch → unchanged; ohne initContainers im Manifest bleibt er", () => {
    effect(true);
    apply({ name: "web", initContainer: true });
    const before = podNames();
    expect(apply({ name: "web", initContainer: true }).output).toMatch(/unchanged/);
    expect(apply({ name: "web" }).output).toMatch(/unchanged/);
    expect(web().initContainer).toStrictEqual({ fillsMi: 300, doubleStage: true });
    expect(podNames()).toEqual(before);
  });
});

describe("ephemeralUsedMi (Laufzeitwert, kein Abgleich)", () => {
  test("Anlegen setzt den Startwert; nach rollout restart 0 und ein Re-apply bleibt unchanged", () => {
    sim.applyEffects["web.yaml"] = { deployment: { name: "web", image: "nginx", replicas: 1, ephemeralUsedMi: 100 } };
    apply({ name: "web" });
    expect(web().ephemeralUsedMi).toBe(100);
    sim.exec("kubectl rollout restart deployment web");
    expect(web().ephemeralUsedMi).toBe(0);
    const before = podNames();
    expect(apply({ name: "web" }).output).toMatch(/unchanged/);
    expect(web().ephemeralUsedMi).toBe(0);
    expect(podNames()).toEqual(before);
  });
  test("ein Image-Wechsel rollt aus und setzt den Wert auf 0, füllt ihn nicht neu", () => {
    sim.applyEffects["web.yaml"] = { deployment: { name: "web", image: "nginx", replicas: 1, ephemeralUsedMi: 100 } };
    apply({ name: "web" });
    sim.applyEffects["web.yaml"] = { deployment: { name: "web", image: "nginx:1.28", replicas: 1, ephemeralUsedMi: 100 } };
    expect(apply({ name: "web", image: "nginx:1.28" }).output).toMatch(/configured/);
    expect(web().ephemeralUsedMi).toBe(0);
  });
});

describe("Heil-Notizen in der apply-Ausgabe (Wortlaut)", () => {
  test("memory heilt OOMKilled → MEM_HEALED_NOTE", () => {
    sim.mergeScenario({ deployments: [{ name: "web", image: "nginx", replicas: 1, broken: { type: "oomkilled", memNeeded: 256 } }] });
    expect(apply({ name: "web", memoryLimit: "256Mi" }).output).toContain(MEM_HEALED_NOTE);
  });
  test("cpu unter 500m drosselt cpuHeavy → CPU_THROTTLED_NOTE; sonst keine Notiz", () => {
    sim.mergeScenario({ deployments: [{ name: "web", image: "nginx", replicas: 1, cpuHeavy: true }] });
    expect(apply({ name: "web", cpuLimit: "800m" }).output).not.toContain(CPU_THROTTLED_NOTE);
    expect(apply({ name: "web", cpuLimit: "250m" }).output).toContain(CPU_THROTTLED_NOTE);
  });
});

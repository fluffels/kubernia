/* Sim-Tests (#1327): Alle kubectl-Befehle, die Deployment-Pods erzeugen (apply, set image, scale,
 * rollout restart, set resources-Heilung), gehen über EINEN Weg: erst die Pod-Security-Admission,
 * dann die Mutation, dann der Rollout. Fahren über sim.exec. */
import { test, beforeEach, expect, describe } from "vitest";
import { KQSim, freshSim } from "./helpers";
import { deploymentYaml } from "../factories/manifests";

let sim: KQSim;
beforeEach(() => { sim = freshSim(); });

const dep = () => sim.deployments.find(d => d.name === "web")!;
const pods = () => dep().pods.map(p => p.name);
const level = (l: string) => sim.exec("kubectl label namespace default pod-security.kubernetes.io/enforce=" + l);
const make = (replicas = 1, hardened = false) => {
  level("privileged");
  sim.files["web.yaml"] = deploymentYaml({ name: "web", replicas, ...(hardened ? { securityContext: { runAsNonRoot: true, allowPrivilegeEscalation: false } } : {}) });
  sim.exec("kubectl apply -f web.yaml");
};

describe("set image", () => {
  test("anderes Image rollt neue Pods aus", () => {
    make();
    const before = pods();
    const r = sim.exec("kubectl set image deployment/web web=nginx:9");
    expect(r.error).toBeFalsy();
    expect(dep().image).toBe("nginx:9");
    expect(pods()).not.toEqual(before);
  });
  test("gleiches Image: kein Rollout", () => {
    make();
    const before = pods();
    sim.exec("kubectl set image deployment/web web=" + dep().image);
    expect(pods()).toEqual(before);
  });
  test("unter restricted ungehärtet: Forbidden, nichts geändert", () => {
    make();
    const img = dep().image;
    const before = pods();
    level("restricted");
    const r = sim.exec("kubectl set image deployment/web web=nginx:9");
    expect(r.error).toBe(true);
    expect(r.output).toMatch(/Forbidden/);
    expect(dep().image).toBe(img);
    expect(pods()).toEqual(before);
  });
  test("unter restricted gehärtet: erlaubt", () => {
    make(1, true);
    level("restricted");
    const before = pods();
    expect(sim.exec("kubectl set image deployment/web web=nginx:9").error).toBeFalsy();
    expect(pods()).not.toEqual(before);
  });
});

describe("scale", () => {
  test("hoch unter restricted ungehärtet: Forbidden, Zustand unverändert", () => {
    make(2);
    level("restricted");
    const before = pods();
    const r = sim.exec("kubectl scale deployment web --replicas=4");
    expect(r.error).toBe(true);
    expect(r.output).toMatch(/Forbidden/);
    expect(r.output).toMatch(/runAsNonRoot/);
    expect(dep().replicas).toBe(2);
    expect(pods()).toEqual(before);
  });
  test("runter ohne Prüfung, gleiche Zahl ok", () => {
    make(3);
    level("restricted");
    expect(sim.exec("kubectl scale deployment web --replicas=3").error).toBeFalsy();
    expect(sim.exec("kubectl scale deployment web --replicas=1").error).toBeFalsy();
    expect(dep().replicas).toBe(1);
  });
  test("gehärtet hoch unter restricted: ok", () => {
    make(1, true);
    level("restricted");
    expect(sim.exec("kubectl scale deployment web --replicas=3").error).toBeFalsy();
    expect(dep().replicas).toBe(3);
  });
  test("baseline: privileged wird abgewiesen, schlichtes Deployment erlaubt", () => {
    make();
    level("baseline");
    expect(sim.exec("kubectl scale deployment web --replicas=2").error).toBeFalsy();
    dep().securityContext = { privileged: true };
    expect(sim.exec("kubectl scale deployment web --replicas=3").error).toBe(true);
    expect(dep().replicas).toBe(2);
  });
});

describe("rollout restart", () => {
  test("unter restricted ungehärtet: Forbidden, nichts geheilt", () => {
    make();
    sim.secrets.push({ name: "db", data: {} } as never);
    dep().broken = { type: "crashloop", needsSecret: "db" } as never;
    dep().emptyDir = { data: "x", usedMi: 5 };
    const before = pods();
    level("restricted");
    const r = sim.exec("kubectl rollout restart deployment web");
    expect(r.error).toBe(true);
    expect(r.output).toMatch(/Forbidden/);
    expect(pods()).toEqual(before);
    expect(dep().broken).not.toBeNull();
    expect(dep().emptyDir?.usedMi).toBe(5);
  });
  test("gehärtet: neue Pods", () => {
    make(1, true);
    level("restricted");
    const before = pods();
    expect(sim.exec("kubectl rollout restart deployment web").error).toBeFalsy();
    expect(pods()).not.toEqual(before);
  });
});

describe("set resources", () => {
  test("OOM-Heilung unter restricted ungehärtet: Forbidden, nichts verändert", () => {
    make();
    dep().broken = { type: "oomkilled", memNeeded: 256 } as never;
    dep().memLimit = 64;
    level("restricted");
    const r = sim.exec("kubectl set resources deployment/web --limits=memory=512Mi");
    expect(r.error).toBe(true);
    expect(r.output).toMatch(/Forbidden/);
    expect(dep().memLimit).toBe(64);
    expect(dep().broken).not.toBeNull();
  });
  test("ohne Heilung (kein Rollout) wird nicht geprüft", () => {
    make();
    level("restricted");
    expect(sim.exec("kubectl set resources deployment/web --limits=memory=512Mi").error).toBeFalsy();
  });
  test("ungültiges ephemeral-Limit zusammen mit gültigem memory: Fehler, keine Teil-Mutation", () => {
    make();
    const mem = dep().memLimit;
    const r = sim.exec("kubectl set resources deployment/web --limits=memory=512Mi,ephemeral-storage=0Mi");
    if (r.error) expect(dep().memLimit).toBe(mem);
  });
});

test("Fitness: in src/sim/kubectl/ erzeugt nur rollout.ts Pods (replacePods/scaleDeployment/admitPod)", async () => {
  const { readdirSync, readFileSync } = await import("node:fs");
  const dir = "src/sim/kubectl";
  for (const f of readdirSync(dir).filter(x => x.endsWith(".ts") && x !== "rollout.ts" && x !== "security.ts")) {
    const code = readFileSync(dir + "/" + f, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    expect(code, f).not.toMatch(/\b(replacePods|scaleDeployment|admitPod)\b/);
  }
});

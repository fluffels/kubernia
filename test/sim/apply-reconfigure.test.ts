/* Sim-Tests (#1300): erneutes `kubectl apply -f` auf ein BESTEHENDES Deployment übernimmt die
 * Pod-Template-Felder image, containerPort, securityContext und resources.limits (memory/cpu/
 * ephemeral-storage) und meldet `configured` (mit Rollout); ohne Änderung bleibt es `unchanged`.
 * Fahren über sim.exec, Manifeste über die Factory (`deploymentYaml`). */
import { test, beforeEach, expect, describe } from "vitest";
import { KQSim, freshSim } from "./helpers";
import { KQContent } from "../../src/content";
import { deploymentYaml, type DeploymentYamlOpts } from "../factories/manifests";

let sim: KQSim;
beforeEach(() => { sim = freshSim(); });

const apply = (o: DeploymentYamlOpts) => {
  sim.files["web.yaml"] = deploymentYaml(o);
  return sim.exec("kubectl apply -f web.yaml");
};
const web = () => sim.deployments.find(d => d.name === "web")!;
const podNames = () => web().pods.map(p => p.name);

describe("jedes Feld: configured + übernommen + Rollout", () => {
  test("image", () => {
    apply({ name: "web", image: "nginx:1.27" });
    const before = podNames();
    const r = apply({ name: "web", image: "nginx:1.28" });
    expect(r.output).toMatch(/^deployment\.apps\/web configured$/m);
    expect(web().image).toBe("nginx:1.28");
    expect(podNames()).not.toEqual(before);
  });

  test("containerPort: ohne → 8080 → 9090", () => {
    apply({ name: "web" });
    expect(apply({ name: "web", containerPort: 8080 }).output).toMatch(/configured/);
    expect(web().containerPort).toBe(8080);
    expect(apply({ name: "web", containerPort: 9090 }).output).toMatch(/configured/);
    expect(web().containerPort).toBe(9090);
  });

  test("securityContext: ohne → gehärtet; fehlt er im Manifest, ist er wieder weg", () => {
    apply({ name: "web" });
    expect(apply({ name: "web", securityContext: { runAsNonRoot: true, allowPrivilegeEscalation: false } }).output).toMatch(/configured/);
    expect(web().securityContext).toStrictEqual({ runAsNonRoot: true, allowPrivilegeEscalation: false });
    expect(apply({ name: "web" }).output).toMatch(/configured/);
    expect(web().securityContext).toBeUndefined();
  });

  test("securityContext: ein einzelner geänderter Wert zählt", () => {
    apply({ name: "web", securityContext: { runAsNonRoot: true } });
    expect(apply({ name: "web", securityContext: { runAsNonRoot: false } }).output).toMatch(/configured/);
    expect(web().securityContext).toStrictEqual({ runAsNonRoot: false });
  });

  test("memory-Limit", () => {
    apply({ name: "web", memoryLimit: "256Mi" });
    expect(web().memLimit).toBe(256);
    expect(apply({ name: "web", memoryLimit: "512Mi" }).output).toMatch(/configured/);
    expect(web().memLimit).toBe(512);
  });

  test("cpu-Limit: 250m, dann 0.5 Cores", () => {
    apply({ name: "web", cpuLimit: "250m" });
    expect(web().cpuLimitMilli).toBe(250);
    expect(apply({ name: "web", cpuLimit: 0.5 }).output).toMatch(/configured/);
    expect(web().cpuLimitMilli).toBe(500);
  });

  test("ephemeral-storage-Limit", () => {
    apply({ name: "web", ephemeralLimitMi: 256 });
    expect(apply({ name: "web", ephemeralLimitMi: 512 }).output).toMatch(/configured/);
    expect(web().ephemeralLimit).toBe(512);
  });

  test("mehrere Felder auf einmal: genau eine configured-Zeile, ein Rollout", () => {
    apply({ name: "web" });
    const r = apply({ name: "web", image: "nginx:2", containerPort: 81, memoryLimit: "128Mi", cpuLimit: "100m" });
    expect(r.output!.match(/configured/g)).toHaveLength(1);
    expect(web()).toMatchObject({ image: "nginx:2", containerPort: 81, memLimit: 128, cpuLimitMilli: 100 });
  });
});

describe("unverändert bleibt unchanged", () => {
  const full: DeploymentYamlOpts = {
    name: "web", image: "nginx:1.27", containerPort: 8080, memoryLimit: "256Mi", cpuLimit: "250m", ephemeralLimitMi: 256,
    securityContext: { runAsNonRoot: true },
  };
  test("dieselbe Datei zweimal: unchanged, gleiche Pods, keine Notiz", () => {
    apply(full);
    const before = podNames();
    const r = apply(full);
    expect(r.output).toBe("deployment.apps/web unchanged");
    expect(podNames()).toEqual(before);
  });

  test("Datei ohne Port/Limits über gesetzte Werte: unchanged, Werte bleiben (konservativ)", () => {
    apply(full);
    const r = apply({ name: "web", image: "nginx:1.27", securityContext: { runAsNonRoot: true } });
    expect(r.output).toBe("deployment.apps/web unchanged");
    expect(web()).toMatchObject({ containerPort: 8080, memLimit: 256, cpuLimitMilli: 250, ephemeralLimit: 256 });
  });

  test("per set resources gesetztes Limit, dann gleiche Datei: unchanged", () => {
    apply({ name: "web" });
    sim.exec("kubectl set resources deployment/web --limits=memory=256Mi");
    expect(apply({ name: "web", memoryLimit: "256Mi" }).output).toBe("deployment.apps/web unchanged");
  });

  test("nur replicas: configured ohne Rollout (Pod-Namen bleiben)", () => {
    apply({ name: "web", replicas: 2 });
    const before = podNames();
    const r = apply({ name: "web", replicas: 3 });
    expect(r.output).toMatch(/configured/);
    expect(web().pods).toHaveLength(3);
    expect(podNames().slice(0, 2)).toEqual(before);
  });
});

describe("Heilung über apply (Juno: kartograf)", () => {
  const scenarioOf = (quest: string, step: number) => KQContent.QUESTS.find(q => q.id === quest)!.steps[step].scenario!;
  const kartograf = () => sim.deployments.find(d => d.name === "kartograf")!;

  test("resources.yaml hebt memory auf 256Mi: configured, geheilt, Limits gespeichert", () => {
    sim.mergeScenario(scenarioOf("k8s-resource-limits", 1));
    sim.mergeScenario(scenarioOf("k8s-resource-limits", 3));
    expect(kartograf().broken?.type).toBe("oomkilled");
    const r = sim.exec("kubectl apply -f resources.yaml");
    expect(r.output!.split("\n")[0]).toBe("deployment.apps/kartograf configured");
    expect(r.output).toMatch(/Genug Speicher/);
    expect(kartograf().broken).toBeNull();
    expect(kartograf()).toMatchObject({ memLimit: 256, cpuLimitMilli: 250 });
    expect(sim.exec("kubectl apply -f resources.yaml").output).toBe("deployment.apps/kartograf unchanged");
  });

  test("ein zu kleines Limit (128Mi) ist configured, heilt aber nicht", () => {
    sim.mergeScenario(scenarioOf("k8s-resource-limits", 1));
    sim.files["klein.yaml"] = deploymentYaml({ name: "kartograf", image: "nginx", memoryLimit: "128Mi" });
    const r = sim.exec("kubectl apply -f klein.yaml");
    expect(r.output).toMatch(/configured/);
    expect(r.output).not.toMatch(/Genug Speicher/);
    expect(kartograf().broken?.type).toBe("oomkilled");
    expect(kartograf().memLimit).toBe(128);
  });

  test("cpuHeavy: cpu-Limit unter 500m im Manifest drosselt die Dauerlast", () => {
    sim.mergeScenario({ deployments: [{ name: "web", image: "nginx", replicas: 1, cpuHeavy: true }] });
    expect(apply({ name: "web", image: "nginx", cpuLimit: "500m" }).output).not.toMatch(/gedrosselt/);
    expect(web().cpuHeavy).toBe(true);
    expect(apply({ name: "web", image: "nginx", cpuLimit: "200m" }).output).toMatch(/gedrosselt/);
    expect(web().cpuHeavy).toBe(false);
  });

  test("image: ein anderes Image als das kaputte heilt imagepull", () => {
    sim.mergeScenario({ deployments: [{ name: "web", image: "ngnix", replicas: 1, broken: { type: "imagepull", badImage: "ngnix" } }] });
    const r = apply({ name: "web", image: "nginx" });
    expect(r.output).toMatch(/configured/);
    expect(web().broken).toBeNull();
    expect(web().image).toBe("nginx");
  });

  test("image: das Manifest mit dem weiter kaputten Image heilt nicht", () => {
    sim.mergeScenario({ deployments: [{ name: "web", image: "ngnix", replicas: 1, broken: { type: "imagepull", badImage: "ngnix" } }] });
    expect(apply({ name: "web", image: "ngnix" }).output).toBe("deployment.apps/web unchanged");
    expect(web().broken).toMatchObject({ type: "imagepull" });
  });

  test("requireBuiltImage: nicht gebautes neues Image → ImagePullBackOff samt Bau-Hinweis", () => {
    sim.mergeScenario({
      files: { "web.yaml": deploymentYaml({ name: "web", image: "web:2" }) },
      applyEffects: { "web.yaml": { deployment: { name: "web", image: "web:2", replicas: 1, requireBuiltImage: true } } },
      deployments: [{ name: "web", image: "web:1", replicas: 1 }],
    });
    const r = sim.exec("kubectl apply -f web.yaml");
    expect(r.output).toMatch(/configured/);
    expect(r.output).toMatch(/docker build -t web:2/);
    expect(web().broken).toMatchObject({ type: "imagepull", badImage: "web:2", needsBuild: true });
  });
});

describe("Pod-Security beim Re-apply", () => {
  const restrict = () => sim.exec("kubectl label namespace default pod-security.kubernetes.io/enforce=restricted");
  const GOOD = { runAsNonRoot: true, allowPrivilegeEscalation: false, readOnlyRootFilesystem: true };

  test("unter restricted: privilegierte Änderung wird abgewiesen, nichts übernommen", () => {
    apply({ name: "web", image: "nginx:1", securityContext: { privileged: true } });
    restrict();
    const before = JSON.stringify(sim.deployments);
    const r = apply({ name: "web", image: "nginx:2", securityContext: { privileged: true } });
    expect(r.error).toBe(true);
    expect(r.output).toMatch(/Forbidden/);
    expect(JSON.stringify(sim.deployments)).toBe(before);
  });

  test("unter restricted: nur neues Image ohne securityContext wird ebenfalls abgewiesen", () => {
    apply({ name: "web", image: "nginx:1", securityContext: { privileged: true } });
    restrict();
    const r = apply({ name: "web", image: "nginx:2" });
    expect(r.error).toBe(true);
    expect(web().image).toBe("nginx:1");
    expect(web().securityContext).toStrictEqual({ privileged: true });
  });

  test("unter restricted: gehärtete Datei kommt durch", () => {
    apply({ name: "web", securityContext: { privileged: true } });
    restrict();
    const r = apply({ name: "web", securityContext: GOOD });
    expect(r.error).toBeFalsy();
    expect(r.output).toMatch(/configured/);
    expect(web().securityContext).toStrictEqual(GOOD);
  });

  test("unverändertes Re-apply des ungehärteten Bestands wird nicht geprüft", () => {
    apply({ name: "web", securityContext: { privileged: true } });
    restrict();
    const r = apply({ name: "web", securityContext: { privileged: true } });
    expect(r.error).toBeFalsy();
    expect(r.output).toBe("deployment.apps/web unchanged");
  });
});

test("ungültige Mengenangabe: Fehler und Zustand bleibt unangetastet", () => {
  apply({ name: "web" });
  sim.exec("kubectl get pods"); // Auswertung einmal laufen lassen, damit der Vorher-Stand vollständig ist
  const before = JSON.stringify(sim.deployments);
  const r = apply({ name: "web", memoryLimit: "viel" });
  expect(r.error).toBe(true);
  sim.exec("kubectl get pods");
  expect(JSON.stringify(sim.deployments)).toBe(before);
});

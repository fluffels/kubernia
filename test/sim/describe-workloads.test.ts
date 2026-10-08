/* describe für Deployment, Service, PVC und StatefulSet (#1465): Renderer, „ohne Namen“,
 * Namenspräfix und Negativfälle. Alles über die öffentliche Sim-API (`exec`). */
import { describe, test, expect } from "vitest";
import { KQSim } from "./helpers";
import { podIP } from "../../src/sim/util";
import { DESCRIBE_ENTRIES } from "../../src/sim/kubectl/describe";
import { RESOURCE_KINDS } from "../../src/sim/kubectl/resources";

const run = (sim: KQSim, cmd: string) => sim.exec("kubectl " + cmd);
const out = (sim: KQSim, cmd: string) => run(sim, cmd).output ?? "";
const sts = (extra: object = {}) => ({ name: "speicher", image: "postgres:16", replicas: 3, serviceName: "speicher", ...extra });
const dep = (name: string, extra: object = {}) => ({ name, image: "nginx:1", replicas: 2, ...extra });
const svc = (name: string, extra: object = {}) => ({ name, type: "ClusterIP", clusterIP: "10.96.0.20", port: 80, ...extra });
const EXTERNAL = "apiVersion: v1\nkind: Service\nmetadata:\n  name: bank\nspec:\n  type: ExternalName\n  externalName: api.bank.example.com\n";

describe("describe deployment", () => {
  const full = () => new KQSim({
    deployments: [dep("web", { containerPort: 8080, memLimit: 128, serviceAccountName: "robo", envFrom: { configMaps: ["cfg"], secrets: ["sek"] }, emptyDir: {} })],
  });

  test("gesund: Kopf, Replicas, Pod-Template, Conditions, Events", () => {
    const d = out(full(), "describe deploy web");
    expect(d).toMatch(/^Name:\s+web$/m);
    expect(d).toMatch(/^Namespace:\s+default$/m);
    expect(d).toMatch(/^Selector:\s+app=web$/m);
    expect(d).toMatch(/^Replicas:\s+2 desired \| 2 updated \| 2 total \| 2 available \| 0 unavailable$/m);
    expect(d).toMatch(/^StrategyType:\s+RollingUpdate$/m);
    expect(d).toMatch(/Image:\s+nginx:1/);
    expect(d).toMatch(/Port:\s+8080\/TCP/);
    expect(d).toMatch(/memory:\s+128Mi/);
    expect(d).toMatch(/Service Account:\s+robo/);
    expect(d).toMatch(/Environment Variables from:\n\s+cfg\s+ConfigMap\s+Optional: false\n\s+sek\s+Secret\s+Optional: false/);
    expect(d).toMatch(/EmptyDir/);
    expect(d).toMatch(/Available\s+True\s+MinimumReplicasAvailable/);
    expect(d).toMatch(/Progressing\s+True\s+NewReplicaSetAvailable/);
    expect(d).toMatch(/^Events:\s+<none>$/m);
  });

  test("ohne bereite Pods: 0 available, Available False, ReplicaSetUpdated", () => {
    const sim = new KQSim({ deployments: [dep("web", { broken: { type: "imagepull" } })] });
    const d = out(sim, "describe deploy web");
    expect(d).toMatch(/0 available \| 2 unavailable/);
    expect(d).toMatch(/Available\s+False\s+MinimumReplicasUnavailable/);
    expect(d).toMatch(/Progressing\s+True\s+ReplicaSetUpdated/);
  });

  test("0 Replicas: Available True, 0 unavailable", () => {
    const d = out(new KQSim({ deployments: [dep("web", { replicas: 0 })] }), "describe deploy web");
    expect(d).toMatch(/0 desired \| 0 updated \| 0 total \| 0 available \| 0 unavailable/);
    expect(d).toMatch(/Available\s+True\s+MinimumReplicasAvailable/);
  });

  test("nichts erfunden: ohne Port, Limits, Service Account, Volumes", () => {
    const d = out(new KQSim({ deployments: [dep("web")] }), "describe deploy web");
    expect(d).toMatch(/Port:\s+<none>/);
    expect(d).not.toMatch(/Limits:|Service Account:|Environment Variables from:|EmptyDir/);
    expect(d).toMatch(/Volumes:\s+<none>/);
  });

  test("Readiness wird nachgeführt: nach create secret ist das Deployment sofort available", () => {
    const sim = new KQSim({ deployments: [dep("web", { broken: { type: "notready", needsSecret: "sek" } })] });
    expect(out(sim, "describe deploy web")).toMatch(/0 available/);
    run(sim, "create secret generic sek --from-literal=a=b");
    expect(out(sim, "describe deploy web")).toMatch(/2 available \| 0 unavailable/);
  });
});

describe("describe service", () => {
  test("ClusterIP: Selector, IP, Port, TargetPort, Endpoints mit podIP:Zielport", () => {
    const sim = new KQSim({ deployments: [dep("web")], services: [svc("web", { targetPort: 8080 })] });
    const d = out(sim, "describe svc web");
    expect(d).toMatch(/^Selector:\s+app=web$/m);
    expect(d).toMatch(/^Type:\s+ClusterIP$/m);
    expect(d).toMatch(/^IP:\s+10\.96\.0\.20$/m);
    expect(d).toMatch(/^Port:\s+<unset>\s+80\/TCP$/m);
    expect(d).toMatch(/^TargetPort:\s+8080\/TCP$/m);
    for (const p of sim.deployments[0].pods) expect(d).toContain(podIP(p.name) + ":8080");
    expect(d).toMatch(/^Events:\s+<none>$/m);
  });

  test("ohne bereite Pods: Endpoints <none> (die Lern-Pointe)", () => {
    const sim = new KQSim({ deployments: [dep("web", { broken: { type: "notready", needsSecret: "sek" } })], services: [svc("web")] });
    expect(out(sim, "describe svc web")).toMatch(/^Endpoints:\s+<none>$/m);
  });

  test("headless vor StatefulSet: IP None, drei Endpoints, Selector app=<statefulset>", () => {
    const sim = new KQSim({ statefulSets: [sts()], services: [svc("speicher", { clusterIP: "None", port: 5432 })] });
    const d = out(sim, "describe service speicher");
    expect(d).toMatch(/^IP:\s+None$/m);
    expect(d).toMatch(/^Selector:\s+app=speicher$/m);
    for (const i of [0, 1, 2]) expect(d).toContain(podIP("speicher-" + i) + ":5432");
  });

  test("ExternalName: kein Selector, External Name, weder Port noch Endpoints", () => {
    const sim = new KQSim({ files: { "e.yaml": EXTERNAL } });
    run(sim, "apply -f e.yaml");
    const d = out(sim, "describe svc bank");
    expect(d).toMatch(/^Selector:\s+<none>$/m);
    expect(d).toMatch(/^Type:\s+ExternalName$/m);
    expect(d).toMatch(/^IP:$/m);
    expect(d).toMatch(/^External Name:\s+api\.bank\.example\.com$/m);
    expect(d).not.toMatch(/^Port:|TargetPort:|Endpoints:/m);
  });
});

describe("describe pvc", () => {
  test("gebunden: Capacity, RWO, Used By, Events <none>", () => {
    const sim = new KQSim({ statefulSets: [sts()] });
    const d = out(sim, "describe pvc data-speicher-0");
    expect(d).toMatch(/^Status:\s+Bound$/m);
    expect(d).toMatch(/^Capacity:\s+1Gi$/m);
    expect(d).toMatch(/^Access Modes:\s+RWO$/m);
    expect(d).toMatch(/^VolumeMode:\s+Filesystem$/m);
    expect(d).toMatch(/^Used By:\s+speicher-0$/m);
    expect(d).not.toMatch(/speicher-[12]/);
    expect(d).toMatch(/^Events:\s+<none>$/m);
  });

  test("loses PVC: Used By <none>", () => {
    const sim = new KQSim({ statefulSets: [sts()] });
    sim.pvcs.push({ name: "lose", status: "Pending", volume: "", capacity: "1Gi", storageClass: "", accessModes: "RWO", created: 0 });
    expect(out(sim, "describe pvc lose")).toMatch(/^Used By:\s+<none>$/m);
  });

  test("Pending mit vorhandener StorageClass: kein ProvisioningFailed, Events <none>", () => {
    const sim = new KQSim({});
    sim.storageClasses.push({ name: "schnell", provisioner: "x", reclaimPolicy: "Delete", isDefault: false, created: 0 });
    sim.pvcs.push({ name: "wartend", status: "Pending", volume: "", capacity: "1Gi", storageClass: "schnell", accessModes: "RWO", created: 0 });
    const d = out(sim, "describe pvc wartend");
    expect(d).not.toContain("ProvisioningFailed");
    expect(d).toMatch(/^Events:\s+<none>$/m);
  });

  test("Pending ohne StorageClass: Capacity leer, FailedBinding mit Originaltext", () => {
    const sim = new KQSim({ statefulSets: [sts({ storageClass: "", replicas: 1 })] });
    const d = out(sim, "describe pvc data-speicher-0");
    expect(d).toMatch(/^Status:\s+Pending$/m);
    expect(d).toMatch(/^Capacity:$/m);
    expect(d).toMatch(/^Access Modes:$/m);
    expect(d).toMatch(/^\s+Normal\s+FailedBinding\s+\S+\s+no persistent volumes available for this claim and no storage class is set/m);
  });

  test("Pending mit unbekannter StorageClass: ProvisioningFailed statt FailedBinding", () => {
    const sim = new KQSim({ statefulSets: [sts({ storageClass: "gibtsnicht", replicas: 1 })] });
    const d = out(sim, "describe pvc data-speicher-0");
    expect(d).toMatch(/Warning\s+ProvisioningFailed\s+\S+\s+storageclass\.storage\.k8s\.io "gibtsnicht" not found/);
    expect(d).not.toContain("FailedBinding");
  });
});

describe("describe statefulset", () => {
  test("gesund: Replicas, Pods Status, Volume Claims", () => {
    const d = out(new KQSim({ statefulSets: [sts()] }), "describe sts speicher");
    expect(d).toMatch(/^Replicas:\s+3 desired \| 3 total$/m);
    expect(d).toMatch(/^Update Strategy:\s+RollingUpdate$/m);
    expect(d).toMatch(/^Pods Status:\s+3 Running \/ 0 Waiting \/ 0 Succeeded \/ 0 Failed$/m);
    expect(d).toMatch(/^\s+Name:\s+data$/m);
    expect(d).toMatch(/^\s+StorageClass:$/m);
    expect(d).toMatch(/^\s+Capacity:\s+1Gi$/m);
    expect(d).toMatch(/Access Modes:\s+\[ReadWriteOnce\]/);
  });

  test("Pending-PVC: 0 Running / 1 Waiting", () => {
    const d = out(new KQSim({ statefulSets: [sts({ storageClass: "", replicas: 1 })] }), "describe sts speicher");
    expect(d).toMatch(/0 Running \/ 1 Waiting/);
  });
});

describe("Schreibweisen und NotFound", () => {
  const sim = new KQSim({ deployments: [dep("web")], services: [svc("web")], statefulSets: [sts({ replicas: 1 })] });
  test.each([
    "describe deploy web", "describe deployment web", "describe deployment/web", "describe deployment.apps web", "describe deployments web",
  ])("kubectl %s", cmd => {
    expect(run(sim, cmd).error).toBeFalsy();
    expect(out(sim, cmd)).toMatch(/^Name:\s+web$/m);
  });
  test.each([
    ["describe svc web", /^Name:\s+web$/m], ["describe pvc data-speicher-0", /^Name:\s+data-speicher-0$/m], ["describe sts speicher", /^Name:\s+speicher$/m],
  ])("kubectl %s", (cmd, re) => expect(out(sim, cmd)).toMatch(re));
  test.each([
    ["deployment", 'deployments.apps "geist"'], ["service", 'services "geist"'], ["pvc", 'persistentvolumeclaims "geist"'], ["sts", 'statefulsets.apps "geist"'],
  ])("unbekannter Name bei %s: NotFound samt Tipp", (typ, text) => {
    const r = run(sim, "describe " + typ + " geist");
    expect(r.error).toBe(true);
    expect(r.output).toContain("Error from server (NotFound): " + text + " not found");
  });
});

describe("ohne Namen und Namenspräfix", () => {
  const world = () => new KQSim({ deployments: [dep("web"), dep("web-api"), dep("kasse")] });

  test("ohne Namen: alle Objekte, zwei Leerzeilen dazwischen, kein Fehler", () => {
    const sim = new KQSim({ deployments: [dep("web"), dep("kasse")] });
    expect(run(sim, "describe deploy").error).toBeFalsy();
    const d = out(sim, "describe deploy");
    expect(d.split("\n\n\nName:")).toHaveLength(2);
    expect(d).toMatch(/^Name:\s+web$/m);
    expect(d).toMatch(/^Name:\s+kasse$/m);
  });

  test.each(["deployments", "services", "pvc", "sts", "pods", "clusterroles"])("leere Art %s: Leermeldung ohne Fehler", typ => {
    const r = run(new KQSim({}), "describe " + typ);
    expect(r.error).toBeFalsy();
    expect(r.output).toBe("No resources found in default namespace.");
  });

  test("exakter Treffer gewinnt vor dem Präfix", () => {
    const d = out(world(), "describe deploy web");
    expect(d).toMatch(/^Name:\s+web$/m);
    expect(d).not.toContain("web-api");
  });

  test("Präfix: alle Treffer, eine Leerzeile dazwischen", () => {
    const d = out(world(), "describe deploy we");
    expect(d.split("\n\nName:")).toHaveLength(2);
    expect(d).not.toContain("\n\n\n");
    expect(d).toMatch(/^Name:\s+web$/m);
    expect(d).toMatch(/^Name:\s+web-api$/m);
    expect(d).not.toContain("kasse");
  });

  test("Präfix, nicht Teilstring: `api` trifft `web-api` nicht", () => {
    expect(out(world(), "describe deploy api")).toContain('deployments.apps "api" not found');
  });

  test("Präfix ohne Treffer: NotFound; Slash-Form gilt nur exakt; kaputte Slash-Form", () => {
    const sim = world();
    expect(out(sim, "describe deploy zz")).toContain('deployments.apps "zz" not found');
    expect(run(sim, "describe deploy/we").error).toBe(true);
    expect(out(sim, "describe deploy/we")).toContain("NotFound");
    expect(run(sim, "describe deploy/").error).toBe(true);
    expect(out(sim, "describe deploy/")).toContain("resource/name form");
  });

  test("describe pod <Präfix> beschreibt alle StatefulSet-Pods", () => {
    const d = out(new KQSim({ statefulSets: [sts()] }), "describe pod speicher");
    for (const i of [0, 1, 2]) expect(d).toMatch(new RegExp("^Name:\\s+speicher-" + i + "$", "m"));
  });

  test("Eigenschaft: jede Art der Registry hat Namen, und describe <art> nennt jeden davon", () => {
    const sim = new KQSim({
      deployments: [dep("web")], services: [svc("web")], statefulSets: [sts({ replicas: 1 })],
      networkPolicies: [{ name: "mauer", podSelector: "web" }], ingresses: [{ name: "tor", host: "a.example", path: "/", service: "web", port: 80, className: "nginx" }],
      serviceAccounts: ["robo"],
      roles: [{ name: "leser", cluster: false, rules: [], created: 0 }, { name: "weit", cluster: true, rules: [], created: 0 }],
    } as never);
    for (const [plural, entry] of DESCRIBE_ENTRIES) {
      const kind = RESOURCE_KINDS.find(k => k.plural === plural)!;
      const names = entry.names(sim, kind);
      expect(names.length, plural + ": Namensliste nicht leer").toBeGreaterThan(0);
      const r = sim.exec("kubectl describe " + plural);
      expect(r.error, plural).toBeFalsy();
      for (const n of names) expect(r.output, plural + " " + n).toMatch(new RegExp("^Name:\\s+" + n + "$", "m"));
    }
  });
});

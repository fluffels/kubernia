/* Einheitliche Pod-Status-Quelle (#1414): clusterPodStatus, podView, workloadSummaries. */
import { describe, test, expect } from "vitest";
import { KQSim } from "./helpers";
import { clusterPods, findClusterPod } from "../../src/sim/pods";
import { clusterPodStatus, deploymentPodStatus, isReady, podView, workloadSummaries } from "../../src/sim/podstatus";
import { BROKEN_STATUS, type Broken } from "../../src/sim/state";
import type { ClusterPod } from "../../src/sim/pods";
import { podAddress } from "../../src/sim/endpoints";

const sts = (extra: object = {}) => ({ name: "speicher", image: "postgres:16", replicas: 3, serviceName: "speicher", ...extra });
const st = (sim: KQSim, name: string) => clusterPodStatus(sim, findClusterPod(sim, name)!);
/** PVC lösen (Pending ohne Volume), ohne die Cluster-Invariante zu verletzen. */
function unbind(sim: KQSim, suffix: string) {
  const pvc = sim.pvcs.find(p => p.name.endsWith(suffix))!;
  const pv = sim.pvs.find(v => v.name === pvc.volume);
  if (pv) { sim.pvs.splice(sim.pvs.indexOf(pv), 1); }
  pvc.status = "Pending"; pvc.volume = "";
}
const view = (sim: KQSim, name: string) => podView(sim, findClusterPod(sim, name)!);

describe("clusterPodStatus", () => {
  test("Deployment gesund: Running 1/1, 0 Restarts", () => {
    const sim = new KQSim({ deployments: [{ name: "web", image: "nginx", replicas: 1 }] });
    expect(st(sim, sim.deployments[0].pods[0].name)).toEqual({ status: "Running", ready: "1/1", restarts: 0, label: "Running" });
  });
  test("Deployment: selbst gezählter Neustart zählt", () => {
    const sim = new KQSim({ deployments: [{ name: "web", image: "nginx", replicas: 1 }] });
    sim.deployments[0].pods[0].restarts = 2;
    expect(st(sim, sim.deployments[0].pods[0].name).restarts).toBe(2);
  });
  test("Deployment crashloop / evicted", () => {
    const sim = new KQSim({ deployments: [
      { name: "absturz", image: "nginx", replicas: 1, broken: { type: "crashloop", needsSecret: "key" } },
      { name: "weg", image: "nginx", replicas: 1 },
    ] });
    sim.deployments[1].evicted = { reason: "DiskPressure" };
    expect(st(sim, sim.deployments[0].pods[0].name)).toEqual({ status: "CrashLoopBackOff", ready: "0/1", restarts: 5, label: "CrashLoopBackOff" });
    expect(st(sim, sim.deployments[1].pods[0].name)).toMatchObject({ status: "Evicted", ready: "0/1" });
  });
  test("StatefulSet gebunden: Running 1/1", () => {
    const sim = new KQSim({ statefulSets: [sts()] });
    expect(st(sim, "speicher-0")).toEqual({ status: "Running", ready: "1/1", restarts: 0, label: "Running" });
  });
  test("StatefulSet ohne StorageClass: Pending 0/1", () => {
    const sim = new KQSim({ statefulSets: [sts({ storageClass: "", replicas: 1 })] });
    expect(st(sim, "speicher-0")).toEqual({ status: "Pending", ready: "0/1", restarts: 0, label: "Pending" });
  });
  test("StatefulSet: nur der Pod mit Pending-PVC ist Pending", () => {
    const sim = new KQSim({ statefulSets: [sts()] });
    unbind(sim, "-1");
    expect(st(sim, "speicher-1").status).toBe("Pending");
    expect(st(sim, "speicher-0").status).toBe("Running");
    expect(st(sim, "speicher-2").status).toBe("Running");
  });
  test("StatefulSet: Restarts aus pod.restarts", () => {
    const sim = new KQSim({ statefulSets: [sts({ replicas: 1 })] });
    sim.statefulSets[0].pods[0].restarts = 3;
    expect(st(sim, "speicher-0").restarts).toBe(3);
  });
});

describe("podView", () => {
  test("notready: Label NotReady, nicht gesund", () => {
    const sim = new KQSim({ deployments: [{ name: "w", image: "nginx", replicas: 1, broken: { type: "notready" } }] });
    const v = view(sim, sim.deployments[0].pods[0].name);
    expect(v).toMatchObject({ label: "NotReady", healthy: false, kind: "Deployment", workload: "w", image: "nginx" });
  });
  test("evicted UND broken: Evicted gewinnt", () => {
    const sim = new KQSim({ deployments: [{ name: "w", image: "nginx", replicas: 1, broken: { type: "crashloop", needsSecret: "k" } }] });
    sim.deployments[0].evicted = { reason: "DiskPressure" };
    expect(view(sim, sim.deployments[0].pods[0].name).label).toBe("Evicted");
  });
  test("gesunder Deployment-Pod: Running, healthy", () => {
    const sim = new KQSim({ deployments: [{ name: "w", image: "nginx", replicas: 1 }] });
    expect(view(sim, sim.deployments[0].pods[0].name)).toMatchObject({ label: "Running", healthy: true, restarts: 0 });
  });
  test("StatefulSet Pending: kind, workload, image, nicht gesund", () => {
    const sim = new KQSim({ statefulSets: [sts({ storageClass: "", replicas: 1 })] });
    expect(view(sim, "speicher-0")).toMatchObject({ kind: "StatefulSet", workload: "speicher", image: "postgres:16", label: "Pending", healthy: false });
  });
  test("StatefulSet: restarts aus pod.restarts", () => {
    const sim = new KQSim({ statefulSets: [sts({ replicas: 1 })] });
    sim.statefulSets[0].pods[0].restarts = 4;
    expect(view(sim, "speicher-0").restarts).toBe(4);
  });
  test("crashloop zeigt Restarts 5 wie get pods", () => {
    const sim = new KQSim({ deployments: [{ name: "a", image: "nginx", replicas: 1, broken: { type: "crashloop", needsSecret: "k" } }] });
    expect(view(sim, sim.deployments[0].pods[0].name).restarts).toBe(5);
  });
});

describe("workloadSummaries", () => {
  const all = (sim: KQSim) => clusterPods(sim).map(c => podView(sim, c));
  test("Reihenfolge des ersten Auftretens, alles gesund: problem null", () => {
    const sim = new KQSim({ deployments: [{ name: "web", image: "nginx", replicas: 2 }], statefulSets: [sts({ replicas: 2 })] });
    const s = workloadSummaries(all(sim));
    expect(s.map(x => x.workload)).toEqual(["web", "speicher"]);
    expect(s[0]).toMatchObject({ kind: "Deployment", ready: 2, total: 2, problem: null, firstPod: sim.deployments[0].pods[0].name });
    expect(s[1]).toMatchObject({ kind: "StatefulSet", ready: 2, total: 2, problem: null, firstPod: "speicher-0" });
  });
  test("2 von 3 bereit: problem Pending", () => {
    const sim = new KQSim({ statefulSets: [sts()] });
    unbind(sim, "-2");
    expect(workloadSummaries(all(sim))).toEqual([expect.objectContaining({ ready: 2, total: 3, problem: "Pending" })]);
  });
  test("problem ist das Label des ERSTEN nicht bereiten Pods", () => {
    const v = (name: string, label: string, healthy: boolean) => ({ name, kind: "Deployment" as const, workload: "w", image: "i", label, healthy, restarts: 0, created: 0 });
    expect(workloadSummaries([v("a", "Running", true), v("b", "Pending", false), v("c", "NotReady", false)])[0].problem).toBe("Pending");
  });
  test("leer: leer", () => { expect(workloadSummaries([])).toEqual([]); });
  test("gleicher Name bei Deployment und StatefulSet bleibt getrennt", () => {
    const sim = new KQSim({ deployments: [{ name: "x", image: "nginx", replicas: 1 }], statefulSets: [sts({ name: "x", serviceName: "x", replicas: 1 })] });
    expect(workloadSummaries(all(sim)).map(s => s.kind)).toEqual(["Deployment", "StatefulSet"]);
  });
});

describe("Konsistenz: eine Quelle für StatefulSet-Status", () => {
  test("podAddress null <=> get pods Pending <=> keine Metrik <=> clusterPodStatus Pending", () => {
    const sim = new KQSim({ statefulSets: [sts(), sts({ name: "wartend", serviceName: "wartend", storageClass: "", replicas: 1 })] });
    unbind(sim, "speicher-1");
    const table = sim.exec("kubectl get pods").output ?? "";
    const metrics = new Set(sim.podMetrics().map(m => m.name));
    for (const c of clusterPods(sim)) {
      const pending = podAddress(c, sim.pvcs) === null;
      const row = table.split("\n").find(l => l.startsWith(c.pod.name + " "))!;
      expect(row.includes("Pending")).toBe(pending);
      expect(metrics.has(c.pod.name)).toBe(!pending);
      expect(clusterPodStatus(sim, c).status === "Pending").toBe(pending);
    }
    expect(clusterPods(sim).some(c => podAddress(c, sim.pvcs) === null)).toBe(true);
  });
});

describe("deploymentPodStatus (#1426)", () => {
  const TYPES = ["imagepull", "crashloop", "pending", "notready", "oomkilled"] as const;
  const broken = (type: Broken["type"]) => ({ type }) as Broken;
  test("gesund: Running 1/1 0 Restarts", () => {
    expect(deploymentPodStatus({ broken: null })).toEqual({ status: "Running", ready: "1/1", restarts: 0, label: "Running" });
  });
  test.each(TYPES)("broken %s entspricht BROKEN_STATUS", (type) => {
    expect(deploymentPodStatus({ broken: broken(type) })).toEqual(BROKEN_STATUS[type]);
  });
  test("notready: Status Running, Label NotReady, nicht bereit", () => {
    const st = deploymentPodStatus({ broken: broken("notready") });
    expect(st).toMatchObject({ status: "Running", label: "NotReady" });
    expect(isReady(st)).toBe(false);
  });
  test("evicted UND broken: Evicted samt Label gewinnt", () => {
    expect(deploymentPodStatus({ evicted: { reason: "DiskPressure" }, broken: broken("crashloop") }))
      .toEqual({ status: "Evicted", ready: "0/1", restarts: 0, label: "Evicted" });
  });
  test("Ergebnis ist eine Kopie: Mutation ändert BROKEN_STATUS nicht", () => {
    const st = deploymentPodStatus({ broken: broken("crashloop") });
    st.restarts = 99; st.label = "x";
    expect(BROKEN_STATUS.crashloop).toMatchObject({ restarts: 5, label: "CrashLoopBackOff" });
  });
});

describe("isReady (#1426)", () => {
  test.each(["1/1", "2/2", "10/10"])("%s ist bereit", (ready) => { expect(isReady({ ready })).toBe(true); });
  test.each(["0/1", "1/2", "0/0", "", "x/y", "1", "1/1/1", "-1/-1"])("%j ist nicht bereit", (ready) => { expect(isReady({ ready })).toBe(false); });
  test("sim._podReady und podView.healthy folgen isReady", () => {
    const sim = new KQSim({ deployments: [{ name: "w", image: "nginx", replicas: 1, broken: { type: "notready" } }] });
    expect(sim._podReady(sim.deployments[0])).toBe(false);
    expect(view(sim, sim.deployments[0].pods[0].name).healthy).toBe(false);
  });
});

describe("Konsistenz: Restarts-Regel steht einmal (#1426)", () => {
  test("describe pod = get pods = clusterPodStatus für jeden Pod", () => {
    const sim = new KQSim({
      deployments: [
        { name: "ok", image: "nginx", replicas: 1 },
        { name: "crash", image: "nginx", replicas: 1, broken: { type: "crashloop", needsSecret: "k" } },
        { name: "oom", image: "nginx", replicas: 1, broken: { type: "oomkilled" } },
        { name: "weg", image: "nginx", replicas: 1 },
      ],
      statefulSets: [sts({ replicas: 1 })],
    });
    sim.deployments[0].pods[0].restarts = 2;
    sim.deployments[3].evicted = { reason: "DiskPressure" };
    sim.statefulSets[0].pods[0].restarts = 3;
    const table = sim.exec("kubectl get pods").output ?? "";
    for (const c of clusterPods(sim)) {
      const s = clusterPodStatus(sim, c);
      const cols = table.split("\n").find(l => l.startsWith(c.pod.name + " "))!.split(/\s+/);
      expect(cols[1]).toBe(s.ready);
      expect(cols[3]).toBe(String(s.restarts));
      const d = sim.exec("kubectl describe pod " + c.pod.name).output ?? "";
      expect(d).toContain("Ready:        " + s.ready + "\n");
      expect(d).toContain("Restart Count: " + s.restarts + "\n");
    }
  });
});

describe("assertNever in den Workload-Switches (#1426)", () => {
  const fake = (sim: KQSim) => ({ owner: "DaemonSet", pod: sim.deployments[0].pods[0] }) as unknown as ClusterPod;
  const sim = () => new KQSim({ deployments: [{ name: "w", image: "nginx", replicas: 1 }] });
  test("clusterPodStatus wirft bei unbekannter Workload-Art", () => {
    const s = sim();
    expect(() => clusterPodStatus(s, fake(s))).toThrow(/clusterPodStatus: unbehandelte Variante/);
  });
  test("podView wirft (über clusterPodStatus)", () => {
    const s = sim();
    expect(() => podView(s, fake(s))).toThrow(/unbehandelte Variante/);
  });
  test("podAddress wirft", () => {
    const s = sim();
    expect(() => podAddress(fake(s), s.pvcs)).toThrow(/podAddress: unbehandelte Variante/);
  });
});

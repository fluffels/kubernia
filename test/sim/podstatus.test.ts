/* Einheitliche Pod-Status-Quelle (#1414): clusterPodStatus, podView, workloadSummaries. */
import { describe, test, expect } from "vitest";
import { KQSim } from "./helpers";
import { clusterPods, findClusterPod } from "../../src/sim/pods";
import { clusterPodStatus, podView, workloadSummaries } from "../../src/sim/podstatus";
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
    expect(st(sim, sim.deployments[0].pods[0].name)).toEqual({ status: "Running", ready: "1/1", restarts: 0 });
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
    expect(st(sim, sim.deployments[0].pods[0].name)).toEqual({ status: "CrashLoopBackOff", ready: "0/1", restarts: 5 });
    expect(st(sim, sim.deployments[1].pods[0].name)).toMatchObject({ status: "Evicted", ready: "0/1" });
  });
  test("StatefulSet gebunden: Running 1/1", () => {
    const sim = new KQSim({ statefulSets: [sts()] });
    expect(st(sim, "speicher-0")).toEqual({ status: "Running", ready: "1/1", restarts: 0 });
  });
  test("StatefulSet ohne StorageClass: Pending 0/1", () => {
    const sim = new KQSim({ statefulSets: [sts({ storageClass: "", replicas: 1 })] });
    expect(st(sim, "speicher-0")).toEqual({ status: "Pending", ready: "0/1", restarts: 0 });
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

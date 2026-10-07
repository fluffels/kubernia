/* Pod-Inventar (#1339): die EINE Aufzählung aller Pods samt Besitzer (src/sim/pods.ts). */
import { describe, test, expect } from "vitest";
import { KQSim } from "./helpers";
import { clusterPods, findClusterPod } from "../../src/sim/pods";

const sts = (extra: object = {}) => ({ name: "speicher", image: "postgres:16", replicas: 3, serviceName: "speicher", ...extra });

describe("clusterPods", () => {
  test("gemischter Cluster: erst Deployment-Pods, dann StatefulSet-Pods", () => {
    const sim = new KQSim({ deployments: [{ name: "kasse", image: "nginx", replicas: 2 }], statefulSets: [sts()] });
    const all = clusterPods(sim);
    expect(all).toHaveLength(5);
    expect(all.slice(0, 2).map(c => c.owner)).toEqual(["Deployment", "Deployment"]);
    expect(all.slice(0, 2).every(c => c.pod.name.startsWith("kasse-"))).toBe(true);
    expect(all.slice(2).map(c => c.owner)).toEqual(["StatefulSet", "StatefulSet", "StatefulSet"]);
    expect(all.slice(2).map(c => c.pod.name)).toEqual(["speicher-0", "speicher-1", "speicher-2"]);
  });

  test("leerer Cluster liefert []", () => {
    expect(clusterPods(new KQSim({}))).toEqual([]);
  });

  test("StatefulSet mit 0 Replicas liefert keinen Eintrag", () => {
    expect(clusterPods(new KQSim({ statefulSets: [sts({ replicas: 0 })] }))).toEqual([]);
  });
});

describe("findClusterPod", () => {
  const sim = new KQSim({ deployments: [{ name: "kasse", image: "nginx", replicas: 2 }], statefulSets: [sts()] });

  test("findet einen Deployment-Pod samt Deployment", () => {
    const name = sim.deployments[0].pods[1].name;
    const c = findClusterPod(sim, name);
    expect(c?.owner).toBe("Deployment");
    expect(c?.owner === "Deployment" && c.dep.name).toBe("kasse");
    expect(c?.pod.name).toBe(name);
  });

  test("findet einen StatefulSet-Pod samt StatefulSet", () => {
    const c = findClusterPod(sim, "speicher-1");
    expect(c?.owner).toBe("StatefulSet");
    expect(c?.owner === "StatefulSet" && c.sts.name).toBe("speicher");
  });

  test("Negativ: unbekannter Name und leerer Cluster liefern undefined", () => {
    expect(findClusterPod(sim, "gibt-es-nicht")).toBeUndefined();
    expect(findClusterPod(sim, "speicher-7")).toBeUndefined();
    expect(findClusterPod(new KQSim({}), "speicher-0")).toBeUndefined();
  });
});

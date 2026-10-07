/* Pod-Inventar (#1339): die EINE Aufzählung aller Pods samt Besitzer (src/sim/pods.ts). */
import { describe, test, expect } from "vitest";
import { KQSim } from "./helpers";
import { clusterPods } from "../../src/sim/pods";

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

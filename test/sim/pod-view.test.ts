/* Einheitliche Pod-Sicht (#1404): `get pods` (auch -A), `describe pod` und `logs` lesen
 * dasselbe Pod-Inventar (`clusterPods`) und kennen StatefulSet-Pods genauso wie Deployment-Pods. */
import { describe, test, expect } from "vitest";
import { KQSim } from "./helpers";
import { podIP } from "../../src/sim/util";
import { statefulPodNode } from "../../src/sim/workload";

const sts = (extra: object = {}) => ({ name: "speicher", image: "postgres:16", replicas: 3, serviceName: "speicher", ...extra });
const out = (sim: KQSim, cmd: string) => sim.exec(cmd).output ?? "";
const rows = (text: string) => text.split("\n").slice(1).filter(Boolean).map(l => l.trim().split(/\s+/));

describe("kubectl get pods -A", () => {
  test("listet StatefulSet-Pods unter default", () => {
    const sim = new KQSim({ statefulSets: [sts()] });
    const r = rows(out(sim, "kubectl get pods -A"));
    for (const i of [0, 1, 2]) expect(r.some(c => c[0] === "default" && c[1] === "speicher-" + i && c[2] === "1/1" && c[3] === "Running")).toBe(true);
  });

  test("zeigt den echten Status statt immer 1/1 Running (CrashLoop, OOMKilled)", () => {
    const sim = new KQSim({
      deployments: [
        { name: "absturz", image: "nginx", replicas: 1, broken: { type: "crashloop", needsSecret: "key" } },
        { name: "speicherhungrig", image: "nginx", replicas: 1, broken: { type: "oomkilled", memNeeded: 256 } },
        { name: "gesund", image: "nginx", replicas: 1 },
      ],
    });
    const r = rows(out(sim, "kubectl get pods -A")).filter(c => c[0] === "default");
    const by = (prefix: string) => r.find(c => c[1].startsWith(prefix))!;
    expect(by("absturz").slice(2, 5)).toEqual(["0/1", "CrashLoopBackOff", "5"]);
    expect(by("speicherhungrig").slice(2, 5)).toEqual(["0/1", "OOMKilled", "4"]);
    expect(by("gesund").slice(2, 5)).toEqual(["1/1", "Running", "0"]);
  });

  test("StatefulSet mit Pending-PVC: 0/1 Pending", () => {
    const sim = new KQSim({ statefulSets: [sts({ storageClass: "", replicas: 1 })] });
    const r = rows(out(sim, "kubectl get pods -A")).find(c => c[1] === "speicher-0")!;
    expect(r.slice(2, 4)).toEqual(["0/1", "Pending"]);
  });

  test("Konsistenz: die default-Zeilen von -A sind die Zeilen von get pods", () => {
    const sim = new KQSim({
      deployments: [{ name: "absturz", image: "nginx", replicas: 2, broken: { type: "crashloop", needsSecret: "key" } }, { name: "kasse", image: "nginx", replicas: 1 }],
      statefulSets: [sts({ replicas: 2 })],
    });
    const plain = rows(out(sim, "kubectl get pods")).map(c => c.slice(0, 4)); // ohne AGE: die Uhr tickt je Befehl
    const all = rows(out(sim, "kubectl get pods -A")).filter(c => c[0] === "default").map(c => c.slice(1, 5));
    expect(plain.length).toBe(5);
    expect(all).toEqual(plain);
  });

  test("-A als erster Befehl plant ein Pending-Deployment neu ein (genug Nodes) und zeigt Running", () => {
    const node = (name: string, roles: string) => ({ name, status: "Ready", roles, version: "v1.30.2" });
    const sim = new KQSim({
      nodes: [node("cp", "control-plane"), node("w1", "<none>"), node("w2", "<none>"), node("w3", "<none>")],
      deployments: [{ name: "wartend", image: "nginx", replicas: 1, broken: { type: "pending" } }],
    });
    expect(rows(out(sim, "kubectl get pods -A")).find(c => c[1].startsWith("wartend"))!.slice(2, 4)).toEqual(["1/1", "Running"]);
  });

  test("Evicted-Pod erscheint unter -A als Evicted", () => {
    const sim = new KQSim({ deployments: [{ name: "wildwuchs", image: "nginx", replicas: 1, ephemeralLimit: 512, emptyDir: { data: "x", usedMi: 600 } }] });
    const r = rows(out(sim, "kubectl get pods -A")).find(c => c[1].startsWith("wildwuchs"))!;
    expect(r.slice(2, 4)).toEqual(["0/1", "Evicted"]);
  });

  test("Negativ: -n kube-system listet keine default-Pods, auch nicht die StatefulSet-Pods", () => {
    const sim = new KQSim({ deployments: [{ name: "kasse", image: "nginx", replicas: 1 }], statefulSets: [sts()] });
    const t = out(sim, "kubectl get pods -n kube-system");
    expect(t).toContain("coredns");
    expect(t).not.toContain("kasse-");
    expect(t).not.toContain("speicher-");
  });
});

describe("kubectl get pods: RESTARTS", () => {
  const cluster = () => new KQSim({
    deployments: [
      { name: "absturz", image: "nginx", replicas: 1, broken: { type: "crashloop", needsSecret: "key" } },
      { name: "oom", image: "nginx", replicas: 1, broken: { type: "oomkilled", memNeeded: 256 } },
      { name: "gesund", image: "nginx", replicas: 1 },
    ],
  });

  test("Deployment-Pods: crashloop 5, oomkilled 4, gesund 0", () => {
    const r = rows(out(cluster(), "kubectl get pods"));
    const restarts = (prefix: string) => r.find(c => c[0].startsWith(prefix))![3];
    expect(restarts("absturz")).toBe("5");
    expect(restarts("oom")).toBe("4");
    expect(restarts("gesund")).toBe("0");
  });

  test("ein selbst gezählter Pod-Neustart (pod.restarts) greift, wenn der Status keine Zahl vorgibt", () => {
    const sim = cluster();
    sim.deployments[2].pods[0].restarts = 3;
    expect(rows(out(sim, "kubectl get pods")).find(c => c[0].startsWith("gesund"))![3]).toBe("3");
    expect(rows(out(sim, "kubectl get pods -A")).find(c => c[1].startsWith("gesund"))![4]).toBe("3");
  });
});

describe("kubectl describe pod (StatefulSet)", () => {
  test("laufender Pod: StatefulSet statt ReplicaSet, IP, Ready, Claim, Image, Node", () => {
    const sim = new KQSim({ statefulSets: [sts()] });
    const d = out(sim, "kubectl describe pod speicher-1");
    expect(sim.exec("kubectl describe pod speicher-1").error).toBeFalsy();
    expect(d).toContain("Name:         speicher-1");
    expect(d).toContain("Controlled By: StatefulSet/speicher");
    expect(d).toContain("Service Account: default");
    expect(d).not.toContain("ReplicaSet/");
    expect(d).toContain("IP:           " + podIP("speicher-1"));
    expect(d).toContain("Status:       Running");
    expect(d).toContain("Ready:        1/1");
    expect(d).toContain("ClaimName:  data-speicher-1");
    expect(d).toContain("Image:        postgres:16");
    expect(d).toContain("Node:         " + statefulPodNode(sim.nodes, { name: "speicher-1" }));
    expect(d).toContain("Successfully assigned default/speicher-1");
  });

  test("Pending-PVC: Pending, ohne Node und IP, Event FailedScheduling", () => {
    const sim = new KQSim({ statefulSets: [sts({ storageClass: "", replicas: 1 })] });
    const d = out(sim, "kubectl describe pod speicher-0");
    expect(d).toContain("Status:       Pending");
    expect(d).toContain("Ready:        0/1");
    expect(d).toContain("Node:         <none>");
    expect(d).toContain("IP:           <none>");
    expect(d).toContain("FailedScheduling");
    expect(d).toContain("unbound immediate PersistentVolumeClaims");
    expect(d).not.toContain("Successfully assigned");
  });

  test("Negativ: unbekannter Pod und fehlender Name", () => {
    const sim = new KQSim({ statefulSets: [sts()] });
    expect(sim.exec("kubectl describe pod speicher-9").error).toBe(true);
    expect(out(sim, "kubectl describe pod speicher-9")).toContain("NotFound");
    expect(sim.exec("kubectl describe pod").error).toBe(true);
  });

  test("Deployment-Pod bleibt ein ReplicaSet-Pod (unverändert)", () => {
    const sim = new KQSim({ deployments: [{ name: "kasse", image: "nginx", replicas: 1 }], statefulSets: [sts()] });
    const d = out(sim, "kubectl describe pod " + sim.deployments[0].pods[0].name);
    expect(d).toContain("Controlled By: ReplicaSet/kasse");
    expect(d).not.toContain("StatefulSet/");
  });
});

describe("kubectl logs (StatefulSet)", () => {
  test("laufender Pod: Log ohne Fehler, nennt Pod und PVC", () => {
    const sim = new KQSim({ statefulSets: [sts()] });
    const r = sim.exec("kubectl logs speicher-0");
    expect(r.error).toBeFalsy();
    expect(r.output).toContain("speicher-0");
    expect(r.output).toContain("data-speicher-0");
    expect(r.output).not.toContain("NotFound");
  });

  test("Pending-PVC: 'not scheduled yet' mit Tipp auf describe und get pvc", () => {
    const sim = new KQSim({ statefulSets: [sts({ storageClass: "", replicas: 1 })] });
    const r = sim.exec("kubectl logs speicher-0");
    expect(r.error).toBe(true);
    expect(r.output).toContain('pod "speicher-0" is not scheduled yet');
    expect(r.output).toContain("kubectl describe pod speicher-0");
    expect(r.output).toContain("kubectl get pvc");
  });

  test("--previous: kein Vorgänger-Container; -f hängt den Stream-Hinweis an", () => {
    const sim = new KQSim({ statefulSets: [sts()] });
    const prev = sim.exec("kubectl logs speicher-0 --previous");
    expect(prev.error).toBe(true);
    expect(prev.output).toContain("previous terminated container");
    expect(prev.output).toContain("not found");
    expect(out(sim, "kubectl logs -f speicher-0")).toContain("--follow");
  });

  test("Negativ: unbekannter Pod -> NotFound; ohne Namen Rückfrage", () => {
    const sim = new KQSim({ statefulSets: [sts()] });
    expect(sim.exec("kubectl logs speicher-9").error).toBe(true);
    expect(out(sim, "kubectl logs speicher-9")).toContain("NotFound");
    expect(sim.exec("kubectl logs").error).toBe(true);
  });

  test("Deployment-Pod: CrashLoop-Log bleibt (unverändert)", () => {
    const sim = new KQSim({ deployments: [{ name: "absturz", image: "nginx", replicas: 1, broken: { type: "crashloop", needsSecret: "key" } }], statefulSets: [sts()] });
    expect(out(sim, "kubectl logs " + sim.deployments[0].pods[0].name)).toContain("FATAL");
  });
});

describe("kubectl delete pod nach dem Umbau", () => {
  test("StatefulSet-Pod kommt mit gleichem Namen zurück, Deployment-Pod mit neuem; unbekannt -> NotFound", () => {
    const sim = new KQSim({ deployments: [{ name: "kasse", image: "nginx", replicas: 1 }], statefulSets: [sts({ replicas: 1 })] });
    const alt = sim.deployments[0].pods[0].name;
    expect(out(sim, "kubectl delete pod speicher-0")).toContain('pod "speicher-0" deleted');
    expect(sim.statefulSets[0].pods.map(p => p.name)).toEqual(["speicher-0"]);
    expect(out(sim, "kubectl delete pod " + alt)).toContain("deleted");
    expect(sim.deployments[0].pods[0].name).not.toBe(alt);
    expect(sim.lastDeletedPod).toBe(alt);
    const r = sim.exec("kubectl delete pod gibt-es-nicht");
    expect(r.error).toBe(true);
    expect(r.output).toContain("NotFound");
    expect(sim.lastDeletedPod).toBe(alt); // ein Tippfehler-Delete setzt den Marker nicht
  });

  test("Negativ: NotFound setzt lastDeletedPod nicht; StatefulSet-Delete setzt ihn und tauscht die Pod-Instanz", () => {
    const sim = new KQSim({ statefulSets: [sts({ replicas: 1 })] });
    sim.exec("kubectl delete pod gibt-es-nicht");
    expect(sim.lastDeletedPod).toBeNull();
    const vorher = sim.statefulSets[0].pods[0];
    sim.exec("kubectl delete pod speicher-0");
    expect(sim.lastDeletedPod).toBe("speicher-0");
    expect(sim.statefulSets[0].pods[0]).not.toBe(vorher);
  });
});

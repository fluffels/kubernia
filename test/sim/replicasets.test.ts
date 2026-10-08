/* ReplicaSets als abgeleitete Ressource (#1468): gemeinsamer pod-template-hash, `get rs`, `get all`,
 * `describe pod` (Controlled By), Alt-Stand ohne Migration, Invariante (9). Alles über `sim.exec` und
 * die öffentlichen Exporte. */
import { describe, test, expect } from "vitest";
import { KQSim } from "./helpers";
import { deploymentYaml } from "../factories/manifests";
import { clusterInvariantViolations } from "../../src/sim/invariants";
import { podTemplateHash, currentReplicaSet } from "../../src/sim/replicasets";
import { newDeploymentPod } from "../../src/sim/workload";
import { K8S_ALPHANUMS, makePodName, safeEncode } from "../../src/sim/util";
import type { Scenario } from "../../src/sim/state";
import altStand from "../fixtures/savegame-v1-rich.json";

const SUFFIX = new RegExp("^[" + K8S_ALPHANUMS + "]{5}$");

function neu(sc: Scenario = {}): KQSim {
  const sim = new KQSim(sc);
  expect(sim.exec("kubectl create deployment web --image=nginx --replicas=3").error).toBe(false);
  return sim;
}
const dep = (sim: KQSim, name = "web") => sim.deployments.find(d => d.name === name)!;
const namen = (sim: KQSim, name = "web") => dep(sim, name).pods.map(p => String(p.name));
/** Das Mittelsegment `<hash>` aus `<dep>-<hash>-<suffix>`. */
const hashes = (sim: KQSim, name = "web") => namen(sim, name).map(n => n.slice(name.length + 1, n.lastIndexOf("-")));
const hash = (sim: KQSim, name = "web") => { const h = new Set(hashes(sim, name)); expect(h.size).toBe(1); return [...h][0]; };
const letzteSpalte = (zeile: string) => zeile.trim().split(/\s+/).pop();

describe("gemeinsamer pod-template-hash", () => {
  test("alle Pods eines Deployments teilen den Hash, der Suffix ist K8s-Alphabet", () => {
    const sim = neu();
    expect(namen(sim)).toHaveLength(3);
    expect(hash(sim)).toMatch(/^[bcdf4-9]{1,10}$/);
    for (const n of namen(sim)) expect(n.slice(n.lastIndexOf("-") + 1)).toMatch(SUFFIX);
    expect(new Set(namen(sim)).size).toBe(3);
  });

  test("safeEncode kodiert Ziffern wie rand.SafeEncodeString", () => {
    expect(safeEncode("0123456789")).toBe("456789bcdf");
    expect(safeEncode("")).toBe("");
  });

  test("zwei Deployments mit gleichem Image haben verschiedene Hashes", () => {
    const sim = neu();
    sim.exec("kubectl create deployment api --image=nginx --replicas=1");
    expect(hash(sim, "api")).not.toBe(hash(sim));
  });

  test("Szenario und kubectl apply desselben Templates ergeben denselben Hash", () => {
    const a = new KQSim({ deployments: [{ name: "web", image: "web:2", replicas: 2, memLimit: 256 }] });
    const b = new KQSim({ files: { "web.yaml": deploymentYaml({ name: "web", image: "web:2", replicas: 2, memoryLimit: "256Mi" }) } });
    expect(b.exec("kubectl apply -f web.yaml").error).toBe(false);
    expect(hash(a)).toBe(hash(b));
  });
});

describe("neues Template ergibt neuen Hash", () => {
  test("set image", () => {
    const sim = neu(); const alt = hash(sim);
    expect(sim.exec("kubectl set image deployment/web nginx=nginx:2").error).toBe(false);
    expect(hash(sim)).not.toBe(alt);
    expect(namen(sim)).toHaveLength(3);
  });

  test("apply mit geändertem Manifest", () => {
    const sim = new KQSim({ files: { "web.yaml": deploymentYaml({ name: "web", image: "web:1", replicas: 2 }) } });
    sim.exec("kubectl apply -f web.yaml");
    const alt = hash(sim);
    sim.files["web.yaml"] = deploymentYaml({ name: "web", image: "web:2", replicas: 2 });
    sim.exec("kubectl apply -f web.yaml");
    expect(hash(sim)).not.toBe(alt);
  });

  test("rollout restart, mehrfach hintereinander", () => {
    const sim = neu(); const h0 = hash(sim);
    expect(sim.exec("kubectl rollout restart deployment/web").error).toBe(false);
    const h1 = hash(sim);
    sim.exec("kubectl rollout restart deployment/web");
    const h2 = hash(sim);
    expect(new Set([h0, h1, h2]).size).toBe(3);
  });

  test("rollout restart nach Reload: der Takt fällt zurück, der Hash ändert sich trotzdem", () => {
    const sim = neu();
    sim.exec("kubectl rollout restart deployment/web");
    const geladen = new KQSim(JSON.parse(JSON.stringify(sim.snapshot())) as Scenario);
    const h = hash(geladen);
    geladen.clock = dep(geladen).restartedAt! - 1; // exec zählt den Takt hoch: der nächste Neustart fällt in den Takt des gespeicherten restartedAt
    geladen.exec("kubectl rollout restart deployment/web");
    expect(hash(geladen)).not.toBe(h);
  });

  test("das neue ReplicaSet ist jünger als das Deployment", () => {
    const sim = neu();
    sim.clock += 5;
    sim.exec("kubectl rollout restart deployment/web");
    expect(currentReplicaSet(dep(sim)).created).toBeGreaterThan(dep(sim).created);
  });
});

describe("Hash bleibt", () => {
  test.each([
    ["scale hoch", "kubectl scale deployment/web --replicas=5"],
    ["scale runter", "kubectl scale deployment/web --replicas=1"],
    ["set image auf dasselbe Image", "kubectl set image deployment/web nginx=nginx"],
    ["set env (kein Rollout)", "kubectl set env deployment/web --from=configmap/cfg"],
  ])("%s", (_t, cmd) => {
    const sim = neu({ configMaps: [{ name: "cfg", keys: ["k"] }] }); const h = hash(sim);
    const rs = currentReplicaSet(dep(sim)).created;
    expect(sim.exec(cmd).error).toBe(false);
    expect(hash(sim)).toBe(h);
    expect(currentReplicaSet(dep(sim)).created).toBe(rs);
  });

  test("scale auf 0 und zurück behält das ReplicaSet", () => {
    const sim = neu(); const h = hash(sim);
    sim.exec("kubectl scale deployment/web --replicas=0");
    sim.exec("kubectl scale deployment/web --replicas=2");
    expect(hash(sim)).toBe(h);
  });

  test("delete pod: der Ersatz-Pod trägt denselben Hash", () => {
    const sim = neu(); const h = hash(sim);
    sim.exec("kubectl delete pod " + namen(sim)[0]);
    expect(namen(sim)).toHaveLength(3);
    expect(hash(sim)).toBe(h);
  });

  test("apply desselben Manifests (unchanged)", () => {
    const sim = new KQSim({ files: { "web.yaml": deploymentYaml({ name: "web", image: "web:1", replicas: 2 }) } });
    sim.exec("kubectl apply -f web.yaml");
    const h = hash(sim);
    expect(sim.exec("kubectl apply -f web.yaml").output).toContain("unchanged");
    expect(hash(sim)).toBe(h);
  });

  test("abgelehnter rollout restart (Admission) ändert nichts", () => {
    const sim = new KQSim({ podSecurity: "restricted", deployments: [{ name: "web", image: "nginx", replicas: 2, securityContext: { privileged: true } }] });
    const vorher = namen(sim);
    const r = sim.exec("kubectl rollout restart deployment/web");
    expect(r.error).toBe(true);
    expect(namen(sim)).toEqual(vorher);
  });

  test("ImagePull-Heilung per docker build rollt Pods neu aus, der Hash bleibt", () => {
    const sim = new KQSim({
      files: { "web.yaml": deploymentYaml({ name: "web", image: "eigen:1", replicas: 2 }), Dockerfile: "FROM nginx" },
      applyEffects: { "web.yaml": { deployment: { name: "web", image: "eigen:1", replicas: 2, requireBuiltImage: true } } },
    });
    sim.exec("kubectl apply -f web.yaml");
    expect(dep(sim).broken).not.toBeNull();
    const h = hash(sim); const vorher = namen(sim); const rsCreated = currentReplicaSet(dep(sim)).created;
    sim.clock += 10;
    sim.exec("docker build -t eigen:1 .");
    sim.exec("kubectl get pods"); // der kubelet zieht das Image beim nächsten Schritt nach
    expect(dep(sim).broken).toBeNull();
    expect(namen(sim)).not.toEqual(vorher);
    expect(hash(sim)).toBe(h);
    expect(currentReplicaSet(dep(sim)).created).toBe(rsCreated); // gleiches Template: das ReplicaSet bleibt
  });
});

describe("Persistenz ohne Migration", () => {
  test("snapshot, neu laden: gleicher Hash, auch nach rollout restart", () => {
    const sim = neu();
    sim.exec("kubectl rollout restart deployment/web");
    const h = hash(sim);
    const snap = JSON.parse(JSON.stringify(sim.snapshot())) as Scenario;
    const geladen = new KQSim(snap);
    expect(hash(geladen)).toBe(h);
    expect(clusterInvariantViolations(geladen)).toEqual([]);
  });

  test("Alt-Stand (v1-rich): alle Pods teilen den Hash, Format unverändert", () => {
    const snap = JSON.parse(JSON.stringify(altStand.data.clusterSnapshot)) as Scenario;
    const sim = new KQSim(snap);
    expect(namen(sim)).toHaveLength(3);
    const h = hash(sim);
    expect(sim.exec("kubectl get rs").output).toMatch(new RegExp("web-" + h + "\\s+3\\s+3\\s+3"));
    expect(clusterInvariantViolations(sim)).toEqual([]);
    const eintrag = (sim.snapshot().deployments ?? []).find(d => d.name === "web");
    expect(eintrag).not.toHaveProperty("pods");
    expect(eintrag).not.toHaveProperty("replicaSet");
    expect(sim.exec("kubectl describe pod " + namen(sim)[0]).output).toContain("Controlled By: ReplicaSet/web-" + h + "\n");
  });
});

describe("get rs", () => {
  test.each(["rs", "replicaset", "replicasets", "replicaset.apps", "replicasets.apps", "RS"])("Alias %s", alias => {
    const sim = neu();
    const zeilen = sim.exec("kubectl get " + alias).output!.split("\n");
    expect(zeilen[0]).toMatch(/^NAME\s+DESIRED\s+CURRENT\s+READY\s+AGE$/);
    expect(zeilen[1]).toMatch(new RegExp("^web-" + hash(sim) + "\\s+3\\s+3\\s+3\\s+\\d+[smh]$"));
  });

  test("get rs <name>, NotFound und leerer Cluster", () => {
    const sim = neu();
    const name = currentReplicaSet(dep(sim)).name;
    expect(sim.exec("kubectl get rs " + name).output).toContain(name);
    const r = sim.exec("kubectl get rs gibtsnicht");
    expect(r.error).toBe(true);
    expect(r.output).toContain('replicasets.apps "gibtsnicht" not found');
    expect(new KQSim().exec("kubectl get rs").output).toBe("No resources found in default namespace.");
  });

  test("replicas=0 zeigt 0 0 0; kaputtes Deployment zeigt READY 0", () => {
    const sim = neu();
    sim.exec("kubectl scale deployment/web --replicas=0");
    expect(sim.exec("kubectl get rs").output).toMatch(/web-\w+\s+0\s+0\s+0\s/);
    const kaputt = new KQSim({ deployments: [{ name: "x", image: "i", replicas: 2, broken: { type: "imagepull", badImage: "i" } }] });
    expect(kaputt.exec("kubectl get rs").output).toMatch(/x-\w+\s+2\s+2\s+0\s/);
  });

  test("AGE nach einem Rollout jünger als das Deployment", () => {
    const sim = neu();
    sim.clock += 20;
    const zeile = (name: string) => sim.exec("kubectl get rs").output!.split("\n").find(z => z.startsWith(name + " "))!;
    const altName = currentReplicaSet(dep(sim)).name;
    const alt = letzteSpalte(zeile(altName));
    sim.exec("kubectl rollout restart deployment/web");
    const jung = letzteSpalte(zeile(currentReplicaSet(dep(sim)).name));
    expect(jung).not.toBe(alt);
  });

  test("kube-system: Leermeldung", () => {
    expect(neu().exec("kubectl get rs -n kube-system").output).toBe("No resources found in kube-system namespace.");
  });
});

describe("get all und describe pod", () => {
  test("get all zeigt das ReplicaSet zwischen Deployment und StatefulSet", () => {
    const sim = neu({ statefulSets: [{ name: "db", image: "db:1", replicas: 1 }] });
    const out = sim.exec("kubectl get all").output!;
    const rs = out.indexOf("replicaset.apps/web-" + hash(sim));
    expect(rs).toBeGreaterThan(out.indexOf("deployment.apps/web"));
    expect(rs).toBeLessThan(out.indexOf("statefulset.apps/db"));
  });

  test("Controlled By ist der Pod-Name ohne das letzte Segment", () => {
    const sim = neu();
    for (const n of namen(sim)) {
      const out = sim.exec("kubectl describe pod " + n).output!;
      expect(out).toContain("Controlled By: ReplicaSet/" + n.slice(0, n.lastIndexOf("-")) + "\n");
    }
  });
});

describe("Invariante (9)", () => {
  test("ein verfälschter Pod-Name wird gemeldet", () => {
    const sim = neu();
    expect(clusterInvariantViolations(sim)).toEqual([]);
    dep(sim).pods[1].name = "web-xxxx-abcde" as never;
    expect(clusterInvariantViolations(sim).join("\n")).toContain("pod-template-hash");
  });

  test("richtiger Präfix, aber falsche Suffix-Länge wird gemeldet", () => {
    const sim = neu();
    const p = namen(sim)[0];
    dep(sim).pods[0].name = (p.slice(0, p.lastIndexOf("-") + 1) + "abcdefghi") as never;
    expect(clusterInvariantViolations(sim).join(" ")).toContain("pod-template-hash");
    dep(sim).pods[0].name = (p.slice(0, p.lastIndexOf("-") + 1) + "abcd") as never;
    expect(clusterInvariantViolations(sim).join(" ")).toContain("pod-template-hash");
  });

  test("Befehlskette bleibt verletzungsfrei", () => {
    const sim = neu();
    sim.files["w.yaml"] = deploymentYaml({ name: "web", image: "nginx:9", replicas: 2 });
    const kette = ["kubectl scale deployment/web --replicas=4", "kubectl set image deployment/web nginx=nginx:3", "kubectl rollout restart deployment/web", "kubectl delete pod " + namen(sim)[0], "kubectl apply -f w.yaml"];
    for (const c of kette) {
      sim.exec(c);
      expect(clusterInvariantViolations(sim), c).toEqual([]);
    }
  });
});

describe("Namenskollision", () => {
  test("ein rng-Stub mit zweimal demselben Suffix würfelt neu, Namen bleiben eindeutig", () => {
    const d = new KQSim({ deployments: [{ name: "web", image: "nginx", replicas: 0 }] }).deployments[0];
    let i = 0;
    const rng = () => (i++ < 5 ? 0.1 : 0.6); // der erste Versuch würfelt exakt den Suffix von `a`
    const a = newDeploymentPod(d, 0, () => 0.1);
    d.pods.push(a);
    const b = newDeploymentPod(d, 0, rng);
    expect(b.name).not.toBe(a.name);
  });

  test("makePodName: Hash und Suffix im Namen", () => {
    expect(makePodName("web", "7d8f", () => 0)).toBe("web-7d8f-bbbbb");
  });
});

describe("podTemplateHash: welche Felder eingehen", () => {
  const basis = () => new KQSim({ deployments: [{ name: "web", image: "a", replicas: 1 }] }).deployments[0];
  test.each<[string, (d: ReturnType<typeof basis>) => void]>([
    ["envFrom.configMaps", d => { d.envFrom.configMaps.push("c"); }],
    ["envFrom.secrets", d => { d.envFrom.secrets.push("s"); }],
    ["serviceAccountName", d => { d.serviceAccountName = "sa"; }],
    ["containerPort", d => { d.containerPort = 8080; }],
    ["memLimit", d => { d.memLimit = 128; }],
    ["cpuLimitMilli", d => { d.cpuLimitMilli = 250; }],
    ["securityContext", d => { d.securityContext = { runAsNonRoot: true }; }],
    ["node", d => { d.node = "n1"; }],
    ["emptyDir", d => { d.emptyDir = { data: "", usedMi: 0 }; }],
    ["ephemeralLimit", d => { d.ephemeralLimit = 64; }],
    ["initContainer", d => { d.initContainer = { fillsMi: 10 }; }],
    ["restartedAt", d => { d.restartedAt = 3; }],
  ])("%s ändert den Hash", (_f, mutiere) => {
    const d = basis(); const h = podTemplateHash(d);
    mutiere(d);
    expect(podTemplateHash(d)).not.toBe(h);
  });

  test("Laufzeitinhalt des emptyDir und der Zusatznutzung ändert den Hash nicht", () => {
    const d = basis(); d.emptyDir = { data: "", usedMi: 0 };
    const h = podTemplateHash(d);
    d.emptyDir = { data: "viel", usedMi: 99 };
    d.ephemeralUsedMi = 7;
    expect(podTemplateHash(d)).toBe(h);
  });
});

describe("podTemplateHash", () => {
  test("pur: Image und Name gehen ein, replicas und Laufzeitwerte nicht", () => {
    const d = new KQSim({ deployments: [{ name: "web", image: "a", replicas: 1 }] }).deployments[0];
    const h = podTemplateHash(d);
    expect(podTemplateHash(d)).toBe(h);
    const mehr = { ...d, replicas: 9 };
    expect(podTemplateHash(mehr)).toBe(h);
    expect(podTemplateHash({ ...d, image: "b" })).not.toBe(h);
    expect(podTemplateHash({ ...d, memLimit: 100 })).not.toBe(h);
    expect(podTemplateHash({ ...d, ephemeralUsedMi: 5 })).toBe(h);
  });
});

describe("Hash-Kanonisierung (Golden, doubleStage, Schlüsselreihenfolge)", () => {
  const voll = () => new KQSim({
    deployments: [{
      name: "web", image: "web:2", replicas: 1, envFrom: { configMaps: ["cfg"], secrets: ["sec"] },
      serviceAccountName: "sa", containerPort: 8080, memLimit: 256, cpuLimitMilli: 250,
      securityContext: { runAsNonRoot: true, privileged: false, readOnlyRootFilesystem: true, allowPrivilegeEscalation: false },
      node: "n1", emptyDir: { data: "", usedMi: 0 }, ephemeralLimit: 64, initContainer: { fillsMi: 10, doubleStage: true }, restartedAt: 3,
    }],
  }).deployments[0];

  test("Golden: der Hash eines Templates mit allen Feldern ist fest (Umbau darf ihn nicht verschieben)", () => {
    expect(podTemplateHash(voll())).toBe("dd977f587");
  });

  test("doubleStage ändert den Hash", () => {
    const d = voll(); const h = podTemplateHash(d);
    d.initContainer = { fillsMi: 10, doubleStage: false };
    expect(podTemplateHash(d)).not.toBe(h);
  });

  test("securityContext: andere Einfüge-Reihenfolge, gleiche Werte → gleicher Hash", () => {
    const d = voll(); const h = podTemplateHash(d);
    d.securityContext = { allowPrivilegeEscalation: false, readOnlyRootFilesystem: true, privileged: false, runAsNonRoot: true };
    expect(podTemplateHash(d)).toBe(h);
    d.securityContext = { ...d.securityContext, privileged: true };
    expect(podTemplateHash(d)).not.toBe(h);
  });
});

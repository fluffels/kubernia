/* kubectl get -o yaml (#1467): Einzelobjekt gegen `kind: List`, NotFound, Arten ohne Baustein, System-Pods,
 * die Objekt-Bausteine (Golden-Texte, Status je Broken-Typ), der Round-Trip mit dem Manifest-Mapper und die
 * Fitness-Tests (Registry ↔ Renderer ↔ Mapper). Alles über die öffentliche Sim-API (`exec`); die Ausgabe wird
 * mit dem Parser der Sim wieder gelesen, damit die Tests am Format hängen, nicht an Einrückungen. */
import { describe, test, expect } from "vitest";
import { KQSim, freshSim } from "./helpers";
import { parseYamlDocuments, type YamlValue } from "../../src/sim/yaml";
import { emitYaml } from "../../src/sim/yaml-emit";
import { effectsFromManifest, MAPPED_KINDS } from "../../src/sim/manifest/registry";
import { YAML_BAUSTEINE, yamlKinds } from "../../src/sim/kubectl/get-yaml";
import { GET_RENDERERS } from "../../src/sim/kubectl/inspect";
import { RESOURCE_KINDS } from "../../src/sim/kubectl/resources";
import { simGrenzen } from "../../src/hud/helptext";
import { deploymentYaml, serviceYaml } from "../factories/manifests";
import type { ApplyEffect, Scenario } from "../../src/sim/state";

const NICHT_SIMULIERT = "Nicht simuliert:";
const run = (sim: KQSim, cmd: string) => sim.exec("kubectl " + cmd);
const out = (sim: KQSim, cmd: string): string => run(sim, cmd).output ?? "";
type Obj = { [key: string]: YamlValue };
/** Die Ausgabe als Wert (der Parser der Sim liest, was der Emitter schreibt). */
const doc = (sim: KQSim, cmd: string): Obj => parseYamlDocuments(out(sim, cmd))[0] as Obj;
const items = (sim: KQSim, cmd: string): Obj[] => doc(sim, cmd).items as Obj[];
const dep = (name: string, extra: object = {}) => ({ name, image: "nginx:1", replicas: 2, ...extra });
const svc = (name: string, extra: object = {}) => ({ name, type: "ClusterIP" as const, clusterIP: "10.96.0.20", port: 80, ...extra });
const sts = (extra: object = {}) => ({ name: "speicher", image: "postgres:16", replicas: 2, serviceName: "speicher", ...extra });

const EMPTY_LIST = "apiVersion: v1\nitems: []\nkind: List\nmetadata:\n  resourceVersion: \"\"";

function reich(): Scenario {
  return { deployments: [dep("web", { containerPort: 8080 }), dep("api")], services: [svc("web", { targetPort: 8080 })], statefulSets: [sts()] };
}

describe("Einzelobjekt gegen List", () => {
  test.each(["get deploy web -o yaml", "get deploy/web -o yaml", "get deployments web --output=yaml", "get deploy web -oyaml", "get deploy web -o YAML"])(
    "%s → genau ein Objekt, keine List", cmd => {
      const o = doc(new KQSim(reich()), cmd);
      expect(o.kind).toBe("Deployment");
      expect(o.items).toBeUndefined();
      expect((o.metadata as Obj).name).toBe("web");
    });

  test("ohne Namen und bei mehreren Namen: kind: List mit items in Tabellenreihenfolge", () => {
    const sim = new KQSim(reich());
    for (const cmd of ["get deploy -o yaml", "get deploy web api -o yaml"]) {
      const l = doc(sim, cmd);
      expect(l).toMatchObject({ apiVersion: "v1", kind: "List", metadata: { resourceVersion: "" } });
      expect(items(sim, cmd).map(i => (i.metadata as Obj).name)).toEqual(["web", "api"]);
    }
    expect(items(sim, "get deploy api web -o yaml").map(i => (i.metadata as Obj).name)).toEqual(["api", "web"]);
  });

  test("leere List als exakter Text (items: [], resourceVersion leer)", () => {
    expect(out(new KQSim({}), "get deploy -o yaml")).toBe(EMPTY_LIST);
    expect(out(new KQSim({}), "get pods -o yaml")).toBe(EMPTY_LIST);
  });

  test("fremder Namespace ergibt eine leere List", () => {
    expect(out(new KQSim(reich()), "get deploy -n prod -o yaml")).toBe(EMPTY_LIST);
  });

  test("der Output endet ohne zusätzliche Leerzeile (wie die Tabellen)", () => {
    expect(out(new KQSim(reich()), "get deploy web -o yaml").endsWith("\n")).toBe(false);
  });
});

describe("NotFound wie bei der Tabelle", () => {
  test("einzelner Name: nur der Fehler, kein YAML", () => {
    const r = run(new KQSim(reich()), "get deploy nope -o yaml");
    expect(r.error).toBe(true);
    expect(r.output).toContain('Error from server (NotFound): deployments.apps "nope" not found');
    expect(r.output).not.toContain("kind:");
  });
  test("gemischt: List mit dem Treffer, danach die Fehlerzeile", () => {
    const r = run(new KQSim(reich()), "get deploy web nope -o yaml");
    expect(r.error).toBe(true);
    const text = r.output ?? "";
    expect(text.indexOf("kind: List")).toBeGreaterThanOrEqual(0);
    expect(text.indexOf("kind: List")).toBeLessThan(text.indexOf("Error from server (NotFound)"));
    expect(text).toContain("name: web");
  });
  test("alle fehlen: List mit items: [] plus Fehler", () => {
    const r = run(new KQSim(reich()), "get deploy a b -o yaml");
    expect(r.error).toBe(true);
    expect(r.output).toContain("items: []");
    expect(r.output).toContain('deployments.apps "a" not found');
    expect(r.output).toContain('deployments.apps "b" not found');
  });
  test("-n prod mit Namen: NotFound", () => {
    const r = run(new KQSim(reich()), "get deploy web -n prod -o yaml");
    expect(r.error).toBe(true);
    expect(r.output).toContain('"web" not found');
  });
});

describe("Arten ohne Baustein und System-Pods: ehrlich abgelehnt, nie gekürzt", () => {
  test("leere Art ohne Baustein ist erlaubt (List), mit Objekten Nicht simuliert samt Liste der Arten", () => {
    expect(out(new KQSim({}), "get ingress -o yaml")).toBe(EMPTY_LIST);
    const sim = new KQSim({ ingresses: [{ name: "tor", host: "a.example", path: "/", service: "web", port: 80, className: "nginx" }] });
    const r = run(sim, "get ingress -o yaml");
    expect(r.error).toBe(true);
    expect(r.output).toContain(NICHT_SIMULIERT);
    for (const k of yamlKinds()) expect(r.output).toContain(k);
    expect(r.output).not.toContain("kind:");
  });
  test("get nodes -o yaml → Nicht simuliert", () => {
    expect(out(new KQSim({}), "get nodes -o yaml")).toContain(NICHT_SIMULIERT);
  });
  test("get all -o yaml: Pod, Service, Deployment, ReplicaSet, StatefulSet ohne Fehler", () => {
    const r = run(new KQSim(reich()), "get all -o yaml");
    expect(r.error).toBeFalsy();
    const kinds = new Set(items(new KQSim(reich()), "get all -o yaml").map(i => i.kind));
    expect([...kinds].sort()).toEqual(["Deployment", "Pod", "ReplicaSet", "Service", "StatefulSet"]);
  });
  test("get all -o yaml mit einem Grafana-Objekt → Nicht simuliert", () => {
    const sim = new KQSim({ ...reich(), grafanaDashboards: [{ name: "d", title: "T", panels: 3 }] });
    expect(out(sim, "get all -o yaml")).toContain(NICHT_SIMULIERT);
  });
  test("System-Pods: -n kube-system und -A → Nicht simuliert", () => {
    const sim = new KQSim(reich());
    expect(out(sim, "get pods -n kube-system -o yaml")).toContain(NICHT_SIMULIERT);
    expect(out(sim, "get pods -A -o yaml")).toContain(NICHT_SIMULIERT);
    expect(out(sim, "get pods -n kube-system -o yaml")).not.toContain("kind:");
  });
  test("get deploy -A -o yaml liefert eine List", () => {
    expect(doc(new KQSim(reich()), "get deploy -A -o yaml").kind).toBe("List");
  });
  test("Komma-Liste und Slash-Form über mehrere Arten: eine List", () => {
    const sim = new KQSim(reich());
    expect(items(sim, "get deploy,svc -o yaml").map(i => i.kind)).toEqual(["Deployment", "Deployment", "Service", "Service"]);
    expect(items(sim, "get deploy/web svc/web -o yaml").map(i => i.kind)).toEqual(["Deployment", "Service"]);
  });
  test("bei abgeschalteter Control-Plane greift das Gate", () => {
    const sim = new KQSim({ ...reich(), controlPlane: { up: false } });
    expect(out(sim, "get deploy -o yaml")).toContain("connection to the server");
  });
});

describe("Deployment", () => {
  test("Golden-Text eines voll belegten Deployments", () => {
    const sim = new KQSim({
      deployments: [dep("web", {
        replicas: 1, containerPort: 8080, serviceAccountName: "robo", memLimit: 1024, cpuLimitMilli: 1000, ephemeralLimit: 100,
        securityContext: { runAsNonRoot: true }, emptyDir: {}, initContainer: { fillsMi: 5 }, envFrom: { configMaps: ["cfg"], secrets: ["sek"] },
      })],
    });
    expect(out(sim, "get deploy web -o yaml")).toBe([
      "apiVersion: apps/v1",
      "kind: Deployment",
      "metadata:",
      "  labels:",
      "    app: web",
      "  name: web",
      "  namespace: default",
      "spec:",
      "  replicas: 1",
      "  selector:",
      "    matchLabels:",
      "      app: web",
      "  template:",
      "    metadata:",
      "      labels:",
      "        app: web",
      "    spec:",
      "      containers:",
      "      - envFrom:",
      "        - configMapRef:",
      "            name: cfg",
      "        - secretRef:",
      "            name: sek",
      "        image: nginx:1",
      "        name: web",
      "        ports:",
      "        - containerPort: 8080",
      "        resources:",
      "          limits:",
      '            cpu: "1"',
      "            ephemeral-storage: 100Mi",
      "            memory: 1Gi",
      "        securityContext:",
      "          runAsNonRoot: true",
      "      initContainers:",
      "      - name: vorbereiter",
      "      serviceAccountName: robo",
      "      volumes:",
      "      - emptyDir: {}",
      "        name: scratch",
      "status:",
      "  availableReplicas: 1",
      "  readyReplicas: 1",
      "  replicas: 1",
      "  updatedReplicas: 1",
    ].join("\n"));
  });

  test("Quantities: 250m, 1500m, 512Mi, 1536Mi (kein glattes Gi)", () => {
    const sim = new KQSim({ deployments: [dep("web", { cpuLimitMilli: 250, memLimit: 512 }), dep("b", { cpuLimitMilli: 1500, memLimit: 1536 })] });
    const lim = (n: string) => ((((doc(sim, "get deploy " + n + " -o yaml").spec as Obj).template as Obj).spec as Obj).containers as Obj[])[0].resources as Obj;
    expect(lim("web")).toEqual({ limits: { cpu: "250m", memory: "512Mi" } });
    expect(lim("b")).toEqual({ limits: { cpu: "1500m", memory: "1536Mi" } });
  });

  test("nichts erfunden: ohne Template-Felder nur Name und Image; 0 Replicas ohne Zähler", () => {
    const o = doc(new KQSim({ deployments: [dep("web", { replicas: 0 })] }), "get deploy web -o yaml");
    expect(((o.spec as Obj).template as Obj).spec).toEqual({ containers: [{ image: "nginx:1", name: "web" }] });
    expect((o.spec as Obj).replicas).toBe(0);
    expect(o.status).toEqual({});
  });

  test("nicht bereit: unavailableReplicas, kein readyReplicas", () => {
    const o = doc(new KQSim({ deployments: [dep("web", { broken: { type: "notready", needsSecret: "sek" } })] }), "get deploy web -o yaml");
    expect(o.status).toEqual({ replicas: 2, unavailableReplicas: 2, updatedReplicas: 2 });
  });

  test("Node-Pin im Template: spec.nodeName", () => {
    const o = doc(new KQSim({ deployments: [dep("web", { node: "ahoi-worker-2" })] }), "get deploy web -o yaml");
    expect((((o.spec as Obj).template as Obj).spec as Obj).nodeName).toBe("ahoi-worker-2");
  });
});

describe("ReplicaSet", () => {
  test("Name und Hash stimmen mit der Tabelle und den Pods überein", () => {
    const sim = new KQSim(reich());
    const rs = out(sim, "get rs").split("\n")[1].split(/\s+/)[0];
    const o = doc(sim, "get rs " + rs + " -o yaml");
    const hash = rs.slice("web-".length);
    expect(o.kind).toBe("ReplicaSet");
    expect((o.metadata as Obj).labels).toEqual({ app: "web", "pod-template-hash": hash });
    expect((((o.spec as Obj).selector as Obj).matchLabels)).toEqual({ app: "web", "pod-template-hash": hash });
    expect(sim.deployments[0].pods.every(p => p.name.startsWith(rs + "-"))).toBe(true);
    expect(o.status).toEqual({ availableReplicas: 2, fullyLabeledReplicas: 2, readyReplicas: 2, replicas: 2 });
  });
});

describe("Service", () => {
  test("Golden-Text des Service kubernetes", () => {
    expect(out(new KQSim({}), "get svc kubernetes -o yaml")).toBe([
      "apiVersion: v1",
      "kind: Service",
      "metadata:",
      "  labels:",
      "    component: apiserver",
      "    provider: kubernetes",
      "  name: kubernetes",
      "  namespace: default",
      "spec:",
      "  clusterIP: 10.96.0.1",
      "  ports:",
      "  - name: https",
      "    port: 443",
      "    protocol: TCP",
      "    targetPort: 6443",
      "  type: ClusterIP",
      "status:",
      "  loadBalancer: {}",
    ].join("\n"));
  });
  test("ClusterIP: targetPort nur, wenn gesetzt (kein Rückfall auf port: die Sim wertet beides verschieden), Selector app=<name>", () => {
    const sim = new KQSim({ ...reich(), services: [svc("web", { targetPort: 8080 }), svc("api")] });
    expect((doc(sim, "get svc web -o yaml").spec as Obj).ports).toEqual([{ port: 80, protocol: "TCP", targetPort: 8080 }]);
    const api = doc(sim, "get svc api -o yaml").spec as Obj;
    expect(api.ports).toEqual([{ port: 80, protocol: "TCP" }]);
    expect(api.selector).toEqual({ app: "api" });
  });
  test("Port als Text (Helm speichert \"80\") wird als Zahl ausgegeben und liest sich zurück", () => {
    const sim = new KQSim({});
    sim.services.push(sim._makeService({ name: "h", port: "80" }));
    const text = out(sim, "get svc h -o yaml");
    expect(text).toContain("port: 80\n");
    expect(text).not.toContain('"80"');
    expect(effectsFromManifest(text, "h.yaml")).toEqual([{ service: { name: "h", port: 80, type: "ClusterIP" } }]);
  });
  test("headless: clusterIP None, Selector des StatefulSet", () => {
    const sim = new KQSim({ statefulSets: [sts()], services: [svc("speicher", { clusterIP: "None", port: 5432 })] });
    const spec = doc(sim, "get svc speicher -o yaml").spec as Obj;
    expect(spec.clusterIP).toBe("None");
    expect(spec.selector).toEqual({ app: "speicher" });
  });
  test("ExternalName: externalName, weder clusterIP noch ports noch selector", () => {
    const sim = new KQSim({ files: { "e.yaml": serviceYaml({ name: "bank", port: 0, type: "ExternalName", externalName: "api.bank.example.com" }) } });
    run(sim, "apply -f e.yaml");
    expect((doc(sim, "get svc bank -o yaml").spec as Obj)).toEqual({ externalName: "api.bank.example.com", type: "ExternalName" });
  });
});

describe("PersistentVolumeClaim", () => {
  test("gebunden: Langform der Access-Modes, Kapazität, volumeName, Phase", () => {
    const o = doc(new KQSim({ statefulSets: [sts()] }), "get pvc data-speicher-0 -o yaml");
    expect(o.kind).toBe("PersistentVolumeClaim");
    expect(o.spec).toMatchObject({ accessModes: ["ReadWriteOnce"], resources: { requests: { storage: "1Gi" } }, volumeMode: "Filesystem" });
    expect((o.spec as Obj).volumeName).toEqual(expect.any(String));
    expect(o.status).toEqual({ accessModes: ["ReadWriteOnce"], capacity: { storage: "1Gi" }, phase: "Bound" });
  });
  test("Pending ohne StorageClass: storageClassName \"\", kein volumeName, kein capacity", () => {
    const o = doc(new KQSim({ statefulSets: [sts({ storageClass: "", replicas: 1 })] }), "get pvc data-speicher-0 -o yaml");
    expect((o.spec as Obj).storageClassName).toBe("");
    expect((o.spec as Obj).volumeName).toBeUndefined();
    expect(o.status).toEqual({ phase: "Pending" });
  });
  test("Access-Modes: Kurzformen werden lang, Langformen und mehrere bleiben", () => {
    const sim = new KQSim({});
    sim.pvcs.push({ name: "m", status: "Pending", volume: "", capacity: "2Gi", storageClass: "", accessModes: "RWX,ReadOnlyMany,ROX,RWOP", created: 0 });
    expect((doc(sim, "get pvc m -o yaml").spec as Obj).accessModes).toEqual(["ReadWriteMany", "ReadOnlyMany", "ReadOnlyMany", "ReadWriteOncePod"]);
  });
});

describe("StatefulSet", () => {
  test("Selector, serviceName, Template, volumeClaimTemplates, Status", () => {
    const o = doc(new KQSim({ statefulSets: [sts()] }), "get sts speicher -o yaml");
    expect(o.kind).toBe("StatefulSet");
    expect(o.spec).toMatchObject({
      replicas: 2, selector: { matchLabels: { app: "speicher" } }, serviceName: "speicher",
      template: { spec: { containers: [{ image: "postgres:16", name: "speicher" }] } },
      volumeClaimTemplates: [{ kind: "PersistentVolumeClaim", metadata: { name: "data" }, spec: { accessModes: ["ReadWriteOnce"], resources: { requests: { storage: "1Gi" } } } }],
    });
    expect(o.status).toEqual({ availableReplicas: 2, currentReplicas: 2, readyReplicas: 2, replicas: 2, updatedReplicas: 2 });
  });
  test("mit Pending-PVC: nicht bereit, availableReplicas bleibt 0 (kein omitempty)", () => {
    const o = doc(new KQSim({ statefulSets: [sts({ storageClass: "", replicas: 1 })] }), "get sts speicher -o yaml");
    expect(o.status).toEqual({ availableReplicas: 0, currentReplicas: 1, replicas: 1, updatedReplicas: 1 });
  });
});

describe("replicas bleibt bei ReplicaSet und StatefulSet als 0 stehen (omitempty nur beim Deployment)", () => {
  test("ReplicaSet mit 0 Replicas: status.replicas 0", () => {
    const sim = new KQSim({ deployments: [dep("web", { replicas: 0 })] });
    const rs = out(sim, "get rs").split(String.fromCharCode(10))[1].split(/\s+/)[0];
    expect(doc(sim, "get rs " + rs + " -o yaml").status).toEqual({ replicas: 0 });
  });
  test("StatefulSet mit 0 Replicas: availableReplicas und replicas 0", () => {
    const o = doc(new KQSim({ statefulSets: [sts({ replicas: 0 })] }), "get sts speicher -o yaml");
    expect(o.status).toEqual({ availableReplicas: 0, replicas: 0 });
  });
});

describe("Pod", () => {
  const podOf = (d: object): Obj => items(new KQSim({ deployments: [dep("web", { replicas: 1, ...d })] }), "get pods -o yaml")[0];
  const cs = (p: Obj): Obj => ((p.status as Obj).containerStatuses as Obj[])[0];

  test("gesund: Running, Container bereit, podIP, nodeName, pod-template-hash", () => {
    const p = podOf({});
    expect((p.status as Obj).phase).toBe("Running");
    expect((p.status as Obj).podIP).toMatch(/^10\.244\.1\./);
    expect(cs(p)).toEqual({ image: "nginx:1", lastState: {}, name: "web", ready: true, restartCount: 0, state: { running: {} } });
    expect((p.spec as Obj).nodeName).toMatch(/^ahoi-/);
    expect(((p.metadata as Obj).labels as Obj)["pod-template-hash"]).toMatch(/^[a-z0-9]+$/);
  });

  test.each<[string, object, string, Obj]>([
    ["imagepull", { type: "imagepull" }, "Pending", { waiting: { reason: "ImagePullBackOff" } }],
    ["crashloop", { type: "crashloop" }, "Running", { waiting: { reason: "CrashLoopBackOff" } }],
    ["notready", { type: "notready", needsSecret: "sek" }, "Running", { running: {} }],
    ["oomkilled", { type: "oomkilled" }, "Running", { waiting: { reason: "CrashLoopBackOff" } }],
  ])("broken %s: Phase %s und der Container-Zustand, den describe pod schon zeigt", (_n, broken, phase, state) => {
    const p = podOf({ broken });
    expect((p.status as Obj).phase).toBe(phase);
    expect(cs(p).state).toEqual(state);
    expect(cs(p).ready).toBe(false);
  });

  test("broken pending mit Node-Pin im Template: der Pod zeigt keinen nodeName (nicht eingeplant)", () => {
    const p = podOf({ broken: { type: "pending" }, node: "ahoi-worker-2" });
    expect((p.spec as Obj).nodeName).toBeUndefined();
  });

  test("broken pending: Phase Pending, weder Container-Status noch podIP noch nodeName", () => {
    const p = podOf({ broken: { type: "pending" } });
    expect(p.status).toEqual({ phase: "Pending" });
    expect((p.spec as Obj).nodeName).toBeUndefined();
  });

  test("oomkilled: lastState terminated OOMKilled (Exit 137), Restarts wie get pods", () => {
    const sim = new KQSim({ deployments: [dep("web", { replicas: 1, broken: { type: "oomkilled" } })] });
    const c = ((items(sim, "get pods -o yaml")[0].status as Obj).containerStatuses as Obj[])[0];
    expect(c.lastState).toEqual({ terminated: { exitCode: 137, reason: "OOMKilled" } });
    expect(String(c.restartCount as number)).toBe(out(sim, "get pods").split("\n")[1].split(/\s+/)[3]);
  });

  test("evicted: Phase Failed, Reason Evicted, Message, keine Container-Status", () => {
    const sim = new KQSim({ deployments: [dep("web", { replicas: 1, ephemeralLimit: 512, emptyDir: { data: "x", usedMi: 600 } })] });
    const s = items(sim, "get pods -o yaml")[0].status as Obj;
    expect(s.phase).toBe("Failed");
    expect(s.reason).toBe("Evicted");
    expect(s.message).toBe(sim.deployments[0].evicted?.reason);
    expect(s.containerStatuses).toBeUndefined();
  });

  test("StatefulSet-Pod: Claim als Volume; mit Pending-PVC Pending ohne IP", () => {
    const ok = items(new KQSim({ statefulSets: [sts()] }), "get pods -o yaml");
    expect((ok[0].spec as Obj).volumes).toEqual([{ name: "data", persistentVolumeClaim: { claimName: "data-speicher-0" } }]);
    expect((ok[0].status as Obj).phase).toBe("Running");
    const wait = items(new KQSim({ statefulSets: [sts({ storageClass: "", replicas: 1 })] }), "get pods -o yaml")[0];
    expect(wait.status).toEqual({ phase: "Pending" });
    expect(((ok[0].status as Obj).containerStatuses as Obj[])).toEqual([{ image: "postgres:16", lastState: {}, name: "speicher", ready: true, restartCount: 0, state: { running: {} } }]);
  });
});

describe("Negativ: nichts erfunden", () => {
  const FORBIDDEN = /uid:|managedFields|creationTimestamp|ownerReferences|requireBuiltImage|fillsMi|doubleStage|cpuHeavy|broken|ephemeralUsedMi|restartedAt|usedMi|needsSecret|memNeeded/;
  test.each(["get deploy", "get pods", "get rs", "get svc", "get sts", "get pvc", "get all"])("%s -o yaml enthält keine Laufzeit-IDs und keine Sim-Sonderfelder", cmd => {
    const sim = new KQSim({
      deployments: [dep("web", { containerPort: 8080, emptyDir: { usedMi: 7 }, initContainer: { fillsMi: 9, doubleStage: true }, ephemeralUsedMi: 3, cpuHeavy: true, restartedAt: 4 }),
        dep("kaputt", { broken: { type: "crashloop", needsSecret: "sek" } })],
      services: [svc("web")], statefulSets: [sts()],
    });
    const text = out(sim, cmd + " -o yaml");
    expect(text).not.toBe("");
    expect(text).not.toMatch(FORBIDDEN);
  });
  test("metadata.resourceVersion steht nur an der List, nie an einem Objekt", () => {
    const text = out(new KQSim(reich()), "get all -o yaml");
    expect(text.match(/resourceVersion/g)).toHaveLength(1);
  });
});

describe("Round-Trip mit dem Manifest-Mapper (Konsistenz-Wächter Mapper ↔ Ausgabe)", () => {
  const deployments: [string, Parameters<typeof deploymentYaml>[0]][] = [
    ["minimal", { name: "web" }],
    ["alle Optionen", {
      name: "web", image: "nginx:1.27", replicas: 3, serviceAccountName: "robo", containerPort: 8080, nodeName: "ahoi-worker-2",
      securityContext: { runAsNonRoot: true, privileged: false, readOnlyRootFilesystem: true, allowPrivilegeEscalation: false },
      ephemeralLimitMi: 512, memoryLimit: "1Gi", cpuLimit: 0.5, emptyDir: true, initContainer: true,
    }],
    ["cpu als Text und ganze Cores", { name: "web", cpuLimit: "2", memoryLimit: "256Mi" }],
  ];
  test.each(deployments)("Deployment %s: Mapper(Ausgabe) = Mapper(Original)", (_n, o) => {
    const orig = deploymentYaml(o);
    const sim = freshSim();
    sim.files["a.yaml"] = orig;
    expect(run(sim, "apply -f a.yaml").error).toBeFalsy();
    const text = out(sim, "get deploy web -o yaml");
    expect(effectsFromManifest(text, "b.yaml")).toEqual(effectsFromManifest(orig, "a.yaml"));
  });

  type Svc = Parameters<typeof serviceYaml>[0];
  const services: [string, Svc, object][] = [
    ["ClusterIP", { name: "web", port: 80, type: "ClusterIP" }, {}],
    ["mit targetPort", { name: "web", port: 80, targetPort: 8080, type: "ClusterIP" }, {}],
    ["NodePort", { name: "web", port: 80, targetPort: 8080, type: "NodePort" }, {}],
    ["LoadBalancer", { name: "web", port: 443, type: "LoadBalancer" }, {}],
    ["ExternalName", { name: "bank", port: 0, type: "ExternalName", externalName: "api.bank.example.com" }, {}],
  ];
  test.each(services)("Service %s: Mapper(Ausgabe) = Mapper(Original) (targetPort nur wenn gesetzt, sonst Original-Effekt ohne ihn)", (_n, o) => {
    const orig = serviceYaml(o);
    const sim = freshSim();
    sim.files["a.yaml"] = orig;
    expect(run(sim, "apply -f a.yaml").error).toBeFalsy();
    const text = out(sim, "get svc " + o.name + " -o yaml");
    const want = effectsFromManifest(orig, "a.yaml") as ApplyEffect[];
    const got = effectsFromManifest(text, "b.yaml") as ApplyEffect[];
    expect(got).toEqual(want);
  });

  test("headless (clusterIP: None) überlebt", () => {
    const orig = "apiVersion: v1\nkind: Service\nmetadata:\n  name: speicher\nspec:\n  clusterIP: None\n  ports:\n    - port: 5432\n";
    const sim = freshSim();
    sim.files["a.yaml"] = orig;
    run(sim, "apply -f a.yaml");
    const got = effectsFromManifest(out(sim, "get svc speicher -o yaml"), "b.yaml") as ApplyEffect[];
    expect(got[0].service).toMatchObject({ name: "speicher", clusterIP: "None", port: 5432 });
  });

  test("Fixpunkt: Ausgabe anwenden (frische Sim) und erneut ausgeben ergibt denselben Text", () => {
    const orig = deploymentYaml({ name: "web", replicas: 2, containerPort: 8080, memoryLimit: "1Gi", cpuLimit: "250m", emptyDir: true, initContainer: true, serviceAccountName: "robo" })
      + "---\n" + serviceYaml({ name: "web", port: 80, targetPort: 8080, type: "ClusterIP" });
    const a = freshSim();
    a.files["a.yaml"] = orig;
    expect(run(a, "apply -f a.yaml").error).toBeFalsy();
    const first = ["get deploy web -o yaml", "get svc web -o yaml"].map(c => out(a, c));
    const b = freshSim();
    b.files["a.yaml"] = first.join("\n---\n");
    expect(run(b, "apply -f a.yaml").error).toBeFalsy();
    expect(["get deploy web -o yaml", "get svc web -o yaml"].map(c => out(b, c))).toEqual(first);
  });

  test("Property: parseYamlDocuments(emitYaml(objekt)) = objekt für alle Baustein-Objekte einer reichen Fixture", () => {
    const sim = new KQSim({
      deployments: [
        dep("web", { containerPort: 8080, memLimit: 1536, cpuLimitMilli: 1500, serviceAccountName: "robo", securityContext: { runAsNonRoot: true }, emptyDir: {}, initContainer: { fillsMi: 1 }, envFrom: { configMaps: ["c"], secrets: ["s"] } }),
        dep("a", { broken: { type: "imagepull" } }), dep("b", { broken: { type: "crashloop" } }), dep("c", { broken: { type: "oomkilled" } }),
        dep("d", { broken: { type: "pending" } }), dep("e", { broken: { type: "notready", needsSecret: "x" } }),
        dep("f", { ephemeralLimit: 512, emptyDir: { data: "x", usedMi: 600 } }),
      ],
      services: [svc("web", { targetPort: 8080 }), svc("speicher", { clusterIP: "None", port: "5432" })],
      statefulSets: [sts(), sts({ name: "wartend", serviceName: "wartend", volumeClaimName: "w", storageClass: "", replicas: 1 })],
    });
    let n = 0;
    for (const [plural, baustein] of YAML_BAUSTEINE) {
      for (const [name, o] of baustein(sim)) {
        expect(parseYamlDocuments(emitYaml(o)), plural + "/" + name).toEqual([o]);
        n++;
      }
    }
    expect(n).toBeGreaterThan(20);
  });
});

describe("Fitness: Registry ↔ Renderer ↔ Mapper", () => {
  test("jede Baustein-Art hat einen Tabellen-Renderer", () => {
    for (const plural of YAML_BAUSTEINE.keys()) expect(GET_RENDERERS.has(plural), plural).toBe(true);
  });
  test("Baustein-Namen = Tabellen-Namen auf einer reichen Fixture", () => {
    const sim = new KQSim(reich());
    for (const [plural, baustein] of YAML_BAUSTEINE) {
      const names = [...baustein(sim).keys()];
      const table = out(sim, "get " + plural).split("\n").slice(1).map(l => l.split(/\s+/)[0]).filter(Boolean);
      expect(names.sort(), plural).toEqual(table.sort());
    }
  });
  test("jede Art in MAPPED_KINDS hat einen Baustein, der genau dieses kind ausgibt", () => {
    const sim = new KQSim(reich());
    const ausgegeben = new Set([...YAML_BAUSTEINE.values()].flatMap(b => [...b(sim).values()].map(o => o.kind)));
    for (const kind of MAPPED_KINDS) expect(ausgegeben.has(kind), kind).toBe(true);
  });
  test("jeder Baustein gibt für alle seine Objekte dasselbe kind aus", () => {
    const sim = new KQSim(reich());
    for (const [plural, baustein] of YAML_BAUSTEINE) {
      expect(new Set([...baustein(sim).values()].map(o => o.kind)).size, plural).toBe(1);
    }
  });
  test("die Grenze yaml-auswahl nennt jede Baustein-Art", () => {
    const text = simGrenzen("kubectl").find(g => g.id === "yaml-auswahl")?.text ?? "";
    for (const plural of YAML_BAUSTEINE.keys()) {
      const k = RESOURCE_KINDS.find(r => r.plural === plural)!;
      expect([k.plural, ...k.short].some(n => text.includes(n)), plural).toBe(true);
    }
  });
});

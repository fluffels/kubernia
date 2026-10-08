/* Namespace-Filter für `kubectl get` (#1417): jede namespaced Ressource meldet in einem
 * fremden Namespace „No resources found in <ns> namespace.", cluster-weite ignorieren `-n`.
 * Der Geltungsbereich ist je Eintrag in GET_RENDERERS Pflicht (Fitness-Test unten). */
import { describe, test, expect } from "vitest";
import { KQSim } from "./helpers";
import { GET_RESOURCE_SCOPES } from "../../src/sim/kubectl/inspect";
import type { Scenario } from "../../src/sim/state";

// Quelle: Spalte NAMESPACED von `kubectl api-resources`; Schlüssel = erster Alias.
// `alerts` ist eine Pseudoressource (eingebaute Regeln), also cluster-weit.
const API_RESOURCES: Record<string, boolean> = {
  pods: true, deployments: true, replicasets: true, services: true, endpoints: true, nodes: false,
  secrets: true, configmaps: true, ingresses: true, networkpolicies: true,
  servicemonitors: true, prometheusrules: true, grafanadatasources: true, grafanadashboards: true,
  statefulsets: true, persistentvolumeclaims: true, persistentvolumes: false, storageclasses: false,
  volumesnapshots: true, serviceaccounts: true, roles: true, clusterroles: false,
  rolebindings: true, clusterrolebindings: false, alerts: false,
};

/** Name eines Objekts je Ressource (erster Alias), das im Szenario in `default` liegt. */
const NAMEN: Record<string, string> = {
  pods: "zz-web", deployments: "zz-web", replicasets: "zz-web", services: "zz-svc", endpoints: "zz-svc",
  secrets: "zz-secret", configmaps: "zz-cm", ingresses: "zz-ing", networkpolicies: "zz-np",
  servicemonitors: "zz-smon", prometheusrules: "zz-rule", grafanadatasources: "zz-ds",
  grafanadashboards: "zz-dash", statefulsets: "zz-db", persistentvolumeclaims: "zz-pvc",
  persistentvolumes: "zz-pv", storageclasses: "zz-sc", volumesnapshots: "zz-snap",
  serviceaccounts: "zz-sa", roles: "zz-role", clusterroles: "zz-crole",
  rolebindings: "zz-rb", clusterrolebindings: "zz-crb",
};

function voll(): Scenario {
  return {
    deployments: [{ name: "zz-web", image: "web:1", replicas: 1 }],
    services: [{ name: "zz-svc", type: "ClusterIP", clusterIP: "10.96.0.7", port: 80 }],
    ingresses: [{ name: "zz-ing", className: "nginx", host: "h.de", path: "/", service: "zz-svc", port: 80 }],
    networkPolicies: [{ name: "zz-np", podSelector: "", allowFrom: "" }],
    secrets: [{ name: "zz-secret", keys: ["k"] }],
    configMaps: [{ name: "zz-cm", keys: ["k"] }],
    serviceMonitors: [{ name: "zz-smon", selector: "app=zz", port: "metrics", interval: "30s" }],
    prometheusRules: [{ name: "zz-rule", alert: "Down", expr: "up==0", forDuration: "5m", severity: "warning" }],
    grafanaDatasources: [{ name: "zz-ds", dsType: "prometheus", url: "http://p" }],
    grafanaDashboards: [{ name: "zz-dash", title: "Hafen", panels: 3 }],
    statefulSets: [{ name: "zz-db", image: "db:1", replicas: 1 }],
    pvcs: [{ name: "zz-pvc", storage: "1Gi" }],
    pvs: [{ name: "zz-pv", capacity: "1Gi" }],
    storageClasses: [{ name: "zz-sc" }],
    volumeSnapshots: [{ name: "zz-snap", sourcePvc: "zz-pvc" }],
    serviceAccounts: ["zz-sa"],
    roles: [
      { name: "zz-role", rules: [{ verbs: ["get"], resources: ["pods"] }] },
      { name: "zz-crole", cluster: true, rules: [{ verbs: ["get"], resources: ["pods"] }] },
    ],
    roleBindings: [
      { name: "zz-rb", roleRef: { kind: "Role", name: "zz-role" }, subjects: [{ kind: "User", name: "ada" }] },
      { name: "zz-crb", cluster: true, roleRef: { kind: "ClusterRole", name: "zz-crole" }, subjects: [{ kind: "User", name: "ada" }] },
    ],
  };
}

const LEER = (ns: string) => "No resources found in " + ns + " namespace.";
/** Serverwarnungen (z.B. v1 Endpoints, #1496) stehen vor der Antwort und gehören nicht zur Namespace-Prüfung. */
const ohneWarnung = (out: string | null | undefined) => (out ?? "").replace(/^Warning:.*\n/gm, "");
const FLAGS = (ns: string) => [`-n ${ns}`, `--namespace ${ns}`, `-n=${ns}`, `--namespace=${ns}`];
const erster = (e: { aliases: string[] }) => e.aliases[0];
const namespaced = GET_RESOURCE_SCOPES.filter(e => e.namespaced);
const clusterWeit = GET_RESOURCE_SCOPES.filter(e => !e.namespaced);

describe("Fitness: jeder get-Renderer trägt seinen Geltungsbereich", () => {
  test("namespaced ist ein boolean an jedem Eintrag", () => {
    for (const e of GET_RESOURCE_SCOPES) expect(typeof e.namespaced).toBe("boolean");
  });
  test("Tabelle und Registry decken dieselben Ressourcen ab (beide Richtungen)", () => {
    expect(GET_RESOURCE_SCOPES.map(erster).sort()).toEqual(Object.keys(API_RESOURCES).sort());
  });
  test("Werte stimmen mit kubectl api-resources überein", () => {
    for (const e of GET_RESOURCE_SCOPES) expect(e.namespaced, erster(e)).toBe(API_RESOURCES[erster(e)]);
  });
  test("extraNamespaces nur an namespaced Einträgen", () => {
    for (const e of clusterWeit) expect(e.extraNamespaces, erster(e)).toBeUndefined();
  });
});

describe("namespaced Ressourcen: fremder Namespace → Leermeldung", () => {
  for (const e of namespaced) {
    for (const alias of e.aliases) {
      test.each(FLAGS("anderer-ns"))(`get ${alias} %s`, flag => {
        const sim = new KQSim(voll());
        const r = sim.exec(`kubectl get ${alias} ${flag}`);
        expect(r.error).toBe(false);
        expect(ohneWarnung(r.output)).toBe(LEER("anderer-ns"));
      });
    }
    test(`get ${erster(e)} ohne -n listet weiter (Positivkontrolle)`, () => {
      const out = new KQSim(voll()).exec(`kubectl get ${erster(e)}`).output;
      expect(out ?? "").toContain(NAMEN[erster(e)] ?? "");
    });
  }
});

describe("Negativtests je Ressourcenfamilie: kein Objekt aus default im fremden Namespace", () => {
  const FAMILIEN: Record<string, string[]> = {
    Workloads: ["deployments", "replicasets", "statefulsets", "pods"],
    Netz: ["services", "endpoints", "ingresses", "networkpolicies"],
    Konfiguration: ["secrets", "configmaps"],
    Observability: ["servicemonitors", "prometheusrules", "grafanadatasources", "grafanadashboards"],
    Speicher: ["persistentvolumeclaims", "volumesnapshots"],
    RBAC: ["serviceaccounts", "roles", "rolebindings"],
  };
  describe.each(Object.entries(FAMILIEN))("%s", (_name, ressourcen) => {
    test.each(ressourcen)("%s", res => {
      const sim = new KQSim(voll());
      expect(sim.exec(`kubectl get ${res}`).output).toContain(NAMEN[res]);
      const out = sim.exec(`kubectl get ${res} -n anderer-ns`).output;
      expect(out).not.toContain(NAMEN[res]);
      expect(ohneWarnung(out)).toBe(LEER("anderer-ns"));
    });
  });
  test("services zeigt im fremden Namespace auch die kubernetes-Zeile nicht", () => {
    const out = new KQSim(voll()).exec("kubectl get svc -n anderer-ns").output;
    expect(out).not.toContain("kubernetes");
  });
});

describe("cluster-weite Ressourcen ignorieren -n", () => {
  for (const e of clusterWeit) {
    test.each(FLAGS("anderer-ns"))(`get ${erster(e)} %s == ohne -n`, flag => {
      const ohne = new KQSim(voll()).exec(`kubectl get ${erster(e)}`).output;
      const mit = new KQSim(voll()).exec(`kubectl get ${erster(e)} ${flag}`).output;
      expect(mit).toBe(ohne);
      expect(mit ?? "").not.toMatch(/^No resources found in anderer-ns/);
    });
  }
  test.each(["persistentvolumes", "storageclasses", "clusterroles", "clusterrolebindings"])("%s: Objektname bleibt sichtbar", res => {
    expect(new KQSim(voll()).exec(`kubectl get ${res} -n anderer-ns`).output).toContain(NAMEN[res]);
  });
});

describe("Grenzfälle", () => {
  test.each(["deployments", "svc", "secrets", "configmaps"])("get %s -n kube-system → Leermeldung", res => {
    expect(new KQSim(voll()).exec(`kubectl get ${res} -n kube-system`).output).toBe(LEER("kube-system"));
  });
  test("get pods -n kube-system zeigt weiter die System-Pods", () => {
    expect(new KQSim(voll()).exec("kubectl get pods -n kube-system").output).toContain("coredns");
  });
  test.each(["-n default", "--namespace=default"])("get deployments %s listet normal", flag => {
    expect(new KQSim(voll()).exec(`kubectl get deployments ${flag}`).output).toContain("zz-web");
  });
  test("-A gewinnt gegen -n", () => {
    expect(new KQSim(voll()).exec("kubectl get deployments -A -n anderer-ns").output).toContain("zz-web");
  });
  test("unbekannter Typ mit -n bleibt ein Typ-Fehler", () => {
    const r = new KQSim(voll()).exec("kubectl get unfug -n anderer-ns");
    expect(r.output).toContain("doesn't have a resource type");
  });
  test("benannter get im fremden Namespace → NotFound wie echtes kubectl (#1444)", () => {
    const r = new KQSim(voll()).exec("kubectl get endpoints zz-svc -n anderer-ns");
    expect(r.error).toBe(true);
    expect(r.output).toContain('Error from server (NotFound): endpoints "zz-svc" not found');
  });
});

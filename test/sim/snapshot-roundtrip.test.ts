/* Round-Trip-Idempotenztest snapshot()/reset() über ALLE ClusterState-Felder (#865).
 *
 * Warum dieser Test neben dem bestehenden Netz existiert:
 *  - sim.test.ts "snapshot/restore erhält den kompletten Zustand" prüft nur einen kleinen,
 *    über exec() erspielten Ausschnitt (ein paar Deployments/Secrets/Releases) und nur per
 *    Stichprobe auf Textfragmente in der Terminal-Ausgabe – kein Feld-für-Feld-Beweis.
 *  - resource-registry.test.ts prüft den Roundtrip nur für die sieben SIMPLE_RESOURCE_KEYS.
 *  - Hier wird JEDER ClusterState-Zweig (state.ts) mit einem untypischen, klar von den
 *    Defaults abweichenden Wert befüllt, über snapshot() → JSON-Roundtrip → reset() (via
 *    `new KQSim(snapshot)`) neu geladen und Feld für Feld gegen den Ausgangszustand geprüft.
 *    Das fängt genau die Auslassung, die reset()/mergeScenario()/snapshot() bei ihrer
 *    3-fachen Pflege (siehe Kommentar in sim.ts) auseinanderdriften lassen kann – bevor der
 *    Split (#893, sim.ts entflechten) die Struktur anfasst.
 *
 * Determinismus (kein Rng-Flackern): PVC/PV liegen schon fertig gebunden vor (kein
 * dynamisches Provisionieren nötig), das StatefulSet erzeugt sein PVC zwar dynamisch – das
 * passiert aber erst NACH den Deployments (der einzigen Rng-Verbraucherin vor der Storage-
 * Phase in reset()) und wirkt sich daher nicht auf deren Pod-Namen aus. Beide Sim-Instanzen
 * starten außerdem mit demselben Default-Seed (zweites KQSim-Argument unbenutzt).
 */
import { test, expect } from "vitest";
import { KQSim } from "./helpers";
import type { ClusterState, Scenario } from "../../src/sim/state";

/** Jedes Feld aus `ClusterState` (state.ts) außer `scenario` (der Input selbst, kein
 *  Rundreise-Ziel) und `clock` (wird nicht serialisiert – jede frische reset() startet bei 0,
 *  in beiden Instanzen gleich, siehe unten). Diese Liste ist bewusst 1:1 aus dem Interface
 *  abgeschrieben: wächst ClusterState um ein Feld, MUSS diese Liste (oder die Ausschluss-
 *  Liste unten) mitwachsen, sonst schlägt der Vollständigkeits-Test weiter unten fehl. */
const CLUSTER_STATE_FIELDS = [
  "docker", "nodes", "deployments", "services", "ingresses", "networkPolicies",
  "secrets", "configMaps", "files", "applyEffects",
  "serviceMonitors", "prometheusRules", "grafanaDatasources", "grafanaDashboards",
  "statefulSets", "pvcs", "pvs", "storageClasses", "volumeSnapshots", "objectStore",
  "serviceAccounts", "roles", "roleBindings", "podSecurity",
  "argoApps", "helmRepos", "releases", "charts",
  "tf", "git", "ci", "controlPlane",
] as const satisfies readonly (keyof ClusterState)[];

/** Sim-eigene Laufzeit-Felder, die BEWUSST kein Teil von `ClusterState` sind (siehe
 *  Kommentar über dem Interface in state.ts) und daher nie über snapshot()/reset() reisen. */
const TRANSIENT_SIM_FIELDS = [
  "scenario", "clock", "rev", "rng", "_seed",
  "lastDeletedPod", "lastError", "invariantChecks", "_firingAlerts", "_resolvedAlerts",
] as const;

/* Ein Szenario, das JEDEN Zweig mit einem Wert befüllt, der sich klar vom reset()-Default
 * unterscheidet (leere Liste/Default-String/false …) – sonst könnte eine vergessene
 * Serialisierung unbemerkt bleiben, weil Ausgangs- und Default-Wert zufällig gleich sind. */
const bigScenario: Scenario = {
  dockerImages: ["nginx:1.27"],
  dockerContainers: [{ name: "build-tmp", image: "nginx:1.27", running: false, created: 0, id: "c-123" }],

  nodes: [
    { name: "ahoi-control", status: "Ready", roles: "control-plane", version: "v1.30.2", ephemeralCapacityMi: 2000, ephemeralBaseMi: 200 },
    { name: "ahoi-worker-1", status: "Ready", roles: "<none>", version: "v1.30.2", ephemeralCapacityMi: 1000, ephemeralBaseMi: 100 },
  ],
  // Überschreibt die aus `nodes` abgeleitete Control-Plane-Lage explizit (Round-trip-Feld,
  // siehe deriveControlPlane) – unabhängig von den Node-Rollen oben.
  controlPlane: { up: true, token: "abcdef.token123456", node: "ahoi-control" },

  deployments: [{
    name: "kasse", image: "nginx", replicas: 2, broken: null,
    envFrom: { configMaps: ["app-config"], secrets: ["db-secret"] },
    cpuHeavy: true, containerPort: 8080,
    node: "ahoi-worker-1", emptyDir: { data: "tmp-data", usedMi: 50 },
    ephemeralLimit: 500, ephemeralUsedMi: 120,
    initContainer: { fillsMi: 80, doubleStage: true },
  }],

  services: [{ name: "kasse-svc", type: "ClusterIP", clusterIP: "10.96.0.5", port: 80, targetPort: 8080 }],
  ingresses: [{ name: "kasse-ing", className: "nginx", host: "hafen.de", path: "/kasse", service: "kasse-svc", port: 80, tls: { secretName: "tls-secret" } }],
  networkPolicies: [{ name: "deny-all", podSelector: "", allowFrom: "" }],
  secrets: [{ name: "db-secret", keys: ["password"], type: "Opaque" }],
  configMaps: [{ name: "app-config", keys: ["LOG_LEVEL"] }],
  files: { "Dockerfile": "FROM nginx:1.27" },
  applyEffects: { "deploy.yaml": { deployment: { name: "kasse-apply", image: "nginx", replicas: 1, containerPort: 80 } } },
  serviceMonitors: [{ name: "kasse-mon", selector: "app=kasse", port: "metrics", interval: "30s" }],
  prometheusRules: [{ name: "kasse-rule", alert: "HighCPU", expr: "cpu>80", forDuration: "5m", severity: "warning" }],
  grafanaDatasources: [{ name: "prom", dsType: "prometheus", url: "http://prom:9090" }],
  grafanaDashboards: [{ name: "board", title: "Hafen-Uebersicht", panels: 4 }],

  statefulSets: [{ name: "lagerhalle", image: "postgres", replicas: 2, serviceName: "lagerhalle-svc", volumeClaimName: "data", storage: "3Gi", storageClass: "schnell" }],
  // Schon fertig gebunden (kein dynamisches Provisionieren) – hält den Roundtrip Rng-frei.
  pvcs: [{ name: "pvc-logs", storage: "5Gi", storageClass: "schnell", accessModes: "RWX", status: "Bound", volume: "pv-logs-vol", data: "log-inhalt" }],
  pvs: [{ name: "pv-standalone", capacity: "2Gi", storageClass: "schnell", accessModes: "RWO", reclaimPolicy: "Retain", status: "Available", claim: "" }],
  storageClasses: [{ name: "schnell", provisioner: "rancher.io/fast-path", reclaimPolicy: "Retain", isDefault: true }],
  volumeSnapshots: [{ name: "snap-logs", sourcePvc: "pvc-logs", data: "log-inhalt-snapshot", restoreSize: "5Gi", readyToUse: true }],
  s3Buckets: [{ name: "backup-bucket", objects: [{ key: "backup.tar", content: "BACKUP-INHALT" }] }],

  serviceAccounts: ["wachtturm-sa"],
  roles: [{ name: "pod-reader", cluster: false, rules: [{ verbs: ["get", "list"], resources: ["pods"] }] }],
  roleBindings: [{ name: "pod-reader-binding", cluster: false, roleRef: { kind: "Role", name: "pod-reader" }, subjects: [{ kind: "ServiceAccount", name: "wachtturm-sa", namespace: "default" }] }],
  podSecurity: "restricted",

  argoApps: [{
    name: "flotte-app", repo: "https://git.example/kubernia-manifeste", path: "apps/flotte",
    autoSync: true, selfHeal: true,
    desired: { deployment: { name: "kasse", image: "nginx", replicas: 2 }, service: { name: "kasse-svc", type: "ClusterIP", port: 80 } },
    created: 5,
  }],
  helmRepos: [{ name: "bitnami", url: "https://charts.bitnami.com/bitnami" }],
  releases: [{ name: "web", chart: "bitnami/nginx", revision: 2, depName: "web-nginx", history: [{ revision: 1, replicas: 1 }, { revision: 2, replicas: 3 }] }],
  charts: [{ name: "eigenes-chart", version: "0.2.0", packaged: true }],

  tfInitialized: true, tfApplied: true,
  tfResources: [{ addr: "aws_instance.hafen", desc: "Server im Hafen", provider: "insel-a" }],
  tfProviders: [{ name: "insel-a", source: "hashicorp/aws", version: "5.40.0" }],
  tfModules: [{ name: "hafen-anlage", source: "./modules/hafen-anlage", resources: ["aws_instance.hafen"], available: true }],
  tfBackend: { type: "s3", name: "flotten-lager", locking: true },
  tfOutputs: [{ name: "hafen_ip", value: "10.0.0.5", sensitive: false }],
  tfLocked: true, tfLockHolder: "crew-nord",

  gitInitialized: true, gitBranch: "feature/kartenwerk", gitBranches: ["main", "feature/kartenwerk"],
  gitStaged: ["README.md"], gitCommitted: ["index.ts"],
  gitCommits: [{ hash: "abc123", msg: "init", branch: "main", files: ["index.ts"] }],
  gitPushed: true, gitRemoteAhead: 2, gitFetched: true,
  // gitConflict -> this.git.pendingConflict, gitActiveConflict -> this.git.conflict (Namen
  // kreuzen sich zwischen Scenario und ClusterState, siehe _resetGit/snapshot() in sim.ts).
  gitConflict: { branch: "feature/kartenwerk", file: "karte.yaml", ours: "unsere-version", theirs: "deren-version" },
  gitActiveConflict: { file: "log.txt", ours: "A", theirs: "B", from: "feature/alt" },

  ciPipelines: [{ id: 1, ref: "main", status: "success", stages: [{ name: "build", status: "success" }, { name: "deploy", status: "success" }], created: 0 }],
  ciDeploy: { name: "kasse", image: "nginx", replicas: 2 },
};

test("snapshot()/reset()-Roundtrip ist idempotent für ALLE ClusterState-Felder (#865)", () => {
  const sim = new KQSim(bigScenario);
  // Über JSON, wie bei der echten Persistenz (store.ts) – deckt auch nicht-JSON-taugliche
  // Werte auf (undefined-Felder, Set/Map …), die ein direkter Objekt-Vergleich übersähe.
  const snapshot = JSON.parse(JSON.stringify(sim.snapshot())) as Scenario;
  const restored = new KQSim(snapshot);

  for (const field of CLUSTER_STATE_FIELDS) {
    expect(restored[field], `Feld "${field}" überlebt den snapshot()/reset()-Roundtrip nicht verlustfrei`).toEqual(sim[field]);
  }
});

test("jedes Sim-Feld ist entweder ClusterState (oben geprüft) oder als transient dokumentiert", () => {
  const sim = new KQSim(bigScenario);
  const known = new Set<string>([...CLUSTER_STATE_FIELDS, ...TRANSIENT_SIM_FIELDS]);
  const unclassified = Object.keys(sim).filter(k => !known.has(k));
  expect(
    unclassified,
    "neues Sim-Feld gefunden, das weder in CLUSTER_STATE_FIELDS noch in TRANSIENT_SIM_FIELDS " +
    "einsortiert ist – snapshot()/reset() darauf prüfen und hier einordnen",
  ).toEqual([]);
});

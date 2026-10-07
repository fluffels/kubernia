/* Unit-Tests für die Observability-Grundlage im Simulator (#109):
 * kubectl top pods/nodes, kubectl logs -f/--previous, Metrik-/Alert-State,
 * Prometheus-Scrape-Targets. Reine Mechanik – deterministisch geprüft.
 */
import { test, beforeEach } from "vitest";
import assert from "node:assert/strict";
import { Sim as KQSim } from "../src/sim";

let sim: KQSim;
beforeEach(() => { sim = new KQSim({}); });

/* ===================== kubectl top pods ===================== */

test("kubectl top pods: zeigt CPU/Memory mit Einheiten für laufende Pods", () => {
  sim = new KQSim({ deployments: [{ name: "kasse", image: "nginx", replicas: 2 }] });
  const r = sim.exec("kubectl top pods");
  assert.ok(!r.error, "top pods auf gesunde Pods darf kein Fehler sein");
  assert.match(r.output!, /CPU\(cores\)/);
  assert.match(r.output!, /MEMORY\(bytes\)/);
  assert.match(r.output!, /kasse-/, "die Pod-Namen tauchen auf");
  assert.match(r.output!, /\d+m/, "CPU in Millicores (m)");
  assert.match(r.output!, /\d+Mi/, "Memory in Mi");
});

test("kubectl top pods: Abkürzung 'po' und ohne Pods", () => {
  // ohne Pods: klare Meldung, kein Fehler
  assert.match(sim.exec("kubectl top pods").output!, /No resources found/);
  // 'po' funktioniert wie 'pods'
  sim = new KQSim({ deployments: [{ name: "web", image: "nginx", replicas: 1 }] });
  assert.match(sim.exec("kubectl top po").output!, /web-/);
});

test("kubectl top pods: nicht laufende Pods (ImagePull/Pending) liefern keine Metriken", () => {
  sim = new KQSim({ deployments: [{ name: "tot", image: "nginx", replicas: 1, broken: { type: "imagepull", badImage: "ngnix" } }] });
  // im Listing fehlt der nicht laufende Pod -> keine Metriken
  const list = sim.exec("kubectl top pods");
  assert.match(list.output!, /No resources found/, "kein laufender Pod -> keine Metriken");
  // gezieltes top auf den Pod: klarer Fehler 'Metrics not available'
  const pod = sim.deployments[0].pods[0].name;
  const one = sim.exec("kubectl top pod " + pod);
  assert.ok(one.error, "Metriken für nicht laufenden Pod -> Fehler");
  assert.match(one.output!, /Metrics not available/i);
});

test("kubectl top pod <name>: unbekannter Pod -> NotFound (Deployment und StatefulSet im Cluster)", () => {
  sim = new KQSim({
    deployments: [{ name: "web", image: "nginx", replicas: 1 }],
    statefulSets: [{ name: "speicher", image: "postgres:16", replicas: 1, serviceName: "speicher" }],
  });
  const r = sim.exec("kubectl top pod gibtsnicht-123");
  assert.ok(r.error);
  assert.match(r.output!, /NotFound/);
  // ein bekannter, laufender Pod ist dagegen kein NotFound
  assert.doesNotMatch(sim.exec("kubectl top pod speicher-0").output!, /NotFound/);
});

/* ===================== kubectl top nodes ===================== */

test("kubectl top nodes: alle Nodes mit CPU%/MEMORY% in 0..100", () => {
  const r = sim.exec("kubectl top nodes");
  assert.ok(!r.error);
  assert.match(r.output!, /CPU%/);
  assert.match(r.output!, /MEMORY%/);
  assert.match(r.output!, /ahoi-control/);
  // jede Prozentzahl muss eine sinnvolle Auslastung sein
  for (const n of sim.nodeMetrics()) {
    assert.ok(n.cpuPct >= 0 && n.cpuPct <= 100, "CPU% in [0,100], war " + n.cpuPct);
    assert.ok(n.memPct >= 0 && n.memPct <= 100, "MEMORY% in [0,100], war " + n.memPct);
    assert.ok(n.cpuMilli > 0 && n.memMi > 0, "Node verbraucht etwas");
  }
});

test("kubectl top node <name>: filtert; unbekannter Node -> NotFound", () => {
  assert.match(sim.exec("kubectl top node ahoi-control").output!, /ahoi-control/);
  assert.doesNotMatch(sim.exec("kubectl top node ahoi-control").output!, /ahoi-worker/);
  const r = sim.exec("kubectl top node ahoi-mars");
  assert.ok(r.error);
  assert.match(r.output!, /NotFound/);
});

/* ===================== kubectl logs -f / --previous ===================== */

test("kubectl logs -f: folgt (Hinweis) und löst den Pod-Namen unabhängig von der Flag-Position", () => {
  sim = new KQSim({ deployments: [{ name: "web", image: "nginx", replicas: 1 }] });
  const pod = sim.deployments[0].pods[0].name;
  const r = sim.exec("kubectl logs -f " + pod); // Flag VOR dem Namen
  assert.ok(!r.error, "logs -f auf gesunden Pod ist kein Fehler");
  assert.match(r.output!, /GET \//, "echte Log-Zeilen kommen weiter");
  assert.match(r.output!, /--follow/, "ein Hinweis erklärt den fehlenden Live-Stream");
});

test("kubectl logs --previous: gesunder Pod hat keinen Vorgänger-Container", () => {
  sim = new KQSim({ deployments: [{ name: "web", image: "nginx", replicas: 1 }] });
  const pod = sim.deployments[0].pods[0].name;
  const r = sim.exec("kubectl logs --previous " + pod);
  assert.ok(r.error, "kein Neustart -> kein vorheriger Container");
  assert.match(r.output!, /previous terminated container/i);
});

test("kubectl logs --previous: CrashLoop zeigt den Absturz des Vorgängers", () => {
  sim = new KQSim({ deployments: [{ name: "app", image: "nginx", replicas: 1, broken: { type: "crashloop", needsSecret: "key" } }] });
  const pod = sim.deployments[0].pods[0].name;
  const r = sim.exec("kubectl logs -p " + pod);
  assert.ok(!r.error);
  assert.match(r.output!, /Secret 'key' nicht gefunden/);
});

test("kubectl logs --previous: nicht gestarteter Container (ImagePull) -> kein Log", () => {
  sim = new KQSim({ deployments: [{ name: "tot", image: "nginx", replicas: 1, broken: { type: "imagepull", badImage: "ngnix" } }] });
  const pod = sim.deployments[0].pods[0].name;
  const r = sim.exec("kubectl logs --previous " + pod);
  assert.ok(r.error, "nie gestartet -> auch kein vorheriger Container");
});

test("Regression: kubectl logs (OOMKilled) verrät den OOM-Kill weiterhin NICHT", () => {
  sim = new KQSim({ deployments: [{ name: "k", image: "nginx", replicas: 1, broken: { type: "oomkilled", memNeeded: 256 } }] });
  const pod = sim.deployments[0].pods[0].name;
  assert.doesNotMatch(sim.exec("kubectl logs " + pod).output!, /OOM/i);
});

/* ===================== Metrik-State ===================== */

test("podMetrics(): gesunde Pods bleiben unter der HighCPU-Schwelle, oomkilled klettert ans Limit", () => {
  sim = new KQSim({ deployments: [
    { name: "web", image: "nginx", replicas: 1 },
    { name: "speicherfresser", image: "nginx", replicas: 1, broken: { type: "oomkilled", memNeeded: 300 } },
  ] });
  const m = sim.podMetrics();
  const web = m.find(x => x.name.startsWith("web-"))!;
  const oom = m.find(x => x.name.startsWith("speicherfresser-"))!;
  assert.ok(web.cpuMilli > 0 && web.cpuMilli <= 500, "gesunde CPU-Grundlast unter der Schwelle");
  assert.ok(web.memMi > 0);
  assert.equal(oom.memMi, 300, "OOMKilled-Pod verbraucht so viel, wie er wirklich braucht");
});

test("podMetrics(): cpuHeavy-Deployment liegt über der HighCPU-Schwelle, nicht laufende Pods fehlen", () => {
  sim = new KQSim({ deployments: [
    { name: "rechenknecht", image: "python", replicas: 1, cpuHeavy: true },
    { name: "pending", image: "nginx", replicas: 1, broken: { type: "pending" } },
  ] });
  const m = sim.podMetrics();
  const hot = m.find(x => x.name.startsWith("rechenknecht-"))!;
  assert.ok(hot.cpuMilli > 500, "cpuHeavy erzeugt verlässlich hohe CPU, war " + hot.cpuMilli);
  assert.ok(!m.some(x => x.name.startsWith("pending-")), "Pending-Pod liefert keine Metriken");
});

/* ===================== Alert-State ===================== */

test("alerts(): gesunder Cluster feuert nichts", () => {
  sim = new KQSim({ deployments: [{ name: "web", image: "nginx", replicas: 1 }] });
  assert.equal(sim.alerts().length, 0, "alles gesund -> keine Alerts");
});

test("alerts(): CrashLoop, OOMKilled, HighCPU und NotReady-Node feuern", () => {
  sim = new KQSim({
    deployments: [
      { name: "crash", image: "nginx", replicas: 1, broken: { type: "crashloop", needsSecret: "key" } },
      { name: "oom", image: "nginx", replicas: 1, broken: { type: "oomkilled", memNeeded: 256 } },
      { name: "hot", image: "python", replicas: 1, cpuHeavy: true },
    ],
    nodes: [
      { name: "ahoi-control", status: "Ready", roles: "control-plane", version: "v1.30.2" },
      { name: "ahoi-worker-1", status: "NotReady", roles: "<none>", version: "v1.30.2" },
    ],
  });
  const firing = sim.alerts().filter(a => a.state === "firing").map(a => a.name);
  assert.ok(firing.includes("KubePodCrashLooping"), "CrashLoop feuert");
  assert.ok(firing.includes("KubePodOOMKilled"), "OOMKilled feuert");
  assert.ok(firing.includes("HighPodCPU"), "hohe CPU feuert");
  assert.ok(firing.includes("KubeNodeNotReady"), "NotReady-Node feuert");
});

test("alerts(): ein gefeuerter Alert wechselt nach Behebung auf 'resolved'", () => {
  sim = new KQSim({ deployments: [{ name: "kasse", image: "nginx", replicas: 1, broken: { type: "crashloop", needsSecret: "db-pass" } }] });
  // anfangs feuernd
  assert.ok(sim.alerts().some(a => a.name === "KubePodCrashLooping" && a.state === "firing"));
  // Heilung: Secret anlegen + rollout restart
  sim.exec("kubectl create secret generic db-pass --from-literal=p=geheim");
  sim.exec("kubectl rollout restart deployment kasse");
  const a = sim.alerts().find(x => x.name === "KubePodCrashLooping");
  assert.ok(a, "der Alert bleibt sichtbar");
  assert.equal(a!.state, "resolved", "Bedingung weg -> resolved (nicht mehr firing)");
});

test("alerts(): nie gefeuert -> taucht nicht als 'resolved' auf", () => {
  sim = new KQSim({ deployments: [{ name: "web", image: "nginx", replicas: 1 }] });
  sim.alerts(); // einmal auswerten, Cluster gesund
  assert.ok(!sim.alerts().some(a => a.name === "KubePodCrashLooping"), "ohne je zu feuern kein resolved");
});

/* ===================== Prometheus-Scrape-Targets ===================== */

test("scrapeTargets(): Node-Targets up bei Ready, down bei NotReady", () => {
  sim = new KQSim({ nodes: [
    { name: "ahoi-control", status: "Ready", roles: "control-plane", version: "v1.30.2" },
    { name: "ahoi-worker-1", status: "NotReady", roles: "<none>", version: "v1.30.2" },
  ] });
  const tg = sim.scrapeTargets();
  const ctrl = tg.find(t => t.instance.startsWith("ahoi-control"))!;
  const worker = tg.find(t => t.instance.startsWith("ahoi-worker-1"))!;
  assert.equal(ctrl.health, "up");
  assert.equal(worker.health, "down", "NotReady-Node scrapet down");
});

test("scrapeTargets(): App-Target up bei bereiten Pods, down bei CrashLoop", () => {
  sim = new KQSim({
    deployments: [
      { name: "kasse", image: "nginx", replicas: 1 },
      { name: "lager", image: "nginx", replicas: 1, broken: { type: "crashloop", needsSecret: "key" } },
    ],
    services: [
      { name: "kasse", type: "ClusterIP", clusterIP: "10.96.0.20", port: 80 },
      { name: "lager", type: "ClusterIP", clusterIP: "10.96.0.21", port: 80 },
    ],
  });
  const tg = sim.scrapeTargets();
  const kasse = tg.find(t => t.job === "kasse")!;
  const lager = tg.find(t => t.job === "lager")!;
  assert.equal(kasse.health, "up", "gesunder Service scrapet up");
  assert.equal(lager.health, "down", "CrashLoop hinter dem Service -> down");
});

/* ===================== StatefulSet-Pods in top/podMetrics (#1339) ===================== */

const STS = (extra: object = {}) => ({ name: "speicher", image: "postgres:16", replicas: 3, serviceName: "speicher", ...extra });
const firstCol = (out: string) => out.split("\n").slice(1).map(l => l.split(/\s+/)[0]).filter(Boolean).sort();

test("kubectl top pods: listet StatefulSet-Pods, Namen gleich wie in get pods", () => {
  sim = new KQSim({ deployments: [{ name: "kasse", image: "nginx", replicas: 2 }], statefulSets: [STS()] });
  const top = sim.exec("kubectl top pods").output!;
  for (const i of [0, 1, 2]) assert.match(top, new RegExp("speicher-" + i));
  assert.match(top, /kasse-/);
  assert.deepEqual(firstCol(top), firstCol(sim.exec("kubectl get pods").output!));
});

test("kubectl top: StatefulSet mit Pending-PVC erscheint nicht, gezielt 'Metrics not available' statt NotFound", () => {
  sim = new KQSim({ statefulSets: [STS({ storageClass: "" })] });
  assert.match(sim.exec("kubectl top pods").output!, /No resources found/);
  const r = sim.exec("kubectl top pod speicher-0");
  assert.ok(r.error, "Pod ohne Metriken ist ein Fehler");
  assert.match(r.output!, /Metrics not available/);
  assert.doesNotMatch(r.output!, /NotFound/);
});

test("podMetrics: StatefulSet-Pods deterministisch und unter der HighPodCPU-Schwelle", () => {
  sim = new KQSim({ statefulSets: [STS()] });
  const a = sim.podMetrics();
  assert.equal(a.length, 3);
  assert.deepEqual(sim.podMetrics(), a);
  assert.ok(a.every(m => m.cpuMilli < 500));
  assert.ok(!sim.alerts().some(x => x.name === "HighPodCPU" && x.state === "firing"));
});

test("HighPodCPU: feuert nur durch das cpuHeavy-Deployment, nie durch StatefulSet-Pods (Gegenprobe)", () => {
  const firing = (s: KQSim) => s.alerts().some(x => x.name === "HighPodCPU" && x.state === "firing");
  assert.equal(firing(new KQSim({ statefulSets: [STS()] })), false, "nur StatefulSet: still");
  sim = new KQSim({ deployments: [{ name: "hot", image: "python", replicas: 1, cpuHeavy: true }], statefulSets: [STS()] });
  assert.equal(firing(sim), true, "cpuHeavy-Deployment daneben feuert");
  const sts = sim.podMetrics().filter(m => m.name.startsWith("speicher-"));
  assert.equal(sts.length, 3);
  assert.ok(sts.every(m => m.cpuMilli < 500), "die StatefulSet-Pods selbst bleiben unter der Schwelle");
});

/* ===================== Evicted-Pods: keine Metriken (#1404) ===================== */

const EVICTED = { name: "wildwuchs", image: "nginx", replicas: 1, ephemeralLimit: 512, emptyDir: { data: "riesig", usedMi: 600 } };

test("Evicted-Pod liefert keine Metriken; gezieltes top meldet 'Metrics not available' statt NotFound", () => {
  sim = new KQSim({ deployments: [EVICTED, { name: "kasse", image: "nginx", replicas: 1 }] });
  assert.match(sim.exec("kubectl get pods").output!, /wildwuchs[\w-]*\s+0\/1\s+Evicted/, "Setup: wirklich evictet");
  const evicted = sim.deployments[0].pods[0].name;
  const gesund = sim.deployments[1].pods[0].name;
  assert.deepEqual(sim.podMetrics().map(m => m.name), [gesund], "nur der gesunde Nachbar hat Metriken");
  const r = sim.exec("kubectl top pod " + evicted);
  assert.ok(r.error);
  assert.match(r.output!, /Metrics not available/);
  assert.doesNotMatch(r.output!, /NotFound/);
  assert.match(sim.exec("kubectl top pods").output!, new RegExp(gesund));
});

test("Evicted + cpuHeavy: der evictete Pod lässt HighPodCPU nicht feuern", () => {
  sim = new KQSim({ deployments: [{ ...EVICTED, cpuHeavy: true }] });
  assert.match(sim.exec("kubectl get pods").output!, /Evicted/);
  assert.equal(sim.podMetrics().length, 0);
  assert.ok(!sim.alerts().some(x => x.name === "HighPodCPU" && x.state === "firing"));
});

test("nodeMetrics: StatefulSet-Pods tragen zur Node-Last bei", () => {
  const sum = (s: KQSim) => s.nodeMetrics().reduce((n, x) => n + x.cpuMilli, 0);
  const ohne = sum(new KQSim({}));
  const mit = sum(new KQSim({ statefulSets: [STS()] }));
  assert.ok(mit > ohne);
});

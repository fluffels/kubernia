/* Unit-Tests für die Ephemeral-Storage-Grundlage im Simulator (#240):
 * emptyDir als flüchtiges Pod-Volume (weg bei Pod-Neustart), ephemeral-storage-Limits am
 * Container und die DiskPressure-Eviction (eigenes Limit gesprengt ODER Node-Disk voll).
 * Reine Mechanik – deterministisch geprüft, inkl. Negativ-/False-Positive-Fällen (Red-Green).
 * Gegenstück zu test/stateful.test.ts (#122), das den DAUERHAFTEN Speicher (PVC) abdeckt.
 */
import { test, beforeEach } from "vitest";
import assert from "node:assert/strict";
import { Sim as KQSim } from "../src/sim";

let sim: KQSim;
beforeEach(() => { sim = new KQSim({}); });

/* Ein Worker-Node mit kleiner Disk-Kapazität – für die Node-Disk-Druck-Fälle. */
function nodesWithSmallDisk(capacityMi: number, baseMi: number) {
  return [
    { name: "ahoi-control", status: "Ready", roles: "control-plane", version: "v1.30.2" },
    { name: "ahoi-worker-1", status: "Ready", roles: "<none>", version: "v1.30.2", ephemeralCapacityMi: capacityMi, ephemeralBaseMi: baseMi },
  ];
}

/* ===================== emptyDir: flüchtig (weg bei Pod-Neustart) ===================== */

test("emptyDir lebt am Pod: describe pod zeigt Volume + Inhalt, delete pod löscht den Inhalt", () => {
  sim = new KQSim({ deployments: [{ name: "kasse", image: "nginx", replicas: 1, emptyDir: { data: "warenkorb-cache", usedMi: 40 } }] });
  const podName = sim.deployments[0].pods[0].name;

  const desc = sim.exec("kubectl describe pod " + podName).output!;
  assert.match(desc, /EmptyDir/, "describe pod nennt das emptyDir-Volume");
  assert.match(desc, /warenkorb-cache/, "der aktuelle Inhalt steht da");
  assert.match(desc, /40Mi/, "der belegte Platz steht da");

  // Pod löschen → Self-Healing-Pod kommt zurück, aber das Scratch-Volume ist LEER.
  const del = sim.exec("kubectl delete pod " + podName);
  assert.ok(!del.error);
  assert.equal(sim.deployments[0].emptyDir!.data, "", "emptyDir-Inhalt ist nach Pod-Neustart weg");
  assert.equal(sim.deployments[0].emptyDir!.usedMi, 0, "und der Platz ist freigegeben");

  // Der neue Pod zeigt ein leeres emptyDir.
  const newPod = sim.deployments[0].pods[0].name;
  assert.notEqual(newPod, podName, "es ist wirklich ein neuer Pod");
  assert.match(sim.exec("kubectl describe pod " + newPod).output!, /\(leer\)/, "leeres Scratch-Volume");
});

test("rollout restart gibt das emptyDir ebenfalls frei (False-Positive-Schutz: VORHER ist es noch da)", () => {
  sim = new KQSim({ deployments: [{ name: "kasse", image: "nginx", replicas: 1, emptyDir: { data: "session", usedMi: 12 } }] });
  // Vorher: Inhalt da (sonst würde der Test auch bei kaputter Logik grün bleiben).
  assert.equal(sim.deployments[0].emptyDir!.data, "session");
  sim.exec("kubectl rollout restart deployment kasse");
  assert.equal(sim.deployments[0].emptyDir!.data, "", "rollout restart leert das emptyDir");
});

/* ===================== ephemeral-storage-Limit am Container ===================== */

test("kubectl set resources --limits=ephemeral-storage setzt das Limit (Gi → Mi)", () => {
  sim = new KQSim({ deployments: [{ name: "logs", image: "nginx", replicas: 1 }] });
  const r = sim.exec("kubectl set resources deployment/logs --limits=ephemeral-storage=1Gi");
  assert.ok(!r.error, "Befehl darf nicht fehlschlagen");
  assert.match(r.output!, /resource requirements updated/);
  assert.equal(sim.deployments[0].ephemeralLimit, 1024, "1Gi == 1024Mi");
});

/* ===================== Eviction-Auslöser 1: eigenes Limit gesprengt ===================== */

test("Pod über seinem ephemeral-storage-Limit → Evicted, mit sichtbarem Grund", () => {
  sim = new KQSim({ deployments: [{ name: "schreiber", image: "nginx", replicas: 1, ephemeralLimit: 512, emptyDir: { data: "tonnen-an-logs", usedMi: 600 } }] });
  const pods = sim.exec("kubectl get pods").output!;
  assert.match(pods, /schreiber[\w-]+\s+0\/1\s+Evicted/, "get pods zeigt Evicted, READY 0/1");

  const podName = sim.deployments[0].pods[0].name;
  const desc = sim.exec("kubectl describe pod " + podName).output!;
  assert.match(desc, /Reason:\s+Evicted/, "describe pod nennt Reason: Evicted");
  assert.match(desc, /exceeds the total limit/, "der Grund ist das gesprengte Limit");
});

test("Limit anheben heilt den evicteten Pod (kein Evicted mehr)", () => {
  sim = new KQSim({ deployments: [{ name: "schreiber", image: "nginx", replicas: 1, ephemeralLimit: 512, emptyDir: { data: "x", usedMi: 600 } }] });
  assert.match(sim.exec("kubectl get pods").output!, /Evicted/, "erst evicted");

  const r = sim.exec("kubectl set resources deployment/schreiber --limits=ephemeral-storage=1Gi");
  assert.match(r.output!, /Genug ephemeral-storage/, "Heilungs-Hinweis erscheint");
  const pods = sim.exec("kubectl get pods").output!;
  assert.doesNotMatch(pods, /Evicted/, "nach genug Limit nicht mehr evicted");
  assert.match(pods, /Running/, "der Pod läuft wieder");
});

test("Negativ: Pod UNTER seinem Limit wird NICHT evicted", () => {
  sim = new KQSim({ deployments: [{ name: "brav", image: "nginx", replicas: 1, ephemeralLimit: 512, emptyDir: { data: "wenig", usedMi: 100 } }] });
  const pods = sim.exec("kubectl get pods").output!;
  assert.doesNotMatch(pods, /Evicted/, "100Mi < 512Mi → kein Evicted (False-Positive-Schutz)");
  assert.match(pods, /Running/);
});

/* ===================== Eviction-Auslöser 2: Node-Disk voll (DiskPressure) ===================== */

test("volle Node-Disk → DiskPressure am Node + Eviction des Verbrauchers", () => {
  sim = new KQSim({
    nodes: nodesWithSmallDisk(1024, 900),
    deployments: [{ name: "hungrig", image: "nginx", replicas: 1, node: "ahoi-worker-1", emptyDir: { data: "riesig", usedMi: 300 } }],
  });
  // 900 (Baseline) + 300 (emptyDir) = 1200 >= 1024 → Druck.
  const nodes = sim.exec("kubectl get nodes").output!;
  assert.match(nodes, /ahoi-worker-1\s+Ready,DiskPressure/, "get nodes zeigt DiskPressure");

  const dn = sim.exec("kubectl describe node ahoi-worker-1").output!;
  assert.match(dn, /DiskPressure\s+True/, "describe node: DiskPressure True");
  assert.match(dn, /ephemeral-storage:\s+1024Mi/, "Kapazität sichtbar");

  assert.match(sim.exec("kubectl get pods").output!, /Evicted/, "der Verbraucher wird evictet");
});

test("Node-Druck endet, wenn der Verursacher neugestartet wird (emptyDir frei → wieder Platz)", () => {
  sim = new KQSim({
    nodes: nodesWithSmallDisk(1024, 900),
    deployments: [{ name: "hungrig", image: "nginx", replicas: 1, node: "ahoi-worker-1", emptyDir: { data: "riesig", usedMi: 300 } }],
  });
  assert.match(sim.exec("kubectl get nodes").output!, /DiskPressure/, "erst Druck");

  sim.exec("kubectl rollout restart deployment hungrig"); // gibt das emptyDir frei
  assert.doesNotMatch(sim.exec("kubectl get nodes").output!, /DiskPressure/, "Druck ist weg");
  assert.doesNotMatch(sim.exec("kubectl get pods").output!, /Evicted/, "Pod läuft wieder");
});

test("Negativ: Default-Cluster (Nodes ohne Kapazität) bekommt NIE DiskPressure", () => {
  // Riesiges emptyDir, aber die Default-Nodes haben keine Kapazitätsgrenze → unbegrenzt.
  sim = new KQSim({ deployments: [{ name: "app", image: "nginx", replicas: 1, emptyDir: { data: "egal", usedMi: 999999 } }] });
  assert.doesNotMatch(sim.exec("kubectl get nodes").output!, /DiskPressure/, "kein Druck ohne Kapazität (Backward-Compat)");
  assert.doesNotMatch(sim.exec("kubectl get pods").output!, /Evicted/, "und kein Evicted ohne Limit");
});

/* ===================== mergeScenario: Node-Disk eines Quest-Szenarios setzen (#242) ===================== */

test("mergeScenario setzt/merged Node-Disk-Kapazität → Quest-Szenario kann DiskPressure aufsetzen", () => {
  sim = new KQSim({}); // Default-Cluster: Nodes ohne Kapazität → unbegrenzt, nie Druck.
  assert.doesNotMatch(sim.exec("kubectl get nodes").output!, /DiskPressure/, "vorher kein Druck (False-Positive-Schutz)");

  // Ein Quest-Szenario schrumpft die Disk eines vorhandenen Workers UND pinnt einen
  // gefräßigen Pod dorthin – genau das Setup, das eine Quest braucht.
  sim.mergeScenario({
    nodes: [{ name: "ahoi-worker-1", status: "Ready", roles: "<none>", version: "v1.30.2", ephemeralCapacityMi: 1024, ephemeralBaseMi: 700 }],
    deployments: [{ name: "wildwuchs", image: "nginx", replicas: 1, node: "ahoi-worker-1", emptyDir: { data: "logflut", usedMi: 400 } }],
  });

  // 700 (Baseline) + 400 (emptyDir) = 1100 >= 1024 → Druck am gemergten Node.
  assert.match(sim.exec("kubectl get nodes").output!, /ahoi-worker-1\s+Ready,DiskPressure/, "der gemergte Node steht unter DiskPressure");
  assert.match(sim.exec("kubectl get pods").output!, /wildwuchs[\w-]*\s+0\/1\s+Evicted/, "der Verbraucher wird evictet");
});

test("mergeScenario nimmt einen ganz neuen Node auf (per Name nicht vorhanden)", () => {
  sim = new KQSim({});
  const before = sim.nodes.length;
  sim.mergeScenario({ nodes: [{ name: "kai-lager-1", status: "Ready", roles: "<none>", version: "v1.30.2" }] });
  assert.equal(sim.nodes.length, before + 1, "neuer Node ist dazugekommen");
  assert.match(sim.exec("kubectl get nodes").output!, /kai-lager-1/, "und taucht in get nodes auf");
});

/* ===================== apply -f: Pod-Template mit emptyDir + Limit ===================== */

test("kubectl apply -f mit emptyDir + ephemeral-storage-Limit (apply-Handler mitgetestet)", () => {
  sim.mergeScenario({
    files: { "kasse.yaml": "kind: Deployment\n" },
    applyEffects: { "kasse.yaml": { deployment: { name: "kasse", image: "nginx", replicas: 1, emptyDir: { data: "cache", usedMi: 700 }, ephemeralLimit: 512 } } },
  });
  const r = sim.exec("kubectl apply -f kasse.yaml");
  assert.match(r.output!, /deployment\.apps\/kasse created/);
  // 700Mi > 512Mi Limit → der Pod wird evictet.
  assert.match(sim.exec("kubectl get pods").output!, /Evicted/);
});

/* ===================== Persistenz: Reload reproduziert die Eviction ===================== */

test("snapshot/reload: emptyDir, Limit und Node-Pin überleben – Eviction wird neu abgeleitet", () => {
  sim = new KQSim({ deployments: [{ name: "x", image: "nginx", replicas: 1, ephemeralLimit: 512, emptyDir: { data: "d", usedMi: 600 } }] });
  const snap = sim.snapshot();
  const sim2 = new KQSim(snap);
  assert.equal(sim2.deployments[0].ephemeralLimit, 512, "Limit übernommen");
  assert.equal(sim2.deployments[0].emptyDir!.usedMi, 600, "emptyDir-Nutzung übernommen");
  assert.match(sim2.exec("kubectl get pods").output!, /Evicted/, "Eviction reproduziert sich nach Reload");
});

/* ===================== describe node: Negativfälle ===================== */

test("describe node: unbekannter Node meldet NotFound, gesunder Node zeigt DiskPressure False", () => {
  const bad = sim.exec("kubectl describe node gibtsnicht");
  assert.ok(bad.error);
  assert.match(bad.output!, /NotFound/);

  const ok = sim.exec("kubectl describe node ahoi-worker-1").output!;
  assert.match(ok, /DiskPressure\s+False/, "ein Default-Node steht nicht unter Druck");
});

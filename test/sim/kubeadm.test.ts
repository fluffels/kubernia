/* Unit-Tests: kubeadm-Befehlsfamilie (sim/kubeadm.ts) – Sim-Fundament des Aufbau-Bogens (#460).
 * Deckt den Happy-Path (bare metal → init → join → join) UND alle vom Ticket geforderten
 * Negativfälle ab (join vor init, doppeltes init, kubectl vor init, falscher/fehlender Token)
 * plus den snapshot/reset-Round-trip eines halb aufgebauten Clusters.
 * Fahren über sim.exec("…"); gemeinsame Fixtures in ./helpers. */
import { test, beforeEach } from "vitest";
import assert from "node:assert/strict";
import { KQSim, freshSim } from "./helpers";

let sim: KQSim;
beforeEach(() => { sim = freshSim(); });

/* ===== Default: der klassische, schon laufende Cluster bleibt unberührt ===== */

test("Default-Cluster: Control-Plane ist up, kubectl funktioniert, 3 Nodes", () => {
  assert.equal(sim.controlPlane.up, true, "ein normaler Cluster ist ansprechbar");
  assert.equal(sim.nodes.length, 3);
  assert.doesNotMatch(sim.exec("kubectl get nodes").output!, /connection.*refused/i);
  assert.match(sim.exec("kubectl get nodes").output!, /ahoi-control/);
});

/* ===== bare metal: leerer/zerstörter Cluster ===== */

test("bare metal: keine Nodes, Control-Plane down, kubectl scheitert mit connection refused", () => {
  const bare = new KQSim({ bareMetal: true });
  assert.equal(bare.nodes.length, 0, "bare metal startet ohne Nodes");
  assert.equal(bare.controlPlane.up, false);
  const r = bare.exec("kubectl get nodes");
  assert.equal(r.error, true, "kubectl ist vor init ein Fehler");
  assert.match(r.output!, /connection to the server.*was refused/i);
  // Negativ-Gegenprobe (Red-Green): im Default-Cluster darf genau das NICHT passieren.
  assert.doesNotMatch(sim.exec("kubectl get nodes").output!, /was refused/i);
});

test("bare metal: auch andere kubectl-Unterbefehle sind vor init blockiert", () => {
  const bare = new KQSim({ bareMetal: true });
  for (const cmd of ["kubectl get pods", "kubectl get deployments", "kubectl create deployment x --image=nginx"]) {
    assert.match(bare.exec(cmd).output!, /was refused/i, cmd + " sollte vor init scheitern");
  }
});

/* ===== Happy-Path: init → join → join ===== */

test("kubeadm init: zieht die Control-Plane hoch, Cluster wird ansprechbar", () => {
  const bare = new KQSim({ bareMetal: true });
  const r = bare.exec("kubeadm init");
  assert.equal(r.error, false);
  assert.match(r.output!, /control-plane has initialized successfully/i);
  assert.equal(bare.controlPlane.up, true);
  assert.ok(bare.controlPlane.token, "init erzeugt einen Join-Token");
  // Control-Plane-Knoten ist da und kubectl funktioniert wieder.
  assert.equal(bare.nodes.length, 1);
  assert.match(bare.nodes[0].roles, /control-plane/);
  assert.match(bare.exec("kubectl get nodes").output!, /ahoi-control/);
});

test("kubeadm join: hängt Worker an, sie tauchen in get nodes auf", () => {
  const bare = new KQSim({ bareMetal: true });
  bare.exec("kubeadm init");
  const token = bare.controlPlane.token!;
  // Beide Schreibweisen: --token und positional.
  assert.match(bare.exec("kubeadm join " + APISERVERTOKEN(token, true)).output!, /joined the cluster/i);
  assert.match(bare.exec("kubeadm join " + token).output!, /joined the cluster/i);
  assert.equal(bare.nodes.length, 3, "1 Control-Plane + 2 Worker");
  const nodes = bare.exec("kubectl get nodes").output!;
  assert.match(nodes, /ahoi-worker-1/);
  assert.match(nodes, /ahoi-worker-2/);
});

/* ===== Negativfälle (vom Ticket gefordert) ===== */

test("Negativ: kubeadm join VOR init scheitert, fügt keinen Node hinzu", () => {
  const bare = new KQSim({ bareMetal: true });
  const r = bare.exec("kubeadm join abcdef.0123456789abcdef");
  assert.equal(r.error, true);
  assert.match(r.output!, /connection refused|couldn't validate/i);
  assert.equal(bare.nodes.length, 0, "ohne Control-Plane kommt kein Worker dazu");
});

test("Negativ: doppeltes kubeadm init wird abgelehnt, Cluster bleibt heil", () => {
  const bare = new KQSim({ bareMetal: true });
  bare.exec("kubeadm init");
  const token = bare.controlPlane.token;
  const r = bare.exec("kubeadm init");
  assert.equal(r.error, true);
  assert.match(r.output!, /already running|in use/i);
  assert.equal(bare.controlPlane.token, token, "der bestehende Token bleibt unangetastet");
  assert.equal(bare.nodes.length, 1, "kein doppelter Control-Plane-Knoten");
});

test("Negativ: kubeadm join mit falschem Token scheitert", () => {
  const bare = new KQSim({ bareMetal: true });
  bare.exec("kubeadm init");
  const r = bare.exec("kubeadm join wrong.token0000000000");
  assert.equal(r.error, true);
  assert.match(r.output!, /invalid bootstrap token/i);
  assert.equal(bare.nodes.length, 1, "ein falscher Token hängt keinen Worker an");
});

test("Negativ: kubeadm join ohne Token scheitert", () => {
  const bare = new KQSim({ bareMetal: true });
  bare.exec("kubeadm init");
  const r = bare.exec("kubeadm join");
  assert.equal(r.error, true);
  assert.match(r.output!, /token is required/i);
});

test("Negativ: unbekannter kubeadm-Unterbefehl", () => {
  assert.match(sim.exec("kubeadm frobnicate").output!, /unbekannter Unterbefehl/i);
});

/* ===== reset: zurück auf bare metal ===== */

test("kubeadm reset: räumt den Cluster ab, kubectl scheitert wieder", () => {
  const bare = new KQSim({ bareMetal: true });
  bare.exec("kubeadm init");
  bare.exec("kubeadm join " + bare.controlPlane.token);
  assert.equal(bare.nodes.length, 2);
  const r = bare.exec("kubeadm reset");
  assert.equal(r.error, false);
  assert.equal(bare.nodes.length, 0);
  assert.equal(bare.controlPlane.up, false);
  assert.match(bare.exec("kubectl get nodes").output!, /was refused/i);
});

/* ===== Integration: neuer Worker plant Pending-Pods ein ===== */

test("kubeadm join: ein neuer Worker kann wartende Pods einplanen", () => {
  // Cluster mit nur 1 Node + Pending-Pod (zu wenig Kapazität), dann zwei Worker dazu.
  const s = new KQSim({
    nodes: [{ name: "ahoi-control", status: "Ready", roles: "control-plane", version: "v1.30.2" }],
    controlPlane: { up: true, token: "tok123.aaaaaaaaaaaaaaaa", node: "ahoi-control" },
    deployments: [{ name: "app", image: "nginx", replicas: 1, broken: { type: "pending" } }],
  });
  assert.match(s.exec("kubectl get pods").output!, /Pending/);
  s.exec("kubeadm join tok123.aaaaaaaaaaaaaaaa");
  s.exec("kubeadm join tok123.aaaaaaaaaaaaaaaa");
  s.exec("kubeadm join tok123.aaaaaaaaaaaaaaaa"); // > 3 Nodes löst _reschedulePending
  assert.equal(s.deployments[0].broken, null, "mit genug Nodes wird der Pod eingeplant");
});

/* ===== snapshot/reset-Round-trip: halb aufgebauter Cluster überlebt den Reload ===== */

test("Round-trip: ein aufgebauter Cluster überlebt snapshot → neue Sim", () => {
  const bare = new KQSim({ bareMetal: true });
  bare.exec("kubeadm init");
  bare.exec("kubeadm join " + bare.controlPlane.token);
  const snap = bare.snapshot();
  const reloaded = new KQSim(snap);
  assert.equal(reloaded.controlPlane.up, true);
  assert.equal(reloaded.controlPlane.token, bare.controlPlane.token);
  assert.equal(reloaded.nodes.length, 2);
  assert.doesNotMatch(reloaded.exec("kubectl get nodes").output!, /was refused/i);
});

test("Round-trip: bare metal bleibt nach snapshot → neue Sim bare metal", () => {
  const bare = new KQSim({ bareMetal: true });
  const reloaded = new KQSim(bare.snapshot());
  assert.equal(reloaded.controlPlane.up, false);
  assert.equal(reloaded.nodes.length, 0);
  assert.match(reloaded.exec("kubectl get nodes").output!, /was refused/i);
});

/* ===== Sturm via mergeScenario: zerstört den laufenden Cluster zur Laufzeit (#461) ===== */

test("mergeScenario bareMetal: der Sturm räumt den laufenden Cluster auf bare metal ab", () => {
  // Laufender Cluster mit Workloads (wie spät im Spiel).
  sim.exec("kubectl create deployment kasse --image=nginx");
  sim.exec("kubectl expose deployment kasse --port=80");
  assert.ok(sim.nodes.length >= 1 && sim.deployments.length === 1 && sim.services.length === 1);
  // Der große Sturm (Quest-Szenario).
  sim.mergeScenario({ bareMetal: true });
  assert.equal(sim.nodes.length, 0, "keine Nodes mehr");
  assert.equal(sim.deployments.length, 0, "keine Workloads mehr");
  assert.equal(sim.services.length, 0, "keine Services mehr");
  assert.equal(sim.controlPlane.up, false, "Control-Plane down");
  assert.match(sim.exec("kubectl get nodes").output!, /was refused/i, "kubectl ist danach blockiert");
  // Negativ-Gegenprobe (Red-Green): ein frischer Sim OHNE Sturm bleibt erreichbar.
  assert.doesNotMatch(freshSim().exec("kubectl get nodes").output!, /was refused/i);
});

test("mergeScenario bareMetal: lokale Baupläne (files) überleben den Sturm", () => {
  sim.mergeScenario({ bareMetal: true, files: { "deployment.yaml": "kind: Deployment" } });
  // ls/cat funktionieren weiter – der Sturm nimmt den Cluster, nicht die Manifeste.
  assert.match(sim.exec("ls").output!, /deployment\.yaml/);
  assert.match(sim.exec("cat deployment.yaml").output!, /Deployment/);
});

test("Aufbau-Bogen spielbar: Sturm zerstört, danach init/join baut wieder auf", () => {
  // Spiegelt den Quest-Fluss #461 → #462/#463: Sturm (mergeScenario) dann Wiederaufbau.
  sim.exec("kubectl create deployment alt --image=nginx");
  sim.mergeScenario({ bareMetal: true });
  assert.equal(sim.controlPlane.up, false);
  sim.exec("kubeadm init");
  sim.exec("kubeadm join " + sim.controlPlane.token);
  assert.equal(sim.controlPlane.up, true);
  assert.equal(sim.nodes.length, 2, "Control-Plane + 1 Worker neu aufgebaut");
  assert.doesNotMatch(sim.exec("kubectl get nodes").output!, /was refused/i);
});

/** Hilfs-Schreibweise: realistischer `kubeadm join`-Aufruf mit --token (wie init ihn ausgibt). */
function APISERVERTOKEN(token: string, withFlag: boolean): string {
  return withFlag ? "10.0.0.10:6443 --token " + token + " --discovery-token-ca-cert-hash sha256:deadbeef" : token;
}

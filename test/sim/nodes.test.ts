/* Unit-Tests: Node-Aggregat-Mutationen (sim/nodes.ts, #534).
 * Zwei Ebenen:
 *  (a) die puren Helfer selbst – `provisionNode` (idempotent per Name, Cluster-Defaults,
 *      spec überschreibt), `removeNode` (spiegelt removeDeployment inkl. Negativkontrakt),
 *      `isControlPlane` (das EINE Rollen-Prädikat), `NODE_VERSION` als einzige Wahrheit;
 *  (b) dass die refaktorierten Aufrufer (kubeadm/terraform) wirklich über den Kanal gehen
 *      und dieselbe Version tragen.
 * Factory in ./helpers. */
import { test, beforeEach } from "vitest";
import assert from "node:assert/strict";
import { KQSim, freshSim } from "./helpers";
import { provisionNode, removeNode, isControlPlane, NODE_VERSION } from "../../src/sim/nodes";
import type { ClusterNode } from "../../src/sim/state";

let sim: KQSim;
beforeEach(() => { sim = freshSim(); });

/* ---------- (a) die puren Helfer ---------- */

test("provisionNode: neuer Worker bekommt die Cluster-Defaults + gibt den Knoten zurück", () => {
  const state = { nodes: [] as ClusterNode[] };
  const node = provisionNode(state, { name: "ahoi-worker-1" });
  assert.deepEqual(node, { name: "ahoi-worker-1", status: "Ready", roles: "<none>", version: NODE_VERSION });
  assert.equal(state.nodes.length, 1);
  assert.equal(state.nodes[0], node);
});

test("provisionNode: spec überschreibt die Defaults (Control-Plane-Rolle)", () => {
  const state = { nodes: [] as ClusterNode[] };
  const node = provisionNode(state, { name: "ahoi-control", roles: "control-plane" });
  assert.equal(node?.roles, "control-plane");
  assert.equal(node?.version, NODE_VERSION, "Version bleibt der Default");
});

test("provisionNode (idempotent): zweiter Aufruf gleichen Namens legt nichts an, gibt undefined", () => {
  const state = { nodes: [] as ClusterNode[] };
  provisionNode(state, { name: "ahoi-worker-1" });
  const second = provisionNode(state, { name: "ahoi-worker-1", roles: "control-plane" });
  assert.equal(second, undefined, "existierender Name → kein Duplikat");
  assert.equal(state.nodes.length, 1, "keine Dublette angelegt");
  assert.equal(state.nodes[0].roles, "<none>", "der vorhandene Knoten bleibt unverändert");
});

test("removeNode: entfernt per Name und gibt den Knoten zurück", () => {
  const state = { nodes: [] as ClusterNode[] };
  provisionNode(state, { name: "ahoi-worker-1" });
  provisionNode(state, { name: "ahoi-worker-2" });
  const removed = removeNode(state, "ahoi-worker-1");
  assert.equal(removed?.name, "ahoi-worker-1");
  assert.equal(state.nodes.length, 1);
  assert.equal(state.nodes.some(n => n.name === "ahoi-worker-1"), false);
});

test("removeNode (Negativfall): unbekannter Name ändert nichts, gibt undefined", () => {
  const state = { nodes: [] as ClusterNode[] };
  provisionNode(state, { name: "ahoi-worker-1" });
  const removed = removeNode(state, "gibt-es-nicht");
  assert.equal(removed, undefined);
  assert.equal(state.nodes.length, 1, "der vorhandene Knoten bleibt unangetastet");
});

test("isControlPlane: erkennt Control-Plane, verneint Worker, greift bei kombinierten Rollen", () => {
  assert.equal(isControlPlane({ name: "c", status: "Ready", roles: "control-plane", version: NODE_VERSION }), true);
  assert.equal(isControlPlane({ name: "w", status: "Ready", roles: "<none>", version: NODE_VERSION }), false);
  // Ein Knoten kann mehrere kommagetrennte Rollen tragen – `includes` fängt das (Gleichheit nicht).
  assert.equal(isControlPlane({ name: "cm", status: "Ready", roles: "control-plane,master", version: NODE_VERSION }), true);
});

/* ---------- (b) die Aufrufer gehen wirklich über den Kanal ---------- */

test("NODE_VERSION ist die eine Wahrheit: die Default-Nodes tragen sie", () => {
  const cp = sim.nodes.find(isControlPlane)!;
  assert.equal(cp.version, NODE_VERSION);
  assert.ok(sim.nodes.every(n => n.version === NODE_VERSION), "alle Default-Knoten auf derselben Version");
});

test("kubeadm init/join/reset provisionieren & räumen Knoten über den Kanal (mit NODE_VERSION)", () => {
  sim.mergeScenario({ bareMetal: true });
  assert.equal(sim.nodes.length, 0, "bare metal: kein Knoten");

  sim.exec("kubeadm init");
  const cp = sim.nodes.find(isControlPlane);
  assert.ok(cp, "init zieht eine Control-Plane hoch");
  assert.equal(cp!.version, NODE_VERSION);
  assert.equal(sim.controlPlane.up, true);

  const token = sim.controlPlane.token!;
  sim.exec("kubeadm join --token " + token);
  const workers = sim.nodes.filter(n => !isControlPlane(n));
  assert.equal(workers.length, 1, "join hängt genau einen Worker an");
  assert.equal(workers[0].version, NODE_VERSION);

  sim.exec("kubeadm reset");
  assert.equal(sim.nodes.length, 0, "reset leert das Node-Aggregat (bare metal)");
  assert.equal(sim.controlPlane.up, false);
});

test("mergeScenario (#577): ein Teil-Node-Spec {name} bekommt die Cluster-Defaults statt eines illegalen Knotens", () => {
  sim.mergeScenario({ bareMetal: true });
  assert.equal(sim.nodes.length, 0, "bare metal: leerer Ausgangszustand");
  // Ein Szenario, das nur den Namen liefert (die Sim-Fabrik soll die Pflichtfelder füllen).
  // Vor #577 landete das per rohem `nodes.push(Object.assign({},n))` als strukturell
  // illegaler ClusterNode (status/roles/version === undefined); jetzt über provisionNode.
  sim.mergeScenario({ nodes: [{ name: "ahoi-lonely" } as ClusterNode] });
  const node = sim.nodes.find(n => n.name === "ahoi-lonely");
  assert.ok(node, "der Teil-Node wurde aufgenommen");
  assert.equal(node!.status, "Ready", "status-Default gefüllt");
  assert.equal(node!.roles, "<none>", "roles-Default gefüllt");
  assert.equal(node!.version, NODE_VERSION, "version-Default gefüllt");
  // Der Knoten ist damit ein legaler ClusterNode: isControlPlane greift ohne TypeError.
  assert.equal(isControlPlane(node!), false, "gefüllte roles sind auswertbar (kein undefined)");
});

test("mergeScenario (#577): ein voll spezifizierter Node bleibt unverändert (Defaults überschrieben)", () => {
  sim.mergeScenario({ bareMetal: true });
  sim.mergeScenario({ nodes: [{ name: "ahoi-cp", status: "Ready", roles: "control-plane", version: NODE_VERSION }] });
  const node = sim.nodes.find(n => n.name === "ahoi-cp")!;
  assert.equal(node.roles, "control-plane", "explizite Rolle bleibt erhalten");
  assert.equal(isControlPlane(node), true);
});

test("terraform destroy entfernt die per apply provisionierten Worker über removeNode", () => {
  sim.mergeScenario({ tfResources: [{ addr: "hafen_server.worker[0]", desc: "neue Server" }] });
  sim.exec("terraform init");
  sim.exec("terraform apply");
  assert.ok(sim.nodes.some(n => n.name === "ahoi-worker-3"), "apply provisioniert ahoi-worker-3");
  assert.ok(sim.nodes.some(n => n.name === "ahoi-worker-4"), "apply provisioniert ahoi-worker-4");
  sim.exec("terraform destroy");
  assert.equal(sim.nodes.some(n => n.name === "ahoi-worker-3"), false, "destroy entfernt ahoi-worker-3");
  assert.equal(sim.nodes.some(n => n.name === "ahoi-worker-4"), false, "destroy entfernt ahoi-worker-4");
});

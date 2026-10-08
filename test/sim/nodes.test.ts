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
import { provisionNode, removeNode, isControlPlane, nodeInternalIP, snapshotNode, NODE_SYSTEM_INFO, NODE_VERSION } from "../../src/sim/nodes";
import { readdirSync, readFileSync } from "node:fs";
import { CONTROL_PLANE_IP } from "../../src/sim/util";
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
  assert.equal(cp.version, NODE_VERSION);
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
  sim.mergeScenario({ nodes: [{ name: "ahoi-lonely" }] });
  const node = sim.nodes.find(n => n.name === "ahoi-lonely");
  assert.ok(node, "der Teil-Node wurde aufgenommen");
  assert.equal(node.status, "Ready", "status-Default gefüllt");
  assert.equal(node.roles, "<none>", "roles-Default gefüllt");
  assert.equal(node.version, NODE_VERSION, "version-Default gefüllt");
  // Der Knoten ist damit ein legaler ClusterNode: isControlPlane greift ohne TypeError.
  assert.equal(isControlPlane(node), false, "gefüllte roles sind auswertbar (kein undefined)");
});

test("mergeScenario (#577): ein voll spezifizierter Node bleibt unverändert (Defaults überschrieben)", () => {
  sim.mergeScenario({ bareMetal: true });
  sim.mergeScenario({ nodes: [{ name: "ahoi-cp", status: "Ready", roles: "control-plane", version: NODE_VERSION }] });
  const node = sim.nodes.find(n => n.name === "ahoi-cp")!;
  assert.equal(node.roles, "control-plane", "explizite Rolle bleibt erhalten");
  assert.equal(isControlPlane(node), true);
});

test("reset (#596): ein Teil-Node-Spec {name} im Szenario bekommt die Cluster-Defaults statt eines illegalen Knotens", () => {
  // Zwilling zu #577, aber auf dem RESET-Pfad (Konstruktor/Laden): ein Szenario mit einem
  // Node, der nur den Namen trägt, landete per rohem `Object.assign({}, n)` (sim.ts:278) als
  // strukturell illegaler ClusterNode (status/roles/version === undefined) – deriveControlPlane
  // wertet dann direkt danach `roles.includes(...)` auf undefined aus (TypeError). Jetzt über
  // provisionNode, das die Pflichtfelder mit den Cluster-Defaults füllt.
  const s = new KQSim({ nodes: [{ name: "ahoi-lonely" }] });
  const node = s.nodes.find(n => n.name === "ahoi-lonely");
  assert.ok(node, "der Teil-Node wurde aufgenommen");
  assert.equal(node.status, "Ready", "status-Default gefüllt");
  assert.equal(node.roles, "<none>", "roles-Default gefüllt");
  assert.equal(node.version, NODE_VERSION, "version-Default gefüllt");
  // Der Knoten ist damit ein legaler ClusterNode: isControlPlane greift ohne TypeError.
  assert.equal(isControlPlane(node), false, "gefüllte roles sind auswertbar (kein undefined)");
});

test("reset (#596): ein voll spezifizierter Szenario-Node bleibt unverändert, Control-Plane wird abgeleitet", () => {
  const s = new KQSim({ nodes: [{ name: "ahoi-cp", status: "Ready", roles: "control-plane", version: NODE_VERSION }] });
  const node = s.nodes.find(n => n.name === "ahoi-cp")!;
  assert.equal(node.roles, "control-plane", "explizite Rolle bleibt erhalten");
  assert.equal(isControlPlane(node), true);
  assert.equal(s.controlPlane.node, "ahoi-cp", "deriveControlPlane findet den gefüllten Control-Plane-Knoten");
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

/* ---------- (c) Node-Modell: INTERNAL-IP und Systeminfo (#1483) ---------- */

test("nodeInternalIP: die Control-Plane trägt die CP-Adresse, auch unter fremdem Namen", () => {
  assert.equal(nodeInternalIP({ name: "ahoi-control", status: "Ready", roles: "control-plane", version: NODE_VERSION }), CONTROL_PLANE_IP);
  assert.equal(nodeInternalIP({ name: "cp-sonder", status: "Ready", roles: "control-plane", version: NODE_VERSION }), CONTROL_PLANE_IP);
});

test("nodeInternalIP: ein Worker bekommt nie die CP-Adresse, auch nicht unter dem Namen ahoi-control (Negativ)", () => {
  const w: ClusterNode = { name: "ahoi-control", status: "Ready", roles: "<none>", version: NODE_VERSION };
  assert.notEqual(nodeInternalIP(w), CONTROL_PLANE_IP);
  for (let i = 1; i <= 2000; i++) {
    assert.doesNotMatch(nodeInternalIP({ ...w, name: "ahoi-worker-" + i }), /^10\.0\.0\./);
  }
});

test("nodeInternalIP: deterministisch, im Node-Netz 10.0.0.0/16 und eindeutig für alle bekannten Namen", () => {
  const quests = readdirSync("src/content/data/quests").map(f => readFileSync("src/content/data/quests/" + f, "utf8")).join("\n");
  const namen = new Set<string>([...quests.matchAll(/ahoi-worker-\d+/g)].map(m => m[0]));
  for (let i = 1; i <= 100; i++) namen.add("ahoi-worker-" + i);
  const ips = new Map<string, string>();
  for (const name of namen) {
    const node: ClusterNode = { name, status: "Ready", roles: "<none>", version: NODE_VERSION };
    const ip = nodeInternalIP(node);
    assert.equal(nodeInternalIP({ ...node }), ip, "deterministisch");
    assert.match(ip, /^10\.0\.\d{1,3}\.\d{1,3}$/);
    assert.ok(!ips.has(ip), name + " kollidiert mit " + ips.get(ip) + " (" + ip + ")");
    ips.set(ip, name);
  }
});

test("NODE_SYSTEM_INFO: eingefroren, mit OS, Kernel und Container-Runtime", () => {
  assert.ok(Object.isFrozen(NODE_SYSTEM_INFO));
  assert.match(NODE_SYSTEM_INFO.osImage, /Ubuntu/);
  assert.match(NODE_SYSTEM_INFO.kernelVersion, /^\d+\.\d+\.\d+/);
  assert.match(NODE_SYSTEM_INFO.containerRuntimeVersion, /^containerd:\/\//);
  assert.equal(NODE_SYSTEM_INFO.architecture, "amd64");
});

/* ---------- (d) Die Node-Version ist abgeleitet statt gespeichert (#1496) ---------- */

test("snapshotNode: die Standardversion steht nicht im Snapshot, eine bewusste Abweichung schon", () => {
  const n: ClusterNode = { name: "ahoi-worker-1", status: "Ready", roles: "<none>", version: NODE_VERSION, diskPressure: true };
  const snap = snapshotNode(n);
  assert.equal("version" in snap, false);
  assert.deepEqual(snap, { name: "ahoi-worker-1", status: "Ready", roles: "<none>", diskPressure: true });
  assert.equal(snapshotNode({ ...n, version: "v1.29.0" }).version, "v1.29.0");
  assert.notEqual(snap, n, "eine Kopie, nicht das Original");
});

test("Snapshot → neue Sim: die Knoten tragen NODE_VERSION, eine abweichende Version überlebt", () => {
  const sim = new KQSim({ nodes: [{ name: "ahoi-control", roles: "control-plane" }, { name: "alt", version: "v1.29.0" }] });
  assert.equal(sim.nodes[0].version, NODE_VERSION, "ein Spec ohne Version bekommt den Cluster-Default");
  const snap = sim.snapshot();
  assert.deepEqual(snap.nodes?.map(n => n.version), [undefined, "v1.29.0"]);
  assert.deepEqual(new KQSim(snap).nodes.map(n => n.version), [NODE_VERSION, "v1.29.0"]);
});

/** Alle Werte eines JSON-Baums, die ein Objekt oder String sind, samt Pfad der Schlüssel. */
function laufe(v: unknown, pfad: string, besuche: (v: unknown, pfad: string) => void): void {
  besuche(v, pfad);
  if (Array.isArray(v)) v.forEach((x, i) => laufe(x, pfad + "[" + i + "]", besuche));
  else if (typeof v === "object" && v !== null) for (const [k, x] of Object.entries(v)) laufe(x, pfad + "." + k, besuche);
}
const questDateien = () => readdirSync("src/content/data/quests").map(f => ({ f, json: JSON.parse(readFileSync("src/content/data/quests/" + f, "utf8")) as unknown }));

test("INHALT: kein Node-Spec in den Quest-Daten trägt eine eigene `version` (sie folgt NODE_VERSION)", () => {
  for (const { f, json } of questDateien()) {
    laufe(json, f, (v, pfad) => {
      if (!pfad.endsWith(".nodes") || !Array.isArray(v)) return;
      for (const n of v as Record<string, unknown>[]) assert.equal("version" in n, false, pfad + ": " + String(n.name) + " trägt eine Version");
    });
  }
});

test("INHALT: jede hafen_cluster-Version in den Quest-Daten (cluster.tf und desc der tfResource) ist NODE_VERSION", () => {
  let gefunden = 0;
  const pruefe = (text: string, pfad: string) => {
    for (const m of text.matchAll(/version\s*=\s*"(\d+\.\d+\.\d+)"/g)) {
      gefunden++;
      assert.equal("v" + m[1], NODE_VERSION, pfad + ": " + m[0]);
    }
  };
  for (const { f, json } of questDateien()) {
    laufe(json, f, (v, pfad) => {
      if (typeof v === "string") {
        // Nur der hafen_cluster-Block, nicht andere Versionen (Provider-Pins, Charts).
        for (const m of v.matchAll(/resource "hafen_cluster"[^}]*}/g)) pruefe(m[0], pfad);
      } else if (typeof v === "object" && v !== null && !Array.isArray(v)) {
        const o = v as { addr?: unknown; desc?: unknown };
        if (typeof o.addr === "string" && o.addr.startsWith("hafen_cluster.") && typeof o.desc === "string") pruefe(o.desc, pfad + ".desc");
      }
    });
  }
  assert.ok(gefunden >= 2, "der Wächter sieht die hafen_cluster-Versionen (cluster.tf und desc), sonst prüft er nichts");
});

/* #444 – Pod-Security-Härtung aus Phase 6 (Wachturm) bleibt narrativ bewusst dauerhaft
 * ("an diesem Tor kommt sie nicht durch"). Sie darf aber das freie Üben NICHT blockieren:
 * Ein Übungs-Drill, der ein Deployment IMPERATIV (ohne securityContext) anlegt, würde unter
 * der dauerhaft auf `restricted` stehenden, GETEILTEN Game.sim sonst an der Pod-Security-
 * Admission scheitern und damit unlösbar werden (Oles `k-create`, dazu alles, was über
 * `ensureDeployment` ein Basis-Deployment braucht).
 *
 * Erwartung: solche Drills normalisieren ihren Sandbox-Cluster auf die permissive Stufe
 * (wie der `pod-security-enforce`-Drill schon "jede Übung startet sauber"). Die Cluster-
 * Härtung selbst bleibt unangetastet – ein roher Pod direkt über exec wird weiter abgewiesen.
 */
import { test } from "vitest";
import assert from "node:assert/strict";
import { Sim as KQSim } from "../src/sim";
import { KQContent } from "../src/content";

const norm = (s: string) => s.trim().replace(/\s+/g, " ");

/** Stellt den Zustand eines Spielers NACH Phase 6 nach: die geteilte Sim steht dauerhaft auf
 *  `restricted`, weil die Wachturm-Quest das enforce-Label gesetzt hat und nie zurücknimmt. */
function postPhase6Sim(): KQSim {
  const sim = new KQSim({});
  sim.exec("kubectl label namespace default pod-security.kubernetes.io/enforce=restricted");
  assert.equal(sim.podSecurity, "restricted", "Vorbedingung: Cluster ist gehärtet");
  return sim;
}

test("#444: Oles k-create-Drill bleibt nach Phase 6 (restricted) lösbar", () => {
  for (let i = 0; i < 8; i++) {
    const sim = postPhase6Sim();
    const t = KQContent.DRILLS["k-create"](sim);
    assert.ok(t.accept.some(re => re.test(norm(t.solution))), "accept matcht die Musterlösung");
    const r = sim.exec(t.solution);
    assert.ok(!r.error, "#" + i + ": imperatives create darf im Drill NICHT an der Admission scheitern: " + r.output);
    assert.ok(sim.deployments.length > 0, "#" + i + ": das Deployment wurde angelegt");
  }
});

test("#444: ensureDeployment-gestützter Drill (k-scale) bleibt nach Phase 6 lösbar (kein Basis-Deployment vorhanden)", () => {
  for (let i = 0; i < 8; i++) {
    const sim = postPhase6Sim();
    assert.equal(sim.deployments.length, 0, "Vorbedingung: kein Deployment da, der Drill muss erst eins anlegen");
    const t = KQContent.DRILLS["k-scale"](sim);
    assert.ok(t.accept.some(re => re.test(norm(t.solution))), "accept matcht die Musterlösung");
    const r = sim.exec(t.solution);
    assert.ok(!r.error, "#" + i + ": k-scale darf nach Phase 6 nicht brechen: " + r.output);
  }
});

test("#444: die Cluster-Härtung bleibt unangetastet – ein roher Pod direkt über exec wird weiter abgewiesen", () => {
  // Wir senken NICHT global die Admission; der Fix wirkt nur in den Drill-Vorbereitungen.
  const sim = postPhase6Sim();
  const r = sim.exec("kubectl create deployment roh-posten --image=nginx");
  assert.ok(r.error, "ein roh über exec (ohne Drill) angelegter Pod wird unter restricted weiter abgewiesen");
});

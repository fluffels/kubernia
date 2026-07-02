/* Unit-Tests: Cluster-Revision (`Sim.rev`, #523).
 * `rev` ist ein monoton wachsender Laufzeit-Dirty-Marker, an dem die Präsentation
 * (worldscene/clustersync.ts) erkennt, ob sich seit dem letzten Frame am Cluster
 * etwas geändert hat – damit der teure Pod-/Signatur-Sync NICHT mehr jeden Frame,
 * sondern nur bei echter Änderung läuft. Getestet wird der Vertrag, auf den sich der
 * Sync verlässt: jede Befehls-Transaktion (exec) UND jede Nicht-exec-Mutation (touch,
 * z.B. Sturm/Piraten in events.ts) bumpen `rev`; reset() bumpt ebenfalls (neuer Stand).
 * Factory in ./helpers. */
import { test, beforeEach } from "vitest";
import assert from "node:assert/strict";
import { KQSim, freshSim } from "./helpers";

let sim: KQSim;
beforeEach(() => { sim = freshSim(); });

test("frischer Simulator hat eine numerische Revision", () => {
  assert.equal(typeof sim.rev, "number");
});

test("jede exec-Transaktion bumpt die Revision (auch Lesebefehle)", () => {
  const before = sim.rev;
  sim.exec("kubectl get pods");
  assert.ok(sim.rev > before, "exec muss rev erhöhen");
  const mid = sim.rev;
  sim.exec("help");
  assert.ok(sim.rev > mid, "auch ein zweiter Befehl bumpt weiter");
});

test("touch() bumpt die Revision (für Nicht-exec-Mutationen wie Sturm/Piraten)", () => {
  const before = sim.rev;
  sim.touch();
  assert.equal(sim.rev, before + 1);
  sim.touch();
  assert.equal(sim.rev, before + 2);
});

test("reset() bumpt die Revision (neuer Stand → Präsentation muss neu synchronisieren)", () => {
  const before = sim.rev;
  sim.reset();
  assert.ok(sim.rev > before, "reset muss rev erhöhen, damit ein neuer Stand einen Resync auslöst");
});

test("rev wächst monoton und fällt nie zurück", () => {
  let last = sim.rev;
  for (const cmd of ["docker pull nginx", "kubectl get pods", "help", "ls"]) {
    sim.exec(cmd);
    assert.ok(sim.rev > last, `nach '${cmd}' muss rev größer sein`);
    last = sim.rev;
  }
});

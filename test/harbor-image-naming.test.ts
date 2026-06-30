/* #363 – Freies Funken / Spielbeginn: das generische Beispiel-Image ist ein
 * Hafen-Name (`lotsen-dienst`) statt des echten Produktnamens `nginx`.
 * Bewusst MINIMALER Scope (mit der Maintainerin abgestimmt): nur die erste
 * Docker-Quest + das freie Funken. Echte Tool-Namen (redis/postgres/…) tauchen
 * absichtlich erst danach auf, wenn Bo sie einführt – das wird hier NICHT erzwungen.
 */
import { test } from "vitest";
import assert from "node:assert/strict";
import { KQContent } from "../src/content";
import { Sim as KQSim } from "../src/sim";
import { KNOWN_IMAGES } from "../src/sim/docker";
import type { TeachStep } from "../src/types";

/** Solutions der teach-Schritte einer Quest. */
function teachSolutions(questId: string): string[] {
  const q = KQContent.QUESTS.find(x => x.id === questId);
  assert.ok(q, `Quest ${questId} fehlt`);
  return q!.steps.filter((s): s is TeachStep => s.type === "teach").map(s => s.cmd.solution);
}

test("#363 erste Docker-Quest führt mit dem Hafen-Image `lotsen-dienst` ein (nicht nginx)", () => {
  const sols = teachSolutions("docker-first-container");
  assert.deepEqual(sols, ["docker pull lotsen-dienst", "docker run lotsen-dienst"]);
  // Red-Green-Gegenprobe: kein teach-Schritt der EINSTIEGS-Quest nennt mehr nginx.
  assert.ok(!sols.some(s => /nginx/.test(s)), "die erste Quest soll keinen echten Produktnamen einführen");
});

test("#363 die erste Drill-Karte (c-ch1-1) drillt ebenfalls `lotsen-dienst`", () => {
  const card = KQContent.CMD_CARDS.find(c => c.id === "c-ch1-1");
  assert.ok(card, "c-ch1-1 fehlt");
  assert.equal(card!.solution, "docker pull lotsen-dienst");
});

test("#363 die Sim kennt `lotsen-dienst` als reguläres Image (keine Tippfehlerhilfe)", () => {
  assert.ok(KNOWN_IMAGES.includes("lotsen-dienst"), "lotsen-dienst muss bekannt sein");
  const sim = new KQSim({});
  const pull = sim.exec("docker pull lotsen-dienst");
  assert.ok(!pull.error, "pull eines Hafen-Images darf nicht fehlschlagen");
  assert.match(pull.output!, /Downloaded newer image for lotsen-dienst:latest/);
  const run = sim.exec("docker run lotsen-dienst");
  assert.ok(!run.error, "run eines Hafen-Images darf nicht fehlschlagen");
});

test("#363 spätere Quest (docker-run-options) darf bewusst noch echte Namen nutzen", () => {
  // Beleg, dass der Scope minimal ist: hier ist nginx absichtlich NICHT ersetzt.
  const sols = teachSolutions("docker-run-options");
  assert.ok(sols.some(s => /nginx/.test(s)), "spätere Quests bleiben (gewollt) bei den echten Namen");
});

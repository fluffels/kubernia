/* Test-Factory: valide Domänen-Eingaben für die Simulator-Tests.
 * Leitidee (DDD): ein Domänen-Objekt lässt sich IMMER ohne Argumente bauen –
 * freshSim() liefert den bekannten leeren Startzustand; spätere Varianten
 * überschreiben nur, was für die jeweilige Assertion relevant ist. */
import { Sim as KQSim } from "../../src/sim";
import { seedGlobalRng } from "../../src/rng";

export { KQSim };

/** Frischer Simulator mit leerem Szenario – der gemeinsame Startzustand jeder
 *  sim-Modul-Test-Datei (`beforeEach(() => { sim = freshSim(); })`).
 *  Setzt zusätzlich den globalen Zufallsstrom (#492) auf einen festen Seed, damit
 *  Pod-Namen/IDs pro Testfall reproduzierbar und von der Ausführungsreihenfolge
 *  unabhängig sind. */
export function freshSim(): KQSim {
  seedGlobalRng(0xC0FFEE);
  return new KQSim({});
}

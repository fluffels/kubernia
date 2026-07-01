/* Test-Factory: valide Domänen-Eingaben für die Simulator-Tests.
 * Leitidee (DDD): ein Domänen-Objekt lässt sich IMMER ohne Argumente bauen –
 * freshSim() liefert den bekannten leeren Startzustand; spätere Varianten
 * überschreiben nur, was für die jeweilige Assertion relevant ist. */
import { Sim as KQSim } from "../../src/sim";

export { KQSim };

/** Frischer Simulator mit leerem Szenario – der gemeinsame Startzustand jeder
 *  sim-Modul-Test-Datei (`beforeEach(() => { sim = freshSim(); })`). */
export function freshSim(): KQSim {
  return new KQSim({});
}

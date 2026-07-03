/* Test-Factory: valide Domänen-Eingaben für die Simulator-Tests.
 * Leitidee (DDD): ein Domänen-Objekt lässt sich IMMER ohne Argumente bauen –
 * freshSim() liefert den bekannten leeren Startzustand; spätere Varianten
 * überschreiben nur, was für die jeweilige Assertion relevant ist. */
import { Sim as KQSim } from "../../src/sim";
import { seedGlobalRng } from "../../src/core/rng";

export { KQSim };

/** Frischer Simulator mit leerem Szenario – der gemeinsame Startzustand jeder
 *  sim-Modul-Test-Datei (`beforeEach(() => { sim = freshSim(); })`).
 *  Pod-Namen/IDs sind seit #580 ohnehin instanz-lokal reproduzierbar (jede Sim seedet
 *  in `reset()` ihren EIGENEN Strom), unabhängig von der Ausführungsreihenfolge. Der
 *  globale Seed (#492) hier fixt nur noch die verbleibende Content-/Anwendungs-Zufälligkeit
 *  (`pick`/Spaced-Repetition), die den globalen Strom nutzt. */
export function freshSim(): KQSim {
  seedGlobalRng(0xC0FFEE);
  return new KQSim({});
}

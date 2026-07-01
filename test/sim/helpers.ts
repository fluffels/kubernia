/* Re-Export der Sim-Factory (nach test/factories/ gezogen, #475). Die
 * test/sim/*-Tests importieren weiterhin `{ KQSim, freshSim }` aus "./helpers"
 * – dieser Barrel hält diese Import-Pfade unverändert (keine Link-Brüche). */
export { KQSim, freshSim } from "../factories/sim";

// Kein Shebang (siehe docs-gen.mjs). Registry der Generatoren (#1392): Marker-Name → Generator
// `({rootDir, config}) => string` (wirft bei Datenfehlern). Die Engine importiert nur diese Datei;
// ein anderes Projekt übergibt `generators` oder ergänzt eigene Generatoren über `config.generatoren`
// (ADR 0022 F6), ohne die Engine oder diese Datei anzufassen.
import { existsSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { adrListeGenerator } from "./adr.mjs";
import { zeitleisteGenerator } from "./zeitleiste.mjs";
import { diagrammGenerator } from "./diagramme.mjs";
import { gatesGenerator } from "./gates.mjs";
import { harnessInventarGenerator } from "./harness-inventar.mjs";
import { harnessKennzahlenGenerator } from "./harness-kennzahlen.mjs";
import { schichtenIstGenerator, schichtenSollGenerator } from "./schichten.mjs";

// Gruppen (#1373): Kern = übertragbar, braucht nur Node und die Config (Fremd-Repo-Beleg: test/docgen-fremdrepo.test.ts);
// Harness-Stack = setzt Claude Code, GitHub und npm voraus (die npm-Ketten-Auflösung dafür steht in npm-ketten.mjs, nicht im Kern).
// Projekt-Generatoren stehen nie hier, sondern in `config.generatoren` (siehe `ladeGeneratoren`).
export const GENERATORS = {
  // Kern (übertragbar)
  "adr-liste": adrListeGenerator,
  zeitleiste: zeitleisteGenerator,
  "schichten-soll": schichtenSollGenerator,
  "schichten-ist": schichtenIstGenerator,
  // Harness-Stack (Claude Code, GitHub, npm)
  gates: gatesGenerator,
  "harness-inventar": harnessInventarGenerator,
  "harness-kennzahlen": harnessKennzahlenGenerator,
  "agenten-ablauf": diagrammGenerator("agenten-ablauf"),
  "agenten-sequenz": diagrammGenerator("agenten-sequenz"),
  "leitplanken-schichten": diagrammGenerator("leitplanken-schichten"),
};

/**
 * Kern-Generatoren plus die Projekt-Generatoren aus `config.generatoren`
 * (`{ "<marker>": { datei: "<pfad relativ zum rootDir>", name: "<Export>" } }`). Wirft mit einer Meldung, die immer
 * `config.generatoren.<marker>` und den Pfad nennt: Kern-Name als Marker (fail-closed), Datei fehlt, Export fehlt
 * oder ist keine Funktion. Ohne `generatoren` entspricht das Ergebnis `GENERATORS`.
 * @param {{ rootDir: string, config?: { generatoren?: unknown } }} opts
 */
export async function ladeGeneratoren({ rootDir, config }) {
  const spec = config?.generatoren;
  if (spec === undefined) return { ...GENERATORS };
  if (spec === null || typeof spec !== "object" || Array.isArray(spec))
    throw new Error("config.generatoren muss ein Objekt { <marker>: { datei, name } } sein");
  const geladen = {};
  for (const [marker, eintrag] of Object.entries(spec)) {
    const wo = `config.generatoren.${marker}`;
    if (Object.hasOwn(GENERATORS, marker)) throw new Error(`${wo}: "${marker}" ist ein Kern-Generator und darf nicht überschrieben werden`);
    if (eintrag === null || typeof eintrag !== "object" || typeof eintrag.datei !== "string" || eintrag.datei === "" || typeof eintrag.name !== "string" || eintrag.name === "")
      throw new Error(`${wo} muss { datei, name } mit nicht leeren Zeichenketten sein`);
    const abs = isAbsolute(eintrag.datei) ? eintrag.datei : resolve(rootDir, eintrag.datei);
    if (!existsSync(abs)) throw new Error(`${wo}: Datei fehlt: ${eintrag.datei}`);
    let modul;
    try {
      modul = await import(pathToFileURL(abs).href);
    } catch (e) {
      throw new Error(`${wo}: ${eintrag.datei} lässt sich nicht laden: ${e instanceof Error ? e.message : String(e)}`, { cause: e });
    }
    if (typeof modul[eintrag.name] !== "function") throw new Error(`${wo}: ${eintrag.datei} exportiert keine Funktion "${eintrag.name}"`);
    geladen[marker] = modul[eintrag.name];
  }
  return { ...GENERATORS, ...geladen };
}

// Kein Shebang (siehe docs-gen.mjs). Registry der Generatoren (#1392): Marker-Name → Generator
// `({rootDir, config}) => string` (wirft bei Datenfehlern). Die Engine importiert nur diese Datei;
// ein anderes Projekt tauscht sie (oder übergibt `generators`), ohne die Engine anzufassen.
import { adrListeGenerator, zeitleisteGenerator } from "./zeitleiste.mjs";
import { diagrammGenerator } from "./diagramme.mjs";
import { gatesGenerator } from "./gates.mjs";
import { harnessInventarGenerator } from "./harness-inventar.mjs";
import { schichtenIstGenerator, schichtenSollGenerator } from "./schichten.mjs";

export const GENERATORS = {
  "adr-liste": adrListeGenerator,
  gates: gatesGenerator,
  "harness-inventar": harnessInventarGenerator,
  "schichten-soll": schichtenSollGenerator,
  "schichten-ist": schichtenIstGenerator,
  zeitleiste: zeitleisteGenerator,
  "agenten-ablauf": diagrammGenerator("agenten-ablauf"),
  "agenten-sequenz": diagrammGenerator("agenten-sequenz"),
  "leitplanken-schichten": diagrammGenerator("leitplanken-schichten"),
};

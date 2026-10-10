// Kein Shebang (siehe docs-gen.mjs). Registry der Generatoren (#1392): Marker-Name → Generator
// `({rootDir, config}) => string` (wirft bei Datenfehlern). Die Engine importiert nur diese Datei;
// ein anderes Projekt tauscht sie (oder übergibt `generators`), ohne die Engine anzufassen.
import { adrListeGenerator } from "./adr.mjs";
import { zeitleisteGenerator } from "./zeitleiste.mjs";
import { diagrammGenerator } from "./diagramme.mjs";
import { gatesGenerator } from "./gates.mjs";
import { harnessInventarGenerator } from "./harness-inventar.mjs";
import { harnessKennzahlenGenerator } from "./harness-kennzahlen.mjs";
import { questGraphGenerator, questsJeThemaGenerator } from "./quests.mjs";
import { saveVersionenGenerator } from "./save-versionen.mjs";
import { schichtenIstGenerator, schichtenSollGenerator } from "./schichten.mjs";

// Gruppen (#1373): Kern = übertragbar, braucht nur Node und die Config (Fremd-Repo-Beleg: test/docgen-fremdrepo.test.ts);
// Harness-Stack = setzt Claude Code, GitHub und npm voraus (die npm-Ketten-Auflösung dafür steht in npm-ketten.mjs, nicht im Kern); Spiel = nur Kubernia.
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
  // Spiel (projektspezifisch, Laufzeit wächst mit dem Inhalt)
  "save-versionen": saveVersionenGenerator,
  "quest-graph": questGraphGenerator,
  "quests-je-thema": questsJeThemaGenerator,
};

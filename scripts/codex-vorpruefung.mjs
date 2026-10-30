// Einstieg: node scripts/codex-vorpruefung.mjs [--belege <JSON-Datei>]. Rein lesend.
import { readFileSync } from "node:fs";
import { flagsLesen } from "./flag-lib.mjs";
import { istDirektaufruf } from "./direktaufruf.mjs";
import { ladeProjektConfig } from "./projekt-config-lib.mjs";
import { bewerteBelege } from "./codex-lib.mjs";

export function main(argv = process.argv.slice(2), out = console.log, err = console.error, lade = ladeProjektConfig) {
  const { werte, fehler } = flagsLesen(argv, { belege: { type: "string" } });
  if (fehler) { err(fehler.text); return 2; }
  try {
    const belege = werte.belege ? JSON.parse(readFileSync(werte.belege, "utf8")) : {};
    const maengel = bewerteBelege(belege, lade());
    maengel.push("Autonomer Codex-Ticketlauf gesperrt: technische Quarantäne, Hook-Abbildung und frische Ende-zu-Ende-Abnahme noch nicht nachgewiesen (#79)");
    out(JSON.stringify({ autonom: false, maengel }));
    return 1;
  } catch (e) { err(`Codex-Vorprüfung gestoppt: ${e.message}`); return 1; }
}
if (istDirektaufruf(import.meta.url)) process.exitCode = main();

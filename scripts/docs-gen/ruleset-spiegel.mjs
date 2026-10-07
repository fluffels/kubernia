// Kein Shebang (siehe docs-gen.mjs). Der Spiegel des Rulesets `main-schutz` (`.github/ruleset-main-schutz.json`, geschützt):
// Name, Required-Check-Kontexte und Bypass-Akteure, wie `gh api repos/{owner}/{repo}/rulesets/<id>` sie liefert.
// EINE Eingangsprüfung für den Generator `leitplanken-schichten` und den Shadowing-Wächter (test/harness/required-check-shadowing.test.ts).
import { leseJson } from "./markdown.mjs";

const textListe = (x) => Array.isArray(x) && x.every((e) => typeof e === "string" && e.trim() !== "");

/** Prüft die Form des Spiegels (`roh` ist das geparste JSON); wirft mit `pfad` in der Meldung, gibt `roh` zurück. */
export function pruefeRulesetSpiegel(roh, pfad) {
  if (typeof roh?.name !== "string" || roh.name.trim() === "") throw new Error(`Ruleset-Spiegel ${pfad}: name fehlt`);
  if (!textListe(roh.requiredChecks) || roh.requiredChecks.length === 0) {
    throw new Error(`Ruleset-Spiegel ${pfad}: requiredChecks muss eine nicht leere Liste aus Texten sein`);
  }
  if (!Array.isArray(roh.bypassActors)) throw new Error(`Ruleset-Spiegel ${pfad}: bypassActors muss eine Liste sein`);
  return roh;
}

/** Liest und prüft den Spiegel unter `pfad` (relativ zu `rootDir` oder absolut). */
export function ladeRulesetSpiegel(rootDir, pfad) {
  return pruefeRulesetSpiegel(leseJson(rootDir, pfad, "Ruleset-Spiegel"), pfad);
}

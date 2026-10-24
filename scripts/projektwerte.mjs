// Projektwerte (ADR 0022 F3f): Stellen, die eine Datei nicht zur Laufzeit aus der Config lesen kann (Markdown-Block zwischen
// Projektwert-Markern, YAML-Zeile direkt nach einem Zeilen-Marker im Frontmatter), werden aus `.factory/projekt.json` erzeugt.
// `node scripts/projektwerte.mjs --check | --write [--wurzel <pfad>]`; Exit 0 ok, 1 Abweichung oder Fehler, 2 Aufruf.
// Prüf-Fläche (geschlossene Liste): `.md`-Pfade des Besitz-Manifests, `.claude/agents/*.md`, `.claude/skills/*/*.md`, `.agents/skills/*/*.md`; andere Dateitypen und
// JSON-Schlüssel-Einheiten werden nicht gerendert. `--write` prüft erst alles und schreibt dann nur Geändertes, im Zeilenende-Stil der Datei.
import { fileURLToPath } from "node:url";
import { istDirektaufruf } from "./hook-io.mjs";
import { dirname, join } from "node:path";
import { AUFRUF_EXIT, flagsLesen } from "./flag-lib.mjs";
import { projektwertLauf } from "./besitz-lib.mjs";
import { ladeProjektConfig } from "./projekt-config-lib.mjs";

const USAGE = "Aufruf: node scripts/projektwerte.mjs --check | --write [--wurzel <pfad>]";
const FIX = "Fix: `node scripts/projektwerte.mjs --write`";

/** Kommandozeile; Rückgabe = Exit-Code (0 ok, 1 Abweichung oder Fehler, 2 Aufruf). */
export function cli(argv, { wurzel = join(dirname(fileURLToPath(import.meta.url)), ".."), out = (s) => console.log(s), err = (s) => console.error(s) } = {}) {
  const gelesen = flagsLesen(argv, { check: { type: "boolean" }, write: { type: "boolean" }, wurzel: { type: "string" } });
  if (gelesen.fehler) {
    err(`projektwerte: ${gelesen.fehler.text}\n${USAGE}`);
    return AUFRUF_EXIT;
  }
  const { check, write } = gelesen.werte;
  if (check === write) {
    err(`projektwerte: genau einen Modus angeben (--check oder --write)\n${USAGE}`);
    return AUFRUF_EXIT;
  }
  const w = gelesen.werte.wurzel ?? wurzel;
  const r = projektwertLauf(w, () => ladeProjektConfig({ rootDir: w }), { schreiben: write === true });
  if (r.fehler.length > 0) {
    err(`projektwerte: ${r.fehler.length} Befund(e)${write ? ", nichts geschrieben" : ""}`);
    for (const f of r.fehler) err(`  ${f}`);
    if (!write && r.abweichungen.length > 0) err(`projektwerte: ${FIX}`);
    return 1;
  }
  for (const p of r.geaendert) out(`geändert: ${p}`);
  out(`projektwerte: ${r.dateien} Dateien mit Projektwert-Stellen, ${write ? `${r.geaendert.length} geändert` : "alle aktuell"}`);
  return 0;
}

if (istDirektaufruf(import.meta.url)) {
  process.exitCode = cli(process.argv.slice(2));
}

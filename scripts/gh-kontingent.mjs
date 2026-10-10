#!/usr/bin/env node
// Messen und Vorab-Prüfen des GitHub-API-Kontingents (#1549 Z1, Bezug #1358).
/**
 * Das Stundenkontingent (core und graphql, je 5000 Punkte) teilen sich alle Agenten und Workflows eines Tokens.
 * Ist es leer, scheitern Board-Läufe mitten in einer Mutation. Dieses Modul
 *  - liest `gh api rate_limit` (zählt laut GitHub-Doku nicht gegen das Primärlimit),
 *  - bricht teure Läufe vorab sauber ab (lokal Exit 3 mit Reset-Zeit; unter GitHub Actions nur eine Warnung, damit `main` nicht rot wird),
 *  - protokolliert die Kosten je Skriptlauf (Delta der `used`-Werte; enthält auch den Verbrauch paralleler Agenten desselben Tokens)
 *    als JSONL in `os.tmpdir()` (Override `KQ_GH_KOSTEN_LOG`), unter Actions als `::notice`.
 *
 * Aufruf: `node scripts/gh-kontingent.mjs` zeigt den Stand (Exit 3 bei < 10 %), `--bericht` aggregiert das Log je Skript.
 * Es liest nur über `gh-cli.mjs` (der Wächter `test/harness/gh-cli.test.ts` verbietet einen direkten `gh`-Aufruf).
 */
import { existsSync, readFileSync } from "node:fs";
import { istDirektaufruf } from "./hook-io.mjs";
import { ARTEN, EXIT_KNAPP, berichtAus, kontingentLesen, kontingentPruefen, logPfad, ressource } from "./kontingent-lib.mjs";

function ausgabeBericht(b) {
  const zeilen = Object.entries(b.skripte)
    .sort((x, y) => y[1].graphql + y[1].core - (x[1].graphql + x[1].core))
    .map(([n, s]) => `${n.padEnd(24)} Läufe ${String(s.laeufe).padStart(4)}  core ${String(s.core).padStart(6)} (max ${s.coreMax})  graphql ${String(s.graphql).padStart(6)} (max ${s.graphqlMax})`);
  return [...(zeilen.length ? zeilen : ["Kein Log vorhanden."]), ...(b.uebersprungen ? [`${b.uebersprungen} unlesbare Zeile(n) übersprungen.`] : []), "Hinweis: Deltas enthalten den Verbrauch paralleler Agenten desselben Tokens."].join("\n");
}

function main() {
  if (process.argv.includes("--bericht")) {
    const pfad = logPfad();
    console.log(ausgabeBericht(berichtAus(existsSync(pfad) ? readFileSync(pfad, "utf8").split(/\r?\n/) : [])));
    return;
  }
  const json = kontingentLesen();
  const p = kontingentPruefen(json);
  for (const art of ARTEN) {
    const r = ressource(json, art);
    if (r) console.log(`${art.padEnd(8)} ${r.remaining}/${r.limit} (${Math.round((r.remaining / r.limit) * 100)} %), Reset ${new Date(r.reset * 1000).toISOString()}`);
  }
  if (p.warnung) console.log(p.warnung);
  if (!p.ok) {
    console.log(`✖ ${p.meldung}`);
    process.exitCode = EXIT_KNAPP;
  }
}

if (istDirektaufruf(import.meta.url)) main();

/* Leerlauf-Schutz für Kern-Tests (#1933, ADR 0022 F10): Ankerdateien aus dem Besitz-Manifest statt absoluter Größenschwellen.
 *
 * Ein Kern-Test, der Dateien scannt, beweist mit einem Anker, dass sein Scan nicht leer läuft: der Anker ist eine Datei, die laut
 * `.factory/besitz.json` verteilt wird und daher in jedem Konsumenten-Repo liegt (auch im Factory-Repo), unabhängig von dessen Größe.
 * Aufruf nur im Test-Rumpf, nie beim Sammeln (sonst ein Sammelfehler statt eines roten Tests).
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as rawBesitz from "../../scripts/besitz-lib.mjs";

const { wirdVerteilt } = rawBesitz as unknown as { wirdVerteilt: (e: { ring: string }) => boolean };

export interface BesitzEintragKurz {
  pfad: string;
  ring: string;
}

const MANIFEST = fileURLToPath(new URL("../../.factory/besitz.json", import.meta.url));

/** Das echte Besitz-Manifest `.factory/besitz.json` (gemeinsamer Lader der Kern-Tests; der Eintragstyp ist je Konsument enger fassbar). */
export function ladeBesitzManifest<E extends BesitzEintragKurz = BesitzEintragKurz>(): { version: number; eintraege: E[] } {
  return JSON.parse(readFileSync(MANIFEST, "utf8")) as { version: number; eintraege: E[] };
}

/** Eindeutige, sortierte Pfade der verteilten Besitz-Einträge, die `passt` erfüllen. Wirft („Leerlauf-Schutz"), wenn keiner passt. */
export function besitzAnker(passt: (pfad: string) => boolean, eintraege?: BesitzEintragKurz[]): string[] {
  const quelle = eintraege ?? ladeBesitzManifest().eintraege;
  const pfade = [...new Set(quelle.filter((e) => wirdVerteilt(e)).map((e) => e.pfad))].filter(passt).sort();
  if (pfade.length === 0) {
    throw new Error(`Leerlauf-Schutz: kein verteilter Besitz-Pfad passt zum Prädikat ${String(passt)}: der Scan hätte keinen Anker`);
  }
  return pfade;
}

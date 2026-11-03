/* Leerlauf-Schutz für Kern-Tests (#1933, ADR 0022 F10): Ankerdateien aus dem Besitz-Manifest statt absoluter Größenschwellen.
 *
 * Ein Kern-Test, der Dateien scannt, beweist mit einem Anker, dass sein Scan nicht leer läuft: der Anker ist eine Datei, die laut
 * `.factory/besitz.json` verteilt wird und daher in jedem Konsumenten-Repo liegt (auch im Factory-Repo), unabhängig von dessen Größe.
 * Ein Anker ist verteilt UND, falls der Eintrag ein `modul` trägt, vom Bezieher gewählt: Quelle der Wahl ist die Projekt-Config (Schlüssel `module`,
 * ohne Schlüssel gilt der Standard); Dateien nicht gewählter Module kommen beim Bezieher nie an (factory#146).
 * Aufruf nur im Test-Rumpf, nie beim Sammeln (sonst ein Sammelfehler statt eines roten Tests).
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as rawBesitz from "../../scripts/besitz-lib.mjs";

// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as rawModulWahl from "../../scripts/modul-wahl-lib.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as rawProjektConfig from "../../scripts/projekt-config-lib.mjs";

const { wirdVerteilt } = rawBesitz as unknown as { wirdVerteilt: (e: { ring: string }) => boolean };
const { gewaehlteModule, modulGewaehlt } = rawModulWahl as unknown as {
  gewaehlteModule: (config: unknown) => string[];
  modulGewaehlt: (e: { modul?: string }, gewaehlt: readonly string[]) => boolean;
};
const { ladeProjektConfig } = rawProjektConfig as unknown as { ladeProjektConfig: (opt: { pruefen: boolean }) => unknown };

export interface BesitzEintragKurz {
  pfad: string;
  ring: string;
  modul?: string;
}

const MANIFEST = fileURLToPath(new URL("../../.factory/besitz.json", import.meta.url));

/** Das echte Besitz-Manifest `.factory/besitz.json` (gemeinsamer Lader der Kern-Tests; der Eintragstyp ist je Konsument enger fassbar). */
export function ladeBesitzManifest<E extends BesitzEintragKurz = BesitzEintragKurz>(): { version: number; eintraege: E[] } {
  return JSON.parse(readFileSync(MANIFEST, "utf8")) as { version: number; eintraege: E[] };
}

/**
 * Eindeutige, sortierte Pfade der verteilten Besitz-Einträge, die `passt` erfüllen und deren Modul gewählt ist. Wirft („Leerlauf-Schutz"), wenn keiner passt.
 * `module` ist die Wahl des Beziehers; ohne Angabe gilt die der Projekt-Config.
 */
export function besitzAnker(passt: (pfad: string) => boolean, eintraege?: BesitzEintragKurz[], module?: readonly string[]): string[] {
  const quelle = eintraege ?? ladeBesitzManifest().eintraege;
  const wahl = module ?? gewaehlteModule(ladeProjektConfig({ pruefen: false }));
  const pfade = [...new Set(quelle.filter((e) => wirdVerteilt(e) && modulGewaehlt(e, wahl)).map((e) => e.pfad))].filter(passt).sort();
  if (pfade.length === 0) {
    throw new Error(`Leerlauf-Schutz: kein verteilter Besitz-Pfad passt zum Prädikat ${String(passt)} (gewählte Module: ${wahl.join(", ") || "keine"}): der Scan hätte keinen Anker`);
  }
  return pfade;
}

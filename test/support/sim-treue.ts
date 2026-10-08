/* Laden und Typen der Treue-Matrizen (docs/sim-treue/<familie>.json, #1461). Nur Einlesen: die Prüfregeln
 * stehen in test/sim/sim-treue.test.ts. Die JSON wird als `unknown` gelesen und erst dort geprüft. */
import { readFileSync, readdirSync } from "node:fs";

export const MATRIX_ORDNER = "docs/sim-treue";

export interface TreueZeile {
  befehl: string; ziel?: string; flag?: string; verhalten: string; ausgabe: string;
  tickets?: number[]; grenzen?: string[]; doku?: string;
}
export interface TreueBefehl { doku: string; dokuZiele?: string[] }
export interface TreueMatrix {
  hinweis: string; stand: string; clusterVersion?: string;
  befehle: Record<string, TreueBefehl>; zeilen: TreueZeile[];
}

/** Familien-Namen aller Matrix-Dateien (= Dateiname ohne `.json`), sortiert. */
export function matrixFamilien(): string[] {
  return readdirSync(MATRIX_ORDNER).filter(f => f.endsWith(".json")).map(f => f.slice(0, -".json".length)).sort();
}

/** Die ungeprüfte Roh-JSON einer Familie (das Schema prüft der Wächter-Test). */
export function ladeRoh(familie: string): unknown {
  return JSON.parse(readFileSync(`${MATRIX_ORDNER}/${familie}.json`, "utf8"));
}

/** Eine Matrix als Typ; der Cast verlässt sich darauf, dass der generische Schema-Test (test/sim/sim-treue.test.ts) sie prüft. */
export function ladeMatrix(familie: string): TreueMatrix {
  return ladeRoh(familie) as TreueMatrix;
}

/* Test-Hilfe für Aufruf-Fehler-Tests der Skripte (#1934): Typ `Zeile`, Runner und Prozessumgebung. Kern und Projekt
 * nutzen denselben Runner (`test/flag-aufrufe.test.ts`, `test/skript-aufrufe-projekt.test.ts`); die Tabellen mit den
 * Skriptnamen liegen in den Tests, hier steht kein Projektwissen. PATH enthält nur den Ordner von node: ohne gh, git und Netz. */
import { expect } from "vitest";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import { escapeRegex } from "../../scripts/ticket-namen.mjs";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
export const maskiere = escapeRegex as (s: string) => string;

export interface Zeile {
  skript: string;
  exit: number;
  /** Erste Zeile von stderr: Rahmen samt Meldung. */
  erste: (meldung: string) => string;
  /** Rest von stderr (Aufrufzeile); leer, wenn der Rahmen einzeilig ist. */
  aufruf: RegExp;
  faelle: { unbekannt: string[]; ohneWert: string[]; doppelt: string[] };
  meldungen: { unbekannt: string; ohneWert: string; doppelt: string };
}

export const STD = { unbekannt: "Unbekanntes Argument: --bogus" };

/** Skripte mit nur booleschen Flags: der Fall „fehlender Wert“ ist ein Wert an einem Schalter (`--x=wert`), ein unbekanntes Argument. */
export const nurSchalter = (skript: string, flag: string, aufrufZeile: string, rahmen: Zeile["erste"] = (m) => m): Zeile => ({
  skript,
  exit: 2,
  erste: rahmen,
  aufruf: new RegExp(`^${maskiere(aufrufZeile)}`, "m"),
  faelle: { unbekannt: ["--bogus"], ohneWert: [`${flag}=x`], doppelt: [flag, flag] },
  meldungen: { unbekannt: STD.unbekannt, ohneWert: `Unbekanntes Argument: ${flag}=x`, doppelt: `${flag} ist doppelt angegeben` },
});

/** Prozessumgebung ohne gh und git: PATH (jede Schreibweise) nur mit dem Ordner von node. */
function umgebung(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(process.env)) if (k.toUpperCase() !== "PATH") env[k] = v;
  env.PATH = dirname(process.execPath);
  return env;
}

/** Startet `scripts/<skript>.mjs` mit absolutem Pfad; `cwd` ist standardmäßig die Repo-Wurzel, der Test hängt nicht vom Aufrufer-cwd ab. */
export function starte(skript: string, argv: string[], cwd: string = ROOT): { status: number | null; stderr: string; stdout: string } {
  const env = umgebung();
  if (skript === "board-takt") env.PROJECT_TOKEN = "x"; // mit Token ruft `main` `mitKontingent` auf: ein vorgezogener Aufruf stünde dann vor dem Fehler
  const r = spawnSync(process.execPath, [join(ROOT, "scripts", `${skript}.mjs`), ...argv], { encoding: "utf8", env, timeout: 60_000, cwd });
  return { status: r.status, stderr: r.stderr, stdout: r.stdout };
}

/** Je Zeile die drei Fälle als Tabelle für `test.each`. */
export function faelleAus(zeilen: Zeile[]) {
  return zeilen.flatMap((z) => (["unbekannt", "ohneWert", "doppelt"] as const).map((fall) => [z.skript, fall, z] as const));
}

/** Prüft einen Fall einer Zeile: Exit-Code, erste stderr-Zeile, Aufrufzeile, leeres stdout. */
export function pruefeFall(z: Zeile, fall: "unbekannt" | "ohneWert" | "doppelt"): void {
  const r = starte(z.skript, z.faelle[fall]);
  expect(r.status).toBe(z.exit);
  const text = r.stderr;
  expect(text.split("\n")[0]).toBe(z.erste(z.meldungen[fall]));
  expect(text).toMatch(z.aufruf);
  expect(r.stdout).toBe(""); // Aufruf-Fehler schreiben nichts auf stdout (sonst lief schon Arbeit vor dem Fehler)
}

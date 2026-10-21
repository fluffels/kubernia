/* Wächter gegen handgeschriebene Flag-Schleifen (#1789) – ohne eigenes check-Skript.
 *
 * @harness-waechter – einziger Durchsetzer seiner Regel, darum im geschützten test/harness/.
 *
 * Jede getrackte Datei unter `scripts/`, die `function parseArgs` oder `parseArgs =` deklariert, muss `flagsLesen(`
 * aus `scripts/flag-lib.mjs` aufrufen, ohne Ausnahme. Der Import `parseArgs` aus `node:util` ist keine Deklaration.
 *
 * Bewusste Grenzen: eine Schleife unter anderem Namen als `parseArgs` fängt der Wächter nicht; `flagsLesen(` zählt als
 * Textvorkommen (auch ein Kommentar neben einer weiter handgeschriebenen Schleife macht die Datei grün); der Scan sieht
 * nur getrackte Dateien (in der CI sind neue Dateien committet).
 */
import { describe, test } from "vitest";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export interface Datei {
  pfad: string;
  text: string;
}

const DEKLARATION = /\bfunction\s+parseArgs\b|\bparseArgs\s*=(?!=)/;
const AUFRUF = /\bflagsLesen\(/;
const FIX_LIB = "Fix: Flags über `flagsLesen` aus `scripts/flag-lib.mjs` lesen (Skript-Konvention, docs/agent-harness.md), keine eigene Schleife.";

/** Probleme: Deklaration von `parseArgs` ohne `flagsLesen(`. Pur. */
export function flagParserProbleme(dateien: Datei[]): string[] {
  return dateien
    .filter((d) => DEKLARATION.test(d.text) && !AUFRUF.test(d.text))
    .map((d) => `${d.pfad}: deklariert parseArgs, ohne flagsLesen( aufzurufen. ${FIX_LIB}`);
}

const WURZEL = fileURLToPath(new URL("../..", import.meta.url));
const git = (args: string[]): string => execFileSync("git", args, { cwd: WURZEL, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });

describe("Flag-Parser-Wächter", () => {
  test("Fixtures: eigene Schleife ist rot, mit flagsLesen und der bloße Import sind grün", () => {
    const f = (text: string): Datei[] => [{ pfad: "scripts/x.mjs", text }];
    assert.equal(flagParserProbleme(f("function parseArgs(argv) { return argv; }")).length, 1);
    assert.equal(flagParserProbleme(f("export const parseArgs = (a) => a;")).length, 1);
    assert.deepEqual(flagParserProbleme(f("function parseArgs(a) { return flagsLesen(a, {}); }")), []);
    assert.deepEqual(flagParserProbleme(f('import { parseArgs } from "node:util";\nparseArgs({});')), []);
    assert.deepEqual(flagParserProbleme(f("if (parseArgs === 1) {}")), []);
    assert.match(flagParserProbleme(f("function parseArgs() {}"))[0] ?? "", /Fix: Flags über `flagsLesen`/);
  });

  test("echter Scan: jedes Skript mit parseArgs ruft flagsLesen( auf, ohne Ausnahme", () => {
    const pfade = git(["ls-files", "scripts"]).split("\n").filter((p) => /\.(?:mjs|cjs|js)$/.test(p));
    const dateien = pfade.map((pfad) => ({ pfad, text: readFileSync(new URL(`../../${pfad}`, import.meta.url), "utf8") }));
    assert.deepEqual(flagParserProbleme(dateien), []);
  });
});

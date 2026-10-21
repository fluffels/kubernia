/* Wächter gegen handgeschriebene Flag-Schleifen (#1789) – ohne eigenes check-Skript.
 *
 * @harness-waechter – einziger Durchsetzer seiner Regel, darum im geschützten test/harness/.
 *
 * Jede getrackte Datei unter `scripts/`, die `function parseArgs` oder `parseArgs =` deklariert, muss `flagsLesen(`
 * aus `scripts/flag-lib.mjs` aufrufen, ohne Ausnahme. Der Import `parseArgs` aus `node:util` ist keine Deklaration.
 *
 * Zweite Regel (#1817): `argv[++i]`, `argv[i + 1]` (auch `args`, Index genau `i`) ist als Flag-Leser verboten, ausgenommen die
 * Shell-Parser `worktree-guard-*` und `stdin-skript-guard`. Grenzen: andere Bezeichner oder Indexnamen, `indexOf` und
 * Kommentare mit dem Muster werden nicht unterschieden (Kommentar zählt als Treffer), nur getrackte Dateien.
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

const FLAG_INDEX = /\b(?:argv|args)\s*\[\s*(?:\+\+\s*i|i\s*\+\s*1)\s*\]/;
/** Shell-Parser (Hook-Eingabe), kein Flag-Leser der Kommandozeile: Ausnahme nach Basisname. */
const INDEX_AUSNAHME = /(?:^|\/)(?:worktree-guard-[^/]*|stdin-skript-guard)\.(?:mjs|cjs|js)$/;

/** Probleme: Flag-Wert per Index (`argv[++i]`, `argv[i + 1]`, auch `args`), zeilenweise, ohne die Ausnahmen. Pur. */
export function flagIndexProbleme(dateien: Datei[]): string[] {
  const probleme: string[] = [];
  for (const d of dateien) {
    if (INDEX_AUSNAHME.test(d.pfad)) continue;
    d.text.split("\n").forEach((zeile, i) => {
      if (FLAG_INDEX.test(zeile)) probleme.push(`${d.pfad}:${i + 1}: liest einen Flag-Wert per Index. ${FIX_LIB}`);
    });
  }
  return probleme;
}

/** Probleme: Deklaration von `parseArgs` ohne `flagsLesen(`. Pur. */
export function flagParserProbleme(dateien: Datei[]): string[] {
  return dateien
    .filter((d) => DEKLARATION.test(d.text) && !AUFRUF.test(d.text))
    .map((d) => `${d.pfad}: deklariert parseArgs, ohne flagsLesen( aufzurufen. ${FIX_LIB}`);
}

const WURZEL = fileURLToPath(new URL("../..", import.meta.url));
const git = (args: string[]): string => execFileSync("git", args, { cwd: WURZEL, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });

function alleSkripte(): Datei[] {
  const pfade = git(["ls-files", "scripts"]).split("\n").filter((p) => /\.(?:mjs|cjs|js)$/.test(p));
  return pfade.map((pfad) => ({ pfad, text: readFileSync(new URL(`../../${pfad}`, import.meta.url), "utf8") }));
}

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

  test("Fixtures Index-Regel: argv[++i] und argv[i + 1] sind rot, andere Zugriffe und die Shell-Parser grün", () => {
    const f = (text: string, pfad = "scripts/x.mjs"): Datei[] => [{ pfad, text }];
    for (const rot of ["argv[++i]", "argv[i + 1]", "argv[i+1]", "process.argv[i + 1]", "args[ ++i ]"]) {
      const p = flagIndexProbleme(f(`a\nconst v = ${rot};`));
      assert.equal(p.length, 1, rot);
      assert.match(p[0] ?? "", /^scripts\/x\.mjs:2: /);
      assert.match(p[0] ?? "", /Fix: Flags über `flagsLesen`/);
    }
    for (const gruen of ["argv[i]", "process.argv[1]", "argv[i - 1]", "argv[i + 10]", "xargv[i + 1]"]) {
      assert.deepEqual(flagIndexProbleme(f(`const v = ${gruen};`)), [], gruen);
    }
    for (const ausgenommen of ["scripts/worktree-guard-eval.mjs", "scripts/worktree-guard-neu.mjs", "scripts/stdin-skript-guard.mjs"]) {
      assert.deepEqual(flagIndexProbleme(f("argv[++i]", ausgenommen)), [], ausgenommen);
    }
    assert.equal(flagIndexProbleme(f("argv[++i]", "scripts/x-worktree-guard-y.mjs")).length, 1);
  });

  test("echter Scan: kein Skript liest einen Flag-Wert per Index", () => {
    assert.deepEqual(flagIndexProbleme(alleSkripte()), []);
  });

  test("echter Scan: jedes Skript mit parseArgs ruft flagsLesen( auf, ohne Ausnahme", () => {
    assert.deepEqual(flagParserProbleme(alleSkripte()), []);
  });
});

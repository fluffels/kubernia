/* Wächter gegen handgeschriebene Flag-Schleifen (#1789) – ohne eigenes check-Skript.
 *
 * @harness-waechter – einziger Durchsetzer seiner Regel, darum im geschützten test/harness/.
 *
 * Jede getrackte Datei unter `scripts/`, die `function parseArgs` oder `parseArgs =` deklariert, muss `flagsLesen(`
 * aus `scripts/flag-lib.mjs` aufrufen, ohne Ausnahme. Der Import `parseArgs` aus `node:util` ist keine Deklaration.
 *
 * Zweite Regel (#1817, #1821): Handleser sind als Flag-Leser verboten, ausgenommen die Shell-Parser `worktree-guard-*` und
 * `stdin-skript-guard`: (a) Index `argv[++x]`/`argv[x + 1]` mit beliebigem Bezeichner (auch `args`), (b)
 * `argv.includes("--…")`/`argv.indexOf("--…")` (auch `process.argv`, auch mit `'`). Grenzen: andere Array-Namen (`rest`,
 * `process.argv.slice(2)`), `.find`/`.some`, Destrukturierung, Template-Literale als Argument und Kommentare mit dem Muster
 * (ein Kommentar zählt als Treffer) werden nicht unterschieden; nur getrackte Dateien.
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

/** Geschlossene Musterliste der Handleser; jede Art mit eigener Meldung. */
const HANDLESER: { muster: RegExp; art: string }[] = [
  { muster: /\b(?:argv|args)\s*\[\s*(?:\+\+\s*[A-Za-z_$][\w$]*|[A-Za-z_$][\w$]*\s*\+\s*1)\s*\]/, art: "liest einen Flag-Wert per Index" },
  { muster: /\b(?:argv|args)\s*\.\s*(?:includes|indexOf)\s*\(\s*["']--/, art: "liest ein Flag per includes/indexOf" },
];
/** Shell-Parser (Hook-Eingabe), kein Flag-Leser der Kommandozeile: Ausnahme nach Basisname. */
const INDEX_AUSNAHME = /(?:^|\/)(?:worktree-guard-[^/]*|stdin-skript-guard)\.(?:mjs|cjs|js)$/;

/** Probleme: Flag-Handleser (Index `argv[++x]`/`argv[x + 1]`, `argv.includes("--…")`/`indexOf`, auch `args`), zeilenweise, ohne die Ausnahmen. Pur. */
export function flagHandleserProbleme(dateien: Datei[]): string[] {
  const probleme: string[] = [];
  for (const d of dateien) {
    if (INDEX_AUSNAHME.test(d.pfad)) continue;
    d.text.split("\n").forEach((zeile, i) => {
      for (const { muster, art } of HANDLESER) {
        if (muster.test(zeile)) probleme.push(`${d.pfad}:${i + 1}: ${art}. ${FIX_LIB}`);
      }
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

  test("Fixtures Handleser-Regel: Index (beliebiger Bezeichner) und includes/indexOf sind rot, andere Zugriffe und die Shell-Parser grün", () => {
    const f = (text: string, pfad = "scripts/x.mjs"): Datei[] => [{ pfad, text }];
    const rote = [
      "argv[++i]", "argv[i + 1]", "argv[i+1]", "process.argv[i + 1]", "args[ ++i ]",
      "argv[addIndex + 1]", "args[ci + 1]", "argv[++idx]", "argv.includes(\"--dry-run\")", "process.argv.includes('--fix')",
      "args.indexOf(\"--config\")", "process.argv.indexOf( \"--port\" )",
    ];
    for (const rot of rote) {
      const p = flagHandleserProbleme(f(`a\nconst v = ${rot};`));
      assert.equal(p.length, 1, rot);
      assert.match(p[0] ?? "", /^scripts\/x\.mjs:2: /);
      assert.match(p[0] ?? "", /Fix: Flags über `flagsLesen`/);
    }
    for (const gruen of [
      "argv[i]", "process.argv[1]", "argv[i - 1]", "argv[i + 10]", "xargv[i + 1]", "argv[0 + 1]",
      "argv.includes(name)", "argv.includes(\"x\")", "xargv.includes(\"--a\")", "argv.indexOf(\"-v\")", "liste.includes(\"--a\")",
    ]) {
      assert.deepEqual(flagHandleserProbleme(f(`const v = ${gruen};`)), [], gruen);
    }
    for (const ausgenommen of ["scripts/worktree-guard-eval.mjs", "scripts/worktree-guard-neu.mjs", "scripts/stdin-skript-guard.mjs"]) {
      assert.deepEqual(flagHandleserProbleme(f("argv[++i]", ausgenommen)), [], ausgenommen);
      assert.deepEqual(flagHandleserProbleme(f("argv.includes(\"--x\")", ausgenommen)), [], ausgenommen);
    }
    assert.equal(flagHandleserProbleme(f("argv[++i]", "scripts/x-worktree-guard-y.mjs")).length, 1);
  });

  test("echter Scan: kein Skript liest ein Flag per Handleser", () => {
    assert.deepEqual(flagHandleserProbleme(alleSkripte()), []);
  });

  test("echter Scan: jedes Skript mit parseArgs ruft flagsLesen( auf, ohne Ausnahme", () => {
    assert.deepEqual(flagParserProbleme(alleSkripte()), []);
  });
});

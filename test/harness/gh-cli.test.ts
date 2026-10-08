/* Wrapper-Wächter (#1428 Z32): alle gh-Aufrufe der Skripte laufen über scripts/gh-cli.mjs.
 *
 * @harness-waechter – einziger Durchsetzer seiner Regel, darum im geschützten test/harness/ (#1165).
 *
 * Bewusste Grenzen: erkannt werden nur literale `execFileSync|execFile|spawnSync|spawn("gh"`; nicht `execSync("gh …")`, kein Template-Literal
 * und keine Variable als Kommando. */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

const DIREKT = /\b(?:execFileSync|execFile|spawnSync|spawn)\(\s*["']gh["']/;

/** Dateien (relativ) mit einem direkten gh-Prozessaufruf. Pur. */
function direkteGhAufrufe(dateien: Record<string, string>): string[] {
  return Object.entries(dateien)
    .filter(([name, text]) => name !== "scripts/gh-cli.mjs" && DIREKT.test(text))
    .map(([name]) => name);
}

function scriptDateien(): Record<string, string> {
  const aus: Record<string, string> = {};
  const geh = (rel: string) => {
    for (const e of readdirSync(join(process.cwd(), rel), { withFileTypes: true })) {
      const p = `${rel}/${e.name}`;
      if (e.isDirectory()) geh(p);
      else if (e.name.endsWith(".mjs")) aus[p] = readFileSync(join(process.cwd(), p), "utf8");
    }
  };
  geh("scripts");
  return aus;
}

describe("gh-Wrapper (#1428 Z32)", () => {
  test("kein Skript ruft gh direkt auf (außer scripts/gh-cli.mjs)", () => {
    expect(direkteGhAufrufe(scriptDateien())).toEqual([]);
  });
  test("Negativ: ein direkter Aufruf wird gefunden, der Wrapper selbst nicht", () => {
    expect(direkteGhAufrufe({ "scripts/x.mjs": `execFileSync("gh", args)`, "scripts/gh-cli.mjs": `execFileSync("gh", a)` })).toEqual(["scripts/x.mjs"]);
    expect(direkteGhAufrufe({ "scripts/y.mjs": `spawnSync( 'gh', ["x"])` })).toEqual(["scripts/y.mjs"]);
    expect(direkteGhAufrufe({ "scripts/z.mjs": `ghText(["x"])` })).toEqual([]);
  });
  test("Wrapper: der Wrapper-Quelltext trägt Puffer, windowsHide und GH_TOKEN", () => {
    const q = readFileSync(join(process.cwd(), "scripts/gh-cli.mjs"), "utf8");
    expect(q).toMatch(/windowsHide: true/);
    expect(q).toMatch(/GH_TOKEN/);
  });
});

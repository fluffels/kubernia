/* Gate-Wächter für `vitest/no-conditional-expect` (#1342, Z3).
 *
 * @harness-waechter – einziger Durchsetzer der Lint-Konfiguration dieser Regel, darum im geschützten test/harness/ (#1156).
 *
 * Ein `expect` im `if`/`catch`/`?:`-Zweig wird nie rot, wenn der Zweig nie läuft: der Test ist dann ein falsches Grün.
 * Die Regel steht in `eslint.config.js` als EIN eigener Block für `test/**` und gilt ohne Baseline (kein Eintrag in
 * `eslint-suppressions.json`). Der Test bindet die Konfiguration und beweist per `Linter`, dass die Regel wirklich greift.
 */
import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { Linter } from "eslint";
// @ts-expect-error – kein .d.ts für die Flat-Config
import eslintConfig from "../../eslint.config.js";

const REGEL = "vitest/no-conditional-expect";
type Block = { files?: string[]; plugins?: Record<string, unknown>; rules?: Record<string, unknown> };
const bloecke = (eslintConfig as Block[]).filter((b) => b.rules && REGEL in b.rules);

describe("vitest/no-conditional-expect ist ein Gate (#1342)", () => {
  test("genau ein Block setzt die Regel als Fehler, für test/**/*.ts, mit dem Plugin", () => {
    expect(bloecke).toHaveLength(1);
    expect(bloecke[0].rules?.[REGEL]).toBe("error");
    expect(bloecke[0].files).toEqual(["test/**/*.ts"]);
    expect(Object.keys(bloecke[0].plugins ?? {})).toEqual(["vitest"]);
  });

  test("keine Baseline: eslint-suppressions.json kennt die Regel nicht", () => {
    const text = readFileSync(new URL("../../eslint-suppressions.json", import.meta.url), "utf8");
    expect(text).not.toContain("no-conditional-expect");
  });

  const pruefe = (code: string) => {
    const linter = new Linter({ configType: "flat" });
    const config = [{ files: bloecke[0].files, plugins: bloecke[0].plugins, rules: { [REGEL]: "error" } }];
    return linter.verify(code, config as never, { filename: "test/probe.test.ts" }).filter((m) => m.ruleId === REGEL);
  };

  test("Verhaltensprobe: bedingtes expect schlägt an, unbedingtes nicht", () => {
    expect(pruefe('import { expect, test } from "vitest";\ntest("a", () => { const r = {}; if (r.error) expect(r.error).toBe("x"); });')).toHaveLength(1);
    expect(pruefe('import { expect, test } from "vitest";\ntest("a", () => { try { f(); } catch (e) { expect(e).toBeDefined(); } });')).toHaveLength(1);
    expect(pruefe('import { expect, test } from "vitest";\ntest("a", () => { expect(1).toBe(1); });')).toHaveLength(0);
  });
});

/* Regex-Wächter (#1888): `regexp/no-empty-alternative` ist in der echten ESLint-Config aktiv.
 * Gegenprobe über die ESLint-API gegen die Repo-Config: `/a|/` rot, `/a|b/` und `(?:a)?` grün.
 */
import assert from "node:assert/strict";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ESLint } from "eslint";
import { describe, test } from "vitest";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const regeln = async (code: string, datei: string): Promise<string[]> => {
  const eslint = new ESLint({ cwd: ROOT });
  const [r] = await eslint.lintText(code, { filePath: resolve(ROOT, datei) });
  return r.messages.map((m) => m.ruleId ?? "");
};

describe("regexp/no-empty-alternative (#1888)", () => {
  test("leere Alternative ist rot (JS und TS)", async () => {
    assert.ok((await regeln("export const r = /a|/;\n", "scripts/zz-probe.mjs")).includes("regexp/no-empty-alternative"));
    assert.ok((await regeln("export const r = /(a|)b/;\n", "scripts/zz-probe.mjs")).includes("regexp/no-empty-alternative"));
    assert.ok((await regeln("export const r = /a|/;\n", "test/eslint-regexp.test.ts")).includes("regexp/no-empty-alternative"));
  });

  test("gültige Alternativen und optionale Gruppen sind grün", async () => {
    assert.deepEqual(await regeln("export const r = /a|b/;\n", "scripts/zz-probe.mjs"), []);
    assert.deepEqual(await regeln("export const r = /(?:a)?b/;\n", "scripts/zz-probe.mjs"), []);
  });
});

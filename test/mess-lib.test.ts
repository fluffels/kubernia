/* Gemeinsamer Messhelfer (#1561 Z1): Median und Cache-TTL-Schwellen stehen einmal in scripts/mess-lib.mjs. */
import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as raw from "../scripts/mess-lib.mjs";

const M = raw as unknown as { median: (w: number[]) => number | null; CACHE_TTL_MS: { fuenfMin: number; eineStunde: number } };

describe("median", () => {
  test("ungerade, gerade, leer, nicht endliche Werte ignoriert", () => {
    expect(M.median([3, 1, 2])).toBe(2);
    expect(M.median([4, 1, 2, 3])).toBe(2.5);
    expect(M.median([])).toBeNull();
    expect(M.median([Number.NaN, 5])).toBe(5);
    expect(M.median([Number.NaN, Infinity])).toBeNull();
  });
});

describe("CACHE_TTL_MS", () => {
  test("Schwellen 5 min und 1 h, eingefroren", () => {
    expect(M.CACHE_TTL_MS).toEqual({ fuenfMin: 300_000, eineStunde: 3_600_000 });
    expect(Object.isFrozen(M.CACHE_TTL_MS)).toBe(true);
  });
});

describe("keine lokalen Kopien in den Mess-Skripten", () => {
  test.each(["token-baseline", "subagent-laufzeit", "hauptchat-zerlegung"])("%s importiert aus mess-lib.mjs und definiert kein eigenes median", (name) => {
    const src = readFileSync(new URL(`../scripts/${name}.mjs`, import.meta.url), "utf8");
    expect(src).toMatch(/from "\.\/mess-lib\.mjs"/);
    expect(src).not.toMatch(/(function median|const median\w* =|\d \* 60_000)/);
  });
});

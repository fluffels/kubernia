/* zerlegeRepo / repoName / repoOwner (#1821 L13/L20): eine Zerlegung von `repo`, kaputte Form wirft mit Fix-Zeile. */
import { describe, test } from "vitest";
import assert from "node:assert/strict";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as raw from "../scripts/projekt-config-lib.mjs";

interface Lib {
  zerlegeRepo(repo: unknown): { owner: string; name: string };
  repoName(config: unknown): string;
  repoOwner(config: unknown): string;
}
const lib = raw as unknown as Lib;

describe("zerlegeRepo", () => {
  test("owner/name wird zerlegt", () => {
    assert.deepEqual(lib.zerlegeRepo("a/b"), { owner: "a", name: "b" });
  });
  for (const kaputt of ["x", "a/b/c", "", "/b", "a/", "a /b", 5, undefined]) {
    test(`wirft mit Fix-Zeile bei ${JSON.stringify(kaputt)}`, () => {
      assert.throws(() => lib.zerlegeRepo(kaputt), /owner\/name[\s\S]*Fix:/);
    });
  }
});

describe("repoName / repoOwner", () => {
  test("liefern Namens- und Besitzerteil", () => {
    assert.equal(lib.repoName({ repo: "o/n" }), "n");
    assert.equal(lib.repoOwner({ repo: "o/n" }), "o");
  });
  test("werfen ohne gültiges repo", () => {
    assert.throws(() => lib.repoOwner({ repo: "x" }), /Fix:/);
    assert.throws(() => lib.repoName({}), /Fix:/);
    assert.throws(() => lib.repoOwner(undefined), /Fix:/);
  });
});

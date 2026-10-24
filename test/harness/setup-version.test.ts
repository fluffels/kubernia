/* @harness-waechter
 * Node-Mindestversion von `npm run setup` (#1906): das Minimum kommt aus `engines.node` (package.json), nicht nur der Major aus
 * der .nvmrc; ist engines.node nicht lesbar, gilt der .nvmrc-Major. Reines Node-Tooling ohne Declaration-File. */
import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as roh from "../../scripts/setup.mjs";

type V = { major: number; minor: number; patch: number };
const { mindestVersion, erfuellt } = roh as unknown as {
  mindestVersion: (pkg: string, nvmrc: string) => V | null;
  erfuellt: (haben: string, min: V | null) => boolean;
};
const pkg = (node: string) => JSON.stringify({ engines: { node } });

describe("mindestVersion", () => {
  test("liest das volle Minimum aus engines.node", () => {
    expect(mindestVersion(pkg(">=22.23.4"), "20\n")).toEqual({ major: 22, minor: 23, patch: 4 });
  });
  test("unparsebares engines.node, fehlendes Feld oder kaputtes JSON: Major aus .nvmrc", () => {
    expect(mindestVersion(pkg("lts/*"), "22.23.4\n")).toEqual({ major: 22, minor: 0, patch: 0 });
    expect(mindestVersion("{}", "v21")).toEqual({ major: 21, minor: 0, patch: 0 });
    expect(mindestVersion("kein json", "22")).toEqual({ major: 22, minor: 0, patch: 0 });
  });
  test("beides unlesbar: null", () => {
    expect(mindestVersion("{}", "")).toBeNull();
  });
  test("das echte Repo: engines.node und .nvmrc stimmen im Major überein und das Minimum ist lesbar", () => {
    const min = mindestVersion(readFileSync("package.json", "utf8"), readFileSync(".nvmrc", "utf8"));
    expect(min).not.toBeNull();
    expect(min?.major).toBe(parseInt(readFileSync(".nvmrc", "utf8"), 10));
  });
});

describe("erfuellt", () => {
  const min = { major: 22, minor: 23, patch: 4 };
  test("22.22.9 ist zu alt (gleicher Major, kleineres Minor)", () => {
    expect(erfuellt("22.22.9", min)).toBe(false);
  });
  test("22.23.3 ist zu alt (Patch)", () => {
    expect(erfuellt("22.23.3", min)).toBe(false);
  });
  test("22.23.4 und 22.23.5 erfüllen das Minimum", () => {
    expect(erfuellt("22.23.4", min)).toBe(true);
    expect(erfuellt("22.23.5", min)).toBe(true);
  });
  test("höherer Major genügt, auch mit kleinerem Minor/Patch (23.0.0)", () => {
    expect(erfuellt("23.0.0", min)).toBe(true);
  });
  test("niedrigerer Major (21.99.99) scheitert", () => {
    expect(erfuellt("21.99.99", min)).toBe(false);
  });
  test("unlesbare Version oder fehlendes Minimum: nicht erfüllt", () => {
    expect(erfuellt("abc", min)).toBe(false);
    expect(erfuellt("22.23.4", null)).toBe(false);
  });
});

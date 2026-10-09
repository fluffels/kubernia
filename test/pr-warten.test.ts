/* PR-Warten (#1559): Kern pur, kein gh-Aufruf, kein echter Schlaf. */
import { describe, expect, test } from "vitest";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as raw from "../scripts/pr-warten.mjs";

type Erg = { exit: number; zeilen: string[] };
const P = raw as unknown as {
  bewerte: (pr: object) => Erg;
  warten: (e: { hole: () => object; schlafe: (ms: number) => void; jetzt: () => number; maxMs: number; intervallMs: number }) => Erg;
  parseArgs: (a: string[]) => { pr: string | null; maxSekunden: number; intervall: number };
};

const lauf = (name: string, status: string, conclusion: string | null = null, url = `https://x/runs/${name}`) => ({ __typename: "CheckRun", name, status, conclusion, detailsUrl: url });
const ctx = (context: string, state: string) => ({ __typename: "StatusContext", context, state, targetUrl: "https://y" });
const offen = (rollup: object[], extra: object = {}) => ({ state: "OPEN", mergeable: "MERGEABLE", autoMergeRequest: { mergeMethod: "SQUASH" }, statusCheckRollup: rollup, ...extra });

describe("bewerte", () => {
  test("MERGED → Exit 0 mit kurzem SHA", () => {
    expect(P.bewerte({ state: "MERGED", mergeCommit: { oid: "abcdef1234567" }, statusCheckRollup: [] })).toEqual({ exit: 0, zeilen: ["MERGED abcdef1"] });
  });
  test.each(["FAILURE", "CANCELLED", "TIMED_OUT"])("roter CheckRun (%s) → Exit 1, eine Zeile je rotem Check", (c) => {
    const r = P.bewerte(offen([lauf("a", "COMPLETED", "SUCCESS"), lauf("b", "COMPLETED", c), lauf("c", "COMPLETED", "FAILURE")]));
    expect(r.exit).toBe(1);
    expect(r.zeilen).toEqual(["ROT b https://x/runs/b", "ROT c https://x/runs/c"]);
  });
  test.each(["FAILURE", "ERROR"])("roter StatusContext (%s) → Exit 1", (s) => {
    expect(P.bewerte(offen([ctx("ci", s)])).exit).toBe(1);
  });
  test("Negativ: SKIPPED und NEUTRAL sind nicht rot", () => {
    const r = P.bewerte(offen([lauf("a", "COMPLETED", "SKIPPED"), lauf("b", "COMPLETED", "NEUTRAL"), lauf("c", "COMPLETED", "SUCCESS")]));
    expect(r.exit).toBe(2);
    expect(r.zeilen[0]).toBe("OFFEN 3/3 grün, Merge steht aus");
  });
  test("wartende Checks → Exit 2 mit Namen und x/y", () => {
    const r = P.bewerte(offen([lauf("a", "COMPLETED", "SUCCESS"), lauf("b", "IN_PROGRESS"), ctx("ci", "PENDING")]));
    expect(r).toEqual({ exit: 2, zeilen: ["OFFEN 1/3 grün, wartend: b, ci"] });
  });
  test("Rot hat Vorrang vor wartenden Checks", () => {
    expect(P.bewerte(offen([lauf("a", "IN_PROGRESS"), lauf("b", "COMPLETED", "FAILURE")])).exit).toBe(1);
  });
  test("CONFLICTING → Exit 3, CLOSED → Exit 3", () => {
    expect(P.bewerte(offen([lauf("a", "COMPLETED", "SUCCESS")], { mergeable: "CONFLICTING" }))).toEqual({ exit: 3, zeilen: ["KONFLIKT"] });
    expect(P.bewerte({ state: "CLOSED", statusCheckRollup: [] })).toEqual({ exit: 3, zeilen: ["GESCHLOSSEN"] });
  });
  test("grün ohne Auto-Merge → Exit 3, leerer Rollup ist nicht grün", () => {
    expect(P.bewerte(offen([lauf("a", "COMPLETED", "SUCCESS")], { autoMergeRequest: null }))).toEqual({ exit: 3, zeilen: ["GRÜN OHNE AUTO-MERGE"] });
    expect(P.bewerte(offen([], { autoMergeRequest: null })).exit).toBe(2);
  });
});

describe("warten", () => {
  const uhr = () => {
    let t = 0;
    return { jetzt: () => t, schlafe: (ms: number) => void (t += ms) };
  };
  test("endet beim ersten Ergebnis ≠ Exit 2, schläft zwischen den Abfragen", () => {
    const u = uhr();
    const folge = [offen([lauf("a", "IN_PROGRESS")]), offen([lauf("a", "COMPLETED", "FAILURE")])];
    let i = 0;
    const r = P.warten({ hole: () => folge[i++], ...u, maxMs: 240_000, intervallMs: 30_000 });
    expect(r.exit).toBe(1);
    expect(u.jetzt()).toBe(30_000);
  });
  test("Zeitbudget abgelaufen → Exit 2 mit letzter Zeile, kein Schlaf über das Budget hinaus", () => {
    const u = uhr();
    const r = P.warten({ hole: () => offen([lauf("a", "IN_PROGRESS")]), ...u, maxMs: 90_000, intervallMs: 30_000 });
    expect(r.exit).toBe(2);
    expect(u.jetzt()).toBeLessThanOrEqual(90_000);
  });
  test("ein gh-Fehler wird überbrückt, drei in Folge → Exit 3", () => {
    const u = uhr();
    let n = 0;
    const ok = P.warten({
      hole: () => {
        if (n++ === 0) throw new Error("API down");
        return { state: "MERGED", mergeCommit: { oid: "abc1234" }, statusCheckRollup: [] };
      },
      ...u,
      maxMs: 240_000,
      intervallMs: 30_000,
    });
    expect(ok.exit).toBe(0);
    const u2 = uhr();
    const aus = P.warten({
      hole: () => {
        throw new Error("API down\nzweite Zeile");
      },
      ...u2,
      maxMs: 240_000,
      intervallMs: 30_000,
    });
    expect(aus).toEqual({ exit: 3, zeilen: ["GH-FEHLER API down"] });
  });
});

describe("parseArgs", () => {
  test("PR-Nummer und Optionen, Standardwerte", () => {
    expect(P.parseArgs(["12"])).toEqual({ pr: "12", maxSekunden: 240, intervall: 30 });
    expect(P.parseArgs(["--max-sekunden", "60", "--intervall", "10", "7"])).toEqual({ pr: "7", maxSekunden: 60, intervall: 10 });
  });
});

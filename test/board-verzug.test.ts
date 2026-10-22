/* Frische offene Issues per GraphQL (#1866): `normalisiereFrischeIssues` (Formtest) und `frischeOffeneIssues` (Abfrage mit injiziertem `gh`).
 * Technik wie test/board.test.ts: Import des .mjs-Tooling-Skripts über `unknown`. */
import { describe, expect, test } from "vitest";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as raw from "../scripts/board-lib.mjs";

type Frisch = { number: number; titel: string; projektIds: string[] };
const B = raw as unknown as {
  normalisiereFrischeIssues: (a: unknown) => Frisch[];
  frischeOffeneIssues: (a?: { repo?: string; label?: string | null; anzahl?: number }, opts?: unknown, run?: (args: string[], opts: unknown) => string) => Frisch[];
};
const antwort = (nodes: unknown) => ({ data: { repository: { issues: { nodes } } } });

describe("normalisiereFrischeIssues", () => {
  test("Nummer, Titel und die Projekt-IDs der Board-Items", () => {
    const r = B.normalisiereFrischeIssues(
      antwort([
        { number: 7, title: "A", projectItems: { nodes: [{ project: { id: "P1" } }, { project: { id: "P2" } }] } },
        { number: 8, title: "B", projectItems: { nodes: [] } },
      ]),
    );
    expect(r).toEqual([
      { number: 7, titel: "A", projektIds: ["P1", "P2"] },
      { number: 8, titel: "B", projektIds: [] },
    ]);
  });
  test("ein Item ohne project.id zählt nicht (kein erfundenes Board)", () => {
    expect(B.normalisiereFrischeIssues(antwort([{ number: 1, title: "A", projectItems: { nodes: [{ project: null }, {}] } }]))[0].projektIds).toEqual([]);
  });
  test("leere Liste ist gültig", () => {
    expect(B.normalisiereFrischeIssues(antwort([]))).toEqual([]);
  });
  test.each([
    ["ohne repository", {}],
    ["nodes keine Liste", antwort("x")],
    ["Nummer fehlt", antwort([{ title: "A", projectItems: { nodes: [] } }])],
    ["Titel keine Zeichenkette", antwort([{ number: 1, title: 5, projectItems: { nodes: [] } }])],
    ["projectItems fehlt", antwort([{ number: 1, title: "A" }])],
  ])("unerwartete Form wirft: %s", (_n, a) => {
    expect(() => B.normalisiereFrischeIssues(a)).toThrow(/Unerwartete/);
  });
});

describe("frischeOffeneIssues", () => {
  const ok = (a: unknown) => () => JSON.stringify(a);
  test("die Abfrage: offene Issues, neueste zuerst, Anzahl und Label gebunden, Owner und Name als Variablen", () => {
    let args: string[] = [];
    const r = B.frischeOffeneIssues({ repo: "o/n", label: "area:harness", anzahl: 50 }, {}, (a) => ((args = a), JSON.stringify(antwort([]))));
    expect(r).toEqual([]);
    const q = args.find((x) => x.startsWith("query=")) ?? "";
    expect(q).toContain("states:OPEN");
    expect(q).toContain("first:50");
    expect(q).toContain("direction:DESC");
    expect(q).toContain("projectItems");
    expect(args).toEqual(expect.arrayContaining(["o=o", "n=n", "l[]=area:harness"]));
  });
  test("ohne Label keine Label-Variable", () => {
    let args: string[] = [];
    B.frischeOffeneIssues({ repo: "o/n", anzahl: 5 }, {}, (a) => ((args = a), JSON.stringify(antwort([]))));
    expect(args.some((x) => x.startsWith("l[]="))).toBe(false);
    expect(args.find((x) => x.startsWith("query="))).toContain("first:5,");
  });
  test("Fehler des gh-Aufrufs, kaputtes JSON und falsche Form werfen", () => {
    expect(() => B.frischeOffeneIssues({ repo: "o/n" }, {}, () => { throw new Error("Rate-Limit"); })).toThrow("Rate-Limit");
    expect(() => B.frischeOffeneIssues({ repo: "o/n" }, {}, () => "kein json")).toThrow();
    expect(() => B.frischeOffeneIssues({ repo: "o/n" }, {}, ok({ data: {} }))).toThrow(/Unerwartete/);
  });
  test("ungültige Anzahl, Label oder Repo werfen vor dem Aufruf", () => {
    const nie = () => { throw new Error("darf nicht laufen"); };
    for (const anzahl of [0, 101, 1.5]) expect(() => B.frischeOffeneIssues({ repo: "o/n", anzahl }, {}, nie)).toThrow(/anzahl/);
    expect(() => B.frischeOffeneIssues({ repo: "o/n", label: 5 as unknown as string }, {}, nie)).toThrow(/label/);
    expect(() => B.frischeOffeneIssues({ repo: "kaputt" }, {}, nie)).toThrow(/owner\/name/);
  });
});

/* Board-Helfer (#1217): Einsortieren mehrerer Tickets mit einer Listenabfrage als getestete Funktion.
 *
 * Reines Node-Tooling-Skript ohne Declaration-File: Namespace einmal über `unknown` auf ein lokales
 * Interface gebracht (gleiche Technik wie test/internalrefs.test.ts, kommt ohne no-unsafe-Suppressions aus). */
import { describe, expect, test } from "vitest";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as rawLib from "../scripts/board-lib.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as rawPlace from "../scripts/board-place.mjs";

type Item = { id: string; number: number };
type Lib = {
  planPlacements: (
    items: Item[],
    numbers: number[],
    after?: number | null,
  ) => { steps: { item: Item; afterId: string | null }[]; missing: number[]; anchorMissing: boolean };
  isRateLimit: (m: string) => boolean;
};
type Place = { parseArgs: (argv: string[]) => { anchor: number | null; numbers: number[]; dry: boolean } | null };
const L = rawLib as unknown as Lib;
const P = rawPlace as unknown as Place;

const item = (n: number): Item => ({ id: `I${n}`, number: n });
const board = [item(10), item(11), item(12)];

describe("Einsortieren mehrerer Tickets (#1217)", () => {
  test("an die Spitze: Reihenfolge der Nummern bleibt, jedes hängt am Vorgänger", () => {
    const { steps, missing } = L.planPlacements(board, [12, 10]);
    expect(missing).toEqual([]);
    expect(steps.map((s) => [s.item.number, s.afterId])).toEqual([[12, null], [10, "I12"]]);
  });

  test("hinter einem Anker", () => {
    const { steps } = L.planPlacements(board, [12, 10], 11);
    expect(steps.map((s) => [s.item.number, s.afterId])).toEqual([[12, "I11"], [10, "I12"]]);
  });

  test("noch nicht gelistete Nummern werden gemeldet statt geraten; fehlender Anker bricht ab", () => {
    expect(L.planPlacements(board, [10, 99]).missing).toEqual([99]);
    expect(L.planPlacements(board, [10, 99]).steps.map((s) => s.item.number)).toEqual([10]);
    expect(L.planPlacements(board, [10], 99)).toMatchObject({ steps: [], anchorMissing: true });
  });

  test("Argumente: --top/--after/--dry-run, falsche Benutzung → null", () => {
    expect(P.parseArgs(["--top", "#5", "6"])).toEqual({ anchor: null, numbers: [5, 6], dry: false });
    expect(P.parseArgs(["--dry-run", "--after", "1", "2", "3"])).toEqual({ anchor: 1, numbers: [2, 3], dry: true });
    expect(P.parseArgs(["--after", "1"])).toBeNull(); // Anker ohne Tickets
    expect(P.parseArgs(["--top"])).toBeNull();
    expect(P.parseArgs(["--top", "abc"])).toBeNull();
    expect(P.parseArgs(["--top", "0"])).toBeNull();
    expect(P.parseArgs(["5", "6"])).toBeNull();
  });

  test("isRateLimit erkennt die GitHub-Meldung", () => {
    expect(L.isRateLimit("GraphQL: API rate limit exceeded for user ID 1.")).toBe(true);
    expect(L.isRateLimit("HTTP 404")).toBe(false);
  });
});

describe("Listen-Normalisierer und Abbruch-Meldung (#1239)", () => {
  // Form wie von `gh project item-list --format json` geliefert (Auszug einer echten Antwort).
  const echt = {
    items: [
      { id: "PVTI_a", title: "Ticket A", status: "Todo", content: { type: "Issue", number: 12, title: "Ticket A", url: "https://github.com/fluffels/kubernia/issues/12", repository: "fluffels/kubernia" } },
      { id: "PVTI_b", title: "Entwurf", status: "Todo", content: { type: "DraftIssue", title: "Entwurf", body: "" } },
      { id: "PVTI_c", title: "PR", status: "Done", content: { type: "PullRequest", number: 99 } },
      { id: "PVTI_d", title: "Ohne Inhalt", status: "Todo" },
      { id: "PVTI_e", title: "Ticket B", status: "Todo", content: { type: "Issue", number: 7 } },
    ],
    totalCount: 5,
  };
  const N = rawLib as unknown as {
    normalizeItems: (raw: unknown) => Item[];
    abortMessage: (message: string) => string;
  };

  test("normalizeItems behält nur Issues, in Board-Reihenfolge, mit id und Nummer", () => {
    expect(N.normalizeItems(echt)).toEqual([{ id: "PVTI_a", number: 12 }, { id: "PVTI_e", number: 7 }]);
  });

  test("normalizeItems bricht bei abgeschnittener Liste laut ab", () => {
    expect(() => N.normalizeItems({ ...echt, totalCount: 900 })).toThrow(/abgeschnitten \(5 von 900\)/);
  });

  test("normalizeItems bricht bei unerwarteter Antwortform laut ab statt leer zu melden", () => {
    expect(() => N.normalizeItems({})).toThrow(/Antwortform/);
    expect(() => N.normalizeItems(null)).toThrow(/Antwortform/);
  });

  test("abortMessage: Rate-Limit und das irreführende „unknown owner type“ werden als Rate-Limit gemeldet", () => {
    expect(N.abortMessage("GraphQL: API rate limit exceeded for user ID 1.")).toMatch(/Rate-Limit/);
    const owner = N.abortMessage("unknown owner type");
    expect(owner).toMatch(/Rate-Limit/);
    expect(owner).not.toMatch(/^unknown owner type/);
  });

  test("abortMessage: andere Fehler bleiben ihre erste Zeile", () => {
    expect(N.abortMessage("HTTP 404\nzweite Zeile")).toBe("HTTP 404");
  });
});

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
type Place = { parseArgs: (argv: string[]) => { anchor?: number | null; position?: number; numbers?: number[]; missing?: boolean; dry: boolean } | null };
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
    expect(P.parseArgs(["--position", "6", "#1312"])).toEqual({ anchor: null, position: 6, numbers: [1312], dry: false });
    expect(P.parseArgs(["--missing"])).toEqual({ missing: true, dry: false });
    for (const bad of [["--position", "6"], ["--position", "0", "5"], ["--position", "6", "5", "7"], ["--missing", "5"]]) expect(P.parseArgs(bad), bad.join(" ")).toBeNull();
    expect(P.parseArgs(["--top", "abc"])).toBeNull();
    expect(P.parseArgs(["--top", "0"])).toBeNull();
    expect(P.parseArgs(["5", "6"])).toBeNull();
  });

  test("isRateLimit erkennt die GitHub-Meldung", () => {
    expect(L.isRateLimit("GraphQL: API rate limit exceeded for user ID 1.")).toBe(true);
    expect(L.isRateLimit("HTTP 404")).toBe(false);
  });
});

describe("Listen-Normalisierer und Abbruch-Meldung (#1239, REST #1311)", () => {
  // Form wie von `gh api --paginate --slurp users/<owner>/projectsV2/1/items?fields=<Status-ID>` geliefert (Auszug einer echten Antwort).
  const status = (name: string) => [{ data_type: "single_select", id: 358708531, name: "Status", value: { id: "f75ad846", name: { raw: name, html: name } } }];
  const issue = (node: string, number: number, st = "Todo") => ({ id: 1, node_id: node, content_type: "Issue", content: { number, title: "T" }, fields: status(st) });
  const echt = [
    [
      issue("PVTI_a", 12),
      { id: 2, node_id: "PVTI_b", content_type: "DraftIssue", content: { title: "Entwurf" }, fields: [] },
      { id: 3, node_id: "PVTI_c", content_type: "PullRequest", content: { number: 99 }, fields: status("Done") },
    ],
    [{ id: 4, node_id: "PVTI_d", content_type: "Issue", content: { number: 5 }, fields: [] }, issue("PVTI_e", 7, "In Progress")],
  ];
  const N = rawLib as unknown as {
    normalizeItems: (raw: unknown) => (Item & { status: string })[];
    abortMessage: (message: string) => string;
    afterIdForPosition: (items: (Item & { status: string })[], n: number, ohneNr?: number | null) => string | null;
    missingFromBoard: (open: number[], items: Item[]) => number[];
  };

  test("normalizeItems: nur Issues, über Seiten hinweg in Board-Reihenfolge, mit node_id, Nummer und Status", () => {
    expect(N.normalizeItems(echt)).toEqual([
      { id: "PVTI_a", number: 12, status: "Todo" },
      { id: "PVTI_d", number: 5, status: "" },
      { id: "PVTI_e", number: 7, status: "In Progress" },
    ]);
  });

  test("normalizeItems bricht bei unerwarteter Antwortform laut ab statt leer zu melden", () => {
    for (const bad of [{}, null, [{}], [[], "x"], "items"]) expect(() => N.normalizeItems(bad), JSON.stringify(bad)).toThrow(/Antwortform/);
    expect(N.normalizeItems([[{ content_type: "Issue", content: {} }]])).toEqual([]); // Issue ohne Nummer/node_id fliegt raus
  });

  const board2 = [1, 2, 3, 4].map((n) => ({ id: `I${n}`, number: n, status: n === 2 ? "Done" : "Todo" }));

  test("afterIdForPosition: N=1 → Spitze, sonst das (N-1). Todo-Item ohne das Ticket selbst; kürzeres Board → letztes Todo", () => {
    expect(N.afterIdForPosition(board2, 1)).toBeNull();
    expect(N.afterIdForPosition(board2, 2)).toBe("I1");
    expect(N.afterIdForPosition(board2, 3)).toBe("I3"); // Done-Item zählt nicht
    expect(N.afterIdForPosition(board2, 3, 3)).toBe("I4"); // das Ticket selbst zählt nicht
    expect(N.afterIdForPosition(board2, 50)).toBe("I4");
    expect(N.afterIdForPosition([], 5)).toBeNull();
    expect(() => N.afterIdForPosition(board2, 0)).toThrow(RangeError);
    expect(() => N.afterIdForPosition(board2, 1.5)).toThrow(RangeError);
  });

  test("missingFromBoard: offene Issues ohne Board-Item, aufsteigend und ohne Duplikate", () => {
    expect(N.missingFromBoard([9, 3, 1, 9], board2)).toEqual([9]);
    expect(N.missingFromBoard([1, 2], board2)).toEqual([]);
    expect(N.missingFromBoard([], [])).toEqual([]);
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

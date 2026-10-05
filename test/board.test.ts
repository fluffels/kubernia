/* Board-Helfer (#1217): Spielrhythmus und Einsortieren als getestete Funktionen statt Inline-jq.
 *
 * Reines Node-Tooling-Skript ohne Declaration-File: Namespace einmal über `unknown` auf ein lokales
 * Interface gebracht (gleiche Technik wie test/internalrefs.test.ts, kommt ohne no-unsafe-Suppressions aus). */
import { describe, expect, test } from "vitest";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as rawLib from "../scripts/board-lib.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as rawPlace from "../scripts/board-place.mjs";

type Item = {
  id: string;
  number: number;
  title: string;
  status: string;
  labels: string[];
  assignees: string[];
  unfree: boolean;
};
type Move = { item: Item; afterId: string | null };
type Lib = {
  isGame: (i: Item) => boolean;
  isPrio: (i: Item) => boolean;
  planRhythmStep: (items: Item[], head?: number) => { action: "ok" | "leer" | "move"; item?: Item; afterId?: string };
  planRhythm: (items: Item[], head?: number, max?: number) => { moves: Move[]; end: string };
  applyMove: (items: Item[], item: Item, afterId: string | null) => Item[];
  planPlacements: (
    items: Item[],
    numbers: number[],
    after?: number | null,
  ) => { steps: Move[]; missing: number[]; anchorMissing: boolean };
  blockerNumbers: (body: string) => number[];
  isRateLimit: (m: string) => boolean;
};
type Place = { parseArgs: (argv: string[]) => { anchor: number | null; numbers: number[]; dry: boolean } | null };
const L = rawLib as unknown as Lib;
const P = rawPlace as unknown as Place;

const GAME = "area:inhalt";
const item = (n: number, o: Partial<Item> = {}): Item => ({
  id: `I${n}`,
  number: n,
  title: `Ticket ${n}`,
  status: "Todo",
  labels: [],
  assignees: [],
  unfree: false,
  ...o,
});
const game = (n: number, o: Partial<Item> = {}) => item(n, { labels: [GAME], ...o });

describe("Spielrhythmus (#1215/#1217)", () => {
  test("intakt: höchstens zwei Nicht-Spieltickets in Folge → ok", () => {
    const items = [item(1), item(2), game(3), item(4), item(5), game(6)];
    expect(L.planRhythmStep(items).action).toBe("ok");
  });

  test("drei Nicht-Spieltickets in Folge: oberstes tieferes Spielticket kommt direkt vor das dritte", () => {
    const items = [item(1), item(2), item(3), item(4), game(5), game(6)];
    const step = L.planRhythmStep(items);
    expect(step.action).toBe("move");
    expect(step.item?.number).toBe(5);
    expect(step.afterId).toBe("I2");
  });

  test("kein Spielticket weiter unten → leer", () => {
    expect(L.planRhythmStep([item(1), item(2), item(3), item(4)]).action).toBe("leer");
  });

  test("nur der Kopf (6 freie Items) wird gepflegt: Lücke dahinter bleibt unberührt", () => {
    const items = [item(1), item(2), game(3), item(4), item(5), game(6), item(7), item(8), item(9), game(10)];
    expect(L.planRhythmStep(items).action).toBe("ok");
  });

  test("Vorrang (🚨/🤖/forum) und Items mit Assignee zählen nicht mit", () => {
    const items = [
      item(1, { title: "🚨 Sicherheitslücke" }),
      item(2, { labels: ["forum"] }),
      item(3, { assignees: ["fluffels"] }),
      item(4, { status: "In Progress" }),
      item(5),
      item(6),
      game(7),
    ];
    expect(L.planRhythmStep(items).action).toBe("ok");
  });

  test("nicht freie Spieltickets (Blocker/Branch) gelten weder als Spielticket noch als Kandidat", () => {
    // game(4) ist blockiert: der Slot ist faktisch leer, das freie game(6) wird vorgezogen.
    const items = [item(1), item(2), item(3), game(4, { unfree: true }), item(5), game(6)];
    const step = L.planRhythmStep(items);
    expect(step.action).toBe("move");
    expect(step.item?.number).toBe(6);
    // Ohne freies Ersatz-Spielticket: leer statt das blockierte zu ziehen.
    expect(L.planRhythmStep([item(1), item(2), item(3), game(4, { unfree: true })]).action).toBe("leer");
  });

  test("Konvergenz: nach lokalem Anwenden aller Schritte ist der Rhythmus intakt", () => {
    const items = [item(1), item(2), item(3), item(4), item(5), item(6), game(7), game(8), game(9)];
    const { moves, end } = L.planRhythm(items);
    expect(end).toBe("ok");
    expect(moves.length).toBeGreaterThan(0);
    let cur = items;
    for (const m of moves) cur = L.applyMove(cur, m.item, m.afterId);
    expect(L.planRhythmStep(cur).action).toBe("ok");
    // Reihenfolge der übrigen Items bleibt erhalten (nur Spieltickets rücken vor).
    expect(cur.filter((i) => !L.isGame(i)).map((i) => i.number)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  test("Schrittgrenze verhindert Endlosschleifen", () => {
    const items = [item(1), item(2), item(3), item(4), item(5), item(6), game(7), game(8), game(9)];
    expect(L.planRhythm(items, 6, 1).end).toBe("limit");
  });

  test("applyMove: Spitze und hinter Anker, ohne das Item zu duplizieren", () => {
    const a = item(1);
    const b = item(2);
    const c = item(3);
    expect(L.applyMove([a, b, c], c, null).map((i) => i.number)).toEqual([3, 1, 2]);
    expect(L.applyMove([a, b, c], a, "I2").map((i) => i.number)).toEqual([2, 1, 3]);
  });
});

describe("Einsortieren mehrerer Tickets (#1217)", () => {
  const board = [item(10), item(11), item(12)];

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
    expect(L.planPlacements(board, [10], 99)).toMatchObject({ steps: [], anchorMissing: true });
  });

  test("Argumente: --top/--after/--dry-run, falsche Benutzung → null", () => {
    expect(P.parseArgs(["--top", "#5", "6"])).toEqual({ anchor: null, numbers: [5, 6], dry: false });
    expect(P.parseArgs(["--dry-run", "--after", "1", "2", "3"])).toEqual({ anchor: 1, numbers: [2, 3], dry: true });
    expect(P.parseArgs(["--after", "1"])).toBeNull(); // Anker ohne Tickets
    expect(P.parseArgs(["--top"])).toBeNull();
    expect(P.parseArgs(["--top", "abc"])).toBeNull();
    expect(P.parseArgs(["5", "6"])).toBeNull();
  });
});

describe("Kleinteile", () => {
  test("blockerNumbers findet „blockiert durch #X“ (mehrfach, Groß-/Kleinschreibung)", () => {
    expect(L.blockerNumbers("Text\nBlockiert durch #12 und blockiert durch #7")).toEqual([12, 7]);
    expect(L.blockerNumbers("kein Blocker, erwähnt #5 nur")).toEqual([]);
    expect(L.blockerNumbers("")).toEqual([]);
  });

  test("isRateLimit erkennt die GitHub-Meldung", () => {
    expect(L.isRateLimit("GraphQL: API rate limit exceeded for user ID 1.")).toBe(true);
    expect(L.isRateLimit("HTTP 404")).toBe(false);
  });
});

/* Board-Helfer (#1217): Einsortieren mehrerer Tickets mit einer Listenabfrage als getestete Funktion.
 *
 * Reines Node-Tooling-Skript ohne Declaration-File: Namespace einmal über `unknown` auf ein lokales
 * Interface gebracht (gleiche Technik wie test/internalrefs.test.ts, kommt ohne no-unsafe-Suppressions aus). */
import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as rawLib from "../scripts/board-lib.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as rawPlace from "../scripts/board-place.mjs";
import { FREMD, FREMD_OWNER } from "./support/fremd-config";

const OWNER = FREMD_OWNER; // Login des Maintainer-Accounts, nur Testdaten

type Item = { id: string; number: number };
type Lib = {
  planPlacements: (
    items: Item[],
    numbers: number[],
    after?: number | null,
  ) => { steps: { item: Item; afterId: string | null }[]; missing: number[]; anchorMissing: boolean };
  isRateLimit: (m: string) => boolean;
  REPO: string;
  OWNER: string;
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

  test("OWNER ist der Besitzerteil von REPO (#1837 L17)", () => {
    expect(L.REPO).toMatch(/^[^/]+\/[^/]+$/);
    expect(L.OWNER).not.toBe("");
    expect(`${L.OWNER}/`).toBe(L.REPO.slice(0, L.OWNER.length + 1));
    expect(L.OWNER).not.toContain("/");
  });

  test("isRateLimit erkennt die GitHub-Meldung", () => {
    expect(L.isRateLimit("GraphQL: API rate limit exceeded for user ID 1.")).toBe(true);
    expect(L.isRateLimit("HTTP 404")).toBe(false);
  });
});

describe("Listen-Normalisierer und Abbruch-Meldung (#1239, REST #1311)", () => {
  // Form wie von `gh api --paginate --slurp users/<owner>/projectsV2/1/items?fields=<Status-ID>` geliefert (Auszug einer echten Antwort).
  const status = (name: string) => [{ data_type: "single_select", id: FREMD.boards[0]?.statusFeldId, name: "Status", value: { id: "f75ad846", name: { raw: name, html: name } } }];
  const issue = (node: string, number: number, st = "Todo") => ({ id: 1, node_id: node, content_type: "Issue", content: { node_id: node === "ITEM_a" ? "I_a" : undefined, number, title: "T", state: "open", assignees: [{ login: OWNER }] }, fields: status(st) });
  const echt = [
    [
      issue("ITEM_a", 12),
      { id: 2, node_id: "ITEM_b", content_type: "DraftIssue", content: { title: "Entwurf" }, fields: [] },
      { id: 3, node_id: "ITEM_c", content_type: "PullRequest", content: { number: 99 }, fields: status("Done") },
    ],
    [{ id: 4, node_id: "ITEM_d", content_type: "Issue", content: { number: 5 }, fields: [] }, issue("ITEM_e", 7, "In Progress")],
  ];
  const N = rawLib as unknown as {
    normalizeItems: (raw: unknown) => (Item & { status: string })[];
    abortMessage: (message: string) => string;
    isRateLimit: (message: string) => boolean;
    afterIdForPosition: (items: (Item & { status: string })[], n: number, ohneNr?: number | null) => string | null;
    missingFromBoard: (open: number[], items: Item[]) => number[];
    ankerNummerFuerPosition: (items: (Item & { status: string })[], n: number, ohneNr?: number | null) => number | null;
    planPlacements: (items: Item[], numbers: number[], after?: number | null) => { steps: { item: Item; afterId: string | null }[]; missing: number[]; anchorMissing: boolean };
  };

  // Felder, die nur das Auswählen des nächsten Tickets liest (#1460 Z8): ohne sie im Rohitem leer bzw. 0.
  const LEER = { contentId: "", body: "", labels: [], autor: null, blockedBy: 0 };

  test("normalizeItems: nur Issues, über Seiten hinweg in Board-Reihenfolge, mit node_id, Nummer und Status", () => {
    expect(N.normalizeItems(echt)).toEqual([
      { id: "ITEM_a", number: 12, status: "Todo", title: "T", assignees: [OWNER], state: "open", ...LEER, contentId: "I_a" },
      { id: "ITEM_d", number: 5, status: "", title: "", assignees: [], state: "", ...LEER },
      { id: "ITEM_e", number: 7, status: "In Progress", title: "T", assignees: [OWNER], state: "open", ...LEER },
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

  test("ankerNummerFuerPosition + planPlacements: das neue Ticket landet als N. Todo-Item (Glue von board-place --position)", () => {
    const anker = (n: number, nr: number) => N.ankerNummerFuerPosition(board2, n, nr);
    expect(anker(1, 99)).toBeNull();
    expect(anker(2, 99)).toBe(1);
    expect(anker(3, 99)).toBe(3); // Done-Item #2 zählt nicht
    expect(anker(50, 99)).toBe(4); // kürzeres Board: ans Ende
    const neu = [...board2, { id: "I99", number: 99, status: "Todo" }];
    expect(N.planPlacements(neu, [99], anker(3, 99)).steps.map((s) => [s.item.number, s.afterId])).toEqual([[99, "I3"]]);
    expect(N.planPlacements(neu, [99], anker(1, 99)).steps.map((s) => [s.item.number, s.afterId])).toEqual([[99, null]]);
    expect(anker(3, 3)).toBe(4); // das Ticket selbst zählt nicht mit
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

  test("abortMessage: bei execFileSync-Text steht der gh-Text statt „Command failed“ (stderr-Zeilen zusammengeführt)", () => {
    const m = N.abortMessage("Command failed: gh api graphql -f query=…\nGraphQL: Could not resolve to a node\nzweite stderr-Zeile");
    expect(m).toBe("GraphQL: Could not resolve to a node zweite stderr-Zeile");
    expect(m).not.toMatch(/Command failed/);
  });

  test("abortMessage: Secondary-Rate-Limit in einer späteren Zeile wird als Rate-Limit gemeldet", () => {
    const m = N.abortMessage("Command failed: gh api graphql\nGraphQL: You have exceeded a secondary rate limit. Please wait.");
    expect(m).toMatch(/Rate-Limit/);
    expect(m).toContain("secondary rate limit");
    expect(N.isRateLimit("You have exceeded a secondary rate limit")).toBe(true);
    expect(N.isRateLimit("HTTP 404")).toBe(false);
  });

  test("abortMessage: leer, undefiniert und eine „Command failed“-Zeile allein bleiben stabil; lange Meldung auf ≈600 Zeichen gekürzt", () => {
    expect(N.abortMessage("")).toBe("");
    expect(N.abortMessage(undefined as unknown as string)).toBe("");
    expect(N.abortMessage("Command failed: gh api x")).toBe("Command failed: gh api x");
    expect(N.abortMessage(`Command failed: gh\n${"a".repeat(2000)}`).length).toBeLessThanOrEqual(601);
  });
});

describe("Nie vor das ungeclaimte Sammelticket (#1322 Z19)", () => {
  const TITEL = "Harness-Härtung (gesammelt)";
  type B = { id: string; number: number; status: string; title: string; assignees: string[]; state: string };
  const b = (number: number, extra: Partial<B> = {}): B => ({ id: `I${number}`, number, status: "Todo", title: `T${number}`, assignees: [], state: "open", ...extra });
  const sammel = (number: number, extra: Partial<B> = {}) => b(number, { title: TITEL, ...extra });
  const LT = "Langfuse-Befunde (gesammelt)";
  const langfuse = (number: number, extra: Partial<B> = {}) => b(number, { title: LT, ...extra });
  const K = rawLib as unknown as {
    sammelticketItem: (items: B[], ohne?: number[]) => B | null;
    klemmeAnker: (items: B[], anker: number | null, o?: { numbers?: number[]; notfall?: boolean }) => { anker: number | null; geklemmt: boolean; sammelticket: number | null };
    normalizeItems: (raw: unknown) => B[];
    SAMMELTICKET_TITEL: string;
    LANGFUSE_SAMMELTICKET_TITEL: string;
    SAMMELTICKET_TITEL_LISTE: string[];
    sammelblock: (items: B[], ohne?: number[]) => B[];
    ungeclaimt: (i: { assignees?: string[] }) => boolean;
  };
  // Board-Reihenfolge: 10, 11, 12, Sammelticket 13 (Position 4), 14, 15
  const board3 = [b(10), b(11), b(12), sammel(13), b(14), b(15)];

  test("ungeclaimt ist exportiert und die EINE Prüfung: board-takt führt keine Kopie (#1663 L41)", () => {
    expect(K.ungeclaimt({ assignees: [] })).toBe(true);
    expect(K.ungeclaimt({})).toBe(true);
    expect(K.ungeclaimt({ assignees: [OWNER] })).toBe(false);
    const takt = readFileSync(new URL("../scripts/board-takt.mjs", import.meta.url), "utf8");
    expect(takt).toContain("ungeclaimt");
    expect(takt).not.toContain("assignees ?? []).length");
  });
  test("sammelticketItem: offen, ohne Assignee, richtiger Titel; geclaimt, geschlossen oder gerade einsortiert zählt nicht", () => {
    expect(K.SAMMELTICKET_TITEL).toBe(TITEL);
    expect(K.sammelticketItem(board3)?.number).toBe(13);
    expect(K.sammelticketItem([b(10), sammel(13, { assignees: [OWNER] })])).toBeNull();
    expect(K.sammelticketItem([b(10), sammel(13, { state: "closed" })])).toBeNull();
    expect(K.sammelticketItem(board3, [13])).toBeNull();
    expect(K.sammelticketItem([b(10, { title: "Harness-Härtung" })])).toBeNull();
    expect(K.sammelticketItem([sammel(7, { assignees: ["x"] }), sammel(8)])?.number).toBe(8);
    expect(K.sammelticketItem([])).toBeNull();
  });

  test("--top ohne Notfall wird hinter das Sammelticket geklemmt, mit Notfall bleibt es ganz oben", () => {
    expect(K.klemmeAnker(board3, null)).toEqual({ anker: 13, geklemmt: true, sammelticket: 13 });
    expect(K.klemmeAnker(board3, null, { notfall: true })).toEqual({ anker: null, geklemmt: false, sammelticket: null });
  });

  test("--after: Anker über dem Sammelticket wird geklemmt, Anker gleich oder darunter bleibt", () => {
    expect(K.klemmeAnker(board3, 11)).toMatchObject({ anker: 13, geklemmt: true });
    expect(K.klemmeAnker(board3, 12)).toMatchObject({ anker: 13, geklemmt: true });
    expect(K.klemmeAnker(board3, 13)).toEqual({ anker: 13, geklemmt: false, sammelticket: null });
    expect(K.klemmeAnker(board3, 14)).toEqual({ anker: 14, geklemmt: false, sammelticket: null });
    expect(K.klemmeAnker(board3, 99)).toEqual({ anker: 99, geklemmt: false, sammelticket: null }); // unbekannter Anker: der Aufrufer meldet ihn
  });

  test("--position: bis zur Position des Sammeltickets geklemmt, dahinter nicht; das Sammelticket selbst klemmt nicht", () => {
    const N2 = rawLib as unknown as { ankerNummerFuerPosition: (items: B[], n: number, ohne?: number | null) => number | null };
    const anker = (n: number, nr: number) => N2.ankerNummerFuerPosition(board3, n, nr);
    for (const n of [1, 2, 3, 4]) expect(K.klemmeAnker(board3, anker(n, 99), { numbers: [99] }), `Position ${n}`).toMatchObject({ anker: 13, geklemmt: true });
    expect(K.klemmeAnker(board3, anker(5, 99), { numbers: [99] })).toMatchObject({ anker: 13, geklemmt: false }); // Anker = Sammelticket selbst: schon dahinter
    expect(K.klemmeAnker(board3, anker(6, 99), { numbers: [99] })).toMatchObject({ anker: 14, geklemmt: false });
    // das Sammelticket auf Position 4: nicht geklemmt (steht in numbers)
    expect(K.klemmeAnker(board3, anker(4, 13), { numbers: [13] })).toEqual({ anker: 12, geklemmt: false, sammelticket: null });
  });

  test("ohne ungeclaimtes Sammelticket keine Klemmung (geclaimt, geschlossen, nicht vorhanden)", () => {
    const geclaimt = [b(10), sammel(13, { assignees: [OWNER] }), b(14)];
    expect(K.klemmeAnker(geclaimt, null)).toEqual({ anker: null, geklemmt: false, sammelticket: null });
    expect(K.klemmeAnker([b(10), sammel(13, { state: "closed" })], null).geklemmt).toBe(false);
    expect(K.klemmeAnker([b(10), b(11)], null).geklemmt).toBe(false);
    expect(K.klemmeAnker([], null).geklemmt).toBe(false);
  });

  test("Klemmung im Zusammenspiel mit planPlacements: neue Tickets hängen hinter dem Sammelticket, in Reihenfolge", () => {
    const neu = [...board3, b(20), b(21)];
    const k = K.klemmeAnker(neu, null, { numbers: [20, 21] });
    const plan = L.planPlacements(neu, [20, 21], k.anker);
    expect(plan.steps.map((s) => [s.item.number, s.afterId])).toEqual([[20, "I13"], [21, "I20"]]);
  });

  test("Titelliste: Harness und Langfuse; Sammelblock = aufeinanderfolgende ungeclaimte Sammeltickets ab dem Harness-Sammelticket (#1342)", () => {
    expect(K.SAMMELTICKET_TITEL_LISTE).toEqual([TITEL, LT]);
    expect(K.LANGFUSE_SAMMELTICKET_TITEL).toBe(LT);
    const nummern = (items: B[], ohne?: number[]) => K.sammelblock(items, ohne).map((i) => i.number);
    expect(nummern([sammel(1), langfuse(2), b(3), langfuse(4)])).toEqual([1, 2]);
    expect(nummern([b(3), sammel(1)]), "Block beginnt am Harness-Sammelticket, wo es steht").toEqual([1]);
    expect(nummern([sammel(1), b(5, { assignees: [OWNER] }), langfuse(2), b(3)]), "geclaimte überspringt der Block").toEqual([1, 2]);
    expect(nummern([sammel(1), b(5, { state: "closed" }), langfuse(2), b(3)]), "geschlossene überspringt der Block").toEqual([1, 2]);
    expect(nummern([sammel(1, { assignees: ["x"] }), langfuse(2)]), "geclaimtes Sammelticket zählt nicht").toEqual([2]);
    expect(nummern([sammel(1), b(20), langfuse(2)], [20]), "gerade einsortiertes Item beendet den Block nicht").toEqual([1, 2]);
    expect(nummern([b(8, { title: "Langfuse-Status überprüfen" }), sammel(1), langfuse(2), b(3)]), "Status-Ticket davor stört nicht").toEqual([1, 2]);
    expect(nummern([b(8), sammel(1), langfuse(2), b(3)]), "Notfall/Forum-Ticket davor stört nicht").toEqual([1, 2]);
    expect(nummern([langfuse(2), b(3)]), "ohne Harness-Sammelticket ab der Spitze").toEqual([2]);
    expect(nummern([])).toEqual([]);
  });

  test("Klemmung kennt beide Sammeltickets: der Anker ist das am weitesten hinten stehende (#1342)", () => {
    const hinter = (items: B[], anker: number | null = null, o = {}) => K.klemmeAnker(items, anker, o).anker;
    expect(hinter([sammel(1), b(9)]), "[S_H, X]").toBe(1);
    expect(hinter([sammel(1), langfuse(2), b(9)]), "[S_H, S_L, X]").toBe(2);
    expect(hinter([sammel(1), b(9), b(10), langfuse(2)]), "S_L am Ende zählt nicht").toBe(1);
    expect(hinter([sammel(1), b(5, { assignees: [OWNER] }), langfuse(2), b(9)]), "geclaimte dazwischen").toBe(2);
    expect(hinter([b(9), sammel(1)]), "[X, S_H]").toBe(1);
    expect(hinter([langfuse(2), b(9), sammel(1)]), "[S_L, X, S_H]").toBe(1);
    expect(hinter([sammel(1), langfuse(2), b(9)], 1), "Anker vor dem Ziel wird geklemmt").toBe(2);
    expect(hinter([sammel(1), langfuse(2), b(9)], 2), "Anker = Ziel bleibt").toBe(2);
    expect(hinter([sammel(1), langfuse(2), b(9)], 9), "Anker dahinter bleibt").toBe(9);
    expect(hinter([sammel(1), langfuse(2), b(9)], null, { numbers: [2] }), "Sammelticket in numbers zählt nicht").toBe(1);
    expect(hinter([sammel(1), langfuse(2), b(9)], null, { notfall: true }), "Notfall klemmt nicht").toBeNull();
    expect(hinter([b(8), sammel(1), langfuse(2), b(9)]), "Status-/Notfall-Ticket an der Spitze (#1342, Lens-Befund)").toBe(2);
    expect(hinter([b(8), sammel(1), langfuse(2), b(9)], 8), "Anker über den Sammeltickets wird geklemmt").toBe(2);
    expect(hinter([langfuse(2), b(9)]), "nur Langfuse an der Spitze, kein Harness-Sammelticket").toBe(2);
    expect(hinter([b(9), langfuse(2)]), "Langfuse hinten, kein Harness: keine Klemmung").toBeNull();
  });

  test("der Titel, an dem die Klemmung das Sammelticket erkennt, steht wörtlich in AGENTS.md, Skill und ticket-reihenfolge.md (keine stille Drift)", () => {
    for (const datei of ["AGENTS.md", ".agents/skills/factory/ablauf.md", "docs/ticket-reihenfolge.md"]) {
      expect(readFileSync(new URL(`../${datei}`, import.meta.url), "utf8"), datei).toContain(K.SAMMELTICKET_TITEL);
    }
    for (const datei of ["AGENTS.md", "docs/ticket-reihenfolge.md"]) {
      expect(readFileSync(new URL(`../${datei}`, import.meta.url), "utf8"), datei).toContain(K.LANGFUSE_SAMMELTICKET_TITEL);
    }
  });

  test("planFuerArgs (die Verdrahtung von board-place): --top klemmt, --notfall nicht, --after und --position klemmen, melden die Klemmung", () => {
    const F = rawLib as unknown as { planFuerArgs: (items: B[], args: object) => { steps: { item: B; afterId: string | null }[]; klemmung: { geklemmt: boolean; sammelticket: number | null } } };
    const neu = [...board3, b(20)];
    const hinter = (args: object) => F.planFuerArgs(neu, args).steps.map((s) => [s.item.number, s.afterId]);
    expect(hinter({ anchor: null, numbers: [20] })).toEqual([[20, "I13"]]);
    expect(F.planFuerArgs(neu, { anchor: null, numbers: [20] }).klemmung).toEqual({ geklemmt: true, sammelticket: 13 });
    expect(hinter({ anchor: null, numbers: [20], notfall: "rot-main" })).toEqual([[20, null]]);
    expect(F.planFuerArgs(neu, { anchor: null, numbers: [20], notfall: "forum" }).klemmung.geklemmt).toBe(false);
    expect(hinter({ anchor: 11, numbers: [20] })).toEqual([[20, "I13"]]);
    expect(hinter({ anchor: 14, numbers: [20] })).toEqual([[20, "I14"]]);
    expect(hinter({ anchor: null, position: 2, numbers: [20] })).toEqual([[20, "I13"]]);
    expect(hinter({ anchor: null, position: 6, numbers: [20] })).toEqual([[20, "I14"]]);
    expect(hinter({ anchor: null, position: 4, numbers: [13] })).toEqual([[13, "I12"]]); // das Sammelticket selbst
  });

  test("Kompositionstest von main: planFuerArgs(items, parseArgs(argv)) aus echten Kommandozeilen (#1331)", () => {
    const F = rawLib as unknown as { planFuerArgs: (items: B[], args: object) => { steps: { item: B; afterId: string | null }[]; klemmung: { geklemmt: boolean } } };
    const neu = [...board3, b(20)];
    const plan = (argv: string[]) => {
      const args = P.parseArgs(argv);
      expect(args, argv.join(" ")).not.toBeNull();
      return F.planFuerArgs(neu, args as object);
    };
    expect(plan(["--top", "20"]).steps.map((s) => [s.item.number, s.afterId])).toEqual([[20, "I13"]]);
    expect(plan(["--top", "20"]).klemmung.geklemmt).toBe(true);
    expect(plan(["--notfall", "rot-main", "--top", "20"]).steps.map((s) => [s.item.number, s.afterId])).toEqual([[20, null]]);
    expect(plan(["--after", "14", "20"]).steps.map((s) => [s.item.number, s.afterId])).toEqual([[20, "I14"]]);
    expect(plan(["--position", "6", "20"]).steps.map((s) => [s.item.number, s.afterId])).toEqual([[20, "I14"]]);
    expect(P.parseArgs(["--notfall", "unbekannt", "--top", "20"])).toBeNull();
  });

  test("normalizeItems liefert Titel, Assignee-Logins und Zustand (Form einer echten REST-Antwort)", () => {
    const echt = [[{ node_id: "ITEM_x", content_type: "Issue", content: { number: 1331, title: TITEL, state: "open", assignees: [{ login: OWNER, id: 1 }, null, { id: 2 }] }, fields: [] }]];
    expect(K.normalizeItems(echt)).toEqual([{ id: "ITEM_x", number: 1331, status: "", title: TITEL, assignees: [OWNER], state: "open", contentId: "", body: "", labels: [], autor: null, blockedBy: 0 }]);
    const roh = [[{ node_id: "ITEM_y", content_type: "Issue", content: { number: 2, title: 5, assignees: "x" }, fields: [] }]];
    expect(K.normalizeItems(roh)).toEqual([{ id: "ITEM_y", number: 2, status: "", title: "", assignees: [], state: "", contentId: "", body: "", labels: [], autor: null, blockedBy: 0 }]);
  });

  test("normalizeItems liest Body, Label-Namen, Autor und GitHubs Blocker-Zähler (REST-Form samt issue_dependencies_summary, #1460 Z8)", () => {
    const echt = [[{
      node_id: "ITEM_z",
      content_type: "Issue",
      content: {
        number: 7,
        title: "T",
        state: "open",
        body: "blockiert durch #3",
        assignees: [],
        user: { login: OWNER, type: "User", id: 1 },
        labels: [{ name: FREMD.labels.harness, id: 5 }, "forum", null, { id: 6 }],
        issue_dependencies_summary: { blocked_by: 2, total_blocked_by: 3, blocking: 0, total_blocking: 0 },
      },
      fields: [],
    }]];
    expect(K.normalizeItems(echt)).toEqual([
      { id: "ITEM_z", number: 7, status: "", title: "T", assignees: [], state: "open", contentId: "", body: "blockiert durch #3", labels: [FREMD.labels.harness, "forum"], autor: { login: OWNER, type: "User" }, blockedBy: 2 },
    ]);
    // kaputte Felder werden abgehärtet statt zu werfen: Body kein Text, Autor ohne Login, Zähler keine Zahl
    const roh = [[{ node_id: "ITEM_y", content_type: "Issue", content: { number: 8, body: 5, user: { type: "User" }, labels: "x", issue_dependencies_summary: { blocked_by: "viel" } }, fields: [] }]];
    expect(K.normalizeItems(roh)).toEqual([{ id: "ITEM_y", number: 8, status: "", title: "", assignees: [], state: "", contentId: "", body: "", labels: [], autor: null, blockedBy: 0 }]);
  });

  test("Argumente: --notfall nur mit --top und mit bekannter Art", () => {
    expect(P.parseArgs(["--notfall", "rot-main", "--top", "5"])).toEqual({ anchor: null, numbers: [5], dry: false, notfall: "rot-main" });
    // --notfall nur unmittelbar vor --top (#1791)
    expect(P.parseArgs(["--top", "5", "--notfall", "security"])).toBeNull();
    expect(P.parseArgs(["--notfall", "rot-main", "--dry-run", "--top", "5"])).toMatchObject({ notfall: "rot-main", dry: true, numbers: [5] });
    expect(P.parseArgs(["--top", "5", "--dry-run"])).toEqual({ anchor: null, numbers: [5], dry: true });
    expect(P.parseArgs(["--missing", "--dry-run"])).toEqual({ missing: true, dry: true });
    for (const art of ["rot-main", "security", "dependabot", "forum"]) expect(P.parseArgs(["--notfall", art, "--top", "1"])).toMatchObject({ notfall: art });
    expect(P.parseArgs(["--top", "5"])).not.toHaveProperty("notfall");
    for (const bad of [
      ["--notfall", "egal", "--top", "5"], // unbekannte Art
      ["--notfall", "--top", "5"], // Art fehlt
      ["--notfall", "forum"], // ohne --top
      ["--notfall", "forum", "--after", "1", "2"], // nur mit --top
      ["--notfall", "forum", "--position", "4", "5"],
      ["--notfall", "forum", "--missing"],
      ["--top", "--notfall", "rot-main", "5"], // --notfall hinter --top
      ["--dry-run", "--dry-run", "--top", "5"], // doppeltes boolean-Flag
      ["--top", "5", "--bogus"], // unbekanntes Flag
      ["--top", "5", "--top", "6"], // doppelter Modus
      ["--top=5"], // Inline-Wert an boolean
      ["5", "--top"], // Positionsargument vor dem Modus
      ["--top", "--", "5"], // Options-Terminator
      ["--missing", "--umzug"], // zwei Modi
      ["--missing", "5"], // Modus ohne Zahlen mit Zahl
      ["--notfall", "rot-main", "--dry-run", "--after", "1", "2"], // dry-run zwischen notfall und Modus ändert nichts
    ])
      expect(P.parseArgs(bad), bad.join(" ")).toBeNull();
  });

  test("Kopf (#1349 Z27b): ohne ungeclaimtes Harness-Sammelticket beginnt der Sammelblock hinter dem Kopf, damit ein Status-Ticket oben das Langfuse-Sammelticket nicht verdeckt", () => {
    const status = (n: number) => b(n, { title: "Langfuse-Status überprüfen" });
    const nummern = (items: B[]) => K.sammelblock(items).map((i) => i.number);
    expect(nummern([status(8), langfuse(2), b(3)])).toEqual([2]);
    expect(K.klemmeAnker([status(8), langfuse(2), b(3)], null)).toMatchObject({ anker: 2, geklemmt: true });
    expect(nummern([b(1, { title: "🚨 CI rot auf main" }), status(8), langfuse(2), b(3)]), "mehrere Kopf-Items").toEqual([2]);
    expect(nummern([b(1, { title: "🤖 Dependabot-PRs auflösen" }), b(4, { title: "Forum #12: Frage" }), langfuse(2)])).toEqual([2]);
    expect(nummern([status(8), b(5), langfuse(2)]), "ein Nicht-Kopf-Ticket dazwischen beendet den Kopf: Block leer").toEqual([]);
    expect(nummern([status(8), b(9, { state: "closed" }), langfuse(2)]), "geschlossene Items zählen nicht").toEqual([2]);
  });

  test("Notfall-Marker stehen wörtlich in ihrer Quelle (Inbox-Workflow bzw. Doku): keine stille Drift (#1390 Z6a)", () => {
    const M = rawLib as unknown as {
      NOTFAELLE: { art: string; marker: string; quelle: string }[];
      NOTFALL_ARTEN: string[];
      KOPF_MARKER: string[];
      istKopfItem: (i: { title: string }) => boolean;
      kopfEnde: (items: B[]) => number;
      imKopf: (items: B[], nr: number) => boolean;
    };
    expect(M.NOTFALL_ARTEN).toEqual(["rot-main", "security", "dependabot", "forum", "wiedervorlage"]);
    expect(M.KOPF_MARKER).toEqual(M.NOTFAELLE.map((n) => n.marker));
    // Die Art forum prüft der Projekt-Test forum-notfall-projekt.test.ts (der Forum-Workflow ist ein Projekt-Modul).
    for (const n of M.NOTFAELLE.filter((x) => x.art !== "forum")) {
      const text = readFileSync(new URL(`../${n.quelle}`, import.meta.url), "utf8");
      // Workflows setzen den Titel als marker="…", die Doku nennt den Marker wörtlich.
      expect(text, `${n.art}: ${n.marker} in ${n.quelle}`).toContain(n.quelle.endsWith(".yml") ? `marker="${n.marker}` : n.marker);
    }
    expect(M.istKopfItem({ title: "🔒 Security: Lücke in X" }), "Security zählt zum Kopf").toBe(true);
    expect(M.kopfEnde([b(1, { title: "🔒 Security: Lücke" }), b(2, { title: "Langfuse-Status überprüfen" }), b(3)])).toBe(2);
    expect(M.istKopfItem({ title: "Harness-Härtung (gesammelt)" })).toBe(false);
    expect(M.istKopfItem({ title: "Langfuse-Status überprüfen" })).toBe(true);
    expect(M.kopfEnde([b(1), b(2)])).toBe(0);
    expect(M.imKopf([b(1, { title: "Langfuse-Status überprüfen" }), b(2)], 1)).toBe(true);
    expect(M.imKopf([b(2), b(1, { title: "Langfuse-Status überprüfen" })], 1)).toBe(false);
    expect(M.imKopf([b(2)], 99)).toBe(false);
  });

  test("fehlendeNummern (#1349 Z16): fehlende Tickets UND ein fehlender Anker lösen den Fallback aus, Bekannte nicht", () => {
    const F = rawLib as unknown as { fehlendeNummern: (items: B[], args: { numbers: number[]; anchor?: number | null }) => number[] };
    const items = [b(10), b(11)];
    expect(F.fehlendeNummern(items, { numbers: [10, 20], anchor: 99 })).toEqual([20, 99]);
    expect(F.fehlendeNummern(items, { numbers: [10], anchor: 11 })).toEqual([]);
    expect(F.fehlendeNummern(items, { numbers: [10], anchor: null })).toEqual([]);
    expect(F.fehlendeNummern([], { numbers: [5] })).toEqual([5]);
  });

  test("geclaimtes Kopf-Item zählt zum Kopf (#1349)", () => {
    const M = rawLib as unknown as { kopfEnde: (items: B[]) => number };
    expect(M.kopfEnde([b(1, { title: "Langfuse-Status überprüfen", assignees: [OWNER] }), b(2)])).toBe(1);
  });

  test("GraphQL-Fallback (#1349 Z16): fehlende Items aus issue.projectItems, nur das eigene Board, fehlende bleiben fehlend", () => {
    const G = rawLib as unknown as {
      boardFuerRolle: (r: string) => { projectId: string };
      itemAusIssueAntwort: (board: unknown, a: unknown) => B | null;
      ergaenzeFehlende: (items: B[], gefunden: (B | null)[]) => B[];
    };
    const antwort = (nodes: unknown[]) => ({ data: { repository: { issue: { number: 1360, title: "Kind", state: "OPEN", assignees: { nodes: [{ login: OWNER }] }, projectItems: { nodes } } } } });
    const produkt = G.boardFuerRolle("produkt");
    const factory = G.boardFuerRolle("factory");
    expect(G.itemAusIssueAntwort(produkt, antwort([{ id: "ITEM_a", project: { id: produkt.projectId } }]))).toEqual({ id: "ITEM_a", number: 1360, status: "", title: "Kind", assignees: [OWNER], state: "open" });
    expect(G.itemAusIssueAntwort(produkt, antwort([{ id: "ITEM_x", project: { id: "PRJ_fremd" } }])), "fremdes Projekt").toBeNull();
    const beide = antwort([{ id: "ITEM_p", project: { id: produkt.projectId } }, { id: "ITEM_f", project: { id: factory.projectId } }]);
    expect(G.itemAusIssueAntwort(produkt, beide)?.id, "Produkt-Board gewählt").toBe("ITEM_p");
    expect(G.itemAusIssueAntwort(factory, beide)?.id, "Factory-Board gewählt").toBe("ITEM_f");
    expect(G.itemAusIssueAntwort(factory, antwort([{ id: "ITEM_p", project: { id: produkt.projectId } }])), "nur im anderen Board").toBeNull();
    expect(G.itemAusIssueAntwort(produkt, antwort([])), "nicht im Board").toBeNull();
    expect(G.itemAusIssueAntwort(produkt, { data: { repository: { issue: null } } }), "Issue unbekannt").toBeNull();
    expect(G.itemAusIssueAntwort(produkt, null)).toBeNull();
    const neu = G.ergaenzeFehlende([b(10)], [{ ...b(1360), id: "ITEM_a" }, null, b(10, { id: "doppelt" })]);
    expect(neu.map((i) => i.id)).toEqual(["I10", "ITEM_a"]);
    const plan = L.planPlacements(neu, [1360], 10);
    expect(plan.missing).toEqual([]);
    expect(plan.steps.map((s) => [s.item.number, s.afterId])).toEqual([[1360, "I10"]]);
  });
});

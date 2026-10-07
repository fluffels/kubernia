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
  const issue = (node: string, number: number, st = "Todo") => ({ id: 1, node_id: node, content_type: "Issue", content: { number, title: "T", state: "open", assignees: [{ login: "fluffels" }] }, fields: status(st) });
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
    ankerNummerFuerPosition: (items: (Item & { status: string })[], n: number, ohneNr?: number | null) => number | null;
    planPlacements: (items: Item[], numbers: number[], after?: number | null) => { steps: { item: Item; afterId: string | null }[]; missing: number[]; anchorMissing: boolean };
  };

  test("normalizeItems: nur Issues, über Seiten hinweg in Board-Reihenfolge, mit node_id, Nummer und Status", () => {
    expect(N.normalizeItems(echt)).toEqual([
      { id: "PVTI_a", number: 12, status: "Todo", title: "T", assignees: ["fluffels"], state: "open" },
      { id: "PVTI_d", number: 5, status: "", title: "", assignees: [], state: "" },
      { id: "PVTI_e", number: 7, status: "In Progress", title: "T", assignees: ["fluffels"], state: "open" },
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
  };
  // Board-Reihenfolge: 10, 11, 12, Sammelticket 13 (Position 4), 14, 15
  const board3 = [b(10), b(11), b(12), sammel(13), b(14), b(15)];

  test("sammelticketItem: offen, ohne Assignee, richtiger Titel; geclaimt, geschlossen oder gerade einsortiert zählt nicht", () => {
    expect(K.SAMMELTICKET_TITEL).toBe(TITEL);
    expect(K.sammelticketItem(board3)?.number).toBe(13);
    expect(K.sammelticketItem([b(10), sammel(13, { assignees: ["fluffels"] })])).toBeNull();
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
    const geclaimt = [b(10), sammel(13, { assignees: ["fluffels"] }), b(14)];
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
    expect(nummern([sammel(1), b(5, { assignees: ["fluffels"] }), langfuse(2), b(3)]), "geclaimte überspringt der Block").toEqual([1, 2]);
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
    expect(hinter([sammel(1), b(5, { assignees: ["fluffels"] }), langfuse(2), b(9)]), "geclaimte dazwischen").toBe(2);
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

  test("der Titel, an dem die Klemmung das Sammelticket erkennt, steht wörtlich in AGENTS.md, Workflow und ticket-reihenfolge.md (keine stille Drift)", () => {
    for (const datei of ["AGENTS.md", ".claude/workflows/kubernia-ticket.js", "docs/ticket-reihenfolge.md"]) {
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
    const echt = [[{ node_id: "PVTI_x", content_type: "Issue", content: { number: 1331, title: TITEL, state: "open", assignees: [{ login: "fluffels", id: 1 }, null, { id: 2 }] }, fields: [] }]];
    expect(K.normalizeItems(echt)).toEqual([{ id: "PVTI_x", number: 1331, status: "", title: TITEL, assignees: ["fluffels"], state: "open" }]);
    const roh = [[{ node_id: "PVTI_y", content_type: "Issue", content: { number: 2, title: 5, assignees: "x" }, fields: [] }]];
    expect(K.normalizeItems(roh)).toEqual([{ id: "PVTI_y", number: 2, status: "", title: "", assignees: [], state: "" }]);
  });

  test("Argumente: --notfall nur mit --top und mit bekannter Art", () => {
    expect(P.parseArgs(["--notfall", "rot-main", "--top", "5"])).toEqual({ anchor: null, numbers: [5], dry: false, notfall: "rot-main" });
    expect(P.parseArgs(["--top", "5", "--notfall", "security"])).toMatchObject({ notfall: "security", numbers: [5] });
    for (const art of ["rot-main", "security", "dependabot", "forum"]) expect(P.parseArgs(["--notfall", art, "--top", "1"])).toMatchObject({ notfall: art });
    expect(P.parseArgs(["--top", "5"])).not.toHaveProperty("notfall");
    for (const bad of [
      ["--notfall", "egal", "--top", "5"], // unbekannte Art
      ["--notfall", "--top", "5"], // Art fehlt
      ["--notfall", "forum"], // ohne --top
      ["--notfall", "forum", "--after", "1", "2"], // nur mit --top
      ["--notfall", "forum", "--position", "4", "5"],
      ["--notfall", "forum", "--missing"],
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

  test("Kopf-Marker stehen wörtlich in den Inbox-Workflows (keine stille Drift)", () => {
    const M = rawLib as unknown as { KOPF_MARKER: string[]; istKopfItem: (i: { title: string }) => boolean; kopfEnde: (items: B[]) => number; imKopf: (items: B[], nr: number) => boolean };
    const wf = [".github/workflows/ci.yml", ".github/workflows/dependabot-inbox.yml", ".github/workflows/forum-inbox.yml"]
      .map((f) => readFileSync(new URL(`../${f}`, import.meta.url), "utf8"))
      .join("\n");
    for (const marker of M.KOPF_MARKER) expect(wf, marker).toContain(`marker="${marker}`);
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
    expect(M.kopfEnde([b(1, { title: "Langfuse-Status überprüfen", assignees: ["fluffels"] }), b(2)])).toBe(1);
  });

  test("GraphQL-Fallback (#1349 Z16): fehlende Items aus issue.projectItems, nur das eigene Board, fehlende bleiben fehlend", () => {
    const G = rawLib as unknown as {
      PROJECT_ID: string;
      itemAusIssueAntwort: (a: unknown) => B | null;
      ergaenzeFehlende: (items: B[], gefunden: (B | null)[]) => B[];
    };
    const antwort = (nodes: unknown[]) => ({ data: { repository: { issue: { number: 1360, title: "Kind", state: "OPEN", assignees: { nodes: [{ login: "fluffels" }] }, projectItems: { nodes } } } } });
    expect(G.itemAusIssueAntwort(antwort([{ id: "PVTI_a", project: { id: G.PROJECT_ID } }]))).toEqual({ id: "PVTI_a", number: 1360, status: "", title: "Kind", assignees: ["fluffels"], state: "open" });
    expect(G.itemAusIssueAntwort(antwort([{ id: "PVTI_x", project: { id: "PVT_fremd" } }])), "fremdes Projekt").toBeNull();
    expect(G.itemAusIssueAntwort(antwort([])), "nicht im Board").toBeNull();
    expect(G.itemAusIssueAntwort({ data: { repository: { issue: null } } }), "Issue unbekannt").toBeNull();
    expect(G.itemAusIssueAntwort(null)).toBeNull();
    const neu = G.ergaenzeFehlende([b(10)], [{ ...b(1360), id: "PVTI_a" }, null, b(10, { id: "doppelt" })]);
    expect(neu.map((i) => i.id)).toEqual(["I10", "PVTI_a"]);
    const plan = L.planPlacements(neu, [1360], 10);
    expect(plan.missing).toEqual([]);
    expect(plan.steps.map((s) => [s.item.number, s.afterId])).toEqual([[1360, "I10"]]);
  });
});

import { describe, expect, test } from "vitest";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as raw from "../scripts/naechstes-ticket.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as boardLib from "../scripts/board-lib.mjs";

type Eingabe = { items: unknown[]; offene: Set<number>; refs?: string[]; worktrees?: string[]; prHeads?: string[]; owner?: string };
type Ergebnis = { ticket: { nr: number; titel: string } | null; uebersprungen: { nr: number; grund: string }[] };
const N = raw as unknown as {
  waehleNaechstes: (e: Eingabe) => Ergebnis;
  blockerNummern: (b: string) => number[];
  ticketAusRef: (t: string) => number | null;
  formatiere: (e: Ergebnis) => string;
  fuehreAus: (argv: string[], io: { lade: () => Eingabe; owner: string }) => { code: number; out: string; err: string };
};

// Ein Parse-Pfad (#1460 Z8): die Roh-Fixtures (REST-Form) laufen wie im Echtbetrieb durch normalizeItems, waehleNaechstes sieht nur Normalisiertes.
const normalizeItems = (boardLib as unknown as { normalizeItems: (pages: unknown[][]) => unknown[] }).normalizeItems;
const norm = (items: unknown[]) => normalizeItems([items]);

const item = (nr: number, c: Record<string, unknown> = {}, status = "Todo") => ({
  node_id: `PVTI_${nr}`,
  content_type: "Issue",
  fields: [{ name: "Status", value: { name: { raw: status } } }],
  content: { number: nr, title: `T${nr}`, state: "open", assignees: [], user: { login: "fluffels", type: "User" }, labels: [], body: "", issue_dependencies_summary: { blocked_by: 0 }, ...c },
});
const frei = (items: unknown[], extra: Partial<Eingabe> = {}) => N.waehleNaechstes({ items: norm(items), offene: new Set(), owner: "fluffels", ...extra });

describe("blockerNummern", () => {
  test("mehrfach, case-insensitiv, mehrere Nummern je Zeile; Klammertext zählt nicht", () => {
    expect(N.blockerNummern("x\nBlockiert durch #12, #13 (nur solange #99 offen ist)\nblockiert durch #14")).toEqual([12, 13, 14]);
  });
  test("ohne Zeile: leer; eine bloße Erwähnung blockiert nicht", () => {
    expect(N.blockerNummern("siehe #5, Nachfolger von #7")).toEqual([]);
    expect(N.blockerNummern(null as unknown as string)).toEqual([]);
  });
});

describe("ticketAusRef", () => {
  test("Branch, Remote-Ref, Worktree-Zeile", () => {
    expect(N.ticketAusRef("feature/kq-12-foo")).toBe(12);
    expect(N.ticketAusRef("origin/feature/kq-12-foo")).toBe(12);
    expect(N.ticketAusRef("worktree C:/x/.claude/worktrees/kq-12")).toBe(12);
    expect(N.ticketAusRef("worktree C:\\x\\.claude\\worktrees\\kq-12")).toBe(12);
    expect(N.ticketAusRef("feature/kq-123-foo")).toBe(123);
  });
  test("fremde Namen: null (kq-12x, anderes Präfix)", () => {
    expect(N.ticketAusRef("main")).toBeNull();
    expect(N.ticketAusRef("feature/kq-12x")).toBeNull();
    expect(N.ticketAusRef("hotfix/kq-12-a")).toBeNull();
  });
});

describe("waehleNaechstes: jedes Kriterium mit Negativfall", () => {
  test("das oberste freie Item gewinnt", () => {
    expect(frei([item(1), item(2)]).ticket).toEqual({ nr: 1, titel: "T1" });
  });
  test("Assignee: übersprungen, nächstes frei", () => {
    const r = frei([item(1, { assignees: [{ login: "fluffels" }] }), item(2)]);
    expect(r.ticket?.nr).toBe(2);
    expect(r.uebersprungen).toEqual([{ nr: 1, grund: "Assignee @fluffels" }]);
  });
  test("Status nicht Todo oder geschlossen: nicht einmal als übersprungen gelistet", () => {
    const r = frei([item(1, {}, "In Progress"), item(2, { state: "closed" }), item(3)]);
    expect(r.ticket?.nr).toBe(3);
    expect(r.uebersprungen).toEqual([]);
  });
  test("offener Blocker: übersprungen; geschlossener zählt nicht", () => {
    const blockiert = item(1, { body: "blockiert durch #50 (nur solange #50 offen ist)" });
    expect(frei([blockiert, item(2)], { offene: new Set([50]) }).ticket?.nr).toBe(2);
    expect(frei([blockiert, item(2)], { offene: new Set([50]) }).uebersprungen[0].grund).toContain("#50");
    expect(frei([blockiert, item(2)], { offene: new Set() }).ticket?.nr).toBe(1);
  });
  test("GitHub-Abhängigkeit blocked_by > 0: übersprungen", () => {
    expect(frei([item(1, { issue_dependencies_summary: { blocked_by: 1 } }), item(2)]).ticket?.nr).toBe(2);
  });
  test("Branch, Worktree oder offener PR: je einzeln übersprungen", () => {
    expect(frei([item(1), item(2)], { refs: ["origin/feature/kq-1-x"] }).ticket?.nr).toBe(2);
    expect(frei([item(1), item(2)], { worktrees: ["worktree C:/a/.claude/worktrees/kq-1"] }).ticket?.nr).toBe(2);
    expect(frei([item(1), item(2)], { prHeads: ["feature/kq-1-y"] }).ticket?.nr).toBe(2);
  });
  test("Fremdeingang: fremder Autor oder Forum-Label wird übersprungen mit Hinweis „Befund melden“", () => {
    const r = frei([item(1, { user: { login: "fremd", type: "User" } }), item(2, { labels: [{ name: "forum" }] }), item(3)]);
    expect(r.ticket?.nr).toBe(3);
    expect(r.uebersprungen.map((u) => u.nr)).toEqual([1, 2]);
    expect(r.uebersprungen[0].grund).toContain("Befund melden");
  });
  test("ein vertrauter Bot als Autor ist kein Fremdeingang", () => {
    expect(frei([item(1, { user: { login: "github-actions[bot]", type: "Bot" } })]).ticket?.nr).toBe(1);
  });
  test("kein freies Item: ticket null; Drafts und PRs werden ignoriert", () => {
    const r = frei([{ content_type: "DraftIssue", fields: [], content: {} }, item(1, { assignees: [{ login: "x" }] })]);
    expect(r.ticket).toBeNull();
    expect(r.uebersprungen).toHaveLength(1);
  });
  test("Blocker auf sich selbst sperrt nicht", () => {
    expect(frei([item(1, { body: "blockiert durch #1" })], { offene: new Set([1]) }).ticket?.nr).toBe(1);
  });
});

describe("fuehreAus", () => {
  const io = (eingabe: Eingabe | Error) => ({
    owner: "fluffels",
    lade: () => {
      if (eingabe instanceof Error) throw eingabe;
      return eingabe;
    },
  });
  test("gefunden: Exit 0, erste Zeile `#nr<TAB>Titel`", () => {
    const r = N.fuehreAus([], io({ items: norm([item(7)]), offene: new Set() }));
    expect(r.code).toBe(0);
    expect(r.out.split("\n")[0]).toBe("#7\tT7");
  });
  test("kein freies: Exit 1", () => {
    expect(N.fuehreAus([], io({ items: [], offene: new Set() })).code).toBe(1);
  });
  test("Fehler beim Laden: Exit 2 mit Meldung", () => {
    const r = N.fuehreAus([], io(new Error("kein Netz")));
    expect(r.code).toBe(2);
    expect(r.err).toContain("kein Netz");
  });
  test("--json: parsebar; der Body erscheint nie in der Ausgabe", () => {
    const r = N.fuehreAus(["--json"], io({ items: norm([item(7, { body: "GEHEIMER BODY" })]), offene: new Set() }));
    expect((JSON.parse(r.out) as Ergebnis).ticket?.nr).toBe(7);
    expect(r.out).not.toContain("GEHEIMER");
  });
});

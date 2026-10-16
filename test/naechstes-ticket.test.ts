import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as raw from "../scripts/naechstes-ticket.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as refs from "../scripts/ticket-refs.mjs";

const R = refs as unknown as { ticketAusRef: (t: string) => number | null; belegteNummern: (e: { refs?: string[]; worktrees?: string[]; prHeads?: string[] }) => Set<number> };
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as boardLib from "../scripts/board-lib.mjs";

type Fenster = { k: number; agent: string; nach: number };
type Stand = { closedAt: string | null; n: number } | { fehler: string };
type Eingabe = { items: unknown[]; offene: Set<number>; refs?: string[]; worktrees?: string[]; prHeads?: string[]; owner?: string; messfenster?: (f: Fenster, wartend: number) => Stand };
type Ergebnis = { ticket: { nr: number; titel: string } | null; uebersprungen: { nr: number; grund: string }[] };
const N = raw as unknown as {
  waehleNaechstes: (e: Eingabe) => Ergebnis;
  blockerNummern: (b: string) => number[];
  formatiere: (e: Ergebnis) => string;
  fuehreAus: (argv: string[], io: { lade: () => Eingabe; ladeEinzeln?: (nr: number) => Eingabe & { item: unknown }; owner: string }) => { code: number; out: string; err: string };
  ticketAusArgv: (argv: string[]) => { ticket: number | null } | { fehler: string };
  itemAusIssue: (i: unknown) => { number: number; title: string; state: string; labels: string[]; body: string; blockedBy: number; autor: { login: string } | null };
  pruefeTicket: (e: Omit<Eingabe, "items"> & { item: unknown }) => Ergebnis;
  bereichAusArgv: (argv: string[]) => { bereich: string | null } | { fehler: string };
  messfensterZeilen: (b: string) => (Fenster | { fehler: string })[];
  ticketsImFenster: (l: { start: number; ticket: number | null }[], o: { closedAt: string; ohneTicket: number }) => number;
  messfensterGrund: (f: Fenster, s: Stand) => string;
  messfensterLader: (o: { dir?: string; holeIssue?: (nr: number) => { state: string; closed_at: string | null } }) => (f: Fenster, wartend: number) => Stand;
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
const frei = (items: unknown[], extra: Partial<Eingabe> & { bereich?: string | null } = {}) =>
  (N.waehleNaechstes as (e: unknown) => Ergebnis)({ items: norm(items), offene: new Set(), owner: "fluffels", ...extra });

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
    expect(R.ticketAusRef("feature/kq-12-foo")).toBe(12);
    expect(R.ticketAusRef("origin/feature/kq-12-foo")).toBe(12);
    expect(R.ticketAusRef("worktree C:/x/.claude/worktrees/kq-12")).toBe(12);
    expect(R.ticketAusRef("worktree C:\\x\\.claude\\worktrees\\kq-12")).toBe(12);
    expect(R.ticketAusRef("feature/kq-123-foo")).toBe(123);
  });
  test("fremde Namen: null (kq-12x, anderes Präfix)", () => {
    expect(R.ticketAusRef("main")).toBeNull();
    expect(R.ticketAusRef("feature/kq-12x")).toBeNull();
    expect(R.ticketAusRef("hotfix/kq-12-a")).toBeNull();
  });
});

describe("belegteNummern", () => {
  test("Branches, Worktrees und PR-Köpfe zählen, fremde Namen nicht", () => {
    const belegt = R.belegteNummern({ refs: ["feature/kq-1-a", "main"], worktrees: ["worktree C:/x/.claude/worktrees/kq-2"], prHeads: ["feature/kq-3-b", "hotfix/kq-4-x"] });
    expect([...belegt].sort()).toEqual([1, 2, 3]);
    expect(R.belegteNummern({}).size).toBe(0);
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

describe("Bereich (#1552)", () => {
  const harness = { labels: [{ name: "area:harness" }] };
  const io = (items: unknown[], spion?: { n: number }) => ({
    owner: "fluffels",
    lade: () => {
      if (spion) spion.n++;
      return { items: norm(items), offene: new Set<number>() };
    },
  });

  test("bereichAusArgv: ohne Schalter null, beide Schreibweisen, neben --json", () => {
    expect(N.bereichAusArgv([])).toEqual({ bereich: null });
    expect(N.bereichAusArgv(["--bereich", "agentic"])).toEqual({ bereich: "agentic" });
    expect(N.bereichAusArgv(["--bereich=spiel"])).toEqual({ bereich: "spiel" });
    expect(N.bereichAusArgv(["--json", "--bereich", "spiel"])).toEqual({ bereich: "spiel" });
  });
  test("bereichAusArgv: fehlender oder unbekannter Wert ist ein Fehler", () => {
    for (const argv of [["--bereich"], ["--bereich", "--json"], ["--bereich", "harness"], ["--bereich", "Agentic"], ["--bereich="], ["--bereich", "constructor"]]) {
      expect(N.bereichAusArgv(argv), argv.join(" ")).toHaveProperty("fehler");
    }
  });
  test("agentic: Spiel-Tickets werden weder gewählt noch als übersprungen gemeldet", () => {
    const r = frei([item(1), item(2, harness)], { bereich: "agentic" });
    expect(r.ticket?.nr).toBe(2);
    expect(r.uebersprungen).toEqual([]);
  });
  test("agentic: ein Assignee im Bereich bleibt übersprungen", () => {
    const r = frei([item(1, { ...harness, assignees: [{ login: "fluffels" }] }), item(2, harness)], { bereich: "agentic" });
    expect(r.ticket?.nr).toBe(2);
    expect(r.uebersprungen).toEqual([{ nr: 1, grund: "Assignee @fluffels" }]);
  });
  test("spiel: Harness-Tickets werden weder gewählt noch gemeldet", () => {
    const r = frei([item(1, harness), item(2)], { bereich: "spiel" });
    expect(r.ticket?.nr).toBe(2);
    expect(r.uebersprungen).toEqual([]);
  });
  test("ohne Schalter: ganzes Board, JSON ohne Schlüssel bereich", () => {
    expect(frei([item(1, harness), item(2)]).ticket?.nr).toBe(1);
    const r = N.fuehreAus(["--json"], io([item(1, harness)]));
    expect(JSON.parse(r.out)).not.toHaveProperty("bereich");
  });
  test("--json mit Bereich nennt den Bereich", () => {
    const r = N.fuehreAus(["--json", "--bereich", "agentic"], io([item(1), item(2, harness)]));
    const j = JSON.parse(r.out) as Ergebnis & { bereich: string };
    expect(j.bereich).toBe("agentic");
    expect(j.ticket?.nr).toBe(2);
  });
  test("nichts frei im Bereich: Exit 1 mit Bereichsname, kein Ausweichen aufs ganze Board", () => {
    const r = N.fuehreAus(["--bereich", "spiel"], io([item(1, harness)]));
    expect(r.code).toBe(1);
    expect(r.out.split("\n")[0]).toBe("kein freies Ticket im Bereich Spielentwicklung");
    const a = N.fuehreAus(["--bereich", "agentic"], io([item(1)]));
    expect(a.out.split("\n")[0]).toBe("kein freies Ticket im Bereich Agentic Engineering");
  });
  test("unbekannter Bereich: Exit 2 vor jedem Laden", () => {
    const spion = { n: 0 };
    const r = N.fuehreAus(["--bereich", "foo"], io([item(1)], spion));
    expect(r.code).toBe(2);
    expect(r.err).toMatch(/agentic.*spiel/);
    expect(spion.n).toBe(0);
  });
  test("Notfälle (rot-main, security) gelten in beiden Bereichen", () => {
    const rot = item(1, { title: "🚨 CI rot auf main: x", labels: [{ name: "area:architektur" }] });
    const sec = item(2, { title: "🔒 Security: y", labels: [{ name: "area:harness" }] });
    expect(frei([rot], { bereich: "agentic" }).ticket?.nr).toBe(1);
    expect(frei([sec], { bereich: "spiel" }).ticket?.nr).toBe(2);
  });
  test("die Notfall-Ausnahme bleibt eng: Dependabot folgt dem Label", () => {
    const dep = item(1, { title: "🤖 Dependabot-PRs auflösen", labels: [{ name: "area:architektur" }] });
    const r = frei([dep], { bereich: "agentic" });
    expect(r.ticket).toBeNull();
    expect(r.uebersprungen).toEqual([]);
  });
});

describe("prHeadsAus: REST-Form der offenen PRs (#1549 Z1)", () => {
  const P = raw as unknown as { prHeadsAus: (s: unknown[]) => string[] };
  test("flacht die Seiten ab und liest head.ref", () => {
    const seiten = [[{ head: { ref: "feature/kq-1-a" } }, { head: { ref: "feature/kq-2-b" } }], [{ head: { ref: "feature/kq-3-c" } }]];
    expect(P.prHeadsAus(seiten)).toEqual(["feature/kq-1-a", "feature/kq-2-b", "feature/kq-3-c"]);
    expect(P.prHeadsAus([])).toEqual([]);
    expect(P.prHeadsAus([[]])).toEqual([]);
  });
});

describe("messfensterZeilen (#1589)", () => {
  const F = { k: 12, agent: "kubernia-umsetzer", nach: 1590 };
  test("ohne Zeile: leer; eine Erwähnung im Fließtext ist keine Zeile", () => {
    expect(N.messfensterZeilen("nichts")).toEqual([]);
    expect(N.messfensterZeilen(null as unknown as string)).toEqual([]);
    expect(N.messfensterZeilen("**Ziel:** Ein Issue mit der Body-Zeile `Messfenster: n ≥ 12 kubernia-umsetzer nach #1590` ist frei")).toEqual([]);
  });
  test("gültig: ≥ oder >=, Listenpunkt, CRLF, Groß-/Kleinschreibung", () => {
    expect(N.messfensterZeilen("Messfenster: n ≥ 12 kubernia-umsetzer nach #1590")).toEqual([F]);
    expect(N.messfensterZeilen("Messfenster: n >= 12 kubernia-umsetzer nach #1590")).toEqual([F]);
    expect(N.messfensterZeilen("- messfenster: n ≥ 12 kubernia-umsetzer nach #1590")).toEqual([F]);
    expect(N.messfensterZeilen("x\r\nMessfenster: n ≥ 12 kubernia-umsetzer nach #1590\r\ny")).toEqual([F]);
  });
  test("Schlusspunkt erlaubt, Folgetext nach der Nummer ist unlesbar", () => {
    expect(N.messfensterZeilen("Messfenster: n ≥ 12 kubernia-umsetzer nach #1590.")).toEqual([F]);
    expect(N.messfensterZeilen("Messfenster: n ≥ 12 kubernia-umsetzer nach #1590 (Hinweis)")[0]).toHaveProperty("fehler");
  });
  test("mehrere Zeilen: mehrere Fenster", () => {
    expect(N.messfensterZeilen("Messfenster: n ≥ 12 kubernia-umsetzer nach #1590\nMessfenster: n ≥ 3 kubernia-lens nach #7")).toEqual([F, { k: 3, agent: "kubernia-lens", nach: 7 }]);
  });
  test.each(["n ≥ zehn kubernia-umsetzer nach #1", "n ≥ 0 kubernia-umsetzer nach #1", "n ≥ <k> kubernia-umsetzer nach #<nr>", "n ≥ 5 kubernia-umsetzer nach 1590", "n ≥ 5 nach #1"])(
    "kaputte Zeile „%s“: fehler",
    (rest) => {
      const r = N.messfensterZeilen(`Messfenster: ${rest}`);
      expect(r).toHaveLength(1);
      expect(r[0]).toHaveProperty("fehler");
    },
  );
});

describe("ticketsImFenster (#1589, je Ticket #1646)", () => {
  const t0 = Date.parse("2026-10-15T16:00:00Z");
  const ab = { closedAt: "2026-10-15T16:00:00Z", ohneTicket: 99 };
  test("Start < closedAt zählt nicht, Start == closedAt zählt", () => {
    expect(N.ticketsImFenster([{ start: t0 - 1, ticket: 5 }, { start: t0, ticket: 6 }, { start: t0 + 1, ticket: 7 }], ab)).toBe(2);
  });
  test("zwei Läufe eines Tickets zählen als ein Ticket", () => {
    expect(N.ticketsImFenster([{ start: t0, ticket: 5 }, { start: t0 + 5, ticket: 5 }], ab)).toBe(1);
  });
  test("das wartende Ticket und Läufe ohne Ticket zählen nicht (konservative Untergrenze)", () => {
    expect(N.ticketsImFenster([{ start: t0, ticket: 99 }, { start: t0, ticket: null }, { start: t0, ticket: 4 }], ab)).toBe(1);
    expect(N.ticketsImFenster([{ start: t0, ticket: null }], ab)).toBe(0);
  });
});

describe("messfensterGrund (#1589)", () => {
  const F = { k: 12, agent: "kubernia-umsetzer", nach: 1590 };
  test("offen: wie ein Blocker; Fehler: nicht prüfbar", () => {
    expect(N.messfensterGrund(F, { closedAt: null, n: 0 })).toBe("offener Blocker #1590 (Messfenster)");
    expect(N.messfensterGrund(F, { fehler: "Messfenster nicht prüfbar (x)" })).toContain("nicht prüfbar");
  });
  test("n = k−1 gesperrt mit exaktem Grund, n = k und n > k frei", () => {
    expect(N.messfensterGrund(F, { closedAt: "2026-10-15T16:00:00Z", n: 11 })).toBe("Messfenster offen (11/12 Tickets mit kubernia-umsetzer nach #1590)");
    expect(N.messfensterGrund(F, { closedAt: "2026-10-15T16:00:00Z", n: 12 })).toBe("");
    expect(N.messfensterGrund(F, { closedAt: "2026-10-15T16:00:00Z", n: 13 })).toBe("");
  });
});

describe("waehleNaechstes mit Messfenster (#1589)", () => {
  const zeile = "Messfenster: n ≥ 12 kubernia-umsetzer nach #1590";
  const lader = (stand: Stand) => {
    const aufrufe: number[] = [];
    return { aufrufe, fn: (_f: Fenster, wartend: number) => (aufrufe.push(wartend), stand) };
  };
  const frist = "2026-10-15T16:00:00Z";
  test("#X offen: übersprungen, Lader nicht aufgerufen", () => {
    const l = lader({ closedAt: frist, n: 99 });
    const r = frei([item(1, { body: zeile }), item(2)], { offene: new Set([1590]), messfenster: l.fn });
    expect(r.ticket?.nr).toBe(2);
    expect(r.uebersprungen[0].grund).toBe("offener Blocker #1590 (Messfenster)");
    expect(l.aufrufe).toEqual([]);
  });
  test("n < k übersprungen, n = k frei", () => {
    const zu = lader({ closedAt: frist, n: 4 });
    const r = frei([item(1, { body: zeile }), item(2)], { messfenster: zu.fn });
    expect(r.ticket?.nr).toBe(2);
    expect(r.uebersprungen[0].grund).toBe("Messfenster offen (4/12 Tickets mit kubernia-umsetzer nach #1590)");
    expect(zu.aufrufe).toEqual([1]);
    expect(frei([item(1, { body: zeile })], { messfenster: lader({ closedAt: frist, n: 12 }).fn }).ticket?.nr).toBe(1);
  });
  test("ohne Zeile, mit Assignee oder belegtem Branch: Lader nie aufgerufen", () => {
    const l = lader({ closedAt: frist, n: 0 });
    frei([item(1), item(2, { body: zeile, assignees: [{ login: "x" }] }), item(3, { body: zeile })], { refs: ["feature/kq-3-a"], messfenster: l.fn });
    expect(l.aufrufe).toEqual([]);
  });
  test("mehrere Zeilen: jede muss erfüllt sein (auch die zweite)", () => {
    const body = `${zeile}\nMessfenster: n ≥ 3 kubernia-lens nach #1600`;
    const nachAgent = (f: Fenster) => (f.agent === "kubernia-lens" ? { closedAt: frist, n: 2 } : { closedAt: frist, n: 50 });
    const r = frei([item(1, { body }), item(2)], { messfenster: nachAgent });
    expect(r.ticket?.nr).toBe(2);
    expect(r.uebersprungen[0].grund).toBe("Messfenster offen (2/3 Tickets mit kubernia-lens nach #1600)");
    expect(frei([item(1, { body })], { messfenster: () => ({ closedAt: frist, n: 50 }) }).ticket?.nr).toBe(1);
    const offen = frei([item(1, { body }), item(2)], { offene: new Set([1600]), messfenster: lader({ closedAt: frist, n: 50 }).fn });
    expect(offen.uebersprungen[0].grund).toBe("offener Blocker #1600 (Messfenster)");
  });
  test("ohne Lader fail-closed; Lader-Fehler übersprungen mit Grund", () => {
    const r = frei([item(1, { body: zeile }), item(2)]);
    expect(r.ticket?.nr).toBe(2);
    expect(r.uebersprungen[0].grund).toContain("nicht prüfbar");
    const f = frei([item(1, { body: zeile })], { messfenster: () => ({ fehler: "Messfenster nicht prüfbar (keine lokalen Transkripte)" }) });
    expect(f.ticket).toBeNull();
    expect(f.uebersprungen[0].grund).toBe("Messfenster nicht prüfbar (keine lokalen Transkripte)");
  });
  test("unlesbare Zeile: fail-closed, der Body-Text taucht nirgends auf", () => {
    const eingabe = { items: norm([item(1, { body: "Messfenster: n ≥ GEHEIM kubernia-umsetzer nach #1" })]), offene: new Set<number>() };
    const r = N.fuehreAus(["--json"], { owner: "fluffels", lade: () => eingabe });
    expect(r.code).toBe(1);
    expect(r.out).toContain("unlesbar");
    expect(r.out).not.toContain("GEHEIM");
    expect(N.fuehreAus([], { owner: "fluffels", lade: () => eingabe }).out).not.toContain("GEHEIM");
  });
});

describe("messfensterLader (#1589)", () => {
  const F = { k: 2, agent: "kubernia-umsetzer", nach: 1590 };
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });
  const zu = () => ({ state: "closed", closed_at: "2026-10-15T10:00:00Z" });
  const lauf = (dir: string, name: string, agentType: string, ticket: number, ts: string) => {
    const sub = join(dir, "sess", "subagents");
    mkdirSync(sub, { recursive: true });
    writeFileSync(join(sub, `${name}.meta.json`), JSON.stringify({ agentType, description: "x" }));
    writeFileSync(join(sub, `${name}.jsonl`), `${JSON.stringify({ type: "user", timestamp: ts, message: { role: "user", content: `Ticket #${ticket}: los` } })}\n`);
  };
  const tmp = () => {
    const d = mkdtempSync(join(tmpdir(), "kq-mf-"));
    dirs.push(d);
    return d;
  };
  test("fehlender Ordner: fehler ohne Pfad im Text", () => {
    const r = N.messfensterLader({ dir: join(tmpdir(), "kq-gibt-es-nicht-1589"), holeIssue: zu })(F, 1591);
    expect(r).toEqual({ fehler: "Messfenster nicht prüfbar (keine lokalen Transkripte)" });
  });
  test("zählt Läufe des Typs ab closedAt, ohne die des wartenden Tickets", () => {
    const d = tmp();
    lauf(d, "a", "kubernia-umsetzer", 1600, "2026-10-15T11:00:00Z");
    lauf(d, "b", "kubernia-umsetzer", 1601, "2026-10-15T12:00:00Z");
    lauf(d, "c", "kubernia-umsetzer", 1591, "2026-10-15T13:00:00Z");
    lauf(d, "d", "kubernia-lens", 1602, "2026-10-15T13:00:00Z");
    lauf(d, "e", "kubernia-umsetzer", 1603, "2026-10-15T09:00:00Z");
    expect(N.messfensterLader({ dir: d, holeIssue: zu })(F, 1591)).toEqual({ closedAt: "2026-10-15T10:00:00Z", n: 2 });
  });
  test("offenes Issue: closedAt null; Abruffehler: fehler", () => {
    const d = tmp();
    expect(N.messfensterLader({ dir: d, holeIssue: () => ({ state: "open", closed_at: null }) })(F, 1591)).toEqual({ closedAt: null, n: 0 });
    const r = N.messfensterLader({ dir: d, holeIssue: () => { throw new Error("boom"); } })(F, 1591);
    expect(r).toEqual({ fehler: "Messfenster nicht prüfbar (#1590 nicht abrufbar)" });
  });
  test("Transkript-Pfad ist eine Datei: fail-closed „nicht lesbar“", () => {
    const d = tmp();
    const datei = join(d, "keine-ordner");
    writeFileSync(datei, "x");
    expect(N.messfensterLader({ dir: datei, holeIssue: zu })(F, 1591)).toEqual({ fehler: "Messfenster nicht prüfbar (Transkripte nicht lesbar)" });
  });
  test("ein frisch gestarteter Lauf ohne Zeitstempel macht das Fenster nicht unprüfbar und zählt nicht", () => {
    const d = tmp();
    lauf(d, "a", "kubernia-umsetzer", 1600, "2026-10-15T11:00:00Z");
    const sub = join(d, "sess", "subagents");
    writeFileSync(join(sub, "leer.meta.json"), JSON.stringify({ agentType: "kubernia-umsetzer" }));
    writeFileSync(join(sub, "leer.jsonl"), "");
    expect(N.messfensterLader({ dir: d, holeIssue: zu })(F, 1591)).toEqual({ closedAt: "2026-10-15T10:00:00Z", n: 1 });
  });
  test("Memo-Schlüssel ist agent und nach: anderer Agent-Typ oder andere Nummer bekommt eigene Läufe und eigenen Abruf", () => {
    const d = tmp();
    lauf(d, "a", "kubernia-umsetzer", 1600, "2026-10-15T11:00:00Z");
    lauf(d, "b", "kubernia-umsetzer", 1601, "2026-10-15T12:00:00Z");
    lauf(d, "c", "kubernia-lens", 1602, "2026-10-15T13:00:00Z");
    const abrufe: number[] = [];
    const holeIssue = (nr: number) => (abrufe.push(nr), nr === 1590 ? zu() : { state: "open", closed_at: null });
    const lader = N.messfensterLader({ dir: d, holeIssue });
    expect(lader(F, 1591)).toEqual({ closedAt: "2026-10-15T10:00:00Z", n: 2 });
    expect(lader({ ...F, agent: "kubernia-lens" }, 1591)).toEqual({ closedAt: "2026-10-15T10:00:00Z", n: 1 });
    expect(lader({ ...F, nach: 1700 }, 1591)).toEqual({ closedAt: null, n: 0 });
    lader(F, 1592);
    lader({ ...F, agent: "kubernia-lens" }, 1592);
    expect(abrufe).toEqual([1590, 1590, 1700]);
  });
  test("offenes Issue ohne Transkript-Ordner: Grund bleibt „offen“, nicht „keine Transkripte“", () => {
    const r = N.messfensterLader({ dir: join(tmpdir(), "kq-gibt-es-nicht-1589"), holeIssue: () => ({ state: "open", closed_at: null }) })(F, 1591);
    expect(r).toEqual({ closedAt: null, n: 0 });
  });
  test("Memo je Fenster: ein REST-Aufruf, aber die Zählung gilt je wartendem Ticket", () => {
    const d = tmp();
    lauf(d, "a", "kubernia-umsetzer", 1600, "2026-10-15T11:00:00Z");
    lauf(d, "b", "kubernia-umsetzer", 1591, "2026-10-15T12:00:00Z");
    let aufrufe = 0;
    const lader = N.messfensterLader({ dir: d, holeIssue: () => (aufrufe++, zu()) });
    expect(lader(F, 1591)).toEqual({ closedAt: "2026-10-15T10:00:00Z", n: 1 });
    expect(lader(F, 1600)).toEqual({ closedAt: "2026-10-15T10:00:00Z", n: 1 });
    expect(lader(F, 1700)).toEqual({ closedAt: "2026-10-15T10:00:00Z", n: 2 });
    expect(aufrufe).toBe(1);
  });
});

describe("Einzelprüfung --ticket (#1621)", () => {
  const issue = (nr: number, c: Record<string, unknown> = {}) => item(nr, c).content;
  const pruefe = (nr: number, c: Record<string, unknown> = {}, extra: Partial<Eingabe> = {}) =>
    N.pruefeTicket({ item: N.itemAusIssue(issue(nr, c)), offene: new Set(), owner: "fluffels", ...extra });
  const grund = (r: Ergebnis) => r.uebersprungen[0]?.grund;
  const zeile = "Messfenster: n ≥ 12 kubernia-umsetzer nach #1590";

  test("ticketAusArgv: ohne Schalter null, drei Schreibweisen, Fehler bei fehlendem oder ungültigem Wert", () => {
    expect(N.ticketAusArgv([])).toEqual({ ticket: null });
    expect(N.ticketAusArgv(["--ticket", "12"])).toEqual({ ticket: 12 });
    expect(N.ticketAusArgv(["--ticket=12"])).toEqual({ ticket: 12 });
    expect(N.ticketAusArgv(["--ticket", "#12"])).toEqual({ ticket: 12 });
    for (const bad of [[], ["abc"], ["0"], ["-3"], ["12x"]]) expect(N.ticketAusArgv(["--ticket", ...bad])).toHaveProperty("fehler");
  });
  test("itemAusIssue: REST-Issue wird normalisiert; PR und kaputte Form werfen", () => {
    const i = N.itemAusIssue(issue(7, { body: "b", labels: [{ name: "x" }], issue_dependencies_summary: { blocked_by: 2 } }));
    expect(i).toMatchObject({ number: 7, title: "T7", state: "open", labels: ["x"], body: "b", blockedBy: 2, autor: { login: "fluffels" } });
    expect(() => N.itemAusIssue({ ...issue(7), pull_request: {} })).toThrow();
    expect(() => N.itemAusIssue({ title: "ohne Nummer" })).toThrow();
    expect(() => N.itemAusIssue(null)).toThrow();
  });
  test("pruefeTicket: frei", () => {
    expect(pruefe(7)).toEqual({ ticket: { nr: 7, titel: "T7" }, uebersprungen: [] });
  });
  test("pruefeTicket: geschlossen, Assignee, Blocker, Fremdeingang, belegt", () => {
    expect(grund(pruefe(7, { state: "closed" }))).toBe("geschlossen");
    expect(grund(pruefe(7, { assignees: [{ login: "fluffels" }] }))).toBe("Assignee @fluffels");
    expect(grund(pruefe(7, { body: "blockiert durch #5" }, { offene: new Set([5]) }))).toBe("offener Blocker #5");
    expect(grund(pruefe(7, { labels: [{ name: "forum" }] }))).toContain("Fremdeingang");
    expect(grund(pruefe(7, { user: { login: "fremd", type: "User" } }))).toContain("Fremdeingang");
    const belegt = "Branch, Worktree oder offener PR vorhanden";
    expect(grund(pruefe(7, {}, { refs: ["feature/kq-7-x"] }))).toBe(belegt);
    expect(grund(pruefe(7, {}, { prHeads: ["feature/kq-7-x"] }))).toBe(belegt);
    expect(grund(pruefe(7, {}, { worktrees: ["branch refs/heads/feature/kq-7-x"] }))).toBe(belegt);
  });
  test("pruefeTicket: Messfenster zählt, auch fail-closed; ein anderer Status als Todo ist kein Grund", () => {
    const stand = (s: Stand) => () => s;
    expect(grund(pruefe(7, { body: zeile }, { messfenster: stand({ closedAt: "2026-10-15T10:00:00Z", n: 4 }) }))).toBe("Messfenster offen (4/12 Tickets mit kubernia-umsetzer nach #1590)");
    expect(grund(pruefe(7, { body: zeile }, { messfenster: stand({ fehler: "Messfenster nicht prüfbar (x)" }) }))).toBe("Messfenster nicht prüfbar (x)");
    expect(pruefe(7, { body: zeile }, { messfenster: stand({ closedAt: "2026-10-15T10:00:00Z", n: 12 }) }).ticket?.nr).toBe(7);
  });

  const io = (e: Error | null = null) => {
    const aufrufe = { lade: 0, einzeln: 0 };
    return {
      aufrufe,
      owner: "fluffels",
      lade: () => {
        aufrufe.lade++;
        return { items: [], offene: new Set<number>() };
      },
      ladeEinzeln: (nr: number) => {
        aufrufe.einzeln++;
        if (e) throw e;
        return { item: N.itemAusIssue(issue(nr, { body: "GEHEIMER BODY" })), offene: new Set<number>() } as never;
      },
    };
  };
  test("fuehreAus Einzelmodus: frei Exit 0 mit #nr TAB Titel, Board-Lader bleibt unbenutzt", () => {
    const i = io();
    const r = N.fuehreAus(["--ticket", "7"], i);
    expect(r).toMatchObject({ code: 0, out: "#7\tT7\n" });
    expect(i.aufrufe).toEqual({ lade: 0, einzeln: 1 });
  });
  test("fuehreAus Einzelmodus: nicht frei Exit 1 mit Grund, json ohne Body", () => {
    const i = io();
    const geschlossen = { ...i, ladeEinzeln: () => ({ item: N.itemAusIssue(issue(7, { state: "closed" })), offene: new Set<number>() }) as never };
    expect(N.fuehreAus(["--ticket=7"], geschlossen)).toMatchObject({ code: 1, out: "#7 nicht frei: geschlossen\n" });
    const j = N.fuehreAus(["--ticket", "7", "--json"], i);
    expect(j.out).not.toContain("GEHEIMER");
    expect((JSON.parse(j.out) as Ergebnis).ticket?.nr).toBe(7);
  });
  test("fuehreAus: --ticket mit --bereich, ungültige Nummer oder Ladefehler sind Exit 2, bei der Bereichskollision ohne jeden Ladeaufruf", () => {
    const i = io();
    expect(N.fuehreAus(["--ticket", "7", "--bereich", "spiel"], i).code).toBe(2);
    expect(i.aufrufe).toEqual({ lade: 0, einzeln: 0 });
    expect(N.fuehreAus(["--ticket", "abc"], i).code).toBe(2);
    const r = N.fuehreAus(["--ticket", "7"], io(new Error("kein Netz")));
    expect(r.code).toBe(2);
    expect(r.err).toContain("kein Netz");
  });
});

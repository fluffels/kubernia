import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as raw from "../scripts/naechstes-ticket.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as refs from "../scripts/ticket-refs.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as namenRoh from "../scripts/ticket-namen.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as ladeCfg from "../scripts/projekt-config-lib.mjs";
import { FREMD, projektConfig, FREMD_OWNER, FREMD_NAMEN } from "./support/fremd-config";

const ticketNamen = (namenRoh as unknown as { ticketNamen: (c: unknown) => unknown }).ticketNamen;

const OWNER = FREMD_OWNER; // Login des Maintainer-Accounts, nur Testdaten
const NAMEN = FREMD_NAMEN;
const ECHT = projektConfig().praefixe; // Standardpfad ohne `namen`: die Config des Projekts wird je Aufruf geladen
const WTP = FREMD.praefixe.worktree;
const BRP = FREMD.praefixe.branch;
const UMS = FREMD.agenten.umsetzer;
const LENS = FREMD.agenten.lens;
const HARNESS = FREMD.labels.harness;

const R = refs as unknown as { ticketAusRef: (t: string, n?: unknown) => number | null; belegteNummern: (e: { refs?: string[]; worktrees?: string[]; prHeads?: string[] }, n?: unknown) => Set<number> };
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as boardLib from "../scripts/board-lib.mjs";

type Fenster = { k: number; agent: string; nach: number };
type Stand = { closedAt: string | null; n: number } | { fehler: string };
type Eingabe = { items: unknown[]; offene: Set<number>; fuellstand?: (nr: number) => number | { fehler: string }; config?: unknown; refs?: string[]; worktrees?: string[]; prHeads?: string[]; owner?: string; namen?: unknown; messfenster?: (f: Fenster, wartend: number) => Stand };
type Ergebnis = { ticket: { nr: number; titel: string } | null; uebersprungen: { nr: number; grund: string }[] };
type ZweiBoards = Omit<Eingabe, "items"> & { produkt: unknown[]; factory: unknown[] };
type Io = { lade: () => ZweiBoards; ladeEinzeln?: (nr: number) => Eingabe & { item: unknown }; owner: string; namen?: unknown; config?: unknown; hartAb?: number };
const N = raw as unknown as {
  waehleNaechstes: (e: Eingabe) => Ergebnis;
  formatiere: (e: Ergebnis) => string;
  fuehreAus: (argv: string[], io: Io) => { code: number; out: string; err: string };
  waehleUeberBoards: (e: unknown) => Ergebnis & { hinweise?: string[] };
  aufrufLesen: (argv: string[]) => { bereich?: string | null; ticket?: number | null; json?: boolean; fehler?: string };
  itemAusIssue: (i: unknown) => { number: number; title: string; state: string; labels: string[]; body: string; blockedBy: number; autor: { login: string } | null };
  pruefeTicket: (e: Omit<Eingabe, "items"> & { item: unknown }) => Ergebnis;
  messfensterZeilen: (b: string) => (Fenster | { fehler: string })[];
  ticketsImFenster: (l: { start: number; ticket: number | null }[], o: { closedAt: string; ohneTicket: number }) => number;
  messfensterGrund: (f: Fenster, s: Stand) => string;
  messfensterLader: (o: { dir?: string; holeIssue?: (nr: number) => { state: string; closed_at: string | null }; ladeNamen?: () => unknown }) => (f: Fenster, wartend: number) => Stand;
};

// Ein Parse-Pfad (#1460 Z8): die Roh-Fixtures (REST-Form) laufen wie im Echtbetrieb durch normalizeItems, waehleNaechstes sieht nur Normalisiertes.
const normalizeItems = (boardLib as unknown as { normalizeItems: (pages: unknown[][]) => unknown[] }).normalizeItems;
const norm = (items: unknown[]) => normalizeItems([items]);

const messfensterLader = (o: Parameters<typeof N.messfensterLader>[0] = {}) => N.messfensterLader({ ladeNamen: () => NAMEN, ...o });
const SPEZ = "## Ziel\nZ\n\n## Akzeptanzkriterien\n- Negativfall: A\n\n";
// Standard-Item trägt eine gültige Spezifikation (Spezifikations-Gate, #1615); `roh` ohne.
const item = (nr: number, c: Record<string, unknown> = {}, status = "Todo") => roh(nr, { ...c, body: SPEZ + (typeof c.body === "string" ? c.body : "") }, status);
const roh = (nr: number, c: Record<string, unknown> = {}, status = "Todo") => ({
  node_id: `ITEM_${nr}`,
  content_type: "Issue",
  fields: [{ name: "Status", value: { name: { raw: status } } }],
  content: { number: nr, title: `T${nr}`, state: "open", assignees: [], user: { login: OWNER, type: "User" }, labels: [], body: "", issue_dependencies_summary: { blocked_by: 0 }, ...c },
});
// Zwei Boards (#1729): die Eingabe der alten Form (ein Board) steht auf dem Produkt-Board; Harness-Items rücken laut Trennregel auf die Factory-Seite.
const CFG = { labels: { harness: HARNESS, forum: FREMD.labels.forum }, sprache: (ladeCfg as unknown as { ladeProjektConfig: () => { sprache: unknown } }).ladeProjektConfig().sprache };
const zweiBoards = (e: Eingabe): ZweiBoards => ({ ...e, produkt: e.items, factory: [] });
const frei = (items: unknown[], extra: Partial<Eingabe> & { bereich?: string | null } = {}) =>
  (N.waehleNaechstes as (e: unknown) => Ergebnis)({ items: norm(items), offene: new Set(), owner: OWNER, namen: NAMEN, config: CFG, ...extra });

describe("Blocker-Zeile aus der Sprache (#1860)", () => {
  const sprache = (CFG.sprache as { spezifikation: Record<string, unknown> }).spezifikation;
  const cfgMit = (blocker: string) => ({ ...CFG, sprache: { ...(CFG.sprache as object), spezifikation: { ...sprache, blocker } } });
  test("das Blocker-Wort der Config sperrt; ein anderes Wort sperrt nicht", () => {
    const offene = new Set([1, 50]);
    expect(frei([item(1, { body: "blocked by #50" })], { offene, config: cfgMit("blocked by") }).ticket).toBeNull();
    expect(frei([item(1, { body: "blockiert durch #50" })], { offene, config: cfgMit("blocked by") }).ticket?.nr).toBe(1);
  });
});

describe("ticketAusRef", () => {
  test("Branch, Remote-Ref, Worktree-Zeile", () => {
    expect(R.ticketAusRef(`${BRP}12-foo`, NAMEN)).toBe(12);
    expect(R.ticketAusRef(`origin/${BRP}12-foo`, NAMEN)).toBe(12);
    expect(R.ticketAusRef(`worktree C:/x/.claude/worktrees/${WTP}12`, NAMEN)).toBe(12);
    expect(R.ticketAusRef(`worktree C:\\x\\.claude\\worktrees\\${WTP}12`, NAMEN)).toBe(12);
    expect(R.ticketAusRef(`${BRP}123-foo`, NAMEN)).toBe(123);
  });
  test("ohne namen gilt das Präfix der Projekt-Config, ein fremdes nicht", () => {
    expect(R.ticketAusRef(`${ECHT.branch}12-foo`)).toBe(12);
    expect(R.ticketAusRef(`${BRP}12-foo`)).toBeNull();
    expect([...R.belegteNummern({ refs: [`${ECHT.branch}1-a`, `${BRP}2-b`], worktrees: [`worktree C:/x/.claude/worktrees/${ECHT.worktree}3`] })].sort()).toEqual([1, 3]);
  });
  test(`fremde Namen: null (${WTP}12x, anderes Präfix)`, () => {
    expect(R.ticketAusRef("main", NAMEN)).toBeNull();
    expect(R.ticketAusRef(`${BRP}12x`, NAMEN)).toBeNull();
    expect(R.ticketAusRef(`hotfix/${WTP}12-a`, NAMEN)).toBeNull();
  });
});

describe("belegteNummern", () => {
  test("Branches, Worktrees und PR-Köpfe zählen, fremde Namen nicht", () => {
    const belegt = R.belegteNummern({ refs: [`${BRP}1-a`, "main"], worktrees: [`worktree C:/x/.claude/worktrees/${WTP}2`], prHeads: [`${BRP}3-b`, `hotfix/${WTP}4-x`] }, NAMEN);
    expect([...belegt].sort()).toEqual([1, 2, 3]);
    expect(R.belegteNummern({}, NAMEN).size).toBe(0);
  });
});

describe("waehleNaechstes: jedes Kriterium mit Negativfall", () => {
  test("das oberste freie Item gewinnt", () => {
    expect(frei([item(1), item(2)]).ticket).toEqual({ nr: 1, titel: "T1" });
  });
  test("Assignee: übersprungen, nächstes frei", () => {
    const r = frei([item(1, { assignees: [{ login: OWNER }] }), item(2)]);
    expect(r.ticket?.nr).toBe(2);
    expect(r.uebersprungen).toEqual([{ nr: 1, grund: `Assignee @${OWNER}` }]);
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
    expect(frei([item(1), item(2)], { refs: [`origin/${BRP}1-x`] }).ticket?.nr).toBe(2);
    expect(frei([item(1), item(2)], { worktrees: [`worktree C:/a/.claude/worktrees/${WTP}1`] }).ticket?.nr).toBe(2);
    expect(frei([item(1), item(2)], { prHeads: [`${BRP}1-y`] }).ticket?.nr).toBe(2);
  });
  test("Fremdeingang: fremder Autor oder Forum-Label wird übersprungen mit Hinweis „Befund melden“", () => {
    const r = frei([item(1, { user: { login: "fremd", type: "User" } }), item(2, { labels: [{ name: FREMD.labels.forum }] }), item(3)]);
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
    owner: OWNER, namen: NAMEN,
    config: CFG,
    lade: () => {
      if (eingabe instanceof Error) throw eingabe;
      return zweiBoards(eingabe);
    },
  });
  test("gefunden: Exit 0, erste Zeile `#nr<TAB>Titel`", () => {
    const r = N.fuehreAus(["--bereich", "spiel"], io({ items: norm([item(7)]), offene: new Set() }));
    expect(r.code).toBe(0);
    expect(r.out.split("\n")[0]).toBe("#7\tT7");
  });
  test("kein freies: Exit 1", () => {
    expect(N.fuehreAus(["--bereich", "spiel"], io({ items: [], offene: new Set() })).code).toBe(1);
  });
  test("Fehler beim Laden: Exit 2 mit Meldung", () => {
    const r = N.fuehreAus(["--bereich", "spiel"], io(new Error("kein Netz")));
    expect(r.code).toBe(2);
    expect(r.err).toContain("kein Netz");
  });
  test("--json: parsebar; der Body erscheint nie in der Ausgabe", () => {
    const r = N.fuehreAus(["--json", "--bereich", "spiel"], io({ items: norm([item(7, { body: "GEHEIMER BODY" })]), offene: new Set() }));
    expect((JSON.parse(r.out) as Ergebnis).ticket?.nr).toBe(7);
    expect(r.out).not.toContain("GEHEIMER");
  });
});

describe("Bereich (#1552)", () => {
  const harness = { labels: [{ name: HARNESS }] };
  const io = (items: unknown[], spion?: { n: number }) => ({
    owner: OWNER, namen: NAMEN,
    config: CFG,
    lade: () => {
      if (spion) spion.n++;
      return zweiBoards({ items: norm(items), offene: new Set<number>() });
    },
  });

  test("aufrufLesen: --bereich in beiden Schreibweisen, neben --json", () => {
    expect(N.aufrufLesen(["--bereich", "agentic"])).toEqual({ bereich: "agentic", ticket: null, json: false });
    expect(N.aufrufLesen(["--bereich=spiel"])).toEqual({ bereich: "spiel", ticket: null, json: false });
    expect(N.aufrufLesen(["--json", "--bereich", "spiel"])).toEqual({ bereich: "spiel", ticket: null, json: true });
  });
  test("aufrufLesen: fehlender oder unbekannter --bereich-Wert ist ein Fehler mit dem alten Text", () => {
    for (const argv of [["--bereich"], ["--bereich", "--json"], ["--bereich="]]) {
      expect(N.aufrufLesen(argv).fehler, argv.join(" ")).toBe("--bereich erwartet agentic oder spiel (bekommen: nichts)");
    }
    for (const argv of [["--bereich", "harness"], ["--bereich", "Agentic"], ["--bereich", "constructor"], ["--bereich", ""]]) {
      expect(N.aufrufLesen(argv).fehler, argv.join(" ")).toMatch(/^--bereich erwartet agentic oder spiel \(bekommen: „.*“\)$/);
    }
  });
  test("aufrufLesen: unbekanntes Flag, Positionsargument, doppeltes Flag, beide Schalter und keine Auswahl sind Fehler", () => {
    expect(N.aufrufLesen(["--bogus"]).fehler).toBe("Unbekanntes Argument: --bogus");
    expect(N.aufrufLesen(["--bereich", "spiel", "x"]).fehler).toBe("Unbekanntes Argument: x");
    expect(N.aufrufLesen(["--bereich", "spiel", "--bereich", "agentic"]).fehler).toBe("--bereich ist doppelt angegeben");
    expect(N.aufrufLesen(["--ticket", "1", "--bereich", "spiel"]).fehler).toBe("--ticket und --bereich schließen sich aus");
    expect(N.aufrufLesen([]).fehler).toMatch(/^Aufruf ohne Auswahl: /);
    expect(N.aufrufLesen(["--json"]).fehler).toMatch(/^Aufruf ohne Auswahl: /);
  });
  test("agentic: Spiel-Tickets werden weder gewählt noch als übersprungen gemeldet", () => {
    const r = frei([item(1), item(2, harness)], { bereich: "agentic" });
    expect(r.ticket?.nr).toBe(2);
    expect(r.uebersprungen).toEqual([]);
  });
  test("agentic: ein Assignee im Bereich bleibt übersprungen", () => {
    const r = frei([item(1, { ...harness, assignees: [{ login: OWNER }] }), item(2, harness)], { bereich: "agentic" });
    expect(r.ticket?.nr).toBe(2);
    expect(r.uebersprungen).toEqual([{ nr: 1, grund: `Assignee @${OWNER}` }]);
  });
  test("spiel: Harness-Tickets werden weder gewählt noch gemeldet", () => {
    const r = frei([item(1, harness), item(2)], { bereich: "spiel" });
    expect(r.ticket?.nr).toBe(2);
    expect(r.uebersprungen).toEqual([]);
  });
  test("waehleNaechstes ohne Bereich bleibt das ganze Board (Baustein, kein Aufrufmodus)", () => {
    expect(frei([item(1, harness), item(2)]).ticket?.nr).toBe(1);
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
    const sec = item(2, { title: "🔒 Security: y", labels: [{ name: HARNESS }] });
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
    const seiten = [[{ head: { ref: `${BRP}1-a` } }, { head: { ref: `${BRP}2-b` } }], [{ head: { ref: `${BRP}3-c` } }]];
    expect(P.prHeadsAus(seiten)).toEqual([`${BRP}1-a`, `${BRP}2-b`, `${BRP}3-c`]);
    expect(P.prHeadsAus([])).toEqual([]);
    expect(P.prHeadsAus([[]])).toEqual([]);
  });
});

describe("messfensterZeilen (#1589)", () => {
  const F = { k: 12, agent: `${UMS}`, nach: 1590 };
  test("ohne Zeile: leer; eine Erwähnung im Fließtext ist keine Zeile", () => {
    expect(N.messfensterZeilen("nichts")).toEqual([]);
    expect(N.messfensterZeilen(null as unknown as string)).toEqual([]);
    expect(N.messfensterZeilen(`**Ziel:** Ein Issue mit der Body-Zeile \`Messfenster: n ≥ 12 ${UMS} nach #1590\` ist frei`)).toEqual([]);
  });
  test("gültig: ≥ oder >=, Listenpunkt, CRLF, Groß-/Kleinschreibung", () => {
    expect(N.messfensterZeilen(`Messfenster: n ≥ 12 ${UMS} nach #1590`)).toEqual([F]);
    expect(N.messfensterZeilen(`Messfenster: n >= 12 ${UMS} nach #1590`)).toEqual([F]);
    expect(N.messfensterZeilen(`- messfenster: n ≥ 12 ${UMS} nach #1590`)).toEqual([F]);
    expect(N.messfensterZeilen(`x\r\nMessfenster: n ≥ 12 ${UMS} nach #1590\r\ny`)).toEqual([F]);
  });
  test("Schlusspunkt erlaubt, Folgetext nach der Nummer ist unlesbar", () => {
    expect(N.messfensterZeilen(`Messfenster: n ≥ 12 ${UMS} nach #1590.`)).toEqual([F]);
    expect(N.messfensterZeilen(`Messfenster: n ≥ 12 ${UMS} nach #1590 (Hinweis)`)[0]).toHaveProperty("fehler");
  });
  test("mehrere Zeilen: mehrere Fenster", () => {
    expect(N.messfensterZeilen(`Messfenster: n ≥ 12 ${UMS} nach #1590\nMessfenster: n ≥ 3 ${LENS} nach #7`)).toEqual([F, { k: 3, agent: `${LENS}`, nach: 7 }]);
  });
  test.each([`n ≥ zehn ${UMS} nach #1`, `n ≥ 0 ${UMS} nach #1`, `n ≥ <k> ${UMS} nach #<nr>`, `n ≥ 5 ${UMS} nach 1590`, "n ≥ 5 nach #1"])(
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
  const F = { k: 12, agent: `${UMS}`, nach: 1590 };
  test("offen: wie ein Blocker; Fehler: nicht prüfbar", () => {
    expect(N.messfensterGrund(F, { closedAt: null, n: 0 })).toBe("offener Blocker #1590 (Messfenster)");
    expect(N.messfensterGrund(F, { fehler: "Messfenster nicht prüfbar (x)" })).toContain("nicht prüfbar");
  });
  test("n = k−1 gesperrt mit exaktem Grund, n = k und n > k frei", () => {
    expect(N.messfensterGrund(F, { closedAt: "2026-10-15T16:00:00Z", n: 11 })).toBe(`Messfenster offen (11/12 Tickets mit ${UMS} nach #1590)`);
    expect(N.messfensterGrund(F, { closedAt: "2026-10-15T16:00:00Z", n: 12 })).toBe("");
    expect(N.messfensterGrund(F, { closedAt: "2026-10-15T16:00:00Z", n: 13 })).toBe("");
  });
});

describe("waehleNaechstes mit Messfenster (#1589)", () => {
  const zeile = `Messfenster: n ≥ 12 ${UMS} nach #1590`;
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
    expect(r.uebersprungen[0].grund).toBe(`Messfenster offen (4/12 Tickets mit ${UMS} nach #1590)`);
    expect(zu.aufrufe).toEqual([1]);
    expect(frei([item(1, { body: zeile })], { messfenster: lader({ closedAt: frist, n: 12 }).fn }).ticket?.nr).toBe(1);
  });
  test("ohne Zeile, mit Assignee oder belegtem Branch: Lader nie aufgerufen", () => {
    const l = lader({ closedAt: frist, n: 0 });
    frei([item(1), item(2, { body: zeile, assignees: [{ login: "x" }] }), item(3, { body: zeile })], { refs: [`${BRP}3-a`], messfenster: l.fn });
    expect(l.aufrufe).toEqual([]);
  });
  test("mehrere Zeilen: jede muss erfüllt sein (auch die zweite)", () => {
    const body = `${zeile}\nMessfenster: n ≥ 3 ${LENS} nach #1600`;
    const nachAgent = (f: Fenster) => (f.agent === `${LENS}` ? { closedAt: frist, n: 2 } : { closedAt: frist, n: 50 });
    const r = frei([item(1, { body }), item(2)], { messfenster: nachAgent });
    expect(r.ticket?.nr).toBe(2);
    expect(r.uebersprungen[0].grund).toBe(`Messfenster offen (2/3 Tickets mit ${LENS} nach #1600)`);
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
    const eingabe = { items: norm([item(1, { body: `Messfenster: n ≥ GEHEIM ${UMS} nach #1` })]), offene: new Set<number>() };
    const r = N.fuehreAus(["--json", "--bereich", "spiel"], { owner: OWNER, namen: NAMEN, lade: () => zweiBoards(eingabe), config: CFG });
    expect(r.code).toBe(1);
    expect(r.out).toContain("unlesbar");
    expect(r.out).not.toContain("GEHEIM");
    expect(N.fuehreAus(["--bereich", "spiel"], { owner: OWNER, namen: NAMEN, lade: () => zweiBoards(eingabe), config: CFG }).out).not.toContain("GEHEIM");
  });
});

describe("messfensterLader (#1589)", () => {
  const F = { k: 2, agent: `${UMS}`, nach: 1590 };
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
    const d = mkdtempSync(join(tmpdir(), "mf-"));
    dirs.push(d);
    return d;
  };
  test("fehlender Ordner: fehler ohne Pfad im Text", () => {
    const r = messfensterLader({ dir: join(tmpdir(), "gibt-es-nicht-1589"), holeIssue: zu })(F, 1591);
    expect(r).toEqual({ fehler: "Messfenster nicht prüfbar (keine lokalen Transkripte)" });
  });
  test("zählt Läufe des Typs ab closedAt, ohne die des wartenden Tickets", () => {
    const d = tmp();
    lauf(d, "a", `${UMS}`, 1600, "2026-10-15T11:00:00Z");
    lauf(d, "b", `${UMS}`, 1601, "2026-10-15T12:00:00Z");
    lauf(d, "c", `${UMS}`, 1591, "2026-10-15T13:00:00Z");
    lauf(d, "d", `${LENS}`, 1602, "2026-10-15T13:00:00Z");
    lauf(d, "e", `${UMS}`, 1603, "2026-10-15T09:00:00Z");
    expect(messfensterLader({ dir: d, holeIssue: zu })(F, 1591)).toEqual({ closedAt: "2026-10-15T10:00:00Z", n: 2 });
  });
  test("Ticket-Namen aus der Config (#1745): der Worktree-Pfad mit dem Präfix der Config ordnet den Lauf zu", () => {
    const d = tmp();
    const sub = join(d, "sess", "subagents");
    mkdirSync(sub, { recursive: true });
    writeFileSync(join(sub, "w.meta.json"), JSON.stringify({ agentType: `${UMS}` }));
    writeFileSync(join(sub, "w.jsonl"), `${JSON.stringify({ type: "user", timestamp: "2026-10-15T11:00:00Z", message: { role: "user", content: "Arbeit in C:/r/.claude/worktrees/ab-1700/src" } })}\n`);
    const mit = (worktree: string) => () => ticketNamen({ praefixe: { branch: `feature/${worktree}`, worktree }, agenten: { planer: "p", umsetzer: "u", lens: "l", gruppe: "g", ticketSkill: "t" } });
    expect(messfensterLader({ dir: d, holeIssue: zu, ladeNamen: mit("ab-") })(F, 1591)).toEqual({ closedAt: "2026-10-15T10:00:00Z", n: 1 });
    expect(messfensterLader({ dir: d, holeIssue: zu, ladeNamen: mit(WTP) })(F, 1591)).toEqual({ closedAt: "2026-10-15T10:00:00Z", n: 0 });
  });
  test("Negativfall: sind die Ticket-Namen nicht ladbar, ist das Fenster unprüfbar (fail-closed, ohne Text der Config)", () => {
    const d = tmp();
    lauf(d, "a", `${UMS}`, 1600, "2026-10-15T11:00:00Z");
    const wirft = () => {
      throw new Error("Projekt-Config unvollständig: agenten.umsetzer fehlt");
    };
    expect(messfensterLader({ dir: d, holeIssue: zu, ladeNamen: wirft })(F, 1591)).toEqual({ fehler: "Messfenster nicht prüfbar (Projekt-Config nicht nutzbar)" });
  });
  test("offenes Issue: closedAt null; Abruffehler: fehler", () => {
    const d = tmp();
    expect(messfensterLader({ dir: d, holeIssue: () => ({ state: "open", closed_at: null }) })(F, 1591)).toEqual({ closedAt: null, n: 0 });
    const r = messfensterLader({ dir: d, holeIssue: () => { throw new Error("boom"); } })(F, 1591);
    expect(r).toEqual({ fehler: "Messfenster nicht prüfbar (#1590 nicht abrufbar)" });
  });
  test("Transkript-Pfad ist eine Datei: fail-closed „nicht lesbar“", () => {
    const d = tmp();
    const datei = join(d, "keine-ordner");
    writeFileSync(datei, "x");
    expect(messfensterLader({ dir: datei, holeIssue: zu })(F, 1591)).toEqual({ fehler: "Messfenster nicht prüfbar (Transkripte nicht lesbar)" });
  });
  test("ein frisch gestarteter Lauf ohne Zeitstempel macht das Fenster nicht unprüfbar und zählt nicht", () => {
    const d = tmp();
    lauf(d, "a", `${UMS}`, 1600, "2026-10-15T11:00:00Z");
    const sub = join(d, "sess", "subagents");
    writeFileSync(join(sub, "leer.meta.json"), JSON.stringify({ agentType: `${UMS}` }));
    writeFileSync(join(sub, "leer.jsonl"), "");
    expect(messfensterLader({ dir: d, holeIssue: zu })(F, 1591)).toEqual({ closedAt: "2026-10-15T10:00:00Z", n: 1 });
  });
  test("Memo-Schlüssel ist agent und nach: anderer Agent-Typ oder andere Nummer bekommt eigene Läufe und eigenen Abruf", () => {
    const d = tmp();
    lauf(d, "a", `${UMS}`, 1600, "2026-10-15T11:00:00Z");
    lauf(d, "b", `${UMS}`, 1601, "2026-10-15T12:00:00Z");
    lauf(d, "c", `${LENS}`, 1602, "2026-10-15T13:00:00Z");
    const abrufe: number[] = [];
    const holeIssue = (nr: number) => (abrufe.push(nr), nr === 1590 ? zu() : { state: "open", closed_at: null });
    const lader = messfensterLader({ dir: d, holeIssue });
    expect(lader(F, 1591)).toEqual({ closedAt: "2026-10-15T10:00:00Z", n: 2 });
    expect(lader({ ...F, agent: `${LENS}` }, 1591)).toEqual({ closedAt: "2026-10-15T10:00:00Z", n: 1 });
    expect(lader({ ...F, nach: 1700 }, 1591)).toEqual({ closedAt: null, n: 0 });
    lader(F, 1592);
    lader({ ...F, agent: `${LENS}` }, 1592);
    expect(abrufe).toEqual([1590, 1590, 1700]);
  });
  test("offenes Issue ohne Transkript-Ordner: Grund bleibt „offen“, nicht „keine Transkripte“", () => {
    const r = messfensterLader({ dir: join(tmpdir(), "gibt-es-nicht-1589"), holeIssue: () => ({ state: "open", closed_at: null }) })(F, 1591);
    expect(r).toEqual({ closedAt: null, n: 0 });
  });
  test("Memo je Fenster: ein REST-Aufruf, aber die Zählung gilt je wartendem Ticket", () => {
    const d = tmp();
    lauf(d, "a", `${UMS}`, 1600, "2026-10-15T11:00:00Z");
    lauf(d, "b", `${UMS}`, 1591, "2026-10-15T12:00:00Z");
    let aufrufe = 0;
    const lader = messfensterLader({ dir: d, holeIssue: () => (aufrufe++, zu()) });
    expect(lader(F, 1591)).toEqual({ closedAt: "2026-10-15T10:00:00Z", n: 1 });
    expect(lader(F, 1600)).toEqual({ closedAt: "2026-10-15T10:00:00Z", n: 1 });
    expect(lader(F, 1700)).toEqual({ closedAt: "2026-10-15T10:00:00Z", n: 2 });
    expect(aufrufe).toBe(1);
  });
});

describe("Einzelprüfung --ticket (#1621)", () => {
  const issue = (nr: number, c: Record<string, unknown> = {}) => item(nr, c).content;
  const pruefe = (nr: number, c: Record<string, unknown> = {}, extra: Partial<Eingabe> = {}) =>
    N.pruefeTicket({ item: N.itemAusIssue(issue(nr, c)), offene: new Set(), owner: OWNER, namen: NAMEN, config: CFG, ...extra });
  const grund = (r: Ergebnis) => r.uebersprungen[0]?.grund;
  const zeile = `Messfenster: n ≥ 12 ${UMS} nach #1590`;

  test("aufrufLesen: --ticket in drei Schreibweisen, Fehler bei fehlendem oder ungültigem Wert", () => {
    expect(N.aufrufLesen(["--ticket", "12"])).toEqual({ bereich: null, ticket: 12, json: false });
    expect(N.aufrufLesen(["--ticket=12"]).ticket).toBe(12);
    expect(N.aufrufLesen(["--ticket", "#12", "--json"])).toEqual({ bereich: null, ticket: 12, json: true });
    expect(N.aufrufLesen(["--ticket"]).fehler).toBe("--ticket erwartet eine Ticketnummer (bekommen: nichts)");
    expect(N.aufrufLesen(["--ticket="]).fehler).toBe("--ticket erwartet eine Ticketnummer (bekommen: nichts)");
    for (const bad of ["abc", "0", "-3", "12x"]) expect(N.aufrufLesen(["--ticket", bad]).fehler, bad).toBe(`--ticket erwartet eine Ticketnummer (bekommen: „${bad}“)`);
  });
  test("itemAusIssue: REST-Issue wird normalisiert; PR und kaputte Form werfen", () => {
    const i = N.itemAusIssue(issue(7, { body: "b", labels: [{ name: "x" }], issue_dependencies_summary: { blocked_by: 2 } }));
    expect(i).toMatchObject({ number: 7, title: "T7", state: "open", labels: ["x"], body: `${SPEZ}b`, blockedBy: 2, autor: { login: OWNER } });
    expect(() => N.itemAusIssue({ ...issue(7), pull_request: {} })).toThrow();
    expect(() => N.itemAusIssue({ title: "ohne Nummer" })).toThrow();
    expect(() => N.itemAusIssue(null)).toThrow();
  });
  test("pruefeTicket: frei", () => {
    expect(pruefe(7)).toEqual({ ticket: { nr: 7, titel: "T7" }, uebersprungen: [] });
  });
  test("pruefeTicket: geschlossen, Assignee, Blocker, Fremdeingang, belegt", () => {
    expect(grund(pruefe(7, { state: "closed" }))).toBe("geschlossen");
    expect(grund(pruefe(7, { assignees: [{ login: OWNER }] }))).toBe(`Assignee @${OWNER}`);
    expect(grund(pruefe(7, { body: "blockiert durch #5" }, { offene: new Set([5]) }))).toBe("offener Blocker #5");
    expect(grund(pruefe(7, { labels: [{ name: FREMD.labels.forum }] }))).toContain("Fremdeingang");
    expect(grund(pruefe(7, { user: { login: "fremd", type: "User" } }))).toContain("Fremdeingang");
    const belegt = "Branch, Worktree oder offener PR vorhanden";
    expect(grund(pruefe(7, {}, { refs: [`${BRP}7-x`] }))).toBe(belegt);
    expect(grund(pruefe(7, {}, { prHeads: [`${BRP}7-x`] }))).toBe(belegt);
    expect(grund(pruefe(7, {}, { worktrees: [`branch refs/heads/${BRP}7-x`] }))).toBe(belegt);
  });
  test("pruefeTicket: Messfenster zählt, auch fail-closed; ein anderer Status als Todo ist kein Grund", () => {
    const stand = (s: Stand) => () => s;
    expect(grund(pruefe(7, { body: zeile }, { messfenster: stand({ closedAt: "2026-10-15T10:00:00Z", n: 4 }) }))).toBe(`Messfenster offen (4/12 Tickets mit ${UMS} nach #1590)`);
    expect(grund(pruefe(7, { body: zeile }, { messfenster: stand({ fehler: "Messfenster nicht prüfbar (x)" }) }))).toBe("Messfenster nicht prüfbar (x)");
    expect(pruefe(7, { body: zeile }, { messfenster: stand({ closedAt: "2026-10-15T10:00:00Z", n: 12 }) }).ticket?.nr).toBe(7);
  });

  const io = (e: Error | null = null) => {
    const aufrufe = { lade: 0, einzeln: 0 };
    return {
      aufrufe,
      owner: OWNER, namen: NAMEN,
      config: CFG,
      lade: () => {
        aufrufe.lade++;
        return { produkt: [], factory: [], offene: new Set<number>() };
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

describe("Spezifikations-Gate (#1615)", () => {
  type GateIo = {
    owner: string;
    namen?: unknown;
    config?: unknown;
    hartAb?: number;
    lade: () => ZweiBoards;
    ladeEinzeln?: (nr: number) => Eingabe & { item: unknown };
  };
  type GateErgebnis = Ergebnis & { uebersprungen: { nr: number; grund: string; fehlt?: string[] }[]; reparieren?: { nr: number; fehlt: string[] }[]; ticket: (Ergebnis["ticket"] & { spezifikation?: { bestand: boolean; fehlt: string[] } }) | null };
  const GateN = N as unknown as {
    waehleNaechstes: (e: unknown) => GateErgebnis;
    pruefeTicket: (e: unknown) => GateErgebnis;
    formatiere: (e: unknown) => string;
    fuehreAus: (argv: string[], io: GateIo) => { code: number; out: string; err: string };
  };
  const OHNE_NEGATIV = "## Ziel\nZ\n\n## Akzeptanzkriterien\n- nur Happy Path\n";
  const waehle = (items: unknown[], extra: Record<string, unknown> = {}) => GateN.waehleNaechstes({ items: norm(items), offene: new Set(), owner: OWNER, namen: NAMEN, config: CFG, ...extra });

  test("AK3: neues Ticket ohne Negativfall wird übersprungen, das nächste gewählt", () => {
    const r = waehle([roh(1, { body: OHNE_NEGATIV }), item(2)]);
    expect(r.ticket?.nr).toBe(2);
    expect(r.uebersprungen).toHaveLength(1);
    expect(r.uebersprungen[0]).toMatchObject({ nr: 1 });
    expect(r.uebersprungen[0].grund).toContain("Spezifikation unvollständig");
    expect(r.uebersprungen[0].grund).toContain("kein Negativfall");
    expect(r.uebersprungen[0].fehlt).toHaveLength(1);
  });
  test("Bestand (Nummer unter hartAb): gewählt, Hinweiszeile, erste Zeile bleibt `#nr TAB Titel`", () => {
    const r = waehle([roh(5, { body: "" })], { hartAb: 100 });
    expect(r.ticket).toMatchObject({ nr: 5, spezifikation: { bestand: true } });
    expect(r.uebersprungen).toEqual([]);
    const text = GateN.formatiere(r);
    expect(text.split("\n")[0]).toBe("#5\tT5");
    expect(text).toContain("hinweis #5: Spezifikation unvollständig (Bestand, nur berichtet): `## Ziel` fehlt");
  });
  test("Grenze: Nummer gleich hartAb ist hart", () => {
    expect(waehle([roh(100, { body: "" })], { hartAb: 100 }).ticket).toBeNull();
    expect(waehle([roh(99, { body: "" })], { hartAb: 100 }).ticket?.nr).toBe(99);
  });
  test("ausgenommen: Sammel-, Status-, Notfall-, Forum-, Epic-Titel ohne Format bleiben frei", () => {
    for (const titel of ["Harness-Härtung (gesammelt)", "Langfuse-Befunde (gesammelt)", "🚨 CI rot auf main", "🔒 Security: x", "🤖 Dependabot-PRs auflösen", "Forum #7: Frage", "⏰ Wiedervorlage: x", "📦 Epic: Welt", "Phase 2: Bau", "Langfuse-Status überprüfen"]) {
      const r = waehle([roh(1, { title: titel, body: "" })], { fuellstand: () => 10 }); // das Sammelticket ist voll: nur das Spezifikations-Gate steht zur Prüfung
      expect(r.ticket?.nr, titel).toBe(1);
      expect(r.ticket?.spezifikation, titel).toBeUndefined();
    }
  });
  test("ein offener Blocker schlägt die Spezifikation (Grund Blocker)", () => {
    const r = waehle([roh(1, { body: "blockiert durch #50" })], { offene: new Set([50]) });
    expect(r.uebersprungen[0].grund).toBe("offener Blocker #50");
    expect(r.uebersprungen[0].fehlt).toBeUndefined();
  });
  test("Belegung (Branch, Worktree, PR) schlägt die Spezifikation: Grund Belegung, kein fehlt", () => {
    const r = waehle([roh(1, { body: OHNE_NEGATIV })], { refs: [`origin/${BRP}1-x`] });
    expect(r.uebersprungen[0].grund).toBe("Branch, Worktree oder offener PR vorhanden");
    expect(r.uebersprungen[0].fehlt).toBeUndefined();
  });
  test("Assignee und Fremdeingang schlagen die Spezifikation: kein `reparieren`, nie ein fremdes Ticket umschreiben", () => {
    const fremd = { body: OHNE_NEGATIV, user: { login: "fremd", type: "User" } };
    const forum = { body: OHNE_NEGATIV, labels: [{ name: FREMD.labels.forum }] };
    const vergeben = { body: OHNE_NEGATIV, assignees: [{ login: OWNER }] };
    for (const c of [fremd, forum, vergeben]) {
      const { eingang } = io([roh(1, c), item(2)]);
      const r = GateN.fuehreAus(["--json", "--bereich", "spiel"], eingang);
      const j = JSON.parse(r.out) as GateErgebnis;
      expect(j.reparieren).toBeUndefined();
      expect(r.out).not.toContain("reparieren");
      expect(j.ticket?.nr).toBe(2);
    }
  });

  test("der teure Messfenster-Lader läuft bei Spezifikations-Mangel nicht", () => {
    let n = 0;
    const r = waehle([roh(1, { body: `Messfenster: n ≥ 12 ${UMS} nach #1590` })], {
      messfenster: () => {
        n++;
        return { closedAt: "2026-10-15T10:00:00Z", n: 99 };
      },
    });
    expect(r.ticket).toBeNull();
    expect(n).toBe(0);
  });
  test("--ticket: dieselbe Prüfung", () => {
    const r = GateN.pruefeTicket({ item: N.itemAusIssue(roh(7, { body: OHNE_NEGATIV }).content), offene: new Set(), owner: OWNER, namen: NAMEN, config: CFG });
    expect(r.ticket).toBeNull();
    expect(r.uebersprungen[0].grund).toContain("kein Negativfall");
  });

  const io = (items: unknown[], extra: Partial<GateIo> = {}) => {
    const eingang: GateIo = {
      owner: OWNER, namen: NAMEN,
      config: CFG,
      lade: () => zweiBoards({ items: norm(items), offene: new Set<number>() }),
      ...extra,
    };
    return { eingang };
  };
  test("hart übersprungenes vertrautes Ticket: `reparieren`-Zeile direkt nach Kopf, erste Zeile und Exit-Code unverändert, Body nie ausgegeben", () => {
    const { eingang } = io([roh(1, { body: `${OHNE_NEGATIV}GEHEIM` }), item(2)]);
    const r = GateN.fuehreAus(["--bereich", "spiel"], eingang);
    const zeilen = r.out.split("\n");
    expect(r.code).toBe(0);
    expect(zeilen[0]).toBe("#2\tT2");
    expect(zeilen[1]).toMatch(/^reparieren #1: .*kein Negativfall/);
    expect(zeilen[2]).toMatch(/^übersprungen #1: Spezifikation unvollständig/);
    expect(r.out).not.toContain("GEHEIM");
    expect(r.err).toBe("");
  });
  test("JSON: `reparieren` nur wenn nicht leer, mit nr und fehlt", () => {
    const { eingang } = io([roh(1, { body: OHNE_NEGATIV }), item(2)]);
    const j = JSON.parse(GateN.fuehreAus(["--json", "--bereich", "spiel"], eingang).out) as GateErgebnis;
    expect(j.reparieren?.map((r) => r.nr)).toEqual([1]);
    expect(j.reparieren?.[0].fehlt.join(" ")).toContain("kein Negativfall");
    const sauber = JSON.parse(GateN.fuehreAus(["--json", "--bereich", "spiel"], io([item(2)]).eingang).out) as GateErgebnis;
    expect("reparieren" in sauber).toBe(false);
  });
  test("ohne freies Ticket bleibt Exit 1 und `reparieren` steht trotzdem in der Ausgabe", () => {
    const r = GateN.fuehreAus(["--bereich", "spiel"], io([roh(1, { body: OHNE_NEGATIV })]).eingang);
    expect(r.code).toBe(1);
    expect(r.out.split("\n")[0]).toBe("kein freies Ticket im Bereich Spielentwicklung");
    expect(r.out.split("\n")[1]).toMatch(/^reparieren #1: /);
  });
  test("Ticket mit vollständiger Spezifikation: weder `reparieren` noch übersprungen", () => {
    const r = GateN.fuehreAus(["--json", "--bereich", "spiel"], io([item(1)]).eingang);
    const j = JSON.parse(r.out) as GateErgebnis;
    expect(j.reparieren).toBeUndefined();
    expect(j.uebersprungen).toEqual([]);
  });
  test("Bestand (unter hartAb) bleibt Hinweis, nicht `reparieren`", () => {
    const r = GateN.fuehreAus(["--bereich", "spiel"], io([roh(5, { body: "" })], { hartAb: 100 }).eingang);
    expect(r.out).toContain("hinweis #5");
    expect(r.out).not.toContain("reparieren");
  });
  test("Reihenfolge der Ausgabe: Kopf, Hinweis, `reparieren`, übersprungen", () => {
    const r = GateN.fuehreAus(["--bereich", "spiel"], io([roh(200, { body: "" }), roh(5, { body: "" })], { hartAb: 100 }).eingang);
    const zeilen = r.out.trim().split("\n");
    expect(zeilen[0]).toBe("#5\tT5");
    expect(zeilen[1]).toMatch(/^hinweis #5:/);
    expect(zeilen[2]).toMatch(/^reparieren #200:/);
    expect(zeilen[3]).toMatch(/^übersprungen #200:/);
  });
  test("AK3: die Auswahl liest keine Kommentare und schreibt nichts (kein Kommentar-I/O im Vertrag)", () => {
    const gelesen: number[] = [];
    const gepostet: number[] = [];
    const eingang = {
      ...io([roh(1, { body: OHNE_NEGATIV }), roh(2, { body: OHNE_NEGATIV }), roh(3, { body: OHNE_NEGATIV })]).eingang,
      kommentareVon: (nr: number) => void gelesen.push(nr),
      kommentiere: (nr: number) => void gepostet.push(nr),
    };
    GateN.fuehreAus(["--bereich", "spiel"], eingang);
    GateN.fuehreAus(["--json", "--bereich", "spiel"], eingang);
    expect(gelesen).toEqual([]);
    expect(gepostet).toEqual([]);
  });
  test("--ticket: nicht frei wegen Spezifikation zeigt `reparieren #nr` mit Exit 1", () => {
    const r = GateN.fuehreAus(["--ticket", "7"], {
      owner: OWNER, namen: NAMEN,
      config: CFG,
      lade: () => ({ produkt: [], factory: [], offene: new Set<number>() }),
      ladeEinzeln: () => ({ item: N.itemAusIssue(roh(7, { body: OHNE_NEGATIV }).content), offene: new Set<number>() }) as never,
    });
    expect(r.code).toBe(1);
    expect(r.out.split("\n")[0]).toMatch(/^#7 nicht frei: Spezifikation unvollständig/);
    expect(r.out.split("\n")[1]).toMatch(/^reparieren #7: /);
  });

  test("hartAb aus io erreicht die Auswahl", () => {
    const { eingang } = io([roh(5, { body: "" })], { hartAb: 100 });
    expect(GateN.fuehreAus(["--bereich", "spiel"], eingang).code).toBe(0);
    const { eingang: hart } = io([roh(5, { body: "" })], { hartAb: 5 });
    expect(GateN.fuehreAus(["--bereich", "spiel"], hart).code).toBe(1);
  });
});

describe("Zwei Boards (#1729)", () => {
  const H = { labels: [{ name: HARNESS }] };
  const vergeben = { assignees: [{ login: OWNER }] };
  type Opt = { argv?: string[]; spion?: { n: number } };
  const lauf = (produkt: unknown[], factory: unknown[], o: Opt = {}) =>
    N.fuehreAus(o.argv ?? ["--json", "--bereich", "spiel"], {
      owner: OWNER, namen: NAMEN,
      config: CFG,
      lade: () => {
        if (o.spion) o.spion.n++;
        return { produkt: norm(produkt), factory: norm(factory), offene: new Set<number>() };
      },
    });
  const json = (r: { out: string }) => JSON.parse(r.out) as Ergebnis & { bereich: string; hinweise?: string[] };
  const AG = ["--json", "--bereich", "agentic"];
  const rot = { title: "🚨 CI rot auf main: x" };
  const status = { title: "Langfuse-Status überprüfen", ...H };

  test("der Bereich bestimmt die Seite: spiel wählt Produkt, agentic Factory, ohne Ausweichen auf die andere", () => {
    expect(json(lauf([item(1)], [item(10, H)])).ticket?.nr).toBe(1);
    expect(json(lauf([item(1)], [item(10, H)], { argv: AG })).ticket?.nr).toBe(10);
    expect(lauf([], [item(10, H)]).code).toBe(1);
    expect(lauf([item(1)], [], { argv: ["--bereich", "agentic"] }).code).toBe(1);
  });
  test("JSON nennt Bereich, Ticket, übersprungen, verzug; ein Schlüssel quote gibt es nicht", () => {
    const j = json(lauf([item(1)], []));
    expect(Object.keys(j).sort()).toEqual(["bereich", "ticket", "uebersprungen", "verzug"]);
    expect((j as { verzug?: number[] }).verzug).toEqual([]);
  });
  test("Kopf vor eigener Seite: ein 🚨 auf dem Factory-Board schlägt ein freies Produkt-Item in beiden Bereichen", () => {
    expect(json(lauf([item(1)], [item(10, { ...rot, ...H })])).ticket?.nr).toBe(10);
    expect(json(lauf([item(1)], [item(10, { ...rot, ...H })], { argv: AG })).ticket?.nr).toBe(10);
  });
  test("Kopf-Rang: 🔒 (Produkt-Board) kommt vor dem Status-Ticket (Factory-Board), bei Gleichstand Produkt vor Factory", () => {
    const sec = { title: "🔒 Security: y" };
    expect(json(lauf([item(1, sec)], [item(2, status)], { argv: AG })).ticket?.nr).toBe(1);
    expect(json(lauf([item(1, rot)], [item(2, { ...rot, ...H })])).ticket?.nr).toBe(1);
    expect(json(lauf([item(1, status)], [item(2, { ...rot, ...H })], { argv: AG })).ticket?.nr).toBe(2);
  });
  test("ein geclaimtes Kopf-Item wird übersprungen, danach gilt die eigene Seite", () => {
    const j = json(lauf([item(1)], [item(10, { ...rot, ...H, ...vergeben }), item(11, H)]));
    expect(j.ticket?.nr).toBe(1);
    expect(j.uebersprungen.map((u) => u.nr)).toEqual([10]);
  });
  test("--bereich agentic: ein freies Status-Ticket auf dem Factory-Board wird als Kopf-Item gewählt, vor dem Factory-Item davor", () => {
    expect(json(lauf([item(1)], [item(10, H), item(2, status)], { argv: AG })).ticket?.nr).toBe(2);
  });
  test("ein geclaimtes Factory-Item in Arbeit lenkt nicht um: agentic wählt das nächste freie Factory-Item, spiel bleibt auf Produkt", () => {
    const factory = [item(10, { ...H, ...vergeben }), item(11, H)];
    expect(json(lauf([item(1)], factory, { argv: AG })).ticket?.nr).toBe(11);
    expect(json(lauf([item(1)], factory)).ticket?.nr).toBe(1);
  });
  test("kein freies Item auf der eigenen Seite: Exit 1, auch wenn die andere Seite frei ist (kein Rückfall, kein Hinweis)", () => {
    const r = lauf([item(1, vergeben)], [item(10, H)], { argv: ["--bereich", "spiel"] });
    expect(r.code).toBe(1);
    expect(r.out.split("\n")[0]).toBe("kein freies Ticket im Bereich Spielentwicklung");
    expect(r.out).not.toContain("Rückfall");
  });
  test("ein Item auf beiden Boards: Hinweis, gezählt nur auf dem Board laut Trennregel", () => {
    const j = json(lauf([item(5, H), item(6)], [item(5, H)]));
    expect(j.ticket?.nr).toBe(6);
    expect(j.hinweise).toEqual(["#5 steht auf beiden Boards, gezählt auf dem Board laut Trennregel"]);
    expect(j.uebersprungen).toEqual([]);
  });
  test("ein Harness-Item nur auf dem Produkt-Board zählt auf der Factory-Seite, hinter den Items des Factory-Boards, mit einem Sammelhinweis", () => {
    const j = json(lauf([item(5, H), item(6)], [], { argv: AG }));
    expect(j.ticket?.nr).toBe(5);
    expect(j.hinweise?.[0]).toBe("1 Items nur auf dem falschen Board (zählen auf ihrer Seite laut Trennregel): #5");
    expect(json(lauf([item(5, H), item(6)], [item(10, H)], { argv: AG })).ticket?.nr).toBe(10);
  });
  test("der Sammelhinweis nennt höchstens 10 Nummern", () => {
    const viele = Array.from({ length: 12 }, (_, k) => item(20 + k, H));
    const h = json(lauf(viele, [])).hinweise?.[0] ?? "";
    expect(h).toContain("12 Items");
    expect(h).toContain("#29, …");
    expect(h).not.toContain("#30");
  });
  test("--bereich agentic: nur die Factory-Seite plus 🚨 vom Produkt-Board", () => {
    expect(json(lauf([item(1)], [item(10, H)], { argv: AG })).ticket?.nr).toBe(10);
    expect(json(lauf([item(1, rot)], [item(10, H)], { argv: AG })).ticket?.nr).toBe(1);
    const leer = lauf([item(1)], [], { argv: ["--bereich", "agentic"] });
    expect(leer.code).toBe(1);
    expect(leer.out.split("\n")[0]).toBe("kein freies Ticket im Bereich Agentic Engineering");
  });
  test("--bereich spiel: nur die Produkt-Seite, ein Factory-Item wird nie gewählt", () => {
    expect(json(lauf([item(1)], [item(10, H)])).ticket?.nr).toBe(1);
    expect(lauf([], [item(10, H)], { argv: ["--bereich", "spiel"] }).code).toBe(1);
  });
  test("ein Status-Ticket auf dem Factory-Board gehört nicht zum Bereich spiel", () => {
    expect(lauf([item(1)], [item(2, status)], { argv: ["--bereich", "spiel"] }).out.split("\n")[0]).toBe("#1	T1");
  });
  test("Text: Zeile 1 bleibt `#nr TAB Titel`, danach die Hinweise (keine Seiten-Infozeile)", () => {
    const zeilen = lauf([item(5, H), item(6)], [item(10, H)], { argv: ["--bereich", "agentic"] }).out.trim().split("\n");
    expect(zeilen[0]).toBe("#10	T10");
    expect(zeilen[1]).toMatch(/^hinweis 1 Items nur auf dem falschen Board/);
  });
  test("ohne Hinweise fehlt der Schlüssel hinweise im JSON", () => {
    expect("hinweise" in json(lauf([item(1)], []))).toBe(false);
  });
  test("Lader-Fehler: Exit 2 mit Meldung", () => {
    const r = N.fuehreAus(["--bereich", "spiel"], { owner: OWNER, namen: NAMEN, config: CFG, lade: () => { throw new Error("kein Netz"); } });
    expect(r.code).toBe(2);
    expect(r.err).toContain("kein Netz");
  });
});

describe("Aufruf ohne --bereich und ohne --ticket", () => {
  const io = (spion: { n: number }) => ({
    owner: OWNER, namen: NAMEN,
    config: CFG,
    lade: () => {
      spion.n++;
      return zweiBoards({ items: norm([item(1)]), offene: new Set<number>() });
    },
  });
  test("fuehreAus: Exit 2 mit beiden Schaltern in der Meldung, ohne jeden Ladeaufruf", () => {
    for (const argv of [[], ["--json"]]) {
      const spion = { n: 0 };
      const r = N.fuehreAus(argv, io(spion));
      expect(r.code, argv.join(" ")).toBe(2);
      expect(r.err).toContain("--bereich agentic|spiel");
      expect(r.err).toContain("--ticket <nr>");
      expect(spion.n).toBe(0);
    }
  });
  test("waehleUeberBoards ohne Bereich wirft, statt eine Seite zu raten", () => {
    expect(() => N.waehleUeberBoards({ produkt: norm([item(1)]), factory: [], offene: new Set<number>(), owner: OWNER, namen: NAMEN, config: CFG })).toThrow(/bereich/);
    expect(() => N.waehleUeberBoards({ produkt: [], factory: [], bereich: null, offene: new Set<number>(), owner: OWNER, namen: NAMEN, config: CFG })).toThrow(/bereich/);
    // Negativfall: ein unbekannter, aber gesetzter Wert wird nicht still als Produkt-Seite gelesen.
    expect(() => N.waehleUeberBoards({ produkt: [], factory: [], bereich: "xyz", offene: new Set<number>(), owner: OWNER, namen: NAMEN, config: CFG })).toThrow(/bereich/);
  });
});

describe("echteIo: Messfenster-Lader bekommt die Namen der Config (#1821 L10)", () => {
  test("ladeNamen liefert die schon geladenen Namen, ohne die Config ein zweites Mal zu laden", () => {
    const cfg = (ladeCfg as unknown as { ladeProjektConfig: () => unknown }).ladeProjektConfig();
    const optionen: { ladeNamen?: () => unknown }[] = [];
    const io = (N as unknown as { echteIo: (o: { config: unknown; messfensterLader: (o: { ladeNamen?: () => unknown }) => unknown }) => { namen: unknown } }).echteIo({
      config: cfg,
      messfensterLader: (o) => {
        optionen.push(o);
        return () => ({ closedAt: null, n: 0 });
      },
    });
    expect(optionen).toHaveLength(1);
    expect(optionen[0].ladeNamen?.()).toBe(io.namen);
  });
});

describe("Sprache als Projektwert (#1711)", () => {
  const ohne = { ...(ladeCfg as unknown as { ladeProjektConfig: () => Record<string, unknown> }).ladeProjektConfig(), sprache: undefined };
  test("echteIo: ohne sprache in der Config bricht der Start vorab mit Fix-Zeile ab", () => {
    const echte = (N as unknown as { echteIo: (o: { config: unknown; messfensterLader: () => unknown }) => unknown }).echteIo;
    expect(() => echte({ config: ohne, messfensterLader: () => () => ({ closedAt: null, n: 0 }) })).toThrow(/sprache[\s\S]*Fix:/);
  });
  test("die Auswahl wirft ohne sprache, sobald ein freier Kandidat das Spezifikations-Gate braucht", () => {
    expect(() => (N.waehleNaechstes as (e: unknown) => unknown)({ items: norm([item(1)]), offene: new Set(), owner: OWNER, namen: NAMEN, config: ohne })).toThrow(/sprache/);
  });
});

describe("--maengel: freie vertraute Tickets mit Spezifikations-Mangel in Board-Reihenfolge (#1860)", () => {
  type MIo = { owner: string; namen?: unknown; config: unknown; hartAb?: number; lade: () => ZweiBoards & { refs?: string[] } };
  type MErgebnis = { anzahl: number; maengel: { nr: number; titel: string; fehlt: string[] }[] };
  const M = N as unknown as {
    aufrufLesen: (argv: string[]) => { maengel?: boolean; bereich?: string | null; ticket?: number | null; json?: boolean; fehler?: string };
    fuehreAus: (argv: string[], io: MIo) => { code: number; out: string; err: string };
  };
  const OHNE_NEGATIV = "## Ziel\nZ\n\n## Akzeptanzkriterien\n- nur Happy Path\n";
  const H = { labels: [{ name: HARNESS }] };
  const lauf = (produkt: unknown[], factory: unknown[] = [], argv: string[] = ["--maengel"], extra: Partial<MIo> = {}, offene = new Set<number>()) =>
    M.fuehreAus(argv, { owner: OWNER, namen: NAMEN, config: CFG, hartAb: 1, lade: () => ({ produkt: norm(produkt), factory: norm(factory), offene }), ...extra });

  test("aufrufLesen: --maengel braucht weder --bereich noch --ticket, schließt --ticket aus", () => {
    expect(M.aufrufLesen(["--maengel"])).toMatchObject({ maengel: true, bereich: null, ticket: null, json: false });
    expect(M.aufrufLesen(["--maengel", "--bereich", "agentic", "--json"])).toMatchObject({ maengel: true, bereich: "agentic", json: true });
    expect(M.aufrufLesen(["--maengel", "--ticket", "5"]).fehler).toMatch(/schließen sich aus/);
    expect(M.aufrufLesen(["--bereich", "spiel"]).maengel).toBeUndefined();
  });
  test("listet Tickets mit Mangel in Board-Reihenfolge, Exit 0, Body nie ausgegeben", () => {
    const r = lauf([roh(3, { body: `${OHNE_NEGATIV}GEHEIM` }), item(4), roh(2, { body: "" })]);
    expect(r.code).toBe(0);
    const zeilen = r.out.trim().split("\n");
    expect(zeilen[0]).toBe("2 Tickets mit Mangel");
    expect(zeilen[1]).toMatch(/^#3\tT3: .*kein Negativfall/);
    expect(zeilen[2]).toMatch(/^#2\tT2: /);
    expect(r.out).not.toContain("GEHEIM");
    expect(r.out).not.toContain("#4");
  });
  test("ohne Mangel: Exit 0 und `0 Tickets mit Mangel`", () => {
    const r = lauf([item(1)]);
    expect(r.code).toBe(0);
    expect(r.out.trim()).toBe("0 Tickets mit Mangel");
  });
  test("Negativfall: Assignee, Fremdeingang, offener Blocker, Belegung, Kopf-, Sammel- und Nicht-Todo-Items fehlen", () => {
    const produkt = [
      roh(1, { body: OHNE_NEGATIV, assignees: [{ login: OWNER }] }),
      roh(2, { body: OHNE_NEGATIV, user: { login: "fremder", type: "User" } }),
      roh(3, { body: `${OHNE_NEGATIV}blockiert durch #50` }),
      roh(4, { body: OHNE_NEGATIV }),
      roh(5, { body: "", title: "Harness-Härtung (gesammelt)" }),
      roh(6, { body: "", title: "🚨 CI rot auf main" }),
      roh(7, { body: OHNE_NEGATIV }, "In Progress"),
      roh(8, { body: OHNE_NEGATIV }),
      roh(9, { body: OHNE_NEGATIV, state: "closed" }),
    ];
    const r = lauf(produkt, [], ["--maengel", "--json"], { lade: () => ({ produkt: norm(produkt), factory: [], offene: new Set([50]), refs: [`origin/${BRP}8-x`] }) });
    expect((JSON.parse(r.out) as MErgebnis).maengel.map((m) => m.nr)).toEqual([4]);
  });
  test("Bestand unter hartAb zählt mit (freies Ticket mit Mangel)", () => {
    const j = JSON.parse(lauf([roh(5, { body: "" })], [], ["--maengel", "--json"], { hartAb: 100 }).out) as MErgebnis;
    expect(j.maengel.map((m) => m.nr)).toEqual([5]);
  });
  test("--bereich trennt die Boards, ohne Bereich zählen beide (Produkt vor Factory), JSON mit anzahl und fehlt", () => {
    const spiel = roh(1, { body: OHNE_NEGATIV });
    const harness = roh(2, { body: OHNE_NEGATIV, ...H });
    const nur = (bereich: string) => (JSON.parse(lauf([spiel], [harness], ["--maengel", "--bereich", bereich, "--json"]).out) as MErgebnis).maengel.map((m) => m.nr);
    expect(nur("spiel")).toEqual([1]);
    expect(nur("agentic")).toEqual([2]);
    const beide = JSON.parse(lauf([spiel], [harness], ["--maengel", "--json"]).out) as MErgebnis;
    expect(beide.anzahl).toBe(2);
    expect(beide.maengel.map((m) => m.nr)).toEqual([1, 2]);
    expect(beide.maengel[0].fehlt.join(" ")).toContain("kein Negativfall");
  });
  test("Messfenster wird nicht geladen: ein Ticket mit Messfenster-Zeile zählt nach seinem Mangel", () => {
    const j = JSON.parse(lauf([roh(1, { body: `${OHNE_NEGATIV}Messfenster: 3 ≥ ${UMS} nach #9` })], [], ["--maengel", "--json"], { hartAb: 100 }).out) as MErgebnis;
    expect(j.anzahl).toBe(1);
  });
  test("ein einzelnes Ticket mit Mangel steht im Singular, mehrere im Plural", () => {
    expect(lauf([roh(1, { body: OHNE_NEGATIV })]).out.split("\n")[0]).toBe("1 Ticket mit Mangel");
    expect(lauf([roh(1, { body: OHNE_NEGATIV }), roh(2, { body: OHNE_NEGATIV })]).out.split("\n")[0]).toBe("2 Tickets mit Mangel");
  });
  test("listeMaengel wirft bei einem unbekannten Bereich", () => {
    const liste = (N as unknown as { listeMaengel: (a: unknown) => unknown }).listeMaengel;
    expect(() => liste({ produkt: [], factory: [], bereich: "unfug", config: CFG, offene: new Set(), namen: {} })).toThrow(/bereich erwartet agentic oder spiel/);
  });
  test("Ladefehler: Exit 2 mit Ursache, kein Stacktrace", () => {
    const r = M.fuehreAus(["--maengel"], { owner: OWNER, namen: NAMEN, config: CFG, lade: () => { throw new Error("gh kaputt"); } });
    expect(r.code).toBe(2);
    expect(r.err).toContain("gh kaputt");
  });
});

describe("Board-Verzug (#1866)", () => {
  const PROD = "PRJ_produkt";
  const FACT = "PRJ_factory";
  type Frisch = { issues: { number: number; titel: string; projektIds: string[] }[]; projektIds: string[] } | { fehler: string };
  const V = raw as unknown as {
    verzugNummern: (a: { frisch: { number: number; titel: string; projektIds: string[] }[]; produkt: { number: number }[]; factory: { number: number }[]; projektIds: string[] }) => number[];
    ladeFrisch: (lade: (a: { anzahl: number }) => unknown) => Frisch;
  };
  const frischer = (number: number, projektIds: string[] = []) => ({ number, titel: `T${number}`, projektIds });
  const lauf = (frisch: Frisch | undefined, argv = ["--json", "--bereich", "spiel"]) =>
    N.fuehreAus(argv, {
      owner: OWNER, namen: NAMEN,
      config: CFG,
      lade: () => ({ produkt: norm([item(1)]), factory: norm([item(10, { labels: [{ name: HARNESS }] })]), offene: new Set<number>(), ...(frisch ? { frisch } : {}) }),
    });
  const alle = { projektIds: [PROD, FACT] };

  test("Nummern mit Item auf einem der Boards, in keiner REST-Liste: Verzug, sortiert; Textzeile direkt unter dem Ticket, JSON-Feld, Exit unverändert", () => {
    const frisch: Frisch = { issues: [frischer(1885, [FACT]), frischer(1871, [PROD]), frischer(1), frischer(10, [FACT])], ...alle };
    const t = lauf(frisch, ["--bereich", "spiel"]);
    expect(t.code).toBe(0);
    expect(t.out.split("\n")[0]).toBe("#1\tT1");
    expect(t.out.split("\n")[1]).toBe("VERZUG #1871, #1885: Board-REST-Liste hinkt, die Auswahl sieht sie nicht");
    expect((JSON.parse(lauf(frisch).out) as { verzug: number[] }).verzug).toEqual([1871, 1885]);
  });
  test("ein Issue ohne Board-Item oder mit fremdem Projekt ist kein Verzug", () => {
    expect(V.verzugNummern({ frisch: [frischer(5, []), frischer(6, ["PRJ_fremd"])], produkt: [], factory: [], ...alle })).toEqual([]);
    const t = lauf({ issues: [frischer(5, [])], ...alle }, ["--bereich", "spiel"]);
    expect(t.out).not.toContain("VERZUG");
    expect(JSON.parse(lauf({ issues: [frischer(5, [])], ...alle }).out)).toMatchObject({ verzug: [] });
  });
  test("GraphQL-Fehler: fail-open, gleiche Auswahl, Hinweis statt VERZUG", () => {
    const mit = lauf({ fehler: "Rate-Limit" }, ["--bereich", "spiel"]);
    const ohne = lauf(undefined, ["--bereich", "spiel"]);
    expect(mit.code).toBe(ohne.code);
    expect(mit.out.split("\n")[0]).toBe(ohne.out.split("\n")[0]);
    expect(mit.out).toContain("hinweis Board-Verzug nicht prüfbar (GraphQL): Rate-Limit");
    expect(mit.out).not.toContain("VERZUG #");
  });
  test("ladeFrisch fängt einen werfenden Lader zu { fehler } ab und fragt 50 Issues", () => {
    expect(V.ladeFrisch(() => { throw new Error("kaputt"); })).toEqual({ fehler: "kaputt" });
    const gesehen: unknown[] = [];
    const r = V.ladeFrisch((a) => (gesehen.push(a), []));
    expect(gesehen).toEqual([{ anzahl: 50 }]);
    const idVon = (rolle: string): string | undefined => projektConfig().boards.find((b) => b.rolle === rolle)?.projectId;
    expect(idVon("produkt")).toBeTruthy();
    expect(idVon("factory")).toBeTruthy();
    expect(idVon("produkt")).not.toBe(idVon("factory"));
    expect("issues" in r && r.projektIds).toEqual([idVon("produkt"), idVon("factory")]);
  });
});

describe("Härtungs-Takt: das Harness-Sammelticket erst ab dem Füllstand (#1888)", () => {
  type Fuell = (nr: number) => number | { fehler: string };
  const SAMMEL = { title: "Harness-Härtung (gesammelt)", labels: [{ name: HARNESS }] };
  const mit = (fuellstand: Fuell | undefined, extra: Record<string, unknown> = {}) =>
    (frei as (i: unknown[], e: unknown) => Ergebnis)([item(1, SAMMEL), item(2, { labels: [{ name: HARNESS }] })], { bereich: "agentic", fuellstand, ...extra });

  test("Grenze 9/10/11: unter der Schwelle übersprungen mit Grund, ab 10 gewählt", () => {
    const neun = mit(() => 9);
    expect(neun.ticket?.nr).toBe(2);
    expect(neun.uebersprungen).toEqual([{ nr: 1, grund: "füllt sich (9/10 Befund-Kommentare)" }]);
    expect(mit(() => 10).ticket?.nr).toBe(1);
    expect(mit(() => 11).ticket?.nr).toBe(1);
    expect(mit(() => 0).uebersprungen[0].grund).toBe("füllt sich (0/10 Befund-Kommentare)");
  });
  test("nicht ladbar oder ohne Lader: übersprungen (fail-closed), nie gewählt", () => {
    expect(mit(() => ({ fehler: "HTTP 502" })).uebersprungen).toEqual([{ nr: 1, grund: "Füllstand nicht prüfbar (HTTP 502)" }]);
    expect(mit(undefined).uebersprungen[0].grund).toMatch(/^Füllstand nicht prüfbar/);
    expect(mit(undefined).ticket?.nr).toBe(2);
  });
  test("der Füllstand wird nur für das ungeclaimte Sammelticket als Kandidat geladen: nicht für andere Items, nicht für ein geclaimtes Sammelticket, nicht nach einem früheren Treffer", () => {
    const gefragt: number[] = [];
    const spion: Fuell = (nr) => (gefragt.push(nr), 10);
    mit(spion);
    expect(gefragt).toEqual([1]);
    gefragt.length = 0;
    (frei as (i: unknown[], e: unknown) => Ergebnis)([item(2, { labels: [{ name: HARNESS }] }), item(1, SAMMEL)], { bereich: "agentic", fuellstand: spion });
    expect(gefragt).toEqual([]); // Item 2 ist frei und kommt zuerst
    (frei as (i: unknown[], e: unknown) => Ergebnis)([item(1, { ...SAMMEL, assignees: [{ login: OWNER }] }), item(2, { labels: [{ name: HARNESS }] })], { bereich: "agentic", fuellstand: spion });
    expect(gefragt).toEqual([]); // geclaimt: Assignee-Grund, kein Laden
  });
  test("das Langfuse-Sammelticket hängt nicht am Füllstand: gewählt trotz Füllstand 0, der Lader wird für es nicht gefragt", () => {
    const gefragt: number[] = [];
    const r = (frei as (i: unknown[], e: unknown) => Ergebnis)([item(1, { title: "Langfuse-Befunde (gesammelt)", labels: [{ name: HARNESS }] })], { bereich: "agentic", fuellstand: (nr: number) => (gefragt.push(nr), 0) });
    expect(r.ticket?.nr).toBe(1);
    expect(gefragt).toEqual([]);
  });
  test("--ticket umgeht die Schwelle: die Einzelprüfung nimmt das Sammelticket auch bei Füllstand 3", () => {
    const pruefe = N.pruefeTicket({ item: N.itemAusIssue(item(1, SAMMEL).content), offene: new Set(), owner: OWNER, namen: NAMEN, config: CFG } as never);
    expect(pruefe.ticket?.nr).toBe(1);
  });
  test("fuehreAus: der Lader aus der io entscheidet; ohne ihn bleibt das Sammelticket liegen", () => {
    const eingabe = { items: norm([item(1, SAMMEL), item(2, { labels: [{ name: HARNESS }] })]), offene: new Set<number>() };
    const lauf = (fuellstand?: Fuell) => N.fuehreAus(["--bereich", "agentic"], { owner: OWNER, namen: NAMEN, lade: () => zweiBoards(eingabe), config: CFG, fuellstand } as never);
    expect(lauf(() => 10).out.split("\n")[0]).toBe("#1\tT1".replace("T1", "Harness-Härtung (gesammelt)"));
    const r = lauf(() => 4);
    expect(r.out.split("\n")[0]).toBe("#2\tT2");
    expect(r.out).toContain("übersprungen #1: füllt sich (4/10 Befund-Kommentare)");
    expect(lauf().out).toContain("Füllstand nicht prüfbar");
  });
  test("Mängelliste und Einzelprüfung fragen den Füllstand nie", () => {
    const eingabe = { items: norm([item(1, SAMMEL)]), offene: new Set<number>() };
    const r = N.fuehreAus(["--maengel"], { owner: OWNER, namen: NAMEN, lade: () => zweiBoards(eingabe), config: CFG, fuellstand: () => { throw new Error("darf nicht fragen"); } } as never);
    expect(r).toMatchObject({ code: 0, err: "" }); // ein Wurf des Laders wäre hier Exit 2
  });

  describe("fuellstandLader: Kommentare vertrauter Nicht-Bot-Autoren, Memo, Ladefehler", () => {
    const lader = (N as unknown as { fuellstandLader: (o: { holeKommentare: (nr: number) => unknown; owner: string }) => Fuell }).fuellstandLader;
    const k = (login: string, type = "User") => ({ user: { login, type } });
    test("zählt nur den Owner ohne Bots, lädt je Nummer einmal", () => {
      let n = 0;
      const f = lader({ holeKommentare: () => (n++, [k(OWNER), k(OWNER), k("fremd"), k("github-actions[bot]", "Bot")]), owner: OWNER });
      expect(f(5)).toBe(2);
      expect(f(5)).toBe(2);
      expect(n).toBe(1);
    });
    test("ein Ladefehler oder eine falsche Form wird zu { fehler } (kein Wurf)", () => {
      const f = lader({ holeKommentare: () => { throw new Error("HTTP 502\nzweite Zeile"); }, owner: OWNER });
      expect(f(5)).toEqual({ fehler: "Kommentare von #5 nicht ladbar: HTTP 502" });
      const r = lader({ holeKommentare: () => ({}), owner: OWNER })(5);
      expect(typeof r === "object" ? r.fehler : "").toMatch(/nicht ladbar/);
    });
  });
});

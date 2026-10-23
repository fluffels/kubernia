/* Board-Rollen (#1728, ADR 0022 F11): das Board ist ein Pflichtparameter der I/O-Funktionen, die Rolle kommt aus der Projekt-Config,
 * `boardRolleFuer` trennt Factory- und Produkt-Arbeit am Label, und jeder Aufrufer übergibt sein Board ausdrücklich.
 *
 * Reines Node-Tooling ohne Declaration-File: Import über `unknown` auf ein lokales Interface (Technik wie test/board.test.ts). */
import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as rawLib from "../scripts/board-lib.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import { FREMD, projektConfig } from "./support/fremd-config";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as rawPlace from "../scripts/board-place.mjs";

type Board = { rolle: string; besitzer: string; nummer: number; projectId: string };
type Lib = {
  boardFuerRolle: (rolle: string) => Board;
  boardRolleFuer: (labels: unknown, config?: unknown) => string;
  loadItems: (...a: unknown[]) => unknown;
  loadItemPages: (...a: unknown[]) => unknown;
  setPosition: (...a: unknown[]) => unknown;
  addToBoardTodo: (...a: unknown[]) => unknown;
  itemsUeberIssues: (...a: unknown[]) => unknown;
  itemsAusAliasAntwort: (...a: unknown[]) => unknown;
  itemAusIssueAntwort: (...a: unknown[]) => unknown;
  seitenListen: (p: Item[], f: Item[], c?: unknown) => { produkt: Item[]; factory: Item[]; doppelt: number[]; falsch: number[] };
  kopfRang: (i: { title?: string }) => number;
  aufnahmePlan: (fehlend: number[], issues: Record<number, unknown>, o?: { config?: unknown; ankerNr?: number | null }) => { aufnehmen: { number: number; rolle: string }[] };
};
type Item = { number: number; title?: string; labels?: string[] };
const L = rawLib as unknown as Lib;
const echt = FREMD; // injiziert: der getestete Code liest die Config nicht selbst
const real = projektConfig(); // nur für `boardFuerRolle`, das die Projekt-Config des Repos liest
const HARNESS = FREMD.labels.harness;

describe("boardFuerRolle", () => {
  test("liefert das Board der Rolle aus der Config; Produkt und Factory sind verschiedene Boards", () => {
    const produkt = L.boardFuerRolle("produkt");
    const factory = L.boardFuerRolle("factory");
    expect(produkt).toMatchObject(real.boards.find((b) => b.rolle === "produkt") ?? {});
    expect(factory).toMatchObject(real.boards.find((b) => b.rolle === "factory") ?? {});
    expect(produkt.nummer).toBe(real.boards.find((b) => b.rolle === "produkt")?.nummer);
    expect(factory.projectId).not.toBe(produkt.projectId);
    expect(factory.nummer).not.toBe(produkt.nummer);
  });
  test("unbekannte Rolle (auch Prototyp-Namen) wirft mit Fix-Zeile; der Eintrag ist eingefroren", () => {
    for (const rolle of ["", "Produkt", "constructor", "toString"]) expect(() => L.boardFuerRolle(rolle), rolle).toThrow(/Unbekannte Board-Rolle[\s\S]*Fix:/);
    expect(Object.isFrozen(L.boardFuerRolle("produkt"))).toBe(true);
  });
});

describe("boardRolleFuer", () => {
  test("das Harness-Label ergibt factory, alles andere produkt (Strings und Label-Objekte)", () => {
    expect(L.boardRolleFuer([], echt)).toBe("produkt");
    expect(L.boardRolleFuer(["bug", HARNESS], echt)).toBe("factory");
    expect(L.boardRolleFuer([{ name: HARNESS }], echt)).toBe("factory");
    expect(L.boardRolleFuer(["area:spiel", { name: "bug" }, null], echt)).toBe("produkt");
  });
  test("nur exakte Gleichheit: das Label mit Suffix oder Präfix zählt nicht", () => {
    expect(L.boardRolleFuer([`${HARNESS}-x`], echt)).toBe("produkt");
    expect(L.boardRolleFuer([{ name: `x${HARNESS}` }], echt)).toBe("produkt");
  });
  test("ohne Label-Liste wirft sie, statt still das Produkt-Board zu wählen", () => {
    for (const bad of [null, undefined, HARNESS, {}]) expect(() => L.boardRolleFuer(bad, echt), JSON.stringify(bad) ?? "undefined").toThrow(/Label-Liste[\s\S]*Fix:/);
    // kein Zufallstreffer: eine echte Liste wirft nicht
    expect(() => L.boardRolleFuer([], echt)).not.toThrow();
  });
});

const H = [HARNESS];
const nrn = (l: Item[]) => l.map((i) => i.number);

describe("seitenListen: zwei Boards als zwei Auswahllisten (#1729)", () => {
  test("Items auf dem richtigen Board behalten die Board-Reihenfolge", () => {
    const p = [{ number: 3, labels: [] }, { number: 1, labels: [] }];
    const f = [{ number: 9, labels: H }, { number: 2, labels: H }];
    const r = L.seitenListen(p, f, echt);
    expect(nrn(r.produkt)).toEqual([3, 1]);
    expect(nrn(r.factory)).toEqual([9, 2]);
    expect(r.doppelt).toEqual([]);
    expect(r.falsch).toEqual([]);
  });
  test("eine Nummer auf beiden Boards (doppelt) zählt nur auf dem Board laut Trennregel", () => {
    const r = L.seitenListen([{ number: 5, labels: H }, { number: 6, labels: [] }], [{ number: 5, labels: H }, { number: 6, labels: [] }], echt);
    expect(r.doppelt).toEqual([5, 6]);
    expect(nrn(r.factory)).toEqual([5]);
    expect(nrn(r.produkt)).toEqual([6]);
    expect(r.falsch).toEqual([]);
  });
  test("ein Item nur auf dem falschen Board zählt auf seiner Seite und hängt hinten an, die relative Reihenfolge bleibt", () => {
    const p = [{ number: 5, labels: H }, { number: 6, labels: [] }, { number: 7, labels: H }];
    const f = [{ number: 10, labels: H }];
    const r = L.seitenListen(p, f, echt);
    expect(nrn(r.factory)).toEqual([10, 5, 7]);
    expect(nrn(r.produkt)).toEqual([6]);
    expect(r.falsch).toEqual([5, 7]);
  });
  test("ein Item ohne Labels gehört zum Produkt-Board; die Eingaben bleiben unverändert", () => {
    const p = [{ number: 1 }];
    const f = [{ number: 2 }];
    const kopieP = JSON.stringify(p);
    const r = L.seitenListen(p, f, echt);
    expect(nrn(r.produkt)).toEqual([1, 2]);
    expect(r.falsch).toEqual([2]);
    expect(JSON.stringify(p)).toBe(kopieP);
    expect(f).toEqual([{ number: 2 }]);
  });
});

describe("kopfRang und aufnahmePlan.rolle (#1729)", () => {
  test("Notfall-Marker in der Reihenfolge von NOTFAELLE, danach das Status-Ticket, sonst Infinity", () => {
    const rot = L.kopfRang({ title: "🚨 CI rot auf main: x" });
    const sec = L.kopfRang({ title: "🔒 Security: y" });
    const status = L.kopfRang({ title: "Langfuse-Status überprüfen" });
    expect(rot).toBeLessThan(sec);
    expect(sec).toBeLessThan(status);
    expect(Number.isFinite(status)).toBe(true);
    expect(L.kopfRang({ title: "normales Ticket" })).toBe(Infinity);
    expect(L.kopfRang({})).toBe(Infinity);
  });
  test("jeder aufzunehmende Eintrag trägt die Rolle laut Trennregel", () => {
    const issue = (n: number, labels: unknown[]) => ({ number: n, state: "open", node_id: `N${n}`, title: "t", labels });
    const r = L.aufnahmePlan([1, 2, 3], { 1: issue(1, [{ name: HARNESS }]), 2: issue(2, []), 3: { ...issue(3, []), labels: undefined } }, { config: echt });
    expect(r.aufnehmen.map((a) => [a.number, a.rolle])).toEqual([[1, "factory"], [2, "produkt"], [3, "produkt"]]);
  });
});

describe("ankerFehler: die Ankerregel von board-place und spezifikation (#1740)", () => {
  const A = rawLib as unknown as { ankerFehler: (a: { anchor: number; rolle: string; produkt: Item[]; factory: Item[] }) => string | null };
  const it = (nr: number): Item => ({ number: nr, labels: [] });
  test("Anker nur auf dem anderen Board: Text mit beiden Boards, in beiden Richtungen", () => {
    expect(A.ankerFehler({ anchor: 3, rolle: "factory", produkt: [it(3)], factory: [] })).toBe("Anker #3 steht nur auf dem Produkt-Board, die Nummern gehören auf das Factory-Board");
    expect(A.ankerFehler({ anchor: 4, rolle: "produkt", produkt: [], factory: [it(4)] })).toBe("Anker #4 steht nur auf dem Factory-Board, die Nummern gehören auf das Produkt-Board");
  });
  test("Anker auf dem eigenen Board, auf beiden oder auf keinem: kein Fehler", () => {
    expect(A.ankerFehler({ anchor: 3, rolle: "factory", produkt: [], factory: [it(3)] })).toBeNull();
    expect(A.ankerFehler({ anchor: 3, rolle: "produkt", produkt: [it(3)], factory: [] })).toBeNull();
    expect(A.ankerFehler({ anchor: 3, rolle: "factory", produkt: [it(3)], factory: [it(3)] })).toBeNull();
    expect(A.ankerFehler({ anchor: 9, rolle: "factory", produkt: [it(3)], factory: [it(4)] })).toBeNull();
  });
});

describe("zielRolle: das Board für board-place (#1729)", () => {
  const Z = rawPlace as unknown as { zielRolle: (a: { numbers: number[]; anchor?: number | null; produkt: Item[]; factory: Item[]; labelsRest?: Record<number, unknown>; config?: unknown }) => { rolle?: string; doppelt?: number[]; fehler?: string } };
  const f = (nr: number): Item => ({ number: nr, labels: H });
  const p = (nr: number): Item => ({ number: nr, labels: [] });
  test("alle Nummern Factory: Factory; alle Produkt: Produkt", () => {
    expect(Z.zielRolle({ numbers: [1, 2], produkt: [], factory: [f(1), f(2)], config: echt })).toMatchObject({ rolle: "factory", doppelt: [] });
    expect(Z.zielRolle({ numbers: [3], produkt: [p(3)], factory: [], config: echt })).toMatchObject({ rolle: "produkt" });
  });
  test("gemischte Nummern sind ein Fehler mit beiden Rollen im Text", () => {
    const r = Z.zielRolle({ numbers: [1, 3], produkt: [p(3)], factory: [f(1)], config: echt });
    expect(r.fehler).toMatch(/gemischte Nummern: #1 factory, #3 produkt/);
  });
  test("ein Anker nur auf dem anderen Board ist ein Fehler, auf beiden oder auf dem Ziel-Board nicht", () => {
    expect(Z.zielRolle({ numbers: [1], anchor: 3, produkt: [p(3)], factory: [f(1)], config: echt }).fehler).toMatch(/Anker #3 steht nur auf dem Produkt-Board/);
    expect(Z.zielRolle({ numbers: [1], anchor: 3, produkt: [p(3)], factory: [f(1), f(3)], config: echt }).fehler).toBeUndefined();
    expect(Z.zielRolle({ numbers: [1], anchor: 2, produkt: [], factory: [f(1), f(2)], config: echt }).fehler).toBeUndefined();
  });
  test("eine Nummer auf beiden Boards wird als doppelt gemeldet, die Rolle folgt der Trennregel", () => {
    const r = Z.zielRolle({ numbers: [5], produkt: [f(5)], factory: [f(5)], config: echt });
    expect(r).toEqual({ rolle: "factory", doppelt: [5] });
  });
  test("ohne Item im Board kommen die Labels aus der Issue-REST; ohne beides ist die Rolle nicht bestimmbar", () => {
    expect(Z.zielRolle({ numbers: [7], produkt: [], factory: [], labelsRest: { 7: [HARNESS] }, config: echt })).toMatchObject({ rolle: "factory" });
    expect(Z.zielRolle({ numbers: [7], produkt: [], factory: [], config: echt }).fehler).toMatch(/#7: Board-Rolle nicht bestimmbar/);
    expect(Z.zielRolle({ numbers: [7], produkt: [], factory: [], labelsRest: { 7: null }, config: echt }).fehler).toMatch(/nicht bestimmbar/);
  });
});

describe("Guard: jede I/O-Funktion verlangt ein Board-Objekt als ersten Parameter", () => {
  const fns: [string, unknown[]][] = [
    ["loadItems", []],
    ["loadItemPages", []],
    ["setPosition", ["I1", null]],
    ["addToBoardTodo", ["node"]],
    ["itemsUeberIssues", [[1]]],
    ["itemsAusAliasAntwort", [{ data: { repository: {} } }, [1]]],
    ["itemAusIssueAntwort", [{ data: { repository: { issue: null } } }]],
  ];
  for (const [name, rest] of fns) {
    test(`${name}: ohne Board, mit String oder leerem Objekt wirft sie synchron vor jedem gh-Aufruf`, () => {
      const f = (L as unknown as Record<string, (...a: unknown[]) => unknown>)[name];
      for (const falsch of [undefined, null, "produkt", {}, { projectId: "" }, [1]]) {
        expect(() => f(falsch, ...rest), `${name}(${JSON.stringify(falsch)})`).toThrow(/Board fehlt[\s\S]*Fix:/);
      }
    });
  }
});

describe("Verdrahtung: jeder Aufrufer übergibt sein Board ausdrücklich", () => {
  const AUFRUFER = ["board-place", "board-takt", "sammelticket-anlegen", "langfuse-takt", "naechstes-ticket"];
  const FUNKTIONEN = /\b(loadItems|loadItemPages|setPosition|addToBoardTodo|itemsUeberIssues|entferneVomBoard)\b/g;
  /** Quelltext ohne Kommentare und ohne den Importblock aus board-lib. */
  const code = (f: string): string =>
    readFileSync(new URL(`../scripts/${f}.mjs`, import.meta.url), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:])\/\/.*$/gm, "$1")
      .replace(/import \{[^}]*\} from "\.\/board-lib\.mjs";/g, "");
  for (const f of AUFRUFER) {
    test(`${f}: jedes Vorkommen ist ein Aufruf mit einem ausdrücklichen Board oder ein Objektschlüssel`, () => {
      const q = code(f);
      for (const m of q.matchAll(FUNKTIONEN)) {
        const davor = q.slice(0, m.index).trimEnd();
        const danach = q.slice((m.index ?? 0) + m[0].length);
        if (davor.endsWith(".")) continue; // Zugriff auf ein Objekt (io.loadItems)
        if (/^\s*:/.test(danach) && !davor.endsWith("=>")) continue; // Objektschlüssel `name:`; Shorthand und `= name,` sind Verstöße
        expect(danach, `${f}: ${m[0]}`).toMatch(/^\((PRODUKT_BOARD|FACTORY_BOARD|board)\b|^\(boardFuerRolle\(/);
      }
    });
  }
  test("die Aufrufer binden ihr Board über die Rolle, nicht über ein Literal", () => {
    for (const f of AUFRUFER) {
      const q = readFileSync(new URL(`../scripts/${f}.mjs`, import.meta.url), "utf8");
      expect(q, f).toContain("boardFuerRolle(");
      expect(q, f).not.toMatch(/PVT_/);
    }
  });
  test("board-place wählt sein Board über zielRolle und meldet einen Fehler als Exit 2; board-takt bindet das Factory-Board über die Rolle", () => {
    const q = readFileSync(new URL("../scripts/board-place.mjs", import.meta.url), "utf8");
    expect(q).toContain("const board = boardFuerRolle(ziel.rolle);");
    expect(q).toContain("let items = listen[ziel.rolle];");
    expect(q).toContain("if (ziel.fehler) throw abbruch(ziel.fehler, 2);");
    const takt = readFileSync(new URL("../scripts/board-takt.mjs", import.meta.url), "utf8");
    expect(takt).toContain('const FACTORY_BOARD = boardFuerRolle("factory");');
  });
  test("kein Aufruf bindet ein festes Produkt-Board (boardFuerRolle(\"produkt\") am Aufruf) in Takt, Sammelticket und Status-Ticket", () => {
    for (const f of ["board-takt", "sammelticket-anlegen", "langfuse-takt"]) {
      expect(readFileSync(new URL(`../scripts/${f}.mjs`, import.meta.url), "utf8"), f).not.toContain('boardFuerRolle("produkt")');
    }
  });
  test("Sammel- und Status-Tickets leiten ihr Board aus dem eigenen Label ab und legen mit demselben Label an", () => {
    for (const f of ["sammelticket-anlegen", "langfuse-takt"]) {
      const q = readFileSync(new URL(`../scripts/${f}.mjs`, import.meta.url), "utf8");
      expect(q, f).toContain("boardFuerRolle(boardRolleFuer([harness], config))");
      expect(q, f).toContain("labels[]=${harness}");
      expect(q, f).not.toContain("PRODUKT_BOARD");
    }
  });
});

describe("umzugsPlan: Items auf dem falschen Board umziehen (#1730)", () => {
  type U = Item & { id: string; status: string; state: string; contentId: string };
  type Schritt = { aktion: string; number: number; title: string; von: string; nach: string; quelleId: string; contentId?: string };
  type Plan = { schritte: Schritt[]; gemeldet: { number: number; grund: string }[]; ende: { produkt: string | null; factory: string | null } };
  const plan = (p: U[], f: U[]): Plan => (L as unknown as { umzugsPlan: (p: U[], f: U[], c: unknown) => Plan }).umzugsPlan(p, f, echt);
  const it = (number: number, labels: string[] = [], extra: Partial<U> = {}): U => ({ id: `ITEM_${number}`, number, status: "Todo", state: "open", contentId: `I_${number}`, labels, ...extra });
  const H = [HARNESS];

  test("Harness-Items vom Produkt-Board ziehen in Quell-Reihenfolge nach Factory, Nicht-Harness dazwischen bleibt", () => {
    const p = plan([it(1, H), it(2), it(3, H), it(4)], [it(9, H)]);
    expect(p.schritte).toEqual([
      { aktion: "umziehen", number: 1, title: "", von: "produkt", nach: "factory", quelleId: "ITEM_1", contentId: "I_1" },
      { aktion: "umziehen", number: 3, title: "", von: "produkt", nach: "factory", quelleId: "ITEM_3", contentId: "I_3" },
    ]);
    expect(p.gemeldet).toEqual([]);
    expect(p.ende).toEqual({ produkt: "ITEM_4", factory: "ITEM_9" });
  });

  test("Gegenrichtung: Nicht-Harness auf dem Factory-Board zieht aufs Produkt-Board", () => {
    const p = plan([], [it(5), it(6, H)]);
    expect(p.schritte.map((s) => [s.number, s.von, s.nach])).toEqual([[5, "factory", "produkt"]]);
    expect(p.ende).toEqual({ produkt: null, factory: "ITEM_6" });
  });

  test("ein Item auf beiden Boards wird nur vom falschen entfernt, nicht doppelt angelegt", () => {
    const p = plan([it(1, H)], [it(1, H)]);
    expect(p.schritte).toEqual([{ aktion: "entfernen", number: 1, title: "", von: "produkt", nach: "factory", quelleId: "ITEM_1" }]);
  });

  test("Status ungleich Todo (auch leer) und fehlende Issue-ID werden gemeldet und nicht umgezogen", () => {
    const p = plan([it(1, H, { status: "In Progress" }), it(2, H, { status: "" }), it(3, H, { contentId: "" }), it(4, H)], []);
    expect(p.schritte.map((s) => s.number)).toEqual([4]);
    expect(p.gemeldet.map((g) => g.number)).toEqual([1, 2, 3]);
    expect(p.gemeldet[0].grund).toMatch(/In Progress/);
    expect(p.gemeldet[1].grund).toMatch(/leer/);
  });

  test("steht ein Item auf beiden Boards, geht „entfernen“ dem Status-Test vor (kein Exit 1 wegen In Progress)", () => {
    const p = plan([it(1, H, { status: "In Progress" })], [it(1, H)]);
    expect(p.schritte.map((s) => s.aktion)).toEqual(["entfernen"]);
    expect(p.gemeldet).toEqual([]);
  });

  test("beide Richtungen in einem Plan: erst Produkt-, dann Factory-Items; der Anker ist das letzte Item, das der Lauf nicht selbst entfernt", () => {
    const p = plan([it(1), it(2, H)], [it(9, H), it(5)]);
    expect(p.schritte.map((s) => [s.number, s.nach])).toEqual([[2, "factory"], [5, "produkt"]]);
    // das letzte Item beider Boards zieht selbst um: der Anker ist das davor
    expect(p.ende).toEqual({ produkt: "ITEM_1", factory: "ITEM_9" });
  });

  test("ein Board, dessen Items alle ausziehen, hat keinen Anker (Spitze)", () => {
    expect(plan([it(2, H)], []).ende).toEqual({ produkt: null, factory: null });
  });

  test("Meldegrund bei fehlender Issue-ID", () => {
    expect(plan([it(3, H, { contentId: "" })], []).gemeldet[0].grund).toMatch(/Issue-Node-ID/);
  });

  test("der Titel wird in den Schritt durchgereicht", () => {
    expect(plan([it(4, H, { title: "Vier" })], []).schritte[0].title).toBe("Vier");
  });

  test("auch ein nur zu entfernendes Item ist als Anker ausgeschlossen (steht auf beiden Boards, letzte Position)", () => {
    const p = plan([it(3), it(1, H)], [it(1, H), it(5)]);
    expect(p.schritte.map((s) => [s.aktion, s.number])).toEqual([["entfernen", 1], ["umziehen", 5]]);
    expect(p.ende.produkt).toBe("ITEM_3");
  });

  test("geschlossene Items bleiben als Historie, richtig stehende Items bleiben, ein Plan nach dem Umzug ist leer (idempotent)", () => {
    expect(plan([it(1, H, { state: "closed" }), it(2)], [it(3, H)])).toMatchObject({ schritte: [], gemeldet: [] });
    expect(plan([], [it(1, H), it(2, H)]).schritte).toEqual([]);
  });

  test("die Eingaben bleiben unverändert", () => {
    const p = Object.freeze([Object.freeze(it(1, H))]) as unknown as U[];
    const f = Object.freeze([]) as unknown as U[];
    expect(() => plan(p, f)).not.toThrow();
  });
});

describe("fuehreUmzugAus: aufnehmen, positionieren, erst dann entfernen (#1730)", () => {
  type S = { aktion: string; number: number; title: string; von: string; nach: string; quelleId: string; contentId?: string };
  type Plan = { schritte: S[]; gemeldet: { number: number; grund: string }[]; ende: { produkt: string | null; factory: string | null } };
  const F = (rawPlace as unknown as { fuehreUmzugAus: (p: Plan, io: Record<string, unknown>) => Promise<number> }).fuehreUmzugAus;
  const um = (number: number): S => ({ aktion: "umziehen", number, title: "", von: "produkt", nach: "factory", quelleId: `Q${number}`, contentId: `C${number}` });
  const entf = (n: number): S => ({ aktion: "entfernen", number: n, title: "", von: "produkt", nach: "factory", quelleId: `Q${n}` });
  const lauf = (schritte: S[], extra: Record<string, unknown> = {}, gemeldet: Plan["gemeldet"] = []) => {
    const ruf: string[] = [];
    const warn: string[] = [];
    const io = {
      dry: false,
      aufnehmen: (r: string, c: string) => (ruf.push(`auf ${r} ${c}`), `N${c}`),
      positioniere: (r: string, i: string, a: string | null) => void ruf.push(`pos ${r} ${i} nach ${a}`),
      entferne: (r: string, i: string) => void ruf.push(`weg ${r} ${i}`),
      schlafe: () => void ruf.push("zzz"),
      log: () => undefined,
      warn: (m: string) => void warn.push(m),
      ...extra,
    };
    const p = F({ schritte, gemeldet, ende: { produkt: "PE", factory: "FE" } }, io);
    return { p, ruf, warn };
  };
  const ohneZzz = (r: string[]) => r.filter((x) => x !== "zzz");

  test("Reihenfolge je Item: aufnehmen, positionieren (Kette ab Board-Ende), entfernen; Pause nach jeder Mutation", async () => {
    const { p, ruf } = lauf([um(1), um(2)]);
    await p;
    expect(ohneZzz(ruf)).toEqual(["auf factory C1", "pos factory NC1 nach FE", "weg produkt Q1", "auf factory C2", "pos factory NC2 nach NC1", "weg produkt Q2"]);
    expect(ruf.filter((x) => x === "zzz")).toHaveLength(6);
  });

  test("ein Schritt „entfernen“ ruft nur entferne", async () => {
    const { p, ruf } = lauf([entf(7)]);
    await p;
    expect(ohneZzz(ruf)).toEqual(["weg produkt Q7"]);
  });

  test("scheitert das Aufnehmen, bleibt das Item auf dem Quell-Board: kein Entfernen, nichts für die Rest-Items; das erste ist erledigt", async () => {
    const ruf: string[] = [];
    let n = 0;
    const aufnehmen = (r: string, c: string): string => {
      if (++n === 2) throw new Error("API rate limit exceeded");
      ruf.push(`auf ${r} ${c}`);
      return `N${c}`;
    };
    const { p, ruf: ruf2 } = lauf([um(1), um(2), um(3)], { aufnehmen });
    await expect(p).rejects.toThrow(/#2 abgebrochen[\s\S]*Offen bleiben #2, #3[\s\S]*idempotent/);
    expect(ohneZzz(ruf2)).toEqual(["pos factory NC1 nach FE", "weg produkt Q1"]);
    expect(ruf).toEqual(["auf factory C1"]);
  });

  test("scheitert das Positionieren, wird nicht entfernt, und die Meldung nennt den Doppelstand", async () => {
    const { p, ruf } = lauf([um(1)], { positioniere: () => { throw new Error("boom"); } });
    await expect(p).rejects.toThrow(/#1 steht auf beiden Boards/);
    expect(ruf.some((x) => x.startsWith("weg"))).toBe(false);
  });

  test("scheitert das Aufnehmen, behauptet die Meldung keinen Doppelstand, sondern nur „möglicherweise“ (halb gescheitertes Aufnehmen)", async () => {
    const { p } = lauf([um(1)], { aufnehmen: () => { throw new Error("rate limit"); } });
    const fehler = await p.then(() => "", (e: Error) => e.message);
    expect(fehler).not.toMatch(/steht auf beiden Boards/);
    expect(fehler).toMatch(/möglicherweise schon auf dem Ziel-Board/);
  });

  test("scheitert das Entfernen: bei „umziehen“ Doppelstand gemeldet, bei einem reinen „entfernen“-Schritt keiner", async () => {
    const boom = () => { throw new Error("boom"); };
    const a = lauf([um(1)], { entferne: boom });
    await expect(a.p).rejects.toThrow(/#1 steht auf beiden Boards/);
    const b = lauf([entf(2)], { entferne: boom });
    const fehler = await b.p.then(() => "", (e: Error) => e.message);
    expect(fehler).toMatch(/#2 abgebrochen/);
    expect(fehler).not.toMatch(/beiden Boards|möglicherweise/);
  });

  test("gemischte Richtungen: die Anker-Kette läuft je Ziel-Board getrennt", async () => {
    const zurueck: S = { aktion: "umziehen", number: 5, title: "", von: "factory", nach: "produkt", quelleId: "Q5", contentId: "C5" };
    const { p, ruf } = lauf([um(1), zurueck, um(2)]);
    await p;
    expect(ohneZzz(ruf).filter((x) => x.startsWith("pos"))).toEqual(["pos factory NC1 nach FE", "pos produkt NC5 nach PE", "pos factory NC2 nach NC1"]);
  });

  test("dry: keine Mutation, keine Pause", async () => {
    const { p, ruf } = lauf([um(1), entf(2)], { dry: true });
    await p;
    expect(ruf).toEqual([]);
  });

  test("gemeldete Items gehen als Warnung raus, die Zahl kommt zurück", async () => {
    const { p, warn } = lauf([], {}, [{ number: 5, grund: "Status X" }]);
    expect(await p).toBe(1);
    expect(warn).toEqual(["⚠ #5: Status X."]);
  });
});

describe("parseArgs --umzug und entferneVomBoard (#1730)", () => {
  const P = (rawPlace as unknown as { parseArgs: (a: string[]) => unknown }).parseArgs;
  test("--umzug allein oder mit --dry-run ist gültig", () => {
    expect(P(["--umzug"])).toEqual({ umzug: true, dry: false });
    expect(P(["--umzug", "--dry-run"])).toEqual({ umzug: true, dry: true });
  });
  test("jede Kombination mit Nummern oder anderen Flags ist ungültig", () => {
    for (const a of [["--umzug", "12"], ["--umzug", "--top", "1"], ["--notfall", "rot-main", "--umzug"], ["--umzug", "--missing"]]) expect(P(a), a.join(" ")).toBeNull();
  });
  test("normalizeItems trägt die Issue-Node-ID, fehlend ist sie leer", () => {
    const n = (L as unknown as { normalizeItems: (r: unknown) => { contentId: string }[] }).normalizeItems;
    const roh = [[{ node_id: "ITEM_1", content_type: "Issue", content: { node_id: "I_1", number: 1 }, fields: [] }, { node_id: "ITEM_2", content_type: "Issue", content: { number: 2 }, fields: [] }]];
    expect(n(roh).map((i) => i.contentId)).toEqual(["I_1", ""]);
  });
  test("entferneVomBoard ohne Board wirft vor jedem gh-Aufruf", () => {
    const f = (L as unknown as { entferneVomBoard: (...a: unknown[]) => unknown }).entferneVomBoard;
    for (const falsch of [undefined, null, "produkt", {}]) expect(() => f(falsch, "ITEM_1")).toThrow(/Board fehlt[\s\S]*Fix:/);
  });
});

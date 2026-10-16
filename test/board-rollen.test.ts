/* Board-Rollen (#1728, ADR 0022 F11): das Board ist ein Pflichtparameter der I/O-Funktionen, die Rolle kommt aus der Projekt-Config,
 * `boardRolleFuer` trennt Factory- und Produkt-Arbeit am Label, und jeder Aufrufer übergibt sein Board ausdrücklich.
 *
 * Reines Node-Tooling ohne Declaration-File: Import über `unknown` auf ein lokales Interface (Technik wie test/board.test.ts). */
import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as rawLib from "../scripts/board-lib.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as rawPc from "../scripts/projekt-config-lib.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as rawPlace from "../scripts/board-place.mjs";

type Board = { rolle: string; besitzer: string; nummer: number; projectId: string };
type Lib = {
  FACTORY_LABEL: string;
  boardFuerRolle: (rolle: string) => Board;
  boardRolleFuer: (labels: unknown) => string;
  loadItems: (...a: unknown[]) => unknown;
  loadItemPages: (...a: unknown[]) => unknown;
  setPosition: (...a: unknown[]) => unknown;
  addToBoardTodo: (...a: unknown[]) => unknown;
  itemsUeberIssues: (...a: unknown[]) => unknown;
  itemsAusAliasAntwort: (...a: unknown[]) => unknown;
  itemAusIssueAntwort: (...a: unknown[]) => unknown;
  seitenListen: (p: Item[], f: Item[]) => { produkt: Item[]; factory: Item[]; doppelt: number[]; falsch: number[] };
  kopfRang: (i: { title?: string }) => number;
  aufnahmePlan: (fehlend: number[], issues: Record<number, unknown>) => { aufnehmen: { number: number; rolle: string }[] };
};
type Item = { number: number; title?: string; labels?: string[] };
const L = rawLib as unknown as Lib;
const echt = (rawPc as unknown as { ladeProjektConfig(): { boards: Board[] } }).ladeProjektConfig();

describe("boardFuerRolle", () => {
  test("liefert das Board der Rolle aus der Config; Produkt und Factory sind verschiedene Boards", () => {
    const produkt = L.boardFuerRolle("produkt");
    const factory = L.boardFuerRolle("factory");
    expect(produkt).toMatchObject(echt.boards.find((b) => b.rolle === "produkt") ?? {});
    expect(factory).toMatchObject(echt.boards.find((b) => b.rolle === "factory") ?? {});
    expect(produkt.nummer).toBe(1);
    expect(factory.projectId).not.toBe(produkt.projectId);
    expect(factory.nummer).not.toBe(produkt.nummer);
  });
  test("unbekannte Rolle (auch Prototyp-Namen) wirft mit Fix-Zeile; der Eintrag ist eingefroren", () => {
    for (const rolle of ["", "Produkt", "constructor", "toString"]) expect(() => L.boardFuerRolle(rolle), rolle).toThrow(/Unbekannte Board-Rolle[\s\S]*Fix:/);
    expect(Object.isFrozen(L.boardFuerRolle("produkt"))).toBe(true);
  });
});

describe("boardRolleFuer", () => {
  test("area:harness ergibt factory, alles andere produkt (Strings und Label-Objekte)", () => {
    expect(L.FACTORY_LABEL).toBe("area:harness");
    expect(L.boardRolleFuer([])).toBe("produkt");
    expect(L.boardRolleFuer(["bug", "area:harness"])).toBe("factory");
    expect(L.boardRolleFuer([{ name: "area:harness" }])).toBe("factory");
    expect(L.boardRolleFuer(["area:spiel", { name: "bug" }, null])).toBe("produkt");
  });
  test("nur exakte Gleichheit: area:harness-x und xarea:harness zählen nicht", () => {
    expect(L.boardRolleFuer(["area:harness-x"])).toBe("produkt");
    expect(L.boardRolleFuer([{ name: "xarea:harness" }])).toBe("produkt");
  });
  test("ohne Label-Liste wirft sie, statt still das Produkt-Board zu wählen", () => {
    for (const bad of [null, undefined, "area:harness", {}]) expect(() => L.boardRolleFuer(bad), JSON.stringify(bad) ?? "undefined").toThrow(/Label-Liste[\s\S]*Fix:/);
    // kein Zufallstreffer: eine echte Liste wirft nicht
    expect(() => L.boardRolleFuer([])).not.toThrow();
  });
});

const H = ["area:harness"];
const nrn = (l: Item[]) => l.map((i) => i.number);

describe("seitenListen: zwei Boards als zwei Auswahllisten (#1729)", () => {
  test("Items auf dem richtigen Board behalten die Board-Reihenfolge", () => {
    const p = [{ number: 3, labels: [] }, { number: 1, labels: [] }];
    const f = [{ number: 9, labels: H }, { number: 2, labels: H }];
    const r = L.seitenListen(p, f);
    expect(nrn(r.produkt)).toEqual([3, 1]);
    expect(nrn(r.factory)).toEqual([9, 2]);
    expect(r.doppelt).toEqual([]);
    expect(r.falsch).toEqual([]);
  });
  test("eine Nummer auf beiden Boards (doppelt) zählt nur auf dem Board laut Trennregel", () => {
    const r = L.seitenListen([{ number: 5, labels: H }, { number: 6, labels: [] }], [{ number: 5, labels: H }, { number: 6, labels: [] }]);
    expect(r.doppelt).toEqual([5, 6]);
    expect(nrn(r.factory)).toEqual([5]);
    expect(nrn(r.produkt)).toEqual([6]);
    expect(r.falsch).toEqual([]);
  });
  test("ein Item nur auf dem falschen Board zählt auf seiner Seite und hängt hinten an, die relative Reihenfolge bleibt", () => {
    const p = [{ number: 5, labels: H }, { number: 6, labels: [] }, { number: 7, labels: H }];
    const f = [{ number: 10, labels: H }];
    const r = L.seitenListen(p, f);
    expect(nrn(r.factory)).toEqual([10, 5, 7]);
    expect(nrn(r.produkt)).toEqual([6]);
    expect(r.falsch).toEqual([5, 7]);
  });
  test("ein Item ohne Labels gehört zum Produkt-Board; die Eingaben bleiben unverändert", () => {
    const p = [{ number: 1 }];
    const f = [{ number: 2 }];
    const kopieP = JSON.stringify(p);
    const r = L.seitenListen(p, f);
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
    const r = L.aufnahmePlan([1, 2, 3], { 1: issue(1, [{ name: "area:harness" }]), 2: issue(2, []), 3: { ...issue(3, []), labels: undefined } });
    expect(r.aufnehmen.map((a) => [a.number, a.rolle])).toEqual([[1, "factory"], [2, "produkt"], [3, "produkt"]]);
  });
});

describe("zielRolle: das Board für board-place (#1729)", () => {
  const Z = rawPlace as unknown as { zielRolle: (a: { numbers: number[]; anchor?: number | null; produkt: Item[]; factory: Item[]; labelsRest?: Record<number, unknown> }) => { rolle?: string; doppelt?: number[]; fehler?: string } };
  const f = (nr: number): Item => ({ number: nr, labels: H });
  const p = (nr: number): Item => ({ number: nr, labels: [] });
  test("alle Nummern Factory: Factory; alle Produkt: Produkt", () => {
    expect(Z.zielRolle({ numbers: [1, 2], produkt: [], factory: [f(1), f(2)] })).toMatchObject({ rolle: "factory", doppelt: [] });
    expect(Z.zielRolle({ numbers: [3], produkt: [p(3)], factory: [] })).toMatchObject({ rolle: "produkt" });
  });
  test("gemischte Nummern sind ein Fehler mit beiden Rollen im Text", () => {
    const r = Z.zielRolle({ numbers: [1, 3], produkt: [p(3)], factory: [f(1)] });
    expect(r.fehler).toMatch(/gemischte Nummern: #1 factory, #3 produkt/);
  });
  test("ein Anker nur auf dem anderen Board ist ein Fehler, auf beiden oder auf dem Ziel-Board nicht", () => {
    expect(Z.zielRolle({ numbers: [1], anchor: 3, produkt: [p(3)], factory: [f(1)] }).fehler).toMatch(/Anker #3 steht nur auf dem Produkt-Board/);
    expect(Z.zielRolle({ numbers: [1], anchor: 3, produkt: [p(3)], factory: [f(1), f(3)] }).fehler).toBeUndefined();
    expect(Z.zielRolle({ numbers: [1], anchor: 2, produkt: [], factory: [f(1), f(2)] }).fehler).toBeUndefined();
  });
  test("eine Nummer auf beiden Boards wird als doppelt gemeldet, die Rolle folgt der Trennregel", () => {
    const r = Z.zielRolle({ numbers: [5], produkt: [f(5)], factory: [f(5)] });
    expect(r).toEqual({ rolle: "factory", doppelt: [5] });
  });
  test("ohne Item im Board kommen die Labels aus der Issue-REST; ohne beides ist die Rolle nicht bestimmbar", () => {
    expect(Z.zielRolle({ numbers: [7], produkt: [], factory: [], labelsRest: { 7: ["area:harness"] } })).toMatchObject({ rolle: "factory" });
    expect(Z.zielRolle({ numbers: [7], produkt: [], factory: [] }).fehler).toMatch(/#7: Board-Rolle nicht bestimmbar/);
    expect(Z.zielRolle({ numbers: [7], produkt: [], factory: [], labelsRest: { 7: null } }).fehler).toMatch(/nicht bestimmbar/);
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
  const FUNKTIONEN = /\b(loadItems|loadItemPages|setPosition|addToBoardTodo|itemsUeberIssues)\b/g;
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
  test("Sammel- und Status-Tickets leiten ihr Board aus dem eigenen Label ab und legen mit demselben Label an", () => {
    for (const f of ["sammelticket-anlegen", "langfuse-takt"]) {
      const q = readFileSync(new URL(`../scripts/${f}.mjs`, import.meta.url), "utf8");
      expect(q, f).toContain("const FACTORY_BOARD = boardFuerRolle(boardRolleFuer([FACTORY_LABEL]));");
      expect(q, f).toContain("labels[]=${FACTORY_LABEL}");
      expect(q, f).not.toContain("PRODUKT_BOARD");
    }
  });
});

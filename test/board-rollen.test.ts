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
};
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
  test("nur exakte Gleichheit: area:harness-x und area:harnes zählen nicht", () => {
    expect(L.boardRolleFuer(["area:harness-x"])).toBe("produkt");
    expect(L.boardRolleFuer([{ name: "xarea:harness" }])).toBe("produkt");
  });
  test("ohne Label-Liste wirft sie, statt still das Produkt-Board zu wählen", () => {
    for (const bad of [null, undefined, "area:harness", {}]) expect(() => L.boardRolleFuer(bad), JSON.stringify(bad) ?? "undefined").toThrow(/Label-Liste[\s\S]*Fix:/);
    // kein Zufallstreffer: eine echte Liste wirft nicht
    expect(() => L.boardRolleFuer([])).not.toThrow();
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
    test(`${f}: jedes Vorkommen ist ein Aufruf mit PRODUKT_BOARD oder ein Objektschlüssel`, () => {
      const q = code(f);
      for (const m of q.matchAll(FUNKTIONEN)) {
        const davor = q.slice(0, m.index).trimEnd();
        const danach = q.slice((m.index ?? 0) + m[0].length);
        if (davor.endsWith(".")) continue; // Zugriff auf ein Objekt (io.loadItems)
        if (/^\s*[:,]/.test(danach) && !davor.endsWith("=>")) continue; // Objektschlüssel
        expect(danach, `${f}: ${m[0]}`).toMatch(/^\(PRODUKT_BOARD\b/);
      }
    });
  }
  test("die Aufrufer binden das Produkt-Board über die Rolle, nicht über ein Literal", () => {
    for (const f of AUFRUFER) expect(readFileSync(new URL(`../scripts/${f}.mjs`, import.meta.url), "utf8"), f).toContain('const PRODUKT_BOARD = boardFuerRolle("produkt");');
  });
});

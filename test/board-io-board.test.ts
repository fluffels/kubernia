/* Die Board-I/O benutzt das übergebene Board (#1728): ein Factory-Aufruf darf nie das Produkt-Board treffen.
 * gh wird gemockt; geprüft werden die Argumente, die an `gh` gehen. */
import { beforeEach, describe, expect, test, vi } from "vitest";

const aufrufe: string[][] = [];
vi.mock("../scripts/gh-cli.mjs", async (orig) => {
  const echt = await orig<Record<string, unknown>>();
  return {
    ...echt,
    ghText: (args: string[]) => {
      aufrufe.push(args);
      const q = args.join(" ");
      if (q.includes("addProjectV2ItemById")) return JSON.stringify({ data: { addProjectV2ItemById: { item: { id: "ITEM_x" } } } });
      return "[]";
    },
  };
});

// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as rawLib from "../scripts/board-lib.mjs";

type Board = { projectId: string; besitzer: string; nummer: number; statusFeldId: number | string; statusFeldNodeId: string; todoOptionId: string };
const L = rawLib as unknown as {
  boardFuerRolle: (r: string) => Board;
  loadItemPages: (b: Board) => unknown;
  setPosition: (b: Board, i: string, a: string | null) => void;
  addToBoardTodo: (b: Board, n: string, o?: { pauseMs?: number; schlafe?: (ms: number) => void }) => string;
};
const produkt = L.boardFuerRolle("produkt");
const factory = L.boardFuerRolle("factory");
const flach = () => aufrufe.map((a) => a.join(" ")).join("\n");

beforeEach(() => {
  aufrufe.length = 0;
});

describe("Board-I/O nutzt das übergebene Board", () => {
  test("loadItemPages: Pfad und fields kommen vom Factory-Board, nichts vom Produkt-Board", () => {
    L.loadItemPages(factory);
    const t = flach();
    expect(t).toContain(`/projectsV2/${factory.nummer}/items`);
    expect(t).toContain(`fields=${factory.statusFeldId}`);
    expect(t).not.toContain(`/projectsV2/${produkt.nummer}/items`);
    expect(t).not.toContain(`fields=${produkt.statusFeldId}`);
  });
  test("setPosition: projectId des Factory-Boards", () => {
    L.setPosition(factory, "ITEM_a", "ITEM_b");
    const t = flach();
    expect(t).toContain(`p=${factory.projectId}`);
    expect(t).not.toContain(produkt.projectId);
  });
  test("addToBoardTodo: projectId, Status-Feld und Todo-Option vom Factory-Board, richtig zugeordnet", () => {
    expect(L.addToBoardTodo(factory, "I_node")).toBe("ITEM_x");
    const t = flach();
    expect(t).toContain(`p=${factory.projectId}`);
    expect(t).toContain(`f=${factory.statusFeldNodeId}`);
    expect(t).toContain(`o=${factory.todoOptionId}`);
    for (const fremd of [produkt.projectId, produkt.statusFeldNodeId]) expect(t).not.toContain(fremd);
  });
  test("addToBoardTodo: mit pauseMs schläft es zwischen Aufnehmen und Status, ohne (Standard 0) nicht", () => {
    L.addToBoardTodo(factory, "I_node", { pauseMs: 1000, schlafe: (ms) => void aufrufe.push(["schlafe", String(ms)]) });
    const namen = aufrufe.map((a) => (a[0] === "schlafe" ? `schlafe(${a[1]})` : a.join(" ").includes("addProjectV2ItemById") ? "add" : "status"));
    expect(namen).toEqual(["add", "schlafe(1000)", "status"]);
    aufrufe.length = 0;
    L.addToBoardTodo(factory, "I_node", { schlafe: (ms) => void aufrufe.push(["schlafe", String(ms)]) });
    expect(aufrufe.some((a) => a[0] === "schlafe")).toBe(false);
  });
});

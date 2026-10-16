/* Die Default-Verdrahtung der Takt-Skripte zeigt auf das Produkt-Board (#1693 L51): `ECHTE_IO` in board-takt, der Default-Parameter
 * `setze` in `fuehreHarnessAus`, `imBoardAnlegen`/`setze` in langfuse-takt und `aufnehmenIns` in board-place. Keiner darf das
 * Factory-Board treffen. gh wird gemockt; geprüft werden die Argumente, die an `gh` gehen, und das Board, dem die Antwort zugeordnet wird. */
import { beforeEach, describe, expect, test, vi } from "vitest";

const aufrufe: string[][] = [];
let issueAntwort: unknown = null;
vi.mock("../scripts/gh-cli.mjs", async (orig) => {
  const echt = await orig<Record<string, unknown>>();
  return {
    ...echt,
    ghText: (args: string[]) => {
      aufrufe.push(args);
      const q = args.join(" ");
      if (q.includes("addProjectV2ItemById")) return JSON.stringify({ data: { addProjectV2ItemById: { item: { id: "PVTI_x" } } } });
      if (q.includes("projectItems")) return JSON.stringify(issueAntwort);
      return "[]";
    },
  };
});

// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as rawLib from "../scripts/board-lib.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as rawTakt from "../scripts/board-takt.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as rawLangfuse from "../scripts/langfuse-takt.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as rawPlace from "../scripts/board-place.mjs";

type Board = { projectId: string; nummer: number; statusFeldId: number | string; statusFeldNodeId: string; todoOptionId: string };
const L = rawLib as unknown as { boardFuerRolle: (r: string) => Board };
const produkt = L.boardFuerRolle("produkt");
const factory = L.boardFuerRolle("factory");
const T = rawTakt as unknown as {
  ECHTE_IO: {
    itemsUeberIssues: (n: number[], o: object) => Array<{ id: string } | null>;
    addToBoardTodo: (nodeId: string, o: object) => string;
    loadItems: (o: object) => unknown[];
  };
  fuehreHarnessAus: (h: object, items: object[], token: string, io: { log: () => void }) => boolean;
};
const LF = rawLangfuse as unknown as {
  fuehreStatusAus: (e: object, o: object) => { ok: boolean; itemId: string | null };
};
const P = rawPlace as unknown as {
  nimmFehlendeAuf: (items: object[], args: object, io: object) => Array<{ id: string; number: number }>;
};
const flach = () => aufrufe.map((a) => a.join(" ")).join("\n");

/** GraphQL-Antwort: Issue #7 steht in beiden Boards, mit je eigener Item-ID. */
const issueInBeidenBoards = {
  data: {
    repository: {
      i0: {
        number: 7,
        title: "T",
        state: "OPEN",
        assignees: { nodes: [] },
        projectItems: { nodes: [{ id: "PVTI_fremd", project: { id: factory.projectId } }, { id: "PVTI_produkt", project: { id: produkt.projectId } }] },
      },
    },
  },
};

/** Beweist: ein Schreibzugriff ging an das Produkt-Board und nie an das Factory-Board. */
function nurProdukt(): void {
  const t = flach();
  expect(t).toContain(`p=${produkt.projectId}`);
  expect(t).not.toContain(factory.projectId);
}

beforeEach(() => {
  aufrufe.length = 0;
  issueAntwort = issueInBeidenBoards;
});

describe("ECHTE_IO in board-takt zeigt auf das Produkt-Board", () => {
  test("itemsUeberIssues ordnet das Produkt-Item zu, nie das des Factory-Boards", () => {
    const [item] = T.ECHTE_IO.itemsUeberIssues([7], {});
    expect(item?.id).toBe("PVTI_produkt");
    expect(item?.id).not.toBe("PVTI_fremd");
  });
  test("itemsUeberIssues: steht das Issue nur im Factory-Board, liefert es null (Negativfall)", () => {
    issueAntwort = { data: { repository: { i0: { ...issueInBeidenBoards.data.repository.i0, projectItems: { nodes: [{ id: "PVTI_fremd", project: { id: factory.projectId } }] } } } } };
    expect(T.ECHTE_IO.itemsUeberIssues([7], {})).toEqual([null]);
  });
  test("addToBoardTodo sendet projectId, Status-Feld und Todo-Option des Produkt-Boards", () => {
    expect(T.ECHTE_IO.addToBoardTodo("I_node", {})).toBe("PVTI_x");
    nurProdukt();
    const t = flach();
    expect(t).toContain(`f=${produkt.statusFeldNodeId}`);
    expect(t).toContain(`o=${produkt.todoOptionId}`);
    expect(t).not.toContain(factory.statusFeldNodeId);
  });
  test("loadItems liest Pfad und Status-Feld des Produkt-Boards", () => {
    T.ECHTE_IO.loadItems({});
    const t = flach();
    expect(t).toContain(`/projectsV2/${produkt.nummer}/items`);
    expect(t).toContain(`fields=${produkt.statusFeldId}`);
    expect(t).not.toContain(`/projectsV2/${factory.nummer}/items`);
  });
});

describe("Default-Wrapper der Takt-Skripte schreiben ins Produkt-Board", () => {
  test("fuehreHarnessAus: Default `setze` setzt die Position im Produkt-Board", () => {
    expect(T.fuehreHarnessAus({ nr: 5, afterId: "PVTI_a" }, [{ number: 5, id: "PVTI_5" }], "tok", { log: () => {} })).toBe(true);
    nurProdukt();
    expect(flach()).toContain("i=PVTI_5");
  });
  test("langfuse-takt fuehreStatusAus: Default `imBoardAnlegen` und `setze` treffen das Produkt-Board", () => {
    const r = LF.fuehreStatusAus(
      { aktion: "nach-oben", nr: 9 },
      { repo: "o/r", vorgaenger: null, jetzt: new Date("2026-10-16T00:00:00Z"), token: "tok", items: [], io: { gh: () => ({ node_id: "I_n" }) } },
    );
    expect(r).toMatchObject({ ok: true, itemId: "PVTI_x" });
    nurProdukt();
    const t = flach();
    expect(t).toContain("updateProjectV2ItemPosition");
    expect(t).toContain(`o=${produkt.todoOptionId}`);
  });
  test("board-place nimmFehlendeAuf: Default `aufnehmenIns` nimmt ins Produkt-Board auf", () => {
    const issue = { number: 5, state: "open", node_id: "I_5", title: "T" };
    const neu = P.nimmFehlendeAuf([], { numbers: [5], anchor: null, dry: false }, { ghJson: () => issue, log: () => {}, warn: () => {} });
    expect(neu.map((i) => i.id)).toEqual(["PVTI_x"]);
    nurProdukt();
  });
});

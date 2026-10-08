import { describe, expect, test } from "vitest";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as raw from "../scripts/board-lib.mjs";

type Plan = { aufnehmen: { number: number; nodeId: string; title: string }[]; abgelehnt: { number: number; grund: string }[] };
const aufnahmePlan = (raw as unknown as { aufnahmePlan: (f: number[], i: Record<number, unknown>, a?: number | null) => Plan }).aufnahmePlan;

const issue = (number: number, extra: Record<string, unknown> = {}) => ({ number, state: "open", node_id: `I_${number}`, title: `T${number}`, ...extra });

describe("aufnahmePlan (#1428 Z37)", () => {
  test("ein offenes Issue wird aufgenommen", () => {
    expect(aufnahmePlan([5], { 5: issue(5) })).toEqual({ aufnehmen: [{ number: 5, nodeId: "I_5", title: "T5" }], abgelehnt: [] });
  });
  test("ein geschlossenes Issue wird abgelehnt, nie aufgenommen", () => {
    const p = aufnahmePlan([5], { 5: issue(5, { state: "closed" }) });
    expect(p.aufnehmen).toEqual([]);
    expect(p.abgelehnt[0].grund).toMatch(/geschlossen/);
  });
  test("ein Pull Request wird abgelehnt", () => {
    expect(aufnahmePlan([5], { 5: issue(5, { pull_request: {} }) }).abgelehnt[0].grund).toMatch(/Pull Request/);
  });
  test("unbekannte oder nicht ladbare Nummer und abweichende Nummer in der Antwort werden abgelehnt", () => {
    expect(aufnahmePlan([5], { 5: null }).abgelehnt[0].grund).toMatch(/nicht ladbar/);
    expect(aufnahmePlan([5], {}).abgelehnt[0].grund).toMatch(/nicht ladbar/);
    expect(aufnahmePlan([5], { 5: issue(6) }).abgelehnt[0].grund).toMatch(/nicht ladbar/);
  });
  test("ohne node_id: abgelehnt", () => {
    expect(aufnahmePlan([5], { 5: issue(5, { node_id: "" }) }).abgelehnt[0].grund).toMatch(/node_id/);
  });
  test("der Anker wird nie automatisch aufgenommen, auch wenn er offen und ladbar ist", () => {
    const p = aufnahmePlan([7, 8], { 7: issue(7), 8: issue(8) }, 7);
    expect(p.aufnehmen.map((a) => a.number)).toEqual([8]);
    expect(p.abgelehnt[0]).toMatchObject({ number: 7 });
  });
  test("gemischt: Reihenfolge der Eingabe bleibt", () => {
    const p = aufnahmePlan([9, 3], { 9: issue(9), 3: issue(3) });
    expect(p.aufnehmen.map((a) => a.number)).toEqual([9, 3]);
  });
});

// ── Verdrahtung nimmFehlendeAuf mit Fakes (#1460 Z7b): kein gh, kein Netz ──
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as placeRaw from "../scripts/board-place.mjs";

type Item = { id: string; number: number; title: string; status?: string };
type Io = { ghJson: (a: string[]) => unknown; addToBoardTodo: (nodeId: string) => string; log: (m: string) => void; warn: (m: string) => void };
const nimmFehlendeAuf = (placeRaw as unknown as { nimmFehlendeAuf: (items: Item[], args: { anchor: number | null; numbers: number[]; dry: boolean }, io: Io) => Item[] }).nimmFehlendeAuf;

describe("nimmFehlendeAuf (#1428 Z37, Verdrahtung)", () => {
  const board: Item[] = [{ id: "PVTI_1", number: 1, title: "eins", status: "Todo" }];
  const fakes = (issues: Record<number, unknown>) => {
    const rufe = { api: [] as string[][], add: [] as string[], log: [] as string[], warn: [] as string[] };
    const io: Io = {
      ghJson: (a) => {
        rufe.api.push(a);
        const nr = Number(a[1].split("/").pop());
        const i = issues[nr];
        if (i instanceof Error) throw i;
        return i;
      },
      addToBoardTodo: (nodeId) => {
        rufe.add.push(nodeId);
        return `PVTI_neu_${nodeId}`;
      },
      log: (m) => rufe.log.push(m),
      warn: (m) => rufe.warn.push(m),
    };
    return { rufe, io };
  };

  test("nichts fehlt: keine Aufrufe, dieselbe Liste", () => {
    const { rufe, io } = fakes({});
    const r = nimmFehlendeAuf(board, { anchor: null, numbers: [1], dry: false }, io);
    expect(r).toBe(board);
    expect(rufe.api).toEqual([]);
    expect(rufe.add).toEqual([]);
  });

  test("ein offenes Issue fehlt: wird mit seiner node_id aufgenommen und als Todo-Item ergänzt", () => {
    const { rufe, io } = fakes({ 5: issue(5) });
    const r = nimmFehlendeAuf(board, { anchor: null, numbers: [1, 5], dry: false }, io);
    expect(rufe.add).toEqual(["I_5"]);
    expect(r.map((i) => i.number)).toEqual([1, 5]);
    expect(r[1]).toMatchObject({ id: "PVTI_neu_I_5", title: "T5" });
    expect(rufe.log[0]).toMatch(/#5 fehlte im Board: aufgenommen/);
  });

  test("--dry-run: kein addToBoardTodo, Meldung „würde aufnehmen“, das Item steht trotzdem in der Liste", () => {
    const { rufe, io } = fakes({ 5: issue(5) });
    const r = nimmFehlendeAuf(board, { anchor: null, numbers: [5], dry: true }, io);
    expect(rufe.add).toEqual([]);
    expect(rufe.log[0]).toMatch(/würde aufnehmen/);
    expect(r.map((i) => i.number)).toEqual([1, 5]);
  });

  test("ghJson wirft: Meldung „nicht aufgenommen“, nichts angefasst", () => {
    const { rufe, io } = fakes({ 5: new Error("HTTP 404") });
    const r = nimmFehlendeAuf(board, { anchor: null, numbers: [5], dry: false }, io);
    expect(rufe.add).toEqual([]);
    expect(rufe.warn[0]).toMatch(/#5 fehlt im Board, nicht aufgenommen/);
    expect(r).toEqual(board);
  });

  test("der Anker wird nie aufgenommen, die anderen schon; geschlossene werden gemeldet", () => {
    const { rufe, io } = fakes({ 7: issue(7), 8: issue(8), 9: issue(9, { state: "closed" }) });
    const r = nimmFehlendeAuf(board, { anchor: 7, numbers: [8, 9], dry: false }, io);
    expect(rufe.add).toEqual(["I_8"]);
    expect(rufe.warn.map((w) => w.match(/#(\d+)/)?.[1]).sort()).toEqual(["7", "9"]);
    expect(r.map((i) => i.number)).toEqual([1, 8]);
  });
});

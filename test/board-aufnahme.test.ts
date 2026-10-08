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

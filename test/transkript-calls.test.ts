/* Output-Schätzung (#1568): Subagent-Transkripte zeichnen output_tokens beim Stand message_start auf (3 bis 8 je Nachricht). */
import { describe, expect, test } from "vitest";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as raw from "../scripts/transkript-calls.mjs";

type Row = Record<string, unknown>;
type Call = { id: string; output: number; cost: number | null; outputSichtbar: number; outputGeschaetzt: number; costGeschaetzt: number | null; messageId: string };
const T = raw as unknown as {
  callsFromTranscript: (z: Row[]) => { calls: Call[] };
  eindeutigeCalls: (c: Call[]) => Call[];
};

let seq = 0;
/** Eine Assistant-Zeile je Content-Block; `ctx` ist der gesamte Eingabe-Kontext (input + Cache). */
const msg = (id: string, ctx: number, blocks: Row[], output = 5): Row[] =>
  blocks.map((b) => {
    seq += 1;
    return {
      type: "assistant",
      uuid: `u${seq}`,
      timestamp: `2026-10-10T10:00:${String(seq % 60).padStart(2, "0")}Z`,
      message: {
        id,
        model: "claude-opus-5-5",
        usage: { input_tokens: 10, cache_read_input_tokens: ctx - 10, cache_creation_input_tokens: 0, output_tokens: output },
        content: [b],
      },
    };
  });
const ergebnis = (zeichen: number): Row => ({
  type: "user",
  message: { role: "user", content: [{ type: "tool_result", tool_use_id: "t", content: "x".repeat(zeichen) }] },
});
const text = (n: number): Row => ({ type: "text", text: "y".repeat(n) });
const tool = (inhalt: string): Row => ({ type: "tool_use", id: "t", name: "Bash", input: { command: inhalt } });

describe("Output-Schätzung aus dem Kontext-Zuwachs", () => {
  test("Zuwachs abzüglich Tool-Ergebnis (Zeichen / 4) ist der Output des vorigen Calls", () => {
    const z = [
      ...msg("a", 1000, [tool("ls")]),
      ergebnis(400), // 100 Tokens Fremdzuwachs
      ...msg("b", 1000 + 100 + 300, [text(4)]), // 300 Tokens Output von a
    ];
    const { calls } = T.callsFromTranscript(z);
    expect(calls[0].output).toBe(5);
    expect(calls[0].outputGeschaetzt).toBe(300);
    expect(calls[0].costGeschaetzt).toBeGreaterThan(calls[0].cost as number);
  });

  test("letzter Call und schrumpfender Kontext fallen auf das Sichtbare zurück", () => {
    const z = [
      ...msg("a", 5000, [text(800)]),
      ...msg("b", 1000, [text(400)]), // Kontext schrumpft (Verdichtung)
    ];
    const { calls } = T.callsFromTranscript(z);
    expect(calls[0].outputSichtbar).toBe(200);
    expect(calls[0].outputGeschaetzt).toBe(200);
    expect(calls[1].outputGeschaetzt).toBe(100);
  });

  test("nie unter dem aufgezeichneten Output und nie unter dem Sichtbaren", () => {
    const z = [
      ...msg("a", 1000, [text(4000)], 700),
      ergebnis(0),
      ...msg("b", 1020, [text(4)]), // Zuwachs 20, Sichtbares 1000, aufgezeichnet 700
    ];
    expect(T.callsFromTranscript(z).calls[0].outputGeschaetzt).toBe(1000);
  });

  test("Anhang unbekannter Größe oder eigener User-Text machen den Zuwachs unbrauchbar (Rückfall aufs Sichtbare)", () => {
    const anhang: Row = { type: "attachment", attachment: { type: "hook_additional_context", content: "z".repeat(100) } };
    const eigenerText: Row = { type: "user", message: { role: "user", content: "bitte weiter" } };
    for (const dazwischen of [anhang, eigenerText, { type: "system", content: "x" }]) {
      const z = [...msg("a", 1000, [text(40)]), ergebnis(0), dazwischen, ...msg("b", 3000, [text(4)])];
      expect(T.callsFromTranscript(z).calls[0].outputGeschaetzt).toBe(10);
    }
  });

  test("kleine Anhänge (Token-Erinnerung) zählen als Fremdzuwachs", () => {
    const klein: Row = { type: "attachment", attachment: { type: "total_tokens_reminder", text: "y".repeat(80) } };
    const z = [...msg("a", 1000, [text(40)]), ergebnis(400), klein, ...msg("b", 1000 + Math.round((400 + JSON.stringify(klein.attachment).length) / 4) + 50, [text(4)])];
    expect(T.callsFromTranscript(z).calls[0].outputGeschaetzt).toBe(50);
  });

  test("mehrzeilige Nachricht zählt einmal, Sichtbares summiert Text und Tool-Eingabe", () => {
    const z = [...msg("a", 1000, [text(40), tool("x".repeat(20))]), ...msg("b", 1000, [text(4)])];
    const { calls } = T.callsFromTranscript(z);
    expect(calls).toHaveLength(2);
    expect(calls[0].outputSichtbar).toBe(Math.ceil((40 + JSON.stringify({ command: "x".repeat(20) }).length) / 4));
  });

  test("eindeutigeCalls nimmt je Nachricht das Maximum der Schätzung", () => {
    const a = { ...T.callsFromTranscript(msg("a", 1000, [text(40)])).calls[0], outputGeschaetzt: 50 };
    const b = { ...a, outputGeschaetzt: 90 };
    const r = T.eindeutigeCalls([a, b]);
    expect(r).toHaveLength(1);
    expect(r[0].outputGeschaetzt).toBe(90);
    expect(r[0].costGeschaetzt).toBeGreaterThan(0);
  });
});

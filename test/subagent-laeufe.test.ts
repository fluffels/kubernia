/* Läufe aus Transkripten (#1579): Ticket-Zuordnung, Modelle ohne Platzhalter. Kern pur, synthetische Zeilen ohne IO. */
import { describe, expect, test } from "vitest";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as raw from "../scripts/subagent-laeufe.mjs";

type Row = Record<string, unknown>;
const A = raw as unknown as {
  ticketAusLauf: (e: { patch: { ticket: number | null } | null; prompt: string }) => number | null;
  laufAus: (e: { meta: Record<string, unknown>; zeilen: Row[]; datei?: string }) => { ticket: number | null; modelle: string[] } | null;
};

const zeile = (min: number, model: string | undefined, text?: string): Row =>
  text !== undefined
    ? { type: "user", timestamp: new Date(Date.UTC(2026, 9, 7, 10, min)).toISOString(), message: { role: "user", content: text } }
    : { type: "assistant", timestamp: new Date(Date.UTC(2026, 9, 7, 10, min)).toISOString(), uuid: `u${min}`, message: { id: `m${min}`, model, usage: { input_tokens: 10, output_tokens: 1 }, content: [{ type: "text", text: "x" }] } };

describe("ticketAusLauf", () => {
  test("Patch-Pfad vor einer fremden Nummer im Brillen-Text (Negativfall der Zeile)", () => {
    const prompt = "Brille: schon erledigt durch #1349 … Patch: C:/tmp/kq-1580-r1.patch · erwarteter HEAD: abc";
    expect(A.ticketAusLauf({ patch: { ticket: 1580 }, prompt })).toBe(1580);
  });
  test("Reihenfolge: der Patch-Pfad schlägt einen Worktree-Pfad im Prompt", () => {
    const prompt = "Arbeitsverzeichnis: C:/x/.claude/worktrees/kq-1111 · Patch: /tmp/kq-1580-r1.patch";
    expect(A.ticketAusLauf({ patch: { ticket: 1580 }, prompt })).toBe(1580);
  });
  test("Diät-Überschrift (#1034) plus Lens-Worktree: der Worktree gibt das Ticket", () => {
    const prompt = "Kontext-Diät (#1034) · Arbeitsverzeichnis: C:/x/.claude/worktrees/kq-1582-lens-r1 · Brille #907";
    expect(A.ticketAusLauf({ patch: null, prompt })).toBe(1582);
  });
  test("ohne kq-Pfad der Rückfall auf das erste #<nr>, ohne alles null", () => {
    expect(A.ticketAusLauf({ patch: null, prompt: "Plane #1382 Langfuse-Befunde" })).toBe(1382);
    expect(A.ticketAusLauf({ patch: null, prompt: "kein Bezug" })).toBeNull();
  });
});

describe("laufAus: Ticket und Modelle", () => {
  test("ein Lens-Prompt mit fremder Nummer vor dem Patch bleibt dem Patch-Ticket zugeordnet", () => {
    const prompt = "Brille (#907) schon erledigt durch #1349\nPatch: /tmp/kq-1580-r2.patch";
    const r = A.laufAus({ meta: { agentType: "kubernia-lens" }, zeilen: [zeile(0, undefined, prompt), zeile(1, "claude-opus-5-5")] });
    expect(r?.ticket).toBe(1580);
  });
  test("<synthetic> und leere Modelle fehlen in modelle, echte bleiben sortiert", () => {
    const zeilen = [zeile(0, undefined, "x"), zeile(1, "claude-opus-5-5"), zeile(2, "<synthetic>"), zeile(3, "claude-haiku-4-5")];
    expect(A.laufAus({ meta: {}, zeilen })?.modelle).toEqual(["claude-haiku-4-5", "claude-opus-5-5"]);
  });
});

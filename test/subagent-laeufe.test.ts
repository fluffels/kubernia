/* Läufe aus Transkripten (#1579): Ticket-Zuordnung, Modelle ohne Platzhalter. Kern pur, synthetische Zeilen ohne IO. */
import { describe, expect, test } from "vitest";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as laeufeRoh from "../scripts/subagent-laeufe.mjs";
import { FREMD, FREMD_NAMEN } from "./support/fremd-config";

type Row = Record<string, unknown>;
// Die Namen kommen aus der Fremd-Config; die Wrapper reichen sie durch, damit die Tests ihre Eingaben wie bisher schreiben.
const NAMEN = FREMD_NAMEN;
const WT = FREMD.praefixe.worktree;
const LENS = FREMD.agenten.lens;
const raw = laeufeRoh as object;
const roh = laeufeRoh as unknown as { ticketAusLauf: (e: object, namen: unknown) => number | null; laufAus: (e: object, namen: unknown) => unknown };
const A = {
  ticketAusLauf: (e: { patch: { ticket: number | null } | null; prompt: string }) => roh.ticketAusLauf(e, NAMEN),
  laufAus: (e: { meta: Record<string, unknown>; zeilen: Row[]; datei?: string }) => roh.laufAus(e, NAMEN) as { ticket: number | null; modelle: string[] } | null,
};

const zeile = (min: number, model: string | undefined, text?: string): Row =>
  text !== undefined
    ? { type: "user", timestamp: new Date(Date.UTC(2026, 9, 7, 10, min)).toISOString(), message: { role: "user", content: text } }
    : { type: "assistant", timestamp: new Date(Date.UTC(2026, 9, 7, 10, min)).toISOString(), uuid: `u${min}`, message: { id: `m${min}`, model, usage: { input_tokens: 10, output_tokens: 1 }, content: [{ type: "text", text: "x" }] } };

describe("ticketAusLauf", () => {
  test("Patch-Pfad vor einer fremden Nummer im Brillen-Text (Negativfall der Zeile)", () => {
    const prompt = `Brille: schon erledigt durch #1349 … Patch: C:/tmp/${WT}1580-r1.patch · erwarteter HEAD: abc`;
    expect(A.ticketAusLauf({ patch: { ticket: 1580 }, prompt })).toBe(1580);
  });
  test("Reihenfolge: der Patch-Pfad schlägt einen Worktree-Pfad im Prompt", () => {
    const prompt = `Arbeitsverzeichnis: C:/x/.claude/worktrees/${WT}1111 · Patch: /tmp/${WT}1580-r1.patch`;
    expect(A.ticketAusLauf({ patch: { ticket: 1580 }, prompt })).toBe(1580);
  });
  test("Diät-Überschrift (#1034) plus Lens-Worktree: der Worktree gibt das Ticket", () => {
    const prompt = `Kontext-Diät (#1034) · Arbeitsverzeichnis: C:/x/.claude/worktrees/${WT}1582-lens-r1 · Brille #907`;
    expect(A.ticketAusLauf({ patch: null, prompt })).toBe(1582);
  });
  test("Kopfzeile `Ticket #<nr>:` in Zeile 1 schlägt Worktree-Pfad und Patch (#1593)", () => {
    const prompt = `Ticket #1729: Titel\nArbeitsverzeichnis: C:/x/.claude/worktrees/${WT}1628 · Patch: /tmp/${WT}1628-r1.patch`;
    expect(A.ticketAusLauf({ patch: { ticket: 1628 }, prompt })).toBe(1729);
    expect(A.ticketAusLauf({ patch: null, prompt })).toBe(1729);
  });
  test("Kopfzeile nur in Zeile 1 und nur vollständig: Zeile 2, Satzmitte und `#12a` zählen nicht (#1593)", () => {
    const wt = `C:/x/.claude/worktrees/${WT}1628`;
    expect(A.ticketAusLauf({ patch: null, prompt: `Vorspann\nTicket #1729: T ${wt}` })).toBe(1628);
    expect(A.ticketAusLauf({ patch: null, prompt: `Siehe Ticket #1729: T ${wt}` })).toBe(1628);
    expect(A.ticketAusLauf({ patch: null, prompt: `Ticket #12a: T ${wt}` })).toBe(1628);
  });
  test("ohne Worktree-Pfad der Rückfall auf das erste #<nr>, ohne alles null", () => {
    expect(A.ticketAusLauf({ patch: null, prompt: "Plane #1382 Langfuse-Befunde" })).toBe(1382);
    expect(A.ticketAusLauf({ patch: null, prompt: "kein Bezug" })).toBeNull();
  });
});

describe("laufAus: Ticket und Modelle", () => {
  test("ein Lens-Prompt mit fremder Nummer vor dem Patch bleibt dem Patch-Ticket zugeordnet", () => {
    const prompt = `Brille (#907) schon erledigt durch #1349\nPatch: /tmp/${WT}1580-r2.patch`;
    const r = A.laufAus({ meta: { agentType: LENS }, zeilen: [zeile(0, undefined, prompt), zeile(1, "claude-opus-5-5")] });
    expect(r?.ticket).toBe(1580);
  });
  test("<synthetic> und leere Modelle fehlen in modelle, echte bleiben sortiert", () => {
    const zeilen = [zeile(0, undefined, "x"), zeile(1, "claude-opus-5-5"), zeile(2, "<synthetic>"), zeile(3, "claude-haiku-4-5")];
    expect(A.laufAus({ meta: {}, zeilen })?.modelle).toEqual(["claude-haiku-4-5", "claude-opus-5-5"]);
  });
});

describe("laufAus: sammel nur aus der Titelzeile (#1593)", () => {
  const sammel = (prompt: string) => (A.laufAus({ meta: {}, zeilen: [zeile(0, undefined, prompt), zeile(1, "claude-sonnet-5-5")] }) as unknown as { sammel: boolean }).sammel;
  test("Titelzeile true, Body und Plan false, leerer Prompt false", () => {
    expect(sammel("Ticket #1628: Harness-Härtung (gesammelt). Body:\nx")).toBe(true);
    expect(sammel("Ticket #1490: Etwas. Body:\nTeil des Sammeltickets Harness-Härtung (gesammelt)")).toBe(false);
    expect(sammel("")).toBe(false);
  });
});

describe("schnittZeile (#1646: CRLF)", () => {
  const S = raw as unknown as { schnittZeile: (p: string, k: string) => string | null };
  test("CRLF-Zeilenenden liefern den Wert, Prosa und Großschrift nicht", () => {
    expect(S.schnittZeile("a\r\nSchnitt: verify\r\nb", "Schnitt")).toBe("verify");
    expect(S.schnittZeile("a\r\nSchnitt: pr \r\n", "Schnitt")).toBe("pr");
    expect(S.schnittZeile("a\r\nSCHNITT: verify\r\n", "Schnitt")).toBeNull();
  });
});

describe("Vorlauf und ersterStartJeTicket (#1646)", () => {
  const V = raw as unknown as { VORLAUF_MS: number; mitVorlauf: (von: string) => string; ersterStartJeTicket: (l: { ticket: number | null; start: number }[]) => Map<number, number> };
  test("48 Stunden", () => {
    expect(V.VORLAUF_MS).toBe(48 * 3_600_000);
  });
  test("mitVorlauf zieht genau den Vorlauf ab (ISO)", () => {
    expect(V.mitVorlauf("2026-10-10T12:00:00.000Z")).toBe("2026-10-08T12:00:00.000Z");
  });
  test("frühester Start je Ticket, Läufe ohne Ticket fallen weg, leer ergibt leere Map", () => {
    const m = V.ersterStartJeTicket([{ ticket: 5, start: 30 }, { ticket: 5, start: 10 }, { ticket: null, start: 1 }, { ticket: 6, start: 7 }]);
    expect([...m.entries()].sort()).toEqual([[5, 10], [6, 7]]);
    expect(V.ersterStartJeTicket([]).size).toBe(0);
  });
});

describe("ticketsMitStartImFenster (#1646)", () => {
  const T = raw as unknown as { ticketsMitStartImFenster: (l: { ticket: number | null; start: number }[], f: { von: string; bis: string }) => number[] };
  const von = "2026-10-07T10:00:00Z";
  const bis = "2026-10-07T12:00:00Z";
  const [v, b] = [Date.parse(von), Date.parse(bis)];
  test("zählt den ersten Start: Start auf von und auf bis zählen, ein Tick davor oder danach nicht", () => {
    expect(T.ticketsMitStartImFenster([{ ticket: 1, start: v - 1 }, { ticket: 2, start: v }, { ticket: 3, start: b }, { ticket: 4, start: b + 1 }], { von, bis })).toEqual([2, 3]);
  });
  test("ein Nachfolger im Fenster, dessen Vorgänger davor startete, gehört nicht dazu", () => {
    expect(T.ticketsMitStartImFenster([{ ticket: 5, start: v - 1000 }, { ticket: 5, start: v + 1000 }], { von, bis })).toEqual([]);
  });
  test("Läufe ohne Ticket zählen nicht, jedes Ticket einmal, sortiert; leere Eingabe ergibt leere Liste", () => {
    expect(T.ticketsMitStartImFenster([{ ticket: null, start: v + 1 }, { ticket: 9, start: v + 2 }, { ticket: 9, start: v + 3 }, { ticket: 7, start: v + 4 }], { von, bis })).toEqual([7, 9]);
    expect(T.ticketsMitStartImFenster([], { von, bis })).toEqual([]);
  });
});

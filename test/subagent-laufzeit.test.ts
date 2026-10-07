/* Subagent-Laufzeit (#1382): Kern pur, synthetische Transkriptzeilen ohne IO. */
import { describe, expect, test } from "vitest";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as raw from "../scripts/subagent-laufzeit.mjs";

type Row = Record<string, unknown>;
type Lauf = { meta: { agentType?: string }; zeilen: Row[] };
type L = { ticket: number | null; sammel: boolean; dauerMin: number; toolMin: number; modellMin: number; requests: number; maxKontext: number; parallel: number; offen: boolean; start: string };
type Stat = { n: number; dauerMin: number | null; maxDauerMin: number | null };
type Erg = { laeufe: L[]; aggregat: { gesamt: Stat; ohneSammel: Stat; sammel: Stat; jeTag: (Stat & { tag: string; sammelN: number })[]; alt?: Stat; neu?: Stat; offen: number } };
const S = raw as unknown as {
  median: (w: number[]) => number | null;
  vereinigungMs: (i: [number, number][]) => number;
  laufzeiten: (e: { laeufe: Lauf[]; agent?: string; von?: string; bis?: string; schnitt?: string }) => Erg;
  renderMarkdown: (r: Erg) => string;
};

const t = (min: number, tag = 7) => new Date(Date.UTC(2026, 9, tag, 10, 0, 0) + min * 60_000).toISOString();
let seq = 0;
const user = (min: number, text: string, tag = 7): Row => ({ type: "user", timestamp: t(min, tag), message: { role: "user", content: text } });
const call = (min: number, tag = 7, tool?: string, ctx = 1000, cache = 0): Row => {
  seq += 1;
  return {
    type: "assistant",
    timestamp: t(min, tag),
    uuid: `u${seq}`,
    message: {
      id: `m${seq}`,
      model: "claude-opus-5-5",
      usage: { input_tokens: ctx, output_tokens: 10, cache_creation_input_tokens: cache, cache_read_input_tokens: cache },
      content: tool ? [{ type: "tool_use", id: tool, name: "Read", input: {} }] : [{ type: "text", text: "x" }],
    },
  };
};
const result = (min: number, id: string, tag = 7): Row => ({ type: "user", timestamp: t(min, tag), message: { content: [{ type: "tool_result", tool_use_id: id, content: "ok" }] } });
/** Ein Lauf von `von` bis `bis` Minuten mit einem Tool-Aufruf [a,b]. */
const lauf = (prompt: string, von: number, bis: number, o: { tag?: number; tool?: [number, number]; agentType?: string; ctx?: number } = {}): Lauf => {
  const tag = o.tag ?? 7;
  const id = `tool${++seq}`;
  const zeilen: Row[] = [user(von, prompt, tag), call(von + 0.1, tag, undefined, o.ctx ?? 1000)];
  if (o.tool) zeilen.push(call(o.tool[0], tag, id), result(o.tool[1], id, tag));
  zeilen.push(call(bis, tag));
  return { meta: { agentType: o.agentType ?? "kubernia-planner" }, zeilen };
};

describe("median und vereinigungMs", () => {
  test("ungerade, gerade, leer, NaN ignoriert", () => {
    expect(S.median([3, 1, 2])).toBe(2);
    expect(S.median([4, 1, 2, 3])).toBe(2.5);
    expect(S.median([])).toBeNull();
    expect(S.median([Number.NaN, 5])).toBe(5);
  });
  test("überlappende Intervalle zählen einmal, getrennte addieren sich, kaputte entfallen", () => {
    expect(S.vereinigungMs([[0, 10], [5, 15]])).toBe(15);
    expect(S.vereinigungMs([[0, 10], [20, 30]])).toBe(20);
    expect(S.vereinigungMs([[0, 10], [2, 4]])).toBe(10);
    expect(S.vereinigungMs([[10, 0], [Number.NaN, 3]])).toBe(0);
    expect(S.vereinigungMs([])).toBe(0);
  });
});

describe("laufzeiten: ein Lauf", () => {
  test("Dauer, Requests, Toolzeit, Modellzeit, Kontext, Ticket und Sammelticket-Erkennung", () => {
    const r = S.laufzeiten({ laeufe: [lauf("Plane #1382 Langfuse-Befunde (gesammelt)", 0, 10, { tool: [2, 4], ctx: 5000 })] });
    const l = r.laeufe[0];
    expect(l).toMatchObject({ ticket: 1382, sammel: true, requests: 3, maxKontext: 5000, offen: false });
    expect(l.dauerMin).toBeCloseTo(10, 5);
    expect(l.toolMin).toBeCloseTo(2, 5);
    expect(l.modellMin).toBeCloseTo(8, 5);
  });
  test("maxKontext zählt Input plus Cache-Write plus Cache-Read", () => {
    const l = lauf("Plane #5", 0, 3);
    l.zeilen.push(call(2, 7, undefined, 1000, 5000));
    expect(S.laufzeiten({ laeufe: [l] }).laeufe[0].maxKontext).toBe(11000);
  });
  test("überlappende Tool-Aufrufe: Vereinigung, nicht Summe", () => {
    const a = lauf("Plane #5", 0, 10);
    a.zeilen.splice(2, 0, call(1, 7, "x1"), call(2, 7, "x2"), result(5, "x1"), result(6, "x2"));
    const l = S.laufzeiten({ laeufe: [a] }).laeufe[0];
    expect(l.toolMin).toBeCloseTo(5, 5); // 1..6 statt 4 + 4
  });
  test("ohne #Nummer: ticket null; ohne (gesammelt): kein Sammelticket", () => {
    expect(S.laufzeiten({ laeufe: [lauf("Plane irgendwas", 0, 3)] }).laeufe[0]).toMatchObject({ ticket: null, sammel: false });
  });
  test("laufender Lauf (Tool ohne Ergebnis) ist offen und zählt nicht in die Mediane", () => {
    const l = lauf("Plane #5", 0, 3);
    l.zeilen.push(call(4, 7, "offen"));
    const r = S.laufzeiten({ laeufe: [l, lauf("Plane #6", 0, 8)] });
    expect(r.aggregat.offen).toBe(1);
    expect(r.aggregat.gesamt.n).toBe(1);
    expect(r.aggregat.gesamt.dauerMin).toBeCloseTo(8, 5);
  });
});

describe("laufzeiten: Filter und Aggregat", () => {
  test("falscher oder fehlender agentType, Zeilen ohne Zeitstempel und leere Eingabe", () => {
    const ohneTyp: Lauf = { meta: {}, zeilen: lauf("x #1", 0, 1).zeilen };
    const ohneZeit: Lauf = { meta: { agentType: "kubernia-planner" }, zeilen: [{ type: "user", message: { content: "x" } }] };
    const r = S.laufzeiten({ laeufe: [ohneTyp, lauf("x #2", 0, 1, { agentType: "kubernia-lens" }), ohneZeit] });
    expect(r.laeufe).toEqual([]);
    expect(r.aggregat.gesamt).toMatchObject({ n: 0, dauerMin: null });
    expect(S.laufzeiten({ laeufe: [] }).laeufe).toEqual([]);
    expect(S.laufzeiten({ laeufe: [lauf("x #2", 0, 1, { agentType: "kubernia-lens" })], agent: "kubernia-lens" }).laeufe).toHaveLength(1);
  });
  test("von/bis schneiden nach dem Start; Median je UTC-Tag, Sammeltickets getrennt gezählt", () => {
    const laeufe = [lauf("#1", 0, 4, { tag: 5 }), lauf("#2", 0, 8, { tag: 5 }), lauf("#3 (gesammelt)", 0, 20, { tag: 6 }), lauf("#4", 0, 6, { tag: 6 })];
    const r = S.laufzeiten({ laeufe, von: t(-1, 5), bis: t(1, 6) });
    expect(r.aggregat.jeTag.map((x) => [x.tag, x.n, x.sammelN, x.dauerMin])).toEqual([["2026-10-05", 2, 0, 6], ["2026-10-06", 2, 1, 13]]);
    expect(r.aggregat.sammel.n).toBe(1);
    expect(r.aggregat.ohneSammel.n).toBe(3);
    expect(S.laufzeiten({ laeufe, von: t(-1, 6) }).laeufe).toHaveLength(2);
    expect(S.laufzeiten({ laeufe, bis: t(1, 5) }).laeufe).toHaveLength(2);
  });
  test("Schnitt: Start genau auf dem Schnitt zählt als neu", () => {
    const laeufe = [lauf("#1", 0, 4), lauf("#2", 10, 20), lauf("#3", 20, 30)];
    const r = S.laufzeiten({ laeufe, schnitt: t(10) });
    expect(r.aggregat.alt?.n).toBe(1);
    expect(r.aggregat.neu?.n).toBe(2);
    expect(S.laufzeiten({ laeufe }).aggregat.alt).toBeUndefined();
  });
  test("Sammeltickets werden vor und ab dem Schnitt getrennt gezählt; bis ist einschließlich", () => {
    const laeufe = [lauf("#0", 0, 4), lauf("#1 (gesammelt)", 0, 4), lauf("#2 (gesammelt)", 10, 20), lauf("#3", 10, 20), lauf("#4 (gesammelt)", 30, 40)];
    const r = S.laufzeiten({ laeufe, schnitt: t(10), bis: t(30) }) as Erg & { aggregat: { altSammel: Stat; neuSammel: Stat } };
    expect(r.aggregat.altSammel.n).toBe(1);
    expect(r.aggregat.neuSammel.n).toBe(2);
    expect(r.laeufe).toHaveLength(5);
  });
  test("Parallelität zählt nur überlappende Läufe desselben Typs", () => {
    const r = S.laufzeiten({ laeufe: [lauf("#1", 0, 10), lauf("#2", 5, 15), lauf("#3", 30, 40), lauf("#9", 0, 40, { agentType: "kubernia-lens" })] });
    expect(r.laeufe.map((l) => l.parallel)).toEqual([1, 1, 0]);
  });
  test("renderMarkdown nennt Aggregat und Läufe", () => {
    const md = S.renderMarkdown(S.laufzeiten({ laeufe: [lauf("Plane #77", 0, 4)], schnitt: t(1) }));
    expect(md).toMatch(/\| #77 \|/);
    expect(md).toMatch(/alle ab Schnitt/);
  });
});

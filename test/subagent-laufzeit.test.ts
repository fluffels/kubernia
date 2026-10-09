/* Subagent-Laufzeit (#1382): Kern pur, synthetische Transkriptzeilen ohne IO. */
import { describe, expect, test } from "vitest";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as raw from "../scripts/subagent-laufzeit.mjs";

type Row = Record<string, unknown>;
type Lauf = { meta: { agentType?: string }; zeilen: Row[] };
type L = { kosten: number | null; ticket: number | null; sammel: boolean; dauerMin: number; toolMin: number; modellMin: number; requests: number; sProRequest: number | null; maxKontext: number; parallel: number; offen: boolean; start: string };
type Stat = { kosten: number | null; kostenSumme: number; ohnePreis: number; n: number; dauerMin: number | null; maxDauerMin: number | null; sProRequest: number | null; parallel: number | null };
type Erg = { laeufe: L[]; aggregat: { gesamt: Stat; ohneSammel: Stat; sammel: Stat; jeTag: (Stat & { tag: string; sammelN: number })[]; alt?: Stat; neu?: Stat; altOhneSammel?: Stat; neuOhneSammel?: Stat; offen: number } };
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
  test("s je Request: Median der Modellzeit je Request, Lauf ohne Request zählt nicht (kein Infinity/NaN)", () => {
    // 2 Requests über 10 min Modellzeit = 300 s; 3 Requests, 8 min Modellzeit = 160 s; Lauf ohne Request.
    const ohneRequest: Lauf = { meta: { agentType: "kubernia-planner" }, zeilen: [user(0, "Plane #3"), user(5, "weiter")] };
    const r = S.laufzeiten({ laeufe: [lauf("Plane #1", 0, 10), lauf("Plane #2", 0, 10, { tool: [2, 4] }), ohneRequest] });
    const [a, b, c] = r.laeufe;
    expect(a.sProRequest).toBeCloseTo(300, 5);
    expect(b.sProRequest).toBeCloseTo(160, 5);
    expect(c).toMatchObject({ requests: 0, sProRequest: null });
    expect(r.aggregat.gesamt.n).toBe(3);
    expect(r.aggregat.gesamt.sProRequest).toBeCloseTo(230, 5);
    expect(S.laufzeiten({ laeufe: [ohneRequest] }).aggregat.gesamt.sProRequest).toBeNull();
  });
  test("Parallelität je Gruppe als Median; ein offener Lauf zählt für andere mit, aber nicht in der Gruppe", () => {
    const offen = lauf("Plane #9", 0, 12);
    offen.zeilen.push(call(13, 7, "offen"));
    const r = S.laufzeiten({ laeufe: [lauf("#1", 0, 10), lauf("#2", 5, 15), lauf("#3", 30, 40), offen] });
    // #1 und #2 überlappen sich und den offenen Lauf, #3 niemanden.
    expect(r.laeufe.map((l) => l.parallel)).toEqual([2, 2, 2, 0]); // Reihenfolge nach Start, stabil: #1, offen, #2, #3
    expect(r.aggregat.gesamt.n).toBe(3);
    expect(r.aggregat.gesamt.parallel).toBe(2);
  });
  test("Schnitt trennt auch die Läufe ohne Sammeltickets (alt/neu)", () => {
    const laeufe = [lauf("#1", 0, 4), lauf("#2 (gesammelt)", 0, 4), lauf("#3", 10, 20), lauf("#4", 12, 30), lauf("#5 (gesammelt)", 10, 20)];
    const a = S.laufzeiten({ laeufe, schnitt: t(10) }).aggregat;
    expect(a.altOhneSammel?.n).toBe(1);
    expect(a.neuOhneSammel?.n).toBe(2);
    expect(S.laufzeiten({ laeufe }).aggregat.neuOhneSammel).toBeUndefined();
  });
  test("renderMarkdown nennt Aggregat und Läufe", () => {
    const md = S.renderMarkdown(S.laufzeiten({ laeufe: [lauf("Plane #77", 0, 4)], schnitt: t(1) }));
    expect(md).toMatch(/\| #77 \|/);
    expect(md).toMatch(/alle ab Schnitt/);
    expect(md).toMatch(/ohne Sammel ab Schnitt/);
    expect(md).toContain("s/Req");
  });
  test("renderMarkdown zeigt die Kosten-Spalte, `-` ohne Preis", () => {
    const md = S.renderMarkdown(S.laufzeiten({ laeufe: [lauf("Plane #77", 0, 4), lauf("Plane #79", 0, 4), ohnePreisLauf("Plane #78")] }));
    expect(md).toContain("Kosten ($)");
    expect(md).toMatch(/\| #77 \|.*\| 0\.01 \|/);
    expect(md).toMatch(/\| #78 \|.*\| - \|/);
    // Aggregat: Median 0,01, Σ 0,02, ein Lauf ohne Preis (Spalten Median, Summe, ohne Preis).
    expect(md).toMatch(/\| alle gemessenen \| 3 \|.*\| 0\.01 \| 0\.02 \| 1 \|/);
  });
});

/** Opus 5.5 = 4 $ Input und 20 $ Output je Mio: ein Call mit 1000 Input und 10 Output kostet 0,0042 $. */
const CALL_KOSTEN = 0.0042;
/** Lauf mit einem Call eines Modells ohne Preis. */
const ohnePreisLauf = (prompt: string, tag = 7): Lauf => {
  const l = lauf(prompt, 0, 4, { tag });
  const letzte = l.zeilen[l.zeilen.length - 1] as { message: { model: string } };
  letzte.message.model = "claude-unbekannt-9";
  return l;
};

describe("laufzeiten: Kosten (#1558)", () => {
  test("Kosten eines Laufs = Summe der Call-Preise", () => {
    const l = lauf("Plane #1", 0, 4, { tool: [1, 2] }); // 3 Calls
    expect(S.laufzeiten({ laeufe: [l] }).laeufe[0].kosten).toBeCloseTo(3 * CALL_KOSTEN, 8);
  });
  test("ein Call ohne Preis macht die Kosten des Laufs null (nie 0) und zählt als ohnePreis", () => {
    const r = S.laufzeiten({ laeufe: [ohnePreisLauf("Plane #1"), lauf("Plane #2", 0, 4)] });
    expect(r.laeufe[0].kosten).toBeNull();
    expect(r.aggregat.gesamt.n).toBe(2);
    expect(r.aggregat.gesamt.ohnePreis).toBe(1);
    expect(r.aggregat.gesamt.kosten).toBeCloseTo(2 * CALL_KOSTEN, 8); // Median nur über den Lauf mit Preis
    expect(r.aggregat.gesamt.kostenSumme).toBeCloseTo(2 * CALL_KOSTEN, 8);
  });
  test("Gruppe ohne bepreiste Läufe: Median null, Summe 0", () => {
    const g = S.laufzeiten({ laeufe: [ohnePreisLauf("Plane #1")] }).aggregat.gesamt;
    expect(g).toMatchObject({ kosten: null, kostenSumme: 0, ohnePreis: 1 });
  });
  test("Median und Summe je Gruppe vor und ab dem Schnitt, auch ohne Sammeltickets", () => {
    const laeufe = [lauf("#1", 0, 4), lauf("#2 (gesammelt)", 0, 4, { tool: [1, 2] }), lauf("#3", 10, 20), lauf("#4", 12, 30), lauf("#5", 12, 30, { tool: [13, 14] })];
    const a = S.laufzeiten({ laeufe, schnitt: t(10) }).aggregat;
    expect(a.alt?.kostenSumme).toBeCloseTo(5 * CALL_KOSTEN, 8);
    expect(a.altOhneSammel?.kostenSumme).toBeCloseTo(2 * CALL_KOSTEN, 8);
    expect(a.neu?.kostenSumme).toBeCloseTo(7 * CALL_KOSTEN, 8);
    expect(a.neu?.kosten).toBeCloseTo(2 * CALL_KOSTEN, 8);
    expect(a.neuOhneSammel?.kostenSumme).toBeCloseTo(7 * CALL_KOSTEN, 8);
  });
  test("Lauf ohne Call hat Kosten null (nie 0 $), zählt als ohnePreis und senkt den Median nicht", () => {
    const ohneRequest: Lauf = { meta: { agentType: "kubernia-planner" }, zeilen: [user(0, "Plane #3"), user(5, "weiter")] };
    const r = S.laufzeiten({ laeufe: [ohneRequest, lauf("Plane #2", 0, 4)] });
    expect(r.laeufe[0].kosten).toBeNull();
    expect(r.aggregat.gesamt.ohnePreis).toBe(1);
    expect(r.aggregat.gesamt.kosten).toBeCloseTo(2 * CALL_KOSTEN, 8);
  });
  test("doppelte JSONL-Zeilen derselben Message-ID zählen einmal", () => {
    const l = lauf("Plane #1", 0, 4);
    l.zeilen.push({ ...l.zeilen[1], uuid: "dupe" }); // gleiche message.id wie Zeile 1
    expect(S.laufzeiten({ laeufe: [l] }).laeufe[0].kosten).toBeCloseTo(2 * CALL_KOSTEN, 8);
  });
});

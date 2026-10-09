/* Subagent-Laufzeit (#1382): Kern pur, synthetische Transkriptzeilen ohne IO. */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as raw from "../scripts/subagent-laufzeit.mjs";

type Row = Record<string, unknown>;
type Lauf = { meta: { agentType?: string }; zeilen: Row[]; datei?: string };
type L = { modelle: string[]; datei: string | null; kosten: number | null; ticket: number | null; sammel: boolean; dauerMin: number; toolMin: number; modellMin: number; requests: number; sProRequest: number | null; maxKontext: number; parallel: number; offen: boolean; start: string };
type Stat = { kosten: number | null; kostenSumme: number; ohnePreis: number; n: number; dauerMin: number | null; maxDauerMin: number | null; sProRequest: number | null; parallel: number | null };
type Erg = { laeufe: L[]; aggregat: { gesamt: Stat; ohneSammel: Stat; sammel: Stat; jeTag: (Stat & { tag: string; sammelN: number })[]; alt?: Stat; neu?: Stat; altOhneSammel?: Stat; neuOhneSammel?: Stat; offen: number } };
const S = raw as unknown as {
  vereinigungMs: (i: [number, number][]) => number;
  laufzeiten: (e: { laeufe: Lauf[]; agent?: string; von?: string; bis?: string; schnitt?: string }) => Erg;
  renderMarkdown: (r: Erg) => string;
};

const t = (min: number, tag = 7) => new Date(Date.UTC(2026, 9, tag, 10, 0, 0) + min * 60_000).toISOString();
let seq = 0;
const user = (min: number, text: string, tag = 7): Row => ({ type: "user", timestamp: t(min, tag), message: { role: "user", content: text } });
const call = (min: number, tag = 7, tool?: string, ctx = 1000, cache = 0, model: string | undefined = "claude-opus-5-5"): Row => {
  seq += 1;
  return {
    type: "assistant",
    timestamp: t(min, tag),
    uuid: `u${seq}`,
    message: {
      id: `m${seq}`,
      model,
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

describe("vereinigungMs", () => {
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

describe("laufzeiten: Modelle und Transkriptdatei (#1580)", () => {
  const mitModellen = (modelle: string[], datei?: string): Lauf => {
    const l = lauf("Lens #1", 0, 4);
    l.zeilen = [user(0, "Lens #1"), ...modelle.map((m, i) => call(1 + i, 7, undefined, 1000, 0, m))];
    if (datei) l.datei = datei;
    l.meta.agentType = "kubernia-lens";
    return l;
  };
  const lauf1 = (l: Lauf) => S.laufzeiten({ laeufe: [l], agent: "kubernia-lens" }).laeufe[0];
  test("modelle: sortiert, ohne Doppel", () => {
    expect(lauf1(mitModellen(["claude-sonnet-5-5", "claude-opus-5-5", "claude-sonnet-5-5"])).modelle).toEqual(["claude-opus-5-5", "claude-sonnet-5-5"]);
  });
  test("modelle: ein Call ohne model taucht nicht auf (kein undefined)", () => {
    expect(lauf1(mitModellen(["claude-sonnet-5-5", ""])).modelle).toEqual(["claude-sonnet-5-5"]);
  });
  test("modelle: ohne Call leer", () => {
    expect(lauf1(mitModellen([])).modelle).toEqual([]);
  });
  test("datei wird durchgereicht, fehlt sie, ist sie null", () => {
    expect(lauf1(mitModellen(["claude-opus-5-5"], "s1/subagents/agent-x.jsonl")).datei).toBe("s1/subagents/agent-x.jsonl");
    expect(lauf1(mitModellen(["claude-opus-5-5"])).datei).toBeNull();
  });
  test("renderMarkdown: Spalte Modellzeit und Spalte Modell (Name, `-` ohne Modell)", () => {
    const r = S.laufzeiten({ laeufe: [mitModellen(["claude-sonnet-5-5"]), mitModellen([])], agent: "kubernia-lens" });
    const md = S.renderMarkdown(r);
    expect(md).toContain("| Modellzeit | Modell | Tool |");
    expect(md).toContain("| Modell |");
    expect(md).toMatch(/\| claude-sonnet-5-5 \|/);
    expect(md).toMatch(/^\| 2026[^\n]*\| \d+\.\d \| - \| \d+\.\d \|/m);
  });
});

describe("ladeLaeufe: datei relativ zum Projektordner (#1580)", () => {
  const L2 = raw as unknown as { ladeLaeufe: (dir: string, agent: string, von?: string) => { meta: { agentType: string }; datei: string }[] };
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });
  const projekt = () => {
    const dir = mkdtempSync(join(tmpdir(), "kq-laufzeit-"));
    dirs.push(dir);
    const sub = join(dir, "sess1", "subagents");
    mkdirSync(sub, { recursive: true });
    const schreibe = (n: string, agentType: string) => {
      writeFileSync(join(sub, `${n}.meta.json`), JSON.stringify({ agentType }));
      writeFileSync(join(sub, `${n}.jsonl`), JSON.stringify(user(0, "Lens #1")) + "\n");
    };
    schreibe("agent-x", "kubernia-lens");
    schreibe("agent-y", "kubernia-planner");
    return dir;
  };
  test("datei = <session>/subagents/<name>.jsonl mit Schrägstrichen, falscher Typ wird nicht geladen", () => {
    const r = L2.ladeLaeufe(projekt(), "kubernia-lens");
    expect(r).toHaveLength(1);
    expect(r[0].datei).toBe("sess1/subagents/agent-x.jsonl");
  });
});

describe("laufzeiten: Beschreibung, Delta-Art, Erst-Call (#1582)", () => {
  type Ext = L & { beschreibung: string | null; brille: string | null; runde: number | null; deltaArt: string | null; promptZeichen: number; ersterCall: { input: number; cacheWrite: number; cacheRead: number } | null };
  const mit = (beschreibung: string | undefined, prompt: string, o: { ohneCall?: boolean } = {}): Ext => {
    const zeilen: Row[] = [user(0, prompt)];
    if (!o.ohneCall) zeilen.push(call(1, 7, undefined, 100, 8000), call(2));
    const meta: Record<string, unknown> = { agentType: "kubernia-lens" };
    if (beschreibung !== undefined) meta.description = beschreibung;
    return S.laufzeiten({ laeufe: [{ meta: meta, zeilen }], agent: "kubernia-lens" }).laeufe[0] as Ext;
  };
  test("neues Format: Brille und Runde, kurze Namen werden zur Brille normalisiert", () => {
    expect(mit("Lens Architektur R1", "x")).toMatchObject({ brille: "Architektur", runde: 1, beschreibung: "Lens Architektur R1" });
    expect(mit("Lens Test R3", "x")).toMatchObject({ brille: "Test-Adäquanz", runde: 3 });
    expect(mit("Lens Requirement R2", "x")).toMatchObject({ brille: "Requirement-Treue", runde: 2 });
  });
  test("älteres Format lens:<brille>:r<n>", () => {
    expect(mit("lens:doku:r2", "x")).toMatchObject({ brille: "Doku", runde: 2 });
  });
  test("fehlende oder fremde Beschreibung: null ohne Absturz", () => {
    expect(mit(undefined, "x")).toMatchObject({ beschreibung: null, brille: null, runde: null });
    expect(mit("Plane etwas", "x")).toMatchObject({ brille: null, runde: null });
  });
  test("deltaArt: null ohne Delta-Patch, fix mit, merge bei Konflikt-Auflösung oder Merge in der Beschreibung", () => {
    expect(mit("Lens Doku R2", "Patch: /t/kq-1-r1.patch").deltaArt).toBeNull();
    expect(mit("Lens Doku R2", "Patch: /t/kq-1-r1.patch Delta-Patch: /t/kq-1-r2-delta.patch").deltaArt).toBe("fix");
    expect(mit("Lens Doku R2", "Delta-Patch: /t/x.patch prüfe die Konflikt-Auflösung").deltaArt).toBe("merge");
    expect(mit("Lens Doku R3 Merge-Auflösung", "Delta-Patch: /t/x.patch").deltaArt).toBe("merge");
  });
  test("ersterCall und promptZeichen; ohne Call null", () => {
    const l = mit("Lens Doku R1", "abcde");
    expect(l.promptZeichen).toBe(5);
    expect(l.ersterCall).toMatchObject({ input: 100 });
    expect(mit("Lens Doku R1", "x", { ohneCall: true }).ersterCall).toBeNull();
  });
});

describe("laufzeiten: Patch-Zugriffe (#1582)", () => {
  type Z = { zugriffe: number; zeilen: number; gesamt: number | null; anteil: number | null; komplett: boolean };
  type P = { ticket: number | null; runde: number | null; voll: Z; delta: Z | null } | null;
  const VOLL = "C:\\Temp\\kq-12-r2.patch";
  const DELTA = "C:\\Temp\\kq-12-r2-delta.patch";
  let n = 0;
  type Aufruf = { name: string; input: Record<string, unknown>; ergebnis?: Record<string, unknown>; fehler?: boolean };
  const lesen = (pfad: string, offset: number, num: number, total: number): Aufruf => ({ name: "Read", input: { file_path: pfad, offset, limit: num }, ergebnis: { type: "text", file: { filePath: pfad, startLine: offset, numLines: num, totalLines: total } } });
  const patchVon = (prompt: string, aufrufe: Aufruf[]): P => {
    const zeilen: Row[] = [user(0, prompt)];
    aufrufe.forEach((a, i) => {
      const id = `p${++n}`;
      zeilen.push(call(1 + i, 7, undefined, 1000));
      const asst = call(1 + i + 0.05, 7, id);
      (asst.message as { content: unknown[] }).content = [{ type: "tool_use", id, name: a.name, input: a.input }];
      zeilen.push(asst);
      zeilen.push({ type: "user", timestamp: t(1 + i + 0.1), toolUseResult: a.ergebnis, message: { content: [{ type: "tool_result", tool_use_id: id, content: "ok", is_error: a.fehler }] } });
    });
    zeilen.push(call(20));
    const l = S.laufzeiten({ laeufe: [{ meta: { agentType: "kubernia-lens" }, zeilen }], agent: "kubernia-lens" }).laeufe[0] as unknown as { patch: P };
    return l.patch;
  };
  const PROMPT = `Lens Doku R2 · Patch: ${VOLL} · Delta-Patch: ${DELTA} · erwarteter HEAD: abc`;
  const sh = (command: string, name = "Bash"): Aufruf => ({ name, input: { command }, ergebnis: { stdout: "x" } });

  test("Ticket und Runde stammen aus dem Patch-Pfad, ohne Patch im Prompt ist patch null", () => {
    expect(patchVon(PROMPT, [])).toMatchObject({ ticket: 12, runde: 2 });
    expect(patchVon("kein Patch hier", [lesen(VOLL, 1, 10, 10)])).toBeNull();
  });
  test("abschnittsweise Vollständigkeit: alle Abschnitte gelesen = komplett, Anteil 1", () => {
    const p = patchVon(PROMPT, [lesen(VOLL, 1, 100, 250), lesen(VOLL, 101, 100, 250), lesen(VOLL, 201, 50, 250)])!;
    expect(p.voll).toMatchObject({ zugriffe: 3, zeilen: 250, gesamt: 250, anteil: 1, komplett: true });
    expect(p.delta).toMatchObject({ zugriffe: 0, komplett: false });
  });
  test("nur Delta gelesen plus gezielter Read auf den vollen Patch: voll nicht komplett", () => {
    const p = patchVon(PROMPT, [lesen(DELTA, 1, 40, 40), lesen(VOLL, 120, 20, 400)])!;
    expect(p.delta).toMatchObject({ zeilen: 40, anteil: 1, komplett: true });
    expect(p.voll).toMatchObject({ zeilen: 20, gesamt: 400, anteil: 0.05, komplett: false });
  });
  test("überlappende Bereiche zählen einmal", () => {
    const p = patchVon(PROMPT, [lesen(VOLL, 1, 60, 100), lesen(VOLL, 41, 20, 100)])!;
    expect(p.voll.zeilen).toBe(60);
  });
  test("Read ohne offset/limit und ohne Längenangabe gilt als komplett, mit Längenangabe zählt der Anteil", () => {
    expect(patchVon(PROMPT, [{ name: "Read", input: { file_path: VOLL }, ergebnis: {} }])!.voll.komplett).toBe(true);
    const mitLaenge: Aufruf = { name: "Read", input: { file_path: VOLL }, ergebnis: { file: { startLine: 1, numLines: 100, totalLines: 5000 } } };
    expect(patchVon(PROMPT, [mitLaenge])!.voll).toMatchObject({ anteil: 0.02, komplett: false });
  });
  test("Fallback offset/limit ohne Ergebnisfeld: Bereich aus der Eingabe, Länge unbekannt, nicht komplett", () => {
    const p = patchVon(PROMPT, [{ name: "Read", input: { file_path: VOLL, offset: 11, limit: 30 }, ergebnis: {} }])!;
    expect(p.voll).toMatchObject({ zeilen: 30, gesamt: null, anteil: null, komplett: false });
  });
  test("fehlgeschlagener Read zählt nicht", () => {
    expect(patchVon(PROMPT, [{ ...lesen(VOLL, 1, 10, 10), fehler: true }])!.voll.zugriffe).toBe(0);
  });
  test("cat und Get-Content ohne Begrenzung sind komplett, sed/head/grep gezielt", () => {
    expect(patchVon(PROMPT, [sh(`cat "${VOLL}"`)])!.voll.komplett).toBe(true);
    expect(patchVon(PROMPT, [sh(`Get-Content ${VOLL}`, "PowerShell")])!.voll.komplett).toBe(true);
    expect(patchVon(PROMPT, [sh(`sed -n '1,50p' "${VOLL}"`)])!.voll).toMatchObject({ zugriffe: 1, komplett: false });
    expect(patchVon(PROMPT, [sh(`head -n 20 ${VOLL}`)])!.voll.komplett).toBe(false);
    expect(patchVon(PROMPT, [sh(`cat ${VOLL} | grep foo`)])!.voll.komplett).toBe(false);
    expect(patchVon(PROMPT, [sh(`Get-Content ${VOLL} -TotalCount 30`, "PowerShell")])!.voll.komplett).toBe(false);
  });
  test("Grep auf den Patch ist ein gezielter Zugriff ohne Zeilen", () => {
    const p = patchVon(PROMPT, [{ name: "Grep", input: { pattern: "x", path: VOLL }, ergebnis: {} }])!;
    expect(p.voll).toMatchObject({ zugriffe: 1, zeilen: 0, komplett: false });
  });
  test("Basename-Vergleich: Slash-Stil und Großschreibung gelten, ein anderer Patch und der Delta-Name nicht für den vollen", () => {
    const p = patchVon(PROMPT, [lesen("c:/temp/KQ-12-R2.PATCH", 1, 10, 10), lesen("C:\\Temp\\kq-99-r2.patch", 1, 10, 10)])!;
    expect(p.voll.zugriffe).toBe(1);
    const q = patchVon(PROMPT, [lesen(DELTA, 1, 5, 5)])!;
    expect(q.voll.zugriffe).toBe(0);
    expect(q.delta!.zugriffe).toBe(1);
    expect(patchVon(PROMPT, [sh(`cat ${DELTA}`)])!.voll.zugriffe).toBe(0);
  });
  test("Fließtext mit Patch: im Auftrag zählt nicht, nur ein Pfad auf eine .patch-Datei", () => {
    const p = patchVon("Regel (Patch:`, Delta-Patch: ein Satz) Patch: " + VOLL + " Delta-Patch: " + DELTA, [lesen(VOLL, 1, 5, 5)])!;
    expect(p.voll.zugriffe).toBe(1);
    expect(p.delta).toMatchObject({ zugriffe: 0 });
  });
  test("ein Delta-Pfad im Feld Patch: ist der Delta-Patch, kein voller Patch", () => {
    const p = patchVon("Patch: " + DELTA + " Delta-Patch: ein Satz", [lesen(DELTA, 1, 17, 18)])!;
    expect(p.voll.zugriffe).toBe(0);
    expect(p.delta).toMatchObject({ zugriffe: 1 });
  });
  test("Read auf eine Tool-Result-Datei zählt nicht als Patch-Zugriff", () => {
    expect(patchVon(PROMPT, [lesen("C:\\Users\\x\\tool-results\\abc.txt", 1, 200, 200)])!.voll.zugriffe).toBe(0);
  });
});

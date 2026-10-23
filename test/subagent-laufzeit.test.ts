/* Subagent-Laufzeit (#1382): Kern pur, synthetische Transkriptzeilen ohne IO. */
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as laufzeitRoh from "../scripts/subagent-laufzeit.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as rawLaeufe from "../scripts/subagent-laeufe.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as namenRoh from "../scripts/ticket-namen.mjs";
import { FREMD, FREMD_NAMEN } from "./support/fremd-config";

// Die Namen kommen aus der Fremd-Config; die Wrapper reichen sie an die Kern-Funktionen durch, damit die Tests ihre Eingaben wie bisher schreiben.
const namenModul = namenRoh as unknown as { ticketNamen: (c: unknown) => unknown; escapeRegex: (s: string) => string };
const NAMEN = FREMD_NAMEN;
const escapeRegex = namenModul.escapeRegex;
const WT = FREMD.praefixe.worktree;
const { planer: PLANER, lens: LENS } = FREMD.agenten;
type Offen = (e: object) => unknown;
const laufzeitModul = laufzeitRoh as unknown as { laufzeiten: Offen; typenUebersicht: Offen; parseArgs: (argv: string[], namen: unknown) => unknown };
const raw = {
  ...(laufzeitRoh as object),
  laufzeiten: (e: object) => laufzeitModul.laufzeiten({ namen: NAMEN, ...e }),
  typenUebersicht: (e: object) => laufzeitModul.typenUebersicht({ namen: NAMEN, ...e }),
  parseArgs: (argv: string[]) => laufzeitModul.parseArgs(argv, NAMEN),
};

type Row = Record<string, unknown>;
type Lauf = { meta: { agentType?: string }; zeilen: Row[]; datei?: string };
type L = { modelle: string[]; datei: string | null; kosten: number | null; kostenGeschaetzt: number | null; ticket: number | null; sammel: boolean; dauerMin: number; toolMin: number; modellMin: number; requests: number; sProRequest: number | null; maxKontext: number; parallel: number; offen: boolean; start: string };
type Stat = { kostenGeschaetzt: number | null; kosten: number | null; kostenSumme: number | null; kostenGeschaetztSumme: number | null; output: number; outputGeschaetzt: number; ohnePreis: number; n: number; dauerMin: number | null; maxDauerMin: number | null; sProRequest: number | null; parallel: number | null };
type Erg = { laeufe: L[]; aggregat: { gesamt: Stat; ohneSammel: Stat; sammel: Stat; jeTag: (Stat & { tag: string; sammelN: number })[]; alt?: Stat; neu?: Stat; altOhneSammel?: Stat; neuOhneSammel?: Stat; offen: number } };
const S = raw as unknown as {
  laufzeiten: (e: { laeufe: Lauf[]; agent?: string; von?: string; bis?: string; schnitt?: string; tickets?: number[]; ohne?: number[] }) => Erg;
  parseArgs: (argv: string[]) => { tickets: number[]; ohne: number[]; fehler?: string };
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
  return { meta: { agentType: o.agentType ?? PLANER }, zeilen };
};

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

describe("laufzeiten: Ticketfilter (--ticket, --ohne)", () => {
  const laeufe = () => [lauf("Plane #5", 0, 10), lauf("Plane #6", 0, 10), lauf("Plane ohne Nummer", 0, 10)];
  test("ohne: ein Ticket fällt ganz weg, Läufe ohne Ticket bleiben", () => {
    expect(S.laufzeiten({ laeufe: laeufe(), ohne: [6] }).laeufe.map((l) => l.ticket)).toEqual([5, null]);
  });
  test("tickets: nur dieses Ticket, ein Lauf ohne Ticket fällt heraus", () => {
    expect(S.laufzeiten({ laeufe: laeufe(), tickets: [6] }).laeufe.map((l) => l.ticket)).toEqual([6]);
  });
  test("ein ausgeschlossener Lauf zählt nicht in parallel", () => {
    const r = S.laufzeiten({ laeufe: [lauf("Plane #5", 0, 10), lauf("Plane #6", 0, 10)], ohne: [6] });
    expect(r.laeufe[0].parallel).toBe(0);
  });
  test("parseArgs: wiederholbar; ungültige Nummer oder fehlender Wert setzt fehler", () => {
    expect(S.parseArgs(["--ticket", "5", "--ticket", "6", "--ohne", "7", "--ohne", "8"])).toMatchObject({ tickets: [5, 6], ohne: [7, 8] });
    expect(S.parseArgs(["--von", "x"])).toMatchObject({ tickets: [], ohne: [] });
    for (const argv of [["--ohne", "abc"], ["--ohne"], ["--ticket", "1.5"]]) expect(S.parseArgs(argv).fehler, argv.join(" ")).toMatch(/Ticketnummer/);
  });
});

describe("laufzeiten: Filter und Aggregat", () => {
  test("falscher oder fehlender agentType, Zeilen ohne Zeitstempel und leere Eingabe", () => {
    const ohneTyp: Lauf = { meta: {}, zeilen: lauf("x #1", 0, 1).zeilen };
    const ohneZeit: Lauf = { meta: { agentType: PLANER }, zeilen: [{ type: "user", message: { content: "x" } }] };
    const r = S.laufzeiten({ laeufe: [ohneTyp, lauf("x #2", 0, 1, { agentType: LENS }), ohneZeit] });
    expect(r.laeufe).toEqual([]);
    expect(r.aggregat.gesamt).toMatchObject({ n: 0, dauerMin: null });
    expect(S.laufzeiten({ laeufe: [] }).laeufe).toEqual([]);
    expect(S.laufzeiten({ laeufe: [lauf("x #2", 0, 1, { agentType: LENS })], agent: LENS }).laeufe).toHaveLength(1);
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
    const r = S.laufzeiten({ laeufe: [lauf("#1", 0, 10), lauf("#2", 5, 15), lauf("#3", 30, 40), lauf("#9", 0, 40, { agentType: LENS })] });
    expect(r.laeufe.map((l) => l.parallel)).toEqual([1, 1, 0]);
  });
  test("s je Request: Median der Modellzeit je Request, Lauf ohne Request zählt nicht (kein Infinity/NaN)", () => {
    // 2 Requests über 10 min Modellzeit = 300 s; 3 Requests, 8 min Modellzeit = 160 s; Lauf ohne Request.
    const ohneRequest: Lauf = { meta: { agentType: PLANER }, zeilen: [user(0, "Plane #3"), user(5, "weiter")] };
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
  test("Standardauswertung nennt die Ticket-Zahl und warnt bei Tickets mit mehreren Läufen (#1646)", () => {
    const zwei = S.renderMarkdown(S.laufzeiten({ laeufe: [lauf("Plane #77", 0, 4), lauf("Plane #77", 10, 14), lauf("Plane #78", 20, 24)] }));
    expect(zwei).toMatch(/\| alle gemessenen \| 3 \|.*\| 2 \|$/m);
    expect(zwei).toContain("Mediane je Lauf, nicht je Ticket (1 Tickets mit mehreren Läufen); Ticket-Schnitt: kontext-treiber --je-ticket");
    const je1 = S.renderMarkdown(S.laufzeiten({ laeufe: [lauf("Plane #77", 0, 4), lauf("Plane #78", 20, 24)] }));
    expect(je1).not.toContain("Mediane je Lauf");
  });
  test("renderMarkdown zeigt die Kosten-Spalte, `-` ohne Preis", () => {
    const md = S.renderMarkdown(S.laufzeiten({ laeufe: [lauf("Plane #77", 0, 4), lauf("Plane #79", 0, 4), ohnePreisLauf("Plane #78")] }));
    expect(md).toContain("Kosten ($)");
    expect(md).toMatch(/\| #77 \|.*\| 0\.01 \|/);
    expect(md).toMatch(/\| #78 \|.*\| - \|/);
    // Aggregat: Median 0,01, Σ 0,02, ein Lauf ohne Preis (Spalten Median, Summe, ohne Preis).
    // Σ geschätzt (#1568) steht zwischen Summe und „ohne Preis“.
    expect(md).toContain("Σ Kosten geschätzt ($)");
    expect(md).toMatch(/\| alle gemessenen \| 3 \|.*\| 0\.01 \| 0\.02 \| 0\.02 \| 1 \|/);
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
  test("geschätzte Kosten: Kontext-Zuwachs ohne Tool-Ergebnis zählt als Output, strikt über dem Aufgezeichneten (#1568)", () => {
    const l = lauf("Plane #1", 0, 4);
    l.zeilen.splice(2, 0, call(1, 7, undefined, 3000)); // Kontext 1000 → 3000 → 1000: der erste Call hat 2000 Token Zuwachs
    const r = S.laufzeiten({ laeufe: [l] });
    expect(r.laeufe[0].kostenGeschaetzt).toBeGreaterThan(r.laeufe[0].kosten as number);
    expect(r.aggregat.gesamt.outputGeschaetzt).toBeGreaterThanOrEqual(2000);
    expect(r.aggregat.gesamt.output).toBe(30);
  });
  test("ohne Preis: auch die geschätzten Kosten sind null, nie 0 $ (#1568)", () => {
    const r = S.laufzeiten({ laeufe: [ohnePreisLauf("Plane #1")] });
    expect(r.laeufe[0].kostenGeschaetzt).toBeNull();
    expect(r.aggregat.gesamt.kostenGeschaetzt).toBeNull();
  });
  test("geschätzte Kosten: Summe und Output je Lauf aus den Calls (#1568)", () => {
    const r = S.laufzeiten({ laeufe: [lauf("Plane #1", 0, 4)] });
    expect(r.laeufe[0].kostenGeschaetzt).toBeGreaterThanOrEqual(r.laeufe[0].kosten as number);
    expect(r.aggregat.gesamt.kostenGeschaetztSumme).toBeCloseTo(r.laeufe[0].kostenGeschaetzt as number, 8);
    expect(r.aggregat.gesamt.outputGeschaetzt).toBeGreaterThanOrEqual(r.aggregat.gesamt.output);
    expect(r.aggregat.gesamt.output).toBeGreaterThan(0);
  });
  test("Gruppe ohne bepreiste Läufe: Median und Summen null (nie 0 $)", () => {
    const g = S.laufzeiten({ laeufe: [ohnePreisLauf("Plane #1")] }).aggregat.gesamt;
    expect(g).toMatchObject({ kosten: null, kostenSumme: null, kostenGeschaetztSumme: null, ohnePreis: 1 });
    expect(S.renderMarkdown(S.laufzeiten({ laeufe: [ohnePreisLauf("Plane #1")] }))).toContain("| - | - | - | 1 |");
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
    const ohneRequest: Lauf = { meta: { agentType: PLANER }, zeilen: [user(0, "Plane #3"), user(5, "weiter")] };
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
    l.meta.agentType = LENS;
    return l;
  };
  const lauf1 = (l: Lauf) => S.laufzeiten({ laeufe: [l], agent: LENS }).laeufe[0];
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
  test("renderMarkdown: zwei Modelle stehen kommagetrennt in einer Zelle", () => {
    const md = S.renderMarkdown(S.laufzeiten({ laeufe: [mitModellen(["claude-sonnet-5-5", "claude-opus-5-5"])], agent: LENS }));
    expect(md).toContain("| claude-opus-5-5, claude-sonnet-5-5 |");
  });
  test("renderMarkdown: Spalte Modellzeit und Spalte Modell (Name, `-` ohne Modell)", () => {
    const r = S.laufzeiten({ laeufe: [mitModellen(["claude-sonnet-5-5"]), mitModellen([])], agent: LENS });
    const md = S.renderMarkdown(r);
    expect(md).toContain("| Modellzeit | Modell | Tool |");
    expect(md).toContain("| Modell |");
    expect(md).toMatch(/\| claude-sonnet-5-5 \|/);
    expect(md).toMatch(/^\| 2026[^\n]*\| \d+\.\d \| - \| \d+\.\d \|/m);
  });
});

describe("ladeLaeufe: datei relativ zum Projektordner (#1580)", () => {
  const L2 = rawLaeufe as unknown as { ladeLaeufe: (dir: string, agent: string, von?: string) => { meta: { agentType: string }; datei: string }[] };
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });
  const projekt = () => {
    const dir = mkdtempSync(join(tmpdir(), "laufzeit-"));
    dirs.push(dir);
    const sub = join(dir, "sess1", "subagents");
    mkdirSync(sub, { recursive: true });
    const schreibe = (n: string, agentType: string) => {
      writeFileSync(join(sub, `${n}.meta.json`), JSON.stringify({ agentType }));
      writeFileSync(join(sub, `${n}.jsonl`), JSON.stringify(user(0, "Lens #1")) + "\n");
    };
    schreibe("agent-x", LENS);
    schreibe("agent-y", PLANER);
    return dir;
  };
  test("datei = <session>/subagents/<name>.jsonl mit Schrägstrichen, falscher Typ wird nicht geladen", () => {
    const r = L2.ladeLaeufe(projekt(), LENS);
    expect(r).toHaveLength(1);
    expect(r[0].datei).toBe("sess1/subagents/agent-x.jsonl");
  });
});

describe("laufzeiten: Beschreibung, Delta-Art, Erst-Call (#1582)", () => {
  type Ext = L & { beschreibung: string | null; brille: string | null; runde: number | null; deltaArt: string | null; promptZeichen: number; ersterCall: { input: number; cacheWrite: number; cacheRead: number } | null };
  const mit = (beschreibung: string | undefined, prompt: string, o: { ohneCall?: boolean } = {}): Ext => {
    const zeilen: Row[] = [user(0, prompt)];
    if (!o.ohneCall) zeilen.push(call(1, 7, undefined, 100, 8000), call(2));
    const meta: Record<string, unknown> = { agentType: LENS };
    if (beschreibung !== undefined) meta.description = beschreibung;
    return S.laufzeiten({ laeufe: [{ meta: meta, zeilen }], agent: LENS }).laeufe[0] as Ext;
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
    expect(mit("Lens Doku R2", `Patch: /t/${WT}1-r1.patch`).deltaArt).toBeNull();
    expect(mit("Lens Doku R2", `Patch: /t/${WT}1-r1.patch Delta-Patch: /t/${WT}1-r2-delta.patch`).deltaArt).toBe("fix");
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
  const VOLL = `C:\\Temp\\${WT}12-r2.patch`;
  const DELTA = `C:\\Temp\\${WT}12-r2-delta.patch`;
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
    const l = S.laufzeiten({ laeufe: [{ meta: { agentType: LENS }, zeilen }], agent: LENS }).laeufe[0] as unknown as { patch: P };
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
    const p = patchVon(PROMPT, [lesen(`c:/temp/${WT.toUpperCase()}12-R2.PATCH`, 1, 10, 10), lesen(`C:\\Temp\\${WT}99-r2.patch`, 1, 10, 10)])!;
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

describe("laufzeiten: Grenzfälle Runde 1 (#1582)", () => {
  type Ext = L & { brille: string | null; runde: number | null; deltaArt: string | null; ersterCall: { input: number; cacheWrite: number; cacheRead: number } | null; patch: { voll: { komplett: boolean; zugriffe: number }; delta: unknown } | null };
  const eins = (beschreibung: string | undefined, prompt: string, zeilen: Row[] = []): Ext => {
    const meta: Record<string, unknown> = { agentType: LENS };
    if (beschreibung !== undefined) meta.description = beschreibung;
    return S.laufzeiten({ laeufe: [{ meta: meta, zeilen: [user(0, prompt), call(1, 7, undefined, 100, 0), ...zeilen, call(2)] }], agent: LENS }).laeufe[0] as Ext;
  };
  test("Merge über M<n> und lens-m: Merge-Delta ohne Runde, Brille bleibt", () => {
    expect(eins("Lens Test M1", `Delta-Patch: /t/${WT}1-r2-delta.patch`)).toMatchObject({ deltaArt: "merge", brille: "Test-Adäquanz", runde: null });
    expect(eins("lens-m:test:1", `Delta-Patch: /t/${WT}1-r2-delta.patch`)).toMatchObject({ deltaArt: "merge", runde: null });
  });
  test("Beschreibung Merge-Auflösung R3 ist keine Brille", () => {
    expect(eins("Lens Merge-Auflösung R3", "x").brille).toBeNull();
  });
  test("ohne Beschreibung kommt die Runde aus dem Patch-Pfad", () => {
    expect(eins(undefined, `Patch: /t/${WT}1-r2.patch`).runde).toBe(2);
  });
  test("ersterCall trennt cacheWrite und cacheRead", () => {
    const l = S.laufzeiten({ laeufe: [{ meta: { agentType: LENS }, zeilen: [user(0, "x"), { ...call(1, 7, undefined, 100, 0), message: { id: "mx", model: "claude-opus-5-5", usage: { input_tokens: 7, output_tokens: 1, cache_creation_input_tokens: 111, cache_read_input_tokens: 222 }, content: [{ type: "text", text: "x" }] } }] }], agent: LENS }).laeufe[0] as Ext;
    expect(l.ersterCall).toEqual({ input: 7, cacheWrite: 111, cacheRead: 222 });
  });
  test("Prompt nur mit Patch: Delta ist null und deltaArt null; Delta-Pfad ohne Label (Workflow-Prompt) gilt", () => {
    const a = eins("Lens Doku R1", `Patch: /t/${WT}3-r1.patch`);
    expect(a.patch?.delta).toBeNull();
    expect(a.deltaArt).toBeNull();
    const w = eins("lens:doku:r2", `Patch-Datei bereit:\n  /t/${WT}3-r2.patch\nDelta-Patch der Nachbesserung:\n  /t/${WT}3-r2-delta.patch`);
    expect(w.deltaArt).toBe("fix");
    expect(w.patch?.delta).not.toBeNull();
    expect(w.runde).toBe(2);
  });
  test("deltaArt und patch.delta stammen aus einer Quelle: Delta-Pfad im Feld Patch: ergibt fix", () => {
    const l = eins("Lens Doku R2", `Patch: /t/${WT}3-r2-delta.patch Delta-Patch: ein Satz`);
    expect(l.deltaArt).toBe("fix");
    expect(l.patch?.delta).not.toBeNull();
  });
  test("Fließtext Delta-Patch: ohne Pfad ergibt weder deltaArt noch patch.delta", () => {
    const l = eins("Lens Doku R2", `Patch: /t/${WT}3-r2.patch Delta-Patch: kommt später`);
    expect(l.deltaArt).toBeNull();
    expect(l.patch?.delta).toBeNull();
  });
  test("ungelabelter voller Pfad: Ticket, Runde und Zugriff kommen aus dem Pfad", () => {
    const id = "ul1";
    const asst = call(1.5, 7, id);
    (asst.message as { content: unknown[] }).content = [{ type: "tool_use", id, name: "Read", input: { file_path: `/t/${WT}3-r1.patch`, offset: 1, limit: 4 } }];
    const zeilen: Row[] = [asst, { type: "user", timestamp: t(1.6), toolUseResult: { file: { startLine: 1, numLines: 4, totalLines: 40 } }, message: { content: [{ type: "tool_result", tool_use_id: id, content: "ok" }] } }];
    const l = eins(undefined, `Patch-Datei bereit:\n  /t/${WT}3-r1.patch`, zeilen);
    expect(l.patch).toMatchObject({ ticket: 3, runde: 1, voll: { zugriffe: 1, zeilen: 4 } });
    expect(l.runde).toBe(1);
  });
  test("Lookbehind: Delta-Patch zuerst, dann Patch, der volle Pfad bleibt der volle", () => {
    const VOLL = `/t/${WT}9-r2.patch`;
    const zeilen: Row[] = [];
    const id = "lb1";
    const asst = call(1.5, 7, id);
    (asst.message as { content: unknown[] }).content = [{ type: "tool_use", id, name: "Read", input: { file_path: VOLL, offset: 1, limit: 10 } }];
    zeilen.push(asst, { type: "user", timestamp: t(1.6), toolUseResult: { file: { startLine: 1, numLines: 10, totalLines: 10 } }, message: { content: [{ type: "tool_result", tool_use_id: id, content: "ok" }] } });
    const l = eins("Lens Doku R2", `Delta-Patch: /t/${WT}9-r2-delta.patch Patch: ${VOLL}`, zeilen);
    expect(l.patch?.voll).toMatchObject({ zugriffe: 1, komplett: true });
  });
  test("Schwelle komplett: 225 von 250 Zeilen (0,9) ja, 224 nein", () => {
    const VOLL = `/t/${WT}9-r2.patch`;
    const lesenZ = (num: number): Row[] => {
      const id = `sw${num}`;
      const asst = call(1.5, 7, id);
      (asst.message as { content: unknown[] }).content = [{ type: "tool_use", id, name: "Read", input: { file_path: VOLL, offset: 1, limit: num } }];
      return [asst, { type: "user", timestamp: t(1.6), toolUseResult: { file: { startLine: 1, numLines: num, totalLines: 250 } }, message: { content: [{ type: "tool_result", tool_use_id: id, content: "ok" }] } }];
    };
    expect(eins("Lens Doku R1", `Patch: ${VOLL}`, lesenZ(225)).patch?.voll.komplett).toBe(true);
    expect(eins("Lens Doku R1", `Patch: ${VOLL}`, lesenZ(224)).patch?.voll.komplett).toBe(false);
  });
  test("PowerShell-Begrenzer: Select-Object -First ist gezielt, type ohne Begrenzung komplett", () => {
    const VOLL = `/t/${WT}9-r2.patch`;
    const sh = (command: string): Row[] => {
      const id = `ps${command.length}`;
      const asst = call(1.5, 7, id);
      (asst.message as { content: unknown[] }).content = [{ type: "tool_use", id, name: "PowerShell", input: { command } }];
      return [asst, { type: "user", timestamp: t(1.6), toolUseResult: { stdout: "x" }, message: { content: [{ type: "tool_result", tool_use_id: id, content: "ok" }] } }];
    };
    expect(eins("Lens Doku R1", `Patch: ${VOLL}`, sh(`Get-Content ${VOLL} | Select-Object -First 50`)).patch?.voll.komplett).toBe(false);
    expect(eins("Lens Doku R1", `Patch: ${VOLL}`, sh(`type ${VOLL}`)).patch?.voll.komplett).toBe(true);
  });
});

type TypRow = { agentType: string; n: number; offen: number; requests: number; kostenSumme: number | null; kostenGeschaetztSumme: number | null; ohnePreis: number; modelle: string[] };
type Typen = { modus: string; typen: TypRow[]; gesamt: TypRow };
const T = raw as unknown as {
  typenUebersicht: (e: { laeufe: Lauf[]; von?: string; bis?: string; tickets?: number[]; ohne?: number[] }) => Typen;
  renderTypen: (r: Typen) => string;
  parseArgs: (argv: string[]) => { typen?: boolean; agent: string; schnitt?: string; fehler?: string };
};

describe("typenUebersicht: Rollen-Übersicht je agentType (#1668)", () => {
  const mix = () => [
    lauf("Plane #1", 0, 4, { agentType: PLANER }),
    lauf("Lens #2", 0, 4, { agentType: LENS }),
    lauf("Lens #3", 10, 14, { agentType: LENS }),
    { meta: {}, zeilen: lauf("x #4", 0, 4).zeilen } as Lauf,
    { meta: { agentType: "" }, zeilen: lauf("x #5", 0, 4).zeilen } as Lauf,
    { meta: { agentType: 5 as unknown as string }, zeilen: lauf("x #6", 0, 4).zeilen } as Lauf,
  ];
  test("gruppiert je Typ, sortiert nach Typ, `unbekannt` (fehlend, leer, Nicht-String) am Ende", () => {
    const r = T.typenUebersicht({ laeufe: mix() });
    expect(r.typen.map((x) => [x.agentType, x.n])).toEqual([[LENS, 2], [PLANER, 1], ["unbekannt", 3]]);
    expect(r.gesamt.n).toBe(6);
    expect(r.modus).toBe("typen");
  });
  test("Σ Requests, Σ Kosten über bepreiste Läufe, Σ geschätzt getrennt, Modelle als sortierte Vereinigung", () => {
    const sonnet = lauf("Lens #9", 0, 4, { agentType: LENS });
    (sonnet.zeilen[1] as { message: { model: string } }).message.model = "claude-sonnet-5-5";
    const r = T.typenUebersicht({ laeufe: [lauf("Lens #2", 0, 4, { agentType: LENS }), sonnet] });
    const lens = r.typen[0];
    expect(lens.requests).toBe(4);
    expect(lens.kostenSumme).toBeGreaterThan(0);
    expect(lens.kostenGeschaetztSumme).toBeGreaterThanOrEqual(lens.kostenSumme as number);
    expect(lens.modelle).toEqual(["claude-opus-5-5", "claude-sonnet-5-5"]);
  });
  test("Lauf ohne Preis zählt in ohnePreis, nicht in die Summe; Typ nur ohne Preis: null statt 0", () => {
    const o = ohnePreisLauf("Lens #1");
    o.meta.agentType = LENS;
    const gemischt = T.typenUebersicht({ laeufe: [o, lauf("Lens #2", 0, 4, { agentType: LENS })] });
    expect(gemischt.typen[0].ohnePreis).toBe(1);
    expect(gemischt.typen[0].kostenSumme).toBeCloseTo(2 * CALL_KOSTEN, 8);
    const nur = T.typenUebersicht({ laeufe: [o] });
    expect(nur.typen[0].kostenSumme).toBeNull();
    expect(nur.typen[0].kostenGeschaetztSumme).toBeNull();
    expect(T.renderTypen(nur)).toMatch(new RegExp(`\\| ${escapeRegex(LENS)} \\| 1 \\| 0 \\| 2 \\| - \\| - \\| 1 \\|`));
  });
  test("offene Läufe zählen in die Summen und in die Spalte offen", () => {
    const offen = lauf("Plane #1", 0, 4, { tool: [2, 3] });
    offen.zeilen.splice(offen.zeilen.length - 2, 2); // letzter tool_use ohne Ergebnis
    const r = T.typenUebersicht({ laeufe: [offen, lauf("Plane #2", 0, 4)] });
    expect(r.typen[0]).toMatchObject({ n: 2, offen: 1 });
    expect(r.typen[0].requests).toBe(offen.zeilen.filter((z) => z.type === "assistant").length + 2);
  });
  test("Fenster [von, bis] nach Laufstart: Grenzlauf drin, kurz davor und danach draußen", () => {
    const laeufe = [lauf("Plane #1", -1, 3), lauf("Plane #2", 0, 3), lauf("Plane #3", 10, 13), lauf("Plane #4", 11, 14)];
    const r = T.typenUebersicht({ laeufe, von: t(0), bis: t(10) });
    expect(r.gesamt.n).toBe(2);
  });
  test("leeres Fenster: keine Typen, gesamt.n 0, Ausgabe nennt es", () => {
    const r = T.typenUebersicht({ laeufe: mix(), von: t(0, 20) });
    expect(r.typen).toEqual([]);
    expect(r.gesamt.n).toBe(0);
    expect(T.renderTypen(r)).toContain("keine Läufe im Fenster");
  });
  test("Σ geschätzt weicht von Σ aufgezeichnet ab (Kontext-Zuwachs) und wird getrennt gerechnet", () => {
    const wachsend = (agentType: string): Lauf => ({
      meta: { agentType },
      zeilen: [0, 1, 2].map((i) => ({ ...call(i), message: { id: `w${++seq}`, model: "claude-opus-5-5", usage: { input_tokens: 1000 + i * 3000, output_tokens: 10, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }, content: [{ type: "text", text: "x" }] } })),
    });
    const z = T.typenUebersicht({ laeufe: [wachsend(LENS), wachsend(LENS)] }).typen[0];
    expect(z.kostenSumme).toBeCloseTo(2 * 0.0486, 6);
    expect(z.kostenGeschaetztSumme).toBeCloseTo(2 * 0.1682, 6);
  });
  test("Sortierung: `unbekannt` steht auch hinter einem Typ, der alphabetisch danach kommt", () => {
    const laeufe = [{ meta: {}, zeilen: lauf("x #1", 0, 4).zeilen } as Lauf, lauf("Lens #2", 0, 4, { agentType: "zz-typ" }), lauf("Lens #3", 0, 4, { agentType: LENS })];
    expect(T.typenUebersicht({ laeufe }).typen.map((x) => x.agentType)).toEqual([LENS, "zz-typ", "unbekannt"]);
  });
  test("renderTypen: Typ ohne echtes Modell zeigt `-` in der Spalte Modelle", () => {
    const l = lauf("Lens #1", 0, 4, { agentType: LENS });
    for (const z of l.zeilen) if ((z as { message?: { model?: string } }).message?.model) (z as { message: { model?: string } }).message.model = undefined;
    expect(T.renderTypen(T.typenUebersicht({ laeufe: [l] }))).toMatch(new RegExp(`\\| ${escapeRegex(LENS)} \\|.*\\| 1 \\| - \\|$`, "m"));
  });
  test("--ohne filtert vor der Summe, --ticket schränkt ein", () => {
    expect(T.typenUebersicht({ laeufe: mix(), ohne: [2, 3] }).gesamt.n).toBe(4);
    expect(T.typenUebersicht({ laeufe: mix(), tickets: [2] }).gesamt.n).toBe(1);
  });
  test("renderTypen: Spaltenkopf und Zeile alle", () => {
    const md = T.renderTypen(T.typenUebersicht({ laeufe: mix() }));
    expect(md).toContain("| agentType | Läufe | offen | Requests | Σ Kosten ($, aufgezeichnet) | Σ Kosten geschätzt ($) | ohne Preis | Modelle |");
    expect(md).toMatch(/^\| alle \| 6 \|/m);
  });
  test("parseArgs: --typen setzt typen; mit --agent (beide Reihenfolgen) oder --schnitt ein Aufruf-Fehler; ohne --typen bleibt der Default", () => {
    expect(T.parseArgs(["--typen", "--von", "x"])).toMatchObject({ typen: true });
    expect(T.parseArgs(["--typen", "--agent", LENS]).fehler).toMatch(/--typen/);
    expect(T.parseArgs(["--agent", LENS, "--typen"]).fehler).toMatch(/--typen/);
    expect(T.parseArgs(["--typen", "--agent", PLANER]).fehler).toMatch(/--typen/);
    expect(T.parseArgs(["--typen", "--schnitt", "2026-10-01T00:00:00Z"]).fehler).toMatch(/--typen/);
    expect(T.parseArgs(["--von", "x"])).toMatchObject({ typen: false, agent: PLANER });
    expect(T.parseArgs(["--von", "x"]).fehler).toBeUndefined();
    expect(T.parseArgs(["--typen", "--ohne", "5"]).fehler).toBeUndefined();
  });
});

describe("ladeAlleLaeufe: alle Typen laden (#1668)", () => {
  const L3 = rawLaeufe as unknown as { ladeAlleLaeufe: (dir: string, von?: string) => { meta: { agentType?: string }; datei: string }[]; ladeLaeufe: (dir: string, agent: string, von?: string) => unknown[] };
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });
  test("lädt Typen und Meta ohne agentType, überspringt kaputte Meta und Meta ohne jsonl; datei relativ", () => {
    const dir = mkdtempSync(join(tmpdir(), "alle-"));
    dirs.push(dir);
    const sub = join(dir, "sess1", "subagents");
    mkdirSync(sub, { recursive: true });
    const jsonl = (n: string) => writeFileSync(join(sub, `${n}.jsonl`), JSON.stringify(user(0, "Lens #1")) + "\n");
    writeFileSync(join(sub, "a.meta.json"), JSON.stringify({ agentType: LENS }));
    jsonl("a");
    writeFileSync(join(sub, "b.meta.json"), JSON.stringify({ agentType: PLANER }));
    jsonl("b");
    writeFileSync(join(sub, "c.meta.json"), JSON.stringify({ description: "x" }));
    jsonl("c");
    writeFileSync(join(sub, "d.meta.json"), "{kaputt");
    jsonl("d");
    writeFileSync(join(sub, "e.meta.json"), JSON.stringify({ agentType: LENS })); // ohne jsonl
    const r = L3.ladeAlleLaeufe(dir);
    expect(r.map((x) => x.datei).sort()).toEqual(["sess1/subagents/a.jsonl", "sess1/subagents/b.jsonl", "sess1/subagents/c.jsonl"]);
    expect(L3.ladeLaeufe(dir, LENS)).toHaveLength(1);
  });
});

describe("Lader: nur Dateien jünger als von (#1693)", () => {
  const L4 = rawLaeufe as unknown as { ladeAlleLaeufe: (dir: string, von?: string) => { datei: string }[]; ladeLaeufe: (dir: string, agent: string, von?: string) => { datei: string }[] };
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });
  const fixture = () => {
    const dir = mkdtempSync(join(tmpdir(), "von-"));
    dirs.push(dir);
    const sub = join(dir, "sess1", "subagents");
    mkdirSync(sub, { recursive: true });
    for (const n of ["alt", "neu"]) {
      writeFileSync(join(sub, `${n}.meta.json`), JSON.stringify({ agentType: LENS }));
      writeFileSync(join(sub, `${n}.jsonl`), JSON.stringify(user(0, "Lens #1")) + "\n");
    }
    const alt = new Date("2026-01-01T00:00:00Z");
    utimesSync(join(sub, "alt.jsonl"), alt, alt);
    return dir;
  };
  test("ladeAlleLaeufe und ladeLaeufe schließen die ältere Datei aus, ohne von laden beide", () => {
    const dir = fixture();
    const von = "2026-06-01T00:00:00Z";
    expect(L4.ladeAlleLaeufe(dir, von).map((x) => x.datei)).toEqual(["sess1/subagents/neu.jsonl"]);
    expect(L4.ladeLaeufe(dir, LENS, von).map((x) => x.datei)).toEqual(["sess1/subagents/neu.jsonl"]);
    expect(L4.ladeAlleLaeufe(dir)).toHaveLength(2);
    expect(L4.ladeLaeufe(dir, LENS)).toHaveLength(2);
  });
});

describe("parseArgs strikt (#1790)", () => {
  const PA = S.parseArgs as unknown as (a: string[]) => { agent: string; agentGesetzt: boolean; typen: boolean; json: boolean; von?: string; bis?: string; schnitt?: string; projekt?: string; tickets: number[]; ohne: number[]; fehler?: string };
  test("alle Flags gesetzt: Form ohne fehler-Feld", () => {
    expect(PA(["--von", "v", "--bis", "b", "--agent", "x", "--schnitt", "s", "--projekt", "p", "--ticket", "1", "--ohne", "2", "--json"])).toEqual({ agent: "x", agentGesetzt: true, typen: false, json: true, von: "v", bis: "b", schnitt: "s", projekt: "p", tickets: [1], ohne: [2] });
    expect(PA([])).toEqual({ agent: PLANER, agentGesetzt: false, typen: false, json: false, tickets: [], ohne: [] });
  });
  test("unbekanntes Flag, Flag ohne Wert und doppeltes Einzel-Flag setzen fehler", () => {
    expect(PA(["--bogus"]).fehler).toMatch(/Unbekanntes Argument: --bogus/);
    expect(PA(["--schnitt"]).fehler).toMatch(/--schnitt braucht einen Wert/);
    expect(PA(["--ohne"]).fehler).toBe("--ohne erwartet eine Ticketnummer, nicht nichts");
    expect(PA(["--ticket", "abc", "--bogus"]).fehler).toMatch(/Unbekanntes Argument: --bogus/);
    expect(PA(["--agent", "a", "--agent", "b"]).fehler).toMatch(/--agent ist doppelt/);
    expect(PA(["--typen", "--typen"]).fehler).toMatch(/--typen ist doppelt/);
    expect(PA(["--typen", "--agent", "a"]).fehler).toMatch(/--typen gilt für alle Typen/);
  });
});

/* Kontext-Treiber (#1559): Kern pur, synthetische Transkriptzeilen ohne IO. */
import { describe, expect, test } from "vitest";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as kontextRoh from "../scripts/kontext-treiber.mjs";
import { FREMD, FREMD_NAMEN } from "./support/fremd-config";

// Die Namen kommen aus der Fremd-Config; die Wrapper reichen sie an die Kern-Funktionen durch, damit die Tests ihre Eingaben wie bisher schreiben.
const NAMEN = FREMD_NAMEN;
const WT = FREMD.praefixe.worktree;
const { planer: PLANER, umsetzer: UMSETZER, lens: LENS } = FREMD.agenten;
const kontextModul = kontextRoh as unknown as { kontextTreiber: (e: object) => unknown; analysiereLauf: (l: unknown, o?: object) => unknown; phaseDerCalls: (z: unknown, einstieg: unknown, namen: unknown) => unknown; parseArgs: (a: string[], namen: unknown) => unknown };
const raw = {
  ...(kontextRoh as object),
  kontextTreiber: (e: object) => kontextModul.kontextTreiber({ namen: NAMEN, ...e }),
  analysiereLauf: (l: unknown) => kontextModul.analysiereLauf(l, { namen: NAMEN }),
  phaseDerCalls: (z: unknown) => kontextModul.phaseDerCalls(z, null, NAMEN),
  parseArgs: (a: string[]) => kontextModul.parseArgs(a, NAMEN),
};

type Row = Record<string, unknown>;
type Lauf = { meta: { agentType?: string }; zeilen: Row[] };
type Tool = { name: string; input?: Record<string, unknown>; result?: string | null };
type CallSpec = { min: number; ctx?: number; cacheRead?: number; tools?: Tool[] };
type Top = { label: string; tokens: number; last: number };
type Rebuild = { ursache: string; tokens: number; mehrkosten: number | null };
type Pause = { ursache: string; sekunden: number; ticks: number };
type Analyse = {
  ticket: number | null;
  sammel: boolean;
  requests: number;
  phasen: string[];
  kontextSumme: number;
  kosten: number | null;
  ergebnisse: Top[];
  neuaufbauten: Rebuild[];
  pausen: Pause[];
  wachstum: { ergebnis: number; eingabe: number; rest: number };
};
type Bericht = {
  gesamt: { n: number; requests: number; kontextCallGewichtet: number | null; kontextMedianLaeufe: number | null; kostenMedian: number | null } | null;
  top: Top[];
  phasen: Record<string, { calls: number }>;
  neuaufbau: Record<string, { n: number; mehrkosten: number }>;
  pausen: Record<string, { n: number; ticks: number }>;
};
const K = raw as unknown as {
  phaseDerCalls: (zeilen: Row[]) => string[];
  analysiereLauf: (l: Lauf) => Analyse | null;
  kontextTreiber: (e: { laeufe: Lauf[]; agent?: string; von?: string; bis?: string; tickets?: number[]; wurzel?: string | null }) => { gesamt: Bericht; ohneSammel: Bericht; sammel: Bericht };
  renderMarkdown: (r: ReturnType<typeof K.kontextTreiber>) => string;
};

const t = (min: number) => new Date(Date.UTC(2026, 9, 8, 12, 0, 0) + min * 60_000).toISOString();
let seq = 0;
const user = (min: number, text: string): Row => ({ type: "user", timestamp: t(min), message: { role: "user", content: text } });
/** Eine Assistant-Nachricht mit Usage (je Tool ein eigener Content-Block, wie Claude Code es schreibt) plus die Ergebniszeilen. */
function schritt(c: CallSpec): Row[] {
  seq += 1;
  const id = `m${seq}`;
  const ctx = c.ctx ?? 10_000;
  const usage = { input_tokens: 0, output_tokens: 10, cache_creation_input_tokens: ctx - (c.cacheRead ?? ctx), cache_read_input_tokens: c.cacheRead ?? ctx };
  const base = { type: "assistant", timestamp: t(c.min), message: { id, model: "claude-sonnet-5-5", usage } };
  const tools = c.tools ?? [];
  if (!tools.length) return [{ ...base, uuid: `u${seq}`, message: { ...base.message, content: [{ type: "text", text: "x" }] } }];
  const rows: Row[] = [];
  tools.forEach((tool, i) => {
    rows.push({ ...base, uuid: `u${seq}-${i}`, message: { ...base.message, content: [{ type: "tool_use", id: `${id}-t${i}`, name: tool.name, input: tool.input ?? {} }] } });
  });
  tools.forEach((tool, i) => {
    if (tool.result === null) return;
    rows.push({ type: "user", timestamp: t(c.min + 0.1), message: { content: [{ type: "tool_result", tool_use_id: `${id}-t${i}`, content: tool.result ?? "ok" }] } });
  });
  return rows;
}
const lauf = (prompt: string, calls: CallSpec[], agentType = UMSETZER): Lauf => ({ meta: { agentType }, zeilen: [user(0, prompt), ...calls.flatMap(schritt)] });
const bash = (command: string, result?: string | null): Tool => ({ name: "Bash", input: { command }, result });
const edit = (file = "src/a.ts"): Tool => ({ name: "Edit", input: { file_path: file } });
const linse: Tool = { name: "Agent", input: { subagent_type: LENS, description: "Lens Architektur R1" } };

describe("Phasen je Call", () => {
  const phasen = (calls: CallSpec[]) => K.phaseDerCalls(lauf("#1 x", calls).zeilen);
  test("Umsetzung, verify, Review, Lens-Fix, PR, CI-Warten, Merge/Cleanup", () => {
    const p = phasen([
      { min: 1, tools: [edit()] }, // Umsetzung
      { min: 2, tools: [bash("npm run verify:kompakt")] }, // verify
      { min: 3, tools: [linse] }, // Review
      { min: 4 }, // Review (kein Tool, erbt)
      { min: 5, tools: [edit()] }, // Lens-Fix
      { min: 6, tools: [bash("gh pr create --title x")] }, // Merge/Cleanup (kein Edit)
      { min: 7, tools: [bash("node scripts/pr-warten.mjs 5")] }, // CI-Warten
      { min: 8, tools: [bash("git worktree remove x")] }, // Merge/Cleanup
    ]);
    expect(p).toEqual(["Umsetzung", "verify", "Review", "Review", "Lens-Fix", "Merge/Cleanup", "CI-Warten", "Merge/Cleanup"]);
  });
  test("Negativ: Edit vor dem ersten Lens-Spawn ist kein Lens-Fix, vitest nach dem PR ist verify", () => {
    const p = phasen([{ min: 1, tools: [edit()] }, { min: 2, tools: [bash("gh pr create")] }, { min: 3, tools: [bash("npx vitest run test/a.test.ts")] }, { min: 4, tools: [edit()] }]);
    expect(p[0]).toBe("Umsetzung");
    expect(p[2]).toBe("verify");
    expect(p[3]).toBe("CI-Fix");
  });
  test("Pflege zwischen den Markern, danach zurück", () => {
    const p = phasen([
      { min: 1, tools: [bash('echo "pflege: start #1"')] },
      { min: 2, tools: [edit("docs/a.md")] },
      { min: 3, tools: [bash('echo "pflege: ende #1"')] },
      { min: 4, tools: [edit()] },
    ]);
    expect(p).toEqual(["Pflege", "Pflege", "Umsetzung", "Umsetzung"]);
  });
  test("CI-Warten erkennt gh pr checks, gh run watch und until-Schleife mit gh pr view", () => {
    const p = phasen([
      { min: 1, tools: [bash("timeout 590 gh pr checks 5 --watch")] },
      { min: 2, tools: [bash("gh run watch 123")] },
      { min: 3, tools: [bash("until [ x ]; do gh pr view 5 --json state; sleep 30; done")] },
      { min: 4, tools: [bash("gh pr view 5 --json state")] },
    ]);
    expect(p.slice(0, 3)).toEqual(["CI-Warten", "CI-Warten", "CI-Warten"]);
    expect(p[3]).not.toBe("CI-Warten");
  });
  test("Vorrang: ein Befehl mit CI-Warten und verify zählt als CI-Warten", () => {
    expect(phasen([{ min: 1, tools: [bash("gh pr checks 5 --watch && npx vitest run")] }])).toEqual(["CI-Warten"]);
  });
});

describe("analysiereLauf", () => {
  test("Last = Tokens × Zahl späterer Calls, letztes Ergebnis Last 0, fehlendes Ergebnis 0 Tokens", () => {
    const a = K.analysiereLauf(
      lauf("#7 x", [
        { min: 1, tools: [{ name: "Read", input: { file_path: "src/a.ts" }, result: "x".repeat(400) }] },
        { min: 2 },
        { min: 3 },
        { min: 4, tools: [{ name: "Read", input: { file_path: "src/b.ts" }, result: "y".repeat(800) }] },
        { min: 5, tools: [{ name: "Read", input: { file_path: "src/c.ts" }, result: null }] },
      ]),
    )!;
    const a1 = a.ergebnisse.find((e) => e.label.includes("src/a.ts"))!;
    const b1 = a.ergebnisse.find((e) => e.label.includes("src/b.ts"))!;
    const c1 = a.ergebnisse.find((e) => e.label.includes("src/c.ts"))!;
    expect(a1).toMatchObject({ tokens: 100, last: 400 });
    expect(b1).toMatchObject({ tokens: 200, last: 200 });
    expect(c1).toMatchObject({ tokens: 0, last: 0 });
    expect(a.ticket).toBe(7);
  });
  test("doppelte Zeilen derselben Message-ID zählen einmal, Zeile ohne Usage entfällt", () => {
    const l = lauf("#1 x", [{ min: 1, tools: [bash("ls"), bash("pwd")] }, { min: 2 }]);
    l.zeilen.push({ type: "assistant", timestamp: t(3), message: { id: "ohne", content: [{ type: "text", text: "hi" }] } });
    expect(K.analysiereLauf(l)!.requests).toBe(2);
  });
  test("leerer Lauf (keine Calls) → null, Call ohne Preis → Kosten null", () => {
    expect(K.analysiereLauf({ meta: { agentType: UMSETZER }, zeilen: [user(0, "#1 x")] })).toBeNull();
    const l = lauf("#1 x", [{ min: 1 }]);
    (l.zeilen[1] as { message: { model: string } }).message.model = "unbekanntes-modell";
    expect(K.analysiereLauf(l)!.kosten).toBeNull();
  });
  test("Neuaufbau: Pause über 5 min mit niedrigem Cache-Read zählt mit Ursache, hoher Read und kurze Pause nicht", () => {
    const a = K.analysiereLauf(
      lauf("#1 x", [
        { min: 1, tools: [bash("timeout 590 gh pr checks 5 --watch")] },
        { min: 12, ctx: 200_000, cacheRead: 10_000 }, // Pause 11 min, Prefix neu geschrieben
        { min: 13, tools: [bash("npm run verify:kompakt")] },
        { min: 25, ctx: 200_000, cacheRead: 190_000 }, // Pause lang, aber Cache gelesen
        { min: 26, tools: [bash("ls")] },
        { min: 28, ctx: 200_000, cacheRead: 10_000 }, // Pause 2 min
      ]),
    )!;
    expect(a.neuaufbauten).toHaveLength(1);
    expect(a.neuaufbauten[0]).toMatchObject({ ursache: "CI-Warten", tokens: 190_000 });
    expect(a.neuaufbauten[0].mehrkosten).toBeCloseTo((190_000 * (2.5 - 0.1)) / 1e6, 6);
  });
  test("Neuaufbau nach Lens-Spawn heißt Lens-Warten", () => {
    const a = K.analysiereLauf(lauf("#1 x", [{ min: 1, tools: [linse] }, { min: 9, ctx: 100_000, cacheRead: 1000 }]))!;
    expect(a.neuaufbauten[0].ursache).toBe("Lens-Warten");
  });
  test("Wachstum wird auf Ergebnis, eigene Eingabe und Rest verteilt", () => {
    const a = K.analysiereLauf(
      lauf("#1 x", [
        { min: 1, ctx: 1000, tools: [{ name: "Read", input: { file_path: "a" }, result: "x".repeat(400) }] },
        { min: 2, ctx: 1000 + 100 + 50 + 7 },
      ]),
    )!;
    expect(a.wachstum.ergebnis).toBe(100);
    expect(a.wachstum.eingabe).toBeGreaterThan(0);
    expect(a.wachstum.ergebnis + a.wachstum.eingabe + a.wachstum.rest).toBe(157);
  });
});

describe("kontextTreiber (Aggregat)", () => {
  const kurz = lauf("#1 x", [{ min: 1, ctx: 100_000 }, { min: 2, ctx: 100_000 }]);
  const lang = lauf("#2 y", [1, 2, 3, 4, 5, 6].map((m) => ({ min: m, ctx: 200_000 })));
  test("Ø Kontext ist call-gewichtet, nicht das Mittel der Lauf-Mittel", () => {
    const r = K.kontextTreiber({ laeufe: [kurz, lang] });
    expect(r.gesamt.gesamt!.kontextCallGewichtet).toBe((2 * 100_000 + 6 * 200_000) / 8);
    expect(r.gesamt.gesamt!.kontextMedianLaeufe).toBe(150_000);
  });
  test("Sammeltickets getrennt, fremder Agent und Ticket-Filter greifen, leere Gruppe → null", () => {
    const sammel = lauf("#9 Harness-Härtung (gesammelt)", [{ min: 1 }, { min: 2 }]);
    const planer = lauf("#3 z", [{ min: 1 }], PLANER);
    const r = K.kontextTreiber({ laeufe: [kurz, sammel, planer] });
    expect(r.ohneSammel.gesamt!.n).toBe(1);
    expect(r.sammel.gesamt!.n).toBe(1);
    expect(r.gesamt.gesamt!.n).toBe(2);
    expect(K.kontextTreiber({ laeufe: [kurz, sammel], tickets: [1] }).gesamt.gesamt!.n).toBe(1);
    expect(K.kontextTreiber({ laeufe: [kurz] }).sammel.gesamt).toBeNull();
  });
  test("wurzel: der Repo-Pfad im Top-Label wird maskiert (öffentliches Repo), ohne wurzel bleibt er unverändert", () => {
    const l = lauf("#1 x", [{ min: 1, tools: [{ name: "Read", input: { file_path: "C:/work/projekt/docs/a.md" }, result: "x".repeat(400) }] }, { min: 2 }, { min: 3 }]);
    const labels = (wurzel?: string) => K.kontextTreiber({ laeufe: [l], wurzel }).gesamt.top.map((x) => x.label);
    expect(labels("C:/work/projekt").some((x) => x.includes("<repo>/docs/a.md"))).toBe(true);
    expect(labels("C:/work/projekt").some((x) => x.includes("C:/work/projekt"))).toBe(false);
    expect(labels().some((x) => x.includes("C:/work/projekt/docs/a.md"))).toBe(true);
  });
  test("Top-10: genau 10 bei 12 Ergebnissen, absteigend nach Last", () => {
    const calls: CallSpec[] = Array.from({ length: 12 }, (_, i) => ({ min: i + 1, tools: [{ name: "Read", input: { file_path: `f${i}` }, result: "x".repeat(400 * (i + 1)) }] }));
    calls.push({ min: 20 }, { min: 21 });
    const r = K.kontextTreiber({ laeufe: [lauf("#1 x", calls)] });
    expect(r.gesamt.top).toHaveLength(10);
    const lasten = r.gesamt.top.map((x) => x.last);
    expect(lasten).toEqual([...lasten].sort((a, b) => b - a));
    expect(r.gesamt.top.some((x) => x.label.includes("f0"))).toBe(false);
  });
  test("Phasen und Markdown enthalten die Ausweise", () => {
    const r = K.kontextTreiber({ laeufe: [lauf("#1 x", [{ min: 1, tools: [bash("npm run verify:kompakt")] }, { min: 2 }])] });
    expect(r.gesamt.phasen["verify"].calls).toBe(1);
    const md = K.renderMarkdown(r);
    expect(md).toContain("Top-10");
    expect(md).toContain("Neuaufbau");
    expect(md).toContain("verify");
  });
  test("Standardauswertung nennt die Ticket-Zahl und warnt bei Tickets mit mehreren Läufen (#1646)", () => {
    const zwei = K.renderMarkdown(K.kontextTreiber({ laeufe: [lauf("#1 x", [{ min: 1 }, { min: 2 }]), lauf("#1 y", [{ min: 1 }, { min: 2 }]), lauf("#2 z", [{ min: 1 }, { min: 2 }])] }));
    expect(zwei).toContain("n=3, Tickets 2,");
    expect(zwei).toContain("Mediane je Lauf, nicht je Ticket (1 Tickets mit mehreren Läufen); Ticket-Schnitt: kontext-treiber --je-ticket");
    const je1 = K.renderMarkdown(K.kontextTreiber({ laeufe: [lauf("#1 x", [{ min: 1 }, { min: 2 }]), lauf("#2 z", [{ min: 1 }, { min: 2 }])] }));
    expect(je1).toContain("n=2, Tickets 2,");
    expect(je1).not.toContain("Mediane je Lauf");
  });
});

const verschiebe = (l: Lauf, minuten: number): Lauf => ({
  ...l,
  zeilen: l.zeilen.map((z) => ({ ...z, timestamp: new Date(Date.parse(z.timestamp as string) + minuten * 60_000).toISOString() })),
});
type Fenster = { laeufe: Lauf[]; von?: string; bis?: string; tickets?: number[]; ohne?: number[] };
const fenster = (e: Fenster) => (K as unknown as { kontextTreiber: (e: Fenster) => { gesamt: { gesamt: { n: number; ohnePreis: number; kostenMedian: number | null; kostenRead: number; kostenWrite: number; kostenOutput: number } | null } } }).kontextTreiber(e).gesamt.gesamt;

describe("Fenster und Filter", () => {
  const a = lauf("#1 a", [{ min: 1 }]); // Start t(0)
  const b = verschiebe(lauf("#2 b", [{ min: 1 }]), 100);
  const c = verschiebe(lauf("#3 c", [{ min: 1 }]), 200);
  test("von und bis grenzen den Start ein, die Grenze selbst zählt mit", () => {
    expect(fenster({ laeufe: [a, b, c], von: t(100), bis: t(100) })!.n).toBe(1);
    expect(fenster({ laeufe: [a, b, c], von: t(50) })!.n).toBe(2);
    expect(fenster({ laeufe: [a, b, c], bis: t(150) })!.n).toBe(2);
    expect(fenster({ laeufe: [a, b, c], von: t(300) })).toBeNull();
  });
  test("ohne schließt Tickets aus, tickets wählt aus", () => {
    expect(fenster({ laeufe: [a, b, c], ohne: [2] })!.n).toBe(2);
    expect(fenster({ laeufe: [a, b, c], tickets: [3], ohne: [3] })).toBeNull();
  });
  test("Kosten: Teile summieren, Lauf ohne Preis zählt nur in ohnePreis", () => {
    const ohnePreis = lauf("#4 d", [{ min: 1 }]);
    (ohnePreis.zeilen[1] as { message: { model: string } }).message.model = "unbekannt";
    const g = fenster({ laeufe: [a, ohnePreis] })!;
    expect(g.ohnePreis).toBe(1);
    expect(g.kostenMedian).toBeGreaterThan(0);
    expect(g.kostenRead).toBeGreaterThan(0);
    expect(g.kostenWrite).toBeGreaterThanOrEqual(0);
    expect(g.kostenOutput).toBeGreaterThan(0);
  });
});

describe("Zerlegung und Ursachen, Grenzfälle", () => {
  test("Zuwachs kleiner als das Tool-Ergebnis: Ergebnis = Zuwachs, Rest 0; schrumpfender Kontext trägt nichts bei", () => {
    const klein = K.analysiereLauf(lauf("#1 x", [{ min: 1, ctx: 1000, tools: [{ name: "Read", input: { file_path: "a" }, result: "x".repeat(4000) }] }, { min: 2, ctx: 1300 }]))!;
    expect(klein.wachstum).toEqual({ ergebnis: 300, eingabe: 0, rest: 0 });
    const schrumpf = K.analysiereLauf(lauf("#1 x", [{ min: 1, ctx: 5000, tools: [{ name: "Read", input: {}, result: "x".repeat(400) }] }, { min: 2, ctx: 2000 }]))!;
    expect(schrumpf.wachstum).toEqual({ ergebnis: 0, eingabe: 0, rest: 0 });
  });
  test("Neuaufbau nach einem Call ohne Tool im Review heißt Lens-Warten, in der Umsetzung sonstiges, nach verify verify", () => {
    const review = K.analysiereLauf(lauf("#1 x", [{ min: 1, tools: [linse] }, { min: 2 }, { min: 12, ctx: 100_000, cacheRead: 1000 }]))!;
    expect(review.neuaufbauten[0].ursache).toBe("Lens-Warten");
    const umsetzung = K.analysiereLauf(lauf("#1 x", [{ min: 1 }, { min: 12, ctx: 100_000, cacheRead: 1000 }]))!;
    expect(umsetzung.neuaufbauten[0].ursache).toBe("sonstiges");
    const verify = K.analysiereLauf(lauf("#1 x", [{ min: 1, tools: [bash("npm run verify:kompakt")] }, { min: 12, ctx: 100_000, cacheRead: 1000 }]))!;
    expect(verify.neuaufbauten[0].ursache).toBe("verify");
  });
  test("ein Call ohne Tool nach einer CI-Fix-Änderung bleibt CI-Fix", () => {
    const p = K.phaseDerCalls(lauf("#1 x", [{ min: 1, tools: [bash("gh pr create")] }, { min: 2, tools: [edit()] }, { min: 3 }]).zeilen);
    expect(p).toEqual(["Merge/Cleanup", "CI-Fix", "CI-Fix"]);
  });
  test("gh run view ist kein CI-Warten (Log lesen gehört zum Fix)", () => {
    expect(K.phaseDerCalls(lauf("#1 x", [{ min: 1, tools: [bash("gh run view 5 --log-failed | tail -n 80")] }]).zeilen)).not.toContain("CI-Warten");
  });
});

describe("Lens-Fix, Repo-Wurzel, Kostenteile (Grenzfälle R2)", () => {
  test("Neuaufbau nach einem Call ohne Tool im Zustand Lens-Fix heißt Lens-Warten", () => {
    const a = K.analysiereLauf(lauf("#1 x", [{ min: 1, tools: [linse] }, { min: 2, tools: [edit()] }, { min: 3 }, { min: 13, ctx: 100_000, cacheRead: 1000 }]))!;
    expect(a.phasen.slice(1, 3)).toEqual(["Lens-Fix", "Lens-Fix"]);
    expect(a.neuaufbauten[0].ursache).toBe("Lens-Warten");
  });
  test("Kostenteile: Write > 0 bei geschriebenem Cache, Read + Write + Output ergeben die Summe", () => {
    const g = (K as unknown as { kontextTreiber: (e: { laeufe: Lauf[] }) => { gesamt: { gesamt: { kostenSumme: number; kostenRead: number; kostenWrite: number; kostenOutput: number } } } })
      .kontextTreiber({ laeufe: [lauf("#1 x", [{ min: 1, ctx: 10_000, cacheRead: 4000 }, { min: 2, ctx: 12_000, cacheRead: 12_000 }])] }).gesamt.gesamt;
    expect(g.kostenWrite).toBeGreaterThan(0);
    expect(g.kostenRead).toBeGreaterThan(0);
    expect(g.kostenRead + g.kostenWrite + g.kostenOutput).toBeCloseTo(g.kostenSumme, 9);
    expect(g.kostenWrite).toBeCloseTo((6000 * 2.5) / 1e6, 9);
  });
});

describe("Filter --delta und --brille (#1582)", () => {
  type Filter = { laeufe: Lauf[]; agent?: string; delta?: boolean | null; brille?: string | null };
  const kt = (e: Filter) => (K as unknown as { kontextTreiber: (e: Filter) => { gesamt: { gesamt: { n: number } | null } } }).kontextTreiber(e).gesamt.gesamt?.n ?? 0;
  const PA = (K as unknown as { parseArgs: (a: string[]) => { delta?: boolean; brille?: string; fehler?: string } }).parseArgs;
  const lens = (beschreibung: string, prompt: string): Lauf => {
    const l = lauf(prompt, [{ min: 1 }, { min: 2 }], LENS);
    (l.meta as Record<string, unknown>).description = beschreibung;
    return l;
  };
  const r1 = lens("Lens Architektur R1", `Patch: /t/${WT}1-r1.patch`);
  const r2 = lens("Lens Test-Adäquanz R2", `Patch: /t/${WT}1-r1.patch Delta-Patch: /t/${WT}1-r2-delta.patch`);
  const alle = [r1, r2];
  test("ohne Filter zählen alle Läufe (Regression)", () => {
    expect(kt({ laeufe: alle, agent: LENS })).toBe(2);
  });
  test("delta true nur mit Delta-Patch, delta false nur ohne", () => {
    expect(kt({ laeufe: alle, agent: LENS, delta: true })).toBe(1);
    expect(kt({ laeufe: alle, agent: LENS, delta: false })).toBe(1);
  });
  test("brille filtert auf den Namen, ein unbekannter Name liefert keine Läufe", () => {
    expect(kt({ laeufe: alle, agent: LENS, brille: "Architektur" })).toBe(1);
    expect(kt({ laeufe: alle, agent: LENS, brille: "Test-Adäquanz", delta: true })).toBe(1);
    expect(kt({ laeufe: alle, agent: LENS, brille: "Architektur", delta: true })).toBe(0);
    expect(kt({ laeufe: alle, agent: LENS, brille: "Gibtsnicht" })).toBe(0);
  });
  test("parseArgs: --delta ja|nein und --brille; ein anderer Wert ist ein Fehler", () => {
    expect(PA(["--delta", "ja", "--brille", "Doku"])).toMatchObject({ delta: true, brille: "Doku" });
    expect(PA(["--delta", "nein"]).delta).toBe(false);
    expect(PA(["--delta", "vielleicht"]).fehler).toMatch(/ja\|nein/);
    expect(PA([]).delta).toBeUndefined();
  });
  test("parseArgs: --ticket/--ohne nehmen nur Ganzzahlen, sonst Aufruf-Fehler statt stillem NaN-Filter", () => {
    const P = (a: string[]) => (K as unknown as { parseArgs: (a: string[]) => { tickets: number[]; ohne: number[]; fehler?: string } }).parseArgs(a);
    expect(P(["--ticket", "7", "--ohne", "8"])).toMatchObject({ tickets: [7], ohne: [8] });
    expect(P(["--ticket", "7"]).fehler).toBeUndefined();
    expect(P(["--ticket", "abc"]).fehler).toMatch(/Ticketnummer/);
    expect(P(["--ohne", ""]).fehler).toMatch(/Ticketnummer/);
    expect(P(["--ohne"]).fehler).toMatch(/Ticketnummer/);
  });
});

describe("--delta ja zählt Merge-Delta-Läufe (#1582)", () => {
  test("ein Lauf mit Delta-Patch-Pfad und Merge-Beschreibung bleibt bei delta true", () => {
    const l = lauf(`Patch: /t/${WT}1-r1.patch Delta-Patch: /t/${WT}1-r2-delta.patch Konflikt-Auflösung`, [{ min: 1 }, { min: 2 }], LENS);
    (l.meta as Record<string, unknown>).description = "Lens Doku Merge-Auflösung";
    const n = (delta: boolean) => (K as unknown as { kontextTreiber: (e: { laeufe: Lauf[]; agent: string; delta: boolean }) => { gesamt: { gesamt: { n: number } | null } } }).kontextTreiber({ laeufe: [l], agent: LENS, delta }).gesamt.gesamt?.n ?? 0;
    expect(n(true)).toBe(1);
    expect(n(false)).toBe(0);
  });
});

describe("Wartepausen über 240 s (#1588)", () => {
  const sek = (x: number) => x / 60;
  const pausen = (calls: CallSpec[]) => K.analysiereLauf(lauf("#1 x", calls))?.pausen ?? [];
  test("241 s nach einem Lens-Spawn: Lens-Warten, 1 Tick", () => {
    expect(pausen([{ min: 1, tools: [linse] }, { min: 1 + sek(241) }])).toEqual([{ ursache: "Lens-Warten", sekunden: 241, ticks: 1 }]);
  });
  test("600 s ergeben 2 Ticks (abgerundet)", () => {
    expect(pausen([{ min: 1, tools: [linse] }, { min: 11 }])[0]).toMatchObject({ sekunden: 600, ticks: 2 });
  });
  test("280 s bei vollem Cache-Read ist eine Pause, aber kein Neuaufbau", () => {
    const a = K.analysiereLauf(lauf("#1 x", [{ min: 1, tools: [linse] }, { min: 1 + sek(280) }]));
    expect(a?.pausen).toHaveLength(1);
    expect(a?.neuaufbauten).toHaveLength(0);
  });
  test("Ursache nach verify und nach pr-warten", () => {
    expect(pausen([{ min: 1, tools: [bash("npm run verify:kompakt")] }, { min: 7 }])[0].ursache).toBe("verify");
    expect(pausen([{ min: 1, tools: [bash("node scripts/pr-warten.mjs 5")] }, { min: 7 }])[0].ursache).toBe("CI-Warten");
  });
  test("genau 240 s und 239 s zählen nicht (strikt größer)", () => {
    expect(pausen([{ min: 1, tools: [linse] }, { min: 5 }])).toEqual([]);
    expect(pausen([{ min: 1, tools: [linse] }, { min: 1 + sek(239) }])).toEqual([]);
  });
  test("ein einzelner Call hat keine Pausen; fehlender Zeitstempel ergibt keine Pause", () => {
    expect(pausen([{ min: 1 }])).toEqual([]);
    const l = lauf("#1 x", [{ min: 1, tools: [linse] }, { min: 20 }]);
    for (const z of l.zeilen) if (z.type === "assistant" && z.timestamp === t(20)) delete z.timestamp;
    expect(() => K.analysiereLauf(l)).not.toThrow();
    expect(K.analysiereLauf(l)?.pausen).toEqual([]);
  });
  test("Phasen-Erkennung ohne Ticket-Namen bricht mit lesbarer Meldung ab", () => {
    const { zeilen } = lauf("#1 x", [{ min: 1 }]);
    expect(() => kontextModul.phaseDerCalls(zeilen, null, {})).toThrow(/Phasen-Erkennung braucht die Ticket-Namen/);
    expect(() => kontextModul.phaseDerCalls(zeilen, null, undefined)).toThrow(/Phasen-Erkennung braucht die Ticket-Namen/);
  });
  test("Aggregat trennt die Ursachen in eigene Buckets, leere Gruppe hat pausen {}", () => {
    const calls: CallSpec[] = [{ min: 1, tools: [linse] }, { min: 11, tools: [bash("node scripts/pr-warten.mjs 5")] }, { min: 16 }];
    const r = K.kontextTreiber({ laeufe: [lauf("#1 x", calls)] });
    expect(r.gesamt.pausen).toEqual({ "Lens-Warten": { n: 1, ticks: 2 }, "CI-Warten": { n: 1, ticks: 1 } });
    expect(r.sammel.pausen).toEqual({});
  });
  test("Aggregat über zwei Läufe, Trennung Sammel/ohne Sammel, Markdown-Zeile", () => {
    const calls: CallSpec[] = [{ min: 1, tools: [linse] }, { min: 11 }];
    const r = K.kontextTreiber({ laeufe: [lauf("#1 x", calls), lauf("#2 Harness-Härtung (gesammelt)", calls)] });
    expect(r.gesamt.pausen["Lens-Warten"]).toEqual({ n: 2, ticks: 4 });
    expect(r.ohneSammel.pausen["Lens-Warten"]).toEqual({ n: 1, ticks: 2 });
    expect(r.sammel.pausen["Lens-Warten"]).toEqual({ n: 1, ticks: 2 });
    expect(K.renderMarkdown(r)).toContain("| Lens-Warten | 2 | 4 |");
  });
});

// ── Phasen-Schnitt: Übergabe, je Ticket (#1592) ──────────────────────────────

type Je = {
  gesamt: { n: number; requests: number; ersterKontextMedian: number | null; kostenSumme: number } | null;
  nachfolger?: { n: number; ersterKontextMedian: number | null };
  nachlese?: { summe: number; median: number | null };
  kostenAb?: Record<string, { median: number | null; summe: number }>;
};
type JeBericht = { agent: string; jeTicket: true; gesamt: Je; ohneSammel: Je; sammel: Je; schnitt: { verify: Je; pr: Je; ohne: Je }; ohneTicket: number; ohneVorgaenger: number };
type JeEingabe = { laeufe: Lauf[]; von?: string; bis?: string; ohne?: number[]; jeTicket: boolean };
const je = (e: JeEingabe) => (K as unknown as { kontextTreiber: (e: JeEingabe) => JeBericht }).kontextTreiber(e);
const KI = K as unknown as {
  parseArgs: (a: string[]) => { jeTicket?: boolean };
  analysiereLauf: (l: Lauf) => (Analyse & { schnitt: string | null; einstieg: string | null; geaendertePfade: string[]; leseAufrufe: { art: string; pfad?: string; befehl?: string }[] }) | null;
};
/** Lauf, der `ab` Minuten später beginnt (der Prompt-Zeitstempel ist der Start des Laufs). */
const laufAb = (ab: number, prompt: string, calls: CallSpec[]): Lauf => ({
  meta: { agentType: UMSETZER },
  zeilen: [user(ab, prompt), ...calls.map((c) => ({ ...c, min: c.min + ab })).flatMap(schritt)],
});
const NL = String.fromCharCode(10);
const vorgaenger = (nr: number, schnitt: string | null, ab: number, calls: CallSpec[]) => laufAb(ab, [`Ticket #${nr}: x`, ...(schnitt ? [`Schnitt: ${schnitt}`] : []), "Lock: nonce=abc"].join(NL), calls);
const nachfolger = (nr: number, einstieg: string, ab: number, calls: CallSpec[]) =>
  laufAb(ab, [`Ticket #${nr}: x`, "Lock: nonce=abc", `Einstieg: ${einstieg}`, "--- Übergabe ---", `SCHNITT: ${einstieg}`, "UEBERGABE:"].join(NL), calls);

describe("parseArgs und Prompt-Zeilen (#1592)", () => {
  test("--je-ticket schaltet um, ohne den Schalter bleibt es aus", () => {
    expect(KI.parseArgs(["--von", "x", "--je-ticket"]).jeTicket).toBe(true);
    expect(KI.parseArgs(["--von", "x"]).jeTicket).toBeFalsy();
  });
  test("Schnitt: und Einstieg: nur als ganze Zeile mit pr|verify; Prosa, SCHNITT:-Großschrift und unbekannte Werte sind null", () => {
    const a = (prompt: string) => KI.analysiereLauf(lauf(prompt, [{ min: 1 }]))!;
    expect(a(`#1 x${NL}Schnitt: verify`)).toMatchObject({ schnitt: "verify", einstieg: null });
    expect(a(`#1 x${NL}Einstieg: pr  `)).toMatchObject({ schnitt: null, einstieg: "pr" });
    expect(a("#1 x: `Schnitt: verify` steht mitten im Satz").schnitt).toBeNull();
    expect(a("#1 x, danach Schnitt: verify").schnitt).toBeNull();
    expect(a(`#1 x${NL}SCHNITT: verify${NL}UEBERGABE:`).schnitt).toBeNull();
    expect(a(`#1 x${NL}Schnitt: review`).schnitt).toBeNull();
    expect(a(`#1 x${NL}Einstieg: verify ab Stufe 0`).einstieg).toBeNull();
  });
});

describe("Phasen beim Einstieg (#1592)", () => {
  const phasen = (einstieg: string, calls: CallSpec[]) => KI.analysiereLauf(nachfolger(1, einstieg, 0, calls))!.phasen;
  test("Einstieg pr: Calls ohne Tool sind Merge/Cleanup, Edit ist CI-Fix", () => {
    expect(phasen("pr", [{ min: 1 }, { min: 2, tools: [edit()] }, { min: 3, tools: [bash("node scripts/pr-warten.mjs 5")] }])).toEqual(["Merge/Cleanup", "CI-Fix", "CI-Warten"]);
  });
  test("Einstieg verify: Calls ohne Tool sind verify, nach dem Lens-Spawn Review, ohne Einstieg bleibt es Umsetzung", () => {
    expect(phasen("verify", [{ min: 1 }, { min: 2, tools: [linse] }, { min: 3 }])).toEqual(["verify", "Review", "Review"]);
    expect(KI.analysiereLauf(lauf("#1 x", [{ min: 1 }]))!.phasen).toEqual(["Umsetzung"]);
  });
});

describe("je Ticket (#1592)", () => {
  test("zwei Läufe eines Tickets sind ein Lauf: Summen, erster Kontext vom Vorgänger, Nachfolger gezählt", () => {
    const v = vorgaenger(5, "verify", 0, [{ min: 1, ctx: 10_000 }, { min: 2, ctx: 20_000 }, { min: 3, ctx: 30_000 }]);
    const n = nachfolger(5, "verify", 10, [{ min: 1, ctx: 15_000 }, { min: 2, ctx: 25_000 }]);
    const r = je({ laeufe: [n, v], jeTicket: true });
    expect(r.gesamt.gesamt).toMatchObject({ n: 1, requests: 5 });
    const einzeln = [v, n].map((l) => KI.analysiereLauf(l)!.kosten!);
    expect(r.gesamt.gesamt!.kostenSumme).toBeCloseTo(einzeln[0] + einzeln[1], 10);
    expect(r.gesamt.nachfolger).toMatchObject({ n: 1, ersterKontextMedian: 15_000 });
    expect(r.schnitt.verify.gesamt!.n).toBe(1);
    expect(r.schnitt.pr.gesamt).toBeNull();
    expect(r.schnitt.ohne.gesamt).toBeNull();
  });
  test("Gruppen nach dem Schnitt des Vorgängers: verify, pr, ohne; ein Schnitt ohne Nachfolger hat nachfolger.n = 0", () => {
    const r = je({
      laeufe: [
        vorgaenger(5, "verify", 0, [{ min: 1 }]),
        nachfolger(5, "verify", 10, [{ min: 1 }]),
        vorgaenger(6, "pr", 20, [{ min: 1 }]), // kein Nachfolger
        vorgaenger(7, null, 30, [{ min: 1 }]),
      ],
      jeTicket: true,
    });
    expect(r.schnitt.verify.gesamt!.n).toBe(1);
    expect(r.schnitt.pr.gesamt!.n).toBe(1);
    expect(r.schnitt.ohne.gesamt!.n).toBe(1);
    expect(r.schnitt.pr.nachfolger!.n).toBe(0);
    expect(r.schnitt.verify.nachfolger!.n).toBe(1);
    expect(r.gesamt.gesamt!.n).toBe(3);
  });
  test("Fenster gilt für den ersten Start des Tickets; Läufe ohne Ticket zählen nur in ohneTicket; Nachfolger ohne Vorgänger fällt heraus", () => {
    const laeufe = [
      vorgaenger(5, "pr", 0, [{ min: 1 }]),
      nachfolger(5, "pr", 100, [{ min: 1 }]),
      vorgaenger(6, "pr", 200, [{ min: 1 }]),
      laufAb(250, "kein Ticket hier", [{ min: 1 }]),
      nachfolger(8, "pr", 300, [{ min: 1 }]),
    ];
    const alle = je({ laeufe, jeTicket: true });
    expect(alle.gesamt.gesamt!.n).toBe(2);
    expect(alle.ohneTicket).toBe(1);
    expect(alle.ohneVorgaenger).toBe(1);
    const spaet = je({ laeufe, von: t(50), jeTicket: true });
    expect(spaet.gesamt.gesamt!.n).toBe(1);
    expect(spaet.ohneVorgaenger).toBe(1); // nur Ticket 8: der Nachfolger von Ticket 5 fällt mit seinem Vorgänger vor dem Fenster ganz heraus
    expect(je({ laeufe, ohne: [6], jeTicket: true }).gesamt.gesamt!.n).toBe(1);
  });
  test("ohne den Schalter ist der Bericht der alte: je Lauf, ohne jeTicket-Felder", () => {
    const laeufe = [vorgaenger(5, "verify", 0, [{ min: 1 }]), nachfolger(5, "verify", 10, [{ min: 1 }])];
    const r = je({ laeufe, jeTicket: false }) as unknown as { gesamt: Je; jeTicket?: boolean; schnitt?: unknown };
    expect(r.gesamt.gesamt!.n).toBe(2);
    expect(r.jeTicket).toBeUndefined();
    expect(r.schnitt).toBeUndefined();
  });
});

describe("Nachlese-Calls und Kosten ab Phase (#1592)", () => {
  const nachlese = (geaendert: Tool[], gelesen: Tool[]) => {
    const v = vorgaenger(5, "verify", 0, [{ min: 1, tools: geaendert }]);
    const n = nachfolger(5, "verify", 10, [{ min: 1, tools: gelesen }]);
    return je({ laeufe: [v, n], jeTicket: true }).gesamt.nachlese!.summe;
  };
  const lies = (file: string): Tool => ({ name: "Read", input: { file_path: file } });
  test("Read mit absolutem Worktree-Pfad (Backslash) und Shell-Befehle cat/sed/head auf geänderte Pfade zählen", () => {
    expect(nachlese([edit("scripts/a.mjs")], [lies(`C:\\dev\\repo\\.claude\\worktrees\\${WT}5-x\\scripts\\a.mjs`)])).toBe(1);
    expect(nachlese([edit("scripts/a.mjs")], [bash("sed -n '1,9p' scripts/a.mjs")])).toBe(1);
    expect(nachlese([edit("scripts/a.mjs")], [bash("head -n 5 scripts/a.mjs")])).toBe(1);
    expect(nachlese([edit("scripts/a.mjs")], [bash(`cat C:/dev/repo/.claude/worktrees/${WT}5-x/scripts/a.mjs`)])).toBe(1);
    expect(nachlese([edit("scripts/a.mjs")], [lies("scripts/a.mjs"), bash("cat scripts/a.mjs"), lies("src/b.ts")])).toBe(2);
    // geänderter Pfad absolut (Worktree, Backslash), gelesen relativ: der Worktree-Präfix fällt weg
    expect(nachlese([edit(`C:\\dev\\repo\\.claude\\worktrees\\${WT}5-x\\scripts\\a.mjs`)], [lies("scripts/a.mjs")])).toBe(1);
  });
  test("Negativ: ungeänderte Datei, grep, ähnlicher Name und Lesen durch den Vorgänger zählen nicht", () => {
    expect(nachlese([edit("scripts/a.mjs")], [bash("cat scripts/b.mjs")])).toBe(0);
    expect(nachlese([edit("scripts/a.mjs")], [bash("grep -n x scripts/a.mjs")])).toBe(0);
    expect(nachlese([edit("scripts/a.mjs")], [bash("cat scripts/a.mjsx")])).toBe(0);
    expect(nachlese([edit("scripts/a.mjs")], [bash("cat myscripts/a.mjs")])).toBe(0);
    expect(nachlese([edit("scripts/a.mjs")], [lies("xscripts/a.mjs")])).toBe(0);
    expect(nachlese([lies("scripts/a.mjs")], [lies("scripts/a.mjs")])).toBe(0);
  });
  test("Median über Tickets mit Nachfolger; ein Ticket ohne Nachfolger geht nicht in die Nachlese ein", () => {
    const r = je({
      laeufe: [
        vorgaenger(5, "pr", 0, [{ min: 1, tools: [edit("a.ts")] }]),
        nachfolger(5, "pr", 10, [{ min: 1, tools: [lies("a.ts"), lies("a.ts")] }]),
        vorgaenger(6, "pr", 20, [{ min: 1, tools: [edit("a.ts")] }]),
        nachfolger(6, "pr", 30, [{ min: 1, tools: [lies("a.ts")] }]),
        vorgaenger(7, "pr", 40, [{ min: 1, tools: [edit("a.ts")] }]),
      ],
      jeTicket: true,
    });
    expect(r.gesamt.nachlese).toEqual({ summe: 3, median: 1.5 });
  });
  test("kostenAb: Tail-Summe der Phasen ab X in Phasen-Reihenfolge, Median und Σ je Ticket", () => {
    const v = vorgaenger(5, "verify", 0, [{ min: 1, tools: [edit()] }, { min: 2, tools: [bash("npm run verify:kompakt")] }, { min: 3, tools: [linse] }]);
    const n = nachfolger(5, "verify", 10, [{ min: 1, tools: [bash("gh pr create --title x")] }, { min: 2, tools: [bash("node scripts/pr-warten.mjs 5")] }, { min: 3, tools: [bash("git worktree remove x")] }]);
    const c = KI.analysiereLauf(lauf("#1 x", [{ min: 1 }]))!.kosten!;
    const ab = je({ laeufe: [v, n], jeTicket: true }).gesamt.kostenAb!;
    // Phasen der sechs Calls: Umsetzung, verify, Review | Merge/Cleanup, CI-Warten, Merge/Cleanup
    expect(ab["Umsetzung"].summe).toBeCloseTo(6 * c, 10);
    expect(ab["verify"].summe).toBeCloseTo(5 * c, 10);
    expect(ab["Review"].summe).toBeCloseTo(4 * c, 10);
    expect(ab["CI-Warten"].summe).toBeCloseTo(3 * c, 10);
    expect(ab["CI-Warten"].median).toBeCloseTo(3 * c, 10);
    expect(ab["CI-Fix"].summe).toBeCloseTo(2 * c, 10);
    expect(ab["Merge/Cleanup"].summe).toBeCloseTo(2 * c, 10);
  });
  test("renderMarkdown nennt Schnitt-Gruppen und die Übergabe-Kennzahlen", () => {
    const r = je({ laeufe: [vorgaenger(5, "verify", 0, [{ min: 1, tools: [edit("a.ts")] }]), nachfolger(5, "verify", 10, [{ min: 1, tools: [{ name: "Read", input: { file_path: "a.ts" } }] }])], jeTicket: true });
    const md = K.renderMarkdown(r as unknown as Parameters<typeof K.renderMarkdown>[0]);
    expect(md).toContain("Schnitt verify");
    expect(md).toContain("Schnitt pr");
    expect(md).toContain("Schnitt ohne");
    expect(md).toContain("Übergabe: 1 Tickets, 1 mit Nachfolger");
    expect(md).toContain("Nachlese-Calls Σ 1");
    expect(md).toContain("Kosten ab verify");
    expect(md).toContain("ab CI-Warten");
  });
});

describe("je Ticket: Zusammenlegung und Fenster, Grenzfälle (#1592 Review R1)", () => {
  type Voll = { gesamt: { n: number; ohnePreis: number; kostenRead: number; kostenWrite: number; kostenOutput: number; ersterKontextMedian: number | null; maxKontextMedian: number | null; kostenSumme: number } | null; wachstum: { ergebnis: number; eingabe: number; rest: number } };
  const jeVoll = (e: JeEingabe) => (K as unknown as { kontextTreiber: (e: JeEingabe) => { gesamt: Voll } }).kontextTreiber(e).gesamt;
  const einzeln = (l: Lauf) => (K as unknown as { kontextTreiber: (e: { laeufe: Lauf[] }) => { gesamt: Voll } }).kontextTreiber({ laeufe: [l] }).gesamt;

  test("Summen über beide Läufe: Kostenteile, Wachstum; erster Kontext vom früheren Lauf (auch bei umgekehrter Eingabe), max. Kontext vom größeren", () => {
    const v = vorgaenger(5, "verify", 0, [{ min: 1, ctx: 10_000 }, { min: 2, ctx: 40_000 }]);
    const n = nachfolger(5, "verify", 10, [{ min: 1, ctx: 15_000 }, { min: 2, ctx: 30_000 }]);
    const g = jeVoll({ laeufe: [n, v], jeTicket: true });
    const a = einzeln(v);
    const b = einzeln(n);
    expect(g.gesamt!.kostenRead).toBeCloseTo(a.gesamt!.kostenRead + b.gesamt!.kostenRead, 10);
    expect(g.gesamt!.kostenWrite).toBeCloseTo(a.gesamt!.kostenWrite + b.gesamt!.kostenWrite, 10);
    expect(g.gesamt!.kostenOutput).toBeCloseTo(a.gesamt!.kostenOutput + b.gesamt!.kostenOutput, 10);
    expect(g.wachstum.rest).toBe(a.wachstum.rest + b.wachstum.rest);
    expect(g.wachstum.rest).toBe(30_000 + 15_000);
    expect(g.gesamt!.ersterKontextMedian).toBe(10_000);
    expect(g.gesamt!.maxKontextMedian).toBe(40_000);
  });

  test("max. Kontext ist das Maximum über alle Läufe, auch wenn es im späteren Lauf liegt (Gegenrichtung)", () => {
    const v = vorgaenger(5, "verify", 0, [{ min: 1, ctx: 10_000 }, { min: 2, ctx: 20_000 }]);
    const n = nachfolger(5, "verify", 10, [{ min: 1, ctx: 15_000 }, { min: 2, ctx: 30_000 }]);
    expect(jeVoll({ laeufe: [v, n], jeTicket: true }).gesamt!.maxKontextMedian).toBe(30_000);
  });

  test("ein Lauf ohne Preis macht die Ticket-Kosten unbekannt (ohnePreis), statt Teilkosten zu zählen", () => {
    const v = vorgaenger(5, "verify", 0, [{ min: 1 }]);
    const n = nachfolger(5, "verify", 10, [{ min: 1 }]);
    (n.zeilen.find((z) => (z as { type?: string }).type === "assistant") as { message: { model: string } }).message.model = "unbekanntes-modell";
    const g = jeVoll({ laeufe: [v, n], jeTicket: true });
    expect(g.gesamt).toMatchObject({ n: 1, ohnePreis: 1, kostenSumme: 0 });
  });

  test("bis gilt für den ersten Start des Tickets: ein Ticket, das nach bis beginnt, fällt heraus; ein Nachfolger nach bis nicht", () => {
    const laeufe = [
      vorgaenger(5, "pr", 0, [{ min: 1 }]),
      nachfolger(5, "pr", 500, [{ min: 1 }]), // nach bis, aber der Vorgänger liegt im Fenster
      vorgaenger(6, "pr", 400, [{ min: 1 }]), // beginnt nach bis
      vorgaenger(7, "pr", 100, [{ min: 1 }]), // beginnt genau auf bis: bleibt
    ];
    const g = jeVoll({ laeufe, bis: t(100), jeTicket: true });
    expect(g.gesamt!.n).toBe(2);
    expect((g.gesamt as unknown as { requests: number }).requests).toBe(3); // Ticket 5 mit Vorgänger UND Nachfolger, Ticket 7
    expect(jeVoll({ laeufe, jeTicket: true }).gesamt!.n).toBe(3);
  });

  test("mit Repo-Wurzel: ein absolut geänderter Pfad gleicht einem relativ gelesenen; ohne Wurzel bleibt er absolut", () => {
    const v = vorgaenger(5, "verify", 0, [{ min: 1, tools: [edit("D:/projekt/repo/scripts/a.mjs")] }]);
    const n = nachfolger(5, "verify", 10, [{ min: 1, tools: [{ name: "Read", input: { file_path: "scripts/a.mjs" } }] }]);
    const mit = (wurzel: string | null) => (K as unknown as { kontextTreiber: (e: JeEingabe & { wurzel: string | null }) => JeBericht }).kontextTreiber({ laeufe: [v, n], jeTicket: true, wurzel }).gesamt.nachlese!.summe;
    expect(mit("D:/projekt/repo")).toBe(1);
    expect(mit(null)).toBe(0);
  });
});

// ── #1646: offene Läufe, Vorlauf, Übergabe ohne Nachfolger, Form des Ticket-Laufs ────────────────

type Gr = { gesamt: { n: number; requests: number; requestsMedian: number | null; kontextCallGewichtet: number | null; kostenSumme: number } | null; offen: number };
type Liste = { ticket: number | null; start: string; sammel: boolean; offen: boolean };
type Voll = { gesamt: Gr; sammel: Gr; ohneSammel: Gr; laeufe: Liste[] };
const voll = (e: { laeufe: Lauf[]; jeTicket?: boolean; von?: string }) => (K as unknown as { kontextTreiber: (e: object) => Voll }).kontextTreiber(e);
const KR = K as unknown as { ladeVon: (von: string, jeTicket: boolean) => string; renderMarkdown: (r: Voll) => string };

describe("offene Läufe (#1646)", () => {
  const offenerLauf = (nr: number, ab: number) => laufAb(ab, `Ticket #${nr}: x`, [{ min: 1 }, { min: 2, tools: [bash("npm run verify", null)] }]);
  const geschlossen = (nr: number, ab: number) => laufAb(ab, `Ticket #${nr}: x`, [{ min: 1 }, { min: 2, tools: [bash("npm run verify", "ok")] }]);
  test("analysiereLauf übernimmt offen: Tool ohne Ergebnis ja, mit Ergebnis nein", () => {
    const a = (l: Lauf) => (K.analysiereLauf(l) as unknown as { offen: boolean }).offen;
    expect(a(offenerLauf(1, 0))).toBe(true);
    expect(a(geschlossen(1, 0))).toBe(false);
  });
  test("ein offener Lauf ändert Mediane und Summen nicht, wird gezählt und steht in der Läufe-Liste", () => {
    const ohneOffen = voll({ laeufe: [geschlossen(1, 0), geschlossen(2, 10)] });
    const mitOffen = voll({ laeufe: [geschlossen(1, 0), geschlossen(2, 10), offenerLauf(3, 20)] });
    expect(mitOffen.gesamt.gesamt).toEqual(ohneOffen.gesamt.gesamt);
    expect(mitOffen.gesamt.offen).toBe(1);
    expect(ohneOffen.gesamt.offen).toBe(0);
    expect(mitOffen.laeufe.map((x) => [x.ticket, x.offen])).toEqual([[1, false], [2, false], [3, true]]);
    expect(mitOffen.laeufe[0].start).toBe(t(0));
  });
  test("nur offene Läufe: keine Kennzahlen, aber gezählt; Je-Ticket: ein Ticket mit offenem Lauf gilt als offen", () => {
    const r = voll({ laeufe: [offenerLauf(3, 0)] });
    expect(r.gesamt.gesamt).toBeNull();
    expect(r.gesamt.offen).toBe(1);
    const je2 = voll({ laeufe: [vorgaenger(5, "verify", 0, [{ min: 1 }]), laufAb(10, `Ticket #5: x${NL}Einstieg: verify`, [{ min: 1, tools: [bash("x", null)] }]), vorgaenger(6, "pr", 20, [{ min: 1 }])], jeTicket: true });
    expect(je2.gesamt.gesamt!.n).toBe(1);
    expect(je2.gesamt.offen).toBe(1);
    expect(je2.laeufe.map((x) => [x.ticket, x.offen])).toEqual([[5, true], [6, false]]);
  });
  test("Markdown: Kopf nennt offen, Tabelle Läufe zeigt offen/geschlossen", () => {
    const md = KR.renderMarkdown(voll({ laeufe: [geschlossen(1, 0), offenerLauf(3, 20)] }));
    expect(md).toContain("offen: 1");
    expect(md).toContain("| Start | Ticket | Sammel | Status |");
    expect(md).toMatch(/\| #3 \| nein \| offen \|/);
    expect(md).toMatch(/\| #1 \| nein \| geschlossen \|/);
  });
});

describe("ladeVon und Übergabe ohne Nachfolger (#1646)", () => {
  test("je Ticket: Laden beginnt 48 h vor dem Fenster, sonst am Fenster selbst", () => {
    expect(KR.ladeVon("2026-10-10T12:00:00.000Z", true)).toBe("2026-10-08T12:00:00.000Z");
    expect(KR.ladeVon("2026-10-10T12:00:00.000Z", false)).toBe("2026-10-10T12:00:00.000Z");
  });
  test("Nachfolger mit Vorgänger 30 h vor dem Fenster: Ticket fällt aus dem Fenster, nicht in ohneVorgaenger; Start genau auf von zählt", () => {
    const vor = vorgaenger(5, "verify", -30 * 60, [{ min: 1 }]);
    const nach = nachfolger(5, "verify", 10, [{ min: 1 }]);
    const r = je({ laeufe: [vor, nach], von: t(0), jeTicket: true });
    expect(r.gesamt.gesamt).toBeNull();
    expect(r.ohneVorgaenger).toBe(0);
    expect(je({ laeufe: [vorgaenger(6, "pr", 0, [{ min: 1 }])], von: t(0), jeTicket: true }).gesamt.gesamt!.n).toBe(1);
  });
  test("renderUebergabe ohne Nachfolger: 0 mit Nachfolger, Striche, kein NaN", () => {
    const md = KR.renderMarkdown(je({ laeufe: [vorgaenger(6, "pr", 0, [{ min: 1 }])], jeTicket: true }) as unknown as Voll);
    expect(md).toContain("0 mit Nachfolger");
    expect(md).toContain("Kontext erster Call Nachfolger (Median) -");
    expect(md).not.toContain("NaN");
  });
});

describe("ticketLauf: Gruppen-Kennzahlen über zwei Läufe (#1646)", () => {
  test("Summen, Median und Kosten stimmen mit den Einzelläufen überein", () => {
    const v = vorgaenger(5, "verify", 0, [{ min: 1, ctx: 10_000 }, { min: 2, ctx: 20_000, tools: [edit("a.ts")] }]);
    const n = nachfolger(5, "verify", 10, [{ min: 1, ctx: 30_000, tools: [bash("cat a.ts")] }]);
    const g = je({ laeufe: [v, n], jeTicket: true }).gesamt.gesamt as unknown as { n: number; requests: number; requestsMedian: number; kontextCallGewichtet: number; kostenSumme: number };
    expect(g).toMatchObject({ n: 1, requests: 3, requestsMedian: 3, kontextCallGewichtet: 20_000 });
    const einzeln = [v, n].map((l) => KI.analysiereLauf(l)!.kosten!);
    expect(g.kostenSumme).toBeCloseTo(einzeln[0] + einzeln[1], 10);
  });
});

describe("Ticketliste je Gruppe (#1593)", () => {
  type Zeile = { ticket: number; schnitt: string; kosten: number | null; nachfolger: number; promptZeichenNachfolger: number; offen: boolean };
  const liste = (laeufe: Lauf[]) => (voll({ laeufe, jeTicket: true }).laeufe as unknown as Zeile[]);
  const v = vorgaenger(5, "verify", 0, [{ min: 1, ctx: 10_000 }, { min: 2, ctx: 20_000 }]);
  const n = nachfolger(5, "verify", 10, [{ min: 1, ctx: 15_000 }]);
  test("je Ticket: Schnitt, Kosten, Zahl und Prompt-Zeichen der Nachfolger; ohne Schnitt-Zeile ohne", () => {
    const [a, b] = liste([v, n, vorgaenger(6, null, 30, [{ min: 1 }, { min: 2 }])]);
    expect(a).toMatchObject({ ticket: 5, schnitt: "verify", nachfolger: 1 });
    expect(a.kosten).toBeCloseTo(KI.analysiereLauf(v)!.kosten! + KI.analysiereLauf(n)!.kosten!, 10);
    expect(a.promptZeichenNachfolger).toBe((KI.analysiereLauf(n) as unknown as { promptZeichen: number }).promptZeichen);
    expect(a.promptZeichenNachfolger).toBeGreaterThan(50);
    expect(b).toMatchObject({ ticket: 6, schnitt: "ohne", nachfolger: 0, promptZeichenNachfolger: 0 });
  });
  test("ein offenes Ticket steht mit offen in der Liste, aber in keinem Median", () => {
    const offen = laufAb(50, "Ticket #7: x", [{ min: 1 }, { min: 2, tools: [bash("npm run verify", null)] }]);
    const r = voll({ laeufe: [v, n, offen], jeTicket: true });
    expect((r.laeufe as unknown as Zeile[]).map((z) => [z.ticket, z.offen])).toEqual([[5, false], [7, true]]);
    expect(r.gesamt.gesamt!.n).toBe(1);
    expect(r.gesamt.offen).toBe(1);
  });
  test("Markdown zeigt die zusätzlichen Spalten nur je Ticket, nicht je Lauf", () => {
    expect(KR.renderMarkdown(voll({ laeufe: [v, n], jeTicket: true }))).toMatch(/\| Schnitt \| Kosten \(\$\) \| Nachfolger \|/);
    expect(KR.renderMarkdown(voll({ laeufe: [v, n] }))).not.toContain("Prompt-Zeichen Nachfolger");
  });
});

describe("Ticketliste je Gruppe: Summe über Nachfolger und Markdown-Zeilen (#1593)", () => {
  type Zeile = { nachfolger: number; promptZeichenNachfolger: number };
  const n2 = (nr: number, ab: number) => laufAb(ab, [`Ticket #${nr}: x`, "Lock: nonce=abc", "Einstieg: verify", "--- Übergabe ---", "SCHNITT: verify", "UEBERGABE:", "ein deutlich längerer zweiter Nachfolger-Prompt"].join(NL), [{ min: 1 }]);
  test("zwei Nachfolger: Anzahl 2 und Σ der Prompt-Zeichen beider, nicht nur des ersten", () => {
    const v = vorgaenger(5, "verify", 0, [{ min: 1 }]);
    const a = nachfolger(5, "verify", 10, [{ min: 1 }]);
    const b = n2(5, 20);
    const z = (voll({ laeufe: [v, a, b], jeTicket: true }).laeufe as unknown as Zeile[])[0];
    const zeichen = (l: Lauf) => (KI.analysiereLauf(l) as unknown as { promptZeichen: number }).promptZeichen;
    expect(z.nachfolger).toBe(2);
    expect(zeichen(b)).toBeGreaterThan(zeichen(a));
    expect(z.promptZeichenNachfolger).toBe(zeichen(a) + zeichen(b));
  });
  test("Markdown-Zeile: Schnitt, Kosten, Nachfolger und Prompt-Zeichen stehen in den Spalten; ohne Preis steht `-`", () => {
    const v = vorgaenger(5, "verify", 0, [{ min: 1 }]);
    const n = nachfolger(5, "verify", 10, [{ min: 1 }]);
    const zeichen = (KI.analysiereLauf(n) as unknown as { promptZeichen: number }).promptZeichen;
    const md = KR.renderMarkdown(voll({ laeufe: [v, n], jeTicket: true }));
    expect(md).toMatch(new RegExp(`\\| #5 \\| nein \\| geschlossen \\| verify \\| \\d+[.,]\\d+ \\| 1 \\| ${zeichen} \\|`));
    const ohnePreis = vorgaenger(6, null, 30, [{ min: 1 }]);
    (ohnePreis.zeilen[1] as { message: { model: string } }).message.model = "unbekannt";
    expect(KR.renderMarkdown(voll({ laeufe: [ohnePreis], jeTicket: true }))).toMatch(/\| #6 \| nein \| geschlossen \| ohne \| - \| 0 \| 0 \|/);
  });
});

describe("parseArgs strikt (#1790)", () => {
  type PArgs = { agent: string; tickets: number[]; ohne: number[]; json: boolean; von?: string; bis?: string; projekt?: string; brille?: string; delta?: boolean; jeTicket?: boolean; fehler?: string };
  const PS = (K as unknown as { parseArgs: (a: string[]) => PArgs }).parseArgs;
  test("alle Flags gesetzt: Form ohne fehler-Feld, --ticket/--ohne wiederholbar", () => {
    expect(PS(["--von", "v", "--bis", "b", "--agent", "x", "--ticket", "1", "--ticket", "2", "--ohne", "3", "--ohne", "4", "--projekt", "p", "--brille", "Doku", "--delta", "nein", "--je-ticket", "--json"])).toEqual({ agent: "x", tickets: [1, 2], ohne: [3, 4], json: true, von: "v", bis: "b", projekt: "p", brille: "Doku", delta: false, jeTicket: true });
    expect(PS([])).toEqual({ agent: UMSETZER, tickets: [], ohne: [], json: false });
  });
  test("unbekanntes Flag, Flag ohne Wert und doppeltes Einzel-Flag setzen fehler", () => {
    expect(PS(["--bogus"]).fehler).toMatch(/Unbekanntes Argument: --bogus/);
    expect(PS(["--agent"]).fehler).toMatch(/--agent braucht einen Wert/);
    expect(PS(["--agent", "a", "--agent", "b"]).fehler).toMatch(/--agent ist doppelt/);
    expect(PS(["--je-ticket", "--je-ticket"]).fehler).toMatch(/--je-ticket ist doppelt/);
    expect(PS(["--delta"]).fehler).toMatch(/--delta braucht einen Wert/);
  });
});

describe("sessions je Zeile (#1814 L8)", () => {
  const mitDatei = (l: Lauf, datei: string | undefined): Lauf => ({ ...l, datei: undefined, session: datei?.split("/")[0] } as Lauf);
  const cl = [{ min: 1 }, { min: 2 }];
  type Zeile = { ticket: number | null; sessions: string[] };
  const zeilen = (e: JeEingabe) => (je(e) as unknown as { laeufe: Zeile[] }).laeufe;
  const flach = (e: Omit<JeEingabe, "jeTicket">) => (K as unknown as { kontextTreiber: (e: JeEingabe) => { laeufe: Zeile[] } }).kontextTreiber({ ...e, jeTicket: false }).laeufe;
  test("flacher Modus: das Feld session des Laufs", () => {
    expect(flach({ laeufe: [mitDatei(lauf("#1 x", cl), "sess-a/subagents/agent-1.jsonl")] })[0].sessions).toEqual(["sess-a"]);
  });
  test("ohne session: leere Liste, kein Absturz", () => {
    expect(flach({ laeufe: [lauf("#1 x", cl)] })[0].sessions).toEqual([]);
  });
  test("je Ticket: sortiert und eindeutig über alle Läufe des Tickets", () => {
    const a = mitDatei(vorgaenger(5, "verify", 0, cl), "sess-b/subagents/a.jsonl");
    const b = mitDatei(nachfolger(5, "pr", 30, cl), "sess-a/subagents/b.jsonl");
    const c = mitDatei(nachfolger(5, "pr", 60, cl), "sess-b/subagents/c.jsonl");
    expect(zeilen({ laeufe: [a, b, c], jeTicket: true })[0].sessions).toEqual(["sess-a", "sess-b"]);
  });
});

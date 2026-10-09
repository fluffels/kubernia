/* Kontext-Treiber (#1559): Kern pur, synthetische Transkriptzeilen ohne IO. */
import { describe, expect, test } from "vitest";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as raw from "../scripts/kontext-treiber.mjs";

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
const lauf = (prompt: string, calls: CallSpec[], agentType = "kubernia-umsetzer"): Lauf => ({ meta: { agentType }, zeilen: [user(0, prompt), ...calls.flatMap(schritt)] });
const bash = (command: string, result?: string | null): Tool => ({ name: "Bash", input: { command }, result });
const edit = (file = "src/a.ts"): Tool => ({ name: "Edit", input: { file_path: file } });
const linse: Tool = { name: "Agent", input: { subagent_type: "kubernia-lens", description: "Lens Architektur R1" } };

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
    expect(K.analysiereLauf({ meta: { agentType: "kubernia-umsetzer" }, zeilen: [user(0, "#1 x")] })).toBeNull();
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
    const planer = lauf("#3 z", [{ min: 1 }], "kubernia-planner");
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
    const l = lauf(prompt, [{ min: 1 }, { min: 2 }], "kubernia-lens");
    (l.meta as Record<string, unknown>).description = beschreibung;
    return l;
  };
  const r1 = lens("Lens Architektur R1", "Patch: /t/kq-1-r1.patch");
  const r2 = lens("Lens Test-Adäquanz R2", "Patch: /t/kq-1-r1.patch Delta-Patch: /t/kq-1-r2-delta.patch");
  const alle = [r1, r2];
  test("ohne Filter zählen alle Läufe (Regression)", () => {
    expect(kt({ laeufe: alle, agent: "kubernia-lens" })).toBe(2);
  });
  test("delta true nur mit Delta-Patch, delta false nur ohne", () => {
    expect(kt({ laeufe: alle, agent: "kubernia-lens", delta: true })).toBe(1);
    expect(kt({ laeufe: alle, agent: "kubernia-lens", delta: false })).toBe(1);
  });
  test("brille filtert auf den Namen, ein unbekannter Name liefert keine Läufe", () => {
    expect(kt({ laeufe: alle, agent: "kubernia-lens", brille: "Architektur" })).toBe(1);
    expect(kt({ laeufe: alle, agent: "kubernia-lens", brille: "Test-Adäquanz", delta: true })).toBe(1);
    expect(kt({ laeufe: alle, agent: "kubernia-lens", brille: "Architektur", delta: true })).toBe(0);
    expect(kt({ laeufe: alle, agent: "kubernia-lens", brille: "Gibtsnicht" })).toBe(0);
  });
  test("parseArgs: --delta ja|nein und --brille; ein anderer Wert ist ein Fehler", () => {
    expect(PA(["--delta", "ja", "--brille", "Doku"])).toMatchObject({ delta: true, brille: "Doku" });
    expect(PA(["--delta", "nein"]).delta).toBe(false);
    expect(PA(["--delta", "vielleicht"]).fehler).toMatch(/ja\|nein/);
    expect(PA([]).delta).toBeUndefined();
  });
});

describe("--delta ja zählt Merge-Delta-Läufe (#1582)", () => {
  test("ein Lauf mit Delta-Patch-Pfad und Merge-Beschreibung bleibt bei delta true", () => {
    const l = lauf("Patch: /t/kq-1-r1.patch Delta-Patch: /t/kq-1-r2-delta.patch Konflikt-Auflösung", [{ min: 1 }, { min: 2 }], "kubernia-lens");
    (l.meta as Record<string, unknown>).description = "Lens Doku Merge-Auflösung";
    const n = (delta: boolean) => (K as unknown as { kontextTreiber: (e: { laeufe: Lauf[]; agent: string; delta: boolean }) => { gesamt: { gesamt: { n: number } | null } } }).kontextTreiber({ laeufe: [l], agent: "kubernia-lens", delta }).gesamt.gesamt?.n ?? 0;
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

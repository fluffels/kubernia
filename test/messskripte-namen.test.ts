/* Messskripte: Namen aus der Projekt-Config (#1745, ADR 0022 F3). Eine Fremd-Config (Repo o/acme, Worktree-Präfix ab-, Commit-Zeile AB-,
 * Agenten acme-*) zeigt, dass kein Name mehr im Skript steht; die Negativfälle zeigen, dass ein fehlender Name laut abbricht statt still zu zählen.
 * Die Ausgabeform belegt das Golden (test/mess-ausgaben-golden.test.ts). Synthetische Zeilen, kein IO außer dem Temp-Ordner.
 */
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { FREMD, repoName } from "./support/fremd-config";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as projektRoh from "../scripts/projekt-config-lib.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as namenRoh from "../scripts/ticket-namen.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as laeufeRoh from "../scripts/subagent-laeufe.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as laufzeitRoh from "../scripts/subagent-laufzeit.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as kontextRoh from "../scripts/kontext-treiber.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as messRoh from "../scripts/mess-lib.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as hauptchatRoh from "../scripts/hauptchat-zerlegung.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as baselineRoh from "../scripts/token-baseline.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as kernRoh from "../scripts/langfuse-abgleich-kern.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as otlpRoh from "../scripts/langfuse-otlp.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as kontingentRoh from "../scripts/kontingent-lib.mjs";

type Row = Record<string, unknown>;
const WT = FREMD.praefixe.worktree;
const BRANCH = FREMD.praefixe.branch;
const { planer: PLANER, umsetzer: UMSETZER, lens: LENS } = FREMD.agenten;
type Lauf = { meta: { agentType?: string }; zeilen: Row[] };
type Namen = { agenten: Record<string, string>; praefixe: { worktree: string } };

const P = projektRoh as unknown as { repoName: (c: unknown) => string };
const N = namenRoh as unknown as { ticketNamen: (c: unknown) => Namen };
const L = laeufeRoh as unknown as { laufAus: (l: unknown, n?: unknown) => { ticket: number | null } | null; ticketAusLauf: (e: object, n?: unknown) => number | null };
const Z = laufzeitRoh as unknown as {
  laufzeiten: (e: object) => { agent: string; laeufe: { ticket: number | null }[] };
  typenUebersicht: (e: object) => { gesamt: { n: number } };
  hauptlauf: (argv: string[], d: object) => number;
  parseArgs: (argv: string[], namen?: unknown) => { agent?: string };
};
const K = kontextRoh as unknown as {
  kontextTreiber: (e: object) => { agent: string };
  analysiereLauf: (l: Lauf, o?: object) => { ergebnisse: { label: string }[] } | null;
  phaseDerCalls: (z: Row[], einstieg: unknown, namen: unknown) => string[];
  hauptlauf: (argv: string[], d: object) => number;
};
const M = messRoh as unknown as { bereinige: (t: string, o?: object) => string; normPfad: (p: string, o?: object) => string };
const H = hauptchatRoh as unknown as {
  hauptchatNamen: (d: { config: unknown }) => { ticketAgenten: Set<string>; repoName: string };
  zerlegeHauptchat: (e: object) => Record<string, { calls: number }> & { rows: { quelle: string; calls: number }[] };
  renderMarkdown: (r: unknown, o?: object) => string;
  ERGEBNIS_SCHLUESSEL: readonly string[];
};
const B = baselineRoh as unknown as {
  summarize: (run: object, bounds?: object, prFiles?: unknown, namen?: object) => { pflegeFehlt?: boolean };
  renderMarkdown: (s: unknown, loop?: object, namen?: object) => string;
};
const G = kernRoh as unknown as { ticketAusBranch: (b: unknown, w?: unknown) => string | null; sollEintraege: (s: object, o?: object) => { ticket: string | null }[] };
type Attribut = { key: string; value: { stringValue?: string; arrayValue?: { values: { stringValue: string }[] } } };
type Span = { attributes: Attribut[] };
type Payload = { resourceSpans: { resource: { attributes: Attribut[] }; scopeSpans: { scope: { name: string }; spans: Span[] }[] }[] };
const O = otlpRoh as unknown as {
  scopeName: (r: string) => string;
  bauePayloads: (s: string, e: unknown, o: object) => { chunks: { payload: Payload }[] };
};
const KL = kontingentRoh as unknown as { logPfad: (env?: object, o?: object) => string; mitKontingent: (name: string, o: object) => { ok: boolean } };

const CFG = {
  version: 2,
  repo: "o/acme",
  praefixe: { commitZeile: "AB-", branch: "feature/ab-", worktree: "ab-" },
  labels: { harness: "bereich:x", festgefahren: "zustand:fest", forum: "f", dependabotInbox: "bereich:x" },
  agenten: { planer: "acme-planer", umsetzer: "acme-umsetzer", lens: "acme-lens", gruppe: "acme-gruppe", ticketSkill: "acme" },
};
const ohneAgent = (rolle: string) => ({ ...CFG, agenten: { ...CFG.agenten, [rolle]: undefined } });
const NAMEN = N.ticketNamen(CFG);

const t = (min: number) => new Date(Date.UTC(2026, 9, 7, 10, 0, 0) + min * 60_000).toISOString();
let seq = 0;
const user = (min: number, text: string): Row => ({ type: "user", timestamp: t(min), message: { role: "user", content: text } });
const call = (min: number, o: { tool?: string; input?: Row; branch?: string; model?: string } = {}): Row => {
  seq += 1;
  return {
    type: "assistant",
    timestamp: t(min),
    uuid: `n${seq}`,
    ...(o.branch ? { gitBranch: o.branch, sessionId: "s1" } : {}),
    message: {
      id: `nm${seq}`,
      model: o.model ?? "claude-opus-5-5",
      usage: { input_tokens: 1000, output_tokens: 10, cache_creation_input_tokens: 0, cache_read_input_tokens: 1000 },
      content: o.tool ? [{ type: "tool_use", id: `nt${seq}`, name: o.tool, input: o.input ?? {} }] : [{ type: "text", text: "x" }],
    },
  };
};
const ergebnis = (min: number, id: string): Row => ({ type: "user", timestamp: t(min), message: { content: [{ type: "tool_result", tool_use_id: id, content: "ok" }] } });
const mitTool = (min: number, tool: string, input: Row): Row[] => {
  const c = call(min, { tool, input });
  return [c, ergebnis(min + 0.1, ((c.message as { content: { id: string }[] }).content[0]).id)];
};
const lauf = (agentType: string, prompt: string, extra: Row[] = []): Lauf => ({ meta: { agentType }, zeilen: [user(0, prompt), call(1), ...extra, call(9)] });

describe("repoName (Namensteil von repo)", () => {
  test("owner/name ergibt den Namen", () => {
    expect(P.repoName(CFG)).toBe("acme");
  });
  test.each([[undefined], [{}], [{ repo: "acme" }], [{ repo: "a/b/c" }], [{ repo: "" }], [{ repo: 5 }], [{ repo: "o/" }], [{ repo: "/acme" }], [{ repo: "o/ac me" }], [{ repo: "o x/acme" }], [{ repo: ["o/acme"] }]])("kaputtes repo %j wirft mit Fix-Zeile", (c) => {
    expect(() => P.repoName(c)).toThrow(/repo[\s\S]*Fix:/);
  });
});

describe("subagent-laeufe: Ticket aus dem Worktree-Präfix der Config", () => {
  test("worktrees/ab-12 ordnet Ticket 12 zu, ein fremdes Präfix nicht", () => {
    expect(L.laufAus(lauf("x", "Arbeit in C:/r/.claude/worktrees/ab-12/src"), NAMEN)?.ticket).toBe(12);
    expect(L.laufAus(lauf("x", `Arbeit in C:/r/.claude/worktrees/${WT}12/src`), NAMEN)?.ticket).toBeNull();
  });
  test("Patch-Pfad ab-12-r1.patch ordnet Ticket 12 zu, ein fremdes Präfix nicht", () => {
    const mit = L.laufAus(lauf("x", "Patch: /t/ab-12-r1.patch"), NAMEN) as { patch: { ticket: number; runde: number } | null; ticket: number | null };
    expect(mit.patch).toMatchObject({ ticket: 12, runde: 1 });
    expect(mit.ticket).toBe(12);
    expect((L.laufAus(lauf("x", `Patch: /t/${WT}12-r1.patch`), NAMEN) as { ticket: number | null }).ticket).toBeNull();
  });
  test("ticketAusLauf ruft ticketAusRef mit den übergebenen Namen auf (Kommentar #1743 K3)", () => {
    expect(L.ticketAusLauf({ patch: null, prompt: "worktrees/ab-7" }, NAMEN)).toBe(7);
    expect(L.ticketAusLauf({ patch: null, prompt: `worktrees/${WT}7` }, NAMEN)).toBeNull();
  });
  test("laufAus reicht die Session durch und lässt das Feld ohne Session weg (#1821 L19)", () => {
    const s = L.laufAus({ ...lauf("x", "a"), session: "s9" }, NAMEN) as unknown as Record<string, unknown>;
    expect(s.session).toBe("s9");
    expect(Object.keys(L.laufAus(lauf("x", "a"), NAMEN) as object)).not.toContain("session");
  });
  test("Negativfall: ohne Namen wirft laufAus, auch der Index aus .map(laufAus)", () => {
    expect(() => L.laufAus(lauf("x", "a"))).toThrow(/Ticket-Namen/);
    expect(() => [lauf("x", "a")].map(L.laufAus as never)).toThrow(/Ticket-Namen/);
    expect(() => L.laufAus(lauf("x", "a"), {})).toThrow(/Ticket-Namen/);
  });
});

describe("subagent-laufzeit: Agent aus der Config", () => {
  const laeufe = [lauf("acme-planer", "Ticket #1: a"), lauf(PLANER, "Ticket #2: b"), lauf("acme-lens", "Ticket #3: c")];
  test("ohne agent gilt agenten.planer, ein Lauf des alten Namens zählt nicht", () => {
    const r = Z.laufzeiten({ laeufe, namen: NAMEN });
    expect(r.agent).toBe("acme-planer");
    expect(r.laeufe.map((l) => l.ticket)).toEqual([1]);
  });
  test("ein ausdrücklicher agent gewinnt gegen den Standard", () => {
    expect(Z.laufzeiten({ laeufe, namen: NAMEN, agent: "acme-lens" }).laeufe.map((l) => l.ticket)).toEqual([3]);
  });
  test("Negativfall: weder agent noch namen.agenten.planer wirft", () => {
    expect(() => Z.laufzeiten({ laeufe, namen: { agenten: {} } })).toThrow(/Agenten-Typ/);
    expect(() => Z.laufzeiten({ laeufe, namen: NAMEN, agent: "" })).toThrow(/Agenten-Typ/);
    expect(() => Z.laufzeiten({ laeufe })).toThrow(/Agenten-Typ/);
  });
  test("typenUebersicht nimmt die Namen für die Ticket-Zuordnung (ohne sie wirft laufAus)", () => {
    expect(Z.typenUebersicht({ laeufe, namen: NAMEN }).gesamt.n).toBe(3);
    expect(() => Z.typenUebersicht({ laeufe })).toThrow(/Ticket-Namen/);
  });
  test("parseArgs: ohne --agent der Planer der Config, mit --agent der angegebene", () => {
    expect(Z.parseArgs(["--von", "x"], NAMEN).agent).toBe("acme-planer");
    expect(Z.parseArgs(["--von", "x", "--agent", "z"], NAMEN).agent).toBe("z");
  });
});

describe("subagent-laufzeit: hauptlauf (K3: ohne agenten.planer bricht es mit Meldung ab)", () => {
  const spiel = () => {
    const log = { out: [] as string[], err: [] as string[], geladen: [] as string[] };
    const d = {
      out: (s: string) => log.out.push(s),
      err: (s: string) => log.err.push(s),
      ordner: () => {
        log.geladen.push("ordner");
        return "/x";
      },
      ladeTyp: (_dir: string, agent: string) => {
        log.geladen.push(`typ:${agent}`);
        return [];
      },
      ladeAlle: () => {
        log.geladen.push("alle");
        return [];
      },
    };
    return { log, d };
  };
  test("Negativfall: ohne agenten.planer Exit 1, Meldung mit Schlüssel und Fix, kein Transkript gelesen", () => {
    const { log, d } = spiel();
    const code = Z.hauptlauf(["--von", t(0)], { ...d, config: ohneAgent("planer") });
    expect(code).toBe(1);
    expect(log.err.join("\n")).toMatch(/agenten\.planer[\s\S]*Fix:/);
    expect(log.geladen).toEqual([]);
    expect(log.out).toEqual([]);
  });
  test("eine leere Config ebenso Exit 1 ohne Transkript", () => {
    const { log, d } = spiel();
    expect(Z.hauptlauf(["--von", t(0)], { ...d, config: {} })).toBe(1);
    expect(log.err.join("\n")).toMatch(/Fix:/);
    expect(log.geladen).toEqual([]);
  });
  test("mit Config: der Standard-Agent ist agenten.planer, Ausgabe über out, Exit 0", () => {
    const { log, d } = spiel();
    expect(Z.hauptlauf(["--von", t(0)], { ...d, config: CFG })).toBe(0);
    expect(log.geladen).toEqual(["ordner", "typ:acme-planer"]);
    expect(log.out.join("\n")).toContain("`acme-planer`");
  });
  test("--typen lädt alle Läufe, Aufruf-Fehler (ohne --von) ist Exit 2 mit dem Planer der Config im Aufrufhinweis", () => {
    const a = spiel();
    expect(Z.hauptlauf(["--von", t(0), "--typen"], { ...a.d, config: CFG })).toBe(0);
    expect(a.log.geladen).toEqual(["ordner", "alle"]);
    const b = spiel();
    expect(Z.hauptlauf([], { ...b.d, config: CFG })).toBe(2);
    expect(b.log.err.join("\n")).toContain("--agent acme-planer");
    expect(b.log.geladen).toEqual([]);
  });
});

describe("mess-lib: Worktree-Präfix als Option", () => {
  test("bereinige: der Worktree-Pfad mit dem Präfix der Config wird <wt>, ein anderes Präfix bleibt", () => {
    expect(M.bereinige("cd C:/r/.claude/worktrees/ab-5 && ls", { worktree: "ab-" })).toBe("cd <wt>/ && ls");
    expect(M.bereinige(`cd C:/r/.claude/worktrees/${WT}5 && ls`, { worktree: "ab-" })).toBe(`cd C:/r/.claude/worktrees/${WT}5 && ls`);
  });
  test("bereinige ohne worktree lässt jeden Worktree-Pfad stehen (nur diese Ersetzung entfällt, der Benutzerordner nicht)", () => {
    expect(M.bereinige("cd C:/r/.claude/worktrees/ab-5 && ls")).toBe("cd C:/r/.claude/worktrees/ab-5 && ls");
    expect(M.bereinige("C:/Users/Max/x")).toBe("~/x");
    // Ein fehlender Wert darf nie als Text „undefined“ ins Muster rutschen.
    expect(M.bereinige("C:/r/.claude/worktrees/undefined5/x")).toBe("C:/r/.claude/worktrees/undefined5/x");
    expect(M.bereinige("C:/r/.claude/worktrees/null5/x")).toBe("C:/r/.claude/worktrees/null5/x");
  });
  test("bereinige maskiert Regex-Zeichen im Präfix (ein Punkt trifft nur den Punkt)", () => {
    expect(M.bereinige("C:/r/.claude/worktrees/a.-5/x", { worktree: "a.-" })).toBe("<wt>/x");
    expect(M.bereinige("C:/r/.claude/worktrees/ab-5/x", { worktree: "a.-" })).toBe("C:/r/.claude/worktrees/ab-5/x");
  });
  test("normPfad: Präfix der Config fällt weg, anderes bleibt, ohne worktree bleibt alles", () => {
    expect(M.normPfad("C:\\R\\.claude\\worktrees\\ab-5\\Src\\A.ts", { worktree: "ab-" })).toBe("src/a.ts");
    expect(M.normPfad(`C:/r/.claude/worktrees/${WT}5/src/a.ts`, { worktree: "ab-" })).toBe(`c:/r/.claude/worktrees/${WT}5/src/a.ts`);
    expect(M.normPfad("C:/r/.claude/worktrees/ab-5/src/a.ts")).toBe("c:/r/.claude/worktrees/ab-5/src/a.ts");
    expect(M.normPfad("C:/r/.claude/worktrees/undefined5/src/a.ts")).toBe("c:/r/.claude/worktrees/undefined5/src/a.ts");
    expect(M.normPfad("C:/r/.claude/worktrees/null5/src/a.ts")).toBe("c:/r/.claude/worktrees/null5/src/a.ts");
  });
});

describe("kontext-treiber: Namen aus der Config", () => {
  const spawn = (typ: string) => mitTool(2, "Agent", { subagent_type: typ, description: "Lens Doku R1" });
  test("Negativfall (#1821 L11): phaseDerCalls ohne Ticket-Namen wirft mit Meldung statt eines nackten TypeError", () => {
    const mitTool_ = [user(0, "Ticket #1: x"), call(1), ...mitTool(2, "Bash", { command: "ls" }), call(3)];
    expect(() => K.phaseDerCalls(mitTool_, null, undefined)).toThrow(/Ticket-Namen/);
    expect(() => K.phaseDerCalls(mitTool_, null, {})).toThrow(/Ticket-Namen/);
    expect(K.phaseDerCalls(mitTool_, null, NAMEN)).toHaveLength(3);
  });
  test("die Review-Phase beginnt beim Spawn des Lens-Agenten der Config, nicht beim alten Namen", () => {
    const mitLinse = [user(0, "Ticket #1: x"), call(1), ...spawn("acme-lens"), call(3)];
    expect(K.phaseDerCalls(mitLinse, null, NAMEN)).toEqual(["Umsetzung", "Review", "Review"]);
    const alt = [user(0, "Ticket #1: x"), call(1), ...spawn(LENS), call(3)];
    expect(K.phaseDerCalls(alt, null, NAMEN)).toEqual(["Umsetzung", "Umsetzung", "Umsetzung"]);
  });
  test("Tool-Label und Pfade: der Worktree-Pfad der Config wird <wt>, der alte bleibt", () => {
    const l = lauf("acme-umsetzer", "Ticket #1: x", [...mitTool(2, "Read", { file_path: "C:/r/.claude/worktrees/ab-5/src/a.ts" }), ...mitTool(3, "Read", { file_path: `C:/r/.claude/worktrees/${WT}5/src/b.ts` })]);
    const labels = K.analysiereLauf(l, { namen: NAMEN })!.ergebnisse.map((e) => e.label);
    expect(labels).toContain("Read <wt>/src/a.ts");
    expect(labels).toContain(`Read C:/r/.claude/worktrees/${WT}5/src/b.ts`);
  });
  test("kontextTreiber: ohne agent gilt agenten.umsetzer; ohne beides wirft er; ohne namen wirft analysiereLauf", () => {
    expect(K.kontextTreiber({ laeufe: [], namen: NAMEN }).agent).toBe("acme-umsetzer");
    expect(() => K.kontextTreiber({ laeufe: [], namen: { agenten: {}, praefixe: {} } })).toThrow(/Agenten-Typ/);
    expect(() => K.kontextTreiber({ laeufe: [], namen: NAMEN, agent: "" })).toThrow(/Agenten-Typ/);
    expect(() => K.kontextTreiber({ laeufe: [] })).toThrow(/Agenten-Typ/);
    expect(() => K.analysiereLauf(lauf("acme-umsetzer", "Ticket #1: x"))).toThrow(/Ticket-Namen/);
  });
  test("Negativfall: hauptlauf ohne agenten.umsetzer endet mit Exit 1 und Meldung samt Fix, ohne Transkript", () => {
    const err: string[] = [];
    const geladen: string[] = [];
    const code = K.hauptlauf(["--von", t(0)], { config: ohneAgent("umsetzer"), err: (s: string) => err.push(s), out: () => {}, ordner: () => geladen.push("o"), ladeTyp: () => geladen.push("t") });
    expect(code).toBe(1);
    expect(err.join("\n")).toMatch(/agenten\.umsetzer[\s\S]*Fix:/);
    expect(geladen).toEqual([]);
  });
  test("hauptlauf mit Config: der Standard-Agent ist agenten.umsetzer (Aufruf mit leerem Ordner)", () => {
    const out: string[] = [];
    const agenten: string[] = [];
    const code = K.hauptlauf(["--von", t(0)], { config: CFG, err: () => {}, out: (s: string) => out.push(s), ordner: () => tmpdir(), wurzel: () => null, ladeTyp: (_d: string, a: string) => (agenten.push(a), []) });
    expect(code).toBe(0);
    expect(agenten).toEqual(["acme-umsetzer"]);
    expect(out.join("\n")).toContain("`acme-umsetzer`");
  });
});

describe("hauptchat-zerlegung: Agenten und Repo-Name aus der Config", () => {
  test("hauptchatNamen: Menge der Ticketlauf-Agenten und Repo-Name", () => {
    const n = H.hauptchatNamen({ config: CFG });
    expect([...n.ticketAgenten].sort()).toEqual(["acme-gruppe", "acme-lens", "acme-planer", "acme-umsetzer"]);
    expect(n.repoName).toBe("acme");
  });
  test("Negativfall (#1821 L11): ein Repo-Name, der einem festen Ergebnisschlüssel gleicht, wirft statt still zu kollidieren", () => {
    for (const schluessel of H.ERGEBNIS_SCHLUESSEL) {
      expect(() => H.hauptchatNamen({ config: { ...CFG, repo: "o/" + schluessel } }), schluessel).toThrow(/Ergebnisschlüssel/);
    }
    expect(H.hauptchatNamen({ config: { ...CFG, repo: "o/rows2" } }).repoName).toBe("rows2");
  });
  test("die festen Ergebnisschlüssel sind genau die der Zerlegung (kein Drift gegen den Ergebnisbau)", () => {
    const r = H.zerlegeHauptchat({ sessions: [], config: CFG });
    expect(Object.keys(r).filter((k) => k !== "acme").sort()).toEqual([...H.ERGEBNIS_SCHLUESSEL].sort());
  });
  test("Negativfall: ohne repo oder ohne Agentenname wirft hauptchatNamen mit Fix", () => {
    expect(() => H.hauptchatNamen({ config: { ...CFG, repo: undefined } })).toThrow(/repo[\s\S]*Fix:/);
    expect(() => H.hauptchatNamen({ config: ohneAgent("gruppe") })).toThrow(/agenten\.gruppe/);
  });
  const sitzung = {
    id: "s",
    main: [user(0, "frag"), call(1)],
    subagents: [
      { meta: { agentType: "acme-umsetzer" }, zeilen: [call(2), call(3)] },
      { meta: { agentType: UMSETZER }, zeilen: [call(4)] },
    ],
  };
  test("ein Subagent mit Namen der Config zählt als eigener (Schlüssel = Repo-Name), der alte Name ist ein Fork", () => {
    const r = H.zerlegeHauptchat({ sessions: [sitzung], config: CFG });
    expect(r.acme.calls).toBe(2);
    expect(repoName(FREMD) in r).toBe(false);
    expect(r.rows.filter((z) => z.quelle === "Fork").reduce((n, z) => n + z.calls, 0)).toBe(1);
  });
  test("renderMarkdown nennt `<Repo-Name>-Subagenten`; ohne passenden repoName wirft es", () => {
    const r = H.zerlegeHauptchat({ sessions: [sitzung], config: CFG });
    expect(H.renderMarkdown(r, { repoName: "acme" })).toContain("acme-Subagenten (nicht Hauptchat): 2 Calls");
    expect(() => H.renderMarkdown(r)).toThrow(/repoName/);
    expect(() => H.renderMarkdown(r, { repoName: "anders" })).toThrow(/repoName/);
  });
});

describe("token-baseline: Umsetzer und Plan-Zeile aus der Config", () => {
  const aufruf = (agentType: string) => ({
    calls: [{ ts: t(1), model: "claude-opus-5-5", input: 1, cacheWrite: 0, cacheRead: 0, output: 1, cost: 0.01, subagent: { agentType, description: "x" } }],
    events: [],
  });
  test("pflegeFehlt: der Umsetzer der Config löst die Warnung aus, der alte Name nicht", () => {
    expect(B.summarize(aufruf("acme-umsetzer"), {}, null, { umsetzer: "acme-umsetzer" }).pflegeFehlt).toBe(true);
    expect(B.summarize(aufruf(UMSETZER), {}, null, { umsetzer: "acme-umsetzer" }).pflegeFehlt).toBe(false);
  });
  test("Negativfall: mit Tool-Events und ohne Umsetzer-Namen wirft summarize, ohne Events nicht", () => {
    expect(() => B.summarize(aufruf("acme-umsetzer"), {}, null, {})).toThrow(/Umsetzer/);
    expect(() => B.summarize(aufruf("acme-umsetzer"), {}, null, { umsetzer: "" })).toThrow(/Umsetzer/);
    expect(() => B.summarize({ calls: aufruf("acme-umsetzer").calls })).not.toThrow();
  });
  const summary = () => B.summarize(aufruf("acme-umsetzer"), {}, null, { umsetzer: "acme-umsetzer" });
  test("die Planer-Angabe trägt die Plan-Zeile der Config", () => {
    expect(B.renderMarkdown(summary(), { nachweis: { runden: 2, plan: true } }, { planZeile: "AB-Plan" })).toContain("Planer: ja (AB-Plan)");
    expect(B.renderMarkdown(summary(), { nachweis: { runden: 2, plan: false } }, { planZeile: "AB-Plan" })).toContain("Planer: nein (AB-Plan)");
  });
  test("Negativfall: ein Nachweis mit Planer-Angabe ohne planZeile wirft; ohne Planer-Angabe oder ohne Nachweis nicht", () => {
    expect(() => B.renderMarkdown(summary(), { nachweis: { runden: 2, plan: true } })).toThrow(/planZeile/);
    expect(() => B.renderMarkdown(summary(), { nachweis: { runden: 2, plan: null } })).not.toThrow();
    expect(() => B.renderMarkdown(summary(), {})).not.toThrow();
  });
});

describe("Langfuse-Abgleich: Worktree-Präfix und Repo-Name aus der Config", () => {
  test("ticketAusBranch: das Präfix der Config trifft, das alte nicht; Wortgrenze davor", () => {
    expect(G.ticketAusBranch("feature/ab-7-x", "ab-")).toBe("ab-7");
    expect(G.ticketAusBranch(`${BRANCH}7`, "ab-")).toBeNull();
    expect(G.ticketAusBranch("feature/xab-7", "ab-")).toBeNull();
    expect(G.ticketAusBranch("ab-7", "ab-")).toBe("ab-7");
    expect(G.ticketAusBranch("feature/ab-7x", "ab-")).toBeNull();
    expect(G.ticketAusBranch(undefined, "ab-")).toBeNull();
    // Regex-Zeichen im Präfix sind wörtlich: der Punkt trifft nur den Punkt.
    expect(G.ticketAusBranch("feature/ab-7", "a.-")).toBeNull();
    expect(G.ticketAusBranch("feature/a.-7", "a.-")).toBe("a.-7");
  });
  test("Negativfall: ohne Präfix wirft ticketAusBranch und sollEintraege", () => {
    expect(() => G.ticketAusBranch("feature/ab-7")).toThrow(/Worktree-Präfix/);
    expect(() => G.ticketAusBranch("feature/ab-7", "")).toThrow(/Worktree-Präfix/);
    expect(() => G.sollEintraege({ id: "s1", main: [], subagents: [] })).toThrow(/Worktree-Präfix/);
  });
  const sitzung = { id: "s1", main: [call(0, { branch: "feature/ab-7-x" })], subagents: [] };
  test("sollEintraege setzt das Ticket aus dem Branch mit dem übergebenen Präfix", () => {
    expect(G.sollEintraege(sitzung, { worktree: "ab-" })[0].ticket).toBe("ab-7");
    expect(G.sollEintraege(sitzung, { worktree: WT })[0].ticket).toBeNull();
  });
  test("scopeName und bauePayloads: Scope, Service und erstes Tag tragen den Repo-Namen", () => {
    expect(O.scopeName("acme")).toBe("acme-abgleich");
    const soll = G.sollEintraege(sitzung, { worktree: "ab-" });
    const { chunks } = O.bauePayloads("s1", soll, { soll, project: "p", repoName: "acme" });
    const rs = chunks[0].payload.resourceSpans[0];
    expect(rs.scopeSpans[0].scope.name).toBe("acme-abgleich");
    expect(rs.resource.attributes.find((a) => a.key === "service.name")?.value.stringValue).toBe("acme-abgleich");
    const tags = rs.scopeSpans[0].spans[0].attributes.find((a) => a.key === "langfuse.trace.tags")?.value.arrayValue?.values.map((v) => v.stringValue);
    expect(tags).toEqual(["acme", "abgleich", "ab-7"]);
  });
  test("Negativfall: bauePayloads ohne repoName wirft", () => {
    const soll = G.sollEintraege(sitzung, { worktree: "ab-" });
    expect(() => O.bauePayloads("s1", soll, { soll, project: "p" })).toThrow(/repoName/);
    expect(() => O.bauePayloads("s1", soll, { soll, project: "p", repoName: "" })).toThrow(/repoName/);
  });
});

describe("kontingent-lib: Log-Pfad aus dem Repo-Namen", () => {
  const ordner: string[] = [];
  afterEach(() => {
    for (const d of ordner.splice(0)) rmSync(d, { recursive: true, force: true });
  });
  test("ohne Umgebungsvariable heißt die Datei <Repo-Name>-gh-kosten.jsonl im Temp-Ordner", () => {
    const p = KL.logPfad({}, { lade: () => CFG });
    expect(p).toBe(join(tmpdir(), "acme-gh-kosten.jsonl"));
  });
  test("FACTORY_GH_KOSTEN_LOG gewinnt, ohne dass die Config geladen wird", () => {
    let geladen = 0;
    expect(KL.logPfad({ FACTORY_GH_KOSTEN_LOG: "X:/eigen.jsonl" }, { lade: () => (geladen += 1, CFG) })).toBe("X:/eigen.jsonl");
    expect(geladen).toBe(0);
  });
  test("Negativfall: ohne repo in der Config wirft logPfad", () => {
    expect(() => KL.logPfad({}, { lade: () => ({}) })).toThrow(/repo[\s\S]*Fix:/);
  });
  const rate = JSON.stringify({ resources: { core: { limit: 5000, remaining: 4000, reset: 2_000_000_000, used: 1000 }, graphql: { limit: 5000, remaining: 4000, reset: 2_000_000_000, used: 1000 } } });
  const messe = (opts: object) => {
    const exits: (() => void)[] = [];
    KL.mitKontingent("probe", { exec: () => rate, schreibe: () => {}, registriere: (f: () => void) => exits.push(f), beende: () => {}, jetzt: () => 1_000_000, ...opts });
    for (const f of exits) f();
  };
  test("mitKontingent schreibt das Protokoll in die Datei aus dem Pfad vom Start (Umgebungsvariable)", () => {
    const dir = mkdtempSync(join(tmpdir(), "mess-1745-"));
    ordner.push(dir);
    const datei = join(dir, "kosten.jsonl");
    messe({ env: { FACTORY_GH_KOSTEN_LOG: datei } });
    expect((JSON.parse(readFileSync(datei, "utf8").trim()) as { skript: string }).skript).toBe("probe");
  });
  test("Negativfall: ist der Pfad nicht bestimmbar (Config unlesbar), läuft mitKontingent weiter und schreibt nichts", () => {
    const dir = mkdtempSync(join(tmpdir(), "mess-1745-"));
    ordner.push(dir);
    // tmpdir() liest TEMP/TMP/TMPDIR zur Laufzeit: jede Ersatzdatei im Temp-Ordner würde hier sichtbar.
    const alt = { TEMP: process.env.TEMP, TMP: process.env.TMP, TMPDIR: process.env.TMPDIR };
    Object.assign(process.env, { TEMP: dir, TMP: dir, TMPDIR: dir });
    try {
      expect(() => messe({ env: {}, lade: () => { throw new Error("Config kaputt"); } })).not.toThrow();
    } finally {
      for (const [k, v] of Object.entries(alt)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
    expect(readdirSync(dir)).toEqual([]);
  });
});

/* Langfuse-Abgleich Soll/Ist (#1562).
 *
 * @harness-waechter – einziger Durchsetzer seiner Regel (nur lesend, Hook-taugliche Import-Hülle), darum im geschützten test/harness/ (#1165).
 *
 * Die Logik lebt in scripts/langfuse-abgleich.mjs (Bewertung, Bericht, CLI) und scripts/langfuse-abgleich-kern.mjs (IDs, Soll, Ist, Diff). Weder ~/.claude noch Langfuse werden angefasst: synthetisches JSONL
 * in einem Temp-Ordner, die Fetch-Schicht bekommt ein injiziertes `fetch`.
 *
 * Ausführen mit: npm test
 */
import { describe, expect, test } from "vitest";
import { readdirSync, readFileSync, statSync, utimesSync } from "node:fs";
import { join, posix } from "node:path";
import { fixture } from "../support/tmp-fixture";
import { lokaleImporteTransitiv } from "./hook-importe";
import { FREMD, projektConfig } from "../support/fremd-config";

// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as rawAbgleichEinstieg from "../../scripts/langfuse-abgleich.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as rawKern from "../../scripts/langfuse-abgleich-kern.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as rawBase from "../../scripts/token-baseline.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as rawPreise from "../../scripts/preise.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as rawCalls from "../../scripts/transkript-calls.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as rawApi from "../../scripts/langfuse-api.mjs";

type Zeilen = Record<string, unknown>[];
type Usage = { input: number; output: number; cacheRead: number; cacheWrite5m: number; cacheWrite1h: number };
type Eintrag = { id: string; traceId: string; session: string; messageId: string; model: string | null; ts: string; usage: Usage; rolle: Record<string, unknown> | null; ticket: string | null };
type Obs = Record<string, unknown>;
type Ist = { calls: number | null; tokens: { input: number; output: number; cacheRead: number; cacheWrite: number } | null };
type Bewertung = { status: string; score: string | null; fehlend: number; dubletten: number; quote: number; callsTranskript: number; callsLangfuse: number; fehlendeCalls: { messageId: string }[] | null; schluessel: string };
type Fetch = (url: string, init?: { method?: string; headers?: Record<string, string> }) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown>; text: () => Promise<string> }>;
// Der Kern (langfuse-abgleich-kern.mjs) trägt IDs, Soll, Sessions, Ist und Diff; der Einstieg Bewertung, Bericht und CLI.
// Das Worktree-Präfix kommt aus der Projekt-Config; die Wrapper reichen es durch, damit die Tests ihre Eingaben wie bisher schreiben.
const WORKTREE = FREMD.praefixe.worktree;
const kernRoh = rawKern as unknown as { sollEintraege: (s: unknown, o: object) => unknown; ticketAusBranch: (b: unknown, w: string) => unknown };
const einstiegRoh = rawAbgleichEinstieg as unknown as { pruefen: (a: unknown, d: object) => unknown };
const A = {
  ...rawAbgleichEinstieg,
  ...rawKern,
  pruefen: (a: unknown, d: object) => einstiegRoh.pruefen(a, { config: FREMD, ...d }),
  sollEintraege: (s: unknown, o?: object) => kernRoh.sollEintraege(s, { worktree: WORKTREE, ...o }),
  ticketAusBranch: (b: unknown) => kernRoh.ticketAusBranch(b, WORKTREE),
} as unknown as {
  RUHEFRIST_MIN: number;
  ROW_LIMIT: number;
  STICHTAG: string;
  nachliefererWartet: (o: { mtime: number; now: number; beendet: boolean }) => boolean;
  standUnveraendert: (eintrag: { mtime?: number; groesse?: number | null } | null | undefined, s: { mtime: number; groesse: number | null }) => boolean;
  endeGiltFuer: (eintrag: { beendet?: boolean; mtime?: number; groesse?: number | null } | null | undefined, s: { mtime: number; groesse: number | null }) => boolean;
  beobachtungsId: (s: string, m: string) => string;
  traceIdVon: (s: string) => string;
  ticketAusBranch: (b: unknown) => string | null;
  sollEintraege: (s: { id: string; main: Zeilen; subagents: { datei: string; meta: Record<string, unknown>; zeilen: Zeilen }[] }, o?: { session?: string }) => Eintrag[];
  findeSessions: (o: { projectsRoot: string; praefix: string; seitMs?: number; sessionId?: string | null; alleOrdner?: boolean }) => { id: string; pfad: string; mtime: number; groesse: number; ausserhalb?: boolean }[];
  istAbfragen: (o: { von: string; bis: string; session?: string | null }) => { zaehlung: Record<string, unknown>; tokens: Record<string, unknown> };
  istAusMetrics: (z: unknown) => Map<string, Ist>;
  schluesselArt: (o: Obs[]) => string;
  diffMultimenge: (soll: Eintrag[], obs: Obs[], art?: string) => { fehlend: Eintrag[]; dubletten: Obs[]; leer: Obs[]; art: string };
  hatDifferenz: (soll: Eintrag[], ist: Ist) => boolean;
  renderMarkdown: (b: Record<string, unknown>[], sum: unknown) => string;
  OHNE_ZUGANG: string;
  AUFRUFHILFE: string;
  bewerteSession: (o: { soll: Eintrag[]; ist: Ist; mtime: number; now: number; diff?: { fehlend: Eintrag[]; dubletten: Obs[]; art: string } | null; ledgerEintrag?: { beendet?: boolean; mtime?: number; groesse?: number | null } | null; groesse?: number | null; ausserhalb?: boolean }) => Bewertung;
  summenzeile: (b: Bewertung[]) => { sessions: number; laeuft: number; callsTranskript: number; callsLangfuse: number; fehlend: number; dubletten: number; quote: number; scoreAusstehend: number; vorStichtag: number };
  pruefen: (
    args: { pruefen: boolean; json: boolean; seit: string | null; session: string | null; ist: string[]; fehler?: string },
    d: { env?: Record<string, string>; now?: number; projectsRoot: string; repoRoot: string; fetchImpl?: Fetch; leseDatei?: (p: string) => string; stateDir?: string | null; config?: unknown },
  ) => Promise<{ exitCode: number; text: string }>;
  parseArgs: (a: string[]) => { pruefen: boolean; json: boolean; seit: string | null; session: string | null; ist: string[]; fehler?: string };
};
const BASE = rawBase as unknown as Record<string, unknown>;
const PREISE = rawPreise as unknown as Record<string, unknown>;
const CALLS = rawCalls as unknown as { callsFromTranscript: (t: string | Zeilen) => { calls: { messageId: string; sessionId: string | null; gitBranch: string | null; output: number }[] } };
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as rawTranskript from "../../scripts/transkript.mjs";

const API = rawApi as unknown as Record<string, unknown>;

const LADE = (rawTranskript as unknown as { ladeSessionDatei: (p: string) => Parameters<typeof A.sollEintraege>[0] }).ladeSessionDatei;
const row = (s: string) => JSON.parse(s) as Record<string, unknown>;
const zeile = (o: Record<string, unknown>) => JSON.stringify(o);
let zaehler = 0;
/** Eine Assistant-Zeile; `id` ist die message.id, `usage` überschreibt die Defaults. */
const msg = (id: string, usage: Record<string, unknown> | null = {}, extra: Record<string, unknown> = {}) =>
  zeile({
    type: "assistant",
    sessionId: "s1",
    gitBranch: `${FREMD.praefixe.branch}1562-x`,
    timestamp: new Date(Date.UTC(2026, 9, 9, 10, 0, zaehler++)).toISOString(),
    uuid: `u-${id}-${zaehler}`,
    message: {
      id,
      role: "assistant",
      model: "claude-opus-5-5",
      ...(usage === null ? {} : { usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 100, cache_creation_input_tokens: 40, cache_creation: { ephemeral_1h_input_tokens: 30 }, ...usage } }),
      content: [{ type: "text", text: "x" }],
    },
    ...extra,
  });

const REPO = "X:/repo";
const PRAEFIX = "X--repo";

describe("Auslagerung: Re-Export statt Kopie, hook-taugliche Import-Hülle", () => {
  test("token-baseline re-exportiert dieselben Funktionen (Identität)", () => {
    for (const n of ["PRICES", "PRICES_STAND", "periodAt", "priceParts", "priceCall"]) expect(BASE[n]).toBe(PREISE[n]);
    expect(BASE.callsFromTranscript).toBe(CALLS.callsFromTranscript);
    expect(BASE.fetchSessionObservations).toBe(API.fetchSessionObservations);
  });

  test("langfuse-abgleich zieht weder token-baseline noch gh-/git-Module nach", () => {
    const lies = (rel: string) => readFileSync(join(__dirname, "../..", rel), "utf8");
    const kette = lokaleImporteTransitiv(["scripts/langfuse-abgleich.mjs"], lies);
    expect(kette).toEqual(expect.arrayContaining(["scripts/preise.mjs", "scripts/transkript-calls.mjs", "scripts/langfuse-api.mjs", "scripts/transkript.mjs"]));
    for (const verboten of ["token-baseline.mjs", "gh-cli.mjs", "ci-laeufe.mjs", "slice-override.mjs"]) expect(kette.map((k) => posix.basename(k))).not.toContain(verboten);
  });

  test("der Stichtag hat genau eine Definition (Kern); Einstieg und Nachlieferer tragen kein Datumsliteral und kein Ledger-Lesen mehr", () => {
    const lies = (rel: string) => readFileSync(join(__dirname, "../..", rel), "utf8");
    expect(lies("scripts/langfuse-abgleich-kern.mjs").match(/export const STICHTAG = "/g)).toHaveLength(1);
    for (const einstieg of ["scripts/langfuse-abgleich.mjs", "scripts/langfuse-nachliefern.mjs"]) {
      const text = lies(einstieg);
      expect(text, einstieg).not.toMatch(/\d{4}-\d{2}-\d{2}/);
      expect(text, einstieg).not.toMatch(/const STICHTAG|function ledgerLesen/);
    }
  });
});

describe("callsFromTranscript liefert messageId, sessionId, gitBranch", () => {
  test("Felder aus der ersten Zeile; Rückfall uuid ohne message.id", () => {
    const text = [msg("m1"), zeile({ type: "assistant", uuid: "nur-uuid", timestamp: "2026-10-09T10:00:00Z", message: { model: "x", usage: { output_tokens: 1 }, content: [] } })].join("\n");
    const { calls } = CALLS.callsFromTranscript(text);
    expect(calls[0]).toMatchObject({ messageId: "m1", sessionId: "s1", gitBranch: `${FREMD.praefixe.branch}1562-x` });
    expect(calls[1].messageId).toBe("nur-uuid");
    expect(calls[1].sessionId).toBeNull();
  });
});

describe("IDs", () => {
  test("Golden: feste Hex-Werte (eine geänderte Formel bricht die Idempotenz von 2/3)", () => {
    expect(A.beobachtungsId("s1", "msg_1")).toBe("c2d9e398acdd8ca3");
    expect(A.traceIdVon("s1")).toBe("e8bc163c82eee18733288c7d4ac636db");
  });
  test("hängen von Session und Message ab; Länge 16 bzw. 32", () => {
    expect(A.beobachtungsId("s1", "a")).not.toBe(A.beobachtungsId("s2", "a"));
    expect(A.beobachtungsId("s1", "a")).not.toBe(A.beobachtungsId("s1", "b"));
    expect(A.beobachtungsId("s1", "a")).toHaveLength(16);
    expect(A.traceIdVon("s1")).toHaveLength(32);
    expect(A.traceIdVon("s1")).toBe(A.traceIdVon("s1"));
  });
});

describe("Soll (pur)", () => {
  const sitzung = (main: string, subs: { meta?: string; text: string }[] = []) => {
    const files: Record<string, string> = { "p/s1.jsonl": main };
    subs.forEach((s, i) => {
      files[`p/s1/subagents/a${i}.jsonl`] = s.text;
      if (s.meta !== undefined) files[`p/s1/subagents/a${i}.meta.json`] = s.meta;
    });
    return { root: fixture(files) };
  };
  const lade = (root: string) => {
    // ladeSessionDatei über den Weg des Abgleichs: findeSessions + Soll
    const [s] = A.findeSessions({ projectsRoot: root, praefix: "p" });
    return s;
  };

  test("mehrere Zeilen je message.id ergeben einen Eintrag, Output = Maximum", () => {
    const e = A.sollEintraege({ id: "s1", main: [row(msg("m", { output_tokens: 3 })), row(msg("m", { output_tokens: 9 })), row(msg("m", { output_tokens: 4 }))], subagents: [] });
    expect(e).toHaveLength(1);
    expect(e[0].usage.output).toBe(9);
  });

  test("Assistant ohne usage ergibt keinen Eintrag", () => {
    expect(A.sollEintraege({ id: "s1", main: [row(msg("m", null))], subagents: [] })).toEqual([]);
  });

  test("Felder: IDs, Modell, Ticket, getrennter Cache-Write, Rolle des Hauptchats null", () => {
    const [e] = A.sollEintraege({ id: "s1", main: [row(msg("m"))], subagents: [] });
    expect(e).toMatchObject({ id: A.beobachtungsId("s1", "m"), traceId: A.traceIdVon("s1"), session: "s1", messageId: "m", model: "claude-opus-5-5", ticket: `${WORKTREE}1562`, rolle: null });
    expect(e.usage).toEqual({ input: 10, output: 5, cacheRead: 100, cacheWrite5m: 10, cacheWrite1h: 30 });
  });

  test("die 1h-Aufteilung wird auf die Summe gekappt", () => {
    const [e] = A.sollEintraege({ id: "s1", main: [row(msg("m", { cache_creation_input_tokens: 5, cache_creation: { ephemeral_1h_input_tokens: 50 } }))], subagents: [] });
    expect(e.usage).toMatchObject({ cacheWrite5m: 0, cacheWrite1h: 5 });
  });

  test("Ticket aus dem Branch; main und fehlender Branch ergeben null", () => {
    expect(A.ticketAusBranch(`${FREMD.praefixe.branch}1562-x`)).toBe(`${WORKTREE}1562`);
    expect(A.ticketAusBranch("main")).toBeNull();
    expect(A.ticketAusBranch(undefined)).toBeNull();
    expect(A.ticketAusBranch(`${FREMD.praefixe.branch}abc`)).toBeNull();
  });

  test("kaputtes meta.json ergibt Rolle ohne agentType, der Eintrag bleibt; kaputte und abgeschnittene Zeilen entfallen", () => {
    const { root } = sitzung(`${msg("m1")}\n{kaputt\n${msg("m2")}\n{"abgeschnitten`, [{ meta: "{nicht json", text: `${msg("sub")}\n` }]);
    const [s] = A.findeSessions({ projectsRoot: root, praefix: "p" });
    expect(s).toBeDefined();
    const e = A.sollEintraege(LADE(s.pfad));
    expect(e.map((x) => x.messageId).sort()).toEqual(["m1", "m2", "sub"]);
    const sub = e.find((x) => x.messageId === "sub");
    expect(sub?.rolle?.agentType).toBeUndefined();
    expect(sub?.rolle).not.toBeNull();
  });

  test("Rolle trägt die agentId aus dem Dateinamen (agent-<id>.jsonl)", () => {
    const e = A.sollEintraege({ id: "s1", main: [], subagents: [{ datei: "agent-abc123.jsonl", meta: { agentType: "t" }, zeilen: [row(msg("x"))] }] });
    expect(e[0].rolle).toMatchObject({ agentId: "abc123", agentType: "t" });
  });

  test("Rolle und Zusammenführung über Dateien: erster Fund bestimmt die Rolle, Output = Maximum", () => {
    const { root } = sitzung(msg("dup", { output_tokens: 2 }), [{ meta: JSON.stringify({ agentType: FREMD.agenten.lens, description: "L", parentAgentId: "p" }), text: msg("dup", { output_tokens: 8 }) + "\n" + msg("nur-sub") }]);
    const e = A.sollEintraege(LADE(lade(root).pfad));
    expect(e).toHaveLength(2);
    const dup = e.find((x) => x.messageId === "dup");
    expect(dup?.usage.output).toBe(8);
    expect(dup?.rolle).toBeNull();
    expect(e.find((x) => x.messageId === "nur-sub")?.rolle).toMatchObject({ agentType: FREMD.agenten.lens, parentAgentId: "p" });
  });
});

describe("Session-Auswahl", () => {
  test("fremder Projektordner wird nicht gelesen; Worktree-Ordner des Projekts schon; --seit filtert nach mtime, --session nicht", () => {
    const root = fixture({
      [`${PRAEFIX}/a.jsonl`]: msg("m"),
      [`${PRAEFIX}--claude-worktrees-wt-1/b.jsonl`]: msg("m"),
      "Y--anders/c.jsonl": msg("m"),
      [`${PRAEFIX}-alt/d.jsonl`]: msg("m"), // Geschwister-Repo mit gleichem Präfix (#1572)
    });
    const ids = (o: Partial<Parameters<typeof A.findeSessions>[0]>) => A.findeSessions({ projectsRoot: root, praefix: PRAEFIX, ...o }).map((s) => s.id).sort();
    expect(ids({})).toEqual(["a", "b"]);
    expect(ids({ seitMs: Date.now() + 3_600_000 })).toEqual([]);
    expect(ids({ seitMs: Date.now() + 3_600_000, sessionId: "a" })).toEqual(["a"]);
    expect(ids({ sessionId: "c" })).toEqual([]);
    expect(ids({ sessionId: "d" })).toEqual([]);
  });

  test("Präfix-Grenze: Geschwister-Repo mit gleichem Namensanfang wird nicht gelesen, Worktree-Ordner schon; groesse summiert Haupt- und Subagent-Dateien", () => {
    const root = fixture({
      [`${PRAEFIX}/a.jsonl`]: "12345",
      [`${PRAEFIX}/a/subagents/agent-x.jsonl`]: "123",
      [`${PRAEFIX}-tools/fremd.jsonl`]: msg("m"),
      [`${PRAEFIX}--claude-worktrees-wt-1/b.jsonl`]: msg("m"),
    });
    const sessions = A.findeSessions({ projectsRoot: root, praefix: PRAEFIX });
    expect(sessions.map((s) => s.id).sort()).toEqual(["a", "b"]);
    expect(sessions.find((s) => s.id === "a")?.groesse).toBe(8);
  });

  test("alleOrdner (#1862) wirkt nur mit sessionId: findet die Session außerhalb samt Markierung, ohne sessionId bleibt es beim Projekt", () => {
    const root = fixture({
      [`${PRAEFIX}/a.jsonl`]: msg("m"),
      "Y--anders/c.jsonl": msg("m"),
      [`${PRAEFIX}-alt/d.jsonl`]: msg("m"),
    });
    const f = (o: Partial<Parameters<typeof A.findeSessions>[0]>) => A.findeSessions({ projectsRoot: root, praefix: PRAEFIX, ...o });
    expect(f({ alleOrdner: true }).map((s) => s.id).sort()).toEqual(["a"]);
    expect(f({ sessionId: "c" })).toEqual([]);
    expect(f({ sessionId: "c", alleOrdner: true })).toMatchObject([{ id: "c", ausserhalb: true }]);
    expect(f({ sessionId: "d", alleOrdner: true })).toMatchObject([{ id: "d", ausserhalb: true }]);
    expect(f({ sessionId: "a", alleOrdner: true })[0].ausserhalb).toBeFalsy();
    expect(f({ sessionId: "gibt-es-nicht", alleOrdner: true })).toEqual([]);
  });

  test("fehlender Projektordner ergibt keine Sessions", () => {
    expect(A.findeSessions({ projectsRoot: join(fixture({}), "gibt-es-nicht"), praefix: PRAEFIX })).toEqual([]);
  });
});

describe("Ist: Abfragen und Antwortformen", () => {
  test("Abfragen: GENERATION-Filter, Dimension sessionId, orderBy desc, row_limit; --session filtert zusätzlich", () => {
    const q = A.istAbfragen({ von: "2026-10-01T00:00:00Z", bis: "2026-10-09T00:00:00Z" });
    expect(q.zaehlung).toMatchObject({ view: "observations", dimensions: [{ field: "sessionId" }], config: { row_limit: A.ROW_LIMIT }, orderBy: [{ field: "count_count", direction: "desc" }] });
    expect(q.zaehlung.filters).toEqual([{ column: "type", operator: "=", value: "GENERATION", type: "string" }]);
    expect(q.tokens.dimensions).toEqual([{ field: "sessionId" }, { field: "usageType" }]);
    const mit = A.istAbfragen({ von: "a", bis: "b", session: "s9" });
    expect((mit.zaehlung.filters as unknown[]).at(-1)).toMatchObject({ column: "sessionId", value: "s9" });
  });

  test("beide Formen, Zahlen als String, Token-Typen werden zu vier Summen", () => {
    const rows = [
      { sessionId: "s1", count_count: "7" },
      { sessionId: "s1", usageType: "input", sum_usageByType: "10" },
      { sessionId: "s1", usageType: "output", sum_usageByType: 5 },
      { sessionId: "s1", usageType: "cache_read_input_tokens", sum_usageByType: 100 },
      { sessionId: "s1", usageType: "input_cache_creation_5m", sum_usageByType: 10 },
      { sessionId: "s1", usageType: "input_cache_creation_1h", sum_usageByType: 30 },
      { sessionId: "s1", usageType: "cache_creation_input_tokens", sum_usageByType: 999 },
      { sessionId: "s1", usageType: "total", sum_usageByType: 12345 },
    ];
    const erwartet = { calls: 7, tokens: { input: 10, output: 5, cacheRead: 100, cacheWrite: 40 } };
    expect(A.istAusMetrics({ data: rows }).get("s1")).toEqual(erwartet);
    expect(A.istAusMetrics(rows).get("s1")).toEqual(erwartet);
  });

  test("nur Summe ohne Aufteilung zählt als Cache-Write; nur Zählung ergibt tokens null", () => {
    const m = A.istAusMetrics([{ sessionId: "a", usageType: "cache_creation_input_tokens", sum_usageByType: 8 }, { sessionId: "b", count_count: 2 }]);
    expect(m.get("a")?.tokens?.cacheWrite).toBe(8);
    expect(m.get("b")).toEqual({ calls: 2, tokens: null });
  });

  test("unbekannte Form wirft", () => {
    expect(() => A.istAusMetrics({ foo: 1 })).toThrow(/Unbekannte Metrics-Form/);
    expect(() => A.istAusMetrics([{ id: "x" }])).toThrow(/sessionId/);
    expect(() => A.istAusMetrics("text")).toThrow();
  });
});

const eintrag = (n: number, over: Partial<Eintrag> = {}): Eintrag => ({
  id: `i${n}`,
  traceId: "t",
  session: "s1",
  messageId: `m${n}`,
  model: "claude-opus-5-5",
  ts: `2026-10-09T10:00:0${n}Z`,
  usage: { input: n, output: 5, cacheRead: 100, cacheWrite5m: 10, cacheWrite1h: 30 },
  rolle: null,
  ticket: `${WORKTREE}1562`,
  ...over,
});
const obsZu = (e: Eintrag, extra: Obs = {}): Obs => ({
  id: `o-${e.messageId}`,
  type: "GENERATION",
  providedModelName: e.model,
  usageDetails: { input: e.usage.input, output: e.usage.output, cache_read_input_tokens: e.usage.cacheRead, input_cache_creation_5m: e.usage.cacheWrite5m, input_cache_creation_1h: e.usage.cacheWrite1h },
  metadata: {},
  ...extra,
});

describe("Diff (pur)", () => {
  test("Teil-Erfassung: 3 Soll, 2 Ist, genau der richtige fehlt, Quote 66,7 %", () => {
    const soll = [eintrag(1), eintrag(2), eintrag(3)];
    const d = A.diffMultimenge(soll, [obsZu(soll[0]), obsZu(soll[2])]);
    expect(d.fehlend.map((e) => e.messageId)).toEqual(["m2"]);
    expect(d.dubletten).toEqual([]);
    const b = A.bewerteSession({ soll, ist: { calls: 2, tokens: null }, mtime: 0, now: 1e12, diff: d });
    expect(b.status).toBe("Lücke");
    expect(b.quote).toBeCloseTo(2 / 3, 5);
  });

  test("Dublette: 2 Ist auf 1 Soll, eine Dublette, nichts fehlt", () => {
    const soll = [eintrag(1)];
    const d = A.diffMultimenge(soll, [obsZu(soll[0], { id: "a" }), obsZu(soll[0], { id: "b" })]);
    expect(d.fehlend).toEqual([]);
    expect(d.dubletten).toHaveLength(1);
    expect(A.bewerteSession({ soll, ist: { calls: 2, tokens: null }, mtime: 0, now: 1e12, diff: d }).status).toBe("Dublette");
  });

  test("Leere Hook-Generationen (Modell claude, keine Tokens) sind keine Dubletten, sondern leer (#1639)", () => {
    const soll = [eintrag(1), eintrag(2)];
    const leer: Obs = { id: "leer1", type: "GENERATION", providedModelName: "claude", usageDetails: {}, metadata: {} };
    const d = A.diffMultimenge(soll, [obsZu(soll[0]), leer, { ...leer, id: "leer2" }]);
    expect(d.fehlend.map((e) => e.messageId)).toEqual(["m2"]);
    expect(d.dubletten).toEqual([]);
    expect(d.leer.map((o) => o.id)).toEqual(["leer1", "leer2"]);
  });

  test("Eine echte Dublette neben leeren Generationen bleibt Dublette; Soll mit Null-Tokens deckt eine leere ab", () => {
    const soll = [eintrag(1)];
    const leer: Obs = { id: "leer1", type: "GENERATION", providedModelName: "claude", usageDetails: {}, metadata: {} };
    const d = A.diffMultimenge(soll, [obsZu(soll[0], { id: "a" }), obsZu(soll[0], { id: "b" }), leer]);
    expect(d.dubletten.map((o) => o.id)).toEqual(["b"]);
    // Eine Observation mit Message-ID und null Tokens ist keine leere Hook-Generation, sondern bleibt Dublette.
    const mitId: Obs = { ...leer, id: "mitid", metadata: { message_id: "zz" } };
    const d3 = A.diffMultimenge(soll, [obsZu(soll[0]), leer, mitId]);
    expect(d3.dubletten.map((o) => o.id)).toEqual(["mitid"]);
    expect(A.bewerteSession({ soll, ist: { calls: 3, tokens: null }, mtime: 0, now: 1e12, diff: d3 })).toMatchObject({ dubletten: 1, leer: 1 });
    const nullEintrag = eintrag(3, { model: "claude", usage: { input: 0, output: 0, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0 } });
    const d2 = A.diffMultimenge([nullEintrag], [leer]);
    expect(d2.fehlend).toEqual([]);
  });

  test("Multimenge: zwei Soll mit gleichem Fingerabdruck, eine Observation, ein Call fehlt", () => {
    const a = eintrag(1);
    const b = eintrag(1, { messageId: "m1b" });
    const d = A.diffMultimenge([a, b], [obsZu(a)]);
    expect(d.fehlend).toHaveLength(1);
    expect(d.art).toBe("fingerprint");
  });

  test("Schlüsselwahl: alle mit message_id: messageId; gemischt oder leer: Fingerabdruck", () => {
    const soll = [eintrag(1), eintrag(2)];
    const mit = soll.map((e) => obsZu(e, { metadata: { message_id: e.messageId } }));
    expect(A.schluesselArt(mit)).toBe("messageId");
    expect(A.schluesselArt([mit[0], obsZu(soll[1])])).toBe("fingerprint");
    expect(A.schluesselArt([])).toBe("fingerprint");
    // exakter Schlüssel: gleiche Tokens, andere message_id zählt NICHT als Treffer
    const d = A.diffMultimenge([soll[0]], [obsZu(soll[0], { metadata: { message_id: "andere" } })]);
    expect(d.fehlend).toHaveLength(1);
    expect(d.dubletten).toHaveLength(1);
  });

  test("passende message_id trifft: nichts fehlt, keine Dublette", () => {
    const soll = [eintrag(1), eintrag(2)];
    const d = A.diffMultimenge(soll, soll.map((e) => obsZu(e, { metadata: { message_id: e.messageId } })));
    expect(d).toMatchObject({ art: "messageId", fehlend: [], dubletten: [] });
  });

  test("fehlend und Dublette zugleich: Status Lücke, Summenzeile zählt beides", () => {
    const soll = [eintrag(1), eintrag(2)];
    const d = A.diffMultimenge(soll, [obsZu(soll[0], { id: "a" }), obsZu(soll[0], { id: "b" })]);
    expect(d.fehlend).toHaveLength(1);
    expect(d.dubletten).toHaveLength(1);
    const b = A.bewerteSession({ soll, ist: { calls: 2, tokens: null }, mtime: 0, now: 1e12, diff: d });
    expect(b.status).toBe("Lücke");
    expect(A.summenzeile([b])).toMatchObject({ fehlend: 1, dubletten: 1, callsLangfuse: 2 });
  });

  test("Fingerabdruck unterscheidet Modell und Cache-Write-Aufteilung", () => {
    const e = eintrag(1);
    expect(A.diffMultimenge([e], [obsZu(e, { providedModelName: "anderes" })]).fehlend).toHaveLength(1);
    expect(A.diffMultimenge([e], [obsZu(e, { usageDetails: { input: 1, output: 5, cache_read_input_tokens: 100, cache_creation_input_tokens: 40 } })]).fehlend).toHaveLength(1);
  });

  test("Session fehlt ganz: alles fehlt, Quote 0, Status Lücke", () => {
    const soll = [eintrag(1), eintrag(2)];
    const b = A.bewerteSession({ soll, ist: { calls: 0, tokens: null }, mtime: 0, now: 1e12 });
    expect(b).toMatchObject({ fehlend: 2, dubletten: 0, quote: 0, status: "Lücke" });
  });

  test("Zählebene ohne Observations: Dubletten und fehlend aus der Differenz", () => {
    const soll = [eintrag(1)];
    expect(A.bewerteSession({ soll, ist: { calls: 3, tokens: null }, mtime: 0, now: 1e12 })).toMatchObject({ fehlend: 0, dubletten: 2, status: "Dublette" });
  });

  test("gleiche Zahl, andere Tokens: Status Abweichung; gleiche Tokens: vollständig", () => {
    const soll = [eintrag(1)];
    const tok = { input: 1, output: 5, cacheRead: 100, cacheWrite: 40 };
    expect(A.bewerteSession({ soll, ist: { calls: 1, tokens: tok }, mtime: 0, now: 1e12 }).status).toBe("vollständig");
    expect(A.bewerteSession({ soll, ist: { calls: 1, tokens: { ...tok, output: 6 } }, mtime: 0, now: 1e12 }).status).toBe("Abweichung");
    expect(A.hatDifferenz(soll, { calls: 1, tokens: tok })).toBe(false);
    expect(A.hatDifferenz(soll, { calls: 1, tokens: { ...tok, input: 9 } })).toBe(true);
    expect(A.hatDifferenz(soll, { calls: 2, tokens: null })).toBe(true);
  });

  test("Ruhefrist: vor 10 min läuft (nicht in Σ und Quote), vor 31 min Lücke", () => {
    const soll = [eintrag(1), eintrag(2)];
    const now = 1_000_000_000_000;
    const laeuft = A.bewerteSession({ soll, ist: { calls: 0, tokens: null }, mtime: now - 10 * 60_000, now });
    const luecke = A.bewerteSession({ soll, ist: { calls: 0, tokens: null }, mtime: now - 31 * 60_000, now });
    expect(laeuft.status).toBe("läuft");
    expect(luecke.status).toBe("Lücke");
    const ok = A.bewerteSession({ soll: [eintrag(3)], ist: { calls: 1, tokens: null }, mtime: 0, now });
    const sum = A.summenzeile([laeuft, ok]);
    expect(sum).toMatchObject({ sessions: 1, laeuft: 1, callsTranskript: 1, callsLangfuse: 1, fehlend: 0, quote: 1 });
    expect(A.summenzeile([luecke, ok])).toMatchObject({ sessions: 2, callsTranskript: 3, fehlend: 2 });
  });
});

const NL = String.fromCharCode(10);
describe("Score außerhalb (#1862)", () => {
  const now = 1_000_000_000_000;
  const bew = (o: Record<string, unknown> = {}) => A.bewerteSession({ soll: [eintrag(1)], ist: { calls: 1, tokens: null }, mtime: now - 60 * 60_000, now, ...o });

  test("außerhalb hat Vorrang vor ausstehend und vor Stichtag, bei läuft bleibt der Score null, ohne Flag ändert sich nichts", () => {
    expect(bew()).toMatchObject({ score: "ausstehend", ausserhalb: false });
    expect(bew({ ausserhalb: true })).toMatchObject({ score: "außerhalb", ausserhalb: true });
    expect(bew({ ausserhalb: true, soll: [{ ...eintrag(1), ts: "2020-01-01T00:00:00.000Z" }] }).score).toBe("außerhalb");
    expect(bew({ ausserhalb: true, mtime: now - 60_000 })).toMatchObject({ status: "läuft", score: null });
  });

  test("Bericht: Hinweiszeile nur bei Sessions außerhalb", () => {
    const aus = bew({ ausserhalb: true });
    const drin = bew();
    const md = (b: Record<string, unknown>[]) => A.renderMarkdown(b, A.summenzeile(b as unknown as Bewertung[]));
    expect(md([aus])).toMatch(/Hinweis .*außerhalb des Projekts/);
    expect(md([drin])).not.toMatch(/außerhalb des Projekts/);
  });

  test("Bericht: der Kostenbefehl in der Hinweiszeile trägt die volle Session-ID", () => {
    const id = "abcdef12-3456-7890-abcd-ef1234567890";
    const md = A.renderMarkdown([{ ...bew({ ausserhalb: true }), session: id }], A.summenzeile([bew({ ausserhalb: true })]));
    expect(md).toContain(`token-baseline.mjs --session ${id}`);
  });
});

describe("Score ausstehend und vor Stichtag (getrennt vom Status)", () => {
  const now = 1_000_000_000_000;
  const bew = (o: Record<string, unknown> = {}) => A.bewerteSession({ soll: [eintrag(1)], ist: { calls: 1, tokens: null }, mtime: now - 60 * 60_000, now, ...o });

  test("ohne bekanntes Ende wartet der Nachlieferer 24 h: vollständig, Score ausstehend; danach null", () => {
    expect(bew()).toMatchObject({ status: "vollständig", score: "ausstehend" });
    expect(bew({ mtime: now - 25 * 3_600_000 }).score).toBeNull();
    expect(bew({ mtime: now - 23 * 3_600_000 }).score).toBe("ausstehend");
  });

  test("bekanntes Ende laut Ledger: 150 s Ruhe genügen, aber nur bei passender mtime", () => {
    const mtime = now - 60 * 60_000;
    expect(bew({ mtime, groesse: 100, ledgerEintrag: { beendet: true, mtime, groesse: 100 } }).score).toBeNull();
    // darf NICHT passieren: ein Ende zu einem anderen Stand der Datei oder ohne beendet-Flag zählt
    expect(bew({ mtime, groesse: 100, ledgerEintrag: { beendet: true, mtime: mtime - 1, groesse: 100 } }).score).toBe("ausstehend");
    expect(bew({ mtime, groesse: 100, ledgerEintrag: { beendet: false, mtime, groesse: 100 } }).score).toBe("ausstehend");
  });

  test("bekanntes Ende gilt nur für denselben Dateistand: gleiche mtime, andere Größe heißt ausstehend (#1609)", () => {
    const mtime = now - 60 * 60_000;
    expect(bew({ mtime, groesse: 200, ledgerEintrag: { beendet: true, mtime, groesse: 100 } }).score).toBe("ausstehend");
    expect(bew({ mtime, groesse: null, ledgerEintrag: { beendet: true, mtime, groesse: 100 } }).score).toBe("ausstehend");
  });

  test("standUnveraendert und endeGiltFuer: eine Definition für Nachlieferer und Abgleich (#1609)", () => {
    const s = { mtime: 5, groesse: 10 };
    expect(A.standUnveraendert({ mtime: 5, groesse: 10 }, s)).toBe(true);
    expect(A.standUnveraendert(null, s)).toBe(false);
    expect(A.standUnveraendert(undefined, s)).toBe(false);
    expect(A.standUnveraendert({ mtime: 6, groesse: 10 }, s)).toBe(false);
    expect(A.standUnveraendert({ mtime: 5, groesse: 11 }, s)).toBe(false);
    expect(A.standUnveraendert({ mtime: 5, groesse: null }, { mtime: 5, groesse: null })).toBe(false);
    expect(A.standUnveraendert({ mtime: 5 }, { mtime: 5, groesse: null })).toBe(false);
    expect(A.endeGiltFuer({ beendet: true, mtime: 5, groesse: 10 }, s)).toBe(true);
    expect(A.endeGiltFuer({ beendet: false, mtime: 5, groesse: 10 }, s)).toBe(false);
    expect(A.endeGiltFuer({ beendet: true, mtime: 5, groesse: 11 }, s)).toBe(false);
    expect(A.endeGiltFuer(null, s)).toBe(false);
  });

  test("Session in der Ruhefrist des Abgleichs hat keinen Score-Vermerk, eine vor dem Stichtag den eigenen", () => {
    expect(bew({ mtime: now - 10 * 60_000 })).toMatchObject({ status: "läuft", score: null });
    const alt = bew({ soll: [eintrag(1, { ts: "2026-10-06T23:59:59Z" })], mtime: now - 25 * 3_600_000 });
    expect(alt.score).toBe("vor Stichtag");
    expect(bew({ soll: [eintrag(1, { ts: "2026-10-07T00:00:00Z" })], mtime: now - 25 * 3_600_000 }).score).toBeNull();
  });

  test("Grenzen der Fristen: genau 24 h (ohne Ende) bzw. 150 s (mit Ende) warten nicht mehr, eine Millisekunde davor noch", () => {
    expect(A.nachliefererWartet({ mtime: now - 24 * 3_600_000 + 1, now, beendet: false })).toBe(true);
    expect(A.nachliefererWartet({ mtime: now - 24 * 3_600_000, now, beendet: false })).toBe(false);
    expect(A.nachliefererWartet({ mtime: now - 150_000 + 1, now, beendet: true })).toBe(true);
    expect(A.nachliefererWartet({ mtime: now - 150_000, now, beendet: true })).toBe(false);
  });

  test("Summenzeile zählt beides unter den festen Sessions, nicht unter läuft", () => {
    const sum = A.summenzeile([bew(), bew(), bew({ mtime: now - 25 * 3_600_000 }), bew({ mtime: now - 10 * 60_000 }), bew({ soll: [eintrag(1, { ts: "2026-10-01T00:00:00Z" })], mtime: now - 25 * 3_600_000 })]);
    expect(sum).toMatchObject({ sessions: 4, laeuft: 1, scoreAusstehend: 2, vorStichtag: 1 });
  });
});

describe("pruefen (Ablauf)", () => {
  const args = (o: Partial<ReturnType<typeof A.parseArgs>> = {}) => ({ pruefen: true, json: false, seit: null, session: null, ist: [], ...o });
  const mitSession = (calls: string[]) => fixture({ [`${PRAEFIX}/s1.jsonl`]: calls.join("\n") });
  const ZUGANG = { LANGFUSE_PUBLIC_KEY: "pk", LANGFUSE_SECRET_KEY: "sk", LANGFUSE_BASE_URL: "http://lf.test" };
  const SPAET = () => Date.now() + 60 * 60_000; // Session gilt als ruhig
  const antwort = (body: unknown, status = 200) => Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(body), text: () => Promise.resolve(JSON.stringify(body)) });

  /** Ein Langfuse-Mock: zählt Aufrufe, antwortet je nach Pfad. */
  const mock = (o: { zaehlung?: unknown[]; zaehlungFn?: (q: Record<string, unknown>) => unknown[]; tokensFn?: (q: Record<string, unknown>) => unknown[]; tokens?: unknown[]; observations?: Obs[]; status?: number }) => {
    const aufrufe: { url: string; method?: string; auth?: string }[] = [];
    const queries: Record<string, unknown>[] = [];
    const fetchImpl: Fetch = (url, init) => {
      aufrufe.push({ url, method: init?.method, auth: init?.headers?.Authorization });
      if (o.status) return antwort({ error: "kaputt" }, o.status);
      if (url.includes("/v2/observations")) return antwort({ data: o.observations ?? [], meta: {} });
      const q = JSON.parse(new URL(url).searchParams.get("query") ?? "{}") as { dimensions: unknown[] };
      queries.push(q);
      return antwort({ data: q.dimensions.length === 1 ? (o.zaehlungFn ? o.zaehlungFn(q) : (o.zaehlung ?? [])) : (o.tokensFn ? o.tokensFn(q) : (o.tokens ?? [])) });
    };
    return { aufrufe, queries, fetchImpl };
  };
  const tokenZeilen = (id: string, t: { input: number; output: number; cacheRead: number; w5: number; w1: number }) => [
    { sessionId: id, usageType: "input", sum_usageByType: t.input },
    { sessionId: id, usageType: "output", sum_usageByType: t.output },
    { sessionId: id, usageType: "cache_read_input_tokens", sum_usageByType: t.cacheRead },
    { sessionId: id, usageType: "input_cache_creation_5m", sum_usageByType: t.w5 },
    { sessionId: id, usageType: "input_cache_creation_1h", sum_usageByType: t.w1 },
  ];

  test("ohne Zugang und ohne --ist: Exit 2 und Hinweis auf --ist", async () => {
    const root = mitSession([msg("a")]);
    const r = await A.pruefen(args(), { env: {}, projectsRoot: root, repoRoot: REPO });
    expect(r.exitCode).toBe(2);
    expect(r.text).toMatch(/--ist/);
  });

  test("ohne --pruefen: Aufrufhilfe, Exit 2", async () => {
    const r = await A.pruefen(args({ pruefen: false }), { env: ZUGANG, projectsRoot: "x", repoRoot: REPO });
    expect(r.exitCode).toBe(2);
    expect(r.text).toMatch(/Aufruf/);
  });

  test("ungültiges --seit: Exit 2", async () => {
    const r = await A.pruefen(args({ seit: "gestern" }), { env: ZUGANG, projectsRoot: "x", repoRoot: REPO });
    expect(r.exitCode).toBe(2);
  });

  test("vollständig erfasst: genau 2 Metrics-Requests, kein Observations-Request, nur GET, Basic-Auth, Exit 0", async () => {
    const root = mitSession([msg("a"), msg("b")]);
    const m = mock({ zaehlung: [{ sessionId: "s1", count_count: 2 }], tokens: tokenZeilen("s1", { input: 20, output: 10, cacheRead: 200, w5: 20, w1: 60 }) });
    const r = await A.pruefen(args(), { env: ZUGANG, now: SPAET(), projectsRoot: root, repoRoot: REPO, fetchImpl: m.fetchImpl });
    expect(r.exitCode).toBe(0);
    expect(m.aufrufe).toHaveLength(2);
    expect(m.aufrufe.every((a) => a.url.startsWith("http://lf.test/api/public/v2/metrics?query="))).toBe(true);
    expect(m.aufrufe.every((a) => a.method === undefined || a.method === "GET")).toBe(true);
    expect(m.aufrufe[0].auth).toBe("Basic " + Buffer.from("pk:sk").toString("base64"));
    expect(r.text).toMatch(/vollständig/);
    expect(r.text).toMatch(/Erfassungsquote 100,0 %/);
  });

  test("N Sessions: weiterhin nur 2 Metrics-Requests", async () => {
    const root = fixture({ [`${PRAEFIX}/s1.jsonl`]: msg("a"), [`${PRAEFIX}/s2.jsonl`]: msg("b"), [`${PRAEFIX}/s3.jsonl`]: msg("c") });
    const m = mock({ zaehlung: [{ sessionId: "s1", count_count: 1 }, { sessionId: "s2", count_count: 1 }, { sessionId: "s3", count_count: 1 }] });
    await A.pruefen(args(), { env: ZUGANG, now: SPAET(), projectsRoot: root, repoRoot: REPO, fetchImpl: m.fetchImpl });
    expect(m.aufrufe.filter((a) => a.url.includes("/metrics"))).toHaveLength(2);
  });

  test("Teil-Erfassung: Observations nur für diese Session, fehlender Call samt Zeit und Modell im Bericht, Exit 0", async () => {
    const root = mitSession([msg("a", { input_tokens: 1 }), msg("b", { input_tokens: 2 }), msg("c", { input_tokens: 3 })]);
    const [s] = A.findeSessions({ projectsRoot: root, praefix: PRAEFIX });
    expect(s.id).toBe("s1");
    const e = A.sollEintraege(LADE(s.pfad));
    const m = mock({ zaehlung: [{ sessionId: "s1", count_count: 2 }], tokens: [], observations: [obsZu(e[0]), obsZu(e[2])] });
    const r = await A.pruefen(args({ json: true }), { env: ZUGANG, now: SPAET(), projectsRoot: root, repoRoot: REPO, fetchImpl: m.fetchImpl });
    expect(r.exitCode).toBe(0);
    expect(m.aufrufe.filter((a) => a.url.includes("/v2/observations"))).toHaveLength(1);
    const j = JSON.parse(r.text) as { sessions: Bewertung[]; summe: { fehlend: number; quote: number } };
    expect(j.sessions[0].status).toBe("Lücke");
    expect(j.sessions[0].fehlendeCalls?.map((c) => c.messageId)).toEqual(["b"]);
    expect(j.summe).toMatchObject({ fehlend: 1 });
    expect(j.summe.quote).toBeCloseTo(2 / 3, 5);
  });

  test("Negativfall (#1862): eine Session des Projekts ohne jede Langfuse-Zeile wird als Lücke mit allen Calls gemeldet, nicht verschwiegen", async () => {
    const root = fixture({ [`${PRAEFIX}/s1.jsonl`]: msg("a") + NL + msg("b"), [`${PRAEFIX}/s2.jsonl`]: msg("c") + NL + msg("d") });
    const m = mock({ zaehlung: [{ sessionId: "s1", count_count: 2 }], observations: [] });
    const r = await A.pruefen(args({ json: true }), { env: ZUGANG, now: SPAET(), projectsRoot: root, repoRoot: REPO, fetchImpl: m.fetchImpl });
    expect(r.exitCode).toBe(0);
    const j = JSON.parse(r.text) as { sessions: (Bewertung & { session: string })[]; summe: { fehlend: number } };
    const s2 = j.sessions.find((x) => x.session === "s2");
    expect(s2).toMatchObject({ status: "Lücke", fehlend: 2, quote: 0, callsLangfuse: 0 });
    expect(s2?.fehlendeCalls?.map((c) => c.messageId)).toEqual(["c", "d"]);
    expect(j.summe.fehlend).toBe(2);
  });

  test("Außerhalb (#1862): --session findet eine Session außerhalb der Projektordner, meldet sie als Lücke mit Score außerhalb; ohne --session erscheint sie nicht; --ist ohne Zugang genügt", async () => {
    const root = fixture({ [`${PRAEFIX}/s1.jsonl`]: msg("a"), "Y--anders/fremd.jsonl": msg("x") + NL + msg("y") });
    const d = { env: {}, now: SPAET(), projectsRoot: root, repoRoot: REPO };
    const leer = fixture({ "ist.json": JSON.stringify({ data: [] }) });
    const mitIst = (o: Partial<ReturnType<typeof A.parseArgs>>) => args({ json: true, ist: [join(leer, "ist.json")], ...o });
    const leseDatei = (p: string) => readFileSync(p, "utf8");
    const r = await A.pruefen(mitIst({ session: "fremd" }), { ...d, leseDatei });
    expect(r.exitCode).toBe(0);
    const j = JSON.parse(r.text) as { sessions: (Bewertung & { session: string; ausserhalb: boolean })[] };
    expect(j.sessions).toHaveLength(1);
    expect(j.sessions[0]).toMatchObject({ session: "fremd", status: "Lücke", fehlend: 2, callsLangfuse: 0, quote: 0, score: "außerhalb", ausserhalb: true });
    const md = await A.pruefen(args({ session: "fremd", ist: [join(leer, "ist.json")] }), { ...d, leseDatei });
    expect(md.text).toMatch(/Hinweis fremd.*außerhalb des Projekts/);
    const ohne = await A.pruefen(mitIst({}), { ...d, leseDatei });
    expect((JSON.parse(ohne.text) as { sessions: { session: string }[] }).sessions.map((x) => x.session)).toEqual(["s1"]);
  });

  test("Session in der Ruhefrist erscheint als läuft, nicht als Lücke, ohne Observations-Request", async () => {
    const root = mitSession([msg("a")]);
    const m = mock({ zaehlung: [] });
    const r = await A.pruefen(args({ json: true }), { env: ZUGANG, now: Date.now(), projectsRoot: root, repoRoot: REPO, fetchImpl: m.fetchImpl });
    const j = JSON.parse(r.text) as { sessions: Bewertung[]; summe: { sessions: number; laeuft: number } };
    expect(j.sessions[0].status).toBe("läuft");
    expect(j.summe).toMatchObject({ sessions: 0, laeuft: 1 });
    expect(m.aufrufe.some((a) => a.url.includes("/v2/observations"))).toBe(false);
  });

  test("Negativfall (#1745): eine Config ohne Worktree-Präfix bricht mit Exit 1 und Fix-Zeile ab, ohne ein Transkript oder Langfuse zu fragen", async () => {
    const root = mitSession([msg("a")]);
    const m = mock({ zaehlung: [] });
    const r = await A.pruefen(args(), { env: ZUGANG, now: SPAET(), projectsRoot: root, repoRoot: REPO, fetchImpl: m.fetchImpl, config: { repo: "o/acme", praefixe: {} } });
    expect(r.exitCode).toBe(1);
    expect(r.text).toMatch(/praefixe\.worktree[\s\S]*Fix:/);
    expect(m.aufrufe).toHaveLength(0);
  });

  test("HTTP 500 ergibt Exit 1", async () => {
    const root = mitSession([msg("a")]);
    const r = await A.pruefen(args(), { env: ZUGANG, now: SPAET(), projectsRoot: root, repoRoot: REPO, fetchImpl: mock({ status: 500 }).fetchImpl });
    expect(r.exitCode).toBe(1);
    expect(r.text).toMatch(/500/);
  });

  test("row_limit erreicht: abgeschnitten, Exit 1 (nie still kürzen)", async () => {
    const root = mitSession([msg("a")]);
    const viele = Array.from({ length: A.ROW_LIMIT }, (_, i) => ({ sessionId: `x${i}`, count_count: 1 }));
    const r = await A.pruefen(args(), { env: ZUGANG, now: Date.parse("2026-10-11T10:00:00Z"), projectsRoot: root, repoRoot: REPO, fetchImpl: mock({ zaehlung: viele }).fetchImpl });
    expect(r.exitCode).toBe(1);
    expect(r.text).toMatch(/abgeschnitten/);
  });

  test("--ist (Export, beide Formen) ohne Zugang: kein Request, Zählebene, Exit 0; kaputte Datei Exit 1", async () => {
    const root = mitSession([msg("a"), msg("b")]);
    const dateien: Record<string, string> = {
      "z.json": JSON.stringify({ data: [{ sessionId: "s1", count_count: "1" }] }),
      "t.json": JSON.stringify(tokenZeilen("s1", { input: 10, output: 5, cacheRead: 100, w5: 10, w1: 30 })),
      "kaputt.json": "{nicht json",
    };
    const leseDatei = (p: string) => dateien[p];
    const lauf = (ist: string[]) => A.pruefen(args({ ist, json: true }), { env: {}, now: SPAET(), projectsRoot: root, repoRoot: REPO, leseDatei });
    const r = await lauf(["z.json", "t.json"]);
    expect(r.exitCode).toBe(0);
    const j = JSON.parse(r.text) as { sessions: Bewertung[] };
    expect(j.sessions[0]).toMatchObject({ callsTranskript: 2, callsLangfuse: 1, fehlend: 1, status: "Lücke", fehlendeCalls: null });
    expect((await lauf(["kaputt.json"])).exitCode).toBe(1);
  });

  test("Markdown-Bericht trägt Tabelle, Summenzeile und die Liste fehlender Calls", async () => {
    const root = mitSession([msg("a"), msg("b")]);
    const m = mock({ zaehlung: [{ sessionId: "s1", count_count: 1 }], observations: [] });
    const r = await A.pruefen(args(), { env: ZUGANG, now: SPAET(), projectsRoot: root, repoRoot: REPO, fetchImpl: m.fetchImpl });
    expect(r.text).toMatch(/\| Session \| Ticket \| Status \| Calls T\/L/);
    expect(r.text).toMatch(/\*\*Summe:\*\*/);
    expect(r.text).toMatch(/Fehlende Calls s1/);
    expect(r.text).toContain(`${WORKTREE}1562`);
  });

  test("ohne injizierte Config gilt die echte Projekt-Config (Standard von pruefen)", async () => {
    const echt = projektConfig();
    const root = mitSession([msg("a", {}, { gitBranch: `${echt.praefixe.branch}1562-x` })]);
    const m = mock({ zaehlung: [{ sessionId: "s1", count_count: 1 }], observations: [] });
    const r = await einstiegRoh.pruefen(args(), { env: ZUGANG, now: SPAET(), projectsRoot: root, repoRoot: REPO, fetchImpl: m.fetchImpl }) as { text: string };
    expect(r.text).toContain(`${echt.praefixe.worktree}1562`);
    expect(r.text).not.toContain(`${WORKTREE}1562`);
  });

  test("Bericht: vollständig, Score ausstehend; Ledger (nur gelesen) mit Ende hebt es auf; kaputtes Ledger bleibt unberührt; Hinweis nennt den Stichtag aus dem Kern", async () => {
    const root = mitSession([msg("a")]);
    const m = mock({ zaehlung: [{ sessionId: "s1", count_count: 1 }], tokens: tokenZeilen("s1", { input: 10, output: 5, cacheRead: 100, w5: 10, w1: 30 }) });
    const lauf = (stateDir: string) => A.pruefen(args(), { env: ZUGANG, now: SPAET(), projectsRoot: root, repoRoot: REPO, fetchImpl: m.fetchImpl, stateDir });
    const mtime = statSync(join(root, PRAEFIX, "s1.jsonl")).mtimeMs;
    const ohne = (await lauf(fixture({}))).text;
    const groesse = statSync(join(root, PRAEFIX, "s1.jsonl")).size;
    expect(ohne).toContain("| vollständig, Score ausstehend |");
    expect(ohne).toContain("1 davon Score ausstehend (Nachlieferer wartet noch)");
    expect(ohne).toContain(`vor ${A.STICHTAG.slice(0, 10)})`);
    const mitEnde = fixture({ "langfuse-abgleich.json": JSON.stringify({ version: 1, sessions: { s1: { beendet: true, mtime, groesse } } }) });
    const ende = (await lauf(mitEnde)).text;
    expect(ende).not.toMatch(/Score ausstehend/);
    expect(ende).toContain("| vollständig |");
    const kaputtDir = fixture({ "langfuse-abgleich.json": "{nicht json" });
    expect((await lauf(kaputtDir)).text).toMatch(/Score ausstehend/);
    expect(readFileSync(join(kaputtDir, "langfuse-abgleich.json"), "utf8")).toBe("{nicht json");
    expect(readdirSync(kaputtDir)).toEqual(["langfuse-abgleich.json"]);
  });

  test("Bericht: eine Session vor dem Stichtag steht in der Summenzeile, ohne sie fehlt der Zusatz", async () => {
    const tokens = tokenZeilen("s1", { input: 10, output: 5, cacheRead: 100, w5: 10, w1: 30 });
    const m = () => mock({ zaehlung: [{ sessionId: "s1", count_count: 1 }], tokens });
    const alt = mitSession([msg("a", {}, { timestamp: "2026-10-01T10:00:00Z" })]);
    const r = await A.pruefen(args(), { env: ZUGANG, now: SPAET(), projectsRoot: alt, repoRoot: REPO, fetchImpl: m().fetchImpl });
    expect(r.text).toContain("1 vor dem Stichtag (nie gesendet, kein Score)");
    const neu = mitSession([msg("a")]);
    const r2 = await A.pruefen(args(), { env: ZUGANG, now: SPAET(), projectsRoot: neu, repoRoot: REPO, fetchImpl: m().fetchImpl });
    expect(r2.text).not.toContain("vor dem Stichtag (nie gesendet");
  });

  test("Bericht: Dubletten der Zählebene tragen den Hinweis auf leere Hook-GENERATIONs, ohne Dubletten oder im Fingerabdruck-Modus fehlt er", async () => {
    const root = mitSession([msg("a")]);
    const tokens = tokenZeilen("s1", { input: 10, output: 5, cacheRead: 100, w5: 10, w1: 30 });
    const lauf = (count: number) => {
      const dateien: Record<string, string> = { "z.json": JSON.stringify({ data: [{ sessionId: "s1", count_count: count }] }), "t.json": JSON.stringify(tokens) };
      return A.pruefen(args({ ist: ["z.json", "t.json"] }), { env: {}, now: SPAET(), projectsRoot: root, repoRoot: REPO, leseDatei: (p: string) => dateien[p] });
    };
    expect((await lauf(2)).text).toContain("leere Hook-GENERATIONs");
    expect((await lauf(2)).text).toContain("1 Session(s) mit Dubletten auf der Zählebene (s1)");
    expect((await lauf(2)).text).toContain("providedModelName none of");
    expect((await lauf(1)).text).not.toContain("leere Hook-GENERATIONs");
    const b = { session: "s1", status: "Dublette", score: null, tickets: [], callsTranskript: 1, callsLangfuse: 2, tokensTranskript: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, tokensLangfuse: null, fehlend: 0, dubletten: 1, leer: 0, quote: 1, fehlendeCalls: null, schluessel: "fingerprint" };
    const sum = A.summenzeile([b]);
    expect(A.renderMarkdown([{ ...b, schluessel: "zählung" }], sum)).toContain("leere Hook-GENERATIONs");
    expect(A.renderMarkdown([b], sum)).not.toContain("leere Hook-GENERATIONs");
    // Anzahl und Liste zählen nur Sessions mit Zähl-Dubletten; die ID wird auf 8 Zeichen gekürzt.
    const z = (session: string, dubletten: number) => ({ ...b, schluessel: "zählung", session, dubletten });
    const zwei = A.renderMarkdown([z("abcdefgh-ijkl", 2), z("s2", 0), { ...z("s3", 1), schluessel: "fingerprint" }], sum);
    const hinweis = zwei.split("\n").find((l) => l.includes("auf der Zählebene")) ?? "";
    expect(hinweis).toContain("1 Session(s) mit Dubletten auf der Zählebene (abcdefgh):");
    expect(hinweis).not.toContain("s2");
    expect(hinweis).not.toContain("s3");
  });

  test("Ohne Zugang nennt der Hinweis den Zähl-Filter gegen leere Hook-GENERATIONs (providedModelName none of claude)", () => {
    expect(A.OHNE_ZUGANG).toContain('Filter providedModelName none of ["claude"]');
  });

  test("Bericht: eine Lücke innerhalb der Nachlieferer-Frist bleibt Lücke und wird nie als „vollständig, Score ausstehend“ gezeigt", async () => {
    const root = mitSession([msg("a")]);
    const m = mock({ zaehlung: [], observations: [] });
    const r = await A.pruefen(args(), { env: ZUGANG, now: SPAET(), projectsRoot: root, repoRoot: REPO, fetchImpl: m.fetchImpl });
    expect(r.text).toContain("| Lücke |");
    expect(r.text).not.toContain("vollständig, Score ausstehend");
  });

  test("keine Sessions im Fenster: Exit 0 mit Hinweis", async () => {
    const root = fixture({ [`${PRAEFIX}/s1.jsonl`]: msg("a") });
    const r = await A.pruefen(args({ seit: new Date(Date.now() + 3_600_000).toISOString() }), { env: ZUGANG, projectsRoot: root, repoRoot: REPO, fetchImpl: mock({}).fetchImpl });
    expect(r.exitCode).toBe(0);
    expect(r.text).toMatch(/Keine Sessions/);
  });

  test("gesendete Abfrage: Zeitfenster umschließt den frühesten Call, --session wird als Filter weitergereicht", async () => {
    const root = mitSession([msg("a")]);
    const m = mock({ zaehlung: [{ sessionId: "s1", count_count: 1 }] });
    const jetzt = SPAET();
    await A.pruefen(args({ session: "s1" }), { env: ZUGANG, now: jetzt, projectsRoot: root, repoRoot: REPO, fetchImpl: m.fetchImpl });
    const frueh = Date.parse("2026-10-09T10:00:00Z");
    for (const q of m.queries) {
      expect(Date.parse(q.fromTimestamp as string)).toBeLessThanOrEqual(frueh);
      expect(Date.parse(q.toTimestamp as string)).toBeGreaterThan(jetzt);
      expect((q.filters as { column: string; value: string }[]).some((f) => f.column === "sessionId" && f.value === "s1")).toBe(true);
    }
    expect(m.queries).toHaveLength(2);
  });

  test("row_limit erreicht: das Zeitfenster wird halbiert und die Teile werden zusammengeführt", async () => {
    const root = mitSession([msg("a"), msg("b")]);
    const m = mock({
      zaehlungFn: (q) => {
        const dauer = Date.parse(q.toTimestamp as string) - Date.parse(q.fromTimestamp as string);
        if (dauer > 12 * 3_600_000) return Array.from({ length: A.ROW_LIMIT }, (_, i) => ({ sessionId: `x${i}`, count_count: 1 }));
        return [{ sessionId: "s1", count_count: 1 }];
      },
    });
    const jetzt = Date.parse("2026-10-11T10:00:00Z");
    const r = await A.pruefen(args({ json: true }), { env: ZUGANG, now: jetzt, projectsRoot: root, repoRoot: REPO, fetchImpl: m.fetchImpl });
    expect(r.exitCode).toBe(0);
    expect(m.queries.length).toBeGreaterThan(2);
    const j = JSON.parse(r.text) as { sessions: Bewertung[] };
    expect(j.sessions[0].callsLangfuse).toBeGreaterThan(1); // Teile addiert
  });

  test("Zeitfenster beginnt vor dem FRÜHESTEN Call (zwei Calls über eine Stunde auseinander)", async () => {
    const root = mitSession([msg("spaet", {}, { timestamp: "2026-10-09T10:00:00.000Z" }), msg("frueh", {}, { timestamp: "2026-10-09T07:30:00.000Z" })]);
    const m = mock({ zaehlung: [{ sessionId: "s1", count_count: 2 }] });
    await A.pruefen(args(), { env: ZUGANG, now: SPAET(), projectsRoot: root, repoRoot: REPO, fetchImpl: m.fetchImpl });
    for (const q of m.queries) expect(Date.parse(q.fromTimestamp as string)).toBeLessThanOrEqual(Date.parse("2026-10-09T07:30:00.000Z") - 3_600_000);
  });

  test("Halbierung deckt das Fenster lückenlos ab: Blätter schließen aneinander an, erstes from und letztes to bleiben", async () => {
    const root = mitSession([msg("a")]);
    const blaetter: { von: number; bis: number }[] = [];
    const m = mock({
      zaehlungFn: (q) => {
        const von = Date.parse(q.fromTimestamp as string);
        const bis = Date.parse(q.toTimestamp as string);
        if (bis - von > 12 * 3_600_000) return Array.from({ length: A.ROW_LIMIT }, (_, i) => ({ sessionId: `x${i}`, count_count: 1 }));
        blaetter.push({ von, bis });
        return [{ sessionId: "s1", count_count: 1 }];
      },
    });
    await A.pruefen(args(), { env: ZUGANG, now: Date.parse("2026-10-11T10:00:00Z"), projectsRoot: root, repoRoot: REPO, fetchImpl: m.fetchImpl });
    const erste = m.queries[0];
    const sortiert = [...blaetter].sort((a, b) => a.von - b.von);
    expect(sortiert.length).toBeGreaterThan(1);
    expect(sortiert[0].von).toBe(Date.parse(erste.fromTimestamp as string));
    expect(sortiert.at(-1)?.bis).toBe(Date.parse(erste.toTimestamp as string));
    for (let i = 1; i < sortiert.length; i++) expect(sortiert[i].von).toBe(sortiert[i - 1].bis);
  });

  test("Token-Summen aus den Hälften werden addiert, nicht überschrieben", async () => {
    const root = mitSession([msg("a")]);
    let blaetter = 0;
    const m = mock({
      zaehlung: [{ sessionId: "s1", count_count: 1 }],
      tokensFn: (q) => {
        const dauer = Date.parse(q.toTimestamp as string) - Date.parse(q.fromTimestamp as string);
        if (dauer > 12 * 3_600_000) return Array.from({ length: A.ROW_LIMIT }, (_, i) => ({ sessionId: `x${i}`, usageType: "input", sum_usageByType: 1 }));
        blaetter += 1;
        return [{ sessionId: "s1", usageType: "input", sum_usageByType: 1 }];
      },
    });
    const r = await A.pruefen(args({ json: true }), { env: ZUGANG, now: Date.parse("2026-10-11T10:00:00Z"), projectsRoot: root, repoRoot: REPO, fetchImpl: m.fetchImpl });
    const j = JSON.parse(r.text) as { sessions: (Bewertung & { tokensLangfuse: { input: number } })[] };
    expect(blaetter).toBeGreaterThan(1);
    expect(j.sessions[0].tokensLangfuse.input).toBe(blaetter);
  });

  test("--ist mit row_limit Zeilen ist abgeschnitten: Exit 1 (kein stilles Kürzen)", async () => {
    const root = mitSession([msg("a")]);
    const viele = Array.from({ length: A.ROW_LIMIT }, (_, i) => ({ sessionId: `x${i}`, count_count: 1 }));
    const r = await A.pruefen(args({ ist: ["z.json"] }), { env: {}, now: SPAET(), projectsRoot: root, repoRoot: REPO, leseDatei: () => JSON.stringify(viele) });
    expect(r.exitCode).toBe(1);
    expect(r.text).toMatch(/abgeschnitten/);
  });

  test("--ist mit gültigem JSON in unbekannter Form: Exit 1", async () => {
    const root = mitSession([msg("a")]);
    const r = await A.pruefen(args({ ist: ["z.json"] }), { env: {}, now: SPAET(), projectsRoot: root, repoRoot: REPO, leseDatei: () => JSON.stringify({ foo: 1 }) });
    expect(r.exitCode).toBe(1);
    expect(r.text).toMatch(/unbekannte Form/);
  });

  test("Ruhefrist: nur der Subagent schreibt (Hauptdatei alt) gilt als läuft", async () => {
    const root = fixture({ [`${PRAEFIX}/s1.jsonl`]: msg("a"), [`${PRAEFIX}/s1/subagents/a0.jsonl`]: msg("b") });
    const alt = new Date(Date.now() - 2 * 3_600_000);
    utimesSync(join(root, PRAEFIX, "s1.jsonl"), alt, alt);
    const r = await A.pruefen(args({ json: true }), { env: ZUGANG, now: Date.now(), projectsRoot: root, repoRoot: REPO, fetchImpl: mock({}).fetchImpl });
    expect((JSON.parse(r.text) as { sessions: Bewertung[] }).sessions[0].status).toBe("läuft");
    // Gegenprobe: auch die Subagent-Datei alt → Lücke
    utimesSync(join(root, PRAEFIX, "s1/subagents/a0.jsonl"), alt, alt);
    const r2 = await A.pruefen(args({ json: true }), { env: ZUGANG, now: Date.now(), projectsRoot: root, repoRoot: REPO, fetchImpl: mock({}).fetchImpl });
    expect((JSON.parse(r2.text) as { sessions: Bewertung[] }).sessions[0].status).toBe("Lücke");
  });

  test("Bericht kappt die Liste fehlender Calls und nennt den Rest", async () => {
    const root = mitSession(Array.from({ length: 23 }, (_, i) => msg(`m${i}`)));
    const m = mock({ zaehlung: [], observations: [] });
    const r = await A.pruefen(args(), { env: ZUGANG, now: SPAET(), projectsRoot: root, repoRoot: REPO, fetchImpl: m.fetchImpl });
    expect(r.text).toMatch(/… und 3 weitere/);
    expect(r.text.match(/^- m\d+ ·/gm)).toHaveLength(20);
  });

  test("parseArgs: --ist wiederholbar", () => {
    expect(A.parseArgs(["--pruefen", "--ist", "a", "--ist", "b", "--seit", "2026-10-01", "--session", "s", "--json"])).toEqual({ pruefen: true, json: true, seit: "2026-10-01", session: "s", ist: ["a", "b"] });
  });
});

describe("strikte Argumente (#1790)", () => {
  test("parseArgs: unbekanntes Flag, Flag ohne Wert und doppeltes Einzel-Flag setzen fehler", () => {
    const fehler = (argv: string[]) => A.parseArgs(argv).fehler ?? "";
    expect(fehler(["--pruefen", "--bogus"])).toMatch(/Unbekanntes Argument: --bogus/);
    expect(fehler(["--seit"])).toMatch(/--seit braucht einen Wert/);
    expect(fehler(["--session", "a", "--session", "b"])).toMatch(/--session ist doppelt/);
    expect(fehler(["--pruefen", "--pruefen"])).toMatch(/--pruefen ist doppelt/);
    expect(fehler(["--pruefen", "--ist", "a", "--ist", "b"])).toBe("");
    expect(A.parseArgs(["--pruefen"])).toEqual({ pruefen: true, json: false, seit: null, session: null, ist: [] });
  });
  test("pruefen: ein Aufruf-Fehler endet mit Exit 2 und Aufrufzeile vor jedem I/O (kein Zugang nötig)", async () => {
    const wirft = () => {
      throw new Error("kein I/O erlaubt");
    };
    const r = await A.pruefen({ pruefen: true, json: false, seit: null, session: null, ist: [], fehler: "X" }, { env: {}, projectsRoot: "X:/gibt-es-nicht", repoRoot: "X:/repo", fetchImpl: wirft, leseDatei: wirft });
    expect(r).toEqual({ exitCode: 2, text: `X\n${A.AUFRUFHILFE}` });
  });
});

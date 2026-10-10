/* Langfuse nachliefern per OTLP (#1577).
 *
 * @harness-waechter – einziger Durchsetzer der Idempotenz-Regeln des Schreibwegs (Ist zuerst, Ledger als Brücke, Dubletten nur melden, Hook-taugliche Import-Hülle), darum im geschützten test/harness/ (#1165).
 *
 * Die Logik lebt in scripts/langfuse-nachliefern.mjs und scripts/langfuse-otlp.mjs. Weder ~/.claude noch Langfuse werden angefasst:
 * synthetisches JSONL und Ledger in Temp-Ordnern, die Netzschicht bekommt ein injiziertes `fetch`.
 *
 * Ausführen mit: npm test
 */
import { describe, expect, test } from "vitest";
import { existsSync, mkdirSync, readdirSync, readFileSync, utimesSync, writeFileSync } from "node:fs";
import { join, posix } from "node:path";
import { fixture } from "../support/tmp-fixture";
import { lokaleImporteTransitiv } from "./hook-importe";

// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as rawNach from "../../scripts/langfuse-nachliefern.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as rawOtlp from "../../scripts/langfuse-otlp.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as rawAbgleich from "../../scripts/langfuse-abgleich.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as rawApi from "../../scripts/langfuse-api.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as rawPreise from "../../scripts/preise.mjs";

type Obs = Record<string, unknown>;
type Usage = { input: number; output: number; cacheRead: number; cacheWrite5m: number; cacheWrite1h: number };
type Rolle = { agentId: string; agentType?: string; description?: string; parentAgentId?: string };
type Eintrag = { id: string; traceId: string; session: string; messageId: string; model: string | null; ts: string; usage: Usage; rolle: Rolle | null; ticket: string | null };
type Attr = { key: string; value: { stringValue?: string; arrayValue?: { values: { stringValue: string }[] } } };
type Span = { traceId: string; spanId: string; parentSpanId?: string; name: string; kind: number; startTimeUnixNano: string; endTimeUnixNano: string; attributes: Attr[] };
type Payload = { resourceSpans: { resource: { attributes: Attr[] }; scopeSpans: { scope: { name: string }; spans: Span[] }[] }[] };
type Chunk = { payload: Payload; generationIds: string[]; spanIds: string[] };
type Antwort = { ok: boolean; status: number; json: () => Promise<unknown>; text: () => Promise<string> };
type Fetch = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => Promise<Antwort>;
type Rec = { session: string; status: string; gesendet: number; dubletten: number; wuerdeSenden: number; ausstehend: number; befund: string | null };
type Protokoll = { zugang: boolean | null; geprueft: number; gesendet: number; spans: number; dubletten: number; wuerdeSenden: number; sessions: Rec[]; fehler: { session: string; status: number | null; meldung: string }[] };
type Args = { ende?: number; ausloeser: string | null; session: string | null; seit: string | null; aktuell: string | null; beendet: string | null; trocken: boolean; json: boolean; fehler: string | null };
type LedgerEintrag = { pfad: string; groesse: number | null; mtime: number | null; bestaetigt: boolean; gesendet: string[]; spans: string[]; beendet?: boolean; befund?: string };

const N = rawNach as unknown as {
  STICHTAG: string;
  RUHEFRIST_OHNE_ENDE_H: number;
  parseArgs: (a: string[]) => Args;
  nachliefern: (a: Args, d: { env?: Record<string, string>; now?: number; fetchImpl?: Fetch; projectsRoot: string; repoRoot: string; stateDir: string }) => Promise<{ exitCode: number; text: string; protokoll: Protokoll }>;
};
const O = rawOtlp as unknown as {
  MAX_SPANS_JE_REQUEST: number;
  nanos: (ts: string) => string;
  attr: (k: string, v: string | string[]) => Attr;
  costDetails: (e: Eintrag) => Record<string, number> | null;
  bauePayloads: (s: string, e: Eintrag[], o: { soll?: Eintrag[]; ledgerSpans?: string[]; env?: Record<string, string>; project: string; maxSpans?: number }) => { chunks: Chunk[] };
};
const A = rawAbgleich as unknown as {
  RUHEFRIST_MIN: number;
  beobachtungsId: (s: string, m: string) => string;
  subagentSpanId: (s: string, a: string) => string;
  scoreId: (s: string, n: string) => string;
  findeSessions: (o: { projectsRoot: string; praefix: string }) => { id: string; pfad: string; mtime: number; groesse: number }[];
};
const API = rawApi as unknown as {
  sendeOtlp: (p: unknown, z: { baseUrl: string; publicKey: string; secretKey: string; fetchImpl: Fetch }) => Promise<unknown>;
  sendeScore: (s: unknown, z: { baseUrl: string; publicKey: string; secretKey: string; fetchImpl: Fetch }) => Promise<void>;
};
const P = rawPreise as unknown as { priceParts: (c: Record<string, unknown>) => Record<string, number> | null; sumParts: (p: Record<string, number>) => number };

const REPO = "X:/repo";
const PRAEFIX = "X--repo";
const ZUGANG = { LANGFUSE_PUBLIC_KEY: "pk", LANGFUSE_SECRET_KEY: "sk", LANGFUSE_BASE_URL: "http://lf.test" };
const HEUTE = Date.parse((rawNach as unknown as { STICHTAG: string }).STICHTAG) + 3_600_000; // eine Stunde nach dem Stichtag: gesendet wird

// ── Helfer ───────────────────────────────────────────────────────────────────

const attrs = (s: Span) => Object.fromEntries(s.attributes.map((a) => [a.key, a.value.stringValue ?? a.value.arrayValue?.values.map((v) => v.stringValue)]));
const spansVon = (p: Payload) => p.resourceSpans[0].scopeSpans[0].spans;
const usage = (o: Partial<Usage> = {}): Usage => ({ input: 10, output: 5, cacheRead: 100, cacheWrite5m: 10, cacheWrite1h: 30, ...o });
const eintrag = (n: number, over: Partial<Eintrag> = {}): Eintrag => ({
  id: A.beobachtungsId("s1", `m${n}`),
  traceId: "t".repeat(32),
  session: "s1",
  messageId: `m${n}`,
  model: "claude-opus-5-5",
  ts: new Date(HEUTE + n * 1000).toISOString(),
  usage: usage({ input: n }),
  rolle: null,
  ticket: "kq-1577",
  ...over,
});

let zaehler = 0;
/** Eine Assistant-Zeile der Session `s1`; `i` ist der Input, damit Fingerabdrücke verschieden bleiben. */
const msg = (id: string, i = 10, extra: Record<string, unknown> = {}) =>
  JSON.stringify({
    type: "assistant",
    sessionId: "s1",
    gitBranch: "feature/kq-1577-x",
    timestamp: new Date(HEUTE + zaehler++ * 1000).toISOString(),
    uuid: `u-${id}`,
    message: {
      id,
      role: "assistant",
      model: "claude-opus-5-5",
      usage: { input_tokens: i, output_tokens: 5, cache_read_input_tokens: 100, cache_creation_input_tokens: 40, cache_creation: { ephemeral_1h_input_tokens: 30 } },
      content: [{ type: "text", text: "x" }],
    },
    ...extra,
  });

/** Observation, wie Langfuse sie für einen Soll-Eintrag liefert (Hook-Aufzeichnung ohne message_id, sonst mit). */
const obsZu = (e: Eintrag, metadata: Obs = {}): Obs => ({
  id: `o-${e.messageId}`,
  type: "GENERATION",
  providedModelName: e.model,
  usageDetails: { input: e.usage.input, output: e.usage.output, cache_read_input_tokens: e.usage.cacheRead, input_cache_creation_5m: e.usage.cacheWrite5m, input_cache_creation_1h: e.usage.cacheWrite1h },
  metadata,
});
/** Soll-Eintrag zu `msg(id, i)`: zwei Zeilen mit demselben Inhalt ergäben denselben Fingerabdruck. */
const sollZu = (id: string, i = 10): Eintrag => eintrag(0, { messageId: id, id: A.beobachtungsId("s1", id), usage: usage({ input: i }) });

type Cfg = { getStatus?: (n: number) => number; ist?: number; obs?: Obs[]; otlpStatus?: (n: number) => number; partial?: number; scoreStatus?: number };
const antwort = (body: unknown, status = 200): Promise<Antwort> => Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(body), text: () => Promise.resolve(JSON.stringify(body)) });
/** Langfuse-Mock: Metrics (Zählung = cfg.ist, Tokens leer), Observations (cfg.obs), OTLP-/Score-POST mit Aufzeichnung. */
const mock = (cfg: Cfg = {}) => {
  const aufrufe: { url: string; method: string; body: unknown; headers: Record<string, string> }[] = [];
  const otlp: Payload[] = [];
  const scores: Record<string, unknown>[] = [];
  const fetchImpl: Fetch = (url, init) => {
    const method = init?.method ?? "GET";
    aufrufe.push({ url, method, body: init?.body ? JSON.parse(init.body) : null, headers: init?.headers ?? {} });
    if (url.includes("/otel/v1/traces")) {
      otlp.push(JSON.parse(init?.body ?? "{}") as Payload);
      const status = cfg.otlpStatus?.(otlp.length - 1) ?? 200;
      return antwort(status === 200 ? { partialSuccess: cfg.partial ? { rejectedSpans: cfg.partial, errorMessage: "kaputt" } : {} } : { error: "x" }, status);
    }
    if (url.endsWith("/api/public/scores")) {
      scores.push(JSON.parse(init?.body ?? "{}") as Record<string, unknown>);
      return antwort({}, cfg.scoreStatus ?? 200);
    }
    if (method === "GET" && cfg.getStatus) {
      const status = cfg.getStatus(aufrufe.filter((x) => x.method === "GET").length - 1);
      if (status !== 200) return antwort({ error: "x" }, status);
    }
    if (url.includes("/v2/observations")) return antwort({ data: cfg.obs ?? [], meta: {} });
    const q = JSON.parse(new URL(url).searchParams.get("query") ?? "{}") as { dimensions: unknown[] };
    return antwort({ data: q.dimensions.length === 1 && cfg.ist ? [{ sessionId: "s1", count_count: cfg.ist }] : [] });
  };
  return { aufrufe, otlp, scores, fetchImpl, posts: () => aufrufe.filter((a) => a.method === "POST") };
};

const argsVon = (o: Partial<Args> = {}): Args => ({ ...N.parseArgs([]), ...o });
const SPAET = () => Date.now() + 48 * 3_600_000; // alle Dateien gelten als lange ruhig
const aufbau = (calls: string[], dateien: Record<string, string> = {}) => {
  const root = fixture({ [`${PRAEFIX}/s1.jsonl`]: calls.join("\n"), ...dateien });
  const state = join(fixture({}), "state");
  return { root, state, ledger: join(state, "langfuse-abgleich.json") };
};
const lauf = (a: { root: string; state: string }, m: ReturnType<typeof mock>, args: Partial<Args> = {}, now = SPAET(), env: Record<string, string> = ZUGANG) =>
  N.nachliefern(argsVon(args), { env, now, fetchImpl: m.fetchImpl, projectsRoot: a.root, repoRoot: REPO, stateDir: a.state });
const ledgerVon = (pfad: string) => (JSON.parse(readFileSync(pfad, "utf8")) as { sessions: Record<string, LedgerEintrag> }).sessions;

const iso = (ms: number) => new Date(ms).toISOString();
const mkdirLedger = (dir: string) => mkdirSync(dir, { recursive: true });

// ── Preise, IDs, Hülle ───────────────────────────────────────────────────────

describe("priceParts: 5m/1h-Aufteilung additiv", () => {
  test("cacheWrite5m + cacheWrite1h ergeben cacheWrite; der Gesamtbetrag bleibt unverändert", () => {
    const p = P.priceParts({ model: "claude-opus-5-5", ts: "2026-10-09T10:00:00Z", input: 10, output: 5, cacheRead: 100, cacheWrite: 40, cacheWrite1h: 30 })!;
    expect(p.cacheWrite5m).toBeCloseTo((10 * 5) / 1e6, 12);
    expect(p.cacheWrite1h).toBeCloseTo((30 * 8) / 1e6, 12);
    expect(p.cacheWrite5m + p.cacheWrite1h).toBeCloseTo(p.cacheWrite, 12);
    expect(P.sumParts(p)).toBe(p.input + p.cacheWrite + p.cacheRead + p.output);
  });
});

describe("IDs", () => {
  test("Golden: feste Hex-Werte (eine geänderte Formel bricht die Idempotenz)", () => {
    expect(A.subagentSpanId("s1", "a1")).toBe("b0937725809280e5");
    expect(A.scoreId("s1", "erfassung")).toBe("d5f734278f0e5dc64009bfceb5ae2c3d");
    expect(A.scoreId("s1", "erfassung_hook")).toBe("ef4f8ca719fd3471484ff3e6def718ff");
  });
});

describe("Import-Hülle", () => {
  test("nachliefern zieht genau preise, transkript, transkript-calls, langfuse-api, langfuse-abgleich, langfuse-otlp nach", () => {
    const lies = (rel: string) => readFileSync(join(__dirname, "../..", rel), "utf8");
    const kette = lokaleImporteTransitiv(["scripts/langfuse-nachliefern.mjs"], lies).map((k) => posix.basename(k, ".mjs"));
    expect(new Set(kette)).toEqual(new Set(["langfuse-nachliefern", "preise", "transkript", "transkript-calls", "langfuse-api", "langfuse-abgleich", "langfuse-otlp"]));
  });
});

// ── OTLP-Aufbau (pur) ────────────────────────────────────────────────────────

describe("Payload (Golden)", () => {
  const baue = (e: Eintrag[], o: Partial<Parameters<typeof O.bauePayloads>[2]> = {}) => O.bauePayloads("s1", e, { project: "repo", ...o });

  test("Generation: alle Attributschlüssel, Usage mit fünf Schlüsseln, Kosten samt total, Nanosekunden als String", () => {
    const e = eintrag(1);
    const [s] = spansVon(baue([e]).chunks[0].payload);
    expect(s).toMatchObject({ traceId: "t".repeat(32), spanId: e.id, kind: 1, startTimeUnixNano: O.nanos(e.ts), endTimeUnixNano: O.nanos(e.ts) });
    expect(s.startTimeUnixNano).toBe(String(BigInt(Date.parse(e.ts)) * 1_000_000n));
    expect(s.parentSpanId).toBeUndefined();
    const a = attrs(s);
    expect(a["langfuse.observation.type"]).toBe("generation");
    expect(a["langfuse.observation.model.name"]).toBe("claude-opus-5-5");
    expect(JSON.parse(a["langfuse.observation.usage_details"] as string)).toEqual({ input: 1, output: 5, cache_read_input_tokens: 100, input_cache_creation_5m: 10, input_cache_creation_1h: 30 });
    const kosten = JSON.parse(a["langfuse.observation.cost_details"] as string) as Record<string, number>;
    expect(Object.keys(kosten).sort()).toEqual(["cache_read_input_tokens", "input", "input_cache_creation_1h", "input_cache_creation_5m", "output", "total"]);
    expect(kosten.total).toBeCloseTo(kosten.input + kosten.output + kosten.cache_read_input_tokens + kosten.input_cache_creation_5m + kosten.input_cache_creation_1h, 12);
    expect(a["langfuse.observation.metadata.message_id"]).toBe("m1");
    expect(a["langfuse.observation.metadata.quelle"]).toBe("abgleich");
  });

  test("Trace-Attribute auf jedem Span: Session, Tags, Name, Projekt; Scope ohne langfuse-sdk-Präfix", () => {
    const sub = { agentId: "x1", agentType: "kubernia-lens", description: "L" };
    const { chunks } = baue([eintrag(1), eintrag(2, { rolle: sub }), eintrag(3, { ticket: "kq-9" })]);
    const p = chunks[0].payload;
    expect(spansVon(p)).toHaveLength(4); // 3 Generationen + 1 Subagent-Span
    for (const s of spansVon(p)) {
      const a = attrs(s);
      expect(a["langfuse.session.id"]).toBe("s1");
      expect(a["langfuse.trace.tags"]).toEqual(["kubernia", "abgleich", "kq-1577", "kq-9"]);
      expect(a["langfuse.trace.name"]).toBe("Abgleich");
      expect(a["langfuse.trace.metadata.project"]).toBe("repo");
    }
    expect(p.resourceSpans[0].scopeSpans[0].scope.name).toBe("kubernia-abgleich");
    expect(p.resourceSpans[0].scopeSpans[0].scope.name.startsWith("langfuse-sdk")).toBe(false);
    expect(p.resourceSpans[0].resource.attributes).toEqual([O.attr("service.name", "kubernia-abgleich")]);
  });

  test.each([
    ["ohne Umgebung", {}, undefined, undefined],
    ["Environment", { LANGFUSE_TRACING_ENVIRONMENT: "dev" }, "dev", undefined],
    ["User", { LANGFUSE_USER_ID: "fluffels" }, undefined, "fluffels"],
  ])("environment/user.id nur wenn gesetzt: %s", (_n, env, environment, user) => {
    const a = attrs(spansVon(baue([eintrag(1)], { env }).chunks[0].payload)[0]);
    expect(a["langfuse.environment"]).toBe(environment);
    expect(a["langfuse.user.id"]).toBe(user);
  });

  test.each([
    ["Modell ohne Preis: keine Kosten", { model: "gpt-x" }, true, false],
    ["ohne Modell: weder Modellname noch Kosten", { model: null }, false, false],
  ])("%s", (_n, over, modell, kosten) => {
    const a = attrs(spansVon(baue([eintrag(1, over)]).chunks[0].payload)[0]);
    expect("langfuse.observation.model.name" in a).toBe(modell);
    expect("langfuse.observation.cost_details" in a).toBe(kosten);
    expect(O.costDetails(eintrag(1, over))).toBeNull();
  });

  test("Subagenten: Name, agent_type, Zeitspanne; Verschachtelung über parentAgentId (auch mit agent--Präfix); Generation hängt am Span ihres Agenten", () => {
    const e = [
      eintrag(1, { rolle: { agentId: "a1", agentType: "kubernia-umsetzer", description: "Umsetzung" } }),
      eintrag(5, { rolle: { agentId: "a1", agentType: "kubernia-umsetzer", description: "Umsetzung" } }),
      eintrag(2, { rolle: { agentId: "a2", agentType: "kubernia-lens", description: "Lens R1", parentAgentId: "agent-a1" } }),
      eintrag(3, { rolle: { agentId: "a3", agentType: "x", parentAgentId: "fremd" } }),
      eintrag(4),
    ];
    const spans = spansVon(baue(e).chunks[0].payload);
    const proId = new Map(spans.map((s) => [s.spanId, s]));
    const a1 = proId.get(A.subagentSpanId("s1", "a1"))!;
    const a2 = proId.get(A.subagentSpanId("s1", "a2"))!;
    const a3 = proId.get(A.subagentSpanId("s1", "a3"))!;
    expect(a1.name).toBe("Subagent: Umsetzung");
    expect(attrs(a1)["langfuse.observation.metadata.agent_type"]).toBe("kubernia-umsetzer");
    expect(attrs(a1)["langfuse.observation.type"]).toBe("span");
    expect(a1.startTimeUnixNano).toBe(O.nanos(e[0].ts));
    expect(a1.endTimeUnixNano).toBe(O.nanos(e[1].ts));
    expect(a1.parentSpanId).toBeUndefined();
    expect(a2.parentSpanId).toBe(a1.spanId);
    expect(a3.parentSpanId).toBeUndefined(); // Eltern-Agent unbekannt: Root
    expect(a3.name).toBe("Subagent: x"); // Rückfall agentType
    expect(proId.get(e[2].id)!.parentSpanId).toBe(a2.spanId);
    expect(proId.get(e[4].id)!.parentSpanId).toBeUndefined(); // Hauptagent
  });

  test("bereits gesendete Subagent-Spans entfallen, benötigte Eltern ohne eigenen neuen Call kommen mit", () => {
    const soll = [
      eintrag(1, { rolle: { agentId: "a1", agentType: "t" } }),
      eintrag(2, { rolle: { agentId: "a2", agentType: "t", parentAgentId: "a1" } }),
    ];
    const ids = (ledgerSpans: string[]) => spansVon(baue([soll[1]], { soll, ledgerSpans }).chunks[0].payload).map((s) => s.spanId);
    expect(ids([])).toEqual([A.subagentSpanId("s1", "a1"), A.subagentSpanId("s1", "a2"), soll[1].id]);
    expect(ids([A.subagentSpanId("s1", "a1"), A.subagentSpanId("s1", "a2")])).toEqual([soll[1].id]);
    expect(spansVon(baue([soll[1]], { soll, ledgerSpans: [A.subagentSpanId("s1", "a2")] }).chunks[0].payload).map((s) => s.spanId)).toContain(A.subagentSpanId("s1", "a1"));
  });

  test("Chunking: Spans stehen im ersten Chunk vor den Generationen, jeder Chunk höchstens maxSpans", () => {
    const e = [1, 2, 3, 4].map((n) => eintrag(n, { rolle: { agentId: "a1", agentType: "t" } }));
    const { chunks } = baue(e, { maxSpans: 2 });
    expect(chunks.map((c) => spansVon(c.payload).length)).toEqual([2, 2, 1]);
    expect(chunks[0].spanIds).toEqual([A.subagentSpanId("s1", "a1")]);
    expect(chunks.flatMap((c) => c.generationIds)).toEqual(e.map((x) => x.id));
    expect(O.MAX_SPANS_JE_REQUEST).toBe(200);
  });
});

// ── HTTP-Schicht ─────────────────────────────────────────────────────────────

describe("sendeOtlp / sendeScore", () => {
  const z = (m: ReturnType<typeof mock>) => ({ baseUrl: "http://lf.test/", publicKey: "pk", secretKey: "sk", fetchImpl: m.fetchImpl });

  test("OTLP: POST, JSON, ingestion-version 4, Basic-Auth, Body unverändert", async () => {
    const m = mock();
    await API.sendeOtlp({ resourceSpans: [] }, z(m));
    expect(m.aufrufe[0]).toMatchObject({ url: "http://lf.test/api/public/otel/v1/traces", method: "POST", body: { resourceSpans: [] } });
    expect(m.aufrufe[0].headers).toEqual({ Authorization: "Basic " + Buffer.from("pk:sk").toString("base64"), "Content-Type": "application/json", "x-langfuse-ingestion-version": "4" });
  });

  test.each([
    ["HTTP 500", { otlpStatus: () => 500 }, 500],
    ["abgelehnte Spans (partialSuccess)", { partial: 2 }, undefined],
  ])("OTLP wirft bei %s", async (_n, cfg, status) => {
    const m = mock(cfg);
    const fehler = (await API.sendeOtlp({}, z(m)).catch((e: unknown) => e)) as Error & { status?: number };
    expect(fehler).toBeInstanceOf(Error);
    expect(fehler.status).toBe(status);
  });

  test("Score: POST auf /scores; HTTP-Fehler wirft mit Status", async () => {
    const m = mock();
    await API.sendeScore({ id: "x" }, z(m));
    expect(m.aufrufe[0]).toMatchObject({ url: "http://lf.test/api/public/scores", method: "POST", body: { id: "x" } });
    const fehler = (await API.sendeScore({ id: "x" }, z(mock({ scoreStatus: 503 }))).catch((e: unknown) => e)) as Error & { status?: number };
    expect(fehler.status).toBe(503);
  });
});

// ── Ablauf ───────────────────────────────────────────────────────────────────

describe("Idempotenz (Ist zuerst, Ledger als Brücke)", () => {
  test("Teil-Erfassung sendet genau die fehlenden; Lauf 2 mit verzögertem Ist sendet 0; Lauf 3 bestätigt; Lauf 4 macht keinen Request", async () => {
    const a = aufbau([msg("a", 1), msg("b", 2), msg("c", 3)]);
    const [sa, sb, sc] = [sollZu("a", 1), sollZu("b", 2), sollZu("c", 3)];
    const m = mock({ ist: 2, obs: [obsZu(sa), obsZu(sc)] });

    const r1 = await lauf(a, m);
    expect(r1.exitCode).toBe(0);
    expect(m.otlp).toHaveLength(1);
    expect(spansVon(m.otlp[0]).map((s) => s.spanId)).toEqual([sb.id]);
    expect(r1.protokoll).toMatchObject({ gesendet: 1, spans: 0 });
    expect(ledgerVon(a.ledger).s1).toMatchObject({ gesendet: [sb.id], bestaetigt: false });

    const r2 = await lauf(a, m); // Ingestion verzögert: Ist weiter 2
    expect(m.otlp).toHaveLength(1);
    expect(r2.protokoll.sessions[0]).toMatchObject({ status: "gesendet", gesendet: 0, ausstehend: 1 });
    expect(ledgerVon(a.ledger).s1.gesendet).toEqual([sb.id]);

    const m3 = mock({ ist: 3, obs: [obsZu(sa), obsZu(sb, { message_id: "b", quelle: "abgleich" }), obsZu(sc)] });
    await lauf(a, m3);
    expect(m3.otlp).toHaveLength(0);
    expect(ledgerVon(a.ledger).s1).toMatchObject({ bestaetigt: true, gesendet: [] });

    const m4 = mock({ ist: 3 });
    const r4 = await lauf(a, m4);
    expect(m4.aufrufe).toHaveLength(0);
    expect(r4.protokoll.sessions[0].status).toBe("bestätigt");
  });

  test("Ledger fehlt oder ist kaputt: Ist zuerst, keine Dublette bei vollständigem Ist; kaputtes Ledger wird gesichert", async () => {
    const a = aufbau([msg("a", 1), msg("b", 2)]);
    mkdirLedger(a.state);
    writeFileSync(a.ledger, "{kaputt");
    const m = mock({ ist: 2, obs: [obsZu(sollZu("a", 1)), obsZu(sollZu("b", 2))] });
    const r = await lauf(a, m);
    expect(r.exitCode).toBe(0);
    expect(m.otlp).toHaveLength(0);
    expect(readdirSync(a.state).filter((n) => n.startsWith("langfuse-abgleich.json.kaputt-"))).toHaveLength(1);
    expect(ledgerVon(a.ledger).s1.bestaetigt).toBe(true);
    // fehlendes Ledger: gleiche Antwort ohne Sicherungsdatei
    const b = aufbau([msg("a", 1), msg("b", 2)]);
    const mb = mock({ ist: 2, obs: [obsZu(sollZu("a", 1)), obsZu(sollZu("b", 2))] });
    await lauf(b, mb);
    expect(mb.otlp).toHaveLength(0);
    expect(existsSync(b.state) && readdirSync(b.state).some((n) => n.includes("kaputt"))).toBe(false);
  });

  test("mehrdeutig (Fingerabdruck: fehlend und Dubletten zugleich): nichts gesendet, bestätigt mit Befund", async () => {
    const a = aufbau([msg("a", 1), msg("b", 2), msg("c", 3)]);
    const fremd = obsZu(sollZu("zz", 99));
    const m = mock({ ist: 2, obs: [obsZu(sollZu("a", 1)), fremd] });
    const r = await lauf(a, m);
    expect(m.otlp).toHaveLength(0);
    expect(r.protokoll.sessions[0]).toMatchObject({ status: "mehrdeutig", dubletten: 1 });
    expect(r.protokoll.dubletten).toBe(1);
    expect(ledgerVon(a.ledger).s1).toMatchObject({ bestaetigt: true, gesendet: [] });
    expect(ledgerVon(a.ledger).s1.befund).toMatch(/mehrdeutig/);
  });

  test("Schlüsselart messageId: Dublette bleibt Dublette, der fehlende Call wird trotzdem gesendet", async () => {
    const a = aufbau([msg("a", 1), msg("b", 2), msg("c", 3)]);
    const m = mock({ ist: 2, obs: [obsZu(sollZu("a", 1), { message_id: "a" }), obsZu(sollZu("zz", 9), { message_id: "zz" })] });
    const r = await lauf(a, m);
    expect(spansVon(m.otlp[0]).map((s) => s.spanId)).toEqual([A.beobachtungsId("s1", "b"), A.beobachtungsId("s1", "c")]);
    expect(r.protokoll.sessions[0]).toMatchObject({ gesendet: 2, dubletten: 1 });
  });

  test("Subagent-Span je Session nur einmal; Kind-Call hängt am Span des Subagenten", async () => {
    const meta = JSON.stringify({ agentType: "kubernia-lens", description: "Lens R1" });
    const sub = (ids: string[]) => ids.map((i, n) => msg(i, 20 + n)).join("\n");
    const a = aufbau([msg("a", 1)], { [`${PRAEFIX}/s1/subagents/agent-x1.jsonl`]: sub(["s1a"]), [`${PRAEFIX}/s1/subagents/agent-x1.meta.json`]: meta });
    const m = mock({ ist: 0, obs: [] });
    await lauf(a, m);
    const namen = spansVon(m.otlp[0]).map((s) => s.name);
    expect(namen).toContain("Subagent: Lens R1");
    expect(spansVon(m.otlp[0])).toHaveLength(3);
    expect(ledgerVon(a.ledger).s1.spans).toEqual([A.subagentSpanId("s1", "x1")]);

    writeFileSync(join(a.root, PRAEFIX, "s1/subagents/agent-x1.jsonl"), sub(["s1a", "s1b"])); // neuer Call desselben Subagenten
    await lauf(a, m);
    const zweiter = spansVon(m.otlp[1]);
    expect(zweiter).toHaveLength(1);
    expect(zweiter[0].spanId).toBe(A.beobachtungsId("s1", "s1b"));
    expect(zweiter[0].parentSpanId).toBe(A.subagentSpanId("s1", "x1"));
  });
});

describe("Fehler", () => {
  test("HTTP 500 beim OTLP-POST: Ledger byte-gleich, Status im Protokoll, Exit 1", async () => {
    const a = aufbau([msg("a", 1)], { "README.txt": "x" });
    mkdirLedger(a.state);
    const vorher = JSON.stringify({ version: 1, sessions: { fremd: { pfad: join(a.root, "README.txt"), groesse: 1, mtime: 1, bestaetigt: true, gesendet: [], spans: [] } } }, null, 2) + "\n";
    writeFileSync(a.ledger, vorher);
    const m = mock({ ist: 0, otlpStatus: () => 500 });
    const r = await lauf(a, m);
    expect(r.exitCode).toBe(1);
    expect(r.protokoll.fehler[0]).toMatchObject({ session: "s1", status: 500 });
    expect(readFileSync(a.ledger, "utf8")).toBe(vorher);
    expect(m.scores).toHaveLength(0);
  });

  test("500 im zweiten Chunk: nur der erste steht im Ledger, nichts bestätigt", async () => {
    const viele = Array.from({ length: O.MAX_SPANS_JE_REQUEST + 1 }, (_, i) => msg(`m${i}`, i));
    const a = aufbau(viele);
    const m = mock({ ist: 0, otlpStatus: (n) => (n === 1 ? 500 : 200) });
    const r = await lauf(a, m);
    expect(r.exitCode).toBe(1);
    expect(m.otlp).toHaveLength(2);
    const e = ledgerVon(a.ledger).s1;
    expect(e.gesendet).toHaveLength(O.MAX_SPANS_JE_REQUEST);
    expect(e.bestaetigt).toBe(false);
    expect(e.groesse).toBeNull(); // Stand nicht als aktuell vermerkt
  });

  test("Fehler in einer Session lässt die übrigen weiterlaufen", async () => {
    const a = aufbau([msg("a", 1)], { [`${PRAEFIX}/s2.jsonl`]: msg("b", 2) });
    const m = mock({ ist: 0, otlpStatus: (n) => (n === 0 ? 500 : 200) });
    const r = await lauf(a, m);
    expect(r.protokoll.fehler).toHaveLength(1);
    expect(m.otlp).toHaveLength(2);
  });

  test.each([
    ["ohne Zugang", {}, [] as string[]],
    ["ohne Secret-Key", { LANGFUSE_PUBLIC_KEY: "pk" }, []],
    ["unbekanntes Flag", ZUGANG, ["--foo"]],
    ["Flag ohne Wert", ZUGANG, ["--session"]],
  ])("%s: Exit 2 und kein Request", async (_n, env, argv) => {
    const a = aufbau([msg("a", 1)]);
    const m = mock({ ist: 0 });
    const r = await N.nachliefern(N.parseArgs(argv), { env, now: SPAET(), fetchImpl: m.fetchImpl, projectsRoot: a.root, repoRoot: REPO, stateDir: a.state });
    expect(r.exitCode).toBe(2);
    expect(m.aufrufe).toHaveLength(0);
  });

  test("Score-Fehler: Exit 1, das Ledger der gesendeten Calls bleibt", async () => {
    const a = aufbau([msg("a", 1)]);
    const r = await lauf(a, mock({ ist: 0, scoreStatus: 500 }));
    expect(r.exitCode).toBe(1);
    expect(r.protokoll.fehler[0].status).toBe(500);
    expect(ledgerVon(a.ledger).s1.gesendet).toHaveLength(1);
  });
});

describe("Auswahl", () => {
  const MIN = 60_000;
  const H = 60 * MIN;
  /** Session mit Alter `alterMs` (mtime = jetzt − alter); `ledger` bekommt (groesse, mtime) der Datei. */
  const mitAlter = async (alterMs: number, args: Partial<Args>, ledger?: Partial<LedgerEintrag> | "gewachsen") => {
    const a = aufbau([msg("a", 1)]);
    const jetzt = Date.now();
    const t = new Date(jetzt - alterMs);
    utimesSync(join(a.root, PRAEFIX, "s1.jsonl"), t, t);
    if (ledger) {
      const [s] = A.findeSessions({ projectsRoot: a.root, praefix: PRAEFIX });
      mkdirLedger(a.state);
      const eintragL = { pfad: s.pfad, groesse: ledger === "gewachsen" ? s.groesse - 1 : s.groesse, mtime: s.mtime, bestaetigt: false, gesendet: [], spans: [], beendet: true, ...(ledger === "gewachsen" ? {} : ledger) };
      writeFileSync(a.ledger, JSON.stringify({ version: 1, sessions: { s1: eintragL } }));
    }
    const m = mock({ ist: 0 });
    const r = await lauf(a, m, args, jetzt);
    return { status: r.protokoll.sessions[0]?.status, m };
  };

  test.each([
    ["2 min mit --beendet", 2 * MIN, { beendet: "s1" }, undefined, "läuft"],
    ["3 min mit --beendet", 3 * MIN, { beendet: "s1" }, undefined, "gesendet"],
    ["explizites --session gilt als beendet (3 min)", 3 * MIN, { session: "s1" }, undefined, "gesendet"],
    ["23 h ohne Ende", 23 * H, {}, undefined, "läuft"],
    ["25 h ohne Ende", 25 * H, {}, undefined, "gesendet"],
    ["Ledger-beendet, Transkript unverändert (3 min)", 3 * MIN, {}, {}, "gesendet"],
    ["Ledger-beendet, Transkript seitdem gewachsen: 24-h-Frist", 3 * MIN, {}, "gewachsen", "läuft"],
    ["--beendet einer anderen Session ändert nichts", 3 * MIN, { beendet: "andere" }, undefined, "läuft"],
  ] as const)("%s", async (_n, alter, args, ledger, erwartet) => {
    expect((await mitAlter(alter, args, ledger)).status).toBe(erwartet);
  });

  test("--aktuell: Session wird nie angefasst (kein Request)", async () => {
    const r = await mitAlter(48 * H, { aktuell: "s1" });
    expect(r.status).toBe("aktuell");
    expect(r.m.aufrufe).toHaveLength(0);
  });

  test("vor dem Stichtag: nur lesen, „würde senden“ zählen, kein POST, kein Ledger, kein Score", async () => {
    const alt = msg("a", 1, { timestamp: "2026-10-06T10:00:00.000Z" });
    const a = aufbau([alt]);
    const m = mock({ ist: 0 });
    const r = await lauf(a, m);
    expect(r.protokoll.sessions[0]).toMatchObject({ status: "vor Stichtag", wuerdeSenden: 1, gesendet: 0 });
    expect(r.protokoll.wuerdeSenden).toBe(1);
    expect(m.posts()).toHaveLength(0);
    expect(existsSync(a.ledger)).toBe(false);
    expect(Number.isFinite(Date.parse(N.STICHTAG))).toBe(true);
  });

  test("Geschwister-Repo wird nicht gelesen, auch nicht Ende zu Ende; Worktree-Ordner des Projekts schon", async () => {
    const a = aufbau([msg("a", 1)], {
      [`${PRAEFIX}-tools/s9.jsonl`]: msg("fremd", 7),
      [`${PRAEFIX}--claude-worktrees-kq-1/s8.jsonl`]: msg("wt", 8),
    });
    const m = mock({ ist: 0 });
    const r = await lauf(a, m);
    expect(r.protokoll.sessions.map((s) => s.session).sort()).toEqual(["s1", "s8"]);
    const ids = m.otlp.flatMap((p) => spansVon(p).map((s) => attrs(s)["langfuse.observation.metadata.message_id"]));
    expect(ids).not.toContain("fremd");
  });

  test("--trocken: null POSTs, kein Ledger, kaputtes Ledger bleibt liegen, Bericht zählt „würde senden“", async () => {
    const a = aufbau([msg("a", 1), msg("b", 2)]);
    mkdirLedger(a.state);
    writeFileSync(a.ledger, "{kaputt");
    const m = mock({ ist: 1, obs: [obsZu(sollZu("a", 1))] });
    const r = await lauf(a, m, { trocken: true });
    expect(m.posts()).toHaveLength(0);
    expect(readFileSync(a.ledger, "utf8")).toBe("{kaputt");
    expect(readdirSync(a.state)).toEqual(["langfuse-abgleich.json"]);
    expect(r.protokoll).toMatchObject({ gesendet: 0, wuerdeSenden: 1 });
    expect(r.text).toMatch(/würde senden: 1/);
  });
});

describe("Scores", () => {
  test("deterministische IDs, NUMERIC, sessionId; erfassung_hook ignoriert Abgleich-Observations", async () => {
    const a = aufbau([msg("a", 1), msg("b", 2), msg("c", 3)]);
    const obs = [obsZu(sollZu("a", 1), { message_id: "a" }), obsZu(sollZu("b", 2), { message_id: "b", quelle: "abgleich" }), obsZu(sollZu("c", 3), { message_id: "c" })];
    const m = mock({ ist: 2, obs });
    await lauf(a, m);
    const nach = Object.fromEntries(m.scores.map((s) => [s.name as string, s]));
    expect(nach.erfassung).toMatchObject({ id: A.scoreId("s1", "erfassung"), dataType: "NUMERIC", sessionId: "s1", value: 1 });
    expect(nach.erfassung_hook).toMatchObject({ id: A.scoreId("s1", "erfassung_hook"), dataType: "NUMERIC", sessionId: "s1" });
    expect(nach.erfassung_hook.value).toBeCloseTo(2 / 3, 6);
    expect(nach.erfassung.environment).toBeUndefined();
  });

  test("Δ = 0: ohne Ledger-gesendet beide Scores (Environment nur wenn gesetzt), mit Ledger-gesendet nur erfassung", async () => {
    const a = aufbau([msg("a", 1)]);
    const m1 = mock({ ist: 1 });
    await lauf(a, m1, {}, SPAET(), { ...ZUGANG, LANGFUSE_TRACING_ENVIRONMENT: "dev" });
    expect(m1.scores.map((s) => s.name)).toEqual(["erfassung", "erfassung_hook"]);
    expect(m1.scores[0].environment).toBe("dev");

    const b = aufbau([msg("a", 1)]);
    await lauf(b, mock({ ist: 0, obs: [] })); // sendet a, Ledger-gesendet gefüllt
    const m2 = mock({ ist: 1 });
    await lauf(b, m2);
    expect(m2.scores.map((s) => s.name)).toEqual(["erfassung"]);
  });

  test("vor dem Stichtag und im Trockenlauf kein Score", async () => {
    const a = aufbau([msg("a", 1, { timestamp: "2026-10-06T10:00:00.000Z" })]);
    const m = mock({ ist: 0 });
    await lauf(a, m);
    await lauf(aufbau([msg("a", 1)]), m, { trocken: true });
    expect(m.scores).toHaveLength(0);
  });
});

describe("Ledger-Zustand und Grenzfälle", () => {
  const MIN = 60_000;
  test("Ledger-Einträge ohne Transkript werden beim schreibenden Lauf entfernt, im Trockenlauf nicht", async () => {
    const a = aufbau([msg("a", 1)]);
    mkdirLedger(a.state);
    const eintragL = { pfad: join(a.root, "gibt-es-nicht.jsonl"), groesse: 1, mtime: 1, bestaetigt: true, gesendet: [], spans: [] };
    writeFileSync(a.ledger, JSON.stringify({ version: 1, sessions: { weg: eintragL } }, null, 2) + "\n");
    await lauf(a, mock({ ist: 1 }), { trocken: true });
    expect(Object.keys(ledgerVon(a.ledger))).toEqual(["weg"]);
    await lauf(a, mock({ ist: 1 }));
    expect(Object.keys(ledgerVon(a.ledger))).toEqual(["s1"]);
  });

  test("bestätigte Session, die danach wächst: neu geprüft, Nachsendung bleibt unbestätigt, der Folgelauf fragt das Ist ab", async () => {
    const a = aufbau([msg("a", 1)]);
    await lauf(a, mock({ ist: 1 }));
    expect(ledgerVon(a.ledger).s1.bestaetigt).toBe(true);
    writeFileSync(join(a.root, PRAEFIX, "s1.jsonl"), [msg("a", 1), msg("b", 2)].join("\n"));
    const m2 = mock({ ist: 1, obs: [obsZu(sollZu("a", 1))] });
    await lauf(a, m2);
    expect(m2.otlp).toHaveLength(1);
    expect(ledgerVon(a.ledger).s1).toMatchObject({ bestaetigt: false, gesendet: [A.beobachtungsId("s1", "b")] });
    const m3 = mock({ ist: 1, obs: [obsZu(sollZu("a", 1))] });
    const r3 = await lauf(a, m3);
    expect(m3.aufrufe.length).toBeGreaterThan(0);
    expect(m3.otlp).toHaveLength(0);
    expect(r3.protokoll.sessions[0].ausstehend).toBe(1);
  });

  test("--beendet in der Ruhefrist wird im Ledger festgehalten und gilt im nächsten Lauf (2,5 min statt 24 h)", async () => {
    const a = aufbau([msg("a", 1)]);
    const jetzt = Date.now();
    const t1 = new Date(jetzt - 1 * MIN);
    utimesSync(join(a.root, PRAEFIX, "s1.jsonl"), t1, t1);
    const r1 = await lauf(a, mock({ ist: 0 }), { beendet: "s1" }, jetzt);
    expect(r1.protokoll.sessions[0].status).toBe("läuft");
    expect(ledgerVon(a.ledger).s1).toMatchObject({ beendet: true, bestaetigt: false });
    const m2 = mock({ ist: 0 });
    const r2 = await lauf(a, m2, {}, jetzt + 2 * MIN);
    expect(r2.protokoll.sessions[0].status).toBe("gesendet");
    expect(m2.otlp).toHaveLength(1);
  });

  test("--beendet in der Ruhefrist behält den bisherigen Ledger-Fortschritt (gesendet, spans)", async () => {
    const a = aufbau([msg("a", 1)]);
    const jetzt = Date.now();
    const t1 = new Date(jetzt - 1 * MIN);
    utimesSync(join(a.root, PRAEFIX, "s1.jsonl"), t1, t1);
    mkdirLedger(a.state);
    const alt = { pfad: join(a.root, PRAEFIX, "s1.jsonl"), groesse: 1, mtime: 1, bestaetigt: false, gesendet: ["x"], spans: ["y"] };
    writeFileSync(a.ledger, JSON.stringify({ version: 1, sessions: { s1: alt } }));
    await lauf(a, mock({ ist: 0 }), { beendet: "s1" }, jetzt);
    expect(ledgerVon(a.ledger).s1).toMatchObject({ gesendet: ["x"], spans: ["y"], beendet: true });
  });

  test("bestätigte, danach gewachsene Session mit --beendet in der Ruhefrist: nicht mehr bestätigt, der Folgelauf sendet", async () => {
    const a = aufbau([msg("a", 1)]);
    const jetzt = Date.now();
    const t1 = new Date(jetzt - 1 * MIN);
    utimesSync(join(a.root, PRAEFIX, "s1.jsonl"), t1, t1);
    mkdirLedger(a.state);
    const alt = { pfad: join(a.root, PRAEFIX, "s1.jsonl"), groesse: 1, mtime: 1, bestaetigt: true, gesendet: [], spans: [] };
    writeFileSync(a.ledger, JSON.stringify({ version: 1, sessions: { s1: alt } }));
    const r1 = await lauf(a, mock({ ist: 0 }), { beendet: "s1" }, jetzt);
    expect(r1.protokoll.sessions[0].status).toBe("läuft");
    expect(ledgerVon(a.ledger).s1).toMatchObject({ bestaetigt: false, beendet: true });
    const m2 = mock({ ist: 0 });
    const r2 = await lauf(a, m2, {}, jetzt + 2 * MIN);
    expect(r2.protokoll.sessions[0].status).toBe("gesendet");
    expect(m2.otlp).toHaveLength(1);
  });

  test("SessionEnd-Kind nach resume: wuchs das Transkript nach dem Ende, gilt das Ende nicht, es wird nicht gesendet und kein beendet vermerkt", async () => {
    const jetzt = Date.now();
    const frisch = () => {
      const x = aufbau([msg("a", 1)]);
      const t3 = new Date(jetzt - 3 * MIN);
      utimesSync(join(x.root, PRAEFIX, "s1.jsonl"), t3, t3);
      return x;
    };
    const a = frisch();
    const m = mock({ ist: 0 });
    const r = await lauf(a, m, { beendet: "s1", ende: jetzt - 10 * MIN }, jetzt);
    expect(r.protokoll.sessions[0].status).toBe("läuft");
    expect(m.aufrufe).toHaveLength(0);
    expect(existsSync(a.ledger)).toBe(false);
    // Schlupf von 5 s: das Transkript wurde 4 s NACH dem Ende-Zeitpunkt geschrieben (mtime = ende + 4 s): das Ende gilt, gesendet wird
    const m2 = mock({ ist: 0 });
    const r2 = await lauf(frisch(), m2, { beendet: "s1", ende: jetzt - 3 * MIN - 4_000 }, jetzt);
    expect(r2.protokoll.sessions[0].status).toBe("gesendet");
    // 6 s nach dem Ende: außerhalb des Schlupfs, das Ende gilt nicht
    const m3 = mock({ ist: 0 });
    const r3 = await lauf(frisch(), m3, { beendet: "s1", ende: jetzt - 3 * MIN - 6_000 }, jetzt);
    expect(r3.protokoll.sessions[0].status).toBe("läuft");
  });

  test("--aktuell setzt ein früheres beendet zurück (resume), --trocken lässt das Ledger byte-gleich", async () => {
    const a = aufbau([msg("a", 1)]);
    mkdirLedger(a.state);
    const alt = { pfad: join(a.root, PRAEFIX, "s1.jsonl"), groesse: 1, mtime: 1, bestaetigt: true, gesendet: [], spans: [], beendet: true };
    writeFileSync(a.ledger, JSON.stringify({ version: 1, sessions: { s1: alt } }));
    const vorher = readFileSync(a.ledger, "utf8");
    const mt = mock({ ist: 0 });
    await lauf(a, mt, { aktuell: "s1", trocken: true });
    expect(readFileSync(a.ledger, "utf8")).toBe(vorher);
    const m = mock({ ist: 0 });
    const r = await lauf(a, m, { aktuell: "s1" });
    expect(r.protokoll.sessions[0].status).toBe("aktuell");
    expect(ledgerVon(a.ledger).s1.beendet).toBe(false);
    expect(m.aufrufe).toHaveLength(0);
  });

  test("--aktuell einer anderen Session lässt beendet unberührt", async () => {
    const a = aufbau([msg("a", 1)]);
    mkdirLedger(a.state);
    const alt = { pfad: join(a.root, PRAEFIX, "s1.jsonl"), groesse: 1, mtime: 1, bestaetigt: true, gesendet: [], spans: [], beendet: true };
    writeFileSync(a.ledger, JSON.stringify({ version: 1, sessions: { s1: alt } }));
    await lauf(a, mock({ ist: 0 }), { aktuell: "andere" }, Date.now());
    expect(ledgerVon(a.ledger).s1.beendet).toBe(true);
  });

  test("protokoll.zugang: false ohne Keys (Exit 2, kein Request), true mit Keys", async () => {
    const a = aufbau([msg("a", 1)]);
    const m = mock({ ist: 1 });
    const ohne = await lauf(a, m, {}, SPAET(), {});
    expect(ohne.exitCode).toBe(2);
    expect(ohne.protokoll.zugang).toBe(false);
    expect(m.aufrufe).toHaveLength(0);
    expect((await lauf(a, m)).protokoll.zugang).toBe(true);
    expect((await lauf(a, m, { fehler: "x" })).protokoll.zugang).toBeNull();
  });

  test.each([
    ["ein Call vor und einer nach dem Stichtag: gilt als vor dem Stichtag", [iso(Date.parse(N.STICHTAG) - 1), iso(Date.parse(N.STICHTAG) + 3_600_000)], "vor Stichtag"],
    ["ein Call exakt am Stichtag: nicht davor", [iso(Date.parse(N.STICHTAG))], "gesendet"],
  ])("Stichtag: %s", async (_n, zeiten, status) => {
    const a = aufbau(zeiten.map((z, i) => msg(`m${i}`, i, { timestamp: z })));
    const m = mock({ ist: 0 });
    const r = await lauf(a, m);
    expect(r.protokoll.sessions[0].status).toBe(status);
    expect(m.otlp).toHaveLength(status === "gesendet" ? 1 : 0);
  });

  test("Session ohne Assistant-Call: „ohne Calls“, kein Request, Exit 0", async () => {
    const a = aufbau([JSON.stringify({ type: "user", sessionId: "s1", message: { role: "user", content: "hi" } })]);
    const m = mock({ ist: 0 });
    const r = await lauf(a, m);
    expect(r.exitCode).toBe(0);
    expect(r.protokoll.sessions[0].status).toBe("ohne Calls");
    expect(m.aufrufe).toHaveLength(0);
  });

  test("Lesefehler (HTTP 500 bei Metrics) in einer Session: Exit 1 mit Status, die übrige Session läuft weiter", async () => {
    const a = aufbau([msg("a", 1)], { [`${PRAEFIX}/s2.jsonl`]: msg("b", 2) });
    const m = mock({ ist: 0, getStatus: (n) => (n === 0 ? 500 : 200) });
    const r = await lauf(a, m);
    expect(r.exitCode).toBe(1);
    expect(r.protokoll.fehler).toHaveLength(1);
    expect(r.protokoll.fehler[0].status).toBe(500);
    expect(m.otlp).toHaveLength(1);
  });

  test("mehrdeutig: erfassung liegt unter 1 (nichts gesendet, zwei Calls fehlen)", async () => {
    const a = aufbau([msg("a", 1), msg("b", 2), msg("c", 3)]);
    const m = mock({ ist: 2, obs: [obsZu(sollZu("a", 1)), obsZu(sollZu("zz", 99))] });
    await lauf(a, m);
    const s = m.scores.find((x) => x.name === "erfassung")!;
    expect(s.value as number).toBeCloseTo(1 / 3, 6);
  });

  test("ungültiges --seit: Exit 2 ohne Request", async () => {
    const a = aufbau([msg("a", 1)]);
    const m = mock({ ist: 0 });
    const r = await lauf(a, m, { seit: "gestern" });
    expect(r.exitCode).toBe(2);
    expect(m.aufrufe).toHaveLength(0);
  });

  test("Ledger wird atomar geschrieben: keine tmp-Datei bleibt liegen", async () => {
    const a = aufbau([msg("a", 1)]);
    await lauf(a, mock({ ist: 0 }));
    expect(readdirSync(a.state)).toEqual(["langfuse-abgleich.json"]);
  });

  test("--json: der Bericht ist das Protokoll", async () => {
    const a = aufbau([msg("a", 1)]);
    const r = await lauf(a, mock({ ist: 1 }), { json: true });
    expect(JSON.parse(r.text)).toMatchObject({ geprueft: 1, gesendet: 0 });
  });
});

describe("parseArgs", () => {
  test("alle Flags landen im richtigen Feld", () => {
    expect(N.parseArgs(["--aktuell", "a", "--beendet", "b", "--session", "s", "--seit", "2026-10-01", "--ausloeser", "sessionend", "--trocken", "--json"])).toEqual({ aktuell: "a", beendet: "b", ausloeser: "sessionend", session: "s", seit: "2026-10-01", trocken: true, json: true, fehler: null });
  });
  test.each(["sessionstart", "sessionend"])("--ausloeser %s ist erlaubt", (w) => {
    expect(N.parseArgs(["--ausloeser", w])).toMatchObject({ ausloeser: w, fehler: null });
  });
  test.each([["manuell"], ["Stop"], [""]])("--ausloeser %j ist ungültig (Fehler, Hilfe nennt die erlaubten Werte)", (w) => {
    const a = N.parseArgs(["--ausloeser", w]);
    expect(a.fehler).toMatch(/sessionstart, sessionend/);
  });
  test.each([
    ["Wert fehlt", ["--session"]],
    ["der nächste Parameter ist ein Flag (sonst würde --session --trocken echt senden)", ["--session", "--trocken"]],
    ["unbekanntes Flag", ["--foo"]],
  ])("Fehler: %s", (_n, argv) => {
    expect(N.parseArgs(argv).fehler).toMatch(/\S/);
  });
});

describe("OTLP-Aufbau: Randfälle", () => {
  test("Eltern-Zyklus und Selbstverweis: jeder Span genau einmal, kein zyklischer Baum", () => {
    const e = [
      eintrag(1, { rolle: { agentId: "a1", agentType: "t", parentAgentId: "a2" } }),
      eintrag(2, { rolle: { agentId: "a2", agentType: "t", parentAgentId: "a1" } }),
      eintrag(3, { rolle: { agentId: "a3", agentType: "t", parentAgentId: "a3" } }),
    ];
    const spans = spansVon(O.bauePayloads("s1", e, { project: "repo" }).chunks[0].payload);
    expect(spans).toHaveLength(6);
    expect(new Set(spans.map((s) => s.spanId)).size).toBe(6);
    for (const id of ["a1", "a2", "a3"]) expect(spans.find((s) => s.spanId === A.subagentSpanId("s1", id))?.parentSpanId).toBeUndefined();
  });

  test("Agent unter einem Eltern-Zyklus, zu dem er nicht gehört: endet, hängt unter dem Zyklus, der Zyklus bleibt Root", () => {
    const e = [
      eintrag(1, { rolle: { agentId: "a1", agentType: "t", parentAgentId: "a2" } }),
      eintrag(2, { rolle: { agentId: "a2", agentType: "t", parentAgentId: "a1" } }),
      eintrag(3, { rolle: { agentId: "a3", agentType: "t", parentAgentId: "a1" } }),
    ];
    const spans = spansVon(O.bauePayloads("s1", e, { project: "repo" }).chunks[0].payload);
    const eltern = (id: string) => spans.find((s) => s.spanId === A.subagentSpanId("s1", id))?.parentSpanId;
    expect(eltern("a3")).toBe(A.subagentSpanId("s1", "a1"));
    expect(eltern("a1")).toBeUndefined();
    expect(eltern("a2")).toBeUndefined();
  });

  test("Zeitspanne des Subagent-Spans unabhängig von der Reihenfolge der Calls", () => {
    const rolle = { agentId: "a1", agentType: "t" };
    const spaet = eintrag(9, { rolle });
    const frueh = eintrag(1, { rolle });
    const s = spansVon(O.bauePayloads("s1", [spaet, frueh], { project: "repo" }).chunks[0].payload).find((x) => x.spanId === A.subagentSpanId("s1", "a1"))!;
    expect(s.startTimeUnixNano).toBe(O.nanos(frueh.ts));
    expect(s.endTimeUnixNano).toBe(O.nanos(spaet.ts));
  });

  test("ungültige Zeit ergibt Nanosekunden \"0\"", () => {
    expect(O.nanos("kein-datum")).toBe("0");
  });

  test("sendeOtlp: 2xx mit Nicht-JSON-Antwort ist kein Fehler", async () => {
    const fetchImpl: Fetch = () => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}), text: () => Promise.resolve("<html>ok</html>") });
    await expect(API.sendeOtlp({}, { baseUrl: "http://lf.test", publicKey: "pk", secretKey: "sk", fetchImpl })).resolves.toBeNull();
  });
});

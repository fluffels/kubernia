/* @harness-waechter
 * Langfuse-Vorbedingung (#1663 L36): ohne erreichbares Langfuse startet kein Entwicklungslauf, sonst wird nichts getrackt.
 * Bewertung (HTTP-Status, Verbindungsfehler, Timeout), Prüfung mit injiziertem fetch, Exit-Codes und die Kopplung
 * (SessionStart-Eintrag, Anker in AGENTS.md, Skills). Kein Netz: fetch ist ein Stub.
 *
 * Reines Node-Tooling ohne Declaration-File: Import über `unknown` auf ein lokales Interface. */
import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as raw from "../../scripts/langfuse-vorbedingung.mjs";

type Urteil = { ok: boolean; grund: string };
type Fetch = (url: string, init?: { signal?: AbortSignal }) => Promise<{ status: number }>;
type Vorbedingung = {
  HEALTH_PFAD: string;
  FRIST_MS: number;
  bewerteHealth: (e: { status?: number; fehler?: string }) => Urteil;
  basisUrl: (env: Record<string, string | undefined>) => string;
  pruefeLangfuse: (o: { baseUrl: string; fetchImpl?: Fetch; fristMs?: number }) => Promise<Urteil>;
  main: (argv: string[], env: Record<string, string | undefined>, out: (s: string) => void, err: (s: string) => void, o?: { fetchImpl?: Fetch; fristMs?: number }) => Promise<number>;
};
const v = raw as unknown as Vorbedingung;
const WURZEL = process.cwd();
const lies = (p: string) => readFileSync(join(WURZEL, p), "utf8");

const antwort = (status: number): Fetch => async () => ({ status });
const verbindungAbgelehnt: Fetch = async () => {
  throw Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNREFUSED" } });
};
const haengt: Fetch = (_url, init) =>
  new Promise((_res, rej) => {
    init?.signal?.addEventListener("abort", () => rej(Object.assign(new Error("aborted"), { name: "AbortError" })));
  });

describe("bewerteHealth", () => {
  test("HTTP 200 ist erreichbar", () => {
    expect(v.bewerteHealth({ status: 200 })).toEqual({ ok: true, grund: "Langfuse erreichbar (HTTP 200)" });
  });
  test.each([500, 503, 404, 302])("HTTP %i ist nicht erreichbar und nennt den Status", (status) => {
    const u = v.bewerteHealth({ status });
    expect(u.ok).toBe(false);
    expect(u.grund).toContain(String(status));
  });
  test("Verbindungsfehler ist nicht erreichbar und nennt ihn", () => {
    const u = v.bewerteHealth({ fehler: "ECONNREFUSED" });
    expect(u.ok).toBe(false);
    expect(u.grund).toContain("ECONNREFUSED");
  });
  test("weder Status noch Fehler ist nicht erreichbar (fail-closed)", () => {
    expect(v.bewerteHealth({}).ok).toBe(false);
  });
});

describe("basisUrl", () => {
  test("LANGFUSE_BASE_URL gewinnt, Standard ist localhost:3000, ein Schrägstrich am Ende fällt weg", () => {
    expect(v.basisUrl({ LANGFUSE_BASE_URL: "http://x:4000/" })).toBe("http://x:4000");
    expect(v.basisUrl({})).toBe("http://localhost:3000");
  });
});

describe("pruefeLangfuse", () => {
  test("ruft /api/public/health und bewertet 200 als ok", async () => {
    let url = "";
    const f: Fetch = async (u) => ((url = u), { status: 200 });
    expect((await v.pruefeLangfuse({ baseUrl: "http://h:1", fetchImpl: f })).ok).toBe(true);
    expect(url).toBe(`http://h:1${v.HEALTH_PFAD}`);
    expect(v.HEALTH_PFAD).toBe("/api/public/health");
  });
  test("HTTP 500 ist nicht ok", async () => {
    expect((await v.pruefeLangfuse({ baseUrl: "http://h", fetchImpl: antwort(500) })).ok).toBe(false);
  });
  test("ECONNREFUSED ist nicht ok und nennt den Code", async () => {
    const u = await v.pruefeLangfuse({ baseUrl: "http://h", fetchImpl: verbindungAbgelehnt });
    expect(u.ok).toBe(false);
    expect(u.grund).toContain("ECONNREFUSED");
  });
  test("Timeout bricht ab und ist nicht ok", async () => {
    const u = await v.pruefeLangfuse({ baseUrl: "http://h", fetchImpl: haengt, fristMs: 20 });
    expect(u.ok).toBe(false);
    expect(u.grund).toMatch(/Timeout/);
  });
  test("die Frist beträgt 3 s", () => {
    expect(v.FRIST_MS).toBe(3000);
  });
});

describe("main", () => {
  const lauf = async (argv: string[], fetchImpl: Fetch) => {
    const out: string[] = [];
    const err: string[] = [];
    const code = await v.main(argv, {}, (s) => out.push(s), (s) => err.push(s), { fetchImpl, fristMs: 20 });
    return { code, out, err };
  };
  test("erreichbar: Exit 0", async () => {
    expect((await lauf([], antwort(200))).code).toBe(0);
  });
  test("nicht erreichbar: Exit 1 und die Meldung „Langfuse aus, bitte starten“ auf stderr", async () => {
    const r = await lauf([], antwort(500));
    expect(r.code).toBe(1);
    expect(r.err.join("\n")).toContain("Langfuse aus, bitte starten");
  });
  test("--sessionstart: Exit 0 auch bei Ausfall, die Warnung steht auf stdout", async () => {
    const r = await lauf(["--sessionstart"], verbindungAbgelehnt);
    expect(r.code).toBe(0);
    expect(r.out.join("\n")).toContain("Langfuse aus, bitte starten");
  });
  test("--sessionstart: erreichbar bleibt still", async () => {
    const r = await lauf(["--sessionstart"], antwort(200));
    expect(r.code).toBe(0);
    expect(r.out).toEqual([]);
  });
  test("unbekanntes Argument: Exit 2", async () => {
    expect((await lauf(["--nope"], antwort(200))).code).toBe(2);
  });
});

describe("Kopplung", () => {
  test("SessionStart ruft das Skript mit --sessionstart", () => {
    const s = JSON.parse(lies(".claude/settings.json")) as { hooks: { SessionStart: { matcher: string; hooks: { args?: string[] }[] }[] } };
    const gruppe = s.hooks.SessionStart.find((g) => g.matcher === "startup|resume|clear");
    const args = (gruppe?.hooks ?? []).map((h) => h.args ?? []).find((x) => x.some((a) => a.endsWith("scripts/langfuse-vorbedingung.mjs")));
    expect(args).toContain("--sessionstart");
  });
  test("AGENTS.md nennt das Skript bei „Langfuse-Erfassung erhalten“", () => {
    const zeile = lies("AGENTS.md").split("\n").find((z) => z.includes("Langfuse-Erfassung erhalten"));
    expect(zeile).toContain("scripts/langfuse-vorbedingung.mjs");
  });
  test.each([".claude/skills/kubernia/SKILL.md", ".claude/skills/kubernia-workflow/SKILL.md"])("%s ruft die Vorbedingung vor dem Start", (datei) => {
    expect(lies(datei)).toContain("node scripts/langfuse-vorbedingung.mjs");
  });
  test("der Takt und der JS-Workflow prüfen sie nicht", () => {
    expect(lies(".claude/workflows/kubernia-ticket.js")).not.toContain("langfuse-vorbedingung");
    expect(lies(".github/workflows/board-takt.yml")).not.toContain("langfuse-vorbedingung");
  });
  test("das Glossar führt „Langfuse-Vorbedingung“", () => {
    expect(lies("docs/harness-glossar.md")).toContain("Langfuse-Vorbedingung");
  });
});

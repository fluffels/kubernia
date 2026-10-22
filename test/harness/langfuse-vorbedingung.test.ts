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
  main: (argv: string[], env: Record<string, string | undefined>, out: (s: string) => void, err: (s: string) => void, o?: { fetchImpl?: Fetch; fristMs?: number; home?: string; lies?: (p: string) => string }) => Promise<number>;
};
const v = raw as unknown as Vorbedingung;
const WURZEL = process.cwd();
const lies = (p: string) => readFileSync(join(WURZEL, p), "utf8");

const antwort = (status: number): Fetch => () => Promise.resolve({ status });
const verbindungAbgelehnt: Fetch = () => Promise.reject(Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNREFUSED" } }));
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
    const f: Fetch = (u) => ((url = u), Promise.resolve({ status: 200 }));
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

const keineDatei = () => {
  throw new Error("keine Datei");
};

describe("main", () => {
  const lauf = async (argv: string[], fetchImpl: Fetch) => {
    const out: string[] = [];
    const err: string[] = [];
    const code = await v.main(argv, {}, (s) => out.push(s), (s) => err.push(s), { fetchImpl, fristMs: 20, home: "/h", lies: keineDatei });
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
  test("--sessionstart: die Warnung ist JSON mit systemMessage (sichtbar) und additionalContext (Session), #1663 H1", async () => {
    const r = await lauf(["--sessionstart"], verbindungAbgelehnt);
    expect(r.out).toHaveLength(1);
    const j = JSON.parse(r.out[0]) as { systemMessage: string; hookSpecificOutput: { hookEventName: string; additionalContext: string } };
    expect(j.systemMessage).toContain("Langfuse aus, bitte starten");
    expect(j.hookSpecificOutput.hookEventName).toBe("SessionStart");
    expect(j.hookSpecificOutput.additionalContext).toContain("Ohne Langfuse startet kein Ticket");
  });
  test("die Basis-URL kommt wie beim Abgleich-Hook auch aus den Plugin-Optionen der User-Settings; die Umgebung hat Vorrang", async () => {
    const settings = JSON.stringify({ pluginConfigs: { "langfuse@x": { options: { LANGFUSE_BASE_URL: "http://plugin:3000/" } } } });
    const lies = (pfad: string) => {
      if (pfad.includes("settings.json")) return settings;
      throw new Error("keine Datei");
    };
    const urls: string[] = [];
    const f: Fetch = (url) => (urls.push(url), Promise.resolve({ status: 200 }));
    await v.main([], {}, () => {}, () => {}, { fetchImpl: f, home: "/h", lies });
    await v.main([], { LANGFUSE_BASE_URL: "http://env:1" }, () => {}, () => {}, { fetchImpl: f, home: "/h", lies });
    expect(urls).toEqual(["http://plugin:3000/api/public/health", "http://env:1/api/public/health"]);
  });
  test("die Vorbedingung liest nie eine Secret-Datei (.langfuse-secret, agent-secrets.env)", async () => {
    const gelesen: string[] = [];
    const lies = (pfad: string) => {
      gelesen.push(pfad);
      throw new Error("keine Datei");
    };
    const urls: string[] = [];
    const f: Fetch = (url) => (urls.push(url), Promise.resolve({ status: 200 }));
    await v.main([], {}, () => {}, () => {}, { fetchImpl: f, home: "/h", lies });
    expect(urls).toEqual(["http://localhost:3000/api/public/health"]);
    expect(gelesen.length).toBeGreaterThan(0);
    expect(gelesen.filter((p) => /langfuse-secret|agent-secrets/.test(p))).toEqual([]);
  });
  test("--sessionstart: erreichbar bleibt still", async () => {
    const r = await lauf(["--sessionstart"], antwort(200));
    expect(r.code).toBe(0);
    expect(r.out).toEqual([]);
  });
  test("unbekanntes Argument: Exit 2", async () => {
    expect((await lauf(["--nope"], antwort(200))).code).toBe(2);
  });
  test("--json erreichbar: Exit 0 und {erreichbar:true, grund:null} auf stdout, stderr leer", async () => {
    const r = await lauf(["--json"], antwort(200));
    expect(r.code).toBe(0);
    expect(r.out.map((z) => JSON.parse(z) as unknown)).toEqual([{ erreichbar: true, grund: null }]);
    expect(r.err).toEqual([]);
  });
  test("--json nicht erreichbar: Exit 1, stdout nennt den Grund, stderr bleibt leer", async () => {
    const r = await lauf(["--json"], antwort(500));
    expect(r.code).toBe(1);
    expect(r.out.map((z) => JSON.parse(z) as unknown)).toEqual([{ erreichbar: false, grund: "Langfuse antwortet mit HTTP 500" }]);
    expect(r.err).toEqual([]);
  });
  test("--json zusammen mit --sessionstart ist ein Aufruf-Fehler (Exit 2, nichts auf stdout)", async () => {
    const r = await lauf(["--json", "--sessionstart"], antwort(200));
    expect(r.code).toBe(2);
    expect(r.out).toEqual([]);
    expect(r.err.join("\n")).toContain("--json");
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
  test.each([".agents/skills/factory/ablauf.md"])("%s ruft die Vorbedingung vor dem Start", (datei) => {
    // Der Aufruf gehört in Schritt 0 (Liste im Abschnitt „Im Hauptchat“), nicht irgendwohin in die Datei.
    const zeilen = lies(datei).split("\n");
    const start = zeilen.findIndex((z) => z.startsWith("0. "));
    const ende = zeilen.findIndex((z, i) => i > start && /^\d+\. /.test(z));
    expect(start).toBeGreaterThanOrEqual(0);
    expect(zeilen.slice(start, ende < 0 ? undefined : ende).join("\n")).toContain("node scripts/langfuse-vorbedingung.mjs");
  });
  test("der Takt prüft sie nicht", () => {
    expect(lies(".github/workflows/board-takt.yml")).not.toContain("langfuse-vorbedingung");
  });
  test("das Glossar führt „Langfuse-Vorbedingung“", () => {
    expect(lies("docs/harness-glossar.md")).toContain("Langfuse-Vorbedingung");
  });
});

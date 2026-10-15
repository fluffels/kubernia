/* @harness-waechter
 * MCP-Ausfall (#1634): Klassifikator der Claude-Code-MCP-Logs, Pfad-Helfer, Hook-Lauf mit Temp-Logs und die Kopplung
 * (SessionStart-Eintrag, Regel-Anker in AGENTS.md, bekannte Server-Arten aus `.mcp.json`).
 *
 * Reines Node-Tooling ohne Declaration-File: Import über `unknown` auf ein lokales Interface (Technik wie test/sandbox-doctor.test.ts). */
import { afterEach, describe, expect, test } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as raw from "../../scripts/mcp-ausfall.mjs";

type Server = { name: string; type?: string; url?: string; headers?: Record<string, string> };
type Befund = { klasse: string; zeit: string; sessionId: string; text: string };
type Gruppe = { server: string; klasse: string; suffix: string; anzahl: number; erste: string; letzte: string; sessions: string[]; beispiel: string };
type Ausfall = {
  BEKANNTE_ARTEN: string[];
  ROUTINE: RegExp;
  serverAusConfig: (text: string) => Server[];
  fehlendeVariablen: (s: Server, env: Record<string, string | undefined>) => string[];
  slug: (p: string) => string;
  logBasis: (o: { plattform: string; env: Record<string, string | undefined>; home: string }) => string;
  projektOrdner: (namen: string[], wurzel: string) => { ordner: string; suffix: string }[];
  serverOrdner: (n: string) => string;
  klassifiziere: (zeilen: string[]) => Befund[];
  buendeln: (b: (Befund & { server: string; suffix?: string })[]) => Gruppe[];
  neuSeit: (b: Befund[], stand: string) => Befund[];
  meldung: (g: Gruppe[], v: string[], seit: string) => string;
  parseSeit: (arg: string | undefined, jetzt: number) => string;
  main: (argv: string[], env: Record<string, string | undefined>, out: (t: string) => void, o?: { plattform?: string; home?: string; jetzt?: number }) => number;
};
const a = raw as unknown as Ausfall;
const WURZEL = join(import.meta.dirname, "..", "..");

const dbg = (debug: string, zeit = "2026-10-15T10:00:00.000Z") => JSON.stringify({ debug, timestamp: zeit, sessionId: "s1", cwd: "C:\\x" });
const err = (error: string, zeit = "2026-10-15T10:00:00.000Z") => JSON.stringify({ error, timestamp: zeit, sessionId: "s1", cwd: "C:\\x" });

describe("klassifiziere", () => {
  test("saubere Session ergibt keinen Befund", () => {
    const zeilen = [dbg("Starting connection with timeout of 30000ms"), dbg("Successfully connected (transport: stdio) in 600ms"), dbg("Tool 'x' completed successfully in 5ms"), dbg("connection closed after 5s (cleanly)")];
    expect(a.klassifiziere(zeilen)).toEqual([]);
  });
  test("npx-Fallback in Server-stderr, übriges stderr und sonstige Fehlerzeilen", () => {
    const r = a.klassifiziere([err("Server stderr: playwright-mcp: lokale Installation fehlt → npx @playwright/mcp@0.0.83"), err("Server stderr: boom"), err("Connection failed: x")]);
    expect(r.map((b) => b.klasse)).toEqual(["npx-fallback", "stderr", "fehler"]);
    // Die Exit-Zeile des Launchers nennt „Modus npx“, ist aber kein Fallback-Start.
    expect(a.klassifiziere([err("Server stderr: playwright-mcp: Server beendet (Exit 1, nach 5 s, Modus npx)")])[0].klasse).toBe("stderr");
  });
  test("zweites Starting connection je Datei ist ein Reconnect, das erste nicht", () => {
    const r = a.klassifiziere([dbg("Starting connection with timeout of 30000ms"), dbg("Starting connection with timeout of 30000ms", "2026-10-15T11:00:00.000Z")]);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ klasse: "reconnect", zeit: "2026-10-15T11:00:00.000Z", sessionId: "s1" });
  });
  test("Tool-Fehler (### …, Tool '…' failed) sind kein Serverausfall", () => {
    expect(a.klassifiziere([err("### Error\nError: x"), dbg("Tool 'browser_navigate' failed after 0s: ### Error\nnet::ERR_BLOCKED_BY_CLIENT")])).toEqual([]);
  });
  test("SSE-Routinezyklus wird ignoriert, Fehler/Timeout/unsauberes Close sind ein Abbruch", () => {
    expect(a.klassifiziere([dbg("SSE stream disconnected, attempting automatic reconnection"), dbg("Terminal connection error: max consecutive terminal errors failed")])).toEqual([]);
    const r = a.klassifiziere([dbg("Connection failed after 3s"), dbg("request timed out"), dbg("connection closed after 9s")]);
    expect(r.map((b) => b.klasse)).toEqual(["abbruch", "abbruch", "abbruch"]);
  });
  test("kaputte und fremde Zeilen werfen nie", () => {
    expect(a.klassifiziere(["{kaputt", "null", "42", JSON.stringify({ x: 1 }), JSON.stringify({ debug: 5 })])).toEqual([]);
  });
});

describe("Pfad-Helfer", () => {
  test("logBasis je Plattform, Override hat Vorrang", () => {
    expect(a.logBasis({ plattform: "win32", env: { LOCALAPPDATA: "L" }, home: "H" })).toBe(join("L", "claude-cli-nodejs", "Cache"));
    expect(a.logBasis({ plattform: "darwin", env: {}, home: "H" })).toBe(join("H", "Library", "Caches", "claude-cli-nodejs"));
    expect(a.logBasis({ plattform: "linux", env: { XDG_CACHE_HOME: "X" }, home: "H" })).toBe(join("X", "claude-cli-nodejs"));
    expect(a.logBasis({ plattform: "linux", env: {}, home: "H" })).toBe(join("H", ".cache", "claude-cli-nodejs"));
    expect(a.logBasis({ plattform: "win32", env: { KQ_MCP_LOG_DIR: "O", LOCALAPPDATA: "L" }, home: "H" })).toBe("O");
  });
  test("projektOrdner: Hauptcheckout und Worktrees, nie Namensvettern", () => {
    const namen = ["C--dev-proj", "C--dev-proj--claude-worktrees-kq-1", "C--dev-proj2", "C--dev-other"];
    const erwartet = [{ ordner: "C--dev-proj", suffix: "" }, { ordner: "C--dev-proj--claude-worktrees-kq-1", suffix: "--claude-worktrees-kq-1" }];
    expect(a.projektOrdner(namen, "C:\\dev\\proj")).toEqual(erwartet);
    expect(a.projektOrdner(namen, "C:\\dev\\proj\\.claude\\worktrees\\kq-1\\")).toEqual(erwartet);
  });
  test("serverOrdner schlägt den Namen wie Claude Code", () => {
    expect(a.serverOrdner("plugin:x y")).toBe("mcp-logs-plugin-x-y");
  });
});

describe("bündeln, filtern, melden", () => {
  const b = (zeit: string, sessionId: string, klasse = "reconnect") => ({ klasse, zeit, sessionId, text: "Starting\nconnection", server: "pw", suffix: "" });
  test("bündelt je Server/Klasse/Suffix mit Zeitspanne und höchstens 3 Sessions", () => {
    const g = a.buendeln([b("2026-10-15T12:00:00Z", "a"), b("2026-10-15T10:00:00Z", "b"), b("2026-10-15T11:00:00Z", "c"), b("2026-10-15T11:30:00Z", "d"), { ...b("2026-10-15T09:00:00Z", "e"), suffix: "--w" }]);
    expect(g).toHaveLength(2);
    expect(g[0]).toMatchObject({ anzahl: 4, erste: "2026-10-15T10:00:00Z", letzte: "2026-10-15T12:00:00Z", sessions: ["a", "b", "c"], beispiel: "Starting connection" });
    expect(g[1]).toMatchObject({ anzahl: 1, suffix: "--w" });
  });
  test("neuSeit lässt Älteres weg", () => {
    expect(a.neuSeit([b("2026-10-15T09:00:00Z", "a"), b("2026-10-15T11:00:00Z", "b")], "2026-10-15T10:00:00Z")).toHaveLength(1);
  });
  test("meldung: leer ergibt \"\", sonst Befunde samt Meldepflicht, Kappung bei 10 Gruppen", () => {
    expect(a.meldung([], [], "S")).toBe("");
    const viele = a.buendeln(Array.from({ length: 12 }, (_, i) => ({ ...b("2026-10-15T09:00:00Z", "a"), server: `s${i}` })));
    const t = a.meldung(viele, ["x: Variable fehlt"], "2026-10-15T00:00:00Z");
    expect(t.split("\n").filter((z) => z.startsWith("- s"))).toHaveLength(10);
    expect(t).toContain("… 2 weitere Gruppen");
    expect(t).toContain("- x: Variable fehlt");
    expect(t).toContain("node scripts/mcp-ausfall.mjs --seit 2026-10-15T00:00:00Z");
    expect(a.meldung([], ["nur Variable"], "S")).toContain("- nur Variable");
  });
  test("parseSeit: ISO, Nh, Standard bei Unsinn", () => {
    const jetzt = Date.parse("2026-10-15T12:00:00Z");
    expect(a.parseSeit("2026-10-14T00:00:00Z", jetzt)).toBe("2026-10-14T00:00:00.000Z");
    expect(a.parseSeit("2h", jetzt)).toBe("2026-10-15T10:00:00.000Z");
    expect(a.parseSeit("quatsch", jetzt)).toBe("2026-10-14T12:00:00.000Z");
    expect(a.parseSeit(undefined, jetzt)).toBe("2026-10-14T12:00:00.000Z");
  });
});

describe("serverAusConfig und fehlendeVariablen", () => {
  test("liest Namen und Konfiguration; kaputtes oder leeres JSON ergibt []", () => {
    expect(a.serverAusConfig('{"mcpServers":{"a":{"type":"stdio","command":"node"}}}')).toEqual([{ name: "a", type: "stdio", command: "node" }]);
    expect(a.serverAusConfig("{kaputt")).toEqual([]);
    expect(a.serverAusConfig("{}")).toEqual([]);
  });
  test("nennt nur nicht gesetzte oder leere Platzhalter", () => {
    const s: Server = { name: "p", type: "http", url: "https://x/mcp", headers: { Authorization: "${TOK}" } };
    expect(a.fehlendeVariablen(s, {})).toEqual(["TOK"]);
    expect(a.fehlendeVariablen(s, { TOK: "" })).toEqual(["TOK"]);
    expect(a.fehlendeVariablen(s, { TOK: "x" })).toEqual([]);
  });
});

describe("main mit Temp-Logs", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });
  /** Projektwurzel mit `.mcp.json` und Log-Basis mit einem Reconnect-Log; Rückgabe: Umgebung. */
  function aufbau(mcp = '{"mcpServers":{"pw":{"type":"stdio","command":"node"}}}') {
    const d = mkdtempSync(join(tmpdir(), "kq-mcp-ausfall-"));
    dirs.push(d);
    const wurzel = join(d, "proj");
    mkdirSync(wurzel);
    writeFileSync(join(wurzel, ".mcp.json"), mcp);
    const logdir = join(d, "logs", a.slug(wurzel), "mcp-logs-pw");
    mkdirSync(logdir, { recursive: true });
    writeFileSync(join(logdir, "2026-10-15T09-00-00Z.jsonl"), `${dbg("Starting connection x", "2026-10-15T09:00:00.000Z")}\n${dbg("Starting connection x", "2026-10-15T09:30:00.000Z")}\n`);
    const env = { CLAUDE_PROJECT_DIR: wurzel, KQ_MCP_LOG_DIR: join(d, "logs"), KQ_MCP_AUSFALL_STAND: join(d, "stand", "stand.json") };
    return { env, d };
  }
  const jetzt = Date.now();
  const lauf = (argv: string[], env: Record<string, string | undefined>, o = {}) => {
    const aus: string[] = [];
    const code = a.main(argv, env, (t) => aus.push(t), { jetzt, ...o });
    return { code, aus };
  };

  test("--sessionstart meldet den Reconnect, schreibt den Stand, der zweite Lauf ist stumm", () => {
    const { env, d } = aufbau();
    const jetztNah = Date.parse("2026-10-15T10:00:00Z");
    const eins = lauf(["--sessionstart"], env, { jetzt: jetztNah });
    expect(eins.code).toBe(0);
    expect(eins.aus.join("\n")).toContain("pw: reconnect ×1");
    expect(JSON.parse(readFileSync(join(d, "stand", "stand.json"), "utf8")).bis).toBe("2026-10-15T10:00:00.000Z");
    expect(lauf(["--sessionstart"], env, { jetzt: jetztNah + 60_000 }).aus).toEqual([]);
  });
  test("ohne Modus: --json liefert parsebare Rohzeilen und schreibt keinen Stand", () => {
    const { env, d } = aufbau();
    const r = lauf(["--seit", "2026-10-15T00:00:00Z", "--json"], env);
    expect(JSON.parse(r.aus[0])).toMatchObject({ klasse: "reconnect", server: "pw" });
    expect(() => readFileSync(join(d, "stand", "stand.json"))).toThrow();
  });
  test("Befunde älter als --seit entfallen; leer ergibt keine Ausgabe", () => {
    const { env } = aufbau();
    expect(lauf(["--seit", "2026-10-15T09:10:00Z"], env).aus.join("\n")).toContain("reconnect ×1");
    expect(lauf(["--seit", "2026-10-15T09:40:00Z"], env).aus).toEqual([]);
  });
  test("fehlender Log-Basisordner ergibt eine Zeile mit dem Pfad", () => {
    const { env, d } = aufbau();
    const r = lauf([], { ...env, KQ_MCP_LOG_DIR: join(d, "gibtsnicht") });
    expect(r.aus).toHaveLength(1);
    expect(r.aus[0]).toContain("gibtsnicht");
  });
  test("kaputtes .mcp.json wirft nicht, Exit 0; unbekannte Art und fehlende Variable werden genannt", () => {
    const { env } = aufbau("{kaputt");
    expect(lauf(["--sessionstart"], env)).toEqual({ code: 0, aus: [] });
    const { env: env2 } = aufbau('{"mcpServers":{"w":{"type":"ws"},"h":{"type":"http","url":"u","headers":{"A":"${KQ_TEST_FEHLT}"}}}}');
    const t = lauf(["--seit", "2026-10-15T00:00:00Z"], env2).aus.join("\n");
    expect(t).toContain('w: Server-Art "ws"');
    expect(t).toContain("KQ_TEST_FEHLT");
  });
});

describe("Kopplung: Hook, Regel, Server-Arten", () => {
  const lies = (p: string) => readFileSync(join(WURZEL, p), "utf8");
  test("SessionStart (startup|resume|clear) ruft mcp-ausfall mit --sessionstart", () => {
    const settings = JSON.parse(lies(".claude/settings.json")) as { hooks: { SessionStart: { matcher: string; hooks: { args?: string[] }[] }[] } };
    const gruppe = settings.hooks.SessionStart.find((g) => g.matcher === "startup|resume|clear");
    const args = (gruppe?.hooks ?? []).map((h) => h.args ?? []).find((x) => x.some((s) => s.endsWith("scripts/mcp-ausfall.mjs")));
    expect(args).toContain("--sessionstart");
  });
  test("AGENTS.md hält die Ausfall-Regel im Bullet „Harness-Befunde sind Zeilen“", () => {
    const zeile = lies("AGENTS.md").split("\n").find((z) => z.includes("Harness-Befunde sind Zeilen, keine Tickets"));
    expect(zeile).toContain("scripts/mcp-ausfall.mjs");
  });
  test("jede Server-Art in .mcp.json ist dem Skript bekannt", () => {
    for (const s of a.serverAusConfig(lies(".mcp.json"))) expect(a.BEKANNTE_ARTEN, s.name).toContain(s.type);
  });
});

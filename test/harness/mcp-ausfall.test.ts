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
type Befund = { klasse: string; zeit: string; sessionId: string; text: string; code?: string; ursache?: string };
type Gruppe = { server: string; klasse: string; code: string; suffix: string; anzahl: number; erste: string; letzte: string; sessions: string[]; beispiel: string };
type Ausfall = {
  BEKANNTE_ARTEN: string[];
  ROUTINE: RegExp;
  serverAusConfig: (text: string) => Server[];
  fehlendeVariablen: (s: Server, env: Record<string, string | undefined>) => string[];
  slug: (p: string) => string;
  hauptWurzel: (p: string) => string;
  standPfad: (w: string, env: Record<string, string | undefined>, tmp: string) => string;
  logBasis: (o: { plattform: string; env: Record<string, string | undefined>; home: string }) => string;
  projektOrdner: (namen: string[], wurzel: string) => { ordner: string; suffix: string }[];
  serverOrdner: (n: string) => string;
  serverNameFuerOrdner: (ordner: string, server: Server[]) => string | null;
  serverAnzeige: (ordner: string, server: Server[]) => string | null;
  istNpxFallback: (text: string) => boolean;
  klassifiziere: (zeilen: string[]) => Befund[];
  netzCode: (text: string) => string;
  buendeln: (b: (Befund & { server: string; suffix?: string })[]) => Gruppe[];
  neuSeit: (b: Befund[], stand: string) => Befund[];
  meldung: (g: Gruppe[], v: string[], seit: string) => string;
  parseSeit: (arg: string | undefined, jetzt: number) => string;
  main: (argv: string[], env: Record<string, string | undefined>, out: (t: string) => void, o?: { plattform?: string; home?: string; jetzt?: number; err?: (t: string) => void }) => number;
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
    expect(a.klassifiziere([err("Server stderr: starte npx -y paket@1")])[0].klasse).toBe("npx-fallback");
    // Die Exit-Zeile des Launchers nennt „Modus npx“, ist aber kein Fallback-Start.
    expect(a.klassifiziere([err("Server stderr: playwright-mcp: Server beendet (Exit 1, nach 5 s, Modus npx)")])[0].klasse).toBe("stderr");
  });
  test("zweites Starting connection je Datei ist ein Reconnect, das erste nicht", () => {
    const r = a.klassifiziere([dbg("Starting connection with timeout of 30000ms"), dbg("Starting connection with timeout of 30000ms", "2026-10-15T11:00:00.000Z")]);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ klasse: "reconnect", zeit: "2026-10-15T11:00:00.000Z", sessionId: "s1" });
  });
  const START = "Starting connection with timeout of 30000ms";
  const inSession = (sessionId: string, debug = START, zeit = "2026-10-15T10:00:00.000Z") => JSON.stringify({ debug, timestamp: zeit, sessionId, cwd: "C:\\x" });
  test("ein Start einer anderen Session in derselben Logdatei ist kein Reconnect; derselbe Start der neuen Session danach schon", () => {
    expect(a.klassifiziere([inSession("s1"), inSession("s2", START, "2026-10-15T11:00:00.000Z")])).toEqual([]);
    const r = a.klassifiziere([inSession("s1"), inSession("s2"), inSession("s2", START, "2026-10-15T12:00:00.000Z")]);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ klasse: "reconnect", sessionId: "s2", zeit: "2026-10-15T12:00:00.000Z" });
    // Zeilen ohne sessionId gelten als dieselbe (leere) Session wie zuvor.
    expect(a.klassifiziere([JSON.stringify({ debug: START }), JSON.stringify({ debug: START })])).toHaveLength(1);
  });
  const VORSPANN = ["Initializing HTTP transport to http://localhost:3000/api/public/mcp", "Node version: v26, Platform: win32", "Environment: {}", "HTTP transport options: {}", "HTTP transport created successfully"];
  test("Reconnect trägt die letzte Logzeile vor dem Neustart als ursache (Vorspann ausgenommen, ≤ 160 Zeichen)", () => {
    const lang = `Transient ECONNREFUSED on initial connect — retry 1/3 in 1000ms ${"x".repeat(300)}`;
    const r = a.klassifiziere([dbg(START), dbg(lang), ...VORSPANN.map((t) => dbg(t)), dbg(START, "2026-10-15T11:00:00.000Z")]);
    expect(r).toHaveLength(1);
    expect(r[0].ursache).toHaveLength(160);
    expect(r[0].ursache).toMatch(/^Transient ECONNREFUSED/);
    expect(a.klassifiziere([dbg(START), dbg(START)])[0].ursache).toBe("");
  });
  test("Reconnect nach einer Routine-Meldung (automatische Wiederverbindung) ist kein Befund", () => {
    const routine = [dbg("Closing transport (max consecutive terminal errors)"), dbg("HTTP transport closed/disconnected, attempting automatic reconnection"), ...VORSPANN.map((t) => dbg(t))];
    expect(a.klassifiziere([dbg(START), ...routine, dbg(START, "2026-10-15T11:00:00.000Z")])).toEqual([]);
    const nichtRoutine = a.klassifiziere([dbg(START), dbg("Successfully connected (transport: http) in 5ms"), ...VORSPANN.map((t) => dbg(t)), dbg(START)]);
    expect(nichtRoutine).toHaveLength(1);
    expect(nichtRoutine[0].ursache).toBe("Successfully connected (transport: http) in 5ms");
  });
  test("Tool-Fehler (### …, Tool '…' failed) sind kein Serverausfall", () => {
    expect(a.klassifiziere([err("### Error\nError: x"), dbg("Tool 'browser_navigate' failed after 0s: ### Error\nnet::ERR_BLOCKED_BY_CLIENT")])).toEqual([]);
  });
  test("SSE-Routinezyklus wird ignoriert, Fehler/Timeout/unsauberes Close sind ein Abbruch", () => {
    expect(a.klassifiziere([dbg("SSE stream disconnected, attempting automatic reconnection"), dbg("Terminal connection error: max consecutive terminal errors failed")])).toEqual([]);
    const r = a.klassifiziere([dbg("Connection failed after 3s"), dbg("request timed out"), dbg("connection closed after 9s")]);
    expect(r.map((b) => b.klasse)).toEqual(["abbruch", "abbruch", "abbruch"]);
  });
  test("Netzabbruch mit Fehlercode (Tool-failed, tools/list, HTTP Connection) ist ein Abbruch mit Code, MCP-Protokollfehler nicht", () => {
    const r = a.klassifiziere([
      dbg("Tool 'getMetricsSchema' failed after 0s: ECONNRESET: The socket connection was closed unexpectedly"),
      dbg("tools/list failed (ECONNRESET: The socket connection was closed)"),
      dbg("HTTP Connection failed after 10560ms: ECONNRESET: boom"),
      dbg("Tool 'x' failed after 1s: fetch failed"),
    ]);
    expect(r.map((b) => b.klasse)).toEqual(["abbruch", "abbruch", "abbruch", "abbruch"]);
    expect(r.map((b) => b.code)).toEqual(["ECONNRESET", "ECONNRESET", "ECONNRESET", "fetch failed"]);
    expect(a.klassifiziere([dbg("Tool 'listObservations' failed after 0s: MCP error -32602: Invalid params")])).toEqual([]);
    expect(a.klassifiziere([dbg("Tool 'listObservations' failed after 0s: MCP error -32602: socket ECONNRESET im Text")])).toEqual([]);
    expect(a.klassifiziere([dbg("Connection failed after 3s")])[0].code).toBe("");
    // Die eigene Fehlerausgabe eines Tools (### Error) ist kein Serverausfall, auch mit Netzcode; `socket` zählt nur als ganzes Wort.
    expect(a.klassifiziere([dbg("Tool 'browser_navigate' failed after 0s: ### Error\nError: connect ECONNREFUSED 127.0.0.1:5173")])).toEqual([]);
    expect(a.klassifiziere([dbg("Tool 'browser_navigate' failed after 0s: net::ERR_SOCKET_NOT_CONNECTED")])).toEqual([]);
    expect(a.klassifiziere([dbg("Tool 'x' failed after 0s: WebSocket is closed")])).toEqual([]);
    expect(a.netzCode("the socket was closed")).toBe("socket");
    expect(a.netzCode("ETIMEDOUT")).toBe("ETIMEDOUT");
    expect(a.netzCode("write EPIPE")).toBe("EPIPE");
    expect(a.netzCode("WebSocket")).toBe("");
    expect(a.netzCode("SocketError")).toBe("");
    expect(a.klassifiziere([dbg("Tool 'x' failed after 0s: socketpath missing")])).toEqual([]);
  });
  test("buendeln trennt Abbrüche nach Code, meldung nennt ihn", () => {
    const mk = (code: string) => ({ klasse: "abbruch", zeit: "2026-10-15T10:00:00Z", sessionId: "a", text: "x", server: "lf", suffix: "", code });
    const g = a.buendeln([mk("ECONNRESET"), mk("ECONNRESET"), mk("ETIMEDOUT")]);
    expect(g).toHaveLength(2);
    expect(a.meldung(g, [], "S")).toContain("lf: abbruch (ECONNRESET) ×2");
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
    expect(a.logBasis({ plattform: "win32", env: { FACTORY_MCP_LOG_DIR: "O", LOCALAPPDATA: "L" }, home: "H" })).toBe("O");
  });
  test("logBasis unter Windows ohne LOCALAPPDATA fällt auf das Home zurück", () => {
    expect(a.logBasis({ plattform: "win32", env: {}, home: "H" })).toBe(join("H", "AppData", "Local", "claude-cli-nodejs", "Cache"));
  });
  test("hauptWurzel kürzt Worktree und Schrägstrich am Ende, sonst unverändert", () => {
    expect(a.hauptWurzel("C:\\dev\\proj\\.claude\\worktrees\\kq-1\\")).toBe("C:\\dev\\proj");
    expect(a.hauptWurzel("/dev/proj/.claude/worktrees/kq-1")).toBe("/dev/proj");
    expect(a.hauptWurzel("C:\\dev\\proj")).toBe("C:\\dev\\proj");
  });
  test("hauptWurzel lässt tiefere Pfade und Namensvettern unverändert", () => {
    expect(a.hauptWurzel("/dev/proj/.claude/worktrees/kq-1/sub")).toBe("/dev/proj/.claude/worktrees/kq-1/sub");
    expect(a.hauptWurzel("/dev/proj/.claude/worktreesX/kq-1")).toBe("/dev/proj/.claude/worktreesX/kq-1");
  });
  test("standPfad: Worktree und Hauptcheckout teilen eine Datei, der Override hat Vorrang", () => {
    const haupt = a.standPfad("/dev/proj", {}, "/tmp");
    expect(a.standPfad("/dev/proj/.claude/worktrees/kq-1", {}, "/tmp")).toBe(haupt);
    expect(haupt).toBe(join("/tmp", "kq-mcp-ausfall--dev-proj.json"));
    expect(a.standPfad("/dev/proj", { FACTORY_MCP_AUSFALL_STAND: "/x/s.json" }, "/tmp")).toBe("/x/s.json");
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
  test("serverNameFuerOrdner: Konfig-Name bei Treffer, sonst der Ordnername; fremde Ordner ergeben null", () => {
    const cfg = [{ name: "plugin:x y" }];
    expect(a.serverNameFuerOrdner("mcp-logs-plugin-x-y", cfg)).toBe("plugin:x y");
    expect(a.serverNameFuerOrdner("mcp-logs-langfuse", cfg)).toBe("langfuse");
    expect(a.serverNameFuerOrdner("mcp-logs-", cfg)).toBeNull();
    expect(a.serverNameFuerOrdner("anderes", cfg)).toBeNull();
  });
  test("serverAnzeige: Repo-Server (likec4) schlicht, Server ohne .mcp.json-Eintrag (claude-artifacts) als extern gekennzeichnet", () => {
    const cfg = [{ name: "likec4" }];
    expect(a.serverAnzeige("mcp-logs-likec4", cfg)).toBe("likec4");
    expect(a.serverAnzeige("mcp-logs-claude-artifacts", cfg)).toBe("claude-artifacts [extern (nicht im Repo konfiguriert)]");
    expect(a.serverAnzeige("anderes", cfg)).toBeNull();
  });
  test("istNpxFallback erkennt den Launcher-Hinweis, nicht beliebige stderr-Zeilen", () => {
    expect(a.istNpxFallback("Server stderr: playwright-mcp: lokale Installation fehlt oder weicht ab → npx @playwright/mcp@1.2.3")).toBe(true);
    expect(a.istNpxFallback("Server stderr: npx -y likec4@1.0.0")).toBe(true);
    expect(a.istNpxFallback("Server stderr: Fehler beim Start")).toBe(false);
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
  test("die Bündelzeile nennt die Ursache des Reconnects, ohne Ursache bleibt das Beispiel unverändert", () => {
    const g = a.buendeln([{ ...b("2026-10-15T12:00:00Z", "a"), ursache: "Transient ECONNREFUSED on initial connect" }]);
    expect(g[0].beispiel).toBe("Starting connection (davor: Transient ECONNREFUSED on initial connect)");
    expect(a.meldung(g, [], "S")).toContain("davor: Transient ECONNREFUSED");
    expect(a.buendeln([{ ...b("2026-10-15T12:00:00Z", "a"), ursache: "" }])[0].beispiel).toBe("Starting connection");
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
    expect(a.meldung(a.buendeln([{ ...b("2026-10-15T09:00:00Z", "a"), suffix: "--w" }]), [], "S")).toContain("pw [Worktree--w]: reconnect");
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
    const env = { CLAUDE_PROJECT_DIR: wurzel, FACTORY_MCP_LOG_DIR: join(d, "logs"), FACTORY_MCP_AUSFALL_STAND: join(d, "stand", "stand.json") };
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
    expect((JSON.parse(readFileSync(join(d, "stand", "stand.json"), "utf8")) as { bis: string }).bis).toBe("2026-10-15T10:00:00.000Z");
    expect(lauf(["--sessionstart"], env, { jetzt: jetztNah + 60_000 }).aus).toEqual([]);
  });
  test("unbekanntes Argument und --seit ohne Wert: Aufruf-Zeile auf stderr, Exit 2, kein Stand", () => {
    const { env, d } = aufbau();
    for (const argv of [["--since", "6h"], ["--seit"], ["--seit", "--json"]]) {
      const fehler: string[] = [];
      const aus: string[] = [];
      expect(a.main(argv, env, (t) => aus.push(t), { jetzt, err: (t: string) => fehler.push(t) })).toBe(2);
      expect(fehler.join("\n")).toContain("Aufruf: node scripts/mcp-ausfall.mjs");
      expect(aus).toEqual([]);
    }
    expect(() => readFileSync(join(d, "stand", "stand.json"))).toThrow();
  });
  test("--seit 6h --json ist erlaubt (Exit 0, keine Fehlerzeile)", () => {
    const { env } = aufbau();
    const fehler: string[] = [];
    expect(lauf(["--seit", "6h", "--json"], env, { err: (t: string) => fehler.push(t) }).code).toBe(0);
    expect(fehler).toEqual([]);
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
    const r = lauf([], { ...env, FACTORY_MCP_LOG_DIR: join(d, "gibtsnicht") });
    expect(r.aus).toHaveLength(1);
    expect(r.aus[0]).toContain("gibtsnicht");
  });
  test("fremde Dateien im Log-Ordner werden ignoriert", () => {
    const { env, d } = aufbau();
    const dir = join(d, "logs", a.slug(env.CLAUDE_PROJECT_DIR), "mcp-logs-pw");
    writeFileSync(join(dir, "notiz.txt"), `${dbg("Starting connection x")}\n${dbg("Starting connection x")}\n${dbg("Starting connection x")}\n`);
    expect(lauf(["--seit", "2026-10-15T00:00:00Z"], env).aus.join("\n")).toContain("reconnect ×1 ");
  });
  test("Server ohne Eintrag in .mcp.json (user-scope, z. B. langfuse) werden über ihren Log-Ordner gefunden", () => {
    const { env, d } = aufbau();
    const dir = join(d, "logs", a.slug(env.CLAUDE_PROJECT_DIR), "mcp-logs-langfuse");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "2026-10-15T09-00-00Z.jsonl"),
      [
        err("Connection failed (ECONNREFUSED): ECONNREFUSED: Unable to connect. Is the computer able to access the url?"),
        err("TypeError: ECONNRESET: The socket connection was closed unexpectedly."),
        dbg("tools/list failed (ECONNRESET: The socket connection was closed unexpectedly.)"),
        dbg("Terminal connection error 1/3"),
        dbg("HTTP connection dropped after 30s uptime"),
      ].join("\n") + "\n",
    );
    const t = lauf(["--seit", "2026-10-15T00:00:00Z"], env).aus.join("\n");
    expect(t).toContain("langfuse [extern (nicht im Repo konfiguriert)]: fehler ×2");
    expect(t).toContain("langfuse [extern (nicht im Repo konfiguriert)]: abbruch (ECONNRESET) ×1");
    expect(t).not.toContain("Terminal connection");
    expect(t).not.toContain("Server-Art");
  });
  test("--sessionstart mit --json bleibt Klartext", () => {
    const { env } = aufbau();
    const t = lauf(["--sessionstart", "--json"], env, { jetzt: Date.parse("2026-10-15T10:00:00Z") }).aus.join("\n");
    expect(t).toContain("MCP-Abweichungen");
  });
  test("fehlende .mcp.json: Exit 0 ohne Wurf (äußerer Fang)", () => {
    const { env } = aufbau();
    rmSync(join(env.CLAUDE_PROJECT_DIR, ".mcp.json"));
    expect(lauf(["--sessionstart"], env)).toEqual({ code: 0, aus: [] });
  });
  test("nicht schreibbare Stand-Datei: Exit 0, die Meldung davor bleibt erhalten", () => {
    const { env, d } = aufbau();
    const datei = join(d, "blockiert");
    writeFileSync(datei, "x");
    const r = lauf(["--sessionstart"], { ...env, FACTORY_MCP_AUSFALL_STAND: join(datei, "unter", "stand.json") }, { jetzt: Date.parse("2026-10-15T10:00:00Z") });
    expect(r.code).toBe(0);
    expect(r.aus.join("\n")).toContain("reconnect ×1");
  });
  test("kaputtes .mcp.json wirft nicht, Exit 0; unbekannte Art und fehlende Variable werden genannt", () => {
    const { env } = aufbau("{kaputt");
    expect(lauf(["--sessionstart"], env)).toEqual({ code: 0, aus: [] });
    const { env: env2 } = aufbau('{"mcpServers":{"w":{"type":"ws"},"h":{"type":"http","url":"u","headers":{"A":"${FACTORY_TEST_FEHLT}"}}}}');
    const t = lauf(["--seit", "2026-10-15T00:00:00Z"], env2).aus.join("\n");
    expect(t).toContain('w: Server-Art "ws"');
    expect(t).toContain("FACTORY_TEST_FEHLT");
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

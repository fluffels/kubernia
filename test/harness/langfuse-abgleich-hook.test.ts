/* Automatischer Langfuse-Abgleich an SessionStart/SessionEnd (#1578).
 *
 * @harness-waechter – einziger Durchsetzer der Hook-Regeln des Abgleichs (losgelöster Start mit exakten Spawn-Optionen, Exit 0 bei jedem Input, Wartezeit länger
 * als die Ruhefrist, Lock, Log-Rotation), darum im geschützten test/harness/ (#1165).
 *
 * Die Logik lebt in scripts/langfuse-abgleich-hook.mjs (Einstieg) und scripts/langfuse-nachliefern.mjs (Lock, Log, Wartezeit). Weder ~/.claude noch Langfuse
 * werden angefasst: Temp-Ordner, injiziertes spawn/lauf/Uhr; Ende-zu-Ende nur mit umgebogenem Home und belegtem Lock (kein Request).
 *
 * Ausführen mit: npm test
 */
import { describe, expect, test } from "vitest";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, unlinkSync, utimesSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { fixture } from "../support/tmp-fixture";

// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as rawHook from "../../scripts/langfuse-abgleich-hook.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as rawNachEinstieg from "../../scripts/langfuse-nachliefern.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as rawLock from "../../scripts/langfuse-lock.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as rawIo from "../../scripts/hook-io.mjs";

type Args = { ausloeser: string | null; session: string | null; aktuell: string | null; beendet: string | null; trocken: boolean; json: boolean; fehler: string | null; seit: string | null };
type Ergebnis = { exitCode: number; text: string; protokoll: Record<string, unknown> };
type Lauf = (a: Args, o: { now: number }) => Promise<Ergebnis>;
type Log = Record<string, unknown> & { ausloeser: string; lock: string; sessions: unknown[]; fehler: { meldung: string }[] };

const H = rawHook as unknown as {
  kindArgs: (i: { event?: string; session?: unknown; source?: string }) => string[] | null;
  leseZugang: (t: string) => Record<string, string>;
  leseSecretDatei: (t: string) => string | undefined;
  lesePluginOptionen: (t: string) => Record<string, string>;
  kindEnv: (env: Record<string, string>, home: string, lies?: (p: string) => string) => Record<string, string>;
  starte: (t: string, o: { spawn: (...a: unknown[]) => Kind; env?: Record<string, string>; execPath?: string; home?: string }) => boolean;
};
type Kind = { on: (e: string, f: () => void) => void; unref: () => void };
// Wartezeit und hookLauf im Einstieg, Lock, Log und gesperrterLauf in der Lib langfuse-lock.mjs.
const N = { ...rawNachEinstieg, ...rawLock } as unknown as {
  RUHEFRIST_BEENDET_MS: number;
  WARTE_SESSIONEND: number;
  WARTE_LOCK: number;
  LOCK_VERALTET_MS: number;
  parseArgs: (a: string[]) => Args;
  lockNehmen: (d: string, o: { now: number; pid: number; nachPruefung?: () => void }) => "frei" | "übernommen" | "belegt";
  lockMeldung: (lock: string) => string;
  lockFreigeben: (d: string, pid: number) => void;
  logAnhaengen: (d: string, e: unknown, o?: { max: number }) => void;
  logEintrag: (o: Record<string, unknown>) => Log;
  hookLauf: (a: Args, o: { stateDir: string; lauf: Lauf; schlafen: (ms: number) => Promise<void>; uhr: () => number; pid: number }) => Promise<{ lock: string; ergebnis: Ergebnis | null }>;
  gesperrterLauf: (a: Args, o: { stateDir: string; lauf: Lauf; ausloeser: string; pid: number }) => Promise<{ lock: string; ergebnis: Ergebnis | null }>;
};
const IO = rawIo as unknown as { parseSessionHookInput: (t: string) => { event?: string; session?: string; source?: string } };

const SKRIPT = (name: string) => join(__dirname, "../../scripts", name);
const T0 = Date.parse("2026-10-09T10:00:00Z");
const MIN = 60_000;

// ── Kind-Argumente ───────────────────────────────────────────────────────────

describe("kindArgs", () => {
  test.each([
    [{ event: "SessionEnd", session: "abc-1" }, ["--ausloeser", "sessionend", "--session", "abc-1", "--beendet", "abc-1"]],
    [{ event: "SessionEnd", session: "abc-1", source: "other" }, ["--ausloeser", "sessionend", "--session", "abc-1", "--beendet", "abc-1"]],
    [{ event: "SessionStart", session: "abc-1", source: "startup" }, ["--ausloeser", "sessionstart", "--aktuell", "abc-1"]],
    [{ event: "SessionStart", session: "abc-1", source: "resume" }, ["--ausloeser", "sessionstart", "--aktuell", "abc-1"]],
    [{ event: "SessionStart", session: "abc-1", source: "clear" }, ["--ausloeser", "sessionstart", "--aktuell", "abc-1"]],
  ])("%j", (eingabe, erwartet) => {
    expect(H.kindArgs(eingabe)).toEqual(erwartet);
  });

  test.each([
    ["SessionStart compact", { event: "SessionStart", session: "s1", source: "compact" }],
    ["SessionStart fork (unbekannte Quelle)", { event: "SessionStart", session: "s1", source: "fork" }],
    ["SessionStart ohne Quelle", { event: "SessionStart", session: "s1" }],
    ["Stop läuft nie", { event: "Stop", session: "s1", source: "startup" }],
    ["SubagentStop läuft nie", { event: "SubagentStop", session: "s1" }],
    ["ohne Ereignis", { session: "s1", source: "startup" }],
    ["ohne Session-ID", { event: "SessionEnd" }],
    ["Session-ID als Flag (--x)", { event: "SessionEnd", session: "--x" }],
    ["Session-ID mit Leerzeichen", { event: "SessionEnd", session: "a b" }],
    ["leere Session-ID", { event: "SessionEnd", session: "" }],
    ["Session-ID keine Zeichenkette", { event: "SessionEnd", session: 7 }],
  ])("kein Lauf: %s", (_n, eingabe) => {
    expect(H.kindArgs(eingabe)).toBeNull();
  });

  test("parseSessionHookInput: tolerant gegen Müll, parseHookInput bleibt für Tool-Hooks unverändert", () => {
    expect(IO.parseSessionHookInput('{"hook_event_name":"SessionEnd","session_id":"s","source":"x","cwd":"/y"}')).toEqual({ event: "SessionEnd", session: "s", source: "x" });
    for (const müll of ["", "kein json", "null", "[1]"]) expect(IO.parseSessionHookInput(müll)).toEqual({});
  });
});

// ── Spawn ────────────────────────────────────────────────────────────────────

const fakeSpawn = () => {
  const aufrufe: { cmd: unknown; args: string[]; opts: Record<string, unknown> }[] = [];
  const kind = { unrefs: 0, handler: [] as string[] };
  const spawn = (cmd: unknown, args: unknown, opts: unknown): Kind => {
    aufrufe.push({ cmd, args: args as string[], opts: opts as Record<string, unknown> });
    return { on: (e) => void kind.handler.push(e), unref: () => void kind.unrefs++ };
  };
  return { aufrufe, kind, spawn };
};
const START = JSON.stringify({ hook_event_name: "SessionStart", session_id: "s1", source: "startup", cwd: "C:/repo" });

describe("starte: losgelöster Kindprozess", () => {
  test("Spawn-Optionen exakt: detached, windowsHide, stdio ignore, cwd = Home (nie der Worktree), genau ein unref, error-Handler", () => {
    const f = fakeSpawn();
    const home = fixture({});
    const ok = H.starte(START, { spawn: f.spawn, env: { A: "1" }, execPath: "node-pfad", home });
    expect(ok).toBe(true);
    expect(f.aufrufe).toHaveLength(1);
    const [a] = f.aufrufe;
    expect(a.cmd).toBe("node-pfad");
    expect(a.args[0]).toBe(SKRIPT("langfuse-nachliefern.mjs"));
    expect(a.args.slice(1)).toEqual(["--ausloeser", "sessionstart", "--aktuell", "s1"]);
    expect(a.opts).toEqual({ detached: true, windowsHide: true, stdio: "ignore", cwd: home, env: { A: "1" } });
    expect(f.kind.unrefs).toBe(1);
    expect(f.kind.handler).toContain("error");
  });

  test("das Kind bekommt die Zugangswerte aus den Dateien im Home (Fake-Werte), die Umgebung hat Vorrang", () => {
    const home = fixture({
      ".langfuse-secret": "sk-fake-77\n",
      ".claude/settings.json": JSON.stringify({ pluginConfigs: { "langfuse-observability@x": { options: { LANGFUSE_PUBLIC_KEY: "pk-fake", LANGFUSE_BASE_URL: "http://plugin.test" } } } }),
    });
    const f = fakeSpawn();
    expect(H.starte(START, { spawn: f.spawn, env: { LANGFUSE_BASE_URL: "http://env.test" }, execPath: "n", home })).toBe(true);
    expect(f.aufrufe[0].opts.env).toEqual({ LANGFUSE_SECRET_KEY: "sk-fake-77", LANGFUSE_PUBLIC_KEY: "pk-fake", LANGFUSE_BASE_URL: "http://env.test" });
  });

  test.each([
    ["Müll", "kein json"],
    ["leer", ""],
    ["Stop", JSON.stringify({ hook_event_name: "Stop", session_id: "s1" })],
    ["compact", JSON.stringify({ hook_event_name: "SessionStart", session_id: "s1", source: "compact" })],
  ])("kein Spawn bei %s", (_n, text) => {
    const f = fakeSpawn();
    expect(H.starte(text, { spawn: f.spawn, home: fixture({}) })).toBe(false);
    expect(f.aufrufe).toHaveLength(0);
  });

  test("wirft spawn, endet starte mit false statt zu werfen", () => {
    const spawn = () => {
      throw new Error("EPERM");
    };
    expect(H.starte(START, { spawn, home: fixture({}) })).toBe(false);
  });

  test("Ende zu Ende: Müll-stdin, leeres stdin und ein Stop-Payload enden mit Exit 0 und ohne Ausgabe", () => {
    for (const input of ["kein json {", "", JSON.stringify({ hook_event_name: "Stop", session_id: "s1" })]) {
      const r = spawnSync(process.execPath, [SKRIPT("langfuse-abgleich-hook.mjs")], { input, encoding: "utf8", timeout: 20_000 });
      expect(r.status).toBe(0);
      expect(r.stdout).toBe("");
    }
  });
});

// ── Zugangs-Lader ────────────────────────────────────────────────────────────

describe("Zugangs-Lader (nur im Hook)", () => {
  const DATEI = ["# Kommentar", "export LANGFUSE_PUBLIC_KEY=pk-1", 'LANGFUSE_SECRET_KEY="sk-2"', "LANGFUSE_BASE_URL='http://lf.test'", "ANTHROPIC_API_KEY=nicht-diese", "  LANGFUSE_HOST = x", ""].join("\r\n");

  test("liest nur die drei Zugangsnamen, mit export und Anführungszeichen, CRLF", () => {
    expect(H.leseZugang(DATEI)).toEqual({ LANGFUSE_PUBLIC_KEY: "pk-1", LANGFUSE_SECRET_KEY: "sk-2", LANGFUSE_BASE_URL: "http://lf.test" });
  });

  test("fehlende Namen kommen aus der Datei, die Umgebung hat Vorrang, fremde Namen werden nicht übernommen", () => {
    const env = H.kindEnv({ LANGFUSE_PUBLIC_KEY: "aus-env", PATH: "p" }, "/h", () => DATEI);
    expect(env).toEqual({ PATH: "p", LANGFUSE_PUBLIC_KEY: "aus-env", LANGFUSE_SECRET_KEY: "sk-2", LANGFUSE_BASE_URL: "http://lf.test" });
    expect("ANTHROPIC_API_KEY" in env).toBe(false);
  });

  test("fehlende oder unlesbare Datei: Umgebung unverändert, kein Wurf", () => {
    const wirf = () => {
      throw new Error("ENOENT");
    };
    expect(H.kindEnv({ PATH: "p" }, "/h", wirf)).toEqual({ PATH: "p" });
  });

  const PLUGIN = JSON.stringify({ pluginConfigs: { "langfuse-observability@langfuse-observability": { options: { LANGFUSE_PUBLIC_KEY: "pk-fake", LANGFUSE_BASE_URL: "http://plugin.test", ANDERES: "x" } }, "anderes@x": { options: { LANGFUSE_PUBLIC_KEY: "falsch" } } } });
  const nachPfad = (dateien: Record<string, string>) => (p: string): string => {
    const hit = Object.entries(dateien).find(([ende]) => p.replaceAll("\\", "/").endsWith(ende));
    if (!hit) throw new Error("ENOENT");
    return hit[1];
  };

  test("leseSecretDatei: rohe Zeile, benannte Form, Kommentar und leere Zeilen übersprungen, fremde Form und leer: nichts", () => {
    expect(H.leseSecretDatei("sk-fake-1\n")).toBe("sk-fake-1");
    expect(H.leseSecretDatei("\r\n  # Kommentar\r\n  sk-fake-2  \r\nzweite")).toBe("sk-fake-2");
    expect(H.leseSecretDatei("export LANGFUSE_SECRET_KEY='sk-fake-3'")).toBe("sk-fake-3");
    expect(H.leseSecretDatei("ANDERER_NAME=wert")).toBeUndefined();
    expect(H.leseSecretDatei("")).toBeUndefined();
    expect(H.leseSecretDatei("# nur Kommentar")).toBeUndefined();
  });

  test("lesePluginOptionen: nur Langfuse-Plugin, nur die zwei nicht-sensiblen Namen; kaputt oder ohne pluginConfigs: leer", () => {
    expect(H.lesePluginOptionen(PLUGIN)).toEqual({ LANGFUSE_PUBLIC_KEY: "pk-fake", LANGFUSE_BASE_URL: "http://plugin.test" });
    expect(H.lesePluginOptionen("kein json")).toEqual({});
    expect(H.lesePluginOptionen("{}")).toEqual({});
    expect(H.lesePluginOptionen(JSON.stringify({ pluginConfigs: { "langfuse@x": { options: { LANGFUSE_SECRET_KEY: "nie" } } } }))).toEqual({});
  });

  test("echter Weg: Secret aus .langfuse-secret, Public-Key und URL aus den Plugin-Optionen, Umgebung hat Vorrang", () => {
    const lies = nachPfad({ "/.langfuse-secret": "sk-fake-9\n", "/.claude/settings.json": PLUGIN });
    expect(H.kindEnv({ PATH: "p" }, "/h", lies)).toEqual({ PATH: "p", LANGFUSE_PUBLIC_KEY: "pk-fake", LANGFUSE_BASE_URL: "http://plugin.test", LANGFUSE_SECRET_KEY: "sk-fake-9" });
    expect(H.kindEnv({ LANGFUSE_SECRET_KEY: "env-sk", LANGFUSE_BASE_URL: "http://env.test" }, "/h", lies)).toMatchObject({ LANGFUSE_SECRET_KEY: "env-sk", LANGFUSE_BASE_URL: "http://env.test", LANGFUSE_PUBLIC_KEY: "pk-fake" });
  });

  test("agent-secrets.env geht vor den Plugin-Optionen; eine fehlende oder kaputte Quelle lässt die anderen gelten", () => {
    const lies = nachPfad({ "/.config/agent-secrets.env": "LANGFUSE_PUBLIC_KEY=pk-datei", "/.claude/settings.json": "kaputt {", "/.langfuse-secret": "sk-fake-5" });
    expect(H.kindEnv({}, "/h", lies)).toEqual({ LANGFUSE_PUBLIC_KEY: "pk-datei", LANGFUSE_SECRET_KEY: "sk-fake-5" });
  });

  test("leere Variable in der Umgebung gilt als fehlend", () => {
    expect(H.kindEnv({ LANGFUSE_SECRET_KEY: "" }, "/h", () => "LANGFUSE_SECRET_KEY=aus-datei").LANGFUSE_SECRET_KEY).toBe("aus-datei");
  });
});

// ── Lock ─────────────────────────────────────────────────────────────────────

const pidVon = (d: string): number => (JSON.parse(readFileSync(d, "utf8")) as { pid: number }).pid;

describe("Lock", () => {
  const lockDatei = () => join(fixture({}), "state", "langfuse-abgleich.lock");

  test("frei: Anlage mit pid und Zeit; zweiter Versuch: belegt", () => {
    const d = lockDatei();
    expect(N.lockNehmen(d, { now: T0, pid: 11 })).toBe("frei");
    expect(JSON.parse(readFileSync(d, "utf8"))).toEqual({ pid: 11, zeit: T0 });
    expect(N.lockNehmen(d, { now: T0 + MIN, pid: 12 })).toBe("belegt");
    expect(pidVon(d)).toBe(11);
  });

  test("veraltet nach 15 min: übernommen, bei genau 15 min noch belegt", () => {
    const d = lockDatei();
    N.lockNehmen(d, { now: T0, pid: 11 });
    expect(N.lockNehmen(d, { now: T0 + N.LOCK_VERALTET_MS, pid: 12 })).toBe("belegt");
    expect(N.lockNehmen(d, { now: T0 + N.LOCK_VERALTET_MS + 1, pid: 12 })).toBe("übernommen");
    expect(pidVon(d)).toBe(12);
  });

  test("kaputter Inhalt: nach mtime beurteilt (frisch belegt, > 15 min alt veraltet)", () => {
    const d = lockDatei();
    mkdirSync(join(d, ".."), { recursive: true });
    writeFileSync(d, "kein json");
    expect(N.lockNehmen(d, { now: Date.now(), pid: 12 })).toBe("belegt");
    const alt = new Date(Date.now() - 20 * MIN);
    utimesSync(d, alt, alt);
    expect(N.lockNehmen(d, { now: Date.now(), pid: 12 })).toBe("übernommen");
  });

  test("TOCTOU: zwei Bewerber sehen denselben veralteten Lock, genau einer gewinnt und der frische Lock des Gewinners bleibt (Negativfall)", () => {
    const d = lockDatei();
    N.lockNehmen(d, { now: T0, pid: 11 });
    const spaet = T0 + N.LOCK_VERALTET_MS + 1;
    let a = "";
    // Bewerber 12 hat „veraltet“ gesehen; bevor er übernimmt, übernimmt Bewerber 13 vollständig.
    const b = N.lockNehmen(d, { now: spaet, pid: 12, nachPruefung: () => { a = N.lockNehmen(d, { now: spaet, pid: 13 }); } });
    expect(a).toBe("übernommen");
    expect(b).toBe("belegt");
    expect(pidVon(d)).toBe(13);
  });

  test("TOCTOU: war der Lock zwischen Prüfung und Übernahme schon freigegeben und neu belegt, bleibt der frische Lock, kein Grabstein übrig", () => {
    const d = lockDatei();
    N.lockNehmen(d, { now: T0, pid: 11 });
    const spaet = T0 + N.LOCK_VERALTET_MS + 1;
    const b = N.lockNehmen(d, { now: spaet, pid: 12, nachPruefung: () => { unlinkSync(d); N.lockNehmen(d, { now: spaet, pid: 13 }); } });
    expect(b).toBe("belegt");
    expect(pidVon(d)).toBe(13);
    expect(readdirSync(join(d, "..")).filter((n) => n.includes("verwaist"))).toEqual([]);
  });

  test("war der veraltete Lock zwischen Prüfung und Übernahme schon freigegeben (ohne neue Belegung): der Bewerber bekommt ihn als frei", () => {
    const d = lockDatei();
    N.lockNehmen(d, { now: T0, pid: 11 });
    const spaet = T0 + N.LOCK_VERALTET_MS + 1;
    const b = N.lockNehmen(d, { now: spaet, pid: 12, nachPruefung: () => unlinkSync(d) });
    expect(b).toBe("frei");
    expect(pidVon(d)).toBe(12);
  });

  test("Grabsteine: ein alter (über 24 h) wird bei der nächsten Übernahme weggeräumt, ein junger bleibt", () => {
    const d = lockDatei();
    mkdirSync(join(d, ".."), { recursive: true });
    const alt = d + ".verwaist-alt";
    const jung = d + ".verwaist-jung";
    writeFileSync(alt, "x");
    writeFileSync(jung, "x");
    const lange = new Date(T0 - 2 * 24 * 3_600_000);
    utimesSync(alt, lange, lange);
    utimesSync(jung, new Date(T0), new Date(T0));
    N.lockNehmen(d, { now: T0, pid: 11 });
    N.lockNehmen(d, { now: T0 + N.LOCK_VERALTET_MS + 1, pid: 12 });
    expect(existsSync(alt)).toBe(false);
    expect(existsSync(jung)).toBe(true);
  });

  test("lockMeldung: je Zustand ein eigener Text", () => {
    expect(N.lockMeldung("belegt")).toMatch(/hält den Lock/);
    expect(N.lockMeldung("fehler")).toMatch(/nicht anlegen/);
    expect(N.lockMeldung("frei")).toMatch(/abgestürzt/);
    expect(new Set([N.lockMeldung("belegt"), N.lockMeldung("fehler"), N.lockMeldung("frei")]).size).toBe(3);
  });

  test("Freigabe nur mit der eigenen pid", () => {
    const d = lockDatei();
    N.lockNehmen(d, { now: T0, pid: 11 });
    N.lockFreigeben(d, 99);
    expect(existsSync(d)).toBe(true);
    N.lockFreigeben(d, 11);
    expect(existsSync(d)).toBe(false);
    expect(() => N.lockFreigeben(d, 11)).not.toThrow();
  });
});

// ── Log ──────────────────────────────────────────────────────────────────────

describe("Log", () => {
  const logDatei = () => join(fixture({}), "state", "langfuse-abgleich.log");

  test("die erste Zeile legt die Datei an, jede Zeile ist gültiges JSON", () => {
    const d = logDatei();
    N.logAnhaengen(d, { a: 1 });
    N.logAnhaengen(d, { a: 2 });
    const zeilen = readFileSync(d, "utf8").trimEnd().split("\n");
    expect(zeilen.map((z) => JSON.parse(z) as unknown)).toEqual([{ a: 1 }, { a: 2 }]);
  });

  test("ab der Grenze wandert die Datei nach .log.1 (eine ältere .1 wird ersetzt), die neue Datei trägt nur die neue Zeile", () => {
    const d = logDatei();
    N.logAnhaengen(d, { n: "alt" }, { max: 30 });
    const groesse = statSync(d).size;
    N.logAnhaengen(d, { n: "neu" }, { max: groesse }); // Größe == Grenze: Wechsel (ab, nicht über der Grenze)
    expect(readFileSync(d, "utf8").trim()).toBe(JSON.stringify({ n: "neu" }));
    expect(readFileSync(`${d}.1`, "utf8")).toContain('"alt"');
    N.logAnhaengen(d, { n: "noch neuer" }, { max: 5 });
    expect(readFileSync(`${d}.1`, "utf8").trim()).toBe(JSON.stringify({ n: "neu" }));
    expect(readFileSync(d, "utf8").trim()).toBe(JSON.stringify({ n: "noch neuer" }));
  });

  test("unter der Grenze: kein Wechsel", () => {
    const d = logDatei();
    N.logAnhaengen(d, { n: "alt" });
    const groesse = statSync(d).size;
    N.logAnhaengen(d, { n: "neu" }, { max: groesse + 1 });
    expect(existsSync(`${d}.1`)).toBe(false);
    expect(readFileSync(d, "utf8").trimEnd().split("\n")).toHaveLength(2);
  });

  test("logEintrag: alle Felder; sessions nur mit Befund; Fehlermeldung auf 300 Zeichen gekürzt; ohne Protokoll Nullwerte", () => {
    const protokoll = {
      zugang: true,
      geprueft: 3,
      gesendet: 2,
      spans: 1,
      dubletten: 1,
      wuerdeSenden: 0,
      sessions: [
        { session: "s1", status: "gesendet", gesendet: 2, wuerdeSenden: 0, dubletten: 0, ausstehend: 0, befund: null },
        { session: "s2", status: "bestätigt", gesendet: 0, wuerdeSenden: 0, dubletten: 0, ausstehend: 0, befund: null },
      ],
      fehler: [{ session: "s1", status: 500, meldung: "x".repeat(400) }],
    };
    const e = N.logEintrag({ zeit: "Z", ausloeser: "sessionend", session: "s1", lock: "frei", exitCode: 1, protokoll });
    expect(Object.keys(e).sort()).toEqual(["ausloeser", "dubletten", "exitCode", "fehler", "geprueft", "gesendet", "lock", "session", "sessions", "spans", "uebrig", "wuerdeSenden", "zeit", "zugang"]);
    expect(e).toMatchObject({ zugang: true, geprueft: 3, gesendet: 2, dubletten: 1, exitCode: 1 });
    expect(e.sessions).toHaveLength(1);
    expect(e.fehler[0].meldung).toHaveLength(300);
    expect(e.fehler[0]).toMatchObject({ status: 500 });
    expect(N.logEintrag({ zeit: "Z", ausloeser: "sessionstart", session: null, lock: "belegt" })).toMatchObject({ zugang: null, geprueft: 0, gesendet: 0, sessions: [], fehler: [], exitCode: null });
  });
});

describe("Log: Ende verworfen (#1579)", () => {
  test("eine Session mit verworfenem Ende steht im Log, auch wenn sonst nichts zu melden ist; ohne das Feld bleibt sie draußen", () => {
    const sess = (endeVerworfen: boolean) => ({ session: "s1", status: "läuft", gesendet: 0, wuerdeSenden: 0, dubletten: 0, ausstehend: 0, befund: null, endeVerworfen });
    const mit = N.logEintrag({ zeit: "Z", ausloeser: "sessionend", session: "s1", lock: "frei", exitCode: 0, protokoll: { zugang: true, geprueft: 1, gesendet: 0, spans: 0, dubletten: 0, wuerdeSenden: 0, sessions: [sess(true)], fehler: [] } });
    expect(mit.sessions).toEqual([{ session: "s1", status: "läuft", gesendet: 0, wuerdeSenden: 0, dubletten: 0, ausstehend: 0, endeVerworfen: true }]);
    const ohne = N.logEintrag({ zeit: "Z", ausloeser: "sessionend", session: "s1", lock: "frei", exitCode: 0, protokoll: { zugang: true, geprueft: 1, gesendet: 0, spans: 0, dubletten: 0, wuerdeSenden: 0, sessions: [sess(false)], fehler: [] } });
    expect(ohne.sessions).toEqual([]);
  });
});

// ── hookLauf ─────────────────────────────────────────────────────────────────

describe("hookLauf", () => {
  const argsVon = (a: string[]): Args => N.parseArgs(a);
  const ENDE = ["--ausloeser", "sessionend", "--session", "s1", "--beendet", "s1"];
  const START_ARGS = ["--ausloeser", "sessionstart", "--aktuell", "s1"];
  const ok: Ergebnis = { exitCode: 0, text: "", protokoll: { zugang: true, geprueft: 1, gesendet: 1, spans: 0, dubletten: 0, wuerdeSenden: 0, sessions: [], fehler: [] } };
  const aufbau = () => {
    const stateDir = join(fixture({}), "state");
    const ereignisse: string[] = [];
    let jetzt = T0;
    const schlafen = (ms: number) => {
      ereignisse.push(`schlafen ${ms}`);
      jetzt += ms;
      return Promise.resolve();
    };
    const lauf: Lauf = (a, o) => {
      ereignisse.push(`lauf now=${o.now - T0} session=${a.session} beendet=${a.beendet} aktuell=${a.aktuell}`);
      return Promise.resolve(ok);
    };
    const logZeilen = () => (existsSync(join(stateDir, "langfuse-abgleich.log")) ? readFileSync(join(stateDir, "langfuse-abgleich.log"), "utf8").trim().split("\n").map((z) => JSON.parse(z) as Log) : []);
    return { stateDir, ereignisse, schlafen, lauf, uhr: () => jetzt, logZeilen, lock: join(stateDir, "langfuse-abgleich.lock") };
  };
  const belegen = (lock: string, zeit = T0) => {
    mkdirSync(join(lock, ".."), { recursive: true });
    writeFileSync(lock, JSON.stringify({ pid: 4242, zeit }));
  };

  test("SessionEnd: erst WARTE_SESSIONEND schlafen, dann lauf mit der Uhr danach und --session/--beendet; Logzeile, Lock danach frei", async () => {
    const a = aufbau();
    const r = await N.hookLauf(argsVon(ENDE), { stateDir: a.stateDir, lauf: a.lauf, schlafen: a.schlafen, uhr: a.uhr, pid: 7 });
    expect(r.lock).toBe("frei");
    expect(a.ereignisse).toEqual([`schlafen ${N.WARTE_SESSIONEND}`, `lauf now=${N.WARTE_SESSIONEND} session=s1 beendet=s1 aktuell=null`]);
    expect(a.logZeilen()).toMatchObject([{ ausloeser: "sessionend", session: "s1", lock: "frei", zugang: true, exitCode: 0, gesendet: 1 }]);
    expect(existsSync(a.lock)).toBe(false);
  });

  test("SessionStart: kein Schlafen, lauf sofort mit --aktuell", async () => {
    const a = aufbau();
    await N.hookLauf(argsVon(START_ARGS), { stateDir: a.stateDir, lauf: a.lauf, schlafen: a.schlafen, uhr: a.uhr, pid: 7 });
    expect(a.ereignisse).toEqual(["lauf now=0 session=null beendet=null aktuell=s1"]);
    expect(a.logZeilen()[0]).toMatchObject({ ausloeser: "sessionstart", session: "s1" });
  });

  test("SessionEnd bei belegtem Lock: nach WARTE_LOCK ein zweiter Versuch, wieder belegt: Logzeile lock belegt, lauf nie aufgerufen", async () => {
    const a = aufbau();
    belegen(a.lock, T0 + N.WARTE_SESSIONEND + 10 * MIN);
    const r = await N.hookLauf(argsVon(ENDE), { stateDir: a.stateDir, lauf: a.lauf, schlafen: a.schlafen, uhr: a.uhr, pid: 7 });
    expect(r).toEqual({ lock: "belegt", ergebnis: null });
    expect(a.ereignisse).toEqual([`schlafen ${N.WARTE_SESSIONEND}`, `schlafen ${N.WARTE_LOCK}`]);
    expect(a.logZeilen()).toMatchObject([{ ausloeser: "sessionend", lock: "belegt", exitCode: null }]);
    expect(existsSync(a.lock)).toBe(true);
  });

  test("SessionEnd: der Lock wird nach dem Warten frei und der zweite Versuch läuft", async () => {
    const a = aufbau();
    belegen(a.lock);
    let schlafenZaehler = 0;
    const schlafen = (ms: number) => {
      if (++schlafenZaehler === 2) unlinkSync(a.lock); // der andere Lauf ist fertig
      return a.schlafen(ms);
    };
    const r = await N.hookLauf(argsVon(ENDE), { stateDir: a.stateDir, lauf: a.lauf, schlafen, uhr: a.uhr, pid: 7 });
    expect(r.lock).toBe("frei");
    expect(a.ereignisse.filter((e) => e.startsWith("lauf"))).toHaveLength(1);
  });

  test("SessionStart bei belegtem Lock: kein Schlafen, Logzeile, kein Lauf", async () => {
    const a = aufbau();
    belegen(a.lock, T0 + 5 * MIN);
    const r = await N.hookLauf(argsVon(START_ARGS), { stateDir: a.stateDir, lauf: a.lauf, schlafen: a.schlafen, uhr: a.uhr, pid: 7 });
    expect(r.lock).toBe("belegt");
    expect(a.ereignisse).toEqual([]);
    expect(a.logZeilen()).toMatchObject([{ ausloeser: "sessionstart", lock: "belegt" }]);
  });

  test("Absturz in lauf: Logzeile mit Fehler, Lock frei, kein Wurf", async () => {
    const a = aufbau();
    const lauf: Lauf = () => Promise.reject(new Error("kaputt"));
    const r = await N.hookLauf(argsVon(START_ARGS), { stateDir: a.stateDir, lauf, schlafen: a.schlafen, uhr: a.uhr, pid: 7 });
    expect(r.ergebnis).toBeNull();
    expect(a.logZeilen()[0]).toMatchObject({ exitCode: 1, fehler: [{ session: "s1", meldung: "kaputt" }] });
    expect(existsSync(a.lock)).toBe(false);
  });

  test("manueller Lauf (gesperrterLauf): Logzeile mit ausloeser manuell, belegter Lock blockiert ohne Wartezeit", async () => {
    const a = aufbau();
    const frei = await N.gesperrterLauf(argsVon(["--session", "s1"]), { stateDir: a.stateDir, lauf: a.lauf, ausloeser: "manuell", pid: 7 });
    expect(frei.lock).toBe("frei");
    belegen(a.lock, Date.now());
    const belegt = await N.gesperrterLauf(argsVon(["--session", "s1"]), { stateDir: a.stateDir, lauf: a.lauf, ausloeser: "manuell", pid: 7 });
    expect(belegt.ergebnis).toBeNull();
    expect(a.logZeilen().map((z) => `${z.ausloeser}:${z.lock}`)).toEqual(["manuell:frei", "manuell:belegt"]);
  });

  test("SessionEnd gibt den Ende-Zeitpunkt von VOR der Wartezeit mit, SessionStart keinen", async () => {
    const a = aufbau();
    const gesehen: (number | undefined)[] = [];
    const lauf: Lauf = (x) => {
      gesehen.push((x as Args & { ende?: number }).ende);
      return Promise.resolve(ok);
    };
    await N.hookLauf(argsVon(ENDE), { stateDir: a.stateDir, lauf, schlafen: a.schlafen, uhr: a.uhr, pid: 7 });
    await N.hookLauf(argsVon(START_ARGS), { stateDir: a.stateDir, lauf, schlafen: a.schlafen, uhr: a.uhr, pid: 7 });
    expect(gesehen).toEqual([T0, undefined]);
  });

  test("ein Logfehler (Verzeichnis statt Logdatei) kippt den Lauf nicht: Ergebnis kommt zurück, Lock danach frei", async () => {
    const a = aufbau();
    mkdirSync(join(a.stateDir, "langfuse-abgleich.log"), { recursive: true });
    const r = await N.hookLauf(argsVon(START_ARGS), { stateDir: a.stateDir, lauf: a.lauf, schlafen: a.schlafen, uhr: a.uhr, pid: 7 });
    expect(r.ergebnis).toEqual(ok);
    expect(existsSync(a.lock)).toBe(false);
  });

  test("ein unlesbarer Zustandsordner (Datei statt Ordner): kein Wurf, kein Lauf, Ergebnis lock fehler", async () => {
    const a = aufbau();
    const datei = join(fixture({ "state-datei": "x" }), "state-datei");
    const r = await N.hookLauf(argsVon(START_ARGS), { stateDir: datei, lauf: a.lauf, schlafen: a.schlafen, uhr: a.uhr, pid: 7 });
    expect(r).toEqual({ lock: "fehler", ergebnis: null });
    expect(a.ereignisse).toEqual([]);
  });

  test("Invariante: die Wartezeit nach SessionEnd ist länger als die Ruhefrist bei bekanntem Ende (sonst gälte die Session beim Lauf noch als laufend)", () => {
    expect(N.WARTE_SESSIONEND).toBeGreaterThan(N.RUHEFRIST_BEENDET_MS);
  });
});

// ── Ende zu Ende ohne Netz ───────────────────────────────────────────────────

describe("Ende zu Ende mit belegtem Lock (kein Request, Home umgebogen)", () => {
  const mitHome = (args: string[]) => {
    const home = fixture({});
    const state = join(home, ".claude", "state");
    mkdirSync(state, { recursive: true });
    writeFileSync(join(state, "langfuse-abgleich.lock"), JSON.stringify({ pid: 4242, zeit: Date.now() }));
    const r = spawnSync(process.execPath, [SKRIPT("langfuse-nachliefern.mjs"), ...args], { encoding: "utf8", timeout: 30_000, env: { ...process.env, USERPROFILE: home, HOME: home, LANGFUSE_PUBLIC_KEY: "", LANGFUSE_SECRET_KEY: "" } });
    const log = join(state, "langfuse-abgleich.log");
    return { r, zeilen: existsSync(log) ? readFileSync(log, "utf8").trim().split("\n").map((z) => JSON.parse(z) as Log) : [] };
  };

  test("--ausloeser sessionstart: Exit 0, eine Logzeile mit lock belegt", () => {
    const { r, zeilen } = mitHome(["--ausloeser", "sessionstart", "--aktuell", "s1"]);
    expect(r.status).toBe(0);
    expect(zeilen).toMatchObject([{ ausloeser: "sessionstart", session: "s1", lock: "belegt" }]);
  });

  test("manueller schreibender Lauf: Exit 1 mit Hinweis auf den Lock; --trocken ignoriert den Lock (Exit 2 ohne Zugang)", () => {
    const m = mitHome(["--session", "s1"]);
    expect(m.r.status).toBe(1);
    expect(m.r.stderr).toMatch(/Lock/);
    expect(m.zeilen).toMatchObject([{ ausloeser: "manuell", lock: "belegt" }]);
    const t = mitHome(["--session", "s1", "--trocken"]);
    expect(t.r.status).toBe(2);
    expect(t.zeilen).toEqual([]);
  });
});

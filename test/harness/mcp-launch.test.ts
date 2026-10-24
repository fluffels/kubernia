/* @harness-waechter
 * Launcher-Fabrik für lokale MCP-Server (#1693 L7): `launcherFuer({ name, pkg, bin })` bindet Namen und Paket an die
 * generische Startlogik aus `scripts/mcp-launch.mjs`; `scripts/*-mcp.mjs` sind nur noch Einzeiler darüber.
 * Reines Node-Tooling ohne Declaration-File: Import über `unknown` auf ein lokales Interface. */
import { afterAll, describe, expect, test } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as launchRoh from "../../scripts/mcp-launch.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as ausfallRoh from "../../scripts/mcp-ausfall.mjs";

type Fabrik = {
  PKG: string;
  BIN: string;
  NAME: string;
  readLockVersion: (root: string) => string | undefined;
  readInstalled: (root: string) => { version: string; binPath: string } | null;
  planLaunch: (o: { lockVersion: string | undefined; installed: { version: string; binPath: string } | null }) => unknown;
  exitMeldung: (o: { code: number | null; signal: string | null; vonAussen: boolean; laufzeitMs: number; modus: string; ersetzt: boolean }) => string | null;
  npxHinweis: (spec: string) => string;
  abweichungHinweis: (a: { lokal: string; lock: string }) => string;
};
const launcherFuer = (launchRoh as unknown as { launcherFuer: (o: { name: string; pkg: string; bin: string }) => Fabrik }).launcherFuer;
const istNpxFallback = (ausfallRoh as unknown as { istNpxFallback: (t: string) => boolean }).istNpxFallback;

const angelegt: string[] = [];
afterAll(() => {
  for (const d of angelegt) rmSync(d, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
});
const fixture = (dateien: Record<string, string>): string => {
  const dir = mkdtempSync(join(tmpdir(), "kq-mcplaunch-"));
  angelegt.push(dir);
  for (const [rel, inhalt] of Object.entries(dateien)) {
    mkdirSync(dirname(join(dir, rel)), { recursive: true });
    writeFileSync(join(dir, rel), inhalt);
  }
  return dir;
};

describe("launcherFuer", () => {
  const l = launcherFuer({ name: "x-mcp", pkg: "@scope/x", bin: "xbin" });

  test("trägt Paket, bin und Namen in Lockfile-Suche, Plan, Ausfallzeile und npx-Hinweis ein", () => {
    expect([l.PKG, l.BIN, l.NAME]).toEqual(["@scope/x", "xbin", "x-mcp"]);
    expect(l.readLockVersion(fixture({ "package-lock.json": JSON.stringify({ packages: { "node_modules/@scope/x": { version: "1.2.3" } } }) }))).toBe("1.2.3");
    expect(l.readLockVersion(fixture({ "package-lock.json": JSON.stringify({ packages: { "node_modules/anderes": { version: "9.9.9" } } }) }))).toBeUndefined();
    expect(l.planLaunch({ lockVersion: "1.2.3", installed: null })).toEqual({ mode: "npx", spec: "@scope/x@1.2.3" });
    expect(l.planLaunch({ lockVersion: "1.2.3", installed: { version: "1.2.3", binPath: "/b" } })).toEqual({ mode: "local", binPath: "/b" });
    expect(l.planLaunch({ lockVersion: "1.2.3", installed: { version: "1.0.0", binPath: "/b" } })).toEqual({ mode: "local", binPath: "/b", abweichung: { lokal: "1.0.0", lock: "1.2.3" } });
    expect(l.abweichungHinweis({ lokal: "1.0.0", lock: "1.2.3" })).toBe("x-mcp: lokale Version 1.0.0 weicht vom Lockfile 1.2.3 ab, starte lokal (npm ci gleicht an)");
    expect(() => l.planLaunch({ lockVersion: undefined, installed: null })).toThrow(/@scope\/x.*Lockfile/);
    expect(l.exitMeldung({ code: 1, signal: null, vonAussen: false, laufzeitMs: 4600, modus: "npx", ersetzt: false })).toBe("x-mcp: Server beendet (Exit 1, nach 5 s, Modus npx)");
    expect(l.npxHinweis("@scope/x@1.2.3")).toBe("x-mcp: lokale Installation fehlt → npx @scope/x@1.2.3");
  });

  test("readInstalled sucht den bin des eigenen Pakets: String-bin, Objekt-bin, fehlende Datei", () => {
    const pkg = (bin: unknown) => JSON.stringify({ version: "1.2.3", bin });
    const dir = fixture({ "node_modules/@scope/x/package.json": pkg({ xbin: "cli.js" }), "node_modules/@scope/x/cli.js": "" });
    expect(l.readInstalled(dir)).toEqual({ version: "1.2.3", binPath: join(dir, "node_modules/@scope/x", "cli.js") });
    expect(l.readInstalled(fixture({ "node_modules/@scope/x/package.json": pkg({ xbin: "cli.js" }) }))).toBeNull();
    expect(l.readInstalled(fixture({ "node_modules/@scope/x/package.json": pkg({ y: "cli.js" }), "node_modules/@scope/x/cli.js": "" }))).toBeNull();
  });

  test("zwei Launcher teilen keinen Zustand", () => {
    const a = launcherFuer({ name: "a-mcp", pkg: "a", bin: "a" });
    const b = launcherFuer({ name: "b-mcp", pkg: "b", bin: "b" });
    expect(a.exitMeldung({ code: 1, signal: null, vonAussen: false, laufzeitMs: 0, modus: "local", ersetzt: false })).toMatch(/^a-mcp:/);
    expect(b.exitMeldung({ code: 1, signal: null, vonAussen: false, laufzeitMs: 0, modus: "local", ersetzt: false })).toMatch(/^b-mcp:/);
  });

  test("der npx-Hinweis ist das Format, das mcp-ausfall als npx-Fallback erkennt; gewöhnliche stderr-Zeilen nicht", () => {
    expect(istNpxFallback(`Server stderr: ${l.npxHinweis("@scope/x@1.2.3")}`)).toBe(true);
    expect(istNpxFallback(`Server stderr: ${l.exitMeldung({ code: 1, signal: null, vonAussen: false, laufzeitMs: 0, modus: "local", ersetzt: false }) ?? ""}`)).toBe(false);
  });
});

describe("starte (gestubbter Kindprozess)", () => {
  type Kind = { on: (e: string, f: (...a: unknown[]) => void) => void; kill: (s: string) => void; ereignisse: Record<string, (...a: unknown[]) => void>; getoetet: string[] };
  type Aufruf = { befehl: string; args: string[]; opt: Record<string, unknown> };
  const starte = (launchRoh as unknown as { starte: (o: Record<string, unknown>, d: Record<string, unknown>) => void }).starte;
  const lauf = (dateien: Record<string, string>, extra: Record<string, unknown> = {}) => {
    const root = fixture(dateien);
    const stderr: string[] = [];
    const aufrufe: Aufruf[] = [];
    const exits: number[] = [];
    const signale: Record<string, () => void> = {};
    const kind: Kind = { ereignisse: {}, getoetet: [], on(e, f) { this.ereignisse[e] = f; }, kill(s) { this.getoetet.push(s); } };
    starte(
      { name: "x-mcp", pkg: "@scope/x", bin: "xbin", root, args: ["--a"], ...extra },
      {
        spawn: (befehl: string, args: string[], opt: Record<string, unknown>) => (aufrufe.push({ befehl, args, opt }), kind),
        stderr: { write: (t: string) => stderr.push(t) },
        exit: (c: number) => exits.push(c),
        onSignal: (sig: string, fn: () => void) => { signale[sig] = fn; },
      },
    );
    return { root, stderr, aufrufe, exits, signale, kind };
  };
  const lock = JSON.stringify({ packages: { "node_modules/@scope/x": { version: "1.2.3" } } });
  const installiert = (version: string) => ({
    "package-lock.json": lock,
    "node_modules/@scope/x/package.json": JSON.stringify({ version, bin: { xbin: "cli.js" } }),
    "node_modules/@scope/x/cli.js": "",
  });

  test("abweichende lokale Version: Warnung auf stderr, Start lokal über node, kein npx", () => {
    const r = lauf(installiert("1.0.0"));
    expect(r.stderr).toEqual(["x-mcp: lokale Version 1.0.0 weicht vom Lockfile 1.2.3 ab, starte lokal (npm ci gleicht an)\n"]);
    expect(r.aufrufe).toHaveLength(1);
    expect(r.aufrufe[0].befehl).toBe(process.execPath);
    expect(r.aufrufe[0].args).toEqual([join(r.root, "node_modules/@scope/x", "cli.js"), "--a"]);
  });

  test("passende lokale Version: keine Warnung, kein npx", () => {
    const r = lauf(installiert("1.2.3"));
    expect(r.stderr).toEqual([]);
    expect(r.aufrufe[0].befehl).toBe(process.execPath);
  });

  test("ohne Installation: npx-Hinweis auf stderr und gepinnter npx-Start, cwd wird durchgereicht", () => {
    const r = lauf({ "package-lock.json": lock }, { cwd: "/arbeit" });
    expect(r.stderr).toEqual(["x-mcp: lokale Installation fehlt → npx @scope/x@1.2.3\n"]);
    expect(r.aufrufe[0].befehl).toBe("npx");
    expect(r.aufrufe[0].args).toEqual(["-y", "@scope/x@1.2.3", "--a"]);
    expect(r.aufrufe[0].opt).toMatchObject({ stdio: "inherit", cwd: "/arbeit" });
  });

  test("Lockfile ohne Eintrag: wirft, startet nichts", () => {
    expect(() => lauf({ "package-lock.json": JSON.stringify({ packages: {} }) })).toThrow(/Lockfile/);
  });

  test("Exit ≠ 0 des Servers: Ausfallzeile auf stderr, Exit-Code wird durchgereicht; Exit 0 bleibt still", () => {
    const r = lauf(installiert("1.2.3"));
    r.kind.ereignisse.exit(3, null);
    expect(r.exits).toEqual([3]);
    expect(r.stderr.join("")).toMatch(/^x-mcp: Server beendet \(Exit 3, nach \d+ s, Modus local\)\n$/);
    const still = lauf(installiert("1.2.3"));
    still.kind.ereignisse.exit(0, null);
    expect(still.exits).toEqual([0]);
    expect(still.stderr).toEqual([]);
  });

  test("Startfehler: Zeile auf stderr und Exit 1", () => {
    const r = lauf(installiert("1.2.3"));
    r.kind.ereignisse.error({ code: "ENOENT" });
    expect(r.stderr).toEqual(["x-mcp: Start fehlgeschlagen (ENOENT)\n"]);
    expect(r.exits).toEqual([1]);
  });

  test("Signal vom Host: wird an den Server weitergereicht und gilt nicht als Ausfall", () => {
    const r = lauf(installiert("1.2.3"));
    r.signale.SIGTERM();
    expect(r.kind.getoetet).toEqual(["SIGTERM"]);
    r.kind.ereignisse.exit(1, null); // Exit ≠ 0 nach Signal vom Host: kein Ausfall
    expect(r.stderr).toEqual([]);
    expect(r.exits).toEqual([1]);
  });
});

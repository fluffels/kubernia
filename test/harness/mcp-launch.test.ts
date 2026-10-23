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
    expect(l.npxHinweis("@scope/x@1.2.3")).toBe("x-mcp: lokale Installation fehlt oder weicht ab → npx @scope/x@1.2.3");
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

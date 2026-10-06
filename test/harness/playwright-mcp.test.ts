/* Wächter für die Browser-Verifikation der Agenten über den Playwright-MCP (#1283).
 *
 * @harness-waechter – einziger Durchsetzer seiner Regel, darum im geschützten test/harness/ (#1165).
 *
 * AGENTS.md schreibt die Browser-Verifikation über den Playwright-MCP vor. Fällt der
 * Server still aus, fehlen in der Session einfach die `mcp__playwright__*`-Tools –
 * kein Fehler, nur ein Agent, der auf „sollte gehen" zurückfällt. Darum prüft dieser
 * Test zwei Dinge:
 *  1. die Startlogik des Launchers (`scripts/playwright-mcp.mjs`): lokale Installation
 *     nur bei passender Lockfile-Version, sonst `npx` mit exakt gepinnter Version –
 *     nie ohne Version, nie `@latest`;
 *  2. die Verdrahtung: `.mcp.json` startet den Launcher, der Server ist in
 *     `.claude/settings.json` aktiviert, `browser_run_code_unsafe` steht auf `ask`,
 *     das Ausgabeverzeichnis ist gitignored, und das installierte Paket liefert den
 *     bin, den der Launcher erwartet (bricht bei einem Dependabot-Bump laut statt still).
 *
 * Ausführen mit:  npm test
 */
import { describe, test } from "vitest";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
// Reines Node-Tooling-Skript ohne Declaration-File (wie scripts/cleanup-worktrees.mjs).
// @ts-expect-error: kein .d.ts fuer das .mjs-Tooling-Skript.
import * as launcherModule from "../../scripts/playwright-mcp.mjs";

type Installed = { version: string; binPath: string } | null;
type Plan = { mode: "local"; binPath: string } | { mode: "npx"; spec: string };
type LauncherModule = {
  PKG: string;
  BIN: string;
  planLaunch: (input: { lockVersion: string | undefined; installed: Installed }) => Plan;
  readLockVersion: (root: string) => string | undefined;
  readInstalled: (root: string) => Installed;
};
const launcher = launcherModule as unknown as LauncherModule;

const root = join(import.meta.dirname, "..", "..");
const readJson = (rel: string): unknown => JSON.parse(readFileSync(join(root, rel), "utf8"));

describe("planLaunch – Startentscheidung des Launchers", () => {
  test("passende lokale Installation → lokal starten", () => {
    const plan = launcher.planLaunch({ lockVersion: "1.2.3", installed: { version: "1.2.3", binPath: "/x/cli.js" } });
    assert.deepEqual(plan, { mode: "local", binPath: "/x/cli.js" });
  });

  test("keine lokale Installation (Checkout ohne npm ci) → npx mit exakter Lockfile-Version", () => {
    const plan = launcher.planLaunch({ lockVersion: "1.2.3", installed: null });
    assert.deepEqual(plan, { mode: "npx", spec: `${launcher.PKG}@1.2.3` });
  });

  test("veraltete lokale Installation (Haupt-Checkout hinter dem Lockfile) → NICHT lokal, sondern npx gepinnt", () => {
    const plan = launcher.planLaunch({ lockVersion: "1.2.4", installed: { version: "1.2.3", binPath: "/x/cli.js" } });
    assert.deepEqual(plan, { mode: "npx", spec: `${launcher.PKG}@1.2.4` });
  });

  test("Lockfile ohne Eintrag → Fehler statt ungepinntem npx", () => {
    assert.throws(() => launcher.planLaunch({ lockVersion: undefined, installed: null }), /Lockfile/);
  });
});

describe("Verdrahtung im Repo", () => {
  test(".mcp.json startet den Playwright-Server über den Launcher (kein npx, kein @latest)", () => {
    const cfg = readJson(".mcp.json") as { mcpServers: Record<string, { command: string; args: string[] }> };
    const server = cfg.mcpServers.playwright;
    assert.ok(server, "Server `playwright` fehlt in .mcp.json");
    assert.equal(server.command, "node");
    assert.equal(server.args[0], "scripts/playwright-mcp.mjs");
    assert.ok(existsSync(join(root, server.args[0])), "Launcher-Datei fehlt");
    assert.ok(!server.args.some((a) => /@latest/.test(a)), "kein @latest in den Server-Argumenten");
  });

  test("Lockfile pinnt das Paket, und das installierte Paket liefert den erwarteten bin", () => {
    const lockVersion = launcher.readLockVersion(root);
    assert.match(lockVersion ?? "", /^\d+\.\d+\.\d+/, "Lockfile-Version von @playwright/mcp fehlt");
    const installed = launcher.readInstalled(root);
    assert.ok(installed, `node_modules/${launcher.PKG} fehlt oder hat keinen bin "${launcher.BIN}"`);
    assert.equal(installed.version, lockVersion);
    assert.ok(existsSync(installed.binPath), `bin-Datei ${installed.binPath} fehlt`);
  });

  test("settings.json aktiviert den Server, gibt ihn frei, stellt run_code_unsafe auf ask", () => {
    const s = readJson(".claude/settings.json") as {
      enabledMcpjsonServers?: string[];
      permissions: { allow: string[]; ask: string[] };
    };
    assert.ok(s.enabledMcpjsonServers?.includes("playwright"), "enabledMcpjsonServers ohne playwright");
    assert.ok(s.permissions.allow.includes("mcp__playwright"), "allow ohne mcp__playwright");
    assert.ok(
      s.permissions.ask.includes("mcp__playwright__browser_run_code_unsafe"),
      "browser_run_code_unsafe (Node-Code im Serverprozess) muss auf ask stehen",
    );
  });

  test("das Ausgabeverzeichnis des Servers ist gitignored", () => {
    const cfg = readJson(".mcp.json") as { mcpServers: Record<string, { args: string[] }> };
    const args = cfg.mcpServers.playwright.args;
    const outDir = args[args.indexOf("--output-dir") + 1];
    assert.ok(outDir, "--output-dir fehlt");
    const ignore = readFileSync(join(root, ".gitignore"), "utf8").split(/\r?\n/);
    assert.ok(ignore.includes(`${outDir}/`), `${outDir}/ fehlt in .gitignore`);
  });
});

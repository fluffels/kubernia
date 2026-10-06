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
import { afterAll, describe, test } from "vitest";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
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

// Die Temp-Ordner der Fixtures und des Handshakes liegen sonst je Lauf herum (#1309): am Ende alle löschen.
const angelegt: string[] = [];
afterAll(() => {
  for (const d of angelegt) rmSync(d, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
});
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

describe("readInstalled/readLockVersion – Dateizugriff liefert null/undefined statt zu werfen", () => {
  // Fixture-Checkout in einem Temp-Ordner: genau die Fälle, in denen main() sonst vor der
  // Startentscheidung abstürzte und der Server still fehlte.
  const fixture = (files: Record<string, string>): string => {
    const dir = mkdtempSync(join(tmpdir(), "kq-pwmcp-"));
    angelegt.push(dir);
    for (const [rel, content] of Object.entries(files)) {
      mkdirSync(dirname(join(dir, rel)), { recursive: true });
      writeFileSync(join(dir, rel), content);
    }
    return dir;
  };
  const pkgJson = (bin: unknown): string => JSON.stringify({ name: launcher.PKG, version: "1.2.3", bin });
  const pkgDir = `node_modules/${launcher.PKG}`;

  test("Paket nicht installiert (Checkout ohne npm ci) → null", () => {
    assert.equal(launcher.readInstalled(fixture({})), null);
  });

  test("package.json ohne passenden bin → null", () => {
    assert.equal(launcher.readInstalled(fixture({ [`${pkgDir}/package.json`]: pkgJson({ anders: "x.js" }) })), null);
  });

  test("bin-Eintrag vorhanden, Datei fehlt → null (nicht lokal starten)", () => {
    assert.equal(launcher.readInstalled(fixture({ [`${pkgDir}/package.json`]: pkgJson({ [launcher.BIN]: "cli.js" }) })), null);
  });

  test("kaputte package.json → null", () => {
    assert.equal(launcher.readInstalled(fixture({ [`${pkgDir}/package.json`]: "{kaputt" })), null);
  });

  test("bin als Objekt- und als String-Eintrag → Version + Pfad", () => {
    for (const bin of [{ [launcher.BIN]: "cli.js" }, "cli.js"]) {
      const dir = fixture({ [`${pkgDir}/package.json`]: pkgJson(bin), [`${pkgDir}/cli.js`]: "" });
      assert.deepEqual(launcher.readInstalled(dir), { version: "1.2.3", binPath: join(dir, pkgDir, "cli.js") });
    }
  });

  test("Lockfile fehlt, ist kaputt oder ohne Eintrag → undefined", () => {
    assert.equal(launcher.readLockVersion(fixture({})), undefined);
    assert.equal(launcher.readLockVersion(fixture({ "package-lock.json": "{kaputt" })), undefined);
    assert.equal(launcher.readLockVersion(fixture({ "package-lock.json": JSON.stringify({ packages: {} }) })), undefined);
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
    assert.ok(!server.args.some((a) => /@latest|^npx$/.test(a)), "kein npx/@latest in den Server-Argumenten");
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

  test("Claude in Chrome ist gesperrt: Browser-Verifikation nur über den isolierten Playwright-Browser", () => {
    // Die Erweiterung arbeitet im echten Browser der Maintainerin mit allen Logins (#1289).
    const s = readJson(".claude/settings.json") as { permissions: { deny: string[] } };
    assert.ok(s.permissions.deny.includes("mcp__claude-in-chrome"), "deny ohne mcp__claude-in-chrome");
  });

  test("Netz-Ausgang begrenzt (#1309): --allowed-origins nur auf localhost und 127.0.0.1", () => {
    const cfg = readJson(".mcp.json") as { mcpServers: Record<string, { args: string[] }> };
    const args = cfg.mcpServers.playwright.args;
    const i = args.indexOf("--allowed-origins");
    assert.ok(i >= 0 && args[i + 1], "--allowed-origins mit Wert fehlt in .mcp.json: der Browser dürfte jede Adresse ohne Rückfrage laden");
    const origins = args[i + 1].split(";").filter(Boolean);
    assert.deepEqual(origins, ["http://localhost:*", "http://127.0.0.1:*"]);
    assert.ok(origins.every((o) => /^http:\/\/(localhost|127\.0\.0\.1):\*$/.test(o)), "nur lokale Origins, keine Platzhalter-Hosts");
  });

  test("das Spiel lädt keine externen Origins (sonst bräche --allowed-origins die Verifikation)", () => {
    // Eingebettete Ressourcen von fremden Hosts (Skripte, Stylesheets, Bilder, Fonts) wären im Browser geblockt.
    const html = readFileSync(join(root, "index.html"), "utf8");
    const extern = [...html.matchAll(/\b(?:src|href)\s*=\s*["'](https?:\/\/[^"']+)["']/g)].map((m) => m[1]);
    const nurLinks = extern.filter((u) => !/^https:\/\/github\.com\//.test(u));
    assert.deepEqual(nurLinks, [], "index.html bettet externe Ressourcen ein");
  });

  test("das Ausgabeverzeichnis des Servers ist gitignored", () => {
    const cfg = readJson(".mcp.json") as { mcpServers: Record<string, { args: string[] }> };
    const args = cfg.mcpServers.playwright.args;
    const i = args.indexOf("--output-dir");
    assert.ok(i >= 0 && args[i + 1], "--output-dir mit Wert fehlt in .mcp.json");
    const outDir = args[i + 1];
    const ignore = readFileSync(join(root, ".gitignore"), "utf8").split(/\r?\n/);
    assert.ok(ignore.includes(`${outDir}/`), `${outDir}/ fehlt in .gitignore`);
  });
});

describe("tools/list-Handshake ohne Browser (#1309)", () => {
  /** Startet den Launcher mit den Args aus .mcp.json, spricht initialize + tools/list und beendet ihn. */
  const toolNamen = (): Promise<string[]> =>
    new Promise((resolve, reject) => {
      const cfg = readJson(".mcp.json") as { mcpServers: Record<string, { args: string[] }> };
      const args = cfg.mcpServers.playwright.args.map((a) => (a === "scripts/playwright-mcp.mjs" ? join(root, a) : a));
      const cwd = mkdtempSync(join(tmpdir(), "kq-pwmcp-hs-"));
      angelegt.push(cwd);
      const child = spawn(process.execPath, args, { cwd, stdio: ["pipe", "pipe", "ignore"] });
      const timer = setTimeout(() => {
        child.kill();
        reject(new Error("tools/list-Handshake nach 30 s ohne Antwort"));
      }, 30_000);
      let buf = "";
      const senden = (o: object) => child.stdin.write(JSON.stringify({ jsonrpc: "2.0", ...o }) + "\n");
      child.stdout.on("data", (d: Buffer) => {
        buf += d.toString();
        for (const zeile of buf.split("\n").slice(0, -1)) {
          try {
            const o = JSON.parse(zeile) as { id?: number; result?: { tools?: { name: string }[] } };
            if (o.id === 1) {
              senden({ method: "notifications/initialized" });
              senden({ id: 2, method: "tools/list", params: {} });
            }
            if (o.id === 2) {
              clearTimeout(timer);
              resolve((o.result?.tools ?? []).map((t) => t.name));
              child.kill(); // Aufräumen des Ordners übernimmt afterAll (Windows hält ihn kurz offen)
            }
          } catch {
            /* unvollständige Zeile */
          }
        }
        buf = buf.slice(buf.lastIndexOf("\n") + 1);
      });
      child.on("error", reject);
      senden({ id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "wachter", version: "1" } } });
    });

  test("der Server nennt die Tools der FAQ und jedes mcp__playwright__-Tool der Umsetzer-Whitelist", async () => {
    const namen = new Set(await toolNamen());
    const faq = ["browser_evaluate", "browser_take_screenshot", "browser_press_key", "browser_start_video"];
    const umsetzer = readFileSync(join(root, ".claude/agents/kubernia-umsetzer.md"), "utf8");
    const tools = /^tools:\s*(.+)$/m.exec(umsetzer)?.[1] ?? "";
    const whitelist = tools.split(",").map((t) => t.trim()).filter((t) => t.startsWith("mcp__playwright__")).map((t) => t.slice("mcp__playwright__".length));
    assert.ok(whitelist.length >= 10, "Whitelist des Umsetzers enthält keine Playwright-Tools mehr?");
    const fehlt = [...faq, ...whitelist].filter((n) => !namen.has(n));
    assert.deepEqual(fehlt, [], "Der Server kennt diese Tools nicht mehr (Umbenennung bei einem Dependabot-Bump?): die Whitelist fiele still aus");
  }, 60_000);

  test("Erkennung greift (Red-Green): ein erfundener Tool-Name fehlt im Server", async () => {
    const namen = new Set(await toolNamen());
    assert.ok(!namen.has("browser_gibt_es_nicht_1309"), "ein erfundener Name darf nicht vorkommen");
    assert.ok(namen.has("browser_navigate"));
  }, 60_000);
});

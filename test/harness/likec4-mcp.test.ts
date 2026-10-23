/* Wächter für den LikeC4-MCP der Agenten (#1422), Abfragewerkzeug für das Architekturmodell.
 *
 * @harness-waechter – einziger Durchsetzer seiner Regel, darum im geschützten test/harness/ (#1165).
 *
 * Fällt der Server still aus, fehlen in der Session einfach die `mcp__likec4__*`-Tools. Darum prüft dieser Test:
 *  1. die Launcher-Bausteine (`scripts/likec4-mcp.mjs` über `scripts/mcp-launch.mjs`): Version aus dem Lockfile,
 *     nie ungepinnt, Server-Argumente auf `docs/architektur`;
 *  2. die Verdrahtung: `.mcp.json` startet den Launcher, der Server ist aktiviert und freigegeben, und jedes
 *     Tool ohne `readOnlyHint` (heute `apply-semantic-layout`, schreibt Layout) steht auf `ask`, nie in `allow`;
 *  3. den echten Handshake (`initialize` + `tools/list`) gegen die lokale Installation.
 *
 * Der Server ist nie Gate-Quelle (ADR 0017).
 */
import { afterAll, describe, test } from "vitest";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
// Reines Node-Tooling-Skript ohne Declaration-File (wie scripts/playwright-mcp.mjs).
// @ts-expect-error: kein .d.ts fuer das .mjs-Tooling-Skript.
import * as launcherModule from "../../scripts/likec4-mcp.mjs";
import { mcpAbfrage, schreibToolsOhneAsk as schreibToolsOhneAskRoh, type McpAbfrage, type McpTool } from "./mcp-handshake";
// @ts-expect-error: kein .d.ts fuer das .mjs-Tooling-Skript.
import * as ausfallModule from "../../scripts/mcp-ausfall.mjs";
const istNpxFallback = (ausfallModule as unknown as { istNpxFallback: (text: string) => boolean }).istNpxFallback;

type Installed = { version: string; binPath: string } | null;
type Plan = { mode: "local"; binPath: string } | { mode: "npx"; spec: string };
type LauncherModule = {
  PKG: string;
  BIN: string;
  WORKSPACE: string;
  serverArgs: (extra?: string[]) => string[];
  planLaunch: (input: { lockVersion: string | undefined; installed: Installed }) => Plan;
  readLockVersion: (root: string) => string | undefined;
  readInstalled: (root: string) => Installed;
  exitMeldung: (o: { code: number | null; signal: string | null; vonAussen: boolean; laufzeitMs: number; modus: string; ersetzt: boolean }) => string | null;
  npxHinweis: (spec: string) => string;
};
const launcher = launcherModule as unknown as LauncherModule;

const root = join(import.meta.dirname, "..", "..");
const readJson = (rel: string): unknown => JSON.parse(readFileSync(join(root, rel), "utf8"));

const angelegt: string[] = [];
afterAll(() => {
  for (const d of angelegt) rmSync(d, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
});

/** Schreib-Tools des likec4-Servers ohne ask-Eintrag (`mcp__likec4__<name>`). */
const schreibToolsOhneAsk = (tools: McpTool[], ask: string[]): string[] => schreibToolsOhneAskRoh(tools, ask, "mcp__likec4__");

describe("Launcher-Bausteine (#1422)", () => {
  test("passende lokale Installation → lokal, sonst npx mit exakter Lockfile-Version", () => {
    assert.deepEqual(launcher.planLaunch({ lockVersion: "1.2.3", installed: { version: "1.2.3", binPath: "/x/likec4.mjs" } }), { mode: "local", binPath: "/x/likec4.mjs" });
    assert.deepEqual(launcher.planLaunch({ lockVersion: "1.2.3", installed: { version: "1.2.2", binPath: "/x/likec4.mjs" } }), { mode: "local", binPath: "/x/likec4.mjs", abweichung: { lokal: "1.2.2", lock: "1.2.3" } });
    assert.deepEqual(launcher.planLaunch({ lockVersion: "1.2.3", installed: null }), { mode: "npx", spec: "likec4@1.2.3" });
  });

  test("Lockfile ohne Eintrag → Fehler mit Paketnamen statt ungepinntem npx", () => {
    assert.throws(() => launcher.planLaunch({ lockVersion: undefined, installed: null }), /likec4.*Lockfile/);
  });

  test("Ausfallzeile trägt den Namen des Launchers", () => {
    const m = launcher.exitMeldung({ code: 1, signal: null, vonAussen: false, laufzeitMs: 4600, modus: "local", ersetzt: false });
    assert.equal(m, "likec4-mcp: Server beendet (Exit 1, nach 5 s, Modus local)");
  });

  test("npx-Hinweis hat das Format, das scripts/mcp-ausfall.mjs als npx-Fallback erkennt", () => {
    assert.ok(istNpxFallback(`Server stderr: ${launcher.npxHinweis("likec4@1.2.3")}`));
    assert.equal(launcher.npxHinweis("likec4@1.2.3"), "likec4-mcp: lokale Installation fehlt oder weicht ab → npx likec4@1.2.3");
  });

  test("Server-Argumente: stdio auf docs/architektur, Zusatzargumente hinten, Modellordner hat .c4-Dateien", () => {
    assert.deepEqual(launcher.serverArgs(), ["mcp", "--stdio", "docs/architektur"]);
    assert.deepEqual(launcher.serverArgs(["--x"]), ["mcp", "--stdio", "docs/architektur", "--x"]);
    const dateien = readdirSync(join(root, launcher.WORKSPACE)).filter((f) => f.endsWith(".c4"));
    assert.ok(dateien.length > 0, "docs/architektur enthält keine .c4-Datei");
  });
});

describe("Verdrahtung im Repo (#1422)", () => {
  const settings = () =>
    readJson(".claude/settings.json") as { enabledMcpjsonServers?: string[]; permissions: { allow: string[]; ask: string[] } };

  test(".mcp.json startet den likec4-Server über den Launcher (kein npx, kein @latest, kein Paketname mit Version)", () => {
    const cfg = readJson(".mcp.json") as { mcpServers: Record<string, { type: string; command: string; args: string[] }> };
    const server = cfg.mcpServers.likec4;
    assert.ok(server, "Server `likec4` fehlt in .mcp.json");
    assert.equal(server.type, "stdio");
    assert.equal(server.command, "node");
    assert.equal(server.args[0], "scripts/likec4-mcp.mjs");
    assert.ok(existsSync(join(root, server.args[0])), "Launcher-Datei fehlt");
    assert.ok(!server.args.some((a) => /@latest|^npx$|^likec4@/.test(a)), "kein npx/@latest/likec4@ in den Server-Argumenten");
  });

  test("Lockfile pinnt likec4 wie die devDependency, und das installierte Paket liefert den bin", () => {
    const lockVersion = launcher.readLockVersion(root);
    assert.match(lockVersion ?? "", /^\d+\.\d+\.\d+/, "Lockfile-Version von likec4 fehlt");
    const pkg = readJson("package.json") as { devDependencies?: Record<string, string> };
    assert.ok(pkg.devDependencies?.likec4, "likec4 fehlt in den devDependencies");
    const installed = launcher.readInstalled(root);
    assert.ok(installed, `node_modules/${launcher.PKG} fehlt oder hat keinen bin "${launcher.BIN}"`);
    assert.equal(installed.version, lockVersion);
    assert.ok(existsSync(installed.binPath), `bin-Datei ${installed.binPath} fehlt`);
  });

  test("settings.json aktiviert den Server, gibt ihn frei, schreibendes Tool steht auf ask und nicht in allow", () => {
    const s = settings();
    assert.ok(s.enabledMcpjsonServers?.includes("likec4"), "enabledMcpjsonServers ohne likec4");
    assert.ok(s.permissions.allow.includes("mcp__likec4"), "allow ohne mcp__likec4");
    assert.ok(!s.permissions.allow.includes("mcp__likec4__apply-semantic-layout"), "apply-semantic-layout darf nicht in allow stehen");
    assert.ok(s.permissions.ask.includes("mcp__likec4__apply-semantic-layout"), "apply-semantic-layout (schreibt Layout) muss auf ask stehen");
  });

  test("FAQ „Wie frage ich das Architekturmodell ab?“ nennt den Server und die Worktree-Grenze", () => {
    const faq = readFileSync(join(root, "docs/agent-harness-faq.md"), "utf8");
    const abschnitt = /^## Wie frage ich das Architekturmodell ab\?\s*$([\s\S]*?)(?=^## |(?![\s\S]))/m.exec(faq)?.[1] ?? "";
    assert.ok(abschnitt.length > 0, "FAQ-Abschnitt fehlt");
    assert.match(abschnitt, /likec4/);
    assert.match(abschnitt, /Worktree/);
  });
});

describe("schreibToolsOhneAsk – Erkennung (Red-Green)", () => {
  test("Tool ohne annotations und ohne ask-Eintrag wird gemeldet", () => {
    assert.deepEqual(schreibToolsOhneAsk([{ name: "x" }], []), ["x"]);
    assert.deepEqual(schreibToolsOhneAsk([{ name: "x", annotations: { readOnlyHint: false } }], []), ["x"]);
  });
  test("readOnly-Tool und Tool auf ask werden nicht gemeldet", () => {
    assert.deepEqual(schreibToolsOhneAsk([{ name: "x", annotations: { readOnlyHint: true } }], []), []);
    assert.deepEqual(schreibToolsOhneAsk([{ name: "x" }], ["mcp__likec4__x"]), []);
  });
  test("ask-Eintrag eines anderen Servers genügt nicht", () => {
    assert.deepEqual(schreibToolsOhneAsk([{ name: "x" }], ["mcp__playwright__x"]), ["x"]);
  });
  test("bekannte Schreib-Tools zählen nur mit Namen, nicht pauschal", () => {
    assert.deepEqual(schreibToolsOhneAskRoh([{ name: "x" }, { name: "y" }], [], "mcp__s__", ["x"]), ["y"]);
  });
});

// Mit lokaler Installation (npm ci, CI und jeder Worktree) läuft der Handshake offline; ohne sie würde der Launcher per npx laden.
const lokalInstalliert = launcher.readInstalled(root) !== null;
const HANDSHAKE_MS = 30_000;

describe.skipIf(!lokalInstalliert)("tools/list-Handshake (#1422)", () => {
  let einmal: Promise<McpAbfrage> | null = null;
  const abfrage = (): Promise<McpAbfrage> => {
    if (!einmal) {
      const cfg = readJson(".mcp.json") as { mcpServers: Record<string, { args: string[] }> };
      const args = cfg.mcpServers.likec4.args.map((a) => (a === "scripts/likec4-mcp.mjs" ? join(root, a) : a));
      const cwd = mkdtempSync(join(tmpdir(), "kq-likec4-hs-"));
      angelegt.push(cwd);
      // Der Launcher startet den Server selbst mit cwd = Repo-Root, das cwd des Aufrufers ist egal; der Aufruf
      // list-projects belegt es (tools/list ist statisch und bliebe auch ohne Modell grün).
      einmal = mcpAbfrage(args, cwd, HANDSHAKE_MS, { name: "list-projects", arguments: {} });
    }
    return einmal;
  };
  const tools = async (): Promise<McpTool[]> => (await abfrage()).tools;

  test("der Server nennt die Abfrage-Tools der FAQ", async () => {
    const namen = new Set((await tools()).map((t) => t.name));
    const fehlt = ["search-element", "read-element", "read-view", "find-relationships", "query-graph"].filter((n) => !namen.has(n));
    assert.deepEqual(fehlt, [], "Der Server kennt diese Tools nicht mehr (Umbenennung bei einem Dependabot-Bump?)");
  }, HANDSHAKE_MS * 2);

  test("jedes Tool ohne readOnlyHint steht in permissions.ask, sonst liefe ein neues Schreib-Tool über mcp__likec4 ungefragt", async () => {
    const ask = (readJson(".claude/settings.json") as { permissions: { ask: string[] } }).permissions.ask;
    assert.deepEqual(schreibToolsOhneAsk(await tools(), ask), [], "Schreib-Tool ohne ask-Eintrag in .claude/settings.json");
  }, HANDSHAKE_MS * 2);

  test("der Server liest das Modell aus docs/architektur, auch wenn der Aufrufer woanders startet (cwd des Launchers)", async () => {
    const r = (await abfrage()).aufruf as { structuredContent?: { projects?: { sources?: string[] }[] } } | undefined;
    const quellen = (r?.structuredContent?.projects ?? []).flatMap((p) => p.sources ?? []).map((s) => s.replaceAll("\\", "/").toLowerCase());
    assert.ok(quellen.some((s) => /\/docs\/architektur\/[^/]+\.c4$/.test(s)), `keine .c4-Quelle unter docs/architektur geladen: ${JSON.stringify(quellen)}`);
    const temp = tmpdir().replaceAll("\\", "/").toLowerCase();
    assert.ok(quellen.every((s) => !s.startsWith(temp)), "Modell darf nicht aus dem Temp-cwd des Aufrufers kommen");
  }, HANDSHAKE_MS * 2);

  test("Erkennung greift (Red-Green): ein erfundener Tool-Name fehlt im Server", async () => {
    const namen = new Set((await tools()).map((t) => t.name));
    assert.ok(!namen.has("gibt-es-nicht-1422"), "ein erfundener Name darf nicht vorkommen");
    assert.ok(namen.has("search-element"));
  }, HANDSHAKE_MS * 2);
});

/* MCP-Gesundheit (#1634): Config-Parser, Variablen-Prüfung, Bewertung, echte Handshake-Probe (grün, Absturz, Hänger,
 * Startfehler) und der Hook-Prozess selbst (Exit 0, stumm bei Gesundheit).
 *
 * Reines Node-Tooling ohne Declaration-File: Import über `unknown` auf ein lokales Interface (Technik wie test/sandbox-doctor.test.ts). */
import { describe, expect, test } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as raw from "../scripts/mcp-gesundheit.mjs";

type Server = { name: string; type?: string; command?: string; args?: string[]; url?: string; headers?: Record<string, string> };
type Probe = { ok: boolean; grund?: string; stderr?: string };
type Gesundheit = {
  serverAusConfig: (text: string) => Server[];
  fehlendeVariablen: (s: Server, env: Record<string, string | undefined>) => string[];
  bewertung: (name: string, p: Probe) => string | null;
  probeStdio: (s: Server, o?: { timeoutMs?: number }) => Promise<Probe>;
  pruefeAlle: (s: Server[], o: { cwd: string; env: Record<string, string | undefined>; probe?: (s: Server) => Promise<Probe> }) => Promise<string[]>;
  meldung: (abweichungen: string[]) => string;
};
const g = raw as unknown as Gesundheit;

/** Ein „MCP-Server“ als `node -e`-Einzeiler: antwortet auf initialize (`antwort`), stürzt ab (`exit`) oder hängt (`haengt`). */
const fake = (name: string, code: string): Server => ({ name, type: "stdio", command: "node", args: ["-e", code] });
const ANTWORT = `process.stdin.once("data",()=>console.log(JSON.stringify({jsonrpc:"2.0",id:1,result:{}})));setInterval(()=>{},1000)`;

describe("serverAusConfig", () => {
  test("liest Namen und Konfiguration; kaputtes oder leeres JSON ergibt []", () => {
    expect(g.serverAusConfig('{"mcpServers":{"a":{"type":"stdio","command":"node"}}}')).toEqual([{ name: "a", type: "stdio", command: "node" }]);
    expect(g.serverAusConfig("{kaputt")).toEqual([]);
    expect(g.serverAusConfig("{}")).toEqual([]);
  });
});

describe("fehlendeVariablen", () => {
  const s: Server = { name: "p", type: "http", url: "https://x/mcp", headers: { Authorization: "${PIXELLAB_TOKEN}" } };
  test("nennt nur nicht gesetzte oder leere Platzhalter", () => {
    expect(g.fehlendeVariablen(s, {})).toEqual(["PIXELLAB_TOKEN"]);
    expect(g.fehlendeVariablen(s, { PIXELLAB_TOKEN: "" })).toEqual(["PIXELLAB_TOKEN"]);
    expect(g.fehlendeVariablen(s, { PIXELLAB_TOKEN: "x" })).toEqual([]);
  });
  test("ohne Platzhalter nichts zu melden", () => {
    expect(g.fehlendeVariablen({ name: "t", type: "http", url: "https://x" }, {})).toEqual([]);
  });
});

describe("bewertung", () => {
  test("ok ohne npx-Hinweis ist gesund", () => {
    expect(g.bewertung("playwright", { ok: true, stderr: "" })).toBeNull();
  });
  test("ok, aber npx-Fallback ist eine Abweichung mit Abhilfe", () => {
    expect(g.bewertung("playwright", { ok: true, stderr: "playwright-mcp: lokale Installation fehlt oder weicht ab → npx @playwright/mcp@0.0.83" })).toContain("npm ci");
  });
  test("nicht ok nennt Grund und die letzten stderr-Zeilen", () => {
    const t = g.bewertung("playwright", { ok: false, grund: "beendet vor der Antwort (Exit 1)", stderr: "a\nb\nc\nd" });
    expect(t).toContain("startet nicht");
    expect(t).toContain("Exit 1");
    expect(t).toContain("b | c | d");
    expect(t).not.toContain("a |");
  });
});

describe("probeStdio (echte Prozesse)", () => {
  test("antwortet auf initialize → ok", async () => {
    expect((await g.probeStdio(fake("ok", ANTWORT), { timeoutMs: 5000 })).ok).toBe(true);
  });
  test("Absturz vor der Antwort → nicht ok mit Exit-Code und stderr", async () => {
    const p = await g.probeStdio(fake("kaputt", `console.error("kaputt-fehler");process.exit(3)`), { timeoutMs: 5000 });
    expect(p.ok).toBe(false);
    expect(p.grund).toContain("Exit 3");
    expect(p.stderr).toContain("kaputt-fehler");
  });
  test("Hänger → nicht ok nach dem Zeitlimit", async () => {
    const p = await g.probeStdio(fake("haengt", "setInterval(()=>{},1000)"), { timeoutMs: 400 });
    expect(p.ok).toBe(false);
    expect(p.grund).toContain("keine Antwort");
  });
  test("unbekannter Befehl → nicht ok", async () => {
    const p = await g.probeStdio({ name: "weg", type: "stdio", command: "kein-solcher-befehl-1634", args: [] }, { timeoutMs: 5000 });
    expect(p.ok).toBe(false);
  });
});

describe("pruefeAlle", () => {
  const cwd = ".";
  test("gesunde Server (stdio per Probe, http mit gesetzter Variable) → keine Abweichung", async () => {
    const server: Server[] = [fake("a", ANTWORT), { name: "h", type: "http", url: "https://x", headers: { A: "${T}" } }];
    expect(await g.pruefeAlle(server, { cwd, env: { T: "1" }, probe: async () => ({ ok: true }) })).toEqual([]);
  });
  test("ausgefallener stdio-Server und fehlende http-Variable werden je einzeln genannt", async () => {
    const server: Server[] = [fake("a", ANTWORT), { name: "h", type: "http", url: "https://x", headers: { A: "${T}" } }];
    const r = await g.pruefeAlle(server, { cwd, env: {}, probe: async () => ({ ok: false, grund: "beendet vor der Antwort (Exit 1)" }) });
    expect(r).toHaveLength(2);
    expect(r[0]).toContain("a: startet nicht");
    expect(r[1]).toContain("T");
  });
  test("unbekannte Server-Art fällt nie still weg", async () => {
    const r = await g.pruefeAlle([{ name: "s", type: "sse" }], { cwd, env: {} });
    expect(r[0]).toContain('"sse"');
  });
});

describe("meldung", () => {
  test("ohne Abweichung nichts ausgeben", () => {
    expect(g.meldung([])).toBe("");
  });
  test("mit Abweichung: Zahl, Zeilen und Meldepflicht", () => {
    const t = g.meldung(["playwright: startet nicht (x)"]);
    expect(t).toContain("(1)");
    expect(t).toContain("- playwright: startet nicht (x)");
    expect(t).toContain("Harness-Härtung (gesammelt)");
  });
});

describe("Hook-Prozess", () => {
  const skript = fileURLToPath(new URL("../scripts/mcp-gesundheit.mjs", import.meta.url));
  const lauf = (mcpJson: string | null) => {
    const dir = mkdtempSync(join(tmpdir(), "mcp-gesundheit-"));
    try {
      if (mcpJson !== null) writeFileSync(join(dir, ".mcp.json"), mcpJson);
      return spawnSync(process.execPath, [skript], { env: { ...process.env, CLAUDE_PROJECT_DIR: dir }, encoding: "utf8", timeout: 30000 });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };
  test("kaputter Server: meldet die Abweichung, Exit bleibt 0", () => {
    const r = lauf(JSON.stringify({ mcpServers: { kaputt: { type: "stdio", command: "node", args: ["-e", "process.exit(7)"] } } }));
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("MCP-Abweichung");
    expect(r.stdout).toContain("kaputt: startet nicht");
  });
  test("gesunder Server: stumm, Exit 0", () => {
    const r = lauf(JSON.stringify({ mcpServers: { ok: fake("ok", ANTWORT) } }));
    expect(r.status).toBe(0);
    expect(r.stdout).toBe("");
  });
  test("fehlende oder kaputte .mcp.json blockiert nie (Exit 0, stumm)", () => {
    for (const inhalt of [null, "{kaputt"]) {
      const r = lauf(inhalt);
      expect(r.status).toBe(0);
      expect(r.stdout).toBe("");
    }
  });
});

/* Fehlende Projekt-Config bei den Messskripten (#1821 L12/L22): jedes bricht mit seinem Exit-Code und einer Meldung samt Projekt-Config-Hinweis ab,
 * nie mit Stacktrace. Der Test startet die Skripte aus einer Kopie von `scripts/` ohne `.factory/projekt.json` (PATH nur mit node: kein gh, kein Netz).
 * Der Exit-Code ist je Skript verschieden und gehört zum Vertrag: 1 (Config nicht nutzbar) bei hauptchat-zerlegung, kontext-treiber, subagent-laufzeit,
 * token-baseline und gh-kontingent --bericht (fail-closed-catch der CLI-main), 2 bei lauf-ergebnis (alle Fehler dort). */
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const VON = "2026-01-01T00:00:00Z";
const BIS = "2026-01-02T00:00:00Z";
let kopie = "";

beforeAll(() => {
  kopie = mkdtempSync(join(tmpdir(), "kq-mess-config-"));
  cpSync(join(ROOT, "scripts"), join(kopie, "scripts"), { recursive: true });
});
afterAll(() => {
  if (kopie) rmSync(kopie, { recursive: true, force: true });
});

function starte(skript: string, argv: string[]): { status: number | null; text: string } {
  const env: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(process.env)) if (k.toUpperCase() !== "PATH" && k !== "GITHUB_REPOSITORY" && k !== "KQ_GH_KOSTEN_LOG") env[k] = v;
  env.PATH = dirname(process.execPath);
  const r = spawnSync(process.execPath, [join(kopie, "scripts", `${skript}.mjs`), ...argv], { encoding: "utf8", env, timeout: 60_000, cwd: kopie });
  return { status: r.status, text: `${r.stdout}\n${r.stderr}` };
}

describe.each([
  ["hauptchat-zerlegung", ["--von", VON, "--bis", BIS], 1],
  ["kontext-treiber", ["--von", VON], 1],
  ["subagent-laufzeit", ["--von", VON], 1],
  ["token-baseline", ["--session", "abc"], 1],
  ["gh-kontingent", ["--bericht"], 1],
  ["lauf-ergebnis", ["--von", VON, "--bis", BIS], 2],
] as const)("%s ohne Projekt-Config", (skript, argv, exit) => {
  test(`Exit ${exit}, Meldung nennt die Projekt-Config mit Fix-Zeile, kein Stacktrace`, () => {
    const r = starte(skript, [...argv]);
    expect(r.status).toBe(exit);
    expect(r.text).toMatch(/Projekt-Config|projekt\.json/);
    expect(r.text).toMatch(/Fix:/);
    expect(r.text).not.toMatch(/^\s+at /m);
    expect(r.text).not.toContain("node:internal");
  }, 60_000);
});

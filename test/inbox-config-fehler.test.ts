/* Kaputte oder fehlende Projekt-Config bei den Inbox-Skripten (#1821, #1837): `audit-einordnung`, `codescanning-inbox`, `wiedervorlage` und
 * `harness-doctor-melden` starten über `inboxStart` und importieren `board-lib`/`inbox-lib` erst danach; die Config-Ursache kommt als `::error::`-Meldung mit `Fix:`-Zeile, nie als Stacktrace
 * („    at …“). Der Test startet die Skripte aus einer Kopie von `scripts/` ohne `.factory/projekt.json` (PATH nur mit node: kein gh, kein Netz). */
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
let kopie = "";

beforeAll(() => {
  kopie = mkdtempSync(join(tmpdir(), "kq-inbox-config-"));
  cpSync(join(ROOT, "scripts"), join(kopie, "scripts"), { recursive: true });
});
afterAll(() => {
  if (kopie) rmSync(kopie, { recursive: true, force: true });
});

function starte(skript: string, argv: string[]): { status: number | null; stdout: string; stderr: string } {
  const env: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(process.env)) if (k.toUpperCase() !== "PATH" && k !== "GITHUB_REPOSITORY") env[k] = v;
  env.PATH = dirname(process.execPath);
  const r = spawnSync(process.execPath, [join(kopie, "scripts", `${skript}.mjs`), ...argv], { encoding: "utf8", env, timeout: 60_000, cwd: kopie });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

describe.each([
  ["audit-einordnung", "Audit-Einordnung"],
  ["codescanning-inbox", "Code-Scanning-Inbox"],
  ["wiedervorlage", "Wiedervorlage"],
  ["harness-doctor-melden", "Harness-Doctor \\(Wochenlauf\\)"],
])("%s mit fehlender Projekt-Config", (skript, name) => {
  test("Exit 2, ::error:: mit Fix-Zeile, kein Stacktrace", () => {
    const r = starte(skript, ["--dry-run"]);
    const text = `${r.stdout}\n${r.stderr}`;
    expect(r.status).toBe(2);
    expect(r.stdout).toMatch(new RegExp(`^::error::${name}: Projekt-Config nicht lesbar: Projekt-Config fehlt oder ist nicht lesbar`));
    expect(text).toMatch(/^Fix: /m);
    expect(text).not.toMatch(/^\s+at /m);
    expect(text).not.toContain("node:internal");
  });

  test("ein Aufruf-Fehler kommt vor dem Config-Laden (Exit 2, Aufrufzeile, nichts auf stdout)", () => {
    const r = starte(skript, ["--bogus"]);
    expect(r.status).toBe(2);
    expect(r.stdout).toBe("");
    expect(r.stderr).toBe(`Unbekanntes Argument: --bogus\nAufruf: node scripts/${skript}.mjs [--dry-run]\n`);
  });
});

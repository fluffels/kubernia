/* Langfuse-Quelle, Unterprozess-Allowlist und Kommandozeile des Cockpits (#1764). */
import { describe, expect, test } from "vitest";
import { createServer } from "node:net";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as rawLangfuse from "../../scripts/cockpit/quellen/langfuse.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as rawLauf from "../../scripts/cockpit/lauf.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as rawQuelle from "../../scripts/cockpit/quelle.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as rawSeite from "../../scripts/cockpit/seite.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as rawCockpit from "../../scripts/cockpit/cockpit.mjs";

interface Lauf { code: number | null; stdout: string; stderr: string; fehler: string | null }
interface Ergebnis { status: string; daten: Record<string, unknown> | null; grund: string | null }
interface Ctx { jetzt: () => number; signal: AbortSignal; lauf: (id: string) => Promise<Lauf> }
interface Panel { id: string; titel: string; ergebnis: Ergebnis; zuletztOk: number | null }
const langfuse = (rawLangfuse as unknown as { default: { id: string; sammeln: (c: Ctx) => Promise<Ergebnis> } }).default;
const { laufe } = rawLauf as unknown as { laufe: (id: string, o?: { cwd?: string; env?: NodeJS.ProcessEnv }) => Promise<Lauf> };
const { erzeugeAbruf } = rawQuelle as unknown as { erzeugeAbruf: (o: { quellen: unknown[]; ctxFuer: () => Partial<Ctx> }) => () => Promise<Panel[]> };
const { renderSeite } = rawSeite as unknown as { renderSeite: (o: { panels: Panel[]; jetzt: number; projekt: string }) => string };
const { leseArgs } = rawCockpit as unknown as { leseArgs: (a: string[], cwd: string) => { projekt?: string; port?: number; fehler?: string } };

const ctxMit = (l: Lauf): Ctx => ({ jetzt: () => 7, signal: new AbortController().signal, lauf: () => Promise.resolve(l) });
const lauf = (code: number | null, stderr = "", fehler: string | null = null): Lauf => ({ code, stdout: "", stderr, fehler });

describe("Langfuse-Quelle", () => {
  test("Exit 0 ist ok", async () => {
    expect(await langfuse.sammeln(ctxMit(lauf(0)))).toMatchObject({ status: "ok", daten: { Health: "erreichbar" }, grund: null });
  });

  test("Exit 1 ist Ausfall mit der ersten stderr-Zeile", async () => {
    const e = await langfuse.sammeln(ctxMit(lauf(1, "\nLangfuse nicht erreichbar: ECONNREFUSED. Hinweis\nzweite Zeile\n")));
    expect(e).toMatchObject({ status: "ausfall", daten: null, grund: "Langfuse nicht erreichbar: ECONNREFUSED. Hinweis" });
  });

  test("Exit 1 ohne stderr hat trotzdem einen Grund", async () => {
    expect((await langfuse.sammeln(ctxMit(lauf(1)))).grund).toBe("Langfuse aus");
  });

  test.each([[2, null, "Exit 2"], [null, "ENOENT", "Exit ENOENT"]])("Exit %s / Fehler %s ist Ausfall", async (code, fehler, text) => {
    const e = await langfuse.sammeln(ctxMit(lauf(code, "", fehler)));
    expect(e).toMatchObject({ status: "ausfall", daten: null });
    expect(e.grund).toBe(`Langfuse-Prüfung fehlgeschlagen (${text})`);
  });

  test("echter Unterprozess gegen einen geschlossenen Port: Ausfall-Panel", async () => {
    const port = await new Promise<number>((res) => {
      const s = createServer();
      s.listen(0, "127.0.0.1", () => {
        const p = (s.address() as { port: number }).port;
        s.close(() => res(p));
      });
    });
    const env = { ...process.env, LANGFUSE_BASE_URL: `http://127.0.0.1:${port}` };
    const panels = await erzeugeAbruf({ quellen: [langfuse], ctxFuer: () => ({ lauf: (id: string) => laufe(id, { env }) }) })();
    expect(panels[0].ergebnis.status).toBe("ausfall");
    expect(renderSeite({ panels, jetzt: 1, projekt: "p" })).toContain("Ausfall: Langfuse nicht erreichbar");
  }, 15000);
});

describe("Allowlist", () => {
  test("unbekannte id wirft", () => {
    expect(() => laufe("unbekannt")).toThrow("Befehl nicht in der Allowlist: unbekannt");
  });
});

describe("leseArgs", () => {
  const cwd = process.cwd();
  test("Standard ist cwd und Port 4180", () => {
    expect(leseArgs([], cwd)).toEqual({ projekt: cwd, port: 4180 });
  });

  test("gültige Flags", () => {
    expect(leseArgs(["--projekt", ".", "--port", "0"], cwd)).toEqual({ projekt: cwd, port: 0 });
    expect(leseArgs(["--port", "65535"], cwd).port).toBe(65535);
  });

  test.each([
    [["--port", "abc"]],
    [["--port", "70000"]],
    [["--port", "-1"]],
    [["--port", "1.5"]],
    [["--projekt"]],
    [["--projekt", "gibt-es-nicht-1764"]],
    [["--unbekannt"]],
  ])("Aufruf-Fehler %j", (argv) => {
    expect(leseArgs(argv, cwd).fehler).toEqual(expect.any(String));
  });

  test("--projekt auf eine Datei ist ein Fehler", () => {
    const dir = mkdtempSync(join(tmpdir(), "kq-cockpit-"));
    try {
      writeFileSync(join(dir, "f.txt"), "x");
      expect(leseArgs(["--projekt", "f.txt"], dir).fehler).toContain("kein Verzeichnis");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

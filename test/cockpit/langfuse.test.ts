/* Langfuse-Quelle, Unterprozess-Allowlist und Kommandozeile des Cockpits (#1764). */
import { afterEach, describe, expect, test, vi } from "vitest";
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
const lauf = (code: number | null, stdout = "", fehler: string | null = null): Lauf => ({ code, stdout, stderr: "", fehler });
const json = (erreichbar: boolean, grund: string | null): string => JSON.stringify({ erreichbar, grund });

describe("Langfuse-Quelle", () => {
  test("Exit 0 ist ok", async () => {
    expect(await langfuse.sammeln(ctxMit(lauf(0, json(true, null))))).toMatchObject({ status: "ok", daten: { Health: "erreichbar" }, grund: null });
  });

  test("Exit 1 ist Ausfall mit dem Grund aus dem JSON", async () => {
    const e = await langfuse.sammeln(ctxMit(lauf(1, json(false, "Langfuse nicht erreichbar: ECONNREFUSED"))));
    expect(e).toMatchObject({ status: "ausfall", daten: null, grund: "Langfuse nicht erreichbar: ECONNREFUSED" });
  });

  test("Exit 1 mit leerem oder fehlendem Grund hat trotzdem einen Grund", async () => {
    expect((await langfuse.sammeln(ctxMit(lauf(1, json(false, null))))).grund).toBe("Langfuse aus");
    expect((await langfuse.sammeln(ctxMit(lauf(1, json(false, "  "))))).grund).toBe("Langfuse aus");
  });

  test.each([[""], ["kein json"], ["{}"], [JSON.stringify({ erreichbar: "ja" })], ["null"], [json(false, "x")]])(
    "unlesbare oder widersprüchliche Ausgabe bei Exit 0 ist Ausfall (%s)",
    async (stdout) => {
      const e = await langfuse.sammeln(ctxMit(lauf(0, stdout)));
      expect(e).toMatchObject({ status: "ausfall", daten: null, grund: "Langfuse-Prüfung fehlgeschlagen (unlesbare Ausgabe)" });
    },
  );

  test("Exit 1 mit widersprüchlichem JSON (erreichbar true) ist Ausfall", async () => {
    expect((await langfuse.sammeln(ctxMit(lauf(1, json(true, null))))).grund).toBe("Langfuse-Prüfung fehlgeschlagen (unlesbare Ausgabe)");
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

describe("laufe", () => {
  test("ein bereits abgebrochenes Signal ergibt code null und einen Fehlertext", async () => {
    const ac = new AbortController();
    ac.abort();
    const l = await (rawLauf as unknown as { laufe: (id: string, o: { signal: AbortSignal }) => Promise<Lauf> }).laufe("langfuse-vorbedingung", { signal: ac.signal });
    expect(l.code).toBeNull();
    expect(l.fehler).toBe("ABORT_ERR");
  });

  test("ein nicht existierendes Arbeitsverzeichnis ist ein Spawn-Fehler: code null, fehler ENOENT", async () => {
    const l = await (rawLauf as unknown as { laufe: (id: string, o: { cwd: string }) => Promise<Lauf> }).laufe("langfuse-vorbedingung", { cwd: join(tmpdir(), "gibt-es-nicht-1821") });
    expect(l.code).toBeNull();
    expect(l.fehler).toBe("ENOENT");
  });
});

describe("main", () => {
  const { main } = rawCockpit as unknown as { main: (argv: string[], cwd: string, deps?: { starteServer: unknown }) => Promise<number | (() => Promise<void>)> };
  const stumm = () => [vi.spyOn(console, "error").mockImplementation(() => undefined), vi.spyOn(console, "log").mockImplementation(() => undefined)] as const;
  afterEach(() => vi.restoreAllMocks());

  test("Aufruf-Fehler: Exit 2 und Aufruf-Hinweis", async () => {
    const [err] = stumm();
    expect(await main(["--port", "abc"], process.cwd())).toBe(2);
    expect(String(err.mock.calls[0][0])).toContain("Aufruf: npm run cockpit");
  });

  test("Erfolg: liefert schliessen und die Startmeldung mit der Adresse", async () => {
    const [, log] = stumm();
    const schliessen = await main(["--port", "0"], process.cwd());
    try {
      expect(schliessen).toEqual(expect.any(Function));
      expect(String(log.mock.calls[0][0])).toMatch(/^Cockpit: http:\/\/127\.0\.0\.1:\d+\//);
    } finally {
      if (typeof schliessen === "function") await schliessen();
    }
  });

  test("anderer Startfehler als belegter Port: Exit 1 mit der Fehlermeldung", async () => {
    const [err] = stumm();
    const starteServer = () => Promise.reject(new Error("kaputt"));
    expect(await main(["--port", "0"], process.cwd(), { starteServer })).toBe(1);
    expect(String(err.mock.calls[0][0])).toBe("Cockpit startet nicht: kaputt");
  });

  test("der Kontext der Quellen trägt das Projekt (ctx.projekt) und den Allowlist-Lauf", async () => {
    stumm();
    let ctx: { projekt: string; lauf: unknown } | undefined;
    const starteServer = (o: { ctxFuer: (s: AbortSignal) => { projekt: string; lauf: unknown } }) => {
      ctx = o.ctxFuer(new AbortController().signal);
      return Promise.resolve({ port: 1, schliessen: () => Promise.resolve() });
    };
    const projekt = mkdtempSync(join(tmpdir(), "cockpit-lf-"));
    try {
      await main(["--projekt", projekt], process.cwd(), { starteServer });
      expect(ctx?.projekt).toBe(projekt);
      expect(ctx?.lauf).toEqual(expect.any(Function));
    } finally {
      rmSync(projekt, { recursive: true, force: true });
    }
  });

  test("belegter Port: Exit 1 und Meldung", async () => {
    const [err] = stumm();
    const besetzt = createServer();
    await new Promise<void>((r) => besetzt.listen(0, "127.0.0.1", () => r()));
    try {
      const port = (besetzt.address() as { port: number }).port;
      expect(await main(["--port", String(port)], process.cwd())).toBe(1);
      expect(String(err.mock.calls[0][0])).toContain(`Port ${port} ist belegt`);
    } finally {
      await new Promise((r) => besetzt.close(r));
    }
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
    const dir = mkdtempSync(join(tmpdir(), "cockpit-lf-"));
    try {
      writeFileSync(join(dir, "f.txt"), "x");
      expect(leseArgs(["--projekt", "f.txt"], dir).fehler).toContain("kein Verzeichnis");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

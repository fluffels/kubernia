/* Gemeinsamer Start der Inbox-Skripte (#1837 L16): Aufruf-Check vor dem Config-Laden, Config- und Lib-Fehler als einheitliche `::error::`-Meldung. */
import { describe, expect, test } from "vitest";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as rawLib from "../scripts/inbox-start-lib.mjs";

interface Start { trocken?: boolean; config?: unknown; libs?: unknown; code?: number }
type Deps = { skript: string; praefix: string; ladeConfig?: () => unknown; ladeLibs?: () => Promise<unknown>; log: (s: string) => void; err: (s: string) => void };
const L = rawLib as unknown as { inboxStart: (argv: string[], deps: Deps) => Promise<Start>; ladeBoardLibs: () => Promise<unknown> };

function deps(extra: Partial<Deps> = {}) {
  const log: string[] = [];
  const err: string[] = [];
  const geladen = { config: 0, libs: 0 };
  const d: Deps = {
    skript: "demo",
    praefix: "Demo: Projekt-Config nicht lesbar: ",
    ladeConfig: () => { geladen.config++; return { c: 1 }; },
    ladeLibs: () => { geladen.libs++; return Promise.resolve({ l: 1 }); },
    log: (s) => log.push(s),
    err: (s) => err.push(s),
    ...extra,
  };
  return { d, log, err, geladen };
}

describe("inboxStart", () => {
  test("Gutfall: Config und Libs geladen, trocken aus --dry-run", async () => {
    const { d, log, err } = deps();
    expect(await L.inboxStart(["--dry-run"], d)).toEqual({ trocken: true, config: { c: 1 }, libs: { l: 1 } });
    expect((await L.inboxStart([], d)).trocken).toBe(false);
    expect([log, err]).toEqual([[], []]);
  });

  test("Aufruf-Fehler: Aufrufzeile auf err, Code 2, weder Config noch Libs geladen", async () => {
    const { d, log, err, geladen } = deps();
    expect(await L.inboxStart(["--bogus"], d)).toEqual({ code: 2 });
    expect(err).toEqual(["Unbekanntes Argument: --bogus\nAufruf: node scripts/demo.mjs [--dry-run]"]);
    expect(log).toEqual([]);
    expect(geladen).toEqual({ config: 0, libs: 0 });
  });

  test("Config-Fehler: ::error:: mit Präfix, Code 2, Libs nie importiert", async () => {
    const { d, log, geladen } = deps({ ladeConfig: () => { throw new Error("Projekt-Config fehlt: x\nFix: anlegen"); } });
    expect(await L.inboxStart([], d)).toEqual({ code: 2 });
    expect(log).toEqual(["::error::Demo: Projekt-Config nicht lesbar: Projekt-Config fehlt: x\nFix: anlegen"]);
    expect(geladen.libs).toBe(0);
  });

  test("Lib-Import-Fehler: gleiche Meldungsform, Code 2", async () => {
    const { d, log } = deps({ ladeLibs: () => Promise.reject(new Error("Import kaputt")) });
    expect(await L.inboxStart([], d)).toEqual({ code: 2 });
    expect(log).toEqual(["::error::Demo: Projekt-Config nicht lesbar: Import kaputt"]);
  });
});

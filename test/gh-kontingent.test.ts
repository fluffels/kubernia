/* GitHub-API-Kontingent (#1549 Z1): Vorab-Prüfung, Kostenmessung je Skriptlauf, Bericht. */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as raw from "../scripts/kontingent-lib.mjs";

type Art = { art: string; remaining: number; limit: number; resetInMin: number };
type Pruefung = { ok: boolean; knapp: Art[]; meldung: string; warnung?: string };
type Res = { limit: number; remaining: number; reset: number; used: number };
const K = raw as unknown as {
  kontingentPruefen: (j: unknown, o?: { minAnteil?: number; jetzt?: number }) => Pruefung;
  kostenDelta: (v: unknown, n: unknown) => { core: number; graphql: number };
  berichtAus: (z: string[]) => { skripte: Record<string, { laeufe: number; core: number; graphql: number; coreMax: number; graphqlMax: number }>; uebersprungen: number };
  mitKontingent: (name: string, o: Record<string, unknown>) => { ok: boolean };
};

const JETZT = 1_000_000_000_000;
const res = (remaining: number, o: Partial<Res> = {}): Res => ({ limit: 5000, remaining, reset: JETZT / 1000 + 23 * 60, used: 5000 - remaining, ...o });
const rate = (core: Res, graphql: Res) => ({ resources: { core, graphql } });

describe("kontingentPruefen", () => {
  test("beide über 10 %: ok, keine Meldung", () => {
    const p = K.kontingentPruefen(rate(res(4000), res(3000)), { jetzt: JETZT });
    expect(p).toMatchObject({ ok: true, knapp: [], meldung: "" });
  });
  test("exakt 10 % ist noch ok, darunter knapp", () => {
    expect(K.kontingentPruefen(rate(res(500), res(5000)), { jetzt: JETZT }).ok).toBe(true);
    const p = K.kontingentPruefen(rate(res(499), res(5000)), { jetzt: JETZT });
    expect(p.ok).toBe(false);
    expect(p.knapp).toEqual([{ art: "core", remaining: 499, limit: 5000, resetInMin: 23 }]);
  });
  test("Meldung nennt Art, Rest, Prozent und Reset in Minuten", () => {
    const p = K.kontingentPruefen(rate(res(5000), res(312)), { jetzt: JETZT });
    expect(p.meldung).toBe("GitHub-API-Kontingent knapp: graphql 312/5000 (6 %), Reset in 23 min.");
  });
  test("beide knapp: beide in der Meldung", () => {
    const p = K.kontingentPruefen(rate(res(10), res(20)), { jetzt: JETZT });
    expect(p.knapp.map((k) => k.art)).toEqual(["core", "graphql"]);
    expect(p.meldung).toContain("core 10/5000");
    expect(p.meldung).toContain("graphql 20/5000");
  });
  test("Reset in der Vergangenheit ergibt 0 min, nie negativ", () => {
    const p = K.kontingentPruefen(rate(res(1, { reset: 1 }), res(5000)), { jetzt: JETZT });
    expect(p.knapp[0].resetInMin).toBe(0);
  });
  test.each([
    ["kaputtes JSON", "kein json"],
    ["fehlende Felder", { resources: {} }],
    ["limit 0", rate(res(0, { limit: 0 }), res(0, { limit: 0 }))],
    ["null", null],
  ])("fail-open bei %s: ok mit Warnung", (_n, eingabe) => {
    const p = K.kontingentPruefen(eingabe, { jetzt: JETZT });
    expect(p.ok).toBe(true);
    expect(p.warnung).toMatch(/nicht lesbar/);
  });
});

describe("kontingentPruefen: Teilantworten", () => {
  test("nur core lesbar: core wird geprüft, die kaputte Art übersprungen", () => {
    expect(K.kontingentPruefen({ resources: { core: res(4000) } }, { jetzt: JETZT }).ok).toBe(true);
    expect(K.kontingentPruefen({ resources: { core: res(1), graphql: "x" } }, { jetzt: JETZT }).ok).toBe(false);
  });
  test("fehlendes used wird aus limit - remaining abgeleitet", () => {
    const ohneUsed = (r: Res) => ({ limit: r.limit, remaining: r.remaining, reset: r.reset });
    const v = rate(ohneUsed(res(4000)) as Res, res(5000));
    const n = rate(ohneUsed(res(3990)) as Res, res(5000));
    expect(K.kostenDelta(v, n).core).toBe(10);
  });
});

describe("kostenDelta", () => {
  test("gleiches Fenster: Differenz der used-Werte", () => {
    const v = rate(res(4000), res(4900));
    const n = rate(res(3990), res(4700));
    expect(K.kostenDelta(v, n)).toEqual({ core: 10, graphql: 200 });
  });
  test("gerolltes Fenster (anderes reset): used des neuen Fensters", () => {
    const v = rate(res(100), res(100));
    const n = rate(res(4990, { reset: JETZT / 1000 + 4000 }), res(5000, { reset: JETZT / 1000 + 4000 }));
    expect(K.kostenDelta(v, n)).toEqual({ core: 10, graphql: 0 });
  });
  test("unlesbar: 0, nie negativ oder NaN", () => {
    expect(K.kostenDelta(null, rate(res(1), res(1)))).toEqual({ core: 0, graphql: 0 });
    expect(K.kostenDelta(rate(res(1, { used: 9 }), res(1)), rate(res(1, { used: 3 }), res(1)))).toEqual({ core: 0, graphql: 0 });
  });
});

describe("berichtAus", () => {
  test("Aggregat je Skript mit Läufen, Summe und Maximum; kaputte Zeilen werden gezählt", () => {
    const z = [
      JSON.stringify({ skript: "board-place", core: 5, graphql: 40 }),
      JSON.stringify({ skript: "board-place", core: 7, graphql: 60 }),
      JSON.stringify({ skript: "naechstes-ticket", core: 3, graphql: 0 }),
      "kaputt",
      "",
      JSON.stringify({ core: 1 }),
    ];
    const b = K.berichtAus(z);
    expect(b.skripte["board-place"]).toEqual({ laeufe: 2, core: 12, graphql: 100, coreMax: 7, graphqlMax: 60 });
    expect(b.skripte["naechstes-ticket"]).toEqual({ laeufe: 1, core: 3, graphql: 0, coreMax: 3, graphqlMax: 0 });
    expect(b.uebersprungen).toBe(2);
  });
});

describe("mitKontingent", () => {
  function umgebung(vorher: unknown, nachher: unknown, env: Record<string, string> = {}) {
    const antworten = [vorher, nachher];
    const aufrufe: string[][] = [];
    const tokens: Array<string | undefined> = [];
    const timeouts: Array<number | undefined> = [];
    const ausgaben: string[] = [];
    const logZeilen: string[] = [];
    const handler: Array<() => void> = [];
    let exitCode: number | undefined;
    const opts = {
      exec: (_c: string, args: string[], o: { env?: Record<string, string>; timeout?: number }) => {
        timeouts.push(o.timeout);
        aufrufe.push(args);
        tokens.push(o.env?.GH_TOKEN);
        const a = antworten.shift();
        if (a instanceof Error) throw a;
        return JSON.stringify(a);
      },
      schreibe: (t: string) => ausgaben.push(t),
      schreibeLog: (z: string) => logZeilen.push(z),
      registriere: (f: () => void) => handler.push(f),
      beende: (c: number) => {
        exitCode = c;
      },
      env,
      jetzt: () => JETZT,
    };
    return { opts, aufrufe, tokens, timeouts, ausgaben, logZeilen, handler, exit: () => exitCode };
  }

  test("genug Kontingent: Lauf darf weiter, nach dem Lauf genau eine Logzeile mit Delta", () => {
    const u = umgebung(rate(res(4000), res(4000)), rate(res(3990), res(3800)));
    expect(K.mitKontingent("board-place", u.opts).ok).toBe(true);
    expect(u.exit()).toBeUndefined();
    expect(u.logZeilen).toHaveLength(0);
    u.handler.forEach((f) => f());
    expect(u.logZeilen).toHaveLength(1);
    expect(JSON.parse(u.logZeilen[0])).toMatchObject({ skript: "board-place", core: 10, graphql: 200, coreRest: 3990, graphqlRest: 3800 });
    expect(u.aufrufe.every((a) => a.join(" ") === "api rate_limit")).toBe(true);
  });
  test("knapp lokal: Abbruch mit Exit 3, Reset-Zeit in der Meldung, kein Log", () => {
    const u = umgebung(rate(res(5000), res(300)), rate(res(5000), res(300)));
    expect(K.mitKontingent("board-place", u.opts).ok).toBe(false);
    expect(u.exit()).toBe(3);
    expect(u.ausgaben.join("")).toContain("✖ Abbruch: GitHub-API-Kontingent knapp: graphql 300/5000 (6 %), Reset in 23 min. Später erneut fahren.");
    expect(u.handler).toHaveLength(0);
  });
  test("knapp unter GitHub Actions: nur ::warning::, Lauf geht weiter, kein Exit", () => {
    const u = umgebung(rate(res(5000), res(300)), rate(res(5000), res(300)), { GITHUB_ACTIONS: "true" });
    expect(K.mitKontingent("board-takt", u.opts).ok).toBe(true);
    expect(u.exit()).toBeUndefined();
    expect(u.ausgaben.join("")).toMatch(/^::warning::/);
    u.handler.forEach((f) => f());
    expect(u.ausgaben.join("")).toContain("::notice title=gh-Kosten::");
    expect(u.logZeilen).toHaveLength(0);
  });
  test("Lesefehler: fail-open, Lauf geht weiter, keine Logzeile", () => {
    const u = umgebung(new Error("rate limit exceeded"), new Error("x"));
    expect(K.mitKontingent("board-place", u.opts).ok).toBe(true);
    expect(u.exit()).toBeUndefined();
    expect(u.handler).toHaveLength(0);
    expect(u.ausgaben.join("")).toContain("nicht lesbar");
  });
  test("zweites Lesen im Exit-Handler scheitert: der Handler wirft nie, keine Logzeile", () => {
    const u = umgebung(rate(res(4000), res(4000)), new Error("netz weg"));
    expect(K.mitKontingent("board-place", u.opts).ok).toBe(true);
    expect(u.handler).toHaveLength(1);
    expect(() => u.handler.forEach((f) => f())).not.toThrow();
    expect(u.logZeilen).toHaveLength(0);
  });
  test("lesbare, aber unbrauchbare Antwort: Warnung, Lauf geht weiter, Handler ist registriert", () => {
    const u = umgebung({}, {});
    expect(K.mitKontingent("board-place", u.opts).ok).toBe(true);
    expect(u.ausgaben.join("")).toContain("nicht lesbar");
    expect(u.handler).toHaveLength(1);
  });
  test("Nachmessung im Exit-Handler hat ein kürzeres Timeout als die Vorab-Prüfung", () => {
    const u = umgebung(rate(res(4000), res(4000)), rate(res(4000), res(4000)));
    K.mitKontingent("board-place", u.opts);
    u.handler.forEach((f) => f());
    expect(u.timeouts).toEqual([15_000, 5_000]);
  });
  test("token wird an beide Lesevorgänge durchgereicht", () => {
    const u = umgebung(rate(res(4000), res(4000)), rate(res(4000), res(4000)), {});
    K.mitKontingent("board-takt", { ...u.opts, token: "PAT" });
    u.handler.forEach((f) => f());
    expect(u.tokens).toEqual(["PAT", "PAT"]);
  });
  test("arten: [core] ignoriert ein knappes graphql, prüft core weiter", () => {
    const u = umgebung(rate(res(4000), res(10)), rate(res(4000), res(10)));
    expect(K.mitKontingent("naechstes-ticket", { ...u.opts, arten: ["core"] }).ok).toBe(true);
    expect(u.exit()).toBeUndefined();
    const v = umgebung(rate(res(10), res(4000)), rate(res(10), res(4000)));
    expect(K.mitKontingent("naechstes-ticket", { ...v.opts, arten: ["core"] }).ok).toBe(false);
    expect(v.exit()).toBe(3);
  });
});

describe("Verdrahtung: die vier Board-Skripte prüfen das Kontingent vorab", () => {
  test.each(["board-place", "naechstes-ticket", "sammelticket-anlegen", "board-takt"])("%s importiert und ruft mitKontingent auf", (name) => {
    const text = readFileSync(join(process.cwd(), "scripts", `${name}.mjs`), "utf8");
    expect(text).toMatch(/import \{ mitKontingent \} from "\.\/kontingent-lib\.mjs";/);
    expect(text).toContain(`mitKontingent("${name}"`);
  });
  test("naechstes-ticket prüft nur core (REST-only), kein anderes Skript schränkt die Arten ein", () => {
    const lies = (n: string) => readFileSync(join(process.cwd(), "scripts", `${n}.mjs`), "utf8");
    expect(lies("naechstes-ticket")).toContain('mitKontingent("naechstes-ticket", { arten: ["core"] })');
    for (const n of ["board-place", "sammelticket-anlegen", "board-takt"]) expect(lies(n)).not.toMatch(/mitKontingent\([^)]*arten/);
  });
});

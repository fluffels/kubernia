/* GitHub-API-Kontingent (#1549 Z1): Vorab-Prüfung, Kostenmessung je Skriptlauf, Bericht. */
import { describe, expect, test } from "vitest";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as raw from "../scripts/gh-kontingent.mjs";

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
    const ausgaben: string[] = [];
    const logZeilen: string[] = [];
    const handler: Array<() => void> = [];
    let exitCode: number | undefined;
    const opts = {
      exec: (_c: string, args: string[]) => {
        aufrufe.push(args);
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
    return { opts, aufrufe, ausgaben, logZeilen, handler, exit: () => exitCode };
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
    u.handler.forEach((f) => f());
    expect(u.logZeilen).toHaveLength(0);
  });
});

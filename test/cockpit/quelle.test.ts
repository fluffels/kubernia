/* Quellen-Vertrag des Cockpits (#1764): Form, parallele Abfrage mit Frist, TTL, Ausfall ohne alte Werte, keine zentrale Fallunterscheidung. */
import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as rawQuelle from "../../scripts/cockpit/quelle.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as rawSeite from "../../scripts/cockpit/seite.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as rawRegistry from "../../scripts/cockpit/registry.mjs";

interface Ctx { jetzt: () => number; signal: AbortSignal }
interface Ergebnis { status: string; stand: number; daten: Record<string, unknown> | null; grund: string | null }
interface Quelle { id: string; titel: string; ttlMs: number; sammeln: (ctx: Ctx) => unknown }
interface Panel { id: string; titel: string; ergebnis: Ergebnis; zuletztOk: number | null }
interface QuelleApi {
  pruefeQuellen: (l: unknown) => void;
  pruefeErgebnis: (e: unknown) => string | null;
  ok: (d: Record<string, unknown>, c: { jetzt: () => number }) => Ergebnis;
  ausfall: (g: string, c: { jetzt: () => number }) => Ergebnis;
  erzeugeAbruf: (o: { quellen: Quelle[]; timeoutMs?: number; jetzt?: () => number }) => () => Promise<Panel[]>;
}
interface SeiteApi { renderSeite: (o: { panels: Panel[]; jetzt: number; projekt: string }) => string; formatZeit: (ms: number) => string }
const { pruefeQuellen, pruefeErgebnis, ok, ausfall, erzeugeAbruf } = rawQuelle as unknown as QuelleApi;
const { renderSeite, formatZeit } = rawSeite as unknown as SeiteApi;
const { QUELLEN } = rawRegistry as unknown as { QUELLEN: Quelle[] };

function uhr(start = 1_000_000) {
  const z = { t: start };
  return { z, jetzt: () => z.t };
}
const quelle = (sammeln: Quelle["sammeln"], extra: Partial<Quelle> = {}): Quelle => ({ id: "q", titel: "Q", ttlMs: 1000, sammeln, ...extra });

describe("Abruf", () => {
  test("gültiges ok erscheint im Panel", async () => {
    const u = uhr();
    const sammle = erzeugeAbruf({ quellen: [quelle((c) => ok({ Wert: 1 }, c))], jetzt: u.jetzt });
    const [p] = await sammle();
    expect(p.ergebnis).toEqual({ status: "ok", stand: u.z.t, daten: { Wert: 1 }, grund: null });
    expect(p.zuletztOk).toBe(u.z.t);
  });

  test("TTL: innerhalb ein Aufruf, nach Ablauf ein neuer", async () => {
    const u = uhr();
    let n = 0;
    const sammle = erzeugeAbruf({ quellen: [quelle((c) => ok({ n: ++n }, c), { ttlMs: 1000 })], jetzt: u.jetzt });
    await sammle();
    u.z.t += 999;
    await sammle();
    expect(n).toBe(1);
    u.z.t += 1;
    await sammle();
    expect(n).toBe(2);
  });

  test("parallel: beide Quellen starten, bevor eine endet", async () => {
    const gestartet: string[] = [];
    const frei: (() => void)[] = [];
    const warte = (id: string): Quelle => ({
      id,
      titel: id,
      ttlMs: 1000,
      sammeln: (c) => new Promise((res) => {
        gestartet.push(id);
        frei.push(() => res(ok({}, c)));
      }),
    });
    const lauf = erzeugeAbruf({ quellen: [warte("a"), warte("b")] })();
    await new Promise((r) => setTimeout(r, 10));
    expect(gestartet).toEqual(["a", "b"]);
    frei.forEach((f) => f());
    expect(await lauf).toHaveLength(2);
  });

  test("Dedupe: zwei gleichzeitige Abrufe rufen sammeln einmal", async () => {
    let n = 0;
    const sammle = erzeugeAbruf({ quellen: [quelle(async (c) => { n++; await new Promise((r) => setTimeout(r, 10)); return ok({}, c); })] });
    await Promise.all([sammle(), sammle()]);
    expect(n).toBe(1);
  });

  test("Wurf wird zum Ausfall", async () => {
    const [p] = await erzeugeAbruf({ quellen: [quelle(() => { throw new Error("boom"); })] })();
    expect(p.ergebnis).toMatchObject({ status: "ausfall", daten: null, grund: "Fehler: boom" });
  });

  test.each([
    ["String", "boom", "Fehler: boom"],
    ["null", null, "Fehler: null"],
  ])("Wurf eines Nicht-Error-Werts (%s) wird zum Ausfall statt zum Abbruch des Abrufs", async (_n, wert, grund) => {
    // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- genau der Nicht-Error-Wert ist der Testgegenstand
    const [p] = await erzeugeAbruf({ quellen: [quelle(() => new Promise((_, nein) => nein(wert)))] })();
    expect(p.ergebnis).toMatchObject({ status: "ausfall", daten: null, grund });
  });

  test("Timeout wird zum Ausfall und bricht per Signal ab", async () => {
    let signal: AbortSignal | undefined;
    const [p] = await erzeugeAbruf({ quellen: [quelle((c) => { signal = c.signal; return new Promise(() => undefined); })], timeoutMs: 20 })();
    expect(p.ergebnis).toMatchObject({ status: "ausfall", daten: null, grund: "Timeout nach 20 ms" });
    expect(signal?.aborted).toBe(true);
  });

  test.each([
    ["null", null],
    ["unbekannter status", { status: "vielleicht", stand: 1, daten: null, grund: "x" }],
    ["ok ohne stand", { status: "ok", daten: {}, grund: null }],
    ["ok mit daten null", { status: "ok", stand: 1, daten: null, grund: null }],
    ["ausfall mit daten", { status: "ausfall", stand: 1, daten: {}, grund: "x" }],
    ["ausfall ohne grund", { status: "ausfall", stand: 1, daten: null, grund: null }],
    ["ok mit grund", { status: "ok", stand: 1, daten: {}, grund: "x" }],
    ["ok mit daten als String", { status: "ok", stand: 1, daten: "x", grund: null }],
    ["ausfall mit leerem grund", { status: "ausfall", stand: 1, daten: null, grund: "" }],
  ])("ungültige Form (%s) ist ein Ausfall", async (_n, form) => {
    expect(pruefeErgebnis(form)).not.toBeNull();
    const [p] = await erzeugeAbruf({ quellen: [quelle(() => form)] })();
    expect(p.ergebnis.status).toBe("ausfall");
    expect(p.ergebnis.daten).toBeNull();
    expect(p.ergebnis.grund).toMatch(/^Ungültiges Ergebnis: /);
  });

  test("gültige Formen bleiben gültig", () => {
    const c = { jetzt: () => 5 };
    expect(pruefeErgebnis(ok({ a: 1 }, c))).toBeNull();
    expect(pruefeErgebnis(ausfall("weg", c))).toBeNull();
  });
});

describe("Ausfall-Anzeige ohne alte Werte", () => {
  test("erst ok, nach TTL Wurf: kein alter Wert, zuletzt ok mit Zeit", async () => {
    const u = uhr(new Date(2026, 9, 21, 10, 0, 0).getTime());
    let n = 0;
    const q = quelle((c) => { if (n++ === 0) return ok({ Geheim: "ALTWERT" }, c); throw new Error("weg"); });
    const sammle = erzeugeAbruf({ quellen: [q], jetzt: u.jetzt });
    const erstes = u.z.t;
    await sammle();
    u.z.t += 5000;
    const panels = await sammle();
    const html = renderSeite({ panels, jetzt: u.z.t, projekt: "p" });
    expect(html).not.toContain("ALTWERT");
    expect(html).toContain(`Ausfall: Fehler: weg, zuletzt ok ${formatZeit(erstes)}`);
  });

  test("ohne bisheriges ok: zuletzt ok nie", async () => {
    const panels = await erzeugeAbruf({ quellen: [quelle(() => { throw new Error("weg"); })] })();
    expect(renderSeite({ panels, jetzt: 1, projekt: "p" })).toContain("Ausfall: Fehler: weg, zuletzt ok nie");
  });
});

describe("pruefeQuellen", () => {
  const gut = (extra: Partial<Quelle>) => [{ id: "a", titel: "A", ttlMs: 1, sammeln: () => ok({}, { jetzt: () => 0 }), ...extra }];
  test.each([
    ["doppelte id", [...gut({}), ...gut({})]],
    ["ttlMs 0", gut({ ttlMs: 0 })],
    ["ttlMs -1", gut({ ttlMs: -1 })],
    ["ttlMs NaN", gut({ ttlMs: NaN })],
    ["sammeln fehlt", gut({ sammeln: undefined })],
    ["leerer Titel", gut({ titel: " " })],
    ["id fehlt", gut({ id: "" })],
  ])("wirft bei %s", (_n, liste) => {
    expect(() => pruefeQuellen(liste)).toThrow();
  });
  test("die echte Registry ist gültig", () => {
    expect(() => pruefeQuellen(QUELLEN)).not.toThrow();
  });
});

describe("keine zentrale Fallunterscheidung über Quellen", () => {
  test("eine fremde Quelle läuft ohne Codeänderung durch Abruf und Rendern", async () => {
    const fremd = quelle((c) => ok({ Neu: "da" }, c), { id: "fremd-xyz", titel: "Fremde Quelle" });
    const panels = await erzeugeAbruf({ quellen: [fremd] })();
    const html = renderSeite({ panels, jetzt: 1, projekt: "p" });
    expect(html).toContain("Fremde Quelle");
    expect(html).toContain("<dd>da</dd>");
  });

  // Grenze: geschlossene Liste der Cockpit-Dateien, die Quellen verarbeiten; sucht die Muster und die ids der Registry.
  test.each(["server.mjs", "seite.mjs", "quelle.mjs"])("%s enthält weder switch noch case noch eine Quellen-id", (datei) => {
    const text = readFileSync(fileURLToPath(new URL(`../../scripts/cockpit/${datei}`, import.meta.url)), "utf8");
    expect(text).not.toMatch(/switch\s*\(/);
    expect(text).not.toMatch(/case\s+["']/);
    for (const q of QUELLEN) expect(text).not.toContain(`"${q.id}"`);
  });
});

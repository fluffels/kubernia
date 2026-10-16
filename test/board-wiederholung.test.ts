import { describe, expect, test } from "vitest";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as raw from "../scripts/board-lib.mjs";

type Opts = { versuche?: number; pausenMs?: number[]; istVoruebergehend?: (e: Error) => boolean; schlafe?: (ms: number) => Promise<void> };
const lib = raw as unknown as {
  mitWiederholung: <T>(fn: (versuch: number) => Promise<T> | T, o?: Opts) => Promise<T>;
  istVoruebergehend: (e: unknown) => boolean;
  wirklichFehlend: (restFehlend: number[], graphqlGefunden: ({ number: number } | null)[]) => number[];
};

const wurf = (msg: string) => new Error(msg);
const pausenSpy = () => {
  const pausen: number[] = [];
  return { pausen, schlafe: (ms: number) => { pausen.push(ms); return Promise.resolve(); } };
};

describe("mitWiederholung (#1628 L27/L30)", () => {
  test("Erfolg im 3. Versuch: zwei Pausen, Ergebnis kommt zurück", async () => {
    const s = pausenSpy();
    let n = 0;
    const r = await lib.mitWiederholung(() => {
      n++;
      if (n < 3) throw wurf("Could not resolve to a node with the global id 'X'");
      return "ok";
    }, { schlafe: s.schlafe });
    expect(r).toBe("ok");
    expect(n).toBe(3);
    expect(s.pausen).toEqual([5000, 10000]);
  });
  test("vier Fehlschläge: wirft den letzten Fehler, drei Pausen, genau vier Versuche", async () => {
    const s = pausenSpy();
    let n = 0;
    await expect(lib.mitWiederholung(() => { n++; throw wurf(`Could not resolve to a node #${n}`); }, { schlafe: s.schlafe })).rejects.toThrow("#4");
    expect(n).toBe(4);
    expect(s.pausen).toEqual([5000, 10000, 20000]);
  });
  test("nicht vorübergehender Fehler (Rate-Limit) wirft sofort, ohne Pause", async () => {
    const s = pausenSpy();
    let n = 0;
    await expect(lib.mitWiederholung(() => { n++; throw wurf("API rate limit exceeded"); }, { schlafe: s.schlafe })).rejects.toThrow("rate limit");
    expect(n).toBe(1);
    expect(s.pausen).toEqual([]);
  });
  test("mehr Versuche als Pausen: die letzte Pause wird wiederholt", async () => {
    const s = pausenSpy();
    let n = 0;
    await expect(lib.mitWiederholung(() => { n++; throw wurf("Could not resolve to a node"); }, { versuche: 5, pausenMs: [1, 2, 3], schlafe: s.schlafe })).rejects.toThrow();
    expect(n).toBe(5);
    expect(s.pausen).toEqual([1, 2, 3, 3]);
  });
  test("ein erster Erfolg braucht keine Pause", async () => {
    const s = pausenSpy();
    expect(await lib.mitWiederholung(() => 7, { schlafe: s.schlafe })).toBe(7);
    expect(s.pausen).toEqual([]);
  });
  test("istVoruebergehend ist überschreibbar", async () => {
    const s = pausenSpy();
    let n = 0;
    await lib.mitWiederholung(() => { if (++n < 2) throw wurf("egal"); }, { schlafe: s.schlafe, istVoruebergehend: () => true });
    expect(n).toBe(2);
  });
  test("istVoruebergehend: Knoten-Race und frisches Issue (Meldung aus board-place) ja; Rate-Limit, Benutzungsfehler, Notfall-Marker nein", () => {
    expect(lib.istVoruebergehend(wurf("Could not resolve to a node with the global id"))).toBe(true);
    expect(lib.istVoruebergehend(wurf("Nicht im Board gefunden (auch nicht per GraphQL): #5"))).toBe(true);
    expect(lib.istVoruebergehend(wurf("API rate limit exceeded"))).toBe(false);
    expect(lib.istVoruebergehend(wurf("Aufruf: board-place.mjs"))).toBe(false);
    expect(lib.istVoruebergehend(wurf("Notfall-Marker fehlt im Titel"))).toBe(false);
    // Rate-Limit gewinnt, auch wenn die Meldung zugleich den Knoten-Text trägt.
    expect(lib.istVoruebergehend(wurf("rate limit: Could not resolve to a node"))).toBe(false);
  });
});

describe("wirklichFehlend (#1628 L30 Z2)", () => {
  test("ein REST-Fehlalarm, den GraphQL findet, wird nicht gemeldet", () => {
    expect(lib.wirklichFehlend([5, 6], [{ number: 5 }, null])).toEqual([6]);
  });
  test("GraphQL findet nichts: alle bleiben, aufsteigend", () => {
    expect(lib.wirklichFehlend([9, 3], [null, null])).toEqual([3, 9]);
  });
  test("alles gefunden oder nichts angefragt: leer", () => {
    expect(lib.wirklichFehlend([], [])).toEqual([]);
    expect(lib.wirklichFehlend([4], [{ number: 4 }])).toEqual([]);
  });
});

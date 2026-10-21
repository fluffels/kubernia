import { describe, expect, test } from "vitest";
// @ts-expect-error: kein .d.ts
import * as flagLib from "../scripts/flag-lib.mjs";

interface Ergebnis {
  werte: Record<string, unknown>;
  positionale: string[];
  tokens: unknown[];
  fehler: { art: string; flag: string; text: string } | null;
}
const { AUFRUF_EXIT, flagsLesen } = flagLib as unknown as {
  AUFRUF_EXIT: number;
  flagsLesen: (argv: string[], optionen: Record<string, unknown>, opt?: Record<string, unknown>) => Ergebnis;
};

type Opt = Record<string, { type: "string" | "boolean"; multiple?: boolean }>;
const OPT: Opt = { a: { type: "string" }, b: { type: "string" }, json: { type: "boolean" }, s: { type: "string", multiple: true } };
const lies = (argv: string[], extra: Record<string, unknown> = {}): Ergebnis => flagsLesen(argv, OPT, extra);
const art = (argv: string[], extra: Record<string, unknown> = {}) => {
  const f = lies(argv, extra).fehler;
  return f === null ? null : `${f.art}|${f.flag}`;
};

describe("flagsLesen", () => {
  test("AUFRUF_EXIT ist 2", () => expect(AUFRUF_EXIT).toBe(2));

  test("liest Werte, Boolean, --flag=wert und negative Zahlen", () => {
    const r = lies(["--a", "x", "--b=-5", "--json"]);
    expect(r.fehler).toBeNull();
    expect(r.werte).toEqual({ a: "x", b: "-5", json: true });
    for (const [argv, wert] of [[["--a", "-5"], "-5"], [["--a=--b"], "--b"], [["--a", ""], ""]] as [string[], string][]) {
      const l = lies(argv);
      expect(l.fehler).toBeNull();
      expect(l.werte.a).toBe(wert);
    }
  });

  test("werte ist ein flaches Objekt, tokens und positionale werden durchgereicht", () => {
    const r = lies(["--a", "x"], { positionale: true });
    expect(Object.getPrototypeOf(r.werte)).toBe(Object.prototype);
    expect(r.tokens).toHaveLength(1);
    expect(lies(["p", "--a", "x", "--", "q"], { positionale: true }).positionale).toEqual(["p", "q"]);
  });

  test("unbekannt: Roh-Argument, auch --x=1, Boolean mit Wert und Prototyp-Namen", () => {
    expect(art(["--x"])).toBe("unbekannt|--x");
    expect(art(["--x=1"])).toBe("unbekannt|--x=1");
    expect(art(["--json=x"])).toBe("unbekannt|--json=x");
    expect(art(["--constructor"])).toBe("unbekannt|--constructor");
    expect(art(["--toString", "x"])).toBe("unbekannt|--toString");
  });

  test("ohne-wert: am Ende, vor Flag, vor Terminator, leerer Inline-Wert", () => {
    expect(art(["--a"])).toBe("ohne-wert|--a");
    expect(art(["--a", "--b", "x"])).toBe("ohne-wert|--a");
    expect(art(["--a", "--json"])).toBe("ohne-wert|--a");
    expect(art(["--a", "--"])).toBe("ohne-wert|--a");
    expect(art(["--a="])).toBe("ohne-wert|--a");
  });

  test("doppelt: String und Boolean, multiple erlaubt Wiederholung", () => {
    expect(art(["--a", "1", "--a", "2"])).toBe("doppelt|--a");
    expect(art(["--json", "--json"])).toBe("doppelt|--json");
    const r = lies(["--s", "1", "--s=2"]);
    expect(r.fehler).toBeNull();
    expect(r.werte.s).toEqual(["1", "2"]);
  });

  test("positional: Standard Fehler (auch nach Terminator), mit positionale: true erlaubt, Terminator allein ok", () => {
    expect(art(["x"])).toBe("positional|x");
    expect(art(["--", "y"])).toBe("positional|y");
    expect(art(["--"])).toBeNull();
    expect(art(["x"], { positionale: true })).toBeNull();
  });

  test("fehlt: pflicht in Reihenfolge, nur ohne Token-Fehler", () => {
    expect(art([], { pflicht: ["a", "b"] })).toBe("fehlt|--a");
    expect(art(["--a", "1"], { pflicht: ["a", "b"] })).toBe("fehlt|--b");
    expect(art(["--a", "1", "--b", "2"], { pflicht: ["a", "b"] })).toBeNull();
    expect(art(["--x"], { pflicht: ["a"] })).toBe("unbekannt|--x");
    expect(() => flagsLesen([], OPT, { pflicht: ["nope"] })).toThrow(/nope/);
  });

  test("der erste Fehler in Argumentreihenfolge gewinnt", () => {
    expect(art(["--x", "--a"])).toBe("unbekannt|--x");
    expect(art(["--a", "--x"])).toBe("ohne-wert|--a");
    expect(art(["--json", "--json", "--x"])).toBe("doppelt|--json");
  });

  test("Standardtexte und Überschreibung per meldung", () => {
    const text = (argv: string[], extra: Record<string, unknown> = {}) => lies(argv, extra).fehler?.text;
    expect(text(["--x"])).toBe("Unbekanntes Argument: --x");
    expect(text(["p"])).toBe("Unbekanntes Argument: p");
    expect(text(["--a"])).toBe("--a braucht einen Wert");
    expect(text(["--json", "--json"])).toBe("--json ist doppelt angegeben");
    expect(text([], { pflicht: ["a"] })).toBe("--a fehlt");
    const meldung = (a: string, f: string) => (a === "ohne-wert" ? `eigen ${f}` : undefined);
    expect(text(["--a"], { meldung })).toBe("eigen --a");
    expect(text(["--x"], { meldung })).toBe("Unbekanntes Argument: --x");
  });

  test("meldung als Objekt: Text oder Funktion je Art, fehlende Art bleibt Standard", () => {
    const text = (argv: string[], meldung: Record<string, unknown>, extra: Record<string, unknown> = {}) => lies(argv, { meldung, ...extra }).fehler?.text;
    const karte = { "ohne-wert": "eigener Text", unbekannt: (flag: string) => `fremd ${flag}` };
    expect(text(["--a"], karte)).toBe("eigener Text");
    expect(text(["--x"], karte)).toBe("fremd --x");
    expect(text(["--json", "--json"], karte)).toBe("--json ist doppelt angegeben");
    expect(text([], karte, { pflicht: ["a"] })).toBe("--a fehlt");
    // Negativfall: ein Objekt ohne die Art fällt nie auf Prototyp-Schlüssel zurück.
    expect(text(["--a"], {})).toBe("--a braucht einen Wert");
    expect(text(["--a"], Object.create({ "ohne-wert": "geerbt" }) as Record<string, unknown>)).toBe("--a braucht einen Wert");
  });
});

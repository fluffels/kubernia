import { describe, expect, test } from "vitest";
// @ts-expect-error: kein .d.ts
import * as flagLib from "../scripts/flag-lib.mjs";

interface Ergebnis {
  werte: Record<string, unknown>;
  positionale: string[];
  tokens: unknown[];
  fehler: { art: string; flag: string; text: string } | null;
}
interface BefehlErgebnis {
  befehl?: string;
  werte?: Record<string, unknown>;
  positionale?: string[];
  fehler: { art: string; flag: string | undefined; text: string } | null;
}
interface Aufruf {
  code: number;
  out: string;
  err: string;
}
const { AUFRUF_EXIT, flagsLesen, befehlLesen, direktaufruf } = flagLib as unknown as {
  AUFRUF_EXIT: number;
  flagsLesen: (argv: string[], optionen: Record<string, unknown>, opt?: Record<string, unknown>) => Ergebnis;
  befehlLesen: (argv: string[], befehle: Record<string, unknown>, opt?: Record<string, unknown>) => BefehlErgebnis;
  direktaufruf: (argv: string[], teile: Record<string, unknown>) => Aufruf;
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
    expect(lies(["p", "--a", "x", "q"], { positionale: true }).positionale).toEqual(["p", "q"]);
  });

  test("terminator: `--` wird zentral abgelehnt (auch mit positionale, vor Wert-Fehlern danach, nie als Wert)", () => {
    expect(art(["--"])).toBe("terminator|--");
    expect(art(["--", "y"])).toBe("terminator|--");
    expect(art(["p", "--", "q"], { positionale: true })).toBe("terminator|--");
    expect(art(["--a", "x", "--"])).toBe("terminator|--");
    expect(art(["--x", "--"])).toBe("unbekannt|--x"); // erster Fehler gewinnt
    expect(art(["--", "--x"])).toBe("terminator|--");
    expect(lies(["--"]).fehler?.text).toBe("Unbekanntes Argument: --");
    expect(lies(["--"], { meldung: { terminator: "eigen" } }).fehler?.text).toBe("eigen");
    expect(art(["--x="])).toBe("unbekannt|--x=");
    expect(art([])).toBeNull();
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

  test("positional: Standard Fehler, mit positionale: true erlaubt", () => {
    expect(art(["x"])).toBe("positional|x");
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

const BEFEHLE = {
  zeige: { optionen: { pr: { type: "string" } }, positionale: 1 },
  leer: { optionen: {}, positionale: 0 },
  viele: { optionen: {}, positionale: 2 },
};
const befehl = (argv: string[], extra: Record<string, unknown> = {}) => befehlLesen(argv, BEFEHLE, extra);

describe("befehlLesen", () => {
  test("liest Befehl, Werte und Positionale", () => {
    const r = befehl(["zeige", "7", "--pr", "3"]);
    expect(r.fehler).toBeNull();
    expect(r.befehl).toBe("zeige");
    expect(r.werte).toEqual({ pr: "3" });
    expect(r.positionale).toEqual(["7"]);
    expect(befehl(["zeige"]).positionale).toEqual([]);
    expect(befehl(["viele", "a", "b"]).fehler).toBeNull();
  });

  test("befehl: leeres argv, unbekannter Name, Prototyp-Name, Flag als Befehl", () => {
    expect(befehl([]).fehler).toEqual({ art: "befehl", flag: undefined, text: "unbekannter Befehl (keiner)" });
    expect(befehl(["x"]).fehler).toEqual({ art: "befehl", flag: "x", text: "unbekannter Befehl „x“" });
    expect(befehl(["toString"]).fehler?.art).toBe("befehl");
    expect(befehl(["--pr", "1"]).fehler?.text).toBe("unbekannter Befehl „--pr“");
    expect(befehl(["--"]).fehler?.art).toBe("befehl");
  });

  test("positional: mehr als die Höchstzahl, bei 0 über den Flag-Leser", () => {
    expect(befehl(["zeige", "7", "8"]).fehler).toEqual({ art: "positional", flag: "8", text: "Unbekanntes Argument: 8" });
    expect(befehl(["viele", "a", "b", "c"]).fehler?.text).toBe("Unbekanntes Argument: c");
    expect(befehl(["leer", "x"]).fehler).toEqual({ art: "positional", flag: "x", text: "Unbekanntes Argument: x" });
  });

  test("Flag-Fehler des Befehls und Terminator kommen durch", () => {
    expect(befehl(["zeige", "--bogus"]).fehler?.art).toBe("unbekannt");
    expect(befehl(["zeige", "--pr"]).fehler?.text).toBe("--pr braucht einen Wert");
    expect(befehl(["zeige", "--", "7"]).fehler?.art).toBe("terminator");
    expect(befehl(["leer", "--"]).fehler?.text).toBe("Unbekanntes Argument: --");
  });

  test("meldung überschreibt befehl und positional, wie bei flagsLesen", () => {
    const meldung = { befehl: (n: string | undefined) => `kein ${n}`, positional: "zu viel" };
    expect(befehl(["x"], { meldung }).fehler?.text).toBe("kein x");
    expect(befehl(["zeige", "1", "2"], { meldung }).fehler?.text).toBe("zu viel");
    expect(befehl(["zeige", "--pr"], { meldung }).fehler?.text).toBe("--pr braucht einen Wert");
  });
});

describe("direktaufruf", () => {
  function teile(fehlerhaft: boolean) {
    const log: string[] = [];
    const ausgabe = { out: [] as string[], err: [] as string[], exit: [] as number[] };
    const t = {
      pruefe: (argv: string[]) => (fehlerhaft ? { fehler: `schlecht ${argv.join(" ")}` } : {}),
      fehlerErgebnis: (_argv: string[], vorab: { fehler: string }) => ({ code: 2, out: "", err: `✖ ${vorab.fehler}\n` }),
      vorbereiten: () => log.push("vorbereiten"),
      io: () => {
        log.push("io");
        return { x: 1 };
      },
      fuehreAus: (_argv: string[], io: unknown) => {
        log.push(`aus:${JSON.stringify(io)}`);
        return { code: 0, out: "o\n", err: "e\n" };
      },
      ausgabe: { out: (s: string) => ausgabe.out.push(s), err: (s: string) => ausgabe.err.push(s), exit: (c: number) => ausgabe.exit.push(c) },
    };
    return { t, log, ausgabe };
  }

  test("Erfolg: vorbereiten, io, fuehreAus in der Reihenfolge; Ausgabe und Exit", () => {
    const { t, log, ausgabe } = teile(false);
    expect(direktaufruf(["a"], t)).toEqual({ code: 0, out: "o\n", err: "e\n" });
    expect(log).toEqual(["vorbereiten", "io", 'aus:{"x":1}']);
    expect(ausgabe).toEqual({ out: ["o\n"], err: ["e\n"], exit: [0] });
  });

  test("Aufruf-Fehler: weder vorbereiten noch io, fuehreAus läuft nicht", () => {
    const { t, log, ausgabe } = teile(true);
    expect(direktaufruf(["a", "b"], t)).toEqual({ code: 2, out: "", err: "✖ schlecht a b\n" });
    expect(log).toEqual([]);
    expect(ausgabe).toEqual({ out: [""], err: ["✖ schlecht a b\n"], exit: [2] });
  });

  test("leeres argv ist ein normaler Aufruf an pruefe; io darf ein Objekt sein; vorbereiten ist optional", () => {
    const { t } = teile(false);
    const { vorbereiten: _v, ...ohne } = t;
    const r = direktaufruf([], { ...ohne, io: { y: 2 } });
    expect(r.code).toBe(0);
  });
});

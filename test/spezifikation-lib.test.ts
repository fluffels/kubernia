/* Spezifikations-Gate (#1615, ADR 0022 F12): pure Prüffunktion; jeder Mangel mit Negativfall. */
import { describe, expect, test } from "vitest";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as raw from "../scripts/spezifikation-lib.mjs";

type Art = { art: "ausgenommen" | "ok" | "bestand" | "hart"; fehlt?: string[] };
const S = raw as unknown as {
  spezifikationsMaengel: (body: unknown) => string[];
  istEpicTitel: (titel: unknown) => boolean;
  pruefeEingang: (i: { nummer: number; titel: string; body: unknown }, o?: { ausgenommen?: (i: unknown) => boolean; hartAb?: number }) => Art;
  verloreneZeilen: (alt: unknown, neu: unknown) => string[];
};

const GUT = "## Ziel\nDas Gate prüft.\n\n## Akzeptanzkriterien\n1. Es prüft.\n2. Negativfall: ohne Format wird übersprungen.\n";

describe("spezifikationsMaengel", () => {
  test("vollständig: keine Mängel", () => {
    expect(S.spezifikationsMaengel(GUT)).toEqual([]);
  });
  test("leerer, null und undefined Body: Ziel und Akzeptanzkriterien fehlen", () => {
    for (const b of ["", null, undefined]) {
      expect(S.spezifikationsMaengel(b)).toEqual(["`## Ziel` fehlt", "`## Akzeptanzkriterien` fehlt"]);
    }
  });
  test("Ziel fehlt", () => {
    expect(S.spezifikationsMaengel("## Akzeptanzkriterien\n- Negativfall: x\n")).toEqual(["`## Ziel` fehlt"]);
  });
  test("Ziel leer", () => {
    expect(S.spezifikationsMaengel("## Ziel\n\n## Akzeptanzkriterien\n- Negativfall: x\n")).toEqual(["`## Ziel` ist leer"]);
  });
  test("Akzeptanzkriterien ohne Listenpunkt", () => {
    expect(S.spezifikationsMaengel("## Ziel\nZ\n## Akzeptanzkriterien\nNegativfall im Fließtext\n")).toEqual(["`## Akzeptanzkriterien` ohne Listenpunkt"]);
  });
  test("kein Negativfall in den Akzeptanzkriterien", () => {
    const m = S.spezifikationsMaengel("## Ziel\nZ\n## Akzeptanzkriterien\n- nur Happy Path\n");
    expect(m).toHaveLength(1);
    expect(m[0]).toContain("kein Negativfall");
  });
  test("„Negativfall“ nur unter `## Ziel` ist ein Mangel", () => {
    const m = S.spezifikationsMaengel("## Ziel\nNegativfall hier\n## Akzeptanzkriterien\n- Happy\n");
    expect(m.some((x) => x.includes("kein Negativfall"))).toBe(true);
  });
  test("Schreibweisen Negativ-Fall und Negativfälle zählen", () => {
    expect(S.spezifikationsMaengel("## Ziel\nZ\n## Akzeptanzkriterien\n* Negativ-Fall: a\n")).toEqual([]);
    expect(S.spezifikationsMaengel("## Ziel\nZ\n## Akzeptanzkriterien\n- Negativfälle: a\n")).toEqual([]);
  });
  test("zu breites Wort zählt nicht: „negativ“ ohne „Fall“ ist kein Negativfall", () => {
    const m = S.spezifikationsMaengel("## Ziel\nZ\n## Akzeptanzkriterien\n- Negativer Saldo wird angezeigt\n- negative Zahl abgelehnt\n");
    expect(m).toHaveLength(1);
    expect(m[0]).toContain("kein Negativfall");
  });
  test("`## Teil-Akzeptanzkriterien` (gebündelte Befund-Issues) gilt als Akzeptanzkriterien", () => {
    expect(S.spezifikationsMaengel("## Ziel\nZ\n## Teil-Akzeptanzkriterien\n- Negativfall: x\n")).toEqual([]);
    expect(S.spezifikationsMaengel("## Ziel\nZ\n## Teil-Akzeptanzkriterien\n- Happy\n")).toHaveLength(1);
    expect(S.spezifikationsMaengel("## Ziel\nZ\n## Teilakzeptanz\n- Negativfall: x\n")).toContain("`## Akzeptanzkriterien` fehlt");
  });
  test("`## Zielgruppe` und `### Ziel` sind kein `## Ziel`", () => {
    expect(S.spezifikationsMaengel("## Zielgruppe\nX\n## Akzeptanzkriterien\n- Negativfall\n")).toContain("`## Ziel` fehlt");
    expect(S.spezifikationsMaengel("### Ziel\nX\n## Akzeptanzkriterien\n- Negativfall\n")).toContain("`## Ziel` fehlt");
  });
  test("`###` gehört zum Abschnitt: Negativfall und Listenpunkt unter Unterüberschrift zählen", () => {
    expect(S.spezifikationsMaengel("## Ziel\nZ\n## Akzeptanzkriterien\n### Teil\n- Negativfall: a\n")).toEqual([]);
  });
  test("Überschrift im Code-Fence zählt nicht", () => {
    const body = "```\n## Ziel\nZ\n## Akzeptanzkriterien\n- Negativfall\n```\n";
    expect(S.spezifikationsMaengel(body)).toEqual(["`## Ziel` fehlt", "`## Akzeptanzkriterien` fehlt"]);
  });
  test("Negativfall im Code-Fence der Akzeptanzkriterien zählt nicht", () => {
    const body = "## Ziel\nZ\n## Akzeptanzkriterien\n- Happy\n```\n- Negativfall\n```\n";
    expect(S.spezifikationsMaengel(body).some((x) => x.includes("kein Negativfall"))).toBe(true);
  });
  test("CRLF wird toleriert", () => {
    expect(S.spezifikationsMaengel(GUT.replace(/\n/g, "\r\n"))).toEqual([]);
  });
  test("der nächste `## `-Abschnitt beendet die Akzeptanzkriterien", () => {
    const body = "## Ziel\nZ\n## Akzeptanzkriterien\n- Happy\n## Hinweise\n- Negativfall\n";
    expect(S.spezifikationsMaengel(body).some((x) => x.includes("kein Negativfall"))).toBe(true);
  });
});

describe("istEpicTitel", () => {
  test("Epic und Phase, auch mit 📦", () => {
    expect(S.istEpicTitel("📦 Epic: Welt 2")).toBe(true);
    expect(S.istEpicTitel("Epic Foo")).toBe(true);
    expect(S.istEpicTitel("Phase 3: Bau")).toBe(true);
  });
  test("normale Titel nicht", () => {
    expect(S.istEpicTitel("Epische Reise")).toBe(false);
    expect(S.istEpicTitel("feat: Epic später")).toBe(false);
    expect(S.istEpicTitel(undefined)).toBe(false);
  });
});

describe("pruefeEingang", () => {
  const i = (nummer: number, body: unknown = "") => ({ nummer, titel: `T${nummer}`, body });
  test("vollständig: ok", () => {
    expect(S.pruefeEingang(i(5, GUT), { hartAb: 1 })).toEqual({ art: "ok" });
  });
  test("Grenze: nummer === hartAb ist hart, hartAb - 1 ist Bestand", () => {
    expect(S.pruefeEingang(i(10), { hartAb: 10 }).art).toBe("hart");
    expect(S.pruefeEingang(i(9), { hartAb: 10 }).art).toBe("bestand");
    expect(S.pruefeEingang(i(10), { hartAb: 10 }).fehlt).toContain("`## Ziel` fehlt");
  });
  test("Default hartAb 0: alles hart", () => {
    expect(S.pruefeEingang(i(1)).art).toBe("hart");
  });
  test("Ausnahme gewinnt auch bei unvollständigem Body", () => {
    expect(S.pruefeEingang(i(1), { ausgenommen: () => true, hartAb: 0 })).toEqual({ art: "ausgenommen" });
  });
});

describe("verloreneZeilen (Inhaltsverlust beim Reparieren)", () => {
  test("nichts verloren: leere Liste", () => {
    expect(S.verloreneZeilen("Text\nzweite Zeile", "## Ziel\nText\nzweite Zeile\n")).toEqual([]);
  });
  test("verlorene Zeile wird gemeldet", () => {
    expect(S.verloreneZeilen("Alpha\nBeta", "## Ziel\nAlpha\n")).toEqual(["Beta"]);
  });
  test("ergänzte Listenzeichen und Checkboxen sind kein Verlust", () => {
    expect(S.verloreneZeilen("Alpha\n[ ] Beta\n1. Gamma", "- Alpha\n- [x] Beta\n* Gamma")).toEqual([]);
  });
  test("Überschrift des Alten zählt nicht, eine umbenannte verliert nichts", () => {
    expect(S.verloreneZeilen("## Alt\nAlpha", "## Neu\nAlpha")).toEqual([]);
  });
  test("„Akzeptanzkriterien:“ wird zur Überschrift", () => {
    expect(S.verloreneZeilen("Akzeptanzkriterien:\n- Eins", "## Akzeptanzkriterien\n- Eins")).toEqual([]);
  });
  test("Überschrift des neuen Bodys zählt als Treffer für eine Textzeile", () => {
    expect(S.verloreneZeilen("Ziel", "## Ziel\nx")).toEqual([]);
  });
  test("CRLF und LF sind gleich", () => {
    expect(S.verloreneZeilen("A\r\nB", "A\nB")).toEqual([]);
  });
  test("Code-Fence-Inhalt zählt", () => {
    expect(S.verloreneZeilen("```\nnode x\n```", "## Ziel\nnichts")).toEqual(["node x"]);
  });
  test("null und undefined als alter Body: nichts verloren", () => {
    expect(S.verloreneZeilen(null, "x")).toEqual([]);
    expect(S.verloreneZeilen(undefined, "x")).toEqual([]);
  });
  test("leerer neuer Body verliert alles", () => {
    expect(S.verloreneZeilen("A", "")).toEqual(["A"]);
  });
});

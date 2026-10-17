/* Tests für scripts/nachweis-lib.mjs (#1762, vorher in slice-override.test.ts): Abnahme-Zeile, Marker, Hex-Muster,
 * Wert-Normalisierung. Reines Node-Tooling ohne Declaration-File: Namespace einmal auf eine lokale Oberfläche gebracht. */
import { describe, expect, it } from "vitest";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as raw from "../scripts/nachweis-lib.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as sliceRaw from "../scripts/slice-override.mjs";

interface Zeilen {
  praefix: string;
  planer: string;
  plan: string;
  review: string;
  abnahme: string;
}
const so = {
  ...(raw as unknown as { parseNachweis: (text: string, zeilen?: Zeilen) => { plan: unknown; abnahme: unknown } }),
  ...(sliceRaw as unknown as { commitZeilen: (praefix?: unknown, planer?: unknown) => Zeilen }),
};
const Z = so.commitZeilen("KQ-", "kubernia-planner");
const HEX = "abc1234";

describe("KQ-Abnahme (#1753): lesen, formatieren, Marker", () => {
  const A = raw as unknown as {
    URTEILSWERTE: string[];
    formatAbnahme: (z: Zeilen, a: unknown) => string;
    abnahmeMarker: (z: Zeilen) => string;
    formatAbnahmeMarker: (z: Zeilen, a: unknown) => string;
    parseAbnahmeMarker: (z: Zeilen, t: string) => unknown;
  };
  const urteil = [
    { k: "K1", wert: "erfuellt" },
    { k: "K2", wert: "nicht-erfuellt" },
    { k: "K3", wert: "nicht-pruefbar" },
  ];
  const ok = { art: "urteil", head: HEX, durchgaenge: 2, urteil };
  const lies = (zeile: string) => so.parseNachweis(zeile, Z).abnahme;
  it("Roundtrip Urteil und entfaellt", () => {
    const z = A.formatAbnahme(Z, ok);
    expect(z).toBe(`KQ-Abnahme: head=${HEX} durchgaenge=2 urteil=K1:erfuellt,K2:nicht-erfuellt,K3:nicht-pruefbar`);
    expect(lies(z)).toEqual(ok);
    const e = A.formatAbnahme(Z, { art: "entfaellt", grund: "Ticket ohne Kriterien" });
    expect(e).toBe("KQ-Abnahme: entfaellt — Ticket ohne Kriterien");
    expect(lies(e)).toEqual({ art: "entfaellt", grund: "Ticket ohne Kriterien" });
  });
  it("ohne Zeile null; die jüngste Zeile gilt, auch eine ungültige; Squash-Präfix; eingerückt zählt nicht", () => {
    const alt = A.formatAbnahme(Z, ok);
    expect(lies("feat: x")).toBeNull();
    expect(lies(`${alt}
KQ-Abnahme: kaputt`)).toEqual({ art: "ungueltig", zeile: "kaputt" });
    expect(lies(`KQ-Abnahme: kaputt
${alt}`)).toEqual(ok);
    expect(lies(`* ${alt}`)).toEqual(ok);
    expect(lies(`  ${alt}`)).toBeNull();
  });
  it("Präfix steuert Zeile und Marker; Marker-Roundtrip, Hand-off-Marker zählt nie", () => {
    const ab = so.commitZeilen("AB-", "p");
    expect(A.formatAbnahme(ab, ok).startsWith("AB-Abnahme: head=")).toBe(true);
    expect(A.abnahmeMarker(ab)).toBe("ab-abnahme");
    const m = A.formatAbnahmeMarker(ab, { durchgang: 3, head: HEX, urteil });
    expect(m).toBe(`<!-- ab-abnahme durchgang=3 head=${HEX} urteil=K1:erfuellt,K2:nicht-erfuellt,K3:nicht-pruefbar -->`);
    expect(A.parseAbnahmeMarker(ab, `Text
${m}
Rest`)).toEqual({ durchgang: 3, head: HEX, urteil });
    expect(A.parseAbnahmeMarker(Z, m)).toBeNull();
    expect(A.parseAbnahmeMarker(ab, "<!-- ab-abnahme-handoff -->")).toBeNull();
    expect(A.parseAbnahmeMarker(ab, `<!-- ab-abnahme durchgang=0 head=${HEX} urteil=K1:erfuellt -->`)).toBeNull();
    expect(A.parseAbnahmeMarker(ab, `<!-- ab-abnahme durchgang=1 head=${HEX} urteil=K1:vielleicht -->`)).toBeNull();
    expect(A.parseAbnahmeMarker(ab, undefined as unknown as string)).toBeNull();
  });
  it.each([
    ["unbekannter Urteilswert", `head=${HEX} durchgaenge=1 urteil=K1:gut`],
    ["entfaellt ohne Grund", "entfaellt"],
    ["entfaellt mit leerem Grund", "entfaellt —"],
    ["head fehlt", "durchgaenge=1 urteil=K1:erfuellt"],
    ["head kein Hex", "head=xyz durchgaenge=1 urteil=K1:erfuellt"],
    ["durchgaenge 0", `head=${HEX} durchgaenge=0 urteil=K1:erfuellt`],
    ["durchgaenge fehlt", `head=${HEX} urteil=K1:erfuellt`],
    ["doppeltes K", `head=${HEX} durchgaenge=1 urteil=K1:erfuellt,K1:erfuellt`],
    ["K0", `head=${HEX} durchgaenge=1 urteil=K0:erfuellt`],
    ["leeres Urteil", `head=${HEX} durchgaenge=1 urteil=`],
  ])("ungueltig: %s", (_n, wert) => {
    expect(lies(`KQ-Abnahme: ${wert}`)).toEqual({ art: "ungueltig", zeile: wert });
  });
  it("Urteil toleriert Leerzeichen nach Kommas und Groß-/Kleinschreibung", () => {
    expect(lies(`KQ-Abnahme: head=${HEX} durchgaenge=1 urteil=K1:Erfuellt, K2:nicht-erfuellt`)).toEqual({
      art: "urteil",
      head: HEX,
      durchgaenge: 1,
      urteil: [
        { k: "K1", wert: "erfuellt" },
        { k: "K2", wert: "nicht-erfuellt" },
      ],
    });
  });
  it("formatAbnahme wirft bei ungültiger Eingabe", () => {
    for (const a of [
      { ...ok, head: "xyz" },
      { ...ok, durchgaenge: 0 },
      { ...ok, durchgaenge: 1.5 },
      { ...ok, urteil: [{ k: "K1", wert: "gut" }] },
      { ...ok, urteil: [] },
      { art: "entfaellt", grund: "" },
      { art: "entfaellt", grund: ["a", "b"].join("\n") },
      { art: "x" },
      null,
    ]) expect(() => A.formatAbnahme(Z, a), JSON.stringify(a)).toThrow(/Abnahme/);
    expect(A.URTEILSWERTE).toEqual(["erfuellt", "nicht-erfuellt", "nicht-pruefbar"]);
  });
  it("parseNachweis ohne Abnahme-Schlüssel wirft", () => {
    const { abnahme: _weg, ...ohne } = Z;
    expect(() => so.parseNachweis("x", ohne as unknown as Zeilen)).toThrow(/Commit-Zeilen/);
  });
});

describe("KQ-Abnahme: Toleranzen und Validierung (Lens-Runde 1)", () => {
  const A = raw as unknown as {
    formatAbnahme: (z: Zeilen, a: unknown) => string;
    formatAbnahmeMarker: (z: Zeilen, a: unknown) => string;
  };
  const lies = (zeile: string) => so.parseNachweis(zeile, Z).abnahme;
  it.each([
    ["entfällt — Grund", "entfällt — Grund"],
    ["entfaellt - Grund", "entfaellt - Grund"],
    ["entfaellt – Grund", "entfaellt – Grund"],
  ])("entfaellt toleriert Umlaut und Trenner: %s", (_n, wert) => {
    expect(lies(`KQ-Abnahme: ${wert}`)).toEqual({ art: "entfaellt", grund: "Grund" });
  });
  it("head in Großbuchstaben wird kleingeschrieben gelesen", () => {
    expect(lies("KQ-Abnahme: head=ABC1234 durchgaenge=1 urteil=K1:erfuellt")).toMatchObject({ art: "urteil", head: "abc1234" });
  });
  it("formatAbnahmeMarker validiert wie formatAbnahme; formatAbnahme ohne Urteil wirft die Abnahme-Meldung", () => {
    const urteil = [{ k: "K1", wert: "erfuellt" }];
    expect(() => A.formatAbnahmeMarker(Z, { durchgang: 0, head: "abc1234", urteil })).toThrow(/Abnahme/);
    expect(() => A.formatAbnahmeMarker(Z, { durchgang: 1, head: "xyz", urteil })).toThrow(/Abnahme/);
    expect(() => A.formatAbnahmeMarker(Z, { durchgang: 1, head: "abc1234", urteil: [{ k: "K1", wert: "gut" }] })).toThrow(/Abnahme/);
    expect(() => A.formatAbnahme(Z, { art: "urteil", head: "abc1234", durchgaenge: 1 })).toThrow(/Abnahme/);
  });
});

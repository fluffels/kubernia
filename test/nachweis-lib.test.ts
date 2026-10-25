/* Tests für scripts/nachweis-lib.mjs (#1762, vorher in slice-override.test.ts): Abnahme-Zeile, Marker, Hex-Muster,
 * Wert-Normalisierung. Reines Node-Tooling ohne Declaration-File: Namespace einmal auf eine lokale Oberfläche gebracht. */
import { describe, expect, it } from "vitest";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as raw from "../scripts/nachweis-lib.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as sliceRaw from "../scripts/slice-override.mjs";
import { FREMD } from "./support/fremd-config";
import { FREMD_ABNAHME_MARKER } from "./support/ticket-ablauf";

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
const Z = so.commitZeilen(FREMD.praefixe.commitZeile, FREMD.agenten.planer);
const HEX = "abc1234";
const MARKER = FREMD_ABNAHME_MARKER;

describe("Abnahme-Zeile (#1753): lesen, formatieren, Marker", () => {
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
    expect(z).toBe(`${Z.abnahme}: head=${HEX} durchgaenge=2 urteil=K1:erfuellt,K2:nicht-erfuellt,K3:nicht-pruefbar`);
    expect(lies(z)).toEqual(ok);
    const e = A.formatAbnahme(Z, { art: "entfaellt", grund: "Ticket ohne Kriterien" });
    expect(e).toBe(`${Z.abnahme}: entfaellt — Ticket ohne Kriterien`);
    expect(lies(e)).toEqual({ art: "entfaellt", grund: "Ticket ohne Kriterien" });
  });
  it("`nach-merge` ist ein Zeilen- und Markerwert (ZEILENWERTE), aber kein Urteilswert des Agenten; Nachbarwerte bleiben ungültig", () => {
    const Z2 = raw as unknown as { ZEILENWERTE: string[] };
    expect(Z2.ZEILENWERTE).toEqual([...A.URTEILSWERTE, "nach-merge"]);
    expect(A.URTEILSWERTE).not.toContain("nach-merge");
    const nm = { art: "urteil", head: HEX, durchgaenge: 1, urteil: [{ k: "K1", wert: "erfuellt" }, { k: "K2", wert: "nach-merge" }] };
    const z = A.formatAbnahme(Z, nm);
    expect(z).toBe(`${Z.abnahme}: head=${HEX} durchgaenge=1 urteil=K1:erfuellt,K2:nach-merge`);
    expect(lies(z)).toEqual(nm);
    const m = A.formatAbnahmeMarker(Z, { durchgang: 1, head: HEX, urteil: nm.urteil });
    expect(A.parseAbnahmeMarker(Z, m)).toEqual({ durchgang: 1, head: HEX, urteil: nm.urteil });
    expect(lies(`${Z.abnahme}: head=${HEX} durchgaenge=1 urteil=K1:nach-merges`)).toMatchObject({ art: "ungueltig", grund: "unbekannter Wert „nach-merges“ bei K1" });
    expect(() => A.formatAbnahme(Z, { ...nm, urteil: [{ k: "K1", wert: "nach_merge" }] })).toThrow(/Abnahme/);
  });
  it("ohne Zeile null; die jüngste Zeile gilt, auch eine ungültige; Squash-Präfix; eingerückt zählt nicht", () => {
    const alt = A.formatAbnahme(Z, ok);
    expect(lies("feat: x")).toBeNull();
    expect(lies(`${alt}
${Z.abnahme}: kaputt`)).toEqual({ art: "ungueltig", zeile: "kaputt", grund: "head fehlt oder ist kein Hex" });
    expect(lies(`${Z.abnahme}: kaputt
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
    ["unbekannter Urteilswert", `head=${HEX} durchgaenge=1 urteil=K1:gut`, /unbekannter Wert „gut“ bei K1/],
    ["entfaellt ohne Grund", "entfaellt", /entfaellt braucht einen Grund/],
    ["entfaellt mit leerem Grund", "entfaellt —", /entfaellt braucht einen Grund/],
    ["head fehlt", "durchgaenge=1 urteil=K1:erfuellt", /head fehlt oder ist kein Hex/],
    ["head kein Hex", "head=xyz durchgaenge=1 urteil=K1:erfuellt", /head fehlt oder ist kein Hex/],
    ["durchgaenge 0", `head=${HEX} durchgaenge=0 urteil=K1:erfuellt`, /durchgaenge fehlt oder ist kleiner als 1/],
    ["durchgaenge fehlt", `head=${HEX} urteil=K1:erfuellt`, /durchgaenge fehlt oder ist kleiner als 1/],
    ["doppeltes K", `head=${HEX} durchgaenge=1 urteil=K1:erfuellt,K1:erfuellt`, /K1 doppelt/],
    ["K0", `head=${HEX} durchgaenge=1 urteil=K0:erfuellt`, /Kriterium „K0“ ungültig/],
    ["leeres Urteil", `head=${HEX} durchgaenge=1 urteil=`, /Urteil ist leer/],
    ["Urteil fehlt ganz", `head=${HEX} durchgaenge=1`, /Urteil ist leer/],
    ["Kriterium Kx", `head=${HEX} durchgaenge=1 urteil=Kx:erfuellt`, /Kriterium „Kx“ ungültig/],
    ["Eintrag ohne Doppelpunkt", `head=${HEX} durchgaenge=1 urteil=K1`, /Eintrag „K1“ ungültig/],
    ["Eintrag ohne Wert", `head=${HEX} durchgaenge=1 urteil=K1:`, /Eintrag „K1:“ ungültig/],
    ["Wert mit Leerzeichen", `head=${HEX} durchgaenge=1 urteil=K1:a b`, /Eintrag „K1:a b“ ungültig/],
  ])("ungueltig: %s (mit Grund)", (_n, wert, grund) => {
    expect(lies(`${Z.abnahme}: ${wert}`)).toEqual({ art: "ungueltig", zeile: wert, grund: expect.stringMatching(grund) as string });
  });
  it("Urteil toleriert Leerzeichen nach Kommas und Groß-/Kleinschreibung", () => {
    expect(lies(`${Z.abnahme}: head=${HEX} durchgaenge=1 urteil=K1:Erfuellt, K2:nicht-erfuellt`)).toEqual({
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

describe("Abnahme-Zeile: Toleranzen und Validierung (Lens-Runde 1)", () => {
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
    expect(lies(`${Z.abnahme}: ${wert}`)).toEqual({ art: "entfaellt", grund: "Grund" });
  });
  it("head in Großbuchstaben wird kleingeschrieben gelesen", () => {
    expect(lies(`${Z.abnahme}: head=ABC1234 durchgaenge=1 urteil=K1:erfuellt`)).toMatchObject({ art: "urteil", head: "abc1234" });
  });
  it("formatAbnahmeMarker validiert wie formatAbnahme; formatAbnahme ohne Urteil wirft die Abnahme-Meldung", () => {
    const urteil = [{ k: "K1", wert: "erfuellt" }];
    expect(() => A.formatAbnahmeMarker(Z, { durchgang: 0, head: "abc1234", urteil })).toThrow(/Abnahme/);
    expect(() => A.formatAbnahmeMarker(Z, { durchgang: 1, head: "xyz", urteil })).toThrow(/Abnahme/);
    expect(() => A.formatAbnahmeMarker(Z, { durchgang: 1, head: "abc1234", urteil: [{ k: "K1", wert: "gut" }] })).toThrow(/Abnahme/);
    expect(() => A.formatAbnahme(Z, { art: "urteil", head: "abc1234", durchgaenge: 1 })).toThrow(/Abnahme/);
  });
});

describe("Hex-Muster und Wert-Normalisierung (#1762 L11)", () => {
  const L = raw as unknown as { HEX: string; HEX_HEAD: RegExp; normalisiereWert: (t: unknown) => string; normalisiereLens: (t: unknown) => string };
  it("HEX_HEAD nimmt 7 bis 40 kleine Hex-Zeichen, sonst nichts", () => {
    expect(L.HEX_HEAD.test("a".repeat(7))).toBe(true);
    expect(L.HEX_HEAD.test("a1b2c3d4e5".repeat(4))).toBe(true);
    for (const falsch of ["a".repeat(6), "a".repeat(41), "ABCDEF1", "abcdefg", "", "abc1234\n", " abc1234"]) {
      expect(L.HEX_HEAD.test(falsch), JSON.stringify(falsch)).toBe(false);
    }
  });
  it("HEX ist die Quelle des Marker-Musters: ein Marker mit Großbuchstaben oder 6 Zeichen zählt nicht", () => {
    const urteil = [{ k: "K1", wert: "erfuellt" }];
    const m = (head: string) => `<!-- ${MARKER} durchgang=1 head=${head} urteil=K1:erfuellt -->`;
    const A = raw as unknown as { parseAbnahmeMarker: (z: Zeilen, t: string) => unknown };
    expect(A.parseAbnahmeMarker(Z, m("abc1234"))).toEqual({ durchgang: 1, head: "abc1234", urteil });
    expect(A.parseAbnahmeMarker(Z, m("abc123"))).toBeNull();
    expect(A.parseAbnahmeMarker(Z, m("a".repeat(41)))).toBeNull();
  });
  it("normalisiereWert: trim, klein, Umlaute in ASCII, Leerraum wird Bindestrich", () => {
    expect(L.normalisiereWert("Nicht-Erfüllt ")).toBe("nicht-erfuellt");
    expect(L.normalisiereWert("  Größe  Maß ")).toBe("groesse-mass");
    expect(L.normalisiereWert(undefined)).toBe("undefined");
  });
  it("normalisiereLens bleibt dieselbe Funktion in anderer Hülle", () => {
    expect(L.normalisiereLens("Test Adäquanz")).toBe("test-adaequanz");
  });
});

describe("vertrauteAbnahmeMarker (#1781 L5b): das Prädikat „vertraut + gültiger Marker“ an einer Stelle", () => {
  const A = raw as unknown as {
    formatAbnahmeMarker: (z: Zeilen, a: unknown) => string;
    vertrauteAbnahmeMarker: (k: unknown, owner: string, z: Zeilen) => { durchgang: number; head: string; urteil: unknown[] }[];
  };
  const urteil = [{ k: "K1", wert: "erfuellt" }];
  const marker = (durchgang: number) => A.formatAbnahmeMarker(Z, { durchgang, head: HEX, urteil });
  const von = (login: string, body: string, type = "User") => ({ user: { login, type }, body });

  it("liefert die Marker vertrauter Autoren in API-Reihenfolge", () => {
    const r = A.vertrauteAbnahmeMarker([von("owner", marker(1)), von("owner", "Text"), von("github-actions[bot]", marker(2), "Bot")], "owner", Z);
    expect(r.map((m) => m.durchgang)).toEqual([1, 2]);
  });
  it("Marker eines fremden Autors zählt nicht, auch nicht mit gültigem Format", () => {
    expect(A.vertrauteAbnahmeMarker([von("fremd", marker(1))], "owner", Z)).toEqual([]);
  });
  it("Hand-off-Marker und kaputte Marker zählen nicht", () => {
    const handoff = `<!-- ${abnahmeMarkerName()}-handoff -->`;
    expect(A.vertrauteAbnahmeMarker([von("owner", handoff), von("owner", `<!-- ${MARKER} durchgang=0 head=${HEX} urteil=K1:erfuellt -->`)], "owner", Z)).toEqual([]);
  });
  it("kein Array, null-Einträge und Einträge ohne user/body sind leer statt Fehler", () => {
    expect(A.vertrauteAbnahmeMarker(undefined, "owner", Z)).toEqual([]);
    expect(A.vertrauteAbnahmeMarker([null, {}, { user: null, body: marker(1) }], "owner", Z)).toEqual([]);
  });
  describe("hoechsterAbnahmeDurchgang (#1821 L18): das Maximum des Felds, nicht die Anzahl", () => {
    const H = (raw as unknown as { hoechsterAbnahmeDurchgang: (k: unknown, owner: string, z: Zeilen) => number }).hoechsterAbnahmeDurchgang;
    it("Lücke (1,3) liefert 3, Duplikat (2,2) liefert 2, ohne Marker 0", () => {
      expect(H([von("owner", marker(1)), von("owner", marker(3))], "owner", Z)).toBe(3);
      expect(H([von("owner", marker(2)), von("owner", marker(2))], "owner", Z)).toBe(2);
      expect(H([von("owner", "Text"), von("fremd", marker(5))], "owner", Z)).toBe(0);
      expect(H(undefined, "owner", Z)).toBe(0);
    });
  });
  function abnahmeMarkerName() {
    return (raw as unknown as { abnahmeMarker: (z: Zeilen) => string }).abnahmeMarker(Z);
  }
});

// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as abschlussRoh from "../scripts/umsetzer-abschluss.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as extraktionRoh from "../scripts/besitz-extraktion.mjs";

const abschluss = { ...abschlussRoh, ...extraktionRoh } as unknown as { leitplankenMuster: () => string[]; trifftLeitplanke: (pfad: string, muster: string[]) => boolean };

describe("Schutzliste (.github/protected-paths.json, #1929): der Kopfkommentar von nachweis-lib.mjs nennt sie als Quelle", () => {
  it("scripts/nachweis-lib.mjs ist eine Leitplanke der echten Liste, und ohne seinen Eintrag wäre es keine", () => {
    const muster = abschluss.leitplankenMuster();
    expect(abschluss.trifftLeitplanke("scripts/nachweis-lib.mjs", muster)).toBe(true);
    expect(abschluss.trifftLeitplanke("scripts/nachweis-lib.mjs", muster.filter((m) => m !== "/scripts/nachweis-lib.mjs"))).toBe(false);
  });
});

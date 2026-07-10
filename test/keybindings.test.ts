import { describe, it, expect } from "vitest";
import {
  BINDABLE_ACTIONS, DEFAULT_KEYBINDINGS, RESERVED_KEYS,
  normalizeKey, isAssignableKey, resolveAction, findConflict, sanitizeKeybindings,
  type Keybindings,
} from "../src/core/keybindings";

/* Pure Domäne (#232): Belegungsregeln – Default gültig, Auflösung, Konflikt, Sanitisieren.
 * Red-Green: die Negativfälle würden bei kaputter Logik durchrutschen. */

const noDupes = (b: Keybindings) => new Set(Object.values(b)).size === BINDABLE_ACTIONS.length;

describe("DEFAULT_KEYBINDINGS", () => {
  it("belegt jede Aktion mit einer belegbaren, paarweise verschiedenen Taste", () => {
    for (const a of BINDABLE_ACTIONS) expect(isAssignableKey(DEFAULT_KEYBINDINGS[a])).toBe(true);
    expect(noDupes(DEFAULT_KEYBINDINGS)).toBe(true);
  });
  it("nutzt die deutsch-mnemonische Belegung R/F/L/B", () => {
    expect(DEFAULT_KEYBINDINGS).toEqual({ talk: "r", radio: "f", logbook: "l", album: "b" });
  });
});

describe("normalizeKey", () => {
  it("Einzelzeichen → Kleinbuchstabe, benannte Tasten kleingeschrieben", () => {
    expect(normalizeKey("R")).toBe("r");
    expect(normalizeKey("ArrowUp")).toBe("arrowup");
  });
});

describe("isAssignableKey", () => {
  it("akzeptiert freie Buchstaben, lehnt reservierte + Nicht-Einzelbuchstaben ab", () => {
    expect(isAssignableKey("r")).toBe(true);
    expect(isAssignableKey("q")).toBe(true);
    // reservierte Bewegungstasten
    for (const k of ["w", "a", "s", "d"]) expect(isAssignableKey(k)).toBe(false);
    // Ziffern/benannte Tasten/Mehrzeichen
    expect(isAssignableKey("1")).toBe(false);
    expect(isAssignableKey("arrowup")).toBe(false);
    expect(isAssignableKey("enter")).toBe(false);
    expect(isAssignableKey("")).toBe(false);
    expect(isAssignableKey("rr")).toBe(false);
    expect(isAssignableKey("R")).toBe(false); // erwartet bereits normalisiert
  });
  it("kein reservierter Schlüssel ist belegbar", () => {
    for (const k of RESERVED_KEYS) expect(isAssignableKey(k)).toBe(false);
  });
});

describe("resolveAction", () => {
  it("findet die Aktion zur belegten Taste (auch groß geschrieben), sonst null", () => {
    expect(resolveAction(DEFAULT_KEYBINDINGS, "r")).toBe("talk");
    expect(resolveAction(DEFAULT_KEYBINDINGS, "F")).toBe("radio");
    expect(resolveAction(DEFAULT_KEYBINDINGS, "x")).toBeNull();
    expect(resolveAction(DEFAULT_KEYBINDINGS, "w")).toBeNull(); // Bewegung ist keine Aktion
  });
});

describe("findConflict", () => {
  it("meldet eine fremde Aktion, aber nicht die eigene", () => {
    expect(findConflict(DEFAULT_KEYBINDINGS, "talk", "f")).toBe("radio");
    expect(findConflict(DEFAULT_KEYBINDINGS, "talk", "r")).toBeNull(); // eigene Taste = kein Konflikt
    expect(findConflict(DEFAULT_KEYBINDINGS, "talk", "x")).toBeNull(); // frei
  });
});

describe("sanitizeKeybindings", () => {
  it("übernimmt eine gültige, eindeutige Belegung unverändert", () => {
    const good: Keybindings = { talk: "q", radio: "e", logbook: "l", album: "b" };
    expect(sanitizeKeybindings(good)).toEqual(good);
  });
  it("liefert bei Müll/undefined die Default-Belegung", () => {
    expect(sanitizeKeybindings(null)).toEqual(DEFAULT_KEYBINDINGS);
    expect(sanitizeKeybindings("kaputt")).toEqual(DEFAULT_KEYBINDINGS);
    expect(sanitizeKeybindings({})).toEqual(DEFAULT_KEYBINDINGS);
  });
  it("ersetzt reservierte/ungültige Tasten durch gültige und bleibt kollisionsfrei", () => {
    const out = sanitizeKeybindings({ talk: "w", radio: "1", logbook: "arrowup", album: "b" });
    expect(isAssignableKey(out.album)).toBe(true);
    for (const a of BINDABLE_ACTIONS) expect(isAssignableKey(out[a])).toBe(true);
    expect(noDupes(out)).toBe(true);
    expect(out.album).toBe("b"); // die eine gültige Eingabe überlebt
  });
  it("löst Duplikate auf (zweite Belegung derselben Taste weicht aus)", () => {
    const out = sanitizeKeybindings({ talk: "x", radio: "x", logbook: "x", album: "x" });
    expect(noDupes(out)).toBe(true);
    expect(out.talk).toBe("x"); // erstes gewinnt die Taste
  });
});

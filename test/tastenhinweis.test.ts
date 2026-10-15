import { describe, it, expect } from "vitest";
import { DEFAULT_KEYBINDINGS, BINDABLE_ACTIONS, type Keybindings } from "../src/core/keybindings";
import { keyLabel, fillKeyTokens, keyTokenActions, TASTEN_HINWEISE, tastenHinweis, type TastenHinweisId } from "../src/hud/tastenhinweis";

const def: Keybindings = { ...DEFAULT_KEYBINDINGS };
const umbelegt: Keybindings = { ...DEFAULT_KEYBINDINGS, radio: "x", talk: "y" };

describe("keyLabel", () => {
  it("Default groß", () => {
    expect(BINDABLE_ACTIONS.map(a => keyLabel(def, a))).toEqual(["R", "F", "L", "B"]);
  });
  it("umbelegt", () => { expect(keyLabel(umbelegt, "radio")).toBe("X"); });
});

describe("fillKeyTokens", () => {
  it("ersetzt mehrere Token aller Aktionen", () => {
    expect(fillKeyTokens("{taste:talk}{taste:radio}{taste:logbook}{taste:album}", def)).toBe("RFLB");
  });
  it("Text ohne Token bleibt gleich", () => { expect(fillKeyTokens("Drück <b>Enter</b>", def)).toBe("Drück <b>Enter</b>"); });
  it("Unbekanntes bleibt wörtlich", () => {
    for (const s of ["{taste:funk}", "{taste:}", "{Taste:radio}", "{{ .Values }}"]) expect(fillKeyTokens(s, def)).toBe(s);
  });
});

describe("keyTokenActions", () => {
  it("findet gültige und ungültige Namen", () => {
    expect(keyTokenActions("a {taste:radio} b {taste:funk} {taste:}")).toEqual(["radio", "funk"]);
  });
});

describe("TASTEN_HINWEISE", () => {
  const ids = Object.keys(TASTEN_HINWEISE) as TastenHinweisId[];
  it("jeder Eintrag hat ein gültiges Token und rendert ohne Rest", () => {
    for (const id of ids) {
      const acts = keyTokenActions(TASTEN_HINWEISE[id]);
      expect(acts.length, id).toBeGreaterThan(0);
      for (const a of acts) expect(BINDABLE_ACTIONS as readonly string[], id).toContain(a);
      expect(tastenHinweis(id, def), id).not.toContain("{taste:");
    }
  });
  it("Regression #1553: Funk-Hinweis nennt F, nicht T; folgt der Umbelegung", () => {
    expect(tastenHinweis("funkAufgabe", def)).toContain("<b>F</b>");
    expect(tastenHinweis("funkAufgabe", def)).not.toContain("<b>T</b>");
    expect(tastenHinweis("funkAufgabe", umbelegt)).toContain("<b>X</b>");
    expect(tastenHinweis("funkAufgabe", umbelegt)).not.toContain("<b>F</b>");
    expect(tastenHinweis("funkLogbuch", umbelegt)).toContain("(<b>X</b>)");
  });
  it("Innenraum-Hinweise folgen der Reden-Taste", () => {
    for (const id of ["innenAnLand", "innenAnsDeck", "innenHinaus", "innenReden"] as const) {
      expect(tastenHinweis(id, umbelegt).startsWith("Y – "), id).toBe(true);
    }
    expect(tastenHinweis("naehe", umbelegt)).toBe("<b>Y</b> – ");
  });
});

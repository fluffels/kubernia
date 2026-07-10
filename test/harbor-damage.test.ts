/* ===== KubeQuest – Harbor-Damage-Textur-Ableitung (#692) =====
 * Unit-Test für die reine Zustands-Ableitung: welche Textur-Variante gehört
 * zu welchem `controlPlane.up`-Zustand? Die Funktion `harborTexture` ist
 * Phaser-frei und daher vollständig unit-testbar.
 */
import { describe, it, expect } from "vitest";
import { harborTexture } from "../src/scenes/worldscene/harbordamage";

describe("harborTexture – Textur-Variante je Control-Plane-Zustand", () => {
  describe("Control-Plane hochgefahren (up = true) → heile Textur", () => {
    it("Leuchtturm: heile Variante", () => {
      expect(harborTexture("lighthouse", true)).toBe("lighthouse");
    });
    it("Bürohaus: heile Variante", () => {
      expect(harborTexture("house_office", true)).toBe("house_office");
    });
    it("Schiff: heile Variante", () => {
      expect(harborTexture("ship", true)).toBe("ship");
    });
    it("Kran: heile Variante", () => {
      expect(harborTexture("crane", true)).toBe("crane");
    });
  });

  describe("Control-Plane unten (up = false) → Trümmer-Textur", () => {
    it("Leuchtturm: Trümmer-Variante", () => {
      expect(harborTexture("lighthouse", false)).toBe("lighthouse_ruined");
    });
    it("Bürohaus: Trümmer-Variante", () => {
      expect(harborTexture("house_office", false)).toBe("house_office_damaged");
    });
    it("Schiff: Trümmer-Variante", () => {
      expect(harborTexture("ship", false)).toBe("ship_wrecked");
    });
    it("Kran: Trümmer-Variante", () => {
      expect(harborTexture("crane", false)).toBe("crane_wrecked");
    });
  });

  describe("Negativ-Fall: unbekannter Schlüssel", () => {
    it("unbekannter Schlüssel bleibt unverändert (kein Absturz)", () => {
      expect(harborTexture("some_unknown_prop", false)).toBe("some_unknown_prop");
      expect(harborTexture("some_unknown_prop", true)).toBe("some_unknown_prop");
    });
  });
});

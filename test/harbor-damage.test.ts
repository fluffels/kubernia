/* ===== KubeQuest – Harbor-Damage-Textur-Ableitung (#692/#693) =====
 * Unit-Tests für die reine Zustands-Ableitung:
 * - welche Textur-Variante gehört zu welchem `controlPlane.up`-Zustand (harborTexture)
 * - welcher Pier ist bei welchem Node-Stand heil (pierHealed)
 * Beide Funktionen sind Phaser-frei und vollständig unit-testbar.
 */
import { describe, it, expect } from "vitest";
import { harborTexture, pierHealed } from "../src/scenes/worldscene/harbordamage";

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

describe("pierHealed – Steg heil je Node-Beitritt (#693)", () => {
  describe("Control-Plane-Steg (ahoi-control)", () => {
    it("zerstört wenn controlPlane.up false", () => {
      expect(pierHealed("ahoi-control", false, [])).toBe(false);
    });
    it("heil wenn controlPlane.up true", () => {
      expect(pierHealed("ahoi-control", true, [])).toBe(true);
    });
    it("Node-Namen spielen für den Control-Steg keine Rolle", () => {
      expect(pierHealed("ahoi-control", false, ["ahoi-control"])).toBe(false);
      expect(pierHealed("ahoi-control", false, ["ahoi-worker-1", "ahoi-worker-2"])).toBe(false);
    });
  });

  describe("Worker-Steg (ahoi-worker-1)", () => {
    it("zerstört wenn Node nicht im Cluster", () => {
      expect(pierHealed("ahoi-worker-1", true, [])).toBe(false);
    });
    it("heil wenn eigener Node beigetreten", () => {
      expect(pierHealed("ahoi-worker-1", false, ["ahoi-worker-1"])).toBe(true);
    });
    it("zerstört wenn nur der andere Worker beigetreten ist", () => {
      expect(pierHealed("ahoi-worker-1", true, ["ahoi-worker-2"])).toBe(false);
    });
    it("heil nach join auch ohne Control-Plane up", () => {
      expect(pierHealed("ahoi-worker-1", false, ["ahoi-worker-1"])).toBe(true);
    });
  });

  describe("Worker-Steg (ahoi-worker-2)", () => {
    it("zerstört wenn Node nicht im Cluster", () => {
      expect(pierHealed("ahoi-worker-2", true, [])).toBe(false);
    });
    it("heil nach join", () => {
      expect(pierHealed("ahoi-worker-2", true, ["ahoi-worker-1", "ahoi-worker-2"])).toBe(true);
    });
  });

  describe("Granularer Wiederaufbau – Stege heilen unabhängig", () => {
    it("control heil nach kubeadm init, Worker noch zerstört", () => {
      expect(pierHealed("ahoi-control",  true,  [])).toBe(true);
      expect(pierHealed("ahoi-worker-1", true,  [])).toBe(false);
      expect(pierHealed("ahoi-worker-2", true,  [])).toBe(false);
    });
    it("control + worker-1 heil, worker-2 noch kaputt", () => {
      const nodes = ["ahoi-control", "ahoi-worker-1"];
      expect(pierHealed("ahoi-control",  true, nodes)).toBe(true);
      expect(pierHealed("ahoi-worker-1", true, nodes)).toBe(true);
      expect(pierHealed("ahoi-worker-2", true, nodes)).toBe(false);
    });
    it("alle drei heil nach vollständigem Aufbau", () => {
      const nodes = ["ahoi-control", "ahoi-worker-1", "ahoi-worker-2"];
      expect(pierHealed("ahoi-control",  true, nodes)).toBe(true);
      expect(pierHealed("ahoi-worker-1", true, nodes)).toBe(true);
      expect(pierHealed("ahoi-worker-2", true, nodes)).toBe(true);
    });
  });
});

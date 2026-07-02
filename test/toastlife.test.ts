import { describe, it, expect } from "vitest";
import {
  TOAST_LIFE_MS,
  HINT_LIFE_MS,
  TOAST_FADE_MS,
  toastFadeDelaySeconds,
} from "../src/hud/toastlife";

// Pure Dauer-Politik der Toasts (#370). Belohnungen/Bestätigungen blitzen kurz auf,
// echte Hinweise müssen wirklich lesbar bleiben. Die DOM-Umsetzung in src/ui/hud.ts
// ist Präsentation (browser-verifiziert) – hier sichern wir nur die Politik ab.
describe("toastlife (#370)", () => {
  it("Hinweis-Toasts bleiben mindestens 15 Sekunden stehen", () => {
    // Akzeptanzkriterium des Tickets: ein Hint bleibt >= 15 s lesbar.
    expect(HINT_LIFE_MS).toBeGreaterThanOrEqual(15000);
  });

  it("ein Hinweis steht deutlich länger als ein Belohnungs-Toast", () => {
    // Sonst wäre die Trennung sinnlos – Hinweise sollen NICHT so flüchtig sein
    // wie die kurzen +XP/+Dublonen-Bestätigungen.
    expect(HINT_LIFE_MS).toBeGreaterThan(TOAST_LIFE_MS);
  });

  it("der Fade-out endet genau beim Entfernen (eine Quelle für JS + CSS)", () => {
    // Der CSS-Fade (toast-out, TOAST_FADE_MS) startet so spät, dass er exakt
    // dann fertig ist, wenn das JS das Element entfernt – kein unsichtbares
    // Herumhängen und kein hartkodiertes 3,4-s-Wegblitzen mehr.
    expect(toastFadeDelaySeconds(HINT_LIFE_MS)).toBeCloseTo((HINT_LIFE_MS - TOAST_FADE_MS) / 1000, 5);
    expect(toastFadeDelaySeconds(TOAST_LIFE_MS)).toBeCloseTo((TOAST_LIFE_MS - TOAST_FADE_MS) / 1000, 5);
  });

  it("ein Hinweis ist die meiste Zeit voll sichtbar, bevor er faded", () => {
    // 15 s − 0,4 s Fade = 14,6 s voll sichtbar: kein „flüchtiges Aufblitzen".
    expect(toastFadeDelaySeconds(HINT_LIFE_MS)).toBeGreaterThanOrEqual(14);
  });

  it("die Fade-Verzögerung wird nie negativ (Negativfall: sehr kurzer Toast)", () => {
    // Wäre die Lebensdauer kürzer als die Fade-Animation, dürfte die Verzögerung
    // nicht ins Negative kippen (sonst startet der Fade „in der Vergangenheit").
    expect(toastFadeDelaySeconds(200)).toBe(0);
    expect(toastFadeDelaySeconds(0)).toBe(0);
    expect(toastFadeDelaySeconds(TOAST_FADE_MS)).toBe(0);
  });
});

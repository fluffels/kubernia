import { describe, it, expect } from "vitest";
import { planAdvance, DEV_FRAME_MS, MAX_DEV_FRAME_MS, MAX_ADVANCE_MS } from "../src/devtools/timestep";

describe("planAdvance (Dev-Zeit-Stepping)", () => {
  it("1000 ms ergeben genau 60 Frames ohne Rest (Float-Falle 1000/60)", () => {
    const p = planAdvance(1000);
    expect(p.frames).toBe(60);
    expect(p.frameMs).toBeCloseTo(DEV_FRAME_MS, 10);
    expect(p.remainderMs).toBe(0);
  });

  it("100 ms bei 16 ms Frames: 6 Frames + 4 ms Rest", () => {
    const p = planAdvance(100, 16);
    expect(p.frames).toBe(6);
    expect(p.remainderMs).toBeCloseTo(4, 10);
  });

  it("weniger als ein Frame: 0 Frames, alles Rest", () => {
    const p = planAdvance(5, 16);
    expect(p.frames).toBe(0);
    expect(p.remainderMs).toBe(5);
  });

  it("Invariante frames*frameMs + rest == ms", () => {
    for (const [ms, f] of [[123, 16], [60_000, 1000 / 60], [999, 33], [7777, 50]] as const) {
      const p = planAdvance(ms, f);
      expect(p.frames * p.frameMs + p.remainderMs).toBeCloseTo(ms, 6);
      expect(p.remainderMs).toBeGreaterThanOrEqual(0);
      expect(p.remainderMs).toBeLessThan(p.frameMs + 1e-6);
    }
  });

  it("lehnt ungültige ms ab (0, negativ, NaN, ±Infinity, über Deckel)", () => {
    for (const bad of [0, -1, NaN, Infinity, -Infinity, MAX_ADVANCE_MS + 1]) {
      expect(() => planAdvance(bad), String(bad)).toThrow(RangeError);
    }
  });

  it("lehnt ungültige frameMs ab (≤0, NaN, über Deckel)", () => {
    for (const bad of [0, -5, NaN, Infinity, MAX_DEV_FRAME_MS + 1]) {
      expect(() => planAdvance(1000, bad), String(bad)).toThrow(RangeError);
    }
  });

  it("Rest-Klemme: Float-Rauschen (positiv wie negativ) wird 0, ein echter Rest bleibt", () => {
    expect(planAdvance(16 + 5e-7, 16).remainderMs).toBe(0);
    expect(planAdvance(16 - 1e-10, 16).remainderMs).toBe(0);
    expect(planAdvance(16 + 1e-3, 16).remainderMs).toBeCloseTo(1e-3, 9);
    expect(planAdvance(100, 16).remainderMs).toBeCloseTo(4, 10);
  });

  it("der Deckel selbst ist erlaubt", () => {
    expect(() => planAdvance(MAX_ADVANCE_MS)).not.toThrow();
  });
});

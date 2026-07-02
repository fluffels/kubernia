import { describe, it, expect } from "vitest";
import {
  buildCrashReport,
  CRASH_TITLE,
  CRASH_FALLBACK_MESSAGE,
} from "../src/crashreport";

// Pure Normalisierung eines beliebigen geworfenen Werts in einen anzeigbaren
// Absturz-Bericht (#504). Der Handler in main.ts füttert diese Funktion mit dem,
// was window.onerror/unhandledrejection liefert – alle Fälle hier abgedeckt.
describe("buildCrashReport (#504)", () => {
  it("trägt immer die feste, nicht-technische Überschrift", () => {
    expect(buildCrashReport(new Error("egal")).title).toBe(CRASH_TITLE);
    expect(buildCrashReport("egal").title).toBe(CRASH_TITLE);
    expect(buildCrashReport(null).title).toBe(CRASH_TITLE);
  });

  it("nimmt bei einem Error die message als Klartext und den Stack als Detail", () => {
    const err = new Error("Szene konnte nicht laden");
    const r = buildCrashReport(err);
    expect(r.message).toBe("Szene konnte nicht laden");
    // Der echte V8-Stack beginnt mit „Error: <message>" – das Detail trägt ihn.
    expect(r.detail).toContain("Szene konnte nicht laden");
    expect(r.detail.length).toBeGreaterThan(0);
  });

  it("baut ohne Stack ein Name-message-Detail (kein Verlust)", () => {
    const err = { name: "TypeError", message: "x ist undefined" }; // stack-los
    const r = buildCrashReport(err);
    expect(r.message).toBe("x ist undefined");
    expect(r.detail).toBe("TypeError: x ist undefined");
  });

  it("erfasst fehlerartige Fremdwerte (DOMException-Duck-Typing)", () => {
    const domish = { name: "QuotaExceededError", message: "Speicher voll", stack: "QuotaExceededError: Speicher voll\n  at save" };
    const r = buildCrashReport(domish);
    expect(r.message).toBe("Speicher voll");
    expect(r.detail).toContain("at save");
  });

  it("nimmt einen geworfenen String direkt, ohne Detail", () => {
    const r = buildCrashReport("Boom im Terminal");
    expect(r.message).toBe("Boom im Terminal");
    expect(r.detail).toBe("");
  });

  it("fällt bei null/undefined/leer auf die Fallback-Meldung zurück", () => {
    expect(buildCrashReport(null).message).toBe(CRASH_FALLBACK_MESSAGE);
    expect(buildCrashReport(undefined).message).toBe(CRASH_FALLBACK_MESSAGE);
    expect(buildCrashReport("   ").message).toBe(CRASH_FALLBACK_MESSAGE);
    expect(buildCrashReport(new Error("")).message).toBe(CRASH_FALLBACK_MESSAGE);
  });

  it("stringifiziert Nicht-Fehler-Werte (Zahl, Objekt)", () => {
    expect(buildCrashReport(42).message).toBe("42");
    expect(buildCrashReport({ code: 7 }).message).toBe('{"code":7}');
  });

  it("wirft nie – auch nicht bei zirkulären Objekten", () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    let r: ReturnType<typeof buildCrashReport>;
    expect(() => { r = buildCrashReport(circular); }).not.toThrow();
    expect(r!.message.length).toBeGreaterThan(0);
  });

  it("kappt eine überlange Meldung auf eine lesbare Zeile", () => {
    const long = "a".repeat(1000);
    const r = buildCrashReport(long);
    expect(r.message.length).toBeLessThanOrEqual(301); // 300 + „…"
    expect(r.message.endsWith("…")).toBe(true);
  });

  it("kappt ein überlanges Detail (riesiger Stack)", () => {
    const err = new Error("kurz");
    err.stack = "S".repeat(9000);
    const r = buildCrashReport(err);
    expect(r.detail.length).toBeLessThanOrEqual(4001);
    expect(r.detail.endsWith("…")).toBe(true);
  });
});

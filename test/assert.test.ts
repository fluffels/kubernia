/* assertNever (#1426): wirft mit Ort und Variante, auch bei zirkulären/riesigen Werten. */
import { describe, it, expect } from "vitest";
import { assertNever } from "../src/core/assert";

describe("assertNever", () => {
  it("wirft einen Error mit Ort und Diskriminante", () => {
    const v = { owner: "DaemonSet" } as never;
    expect(() => assertNever(v, "kubectl delete pod")).toThrow(Error);
    expect(() => assertNever(v, "kubectl delete pod")).toThrow(/kubectl delete pod: unbehandelte Variante.*DaemonSet/);
  });
  it("ein Primitiv erscheint in der Meldung", () => {
    expect(() => assertNever("Job" as never, "x")).toThrow(/Job/);
  });
  it("undefined und Funktion: Meldung statt TypeError", () => {
    expect(() => assertNever(undefined as never, "x")).toThrow(/x: unbehandelte Variante undefined/);
    expect(() => assertNever((() => 1) as never, "x")).toThrow(/x: unbehandelte Variante/);
    expect(() => assertNever(undefined as never, "x")).not.toThrow(TypeError);
  });
  it("zirkuläres Objekt: trotzdem die assertNever-Meldung, kein TypeError", () => {
    const a: Record<string, unknown> = { owner: "Zyklus" };
    a.self = a;
    expect(() => assertNever(a as never, "z")).toThrow(/z: unbehandelte Variante/);
    expect(() => assertNever(a as never, "z")).not.toThrow(TypeError);
  });
  it("sehr großes Objekt: Meldung gekürzt", () => {
    const big = { owner: "X", daten: "y".repeat(5000) };
    const msg = (() => { try { return assertNever(big as never, "g"); } catch (e) { return (e as Error).message; } })();
    expect(msg.length).toBeLessThan(300);
    expect(msg).toMatch(/^g: unbehandelte Variante/);
  });
});

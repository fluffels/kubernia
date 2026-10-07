/* Die Helfer aus test/support/erwartungen.ts (#1342) dürfen nie still durchwinken: sie müssen bei Abweichung rot werden. */
import { describe, expect, test } from "vitest";
import { erwarteFall, erwarteSolidJeBoden, erwarteVariante } from "./support/erwartungen";

type V = { outcome: "a"; x: number } | { outcome: "b"; y: string };
type K = { kind: "s"; idx: number } | { kind: "t" };

const alsV = (v: V): V => v;
const alsK = (k: K): K => k;
const va = alsV({ outcome: "a", x: 1 });
const vb = alsV({ outcome: "b", y: "z" });
const ks = alsK({ kind: "s", idx: 2 });
const kt = alsK({ kind: "t" });

describe("erwarteFall / erwarteVariante", () => {
  test("liefern die passende Variante typisiert zurück", () => {
    expect(erwarteFall(va, "a").x).toBe(1);
    expect(erwarteVariante(ks, "s").idx).toBe(2);
  });

  test("werfen bei einer anderen Variante (Negativfall)", () => {
    expect(() => erwarteFall(vb, "a")).toThrow();
    expect(() => erwarteVariante(kt, "s")).toThrow();
  });
});

describe("erwarteSolidJeBoden", () => {
  const map = { ground: [0, 0, 1, 1], solid: [1, 1, 0, 0] };
  const erwartung = [
    { boden: 0, solid: 1 as const, name: "Wasser" },
    { boden: 1, solid: 0 as const, name: "Land" },
  ];

  test("passt: alle Böden tragen den erwarteten solid-Wert", () => {
    expect(() => erwarteSolidJeBoden(map, erwartung)).not.toThrow();
  });

  test("rot bei falschem solid-Wert, bei fehlendem Boden und ohne Ausnahme für die Kachel", () => {
    expect(() => erwarteSolidJeBoden({ ground: map.ground, solid: [1, 0, 0, 0] }, erwartung)).toThrow();
    expect(() => erwarteSolidJeBoden(map, [{ boden: 9, solid: 0, name: "gibt es nicht" }])).toThrow();
    const kaputt = { ground: map.ground, solid: [1, 1, 0, 1] };
    expect(() => erwarteSolidJeBoden(kaputt, erwartung)).toThrow();
    expect(() => erwarteSolidJeBoden(kaputt, erwartung, new Set([3]))).not.toThrow();
  });
});

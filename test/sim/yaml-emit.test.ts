import { describe, it, expect } from "vitest";
import { emitYaml, sortedKeys } from "../../src/sim/yaml-emit";
import { parseYamlDocuments, type YamlValue } from "../../src/sim/yaml";
import { mulberry32 } from "../../src/core/rng";

const roundTrip = (v: YamlValue): YamlValue[] => parseYamlDocuments(emitYaml(v));

describe("emitYaml – Layout wie kubectl", () => {
  it("verschachtelt, Sequenz-Strich auf Schlüssel-Höhe, `- k: v` mit Folgeschlüsseln", () => {
    const v = { spec: { ports: [{ port: 80, protocol: "TCP" }, { port: 81, protocol: "TCP" }] }, metadata: { name: "web" } };
    expect(emitYaml(v)).toBe([
      "metadata:",
      "  name: web",
      "spec:",
      "  ports:",
      "  - port: 80",
      "    protocol: TCP",
      "  - port: 81",
      "    protocol: TCP",
    ].join("\n"));
  });

  it("leere Strukturen als {} und [], null als null", () => {
    expect(emitYaml({ a: {}, b: [], c: null })).toBe("a: {}\nb: []\nc: null");
    expect(emitYaml({})).toBe("{}");
    expect(emitYaml([])).toBe("[]");
  });

  it("Sequenz in Sequenz als `- - x`, Liste auf oberster Ebene", () => {
    expect(emitYaml([["x", "q"], "z"])).toBe("- - x\n  - q\n- z");
    expect(emitYaml({ a: [["x"]] })).toBe("a:\n- - x");
  });

  it("eine Liste als erster Wert eines Listen-Mappings bleibt auf Schlüssel-Höhe", () => {
    expect(emitYaml([{ ports: [80], name: "a" }])).toBe("- name: a\n  ports:\n  - 80");
  });
});

describe("emitYaml – Schlüsselordnung (go-yaml)", () => {
  it("apiVersion < items < kind < metadata", () => {
    expect(sortedKeys({ metadata: 1, kind: 1, items: 1, apiVersion: 1 })).toEqual(["apiVersion", "items", "kind", "metadata"]);
  });
  it("Ziffernfolgen zählen numerisch: a9 vor a10", () => {
    expect(sortedKeys({ a10: 1, a9: 1, a2: 1 })).toEqual(["a2", "a9", "a10"]);
  });
  it("Großbuchstaben vor Kleinbuchstaben, Nicht-Buchstabe vor Buchstabe", () => {
    expect(sortedKeys({ a: 1, Z: 1, "-x": 1, _y: 1 })).toEqual(["-x", "_y", "Z", "a"]);
  });
  it("führende Null zählt als Ziffernfolge ohne Vorrang: a1 vor a01 (gleicher Wert, kürzer zuerst)", () => {
    expect(sortedKeys({ a01: 1, a1: 1 })).toEqual(["a1", "a01"]);
  });
  it("Null hinter einer Ziffer ungleich null gehört zur Zahl: a19 vor a100, a1009 vor a1010", () => {
    expect(sortedKeys({ a100: 1, a19: 1 })).toEqual(["a19", "a100"]);
    expect(sortedKeys({ a1010: 1, a1009: 1 })).toEqual(["a1009", "a1010"]);
    expect(sortedKeys({ a10009: 1, a1015: 1 })).toEqual(["a1015", "a10009"]); // die Nullfolge zählt rückwärts bis zur ersten Ziffer ungleich null
  });
  it("ein Präfix kommt vor dem längeren Schlüssel", () => {
    expect(sortedKeys({ app2: 1, app: 1 })).toEqual(["app", "app2"]);
  });
});

describe("emitYaml – Quoting", () => {
  const cases: [string, string][] = [
    ["", '""'], ["80", '"80"'], ["1.5", '"1.5"'], ["true", '"true"'], ["null", '"null"'], ["~", '"~"'], ["yes", '"yes"'],
    ["0x1F", '"0x1F"'], ["1e3", '"1e3"'], ["a: b", "'a: b'"], ["-x", "-x"], ["- x", "'- x'"], ["#c", "'#c'"], ["a #b", "'a #b'"],
    ["x:", "'x:'"], ["'q", "'''q'"], ["@a", "'@a'"], ["a\nb", '"a\\nb"'], ["None", "None"], ["Größe", "Größe"], ["250m", "250m"],
    ["10Gi", "10Gi"], [" a", "' a'"], ["---", "'---'"], ["[a]", "'[a]'"], ["|", "'|'"], ["-", "'-'"], ["2024-01-02", '"2024-01-02"'], ["1:30", '"1:30"'], ["0o17", '"0o17"'], ["on", '"on"'], ["Off", '"Off"'],
    [".inf", '".inf"'], ["a\tb", '"a\\tb"'],
  ];
  it.each(cases)("Wert %j wird zu %s", (s, text) => {
    expect(emitYaml({ k: s })).toBe("k: " + text);
  });

  it("Schlüssel folgen denselben Regeln", () => {
    expect(emitYaml({ "a: b": 1, "": 2, "80": 3 })).toBe("\"\": 2\n\"80\": 3\n'a: b': 1");
  });

  it("negative und gebrochene Zahlen, Booleans", () => {
    expect(emitYaml({ a: -3, b: 1.5, c: 0, d: true, e: false })).toBe("a: -3\nb: 1.5\nc: 0\nd: true\ne: false");
  });
});

describe("emitYaml – Negativfälle (Programmierfehler)", () => {
  it.each([[NaN], [Infinity], [1e21], [1e-7]])("Zahl %s wirft", n => {
    expect(() => emitYaml({ n })).toThrow(/Parser-Teilmenge/);
  });
  it("undefined und Funktionen werfen", () => {
    expect(() => emitYaml(undefined as never)).toThrow(/kein YamlValue/);
    expect(() => emitYaml({ f: (() => 1) as never })).toThrow(/kein YamlValue/);
  });
  it("ein Steuerzeichen ohne Escape im Parser wirft", () => {
    expect(() => emitYaml({ s: "a\u0001b" })).toThrow(/Steuerzeichen/);
  });
});

describe("emitYaml – Round-Trip mit dem Parser", () => {
  const edge = ["", "80", "true", "null", "a: b", "-x", "- x", "x:", "'q", '"q"', "a #b", "#c", "1e3", "0x1F", "yes", "~", "-", "---", "[a, b]", "{a}",
    "a\nb", "a\tb", "back\\slash", " lead", "trail ", "1.5", "-3", "+4", "10Gi", "250m", "Größe ✓", "a:b", "= x", "? x", "|", ">", "*a", "&a", "!a", "%a", "@a", "`a"];

  it.each(edge)("Grenzfall %j überlebt als Wert, Schlüssel und Listenelement", s => {
    expect(roundTrip({ [s]: s })).toEqual([{ [s]: s }]);
    expect(roundTrip([s, [s]])).toEqual([[s, [s]]]);
    expect(roundTrip(s)).toEqual([s]);
  });

  it("Property: mehrere hundert zufällige Werte (geseedet)", () => {
    const rnd = mulberry32(1467);
    const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)];
    const word = (): string => pick(edge);
    const value = (depth: number): YamlValue => {
      const k = Math.floor(rnd() * (depth >= 4 ? 5 : 8));
      if (k === 0) return null;
      if (k === 1) return rnd() < 0.5;
      if (k === 2) return pick([0, 1, -7, 80, 1.5, 0.25, 65535, -0.5]);
      if (k <= 4) return word();
      if (k <= 6) return Array.from({ length: Math.floor(rnd() * 4) }, () => value(depth + 1));
      const o: { [key: string]: YamlValue } = {};
      for (let i = Math.floor(rnd() * 4); i > 0; i--) o[word()] = value(depth + 1);
      return o;
    };
    for (let i = 0; i < 400; i++) {
      const v = value(0);
      const docs = roundTrip(v);
      expect(docs, emitYaml(v)).toEqual([v]);
    }
  });
});

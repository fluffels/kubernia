/* Reine Sim-Helfer (sim/util.ts) – seit #499 sind die früheren `_editDistance`/`_suggest`-
 * Methoden pure Funktionen (kein Cluster-Zustand). Diese Tests
 * sichern ihr Verhalten inkl. Grenz-/Negativfälle direkt an der öffentlichen Funktion ab,
 * statt sie nur indirekt über die Befehlsfamilien mitzuprüfen. */
import { describe, test, expect } from "vitest";
import { editDistance, suggest, parseCpuMilli } from "../../src/sim/util";

describe("editDistance – Levenshtein", () => {
  test("gleiche Strings: Distanz 0", () => {
    expect(editDistance("kubectl", "kubectl")).toBe(0);
  });
  test("eine Ersetzung / ein Einschub / leerer String", () => {
    expect(editDistance("kubectl", "kubektl")).toBe(1); // ein Buchstabe ersetzt (c→k)
    expect(editDistance("helm", "hlm")).toBe(1);        // ein fehlender Buchstabe
    expect(editDistance("", "abc")).toBe(3);            // leer → 3 Einfügungen
  });
});

describe("suggest – Meintest-du-Vorschlag", () => {
  const cmds = ["docker", "kubectl", "helm", "terraform", "git"];
  test("naher Tippfehler wird korrigiert", () => {
    expect(suggest("kubctl", cmds)).toBe("kubectl");
    expect(suggest("dockr", cmds)).toBe("docker");
  });
  test("exakter Treffer gibt NICHT sich selbst zurück (Distanz 0 → null)", () => {
    expect(suggest("git", cmds)).toBeNull();
  });
  test("zu weit weg → null (kurze Wörter strenger: limit 1)", () => {
    expect(suggest("xyz", cmds)).toBeNull();
  });
  test("längere Wörter erlauben Distanz bis 2", () => {
    expect(suggest("terrafrm", cmds)).toBe("terraform"); // 1 fehlend
  });
});

describe("parseCpuMilli – CPU-Menge in Milli-Cores", () => {
  test("Milli-Schreibweise, ganze und gebrochene Cores", () => {
    expect(parseCpuMilli("250m")).toBe(250);
    expect(parseCpuMilli("1")).toBe(1000);
    expect(parseCpuMilli("0.5")).toBe(500);
    expect(parseCpuMilli("0.125")).toBe(125);
  });
  test("Unsinn und zu feine Nachkommastellen → null", () => {
    for (const bad of ["", "zwei", "m", "250M", "250mi", "-1", "1.5m", "0.0001", "1.", ".5", "1e3"]) expect(parseCpuMilli(bad), bad).toBeNull();
  });
});

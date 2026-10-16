import { describe, expect, test } from "vitest";
import { esc } from "../src/ui/html-escape";
import { esc as escDev } from "../src/devpanel";

/** HTML-Escape der UI (#1693 L11): muss Text- und Attributkontext (`"` und `'`) abdecken, sonst bricht ein Wert aus `data-arg="…"` aus. */
describe.each([
  ["ui/html-escape", esc],
  ["devpanel (Kopie)", escDev],
])("esc (%s)", (_name, f) => {
  test("maskiert & < > \" '", () => {
    expect(f(`a&b<c>d"e'f`)).toBe("a&amp;b&lt;c&gt;d&quot;e&#39;f");
  });
  test("Anführungszeichen können ein Attribut nicht beenden", () => {
    expect(f(`x" onmouseover="alert(1)`)).not.toContain('"');
    expect(f(`x' onmouseover='alert(1)`)).not.toContain("'");
  });
  test("& wird zuerst maskiert: kein doppeltes Escaping der eigenen Entities", () => {
    expect(f("&quot;")).toBe("&amp;quot;");
  });
  test("Nicht-Strings und Leerwerte", () => {
    expect(f(42)).toBe("42");
    expect(f(null)).toBe("null");
    expect(f("")).toBe("");
  });
});

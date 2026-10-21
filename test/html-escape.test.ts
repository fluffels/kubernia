import { describe, expect, test } from "vitest";
import { esc as f } from "../src/core/html-escape";

/** HTML-Escape (einzige Quelle für UI und Dev-Panel): muss Text- und Attributkontext (`"` und `'`) abdecken, sonst bricht ein Wert aus `data-arg="…"` aus. */
describe("esc", () => {
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
  test("Negativfall: jedes Vorkommen wird maskiert, nicht nur das erste (#1684)", () => {
    expect(f(`""''&&<<>>`)).toBe("&quot;&quot;&#39;&#39;&amp;&amp;&lt;&lt;&gt;&gt;");
    expect(f(`a="1" b="2"`)).toBe("a=&quot;1&quot; b=&quot;2&quot;");
  });
});

import { describe, expect, test } from "vitest";
import { mitSafecrlfAus } from "./support/git-umgebung";

describe("mitSafecrlfAus (#1428 Z1)", () => {
  test("ohne Zähler: Eintrag 0", () => {
    const e = mitSafecrlfAus({});
    expect(e.GIT_CONFIG_COUNT).toBe("1");
    expect(e.GIT_CONFIG_KEY_0).toBe("core.safecrlf");
    expect(e.GIT_CONFIG_VALUE_0).toBe("false");
  });
  test("gesetzter Zähler 2: Eintrag 2 wird angehängt, die alten bleiben", () => {
    const e = mitSafecrlfAus({ GIT_CONFIG_COUNT: "2", GIT_CONFIG_KEY_0: "a.b", GIT_CONFIG_VALUE_0: "x" });
    expect(e.GIT_CONFIG_COUNT).toBe("3");
    expect(e.GIT_CONFIG_KEY_2).toBe("core.safecrlf");
    expect(e.GIT_CONFIG_KEY_0).toBe("a.b");
  });
  test("kaputter Zähler: wie keiner", () => {
    const e = mitSafecrlfAus({ GIT_CONFIG_COUNT: "abc" });
    expect(e.GIT_CONFIG_COUNT).toBe("1");
    expect(e.GIT_CONFIG_KEY_0).toBe("core.safecrlf");
  });
  test("das Setup wirkt im Testprozess", () => {
    expect(process.env.KQ_GIT_SAFECRLF).toBe("1");
    expect(Object.values(process.env)).toContain("core.safecrlf");
  });
});

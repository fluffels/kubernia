/* @harness-waechter
 * Regex-Hilfen der Kern-Tests (#1906): Escape und Ganzes-Wort-Matcher. */
import { describe, test } from "vitest";
import assert from "node:assert/strict";
import { escapeRe, ganzesWortRe } from "../support/regex";

describe("escapeRe", () => {
  test("Metazeichen wirken nur als Text", () => {
    assert.equal(new RegExp(`^${escapeRe("a.b+c(d)")}$`).test("a.b+c(d)"), true);
    assert.equal(new RegExp(`^${escapeRe("a.b")}$`).test("axb"), false);
  });
});

describe("ganzesWortRe", () => {
  test("trifft das ganze Wort, auch zwischen Nicht-Buchstaben", () => {
    assert.equal(ganzesWortRe(["phaser"]).test("Phaser.Scene"), true);
    assert.equal(ganzesWortRe(["phaser", "hof"]).test("im Hof"), true);
  });
  test("trifft nicht als Teil eines Worts (Buchstabe, Ziffer, Unterstrich, Umlaut davor oder dahinter)", () => {
    for (const s of ["phaserx", "xphaser", "phaser2", "_phaser", "phaserä", "äphaser"]) assert.equal(ganzesWortRe(["phaser"]).test(s), false, s);
  });
  test("mehrere Wörter: die Wortgrenze gilt für jedes, nicht nur für das erste und letzte Ende", () => {
    for (const s of ["phaserx", "xhof", "xphaser", "hofx"]) assert.equal(ganzesWortRe(["phaser", "hof"]).test(s), false, s);
    assert.equal(ganzesWortRe(["phaser", "hof"]).test("hof"), true);
  });
  test("Wörter mit Metazeichen werden maskiert", () => {
    assert.equal(ganzesWortRe(["a.b"]).test("axb"), false);
    assert.equal(ganzesWortRe(["a.b"]).test("a.b"), true);
  });
  test("Flags: Standard ignoriert Groß-/Kleinschreibung, eigene Flags gelten", () => {
    assert.equal(ganzesWortRe(["hof"]).test("HOF"), true);
    assert.equal(ganzesWortRe(["hof"], "u").test("HOF"), false);
  });
});

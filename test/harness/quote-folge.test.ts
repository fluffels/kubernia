/* Quote-Zerlegung des gh-Guards (#1311) — Zustand je Zeichen.
 *
 * @harness-waechter – Struktur-Wächter für scripts/quote-folge.mjs: der gh-Guard stützt Segmentierung, Variablen-Suche,
 * Endpunkt und Interpreter-String auf diese Zerlegung, darum liegt der Test im geschützten test/harness/.
 *
 * Ausführen mit: npm test
 */
import { describe, test } from "vitest";
import assert from "node:assert/strict";

type Zeichen = { i: number; c: string; q: string | null; masked: boolean };
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as raw from "../../scripts/quote-folge.mjs";
const quoteFolge = (raw as { quoteFolge: (t: string, von?: number, q0?: string | null, escAussen?: boolean) => Zeichen[] & { ende: string | null } }).quoteFolge;

const zustand = (text: string, ...args: [number?, (string | null)?, boolean?]) => quoteFolge(text, ...args).map((z) => `${z.c}${z.q ?? "-"}${z.masked ? "m" : ""}`).join(" ");

describe("quoteFolge (#1311)", () => {
  test("Quote-Zustand VOR dem Zeichen; das öffnende und das schließende Quote tragen den alten Zustand", () => {
    assert.equal(zustand(`a'b'c`), "a- '- b' '' c-");
    assert.equal(zustand(`a"b"c`), `a- "- b" "" c-`);
  });

  test("in Single Quotes maskiert nichts, in Double Quotes und außerhalb \\ und Backtick", () => {
    assert.equal(quoteFolge("'\\$'").find((z) => z.c === "$")?.masked, false, "in Single Quotes ist \\ ein normales Zeichen");
    const dq = quoteFolge('"\\$a"');
    assert.equal(dq.find((z) => z.c === "$")?.masked, true);
    const aussen = quoteFolge("\\$a");
    assert.equal(aussen.find((z) => z.c === "$")?.masked, true);
    assert.equal(quoteFolge("`$a").find((z) => z.c === "$")?.masked, true, "PowerShell-Backtick");
  });

  test("escAussen: false maskiert außerhalb von Quotes nichts (PowerShell-Pfade), innerhalb von Double Quotes weiter", () => {
    assert.equal(quoteFolge("C:\\dev\\;", 0, null, false).some((z) => z.masked), false);
    assert.equal(quoteFolge('"a\\"b"', 0, null, false).some((z) => z.masked), true);
  });

  test("Startzustand und Endzustand: .ende meldet ein offenes Quote, q0 startet mitten im Quote", () => {
    assert.equal(quoteFolge("a'b").ende, "'");
    assert.equal(quoteFolge("a'b'").ende, null);
    assert.equal(quoteFolge("x y", 0, '"').find((z) => z.c === " ")?.q, '"');
    assert.equal(quoteFolge("abc", 1).length, 2, "von: Start hinter dem Anfang");
  });
});

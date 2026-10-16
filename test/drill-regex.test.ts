/* escapeRegExp (#1703): variable Teile einer accept-Regex dürfen nie als Muster wirken. */
import { test } from "vitest";
import assert from "node:assert/strict";
import { escapeRegExp } from "../src/content/drills/shared";
import { KQContent } from "../src/content";
import { Sim as KQSim } from "../src/sim";

test("escapeRegExp escaped jedes Regex-Metazeichen", () => {
  for (const ch of ".*+?^${}()|[]\\".split("")) {
    assert.equal(escapeRegExp(ch), "\\" + ch, `Zeichen ${ch}`);
  }
});

test("escapeRegExp: Rundlauf, Muster matcht genau den Originaltext", () => {
  for (const s of ["a.b", "1.27", "ghcr.io", "x(y)", "a\\b", "a\\", "a-b", "lotsen-app"]) {
    const re = new RegExp("^" + escapeRegExp(s) + "$");
    assert.ok(re.test(s), s);
  }
});

test("escapeRegExp: Wildcard-Punkt und Quantor wirken nicht als Muster", () => {
  assert.equal(new RegExp("^" + escapeRegExp("1.27") + "$").test("1x27"), false);
  assert.equal(new RegExp("^" + escapeRegExp("a+") + "$").test("aa"), false);
  assert.equal(new RegExp("^" + escapeRegExp("a|b") + "$").test("a"), false);
});

test("escapeRegExp nimmt auch Zahlen", () => {
  assert.equal(escapeRegExp(3), "3");
});

test("jeder Drill akzeptiert seine eigene Lösung (8 Ziehungen)", () => {
  const fehler: string[] = [];
  for (const [id, make] of Object.entries(KQContent.DRILLS)) {
    for (let i = 0; i < 8; i++) {
      const t = make(new KQSim({}));
      if (!t.accept.some(re => re.test(t.solution))) fehler.push(`${id}: „${t.solution}“`);
    }
  }
  assert.deepEqual(fehler, []);
});

test("Drill-Ebene: ein Punkt in Datei-, Tag- und Registry-Namen ist kein Wildcard", () => {
  const add = KQContent.DRILLS["git-add"](new KQSim({}));
  assert.ok(add.accept.some(re => re.test(add.solution)));
  assert.equal(add.accept.some(re => re.test(add.solution.replace(".md", "xmd"))), false);
  const reg = KQContent.DRILLS["docker-pull-registry"](new KQSim({}));
  assert.ok(reg.accept.some(re => re.test(reg.solution)));
  assert.equal(reg.accept.some(re => re.test(reg.solution.replace(".io", "xio"))), false);
});

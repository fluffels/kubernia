/* escapeRegExp (#1703): variable Teile einer accept-Regex dürfen nie als Muster wirken. */
import { test } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
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
  // Tag: bei jeder Ziehung mit Punkt im Tag (1.0, 1.27, 3.19) darf „x“ statt „.“ nicht passen; mindestens eine Ziehung enthält einen Punkt.
  let mitPunkt = 0;
  for (let i = 0; i < 60; i++) {
    const ver = KQContent.DRILLS["docker-pull-version"](new KQSim({}));
    assert.ok(ver.accept.some(re => re.test(ver.solution)));
    const tag = ver.solution.split(":")[1];
    if (!tag.includes(".")) continue;
    mitPunkt++;
    assert.equal(ver.accept.some(re => re.test(ver.solution.replace(".", "x"))), false, ver.solution);
  }
  assert.ok(mitPunkt > 0, "keine Ziehung mit Punkt im Tag");
});

/** Fitness-Wächter (#1693 L34): in `new RegExp(...)` eines Drills darf kein variabler Teil (`+ name`) ohne `escapeRegExp(...)` stehen. Pur. */
function ungeschuetzteTeile(quelltext: string): string[] {
  const funde: string[] = [];
  for (const m of quelltext.matchAll(/new RegExp\(/g)) {
    let tiefe = 1;
    let i = (m.index ?? 0) + m[0].length;
    const start = i;
    let imString: string | null = null;
    for (; i < quelltext.length && tiefe > 0; i++) {
      const c = quelltext[i];
      if (imString) {
        if (c === "\\") i++;
        else if (c === imString) imString = null;
      } else if (c === '"' || c === "'") imString = c;
      else if (c === "(") tiefe++;
      else if (c === ")") tiefe--;
    }
    let arg = quelltext.slice(start, i - 1);
    // escapeRegExp(<...>) samt Inhalt entfernen (Inhalt ist geschützt), String-Literale leeren.
    for (let n = 0; n < 50 && arg.includes("escapeRegExp("); n++) {
      const p = arg.indexOf("escapeRegExp(");
      let t = 1;
      let j = p + "escapeRegExp(".length;
      for (; j < arg.length && t > 0; j++) {
        if (arg[j] === "(") t++;
        else if (arg[j] === ")") t--;
      }
      arg = arg.slice(0, p) + "GESCHUETZT" + arg.slice(j);
    }
    const ohneStrings = arg.replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g, '""');
    if (/\+\s*(?!GESCHUETZT)[A-Za-z_]/.test(ohneStrings)) funde.push(arg.slice(0, 80));
  }
  return funde;
}

test("Wächter ungeschuetzteTeile: erkennt ein vergessenes escapeRegExp (Negativfälle)", () => {
  assert.deepEqual(ungeschuetzteTeile('new RegExp("^a\\s+" + escapeRegExp(img) + "$")'), []);
  assert.equal(ungeschuetzteTeile('new RegExp("^a\\s+" + img + "$")').length, 1);
  assert.equal(ungeschuetzteTeile('new RegExp("^a" + escapeRegExp(x) + ":" + tag)').length, 1);
  assert.equal(ungeschuetzteTeile('new RegExp("a" + o.name)').length, 1);
  assert.deepEqual(ungeschuetzteTeile('new RegExp("^docker\\s+" + escapeRegExp(f(x, "(")) + "$")'), []);
  assert.deepEqual(ungeschuetzteTeile("const x = 1;"), []);
});

test("Wächter: alle accept-Regex der Drills schützen variable Teile mit escapeRegExp", () => {
  const dir = join(import.meta.dirname, "..", "src", "content", "drills");
  const dateien = readdirSync(dir).filter(n => n.endsWith(".ts"));
  assert.ok(dateien.length > 5);
  const fehler: string[] = [];
  let regexe = 0;
  for (const n of dateien) {
    const q = readFileSync(join(dir, n), "utf8");
    regexe += (q.match(/new RegExp\(/g) ?? []).length;
    for (const f of ungeschuetzteTeile(q)) fehler.push(n + ": " + f);
  }
  assert.ok(regexe > 20, "zu wenige new RegExp gefunden: " + regexe);
  assert.deepEqual(fehler, []);
});

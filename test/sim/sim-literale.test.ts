/* Domänen-Fitness (#1483): Selektor-Konvention, Node-Namen und das Alter der eingebauten Objekte stehen je
 * einmal in src/sim/util.ts (`workloadSelector`, `CONTROL_PLANE_NODE`/`workerNodeName`, `BUILTIN_AGE`),
 * nicht als Literal an jeder Stelle. Der Test sucht in String-Literalen (Kommentare und Doc-Texte
 * zählen nicht), damit eine neue Handschreibweise rot wird. */
import { test, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

function tsFiles(dir: string): string[] {
  return readdirSync(dir).flatMap(f => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? tsFiles(p) : p.endsWith(".ts") ? [p] : [];
  });
}
const files = [...tsFiles("src/sim"), "src/sim.ts"].filter(f => f.replace(/\\/g, "/") !== "src/sim/util.ts");

/** Alle String-Literale (", ', `) einer Datei, ohne Zeilenkommentare. */
function literale(src: string): string[] {
  const ohne = src.split("\n").filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).map(l => l.replace(/\s\/\/.*$/, "")).join("\n");
  return [...ohne.matchAll(/"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`/g)].map(m => m[0]);
}
const treffer = (re: RegExp) => files.flatMap(f => literale(readFileSync(f, "utf8")).filter(l => re.test(l)).map(l => f + ": " + l));

test("kein handgeschriebenes app=<name> (workloadSelector)", () => {
  expect(treffer(/app=/)).toEqual([]);
});
test("kein Literal ahoi-control / ahoi-worker- (CONTROL_PLANE_NODE, workerNodeName)", () => {
  expect(treffer(/ahoi-control|ahoi-worker-/)).toEqual([]);
});
test("kein Literal \"3d\" (BUILTIN_AGE)", () => {
  expect(treffer(/^["']3d["']$/)).toEqual([]);
});

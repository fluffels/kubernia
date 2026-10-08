/* Domänen-Fitness (#1483, #1497): Selektor-Konvention, Node-Namen, Control-Plane-Adresse und das Alter der
 * eingebauten Objekte stehen je einmal in ihrer Heimatdatei (`workloadSelector`/`BUILTIN_AGE` in src/sim/util.ts,
 * `CONTROL_PLANE_NODE`/`workerNodeName`/`CONTROL_PLANE_IP` in src/sim/nodes.ts), nicht als Literal an jeder Stelle.
 * Der Test liest den TypeScript-Syntaxbaum: String-, Template- und per `+` zerlegte Literale zählen,
 * Kommentare (auch Blockkommentare und JSDoc) und Regex-Literale nicht.
 * Bekannte Grenze: Strings, die über Variablen zusammengesetzt werden, sieht der Test nicht (Stichprobe,
 * keine Datenflussanalyse). */
import { test, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import * as ts from "typescript";

function tsFiles(dir: string): string[] {
  return readdirSync(dir).flatMap(f => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? tsFiles(p) : p.endsWith(".ts") ? [p] : [];
  });
}
const alle = [...tsFiles("src/sim"), "src/sim.ts"];

const istText = (n: ts.Node): n is ts.StringLiteral | ts.NoSubstitutionTemplateLiteral =>
  ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n);

/** Operanden einer `+`-Kette, von links nach rechts. */
function plusOperanden(n: ts.Expression): ts.Expression[] {
  if (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.PlusToken) return [...plusOperanden(n.left), ...plusOperanden(n.right)];
  return [n];
}

/** Alle Literal-Texte einer Quelle: jedes String-/Template-Stück einzeln plus die Verkettung aufeinanderfolgender
 *  Literal-Operanden einer `+`-Kette (`"ahoi-" + "worker-" + n` liefert auch `ahoi-worker-`). */
function literale(src: string): string[] {
  const out: string[] = [];
  const sf = ts.createSourceFile("x.ts", src, ts.ScriptTarget.Latest, true);
  const visit = (n: ts.Node): void => {
    if (istText(n)) out.push(n.text);
    else if (ts.isTemplateExpression(n)) out.push(n.head.text, ...n.templateSpans.map(s => s.literal.text));
    if (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.PlusToken) {
      let lauf = "";
      let laenge = 0;
      const flush = () => { if (laenge >= 2) out.push(lauf); lauf = ""; laenge = 0; };
      for (const o of plusOperanden(n)) {
        if (istText(o)) { lauf += o.text; laenge++; } else flush();
      }
      flush();
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

test("Extraktor: findet Literale nach Blockkommentar, zerlegte Strings und Templates", () => {
  expect(literale('/* x */ const a = "app=" + b;')).toContain("app=");
  expect(literale('const a = "ahoi-" + "worker-" + n;')).toContain("ahoi-worker-");
  expect(literale("const a = `ahoi-control`;")).toContain("ahoi-control");
  expect(literale("const a = `ahoi-${n}-x`;")).toEqual(expect.arrayContaining(["ahoi-", "-x"]));
});

test("Extraktor: Kommentare und Regex-Literale zählen nicht, ein Regex mit Anführungszeichen stört nicht", () => {
  expect(literale('// "app=x"\nconst a = 1;')).toEqual([]);
  expect(literale('/* "app=x" */ const a = 1;')).toEqual([]);
  expect(literale('/**\n * "app=x"\n */\nconst a = 1;')).toEqual([]);
  expect(literale('const r = /"app=/; const b = "ok";')).toEqual(["ok"]);
});

/** Treffer in allen sim-Dateien außer der Heimatdatei; verglichen wird der Literal-Text. */
const treffer = (re: RegExp, heimat: string) =>
  alle.filter(f => f.replace(/\\/g, "/") !== heimat)
    .flatMap(f => literale(readFileSync(f, "utf8")).filter(l => re.test(l)).map(l => f + ": " + l));

test("kein handgeschriebenes app=<name> (workloadSelector)", () => {
  expect(treffer(/app=/, "src/sim/util.ts")).toEqual([]);
});
test("kein Literal ahoi-control / ahoi-worker- (CONTROL_PLANE_NODE, workerNodeName)", () => {
  expect(treffer(/ahoi-control|ahoi-worker-/, "src/sim/nodes.ts")).toEqual([]);
});
test("kein Literal \"3d\" (BUILTIN_AGE)", () => {
  expect(treffer(/^3d$/, "src/sim/util.ts")).toEqual([]);
});
test("kein Literal 10.0.0.10 (CONTROL_PLANE_IP)", () => {
  expect(treffer(/10\.0\.0\.10/, "src/sim/nodes.ts")).toEqual([]);
});

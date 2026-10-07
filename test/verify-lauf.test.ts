/* Zwei-Stufen-Prüfung (#1120): Verhalten von scripts/verify-lauf.mjs (Kette, Einengung, Bericht, Exit). Spawn/git sind injiziert. */
import { describe, test } from "vitest";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as vlModule from "../scripts/verify-lauf.mjs";

type Job = { art: "npm"; schritt: string } | { art: "node"; args: string[] };
type Erg = { name: string; ok: boolean; exit?: number; ms: number; ausgabe?: string; info?: string; uebersprungen?: boolean };
type Eng = { voll: true; grund: string } | { voll: false; lint: string[]; related: string[]; perName: string[] };
const vl = vlModule as {
  ketteAusPackage: (pkg: unknown) => string[];
  bestimmeEngung: (a: { base: string | null; dateien?: string[]; tests?: { pfad: string; text: string }[] }) => Eng;
  kuerze: (t: string, s: string) => string;
  bericht: (e: Erg[], o?: { modus?: string; hinweis?: string }) => string;
  laufe: (a: { schritte: string[]; engung?: Eng | null; run: (j: Job) => { status: number; output: string }; jetzt?: () => number }) => Erg[];
};
const pkg = JSON.parse(readFileSync("package.json", "utf8")) as { scripts: Record<string, string> };

describe("Kette", () => {
  test("Schritte kommen aus package.json › verify; ein neuer Schritt läuft in beiden Modi mit", () => {
    const schritte = vl.ketteAusPackage(pkg);
    assert.ok(schritte.includes("lint") && schritte.includes("test") && schritte.includes("typecheck"));
    const neu = vl.ketteAusPackage({ scripts: { ...pkg.scripts, verify: `${pkg.scripts.verify} && npm run check:fake` } });
    assert.equal(neu.at(-1), "check:fake");
    const gesehen: string[] = [];
    const eng: Eng = { voll: false, lint: ["a.ts"], related: ["a.ts"], perName: [] };
    for (const engung of [null, eng]) {
      gesehen.length = 0;
      vl.laufe({ schritte: neu, engung, run: (j) => (gesehen.push(j.art === "npm" ? j.schritt : "x"), { status: 0, output: "" }) });
      assert.ok(gesehen.includes("check:fake"), "unbekannter Schritt läuft voll");
    }
  });
  test("Negativ: Shell-Zeichen im Schrittnamen und fehlendes verify werfen", () => {
    assert.throws(() => vl.ketteAusPackage({ scripts: { verify: "npm run a;b && npm run c" } }), /Shell/);
    assert.throws(() => vl.ketteAusPackage({ scripts: {} }), /verify/);
  });
});

describe("Einengung (--changed)", () => {
  const tests = [
    { pfad: "test/a.test.ts", text: "liest docs/foo.md" },
    { pfad: "test/b.test.ts", text: "nichts" },
  ];
  test("Lint nur lintbare Dateien; .md zieht per Namen genau die lesenden Tests nach", () => {
    const e = vl.bestimmeEngung({ base: "abc", dateien: ["src/x.ts", "docs/foo.md", "scripts/s.mjs"], tests });
    assert.equal(e.voll, false);
    if (e.voll) return;
    assert.deepEqual(e.lint, ["src/x.ts", "scripts/s.mjs"]);
    assert.deepEqual(e.related, ["src/x.ts", "docs/foo.md", "scripts/s.mjs"]);
    assert.deepEqual(e.perName, ["test/a.test.ts"]);
  });
  test("Lint ohne lintbare Datei: übersprungen und ok, nicht rot", () => {
    const e = vl.bestimmeEngung({ base: "abc", dateien: ["docs/foo.md"], tests });
    const r = vl.laufe({ schritte: ["lint"], engung: e, run: () => assert.fail("kein Lint-Lauf erwartet") });
    assert.equal(r[0].ok, true);
    assert.equal(r[0].uebersprungen, true);
  });
  test("Fail-closed: keine Basis, zu viele Dateien, Konfig geändert → voll mit Grund", () => {
    assert.match((vl.bestimmeEngung({ base: null, dateien: ["a.ts"] }) as { grund: string }).grund, /Basis/);
    const viele = Array.from({ length: 151 }, (_, i) => `src/f${i}.ts`);
    assert.equal(vl.bestimmeEngung({ base: "abc", dateien: viele, tests }).voll, true);
    for (const k of ["package.json", "eslint.config.js", "vite.config.ts", "tsconfig.json", "eslint-suppressions.json", "package-lock.json"]) {
      const e = vl.bestimmeEngung({ base: "abc", dateien: ["src/x.ts", k], tests });
      assert.equal(e.voll, true, k);
    }
    assert.equal(vl.bestimmeEngung({ base: "abc", dateien: Array.from({ length: 150 }, (_, i) => `src/f${i}.ts`), tests }).voll, false);
  });
  test("laufe gibt Lint und Test die eingeengten Argumente, alles andere läuft voll", () => {
    const e = vl.bestimmeEngung({ base: "abc", dateien: ["src/x.ts"], tests });
    const jobs: Job[] = [];
    vl.laufe({ schritte: ["typecheck", "lint", "test"], engung: e, run: (j) => (jobs.push(j), { status: 0, output: "" }) });
    assert.deepEqual(jobs[0], { art: "npm", schritt: "typecheck" });
    assert.deepEqual(jobs[1], { art: "node", args: ["eslint", "--max-warnings", "0", "--no-warn-ignored", "src/x.ts"] });
    assert.deepEqual(jobs[2], { art: "node", args: ["vitest", "related", "--run", "--passWithNoTests", "src/x.ts"] });
  });
});

describe("Lauf und Bericht", () => {
  const schritte = ["typecheck", "lint", "test"];
  test("alle Schritte laufen nach einem Rot weiter; roter Schritt ergibt roten Lauf", () => {
    const gerufen: string[] = [];
    const r = vl.laufe({
      schritte,
      run: (j) => {
        const s = j.art === "npm" ? j.schritt : "?";
        gerufen.push(s);
        return { status: s === "typecheck" ? 2 : 0, output: s };
      },
    });
    assert.deepEqual(gerufen, schritte);
    assert.deepEqual(r.map((x) => x.ok), [false, true, true]);
  });
  test("grün: genau eine Zeile, keine Schrittausgabe", () => {
    const r = vl.laufe({ schritte, run: () => ({ status: 0, output: "GEHEIME GRÜNE AUSGABE" }) });
    const b = vl.bericht(r);
    assert.equal(b.split("\n").length, 1);
    assert.match(b, /^verify:kompakt grün · 3\/3/);
    assert.doesNotMatch(b, /GEHEIME/);
  });
  test("rot: nur der rote Block, Summe als letzte Zeile mit ROT und Liste", () => {
    const r = vl.laufe({ schritte, run: (j) => ({ status: j.art === "npm" && j.schritt === "lint" ? 1 : 0, output: j.art === "npm" ? `Ausgabe-${j.schritt}` : "" }) });
    const b = vl.bericht(r);
    assert.match(b, /── lint: rot \(Exit 1/);
    assert.match(b, /Ausgabe-lint/);
    assert.doesNotMatch(b, /Ausgabe-typecheck|Ausgabe-test/);
    const zeilen = b.split("\n");
    assert.match(zeilen.at(-1) ?? "", /^verify:kompakt ROT · 2\/3 grün .* rot: lint$/);
  });
  test("Kürzung: über 100 Zeilen 80 + 20 mit Hinweis, darunter unverändert", () => {
    const lang = Array.from({ length: 150 }, (_, i) => `z${i}`).join("\n");
    const k = vl.kuerze(lang, "lint").split("\n");
    assert.equal(k.length, 101);
    assert.equal(k[79], "z79");
    assert.equal(k[80], "… 50 Zeilen gekürzt, volle Ausgabe: npm run lint");
    assert.equal(k[100], "z149");
    const kurz = Array.from({ length: 100 }, (_, i) => `z${i}`).join("\n");
    assert.equal(vl.kuerze(kurz, "lint"), kurz);
  });
  test("Hinweis (Fail-closed-Grund) steht in der Summenzeile", () => {
    const r = vl.laufe({ schritte: ["test"], run: () => ({ status: 0, output: "" }) });
    assert.match(vl.bericht(r, { modus: "changed", hinweis: "Lint und Test voll (keine Vergleichs-Basis)" }), /^verify:changed grün .*keine Vergleichs-Basis/);
  });
});

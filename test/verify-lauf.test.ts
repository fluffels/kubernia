/* Zwei-Stufen-Prüfung (#1120): Verhalten von scripts/verify-lauf.mjs (Kette, Einengung, Bericht, Exit). Spawn/git sind injiziert. */
import { describe, expect, test } from "vitest";
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
  exitCode: (e: Erg[]) => number;
  engungSicher: (lade: () => Eng) => Eng;
  statusVon: (r: { status: number | null }) => number;
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
  test("Windows-Pfade mit Rückwärtsschrägstrich in Tests und Dateien werden normalisiert; Selbst-Ausschluss: eine geänderte Testdatei steht nur einmal im Aufruf", () => {
    const e = vl.bestimmeEngung({ base: "abc", dateien: ["docs\\foo.md", "test/a.test.ts"], tests: [{ pfad: "test\\a.test.ts", text: "foo.md" }, { pfad: "test\\c.test.ts", text: "foo.md" }] });
    assert.equal(e.voll, false);
    if (e.voll) return;
    assert.deepEqual(e.perName, ["test/c.test.ts"]);
    assert.deepEqual(e.related, ["docs/foo.md", "test/a.test.ts"]);
    const l = vl.bestimmeEngung({ base: "abc", dateien: ["src\\x.ts"], tests: [] });
    assert.equal(l.voll, false);
    if (!l.voll) assert.deepEqual(l.lint, ["src/x.ts"]);
  });
  test("Fail-closed: wirft das Laden des Slice, laufen Lint und Test voll mit Grund", () => {
    const e = vl.engungSicher(() => {
      throw new Error("git kaputt\nzweite Zeile");
    });
    assert.deepEqual(e, { voll: true, grund: "Slice nicht lesbar: git kaputt" });
    const ok: Eng = { voll: false, lint: [], related: [], perName: [] };
    assert.equal(vl.engungSicher(() => ok), ok);
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
    const e = vl.bestimmeEngung({ base: "abc", dateien: ["src/x.ts", "docs/foo.md"], tests });
    const jobs: Job[] = [];
    vl.laufe({ schritte: ["typecheck", "lint", "test"], engung: e, run: (j) => (jobs.push(j), { status: 0, output: "" }) });
    assert.deepEqual(jobs[0], { art: "npm", schritt: "typecheck" });
    assert.deepEqual(jobs[1], { art: "node", args: ["eslint", "--max-warnings", "0", "--no-warn-ignored", "src/x.ts"] });
    assert.deepEqual(jobs[2], { art: "node", args: ["vitest", "related", "--run", "--passWithNoTests", "src/x.ts", "docs/foo.md", "test/a.test.ts"] });
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
  test("Exit-Code: 0 nur wenn alle ok; ein roter Schritt oder ein übersprungener Lint allein: richtig", () => {
    const ok = { name: "a", ok: true, ms: 0 };
    assert.equal(vl.exitCode([ok, { ...ok, uebersprungen: true }]), 0);
    assert.equal(vl.exitCode([ok, { ...ok, ok: false, exit: 1 }]), 1);
    assert.equal(vl.exitCode([{ ...ok, ok: false }, ok]), 1);
  });
  test("Signal-Abbruch oder Timeout (status null) gilt als rot, nie als grün", () => {
    assert.equal(vl.statusVon({ status: null }), 1);
    assert.equal(vl.statusVon({ status: 0 }), 0);
    assert.equal(vl.statusVon({ status: 3 }), 3);
  });
  test("Bericht nennt übersprungene Schritte und ihre Info", () => {
    const b = vl.bericht([{ name: "lint", ok: true, uebersprungen: true, ms: 0, info: "keine Dateien" }]);
    assert.match(b, /lint übersprungen 0 s \(keine Dateien\)/);
  });
  test("Hinweis (Fail-closed-Grund) steht in der Summenzeile", () => {
    const r = vl.laufe({ schritte: ["test"], run: () => ({ status: 0, output: "" }) });
    assert.match(vl.bericht(r, { modus: "changed", hinweis: "Lint und Test voll (keine Vergleichs-Basis)" }), /^verify:changed grün .*keine Vergleichs-Basis/);
  });
});

describe("main und IO-Verdrahtung (#1428 Z9)", () => {
  type Zugriffe = { git: (a: string[]) => string; existiert: (d: string) => boolean; sammleTests: () => { pfad: string; text: string }[] };
  const io = vlModule as unknown as {
    main: (argv: string[], deps: { pkg: unknown; ladeEngung?: () => Eng; run: (j: Job) => { status: number; output: string }; log: (z: string) => void }) => number;
    ergebnisAusProzess: (r: { status: number | null; stdout?: string; stderr?: string; error?: Error }) => { status: number; output: string };
    ladeEngung: (z: Zugriffe) => Eng;
  };
  const kleinesPkg = { scripts: { verify: "npm run lint && npm run test", lint: "x", test: "y" } };
  const lauf = (argv: string[], run: (j: Job) => { status: number; output: string }, ladeEngung?: () => Eng) => {
    const log: string[] = [];
    const code = io.main(argv, { pkg: kleinesPkg, run, ladeEngung, log: (z) => log.push(z) });
    return { code, log: log.join("\n") };
  };

  test("main: ein roter Schritt gibt Exit 1 (und alle Schritte laufen), alles grün Exit 0", () => {
    const gesehen: string[] = [];
    const rot = lauf([], (j) => (gesehen.push(j.art === "npm" ? j.schritt : "x"), { status: j.art === "npm" && j.schritt === "lint" ? 2 : 0, output: "boom" }));
    expect(rot.code).toBe(1);
    expect(gesehen).toEqual(["lint", "test"]);
    expect(rot.log).toMatch(/verify:kompakt ROT/);
    expect(lauf([], () => ({ status: 0, output: "" })).code).toBe(0);
  });

  test("ergebnisAusProzess: status null (Signal, Timeout, Startfehler) ist rot und nennt den Fehler", () => {
    const r = io.ergebnisAusProzess({ status: null, stdout: "a", error: new Error("ETIMEDOUT") });
    expect(r.status).toBe(1);
    expect(r.output).toContain("ETIMEDOUT");
    expect(io.ergebnisAusProzess({ status: 0, stdout: "ok" })).toEqual({ status: 0, output: "ok" });
  });

  test("--changed mit werfendem git: Lint und Test voll, Grund im Bericht", () => {
    const zugriffe: Zugriffe = {
      git: (a) => {
        if (a[0] === "merge-base") return "abc123";
        throw new Error("git kaputt");
      },
      existiert: () => true,
      sammleTests: () => [],
    };
    const e = io.ladeEngung(zugriffe);
    expect(e).toMatchObject({ voll: true });
    expect((e as { grund: string }).grund).toMatch(/Slice nicht lesbar: git kaputt/);
    const r = lauf(["--changed"], () => ({ status: 0, output: "" }), () => e);
    expect(r.log).toContain("Lint und Test voll (Slice nicht lesbar");
  });

  test("--changed ohne Vergleichs-Basis: voll; mit Basis eingeengt", () => {
    const ohne: Zugriffe = { git: () => { throw new Error("kein git"); }, existiert: () => true, sammleTests: () => [] };
    const saved = process.env.KQ_DIFF_BASE;
    delete process.env.KQ_DIFF_BASE;
    try {
      expect(io.ladeEngung(ohne)).toEqual({ voll: true, grund: "keine Vergleichs-Basis" });
      const mit: Zugriffe = {
        git: (a) => (a[0] === "merge-base" ? "abc" : a[0] === "diff" ? "src/a.ts\0" : ""),
        existiert: () => true,
        sammleTests: () => [{ pfad: "test/a.test.ts", text: "import a.ts" }],
      };
      expect(io.ladeEngung(mit)).toMatchObject({ voll: false, lint: ["src/a.ts"], perName: ["test/a.test.ts"] });
    } finally {
      if (saved !== undefined) process.env.KQ_DIFF_BASE = saved;
    }
  });
});

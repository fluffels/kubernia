/* Diff-Coverage-Wächter (#1021) — geänderte Zeilen pro PR müssen getestet sein.
 *
 * Harness-Test in derselben Familie wie test/diffsize.test.ts und test/bundle.test.ts:
 * er prüft das Verhalten der TOOLING-Logik über deren öffentliche Exporte (importiert
 * aus scripts/check-diffcoverage.mjs — EINE Quelle der Wahrheit, kein Drift zwischen
 * Test und CLI). git und Dateisystem bleiben unangetastet: `runGit`/`readFile` sind
 * injiziert, damit der Test ohne Repo-/Coverage-Zustand deterministisch läuft. Das
 * Warum des Gates steht in AGENTS.md › Testabdeckung.
 *
 * Ausführen mit:  npm test   (oder gezielt: npm run check:diffcoverage)
 */
import { describe, test } from "vitest";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

// Schicht-SSOT (bewusst CommonJS, siehe scripts/layers.cjs) — damit der Floor-Test
// unten an die ECHTEN Schicht-Buckets gebunden ist statt an vier abgeschriebene Namen.
const requireCjs = createRequire(import.meta.url);
const { LAYERS } = requireCjs("../scripts/layers.cjs") as { LAYERS: Record<string, string> };

type Env = Record<string, string | undefined>;
type RunGit = (args: string[]) => string;
type Changed = Map<string, Set<number>>;
type Lcov = Map<string, Map<number, number>>;
type Bucket = { covered: number; total: number; pct: number; floor: number | null; below: boolean };
type Verdict = { buckets: Record<string, Bucket>; missing: string[]; below: string[] };

/** Die öffentliche Oberfläche des Wächters, wie dieser Test sie nutzt. */
type CheckDiffCoverageModule = {
  LAYER_DIFF_FLOORS: Record<string, number | null>;
  LCOV_PATH: string;
  normalizePath: (p: string) => string;
  isMeasured: (path: string) => boolean;
  parseDiffLines: (text: string) => Changed;
  parseLcov: (text: string) => Lcov;
  parseLcovBranches: (text: string) => Map<string, Map<number, { total: number; taken: number }>>;
  teilweiseGetestet: (
    changed: Changed,
    lcov: Lcov,
    branches: Map<string, Map<number, { total: number; taken: number }>>,
  ) => { path: string; line: number; taken: number; total: number }[];
  evaluateByLayer: (changed: Changed, lcov: Lcov, floors?: Record<string, number | null>) => Verdict;
  OVERRIDE_KEY: string;
  checkDiffCoverage: (opts: { runGit: RunGit; readFile?: (p: string) => string; env?: Env }) => Record<string, unknown>;
};

// Tooling-Skript ohne Declaration-File (scripts/ ist nicht im tsconfig-include). Der
// Namespace wird EINMAL auf die Oberfläche oben festgelegt, statt jeden Zugriff einzeln
// zu casten — sonst meldet der typbewusste Linter (#868) lauter no-unsafe-member-access.
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as checkCovRaw from "../scripts/check-diffcoverage.mjs";

const {
  LAYER_DIFF_FLOORS,
  LCOV_PATH,
  normalizePath,
  isMeasured,
  parseDiffLines,
  parseLcov,
  parseLcovBranches,
  teilweiseGetestet,
  evaluateByLayer,
  OVERRIDE_KEY,
  checkDiffCoverage,
} = checkCovRaw as CheckDiffCoverageModule;

/** Hängt an einen Fake-git einen Slice-Commit mit `line` als Message (Override-Trailer, #1269). */
function mitTrailer(runGit: RunGit, line: string): RunGit {
  return (args) => (args[0] === "log" ? `chore: bewusst

${line}
` : runGit(args));
}

/** Minimaler `git diff -U0`-Ausschnitt bzw. lcov-Block für eine Datei. */
function diffFor(path: string, hunks: string[]): string {
  return [`diff --git a/${path} b/${path}`, `--- a/${path}`, `+++ b/${path}`, ...hunks].join("\n");
}
function lcovFor(path: string, hits: Record<number, number>): string {
  return [`TN:`, `SF:${path}`, ...Object.entries(hits).map(([l, n]) => `DA:${l},${n}`), `end_of_record`].join("\n");
}

describe("Diff-Coverage: Diff-Parsing", () => {
  test("Hunk-Header liefert genau die Zeilen der NEUEN Seite", () => {
    const changed = parseDiffLines(diffFor("src/sim/pods.ts", ["@@ -1,0 +2,3 @@", "+a", "+b", "+c"]));
    assert.deepEqual([...(changed.get("src/sim/pods.ts") ?? [])], [2, 3, 4]);
  });

  test("Hunk ohne Zeilenzahl (`+5`) meint genau eine Zeile", () => {
    const changed = parseDiffLines(diffFor("src/sim/pods.ts", ["@@ -5 +5 @@", "-alt", "+neu"]));
    assert.deepEqual([...(changed.get("src/sim/pods.ts") ?? [])], [5]);
  });

  test("reine Löschung (+c,0) fügt KEINE Zeile hinzu — sonst zählte gelöschter Code als ungetestet", () => {
    const changed = parseDiffLines(diffFor("src/sim/pods.ts", ["@@ -10,3 +9,0 @@", "-weg", "-weg", "-weg"]));
    assert.equal(changed.has("src/sim/pods.ts"), false);
  });

  test("gelöschte Datei (+++ /dev/null) wird übersprungen", () => {
    const text = ["diff --git a/src/sim/alt.ts b/src/sim/alt.ts", "--- a/src/sim/alt.ts", "+++ /dev/null", "@@ -1,2 +0,0 @@", "-x", "-y"].join(
      "\n",
    );
    assert.equal(parseDiffLines(text).size, 0);
  });

  test("Windows-Backslash-Pfade werden auf POSIX normalisiert (sonst matcht der lcov-Pfad nie)", () => {
    const changed = parseDiffLines(
      ["diff --git a/src\\sim\\pods.ts b/src\\sim\\pods.ts", "--- a/src\\sim\\pods.ts", "+++ b/src\\sim\\pods.ts", "@@ -0,0 +1 @@", "+x"].join(
        "\n",
      ),
    );
    assert.equal(changed.has("src/sim/pods.ts"), true);
  });

  test("INHALTS-Zeilen, die wie Header aussehen, kapern den Datei-Pfad NICHT", () => {
    // Als Header gelesen, fielen die folgenden Hunks unter einem Phantom-Pfad still aus
    // der Messung. Der zweite Fall sieht sogar wie ein vollständiges Header-PAAR aus —
    // nur die Bindung an `diff --git` fängt ihn.
    const changed = parseDiffLines(
      diffFor("src/sim/pods.ts", ["@@ -0,0 +1,2 @@", "+++ inhalt mit plus", "+b", "@@ -9,0 +30 @@", "+c"]),
    );
    assert.deepEqual([...changed.keys()], ["src/sim/pods.ts"]);
    assert.deepEqual([...(changed.get("src/sim/pods.ts") ?? [])].sort((a, b) => a - b), [1, 2, 30]);

    const paar = parseDiffLines(
      diffFor("src/sim/pods.ts", ["@@ -20,1 +20,2 @@", "--- a/alt", "+++ b/phantom", "@@ -30,0 +40 @@", "+x"]),
    );
    assert.deepEqual([...paar.keys()], ["src/sim/pods.ts"]);
  });

  test("gelöschte Datei leckt nicht in die nächste (echter /dev/null-Fall mit folgendem Hunk)", () => {
    const changed = parseDiffLines(
      [
        "diff --git a/src/sim/alt.ts b/src/sim/alt.ts",
        "--- a/src/sim/alt.ts",
        "+++ /dev/null",
        "@@ -1,2 +1,2 @@", // count > 0: NUR die /dev/null-Abzweigung kann das verwerfen
        "-x",
        diffFor("src/sim/neu.ts", ["@@ -0,0 +1 @@", "+y"]),
      ].join("\n"),
    );
    assert.deepEqual([...changed.keys()], ["src/sim/neu.ts"]);
  });

  test("Umbenennung zählt den NEUEN Pfad, ein Binärdatei-Block leckt nicht in die Folgedatei", () => {
    const rename = parseDiffLines(
      ["diff --git a/src/sim/alt.ts b/src/sim/neu.ts", "--- a/src/sim/alt.ts", "+++ b/src/sim/neu.ts", "@@ -0,0 +1 @@", "+x"].join("\n"),
    );
    assert.deepEqual([...rename.keys()], ["src/sim/neu.ts"]);
    const binaer = parseDiffLines(
      ["diff --git a/a.png b/a.png", "Binary files a/a.png and b/a.png differ", diffFor("src/sim/p.ts", ["@@ -0,0 +1 @@", "+x"])].join("\n"),
    );
    assert.deepEqual([...binaer.keys()], ["src/sim/p.ts"]);
  });

  test("CRLF-Zeilenenden (Windows-git) werden verarbeitet", () => {
    const changed = parseDiffLines(diffFor("src/sim/pods.ts", ["@@ -0,0 +1 @@", "+x"]).replace(/\n/g, "\r\n"));
    assert.deepEqual([...(changed.get("src/sim/pods.ts") ?? [])], [1]);
  });

  test("mehrere Hunks derselben Datei werden vereinigt", () => {
    const changed = parseDiffLines(diffFor("src/sim/pods.ts", ["@@ -0,0 +1,2 @@", "+a", "+b", "@@ -9,0 +20,1 @@", "+c"]));
    assert.deepEqual([...(changed.get("src/sim/pods.ts") ?? [])].sort((a, b) => a - b), [1, 2, 20]);
  });
});

describe("Diff-Coverage: lcov-Parsing", () => {
  test("DA-Records werden je Datei als Zeile→Treffer gelesen", () => {
    const lcov = parseLcov(lcovFor("src/sim/pods.ts", { 1: 3, 2: 0 }));
    assert.equal(lcov.get("src/sim/pods.ts")?.get(1), 3);
    assert.equal(lcov.get("src/sim/pods.ts")?.get(2), 0);
  });

  test("SF-Pfade mit Backslashes (v8-Reporter unter Windows) werden normalisiert", () => {
    const lcov = parseLcov(lcovFor("src\\sim\\pods.ts", { 1: 1 }));
    assert.equal(lcov.has("src/sim/pods.ts"), true);
  });

  test("mehrere Records bleiben getrennt", () => {
    const lcov = parseLcov([lcovFor("src/sim/a.ts", { 1: 1 }), lcovFor("src/sim/b.ts", { 1: 0 })].join("\n"));
    assert.equal(lcov.size, 2);
    assert.equal(lcov.get("src/sim/b.ts")?.get(1), 0);
  });

  test("kaputter Report: DA vor SF, leere und unparsbare DA-Zeilen werden verworfen statt zu werfen", () => {
    assert.deepEqual([...parseLcov("DA:1,1\nDA:2,0").keys()], []);
    const lcov = parseLcov(["TN:", "SF:src/sim/a.ts", "DA:", "DA:x,y", "DA:3,1", "end_of_record"].join("\n"));
    assert.deepEqual([...(lcov.get("src/sim/a.ts")?.keys() ?? [])], [3]);
    // DA ohne Trefferzahl gilt als UNgetestet — im Zweifel streng, nicht lasch.
    assert.equal(parseLcov(["SF:src/sim/b.ts", "DA:3", "end_of_record"].join("\n")).get("src/sim/b.ts")?.get(3), 0);
    assert.equal(parseLcov("").size, 0); // leerer Report: leere Abbildung, kein Absturz
  });

  test("fehlendes end_of_record vermischt zwei Dateien nicht (SF: schaltet um)", () => {
    const lcov = parseLcov(["SF:src/sim/a.ts", "DA:1,1", "SF:src/sim/b.ts", "DA:2,0"].join("\n"));
    assert.deepEqual([...(lcov.get("src/sim/a.ts")?.keys() ?? [])], [1]);
    assert.deepEqual([...(lcov.get("src/sim/b.ts")?.keys() ?? [])], [2]);
  });

});

describe("Diff-Coverage: Zweig-Sicht, nur berichtend (#1425)", () => {
  const P = "src/sim/argocd.ts";
  const lcov = (da: Record<number, number>, brda: string[]) =>
    [`SF:${P}`, ...Object.entries(da).map(([l, n]) => `DA:${l},${n}`), ...brda, `end_of_record`].join("\n");

  test("BRDA: `-` und 0 sind ungenommen, n > 0 genommen; kaputte Records und Windows-Pfade stören nicht", () => {
    const text = [
      lcov({ 5: 3 }, ["BRDA:5,0,0,2", "BRDA:5,0,1,-", "BRDA:5,1,0,0", "BRDA:kaputt", "BRDA:5,0,0", "BRDA:x,0,0,1"]),
      "SF:src\\sim\\x.ts",
      "BRDA:9,0,0,1",
      "end_of_record",
    ].join("\n");
    const b = parseLcovBranches(text);
    assert.deepEqual(b.get(P)?.get(5), { total: 3, taken: 1 });
    assert.deepEqual(b.get("src/sim/x.ts")?.get(9), { total: 1, taken: 1 });
    assert.equal(b.get(P)?.size, 1);
  });

  test("BRDA außerhalb eines SF-Blocks (vor dem ersten SF und nach end_of_record) wird ignoriert", () => {
    assert.equal(parseLcovBranches("BRDA:1,0,0,1").size, 0);
    const b = parseLcovBranches(["SF:src/a.ts", "BRDA:1,0,0,1", "end_of_record", "BRDA:2,0,0,1"].join("\n"));
    assert.deepEqual([...(b.get("src/a.ts")?.keys() ?? [])], [1]);
  });

  test("meldet geänderte, ausgeführte Zeile mit ungenommenem Zweig", () => {
    const text = lcov({ 7: 4 }, ["BRDA:7,0,0,4", "BRDA:7,0,1,0"]);
    const r = teilweiseGetestet(new Map([[P, new Set([7])]]), parseLcov(text), parseLcovBranches(text));
    assert.deepEqual(r, [{ path: P, line: 7, taken: 1, total: 2 }]);
  });

  test("meldet NICHT: ungeänderte Zeile, nicht ausgeführte Zeile (DA 0), alle Zweige genommen, .d.ts, außerhalb src", () => {
    const text = [
      lcov({ 7: 4, 8: 0, 9: 2 }, ["BRDA:7,0,0,4", "BRDA:7,0,1,0", "BRDA:8,0,0,0", "BRDA:9,0,0,1", "BRDA:9,0,1,1"]),
      "SF:src/t.d.ts",
      "DA:1,1",
      "BRDA:1,0,0,0",
      "end_of_record",
      "SF:scripts/x.mjs",
      "DA:1,1",
      "BRDA:1,0,0,0",
      "end_of_record",
    ].join("\n");
    const changed: Changed = new Map([
      [P, new Set([8, 9])], // Zeile 7 nicht geändert
      ["src/t.d.ts", new Set([1])],
      ["scripts/x.mjs", new Set([1])],
    ]);
    assert.deepEqual(teilweiseGetestet(changed, parseLcov(text), parseLcovBranches(text)), []);
  });

  test("Ende-zu-Ende: `partial` im Ergebnis, `failed` bleibt unberührt", () => {
    const text = lcov({ 1: 2 }, ["BRDA:1,0,0,2", "BRDA:1,0,1,0"]).replace(P, "src/sim/pods.ts");
    const r = checkDiffCoverage({
      runGit: (args) => (args[0] === "diff" ? diffFor("src/sim/pods.ts", ["@@ -0,0 +1 @@", "+x"]) : "basesha"),
      readFile: () => text,
      env: { KQ_DIFF_BASE: "basesha" },
    });
    assert.equal(r.failed, false);
    assert.deepEqual(r.partial, [{ path: "src/sim/pods.ts", line: 1, taken: 1, total: 2 }]);
  });
});

describe("Diff-Coverage: Bewertung pro Schicht", () => {
  test("ungetestete Domänen-Zeile drückt den Bucket unter den Floor (rot)", () => {
    const changed = new Map([["src/sim/pods.ts", new Set([1, 2, 3, 4, 5])]]);
    const lcov = new Map([["src/sim/pods.ts", new Map([[1, 2], [2, 1], [3, 1], [4, 1], [5, 0]])]]);
    const v = evaluateByLayer(changed, lcov);
    assert.equal(v.buckets["domaene"].covered, 4);
    assert.equal(v.buckets["domaene"].total, 5);
    assert.equal(v.below.includes("domaene"), true);
  });

  test("Gegenprobe: dieselben Zeilen MIT Treffern sind grün (der Test misst wirklich Coverage)", () => {
    const changed = new Map([["src/sim/pods.ts", new Set([1, 2, 3, 4, 5])]]);
    const lcov = new Map([["src/sim/pods.ts", new Map([[1, 2], [2, 1], [3, 1], [4, 1], [5, 1]])]]);
    assert.deepEqual(evaluateByLayer(changed, lcov).below, []);
  });

  test("dieselbe ungetestete Zeile in der PRÄSENTATION ist NICHT rot (Phaser/DOM ist unit-untestbar)", () => {
    const changed = new Map([["src/scenes/worldscene/clustersync.ts", new Set([1, 2, 3, 4, 5])]]);
    const lcov = new Map([["src/scenes/worldscene/clustersync.ts", new Map([[1, 0], [2, 0], [3, 0], [4, 0], [5, 0]])]]);
    const v = evaluateByLayer(changed, lcov);
    assert.equal(v.buckets["praesentation"].total, 5);
    assert.equal(v.buckets["praesentation"].covered, 0);
    assert.deepEqual(v.below, []);
  });

  test("Zeilen ohne DA-Record (Kommentar/Typ/Leerzeile) zählen NICHT in den Nenner", () => {
    const changed = new Map([["src/sim/pods.ts", new Set([1, 2, 3])]]);
    const lcov = new Map([["src/sim/pods.ts", new Map([[2, 1]])]]);
    const v = evaluateByLayer(changed, lcov);
    assert.equal(v.buckets["domaene"].total, 1);
    assert.equal(v.buckets["domaene"].covered, 1);
  });

  test("geänderte src-Datei ohne lcov-Record wird gemeldet statt still übersprungen (Gaming-Vektor)", () => {
    const changed = new Map([["src/sim/neu.ts", new Set([1])]]);
    const v = evaluateByLayer(changed, new Map());
    assert.deepEqual(v.missing, ["src/sim/neu.ts"]);
  });

  test("Nicht-.ts unter src (Content-JSON) fällt aus der Messung — kein ausführbarer Code", () => {
    const changed = new Map([["src/content/data/quests/ole.json", new Set([1, 2])]]);
    const v = evaluateByLayer(changed, new Map());
    assert.deepEqual(v.missing, []);
    assert.equal(v.buckets["domaene"].total, 0);
  });

  test("leerer Bucket ist nie rot (keine Division durch null)", () => {
    const v = evaluateByLayer(new Map(), new Map());
    assert.deepEqual(v.below, []);
    assert.equal(v.buckets["domaene"].total, 0);
  });

  test("Anwendungs-Bucket hat einen eigenen, niedrigeren Floor als die Domäne", () => {
    const changed = new Map([["src/store/idb.ts", new Set([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])]]);
    // 85 % — unter dem Domänen-Floor (90), über dem Anwendungs-Floor (80).
    const hits = new Map<number, number>();
    for (let i = 1; i <= 10; i++) hits.set(i, i <= 8 ? 1 : 0);
    const v = evaluateByLayer(changed, new Map([["src/store/idb.ts", hits]]));
    assert.equal(v.buckets["anwendung"].pct, 80);
    assert.deepEqual(v.below, []);
  });
});

describe("Diff-Coverage: Floors + Override (Ratchet-Disziplin)", () => {
  test("Floors sind festgeschrieben: Domäne 90, Anwendung 80, Präsentation/Einstieg nur berichtend", () => {
    assert.equal(LAYER_DIFF_FLOORS["domaene"], 90);
    assert.equal(LAYER_DIFF_FLOORS["anwendung"], 80);
    assert.equal(LAYER_DIFF_FLOORS["praesentation"], null);
    assert.equal(LAYER_DIFF_FLOORS["einstieg"], null);
  });

  test("JEDE Schicht der SSOT hat einen Floor-Eintrag — eine neue Schicht fällt nicht still in 'berichtend'", () => {
    assert.deepEqual(Object.keys(LAYER_DIFF_FLOORS).sort(), [...Object.values(LAYERS)].sort());
  });

  test("Erzeuger-Vertrag: vite.config.ts schreibt das lcov, das dieser Wächter liest", () => {
    // Ohne diese Bindung könnte der `lcovonly`-Reporter entfernt werden, ohne dass ein
    // Test rot wird — das Gate liefe dann in der CI auf „noReport" statt zu messen.
    const viteConfig = readFileSync(fileURLToPath(new URL("../vite.config.ts", import.meta.url)), "utf8");
    assert.match(viteConfig, /reporter:\s*\[[^\]]*"lcovonly"/);
    assert.match(viteConfig, /reportsDirectory:\s*"coverage"/);
    assert.equal(normalizePath(LCOV_PATH).endsWith("coverage/lcov.info"), true);
  });

  test("Typdeklarationen (.d.ts) fallen aus der Messung — sie enthalten keine ausführbare Zeile", () => {
    assert.equal(isMeasured("src/vite-env.d.ts"), false);
    assert.equal(isMeasured("src/sim/pods.ts"), true);
    assert.equal(isMeasured("scripts/check-size.mjs"), false);
  });

  test("eigener Override-Schlüssel (#1269): ein Diffsize-Trailer gilt hier nicht", () => {
    assert.equal(OVERRIDE_KEY, "KQ-Diffcov-Override");
    const runGit = mitTrailer(
      (args) => (args[0] === "diff" ? diffFor("src/sim/pods.ts", ["@@ -0,0 +1,2 @@", "+x", "+y"]) : "basesha"),
      "KQ-Diffsize-Override: #1021 falsches Gate",
    );
    const r = checkDiffCoverage({ runGit, readFile: () => lcovFor("src/sim/pods.ts", { 1: 1, 2: 0 }), env: { KQ_DIFF_BASE: "basesha" } });
    assert.equal(r.allowed, false);
    assert.equal(r.failed, true);
  });

  test("versetzte Override-Zeilen (#1390 Z7): mit Strich oder eingerückt zählen nicht, werden aber gemeldet; eine gültige daneben wirkt", () => {
    const basis: RunGit = (args) => (args[0] === "diff" ? diffFor("src/sim/pods.ts", ["@@ -0,0 +1,2 @@", "+x", "+y"]) : "basesha");
    const readFile = () => lcovFor("src/sim/pods.ts", { 1: 1, 2: 0 });
    const env = { KQ_DIFF_BASE: "basesha" };
    const versetzt = ["- KQ-Diffcov-Override: #1390 mit Strich", "  KQ-Diffcov-Override: #1390 eingerückt"];
    const r = checkDiffCoverage({ runGit: mitTrailer(basis, versetzt.join("\n")), readFile, env });
    assert.equal(r.allowed, false, "die versetzten Zeilen zählen nicht als Override");
    assert.equal(r.failed, true);
    assert.deepEqual(r.versetzteOverrides, ["- KQ-Diffcov-Override: #1390 mit Strich", "KQ-Diffcov-Override: #1390 eingerückt"]);
    const gueltig = "KQ-Diffcov-Override: #1390 bewusst";
    const beides = checkDiffCoverage({ runGit: mitTrailer(basis, `${versetzt.join("\n")}\n${gueltig}`), readFile, env });
    assert.equal(beides.allowed, true);
    assert.equal(beides.failed, false);
    assert.deepEqual(checkDiffCoverage({ runGit: mitTrailer(basis, gueltig), readFile, env }).versetzteOverrides, []);
  });
});

describe("Diff-Coverage: Ende-zu-Ende mit injizierter IO", () => {
  const lcovOk = lcovFor("src/sim/pods.ts", { 1: 1, 2: 1 });

  test("keine auflösbare Basis (flacher Checkout) → No-op-grün, statt main rot zu machen", () => {
    const r = checkDiffCoverage({
      runGit: () => {
        throw new Error("kein origin/main");
      },
      readFile: () => lcovOk,
      env: {},
    });
    assert.equal(r.skipped, true);
  });

  test("fehlendes lcov → ROT mit Hinweis, nicht still grün (ein Gate, das nichts gemessen hat)", () => {
    const r = checkDiffCoverage({
      runGit: (args) => (args[0] === "diff" ? diffFor("src/sim/pods.ts", ["@@ -0,0 +1 @@", "+x"]) : "basesha"),
      readFile: () => {
        throw new Error("ENOENT");
      },
      env: { KQ_DIFF_BASE: "basesha" },
    });
    assert.equal(r.skipped, false);
    assert.equal(r.noReport, true);
    assert.equal(r.failed, true); // die Leitregel: nichts gemessen ⇒ niemals grün
  });

  test("ungetesteter Domänen-Slice → rot; Override mit Begründung lässt ihn bewusst durch", () => {
    const runGit: RunGit = (args) =>
      args[0] === "diff" ? diffFor("src/sim/pods.ts", ["@@ -0,0 +1,2 @@", "+x", "+y"]) : "basesha";
    const readFile = () => lcovFor("src/sim/pods.ts", { 1: 1, 2: 0 });
    const rot = checkDiffCoverage({ runGit, readFile, env: { KQ_DIFF_BASE: "basesha" } });
    assert.equal(rot.failed, true);
    const geduldet = checkDiffCoverage({
      runGit: mitTrailer(runGit, "KQ-Diffcov-Override: #1021 bewusst"),
      readFile,
      env: { KQ_DIFF_BASE: "basesha" },
    });
    assert.equal(geduldet.failed, false);
    assert.equal(geduldet.allowed, true);
    assert.equal(geduldet.reason, "#1021 bewusst");
  });

  test("die alte Env KQ_DIFFCOV_OVERRIDE lässt NICHTS mehr durch (kam in der PR-CI nie an)", () => {
    const r = checkDiffCoverage({
      runGit: (args) => (args[0] === "diff" ? diffFor("src/sim/pods.ts", ["@@ -0,0 +1,2 @@", "+x", "+y"]) : "basesha"),
      readFile: () => lcovFor("src/sim/pods.ts", { 1: 1, 2: 0 }),
      env: { KQ_DIFF_BASE: "basesha", KQ_DIFFCOV_OVERRIDE: "#1021 bewusst" },
    });
    assert.equal(r.allowed, false);
    assert.equal(r.failed, true);
    assert.equal(r.legacyEnv, true);
  });

  test("ungültige Override-Zeile (ohne #<nr>) lässt nichts durch und wird gemeldet", () => {
    const r = checkDiffCoverage({
      runGit: mitTrailer(
        (args) => (args[0] === "diff" ? diffFor("src/sim/pods.ts", ["@@ -0,0 +1,2 @@", "+x", "+y"]) : "basesha"),
        "KQ-Diffcov-Override: einfach so",
      ),
      readFile: () => lcovFor("src/sim/pods.ts", { 1: 1, 2: 0 }),
      env: { KQ_DIFF_BASE: "basesha" },
    });
    assert.equal(r.allowed, false);
    assert.deepEqual(r.invalidOverrides, ["KQ-Diffcov-Override: einfach so"]);
  });

  test("gesetztes Override bei grünem Slice wird als STALE gemeldet (rot)", () => {
    const r = checkDiffCoverage({
      runGit: mitTrailer(
        (args) => (args[0] === "diff" ? diffFor("src/sim/pods.ts", ["@@ -0,0 +1,2 @@", "+x", "+y"]) : "basesha"),
        "KQ-Diffcov-Override: #1021 unnötig",
      ),
      readFile: () => lcovOk,
      env: { KQ_DIFF_BASE: "basesha" },
    });
    assert.equal(r.stale, true);
    assert.equal(r.failed, true);
  });

  test("geänderte src-Datei fehlt im Report → ROT (Anti-Gaming: Code verstecken)", () => {
    const r = checkDiffCoverage({
      runGit: (args) => (args[0] === "diff" ? diffFor("src/sim/versteckt.ts", ["@@ -0,0 +1,2 @@", "+x", "+y"]) : "basesha"),
      readFile: () => lcovFor("src/sim/andere.ts", { 1: 1 }),
      env: { KQ_DIFF_BASE: "basesha" },
    });
    assert.equal(r.failed, true);
    assert.deepEqual(r.missing, ["src/sim/versteckt.ts"]);
  });

  test("ein Messfehler (missing) ist NICHT über das Override abkürzbar — nur neu messen hilft", () => {
    const r = checkDiffCoverage({
      runGit: mitTrailer(
        (args) => (args[0] === "diff" ? diffFor("src/sim/versteckt.ts", ["@@ -0,0 +1,2 @@", "+x", "+y"]) : "basesha"),
        "KQ-Diffcov-Override: #1021 durchwinken",
      ),
      readFile: () => lcovFor("src/sim/andere.ts", { 1: 1 }),
      env: { KQ_DIFF_BASE: "basesha" },
    });
    assert.equal(r.failed, true);
    assert.equal(r.allowed, false);
    // ... und das Override gilt dabei NICHT als stale (es gibt ja ein echtes Problem).
    assert.equal(r.stale, false);
  });

  test("below UND missing zugleich: beide werden gemeldet, der Lauf ist rot", () => {
    const runGit: RunGit = (args) =>
      args[0] === "diff"
        ? [
            diffFor("src/sim/pods.ts", ["@@ -0,0 +1,2 @@", "+x", "+y"]),
            diffFor("src/sim/versteckt.ts", ["@@ -0,0 +1 @@", "+z"]),
          ].join("\n")
        : "basesha";
    const r = checkDiffCoverage({
      runGit,
      readFile: () => lcovFor("src/sim/pods.ts", { 1: 1, 2: 0 }),
      env: { KQ_DIFF_BASE: "basesha" },
    });
    assert.equal(r.failed, true);
    assert.deepEqual(r.below, ["domaene"]);
    assert.deepEqual(r.missing, ["src/sim/versteckt.ts"]);
  });

  test("reiner Doku-/Tooling-Slice braucht KEINEN Coverage-Report (grün statt rot)", () => {
    const r = checkDiffCoverage({
      runGit: (args) => (args[0] === "diff" ? diffFor("docs/agent-harness.md", ["@@ -0,0 +1 @@", "+text"]) : "basesha"),
      readFile: () => {
        throw new Error("ENOENT — es gab nichts zu messen");
      },
      env: { KQ_DIFF_BASE: "basesha" },
    });
    assert.equal(r.failed, false);
    assert.equal(r.nothingToMeasure, true);
  });

  test("Doku-Slice mit KQ-Diffcov-Override ist stale → rot (#1309); ohne Trailer bleibt er grün", () => {
    const runGit: RunGit = (args) => (args[0] === "diff" ? diffFor("docs/agent-harness.md", ["@@ -0,0 +1 @@", "+text"]) : "basesha");
    const lesen = () => {
      throw new Error("ENOENT");
    };
    const r = checkDiffCoverage({ runGit: mitTrailer(runGit, "KQ-Diffcov-Override: #1021 unnötig"), readFile: lesen, env: { KQ_DIFF_BASE: "basesha" } });
    assert.equal(r.nothingToMeasure, true);
    assert.equal(r.stale, true);
    assert.equal(r.failed, true, "nichts zu messen heißt nichts durchzulassen: der Trailer ist überflüssig");
    const ohne = checkDiffCoverage({ runGit, readFile: lesen, env: { KQ_DIFF_BASE: "basesha" } });
    assert.equal(ohne.failed, false);
    const fremd = checkDiffCoverage({ runGit: mitTrailer(runGit, "KQ-Diffsize-Override: #1021 anderes Gate"), readFile: lesen, env: { KQ_DIFF_BASE: "basesha" } });
    assert.equal(fremd.failed, false, "ein fremder Schlüssel macht diesen Slice nicht stale");
  });

  test("nicht messbarer Diff (git wirft trotz Basis) degradiert zu grün, statt main rot zu machen", () => {
    const r = checkDiffCoverage({
      runGit: (args) => {
        if (args[0] === "diff") throw new Error("bad revision");
        return "basesha";
      },
      readFile: () => lcovOk,
      env: { KQ_DIFF_BASE: "basesha" },
    });
    assert.equal(r.skipped, true);
    assert.equal(r.failed, false);
  });

  test("gemessen wird der EIGENE Slice (Drei-Punkt gegen die Merge-Base), nicht base..HEAD", () => {
    // Sonst zählen Änderungen, die main NACH dem Abzweigen bekam, als Additionen
    // dieses Slices — fremder Code im Nenner, potenziell falsches Rot.
    const gesehen: string[][] = [];
    checkDiffCoverage({
      runGit: (args) => {
        gesehen.push(args);
        return args[0] === "diff" ? diffFor("src/sim/pods.ts", ["@@ -0,0 +1,2 @@", "+x", "+y"]) : "basesha";
      },
      readFile: () => lcovOk,
      env: { KQ_DIFF_BASE: "basesha" },
    });
    // Pinnt zugleich `-U0` (Kontextzeilen zählten sonst als geändert mit) und den Scope.
    assert.deepEqual(gesehen.find((a) => a[0] === "diff"), ["diff", "-U0", "basesha...HEAD", "--", "src"]);
  });

  test("vollständig getesteter Slice ist grün", () => {
    const r = checkDiffCoverage({
      runGit: (args) => (args[0] === "diff" ? diffFor("src/sim/pods.ts", ["@@ -0,0 +1,2 @@", "+x", "+y"]) : "basesha"),
      readFile: () => lcovOk,
      env: { KQ_DIFF_BASE: "basesha" },
    });
    assert.equal(r.failed, false);
    assert.equal(r.skipped, false);
  });
});

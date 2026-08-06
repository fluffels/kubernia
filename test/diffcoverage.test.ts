/* Diff-Coverage-Wächter (#1021) — geänderte Zeilen pro PR müssen getestet sein.
 *
 * Das bestehende Coverage-Gate (#495) misst ein Schicht-AGGREGAT: neuer, komplett
 * ungetesteter Code in einer bereits hoch abgedeckten Schicht reißt den Floor nicht,
 * weil er im Nenner der ganzen Schicht untergeht. Dieser Wächter misst stattdessen
 * genau die Zeilen, die der aktuelle Slice ANFASST — dieselbe Diff-Basis-Semantik
 * wie check:diffsize (#533), dieselben Schicht-Buckets wie das Aggregat-Gate.
 *
 * Rein struktureller Wächter (wie filesize/diffsize/docdrift), bewusst kein
 * Verhaltens-Test. Die Parse-/Bewertungs-/Override-Logik wird aus
 * scripts/check-diffcoverage.mjs importiert — EINE Quelle der Wahrheit (kein Drift
 * zwischen Test und CLI). git und Dateisystem werden NICHT angefasst: `runGit` und
 * `readFile` sind injiziert, damit der Test deterministisch ohne Repo-/Coverage-
 * Zustand läuft.
 *
 * Ausführen mit:  npm test   (oder gezielt: npm run check:diffcoverage)
 */
import { describe, test } from "vitest";
import assert from "node:assert/strict";

type Env = Record<string, string | undefined>;
type RunGit = (args: string[]) => string;
type Changed = Map<string, Set<number>>;
type Lcov = Map<string, Map<number, number>>;
type Bucket = { covered: number; total: number; pct: number; floor: number | null; below: boolean };
type Verdict = { buckets: Record<string, Bucket>; missing: string[]; below: string[] };

/** Die öffentliche Oberfläche des Wächters, wie dieser Test sie nutzt. */
type CheckDiffCoverageModule = {
  LAYER_DIFF_FLOORS: Record<string, number | null>;
  parseDiffLines: (text: string) => Changed;
  parseLcov: (text: string) => Lcov;
  evaluateByLayer: (changed: Changed, lcov: Lcov, floors?: Record<string, number | null>) => Verdict;
  overrideReason: (env?: Env) => string | null;
  checkDiffCoverage: (opts: { runGit: RunGit; readFile?: (p: string) => string; env?: Env }) => Record<string, unknown>;
};

// Reines Node-Tooling-Skript ohne Declaration-File (allowJs aus, scripts/ nicht im
// tsconfig-include) – der Laufzeit-Import genügt. Der Namespace wird EINMAL auf die
// Oberfläche oben festgelegt, statt jeden Zugriff einzeln zu casten: sonst meldet der
// typbewusste Linter (#868) für jeden Zugriff no-unsafe-member-access.
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as checkCovRaw from "../scripts/check-diffcoverage.mjs";

const { LAYER_DIFF_FLOORS, parseDiffLines, parseLcov, evaluateByLayer, overrideReason, checkDiffCoverage } =
  checkCovRaw as CheckDiffCoverageModule;

/** Minimaler `git diff -U0`-Ausschnitt für eine Datei. */
function diffFor(path: string, hunks: string[]): string {
  return [`diff --git a/${path} b/${path}`, `--- a/${path}`, `+++ b/${path}`, ...hunks].join("\n");
}

/** lcov-Block für eine Datei: `hits` bildet Zeile → Trefferzahl ab. */
function lcovFor(path: string, hits: Record<number, number>): string {
  const da = Object.entries(hits).map(([line, n]) => `DA:${line},${n}`);
  return [`TN:`, `SF:${path}`, ...da, `end_of_record`].join("\n");
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

  test("leeres/whitespace-Override zählt nicht — Pflicht-Begründung", () => {
    assert.equal(overrideReason({}), null);
    assert.equal(overrideReason({ KQ_DIFFCOV_OVERRIDE: "   " }), null);
    assert.equal(overrideReason({ KQ_DIFFCOV_OVERRIDE: " #1021 warum " }), "#1021 warum");
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
  });

  test("ungetesteter Domänen-Slice → rot; Override mit Begründung lässt ihn bewusst durch", () => {
    const runGit: RunGit = (args) =>
      args[0] === "diff" ? diffFor("src/sim/pods.ts", ["@@ -0,0 +1,2 @@", "+x", "+y"]) : "basesha";
    const readFile = () => lcovFor("src/sim/pods.ts", { 1: 1, 2: 0 });
    const rot = checkDiffCoverage({ runGit, readFile, env: { KQ_DIFF_BASE: "basesha" } });
    assert.equal(rot.failed, true);
    const geduldet = checkDiffCoverage({
      runGit,
      readFile,
      env: { KQ_DIFF_BASE: "basesha", KQ_DIFFCOV_OVERRIDE: "#1021 bewusst" },
    });
    assert.equal(geduldet.failed, false);
    assert.equal(geduldet.allowed, true);
  });

  test("gesetztes Override bei grünem Slice wird als STALE gemeldet (rot)", () => {
    const r = checkDiffCoverage({
      runGit: (args) => (args[0] === "diff" ? diffFor("src/sim/pods.ts", ["@@ -0,0 +1,2 @@", "+x", "+y"]) : "basesha"),
      readFile: () => lcovOk,
      env: { KQ_DIFF_BASE: "basesha", KQ_DIFFCOV_OVERRIDE: "#1021 unnötig" },
    });
    assert.equal(r.stale, true);
    assert.equal(r.failed, true);
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

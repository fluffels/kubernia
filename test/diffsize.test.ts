/* Diff-Größenbudget-Wächter (#533) — Frühwarnung gegen zu breite Änderungen.
 *
 * Ein Ticket, das eigentlich in session-große Kinder gehört (AGENTS.md), kann als
 * ein Riesen-Commit durchrutschen und wird unreviewbar. Dieser Wächter misst den
 * Diff gegen main und wird rot über einem Budget an Dateien/Zeilen. Dieselbe Logik
 * gibt es als CLI `npm run check:diffsize` (Teil von `npm run verify`).
 *
 * Rein struktureller Wächter (wie filesize/docdrift), bewusst kein Verhaltens-Test.
 * Die Mess-/Bewertungs-/Override-Logik wird aus scripts/check-diffsize.mjs
 * importiert — EINE Quelle der Wahrheit (kein Drift zwischen Test und CLI). git
 * selbst wird NICHT ausgeführt: `runGit` ist injiziert, damit der Test
 * deterministisch und ohne Repo-Zustand läuft.
 *
 * Ausführen mit:  npm test   (oder gezielt: npm run check:diffsize)
 */
import { describe, test } from "vitest";
import assert from "node:assert/strict";

// Reines Node-Tooling-Skript ohne Declaration-File (allowJs aus, scripts/ nicht im
// tsconfig-include) – der Laufzeit-Import genügt, Typen lokal deklariert.
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as checkDiff from "../scripts/check-diffsize.mjs";

type Sums = { fileCount: number; changedLines: number };
type Thresholds = { maxFiles: number; maxLines: number };
type Eval = { overFiles: boolean; overLines: boolean; over: boolean };
type RunGit = (args: string[]) => string;

const MAX_FILES: number = checkDiff.MAX_FILES;
const MAX_LINES: number = checkDiff.MAX_LINES;
const readThresholds: (env?: Record<string, string | undefined>) => Thresholds = checkDiff.readThresholds;
const parseNumstat: (text: string) => { files: { path: string; added: number; deleted: number; binary: boolean }[] } & Sums =
  checkDiff.parseNumstat;
const evaluate: (sums: Sums, t: Thresholds) => Eval = checkDiff.evaluate;
const overrideReason: (env?: Record<string, string | undefined>) => string | null = checkDiff.overrideReason;
const resolveBase: (runGit: RunGit, env?: Record<string, string | undefined>) => string | null = checkDiff.resolveBase;
const checkDiffSize: (opts: { runGit: RunGit; env?: Record<string, string | undefined> }) => Record<string, unknown> =
  checkDiff.checkDiffSize;

describe("Diff-Größenbudget (#533)", () => {
  test("parseNumstat: summiert added+deleted, zählt Dateien, behandelt Binärdateien", () => {
    const text = ["12\t3\tsrc/foo.ts", "0\t5\tsrc/bar.ts", "-\t-\tassets/pixellab/x.png"].join("\n");
    const r = parseNumstat(text);
    assert.equal(r.fileCount, 3, "drei geänderte Dateien");
    assert.equal(r.changedLines, 12 + 3 + 0 + 5, "Binärdatei trägt 0 Zeilen bei");
    assert.equal(r.files[2].binary, true, "die PNG-Zeile ist binär");
  });

  test("parseNumstat: leerer Diff = 0/0; Pfade mit Tab/Leerzeichen bleiben ganz", () => {
    assert.deepEqual(parseNumstat(""), { files: [], fileCount: 0, changedLines: 0 });
    assert.deepEqual(parseNumstat("\n\n"), { files: [], fileCount: 0, changedLines: 0 });
    const r = parseNumstat("1\t1\tsrc/a b/c\td.ts");
    assert.equal(r.files[0].path, "src/a b/c\td.ts", "Pfad mit weiterem Tab wird nicht abgeschnitten");
  });

  test("evaluate: == Budget ist ok, > Budget ist über (strikt, wie check-size)", () => {
    const t = { maxFiles: 20, maxLines: 800 };
    assert.equal(evaluate({ fileCount: 20, changedLines: 800 }, t).over, false, "genau am Budget = ok");
    assert.equal(evaluate({ fileCount: 21, changedLines: 10 }, t).overFiles, true, "eine Datei zu viel");
    assert.equal(evaluate({ fileCount: 1, changedLines: 801 }, t).overLines, true, "eine Zeile zu viel");
  });

  test("Detektion greift wirklich (Red-Green): kleines Budget trifft, riesiges nie", () => {
    // No-op-Schutz: ein Wächter, der immer grün ist, wäre wertlos.
    const sums = { fileCount: 10, changedLines: 500 };
    assert.equal(evaluate(sums, { maxFiles: 1, maxLines: 1 }).over, true, "winziges Budget MUSS treffen");
    assert.equal(evaluate(sums, { maxFiles: 1e6, maxLines: 1e6 }).over, false, "riesiges Budget darf nie treffen");
  });

  test("readThresholds: Defaults, Env-Override, ungültige Werte fallen auf Default zurück", () => {
    assert.deepEqual(readThresholds({}), { maxFiles: MAX_FILES, maxLines: MAX_LINES });
    assert.deepEqual(readThresholds({ KQ_DIFFSIZE_MAX_FILES: "5", KQ_DIFFSIZE_MAX_LINES: "50" }), {
      maxFiles: 5,
      maxLines: 50,
    });
    assert.deepEqual(readThresholds({ KQ_DIFFSIZE_MAX_FILES: "0", KQ_DIFFSIZE_MAX_LINES: "-3" }), {
      maxFiles: MAX_FILES,
      maxLines: MAX_LINES,
    });
    assert.deepEqual(readThresholds({ KQ_DIFFSIZE_MAX_FILES: "abc" }), { maxFiles: MAX_FILES, maxLines: MAX_LINES });
  });

  test("overrideReason: leer/whitespace zählt NICHT (Pflicht-Begründung)", () => {
    assert.equal(overrideReason({}), null);
    assert.equal(overrideReason({ KQ_DIFFSIZE_OVERRIDE: "   " }), null, "whitespace ist keine Begründung");
    assert.equal(overrideReason({ KQ_DIFFSIZE_OVERRIDE: "  #317 bewusst breit " }), "#317 bewusst breit");
  });

  test("resolveBase: KQ_DIFF_BASE zuerst, sonst origin/main vor main, sonst null", () => {
    // origin/main-Zweig gewinnt vor main.
    const git1: RunGit = (a) => {
      if (a[0] === "merge-base" && a[2] === "origin/main") return "base-origin\n";
      if (a[0] === "merge-base" && a[2] === "main") return "base-main\n";
      throw new Error("unerwartet");
    };
    assert.equal(resolveBase(git1, {}), "base-origin");

    // origin/main fehlt (wirft) → Fallback auf main.
    const git2: RunGit = (a) => {
      if (a[0] === "merge-base" && a[2] === "origin/main") throw new Error("kein origin/main");
      if (a[0] === "merge-base" && a[2] === "main") return "base-main\n";
      throw new Error("unerwartet");
    };
    assert.equal(resolveBase(git2, {}), "base-main");

    // explizites KQ_DIFF_BASE gewinnt über alles.
    const git3: RunGit = (a) => {
      if (a[0] === "rev-parse") return "explicit-sha\n";
      throw new Error("merge-base darf nicht gefragt werden");
    };
    assert.equal(resolveBase(git3, { KQ_DIFF_BASE: "v1.2.3" }), "explicit-sha");

    // alles wirft → keine Basis.
    const git4: RunGit = () => {
      throw new Error("nichts da");
    };
    assert.equal(resolveBase(git4, {}), null);
  });

  // ── checkDiffSize: die vier Zustände (ok / über / geduldet / stale) + No-op ──
  const OVER = ["1\t1\ta", "1\t1\tb", "1\t1\tc"].join("\n"); // 3 Dateien, 6 Zeilen
  const tightEnv = { KQ_DIFFSIZE_MAX_FILES: "2", KQ_DIFFSIZE_MAX_LINES: "2" };
  const gitWith =
    (base: string | null, numstat: string): RunGit =>
    (a) => {
      if (a[0] === "merge-base" && a[2] === "origin/main") {
        if (base === null) throw new Error("keine Basis");
        return base + "\n";
      }
      if (a[0] === "merge-base") throw new Error("keine Basis");
      if (a[0] === "rev-parse") return "HEADSHA\n";
      if (a[0] === "diff") return numstat;
      throw new Error("unerwartet: " + a.join(" "));
    };

  test("checkDiffSize: unter Budget → ok, nicht übersprungen, nicht über", () => {
    const r = checkDiffSize({ runGit: gitWith("BASE", OVER), env: {} });
    assert.equal(r.skipped, false);
    assert.equal(r.over, false, "3 Dateien/6 Zeilen liegen unter dem Default-Budget");
  });

  test("checkDiffSize: über Budget ohne Override → over, nicht allowed/stale", () => {
    const r = checkDiffSize({ runGit: gitWith("BASE", OVER), env: tightEnv });
    assert.equal(r.over, true);
    assert.equal(r.allowed, false, "ohne Begründung nicht durchgelassen");
    assert.equal(r.stale, false);
  });

  test("checkDiffSize: über Budget MIT Begründung → allowed (durchgelassen)", () => {
    const r = checkDiffSize({ runGit: gitWith("BASE", OVER), env: { ...tightEnv, KQ_DIFFSIZE_OVERRIDE: "#317 Epic" } });
    assert.equal(r.over, true);
    assert.equal(r.allowed, true);
    assert.equal(r.stale, false);
    assert.equal(r.reason, "#317 Epic");
  });

  test("checkDiffSize: Override gesetzt, aber im Budget → stale", () => {
    const r = checkDiffSize({ runGit: gitWith("BASE", OVER), env: { KQ_DIFFSIZE_OVERRIDE: "unnötig" } });
    assert.equal(r.over, false);
    assert.equal(r.stale, true, "unnötiges Override wird als stale gemeldet");
  });

  test("checkDiffSize: keine Basis → No-op-grün (skipped), niemals rot", () => {
    const r = checkDiffSize({ runGit: gitWith(null, OVER), env: tightEnv });
    assert.equal(r.skipped, true, "flacher Checkout / kein origin/main → übersprungen");
    assert.equal(r.over ?? false, false);
  });

  test("checkDiffSize: Basis == HEAD → leerer Slice, übersprungen", () => {
    // merge-base liefert genau HEADSHA → nichts gegenüber main → No-op.
    const r = checkDiffSize({ runGit: gitWith("HEADSHA", OVER), env: tightEnv });
    assert.equal(r.skipped, true);
  });
});

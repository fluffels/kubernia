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
import { readFileSync } from "node:fs";

type Env = Record<string, string | undefined>;
type Sums = { fileCount: number; changedLines: number };
type Thresholds = { maxFiles: number; maxLines: number };
type Eval = { overFiles: boolean; overLines: boolean; over: boolean };
type RunGit = (args: string[]) => string;
type Trailers = { valid: { nr: number; reason: string }[]; invalid: string[] };

/** Die öffentliche Oberfläche des Wächters, wie dieser Test sie nutzt. */
type CheckDiffSizeModule = {
  MAX_FILES: number;
  MAX_LINES: number;
  OVERRIDE_KEY: string;
  readThresholds: (env?: Env) => Thresholds;
  parseNumstat: (text: string) => { files: { path: string; added: number; deleted: number; binary: boolean }[] } & Sums;
  evaluate: (sums: Sums, t: Thresholds) => Eval;
  resolveBase: (runGit: RunGit, env?: Env) => string | null;
  checkDiffSize: (opts: { runGit: RunGit; env?: Env }) => Record<string, unknown>;
  isGeneratedArtifact: (path: string) => boolean;
};

// Tooling-Skript ohne Declaration-File (scripts/ ist nicht im tsconfig-include). Der
// Namespace wird EINMAL auf die Oberfläche oben festgelegt, statt jeden Zugriff einzeln
// zu casten (wie test/diffcoverage.test.ts), sonst meldet der typbewusste Linter
// lauter no-unsafe-member-access.
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as checkDiffRaw from "../scripts/check-diffsize.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as sliceRaw from "../scripts/slice-override.mjs";

const { parseOverrideTrailers, sliceOverride } = sliceRaw as {
  parseOverrideTrailers: (text: string, key: string) => Trailers;
  sliceOverride: (runGit: RunGit, base: string, key: string) => { reason: string | null; invalid: string[]; versetzt: string[] };
};

const {
  MAX_FILES,
  MAX_LINES,
  OVERRIDE_KEY,
  readThresholds,
  parseNumstat,
  evaluate,
  resolveBase,
  checkDiffSize,
  isGeneratedArtifact,
} = checkDiffRaw as CheckDiffSizeModule;

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

  // ── Override als Commit-Trailer (#1269): wirkt lokal, im PR und auf main gleich ──
  test("parseOverrideTrailers: gültige Zeile liefert Ticketnummer + Begründung", () => {
    const r = parseOverrideTrailers("feat: x\n\nKQ-Diffsize-Override: #317 Rename-Welle über 40 Dateien\n", OVERRIDE_KEY);
    assert.deepEqual(r.valid, [{ nr: 317, reason: "#317 Rename-Welle über 40 Dateien" }]);
    assert.deepEqual(r.invalid, []);
  });

  test("parseOverrideTrailers: findet den Trailer mitten in einem Squash-Body (COMMIT_MESSAGES)", () => {
    const squash = [
      "feat(x): Welle (#12)",
      "",
      "* feat: erster Teil",
      "",
      "KQ-Diffsize-Override: #12 bewusst breit",
      "",
      "Co-Authored-By: jemand",
      "",
      "* fix: zweiter Teil",
    ].join("\r\n");
    assert.deepEqual(parseOverrideTrailers(squash, OVERRIDE_KEY).valid, [{ nr: 12, reason: "#12 bewusst breit" }]);
  });

  test("parseOverrideTrailers: Erwähnung in Prosa, eingerückt oder in Backticks zählt NICHT", () => {
    const text = [
      "docs: erklärt KQ-Diffsize-Override: #1 im Satz",
      "  KQ-Diffsize-Override: #2 eingerückt",
      "`KQ-Diffsize-Override: #3 backtick`",
      "  * KQ-Diffsize-Override: #2 x",
      "- KQ-Diffsize-Override: #3 x",
      "*KQ-Diffsize-Override: #4 x",
      "** KQ-Diffsize-Override: #5 x",
      "*  KQ-Diffsize-Override: #6 x",
      "* siehe KQ-Diffsize-Override: #7 x",
      "> KQ-Diffsize-Override: #8 x",
    ].join("\n");
    assert.deepEqual(parseOverrideTrailers(text, OVERRIDE_KEY), { valid: [], invalid: [] });
  });

  test("parseOverrideTrailers: ohne #<nr> oder ohne Begründung ungültig (Pflicht-Begründung)", () => {
    const text = ["KQ-Diffsize-Override: nur warum", "KQ-Diffsize-Override: #12", "KQ-Diffsize-Override:   "].join("\n");
    const r = parseOverrideTrailers(text, OVERRIDE_KEY);
    assert.deepEqual(r.valid, []);
    assert.equal(r.invalid.length, 3);
  });

  test("parseOverrideTrailers: ein fremder Schlüssel (Diffcov) wird nicht als Diffsize erkannt", () => {
    assert.deepEqual(parseOverrideTrailers("KQ-Diffcov-Override: #5 warum", OVERRIDE_KEY), { valid: [], invalid: [] });
    assert.equal(parseOverrideTrailers("KQ-Diffcov-Override: #5 warum", "KQ-Diffcov-Override").valid.length, 1);
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
    (base: string | null, numstat: string, log = ""): RunGit =>
    (a) => {
      if (a[0] === "merge-base" && a[2] === "origin/main") {
        if (base === null) throw new Error("keine Basis");
        return base + "\n";
      }
      if (a[0] === "merge-base") throw new Error("keine Basis");
      if (a[0] === "rev-parse") return "HEADSHA\n";
      if (a[0] === "diff") return numstat;
      if (a[0] === "log") return log;
      throw new Error("unerwartet: " + a.join(" "));
    };

  test("checkDiffSize: misst Drei-Punkt gegen die Merge-Base, nicht den Zwei-Punkt-Diff (Branch hinter main)", () => {
    const AUFGEBLAEHT = Array.from({ length: 30 }, (_, i) => `100\t0\tfremd${i}`).join("\n");
    const runGit: RunGit = (a) => {
      if (a[0] === "diff" && a[2] === "BASE...HEAD") return OVER;
      if (a[0] === "diff") return AUFGEBLAEHT; // Zwei-Punkt zählt main-Änderungen spiegelverkehrt mit
      return gitWith("BASE", OVER)(a);
    };
    const r = checkDiffSize({ runGit, env: {} });
    assert.equal(r.over, false, "nur der echte Slice zählt");
    assert.equal(r.fileCount, 3);
  });

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

  const TRAILER = "chore: bewusst breit\n\nKQ-Diffsize-Override: #317 Epic-Split\n";

  test("checkDiffSize: über Budget MIT Trailer im Slice → allowed (durchgelassen)", () => {
    const r = checkDiffSize({ runGit: gitWith("BASE", OVER, TRAILER), env: tightEnv });
    assert.equal(r.over, true);
    assert.equal(r.allowed, true);
    assert.equal(r.stale, false);
    assert.equal(r.reason, "#317 Epic-Split");
  });

  test("checkDiffSize (#1349 Z31): eine knapp danebenliegende Override-Zeile wird gemeldet und nicht still gewertet", () => {
    const daneben = "chore: x\n\n- KQ-Diffsize-Override: #1349 mit Strich\n  KQ-Diffsize-Override: #1349 eingerückt\n";
    const r = checkDiffSize({ runGit: gitWith("BASE", OVER, daneben), env: tightEnv });
    assert.equal(r.over, true);
    assert.equal(r.allowed, false, "die versetzten Zeilen zählen nicht als Override");
    assert.deepEqual(r.versetzteOverrides, ["- KQ-Diffsize-Override: #1349 mit Strich", "KQ-Diffsize-Override: #1349 eingerückt"]);
    // eine gültige Zeile daneben: Override wirkt, die versetzten bleiben nur Information
    const beides = checkDiffSize({ runGit: gitWith("BASE", OVER, `${daneben}\n${TRAILER}`), env: tightEnv });
    assert.equal(beides.allowed, true);
    assert.equal(checkDiffSize({ runGit: gitWith("BASE", OVER, TRAILER), env: tightEnv }).versetzteOverrides instanceof Array, true);
    assert.deepEqual(checkDiffSize({ runGit: gitWith("BASE", OVER, TRAILER), env: tightEnv }).versetzteOverrides, []);
  });

  // Format belegt an Commit 913cf17: GitHub schreibt jeden Commit-Betreff als `* <betreff>`.
  const SQUASH_1342 = [
    "feat(harness): Sammelticket komplett (#1342) (#1381)",
    "",
    "* feat(harness): Handback-Wächter (#1342)",
    "",
    "Co-Authored-By: Claude <noreply@anthropic.com>",
    "",
    "* KQ-Diffsize-Override: #1342 Sammelticket komplett: rund 45 Dateien",
    "",
    "Co-Authored-By: Claude <noreply@anthropic.com>",
    "",
    "* chore(review): Nachweis Plan und Review (#1342)",
    "",
    "KQ-Plan: kubernia-planner",
    "KQ-Review: head=2f1025d runden=2 lenses=architektur verdikt=ok",
    "",
    "---------",
    "",
    "Co-authored-by: Claude <noreply@anthropic.com>",
  ].join("\n");

  test("push:main: Override als Commit-Betreff erscheint im Squash als `* KQ-…` und lässt den Slice durch (#1383)", () => {
    const r = checkDiffSize({ runGit: gitWith("BASE", OVER, SQUASH_1342), env: tightEnv });
    assert.equal(r.over, true);
    assert.equal(r.allowed, true);
    assert.match(String(r.reason), /^#1342 /);
    assert.deepEqual(
      parseOverrideTrailers(SQUASH_1342, OVERRIDE_KEY).valid.map((v) => v.nr),
      [1342],
    );
  });

  test("parseOverrideTrailers: ungültiger Betreff `* KQ-…` wird ohne Präfix gemeldet (#1383)", () => {
    const r = parseOverrideTrailers("* KQ-Diffsize-Override: ohne nummer", OVERRIDE_KEY);
    assert.deepEqual(r, { valid: [], invalid: ["KQ-Diffsize-Override: ohne nummer"] });
  });

  test("checkDiffSize: liest die Commit-Messages genau im Slice-Bereich <basis>..HEAD", () => {
    const gerufen: string[][] = [];
    const runGit: RunGit = (a) => {
      gerufen.push(a);
      return gitWith("BASE", OVER, TRAILER)(a);
    };
    checkDiffSize({ runGit, env: tightEnv });
    assert.deepEqual(
      gerufen.find((a) => a[0] === "log"),
      ["log", "--reverse", "--format=%B", "BASE..HEAD"],
    );
  });

  test("checkDiffSize: Trailer gesetzt, aber im Budget → stale", () => {
    const r = checkDiffSize({ runGit: gitWith("BASE", OVER, TRAILER), env: {} });
    assert.equal(r.over, false);
    assert.equal(r.stale, true, "unnötiges Override wird als stale gemeldet");
  });

  test("checkDiffSize: nur ungültiger Trailer → bleibt rot und meldet die Zeile", () => {
    const r = checkDiffSize({ runGit: gitWith("BASE", OVER, "KQ-Diffsize-Override: ohne nummer"), env: tightEnv });
    assert.equal(r.over, true);
    assert.equal(r.allowed, false);
    assert.deepEqual(r.invalidOverrides, ["KQ-Diffsize-Override: ohne nummer"]);
  });

  test("checkDiffSize: git log scheitert → kein Override, über Budget bleibt rot", () => {
    const runGit: RunGit = (a) => {
      if (a[0] === "log") throw new Error("kaputt");
      return gitWith("BASE", OVER)(a);
    };
    const r = checkDiffSize({ runGit, env: tightEnv });
    assert.equal(r.allowed, false);
    assert.equal(r.over, true);
  });

  test("checkDiffSize: die alte Env KQ_DIFFSIZE_OVERRIDE lässt NICHTS mehr durch (nur Hinweis)", () => {
    const r = checkDiffSize({ runGit: gitWith("BASE", OVER), env: { ...tightEnv, KQ_DIFFSIZE_OVERRIDE: "#317 Epic" } });
    assert.equal(r.allowed, false, "lokal grün, CI rot darf es nicht mehr geben");
    assert.equal(r.legacyEnv, true);
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

  // ── #612: generierte Lockfiles zählen nicht zum reviewbaren Slice ──
  test("isGeneratedArtifact: Lockfiles (auch in Unterordnern), NICHT Quellcode", () => {
    assert.equal(isGeneratedArtifact("package-lock.json"), true);
    assert.equal(isGeneratedArtifact("npm-shrinkwrap.json"), true);
    assert.equal(isGeneratedArtifact("yarn.lock"), true);
    assert.equal(isGeneratedArtifact("pnpm-lock.yaml"), true);
    assert.equal(isGeneratedArtifact("sub/dir/package-lock.json"), true, "Basename greift auch in Unterordnern");
    assert.equal(isGeneratedArtifact("src/foo.ts"), false, "Quellcode zählt weiter mit");
    assert.equal(isGeneratedArtifact("package.json"), false, "package.json ist von Hand geschrieben");
  });

  test("checkDiffSize: ein riesiges Lockfile allein sprengt das Budget NICHT (#612)", () => {
    // Ein winziger Code-Slice + ein aufgeblähtes Lockfile (Dep-Ergänzung wie jscpd/#612).
    // Ohne die Exklusion wären das 1100 Zeilen > Default-Budget 800 → fälschlich rot.
    const numstat = ["10\t2\tsrc/foo.ts", "1100\t0\tpackage-lock.json"].join("\n");
    const r = checkDiffSize({ runGit: gitWith("BASE", numstat), env: {} });
    assert.equal(r.excludedCount, 1, "das Lockfile wird als ausgeschlossen gezählt");
    assert.equal(r.changedLines, 12, "nur der Code-Slice (10+2) zählt, nicht die 1100 Lockfile-Zeilen");
    assert.equal(r.fileCount, 1, "nur src/foo.ts zählt als Slice-Datei");
    assert.equal(r.over, false, "der reviewbare Slice liegt unter Budget");
  });

  test("Red-Green: dasselbe Lockfile-Volumen als Quellcode WÜRDE das Budget reißen", () => {
    // Beweist, dass die Exklusion wirkt (nicht das Budget an sich): identische Zeilen,
    // aber in einer .ts statt im Lockfile → over === true.
    const numstat = ["10\t2\tsrc/foo.ts", "1100\t0\tsrc/generated.ts"].join("\n");
    const r = checkDiffSize({ runGit: gitWith("BASE", numstat), env: {} });
    assert.equal(r.excludedCount, 0);
    assert.equal(r.over, true, "1112 echte Code-Zeilen sprengen das 800er-Budget");
  });

  test("Doku nennt den Override so, wie das Skript ihn liest (#1269: keine Env-Variable mehr)", () => {
    for (const datei of ["AGENTS.md", "docs/agent-harness.md"]) {
      const text = readFileSync(new URL(`../${datei}`, import.meta.url), "utf8");
      assert.ok(text.includes(`${OVERRIDE_KEY}: #<nr>`), `${datei} beschreibt die Commit-Zeile`);
      assert.ok(!text.includes("KQ_DIFFSIZE_OVERRIDE="), `${datei} verspricht keine Env-Variable mehr`);
    }
  });

  // Bindung je Override-Schlüssel an die Texte, die ihn beschreiben (#1309): fehlt ein Schlüssel in einer
  // dieser Dateien, driftet die Doku vom Skript weg (vorher war nur Diffsize in AGENTS.md/agent-harness gebunden).
  const BINDUNG: [string, string[]][] = [
    ["KQ-Diffsize-Override", ["AGENTS.md", "docs/agent-harness.md", "docs/adr/0009-pr-gating-required-checks.md"]],
    ["KQ-Diffcov-Override", ["docs/agent-harness.md", "docs/adr/0009-pr-gating-required-checks.md"]],
  ];
  for (const [schluessel, dateien] of BINDUNG) {
    test(`Doku-Bindung: ${schluessel} steht in ${dateien.join(", ")}`, () => {
      const fehlt = dateien.filter((d) => !readFileSync(new URL(`../${d}`, import.meta.url), "utf8").includes(schluessel));
      assert.deepEqual(fehlt, []);
    });
  }

  test("sliceOverride liest chronologisch (--reverse): die NEUESTE gültige Begründung zählt (#1309)", () => {
    // Fake-git verlangt --reverse und liefert dann ältesten zuerst; ohne das Flag käme die Reihenfolge
    // des normalen git log (neueste zuerst) und die ÄLTESTE Begründung würde angezeigt.
    const runGit: RunGit = (a) => {
      const chronologisch = a.includes("--reverse");
      const commits = ["alt\n\nKQ-Diffsize-Override: #1 alte Begründung\n", "neu\n\nKQ-Diffsize-Override: #2 neue Begründung\n"];
      return (chronologisch ? commits : [...commits].reverse()).join("\n");
    };
    assert.equal(sliceOverride(runGit, "BASE", OVERRIDE_KEY).reason, "#2 neue Begründung");
  });

  test("sliceOverride: git scheitert → kein Override, ungültige Zeilen werden gesammelt", () => {
    const wirft: RunGit = () => {
      throw new Error("kaputt");
    };
    assert.deepEqual(sliceOverride(wirft, "BASE", OVERRIDE_KEY), { reason: null, invalid: [], versetzt: [] });
    const nurUngueltig: RunGit = () => "x\n\nKQ-Diffsize-Override: ohne nummer\n";
    assert.deepEqual(sliceOverride(nurUngueltig, "BASE", OVERRIDE_KEY), { reason: null, invalid: ["KQ-Diffsize-Override: ohne nummer"], versetzt: [] });
  });
});

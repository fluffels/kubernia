/* Tests für scripts/slice-override.mjs (#1311): die Ausgabe-Helfer und der CLI-Zweig von check:diffcoverage,
 * die bisher ungetestet waren (Befund aus dem Review von #1309).
 *
 * Reines Node-Tooling ohne Declaration-File: Namespace einmal auf eine lokale Oberfläche gebracht. */
import { describe, expect, it } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as raw from "../scripts/slice-override.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as gate from "../scripts/check-review-nachweis.mjs";

const so = raw as unknown as {
  meldeUngueltigeOverrides: (invalid: string[] | undefined, o?: { dim?: (s: string) => string; log?: (s: string) => void }) => void;
  staleOverrideHinweis: (key: string, warum: string) => string;
  parseNachweis: (text: string) => { plan: unknown; review: { runden: number; lenses: string[] } | null };
  parseOverrideTrailers: (text: string, key: string) => { valid: { nr: number; reason: string }[]; invalid: string[] };
};
const gateModul = gate as unknown as { parseNachweis: unknown };

describe("meldeUngueltigeOverrides", () => {
  it("loggt je ungültiger Zeile genau eine gedimmte Meldung mit der Zeile", () => {
    const zeilen: string[] = [];
    so.meldeUngueltigeOverrides(["KQ-X-Override: kaputt", "KQ-X-Override: #5"], { dim: (s) => `<${s}>`, log: (s) => zeilen.push(s) });
    expect(zeilen).toHaveLength(2);
    expect(zeilen[0]).toBe("<• ungültige Override-Zeile ignoriert (braucht \"#<nr> <warum>\"): KQ-X-Override: kaputt>");
    expect(zeilen[1]).toContain("KQ-X-Override: #5");
  });

  it("leere, fehlende oder nicht übergebene Liste: keine Ausgabe, kein Wurf", () => {
    const zeilen: string[] = [];
    for (const leer of [[], undefined]) so.meldeUngueltigeOverrides(leer, { log: (s) => zeilen.push(s) });
    expect(zeilen).toEqual([]);
  });
});

describe("staleOverrideHinweis", () => {
  it("nennt Schlüssel und Grund und den Weg, den Override zu entfernen", () => {
    const t = so.staleOverrideHinweis("KQ-Diffcov-Override", "der Slice erfüllt die Floors");
    expect(t).toContain("KQ-Diffcov-Override steht im Slice, aber der Slice erfüllt die Floors");
    expect(t).toContain("stale");
    expect(t).toContain("Feature-Branch");
  });
});

describe("parseNachweis lebt im neutralen Modul (#1311)", () => {
  it("das Gate re-exportiert dieselbe Funktion; das Messskript liest sie aus slice-override", () => {
    expect(gateModul.parseNachweis).toBe(so.parseNachweis);
    const n = so.parseNachweis(`KQ-Plan: kubernia-planner\nKQ-Review: head=${"a".repeat(40)} runden=2 lenses=architektur,doku verdikt=ok`);
    expect(n.review?.runden).toBe(2);
    expect(n.review?.lenses).toEqual(["architektur", "doku"]);
  });
});

describe("check:diffcoverage CLI im Doku-Slice (nichts zu messen)", () => {
  const SKRIPT = join(__dirname, "..", "scripts", "check-diffcoverage.mjs");

  /** Temp-Repo: Basis-Commit, dann ein Doku-Commit mit der gegebenen Nachricht; liefert Ergebnis des CLI-Laufs. */
  function lauf(nachricht: string) {
    const dir = mkdtempSync(join(tmpdir(), "kq-dcov-"));
    try {
      const git = (...a: string[]) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...a], { cwd: dir, encoding: "utf8" }).trim();
      git("init", "-q");
      writeFileSync(join(dir, "a.md"), "eins\n");
      git("add", "-A");
      git("commit", "-q", "-m", "basis");
      const basis = git("rev-parse", "HEAD");
      writeFileSync(join(dir, "a.md"), "zwei\n");
      git("add", "-A");
      git("commit", "-q", "-m", "doku", "-m", nachricht);
      const r = spawnSync(process.execPath, [SKRIPT], { cwd: dir, encoding: "utf8", env: { ...process.env, KQ_DIFF_BASE: basis } });
      return { code: r.status, out: `${r.stdout}${r.stderr}` };
    } finally {
      rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  }

  it("ungültige Override-Zeile wird auch im grünen Zweig gemeldet, der Lauf bleibt grün", () => {
    const r = lauf("KQ-Diffcov-Override: ohne Nummer");
    expect(r.code).toBe(0);
    expect(r.out).toContain("ungültige Override-Zeile ignoriert");
    expect(r.out).toContain("keinen gemessenen Spielcode");
  });

  it("gültige Override-Zeile ohne messbaren Code ist stale und rot", () => {
    const r = lauf("KQ-Diffcov-Override: #1 weil");
    expect(r.code).toBe(1);
    expect(r.out).toContain("stale");
  });

  it("ohne Override-Zeile: grün, keine Meldung", () => {
    const r = lauf("ganz normal");
    expect(r.code).toBe(0);
    expect(r.out).not.toContain("ungültige Override-Zeile");
  });
});

// Format belegt an Commit 913cf17: GitHub schreibt jeden Commit-Betreff als `* <betreff>`, Body-Zeilen
// bleiben unverändert (#1383).
function squash(titel: string, commits: string[]): string {
  const teile = commits.map((c) => c.split("\n").map((z, i) => (i === 0 ? `* ${z}` : z)).join("\n") + "\n");
  return [titel, "", ...teile, "---------"].join("\n");
}
/** Wie `git log --reverse --format=%B` auf dem Branch. */
function branchLog(commits: string[]): string {
  return commits.map((c) => c + "\n").join("\n");
}

describe("PR-Log und Squash-Commit auf main lesen dasselbe (#1383)", () => {
  const KEY = "KQ-Diffsize-Override";
  const NACHWEIS = "KQ-Plan: kubernia-planner\nKQ-Review: head=abc1234 runden=1 lenses=architektur verdikt=ok";
  const szenarien: [string, string[]][] = [
    ["Override als Betreff", ["feat: a", `${KEY}: #5 breit`, "fix: b"]],
    ["Override als Body-Zeile", [`feat: a\n\n${KEY}: #5 breit`, "fix: b"]],
    ["ungültiger Override als Betreff", ["feat: a", `${KEY}: ohne nummer`]],
    ["alter als Betreff, neuer als Body", [`${KEY}: #1 alt`, `feat: a\n\n${KEY}: #2 neu`]],
    ["Nachweis wie im Workflow (KQ-Plan als Betreff)", ["feat: a", NACHWEIS]],
    ["Nachweis wie im Skill (beide im Body)", ["feat: a", `chore: Nachweis\n\n${NACHWEIS}`]],
  ];
  it.each(szenarien)("%s", (_name, commits) => {
    const pr = branchLog(commits);
    const main = squash("titel (#9)", commits);
    expect(so.parseOverrideTrailers(main, KEY)).toEqual(so.parseOverrideTrailers(pr, KEY));
    expect(so.parseNachweis(main)).toEqual(so.parseNachweis(pr));
  });

  it("neuester gewinnt in beiden Formen", () => {
    const commits = [`${KEY}: #1 alt`, `feat: a\n\n${KEY}: #2 neu`];
    expect(so.parseOverrideTrailers(branchLog(commits), KEY).valid.at(-1)?.nr).toBe(2);
    expect(so.parseOverrideTrailers(squash("t", commits), KEY).valid.at(-1)?.nr).toBe(2);
  });
});

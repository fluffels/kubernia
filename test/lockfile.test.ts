/* Lockfile-Integritäts-Wächter (#593, Governance) — fängt Lockfile-Drift lokal.
 *
 * `package.json` nutzt `^`-Ranges; die CI ist über `npm ci` reproduzierbar, aber
 * ohne dieses Gate fällt ein Drift zwischen package.json und package-lock.json
 * (Dep von Hand geändert, `npm install` vergessen) erst spät in der PR-CI auf.
 * Dieselbe Logik gibt es als CLI `npm run check:lockfile` (Teil von `npm run verify`).
 *
 * Rein struktureller Wächter (wie diffsize/docdrift), bewusst kein Verhaltens-Test.
 * Die Prüflogik wird aus scripts/check-lockfile.mjs importiert — EINE Quelle der
 * Wahrheit (kein Drift zwischen Test und CLI). Das Dateisystem wird NICHT berührt:
 * `auditLockfile` bekommt pkg/lock als reine Objekte injiziert.
 *
 * Ein zweiter Test hält den Wächter gegen den ECHTEN Repo-Lockfile scharf: er MUSS
 * grün sein (fängt einen unbeabsichtigten Drift auch im Test-Lauf).
 *
 * Ausführen mit:  npm test   (oder gezielt: npm run check:lockfile)
 */
import { describe, test } from "vitest";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// Reines Node-Tooling-Skript ohne Declaration-File (allowJs aus, scripts/ nicht im
// tsconfig-include) – der Laufzeit-Import genügt, Typen lokal deklariert.
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as checkLock from "../scripts/check-lockfile.mjs";

type Problem = { kind: string; [k: string]: unknown };
type Audit = { ok: boolean; problems: Problem[] };
type Pkg = Record<string, unknown>;
type Lock = Record<string, unknown> | null;

const DEP_BUCKETS: string[] = checkLock.DEP_BUCKETS;
const auditLockfile: (io: { pkg: Pkg; lock: Lock }) => Audit = checkLock.auditLockfile;
const describeProblem: (p: Problem) => string = checkLock.describeProblem;

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Baut einen minimalen, IN-SYNC Lockfile v3, dessen Wurzel packages[""] die deps
 *  aus dem übergebenen package.json spiegelt — der „grüne" Ausgangszustand. */
function lockMirroring(pkg: Pkg): Lock {
  const root: Record<string, unknown> = { name: pkg.name, version: pkg.version };
  for (const b of DEP_BUCKETS) if (pkg[b]) root[b] = { ...(pkg[b] as object) };
  return { name: pkg.name, version: pkg.version, lockfileVersion: 3, packages: { "": root } };
}

const BASE_PKG: Pkg = {
  name: "kubequest",
  version: "3.0.0",
  dependencies: { phaser: "^3.87.0" },
  devDependencies: { vite: "^8.1.0", vitest: "^4.1.9" },
};

describe("Lockfile-Integrität (#593)", () => {
  test("in sync → ok, keine Befunde", () => {
    const r = auditLockfile({ pkg: BASE_PKG, lock: lockMirroring(BASE_PKG) });
    assert.equal(r.ok, true, "gespiegelter Lockfile ist synchron");
    assert.deepEqual(r.problems, []);
  });

  test("Detektion greift wirklich (Red-Green): ein Bump ohne install wird rot", () => {
    // No-op-Schutz: ein Wächter, der immer grün ist, wäre wertlos. package.json
    // bumpt phaser, der Lockfile bleibt auf der alten Range → MUSS treffen.
    const lock = lockMirroring(BASE_PKG);
    const bumped: Pkg = { ...BASE_PKG, dependencies: { phaser: "^4.0.0" } };
    const r = auditLockfile({ pkg: bumped, lock });
    assert.equal(r.ok, false);
    const p = r.problems.find((x) => x.kind === "spec-mismatch");
    assert.ok(p, "spec-mismatch muss gemeldet werden");
    assert.equal(p!.name, "phaser");
    assert.equal(p!.pkgSpec, "^4.0.0");
    assert.equal(p!.lockSpec, "^3.87.0");
  });

  test("neue Dependency in package.json, aber nicht im Lockfile → missing", () => {
    const lock = lockMirroring(BASE_PKG);
    const withNew: Pkg = { ...BASE_PKG, dependencies: { ...(BASE_PKG.dependencies as object), lodash: "^4.17.0" } };
    const r = auditLockfile({ pkg: withNew, lock });
    assert.equal(r.ok, false);
    const p = r.problems.find((x) => x.kind === "missing" && x.name === "lodash");
    assert.ok(p, "fehlende Dependency muss gemeldet werden");
    assert.equal(p!.bucket, "dependencies");
  });

  test("Dependency aus package.json entfernt, aber noch im Lockfile → extra", () => {
    const lock = lockMirroring(BASE_PKG);
    const removed: Pkg = { ...BASE_PKG, devDependencies: { vite: "^8.1.0" } }; // vitest raus
    const r = auditLockfile({ pkg: removed, lock });
    assert.equal(r.ok, false);
    const p = r.problems.find((x) => x.kind === "extra" && x.name === "vitest");
    assert.ok(p, "verwaiste Lockfile-Dependency muss gemeldet werden");
    assert.equal(p!.bucket, "devDependencies");
  });

  test("Projekt-Version gebumpt ohne install → version-mismatch", () => {
    const lock = lockMirroring(BASE_PKG);
    const r = auditLockfile({ pkg: { ...BASE_PKG, version: "3.1.0" }, lock });
    assert.equal(r.ok, false);
    assert.ok(r.problems.some((x) => x.kind === "version-mismatch"), "Version-Drift muss auffallen");
  });

  test("fehlender Lockfile → missing-lockfile (nicht still grün)", () => {
    const r = auditLockfile({ pkg: BASE_PKG, lock: null });
    assert.equal(r.ok, false);
    assert.deepEqual(r.problems, [{ kind: "missing-lockfile" }]);
  });

  test("v1-Lockfile (keine packages-Wurzel) → lockfile-version, nicht still grün", () => {
    const r = auditLockfile({ pkg: BASE_PKG, lock: { lockfileVersion: 1 } });
    assert.equal(r.ok, false);
    assert.equal(r.problems[0].kind, "lockfile-version");
  });

  test("Lockfile ohne packages[\"\"] → missing-root-package", () => {
    const r = auditLockfile({ pkg: BASE_PKG, lock: { lockfileVersion: 3, packages: {} } });
    assert.equal(r.ok, false);
    assert.equal(r.problems[0].kind, "missing-root-package");
  });

  test("describeProblem: liefert für jede kind-Art eine nicht-leere, spezifische Zeile", () => {
    const kinds = [
      { kind: "missing-lockfile" },
      { kind: "lockfile-version", version: 1 },
      { kind: "missing-root-package" },
      { kind: "name-mismatch", pkg: "a", lock: "b" },
      { kind: "version-mismatch", pkg: "1", lock: "2" },
      { kind: "missing", bucket: "dependencies", name: "x", spec: "^1" },
      { kind: "extra", bucket: "devDependencies", name: "y", lockSpec: "^2" },
      { kind: "spec-mismatch", bucket: "dependencies", name: "z", pkgSpec: "^1", lockSpec: "^2" },
    ];
    for (const k of kinds) {
      const line = describeProblem(k as Problem);
      assert.ok(line.length > 0 && !line.includes("unbekannter Befund"), `Zeile für ${k.kind}`);
    }
  });

  // Scharf gegen die Realität: der echte Repo-Lockfile MUSS synchron sein.
  test("der echte package-lock.json des Repos ist synchron zu package.json", () => {
    const pkg = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8"));
    const lock = JSON.parse(readFileSync(join(REPO_ROOT, "package-lock.json"), "utf8"));
    const r = auditLockfile({ pkg, lock });
    assert.equal(r.ok, true, "Repo-Lockfile driftet: " + r.problems.map(describeProblem).join(" | "));
  });
});

// ── Slice-Prüfung: Lockfile ohne package.json (#1411) ─────────────────────────────
describe("Lockfile-Drift im Slice (#1411)", () => {
  type Slice = {
    skipped: boolean;
    drift: boolean;
    dependabot?: boolean;
    over?: boolean;
    allowed?: boolean;
    stale?: boolean;
    reason?: string | null;
    invalidOverrides?: string[];
  };
  const sliceModul = checkLock as unknown as {
    checkLockfileSlice: (o: { runGit: (a: string[]) => string; env?: Record<string, string> }) => Slice;
    OVERRIDE_KEY: string;
  };
  const checkLockfileSlice = sliceModul.checkLockfileSlice;
  const OVERRIDE = sliceModul.OVERRIDE_KEY;
  const DEPENDABOT = "49699333+dependabot[bot]@users.noreply.github.com";
  const MENSCH = "12345+fluffels@users.noreply.github.com";

  /** Fake-git: Basis BASE, geänderte Dateien, Autor-Mails der Slice-Commits, Commit-Messages. */
  const gitMit =
    (opts: { geaendert?: string; mails?: string[]; messages?: string; basis?: boolean; diffWirft?: boolean }) =>
    (a: string[]): string => {
      if (a[0] === "merge-base") {
        if (opts.basis === false) throw new Error("keine Basis");
        return a[2] === "origin/main" ? "BASE\n" : "BASE\n";
      }
      if (a[0] === "diff") {
        if (opts.diffWirft) throw new Error("diff kaputt");
        return opts.geaendert ?? "";
      }
      if (a[0] === "log" && a.includes("--format=%ae")) return (opts.mails ?? [MENSCH]).join("\n") + "\n";
      if (a[0] === "log") return opts.messages ?? "";
      throw new Error("unerwartet: " + a.join(" "));
    };
  const messe = (o: Parameters<typeof gitMit>[0]) => checkLockfileSlice({ runGit: gitMit(o), env: {} });

  test("nur package-lock.json geändert (Metadaten-Drift) → rot", () => {
    const r = messe({ geaendert: "package-lock.json\n" });
    assert.equal(r.drift, true);
    assert.equal(r.over, true);
    assert.equal(r.allowed, false);
    assert.equal(r.stale, false);
  });

  test("Lockfile zusammen mit package.json geändert → grün", () => {
    const r = messe({ geaendert: "package-lock.json\npackage.json\n" });
    assert.equal(r.drift, false);
    assert.equal(r.over, false);
  });

  test("weder Lockfile noch package.json geändert, und nur package.json allein → grün", () => {
    assert.equal(messe({ geaendert: "" }).over, false);
    assert.equal(messe({ geaendert: "package.json\n" }).over, false);
  });

  test("Dependabot: alle Commits des Slices von dependabot[bot] → grün; ein Menschen-Commit dazwischen → rot", () => {
    const nurBot = messe({ geaendert: "package-lock.json\n", mails: [DEPENDABOT, DEPENDABOT] });
    assert.equal(nurBot.dependabot, true);
    assert.equal(nurBot.over, false);
    const gemischt = messe({ geaendert: "package-lock.json\n", mails: [DEPENDABOT, MENSCH] });
    assert.equal(gemischt.dependabot, false);
    assert.equal(gemischt.over, true);
    assert.equal(messe({ geaendert: "package-lock.json\n", mails: [] }).over, true, "keine Autoren lesbar → keine Ausnahme");
  });

  test("Override mit Begründung lässt den Drift durch (allowed); ohne Nummer oder Begründung zählt er nicht", () => {
    const ok = messe({ geaendert: "package-lock.json\n", messages: `chore\n\n${OVERRIDE}: #99 npm-Update bewusst\n` });
    assert.equal(ok.allowed, true);
    assert.equal(ok.reason, "#99 npm-Update bewusst");
    const ungueltig = messe({ geaendert: "package-lock.json\n", messages: `chore\n\n${OVERRIDE}: ohne nummer\n` });
    assert.equal(ungueltig.allowed, false);
    assert.equal(ungueltig.over, true);
    assert.deepEqual(ungueltig.invalidOverrides, [`${OVERRIDE}: ohne nummer`]);
  });

  test("Override ohne Drift (Lockfile mit package.json, Dependabot, kein Lockfile-Diff) ist stale", () => {
    const messages = `x\n\n${OVERRIDE}: #99 grundlos\n`;
    assert.equal(messe({ geaendert: "package-lock.json\npackage.json\n", messages }).stale, true);
    assert.equal(messe({ geaendert: "", messages }).stale, true);
    assert.equal(messe({ geaendert: "package-lock.json\n", mails: [DEPENDABOT], messages }).stale, true);
  });

  test("keine auflösbare Basis oder git-Fehler → kein Urteil (kein falsches Rot)", () => {
    assert.deepEqual(messe({ basis: false }), { skipped: true, drift: false });
    assert.deepEqual(messe({ diffWirft: true }), { skipped: true, drift: false });
  });

  test("der Diff läuft Drei-Punkt gegen die Basis und nur über die beiden Manifest-Dateien", () => {
    const gesehen: string[][] = [];
    checkLockfileSlice({
      runGit: (a) => {
        gesehen.push(a);
        return gitMit({ geaendert: "" })(a);
      },
      env: {},
    });
    const diff = gesehen.find((a) => a[0] === "diff") ?? [];
    assert.ok(diff.includes("BASE...HEAD"), "Drei-Punkt");
    assert.deepEqual(diff.slice(diff.indexOf("--") + 1), ["package.json", "package-lock.json"]);
  });

  test("Doku nennt den Override so, wie das Skript ihn liest", () => {
    for (const datei of ["AGENTS.md", "docs/agent-harness.md"]) {
      const text = readFileSync(join(REPO_ROOT, datei), "utf8");
      assert.ok(text.includes(OVERRIDE), `${datei} beschreibt ${OVERRIDE}`);
    }
  });
});

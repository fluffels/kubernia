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

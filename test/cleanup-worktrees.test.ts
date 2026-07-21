/* Verwaiste-Worktree-Diagnose/-Cleanup (#908/#952).
 *
 * Die Logik lebt in scripts/cleanup-worktrees.mjs (EINE Quelle fuer das
 * CLI-Skript und den automatischen Check in scripts/stop-verify-hook.mjs).
 * git/fs werden NICHT ausgefuehrt -- execSync/fs-Funktionen sind injiziert,
 * damit der Test deterministisch und ohne echten Repo-Zustand laeuft.
 *
 * Ausfuehren mit: npm test
 */
import { describe, test } from "vitest";
import assert from "node:assert/strict";

// Reines Node-Tooling-Skript ohne Declaration-File (wie scripts/check-diffsize.mjs).
// @ts-expect-error: kein .d.ts fuer das .mjs-Tooling-Skript.
import * as cleanup from "../scripts/cleanup-worktrees.mjs";

const parseWorktreeListPorcelain: (output: string) => string[] =
  cleanup.parseWorktreeListPorcelain;
const registeredWorktreePaths: (cwd: string, deps?: object) => string[] =
  cleanup.registeredWorktreePaths;
const localWorktreeDirs: (worktreesDir: string, deps?: object) => string[] =
  cleanup.localWorktreeDirs;
const computeOrphans: (worktreesDir: string, dirs: string[], registered: Set<string>) => string[] =
  cleanup.computeOrphans;
const diagnoseOrphans: (
  cwd: string,
  deps?: object
) => { ok: boolean; orphans: string[]; mainRoot: string | null; worktreesDir: string | null } =
  cleanup.diagnoseOrphans;
const fixOrphans: (
  mainRoot: string,
  worktreesDir: string,
  orphans: string[],
  deps?: object
) => { removed: string[]; errors: string[] } = cleanup.fixOrphans;

describe("parseWorktreeListPorcelain (#952)", () => {
  test("ein Eintrag (nur Haupt-Checkout)", () => {
    const out = ["worktree /c/git/kubernia", "HEAD abc123", "branch refs/heads/main", ""].join("\n");
    assert.deepEqual(parseWorktreeListPorcelain(out), ["/c/git/kubernia"]);
  });

  test("Haupt-Checkout zuerst, dann Linked Worktrees in Reihenfolge", () => {
    const out = [
      "worktree /c/git/kubernia",
      "HEAD abc123",
      "branch refs/heads/main",
      "",
      "worktree /c/git/kubernia/.claude/worktrees/kq-1",
      "HEAD def456",
      "branch refs/heads/kq-1",
      "",
      "worktree /c/git/kubernia/.claude/worktrees/kq-2",
      "HEAD ghi789",
      "branch refs/heads/kq-2",
      "",
    ].join("\n");
    assert.deepEqual(parseWorktreeListPorcelain(out), [
      "/c/git/kubernia",
      "/c/git/kubernia/.claude/worktrees/kq-1",
      "/c/git/kubernia/.claude/worktrees/kq-2",
    ]);
  });

  test("Windows-Pfade mit Backslashes werden auf Slashes normalisiert", () => {
        const bs = String.fromCharCode(92);
        const winPath = "worktree C:" + bs + "git" + bs + "kubernia";
        const out = [winPath, "HEAD abc123", "branch refs/heads/main", ""].join("\n");
        assert.deepEqual(parseWorktreeListPorcelain(out), ["C:/git/kubernia"]);
    });


  test("CRLF-Zeilenenden werden korrekt geparst", () => {
    const out = ["worktree /c/git/kubernia", "HEAD abc123", "branch refs/heads/main", ""].join("\r\n");
    assert.deepEqual(parseWorktreeListPorcelain(out), ["/c/git/kubernia"]);
  });

  test("leerer Output ergibt leeres Array", () => {
    assert.deepEqual(parseWorktreeListPorcelain(""), []);
  });
});

describe("registeredWorktreePaths (#952)", () => {
  test("gibt geparste Pfade zurueck", () => {
    const deps = {
      execSync: () => "worktree /c/git/kubernia\nHEAD abc\nbranch refs/heads/main\n\n",
    };
    assert.deepEqual(registeredWorktreePaths("/c/git/kubernia", deps), ["/c/git/kubernia"]);
  });

  test("execSync wirft, Fehler propagiert (Aufrufer entscheidet fail-safe)", () => {
    const deps = {
      execSync: () => {
        throw new Error("kein git");
      },
    };
    assert.throws(() => registeredWorktreePaths("/c/git/kubernia", deps));
  });
});

describe("localWorktreeDirs (#952)", () => {
  test("Ordner existiert nicht, leeres Array", () => {
    const deps = { existsSync: () => false };
    assert.deepEqual(localWorktreeDirs("/x/.claude/worktrees", deps), []);
  });

  test("nur Verzeichnisse werden zurueckgegeben, keine Dateien", () => {
    const deps = {
      existsSync: () => true,
      readdirSync: () => [
        { name: "kq-1", isDirectory: () => true },
        { name: ".gitkeep", isDirectory: () => false },
        { name: "kq-2", isDirectory: () => true },
      ],
    };
    assert.deepEqual(localWorktreeDirs("/x/.claude/worktrees", deps), ["kq-1", "kq-2"]);
  });
});

describe("computeOrphans (#952)", () => {
  test("kein Ordner ist registriert, alle sind Waisen", () => {
    const orphans = computeOrphans("/root/.claude/worktrees", ["kq-1", "kq-2"], new Set());
    assert.deepEqual(orphans, ["kq-1", "kq-2"]);
  });

  test("alle Ordner registriert, keine Waisen", () => {
    const registered = new Set(["/root/.claude/worktrees/kq-1", "/root/.claude/worktrees/kq-2"]);
    assert.deepEqual(computeOrphans("/root/.claude/worktrees", ["kq-1", "kq-2"], registered), []);
  });

  test("gemischt, nur die nicht-registrierten sind Waisen", () => {
    const registered = new Set(["/root/.claude/worktrees/kq-1"]);
    assert.deepEqual(
      computeOrphans("/root/.claude/worktrees", ["kq-1", "kq-2", "kq-3"], registered),
      ["kq-2", "kq-3"]
    );
  });
});

describe("diagnoseOrphans (#952)", () => {
  test("Haupt-Checkout sauber, ein Waisen-Ordner, ok true und orphans enthaelt ihn", () => {
    const deps = {
      execSync: () =>
        "worktree /root\nHEAD abc\nbranch refs/heads/main\n\n" +
        "worktree /root/.claude/worktrees/kq-1\nHEAD def\nbranch refs/heads/kq-1\n\n",
      existsSync: () => true,
      readdirSync: () => [
        { name: "kq-1", isDirectory: () => true },
        { name: "kq-2", isDirectory: () => true },
      ],
    };
    const result = diagnoseOrphans("/root", deps);
    assert.equal(result.ok, true);
    assert.deepEqual(result.orphans, ["kq-2"]);
    assert.equal(result.mainRoot, "/root");
  });

  test("keine lokalen Ordner, ok true, orphans leer", () => {
    const deps = {
      execSync: () => "worktree /root\nHEAD abc\nbranch refs/heads/main\n\n",
      existsSync: () => false,
    };
    const result = diagnoseOrphans("/root", deps);
    assert.equal(result.ok, true);
    assert.deepEqual(result.orphans, []);
  });

  test("git worktree list schlaegt fehl, ok false, orphans leer, fail-safe statt alles als Waise zu melden", () => {
    const deps = {
      execSync: () => {
        throw new Error("kein git-Repo");
      },
    };
    const result = diagnoseOrphans("/root", deps);
    assert.equal(result.ok, false);
    assert.deepEqual(result.orphans, []);
  });

  test("leerer git-Output, sollte nie vorkommen, ok false statt Absturz", () => {
    const deps = { execSync: () => "" };
    const result = diagnoseOrphans("/root", deps);
    assert.equal(result.ok, false);
  });
});

describe("fixOrphans (#952)", () => {
  test("erfolgreiches Loeschen, removed enthaelt Namen, errors leer", () => {
    const deps = {
      execSync: () => "",
      rmSync: () => {},
      existsSync: () => false,
    };
    const result = fixOrphans("/root", "/root/.claude/worktrees", ["kq-1"], deps);
    assert.deepEqual(result.removed, ["kq-1"]);
    assert.deepEqual(result.errors, []);
  });

  test("Ordner besteht nach rmSync weiter, Datei-Lock, errors enthaelt Namen", () => {
    const deps = {
      execSync: () => "",
      rmSync: () => {},
      existsSync: () => true,
    };
    const result = fixOrphans("/root", "/root/.claude/worktrees", ["kq-1"], deps);
    assert.deepEqual(result.removed, []);
    assert.deepEqual(result.errors, ["kq-1"]);
  });

  test("rmSync wirft, als error gezaehlt, kein Absturz", () => {
    const deps = {
      execSync: () => "",
      rmSync: () => {
        throw new Error("EBUSY");
      },
      existsSync: () => true,
    };
    const result = fixOrphans("/root", "/root/.claude/worktrees", ["kq-1"], deps);
    assert.deepEqual(result.errors, ["kq-1"]);
  });

  test("git worktree prune schlaegt fehl, nicht fatal, Loeschung laeuft trotzdem", () => {
    const deps = {
      execSync: () => {
        throw new Error("prune failed");
      },
      rmSync: () => {},
      existsSync: () => false,
    };
    const result = fixOrphans("/root", "/root/.claude/worktrees", ["kq-1"], deps);
    assert.deepEqual(result.removed, ["kq-1"]);
  });

  test("mehrere Waisen, gemischtes Ergebnis", () => {
    const deps = {
      execSync: () => "",
      rmSync: (path: string) => {
        if (path.includes("kq-locked")) throw new Error("EBUSY");
      },
      existsSync: () => false,
    };
    const result = fixOrphans("/root", "/root/.claude/worktrees", ["kq-1", "kq-locked", "kq-2"], deps);
    assert.deepEqual(result.removed, ["kq-1", "kq-2"]);
    assert.deepEqual(result.errors, ["kq-locked"]);
  });

  test("leere orphans-Liste, removed und errors beide leer", () => {
    const deps = { execSync: () => "" };
    const result = fixOrphans("/root", "/root/.claude/worktrees", [], deps);
    assert.deepEqual(result.removed, []);
    assert.deepEqual(result.errors, []);
  });
});

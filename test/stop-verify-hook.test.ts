/* Stop-Verify-Hook (#708/#909) — Stop-Hook, der verify im aktiven Worktree ausführt.
 *
 * #708: fängt uncommittete Änderungen im Haupt-Checkout auf.
 * #909: fängt uncommittete Änderungen in Linked Worktrees auf (Normalfall des
 *       Worktree-Workflows, wo der Haupt-Checkout immer sauber ist).
 *
 * Die Erkennungslogik lebt in scripts/stop-verify-hook.mjs (EINE Quelle für
 * Hook-CLI und Test). git/npm werden NICHT ausgeführt — spawnSync ist injiziert,
 * damit der Test deterministisch und ohne echten Repo-Zustand läuft.
 *
 * Ausführen mit: npm test
 */
import { describe, test } from "vitest";
import assert from "node:assert/strict";

// Reines Node-Tooling-Skript ohne Declaration-File (wie scripts/check-diffsize.mjs).
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as hook from "../scripts/stop-verify-hook.mjs";

type SpawnResult = { status: number; stdout?: string; stderr?: string };
type SpawnDeps = { spawnSync?: (cmd: string, args: string[], opts: object) => SpawnResult };

const parseStopInput: (text: string) => { stopHookActive: boolean } = hook.parseStopInput;
const hasUncommittedChanges: (repoRoot: string, deps?: SpawnDeps) => boolean =
  hook.hasUncommittedChanges;
const listLinkedWorktrees: (repoRoot: string, deps?: SpawnDeps) => string[] =
  hook.listLinkedWorktrees;
const repoRootFromScriptUrl: (url: string) => string = hook.repoRootFromScriptUrl;

// ── parseStopInput ────────────────────────────────────────────────────────────

describe("parseStopInput (#708)", () => {
  test("stop_hook_active:true → stopHookActive true", () => {
    const r = parseStopInput(JSON.stringify({ stop_hook_active: true }));
    assert.equal(r.stopHookActive, true);
  });

  test("stop_hook_active:false → stopHookActive false", () => {
    const r = parseStopInput(JSON.stringify({ stop_hook_active: false }));
    assert.equal(r.stopHookActive, false);
  });

  test("leeres JSON-Objekt → stopHookActive false", () => {
    assert.equal(parseStopInput("{}").stopHookActive, false);
  });

  test("kaputtes JSON → stopHookActive false (kein Absturz)", () => {
    assert.equal(parseStopInput("KEIN JSON").stopHookActive, false);
  });

  test("leerer String → stopHookActive false", () => {
    assert.equal(parseStopInput("").stopHookActive, false);
  });
});

// ── hasUncommittedChanges ────────────────────────────────────────────────────

describe("hasUncommittedChanges (#708)", () => {
  test("exit 1 (Änderungen vorhanden) → true", () => {
    const deps: SpawnDeps = { spawnSync: () => ({ status: 1 }) };
    assert.equal(hasUncommittedChanges("/repo", deps), true);
  });

  test("exit 0 (sauber) → false", () => {
    const deps: SpawnDeps = { spawnSync: () => ({ status: 0 }) };
    assert.equal(hasUncommittedChanges("/repo", deps), false);
  });

  test("spawnSync wirft Fehler (kein git) → false (fail-open)", () => {
    const deps: SpawnDeps = {
      spawnSync: () => {
        throw new Error("kein git");
      },
    };
    assert.equal(hasUncommittedChanges("/repo", deps), false);
  });
});

// ── listLinkedWorktrees (#909) ────────────────────────────────────────────────

describe("listLinkedWorktrees (#909)", () => {
  /** Erzeugt einen spawnSync-Stub, der auf `git worktree list --porcelain` mit
   *  `stdout` antwortet (status 0). Andere Kommandos werden ignoriert. */
  function stubWorktreeList(stdout: string): SpawnDeps {
    return {
      spawnSync: (_cmd: string, args: string[]) =>
        args.includes("--porcelain") ? { status: 0, stdout } : { status: 0, stdout: "" },
    };
  }

  test("nur Haupt-Checkout → leeres Array", () => {
    const output = [
      "worktree /c/git/kubernia",
      "HEAD abc123",
      "branch refs/heads/main",
      "",
    ].join("\n");
    assert.deepEqual(listLinkedWorktrees("/c/git/kubernia", stubWorktreeList(output)), []);
  });

  test("Haupt-Checkout + ein Linked Worktree → einen Pfad", () => {
    const output = [
      "worktree /c/git/kubernia",
      "HEAD abc123",
      "branch refs/heads/main",
      "",
      "worktree /c/git/kubernia/.claude/worktrees/kq-909",
      "HEAD def456",
      "branch refs/heads/kq-909",
      "",
    ].join("\n");
    assert.deepEqual(listLinkedWorktrees("/c/git/kubernia", stubWorktreeList(output)), [
      "/c/git/kubernia/.claude/worktrees/kq-909",
    ]);
  });

  test("Haupt-Checkout + zwei Linked Worktrees → zwei Pfade", () => {
    const output = [
      "worktree /c/git/kubernia",
      "HEAD abc123",
      "branch refs/heads/main",
      "",
      "worktree /c/git/kubernia/.claude/worktrees/kq-909",
      "HEAD def456",
      "branch refs/heads/kq-909",
      "",
      "worktree /c/git/kubernia/.claude/worktrees/kq-123",
      "HEAD ghi789",
      "branch refs/heads/kq-123",
      "",
    ].join("\n");
    assert.deepEqual(listLinkedWorktrees("/c/git/kubernia", stubWorktreeList(output)), [
      "/c/git/kubernia/.claude/worktrees/kq-909",
      "/c/git/kubernia/.claude/worktrees/kq-123",
    ]);
  });

  test("Windows-Pfade mit Backslashes in der git-Ausgabe werden korrekt zurückgegeben", () => {
    const output = [
      "worktree C:\\git\\kubernia",
      "HEAD abc123",
      "branch refs/heads/main",
      "",
      "worktree C:\\git\\kubernia\\.claude\\worktrees\\kq-909",
      "HEAD def456",
      "branch refs/heads/kq-909",
      "",
    ].join("\n");
    assert.deepEqual(listLinkedWorktrees("C:\\git\\kubernia", stubWorktreeList(output)), [
      "C:\\git\\kubernia\\.claude\\worktrees\\kq-909",
    ]);
  });

  test("git exit ≠ 0 → leeres Array (fail-open)", () => {
    const deps: SpawnDeps = {
      spawnSync: () => ({ status: 1, stdout: "" }),
    };
    assert.deepEqual(listLinkedWorktrees("/repo", deps), []);
  });

  test("spawnSync wirft → leeres Array (fail-open)", () => {
    const deps: SpawnDeps = {
      spawnSync: () => {
        throw new Error("kein git");
      },
    };
    assert.deepEqual(listLinkedWorktrees("/repo", deps), []);
  });

  test("CRLF-Zeilenenden (Windows) werden korrekt geparst", () => {
    const output = [
      "worktree /c/git/kubernia",
      "HEAD abc123",
      "branch refs/heads/main",
      "",
      "worktree /c/git/kubernia/.claude/worktrees/kq-909",
      "HEAD def456",
      "branch refs/heads/kq-909",
      "",
    ]
      .join("\r\n");
    assert.deepEqual(listLinkedWorktrees("/c/git/kubernia", stubWorktreeList(output)), [
      "/c/git/kubernia/.claude/worktrees/kq-909",
    ]);
  });
});

// ── repoRootFromScriptUrl (Smoke) ────────────────────────────────────────────

describe("repoRootFromScriptUrl", () => {
  test("leitet Repo-Root korrekt aus scripts/-Pfad ab (zwei Ebenen hoch)", () => {
    // Nutzt import.meta.url des TESTS selbst: test/ → repo-root (eine Ebene hoch).
    // Das Skript liegt in scripts/ (auch eine Ebene unter Root), also muss
    // repoRootFromScriptUrl auf eine gefakte scripts/-URL dieselbe Tiefe liefern.
    // Wir simulieren mit einem Pfad, der auf der aktuellen Plattform gültig ist,
    // indem wir den echten scripts/-Pfad aus dem bekannten import.meta.url ableiten.
    const scriptUrl = import.meta.url.replace(/\/test\/[^/]+$/, "/scripts/stop-verify-hook.mjs");
    const root = repoRootFromScriptUrl(scriptUrl);
    const rootNorm = root.replace(/\\/g, "/");
    // Repo-Root muss auf "kubernia" enden (keine scripts/-Komponente mehr)
    assert.ok(
      !rootNorm.endsWith("/scripts") && rootNorm.includes("kubernia"),
      `Erwartet Pfad mit kubernia ohne /scripts/, bekam: ${root}`
    );
  });
});

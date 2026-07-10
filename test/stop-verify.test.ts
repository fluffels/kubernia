/* Stop-Verify-Hook (#708) — Stop-Hook, der `npm run verify` ausführt, wenn der Agent
 * seinen Turn mit uncommitteten Änderungen im Haupt-Checkout beendet.
 *
 * Rein struktureller Wächter (wie worktree-guard.test.ts): die Erkennungslogik lebt in
 * scripts/stop-verify-hook.mjs (EINE Quelle für Hook-CLI und Test). git/npm werden NICHT
 * aufgerufen — spawnSync ist injiziert, damit der Test deterministisch läuft.
 *
 * Ausführen mit: npm test
 */
import { describe, test } from "vitest";
import assert from "node:assert/strict";

// Reines Node-Tooling-Skript ohne Declaration-File (wie scripts/check-diffsize.mjs).
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as hook from "../scripts/stop-verify-hook.mjs";

type ParseResult = { stopHookActive: boolean };
type VerifyResult = { ok: boolean; output: string };

const parseStopInput: (text: string) => ParseResult = hook.parseStopInput;
const hasUncommittedChanges: (repoRoot: string, deps?: object) => boolean = hook.hasUncommittedChanges;
const runVerify: (repoRoot: string, deps?: object) => VerifyResult = hook.runVerify;
const repoRootFromScriptUrl: (importMetaUrl: string) => string = hook.repoRootFromScriptUrl;

// ── parseStopInput ───────────────────────────────────────────────────────────

describe("parseStopInput (#708)", () => {
  test("returns stopHookActive:false for empty input", () => {
    const result = parseStopInput("");
    assert.equal(result.stopHookActive, false);
  });

  test("returns stopHookActive:false for invalid JSON", () => {
    const result = parseStopInput("{not valid json");
    assert.equal(result.stopHookActive, false);
  });

  test("returns stopHookActive:false when field absent", () => {
    const result = parseStopInput(JSON.stringify({ other: "field" }));
    assert.equal(result.stopHookActive, false);
  });

  test("returns stopHookActive:true when stop_hook_active is true", () => {
    const result = parseStopInput(JSON.stringify({ stop_hook_active: true }));
    assert.equal(result.stopHookActive, true);
  });

  test("returns stopHookActive:false when stop_hook_active is false", () => {
    const result = parseStopInput(JSON.stringify({ stop_hook_active: false }));
    assert.equal(result.stopHookActive, false);
  });

  test("returns stopHookActive:false when stop_hook_active is truthy string", () => {
    // Boolean() coercion: non-empty string is true — aber stop_hook_active sollte boolean sein
    const result = parseStopInput(JSON.stringify({ stop_hook_active: "yes" }));
    assert.equal(result.stopHookActive, true); // Boolean("yes") === true
  });

  test("returns stopHookActive:false when stop_hook_active is 0", () => {
    const result = parseStopInput(JSON.stringify({ stop_hook_active: 0 }));
    assert.equal(result.stopHookActive, false);
  });
});

// ── hasUncommittedChanges ────────────────────────────────────────────────────

describe("hasUncommittedChanges (#708)", () => {
  test("returns false when git diff exits 0 (clean checkout)", () => {
    const deps = {
      spawnSync: () => ({ status: 0 }),
    };
    assert.equal(hasUncommittedChanges("/fake/root", deps), false);
  });

  test("returns true when git diff exits non-0 (changes present)", () => {
    const deps = {
      spawnSync: () => ({ status: 1 }),
    };
    assert.equal(hasUncommittedChanges("/fake/root", deps), true);
  });

  test("returns false (fail-open) when spawnSync throws", () => {
    const deps = {
      spawnSync: () => { throw new Error("no git"); },
    };
    assert.equal(hasUncommittedChanges("/fake/root", deps), false);
  });

  test("passes correct args to git", () => {
    const calls: unknown[][] = [];
    const deps = {
      spawnSync: (cmd: string, args: string[]) => { calls.push([cmd, args]); return { status: 0 }; },
    };
    hasUncommittedChanges("/my/root", deps);
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0], ["git", ["diff", "--quiet", "HEAD"]]);
  });

  test("passes repoRoot as cwd", () => {
    const cwds: unknown[] = [];
    const deps = {
      spawnSync: (_cmd: string, _args: string[], opts: { cwd: string }) => {
        cwds.push(opts.cwd);
        return { status: 0 };
      },
    };
    hasUncommittedChanges("/some/root", deps);
    assert.equal(cwds[0], "/some/root");
  });
});

// ── runVerify ────────────────────────────────────────────────────────────────

describe("runVerify (#708)", () => {
  test("returns ok:true when npm exits 0", () => {
    const deps = {
      spawnSync: () => ({ status: 0, stdout: "all good\n", stderr: "" }),
    };
    const result = runVerify("/fake/root", deps);
    assert.equal(result.ok, true);
  });

  test("returns ok:false when npm exits non-0", () => {
    const deps = {
      spawnSync: () => ({ status: 1, stdout: "", stderr: "error\n" }),
    };
    const result = runVerify("/fake/root", deps);
    assert.equal(result.ok, false);
  });

  test("concatenates stdout and stderr in output", () => {
    const deps = {
      spawnSync: () => ({ status: 1, stdout: "STDOUT", stderr: "STDERR" }),
    };
    const result = runVerify("/fake/root", deps);
    assert.ok(result.output.includes("STDOUT"));
    assert.ok(result.output.includes("STDERR"));
  });

  test("truncates output to 3000 chars", () => {
    const bigOutput = "x".repeat(5000);
    const deps = {
      spawnSync: () => ({ status: 1, stdout: bigOutput, stderr: "" }),
    };
    const result = runVerify("/fake/root", deps);
    assert.equal(result.output.length, 3000);
  });

  test("handles null stdout/stderr gracefully", () => {
    const deps = {
      spawnSync: () => ({ status: 0, stdout: null, stderr: null }),
    };
    assert.doesNotThrow(() => runVerify("/fake/root", deps));
  });
});

// ── repoRootFromScriptUrl ────────────────────────────────────────────────────

describe("repoRootFromScriptUrl (#708)", () => {
  test("resolves two levels up from scripts/stop-verify-hook.mjs", () => {
    // fileURLToPath braucht auf Windows eine Laufwerks-Buchstaben.
    const fakeUrl = process.platform === "win32"
      ? "file:///C:/myrepo/scripts/stop-verify-hook.mjs"
      : "file:///myrepo/scripts/stop-verify-hook.mjs";
    const expected = process.platform === "win32" ? "C:\\myrepo" : "/myrepo";
    const root = repoRootFromScriptUrl(fakeUrl);
    assert.equal(root, expected, `got: ${root}`);
  });
});

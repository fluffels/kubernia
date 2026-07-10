/* Worktree-Guard-Hook (#735) — PreToolUse-Hook, der git commit/push AUSSERHALB
 * eines eigenen git-Worktrees blockt (Bitte-zu-Mauer-Verschiebung für die reale,
 * wiederholt aufgetretene Kollision: zwei parallele Agenten im selben geteilten
 * main-Checkout, siehe Kontext in #735).
 *
 * Rein struktureller Wächter (wie diffsize/docdrift): die Erkennungslogik lebt in
 * scripts/worktree-guard-hook.mjs (EINE Quelle für Hook-CLI und Test). git selbst
 * wird NICHT ausgeführt — execFile/stat sind injiziert, damit der Test
 * deterministisch und ohne echten Repo-Zustand läuft.
 *
 * Ausführen mit: npm test
 */
import { describe, test } from "vitest";
import assert from "node:assert/strict";
import { join } from "node:path";

// Reines Node-Tooling-Skript ohne Declaration-File (wie scripts/check-diffsize.mjs).
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as guard from "../scripts/worktree-guard-hook.mjs";

type ExecDeps = { execFileSync?: (...a: unknown[]) => string; statSync?: (...a: unknown[]) => { isDirectory(): boolean } };
type Decision = { block: boolean; reason?: string };

const isProtectedGitCommand: (command: string) => boolean = guard.isProtectedGitCommand;
const resolveGitContext: (cwd: string, repoRoot: string, deps?: ExecDeps) => Record<string, unknown> = guard.resolveGitContext;
const decide: (opts: { cwd?: string; command: string; repoRoot: string; deps?: ExecDeps }) => Decision = guard.decide;
const parseHookInput: (text: string) => { cwd?: string; command?: string } = guard.parseHookInput;
const buildDenyOutput: (reason: string) => Record<string, unknown> = guard.buildDenyOutput;

describe("isProtectedGitCommand (#735)", () => {
  test("erkennt git commit / git push in einfachen Kommandos", () => {
    assert.equal(isProtectedGitCommand('git commit -m "x"'), true);
    assert.equal(isProtectedGitCommand("git push origin main"), true);
    assert.equal(isProtectedGitCommand("git push"), true);
  });

  test("erkennt commit/push auch nach && / ; / Zeilenumbruch verkettet", () => {
    assert.equal(isProtectedGitCommand('git add -A && git commit -m "x"'), true);
    assert.equal(isProtectedGitCommand("npm test; git push origin feature/x"), true);
    assert.equal(isProtectedGitCommand("npm test\ngit commit -am x"), true);
  });

  test("erkennt commit/push mit git-Flags davor (-C, --no-pager)", () => {
    assert.equal(isProtectedGitCommand("git -C /some/path commit -m x"), true);
    assert.equal(isProtectedGitCommand("git --no-pager push origin main"), true);
  });

  test("false NEGATIVES: unverwandte Kommandos triggern NICHT (Red-Green-Gegenprobe)", () => {
    assert.equal(isProtectedGitCommand("npm test"), false, "keine git-Erwähnung");
    assert.equal(isProtectedGitCommand("git status"), false, "lesender git-Befehl");
    assert.equal(isProtectedGitCommand("git worktree remove .claude/worktrees/kq-1"), false, "kein commit/push");
    assert.equal(isProtectedGitCommand("git log --oneline"), false);
  });

  test("Grenzfall: 'push'/'commit' als Teilstring in Flag-Wert löst NICHT zwingend git-Bezug aus, wenn kein git im Segment steht", () => {
    assert.equal(isProtectedGitCommand("echo 'please push this feature'"), false, "kein 'git' im Segment");
  });
});

describe("resolveGitContext (#735) — Haupt-Worktree vs. Linked-Worktree", () => {
  const repoRoot = "/c/git/kubequest";

  type DirInfo = { toplevel: string; commonDir: string };
  /** Simuliert git für mehrere Verzeichnisse gleichzeitig (die Funktion ruft git
   *  sowohl für `repoRoot` selbst — die Referenz — als auch für das zu prüfende
   *  `cwd` auf; beide können unterschiedliche Antworten brauchen). `byDir` ist
   *  keyed nach dem `cwd`-Options-Wert, mit dem `git` aufgerufen wird. */
  function fakeDeps(byDir: Record<string, DirInfo>, gitFileDirs: Set<string> = new Set()): ExecDeps {
    return {
      execFileSync: (_cmd: unknown, args: unknown, options?: unknown) => {
        const a = args as string[];
        const dir = (options as { cwd?: string } | undefined)?.cwd ?? "";
        const info = byDir[dir];
        if (!info) throw new Error(`kein Git-Repo simuliert für ${dir}`);
        if (a.includes("--show-toplevel")) return info.toplevel + "\n";
        if (a.includes("--git-common-dir")) return info.commonDir + "\n";
        throw new Error(`unerwartete git-Args: ${a.join(" ")}`);
      },
      statSync: (p: unknown) => ({ isDirectory: () => !gitFileDirs.has(String(p)) }),
    };
  }

  test("Haupt-Checkout: .git ist ein Verzeichnis am Toplevel -> relevant + isMainWorktree", () => {
    const deps = fakeDeps({ [repoRoot]: { toplevel: repoRoot, commonDir: `${repoRoot}/.git` } });
    const ctx = resolveGitContext(repoRoot, repoRoot, deps);
    assert.equal(ctx.relevant, true);
    assert.equal(ctx.isMainWorktree, true);
  });

  test("Linked Worktree: .git ist eine Datei am Toplevel -> relevant, aber NICHT isMainWorktree", () => {
    const wt = `${repoRoot}/.claude/worktrees/kq-42`;
    const deps = fakeDeps(
      {
        [repoRoot]: { toplevel: repoRoot, commonDir: `${repoRoot}/.git` },
        [wt]: { toplevel: wt, commonDir: `${repoRoot}/.git` },
      },
      new Set([join(wt, ".git")]),
    );
    const ctx = resolveGitContext(wt, repoRoot, deps);
    assert.equal(ctx.relevant, true);
    assert.equal(ctx.isMainWorktree, false);
  });

  test("Skript-Standort selbst ist ein Linked Worktree (repoRoot != Haupt-Checkout) -> trotzdem korrekt relevant", () => {
    // Genau der Bug, den die Erstversion hatte: repoRoot kann ein Worktree sein
    // (das Skript läuft aus scripts/ innerhalb DIESES Checkouts) — die Referenz
    // muss über git-common-dir aufgelöst werden, nicht über `<repoRoot>/.git`.
    const scriptWorktree = `${repoRoot}/.claude/worktrees/kq-735`;
    const deps = fakeDeps(
      {
        [scriptWorktree]: { toplevel: scriptWorktree, commonDir: `${repoRoot}/.git` },
        [repoRoot]: { toplevel: repoRoot, commonDir: `${repoRoot}/.git` },
      },
      new Set([join(scriptWorktree, ".git")]),
    );
    const ctx = resolveGitContext(repoRoot, scriptWorktree, deps);
    assert.equal(ctx.relevant, true, "beide Worktrees teilen denselben common-dir");
    assert.equal(ctx.isMainWorktree, true);
  });

  test("Anderes Repo (git-common-dir zeigt NICHT auf unser .git) -> nicht relevant", () => {
    const otherRepo = "/c/git/anderes-repo";
    const deps = fakeDeps({
      [repoRoot]: { toplevel: repoRoot, commonDir: `${repoRoot}/.git` },
      [otherRepo]: { toplevel: otherRepo, commonDir: `${otherRepo}/.git` },
    });
    const ctx = resolveGitContext(otherRepo, repoRoot, deps);
    assert.equal(ctx.relevant, false, "ein fremdes Repo darf den Hook nicht triggern");
  });

  test("Kein Git-Repo am cwd (rev-parse wirft) -> nicht relevant, kein Crash", () => {
    const deps = fakeDeps({ [repoRoot]: { toplevel: repoRoot, commonDir: `${repoRoot}/.git` } });
    const ctx = resolveGitContext("/tmp/kein-repo", repoRoot, deps);
    assert.equal(ctx.relevant, false);
  });
});

describe("decide (#735) — Gesamtentscheidung", () => {
  const repoRoot = "/c/git/kubequest";

  function fakeDeps({ toplevel, gitFileAtToplevel }: { toplevel: string; gitFileAtToplevel: boolean }): ExecDeps {
    return {
      execFileSync: (_cmd: unknown, args: unknown) => {
        const a = args as string[];
        if (a.includes("--show-toplevel")) return toplevel + "\n";
        if (a.includes("--git-common-dir")) return `${repoRoot}/.git\n`;
        throw new Error("unerwartet");
      },
      statSync: () => ({ isDirectory: () => !gitFileAtToplevel }),
    };
  }

  test("BLOCKT: git commit im geteilten Haupt-Checkout", () => {
    const deps = fakeDeps({ toplevel: repoRoot, gitFileAtToplevel: false });
    const r = decide({ cwd: repoRoot, command: 'git commit -m "x"', repoRoot, deps });
    assert.equal(r.block, true);
    assert.match(r.reason ?? "", /worktree/i);
  });

  test("BLOCKT: git push im geteilten Haupt-Checkout", () => {
    const deps = fakeDeps({ toplevel: repoRoot, gitFileAtToplevel: false });
    const r = decide({ cwd: repoRoot, command: "git push origin feature/x", repoRoot, deps });
    assert.equal(r.block, true);
  });

  test("ERLAUBT: git commit in einem Linked Worktree", () => {
    const wt = `${repoRoot}/.claude/worktrees/kq-735`;
    const deps = fakeDeps({ toplevel: wt, gitFileAtToplevel: true });
    const r = decide({ cwd: wt, command: 'git commit -m "x"', repoRoot, deps });
    assert.equal(r.block, false);
  });

  test("ERLAUBT: nicht-git-mutierende Kommandos im Haupt-Checkout (git status, npm test)", () => {
    const deps = fakeDeps({ toplevel: repoRoot, gitFileAtToplevel: false });
    assert.equal(decide({ cwd: repoRoot, command: "git status", repoRoot, deps }).block, false);
    assert.equal(decide({ cwd: repoRoot, command: "npm test", repoRoot, deps }).block, false);
  });

  test("ERLAUBT (fail-open): fehlender cwd im Payload blockt nicht (kann nicht entscheiden)", () => {
    const r = decide({ command: 'git commit -m "x"', repoRoot });
    assert.equal(r.block, false);
  });

  test("Red-Green-Gegenprobe: verfälschte isMainWorktree=false-Annahme macht den Test rot", () => {
    // Beweist, dass der Test bei kaputter Logik wirklich rot wird (nicht nur zufällig grün ist).
    const deps = fakeDeps({ toplevel: repoRoot, gitFileAtToplevel: false });
    const r = decide({ cwd: repoRoot, command: 'git commit -m "x"', repoRoot, deps });
    assert.notEqual(r.block, false, "im Haupt-Checkout MUSS geblockt werden — wäre hier fälschlich grün, flöge der Test");
  });
});

describe("parseHookInput / buildDenyOutput (#735) — CLI-Ein-/Ausgabe", () => {
  test("parst gültiges Hook-stdin-JSON (cwd + tool_input.command)", () => {
    const input = JSON.stringify({ cwd: "/c/git/kubequest", tool_name: "Bash", tool_input: { command: "git push" } });
    assert.deepEqual(parseHookInput(input), { cwd: "/c/git/kubequest", command: "git push" });
  });

  test("kaputtes/leeres JSON liefert leeres Objekt statt zu crashen", () => {
    assert.deepEqual(parseHookInput(""), {});
    assert.deepEqual(parseHookInput("{not json"), {});
  });

  test("fehlender tool_input.command liefert command: undefined", () => {
    const input = JSON.stringify({ cwd: "/x", tool_name: "Bash", tool_input: {} });
    assert.deepEqual(parseHookInput(input), { cwd: "/x", command: undefined });
  });

  test("buildDenyOutput liefert das dokumentierte hookSpecificOutput-Schema", () => {
    const out = buildDenyOutput("Testgrund");
    assert.deepEqual(out, {
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: "Testgrund",
      },
    });
  });
});

/* Worktree-Guard-Hook (#735) — PreToolUse-Hook, der git commit/push AUSSERHALB
 * eines eigenen git-Worktrees blockt (Bitte-zu-Mauer-Verschiebung für die reale,
 * wiederholt aufgetretene Kollision: zwei parallele Agenten im selben geteilten
 * main-Checkout, siehe Kontext in #735).
 *
 * @harness-waechter – einziger Durchsetzer seiner Regel, darum im geschützten test/harness/ (#1165).
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
import { join, resolve } from "node:path";

type ExecDeps = { execFileSync?: (...a: unknown[]) => string; statSync?: (...a: unknown[]) => { isDirectory(): boolean } };
type Decision = { block: boolean; reason?: string };
type Word = { text: string; dynamic: boolean };
type Cmd = { words: Word[]; sep: string; boundary?: string };
type GuardModule = {
  isProtectedGitCommand: (command: string) => boolean;
  resolveGitContext: (cwd: string, repoRoot: string, deps?: ExecDeps) => Record<string, unknown>;
  decide: (opts: { cwd?: string; command: string; repoRoot: string; deps?: ExecDeps }) => Decision;
  parseHookInput: (text: string) => { cwd?: string; command?: string };
  buildDenyOutput: (reason: string) => Record<string, unknown>;
  lexShell: (command: string) => { ok: true; cmds: Cmd[] } | { ok: false };
  gitInvocation: (words: Word[]) => { sub: string | null; cDirs: Word[]; unsure: boolean } | null;
  protectedGitTargets: (command: string, cwd: string, deps?: ExecDeps) => string[];
  fromMsysPath: (p: string, platform?: string) => string;
};

// Reines Node-Tooling-Skript ohne Declaration-File (wie scripts/check-review-nachweis.mjs).
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as raw from "../../scripts/worktree-guard-hook.mjs";
const guard = raw as GuardModule;

const { isProtectedGitCommand, resolveGitContext, decide, parseHookInput, buildDenyOutput, lexShell, gitInvocation, protectedGitTargets, fromMsysPath } = guard;

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

describe("isProtectedGitCommand (#1308) — Quotes, Heredocs und Substitutionen", () => {
  test("Text in Quotes, Heredoc-Bodies und Kommentaren ist KEIN Kommando", () => {
    const nein = [
      'gh issue comment 1 --body "git push und git commit"',
      'gh issue comment 1 --body "a\ngit push\nb"',
      'gh issue comment 1 --body "erst git commit; dann git push (x)"',
      "gh issue comment 1 --body 'git push'",
      'gh pr create --body "$(cat <<\'EOF\'\nZusammenfassung: git commit (x)\nEOF\n)"',
      "cat > f <<'EOF'\ngit push\nEOF",
      "cat > f <<-EOF\n\tgit push\n\tEOF",
      "git log --grep=push",
      "git stash push",
      "git status # dann git push",
      "gh issue comment 1 --body '`git push`'",
      "echo 'x' && git status",
    ];
    for (const cmd of nein) assert.equal(isProtectedGitCommand(cmd), false, cmd);
  });

  test("echte Aufrufe werden auch in Sonderformen erkannt (Red-Green-Gegenseite)", () => {
    const ja = [
      '"git" commit -m x',
      "git -c user.name=x commit -m y",
      "git --git-dir=/x/.git push",
      "x=$(git push)",
      "echo `git commit`",
      'gh issue comment 1 --body "`git push`"', // Backticks in Double Quotes laufen wirklich
      "git commit -F - <<'EOF'\nNachricht\nEOF",
      'git commit -m "$(cat <<\'EOF\'\nNachricht (x)\nEOF\n)"',
      "FOO=bar git push",
      "env GIT_X=1 git commit",
      "if true; then git push; fi",
      "find . -exec git commit {} \\;",
      "echo a | git push",
      "git add -A && git commit -m x",
      "cat <<EOF\n$(git push)\nEOF",
    ];
    for (const cmd of ja) assert.equal(isProtectedGitCommand(cmd), true, cmd);
  });

  test("Interpreter und nicht zerlegbare Befehle fallen auf die grobe Regel zurück", () => {
    assert.equal(isProtectedGitCommand('bash -c "git push"'), true);
    assert.equal(isProtectedGitCommand('eval "git push"'), true);
    assert.equal(isProtectedGitCommand('sh -c \'git commit -m "x"\''), true);
    assert.equal(isProtectedGitCommand('git commit -m "x'), true, "offenes Quote");
    assert.equal(isProtectedGitCommand('echo "x'), false, "offenes Quote ohne git commit");
    assert.equal(isProtectedGitCommand("bash scripts/build.sh"), false);
  });
});

describe("lexShell / gitInvocation (#1308)", () => {
  const texts = (command: string) => {
    const r = lexShell(command);
    assert.equal(r.ok, true, command);
    return r.ok ? r.cmds.filter((c) => !c.boundary).map((c) => c.words.map((w) => w.text)) : [];
  };

  test("zerlegt Trenner, Quotes und Escapes", () => {
    assert.deepEqual(texts('a b && c "d e" | f; g\\ h'), [["a", "b"], ["c", "d e"], ["f"], ["g h"]]);
    assert.deepEqual(texts("echo 'a;b' \"c&&d\""), [["echo", "a;b", "c&&d"]]);
  });

  test("Umleitungen mit & sind keine Trenner", () => {
    assert.deepEqual(texts("cmd 2>&1 &> out"), [["cmd", "2>&1", "&>", "out"]]);
  });

  test("Substitutionen sind eigene Kommandos mit Grenzen; Wörter damit sind dynamisch", () => {
    const r = lexShell("echo $(git push) x");
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.deepEqual(r.cmds.map((c) => c.boundary ?? c.words[0].text), ["(", "git", ")", "echo"]);
    assert.equal(r.cmds[3].words[1].dynamic, true);
    assert.equal(r.cmds[3].words[2].dynamic, false);
  });

  test("offenes Quote, offene Substitution und fehlender Heredoc-Delimiter sind nicht zerlegbar", () => {
    for (const cmd of ['echo "x', "echo 'x", "echo $(x", "echo x)", "cat <<EOF\nx", "f() { x; }"]) {
      assert.equal(lexShell(cmd).ok, false, cmd);
    }
  });

  test("gitInvocation: Unterbefehl, -C-Wörter und unsichere Optionen", () => {
    const inv = (command: string) => {
      const r = lexShell(command);
      return r.ok ? gitInvocation(r.cmds[0].words) : null;
    };
    assert.equal(inv("ls -la"), null);
    assert.equal(inv("git status")?.sub, "status");
    assert.deepEqual(inv("git -C a -C b commit")?.cDirs.map((w) => w.text), ["a", "b"]);
    assert.equal(inv("git -c x=y commit")?.sub, "commit");
    assert.equal(inv("git --git-dir=/x push")?.unsure, true);
    assert.equal(inv("/usr/bin/git.exe push")?.sub, "push");
    assert.equal(inv("git $SUB")?.sub, null);
  });

  test("fromMsysPath: /c/… wird nur unter Windows umgeschrieben", () => {
    assert.equal(fromMsysPath("/c/dev/x", "win32"), "C:/dev/x");
    assert.equal(fromMsysPath("/c", "win32"), "C:/");
    assert.equal(fromMsysPath("/c/dev/x", "linux"), "/c/dev/x");
    assert.equal(fromMsysPath("rel/x", "win32"), "rel/x");
  });
});

describe("decide (#1308) — cd und git -C aus dem Befehl auswerten", () => {
  const repoRoot = resolve("/c/git/kubequest");
  const wt = join(repoRoot, ".claude", "worktrees", "kq-42");

  /** git-Fake nach Verzeichnis: `worktrees` sind Linked Worktrees (`.git` ist eine
   *  Datei), alles unter `repoRoot` sonst der Haupt-Checkout, außerhalb: kein Repo.
   *  `missing` sind nicht vorhandene Ordner (statSync wirft). */
  function fsFake(worktrees: string[], missing: string[] = []): ExecDeps {
    const wts = worktrees.map((p) => resolve(p));
    const topOf = (dir: string) => wts.find((w) => dir === w || dir.startsWith(w + (w.endsWith("\\") ? "" : "\\")) || dir.startsWith(w + "/")) ?? repoRoot;
    return {
      execFileSync: (_cmd: unknown, args: unknown, options?: unknown) => {
        const a = args as string[];
        const dir = resolve((options as { cwd?: string }).cwd ?? "");
        if (dir !== repoRoot && !dir.startsWith(repoRoot)) throw new Error(`kein Repo: ${dir}`);
        if (missing.some((m) => resolve(m) === dir)) throw new Error(`ENOENT: ${dir}`); // git in fehlendem cwd scheitert
        if (a.includes("--show-toplevel")) return topOf(dir) + "\n";
        if (a.includes("--git-common-dir")) return `${repoRoot}/.git\n`;
        throw new Error("unerwartet");
      },
      statSync: (p: unknown) => {
        const path = resolve(String(p));
        if (path.endsWith(".git")) return { isDirectory: () => !wts.includes(resolve(path, "..")) };
        if (missing.map((m) => resolve(m)).includes(path)) throw new Error("ENOENT");
        return { isDirectory: () => true };
      },
    };
  }
  const run = (command: string, cwd = repoRoot, deps = fsFake([wt])) => decide({ cwd, command, repoRoot, deps }).block;

  test("ERLAUBT: cd in den Worktree, auch mit mehreren Schritten davor", () => {
    assert.equal(run(`cd '${wt}' && git add -A && git commit -m x`), false);
    assert.equal(run(`cd ${join(".claude", "worktrees", "kq-42").replace(/\\/g, "/")} && git commit -m x`), false);
    assert.equal(run(`cd "${wt}"\ngit push`), false);
  });

  test("ERLAUBT: git -C <worktree>, auch hinter Optionen", () => {
    assert.equal(run(`git -C '${wt}' push`), false);
    assert.equal(run(`git --no-pager -C '${wt}' commit -m x`), false);
  });

  test("ERLAUBT: Wortpaar nur im Text eines gh-Kommandos", () => {
    assert.equal(run('gh issue comment 1 --body "erst git push, dann git commit"'), false);
    assert.equal(run('gh issue comment 1 --body "a\ngit push\nb"'), false);
  });

  test("BLOCKT: schlichtes commit/push im Haupt-Checkout und mit -C auf ihn", () => {
    assert.equal(run("git commit -m x"), true);
    assert.equal(run("git push"), true);
    assert.equal(run(`git -C '${repoRoot}' commit -m x`), true);
  });

  test("BLOCKT (neu): git -C auf den Haupt-Checkout aus einem Worktree", () => {
    assert.equal(run(`git -C '${repoRoot}' commit -m x`, wt), true);
    assert.equal(run("git commit -m x", wt), false, "im Worktree selbst bleibt es erlaubt");
  });

  test("-C relativ zum verfolgten Verzeichnis", () => {
    assert.equal(run(`cd '${wt}' && git -C sub commit -m x`), false);
    assert.deepEqual(protectedGitTargets(`cd '${wt}' && git -C sub commit`, repoRoot, fsFake([wt])), [join(wt, "sub")]);
  });

  test("cd wirkt nur, wenn es wirklich ankommt (kein cd-Missbrauch als Freifahrtschein)", () => {
    const missing = join(repoRoot, "gibt-es-nicht");
    assert.equal(run(`cd '${missing}'; git commit -m x`, repoRoot, fsFake([wt], [missing])), true, "fehlender Ordner");
    assert.equal(run(`(cd '${wt}') && git commit -m x`), true, "Subshell");
    assert.equal(run(`x=$(cd '${wt}'); git push`), true, "Substitution");
    assert.equal(run(`cd '${wt}' | cat; git commit -m x`), true, "Pipeline");
    assert.equal(run(`cd '${wt}' & git push`), true, "Hintergrund");
    assert.equal(run(`cd '${wt}' && sleep 1 & git push`), true, "Hintergrund-Liste");
    assert.equal(run(`cd "$WT" && git commit -m x`), true, "dynamisches Ziel");
    assert.equal(run("cd ~ && git push"), true, "Home");
    assert.equal(run("cd src && git commit -m x"), true, "Unterordner des Haupt-Checkouts");
    assert.equal(run(`cd - && git commit -m x`), true, "cd -");
  });

  test("cd bleibt nach Subshell/Substitution im Rest wirksam, wo es echt ist", () => {
    assert.equal(run(`(echo x); cd '${wt}' && git commit -m x`), false);
    assert.equal(run(`cd '${wt}' && (echo x) && git commit -m x`), false);
  });

  test("Interpreter-Rückfall prüft gegen das Session-cwd (keine neuen False Negatives)", () => {
    assert.equal(run('bash -c "git push"'), true);
    assert.equal(run(`bash -c "cd '${wt}' && git push"`), true, "grob: lieber blocken als durchwinken");
    assert.equal(run('bash -c "git push"', wt), false);
  });

  test("fehlender cwd und fremdes Repo blocken nicht (fail-open)", () => {
    assert.equal(decide({ command: "git push", repoRoot }).block, false);
    const fremd = resolve("/c/git/anderes");
    assert.equal(run("git push", fremd), false);
    assert.equal(run(`git -C '${fremd}' push`), false);
  });

  test("die Meldung nennt den Haupt-Checkout und beide erlaubten Wege", () => {
    const r = decide({ cwd: repoRoot, command: "git commit -m x", repoRoot, deps: fsFake([wt]) });
    assert.match(r.reason ?? "", /git -C <worktree>/);
    assert.match(r.reason ?? "", /cd <worktree> && git/);
    assert.ok((r.reason ?? "").includes(repoRoot));
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

/* Worktree-Guard-Hook (#735) — PreToolUse-Hook, der git commit/push AUSSERHALB
 * eines eigenen git-Worktrees blockt (Bitte-zu-Mauer-Verschiebung für die reale,
 * wiederholt aufgetretene Kollision: zwei parallele Agenten im selben geteilten
 * main-Checkout, siehe Kontext in #735).
 *
 * @harness-waechter – einziger Durchsetzer seiner Regel, darum im geschützten test/harness/ (#1165).
 *
 * Rein struktureller Wächter (wie diffsize/docdrift): die Erkennungslogik lebt in
 * scripts/worktree-guard-hook.mjs (EINE Quelle für Hook-CLI und Test). Die Einheitstests
 * führen git NICHT aus (execFile/stat sind injiziert); ein eigener Block prüft den Hook
 * gegen echtes git in einem Temp-Repo mit Worktree und Unterordner (gegen die Fakes).
 *
 * Ausführen mit: npm test
 */
import { afterAll, beforeAll, describe, test } from "vitest";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";

type ExecDeps = { execFileSync?: (...a: unknown[]) => string; statSync?: (...a: unknown[]) => { isDirectory(): boolean }; homedir?: () => string; platform?: string; kontextCache?: Map<string, unknown> };
type Decision = { block: boolean; ask?: boolean; reason?: string };
type GuardModule = {
  isProtectedGitCommand: (command: string) => boolean;
  resolveGitContext: (cwd: string, repoRoot: string, deps?: ExecDeps) => Record<string, unknown>;
  decide: (opts: { cwd?: string; command: string; repoRoot: string; deps?: ExecDeps }) => Decision;
  parseHookInput: (text: string) => { cwd?: string; command?: string };
  buildDenyOutput: (reason: string) => Record<string, unknown>;
  protectedGitTargets: (command: string, cwd: string, deps?: ExecDeps) => string[];
  fromMsysPath: (p: string, platform?: string) => string;
};

// Reines Node-Tooling-Skript ohne Declaration-File (wie scripts/check-review-nachweis.mjs).
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as raw from "../../scripts/worktree-guard-hook.mjs";
const guard = raw as GuardModule;

const { isProtectedGitCommand, resolveGitContext, decide, parseHookInput, buildDenyOutput, protectedGitTargets, fromMsysPath } = guard;

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
        if (a.includes("--show-toplevel") && a.includes("--git-common-dir")) return `${info.toplevel}\n${info.commonDir}\n`;
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
        if (a.includes("--show-toplevel") && a.includes("--git-common-dir")) return `${toplevel}\n${repoRoot}/.git\n`;
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
      "cat <<'EOF'\n$(git push)\nEOF", // quotierter Delimiter: Body wörtlich
      "cat > f <<-EOF\n\tgit push\n\tEOF",
      "git log --grep=push",
      "git stash push",
      "git status # dann git push",
      "npm test # git push",
      "gh issue comment 1 --body '`git push`'",
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
      'gh issue comment 1 --body "$(git push)"', // ebenso $(…) in Double Quotes
      'echo "a $(git commit -m x) b"',
      "git commit -F - <<'EOF'\nNachricht\nEOF",
      'git commit -m "$(cat <<\'EOF\'\nNachricht (x)\nEOF\n)"',
      "FOO=bar git push",
      "env GIT_X=1 git commit",
      "if true; then git push; fi",
      "find . -exec git commit {} \\;",
      "echo a | git push",
      "echo a#; git push",
      "git --namespace x push",
      "timeout 60 git push",
      "xargs -n 1 git push",
      "env -u FOO git commit -m x",
      "winpty git push",
      "sudo -u me git push",
      "git add -A && git commit -m x",
      "cat <<EOF\n$(git push)\nEOF",
      "cat <<EOF\n`git push`\nEOF",
      "cat <(git push)",
    ];
    for (const cmd of ja) assert.equal(isProtectedGitCommand(cmd), true, cmd);
  });

  test("Interpreter und nicht zerlegbare Befehle fallen auf die grobe Regel zurück", () => {
    assert.equal(isProtectedGitCommand('bash -c "git push"'), true);
    assert.equal(isProtectedGitCommand('eval "git push"'), true);
    assert.equal(isProtectedGitCommand('sh -c \'git commit -m "x"\''), true);
    assert.equal(isProtectedGitCommand(`node -e "execSync('git push')"`), true);
    assert.equal(isProtectedGitCommand("python3 -c \"os.system('git commit -m x')\""), true);
    assert.equal(isProtectedGitCommand('git commit -m "x'), true, "offenes Quote");
    assert.equal(isProtectedGitCommand('echo "x'), false, "offenes Quote ohne git commit");
    assert.equal(isProtectedGitCommand("bash scripts/build.sh"), false);
  });
});

describe("fromMsysPath (#1308)", () => {
  test("/c/… wird nur unter Windows umgeschrieben", () => {
    assert.equal(fromMsysPath("/c/dev/x", "win32"), "C:/dev/x");
    assert.equal(fromMsysPath("/c/dev/x", "linux"), "/c/dev/x");
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
        if (a.includes("--show-toplevel") && a.includes("--git-common-dir")) {
          // wie echtes git: im Haupt-Checkout relativ zum Aufruf-Verzeichnis (`.git`, `../.git`), im Worktree absolut
          const absolut = `${repoRoot}/.git`;
          return `${topOf(dir)}\n${wts.includes(topOf(dir)) ? absolut : relative(dir, absolut).replace(/\\/g, "/")}\n`;
        }
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
    assert.equal(run('gh issue comment 1 --body "erst git push\ndann git commit"'), false);
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
    assert.equal(run(`(echo x); cd '${wt}' && (echo y) && git commit -m x`), false, "echtes cd bleibt nach Subshells wirksam");
  });

  test("cd, das nicht verfolgbar ist, setzt auf das Session-cwd zurück (kein altes Ziel behalten)", () => {
    for (const mitte of ["cd -", "cd ~", `pushd '${repoRoot}'`, "popd", 'cd "$X"']) {
      assert.equal(run(`cd '${wt}' && ${mitte} && git push`), true, mitte);
    }
    assert.equal(run(`false && cd '${wt}'; git push`), true, "bedingtes cd");
    assert.equal(run(`false && cd '${wt}' && echo x; git push`), true, "cd mitten in der Liste");
    assert.equal(run(`true || cd '${wt}' && git push`), true, "cd hinter ||");
    assert.equal(run(`(true) || cd '${wt}' && git push`), true, "cd hinter || nach einer Subshell");
    assert.equal(run(`(true) | cd '${wt}' && git push`), true, "cd in einer Pipeline nach einer Subshell");
    assert.equal(run(`(true); cd '${wt}' && git push`), false, "Subshell mit ; beendet die Liste");
    assert.equal(run(`if false; then\ncd '${wt}'\nfi\ngit push`), true, "cd in einem Block");
    assert.equal(run(`cd '${wt}' && node scripts/x.mjs && npx vitest run && git commit -m x`), false, "Interpreter in der Kette");
    assert.equal(run(`cd '${wt}' && echo git push`), false, "reiner Text");
    assert.equal(run(`if true; then cd '${wt}' && git push; fi`), false, "cd und git im selben then-Zweig: exakt ausgewertet");
    assert.equal(run(`if true; then cd '${wt}'; fi; git push`), true, "cd im Zweig wirkt danach nur bedingt: der Ausgangsort bleibt Ziel");
    assert.equal(run(`cd '${wt}' && git -C sub push && git push`), false);
  });

  test("Wrapper vor Interpretern und nicht auflösbares -C bleiben geblockt", () => {
    for (const cmd of ['timeout 60 bash -c "git push"', 'winpty bash -c "git commit -m x"', 'su -c "git push"', 'py -c "os.system(\'git push\')"', 'git -C ~ push', 'git -C "$MAIN" push', 'xargs -I{} git -C {} push']) {
      assert.equal(run(cmd), true, cmd);
    }
    assert.equal(run(`git -C '${wt}' commit -m "GIT_DIR=x"`), false, "GIT_DIR nur als Zuweisung vor git");
    assert.equal(run(`cd '${wt}' && git -C "$MAIN" push`), true, "dynamisches -C trotz cd");
    assert.equal(run(`timeout 5 git -C '${wt}' push`), false, "Wrapper: -C wird trotzdem ausgewertet");
  });

  test("--git-dir und GIT_DIR prüfen zusätzlich das Session-cwd", () => {
    assert.equal(run(`cd '${wt}' && git --git-dir='${repoRoot}/.git' commit -m x`), true);
    assert.equal(run(`cd '${wt}' && GIT_DIR=x git commit -m x`), true);
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
    assert.match(r.reason ?? "", /git -C <worktree>.*cd <worktree> && git/s);
    assert.ok((r.reason ?? "").includes(repoRoot));
  });

  // ── #1311: AST-Auswerter (Mengenmodell), Lücken aus den Lens-Reviews und Restlücken ──
  const ask = (command: string, cwd = repoRoot, deps = fsFake([wt])) => decide({ cwd, command, repoRoot, deps }).ask === true;
  const withHome = (home: string) => ({ ...fsFake([wt]), homedir: () => home });

  test("Block-Gruppe, if und while mit & am Ende: das Folgekommando läuft im Ausgangsort", () => {
    for (const bg of ["{ true; } &", "if true; then :; fi &", "while false; do :; done &", "(true) &"]) {
      assert.equal(run(`cd '${wt}' && ${bg} git push`), true, bg);
    }
    assert.equal(run(`cd '${wt}' && { true; } && git push`), false, "Gegenprobe: ohne & wirkt das cd");
    assert.equal(run(`cd '${wt}' && if true; then :; fi && git push`), false);
    assert.equal(run(`cd '${wt}' && while false; do :; done; git push`), false);
  });

  test("git-Optionen mit getrenntem Wert verschieben den Unterbefehl nicht", () => {
    assert.equal(run("git --attr-source HEAD push"), true);
    assert.equal(run("git --config-env a=B commit -m x"), true);
    assert.equal(run(`git --attr-source HEAD -C '${repoRoot}' push`, wt), true);
    assert.equal(run("git --attr-source HEAD push", wt), false, "im Worktree bleibt es erlaubt");
  });

  test("nicht existierendes -C-Ziel: xargs-Platzhalter blockt im Haupt-Checkout, im Worktree bleibt es erlaubt", () => {
    const missing = join(repoRoot, "gibt-es-nicht");
    assert.equal(decide({ cwd: repoRoot, command: "git -C gibt-es-nicht push", repoRoot, deps: fsFake([wt], [missing]) }).block, true);
    assert.equal(run("echo . | xargs -I % git -C % push"), true);
    assert.equal(decide({ cwd: wt, command: "git -C gibt-es-nicht push", repoRoot, deps: fsFake([wt], [join(wt, "gibt-es-nicht")]) }).block, false, "im Worktree selbst bleibt es erlaubt");
  });

  test("~ wird per os.homedir() aufgelöst (-C und cd), nicht als dynamisch geraten", () => {
    const home = resolve(repoRoot, "..");
    const deps = withHome(home);
    assert.equal(run("git -C ~/kubequest push", wt, deps), true);
    assert.equal(run("cd ~/kubequest && git push", wt, deps), true);
    assert.equal(run("cd ~ && git push", wt, withHome(repoRoot)), true);
    assert.equal(run("git -C ~/anderswo push", wt, deps), false, "Home-Unterordner außerhalb des Repos");
    assert.equal(run("git -C ~root push", wt, deps), false, "~user ist nicht auflösbar, im Worktree aber kein Haupt-Checkout");
    assert.equal(ask("git -C ~root push", wt, deps), true, "~user: Ziel unbekannt, deshalb Rückfrage");
  });

  test("cd mit zu vielen Argumenten schlägt fehl (der Ort bleibt)", () => {
    assert.equal(run(`cd '${wt}' x; git push`), true);
    assert.equal(run(`cd '${wt}' x && git push`), true);
    assert.equal(run(`cd '${wt}'; git push`), false, "Gegenprobe mit einem Argument");
  });

  test("ANSI-C-Quote $'git' ist git", () => {
    assert.equal(run(`$'git' -C '${repoRoot}' push`, wt), true);
    assert.equal(run("$'gi\\x74' push"), true);
    assert.equal(run("$'echo' $'git push'"), false);
  });

  test("--work-tree, GIT_WORK_TREE und exportiertes GIT_DIR zeigen auf den Haupt-Checkout", () => {
    assert.equal(run(`git --work-tree='${repoRoot}' commit -m x`, wt), true);
    assert.equal(run(`GIT_WORK_TREE='${repoRoot}' git commit -m x`, wt), true);
    assert.equal(run(`export GIT_WORK_TREE='${repoRoot}'; git commit -m x`, wt), true);
    assert.equal(run(`export GIT_DIR='${repoRoot}/.git'; git commit -m x`, wt), true);
    assert.equal(run(`declare -x GIT_DIR='${repoRoot}/.git'; git push`, wt), true);
    assert.equal(run(`GIT_DIR='${repoRoot}/.git'; export GIT_DIR; git push`, wt), true);
    assert.equal(run(`git --work-tree='${wt}' commit -m x`, wt), false, "Worktree als Work-Tree bleibt erlaubt");
    assert.equal(run("export FOO=1; git commit -m x", wt), false);
  });

  test("Wrapper mit Optionswert: das Kommando dahinter wird gefunden", () => {
    assert.equal(run('sudo -u git bash -c "git push"'), true);
    assert.equal(run('env -u echo bash -c "git push"'), true);
    assert.equal(run("timeout -s KILL 5 git push"), true);
    assert.equal(run("xargs -I % git push"), true);
    assert.equal(run(`command -p cd '${repoRoot}' && git push`, wt), true);
    assert.equal(run(`env -C '${repoRoot}' git push`, wt), true);
    assert.equal(run(`env --chdir='${repoRoot}' git push`, wt), true);
    assert.equal(run(`sudo -D '${repoRoot}' git push`, wt), true);
    assert.equal(run(`nice -n 5 git -C '${wt}' push`), false, "Gegenprobe: Wrapper-Argument ist kein Kommando");
    assert.equal(run(`env -C '${wt}' git push`), false);
  });

  test("cd mit Optionen und Verkettungen aus dem Worktree in den Haupt-Checkout", () => {
    assert.equal(run(`cd -- '${repoRoot}' && git push`, wt), true);
    assert.equal(run(`cd -P '${repoRoot}' && git push`, wt), true);
    assert.equal(run(`cd '${repoRoot}' || cd '${wt}' && git push`, wt), true);
    assert.equal(run(`cd '${repoRoot}' && true | cd '${wt}' && git push`, wt), true);
    assert.equal(run(`cd '${wt}' || cd '${repoRoot}' && git push`), false, "das erste cd gelingt, das zweite läuft nie");
    assert.equal(run(`cd '${join(repoRoot, "weg")}' || cd '${wt}' && git push`, repoRoot, fsFake([wt], [join(repoRoot, "weg")])), true, "fehlgeschlagenes cd: Nachfolger gegen die unveränderte Menge");
  });

  test("voller Pfad zu git, auch mit Leerzeichen und .exe", () => {
    assert.equal(run(`/usr/bin/git -C '${repoRoot}' push`, wt), true);
    assert.equal(run(`"C:/Program Files/Git/cmd/git.exe" -C '${repoRoot}' push`, wt), true);
    assert.equal(run("/usr/bin/git status"), false);
  });

  test("grep/rg mit Quote-Text sind kein Aufruf, rg --pre und find -exec schon", () => {
    assert.equal(run('grep "git push" x'), false);
    assert.equal(run('rg -n "git commit" docs'), false);
    assert.equal(run('egrep -r "git push" .'), false);
    assert.equal(run("rg --pre 'sh -c \"git push\"' x"), true);
    assert.equal(run('find . -name "git push"'), false);
    assert.equal(run('find . -exec echo {} \\; -exec bash -c "git push" \\;'), true);
    assert.equal(run(`find . -exec git -C '${wt}' push {} \\;`), false);
    assert.equal(run("find . -exec git push {} +"), true);
  });

  test("Zeilenfortsetzung und Prozess-Substitution", () => {
    assert.equal(run(`git -C '${repoRoot}' \\\n push`, wt), true);
    assert.equal(run("git \\\n push"), true);
    assert.equal(run(`cd '${wt}' && git push && diff <(echo a) <(echo b)`), false, "<(…) ist kein Trenner und kein Ortswechsel");
    assert.equal(run(`cd '${wt}' && diff <(echo a) <(echo b) && git push`), false);
    assert.equal(run("cat <(git push)"), true);
    assert.equal(run("diff <(echo a) <(git commit -m x)"), true);
  });

  test("Interpreter mit Heredoc, Here-String und Pipe als Eingabe wird ausgewertet", () => {
    assert.equal(run("bash <<'EOF'\ngit push\nEOF"), true);
    assert.equal(run("sh <<EOF\ngit commit -m x\nEOF"), true);
    assert.equal(run('echo "git push" | sh'), true);
    assert.equal(run("printf '%s\\n' 'git push' | bash"), true);
    assert.equal(run("bash <<< 'git push'"), true);
    assert.equal(run("cat <<'EOF' | sh\ngit commit -m x\nEOF"), true);
    assert.equal(run("bash <<'EOF'\ngit push\nEOF", wt), false, "im Worktree bleibt es erlaubt");
    assert.equal(run("bash <<'EOF'\necho hallo\nEOF"), false);
    assert.equal(run('echo "git status" | sh'), false);
    assert.equal(run("bash skript.sh"), false, "Skriptdatei: Inhalt nicht auswertbar, aber auch kein Anlass");
  });

  test("Interpreter mit nicht statischem Text fragt im Haupt-Checkout, im Worktree nicht", () => {
    for (const cmd of ["curl x | sh", 'bash -c "$CMD"', 'eval "$(ssh-agent -s)"', "bash <<EOF\n$CMD\nEOF"]) {
      assert.equal(ask(cmd), true, cmd);
      assert.equal(ask(cmd, wt), false, `${cmd} (Worktree)`);
    }
    assert.equal(run('bash -c "$CMD"'), false, "fragt, blockt nicht");
  });

  test("git submodule foreach, rebase -x/--exec und subtree push", () => {
    assert.equal(run("git submodule foreach 'git push'"), true);
    assert.equal(run("git submodule foreach git commit -am x"), true);
    assert.equal(run("git rebase -x 'git push' main"), true);
    assert.equal(run("git rebase --exec='git commit --amend' main"), true);
    assert.equal(run("git subtree push --prefix=x origin main"), true);
    assert.equal(run("git submodule foreach 'echo hi'"), false);
    assert.equal(run("git rebase -x 'make test' main"), false);
    assert.equal(run("git rebase main"), false);
    assert.equal(run("git subtree pull --prefix=x origin main"), false);
    assert.equal(run("git submodule foreach 'git push'", wt), false);
    assert.equal(ask('git submodule foreach "$CMD"'), true);
  });

  test("Git-Aliase: -c alias.x=…, Alias aus der git-Konfiguration, Shell-Alias mit !", () => {
    assert.equal(run("git -c alias.p=push p"), true);
    assert.equal(run("git -c alias.p=push p", wt), false);
    assert.equal(run("git -c 'alias.c=!git commit -m' c x"), true);
    assert.equal(run("git p"), false, "kein Alias bekannt: externer Befehl");
    const base = fsFake([wt]);
    const cfg = (v: string): ExecDeps => ({ ...base, execFileSync: (cmd, args, o) => ((args as string[])[0] === "config" ? `${v}\n` : base.execFileSync?.(cmd, args, o) ?? "") });
    assert.equal(run("git up", repoRoot, cfg("push")), true);
    assert.equal(run("git up origin", repoRoot, cfg("push --force")), true);
    assert.equal(run("git up", wt, cfg("push")), false);
    assert.equal(run("git up", repoRoot, cfg("status")), false);
    assert.equal(run("git up", repoRoot, cfg("!git commit -am")), true);
    assert.equal(run("git status", repoRoot, cfg("push")), false, "eingebaute Befehle werden nicht über Aliase aufgelöst");
  });

  test("Funktionen und Aliase, die im selben Befehl definiert werden", () => {
    assert.equal(run("f() { git push; }; f"), true);
    assert.equal(run("function f { git commit -m x; }; f"), true);
    assert.equal(run("f() { git push; }; f", wt), false);
    assert.equal(run("f() { git push; }"), false, "nur definiert, nie aufgerufen");
    assert.equal(run(`f() { git push; }; cd '${wt}' && f`), false, "die Funktion läuft am Aufrufort");
    assert.equal(run(`f() { cd '${wt}'; }; f && git push`), false, "cd in der Funktion wirkt auf die Shell");
    assert.equal(run("alias g=git; g push"), true);
    assert.equal(run("alias g='git -C x'; g push"), true);
    assert.equal(run("alias g=git; g status"), false);
    assert.equal(run("alias g=git; unalias g; g push"), false);
    assert.equal(ask('alias g="$X"; g push'), true, "unauflösbarer Alias");
  });

  test("dynamisches cd/-C: aus dem Worktree wird gefragt, nur bei einem geschützten git-Aufruf", () => {
    for (const cmd of ['cd "$X" && git push', 'git -C "$D" push', "cd - && git push", "popd && git commit -m x", "git -C {} push"]) {
      assert.equal(ask(cmd, wt), true, cmd);
      assert.equal(run(cmd, wt), false, `${cmd}: fragt statt zu blocken`);
    }
    for (const cmd of ['cd "$X" && git status', 'cd "$X" && ls', `git -C '${wt}' push`, `cd '${wt}' && git push`, "git push"]) assert.equal(ask(cmd, wt), false, cmd);
    assert.equal(run('cd "$X" && git push'), true, "im Haupt-Checkout blockt es");
    assert.equal(ask('git -C "$D" push', resolve("/c/git/anderes")), false, "fremdes Repo: keine Rückfrage");
  });

  test("dynamisches Kommando und dynamischer git-Unterbefehl fragen im Haupt-Checkout", () => {
    assert.equal(ask("$(echo git) push"), true);
    assert.equal(ask('"$G" commit -m x'), true);
    assert.equal(ask('git "$SUB"'), true);
    assert.equal(ask("$EDITOR notizen.txt"), false);
    assert.equal(ask('git "$SUB"', wt), false);
  });

  test("Verschachtelung über MAX_TIEFE und Fehler im Auswerter fallen auf die grobe Regel zurück", () => {
    assert.equal(run("(".repeat(150) + "git push" + ")".repeat(150)), true);
    assert.equal(run("$(".repeat(150) + "git push" + ")".repeat(150)), true);
    assert.equal(run("(".repeat(150) + "echo x" + ")".repeat(150)), false);
    const kaputt = { ...fsFake([wt]), homedir: () => { throw new Error("boom"); } };
    assert.equal(run("cd ~ && git push", repoRoot, kaputt), true, "werfender Fake: grobe Regel statt Durchwinken");
    assert.equal(run("cd ~ && echo x", repoRoot, kaputt), false);
  });

  test("Review R1: -C-Ziel fehlt bei Ausgangsort ≠ Session-cwd, F-Seite, Negation, Rückfrage-Vorrang, Wortfortsetzung", () => {
    const fehlt = join(wt, "gibt-es-nicht");
    assert.equal(decide({ cwd: repoRoot, command: `cd '${wt}' && git -C gibt-es-nicht push`, repoRoot, deps: fsFake([wt], [fehlt]) }).block, true, "Session-cwd zusätzlich");
    assert.equal(run(`cd '${join(repoRoot, "weg")}' || git push`, repoRoot, fsFake([wt], [join(repoRoot, "weg")])), true, "fehlendes cd: der ||-Zweig läuft");
    assert.equal(run(`! cd '${repoRoot}' || git push`, wt), true, "! tauscht Erfolg und Misserfolg");
    assert.equal(run(`! cd '${repoRoot}' && git push`, wt), false, "Gegenprobe: nach ! cd läuft && nur bei Misserfolg");
    assert.equal(ask('bash -c "$C"; git -C "$D" push', wt), true, "die Rückfrage ohne mainOnly gilt auch dort, wo die mainOnly-Frage entfällt");
    assert.equal(run("gi\\\nt push"), true, "Zeilenfortsetzung mitten im Wort");
    assert.equal(run("command -v git push"), false, "command -v ist nur eine Abfrage");
  });

  test("Review R1: git config alias.X im selben Befehl gilt für das folgende git", () => {
    assert.equal(run("git config alias.p push && git p"), true);
    assert.equal(run("git config alias.P push && git p"), true, "Alias-Namen sind nicht case-sensitiv");
    assert.equal(run("git config --global alias.p '!git push'; git p"), true);
    assert.equal(run("git config alias.p status && git p"), false);
    assert.equal(run("git config alias.p push && git p", wt), false);
    assert.equal(ask('git config alias.p "$X"; git p'), true, "nicht statischer Alias");
  });

  test("Review R1: ein rev-parse je Verzeichnis und decide (kontextCache)", () => {
    let aufrufe = 0;
    const base = fsFake([wt]);
    const deps: ExecDeps = { ...base, execFileSync: (cmd, args, o) => { aufrufe++; return base.execFileSync?.(cmd, args, o) ?? ""; } };
    assert.equal(run("git push && git commit -m x && git -C . push", repoRoot, deps), true);
    assert.equal(aufrufe, 1, "Referenz und Ziel sind dasselbe Verzeichnis: ein einziger rev-parse, nicht einer je Aufruf");
  });

  test("MSYS-Pfade im Verbund (deps.platform), unabhängig vom Betriebssystem", () => {
    const deps: ExecDeps = { statSync: () => ({ isDirectory: () => true }), execFileSync: () => { throw new Error("kein git"); }, platform: "win32" };
    assert.deepEqual(protectedGitTargets("git -C /c/dev/main push", "C:\\work", deps), ["C:\\dev\\main"]);
    assert.deepEqual(protectedGitTargets("cd /c/dev/wt && git push", "C:\\work", deps), ["C:\\dev\\wt"]);
    assert.deepEqual(protectedGitTargets("git -C /c/dev/main status", "C:\\work", deps), []);
  });
});

describe("Hook gegen echtes git (#1308) — Temp-Repo mit Worktree und Unterordner", { timeout: 120_000 }, () => {
  let base = "";
  let main = "";
  let sub = "";
  let linked = "";
  let linkedSub = "";
  const slash = (p: string) => p.replace(/\\/g, "/");
  // Ohne GIT_*-Variablen der umgebenden Umgebung (z.B. GIT_DIR im pre-push-Hook): das Temp-Repo bleibt isoliert.
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("GIT_")));
  const git = (cwd: string, ...args: string[]) =>
    execFileSync("git", ["-c", `core.hooksPath=${join(base, "keine-hooks")}`, "-c", "user.name=t", "-c", "user.email=t@example.invalid", "-c", "commit.gpgsign=false", ...args], { cwd, encoding: "utf8", stdio: "pipe", env });

  // Auch die git-Aufrufe des Hooks selbst erben process.env: GIT_* für die Dauer dieses Blocks entfernen.
  const gitEnvVorher = Object.entries(process.env).filter(([k]) => k.startsWith("GIT_"));
  beforeAll(() => {
    for (const [k] of gitEnvVorher) delete process.env[k];
    base = realpathSync.native(mkdtempSync(join(tmpdir(), "kq-guard-")));
    main = join(base, "main");
    sub = join(main, "src");
    linked = join(base, "wt");
    linkedSub = join(linked, "src");
    mkdirSync(sub, { recursive: true });
    writeFileSync(join(sub, "b.txt"), "x");
    git(main, "init", "-q");
    git(main, "add", "-A");
    git(main, "commit", "-q", "-m", "init");
    git(main, "worktree", "add", "-q", "-b", "wtbranch", linked);
  }, 60_000);
  afterAll(() => {
    for (const [k, v] of gitEnvVorher) process.env[k] = v;
    rmSync(base, { recursive: true, force: true });
  });

  const kontextCache = new Map<string, unknown>(); // ein Temp-Repo, ein Zustand: Kontexte je Verzeichnis nur einmal ermitteln
  const blockt = (cwd: string, command: string) => decide({ cwd, command, repoRoot: main, deps: { kontextCache } }).block;

  test("resolveGitContext: Unterordner des Haupt-Checkouts und des Worktrees werden richtig zugeordnet", () => {
    const m = resolveGitContext(sub, main);
    assert.equal(m.relevant, true, "git liefert ../.git relativ zum Unterordner");
    assert.equal(m.isMainWorktree, true);
    const l = resolveGitContext(linkedSub, main);
    assert.equal(l.relevant, true);
    assert.equal(l.isMainWorktree, false);
  });

  test("aus dem Haupt-Checkout und seinem Unterordner: cd src / git -C src blocken, der Worktree geht durch", () => {
    for (const cwd of [main, sub]) {
      assert.equal(blockt(cwd, "git commit -m x"), true, cwd);
      assert.equal(blockt(cwd, `cd '${slash(sub)}' && git commit -m x`), true, "cd in den Unterordner des Haupt-Checkouts");
      assert.equal(blockt(cwd, `git -C '${slash(sub)}' push`), true, "-C in den Unterordner");
      assert.equal(blockt(cwd, `cd '${slash(linked)}' && git add -A && git commit -m x`), false, "cd in den Worktree");
      assert.equal(blockt(cwd, `git -C '${slash(linkedSub)}' push`), false, "-C in einen Unterordner des Worktrees");
    }
    assert.equal(blockt(main, "cd src && git commit -m x"), true, "relatives cd src");
    assert.equal(blockt(main, "git -C src commit -m x"), true, "relatives -C src");
  });

  test("aus dem Worktree: eigenes commit/push geht, der Haupt-Checkout wird auch über cd/-C geblockt", () => {
    for (const cwd of [linked, linkedSub]) {
      assert.equal(blockt(cwd, "git commit -m x"), false, cwd);
      assert.equal(blockt(cwd, `git -C '${slash(main)}' commit -m x`), true);
      assert.equal(blockt(cwd, `git -C '${slash(sub)}' push`), true);
      assert.equal(blockt(cwd, `cd '${slash(main)}' && git push`), true);
      assert.equal(blockt(cwd, `true && cd '${slash(main)}' && git push`), true, "nicht sicher geltendes cd-Ziel wird zusätzlich geprüft");
      assert.equal(blockt(cwd, `builtin cd '${slash(main)}' && git push`), true, "builtin cd wird als cd erkannt");
      assert.equal(blockt(cwd, `cd '${slash(main)}' && bash -c "git push"`), true, "Sicherheitsnetz prüft das verfolgte Verzeichnis, nicht das Session-cwd");
      assert.equal(blockt(cwd, `if true; then cd '${slash(main)}'; fi; git push`), true, "cd hinter then");
    }
  });

  test.skipIf(process.platform !== "win32")("Windows: MSYS-Pfade (/c/…) werden in cd und -C aufgelöst", () => {
    const msys = (p: string) => slash(p).replace(/^([A-Za-z]):/, (_m, d: string) => "/" + d.toLowerCase());
    assert.equal(blockt(linked, `git -C '${msys(main)}' push`), true);
    assert.equal(blockt(linked, `cd '${msys(main)}' && git push`), true);
    assert.equal(blockt(main, `cd '${msys(linked)}' && git commit -m x`), false);
    assert.equal(blockt(main, `git -C '${msys(linked)}' push`), false);
  });

  /** Differenz-Matrix: jeder Befehl, den die frühere Wortregel aus dem Haupt-Checkout blockte, muss
   *  weiter blocken, außer er ist hier bewusst als erlaubt gelistet (cd/-C in den Worktree, Text). */
  const L = () => slash(linked);
  const MATRIX: [string, boolean][] = [
    // [Befehl (L = Worktree), bewusst erlaubt?]
    ["git commit -m x", false],
    ["git push", false],
    ["git add -A && git commit -m x", false],
    ["npm test; git push origin x", false],
    ["echo a | git push", false],
    ["git -c a=b commit", false],
    ["git commit -F - <<EOF\nm\nEOF", false],
    ["find . -exec git commit {} \\;", false],
    ["x=$(git push)", false],
    ["echo `git commit`", false],
    ['gh issue comment 1 --body "$(git push)"', false],
    ['bash -c "git push"', false],
    ['timeout 5 git push', false],
    ["xargs -n 1 git push", false],
    ['node -e "git push"', false],
    ["cd - && git push", false],
    ["cd ~ && git push", false],
    ["cd 'L' && cd - && git push", false],
    ["true || cd 'L' && git push", false],
    ["(true) || cd 'L' && git push", false],
    ["if true; then cd 'L'; fi; git commit", false],
    ["git --git-dir=M/.git commit", false],
    ["cd 'L' && git -C \"$X\" push", false],
    ["cd 'L' && GIT_DIR=x git commit -m x", false],
    ["cd 'L' && git --git-dir=x push", false],
    ['find . -exec echo {} \\; -exec bash -c "git push" \\;', false], // hinter find gilt die Text-Ausnahme nicht
    ["git --git-dir .git commit -m x", false],
    ["cd 'L' && git --git-dir M/.git commit -m x", false],
    ["git -C ~/x push", false],
    ["xargs -I{} git -C {} push", false],
    ["cat <<EOF\n`git push`\nEOF", false],
    ["cd 'L' && (true) & git push", false],
    ["cd 'L' && { true; } & git push", false],
    ["cd 'L' && if true; then :; fi & git push", false],
    ["git --attr-source HEAD push", false],
    ["env -u echo bash -c \"git push\"", false],
    ["bash <<'EOF'\ngit push\nEOF", false],
    ["git -c alias.p=push p", false],
    ["f() { git push; }; f", false],
    // bewusst erlaubt (exakt statt konservativ: der Auswerter kennt jetzt Zweige, Wrapper und Text-Kommandos)
    ["if true; then cd 'L' && git push; fi", true],
    ["builtin cd 'L' && git commit -m x", true],
    ["command cd 'L' && git push", true],
    ["grep \"git push\" x", true],
    ["rg -n \"git commit\" docs", true],
    ["cd 'L' && git add -A && git commit -m x", true],
    ["cd 'L'; git commit -m x", true],
    ["cd 'L' && node x.mjs && git commit -m x", true],
    ["(cd 'L' && git push)", true],
    ["git -C 'L' push", true],
    ["timeout 5 git -C 'L' push", true],
    ['gh issue comment 1 --body "git push und git commit"', true],
    ['gh pr create --body "$(cat <<\'EOF\'\ngit commit\nEOF\n)"', true],
    ["cat > f <<'EOF'\ngit push\nEOF", true],
    ["echo 'git push'", true],
    ["git log --grep=push", true],
    ["git stash push", true],
    ["git status # git push", true],
    ['FOO=1 gh issue comment 1 --body "git push"', true],
    ['command echo "git push"', true],
  ];

  test("Differenz-Matrix aus Haupt-Checkout und Unterordner: nur bewusste Fälle gehen durch", () => {
    const coarse = (c: string) => c.split(/&&|\|\||;|\n/).some((s) => /\bgit\b/.test(s) && /\b(commit|push)\b/.test(s)); // frühere Wortregel
    for (const cwd of [main, sub]) {
      for (const [roh, erlaubt] of MATRIX) {
        const cmd = roh.replace(/'L'/g, `'${L()}'`).replace(/\bM\//g, `${slash(main)}/`);
        assert.equal(blockt(cwd, cmd), !erlaubt, `${cwd}: ${cmd}`);
        if (!erlaubt) assert.ok(coarse(cmd), `Matrix-Eintrag blockte schon früher: ${cmd}`);
      }
    }
  });

  test("Interpreter mit Heredoc, Funktionen und Aliase gegen echtes git", () => {
    assert.equal(blockt(main, "bash <<'EOF'\ngit push\nEOF"), true);
    assert.equal(blockt(linked, `bash <<'EOF'\ngit -C '${slash(main)}' push\nEOF`), true);
    assert.equal(blockt(linked, "bash <<'EOF'\ngit push\nEOF"), false);
    assert.equal(blockt(main, "f() { git push; }; f"), true);
    assert.equal(blockt(linked, `cd '${slash(main)}' && { true; } & git push`), false, "& am Block: das cd gilt dort nicht, der Aufruf läuft im Worktree");
  });

  test("git config alias.* wird für unbekannte Unterbefehle befragt", () => {
    git(main, "config", "alias.up", "push");
    git(main, "config", "alias.st", "status");
    assert.equal(blockt(main, "git up"), true);
    assert.equal(blockt(main, "git st"), false);
    assert.equal(blockt(linked, "git up"), false, "Alias gilt gemeinsam, im Worktree bleibt push erlaubt");
    git(main, "config", "--unset", "alias.up");
    git(main, "config", "--unset", "alias.st");
  });

  test("Junction/Symlink auf den Haupt-Checkout: Kontext über realpath erkannt", () => {
    const link = join(base, "main-link");
    symlinkSync(main, link, "junction");
    const wtLink = join(base, "wt-link");
    symlinkSync(linked, wtLink, "junction");
    assert.equal(resolveGitContext(link, main).relevant, true, "git-common-dir über den Link aufgelöst");
    assert.equal(blockt(link, "git commit -m x"), true);
    assert.equal(blockt(link, `cd '${slash(wtLink)}' && git commit -m x`), false);
    assert.equal(blockt(wtLink, "git commit -m x"), false);
    assert.equal(blockt(wtLink, `git -C '${slash(link)}' push`), true);
  });
});

describe("parseHookInput / buildDenyOutput (#735) — CLI-Ein-/Ausgabe", () => {
  test("parst gültiges Hook-stdin-JSON (cwd + tool_input.command)", () => {
    const input = JSON.stringify({ cwd: "/c/git/kubequest", tool_name: "Bash", tool_input: { command: "git push" } });
    assert.deepEqual(parseHookInput(input), { tool: "Bash", cwd: "/c/git/kubequest", command: "git push" });
  });

  test("kaputtes/leeres JSON liefert leeres Objekt statt zu crashen", () => {
    assert.deepEqual(parseHookInput(""), {});
    assert.deepEqual(parseHookInput("{not json"), {});
  });

  test("fehlender tool_input.command liefert command: undefined", () => {
    const input = JSON.stringify({ cwd: "/x", tool_name: "Bash", tool_input: {} });
    assert.deepEqual(parseHookInput(input), { tool: "Bash", cwd: "/x", command: undefined });
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

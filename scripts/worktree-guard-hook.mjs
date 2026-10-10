// Kein Einstieg, kein Direktaufruf (#1579, Konvention #1398): Lib des Dispatchers `scripts/pretooluse-hook.mjs`, der einzige registrierte
// PreToolUse-Hook; wird von ihm, von worktree-guard-powershell.mjs und von test/harness/worktree-guard.test.ts importiert.
/**
 * Worktree-Guard-Hook (#735) — Claude-Code-`PreToolUse`-Hook für `Bash`.
 *
 * Hintergrund: AGENTS.md verlangt "IMMER im eigenen `git worktree` arbeiten, nie im
 * main-Checkout committen/pushen". Real vorgekommen: eine parallele Sitzung committete 2026-07-07
 * eigenständig im geteilten main-Checkout (siehe #735). Dieser Hook macht daraus eine kleine, technische
 * Mauer: `git commit`/`git push`, das im GETEILTEN Haupt-Checkout dieses Repos (nicht in einem Linked
 * Worktree) liefe, wird über `PreToolUse` geblockt.
 *
 * Aufbau (#1311):
 *  - `scripts/bash-parser.mjs` zerlegt den Befehl in einen AST (Liste → Und-Oder-Kette → Pipeline → Kommando).
 *  - Der Auswerter (`worktree-guard-eval.mjs`; git-Aufrufe in `worktree-guard-git.mjs`, Tabellen in `worktree-guard-tabellen.mjs`) führt MENGEN möglicher Verzeichnisse mit: `D` = wo das nächste Kommando laufen kann.
 *    Eine Und-Oder-Kette liefert `{ S, F }` (Verzeichnisse nach Erfolg bzw. Misserfolg des letzten Gliedes);
 *    `a && b` wertet b aus S, `a || b` aus F, das Kettenende ist S ∪ F. Ein `cd` auf ein statisches, existierendes
 *    Ziel ersetzt die Menge exakt; ein fehlendes Ziel oder zu viele Argumente lässt sie unverändert (konservativ);
 *    ein dynamisches Ziel (`cd "$X"`, `cd -`, `popd`) fügt Session-`cwd` und einen Unbekannt-Marker hinzu.
 *    Subshells, Substitutionen, Pipelines und Hintergrundlisten (`&`) wirken nicht nach außen; `{ … }` und
 *    `eval` schon; if/Schleifen/case vereinigen die Enden aller Zweige.
 *  - Geschützt sind `git commit`/`git push`, `git subtree push`, die Unterkommandos von `git submodule foreach` und
 *    `git rebase -x/--exec`, Git-Aliase (`-c alias.p=push p`, `git config alias.*`) und exportiertes
 *    `GIT_DIR`/`GIT_WORK_TREE`. Ziel ist je Verzeichnis aus `D`: `-C`-Kette (relativ, `~` per `os.homedir()`,
 *    MSYS-Pfade), `--git-dir`/`--work-tree`, Wrapper mit Ortswechsel (`env -C`, `sudo -D`). Ein nicht existierendes
 *    `-C`-Ziel und `~` prüfen zusätzlich Ausgangsort und Session-`cwd`.
 *  - Wrapper (`sudo`, `env`, `timeout`, `xargs`, `nice`, `command`, `builtin` …) werden mit ihren Optionen
 *    übersprungen; `find -exec`-Unterkommandos werden einzeln bewertet. Interpreter (`bash|sh|zsh|dash|ksh -c`,
 *    `eval`, Heredoc/Here-String/Pipe als Eingabe, Funktionen und Aliase im selben Befehl) werden rekursiv
 *    ausgewertet und zusätzlich mit der groben Wortregel vereint.
 *  - Was nicht statisch bestimmbar ist, wird NICHT durchgelassen, sondern gefragt (`permissionDecision: "ask"`):
 *    ein geschützter git-Aufruf mit dynamischem Ziel (`cd "$X"`, `-C "$D"`, `git "$SUB"`) und ein Interpreter mit
 *    nicht statischem Text (`bash -c "$X"`, `curl … | sh`, unauflösbarer Alias), Letzteres nur, wenn der Haupt-
 *    Checkout erreichbar ist. Im eigenen Worktree mit literalem Pfad fragt der Hook nie.
 *  - Text in Heredoc-Bodies (außer `$(…)`/Backticks bei unquotiertem Delimiter) und Kommentaren zählt nie; Text in
 *    Quotes zählt bei reinen Text-Kommandos (gh, echo, printf, cat, grep, egrep, fgrep, rg ohne `--pre`) nicht.
 *  - Nicht zerlegbar (offenes Quote, `for ((…))`, Verschachtelung über MAX_TIEFE): grobe Wortregel (Wortsuche
 *    "git" + "commit"/"push") gegen das Session-`cwd`.
 *  - Fail-open nur bei fehlendem `cwd`, Nicht-Git-Verzeichnis und anderem Repo (dieselbe "kein falsches Rot"-
 *    Philosophie wie check-diffsize.mjs).
 *  - Ersetzt NICHT den PR-Gate (#592): das bleibt die Durchsetzung für Code-Qualität. Der Hook fängt die EINE
 *    irreversible Fehlaktion "Commit/Push vom falschen Ort". Er erkennt Haupt- vs. Linked-Worktree über gits
 *    Konvention (am Toplevel eines Linked Worktree ist `.git` eine DATEI, im Haupt-Checkout ein VERZEICHNIS) und
 *    vergleicht `git-common-dir` (per `realpath`, also auch über Junction/Symlink) mit dem des eigenen Checkouts.
 *  - Das PowerShell-Tool deckt scripts/worktree-guard-powershell.mjs ab, beide hängen am Dispatcher.
 *
 * Bewusste Grenzen:
 *  - Eine zur Laufzeit gebaute Befehlszeile aus mehreren Schritten (`X=$(…); $X`), Skripte (`bash skript.sh`) und
 *    Binärprogramme, die selbst git aufrufen (`npm run x`), sieht er nicht.
 *
 * Reines Node-Skript (nur Builtins). Die Entscheidungslogik ist pur/exportiert und testbar
 * (execFile/stat/homedir/platform injizierbar) — EINE Quelle für Hook-CLI und Test.
 */

import { execFileSync } from "node:child_process";
import { statSync, realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildDenyOutput, parseHookInput } from "./hook-io.mjs";
import { analyse } from "./worktree-guard-eval.mjs";
import { coarseProtected, fromMsysPath, pathFor } from "./worktree-guard-tabellen.mjs";

export { parseHookInput, buildDenyOutput, analyse, coarseProtected, fromMsysPath };

/** Normalisiert einen Pfad für den Vergleich: Backslashes -> Slashes, unter
 *  Windows zusätzlich klein geschrieben (case-insensitives Dateisystem); Linux
 *  bleibt case-sensitive. */
function normalizePath(p, platform = process.platform) {
  const slashed = String(p).replace(/\\/g, "/").replace(/\/+$/, "");
  return platform === "win32" ? slashed.toLowerCase() : slashed;
}


/** Verzeichnisse, in denen `git commit`/`git push` aus `command` liefen (Session-`cwd`, `cd`, `git -C` …); leer
 *  ohne solchen Aufruf. Nicht zerlegbar: `[cwd]` bei grobem Treffer. */
export function protectedGitTargets(command, cwd, deps = {}) {
  return analyse(command, cwd, deps).targets;
}

/** True, wenn `command` einen echten `git commit`/`git push` ausführt (Fake: nichts existiert, kein git-Config). */
export function isProtectedGitCommand(command) {
  const deps = {
    statSync: () => ({ isDirectory: () => false }),
    execFileSync: () => {
      throw new Error("kein git");
    },
    homedir: () => "/home/test",
  };
  return protectedGitTargets(command, ".", deps).length > 0;
}

/** Ermittelt, ob `cwd` zu DEMSELBEN Repo gehört wie `repoRoot` (Vergleich über `git-common-dir`, per `realpath`,
 *  also auch über Junction/Symlink; der `git-common-dir` von `repoRoot` ist die Referenz, nicht
 *  `<repoRoot>/.git`) und ob es der Haupt-Checkout oder ein Linked Worktree ist (`.git` als Verzeichnis vs. Datei am
 *  Toplevel). Ein einziger `git rev-parse` je Verzeichnis, gecacht über `deps.kontextCache`. Wirft nie — bei jedem
 *  git-/fs-Fehler `{ relevant: false }`. `deps` injizierbar fürs Testen (execFileSync/statSync/platform). */
export function resolveGitContext(cwd, repoRoot, deps = {}) {
  const exec = deps.execFileSync ?? execFileSync;
  const stat = deps.statSync ?? statSync;
  const platform = deps.platform ?? process.platform;
  const P = pathFor(platform);
  const cache = deps.kontextCache;

  const lookup = (dir) => {
    const key = `${repoRoot}\0${dir}`;
    if (cache?.has(key)) return cache.get(key);
    let v = null;
    try {
      const out = exec("git", ["rev-parse", "--show-toplevel", "--git-common-dir"], { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
      const [top, common] = String(out).split(/\r?\n/).map((s) => s.trim());
      if (top && common) v = { top, common };
    } catch {
      v = null;
    }
    cache?.set(key, v);
    return v;
  };
  const canon = (base, raw) => {
    const p = P.resolve(base, raw); // git gibt den Pfad relativ zum Aufruf-Verzeichnis aus (`../.git` im Unterordner)
    try {
      return realpathSync.native(p);
    } catch {
      return p;
    }
  };

  const ref = lookup(repoRoot);
  if (!ref) return { relevant: false };
  const mine = lookup(cwd);
  if (!mine) return { relevant: false };
  if (normalizePath(canon(cwd, mine.common), platform) !== normalizePath(canon(repoRoot, ref.common), platform)) {
    return { relevant: false }; // cwd gehört zu einem anderen Repo — nicht unsere Sache
  }
  let isMainWorktree;
  try {
    isMainWorktree = stat(join(mine.top, ".git")).isDirectory();
  } catch {
    isMainWorktree = true; // .git nicht lesbar -> im Zweifel konservativ blocken
  }
  return { relevant: true, toplevel: mine.top, isMainWorktree };
}

const BLOCK_REASON = (top) =>
  `git commit/push würde im geteilten main-Checkout (${top}) laufen und ist blockiert. ` +
  `Aus einem worktree: \`git -C <worktree> …\` (ändert die Shell-cwd nicht) oder \`cd <worktree> && git …\`, ` +
  `beides wertet der Hook aus. Neuer Worktree (AGENTS.md § Git-Workflow): ` +
  `\`git fetch origin && git worktree add .claude/worktrees/kq-<nr> -b feature/kq-<nr>-<slug> origin/main\` (vom frischen origin/main, #772). (#735)`;

/** Gesamtentscheidung: `block` nur, wenn (a) das Kommando commit/push ist, (b) cwd bekannt ist, (c) mindestens ein
 *  Ziel-Verzeichnis zu diesem Repo gehört UND (d) dort der Haupt-Checkout liegt (kein Linked Worktree). `ask`, wenn
 *  nichts blockt, aber ein Ziel/Inhalt nicht statisch bestimmbar ist (siehe Kopfkommentar). Sonst durchlassen. */
export function decide({ cwd, command, repoRoot, deps = {} }) {
  if (!cwd) return { block: false }; // kein cwd im Payload -> nicht entscheidbar, fail-open
  const d = { ...deps, kontextCache: deps.kontextCache ?? new Map() };
  let found;
  try {
    found = analyse(command, cwd, d);
  } catch {
    found = { targets: coarseProtected(command) ? [cwd] : [], asks: new Map() }; // unerwarteter Fehler: grobe Regel statt Durchwinken
  }
  for (const target of found.targets) {
    const ctx = resolveGitContext(target, repoRoot, d);
    if (ctx.relevant && ctx.isMainWorktree) return { block: true, reason: BLOCK_REASON(ctx.toplevel) };
  }
  for (const [dir, a] of found.asks) {
    const ctx = resolveGitContext(dir, repoRoot, d);
    if (!ctx.relevant || (a.mainOnly && !ctx.isMainWorktree)) continue;
    return { block: false, ask: true, reason: `Worktree-Guard: ${a.reason} Den Ort literal angeben (\`git -C <worktree-pfad> …\`) oder bestätigen. (#1311)` };
  }
  return { block: false };
}

/** Repo-Root aus dem Skript-Pfad ableiten (`scripts/<datei>.mjs` liegt eine Ebene unter dem Root). */
export const repoRootFromScriptUrl = (importMetaUrl) => dirname(dirname(fileURLToPath(importMetaUrl)));

// Kein Shebang: wird über den Dispatcher `scripts/pretooluse-hook.mjs` (oder direkt per `node scripts/worktree-guard-hook.mjs`)
// gestartet UND von test/harness/worktree-guard.test.ts importiert (ein `#!` bricht den Test-Import, analog zu check-diffsize.mjs).
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
 *  - Dieser Auswerter führt MENGEN möglicher Verzeichnisse mit: `D` = wo das nächste Kommando laufen kann.
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
 *  - Verbleibende Grenze: eine zur Laufzeit gebaute Befehlszeile aus mehreren Schritten (`X=$(…); $X`), Skripte
 *    (`bash skript.sh`) und Binärprogramme, die selbst git aufrufen (`npm run x`), sieht er nicht.
 *  - Das PowerShell-Tool deckt scripts/worktree-guard-powershell.mjs ab, beide hängen am Dispatcher.
 *
 * Reines Node-Skript (nur Builtins). Die Entscheidungslogik ist pur/exportiert und testbar
 * (execFile/stat/homedir/platform injizierbar) — EINE Quelle für Hook-CLI und Test.
 */

import { execFileSync } from "node:child_process";
import { statSync, realpathSync } from "node:fs";
import { homedir as osHomedir } from "node:os";
import path, { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseBash } from "./bash-parser.mjs";
import { buildDenyOutput, emit, istDirektaufruf, mergeDecisions, parseHookInput, readStdin } from "./hook-io.mjs";

export { parseHookInput, buildDenyOutput };

/** Normalisiert einen Pfad für den Vergleich: Backslashes -> Slashes, unter
 *  Windows zusätzlich klein geschrieben (case-insensitives Dateisystem); Linux
 *  bleibt case-sensitive. */
function normalizePath(p, platform = process.platform) {
  const slashed = String(p).replace(/\\/g, "/").replace(/\/+$/, "");
  return platform === "win32" ? slashed.toLowerCase() : slashed;
}

/** Grobe Wortregel (Rückfall, wenn der Parser nicht zerlegen kann oder ein Interpreter den eigentlichen
 *  Befehl verbirgt): ein Segment (Split auf `&&`/`||`/`;`/Zeilenumbruch) mit "git" UND "commit"/"push" als Wort. */
export function coarseProtected(command) {
  const segments = String(command).split(/&&|\|\||;|\n/);
  return segments.some((seg) => /\bgit\b/.test(seg) && /\b(commit|push)\b/.test(seg));
}

// ── Tabellen ────────────────────────────────────────────────────────────────
const GIT_RE = /^(?:.*[\\/])?git(?:\.exe)?$/i;
const ASSIGN_RE = /^[A-Za-z_]\w*=/;
const PROTECTED_SUBS = new Set(["commit", "push"]);
/** Reine Text-Kommandos: ein Wortpaar "git commit/push" darin ist kein Aufruf. */
const TEXT_COMMANDS = new Set(["gh", "echo", "printf", "cat", "grep", "egrep", "fgrep", "rg"]);
const SHELLS = new Set(["bash", "sh", "zsh", "dash", "ksh", "ash"]);
const CD_LIKE = new Set(["cd", "pushd", "popd"]);
/** Wrapper, hinter denen ein `cd` weiterhin die aktuelle Shell wechselt. */
const CD_WRAPPERS = new Set(["builtin", "command", "time"]);
const EXEC_FLAGS = new Set(["-exec", "-execdir", "-ok", "-okdir"]);
const EXPORTERS = new Set(["export", "declare", "typeset", "readonly", "local"]);
const MAX_INTERPRETER = 6; // Rekursionstiefe Interpreter-Strings/Funktionen/Aliase
const UNKNOWN = "\0unbekannt";

/** Wrapper-Tabelle: Optionen mit Wert (`val`), Optionen mit Ortswechsel (`chdir`), Positionsargumente (`pos`),
 *  `assign`: NAME=WERT-Argumente. */
const W = (val = [], extra = {}) => ({ val: new Set(val), chdir: new Set(extra.chdir ?? []), pos: extra.pos ?? 0, assign: extra.assign ?? false, lookup: new Set(extra.lookup ?? []) });
const WRAPPERS = {
  time: W(["-f", "-o", "--format", "--output"]),
  command: W([], { lookup: ["-v", "-V"] }),
  exec: W(["-a"]),
  builtin: W(),
  env: W(["-u", "--unset", "-S", "--split-string", "-C", "--chdir"], { chdir: ["-C", "--chdir"], assign: true }),
  sudo: W(["-u", "-g", "-p", "-C", "-r", "-t", "-U", "-T", "-R", "-h", "-D", "--user", "--group", "--chdir"], { chdir: ["-D", "--chdir"] }),
  doas: W(["-u", "-C"]),
  xargs: W(["-I", "-L", "-n", "-P", "-s", "-d", "-E", "-a", "--max-args", "--max-procs", "--delimiter", "--arg-file"]),
  nice: W(["-n", "--adjustment"]),
  timeout: W(["-s", "-k", "--signal", "--kill-after"], { pos: 1 }),
  stdbuf: W(["-i", "-o", "-e"]),
  ionice: W(["-c", "-n", "-p"]),
  nohup: W(),
  winpty: W(),
  setsid: W(),
  unbuffer: W(),
};

/** Eingebaute git-Unterbefehle (Rest: möglicher Alias, wird per `git config` aufgelöst). */
const KNOWN_SUBS = new Set(
  ("add am annotate apply archive bisect blame branch bundle cat-file check-attr check-ignore checkout checkout-index cherry cherry-pick clean clone column " +
    "commit-graph commit-tree config count-objects credential describe diff diff-files diff-index diff-tree difftool fast-export fast-import fetch filter-branch " +
    "fmt-merge-msg for-each-ref format-patch fsck gc grep gui hash-object help init interpret-trailers log ls-files ls-remote ls-tree maintenance merge merge-base " +
    "mergetool mktree mv name-rev notes pack-refs prune pull range-diff read-tree rebase reflog remote repack replace request-pull rerere reset restore rev-list " +
    "rev-parse revert rm send-email shortlog show show-branch show-ref sparse-checkout stash status submodule subtree switch symbolic-ref tag update-index update-ref " +
    "var verify-commit verify-tag version whatchanged worktree write-tree bugreport diagnose scalar").split(" "),
);

// ── Kontext und Pfad-Helfer ─────────────────────────────────────────────────
/** MSYS-/Git-Bash-Pfad `/c/foo` → `C:/foo` (nur unter Windows). */
export function fromMsysPath(p, platform = process.platform) {
  const m = platform === "win32" ? /^\/([a-zA-Z])(?:\/(.*))?$/.exec(p) : null;
  return m ? `${m[1].toUpperCase()}:/${m[2] ?? ""}` : p;
}

function makeCtx(cwd, deps) {
  const platform = deps.platform ?? process.platform;
  const P = platform === process.platform ? path : platform === "win32" ? path.win32 : path.posix;
  return {
    P,
    platform,
    deps,
    stat: deps.statSync ?? statSync,
    home: () => (deps.homedir ? deps.homedir() : osHomedir()),
    cwd: P.resolve(cwd),
    targets: new Set(),
    asks: new Map(),
    fns: new Map(),
    aliases: new Map(),
    expanding: new Set(),
    gitEnv: { gitDir: null, workTree: null },
    seen: new Set(),
    depth: 0,
    aliasCache: new Map(),
    cfgAliases: new Map(), // `git config alias.X …` im selben Befehl
  };
}

const real = (D) => [...D].filter((d) => d !== UNKNOWN);
const union = (...sets) => new Set(sets.flatMap((s) => [...s]));
const abs = (c, base, p) => c.P.resolve(base, fromMsysPath(p, c.platform));

function isDir(c, p) {
  try {
    return c.stat(p).isDirectory();
  } catch {
    return false;
  }
}

/** `~`/`~/x` per `os.homedir()` auflösen; `~user` u.ä. → null (nicht auflösbar); sonst unverändert. */
function tildeOf(c, text) {
  if (text === "~") return c.home();
  if (/^~[\\/]/.test(text)) return c.P.join(c.home(), text.slice(2));
  return text.startsWith("~") ? null : text;
}

/** Rückfrage vormerken: für die Verzeichnisse `dirs` (und das Session-`cwd`). `mainOnly`: nur, wenn dort der Haupt-
 *  Checkout liegt (unbekannter Inhalt); sonst bei jedem Verzeichnis dieses Repos (unbekanntes Ziel). */
function ask(c, dirs, reason, mainOnly = false) {
  for (const d of [...dirs, c.cwd]) {
    if (d === UNKNOWN) continue;
    const alt = c.asks.get(d);
    if (!alt || (alt.mainOnly && !mainOnly)) c.asks.set(d, { reason, mainOnly });
  }
}

// ── Wörter vorbereiten ──────────────────────────────────────────────────────
const REDIR_ONLY = /^(?:\d*|&)(?:>>|>\||>&|<&|<>|<<<|>|<)$/;
const REDIR_ATTACHED = /^(?:\d*|&)(?:>>|>\||>&|<&|<>|>|<)./;

/** Entfernt Umleitungen (`>f`, `2>&1`, `> f`) aus den Wörtern. */
function stripRedirs(words) {
  const out = [];
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (!w.quoted && REDIR_ONLY.test(w.text)) i++;
    else if (!w.quoted && REDIR_ATTACHED.test(w.text)) continue;
    else out.push(w);
  }
  return out;
}

const hereStringOf = (words) => {
  const i = words.findIndex((w) => !w.quoted && w.text === "<<<");
  return i >= 0 ? (words[i + 1] ?? null) : null;
};

const baseName = (text) => text.replace(/\\/g, "/").split("/").pop().toLowerCase().replace(/\.exe$/, "");

/** Überspringt Zuweisungen und Wrapper (mit ihren Optionen) vor dem eigentlichen Kommando.
 *  `i`: Index des Kommandowortes (-1: keines, nur Zuweisungen), `name`: dessen Basisname, `wrappers`, `chdirs`
 *  (Ortswechsel-Optionen von `env -C`/`sudo -D`), `env`: NAME=WERT-Zuweisungen davor. */
function peel(words) {
  const res = { i: -1, name: null, wrappers: [], chdirs: [], env: [], dynamicCmd: false, noop: false };
  const assign = (w) => {
    const eq = w.text.indexOf("=");
    res.env.push({ name: w.text.slice(0, eq), word: { text: w.text.slice(eq + 1), dynamic: w.dynamic } });
  };
  let i = 0;
  for (let round = 0; round < 20; round++) {
    while (i < words.length && ASSIGN_RE.test(words[i].text)) assign(words[i++]);
    if (i >= words.length) return res;
    const w = words[i];
    if (w.dynamic) return { ...res, i, dynamicCmd: true };
    const name = baseName(w.text);
    const spec = WRAPPERS[name];
    if (!spec) return { ...res, i, name };
    res.wrappers.push(name);
    i++;
    let pos = spec.pos;
    while (i < words.length) {
      const a = words[i];
      const t = a.text;
      if (spec.assign && ASSIGN_RE.test(t)) {
        assign(a);
        i++;
      } else if (!a.dynamic && t === "--") {
        i++;
        break;
      } else if (!a.dynamic && t.startsWith("-") && t.length > 1) {
        const eq = t.startsWith("--") ? t.indexOf("=") : -1;
        const opt = eq > 0 ? t.slice(0, eq) : t;
        if (spec.lookup.has(opt)) return { ...res, noop: true };
        if (spec.chdir.has(opt)) {
          if (eq > 0) res.chdirs.push({ text: t.slice(eq + 1), dynamic: a.dynamic });
          else res.chdirs.push(words[i + 1] ?? { text: "", dynamic: true });
        }
        i += spec.val.has(opt) && eq < 0 ? 2 : 1;
      } else if (pos > 0) {
        pos--;
        i++;
      } else break;
    }
  }
  return res;
}

// ── Auswerter ───────────────────────────────────────────────────────────────
function evalList(list, D, c) {
  for (const it of list.items) {
    const r = evalAndOr(it.andor, D, c);
    if (!it.bg) D = union(r.S, r.F); // Hintergrund: läuft in einer Subshell, D bleibt
  }
  return D;
}

function evalAndOr(andor, D, c) {
  let { S, F } = evalPipeline(andor.first, D, c);
  for (const { op, pipe } of andor.rest) {
    const r = evalPipeline(pipe, op === "&&" ? S : F, c);
    if (op === "&&") {
      F = union(F, r.F);
      S = r.S;
    } else {
      S = union(S, r.S);
      F = r.F;
    }
  }
  return { S, F };
}

function evalPipeline(p, D, c) {
  let r;
  if (p.cmds.length === 1) r = evalCmd(p.cmds[0], D, c, {});
  else {
    p.cmds.forEach((cmd, i) => evalCmd(cmd, D, c, { pipeSrc: i > 0 ? p.cmds[i - 1] : null })); // jedes Glied in einer Subshell
    r = { S: D, F: D };
  }
  return p.neg ? { S: r.F, F: r.S } : r;
}

function evalSubsts(node, D, c) {
  for (const l of node.substs ?? []) evalList(l, D, c);
  for (const h of node.heredocs ?? []) for (const l of h.substs) evalList(l, D, c);
}

function evalCmd(cmd, D, c, opts) {
  switch (cmd.type) {
    case "simple":
      return evalSimple(cmd, D, c, opts);
    case "subshell":
      evalSubsts(cmd, D, c);
      evalList(cmd.body, D, c);
      return { S: D, F: D };
    case "group": {
      evalSubsts(cmd, D, c);
      const r = evalList(cmd.body, D, c);
      return { S: r, F: r };
    }
    case "funcdef":
      c.fns.set(cmd.name, cmd.body);
      return { S: D, F: D };
    default: {
      evalSubsts(cmd, D, c);
      const r = evalCompound(cmd, D, c);
      return { S: r, F: r };
    }
  }
}

/** if / while / until / for / case: die Enden aller Zweige vereinen (Schleifen zwei Durchläufe). */
function evalCompound(cmd, D, c) {
  if (cmd.type === "if") {
    let cur = D;
    const ends = [];
    for (const cl of cmd.clauses) {
      cur = evalList(cl.cond, cur, c);
      ends.push(evalList(cl.body, cur, c));
    }
    ends.push(cmd.else ? evalList(cmd.else, cur, c) : cur);
    return union(...ends);
  }
  if (cmd.type === "case") return union(D, ...cmd.arms.map((a) => evalList(a, D, c)));
  let cur = D;
  for (let i = 0; i < 2; i++) {
    const dc = cmd.cond ? evalList(cmd.cond, cur, c) : cur;
    cur = union(cur, dc, evalList(cmd.body, dc, c));
  }
  return cur;
}

const dynamicState = (D, c) => ({ S: union(D, new Set([c.cwd, UNKNOWN]), c.seen), F: D });

/** `cd`/`pushd`/`popd` (Optionen `-L -P -e -@ --` gefiltert). */
function cdEffect(name, args, D, c) {
  for (const d of real(D)) c.seen.add(d);
  const ops = [];
  let optsDone = false;
  for (const w of args) {
    if (!optsDone && !w.dynamic && w.text === "--") optsDone = true;
    else if (optsDone || w.dynamic || !["-L", "-P", "-e", "-@"].includes(w.text)) ops.push(w);
  }
  if (ops.length > 1) return { S: D, F: D }; // zu viele Argumente: cd schlägt fehl
  const t = ops[0];
  if (name === "popd" || (name === "pushd" && !t) || (t && (t.dynamic || t.text === "-"))) return dynamicState(D, c);
  if (!t) return { S: new Set([c.home(), c.cwd]), F: D }; // `cd` ohne Argument: Home
  const text = tildeOf(c, t.text);
  if (text === null) return dynamicState(D, c);
  if (text !== t.text) {
    const n = abs(c, c.cwd, text);
    if (!isDir(c, n)) return { S: D, F: D };
    c.seen.add(n);
    return { S: new Set([n, c.cwd]), F: D };
  }
  const S = new Set();
  const F = new Set();
  for (const el of D) {
    if (el === UNKNOWN) {
      S.add(c.P.isAbsolute(fromMsysPath(text, c.platform)) ? abs(c, c.cwd, text) : UNKNOWN);
      continue;
    }
    const dir = abs(c, el, text);
    if (isDir(c, dir)) {
      S.add(dir);
      c.seen.add(dir);
    } else {
      S.add(el);
      F.add(el); // fehlendes Ziel: konservativ, der Nachfolger läuft gegen die unveränderte Menge
    }
  }
  return { S, F };
}

function noteEnv(c, env) {
  for (const { name, word } of env) {
    if (name === "GIT_DIR") c.gitEnv.gitDir = word;
    else if (name === "GIT_WORK_TREE") c.gitEnv.workTree = word;
  }
}

const isTextCommand = (name, words) => TEXT_COMMANDS.has(name) && !(name === "rg" && words.some((w) => w.text === "--pre" || w.text.startsWith("--pre=")));

function aliasWordsOf(value) {
  const p = parseBash(value);
  const items = p.ok ? p.ast.items : [];
  const cmd = items.length === 1 && !items[0].bg && !items[0].andor.rest.length && items[0].andor.first.cmds.length === 1 ? items[0].andor.first.cmds[0] : null;
  return cmd && cmd.type === "simple" && !cmd.substs.length ? stripRedirs(cmd.words) : null;
}

function evalSimple(cmd, D, c, opts) {
  evalSubsts(cmd, D, c);
  const same = { S: D, F: D };
  const hereString = hereStringOf(cmd.words);
  const words = stripRedirs(cmd.words);
  if (!words.length) return same;
  const pe = peel(words);
  if (pe.noop) return same;
  if (pe.i < 0) {
    noteEnv(c, pe.env); // nur Zuweisungen: gelten für folgende Kommandos (konservativ als exportiert)
    return same;
  }
  const args = words.slice(pe.i + 1);
  if (pe.dynamicCmd) {
    if (args.some((w) => !w.dynamic && PROTECTED_SUBS.has(w.text))) ask(c, real(D), "Das Kommando ist dynamisch (`$(…) push`, `$GIT commit`): git commit/push im Haupt-Checkout nicht auswertbar.", true);
    return same;
  }
  const name = pe.name;
  if (c.fns.has(name) && c.depth < MAX_INTERPRETER) {
    c.depth++;
    const r = evalCmd(c.fns.get(name), D, c, opts);
    c.depth--;
    return r;
  }
  if (name === "alias" || name === "unalias") {
    for (const w of args) {
      const m = /^([^=]+)=(.*)$/s.exec(w.text);
      if (name === "unalias") c.aliases.delete(w.text);
      else if (m) c.aliases.set(m[1], w.dynamic ? null : aliasWordsOf(m[2]));
    }
    return same;
  }
  if (c.aliases.has(name) && !c.expanding.has(name) && c.depth < MAX_INTERPRETER) {
    const aw = c.aliases.get(name);
    if (aw === null) {
      ask(c, real(D), `Der Alias \`${name}\` ist nicht statisch auflösbar.`, true);
      return same;
    }
    c.expanding.add(name);
    c.depth++;
    const r = evalSimple({ ...cmd, words: [...words.slice(0, pe.i), ...aw, ...args], substs: [], heredocs: cmd.heredocs }, D, c, opts);
    c.depth--;
    c.expanding.delete(name);
    return r;
  }
  if (CD_LIKE.has(name) && pe.wrappers.every((w) => CD_WRAPPERS.has(w))) return cdEffect(name, args, D, c);
  if (EXPORTERS.has(name)) {
    noteEnv(c, args.filter((w) => ASSIGN_RE.test(w.text)).map((w) => ({ name: w.text.slice(0, w.text.indexOf("=")), word: { text: w.text.slice(w.text.indexOf("=") + 1), dynamic: w.dynamic } })));
    return same;
  }
  if (name === "git") {
    gitCall(words, pe.i, pe, D, c, 0);
    return same;
  }
  let result = same;
  if (name === "eval") {
    if (args.some((w) => w.dynamic)) ask(c, real(D), "`eval` mit nicht statischem Text.", true);
    else {
      const r = evalString(args.map((w) => w.text).join(" "), D, c);
      result = { S: r, F: r }; // eval läuft in der aktuellen Shell
    }
  } else if (SHELLS.has(name)) shellCall(args, cmd, opts, hereString, D, c);
  else if (name === "find") findCall(words.slice(pe.i), D, c);
  else if (!isTextCommand(name, words)) {
    // Unbekannter Wrapper (`su -c`, `watch`): das erste git-Wort als Aufruf nehmen.
    const gi = words.findIndex((w, i) => i > pe.i && !w.dynamic && GIT_RE.test(w.text));
    if (gi >= 0) {
      gitCall(words, gi, pe, D, c, 0);
      return same;
    }
  }
  // Sicherheitsnetz: trifft der Worttext die grobe Regel, gilt jedes verfolgte Verzeichnis als Ziel.
  if (name !== "find" && !isTextCommand(name, words) && coarseProtected(words.map((w) => w.text).join(" "))) for (const d of real(D)) c.targets.add(d);
  return result;
}

/** Wertet einen Shell-Text (Interpreter-Argument, Heredoc, Alias) rekursiv aus; liefert die Endmenge. */
function evalString(text, D, c) {
  const grob = () => {
    if (coarseProtected(text)) for (const d of real(D)) c.targets.add(d);
    return D;
  };
  if (c.depth >= MAX_INTERPRETER) return grob();
  const p = parseBash(text);
  if (!p.ok) return grob();
  c.depth++;
  try {
    return evalList(p.ast, D, c);
  } finally {
    c.depth--;
  }
}

/** Statischer Text, den ein Kommando auf stdout schreibt (echo/printf/cat <<EOF); sonst null. */
function staticOutput(node) {
  if (!node || node.type !== "simple" || node.substs.length) return null;
  const words = stripRedirs(node.words);
  if (!words.length || words.some((w) => w.dynamic)) return null;
  const name = baseName(words[0].text);
  const args = words.slice(1).map((w) => w.text);
  if (name === "echo") return args.filter((a, i) => !(/^-[neE]+$/.test(a) && args.slice(0, i).every((b) => /^-[neE]+$/.test(b)))).join(" ");
  if (name === "printf") {
    const [fmt = "", ...vals] = args;
    let n = 0;
    const out = fmt.replace(/%[sb]/g, () => vals[n++] ?? "").replace(/\\n/g, "\n");
    return [out, ...vals.slice(n)].join(" ");
  }
  if (name === "cat" && !args.length && node.heredocs.length) {
    const h = node.heredocs.at(-1);
    return h.static ? h.body : null;
  }
  return null;
}

/** `bash|sh|… -c <text>`, `bash <<EOF`, `echo … | sh`, `bash <<< text`. */
function shellCall(args, cmd, opts, hereString, D, c) {
  let script = null;
  let sawC = false;
  let operand = false;
  let stdinFlag = false;
  for (let i = 0; i < args.length; i++) {
    const w = args[i];
    const t = w.text;
    if (w.dynamic) {
      operand = true;
      break;
    }
    if (/^-[A-Za-z]+$/.test(t) && t.includes("c")) {
      sawC = true;
      script = args[i + 1] ?? null;
      break;
    }
    if (["-o", "+o", "-O", "+O", "--rcfile", "--init-file"].includes(t)) i++;
    else if (t === "-" || t === "-s") stdinFlag = true;
    else if (!t.startsWith("-") && !t.startsWith("+")) {
      operand = true;
      break;
    }
  }
  if (sawC) {
    if (!script) return;
    if (script.dynamic) ask(c, real(D), "Interpreter mit nicht statischem Text (`bash -c \"$X\"`).", true);
    else evalString(script.text, D, c);
    return;
  }
  if (operand && !stdinFlag) return; // `bash skript.sh`: Dateiinhalt ist nicht auswertbar
  let text;
  if (cmd.heredocs.length) text = cmd.heredocs.at(-1).static ? cmd.heredocs.at(-1).body : null;
  else if (hereString) text = hereString.dynamic ? null : hereString.text;
  else if (opts.pipeSrc) text = staticOutput(opts.pipeSrc);
  if (text === undefined) return; // keine Eingabe (interaktive Shell)
  if (text === null) ask(c, real(D), "Interpreter mit nicht statischer Eingabe (Heredoc/Pipe).", true);
  else evalString(text, D, c);
}

/** `find … -exec CMD … ;|+`: jedes innere Kommando einzeln bewerten. */
function findCall(words, D, c) {
  for (let i = 0; i < words.length; i++) {
    if (!EXEC_FLAGS.has(words[i].text)) continue;
    let j = i + 1;
    while (j < words.length && !(words[j].text === ";" || words[j].text === "+")) j++;
    evalSimple({ type: "simple", words: words.slice(i + 1, j), substs: [], heredocs: [] }, D, c, {});
    i = j;
  }
}

// ── git ─────────────────────────────────────────────────────────────────────
function parseGitArgs(words, k) {
  const g = { cWords: [], gitDirs: [], workTrees: [], aliases: new Map(), sub: null, subIdx: words.length };
  let j = k + 1;
  const value = (list, i) => list.push(words[i + 1] ?? { text: "", dynamic: true });
  while (j < words.length) {
    const w = words[j];
    const t = w.text;
    let m;
    if (w.dynamic && !t.startsWith("-")) break;
    if (t === "-C") {
      value(g.cWords, j);
      j += 2;
    } else if (t === "-c") {
      const cfg = words[j + 1];
      const a = cfg && !cfg.dynamic ? /^alias\.([^=]+)=(.*)$/s.exec(cfg.text) : null;
      const wt = cfg && !cfg.dynamic ? /^core\.worktree=(.*)$/is.exec(cfg.text) : null;
      if (a) g.aliases.set(a[1], a[2]);
      if (wt) g.workTrees.push({ text: wt[1], dynamic: false });
      j += 2;
    } else if (t === "--git-dir" || t === "--work-tree") {
      value(t === "--git-dir" ? g.gitDirs : g.workTrees, j);
      j += 2;
    } else if ((m = /^--(git-dir|work-tree)=(.*)$/s.exec(t))) {
      (m[1] === "git-dir" ? g.gitDirs : g.workTrees).push({ text: m[2], dynamic: w.dynamic });
      j++;
    } else if (["--namespace", "--config-env", "--attr-source", "--super-prefix"].includes(t)) j += 2;
    else if (t.startsWith("-")) j++;
    else break;
  }
  g.subIdx = j;
  g.sub = words[j] ?? null;
  return g;
}

/** Alias aus der git-Konfiguration (`git config --get alias.<n>`), gecacht; null ohne Alias. */
function configAlias(c, sub, D) {
  const base = real(D)[0] ?? c.cwd;
  const key = `${base}\0${sub}`;
  if (c.aliasCache.has(key)) return c.aliasCache.get(key);
  let v;
  try {
    const out = (c.deps.execFileSync ?? execFileSync)("git", ["config", "--get", `alias.${sub}`], { cwd: base, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    v = String(out).trim() || null;
  } catch {
    v = null;
  }
  c.aliasCache.set(key, v);
  return v;
}

/** Verzeichnisse, in denen dieser git-Aufruf liefe; vermerkt Rückfragen bei unbestimmbarem Ziel. */
function gitTargetDirs(g, pe, D, c) {
  const out = new Set();
  let unresolved = false;
  if (D.has(UNKNOWN)) {
    unresolved = true;
    out.add(c.cwd);
  }
  const envOf = (n, global) => [...pe.env.filter((e) => e.name === n).map((e) => e.word), ...(global ? [global] : [])].filter((w) => w.dynamic || w.text !== "");
  const gitDirs = [...g.gitDirs, ...envOf("GIT_DIR", c.gitEnv.gitDir)];
  const workTrees = [...g.workTrees, ...envOf("GIT_WORK_TREE", c.gitEnv.workTree)];
  for (const b0 of real(D)) {
    let b = b0;
    for (const ch of pe.chdirs) {
      const t = ch.dynamic ? null : tildeOf(c, ch.text);
      if (t === null) {
        unresolved = true;
        out.add(b);
      } else b = abs(c, b, t);
    }
    let cur = b;
    for (const w of g.cWords) {
      const t = w.dynamic || /[{}*?]/.test(w.text) ? null : tildeOf(c, w.text);
      if (t === null) {
        unresolved = true;
        out.add(cur);
        out.add(c.cwd);
        continue;
      }
      const n = abs(c, cur, t);
      if (t !== w.text || !isDir(c, n)) {
        out.add(cur); // `~` oder nicht existierendes Ziel: zusätzlich Ausgangsort und Session-cwd
        out.add(c.cwd);
      }
      cur = n;
    }
    out.add(cur);
    const extra = (w, isGitDir) => {
      const t = w.dynamic ? null : tildeOf(c, w.text);
      if (t === null) {
        unresolved = true;
        out.add(b);
        out.add(c.cwd);
        return;
      }
      const v = abs(c, b, t);
      out.add(isGitDir && /[\\/]\.git$/.test(v) ? c.P.dirname(v) : v);
      out.add(b);
      out.add(c.cwd);
    };
    for (const w of gitDirs) extra(w, true);
    for (const w of workTrees) extra(w, false);
  }
  if (unresolved) ask(c, [...out], "Das Ziel des git-Aufrufs ist nicht statisch bestimmbar (`cd \"$X\"`, `-C \"$D\"`, `cd -`, `--git-dir=$X`).");
  return out;
}

const REBASE_EXEC = (rest) => {
  const cmds = [];
  for (let i = 0; i < rest.length; i++) {
    const t = rest[i].text;
    if (t === "-x" || t === "--exec") cmds.push(rest[++i] ?? { text: "", dynamic: true });
    else if (t.startsWith("--exec=")) cmds.push({ text: t.slice(7), dynamic: rest[i].dynamic });
    else if (/^-x./.test(t)) cmds.push({ text: t.slice(2), dynamic: rest[i].dynamic });
  }
  return cmds;
};

function gitCall(words, k, pe, D, c, depth) {
  const g = parseGitArgs(words, k);
  if (!g.sub) return;
  if (g.sub.dynamic) {
    ask(c, real(D), "Der git-Unterbefehl ist dynamisch (`git \"$SUB\"`).", true);
    return;
  }
  const sub = g.sub.text;
  const rest = words.slice(g.subIdx + 1);
  if (sub === "config") {
    // `git config [--global] alias.p push`: der Alias gilt für folgende git-Aufrufe im selben Befehl
    const k2 = rest.findIndex((w) => !w.dynamic && /^alias\.[^=\s]+$/.test(w.text));
    if (k2 >= 0) c.cfgAliases.set(rest[k2].text.slice(6).toLowerCase(), rest[k2 + 1] && !rest[k2 + 1].dynamic ? rest[k2 + 1].text : null);
    return;
  }
  if (!PROTECTED_SUBS.has(sub) && (g.aliases.has(sub) || !KNOWN_SUBS.has(sub)) && sub !== "") {
    const cfgName = sub.toLowerCase(); // git-Konfigurationsnamen sind nicht case-sensitiv
    if (c.cfgAliases.get(cfgName) === null) ask(c, real(D), `Der git-Alias \`${sub}\` ist nicht statisch auflösbar.`, true);
    const al = g.aliases.has(sub) ? g.aliases.get(sub) : (c.cfgAliases.get(cfgName) ?? configAlias(c, sub, D));
    if (al && depth < 3) {
      if (al.startsWith("!")) {
        evalString(`${al.slice(1)} ${rest.map((w) => w.text).join(" ")}`, gitTargetDirs(g, pe, D, c), c);
        return;
      }
      const aw = al.trim().split(/\s+/).map((text) => ({ text, dynamic: false, quoted: false }));
      gitCall([...words.slice(0, g.subIdx), ...aw, ...rest], k, pe, D, c, depth + 1);
      return;
    }
  }
  if (PROTECTED_SUBS.has(sub) || (sub === "subtree" && rest[0]?.text === "push")) {
    for (const d of gitTargetDirs(g, pe, D, c)) c.targets.add(d);
    return;
  }
  const inner = sub === "submodule" && rest.some((w) => w.text === "foreach") ? [{ text: rest.slice(rest.findIndex((w) => w.text === "foreach") + 1).filter((w) => !w.text.startsWith("-")).map((w) => w.text).join(" "), dynamic: rest.some((w) => w.dynamic) }] : sub === "rebase" ? REBASE_EXEC(rest) : [];
  if (!inner.length) return;
  const dirs = gitTargetDirs(g, pe, D, c);
  for (const w of inner) {
    if (w.dynamic) ask(c, [...dirs], "Unterkommando von `git submodule foreach`/`git rebase -x` ist nicht statisch.", true);
    else evalString(w.text, dirs, c);
  }
}

// ── Einstieg ────────────────────────────────────────────────────────────────
/** Zerlegt und wertet `command` aus: `{ targets: string[], asks: Map<dir, {reason, mainOnly}> }`. */
export function analyse(command, cwd, deps = {}) {
  const c = makeCtx(cwd, deps);
  if (!command) return { targets: [], asks: c.asks };
  const parsed = parseBash(command);
  if (!parsed.ok) return { targets: coarseProtected(command) ? [cwd] : [], asks: c.asks };
  evalList(parsed.ast, new Set([c.cwd]), c);
  return { targets: [...c.targets], asks: c.asks };
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
  const P = platform === process.platform ? path : platform === "win32" ? path.win32 : path.posix;
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

// ── CLI (Direktaufruf; der Dispatcher ruft `decide` selbst) ─────────────────
function main() {
  const { cwd, command } = parseHookInput(readStdin());
  emit(mergeDecisions([decide({ cwd, command, repoRoot: repoRootFromScriptUrl(import.meta.url) })]));
}

if (istDirektaufruf(import.meta.url)) main();

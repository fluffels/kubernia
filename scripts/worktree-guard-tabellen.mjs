// Kein Shebang: Baustein des Worktree-Guards (scripts/worktree-guard-hook.mjs), wird von dessen Modulen und Tests importiert.
/**
 * Tabellen, Kontext und Wort-Helfer des Worktree-Guards (#1311): Wrapper-Tabelle, bekannte git-Unterbefehle, der
 * Auswertungs-Kontext `makeCtx`, Pfad-Helfer und `peel` (Zuweisungen und Wrapper vor dem eigentlichen Kommando).
 * Pur und ohne Abhängigkeit von den Auswerter-Modulen (kein Import-Zyklus): `worktree-guard-git.mjs` und
 * `worktree-guard-eval.mjs` bauen darauf auf.
 *
 * Reines Node-Skript (nur Builtins).
 */
import { statSync } from "node:fs";
import { homedir as osHomedir } from "node:os";
import path from "node:path";
import { SHELLS, baseName } from "./shell-tabellen.mjs";

export { SHELLS, baseName };

/** Grobe Wortregel (Rückfall, wenn der Parser nicht zerlegen kann oder ein Interpreter den eigentlichen
 *  Befehl verbirgt): ein Segment (Split auf `&&`/`||`/`;`/Zeilenumbruch) mit "git" UND "commit"/"push" als Wort. */
export function coarseProtected(command) {
  const segments = String(command).split(/&&|\|\||;|\n/);
  return segments.some((seg) => /\bgit\b/.test(seg) && /\b(commit|push)\b/.test(seg));
}

export const GIT_RE = /^(?:.*[\\/])?git(?:\.exe)?$/i;
export const ASSIGN_RE = /^[A-Za-z_]\w*=/;
export const PROTECTED_SUBS = new Set(["commit", "push"]);
/** Reine Text-Kommandos: ein Wortpaar "git commit/push" darin ist kein Aufruf. */
export const TEXT_COMMANDS = new Set(["gh", "echo", "printf", "cat", "grep", "egrep", "fgrep", "rg"]);
export const CD_LIKE = new Set(["cd", "pushd", "popd"]);
/** Wrapper, hinter denen ein `cd` weiterhin die aktuelle Shell wechselt. */
export const CD_WRAPPERS = new Set(["builtin", "command", "time"]);
export const EXEC_FLAGS = new Set(["-exec", "-execdir", "-ok", "-okdir"]);
export const EXPORTERS = new Set(["export", "declare", "typeset", "readonly", "local"]);
/** Unbekanntes Verzeichnis (dynamisches `cd`): fragt bei einem folgenden geschützten git-Aufruf nach. */
export const UNKNOWN = "\0unbekannt";

/** Wrapper-Tabelle: Optionen mit Wert (`val`), Optionen mit Ortswechsel (`chdir`), Positionsargumente (`pos`),
 *  `assign`: NAME=WERT-Argumente, `lookup`: Optionen, die nur nachschlagen (`command -v`). */
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

/** Namen der Wrapper (Schlüssel der Wrapper-Tabelle). */
export const WRAPPER_NAMEN = new Set(Object.keys(WRAPPERS));

/** Eingebaute git-Unterbefehle (Rest: möglicher Alias, wird per `git config` aufgelöst). */
export const KNOWN_SUBS = new Set(
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

/** Pfad-Modul passend zur (ggf. injizierten) Plattform. */
export const pathFor = (platform) => (platform === process.platform ? path : platform === "win32" ? path.win32 : path.posix);

/** Auswertungs-Zustand eines `analyse`-Laufs. `evalString` setzt `worktree-guard-eval.mjs` (vermeidet einen Import-Zyklus). */
export function makeCtx(cwd, deps) {
  const platform = deps.platform ?? process.platform;
  const P = pathFor(platform);
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
    cAliases: new Map(), // `-c alias.x=…` der äußeren `!`-Aliase (gelten nur für den inneren Lauf)
    cfgAliases: new Map(), // `git config alias.X …` im selben Befehl (Schlüssel klein geschrieben)
    evalString: () => {
      throw new Error("evalString nicht gesetzt");
    },
  };
}

export const real = (D) => [...D].filter((d) => d !== UNKNOWN);
export const union = (...sets) => new Set(sets.flatMap((s) => [...s]));
export const abs = (c, base, p) => c.P.resolve(base, fromMsysPath(p, c.platform));

export function isDir(c, p) {
  try {
    return c.stat(p).isDirectory();
  } catch {
    return false;
  }
}

/** `~`/`~/x` per `os.homedir()` auflösen; `~user` u.ä. → null (nicht auflösbar); sonst unverändert. */
export function tildeOf(c, text) {
  if (text === "~") return c.home();
  if (/^~[\\/]/.test(text)) return c.P.join(c.home(), text.slice(2));
  return text.startsWith("~") ? null : text;
}

/** Rückfrage vormerken: für die Verzeichnisse `dirs` (und das Session-`cwd`). `mainOnly`: nur, wenn dort der Haupt-
 *  Checkout liegt (unbekannter Inhalt); sonst bei jedem Verzeichnis dieses Repos (unbekanntes Ziel). */
export function ask(c, dirs, reason, mainOnly = false) {
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
export function stripRedirs(words) {
  const out = [];
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (!w.quoted && REDIR_ONLY.test(w.text)) i++;
    else if (!w.quoted && REDIR_ATTACHED.test(w.text)) continue;
    else out.push(w);
  }
  return out;
}

export const hereStringOf = (words) => {
  const i = words.findIndex((w) => !w.quoted && w.text === "<<<");
  return i >= 0 ? (words[i + 1] ?? null) : null;
};


export const isTextCommand = (name, words) => TEXT_COMMANDS.has(name) && !(name === "rg" && words.some((w) => w.text === "--pre" || w.text.startsWith("--pre=")));

// ── Wrapper überspringen ────────────────────────────────────────────────────
function merkeZuweisung(res, w) {
  const eq = w.text.indexOf("=");
  res.env.push({ name: w.text.slice(0, eq), word: { text: w.text.slice(eq + 1), dynamic: w.dynamic } });
}

/** Eine Option eines Wrappers an Index `i`; liefert den nächsten Index oder -1 (Abfrage-Modus, z.B. `command -v`). */
function wrapperFlag(spec, words, i, res) {
  const a = words[i];
  const t = a.text;
  const eq = t.startsWith("--") ? t.indexOf("=") : -1;
  const opt = eq > 0 ? t.slice(0, eq) : t;
  if (spec.lookup.has(opt)) return -1;
  if (spec.chdir.has(opt)) res.chdirs.push(eq > 0 ? { text: t.slice(eq + 1), dynamic: a.dynamic } : (words[i + 1] ?? { text: "", dynamic: true }));
  return i + (spec.val.has(opt) && eq < 0 ? 2 : 1);
}

/** Optionen und Positionsargumente eines Wrappers ab `start`; liefert den Index des nächsten Wortes oder -1. */
function wrapperOptionen(spec, words, start, res) {
  let i = start;
  let pos = spec.pos;
  while (i < words.length) {
    const a = words[i];
    if (spec.assign && ASSIGN_RE.test(a.text)) {
      merkeZuweisung(res, a);
      i++;
    } else if (!a.dynamic && a.text === "--") return i + 1;
    else if (!a.dynamic && a.text.startsWith("-") && a.text.length > 1) {
      i = wrapperFlag(spec, words, i, res);
      if (i < 0) return -1;
    } else if (pos > 0) {
      pos--;
      i++;
    } else return i;
  }
  return i;
}

/** Überspringt Zuweisungen und Wrapper (mit ihren Optionen) vor dem eigentlichen Kommando.
 *  `i`: Index des Kommandowortes (-1: keines, nur Zuweisungen), `name`: dessen Basisname, `wrappers`, `chdirs`
 *  (Ortswechsel-Optionen von `env -C`/`sudo -D`), `env`: NAME=WERT-Zuweisungen davor. */
export function peel(words) {
  const res = { i: -1, name: null, wrappers: [], chdirs: [], env: [], dynamicCmd: false, noop: false };
  let i = 0;
  for (let round = 0; round <= words.length; round++) { // jede Runde verbraucht mindestens ein Wort
    while (i < words.length && ASSIGN_RE.test(words[i].text)) merkeZuweisung(res, words[i++]);
    if (i >= words.length) return res;
    const w = words[i];
    if (w.dynamic) return { ...res, i, dynamicCmd: true };
    const name = baseName(w.text);
    const spec = WRAPPERS[name];
    if (!spec) return { ...res, i, name };
    res.wrappers.push(name);
    i = wrapperOptionen(spec, words, i + 1, res);
    if (i < 0) return { ...res, noop: true };
  }
  return res;
}

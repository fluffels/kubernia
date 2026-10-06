// Kein Shebang: wird über `.claude/settings.json` per `node scripts/worktree-guard-hook.mjs`
// gestartet UND von test/harness/worktree-guard.test.ts importiert (ein `#!` bricht den
// Test-Import, analog zu check-diffsize.mjs).
/**
 * Worktree-Guard-Hook (#735) — Claude-Code-`PreToolUse`-Hook für `Bash`.
 *
 * Hintergrund: AGENTS.md verlangt "IMMER im eigenen `git worktree` arbeiten, nie im
 * main-Checkout committen/pushen" — bisher nur eine BITTE an den Agenten. Real
 * vorgekommen: eine parallele Sitzung committete 2026-07-07 eigenständig
 * uncommittete Änderungen im geteilten main-Checkout, weil zwei Sessions denselben
 * Checkout nutzten (siehe #735). Dieser Hook macht daraus eine kleine, technische
 * Mauer: `git commit`/`git push`, dessen cwd der GETEILTE Haupt-Checkout dieses
 * Repos ist (nicht ein Linked Worktree), wird über `PreToolUse` geblockt.
 *
 * Bewusste Grenzen (siehe #735-Diskussion + docs/agent-harness-faq.md „Warum prüft
 * die Mauer erst im PR-Gate"):
 *  - Ersetzt NICHT den PR-Gate (#592) — der bleibt die eigentliche Durchsetzung für
 *    Code-Qualität. Dieser Hook fängt nur die EINE irreversible Fehlaktion
 *    "Commit/Push vom falschen Ort", analog zum dokumentierten "block rm -rf"-Muster.
 *  - Erkennt den Haupt- vs. Linked-Worktree-Unterschied über gits eigene Konvention:
 *    am Toplevel eines Linked Worktree ist `.git` eine DATEI ("gitdir: …"), im
 *    Haupt-Checkout ein VERZEICHNIS — robuster als eine Pfad-Namenskonvention wie
 *    ".claude/worktrees/*" zu erraten.
 *  - Scoped auf DIESES Repo: `git-common-dir` des cwd wird gegen das eigene `.git`
 *    verglichen (aus dem Skript-Pfad abgeleitet) — ein Bash-Aufruf gegen ein
 *    komplett anderes Repo im selben Claude-Code-Workspace wird nie angefasst.
 *  - Kommando-Erkennung über einen kleinen Shell-Lexer (`lexShell`): Text in Quotes,
 *    Heredocs und Kommentaren ist kein Kommando. Ziel ist das Verzeichnis, in dem
 *    git liefe: Session-`cwd`, ein vorangestelltes `cd <pfad> &&` (nur existierender
 *    Ordner, nicht in Pipeline/bei `&`, Subshells isoliert) und `git -C <pfad>`.
 *  - Rückfall auf die alte grobe Regel (Wortsuche "git" + "commit"/"push") gegen das Session-
 *    `cwd`, wenn der Lexer nicht zerlegen kann, und je Kommando als Sicherheitsnetz, wenn
 *    dessen Worttext sie trifft (`bash -c "git push"`, `timeout 5 …`); ausgenommen reine
 *    Text-Kommandos (gh, echo, printf, cat, git). Ziel ist, keine Fälle durchzulassen, die
 *    die alte Regel blockte; Restlücken: siehe unten.
 *  - Nicht erkannt: Aliase/Shell-Funktionen, `env -C`; `pushd`/`popd` und ein nicht
 *    verfolgbares `cd` setzen auf das Session-`cwd` zurück; `--git-dir`/`GIT_DIR` prüfen
 *    zusätzlich das Session-`cwd`; das PowerShell-Tool deckt der Hook nicht ab.
 *  - Fail-open bei Unsicherheit (kein cwd im Payload, cwd ist gar kein Git-Repo,
 *    cwd gehört zu einem anderen Repo): NICHT blocken — dieselbe "kein falsches
 *    Rot"-Philosophie wie check-diffsize.mjs bei fehlender Vergleichsbasis.
 *  - Verteilung: `.claude/settings.json` ist bewusst NICHT gitignored (Ausnahme wie
 *    `.claude/skills/`) — als getrackte Datei liegt sie automatisch in jedem
 *    frischen Checkout/Worktree, ohne eigenen `npm run setup`-Verteilschritt.
 *  - Offen/nicht abschließend verifiziert: ob Claude Code `.claude/settings.json`
 *    zuverlässig auflöst, wenn die Session-Root ein ELTERN-Verzeichnis dieses Repos
 *    ist (verschachtelter Checkout), war zum Zeitpunkt der Umsetzung nicht
 *    empirisch prüfbar (siehe PR-Beschreibung zu #735) — einmal in echter Session
 *    gegenprüfen.
 *
 * Reines Node-Skript (nur Builtins). Die Entscheidungslogik ist pure/exportiert
 * und testbar (execFile/stat injizierbar) — EINE Quelle für Hook-CLI und Test.
 */

import { execFileSync } from "node:child_process";
import { statSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/** Normalisiert einen Pfad für den Vergleich: Backslashes -> Slashes, unter
 *  Windows zusätzlich klein geschrieben (case-insensitives Dateisystem); Linux
 *  bleibt case-sensitive. */
function normalizePath(p) {
  const slashed = String(p).replace(/\\/g, "/").replace(/\/+$/, "");
  return process.platform === "win32" ? slashed.toLowerCase() : slashed;
}

/** Alte, grobe Regel (Rückfall, wenn der Lexer nicht zerlegen kann oder ein
 *  Interpreter den eigentlichen Befehl verbirgt): ein Segment (Split auf
 *  `&&`/`||`/`;`/Zeilenumbruch) mit "git" UND "commit"/"push" als Wort. */
function coarseProtected(command) {
  const segments = String(command).split(/&&|\|\||;|\n/);
  return segments.some((seg) => /\bgit\b/.test(seg) && /\b(commit|push)\b/.test(seg));
}

// ── Minimaler Shell-Lexer ───────────────────────────────────────────────────
// Zerlegt einen Bash-Befehl in Kommandos aus Wörtern. Versteht Quotes, Escapes,
// Kommentare, Heredocs und Substitutionen; Text darin ist KEIN Kommando.

class LexError extends Error {}

const boundary = (kind) => ({ words: [], sep: "", boundary: kind });

function lexer(src) {
  let pos = 0;
  const pending = []; // wartende Heredocs { delim, strip, quoted }
  const fail = () => {
    throw new LexError("nicht zerlegbar");
  };

  /** pos steht hinter `(`: Liste bis `)` lesen, als `(`…`)`-Grenzen einreihen. */
  function subst(out) {
    out.push(boundary("("));
    parseList(out, true);
    out.push(boundary(")"));
  }

  /** pos steht hinter dem öffnenden Backtick. */
  function backtick(out) {
    let end = pos;
    while (end < src.length && src[end] !== "`") end += src[end] === "\\" ? 2 : 1;
    if (end >= src.length) fail();
    const inner = src.slice(pos, end).replace(/\\([`\\$])/g, "$1");
    pos = end + 1;
    out.push(boundary("("), ...lexer(inner).run(), boundary(")"));
  }

  /** pos steht hinter dem öffnenden `"`. */
  function readDouble(out, w) {
    for (;;) {
      if (pos >= src.length) fail();
      const ch = src[pos];
      if (ch === '"') {
        pos++;
        return;
      }
      if (ch === "\\") {
        const n = src[pos + 1];
        if (n !== undefined && '$`"\\\n'.includes(n)) {
          if (n !== "\n") w.text += n;
          pos += 2;
        } else {
          w.text += "\\";
          pos++;
        }
        continue;
      }
      if (ch === "$" || ch === "`") {
        w.dynamic = true;
        if (ch === "`") {
          pos++;
          backtick(out);
        } else if (src[pos + 1] === "(") {
          pos += 2;
          subst(out);
        } else pos++;
        continue;
      }
      w.text += ch;
      pos++;
    }
  }

  /** `<<[-]DELIM`: pos steht hinter `<<`. Das Delimiter-Wort wird vorgemerkt. */
  function heredocStart() {
    const strip = src[pos] === "-";
    if (strip) pos++;
    while (src[pos] === " " || src[pos] === "\t") pos++;
    let delim = "";
    let quoted = false;
    while (pos < src.length && !/[\s;|&()<>]/.test(src[pos])) {
      const ch = src[pos];
      if (ch === "'" || ch === '"') {
        const end = src.indexOf(ch, pos + 1);
        if (end < 0) fail();
        delim += src.slice(pos + 1, end);
        quoted = true;
        pos = end + 1;
      } else if (ch === "\\") {
        delim += src[pos + 1] ?? "";
        quoted = true;
        pos += 2;
      } else {
        delim += ch;
        pos++;
      }
    }
    if (!delim) fail();
    pending.push({ delim, strip, quoted });
  }

  /** Nach einem Zeilenumbruch: die Bodies der vorgemerkten Heredocs lesen. */
  function readHeredocs(out) {
    while (pending.length) {
      const { delim, strip, quoted } = pending.shift();
      let body = "";
      for (;;) {
        if (pos >= src.length) fail();
        const end = src.indexOf("\n", pos);
        const line = src.slice(pos, end < 0 ? src.length : end).replace(/\r$/, "");
        pos = end < 0 ? src.length : end + 1;
        if ((strip ? line.replace(/^\t+/, "") : line) === delim) break;
        if (end < 0) fail();
        body += line + "\n";
      }
      // Quotierter Delimiter: Body wörtlich. Sonst nur Substitutionen darin auswerten.
      if (!quoted) {
        const inner = lexer(body).scanBody();
        if (inner.length) out.push(boundary("("), ...inner, boundary(")"));
      }
    }
  }

  function parseList(out, nested) {
    let words = [];
    let w = null;
    const ensure = () => (w ??= { text: "", dynamic: false });
    const endWord = () => {
      if (w) words.push(w);
      w = null;
    };
    const endCmd = (sep) => {
      endWord();
      if (words.length) out.push({ words, sep });
      words = [];
    };
    while (pos < src.length) {
      const ch = src[pos];
      const next = src[pos + 1];
      if (ch === " " || ch === "\t" || ch === "\r") {
        endWord();
        pos++;
      } else if (ch === "\n") {
        endCmd("\n");
        pos++;
        readHeredocs(out);
      } else if (ch === "#" && !w) {
        while (pos < src.length && src[pos] !== "\n") pos++;
      } else if (ch === ";") {
        endCmd(";");
        pos++;
      } else if (ch === "|" && !(w && w.text.endsWith(">"))) {
        const sep = next === "|" ? "||" : "|";
        endCmd(sep);
        pos += next === "|" || next === "&" ? 2 : 1;
      } else if (ch === "&" && next === "&") {
        endCmd("&&");
        pos += 2;
      } else if (ch === "&" && !((w && /[<>]$/.test(w.text)) || next === ">")) {
        endCmd("&");
        pos++;
      } else if (ch === "(" && w && /[<>]$/.test(w.text)) {
        w.text = w.text.slice(0, -1); // <(…) / >(…): Prozess-Substitution
        w.dynamic = true;
        pos++;
        subst(out);
      } else if (ch === "(") {
        if (w) fail(); // z.B. Funktionsdefinition: nicht zerlegbar
        pos++;
        subst(out);
      } else if (ch === ")") {
        if (!nested) fail();
        endCmd("");
        pos++;
        return;
      } else if (ch === "<" && next === "<" && src[pos + 2] !== "<") {
        pos += 2;
        heredocStart();
      } else if (ch === "'") {
        const end = src.indexOf("'", pos + 1);
        if (end < 0) fail();
        ensure().text += src.slice(pos + 1, end);
        pos = end + 1;
      } else if (ch === '"') {
        pos++;
        readDouble(out, ensure());
      } else if (ch === "\\") {
        if (next === "\n") pos += 2; // Zeilenfortsetzung
        else {
          if (next !== undefined) ensure().text += next;
          pos += 2;
        }
      } else if (ch === "`") {
        pos++;
        ensure().dynamic = true;
        backtick(out);
      } else if (ch === "$") {
        ensure().dynamic = true;
        if (next === "(") {
          pos += 2;
          subst(out);
        } else pos++;
      } else {
        ensure().text += ch;
        pos++;
      }
    }
    if (nested || pending.length) fail();
    endCmd("");
  }

  /** Heredoc-Body (unquotierter Delimiter): nur `$(…)` und Backticks sind aktiv. */
  function scanBody() {
    const out = [];
    while (pos < src.length) {
      const ch = src[pos];
      if (ch === "\\") pos += 2;
      else if (ch === "$" && src[pos + 1] === "(") {
        pos += 2;
        subst(out);
      } else if (ch === "`") {
        pos++;
        backtick(out);
      } else pos++;
    }
    return out;
  }

  function run() {
    const out = [];
    parseList(out, false);
    return out;
  }

  return { run, scanBody };
}

/** Zerlegt `command` in Kommandos `{ words: {text, dynamic}[], sep }` (`sep`: Trenner
 *  danach). Substitutionen/Subshells stehen als Einträge `{ boundary: "(" | ")" }`
 *  vor/nach dem umschließenden Kommando. Nicht zerlegbar → `{ ok: false }`. */
export function lexShell(command) {
  try {
    return { ok: true, cmds: lexer(String(command)).run() };
  } catch (e) {
    if (e instanceof LexError) return { ok: false };
    throw e;
  }
}

// ── git-Aufruf erkennen ─────────────────────────────────────────────────────
const GIT_RE = /^(?:.*[\\/])?git(?:\.exe)?$/i;
const FIND_RE = /^(?:.*[\\/])?find(?:\.exe)?$/i;
const PREFIX_WORDS = new Set(["then", "do", "else", "elif", "if", "while", "until", "{", "!", "time", "command", "exec", "env", "nohup", "sudo", "xargs", "nice"]);
const EXEC_FLAGS = new Set(["-exec", "-execdir", "-ok", "-okdir"]);

/** Index des Wortes, das den eigentlichen Befehl nennt (hinter Schlüsselwörtern,
 *  Zuweisungen und Wrappern wie `env`/`xargs`/`find -exec`); -1 wenn keiner. */
function commandIndex(words) {
  if (words.length && FIND_RE.test(words[0].text)) {
    const k = words.findIndex((w) => EXEC_FLAGS.has(w.text));
    return k < 0 ? -1 : k + 1;
  }
  let i = 0;
  let wrapped = false;
  while (i < words.length) {
    const t = words[i].text;
    const prefix = !words[i].dynamic && PREFIX_WORDS.has(t);
    if (prefix) wrapped = true;
    if (prefix || /^[A-Za-z_]\w*=/.test(t) || (wrapped && t.startsWith("-"))) i++;
    else break;
  }
  return i < words.length ? i : -1;
}

/** `null` ohne git-Aufruf, sonst `{ sub, cDirs, unsure }` (Unterbefehl, `-C`-Wörter,
 *  `--git-dir`/`--work-tree` gesetzt). */
export function gitInvocation(words) {
  let i = commandIndex(words);
  if (i < 0 || words[i].dynamic || !GIT_RE.test(words[i].text)) {
    // Unbekannter Wrapper (`timeout 60 git push`, `xargs -n 1 git …`): erstes git-Wort nehmen.
    i = words.findIndex((w) => !w.dynamic && GIT_RE.test(w.text));
    if (i < 0) return null;
  }
  const cDirs = [];
  let unsure = words.slice(0, i).some((w) => /^GIT_(DIR|WORK_TREE)=/.test(w.text));
  let j = i + 1;
  while (j < words.length) {
    const t = words[j].text;
    if (t === "-C" && words[j + 1]) {
      cDirs.push(words[j + 1]);
      j += 2;
    } else if (t === "-c" || t === "--namespace" || t === "--config-env") j += 2;
    else if (t === "--git-dir" || t === "--work-tree") {
      unsure = true;
      j += 2;
    } else if (t.startsWith("--git-dir=") || t.startsWith("--work-tree=")) {
      unsure = true;
      j++;
    } else if (t.startsWith("-")) j++;
    else break;
  }
  const sub = words[j];
  return { sub: sub && !sub.dynamic ? sub.text : null, cDirs, unsure };
}

const PROTECTED_SUBS = new Set(["commit", "push"]);
const isProtectedInvocation = (inv) => inv !== null && PROTECTED_SUBS.has(inv.sub ?? "");

/** True, wenn `command` einen echten `git commit`/`git push` ausführt. Text in
 *  Quotes, Heredoc-Bodies und Kommentaren zählt nicht; Sicherheitsnetz siehe `protectedGitTargets`. */
export function isProtectedGitCommand(command) {
  return protectedGitTargets(command, ".", { statSync: () => ({ isDirectory: () => false }) }).length > 0;
}

/** MSYS-/Git-Bash-Pfad `/c/foo` → `C:/foo` (nur unter Windows). */
export function fromMsysPath(p, platform = process.platform) {
  const m = platform === "win32" ? /^\/([a-zA-Z])(?:\/(.*))?$/.exec(p) : null;
  return m ? `${m[1].toUpperCase()}:/${m[2] ?? ""}` : p;
}

/** Ziel des `cd`-Kommandos (ohne Optionen) oder null, wenn es nicht statisch ist. */
function cdTarget(words) {
  const rest = words.slice(1).filter((w) => w.dynamic || !["-L", "-P", "--", "-e", "-@"].includes(w.text));
  const t = rest[0];
  if (!t || t.dynamic || t.text === "-" || t.text.startsWith("~")) return null;
  return t.text;
}

function isDirectory(path, stat) {
  try {
    return stat(path).isDirectory();
  } catch {
    return false;
  }
}

const OPENERS = new Set(["if", "for", "while", "until", "case", "select", "{"]);
const CLOSERS = new Set(["fi", "done", "esac", "}"]);
/** Reine Text-Kommandos: ein Wortpaar "git commit/push" darin ist kein Aufruf. */
const TEXT_COMMANDS = new Set(["gh", "echo", "printf", "cat", "git"]);

/** Verzeichnisse, in denen `git commit`/`git push` aus `command` liefen (Session-`cwd`,
 *  verfolgtes `cd`, `git -C`); leer ohne solchen Aufruf. Nicht zerlegbar: `[cwd]` bei grobem
 *  Treffer. Sicherheitsnetz je Kommando: trifft der Worttext eines Kommandos (außer reinen
 *  Text-Kommandos) die grobe Regel, etwa `bash -c "git push"` oder `timeout 5 bash -c …`,
 *  gilt das verfolgte Verzeichnis als Ziel. */
export function protectedGitTargets(command, cwd, deps = {}) {
  if (!command) return [];
  const lexed = lexShell(command);
  if (!lexed.ok) return coarseProtected(command) ? [cwd] : [];
  const stat = deps.statSync ?? statSync;
  const targets = new Set();
  const stack = [];
  let cur = cwd;
  let listStart = cwd;
  let pure = true; // in dieser Und-Oder-Liste kam bisher nur `cd` (nur dann gilt ein `cd` sicher)
  let depth = 0; // offene Blöcke (if/for/while/case/{)
  let prevPiped = false;
  for (const c of lexed.cmds) {
    if (c.boundary === "(") {
      stack.push({ cur, listStart, pure });
      listStart = cur;
      continue;
    }
    if (c.boundary === ")") {
      ({ cur, listStart, pure } = stack.pop() ?? { cur, listStart, pure });
      continue;
    }
    const first = c.words[0].dynamic ? "" : c.words[0].text;
    const inv = gitInvocation(c.words);
    if (isProtectedInvocation(inv)) {
      const dirs = inv.cDirs.map((w) => (w.dynamic || /^~|[{}]/.test(w.text) ? null : w.text));
      targets.add(resolve(dirs.reduce((d, w) => (w === null ? d : resolve(d, fromMsysPath(w))), cur)));
      // --git-dir/GIT_DIR oder ein nicht auflösbares -C können woanders hin zeigen: Session-cwd prüfen.
      if (inv.unsure || dirs.includes(null)) targets.add(resolve(cwd));
    } else if (!inv && ["cd", "pushd", "popd"].includes(first) && !prevPiped && c.sep !== "|" && c.sep !== "&") {
      // Ein cd gilt nur am Anfang seiner Liste, außerhalb von Blöcken und mit statischem, existierendem
      // Ziel; alles andere (cd -, ~, pushd/popd, bedingt) setzt zurück auf das Session-cwd.
      const t = first === "cd" && pure && depth === 0 ? cdTarget(c.words) : null;
      const dir = t === null ? null : resolve(cur, fromMsysPath(t));
      cur = dir !== null && isDirectory(dir, stat) ? dir : cwd;
    } else if (!inv && !TEXT_COMMANDS.has(first)) {
      const text = c.words.map((w) => w.text).join(" ");
      if (coarseProtected(text)) targets.add(resolve(cur));
    }
    if (OPENERS.has(first)) depth++;
    else if (CLOSERS.has(first)) depth = Math.max(0, depth - 1);
    pure = pure && first === "cd" && c.sep === "&&";
    prevPiped = c.sep === "|";
    if (c.sep === "&") cur = listStart; // Hintergrund-Liste lief in einer Subshell
    if (c.sep === "&" || c.sep === ";" || c.sep === "\n" || c.sep === "") {
      listStart = cur;
      pure = true;
    }
  }
  return [...targets];
}

/** Ermittelt, ob `cwd` zu DEMSELBEN Repo gehört wie `repoRoot` (Vergleich über
 *  `git-common-dir`, NICHT über `<repoRoot>/.git` als Pfad-Konstruktion — das
 *  Skript liegt selbst in `scripts/`, aber `repoRoot` kann je nach Checkout ein
 *  Linked Worktree sein, dessen `.git` nur eine Datei ist, kein Verzeichnis. Der
 *  `git-common-dir` von `repoRoot` selbst ist deshalb die verlässliche Referenz,
 *  nicht `resolve(repoRoot, ".git")`) und ob es der Haupt-Checkout oder ein
 *  Linked Worktree ist (`.git` als Verzeichnis vs. Datei am Toplevel). Wirft nie —
 *  bei jedem git-/fs-Fehler (kein Repo, Pfad existiert nicht, …) `{ relevant:
 *  false }`. `deps` injizierbar fürs Testen (execFileSync/statSync). */
export function resolveGitContext(cwd, repoRoot, deps = {}) {
  const exec = deps.execFileSync ?? execFileSync;
  const stat = deps.statSync ?? statSync;

  const run = (dir, args) => {
    try {
      return exec("git", args, { cwd: dir, encoding: "utf8" }).trim();
    } catch {
      return null;
    }
  };

  // Referenz: der git-common-dir DIESES Skript-Checkouts (egal ob Haupt-Checkout
  // oder selbst ein Linked Worktree) — zeigt in beiden Fällen korrekt auf das
  // eine geteilte `.git` des Repos.
  const referenceCommonDirRaw = run(repoRoot, ["rev-parse", "--git-common-dir"]);
  if (!referenceCommonDirRaw) return { relevant: false };
  const referenceCommonDir = resolve(repoRoot, referenceCommonDirRaw);

  const toplevel = run(cwd, ["rev-parse", "--show-toplevel"]);
  if (!toplevel) return { relevant: false };

  const commonDirRaw = run(cwd, ["rev-parse", "--git-common-dir"]);
  if (!commonDirRaw) return { relevant: false };
  const commonDir = resolve(toplevel, commonDirRaw);

  if (normalizePath(commonDir) !== normalizePath(referenceCommonDir)) {
    return { relevant: false }; // cwd gehört zu einem anderen Repo — nicht unsere Sache
  }

  let isMainWorktree;
  try {
    isMainWorktree = stat(join(toplevel, ".git")).isDirectory();
  } catch {
    isMainWorktree = true; // .git nicht lesbar -> im Zweifel konservativ blocken
  }

  return { relevant: true, toplevel, isMainWorktree };
}

/** Gesamtentscheidung: block=true nur, wenn (a) das Kommando wirklich commit/push
 *  ist, (b) cwd bekannt ist, (c) mindestens ein Ziel-Verzeichnis (cwd, verfolgtes
 *  `cd`, `git -C`) zu diesem Repo gehört UND (d) dort der Haupt-Checkout liegt
 *  (kein Linked Worktree). Alles andere: durchlassen. */
export function decide({ cwd, command, repoRoot, deps }) {
  if (!cwd) return { block: false }; // kein cwd im Payload -> nicht entscheidbar, fail-open
  let targets;
  try {
    targets = protectedGitTargets(command, cwd, deps);
  } catch {
    targets = coarseProtected(command) ? [cwd] : []; // unerwarteter Lexer-Fehler: alte Regel statt Durchwinken
  }
  for (const target of targets) {
    const ctx = resolveGitContext(target, repoRoot, deps);
    if (!ctx.relevant || !ctx.isMainWorktree) continue;
    return {
      block: true,
      reason:
        `git commit/push würde im geteilten main-Checkout (${ctx.toplevel}) laufen und ist blockiert. ` +
        `Aus einem worktree: \`git -C <worktree> …\` (ändert die Shell-cwd nicht) oder \`cd <worktree> && git …\`, ` +
        `beides wertet der Hook aus. Neuer Worktree (AGENTS.md § Git-Workflow): ` +
        `\`git fetch origin && git worktree add .claude/worktrees/kq-<nr> -b feature/kq-<nr>-<slug> origin/main\` (vom frischen origin/main, #772). (#735)`,
    };
  }
  return { block: false };
}

/** Parst das Hook-stdin-JSON tolerant: liefert bei kaputtem/leerem Input `{}`
 *  statt zu werfen (der Hook soll NIE selbst crashen und damit versehentlich
 *  jeden Bash-Aufruf blockieren). */
export function parseHookInput(text) {
  try {
    const data = JSON.parse(text);
    return { cwd: data.cwd, command: data.tool_input?.command };
  } catch {
    return {};
  }
}

/** Baut die dokumentierte `hookSpecificOutput`-JSON für ein `PreToolUse`-Deny. */
export function buildDenyOutput(reason) {
  return {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: reason,
    },
  };
}

/** Repo-Root aus dem Skript-Pfad ableiten (`scripts/worktree-guard-hook.mjs` liegt
 *  eine Ebene unter dem Root) — portabel, kein hartcodierter absoluter Pfad. */
function repoRootFromScriptUrl(importMetaUrl) {
  return dirname(dirname(fileURLToPath(importMetaUrl)));
}

// ── CLI (vom PreToolUse-Hook aufgerufen) ────────────────────────────────────
function main() {
  let stdinText;
  try {
    stdinText = readFileSync(0, "utf8");
  } catch {
    stdinText = "";
  }

  const { cwd, command } = parseHookInput(stdinText);
  const repoRoot = repoRootFromScriptUrl(import.meta.url);
  const result = decide({ cwd, command, repoRoot });

  if (result.block) {
    console.log(JSON.stringify(buildDenyOutput(result.reason)));
  }
  // Bewusst KEIN process.exit(0) hier: auf Windows kann ein Pipe-stdout asynchron
  // sein, ein sofortiges exit() nach console.log() hat die Ausgabe abgeschnitten
  // (empirisch beobachtet). Natürliches Skript-Ende flusht zuverlässig und
  // beendet mit Exit-Code 0 (Default bei erfolgreichem Durchlauf ohne Fehler).
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();

// Kein Shebang: Baustein des Worktree-Guards (scripts/worktree-guard-hook.mjs), wird von diesem und von Tests importiert.
/**
 * Auswerter des Worktree-Guards (#1311): führt über den AST aus `scripts/bash-parser.mjs` die Menge `D` der
 * Verzeichnisse mit, in denen das nächste Kommando laufen kann. Eine Und-Oder-Kette liefert `{ S, F }`
 * (Verzeichnisse nach Erfolg bzw. Misserfolg des letzten Gliedes): `a && b` wertet b aus S, `a || b` aus F, das
 * Kettenende ist S ∪ F. Ein `cd` auf ein statisches, existierendes Ziel ersetzt die Menge exakt; ein fehlendes Ziel
 * oder zu viele Argumente lassen sie unverändert; ein dynamisches Ziel fügt Session-`cwd` und einen Unbekannt-Marker
 * hinzu. Subshells, Substitutionen, Pipelines und `&`-Listen wirken nicht nach außen; `{ … }` und `eval` schon;
 * if/Schleifen/case vereinigen die Enden aller Zweige. Die git-Aufrufe wertet `worktree-guard-git.mjs` aus.
 *
 * Reines Node-Skript (nur Builtins).
 */
import { parseBash } from "./bash-parser.mjs";
import { MAX_INTERPRETER } from "./hook-io.mjs";
import { gitCall } from "./worktree-guard-git.mjs";
import {
  CD_LIKE,
  CD_WRAPPERS,
  EXEC_FLAGS,
  EXPORTERS,
  GIT_RE,
  PROTECTED_SUBS,
  SHELLS,
  UNKNOWN,
  abs,
  ask,
  coarseProtected,
  fromMsysPath,
  hereStringOf,
  isDir,
  isTextCommand,
  makeCtx,
  peel,
  real,
  stripRedirs,
  tildeOf,
  union,
  ASSIGN_RE,
  baseName,
} from "./worktree-guard-tabellen.mjs";

// ── Listen, Ketten, Pipelines ───────────────────────────────────────────────
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

// ── cd / pushd / popd ───────────────────────────────────────────────────────
const dynamicState = (D, c) => ({ S: union(D, new Set([c.cwd, UNKNOWN]), c.seen), F: D });

/** Operanden von `cd` (Optionen `-L -P -e -@ --` gefiltert). */
function cdOperanden(args) {
  const ops = [];
  let optsDone = false;
  for (const w of args) {
    if (!optsDone && !w.dynamic && w.text === "--") optsDone = true;
    else if (optsDone || w.dynamic || !["-L", "-P", "-e", "-@"].includes(w.text)) ops.push(w);
  }
  return ops;
}

/** `cd` auf ein statisches Ziel relativ zu jedem Verzeichnis der Menge. */
function cdStatisch(c, text, D) {
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

function cdEffect(name, args, D, c) {
  for (const d of real(D)) c.seen.add(d);
  const ops = cdOperanden(args);
  if (ops.length > 1) return { S: D, F: D }; // zu viele Argumente: cd schlägt fehl
  const t = ops[0];
  if (name === "popd" || (name === "pushd" && !t) || (t && (t.dynamic || t.text === "-"))) return dynamicState(D, c);
  if (!t) return { S: new Set([c.home(), c.cwd]), F: D }; // `cd` ohne Argument: Home
  const text = tildeOf(c, t.text);
  if (text === null) return dynamicState(D, c);
  if (text === t.text) return cdStatisch(c, text, D);
  const n = abs(c, c.cwd, text); // `~` aufgelöst
  if (!isDir(c, n)) return { S: D, F: D };
  c.seen.add(n);
  return { S: new Set([n, c.cwd]), F: D };
}

// ── Zuweisungen, Aliase, Funktionen ─────────────────────────────────────────
function noteEnv(c, env) {
  for (const { name, word } of env) {
    if (name === "GIT_DIR") c.gitEnv.gitDir = word;
    else if (name === "GIT_WORK_TREE") c.gitEnv.workTree = word;
  }
}

function aliasWordsOf(value) {
  const p = parseBash(value);
  const items = p.ok ? p.ast.items : [];
  const cmd = items.length === 1 && !items[0].bg && !items[0].andor.rest.length && items[0].andor.first.cmds.length === 1 ? items[0].andor.first.cmds[0] : null;
  return cmd && cmd.type === "simple" && !cmd.substs.length ? stripRedirs(cmd.words) : null;
}

/** `alias`/`unalias` im selben Befehl vormerken. */
function aliasBuiltin(name, args, c) {
  for (const w of args) {
    const m = /^([^=]+)=(.*)$/s.exec(w.text);
    if (name === "unalias") c.aliases.delete(w.text);
    else if (m) c.aliases.set(m[1], w.dynamic ? null : aliasWordsOf(m[2]));
  }
}

const exportZuweisungen = (args) =>
  args.filter((w) => ASSIGN_RE.test(w.text)).map((w) => ({ name: w.text.slice(0, w.text.indexOf("=")), word: { text: w.text.slice(w.text.indexOf("=") + 1), dynamic: w.dynamic } }));

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

// ── Interpreter ─────────────────────────────────────────────────────────────
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

/** Liest die Argumente einer Shell: `-c <text>` (`script`), Dateioperand, `-s`/`-`. */
function shellArgumente(args) {
  const r = { script: null, sawC: false, operand: false, stdinFlag: false };
  for (let i = 0; i < args.length; i++) {
    const t = args[i].text;
    if (args[i].dynamic) {
      r.operand = true;
      return r;
    }
    if (/^-[A-Za-z]+$/.test(t) && t.includes("c")) {
      r.sawC = true;
      r.script = args[i + 1] ?? null;
      return r;
    }
    if (["-o", "+o", "-O", "+O", "--rcfile", "--init-file"].includes(t)) i++;
    else if (t === "-" || t === "-s") r.stdinFlag = true;
    else if (!t.startsWith("-") && !t.startsWith("+")) {
      r.operand = true;
      return r;
    }
  }
  return r;
}

/** Text, den eine Shell von stdin liest (Heredoc, Here-String, Pipe); undefined ohne Eingabe, null wenn nicht statisch. */
function stdinText(cmd, opts, hereString) {
  if (cmd.heredocs.length) return cmd.heredocs.at(-1).static ? cmd.heredocs.at(-1).body : null;
  if (hereString) return hereString.dynamic ? null : hereString.text;
  return opts.pipeSrc ? staticOutput(opts.pipeSrc) : undefined;
}

/** `bash|sh|… -c <text>`, `bash <<EOF`, `echo … | sh`, `bash <<< text`. */
function shellCall(args, cmd, opts, hereString, D, c) {
  const a = shellArgumente(args);
  if (a.sawC) {
    if (!a.script) return;
    if (a.script.dynamic) ask(c, real(D), "Interpreter mit nicht statischem Text (`bash -c \"$X\"`).", true);
    else evalString(a.script.text, D, c);
    return;
  }
  if (a.operand && !a.stdinFlag) return; // `bash skript.sh`: Dateiinhalt ist nicht auswertbar
  const text = stdinText(cmd, opts, hereString);
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

// ── Einfache Kommandos ──────────────────────────────────────────────────────
const nichts = (D) => ({ S: D, F: D });

/** Funktion oder Alias im selben Befehl: das Ergebnis oder undefined. */
function indirektion(cmd, words, pe, D, c, opts) {
  const name = pe.name;
  const args = words.slice(pe.i + 1);
  if (c.fns.has(name) || c.aliases.has(name)) {
    if (c.depth >= MAX_INTERPRETER) {
      // Tiefe erschöpft: fail-closed statt still durchlassen (der Rumpf wird nicht mehr ausgewertet)
      ask(c, real(D), `Funktion/Alias \`${name}\` ist zu tief verschachtelt, der Inhalt wird nicht mehr ausgewertet.`, true);
      return nichts(D);
    }
  }
  if (c.fns.has(name)) {
    c.depth++;
    const r = evalCmd(c.fns.get(name), D, c, opts);
    c.depth--;
    return r;
  }
  if (name === "alias" || name === "unalias") {
    aliasBuiltin(name, args, c);
    return nichts(D);
  }
  if (!c.aliases.has(name) || c.expanding.has(name)) return undefined;
  const aw = c.aliases.get(name);
  if (aw === null) {
    ask(c, real(D), `Der Alias \`${name}\` ist nicht statisch auflösbar.`, true);
    return nichts(D);
  }
  c.expanding.add(name);
  c.depth++;
  const r = evalSimple({ ...cmd, words: [...words.slice(0, pe.i), ...aw, ...args], substs: [], heredocs: cmd.heredocs }, D, c, opts);
  c.depth--;
  c.expanding.delete(name);
  return r;
}

/** Kommandos mit Sonderbehandlung: cd, export, git, eval, Shells, find; undefined für alles andere. */
function sonderfall(name, ctx) {
  const { words, pe, args, D, c } = ctx;
  if (CD_LIKE.has(name) && pe.wrappers.every((w) => CD_WRAPPERS.has(w))) return cdEffect(name, args, D, c);
  if (EXPORTERS.has(name)) {
    noteEnv(c, exportZuweisungen(args));
    return nichts(D);
  }
  if (name === "git") {
    gitCall(words, pe.i, pe, D, c, 0);
    return nichts(D);
  }
  if (name === "eval") {
    if (args.some((w) => w.dynamic)) {
      ask(c, real(D), "`eval` mit nicht statischem Text.", true);
      return undefined;
    }
    const r = evalString(args.map((w) => w.text).join(" "), D, c);
    return { S: r, F: r, eval: true }; // eval läuft in der aktuellen Shell
  }
  if (SHELLS.has(name)) shellCall(args, ctx.cmd, ctx.opts, ctx.hereString, D, c);
  else if (name === "find") findCall(words.slice(pe.i), D, c);
  return undefined;
}

function evalSimple(cmd, D, c, opts) {
  evalSubsts(cmd, D, c);
  const hereString = hereStringOf(cmd.words);
  const words = stripRedirs(cmd.words);
  if (!words.length) return nichts(D);
  const pe = peel(words);
  if (pe.noop) return nichts(D);
  if (pe.i < 0) {
    noteEnv(c, pe.env); // nur Zuweisungen: gelten für folgende Kommandos (konservativ als exportiert)
    return nichts(D);
  }
  const args = words.slice(pe.i + 1);
  if (pe.dynamicCmd) {
    if (args.some((w) => !w.dynamic && PROTECTED_SUBS.has(w.text))) ask(c, real(D), "Das Kommando ist dynamisch (`$(…) push`, `$GIT commit`): git commit/push im Haupt-Checkout nicht auswertbar.", true);
    return nichts(D);
  }
  const name = pe.name;
  const ind = indirektion(cmd, words, pe, D, c, opts);
  if (ind) return ind;
  const sonder = sonderfall(name, { cmd, words, pe, args, D, c, opts, hereString });
  if (sonder && !sonder.eval) return sonder;
  return grobesNetz(name, words, pe, D, c, sonder ? { S: sonder.S, F: sonder.F } : nichts(D));
}

/** Unbekannter Wrapper mit git-Wort, sonst die grobe Wortregel als Sicherheitsnetz. */
function grobesNetz(name, words, pe, D, c, result) {
  const sonderName = name === "eval" || SHELLS.has(name) || name === "find";
  if (!sonderName && !isTextCommand(name, words)) {
    // Unbekannter Wrapper (`su -c`, `watch`): das erste git-Wort als Aufruf nehmen.
    const gi = words.findIndex((w, i) => i > pe.i && !w.dynamic && GIT_RE.test(w.text));
    if (gi >= 0) {
      gitCall(words, gi, pe, D, c, 0);
      return nichts(D);
    }
  }
  if (name !== "find" && !isTextCommand(name, words) && coarseProtected(words.map((w) => w.text).join(" "))) for (const d of real(D)) c.targets.add(d);
  return result;
}

// ── Einstieg ────────────────────────────────────────────────────────────────
/** Zerlegt und wertet `command` aus: `{ targets: string[], asks: Map<dir, {reason, mainOnly}> }`. */
export function analyse(command, cwd, deps = {}) {
  const c = makeCtx(cwd, deps);
  c.evalString = (text, D) => evalString(text, D, c);
  if (!command) return { targets: [], asks: c.asks };
  const parsed = parseBash(command);
  if (!parsed.ok) return { targets: coarseProtected(command) ? [cwd] : [], asks: c.asks };
  evalList(parsed.ast, new Set([c.cwd]), c);
  return { targets: [...c.targets], asks: c.asks };
}

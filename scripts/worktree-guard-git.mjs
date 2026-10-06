// Kein Shebang: Baustein des Worktree-Guards (scripts/worktree-guard-hook.mjs), wird von dessen Modulen importiert.
/**
 * git-Aufrufe im Worktree-Guard (#1311): Optionen lesen (`-C`, `-c`, `--git-dir`, `--work-tree`), das Ziel-
 * verzeichnis je Verzeichnis der Menge bestimmen, Aliase auflösen (`-c alias.x=…`, `git config alias.*`, im selben
 * Befehl gesetzt) und geschützte Aufrufe (`commit`, `push`, `subtree push`, `submodule foreach`, `rebase -x`) melden.
 * Innere Kommandos werten `c.evalString` aus (vom Auswerter gesetzt, kein Import-Zyklus).
 *
 * Reines Node-Skript (nur Builtins).
 */
import { execFileSync } from "node:child_process";
import { MAX_INTERPRETER } from "./hook-io.mjs";
import { KNOWN_SUBS, PROTECTED_SUBS, abs, ask, isDir, real, tildeOf, UNKNOWN } from "./worktree-guard-tabellen.mjs";

const VALUE_OPTS = ["--namespace", "--config-env", "--attr-source", "--super-prefix"];

/** `-c key=value`: Aliase und `core.worktree` merken. */
function konfiguration(g, cfg) {
  if (!cfg || cfg.dynamic) return;
  const a = /^alias\.([^=]+)=(.*)$/is.exec(cfg.text);
  const wt = /^core\.worktree=(.*)$/is.exec(cfg.text);
  if (a) g.aliases.set(a[1].toLowerCase(), a[2]); // git-Konfigurationsnamen sind nicht case-sensitiv
  if (wt) g.workTrees.push({ text: wt[1], dynamic: false });
}

/** Eine Option (oder `-C`) an Index `j`; liefert den nächsten Index oder -1 beim Unterbefehl. */
function gitOption(g, words, j) {
  const w = words[j];
  const t = w.text;
  const value = (list) => list.push(words[j + 1] ?? { text: "", dynamic: true });
  const lang = /^--(git-dir|work-tree)=(.*)$/s.exec(t);
  if (t === "-C") value(g.cWords);
  else if (t === "-c") konfiguration(g, words[j + 1]);
  else if (t === "--git-dir" || t === "--work-tree") value(t === "--git-dir" ? g.gitDirs : g.workTrees);
  else if (lang) {
    (lang[1] === "git-dir" ? g.gitDirs : g.workTrees).push({ text: lang[2], dynamic: w.dynamic });
    return j + 1;
  } else if (!VALUE_OPTS.includes(t)) return t.startsWith("-") ? j + 1 : -1;
  return j + 2;
}

function parseGitArgs(words, k) {
  const g = { cWords: [], gitDirs: [], workTrees: [], aliases: new Map(), sub: null, subIdx: words.length };
  let j = k + 1;
  while (j < words.length && !(words[j].dynamic && !words[j].text.startsWith("-"))) {
    const next = gitOption(g, words, j);
    if (next < 0) break;
    j = next;
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

const envWorte = (pe, name, global) => [...pe.env.filter((e) => e.name === name).map((e) => e.word), ...(global ? [global] : [])].filter((w) => w.dynamic || w.text !== "");

/** `-C`-Kette ab `b`; liefert den Endpunkt und ergänzt `out`/`unresolved` für nicht auflösbare oder fehlende Ziele. */
function folgeC(c, g, b, out, st) {
  let cur = b;
  for (const w of g.cWords) {
    const t = w.dynamic || /[{}*?]/.test(w.text) ? null : tildeOf(c, w.text);
    if (t === null) {
      st.unresolved = true;
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
  return cur;
}

/** `--git-dir`/`--work-tree` (Option oder Umgebung): zusätzliche Ziele neben `b`, `cur` und dem Session-cwd. */
function extraZiel(c, w, isGitDir, b, cur, out, st) {
  const t = w.dynamic ? null : tildeOf(c, w.text);
  if (t === null) {
    st.unresolved = true;
    out.add(b);
    out.add(c.cwd);
    return;
  }
  const v = abs(c, b, t);
  out.add(isGitDir && /[\\/]\.git$/.test(v) ? c.P.dirname(v) : v);
  out.add(b);
  out.add(cur);
  out.add(c.cwd);
}

/** Wrapper-Ortswechsel (`env -C`, `sudo -D`) auf `b0` anwenden. */
function wrapperOrt(c, pe, b0, out, st) {
  let b = b0;
  for (const ch of pe.chdirs) {
    const t = ch.dynamic ? null : tildeOf(c, ch.text);
    if (t === null) {
      st.unresolved = true;
      out.add(b);
    } else b = abs(c, b, t);
  }
  return b;
}

/** Verzeichnisse, in denen dieser git-Aufruf liefe; vermerkt Rückfragen bei unbestimmbarem Ziel. */
function gitTargetDirs(g, pe, D, c) {
  const out = new Set();
  const st = { unresolved: false };
  if (D.has(UNKNOWN)) {
    st.unresolved = true;
    out.add(c.cwd);
  }
  const gitDirs = [...g.gitDirs, ...envWorte(pe, "GIT_DIR", c.gitEnv.gitDir)];
  const workTrees = [...g.workTrees, ...envWorte(pe, "GIT_WORK_TREE", c.gitEnv.workTree)];
  for (const b0 of real(D)) {
    const b = wrapperOrt(c, pe, b0, out, st);
    const cur = folgeC(c, g, b, out, st);
    out.add(cur);
    for (const w of gitDirs) extraZiel(c, w, true, b, cur, out, st);
    for (const w of workTrees) extraZiel(c, w, false, b, cur, out, st);
  }
  if (st.unresolved) ask(c, [...out], "Das Ziel des git-Aufrufs ist nicht statisch bestimmbar (`cd \"$X\"`, `-C \"$D\"`, `cd -`, `--git-dir=$X`).");
  return out;
}

/** Unterkommandos von `git rebase -x/--exec` (Wörter). */
function rebaseExec(rest) {
  const cmds = [];
  for (let i = 0; i < rest.length; i++) {
    const t = rest[i].text;
    if (t === "-x" || t === "--exec") cmds.push(rest[++i] ?? { text: "", dynamic: true });
    else if (t.startsWith("--exec=")) cmds.push({ text: t.slice(7), dynamic: rest[i].dynamic });
    else if (/^-x./.test(t)) cmds.push({ text: t.slice(2), dynamic: rest[i].dynamic });
  }
  return cmds;
}

/** Das Unterkommando von `git submodule foreach` (ein Wort, Optionen ausgenommen); leer ohne `foreach`. */
function foreachKommando(rest) {
  const k = rest.findIndex((w) => w.text === "foreach");
  if (k < 0) return [];
  const args = rest.slice(k + 1).filter((w) => !w.text.startsWith("-"));
  return [{ text: args.map((w) => w.text).join(" "), dynamic: rest.some((w) => w.dynamic) }];
}

/** `git config alias.X …` im selben Befehl vormerken. */
function configAliasMerken(c, rest) {
  const k = rest.findIndex((w) => !w.dynamic && /^alias\.[^=\s]+$/i.test(w.text));
  if (k >= 0) c.cfgAliases.set(rest[k].text.slice(6).toLowerCase(), rest[k + 1] && !rest[k + 1].dynamic ? rest[k + 1].text : null);
}

/** Alias auflösen (Aufruf-lokal, im selben Befehl gesetzt oder aus der git-Konfiguration); true, wenn der Aufruf damit erledigt ist. */
function aliasAufloesen(g, words, k, rest, pe, D, c, depth) {
  const sub = g.sub.text;
  const cfgName = sub.toLowerCase(); // git-Konfigurationsnamen sind nicht case-sensitiv
  if (PROTECTED_SUBS.has(sub) || !(g.aliases.has(cfgName) || c.cAliases.has(cfgName) || !KNOWN_SUBS.has(sub)) || sub === "") return false;
  if (c.cfgAliases.get(cfgName) === null) ask(c, real(D), `Der git-Alias \`${sub}\` ist nicht statisch auflösbar.`, true);
  const lokal = g.aliases.has(cfgName) ? g.aliases.get(cfgName) : c.cAliases.get(cfgName); // -c des Aufrufs, dann -c der äußeren !-Aliase
  const al = lokal ?? c.cfgAliases.get(cfgName) ?? configAlias(c, sub, D);
  if (!al) return false;
  if (depth >= MAX_INTERPRETER || (al.startsWith("!") && c.depth >= MAX_INTERPRETER)) {
    ask(c, real(D), `Die Alias-Kette von \`${sub}\` ist zu tief verschachtelt, der Inhalt wird nicht mehr ausgewertet.`, true);
    return true;
  }
  if (al.startsWith("!")) {
    // `-c alias.x=…` gelten für den inneren git-Aufruf, aber nur für ihn: eine eigene Ebene, die der befehlsweite Zustand (`git config alias.*`) nicht berührt
    const vorher = c.cAliases;
    c.cAliases = new Map([...vorher, ...g.aliases]);
    try {
      c.evalString(`${al.slice(1)} ${rest.map((w) => w.text).join(" ")}`, gitTargetDirs(g, pe, D, c));
    } finally {
      c.cAliases = vorher;
    }
    return true;
  }
  const aw = al.trim().split(/\s+/).map((text) => ({ text, dynamic: false, quoted: false }));
  gitCall([...words.slice(0, g.subIdx), ...aw, ...rest], k, pe, D, c, depth + 1);
  return true;
}

/** Wertet einen git-Aufruf ab Index `k` aus: geschützte Aufrufe tragen ihre Ziele in `c.targets` ein. */
export function gitCall(words, k, pe, D, c, depth) {
  const g = parseGitArgs(words, k);
  if (!g.sub) return;
  if (g.sub.dynamic) {
    ask(c, real(D), "Der git-Unterbefehl ist dynamisch (`git \"$SUB\"`).", true);
    return;
  }
  const sub = g.sub.text;
  const rest = words.slice(g.subIdx + 1);
  if (sub === "config") return configAliasMerken(c, rest);
  if (aliasAufloesen(g, words, k, rest, pe, D, c, depth)) return;
  if (PROTECTED_SUBS.has(sub) || (sub === "subtree" && rest[0]?.text === "push")) {
    for (const d of gitTargetDirs(g, pe, D, c)) c.targets.add(d);
    return;
  }
  const inner = sub === "submodule" ? foreachKommando(rest) : sub === "rebase" ? rebaseExec(rest) : [];
  if (!inner.length) return;
  const dirs = gitTargetDirs(g, pe, D, c);
  for (const w of inner) {
    if (w.dynamic) ask(c, [...dirs], "Unterkommando von `git submodule foreach`/`git rebase -x` ist nicht statisch.", true);
    else c.evalString(w.text, dirs);
  }
}

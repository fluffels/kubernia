// Kein Shebang: wird über `.claude/settings.json` per `node scripts/worktree-guard-powershell.mjs` gestartet UND von
// test/harness/worktree-guard-powershell.test.ts importiert (ein `#!` bricht den Test-Import).
/**
 * Worktree-Guard für das PowerShell-Tool (#1311, Z25) — Claude-Code-`PreToolUse`-Hook, Matcher `PowerShell`.
 *
 * Lücke: `scripts/worktree-guard-hook.mjs` hängt nur am Matcher `Bash`. Über das PowerShell-Tool lief
 * `Set-Location <hauptcheckout>; git commit …` ungeprüft durch (der Ausweichweg in #1139/#1276). Dieser Hook
 * hat dieselbe Entscheidung (Haupt-Checkout statt Linked Worktree, `resolveGitContext` aus dem Bash-Hook,
 * EINE Quelle), versteht aber die PowerShell-Eigenheiten, die der Bash-Hook nicht kennt.
 *
 * Gemessen (Probe 2026-10-06, `claude -p` mit einem PreToolUse-Hook, Matcher PowerShell): die Payload-`cwd`
 * FOLGT dem persistenten `Set-Location` früherer Aufrufe. Der Hook startet darum bei `cwd` und wertet nur
 * Ortswechsel INNERHALB des einen Befehls aus.
 *
 * Was er versteht (Tokenizer statt Regex auf dem Rohtext):
 *  - Trenner `;`, `&&`, `||`, `|`, Zeilenumbruch und Blöcke `{ … }`; Text in `'…'`, `"…"` (Backtick-Escape),
 *    Here-Strings und Kommentare (`#`, `<# … #>`) zählt nicht als Befehl.
 *  - Ortswechsel `Set-Location`/`cd`/`sl`/`chdir`/`Push-Location`/`pushd` (auch `-Path`/`-LiteralPath`): nur ein
 *    EXISTIERENDER Ordner ändert den Ort. Nach `;` läuft der nächste Befehl trotz Fehler weiter (der Ort bleibt),
 *    nach `&&` nicht, nach `||` nur bei Fehler.
 *  - `git -C <dir> …` (auch mehrfach, relativ), `git.exe`, `& git`, voller Pfad zu git.
 *  - Einfache Variablen-Zuweisungen mit Literal (`$W = 'C:\wt'`) für `-C $W` und `Set-Location $W`.
 *  - Interpreter-Umwege (`iex`, `Invoke-Expression`, `pwsh -c`, `cmd /c`, `bash -c`, `Start-Process`): grobe
 *    Regel gegen den aktuellen Ort, sobald im Statement `git … commit|push` vorkommt.
 *
 * Fail-closed in genau einem Fall: ein Ziel mit nicht auflösbarer Variable/Ausdruck (`-C $unbekannt`,
 * `cd (Join-Path …)`) bei commit/push wird geblockt, mit dem Hinweis, den Pfad literal zu schreiben. Sonst
 * fail-open wie der Bash-Hook (kein cwd, kein Git-Repo, anderes Repo).
 *
 * Ehrliche Grenze: kein vollständiger PowerShell-Parser. Eine zur Laufzeit zusammengesetzte Befehlszeile
 * (`& ([string]'gi'+'t') commit`) sieht er nicht; die Durchsetzung bleibt das PR-Gate.
 */
import { statSync } from "node:fs";
import { dirname, resolve, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import { analyse, resolveGitContext } from "./worktree-guard-hook.mjs"; // eine Quelle für Entscheidung und Bash-Auswertung
import { SHELLS } from "./shell-tabellen.mjs";
import { MAX_INTERPRETER, emit, istDirektaufruf, mergeDecisions, parseHookInput, readStdin } from "./hook-io.mjs";

export { parseHookInput };

const ORT_BEFEHLE = new Set(["set-location", "cd", "sl", "chdir", "push-location", "pushd"]);
const INTERPRETER = new Set([...SHELLS, "iex", "invoke-expression", "pwsh", "pwsh.exe", "powershell", "powershell.exe", "cmd", "cmd.exe", "wsl", "start-process", "start", "invoke-command", "icm"]);
const GESCHUETZT = new Set(["commit", "push"]);

/** Ein Token: `value` ohne Anführungszeichen, `literal` = komplett aus '…' (keine Variablen-Ersetzung). */
/** @typedef {{ value: string, literal: boolean }} Token */

/**
 * Zerlegt einen PowerShell-Befehl in Statements. Pur.
 * @returns {{ tokens: Token[], raw: string, sep: string }[]} `sep` ist der Trenner NACH dem Statement ("" am Ende).
 */
export function zerlege(src) {
  const text = String(src ?? "");
  const z = { text, out: [], tokens: [], cur: "", hat: false, nurLiteral: true, start: 0 };
  for (let i = 0; i < text.length; i++) i = schritt(z, i);
  stmtEnde(z, "", text.length);
  return z.out;
}

// ── Tokenizer-Bausteine (`z`: Zustand, `i`: Index; `schritt` liefert den Index des zuletzt verbrauchten Zeichens) ──
function tokenEnde(z) {
  if (z.hat) z.tokens.push({ value: z.cur, literal: z.nurLiteral });
  z.cur = "";
  z.hat = false;
  z.nurLiteral = true;
}

function stmtEnde(z, sep, i) {
  tokenEnde(z);
  if (z.tokens.length > 0) z.out.push({ tokens: z.tokens, raw: z.text.slice(z.start, i).trim(), sep });
  z.tokens = [];
  z.start = i + sep.length;
}

/** `'…'` (verbatim, `''` ist ein Apostroph): liefert den Index des schließenden Quotes. */
function einfacherString(z, i0) {
  const { text } = z;
  z.hat = true;
  let i = i0 + 1;
  while (i < text.length) {
    if (text[i] === "'" && text[i + 1] === "'") {
      z.cur += "'";
      i += 2;
    } else if (text[i] === "'") break;
    else z.cur += text[i++];
  }
  return i;
}

/** `"…"` (Backtick-Escape, `""` ist ein Anführungszeichen): liefert den Index des schließenden Quotes. */
function doppelterString(z, i0) {
  const { text } = z;
  z.hat = true;
  z.nurLiteral = false;
  let i = i0 + 1;
  while (i < text.length) {
    if (text[i] === "`" && i + 1 < text.length) {
      z.cur += text[i + 1];
      i += 2;
    } else if (text[i] === '"' && text[i + 1] === '"') {
      z.cur += '"';
      i += 2;
    } else if (text[i] === '"') break;
    else z.cur += text[i++];
  }
  return i;
}

/** Here-String `@' … '@` / `@" … "@` (Opener am Tokenanfang, danach Zeilenende): Index des Endes oder -1. */
function hereString(z, i) {
  const { text } = z;
  const n = text[i + 1];
  if (z.hat || !/^[ \t]*\r?\n/.test(text.slice(i + 2))) return -1;
  const anfang = text.indexOf("\n", i + 2) + 1; // Inhalt beginnt nach dem Zeilenende des Openers
  const ende = text.indexOf(`\n${n}@`, anfang - 1);
  z.hat = true;
  z.nurLiteral = n === "'";
  z.cur += ende < 0 ? text.slice(anfang) : text.slice(anfang, ende);
  return ende < 0 ? text.length : ende + 2;
}

/** Backtick: Zeilenfortsetzung oder Escape des nächsten Zeichens. */
function backtick(z, i) {
  const n = z.text[i + 1];
  if (n === "\r" || n === "\n") return i + (n === "\r" && z.text[i + 2] === "\n" ? 2 : 1);
  if (n === undefined) return i;
  z.hat = true;
  z.cur += n;
  z.nurLiteral = false;
  return i + 1;
}

/** Trenner an Position `i`: `{ sep, len }` oder null. */
function trenner(text, i) {
  const c = text[i];
  const zwei = text.slice(i, i + 2);
  if (zwei === "&&" || zwei === "||") return { sep: zwei, len: 2 };
  return c === "\n" || c === ";" || c === "|" || c === "{" || c === "}" ? { sep: c, len: 1 } : null;
}

/** Kommentar `<# … #>` oder `# …` (nicht mitten in einem Token): Index des zuletzt verbrauchten Zeichens oder -1. */
function kommentar(z, i) {
  const { text } = z;
  if (text[i] === "<" && text[i + 1] === "#") {
    const ende = text.indexOf("#>", i + 2);
    return ende < 0 ? text.length : ende + 1;
  }
  if (text[i] !== "#" || z.hat) return -1;
  const nl = text.indexOf("\n", i);
  return (nl < 0 ? text.length : nl) - 1; // der Zeilenumbruch trennt das Statement
}

function schritt(z, i) {
  const { text } = z;
  const c = text[i];
  const n = text[i + 1];
  if (c === "'") return einfacherString(z, i);
  if (c === '"') return doppelterString(z, i);
  if (c === "@" && (n === "'" || n === '"')) {
    const ende = hereString(z, i);
    if (ende >= 0) return ende;
  }
  const k = kommentar(z, i);
  if (k >= 0) return k;
  if (c === "`") return backtick(z, i);
  if (c === " " || c === "\t" || c === "\r") {
    tokenEnde(z);
    return i;
  }
  const t = trenner(text, i);
  if (t) {
    stmtEnde(z, t.sep, i);
    return i + t.len - 1;
  }
  z.hat = true;
  z.cur += c;
  z.nurLiteral = false;
  return i;
}

const basename = (p) => String(p).replace(/\\/g, "/").split("/").pop().toLowerCase();
/** Ist das Token der Befehl `git` (auch `git.exe`, voller Pfad)? */
const istGit = (t) => /^git(\.exe)?$/.test(basename(t));
/** Klammern und Subexpression-Präfix vom Befehlsnamen lösen: `$(git`, `(git`. */
const befehlsname = (v) => String(v).replace(/^[\s(@$]*\(?/, "").replace(/[)]+$/, "");

/** Variablen ersetzen (nur nicht-literale Tokens); `$` im Ergebnis = nicht auflösbar. */
function expandiere(tok, vars) {
  if (tok.literal) return tok.value;
  return tok.value.replace(/\$(\w+)/g, (voll, name) => (vars.has(name.toLowerCase()) ? vars.get(name.toLowerCase()) : voll));
}
const unaufloesbar = (v) => /[$*~]|^\(/.test(v) || v === "";

/** Normalisierter Vergleichs-/Schlüsselpfad (Slashes, absolut). */
export const normPfad = (p) => resolve(p).replace(/\\/g, "/");

/** Lokale Variablen-Zuweisung `$x = 'literal'` bzw. `$x='literal'`: merkt Literale, alles andere bleibt unbekannt. */
function zuweisung(toks, vars) {
  const kopf = toks[0].value;
  if (!kopf.startsWith("$")) return false;
  const direkt = /^\$(\w+)=(.*)$/s.exec(kopf);
  const getrennt = toks[1]?.value === "=" ? { name: kopf.slice(1), wert: toks.slice(2).map((t) => t.value).join(" "), literal: false } : null;
  const z = direkt ? { name: direkt[1], wert: direkt[2], literal: toks[0].literal } : getrennt;
  if (!z) return false;
  const ex = expandiere({ value: z.wert, literal: z.literal }, vars);
  if (!/[$()]/.test(ex)) vars.set(z.name.toLowerCase(), ex);
  return true;
}

/** Das Ziel eines Ortswechsels (`Set-Location <pfad>` bzw. `-Path`/`-LiteralPath <pfad>`); undefined ohne Ziel. */
function ortsZiel(rest, vars) {
  const args = rest.map((t) => expandiere(t, vars));
  for (let i = 0; i < args.length; i++) {
    if (/^-(path|literalpath|pspath)$/i.test(args[i])) return args[i + 1];
    if (!args[i].startsWith("-")) return args[i];
  }
  return undefined;
}

/**
 * Wertet die globalen Optionen eines git-Aufrufs aus (`-C <dir>`, `--work-tree`, `--git-dir`) und liefert
 * Unterbefehl, Zielordner und ob das Ziel unauswertbar ist.
 */
function gitZiel(rest, start, vars, istOrdnerStart) {
  let dir = start;
  let unbekannt = istOrdnerStart === null;
  let sub;
  const setze = (d) => {
    if (unaufloesbar(d)) unbekannt = true;
    else if (!unbekannt) dir = isAbsolute(d) ? d : resolve(dir, d);
  };
  for (let i = 0; i < rest.length; ) {
    const a = expandiere(rest[i], vars);
    const m = /^--(git-dir|work-tree)(?:=(.*))?$/.exec(a);
    if (a === "-C") { setze(rest[i + 1] ? expandiere(rest[i + 1], vars) : ""); i += 2; }
    else if (m) {
      const wert = m[2] ?? (rest[i + 1] ? expandiere(rest[i + 1], vars) : "");
      // --git-dir=<x>/.git zeigt auf den Checkout daneben, --work-tree direkt auf ihn
      setze(m[1] === "git-dir" && /[\\/]\.git$/.test(wert) ? wert.replace(/[\\/]\.git$/, "") || "/" : wert);
      i += m[2] === undefined ? 2 : 1;
    }
    else if (a === "-c" || a === "--exec-path" || a === "--namespace") i += 2;
    else if (a.startsWith("-")) i++;
    else { sub = a; break; }
  }
  return { sub, dir, unbekannt };
}

/** Zustand eines Bewertungslaufs: `ort` (null = nach einem nicht auswertbaren Ortswechsel), `ortStatus` des unmittelbar
 *  vorangehenden ORTSWECHSELS (für && / ||: true = gelungen, false = fehlgeschlagen, null = der Vorgänger war kein auswertbarer
 *  Ortswechsel; nur ein ausgewerteter Ortswechsel darf einen Nachfolger überspringen, bei jedem anderen Vorgänger
 *  (`git diff --quiet || git commit`) läuft der Nachfolger, im Zweifel wird geblockt). */
function neuerLauf({ cwd, repoRoot, deps, tiefe }) {
  return {
    cwd,
    repoRoot,
    deps,
    tiefe,
    vars: new Map(),
    ort: resolve(cwd),
    ortStatus: null,
    istOrdner: deps.istOrdner ?? ((p) => { try { return statSync(p).isDirectory(); } catch { return false; } }),
    kontext: deps.kontext ?? ((dir) => resolveGitContext(dir, repoRoot)),
  };
}

function blockiert(k, dir, was) {
  const ctx = k.kontext(dir);
  if (!ctx || !ctx.relevant || !ctx.isMainWorktree) return null;
  return {
    block: true,
    reason:
      `git ${was} ist im geteilten main-Checkout (${ctx.toplevel ?? dir}) blockiert (PowerShell-Tool). ` +
      "Bitte im eigenen `git worktree` arbeiten (AGENTS.md § Git-Workflow): z.B. `git -C <worktree-pfad> commit …` " +
      "oder zuerst `Set-Location <worktree-pfad>`. (#735, #1311)",
  };
}

const unklar = (was) => ({
  block: true,
  reason:
    `git ${was} mit einem Ziel, das der Guard nicht auswerten kann (Variable oder Ausdruck). Den Worktree-Pfad ` +
    "literal schreiben (`git -C C:\\pfad\\zum\\worktree …`), damit der Haupt-Checkout-Schutz greift. (#1311)",
});

/** git-Statement: commit/push gegen das Ziel prüfen; unauswertbares Ziel ist fail-closed. */
function gitStatement(k, rest) {
  const { sub, dir, unbekannt } = gitZiel(rest, k.ort, k.vars, k.ort);
  if (sub && GESCHUETZT.has(sub)) return unbekannt ? unklar(sub) : blockiert(k, dir, sub);
  if (!unbekannt) return null;
  // Ziel nicht auswertbar: steht irgendwo commit/push in den Argumenten, ist es zu unklar zum Durchlassen.
  const was = rest.map((t) => expandiere(t, k.vars)).find((a) => GESCHUETZT.has(a));
  return was ? unklar(was) : null;
}

/** Ortswechsel: nur ein existierender Ordner ändert den Ort, sonst bleibt er (und `&&` bricht ab). */
function ortWechsel(k, rest) {
  const ziel = ortsZiel(rest, k.vars);
  if (ziel === undefined) return;
  if (unaufloesbar(ziel)) {
    k.ort = null;
    return;
  }
  const zielAbs = isAbsolute(ziel) ? ziel : resolve(k.ort ?? k.cwd, ziel);
  k.ortStatus = k.istOrdner(zielAbs);
  if (k.ortStatus) k.ort = zielAbs;
}

/** Der String hinter `bash|sh -c` läuft durch den Bash-Auswerter (Ziele blocken, nicht bestimmbare Ziele fragen). */
function bashBruecke(k, skript, name) {
  const { targets, asks } = analyse(skript, k.ort, { statSync: (p) => ({ isDirectory: () => k.istOrdner(p) }) });
  for (const ziel of targets) {
    const b = blockiert(k, ziel, `commit/push (in \`${name} -c\`)`);
    if (b) return b;
  }
  for (const [dir, a] of asks) {
    const ctx = k.kontext(dir);
    if (ctx?.relevant && (!a.mainOnly || ctx.isMainWorktree)) return { block: false, ask: true, reason: `Worktree-Guard (PowerShell): ${a.reason} Den Ort literal angeben (\`git -C <worktree-pfad> …\`) oder bestätigen. (#1311)` };
  }
  return null;
}

/** Das Skript hinter `-c`/`-Command` bzw. der Ausdruck hinter `iex`/`Invoke-Expression`; sonst null. */
function interpreterSkript(k, toks, name) {
  const rest = toks.slice(1).map((t) => expandiere(t, k.vars));
  if (/^(iex|invoke-expression)$/.test(name)) return rest.join(" ");
  const ci = rest.findIndex((a) => /^-[A-Za-z]*c[A-Za-z]*$/.test(a) || /^-command$/i.test(a));
  return ci >= 0 ? rest.slice(ci + 1).join(" ") : null;
}

/** Interpreter-Umweg: der String hinter `bash -c` läuft durch den Bash-Auswerter, der hinter `pwsh -c`/`iex` rekursiv
 *  durch diesen Guard (Tiefe ≤ MAX_INTERPRETER); zusätzlich die grobe Regel: kommt im Text git … commit|push vor, gilt
 *  das gegen den aktuellen Ort. */
function interpreterUmweg(k, raw, toks, cmd) {
  if (k.ort !== null && k.tiefe < MAX_INTERPRETER) {
    const name = basename(cmd).replace(/\.exe$/, "");
    const skript = interpreterSkript(k, toks, name);
    let r = null;
    if (skript && SHELLS.has(name)) r = bashBruecke(k, skript, name);
    else if (skript && /^(iex|invoke-expression|pwsh|powershell)$/.test(name)) r = bewertePowerShell({ command: skript, cwd: k.ort, repoRoot: k.repoRoot, deps: k.deps, tiefe: k.tiefe + 1 });
    if (r && (r.block || r.ask)) return r;
  }
  if (!/\bgit(\.exe)?\b[^;|]*\b(commit|push)\b/i.test(raw)) return null;
  return k.ort === null ? unklar("commit/push") : blockiert(k, k.ort, "commit/push (über einen Interpreter)");
}

/** Ein Statement bewerten: Ortswechsel, git oder Interpreter; Ergebnis `{ block }`, `{ ask }` oder null. */
function statement(k, stmt) {
  const toks = stmt.tokens;
  if (zuweisung(toks, k.vars)) return null;
  const aufruf = ["&", "."].includes(befehlsname(toks[0].value));
  const kopfTok = aufruf ? toks[1] : toks[0];
  const cmd = kopfTok ? befehlsname(kopfTok.value) : "";
  if (ORT_BEFEHLE.has(cmd.toLowerCase())) {
    ortWechsel(k, toks.slice(aufruf ? 2 : 1));
    return null;
  }
  if (kopfTok && istGit(kopfTok.value)) return gitStatement(k, toks.slice(aufruf ? 2 : 1));
  if (INTERPRETER.has(cmd.toLowerCase()) || INTERPRETER.has(basename(cmd))) return interpreterUmweg(k, stmt.raw, toks.slice(aufruf ? 1 : 0), cmd);
  return null;
}

const ueberspringt = (sep, ortStatus) => (sep === "&&" && ortStatus === false) || (sep === "||" && ortStatus === true);

/**
 * Bewertet einen PowerShell-Befehl. `deps.istOrdner(pfad)` und `deps.kontext(ordner)` sind injizierbar
 * (Tests); Standard: echtes Dateisystem und `resolveGitContext` aus dem Bash-Hook.
 * @returns {{ block: boolean, ask?: boolean, reason?: string }} (`ask`: das Ziel eines `bash -c`-Strings ist nicht bestimmbar)
 */
export function bewertePowerShell({ command, cwd, repoRoot, deps = {}, tiefe = 0 }) {
  if (!command || !cwd) return { block: false }; // nicht entscheidbar → fail-open
  const k = neuerLauf({ cwd, repoRoot, deps, tiefe });
  let frage = null;
  let vorherSep = ";";
  for (const stmt of zerlege(command)) {
    // Verkettung: nach fehlgeschlagenem Ortswechsel läuft ein && -Nachfolger nicht, nach gelungenem ein || -Nachfolger nicht.
    const ueberspringen = ueberspringt(vorherSep, k.ortStatus);
    vorherSep = stmt.sep;
    if (ueberspringen) continue;
    k.ortStatus = null;
    const r = statement(k, stmt);
    if (r?.block) return r;
    frage ??= r?.ask ? r : null; // eine Rückfrage zählt erst, wenn kein späteres Statement blockt
  }
  return frage ?? { block: false };
}

function main() {
  const { tool, cwd, command } = parseHookInput(readStdin());
  if (tool !== undefined && tool !== "PowerShell") return;
  const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
  emit(mergeDecisions([bewertePowerShell({ command, cwd, repoRoot })]));
}

if (istDirektaufruf(import.meta.url)) main();

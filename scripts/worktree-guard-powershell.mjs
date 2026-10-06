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
import { MAX_INTERPRETER, emit, istDirektaufruf, mergeDecisions, parseHookInput, readStdin } from "./hook-io.mjs";

export { parseHookInput };

const ORT_BEFEHLE = new Set(["set-location", "cd", "sl", "chdir", "push-location", "pushd"]);
const INTERPRETER = new Set(["iex", "invoke-expression", "pwsh", "pwsh.exe", "powershell", "powershell.exe", "cmd", "cmd.exe", "bash", "sh", "wsl", "start-process", "start", "invoke-command", "icm"]);
const GESCHUETZT = new Set(["commit", "push"]);

/** Ein Token: `value` ohne Anführungszeichen, `literal` = komplett aus '…' (keine Variablen-Ersetzung). */
/** @typedef {{ value: string, literal: boolean }} Token */

/**
 * Zerlegt einen PowerShell-Befehl in Statements. Pur.
 * @returns {{ tokens: Token[], raw: string, sep: string }[]} `sep` ist der Trenner NACH dem Statement ("" am Ende).
 */
export function zerlege(src) {
  const text = String(src ?? "");
  const out = [];
  let tokens = [];
  let cur = "";
  let hat = false; // Token begonnen (auch leer, z.B. '')
  let nurLiteral = true;
  let start = 0;

  const tokenEnde = () => {
    if (hat) tokens.push({ value: cur, literal: nurLiteral });
    cur = "";
    hat = false;
    nurLiteral = true;
  };
  const stmtEnde = (sep, i) => {
    tokenEnde();
    if (tokens.length > 0) out.push({ tokens, raw: text.slice(start, i).trim(), sep });
    tokens = [];
    start = i + sep.length;
  };

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    const n = text[i + 1];
    if (c === "'" || c === '"') {
      // Here-String: @' … '@ bzw. @" … "@ (der Opener steht am Tokenanfang, danach Zeilenende)
      hat = true;
      if (c === "'") {
        i++;
        let s = "";
        while (i < text.length) {
          if (text[i] === "'" && text[i + 1] === "'") { s += "'"; i += 2; continue; }
          if (text[i] === "'") break;
          s += text[i++];
        }
        cur += s;
      } else {
        nurLiteral = false;
        i++;
        let s = "";
        while (i < text.length) {
          if (text[i] === "`" && i + 1 < text.length) { s += text[i + 1]; i += 2; continue; }
          if (text[i] === '"' && text[i + 1] === '"') { s += '"'; i += 2; continue; }
          if (text[i] === '"') break;
          s += text[i++];
        }
        cur += s;
      }
      continue;
    }
    if (c === "@" && (n === "'" || n === '"') && !hat && /^[ \t]*\r?\n/.test(text.slice(i + 2))) {
      const anfang = text.indexOf("\n", i + 2) + 1; // Inhalt beginnt nach dem Zeilenende des Openers
      const ende = text.indexOf(`\n${n}@`, anfang - 1);
      hat = true;
      nurLiteral = n === "'";
      cur += ende < 0 ? text.slice(anfang) : text.slice(anfang, ende);
      i = ende < 0 ? text.length : ende + 2;
      continue;
    }
    if (c === "<" && n === "#") {
      const ende = text.indexOf("#>", i + 2);
      i = ende < 0 ? text.length : ende + 1;
      continue;
    }
    if (c === "#" && !hat) {
      while (i < text.length && text[i] !== "\n") i++;
      i--; // der Zeilenumbruch trennt das Statement
      continue;
    }
    if (c === "`") {
      if (n === "\r" || n === "\n") { i += n === "\r" && text[i + 2] === "\n" ? 2 : 1; continue; } // Zeilenfortsetzung
      if (n !== undefined) { hat = true; cur += n; nurLiteral = false; i++; }
      continue;
    }
    if (c === " " || c === "\t" || c === "\r") { tokenEnde(); continue; }
    if (c === "\n") { stmtEnde("\n", i); continue; }
    if (c === ";") { stmtEnde(";", i); continue; }
    if (c === "&" && n === "&") { stmtEnde("&&", i); i++; continue; }
    if (c === "|" && n === "|") { stmtEnde("||", i); i++; continue; }
    if (c === "|") { stmtEnde("|", i); continue; }
    if (c === "{" || c === "}") { stmtEnde(c, i); continue; }
    hat = true;
    cur += c;
    nurLiteral = false;
  }
  stmtEnde("", text.length);
  return out;
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

/** Der String hinter `bash|sh -c` läuft durch den Bash-Auswerter (Ziele blocken, nicht bestimmbare Ziele fragen). */
function bashBruecke(k, skript, name) {
  const { targets, asks } = analyse(skript, k.ort, { statSync: (p) => ({ isDirectory: () => k.istOrdner(p) }) });
  for (const ziel of targets) {
    const b = k.blockiert(ziel, `commit/push (in \`${name} -c\`)`);
    if (b) return b;
  }
  for (const [dir, a] of asks) {
    const ctx = k.kontext(dir);
    if (ctx?.relevant && (!a.mainOnly || ctx.isMainWorktree)) return { block: false, ask: true, reason: `Worktree-Guard (PowerShell): ${a.reason} Den Ort literal angeben (\`git -C <worktree-pfad> …\`) oder bestätigen. (#1311)` };
  }
  return null;
}

/** Interpreter-Umweg: der String hinter `bash -c` läuft durch den Bash-Auswerter, der hinter `pwsh -c`/`iex` rekursiv
 *  durch diesen Guard (Tiefe ≤ MAX_INTERPRETER); zusätzlich die grobe Regel: kommt im Text git … commit|push vor, gilt
 *  das gegen den aktuellen Ort. `k`: Zustand des umgebenden Aufrufs. */
function interpreterUmweg(k, raw, toks, cmd) {
  if (k.ort !== null && k.tiefe < MAX_INTERPRETER) {
    const rest = toks.slice(1).map((t) => expandiere(t, k.vars));
    const ci = rest.findIndex((a) => /^-[A-Za-z]*c[A-Za-z]*$/.test(a) || /^-command$/i.test(a));
    const name = basename(cmd).replace(/\.exe$/, "");
    const skript = /^(iex|invoke-expression)$/.test(name) ? rest.join(" ") : ci >= 0 ? rest.slice(ci + 1).join(" ") : null;
    let r = null;
    if (skript && /^(bash|sh|zsh|dash|ksh)$/.test(name)) r = bashBruecke(k, skript, name);
    else if (skript && /^(iex|invoke-expression|pwsh|powershell)$/.test(name)) r = bewertePowerShell({ command: skript, cwd: k.ort, repoRoot: k.repoRoot, deps: k.deps, tiefe: k.tiefe + 1 });
    if (r && (r.block || r.ask)) return r;
  }
  if (!/\bgit(\.exe)?\b[^;|]*\b(commit|push)\b/i.test(raw)) return null;
  return k.ort === null ? k.unklar("commit/push") : k.blockiert(k.ort, "commit/push (über einen Interpreter)");
}

/**
 * Bewertet einen PowerShell-Befehl. `deps.istOrdner(pfad)` und `deps.kontext(ordner)` sind injizierbar
 * (Tests); Standard: echtes Dateisystem und `resolveGitContext` aus dem Bash-Hook.
 * @returns {{ block: boolean, ask?: boolean, reason?: string }} (`ask`: das Ziel eines `bash -c`-Strings ist nicht bestimmbar)
 */
export function bewertePowerShell({ command, cwd, repoRoot, deps = {}, tiefe = 0 }) {
  if (!command || !cwd) return { block: false }; // nicht entscheidbar → fail-open
  const istOrdner = deps.istOrdner ?? ((p) => { try { return statSync(p).isDirectory(); } catch { return false; } });
  const kontext = deps.kontext ?? ((dir) => resolveGitContext(dir, repoRoot));
  const vars = new Map();
  let ort = resolve(cwd); // null = nach einem nicht auswertbaren Ortswechsel
  // Ergebnis des unmittelbar vorangehenden ORTSWECHSELS (für && / ||): true = gelungen, false = fehlgeschlagen, null = der
  // Vorgänger war kein (auswertbarer) Ortswechsel. Nur ein ausgewerteter Ortswechsel darf einen Nachfolger überspringen;
  // bei jedem anderen Vorgänger (`git diff --quiet || git commit`) läuft der Nachfolger, im Zweifel wird geblockt.
  let ortStatus = null;

  const blockiert = (dir, was) => {
    const ctx = kontext(dir);
    if (!ctx || !ctx.relevant || !ctx.isMainWorktree) return null;
    return {
      block: true,
      reason:
        `git ${was} ist im geteilten main-Checkout (${ctx.toplevel ?? dir}) blockiert (PowerShell-Tool). ` +
        "Bitte im eigenen `git worktree` arbeiten (AGENTS.md § Git-Workflow): z.B. `git -C <worktree-pfad> commit …` " +
        "oder zuerst `Set-Location <worktree-pfad>`. (#735, #1311)",
    };
  };
  const unklar = (was) => ({
    block: true,
    reason:
      `git ${was} mit einem Ziel, das der Guard nicht auswerten kann (Variable oder Ausdruck). Den Worktree-Pfad ` +
      "literal schreiben (`git -C C:\\pfad\\zum\\worktree …`), damit der Haupt-Checkout-Schutz greift. (#1311)",
  });

  /** git-Statement: commit/push gegen das Ziel prüfen; unauswertbares Ziel ist fail-closed. */
  const gitStatement = (rest) => {
    const { sub, dir, unbekannt } = gitZiel(rest, ort, vars, ort);
    if (sub && GESCHUETZT.has(sub)) return unbekannt ? unklar(sub) : blockiert(dir, sub);
    if (!unbekannt) return null;
    // Ziel nicht auswertbar: steht irgendwo commit/push in den Argumenten, ist es zu unklar zum Durchlassen.
    const was = rest.map((t) => expandiere(t, vars)).find((a) => GESCHUETZT.has(a));
    return was ? unklar(was) : null;
  };

  /** Ortswechsel: nur ein existierender Ordner ändert den Ort, sonst bleibt er (und `&&` bricht ab). */
  const ortWechsel = (rest) => {
    const ziel = ortsZiel(rest, vars);
    if (ziel === undefined) return;
    if (unaufloesbar(ziel)) { ort = null; return; }
    const abs = isAbsolute(ziel) ? ziel : resolve(ort ?? cwd, ziel);
    if (istOrdner(abs)) { ort = abs; ortStatus = true; }
    else ortStatus = false;
  };

  const interpreter = (raw, toks, cmd) => interpreterUmweg({ ort, tiefe, vars, istOrdner, kontext, blockiert, unklar, repoRoot, deps }, raw, toks, cmd);

  let frage = null;
  let vorherSep = ";";
  for (const stmt of zerlege(command)) {
    // Verkettung: nach fehlgeschlagenem Ortswechsel läuft ein && -Nachfolger nicht, nach gelungenem ein || -Nachfolger nicht.
    const ueberspringen = (vorherSep === "&&" && ortStatus === false) || (vorherSep === "||" && ortStatus === true);
    vorherSep = stmt.sep;
    if (ueberspringen) continue;
    ortStatus = null;

    const toks = stmt.tokens;
    if (zuweisung(toks, vars)) continue;
    const aufruf = ["&", "."].includes(befehlsname(toks[0].value));
    const kopfTok = aufruf ? toks[1] : toks[0];
    const rest = toks.slice(aufruf ? 2 : 1);
    const cmd = kopfTok ? befehlsname(kopfTok.value) : "";

    let r = null;
    if (ORT_BEFEHLE.has(cmd.toLowerCase())) ortWechsel(rest);
    else if (kopfTok && istGit(kopfTok.value)) r = gitStatement(rest);
    else if (INTERPRETER.has(cmd.toLowerCase()) || INTERPRETER.has(basename(cmd))) r = interpreter(stmt.raw, toks.slice(aufruf ? 1 : 0), cmd);
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

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
import { statSync, readFileSync } from "node:fs";
import { dirname, resolve, isAbsolute } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolveGitContext } from "./worktree-guard-hook.mjs";

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

/**
 * Bewertet einen PowerShell-Befehl. `deps.istOrdner(pfad)` und `deps.kontext(ordner)` sind injizierbar
 * (Tests); Standard: echtes Dateisystem und `resolveGitContext` aus dem Bash-Hook.
 * @returns {{ block: boolean, reason?: string }}
 */
export function bewertePowerShell({ command, cwd, repoRoot, deps = {} }) {
  if (!command || !cwd) return { block: false }; // nicht entscheidbar → fail-open
  const istOrdner = deps.istOrdner ?? ((p) => { try { return statSync(p).isDirectory(); } catch { return false; } });
  const kontext = deps.kontext ?? ((dir) => resolveGitContext(dir, repoRoot));
  const vars = new Map();
  let ort = resolve(cwd);
  let ortOk = true; // Ergebnis des letzten Ortswechsels (für && / ||)

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

  let vorherSep = ";";
  for (const stmt of zerlege(command)) {
    // Verkettung: nach fehlgeschlagenem Ortswechsel läuft ein && -Nachfolger nicht, ein || -Nachfolger schon.
    const ueberspringen = (vorherSep === "&&" && !ortOk) || (vorherSep === "||" && ortOk);
    const sep = stmt.sep;
    if (ueberspringen) { vorherSep = sep; continue; }
    ortOk = true;

    const toks = stmt.tokens;
    const kopf = befehlsname(toks[0].value);
    const kopfTok = kopf === "&" || kopf === "." ? toks[1] : toks[0];
    const rest = kopf === "&" || kopf === "." ? toks.slice(2) : toks.slice(1);
    const cmd = kopfTok ? befehlsname(kopfTok.value) : "";

    // $x = 'literal'  |  $x='literal'
    const zuw = /^\$(\w+)=(.*)$/s.exec(toks[0].value) ?? (toks[1]?.value === "=" ? [null, toks[0].value.replace(/^\$/, ""), toks.slice(2).map((t) => t.value).join(" ")] : null);
    if (toks[0].value.startsWith("$") && zuw) {
      const wert = zuw[2] ?? "";
      const tokWert = toks[0].value.includes("=") ? { value: wert, literal: toks[0].literal } : { value: wert, literal: false };
      const ex = expandiere(tokWert, vars);
      if (!/[$()]/.test(ex)) vars.set(zuw[1].toLowerCase(), ex);
      vorherSep = sep;
      continue;
    }

    if (ORT_BEFEHLE.has(cmd.toLowerCase())) {
      const args = rest.map((t) => ({ tok: t, v: expandiere(t, vars) }));
      let ziel;
      for (let i = 0; i < args.length; i++) {
        const v = args[i].v;
        if (/^-(path|literalpath|pspath)$/i.test(v)) { ziel = args[i + 1]?.v; break; }
        if (v.startsWith("-")) continue;
        ziel = v;
        break;
      }
      if (ziel !== undefined && !unaufloesbar(ziel)) {
        const abs = isAbsolute(ziel) ? ziel : resolve(ort, ziel);
        if (istOrdner(abs)) ort = abs;
        else ortOk = false; // Fehler: Ort bleibt
      } else if (ziel !== undefined) {
        ort = null; // unbekannter Ort: Folge-Statements mit git commit/push sind unklar
      }
      vorherSep = sep;
      continue;
    }

    if (kopfTok && istGit(kopfTok.value)) {
      let dir = ort;
      let unbekannt = ort === null;
      let i = 0;
      let sub;
      while (i < rest.length) {
        const a = expandiere(rest[i], vars);
        if (a === "-C") {
          const d = rest[i + 1] ? expandiere(rest[i + 1], vars) : "";
          if (unaufloesbar(d)) unbekannt = true;
          else if (!unbekannt) dir = isAbsolute(d) ? d : resolve(dir, d);
          i += 2;
        } else if (a === "-c" || a === "--exec-path" || a === "--namespace") i += 2;
        else if (/^--(git-dir|work-tree)=/.test(a)) { unbekannt = unbekannt || false; i++; }
        else if (a.startsWith("-")) i++;
        else { sub = a; break; }
      }
      if (sub && GESCHUETZT.has(sub)) {
        if (unbekannt) return unklar(sub);
        const r = blockiert(dir, sub);
        if (r) return r;
      } else if (unbekannt) {
        // Ziel nicht auswertbar: steht irgendwo commit/push in den Argumenten, ist es zu unklar zum Durchlassen.
        const was = rest.map((t) => expandiere(t, vars)).find((a) => GESCHUETZT.has(a));
        if (was) return unklar(was);
      }
      vorherSep = sep;
      continue;
    }

    if (INTERPRETER.has(cmd.toLowerCase()) || INTERPRETER.has(basename(cmd))) {
      // grobe Regel: im Text des Statements kommt git … commit|push vor → gegen den aktuellen Ort prüfen
      if (/\bgit(\.exe)?\b[^;|]*\b(commit|push)\b/i.test(stmt.raw)) {
        if (ort === null) return unklar("commit/push");
        const r = blockiert(ort, "commit/push (über einen Interpreter)");
        if (r) return r;
      }
    }
    vorherSep = sep;
  }
  return { block: false };
}

/** Parst das Hook-stdin-JSON tolerant. */
export function parseHookInput(text) {
  try {
    const data = JSON.parse(text);
    return { tool: data.tool_name, cwd: data.cwd, command: data.tool_input?.command };
  } catch {
    return {};
  }
}

/** Die dokumentierte `hookSpecificOutput`-JSON für ein `PreToolUse`-Deny. */
export function buildDenyOutput(reason) {
  return { hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: reason } };
}

function main() {
  let text;
  try {
    text = readFileSync(0, "utf8");
  } catch {
    text = "";
  }
  const { tool, cwd, command } = parseHookInput(text);
  if (tool !== undefined && tool !== "PowerShell") return;
  const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
  const r = bewertePowerShell({ command, cwd, repoRoot });
  if (r.block) console.log(JSON.stringify(buildDenyOutput(r.reason)));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();

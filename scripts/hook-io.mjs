// Kein Shebang: wird von den Guard-Skripten, vom Dispatcher und von den Wächter-Tests importiert.
/**
 * Gemeinsames Hook-I/O für die PreToolUse-Guards (#1311): stdin lesen, Payload parsen, deny/ask-Ausgabe bauen,
 * Entscheidungen zusammenführen. EINE Quelle statt drei Kopien in worktree-guard-hook, worktree-guard-powershell
 * und gh-guard-hook; der Dispatcher `scripts/pretooluse-hook.mjs` nutzt sie, damit ein Tool-Aufruf nur noch EINEN
 * Node-Prozess startet.
 *
 * Reines Node-Skript (nur Builtins), die Funktionen sind pur bzw. nehmen ihre Eingabe als Argument.
 */
import { readFileSync } from "node:fs";
import { posix } from "node:path";
export { istDirektaufruf } from "./direktaufruf.mjs";

/** Liest stdin komplett; bei Fehler (kein stdin) leerer Text. */
export function readStdin() {
  try {
    return readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

/** Parst das Hook-stdin-JSON tolerant: bei kaputtem/leerem Input `{}` statt zu werfen (ein Hook darf nie selbst
 *  jeden Aufruf blockieren). */
export function parseHookInput(text) {
  try {
    const data = JSON.parse(text);
    return { tool: data.tool_name, cwd: data.cwd, command: data.tool_input?.command };
  } catch {
    return {};
  }
}

const hookOutput = (decision, reason) => ({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: decision, permissionDecisionReason: reason } });

/** Die dokumentierte `hookSpecificOutput`-JSON für ein `PreToolUse`-Deny. */
export const buildDenyOutput = (reason) => hookOutput("deny", reason);

/** Dieselbe für ein `PreToolUse`-Ask (Rückfrage bei der Maintainerin). */
export const buildAskOutput = (reason) => hookOutput("ask", reason);

/** Führt Entscheidungen `{ block?, ask?, reason? }` zusammen: deny vor ask vor nichts. Gibt das Output-Objekt
 *  oder null (durchlassen) zurück. */
export function mergeDecisions(decisions) {
  const deny = decisions.find((d) => d?.block);
  if (deny) return buildDenyOutput(deny.reason);
  const ask = decisions.find((d) => d?.ask);
  return ask ? buildAskOutput(ask.reason) : null;
}

/** Gibt die Entscheidung als eine JSON-Zeile aus. Bewusst KEIN process.exit(): auf Windows kann ein Pipe-stdout
 *  asynchron sein, ein sofortiges exit() nach console.log() schnitte die Ausgabe ab. */
export function emit(output) {
  if (output) console.log(JSON.stringify(output));
}

/** Pfad lexikalisch normalisieren (Backslashes → Slashes, `..` auflösen), relative Pfade gegen `cwd`. */
export function normalisierePfad(pfad, cwd) {
  const p = String(pfad).replace(/\\/g, "/");
  const absolut = /^([a-z]:)?\//i.test(p);
  const basis = String(cwd ?? "").replace(/\\/g, "/");
  return posix.normalize(absolut || !basis ? p : `${basis}/${p}`);
}

/** Liegt `pfad` unter (oder gleich) `basis`? Beide schon normalisiert (`normalisierePfad`, Slashes). Segmentgrenze
 *  beachtet (`/a/bc` liegt nicht unter `/a/b`), auf Windows ohne Groß-/Kleinschreibung. Git-Pfade (case-sensitiv) hat
 *  `istDocgenDatei` in check-diffsize.mjs bewusst eigen. */
export function liegtUnter(pfad, basis, plattform = process.platform) {
  const form = (p) => {
    const ohne = String(p).replace(/\/+$/, "");
    return plattform === "win32" ? ohne.toLowerCase() : ohne;
  };
  const n = form(pfad);
  const b = form(basis);
  return n === b || n.startsWith(`${b}/`);
}

/** Baut den Hook-Einstieg eines Tool-Guards: stdin-Text → deny-Output oder null. `bewerte(toolName, toolInput, cwd)` liefert
 *  `{ block, reason? }`. Nur die genannten Tools werden geprüft (ohne `tool_name` nur mit `ohneToolName`); kaputter Input lässt durch. */
export const toolGuardHook =
  (tools, bewerte, ohneToolName = false) =>
  (text) => {
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      return null;
    }
    const name = data?.tool_name;
    if (name === undefined ? !ohneToolName : !tools.includes(name)) return null;
    const e = bewerte(name, data?.tool_input, data?.cwd);
    return e.block ? buildDenyOutput(e.reason) : null;
  };

/** Baut den Hook-Einstieg eines Pfad-Guards: stdin-Text → deny-Output oder null. `bewerte(pfad, cwd)` liefert
 *  `{ block, reason? }`. Nur das genannte Tool wird geprüft (ohne `tool_name` immer); kaputter Input lässt durch. */
export const pfadGuardHook = (tool, bewerte) => toolGuardHook([tool], (_name, eingabe, cwd) => bewerte(eingabe?.file_path, cwd), true);

/** Rekursionstiefe für Interpreter-Strings (`bash -c`, `pwsh -c`, `eval`, Funktionen, Aliase): EINE Grenze für alle Guards. */
export const MAX_INTERPRETER = 3;

/** Wie parseHookInput, aber für SessionStart/SessionEnd: `{ event, session, source }`; bei kaputtem/leerem Input `{}`. */
export function parseSessionHookInput(text) {
  try {
    const data = JSON.parse(text);
    return { event: data.hook_event_name, session: data.session_id, source: data.source };
  } catch {
    return {};
  }
}

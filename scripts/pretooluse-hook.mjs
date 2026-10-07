// Kein Shebang: wird über `.claude/settings.json` per `node scripts/pretooluse-hook.mjs` gestartet UND von
// test/harness/pretooluse-hook.test.ts importiert.
/**
 * PreToolUse-Dispatcher (#1311) für `Bash` und `PowerShell`: EIN Node-Prozess je Tool-Aufruf statt drei.
 *
 * Er liest das Payload einmal (`hook-io.mjs`) und fragt die Guards:
 *  - Bash:       Worktree-Guard (`decide`, scripts/worktree-guard-hook.mjs) und gh-Guard (`bewerte`)
 *  - PowerShell: Worktree-Guard für PowerShell (scripts/worktree-guard-powershell.mjs) und gh-Guard
 * Jeder Guard läuft im eigenen try/catch: ein werfender Guard legt den anderen nicht lahm und blockt nie selbst
 * (fail-open bei internem Fehler). Ausgabe: genau ein JSON, deny vor ask; fremde Tools und kaputtes JSON → nichts.
 *
 * Die drei Guard-Skripte bleiben einzeln aufrufbar (dünner Direktaufruf), weil laufende Sessions ihre
 * Hook-Konfiguration beim Start einfrieren.
 *
 * Reines Node-Skript (nur Builtins).
 */
import { SHELL_VON_TOOL } from "./shell-tabellen.mjs";
import { bewerte as bewerteGh } from "./gh-guard-hook.mjs";
import { emit, istDirektaufruf, mergeDecisions, parseHookInput, readStdin } from "./hook-io.mjs";
import { decide, repoRootFromScriptUrl } from "./worktree-guard-hook.mjs";
import { bewertePowerShell } from "./worktree-guard-powershell.mjs";

const sicher = (fn) => {
  try {
    return fn();
  } catch {
    return null;
  }
};

/** Entscheidet für ein Payload (Text) und gibt das Hook-Output-Objekt oder null (durchlassen) zurück. */
export function dispatch(text, repoRoot, guards = { decide, bewertePowerShell, bewerteGh }, shellVonTool = SHELL_VON_TOOL) {
  const { tool, cwd, command } = parseHookInput(text);
  if (tool === undefined || !Object.hasOwn(shellVonTool, tool)) return null;
  const shell = shellVonTool[tool]; // Quote-Dialekt für den gh-Guard (Backslash gegen Backtick) UND Wahl des Worktree-Guards
  const worktreeGuard = { bash: () => guards.decide({ cwd, command, repoRoot }), powershell: () => guards.bewertePowerShell({ command, cwd, repoRoot }) }[shell]; // ein neues Tool braucht hier bewusst einen eigenen Guard
  // Fail-closed (#1331): eine Shell in der Tabelle ohne Worktree-Guard darf nicht still durchlaufen.
  const worktree = worktreeGuard
    ? sicher(worktreeGuard)
    : { block: true, reason: `Dispatcher: für die Shell "${shell}" gibt es keinen Worktree-Guard (SHELL_VON_TOOL und Dispatcher driften auseinander).` };
  if (worktree?.block) return mergeDecisions([worktree]); // deny geht vor ask: ein langsamer gh-Guard darf es nicht aushebeln
  return mergeDecisions([worktree, sicher(() => guards.bewerteGh(command, { shell }))]);
}

if (istDirektaufruf(import.meta.url)) emit(dispatch(readStdin(), repoRootFromScriptUrl(import.meta.url)));

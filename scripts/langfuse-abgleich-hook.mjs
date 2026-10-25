// Hook-Einstieg (#1578): SessionStart und SessionEnd starten den Nachlieferer losgelöst und enden sofort mit Exit 0. Nie an Stop (läuft je Turn, kollidiert mit dem
// vom Plugin zurückgehaltenen Turn und erzeugt Dubletten). Wartezeit, Lock und Log stecken im Kind (scripts/langfuse-nachliefern.mjs, --ausloeser).
// Nur Builtins, hook-io.mjs und langfuse-zugang.mjs; Einordnung: docs/langfuse-hook-patch.md › Abgleich als Garantie.
import { spawn as spawnEcht } from "node:child_process";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { istDirektaufruf } from "./direktaufruf.mjs";
import { parseSessionHookInput, readStdin } from "./hook-io.mjs";
import { kindEnv } from "./langfuse-zugang.mjs";

/** Session-IDs sind UUIDs; ein führendes `-` würde als Flag des Kindes gelesen. */
const SESSION_ID = /^[0-9A-Za-z][\w-]*$/;

/** Kind-Argumente je Hook-Ereignis; `null`: kein Lauf (compact/fork/unbekannt, fehlende oder verdächtige Session-ID). */
export function kindArgs({ event, session, source } = {}) {
  if (typeof session !== "string" || !SESSION_ID.test(session)) return null;
  if (event === "SessionEnd") return ["--ausloeser", "sessionend", "--session", session, "--beendet", session];
  if (event === "SessionStart" && ["startup", "resume", "clear"].includes(source)) return ["--ausloeser", "sessionstart", "--aktuell", session];
  return null;
}

/** Startet das Kind losgelöst; `true`, wenn gestartet. Wirft nie. */
export function starte(text, { spawn = spawnEcht, env = process.env, execPath = process.execPath, home = homedir() } = {}) {
  try {
    const args = kindArgs(parseSessionHookInput(text));
    if (!args) return false;
    const skript = fileURLToPath(new URL("./langfuse-nachliefern.mjs", import.meta.url));
    // cwd im Home: ein cwd im Worktree blockierte dessen Entfernen unter Windows.
    const kind = spawn(execPath, [skript, ...args], { detached: true, windowsHide: true, stdio: "ignore", cwd: home, env: kindEnv(env, home) });
    kind.on("error", () => {}); // ein asynchrones ENOENT darf den Hook nicht kippen
    kind.unref();
    return true;
  } catch {
    return false;
  }
}

if (istDirektaufruf(import.meta.url)) {
  starte(readStdin());
  process.exitCode = 0;
}

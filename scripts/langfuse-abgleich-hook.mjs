// Hook-Einstieg (#1578): SessionStart und SessionEnd starten den Nachlieferer losgelöst und enden sofort mit Exit 0. Nie an Stop (läuft je Turn, kollidiert mit dem
// vom Plugin zurückgehaltenen Turn und erzeugt Dubletten). Wartezeit, Lock und Log stecken im Kind (scripts/langfuse-nachliefern.mjs, --ausloeser).
// Nur Builtins und hook-io.mjs; Einordnung: docs/langfuse-hook-patch.md › Abgleich als Garantie.
import { spawn as spawnEcht } from "node:child_process";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { istDirektaufruf, parseSessionHookInput, readStdin } from "./hook-io.mjs";

/** Session-IDs sind UUIDs; ein führendes `-` würde als Flag des Kindes gelesen. */
const SESSION_ID = /^[0-9A-Za-z][\w-]*$/;
const ZUGANGSNAMEN = ["LANGFUSE_PUBLIC_KEY", "LANGFUSE_SECRET_KEY", "LANGFUSE_BASE_URL"];

/** Kind-Argumente je Hook-Ereignis; `null`: kein Lauf (compact/fork/unbekannt, fehlende oder verdächtige Session-ID). */
export function kindArgs({ event, session, source } = {}) {
  if (typeof session !== "string" || !SESSION_ID.test(session)) return null;
  if (event === "SessionEnd") return ["--ausloeser", "sessionend", "--session", session, "--beendet", session];
  if (event === "SessionStart" && ["startup", "resume", "clear"].includes(source)) return ["--ausloeser", "sessionstart", "--aktuell", session];
  return null;
}

/** Die drei Zugangsnamen aus dem Text einer `KEY=VALUE`-Datei (optional `export `, optional Anführungszeichen); alles andere wird ignoriert. */
export function leseZugang(text) {
  const out = {};
  for (const zeile of String(text).split(/\r?\n/)) {
    const m = /^\s*(?:export\s+)?([A-Z_]+)\s*=\s*(.*?)\s*$/.exec(zeile);
    if (!m || !ZUGANGSNAMEN.includes(m[1])) continue;
    const roh = m[2];
    out[m[1]] = /^(["']).*\1$/.test(roh) && roh.length >= 2 ? roh.slice(1, -1) : roh;
  }
  return out;
}

/** Umgebung des Kindes: fehlende Zugangsnamen kommen aus `~/.config/agent-secrets.env` (ein Projekt-Hook sieht den Secret-Key sonst nicht); die Umgebung hat Vorrang. */
export function kindEnv(env, home, lies = (p) => readFileSync(p, "utf8")) {
  let datei = {};
  try {
    datei = leseZugang(lies(join(home, ".config", "agent-secrets.env")));
  } catch {
    // keine Datei: Umgebung unverändert
  }
  const out = { ...env };
  for (const name of ZUGANGSNAMEN) if (!out[name] && datei[name]) out[name] = datei[name];
  return out;
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

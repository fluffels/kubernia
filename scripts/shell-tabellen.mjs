// Kein Shebang: Baustein der Guards (gh-Guard, Worktree-Guard, PowerShell-Guard), wird von diesen importiert.
/**
 * Gemeinsame Namen der Guards (#1311): welche Programme als Shell gelten und wie der Basisname eines Kommandowortes
 * gebildet wird. EINE Liste für gh-Guard, Worktree-Guard (`worktree-guard-tabellen.mjs`) und PowerShell-Guard.
 * Pur, nur Builtins.
 */

/** POSIX-artige Shells, die per `-c <text>`, Heredoc oder Pipe Befehle ausführen. */
export const SHELLS = new Set(["bash", "sh", "zsh", "dash", "ksh", "ash"]);

/** Basisname eines Kommandowortes: Verzeichnis, `.exe` und Groß-/Kleinschreibung weg (`C:\Git\bin\Git.exe` → `git`). */
export const baseName = (text) => text.replace(/\\/g, "/").split("/").pop().toLowerCase().replace(/\.exe$/, "");

/** Programme, die einen Befehlstext ausführen (`-c`, `/c`, `-Command`): die POSIX-Shells, PowerShell und cmd. EINE Liste für die Guards. */
export const INTERPRETER_NAMEN = [...SHELLS, "pwsh", "powershell", "cmd"];

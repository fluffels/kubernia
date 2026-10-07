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

/** Tool-Name des Hooks → Quote-Dialekt des gh-Guards. EINE Tabelle für Dispatcher und gh-Guard-Direktaufruf; ihre Schlüssel sind die geprüften Tools. */
export const SHELL_VON_TOOL = Object.freeze({ Bash: "bash", PowerShell: "powershell" });

/** Wrapper-Tabelle (hier, damit der gh-Guard nicht an den fs/os-Importen des Worktree-Guards hängt): Optionen mit Wert (`val`), Optionen mit Ortswechsel (`chdir`), Positionsargumente (`pos`),
 *  `assign`: NAME=WERT-Argumente, `lookup`: Optionen, die nur nachschlagen (`command -v`). */
const W = (val = [], extra = {}) => ({ val: new Set(val), chdir: new Set(extra.chdir ?? []), pos: extra.pos ?? 0, assign: extra.assign ?? false, lookup: new Set(extra.lookup ?? []) });
export const WRAPPERS = {
  time: W(["-f", "-o", "--format", "--output"]),
  command: W([], { lookup: ["-v", "-V"] }),
  exec: W(["-a"]),
  builtin: W(),
  env: W(["-u", "--unset", "-S", "--split-string", "-C", "--chdir"], { chdir: ["-C", "--chdir"], assign: true }),
  sudo: W(["-u", "-g", "-p", "-C", "-r", "-t", "-U", "-T", "-R", "-h", "-D", "--user", "--group", "--chdir"], { chdir: ["-D", "--chdir"] }),
  doas: W(["-u", "-C"]),
  xargs: W(["-I", "-L", "-n", "-P", "-s", "-d", "-E", "-a", "--max-args", "--max-procs", "--delimiter", "--arg-file"]),
  nice: W(["-n", "--adjustment"]),
  timeout: W(["-s", "-k", "--signal", "--kill-after"], { pos: 1 }),
  stdbuf: W(["-i", "-o", "-e"]),
  ionice: W(["-c", "-n", "-p"]),
  nohup: W(),
  winpty: W(),
  setsid: W(),
  unbuffer: W(),
};

/** Namen der Wrapper (Schlüssel der Wrapper-Tabelle). */
export const WRAPPER_NAMEN = new Set(Object.keys(WRAPPERS));

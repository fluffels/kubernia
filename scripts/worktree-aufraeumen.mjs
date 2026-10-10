// Kein Shebang, kein Direktaufruf: Lib für `cleanup-worktrees.mjs` (CLI) und `stop-verify-hook.mjs` (#1579, Konvention #1398:
// Einstiegsskripte importieren nicht voneinander, gemeinsamer Code steht in einer Lib). Entscheidungslogik pur/exportiert und
// testbar (execSync/fs injizierbar); Doku zu Waisen, Lens-Worktrees und losen Dateien: Kopf von cleanup-worktrees.mjs.
import { execFileSync, execSync } from "node:child_process";
import { existsSync, lstatSync, readdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { LENS_WORKTREE_NAME } from "./ticket-refs.mjs";

/** Pfad-Normalisierung: Backslashes → Slashes, kein Trailing-Slash. Real entstehen
 *  gemischte Pfade (`mainRoot` slash-normalisiert, `join()` hängt auf Windows
 *  Backslashes an) — ohne das verweigert der Guard legitime Löschungen. */
function norm(p) {
  return String(p).replace(/\\/g, "/").replace(/\/+$/, "");
}

/** Parst `git worktree list --porcelain`-Output zu einer Liste absoluter Pfade
 *  (normalisiert auf `/`). Gits eigene Konvention: der ERSTE Eintrag ist immer
 *  der Haupt-Checkout, unabhängig davon, aus welchem Worktree der Befehl lief —
 *  wichtig, weil dieser Hook aus JEDEM Linked Worktree heraus feuern kann. */
export function parseWorktreeListPorcelain(output) {
  const paths = [];
  for (const line of String(output).split(/\r?\n/)) {
    if (line.startsWith("worktree ")) {
      paths.push(line.slice("worktree ".length).trim().replace(/\\/g, "/"));
    }
  }
  return paths;
}

/** Fragt `git worktree list --porcelain` ab (cwd egal welcher Worktree, gleiche
 *  geteilte git-Datenbank) und gibt die geordnete Pfad-Liste zurück. Wirft bei
 *  git-Fehlern weiter (Aufrufer entscheidet fail-safe). */
export function registeredWorktreePaths(cwd, deps = {}) {
  const exec = deps.execSync ?? execSync;
  const out = exec("git worktree list --porcelain", { cwd, encoding: "utf-8" });
  return parseWorktreeListPorcelain(out);
}

/** Ordnernamen (nicht Pfade) direkt unter `worktreesDir`. Leeres Array, wenn der
 *  Ordner nicht existiert (kein Fehler — Normalfall bei frischem Checkout). */
export function localWorktreeDirs(worktreesDir, deps = {}) {
  const exists = deps.existsSync ?? existsSync;
  const readdir = deps.readdirSync ?? readdirSync;
  if (!exists(worktreesDir)) return [];
  return readdir(worktreesDir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name);
}

/** Namen regulärer Dateien (keine Ordner, keine Links) direkt unter `worktreesDir` (#1476). Fake-Dirents ohne `isFile` zählen nicht. */
export function localWorktreeFiles(worktreesDir, deps = {}) {
  const exists = deps.existsSync ?? existsSync;
  const readdir = deps.readdirSync ?? readdirSync;
  if (!exists(worktreesDir)) return [];
  return readdir(worktreesDir, { withFileTypes: true })
    .filter((e) => typeof e.isFile === "function" && e.isFile())
    .map((e) => e.name);
}

/** Dateiname `kq-<nr>` gefolgt von `-`, `.` oder Ende: Gruppe 1 ist der Eltern-Worktree (`kq-13610-x` gehört zu `kq-13610`, nicht `kq-1361`). */
const KQ_DATEI = /^(kq-\d+)(?=[-.]|$)/;

/**
 * Teilt lose Dateien (#1476): `verwaist` (`kq-<nr>` nicht registriert, älter als 5 Minuten, löschbar), `jung` (verwaist,
 * aber jünger, nur melden) und `fremd` (Name nicht `kq-<nr>…`, nur melden). Dateien eines registrierten Worktrees fehlen.
 */
export function sortiereDateien(worktreesDir, dateien, registered, deps = {}) {
  const kandidaten = [];
  const fremd = [];
  for (const name of dateien) {
    const m = KQ_DATEI.exec(name);
    if (!m) fremd.push(name);
    else if (!registered.has(join(worktreesDir, m[1]).replace(/\\/g, "/"))) kandidaten.push(name);
  }
  const { alt, jung } = splitByAge(worktreesDir, kandidaten, deps);
  return { verwaist: alt, jung, fremd };
}

/**
 * Entfernt verwaiste lose Dateien (#1476) mit `rmSync` OHNE `recursive`, nur nach dem Schutzgurt (reguläre Datei, kein
 * Link, direktes Kind von `<mainRoot>/.claude/worktrees`). Wirft nie. Buckets: `removed`, `refused` (Gurt lehnte ab,
 * nichts angefasst), `errors` (Datei nach dem Löschversuch noch da).
 */
export function entferneVerwaisteDateien(mainRoot, worktreesDir, names, deps = {}) {
  const rm = deps.rmSync ?? rmSync;
  const exists = deps.existsSync ?? existsSync;
  const removed = [];
  const errors = [];
  const refused = [];
  for (const name of names) {
    const guard = assertSafeOrphanTarget(mainRoot, worktreesDir, name, deps, "file");
    if (!guard.safe) {
      refused.push({ name, reason: guard.reason });
      continue;
    }
    const absPath = join(worktreesDir, name);
    try {
      rm(absPath, { force: true });
    } catch {
      /* Ergebnis wird unten geprüft */
    }
    (exists(absPath) ? errors : removed).push(name);
  }
  return { removed, errors, refused };
}

/**
 * Einträge unter `worktreesDir`, die ein **Symlink/Reparse-Point** sind (#1051).
 *
 * `Dirent.isDirectory()` ist für eine Junction **false** — `localWorktreeDirs()`
 * übersah sie STILLSCHWEIGEND, obwohl `git worktree remove --force` Junctions
 * folgt und echte Ziele leert. Sichtbar machen, nie selbst löschen.
 */
export function suspiciousWorktreeEntries(worktreesDir, deps = {}) {
  const exists = deps.existsSync ?? existsSync;
  const readdir = deps.readdirSync ?? readdirSync;
  if (!exists(worktreesDir)) return [];
  return readdir(worktreesDir, { withFileTypes: true })
    .filter((e) => typeof e.isSymbolicLink === "function" && e.isSymbolicLink())
    .map((e) => e.name);
}

/**
 * Schutzgurt vor dem `rmSync` (#1051) — `{ safe, reason? }`.
 *
 * Anlass: Beim Aufräumen von `kq-1027` wurden ALLE versionierten Dateien unter
 * `.claude/` im Haupt-Checkout gelöscht, obwohl der Code dem Wortlaut nach nur
 * den Waisen-Pfad anfasst; die Ursache bleibt offen (#1058). Der Guard sichert
 * daher URSACHENUNABHÄNGIG und **fail-closed** ab: gelöscht wird nur, was
 * beweisbar ein echtes Verzeichnis ECHT UNTERHALB von
 * `<mainRoot>/.claude/worktrees/` ist. Dieser Pfad läuft unbeaufsichtigt bei
 * jedem Turn-Ende (#952) und träfe sonst die Dateien, die den Agenten steuern.
 */
export function assertSafeOrphanTarget(mainRoot, worktreesDir, name, deps = {}, art = "dir") {
  const lstat = deps.lstatSync ?? lstatSync;

  if (!mainRoot || !worktreesDir) {
    return { safe: false, reason: "mainRoot/worktreesDir nicht aufgelöst" };
  }

  // 1) GENAU EIN Pfad-Segment: "" und "." zeigen auf worktreesDir SELBST, ".."
  //    auf `.claude/` — genau der real eingetretene Schaden.
  if (typeof name !== "string" || name === "" || name === "." || name === "..") {
    return { safe: false, reason: `unzulässiger Ordnername ${JSON.stringify(name)}` };
  }
  if (name.includes("/") || name.includes("\\")) {
    return { safe: false, reason: `Ordnername enthält einen Pfad-Trenner: ${name}` };
  }

  // 2) worktreesDir exakt <mainRoot>/.claude/worktrees — fängt einen
  //    Auflösungsfehler, der den Löschpfad eine Ebene zu hoch zeigen liesse.
  const expected = norm(join(mainRoot, ".claude", "worktrees"));
  if (norm(worktreesDir) !== expected) {
    return {
      safe: false,
      reason: `worktreesDir ist nicht <mainRoot>/.claude/worktrees (erwartet ${expected}, bekam ${norm(worktreesDir)})`,
    };
  }

  // 3) Defense in Depth: das Ziel muss ECHT unterhalb liegen, nie gleich sein.
  const target = norm(join(worktreesDir, name));
  if (!target.startsWith(expected + "/") || target.length <= expected.length + 1) {
    return { safe: false, reason: `Ziel liegt nicht echt unterhalb von ${expected}: ${target}` };
  }

  // 4) Nur ein ECHTES Verzeichnis: rekursives Löschen darf keinem Link folgen
  //    (dieselbe Klasse wie die node_modules-Junction-Falle in AGENTS.md).
  let st;
  try {
    st = lstat(join(worktreesDir, name));
  } catch {
    return { safe: false, reason: `Ziel nicht statbar (existiert nicht?): ${target}` };
  }
  if (st.isSymbolicLink()) {
    return { safe: false, reason: `Ziel ist ein Symlink/Junction (Reparse-Point), wird nicht gelöscht: ${target}` };
  }
  if (art === "file" ? !st.isFile() : !st.isDirectory()) {
    return { safe: false, reason: `Ziel ist ${art === "file" ? "keine reguläre Datei" : "kein Verzeichnis"}: ${target}` };
  }

  return { safe: true };
}

/** Ordner, die jünger sind, gelten (noch) nicht als verwaist (#1311): eine parallele Session legt ihren Worktree per
 *  `git worktree add` an, und für kurze Zeit ist der Ordner da, aber noch nicht (vollständig) registriert. Bei vielen
 *  parallelen Agenten und dem SubagentStop-Hook kommt das häufiger vor. Junge Ordner werden gemeldet, nie gelöscht. */
export const MIN_ORPHAN_AGE_MS = 5 * 60_000;

/** Teilt Waisen-Kandidaten nach dem Alter des Ordners (mtime) in `alt` (löschbar) und `jung` (nur melden). Ein nicht lesbarer
 *  Ordner zählt als alt (er ist weg oder gesperrt, das alte Verhalten bleibt). Pure bis auf `deps.statSync`/`deps.now`. */
export function splitByAge(worktreesDir, names, deps = {}) {
  const stat = deps.statSync ?? statSync;
  const now = deps.now ?? Date.now();
  const alt = [];
  const jung = [];
  for (const name of names) {
    let alter = Number.POSITIVE_INFINITY;
    try {
      alter = now - stat(join(worktreesDir, name)).mtimeMs;
    } catch {
      /* nicht lesbar → alt */
    }
    (alter < MIN_ORPHAN_AGE_MS ? jung : alt).push(name);
  }
  return { alt, jung };
}

/** Pure Berechnung: welche `dirs` (Ordnernamen relativ zu `worktreesDir`) sind
 *  NICHT in `registered` (Set absoluter, `/`-normalisierter Pfade). */
export function computeOrphans(worktreesDir, dirs, registered) {
  return dirs.filter((name) => !registered.has(join(worktreesDir, name).replace(/\\/g, "/")));
}

/**
 * Diagnose: liefert `{ ok, orphans, young, lensOrphans, lensYoung, orphanFiles, youngFiles, foreignFiles, mainRoot, worktreesDir }` (`young`: unregistrierte
 * Ordner unter 5 Minuten, nur melden, nie löschen; `lensOrphans`/`lensYoung`: registrierte Lens-Worktrees ohne
 * Feature-Worktree, alt bzw. unter 5 Minuten, #1425; `orphanFiles`/`youngFiles`/`foreignFiles`: lose Dateien, #1476).
 * `ok:false` bei jedem git-Fehler (z.B. `cwd` ist gar kein Git-Repo) — dann
 * bewusst KEINE Waisen melden, statt bei fehlgeschlagenem `git worktree list`
 * versehentlich JEDEN lokalen Ordner (auch aktive!) als Waise zu behandeln.
 * `mainRoot`/`worktreesDir` werden aus dem ERSTEN `git worktree list`-Eintrag
 * abgeleitet (Haupt-Checkout), nicht aus `cwd` — robust, egal von welchem
 * Worktree aus dieser Check läuft (#952).
 */
export function diagnoseOrphans(cwd, deps = {}) {
  let allPaths;
  try {
    allPaths = registeredWorktreePaths(cwd, deps);
  } catch {
    return { ok: false, orphans: [], mainRoot: null, worktreesDir: null };
  }
  if (allPaths.length === 0) {
    return { ok: false, orphans: [], mainRoot: null, worktreesDir: null };
  }

  const mainRoot = allPaths[0];
  const worktreesDir = join(mainRoot, ".claude", "worktrees");
  const registered = new Set(allPaths);
  const dirs = localWorktreeDirs(worktreesDir, deps);
  const { alt: orphans, jung: young } = splitByAge(worktreesDir, computeOrphans(worktreesDir, dirs, registered), deps);
  const { alt: lensOrphans, jung: lensYoung } = splitByAge(worktreesDir, verwaisteLensWorktrees(allPaths, worktreesDir), deps);
  const dateien = sortiereDateien(worktreesDir, localWorktreeFiles(worktreesDir, deps), registered, deps);
  return { ok: true, orphans, young, lensOrphans, lensYoung, orphanFiles: dateien.verwaist, youngFiles: dateien.jung, foreignFiles: dateien.fremd, mainRoot, worktreesDir };
}

/**
 * Registrierte Lens-Worktrees unter `worktreesDir`, deren Feature-Worktree `kq-<nr>` NICHT mehr registriert ist (#1425).
 * `registeredPaths` sind die absoluten Pfade aus `git worktree list`. Pure; liefert Ordnernamen (nicht Pfade).
 */
export function verwaisteLensWorktrees(registeredPaths, worktreesDir) {
  const basis = norm(worktreesDir) + "/";
  const registriert = new Set(registeredPaths.map(norm));
  const namen = [...registriert].filter((p) => p.startsWith(basis) && !p.slice(basis.length).includes("/")).map((p) => p.slice(basis.length));
  return namen.filter((name) => {
    const m = LENS_WORKTREE_NAME.exec(name);
    return m !== null && !registriert.has(basis + m[1]);
  });
}

/** Interpreter-Namen (ohne `.exe`), die ein Skript von stdin lesen können (#1428 Z16), und die Kommandozeile mit dem Argument `-` am Ende. */
const STDIN_INTERPRETER = /^(?:python[\d.]*|py|node)$/;
const STDIN_SKRIPT = /\s-\s*$/;
/** Werkzeug-Prozesse, die als vergessene Hilfsserver oder Stubs einen Worktree-Ordner festhalten können (Name ohne `.exe`). */
export const WERKZEUG_PROZESSE = new Set(["node", "python", "python3", "bash", "sh", "pwsh", "powershell", "cmd", "git", "npm", "npx"]);

/** Max. so viele Halter-Kandidaten in der Meldung (der Rest wäre Rauschen). */
const MAX_HALTER = 8;

/**
 * Mögliche Halter eines gesperrten Worktree-Ordners (#1411), nur zum NENNEN mit PID, nie zum Beenden. `prozesse` sind
 * `{ pid, ppid, name, commandLine, startMs }`. Kandidat ist (a) ein Prozess, dessen Kommandozeile den Ordnerpfad enthält
 * (Schrägstrich-, Backslash- und MSYS-Form `/c/…`, ohne Groß-/Kleinschreibung), oder (b) ein verwaister Prozess
 * (Elternprozess existiert nicht mehr) eines Werkzeug-Namens, gestartet nach dem Anlegen des Ordners (`ordnerGeburtMs`;
 * `null` = unbekannt, dann zählt jeder verwaiste Werkzeug-Prozess), oder (c, #1428) ein Interpreter-Prozess, der ein Skript von stdin
 * liest (`python -`, `python3 -`, `py -`, `node -`; ein Heredoc im Bash-Tool), gestartet nach dem Anlegen des Ordners: der Bash-Wrapper
 * des Tools (`bash.exe -c "… eval '<Befehl>' < /dev/null && pwd -P"`) nennt den Ordner nicht, (a) und (b) verfehlen ihn. Nur NENNEN,
 * nie beenden. Der eigene Prozess ist ausgenommen. Pure.
 */
export function moeglicheHalter(prozesse, pfad, ordnerGeburtMs, eigenePid = process.pid) {
  const slash = norm(pfad).toLowerCase();
  const laufwerk = /^([a-z]):\/(.*)$/.exec(slash);
  const formen = [slash, ...(laufwerk ? [`/${laufwerk[1]}/${laufwerk[2]}`] : [])];
  const pids = new Set(prozesse.map((p) => p.pid));
  const halter = [];
  for (const p of prozesse) {
    if (p.pid === eigenePid) continue;
    const cmd = String(p.commandLine ?? "").replace(/\\/g, "/").toLowerCase();
    const name = String(p.name ?? "").toLowerCase().replace(/\.exe$/, "");
    if (cmd !== "" && formen.some((f) => cmd.includes(f))) {
      halter.push({ pid: p.pid, name: p.name, commandLine: p.commandLine ?? "", grund: "Kommandozeile liegt im Worktree" });
    } else if (WERKZEUG_PROZESSE.has(name) && !pids.has(p.ppid) && (ordnerGeburtMs === null || p.startMs >= ordnerGeburtMs)) {
      halter.push({ pid: p.pid, name: p.name, commandLine: p.commandLine ?? "", grund: "verwaist (Elternprozess beendet), nach dem Anlegen des Ordners gestartet" });
    } else if (STDIN_INTERPRETER.test(name) && STDIN_SKRIPT.test(cmd) && (ordnerGeburtMs === null || p.startMs >= ordnerGeburtMs)) {
      halter.push({ pid: p.pid, name: p.name, commandLine: p.commandLine ?? "", grund: "liest ein Skript von stdin (z.B. `python -`), nach dem Anlegen des Ordners gestartet" });
    }
  }
  return halter.slice(0, MAX_HALTER);
}

/** Prozessliste unter Windows per PowerShell (`Get-CimInstance Win32_Process`); wirft bei Fehler (Aufrufer: fail-open). */
export function listProcessesWindows() {
  const skript =
    "Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,CommandLine," +
    "@{n='Created';e={if ($_.CreationDate) { $_.CreationDate.ToUniversalTime().ToString('o') } else { '' }}} | ConvertTo-Json -Compress";
  const out = execFileSync("powershell", ["-NoProfile", "-NonInteractive", "-Command", skript], { encoding: "utf8", timeout: 10_000, maxBuffer: 32 * 1024 * 1024 });
  const roh = JSON.parse(out);
  return (Array.isArray(roh) ? roh : [roh]).map((p) => ({
    pid: p.ProcessId,
    ppid: p.ParentProcessId,
    name: p.Name,
    commandLine: p.CommandLine,
    startMs: Date.parse(p.Created) || 0,
  }));
}

/**
 * Halter-Kandidaten für einen gesperrten, nicht leeren Ordner. Nur unter Windows; jeder Fehler (PowerShell fehlt, Timeout,
 * kaputtes JSON) ergibt eine leere Liste, der Hook bleibt fail-open. `deps.listProcesses`/`deps.platform` injizierbar.
 */
export function findeHalter(absPath, ordnerGeburtMs, deps = {}) {
  if ((deps.platform ?? process.platform) !== "win32") return [];
  try {
    return moeglicheHalter((deps.listProcesses ?? listProcessesWindows)(), absPath, ordnerGeburtMs);
  } catch {
    return [];
  }
}

/** Die Halter als Meldungstext: PID, Name, gekürzte Kommandozeile, dazu der Rat (gezielt per PID, nie per Name). */
export function formatHalter(halter) {
  if (halter.length === 0) return "kein Halter per Kommandozeile oder Verwaisung gefunden";
  const zeilen = halter.map((h) => `PID ${h.pid} ${h.name} (${h.grund}): ${String(h.commandLine).slice(0, 140)}`);
  return `mögliche Halter: ${zeilen.join("; ")}. Nach Prüfung gezielt beenden mit "taskkill /PID <pid> /T /F" (PowerShell) oder "taskkill //PID <pid> //T //F" (Git-Bash), nie per Name (parallele Agenten laufen)`;
}

/**
 * Pruned veraltete git-Registrierungen und löscht `orphans` (Ordnernamen unter
 * `worktreesDir`) physisch per `fs.rmSync` (mit Wiederholung bei kurzen Sperren, #1411). Wirft nie. Vier Ergebnis-Buckets:
 *  - `removed`: erfolgreich gelöscht
 *  - `pending`: Ordner existiert weiter, ist aber LEER (ein Halter ohne Datei darin, die Sperre ist meist
 *               vorübergehend): kein Fehler, der nächste Lauf versucht es erneut (#1411)
 *  - `errors`:  Löschversuch gelaufen, Ordner existiert weiter und ist nicht leer (Datei-Lock durch einen
 *               Prozess, siehe AGENTS.md Windows-Fallen); `halter[name]` nennt unter Windows mögliche Halter mit PID
 *  - `refused`: `assertSafeOrphanTarget` hat das Ziel abgelehnt — es wurde
 *               **gar nicht** angefasst (#1051). Semantisch bewusst getrennt von
 *               `errors`: „bewusst nicht gelöscht" statt „löschen fehlgeschlagen".
 */
export function fixOrphans(mainRoot, worktreesDir, orphans, deps = {}) {
  const exec = deps.execSync ?? execSync;
  const rm = deps.rmSync ?? rmSync;
  const exists = deps.existsSync ?? existsSync;

  try {
    exec("git worktree prune", { cwd: mainRoot, encoding: "utf-8" });
  } catch {
    // Nicht fatal: Ordner-Löschung unten trotzdem versuchen.
  }

  const removed = [];
  const errors = [];
  const pending = [];
  const refused = [];
  const halter = {};
  for (const name of orphans) {
    // Schutzgurt VOR jedem Löschen (#1051) — bei Zweifel gar nicht anfassen.
    const guard = assertSafeOrphanTarget(mainRoot, worktreesDir, name, deps);
    if (!guard.safe) {
      refused.push({ name, reason: guard.reason });
      continue;
    }

    const absPath = join(worktreesDir, name);
    let geburtMs = null;
    try {
      geburtMs = (deps.statSync ?? statSync)(absPath).birthtimeMs;
    } catch {
      /* unbekannt → jeder verwaiste Werkzeug-Prozess zählt als Kandidat */
    }
    let gesperrt;
    try {
      // Kurze Sperren (Virenscanner, ein eben beendeter Prozess) lösen sich meist binnen Sekunden: Node wiederholt EBUSY/EPERM/ENOTEMPTY.
      rm(absPath, { recursive: true, force: true, maxRetries: 3, retryDelay: 300 });
      gesperrt = exists(absPath);
      if (!gesperrt) removed.push(name);
    } catch {
      gesperrt = true;
    }
    if (!gesperrt) continue;
    if (istLeer(absPath, deps)) {
      pending.push(name);
    } else {
      errors.push(name);
      halter[name] = findeHalter(absPath, geburtMs, deps);
    }
  }
  return { removed, errors, pending, refused, halter };
}

/**
 * Entfernt verwaiste Lens-Worktrees (#1425) per `git worktree remove --force` (cwd = Haupt-Checkout) und PRÜFT das
 * Ergebnis: der Pfad darf nicht mehr registriert sein und der Ordner muss weg. Wirft nie. Buckets: `removed`,
 * `refused` (Schutzgurt `assertSafeOrphanTarget` lehnte ab, nichts angefasst), `errors` (Entfernen gescheitert;
 * `halter[name]` nennt unter Windows mögliche Halter mit PID).
 */
export function entferneLensWorktrees(mainRoot, worktreesDir, names, deps = {}) {
  const exec = deps.execSync ?? execSync;
  const exists = deps.existsSync ?? existsSync;
  const removed = [];
  const errors = [];
  const refused = [];
  const halter = {};
  for (const name of names) {
    const absPath = join(worktreesDir, name);
    const guard = assertSafeOrphanTarget(mainRoot, worktreesDir, name, deps);
    if (!guard.safe) {
      refused.push({ name, reason: guard.reason });
      continue;
    }
    let geburtMs = null;
    try {
      geburtMs = (deps.statSync ?? statSync)(absPath).birthtimeMs;
    } catch {
      /* unbekannt */
    }
    try {
      exec(`git worktree remove --force "${absPath}"`, { cwd: mainRoot, encoding: "utf-8" });
    } catch {
      /* Ergebnis wird unten geprüft, nicht der Exit-Code */
    }
    let noch = true;
    try {
      noch = registeredWorktreePaths(mainRoot, deps).includes(norm(absPath)) || exists(absPath);
    } catch {
      /* nicht prüfbar: als nicht entfernt behandeln */
    }
    if (noch) {
      errors.push(name);
      halter[name] = findeHalter(absPath, geburtMs, deps);
    } else {
      removed.push(name);
    }
  }
  return { removed, errors, refused, halter };
}

/** True, wenn der Ordner existiert und leer ist; jeder Lesefehler zählt als nicht leer (fail-closed: dann meldet der Hook einen Fehler). */
function istLeer(absPath, deps = {}) {
  try {
    return (deps.readdirSync ?? readdirSync)(absPath).length === 0;
  } catch {
    return false;
  }
}

// ── Lokale Branches nach dem Squash-Merge (#1579) ─────────────────────────────

/** Branch-Namensraum der Ticket-Branches; nur darunter wird je etwas gelöscht. */
const TICKET_BRANCH = /^feature\/kq-\d+/;

/**
 * Ausgabe von `git for-each-ref --format=%(refname:short)%09%(upstream:track)%09%(objectname) refs/heads/…` →
 * `[{ name, gone, sha }]` (`gone`: der Upstream ist nach dem Merge entfernt, `[gone]`). Zeilen ohne Namen oder Hash entfallen.
 */
export function parseBranchRefs(text) {
  return String(text ?? "")
    .split(/\r?\n/)
    .map((zeile) => zeile.split("\t"))
    .filter(([name, , sha]) => name && /^[0-9a-f]{40}$/.test(sha ?? ""))
    .map(([name, track, sha]) => ({ name, gone: (track ?? "").trim() === "[gone]", sha }));
}

/** Namen der in einem Worktree (auch dem Hauptcheckout) ausgecheckten Branches aus `git worktree list --porcelain`. */
export function worktreeBranchen(porcelain) {
  return new Set(
    String(porcelain ?? "")
      .split(/\r?\n/)
      .map((z) => /^branch refs\/heads\/(.+)$/.exec(z)?.[1])
      .filter(Boolean),
  );
}

/**
 * Welche lokalen Branches sind nach einem Squash-Merge sicher löschbar? Alle Bedingungen zugleich: Name `feature/kq-<nr>…`,
 * `[gone]` (Remote nach dem Merge gelöscht), in keinem Worktree ausgecheckt, und die Spitze gleicht dem Kopf-Commit eines gemergten
 * PR desselben Branch-Namens (`gemergteHeads`: `[{ headRefName, headRefOid }]`): lokale Nach-Commits bleiben also stehen.
 * Fehlt `gemergteHeads` (gh scheiterte), wird nichts gelöscht (fail-closed). `git branch --merged` erkennt Squash-Merges nicht.
 */
export function aufraeumbareBranches({ refs, worktreeBranches, gemergteHeads }) {
  if (!Array.isArray(gemergteHeads)) return [];
  const belegt = worktreeBranches instanceof Set ? worktreeBranches : new Set(worktreeBranches ?? []);
  return refs
    .filter((r) => TICKET_BRANCH.test(r.name) && r.gone && !belegt.has(r.name))
    .filter((r) => gemergteHeads.some((h) => h?.headRefName === r.name && h?.headRefOid === r.sha))
    .map((r) => r.name);
}

/**
 * Räumt gemergte lokale Ticket-Branches auf (nur CLI, nie im Stop-Hook). `git(args)` und `gh()` sind injiziert (`gh` liefert die
 * gemergten PRs `[{ headRefName, headRefOid }]`). Ohne `loeschen` nur die Liste. Rückgabe `{ ok, grund?, kandidaten, geloescht, behalten, fehler }`.
 */
export function branchesAufraeumen({ git, gh, loeschen = false }) {
  const leer = { kandidaten: [], geloescht: [], behalten: 0, fehler: [] };
  let refsText;
  let worktrees;
  try {
    refsText = git(["for-each-ref", "--format=%(refname:short)%09%(upstream:track)%09%(objectname)", "refs/heads/feature/kq-*"]);
    worktrees = git(["worktree", "list", "--porcelain"]);
  } catch (e) {
    return { ...leer, ok: false, grund: `git: ${e.message}` };
  }
  let gemergteHeads;
  try {
    gemergteHeads = gh();
  } catch (e) {
    return { ...leer, ok: false, grund: `gh: ${e.message} (nichts gelöscht)` };
  }
  const refs = parseBranchRefs(refsText);
  const kandidaten = aufraeumbareBranches({ refs, worktreeBranches: worktreeBranchen(worktrees), gemergteHeads });
  const geloescht = [];
  const fehler = [];
  if (loeschen) {
    for (const name of kandidaten) {
      try {
        git(["branch", "-D", name]);
        geloescht.push(name);
      } catch (e) {
        fehler.push(`${name}: ${e.message}`);
      }
    }
  }
  return { ok: fehler.length === 0, kandidaten, geloescht, behalten: refs.length - kandidaten.length, fehler };
}

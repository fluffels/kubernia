// Kein Shebang: wird per `node scripts/cleanup-worktrees.mjs` gestartet UND von
// test/harness/cleanup-worktrees.test.ts sowie scripts/stop-verify-hook.mjs importiert
// (ein `#!` bricht den Test-Import, analog zu worktree-guard-hook.mjs).
/**
 * Diagnostik und Cleanup verwaister Worktree-Ordner (#908, #952).
 *
 * Dry-Run (Standard):
 *   node scripts/cleanup-worktrees.mjs
 *
 * Fix-Modus (löscht Geister-Ordner + prunet git-Einträge):
 *   node scripts/cleanup-worktrees.mjs --fix
 *
 * Geister = Ordner in .claude/worktrees/, die git worktree list nicht kennt.
 * Ursachen: git worktree remove ist auf Windows wegen laufendem Dev-Server
 * oder Shell-cwd-im-Worktree fehlgeschlagen (AGENTS.md Punkte 1-2). Seit #913
 * (rm-rf hart in `deny`) gibt es keinen Shell-Fallback mehr dafür — dieses
 * Skript räumt stattdessen über `fs.rmSync` auf (kein Shell-`rm`, `Bash(node:*)`
 * bleibt erlaubt).
 *
 * Lens-Worktrees (#1425): die Test-Lens sabotiert in `kq-<nr>-lens-r<runde>` bzw. `kq-<nr>-lens-m<n>` (Merge-Delta-Lens, Skill `review-lenses`). Bleibt so ein
 * Worktree REGISTRIERT stehen, obwohl sein Feature-Worktree `kq-<nr>` weg ist, fehlt er in der Waisen-Sicht oben
 * (die kennt nur unregistrierte Ordner). `verwaisteLensWorktrees` findet sie, `entferneLensWorktrees` räumt sie per
 * `git worktree remove --force` und prüft das Ergebnis.
 * Bewusste Grenzen: ein Feature-Worktree, der nicht `kq-<nr>` heißt, hat keinen erkennbaren Eltern-Worktree; seine
 * Lens-Worktrees gelten nach 5 Minuten als verwaist. Ein junger Lens-Worktree wird nur gemeldet.
 *
 * Lose Dateien (#1476): direkt unter `.claude/worktrees/` liegende reguläre Dateien (z.B. eine Sicherungskopie
 * `kq-<nr>-…-orig.bak`, die eine Lens neben ihren Worktree legte) hält `git worktree remove` nicht auf. Verwaist ist
 * eine Datei `kq-<nr>[-.]…`, deren `kq-<nr>` nicht mehr registriert und die älter als 5 Minuten ist; nur sie wird
 * entfernt (nicht rekursiv, keine Links, Schutzgurt wie bei Ordnern). Junge und fremd benannte Dateien werden nur gemeldet.
 *
 * Entscheidungslogik ist pure/exportiert und testbar (execSync/fs injizierbar) —
 * EINE Quelle für dieses CLI-Skript und den automatischen Check in
 * scripts/stop-verify-hook.mjs (#952).
 */

import { execFileSync, execSync } from "node:child_process";
import { existsSync, lstatSync, readdirSync, rmSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { LENS_WORKTREE_NAME } from "./lens-edit-guard.mjs";

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

/** Name eines Lens-Worktrees: `kq-<nr>-lens-r<runde>` oder `kq-<nr>-lens-m<n>` (Skill review-lenses); Gruppe 1 ist der Eltern-Worktree `kq-<nr>`. */
const LENS_WORKTREE = LENS_WORKTREE_NAME;

/**
 * Registrierte Lens-Worktrees unter `worktreesDir`, deren Feature-Worktree `kq-<nr>` NICHT mehr registriert ist (#1425).
 * `registeredPaths` sind die absoluten Pfade aus `git worktree list`. Pure; liefert Ordnernamen (nicht Pfade).
 */
export function verwaisteLensWorktrees(registeredPaths, worktreesDir) {
  const basis = norm(worktreesDir) + "/";
  const registriert = new Set(registeredPaths.map(norm));
  const namen = [...registriert].filter((p) => p.startsWith(basis) && !p.slice(basis.length).includes("/")).map((p) => p.slice(basis.length));
  return namen.filter((name) => {
    const m = LENS_WORKTREE.exec(name);
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

// ── CLI ──────────────────────────────────────────────────────────────────────
function main() {
  const FIX = process.argv.includes("--fix");
  const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

  console.log("=== Worktree-Diagnose ===\n");
  console.log(`Root: ${ROOT}`);

  const { ok, orphans, young, lensOrphans, lensYoung, orphanFiles, youngFiles, foreignFiles, mainRoot, worktreesDir } = diagnoseOrphans(ROOT);
  if (!ok) {
    console.error("git worktree list fehlgeschlagen — Diagnose abgebrochen.");
    process.exit(1);
  }

  const dirs = localWorktreeDirs(worktreesDir);
  console.log(`Worktrees-Ordner: ${worktreesDir}`);
  console.log(`Lokal vorhanden: ${dirs.length} Ordner\n`);

  // Reparse-Points an Worktree-Stelle sind nie ein normaler Ordner (#1051) und
  // werden NIE gelöscht — nur gemeldet, mit dem Auflöse-Befehl.
  const suspicious = suspiciousWorktreeEntries(worktreesDir);
  if (suspicious.length > 0) {
    console.error(`Symlink/Junction an Worktree-Stelle (${suspicious.length}) — NICHT automatisch löschbar:`);
    for (const name of suspicious) {
      console.error(`  ⚠ ${name} — bitte von Hand lösen: cmd /c rmdir "${join(worktreesDir, name)}"`);
    }
    console.error();
  }

  if (dirs.length === 0 && suspicious.length === 0 && orphanFiles.length + youngFiles.length + foreignFiles.length === 0) {
    console.log(".claude/worktrees/ ist leer — alles sauber.");
    process.exit(0);
  }

  if (young.length > 0) {
    console.log(`Zu jung zum Löschen (unter ${MIN_ORPHAN_AGE_MS / 60_000} Minuten, evtl. gerade von einer parallelen Session angelegt): ${young.join(", ")}\n`);
  }

  if (lensYoung.length > 0) {
    console.log(`Lens-Worktrees ohne Feature-Worktree, aber unter ${MIN_ORPHAN_AGE_MS / 60_000} Minuten alt (nur gemeldet): ${lensYoung.join(", ")}`);
  }
  if (lensOrphans.length > 0) {
    console.log(`Verwaiste Lens-Worktrees (registriert, Feature-Worktree fehlt, ${lensOrphans.length}):`);
    for (const name of lensOrphans) console.log(`  ✗ ${name}`);
    console.log();
  }

  const okDirs = dirs.filter((name) => !orphans.includes(name) && !young.includes(name) && !lensOrphans.includes(name));
  if (okDirs.length > 0) {
    console.log("Aktive Worktrees (git bekannt):");
    for (const name of okDirs) console.log(`  ✓ ${name}`);
    console.log();
  }

  if (youngFiles.length > 0) {
    console.log(`Lose Dateien, verwaist, aber unter ${MIN_ORPHAN_AGE_MS / 60_000} Minuten alt (nur gemeldet): ${youngFiles.join(", ")}`);
  }
  if (foreignFiles.length > 0) {
    console.log(`Fremde lose Dateien (Name nicht kq-<nr>…, nie automatisch gelöscht): ${foreignFiles.join(", ")}`);
  }
  if (orphanFiles.length > 0) {
    console.log(`Verwaiste lose Dateien (kq-<nr> nicht mehr registriert, ${orphanFiles.length}):`);
    for (const name of orphanFiles) console.log(`  ✗ ${name}`);
    console.log();
  }

  if (orphans.length === 0 && lensOrphans.length === 0 && orphanFiles.length === 0) {
    console.log("Keine verwaisten Ordner — alles sauber.");
    // Ein gemeldeter Reparse-Point ist NICHT "sauber": exit 1, damit die
    // Warnung nicht in einem grünen Lauf untergeht (#1051).
    process.exit(suspicious.length > 0 ? 1 : 0);
  }

  if (orphans.length > 0) {
    console.log(`Verwaiste Ordner (${orphans.length}):`);
    for (const name of orphans) console.log(`  ✗ ${name}`);
    console.log();
  }

  if (!FIX) {
    console.log(
      "Dry-Run — keine Änderungen. Zum Bereinigen: node scripts/cleanup-worktrees.mjs --fix"
    );
    process.exit(1);
  }

  console.log("Pruning veralteter git-Einträge + Löschen...");
  const lens = entferneLensWorktrees(mainRoot, worktreesDir, lensOrphans);
  const dateien = entferneVerwaisteDateien(mainRoot, worktreesDir, orphanFiles);
  for (const name of dateien.removed) console.log(`  ✓ ${name} (lose Datei) entfernt`);
  for (const name of lens.removed) console.log(`  ✓ ${name} (Lens-Worktree) entfernt`);
  const { removed, errors: ordnerFehler, pending, refused: ordnerRefused, halter: ordnerHalter } = fixOrphans(mainRoot, worktreesDir, orphans);
  const errors = [...ordnerFehler, ...lens.errors, ...dateien.errors];
  const refused = [...ordnerRefused, ...lens.refused, ...dateien.refused];
  const halter = { ...ordnerHalter, ...lens.halter };
  for (const name of removed) console.log(`  ✓ ${name} entfernt`);
  for (const name of pending) console.log(`  … ${name} ist leer, aber gerade gesperrt: kein Fehler, der nächste Lauf versucht es erneut`);
  for (const { name, reason } of refused) {
    console.error(`  VERWEIGERT: ${name} — ${reason} (Schutzgurt #1051, nichts gelöscht)`);
  }
  for (const name of errors) {
    console.error(`  FEHLER: ${name} noch vorhanden und nicht leer — ${formatHalter(halter[name] ?? [])}`);
  }

  if (refused.length > 0) {
    console.error(
      `\n${refused.length} Ziel(e) vom Schutzgurt abgelehnt — bewusst NICHT gelöscht. Bitte von Hand prüfen (#1051).`
    );
    process.exit(1);
  }

  if (errors.length > 0) {
    console.error(
      `\n${errors.length} Fehler beim Löschen. Den Halter gezielt per PID beenden (taskkill /PID <pid> /T /F bzw. in Git-Bash taskkill //PID <pid> //T //F, nie per Name), dann erneut versuchen.`
    );
    process.exit(1);
  }

  console.log("\nFertig. Verify-Befehle:");
  console.log("  git worktree list");
  console.log(
    `  Test-Path '${worktreesDir}' (PowerShell, muss False sein) oder test -e '${worktreesDir}' (Git-Bash, Exit 1); ein leerer Ordner ist auch ok`
  );

  // Ein gemeldeter Reparse-Point bleibt offen (wird nie automatisch gelöscht,
  // #1051) — der Lauf darf deshalb nicht grün enden.
  if (suspicious.length > 0) process.exit(1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();

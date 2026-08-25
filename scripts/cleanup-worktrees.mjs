// Kein Shebang: wird per `node scripts/cleanup-worktrees.mjs` gestartet UND von
// test/cleanup-worktrees.test.ts sowie scripts/stop-verify-hook.mjs importiert
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
 * Entscheidungslogik ist pure/exportiert und testbar (execSync/fs injizierbar) —
 * EINE Quelle für dieses CLI-Skript und den automatischen Check in
 * scripts/stop-verify-hook.mjs (#952).
 */

import { execSync } from "node:child_process";
import { existsSync, lstatSync, readdirSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/** Pfad-Normalisierung für Vergleiche: Backslashes → Slashes, kein Trailing-Slash.
 *  Nötig, weil `mainRoot` slash-normalisiert aus `parseWorktreeListPorcelain`
 *  kommt, `join()` auf Windows aber Backslashes anhängt — es entstehen also real
 *  gemischte Pfade wie `C:/git/kubernia\.claude\worktrees`. Ohne diese
 *  Normalisierung würde der Guard unten legitime Löschungen verweigern
 *  (Denial-of-Service gegen sich selbst). */
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

/**
 * Einträge unter `worktreesDir`, die ein **Symlink/Reparse-Point** sind (#1051).
 *
 * `Dirent.isDirectory()` ist für eine Junction **false** — der Filter in
 * `localWorktreeDirs()` übersah einen Reparse-Point an Worktree-Stelle deshalb
 * STILLSCHWEIGEND: nie als Waise gemeldet, nie aufgeräumt, nie gewarnt. Genau
 * die gefährlichste Form (`git worktree remove --force` folgt Junctions und
 * leert dadurch echte Ziele, siehe AGENTS.md § Worktree entfernen) war damit
 * unsichtbar. Diese Funktion macht sie sichtbar — sie löscht **nie** selbst.
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
 * Anlass: Beim Aufräumen des Worktrees `kq-1027` wurden ALLE versionierten
 * Dateien unter `.claude/` im Haupt-Checkout gelöscht, obwohl der Code dem
 * Wortlaut nach nur den Waisen-Pfad anfasst. Die Ursache liess sich aus der
 * Code-Lesart nicht bestimmen (Kandidaten: ein Reparse-Point im Worktree, ein
 * Folgeschaden des mit ENOSYS gescheiterten `git worktree remove`, ein
 * Pfad-Auflösungsfehler in `diagnoseOrphans`). Dieser Guard sichert den
 * Löschpfad daher URSACHENUNABHÄNGIG ab und **fail-closed**: gelöscht wird nur,
 * was beweisbar ein echtes Verzeichnis ECHT UNTERHALB von
 * `<mainRoot>/.claude/worktrees/` ist — im Zweifel nichts. Dieser Pfad läuft
 * unbeaufsichtigt bei jedem Turn-Ende (`scripts/stop-verify-hook.mjs`, #952) und
 * kann im Schadensfall genau die Dateien treffen, die den Agenten steuern:
 * lieber ein Geister-Ordner zu viel als eine entwaffnete Harness.
 */
export function assertSafeOrphanTarget(mainRoot, worktreesDir, name, deps = {}) {
  const lstat = deps.lstatSync ?? lstatSync;

  if (!mainRoot || !worktreesDir) {
    return { safe: false, reason: "mainRoot/worktreesDir nicht aufgelöst" };
  }

  // 1) Der Name muss GENAU EIN Pfad-Segment sein. Ein leerer Name oder "."
  //    liesse `join()` auf worktreesDir SELBST zeigen, ".." auf `.claude/`.
  if (typeof name !== "string" || name === "" || name === "." || name === "..") {
    return { safe: false, reason: `unzulässiger Ordnername ${JSON.stringify(name)}` };
  }
  if (name.includes("/") || name.includes("\\")) {
    return { safe: false, reason: `Ordnername enthält einen Pfad-Trenner: ${name}` };
  }

  // 2) worktreesDir muss exakt <mainRoot>/.claude/worktrees sein — fängt einen
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

  // 4) Nur ein ECHTES Verzeichnis, niemals ein Symlink/Reparse-Point: rekursives
  //    Löschen darf einem Link nicht folgen (dieselbe Klasse wie die
  //    node_modules-Junction-Falle in AGENTS.md).
  let st;
  try {
    st = lstat(join(worktreesDir, name));
  } catch {
    return { safe: false, reason: `Ziel nicht statbar (existiert nicht?): ${target}` };
  }
  if (st.isSymbolicLink()) {
    return { safe: false, reason: `Ziel ist ein Symlink/Junction (Reparse-Point), wird nicht gelöscht: ${target}` };
  }
  if (!st.isDirectory()) {
    return { safe: false, reason: `Ziel ist kein Verzeichnis: ${target}` };
  }

  return { safe: true };
}

/** Pure Berechnung: welche `dirs` (Ordnernamen relativ zu `worktreesDir`) sind
 *  NICHT in `registered` (Set absoluter, `/`-normalisierter Pfade). */
export function computeOrphans(worktreesDir, dirs, registered) {
  return dirs.filter((name) => !registered.has(join(worktreesDir, name).replace(/\\/g, "/")));
}

/**
 * Diagnose: liefert `{ ok, orphans, mainRoot, worktreesDir }`.
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
  const orphans = computeOrphans(worktreesDir, dirs, registered);
  return { ok: true, orphans, mainRoot, worktreesDir };
}

/**
 * Pruned veraltete git-Registrierungen und löscht `orphans` (Ordnernamen unter
 * `worktreesDir`) physisch per `fs.rmSync`. Wirft nie. Drei Ergebnis-Buckets:
 *  - `removed`: erfolgreich gelöscht
 *  - `errors`:  Löschversuch gelaufen, Ordner existiert weiter (Datei-Lock durch
 *               laufenden Dev-Server o.ä., siehe AGENTS.md Windows-Fallen)
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
  const refused = [];
  for (const name of orphans) {
    // Schutzgurt VOR jedem Löschen (#1051) — bei Zweifel gar nicht anfassen.
    const guard = assertSafeOrphanTarget(mainRoot, worktreesDir, name, deps);
    if (!guard.safe) {
      refused.push({ name, reason: guard.reason });
      continue;
    }

    const absPath = join(worktreesDir, name);
    try {
      rm(absPath, { recursive: true, force: true });
      if (exists(absPath)) {
        errors.push(name);
      } else {
        removed.push(name);
      }
    } catch {
      errors.push(name);
    }
  }
  return { removed, errors, refused };
}

// ── CLI ──────────────────────────────────────────────────────────────────────
function main() {
  const FIX = process.argv.includes("--fix");
  const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

  console.log("=== Worktree-Diagnose ===\n");
  console.log(`Root: ${ROOT}`);

  const { ok, orphans, mainRoot, worktreesDir } = diagnoseOrphans(ROOT);
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

  if (dirs.length === 0 && suspicious.length === 0) {
    console.log(".claude/worktrees/ ist leer — alles sauber.");
    process.exit(0);
  }

  const okDirs = dirs.filter((name) => !orphans.includes(name));
  if (okDirs.length > 0) {
    console.log("Aktive Worktrees (git bekannt):");
    for (const name of okDirs) console.log(`  ✓ ${name}`);
    console.log();
  }

  if (orphans.length === 0) {
    console.log("Keine verwaisten Ordner — alles sauber.");
    // Ein gemeldeter Reparse-Point ist NICHT "sauber": exit 1, damit die
    // Warnung nicht in einem gruenen Lauf untergeht (#1051).
    process.exit(suspicious.length > 0 ? 1 : 0);
  }

  console.log(`Verwaiste Ordner (${orphans.length}):`);
  for (const name of orphans) console.log(`  ✗ ${name}`);
  console.log();

  if (!FIX) {
    console.log(
      "Dry-Run — keine Änderungen. Zum Bereinigen: node scripts/cleanup-worktrees.mjs --fix"
    );
    process.exit(1);
  }

  console.log("Pruning veralteter git-Einträge + Löschen...");
  const { removed, errors, refused } = fixOrphans(mainRoot, worktreesDir, orphans);
  for (const name of removed) console.log(`  ✓ ${name} entfernt`);
  for (const { name, reason } of refused) {
    console.error(`  VERWEIGERT: ${name} — ${reason} (Schutzgurt #1051, nichts gelöscht)`);
  }
  for (const name of errors) {
    console.error(`  FEHLER: ${name} noch vorhanden — möglicherweise noch ein Prozess aktiv (Dev-Server?)`);
  }

  if (refused.length > 0) {
    console.error(
      `\n${refused.length} Ziel(e) vom Schutzgurt abgelehnt — bewusst NICHT gelöscht. Bitte von Hand prüfen (#1051).`
    );
    process.exit(1);
  }

  if (errors.length > 0) {
    console.error(
      `\n${errors.length} Fehler beim Löschen. Tipp: Dev-Server per PowerShell beenden (Stop-Process -Name node -Force), dann erneut versuchen.`
    );
    process.exit(1);
  }

  console.log("\nFertig. Verify-Befehle:");
  console.log("  git worktree list");
  console.log(
    "  pwsh -c \"Test-Path C:\\git\\kubernia\\.claude\\worktrees\" # muss False oder leerer Ordner sein"
  );

  // Ein gemeldeter Reparse-Point bleibt offen (wird nie automatisch gelöscht,
  // #1051) — der Lauf darf deshalb nicht grün enden.
  if (suspicious.length > 0) process.exit(1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();

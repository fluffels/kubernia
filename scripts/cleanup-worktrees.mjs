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
import { existsSync, readdirSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

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
 * `worktreesDir`) physisch per `fs.rmSync`. Gibt `{ removed, errors }` zurück —
 * `errors` enthält Namen, die nach dem Löschversuch noch existieren (Datei-Lock
 * durch laufenden Dev-Server o.ä., siehe AGENTS.md Windows-Fallen). Wirft nie.
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
  for (const name of orphans) {
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
  return { removed, errors };
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

  if (dirs.length === 0) {
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
    process.exit(0);
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
  const { removed, errors } = fixOrphans(mainRoot, worktreesDir, orphans);
  for (const name of removed) console.log(`  ✓ ${name} entfernt`);
  for (const name of errors) {
    console.error(`  FEHLER: ${name} noch vorhanden — möglicherweise noch ein Prozess aktiv (Dev-Server?)`);
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
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();

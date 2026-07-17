#!/usr/bin/env node
/**
 * Diagnostik und Cleanup verwaister Worktree-Ordner (#908).
 *
 * Dry-Run (Standard):
 *   node scripts/cleanup-worktrees.mjs
 *
 * Fix-Modus (löscht Geister-Ordner + prunet git-Einträge):
 *   node scripts/cleanup-worktrees.mjs --fix
 *
 * Geister = Ordner in .claude/worktrees/, die git worktree list nicht kennt.
 * Ursachen: git worktree remove ist auf Windows wegen laufendem Dev-Server
 * oder Shell-cwd-im-Worktree fehlgeschlagen (AGENTS.md Punkte 1-2).
 */

import { execSync } from "node:child_process";
import { existsSync, readdirSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";

const FIX = process.argv.includes("--fix");
const ROOT = resolve(import.meta.dirname, "..");
const WORKTREES_DIR = join(ROOT, ".claude", "worktrees");

function run(cmd) {
  return execSync(cmd, { cwd: ROOT, encoding: "utf-8" }).trim();
}

// --- git worktree list --porcelain ---
function registeredWorktrees() {
  const out = run("git worktree list --porcelain");
  const paths = new Set();
  for (const line of out.split("\n")) {
    if (line.startsWith("worktree ")) {
      paths.add(line.slice("worktree ".length).replace(/\\/g, "/"));
    }
  }
  return paths;
}

// --- Ordner in .claude/worktrees/ ---
function localDirs() {
  if (!existsSync(WORKTREES_DIR)) return [];
  return readdirSync(WORKTREES_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name);
}

const registered = registeredWorktrees();
const dirs = localDirs();

console.log("=== Worktree-Diagnose ===\n");
console.log(`Root: ${ROOT}`);
console.log(`Worktrees-Ordner: ${WORKTREES_DIR}`);
console.log(`git worktree list kennt ${registered.size} Einträge`);
console.log(`Lokal vorhanden: ${dirs.length} Ordner\n`);

if (dirs.length === 0) {
  console.log(".claude/worktrees/ ist leer — alles sauber.");
  process.exit(0);
}

const orphans = dirs.filter((name) => {
  const absPath = join(WORKTREES_DIR, name).replace(/\\/g, "/");
  return !registered.has(absPath);
});

const ok = dirs.filter((name) => {
  const absPath = join(WORKTREES_DIR, name).replace(/\\/g, "/");
  return registered.has(absPath);
});

if (ok.length > 0) {
  console.log("Aktive Worktrees (git bekannt):");
  for (const name of ok) console.log(`  ✓ ${name}`);
  console.log();
}

if (orphans.length === 0) {
  console.log("Keine verwaisten Ordner — alles sauber.");
  process.exit(0);
}

console.log(`Verwaiste Ordner (${orphans.length}):`);
for (const name of orphans) {
  console.log(`  ✗ ${name}`);
}
console.log();

if (!FIX) {
  console.log(
    "Dry-Run — keine Änderungen. Zum Bereinigen: node scripts/cleanup-worktrees.mjs --fix"
  );
  process.exit(1);
}

// --- Fix-Modus ---
console.log("Pruning veralteter git-Einträge...");
try {
  const pruneOut = run("git worktree prune");
  if (pruneOut) console.log(pruneOut);
} catch (e) {
  console.error("git worktree prune fehlgeschlagen:", e.message);
}

let errors = 0;
for (const name of orphans) {
  const absPath = join(WORKTREES_DIR, name);
  console.log(`Lösche ${absPath} ...`);
  try {
    rmSync(absPath, { recursive: true, force: true });
    if (existsSync(absPath)) {
      console.error(
        `  FEHLER: Ordner noch vorhanden — möglicherweise noch ein Prozess aktiv (Dev-Server?)`
      );
      errors++;
    } else {
      console.log("  ✓ entfernt");
    }
  } catch (e) {
    console.error(`  FEHLER: ${e.message}`);
    errors++;
  }
}

if (errors > 0) {
  console.error(
    `\n${errors} Fehler beim Löschen. Tipp: Dev-Server per PowerShell beenden (Stop-Process -Name node -Force), dann erneut versuchen.`
  );
  process.exit(1);
}

console.log("\nFertig. Verify-Befehle:");
console.log("  git worktree list");
console.log(
  "  pwsh -c \"Test-Path C:\\git\\kubernia\\.claude\\worktrees\" # muss False oder leerer Ordner sein"
);

// Kein Shebang: wie worktree-guard-hook.mjs, kein #! wegen Test-Import via Vitest/esbuild.
/**
 * Stop-Worktree-Cleanup-Hook (#708/#909/#952) — Claude-Code-`Stop`-Hook.
 *
 * Läuft, wenn der Agent seinen Turn beendet, und räumt verwaiste
 * Worktree-Ordner automatisch auf (#952). Bewusst schlank: still im Normalfall,
 * kostet keine Tokens/Latenz, blockiert nur, wenn ein Waisen-Ordner physisch
 * nicht gelöscht werden kann.
 *
 * Historie: Der Hook fuhr früher zusätzlich `npm run verify`, wenn der Turn mit
 * uncommitteten Änderungen endete (#708 Haupt-Checkout, #909 Linked Worktrees).
 * Dieser verify-Frühindikator wurde entfernt (Maintainerin-Wunsch, 2026-08-05):
 * er lief bei jedem Turn-Ende mit uncommitteten Änderungen (~30 s Latenz) und war
 * gegenüber dem maßgeblichen PR-/CI-Gate + pre-push-Hook redundant. Der billige,
 * stille Waisen-Cleanup bleibt der einzige Zweck dieses Hooks.
 *
 * Waisen-Cleanup (#952): seit #913 ist `rm -rf` hart in `deny` — der frühere
 * Shell-Fallback, wenn `git worktree remove` auf Windows am physischen Löschen
 * scheitert (laufender Dev-Server / Shell-cwd im Worktree, AGENTS.md Punkte 1-2),
 * ist damit blockiert. Statt darauf zu vertrauen, dass jemand manuell an
 * `node scripts/cleanup-worktrees.mjs --fix` denkt, prüft und räumt dieser Hook
 * bei JEDEM Stop automatisch auf (Logik aus cleanup-worktrees.mjs, EINE Quelle).
 * Erfolgreich (keine Waisen oder alle entfernt) → still, kein Reibungsverlust.
 * Löschen schlägt fehl (Datei-Lock) → Stop blockieren mit klarer Meldung. Bewusst
 * NICHT die `rm -rf`-Deny aufweichen — der Workaround über `fs.rmSync` (kein
 * Shell-`rm`) bleibt sauber innerhalb der Least-Privilege-Policy (#901).
 *
 * Output bei blockiertem Stop: { "reason": "…" } auf stdout, exit-code != 0.
 */

import { readFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { diagnoseOrphans, fixOrphans } from "./cleanup-worktrees.mjs";

/** Parst das Hook-stdin-JSON tolerant (wirft nie). */
export function parseStopInput(text) {
  try {
    const data = JSON.parse(text);
    return { stopHookActive: Boolean(data.stop_hook_active) };
  } catch {
    return { stopHookActive: false };
  }
}

/** Repo-Root aus dem Skript-Pfad ableiten (`scripts/` → Root). */
export function repoRootFromScriptUrl(importMetaUrl) {
  return dirname(dirname(fileURLToPath(importMetaUrl)));
}

/**
 * Prüft `.claude/worktrees/` auf verwaiste Ordner und räumt sie automatisch auf
 * (#908/#952). Siehe Datei-Kopf für die Begründung (rm-rf-Deny seit #913).
 *  - Keine Waisen ODER alle erfolgreich entfernt → { blocked: false }.
 *  - Waisen gefunden, Löschen schlägt fehl (Datei-Lock) → { blocked: true, reason }.
 *  - git-Fehler (diagnoseOrphans meldet ok:false) → fail-open, { blocked: false }.
 */
export function checkAndFixOrphanWorktrees(repoRoot, deps = {}) {
  const { ok, orphans, mainRoot, worktreesDir } = diagnoseOrphans(repoRoot, deps);
  if (!ok || orphans.length === 0) return { blocked: false };

  const { removed, errors } = fixOrphans(mainRoot, worktreesDir, orphans, deps);
  if (errors.length === 0) return { blocked: false, removed };

  return {
    blocked: true,
    reason:
      `Stop-Worktree-Cleanup-Hook (#908/#952): ${errors.length} verwaiste Worktree-Ordner ` +
      `(${errors.join(", ")}) konnten nicht gelöscht werden (Datei-Lock? laufender ` +
      `Dev-Server?). Bitte PowerShell "Stop-Process -Name node -Force" prüfen, dann ` +
      `"node scripts/cleanup-worktrees.mjs --fix" erneut versuchen (AGENTS.md § Worktree entfernen).`,
  };
}

// ── CLI (vom Stop-Hook aufgerufen) ───────────────────────────────────────────
function main() {
  let stdinText;
  try {
    stdinText = readFileSync(0, "utf8");
  } catch {
    stdinText = "";
  }

  const { stopHookActive } = parseStopInput(stdinText);
  if (stopHookActive) {
    process.exit(0); // bereits einmal blockiert → diesmal freigeben
  }

  const repoRoot = repoRootFromScriptUrl(import.meta.url);

  // Verwaiste Worktree-Ordner automatisch aufräumen (#908/#952)
  const orphanResult = checkAndFixOrphanWorktrees(repoRoot);
  if (orphanResult.blocked) {
    console.log(JSON.stringify({ reason: orphanResult.reason }));
    process.exit(2);
  }
  // Sauber aufgeräumt (oder nichts zu tun) → Stop freigeben (kein explizites
  // exit(0) nötig, s. worktree-guard-hook.mjs).
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();

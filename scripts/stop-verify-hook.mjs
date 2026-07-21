// Kein Shebang: wie worktree-guard-hook.mjs, kein #! wegen Test-Import via Vitest/esbuild.
/**
 * Stop-Verify-Hook (#708/#909/#952) — Claude-Code-`Stop`-Hook.
 *
 * Läuft, wenn der Agent seinen Turn beendet. Frühindikator:
 * prüft ob `npm run verify` im aktuellen Checkout/Worktree grün ist, UND räumt
 * verwaiste Worktree-Ordner automatisch auf (#952).
 *
 * Design-Entscheidung (#708/#909):
 *  - Prüft zuerst den Haupt-Checkout auf uncommittete Änderungen.
 *    Hat der Haupt-Checkout Änderungen, wird verify dort ausgeführt (fängt
 *    versehentliche Direktänderungen auf, zweite Mauer nach #735).
 *  - Hat der Haupt-Checkout KEINE Änderungen (Normalfall im Worktree-Workflow),
 *    werden alle registrierten Linked Worktrees per `git worktree list` ermittelt
 *    und jeder mit uncommitteten Änderungen per verify geprüft (#909). Damit greift
 *    der Hook auch im dokumentierten Worktree-Workflow zuverlässig.
 *  - stop_hook_active:true → sofort freigeben (eingebautes Anti-Loop-Netz).
 *  - KEIN Ersatz für PR-Gate (CI bleibt die Mauer) und pre-push-Hook —
 *    ergänzt sie als zusätzlicher lokaler Frühindikator.
 *
 * Waisen-Cleanup (#952): seit #913 ist `rm -rf` hart in `deny` — der frühere
 * Shell-Fallback, wenn `git worktree remove` auf Windows am physischen Löschen
 * scheitert (laufender Dev-Server / Shell-cwd im Worktree, AGENTS.md Punkte 1-2),
 * ist damit blockiert. Statt darauf zu vertrauen, dass jemand manuell an
 * `node scripts/cleanup-worktrees.mjs --fix` denkt, prüft und räumt dieser Hook
 * bei JEDEM Stop automatisch auf (Logik aus cleanup-worktrees.mjs, EINE Quelle).
 * Erfolgreich (keine Waisen oder alle entfernt) → still, kein Reibungsverlust.
 * Löschen schlägt fehl (Datei-Lock) → Stop blockieren mit klarer Meldung, gleiche
 * Philosophie wie der Verify-Check unten. Bewusst NICHT die `rm -rf`-Deny
 * aufweichen — der Workaround über `fs.rmSync` (kein Shell-`rm`) bleibt sauber
 * innerhalb der Least-Privilege-Policy (#901).
 *
 * Output bei blockiertem Stop: { "reason": "…" } auf stdout, exit-code != 0.
 */

import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
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

/** True, wenn `git diff HEAD` uncommittete Änderungen meldet. Fail-open (false) bei Fehler. */
export function hasUncommittedChanges(repoRoot, deps = {}) {
  const spawn = deps.spawnSync ?? spawnSync;
  try {
    const r = spawn("git", ["diff", "--quiet", "HEAD"], { cwd: repoRoot, stdio: "pipe" });
    return r.status !== 0;
  } catch {
    return false; // kein git / kein Repo → nichts zu prüfen
  }
}

/** Führt `npm run verify` aus und gibt Ergebnis zurück. */
export function runVerify(repoRoot, deps = {}) {
  const spawn = deps.spawnSync ?? spawnSync;
  const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";
  const r = spawn(npmCmd, ["run", "verify"], {
    cwd: repoRoot,
    stdio: "pipe",
    encoding: "utf8",
  });
  const output = ((r.stdout ?? "") + (r.stderr ?? "")).slice(-3000);
  return { ok: r.status === 0, output };
}

/** Repo-Root aus dem Skript-Pfad ableiten (`scripts/` → Root). */
export function repoRootFromScriptUrl(importMetaUrl) {
  return dirname(dirname(fileURLToPath(importMetaUrl)));
}

/**
 * Gibt die Pfade aller registrierten Linked Worktrees zurück (Haupt-Checkout
 * ausgenommen). Fail-open (leeres Array) bei jedem git-Fehler.
 *
 * `git worktree list --porcelain` gibt Blöcke aus, die erste Zeile je Block
 * beginnt mit "worktree <pfad>". Der erste Block ist immer der Haupt-Checkout —
 * er wird übersprungen, alle weiteren Pfade werden zurückgegeben.
 */
export function listLinkedWorktrees(repoRoot, deps = {}) {
  const spawn = deps.spawnSync ?? spawnSync;
  try {
    const r = spawn("git", ["worktree", "list", "--porcelain"], {
      cwd: repoRoot,
      stdio: "pipe",
      encoding: "utf8",
    });
    if (r.status !== 0) return [];
    const allPaths = (r.stdout ?? "")
      .split(/\r?\n/)
      .filter((l) => l.startsWith("worktree "))
      .map((l) => l.slice("worktree ".length).trim());
    return allPaths.slice(1); // erster Eintrag = Haupt-Checkout, überspringen
  } catch {
    return [];
  }
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
      `Stop-Verify-Hook (#908/#952): ${errors.length} verwaiste Worktree-Ordner ` +
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

  // 0. Verwaiste Worktree-Ordner automatisch aufräumen (#908/#952)
  const orphanResult = checkAndFixOrphanWorktrees(repoRoot);
  if (orphanResult.blocked) {
    console.log(JSON.stringify({ reason: orphanResult.reason }));
    process.exit(2);
  }

  // 1. Haupt-Checkout: uncommittete Änderungen → verify dort laufen lassen (#708)
  if (hasUncommittedChanges(repoRoot)) {
    const { ok, output } = runVerify(repoRoot);
    if (!ok) {
      console.log(
        JSON.stringify({
          reason:
            "Stop-Verify-Hook (#708): npm run verify fehlgeschlagen.\n\n" +
            output.trim() +
            "\n\nGates fixen, bevor der Agent fertig ist.",
        })
      );
      process.exit(2);
    }
    return; // Haupt-Checkout war schmutzig + verify grün → fertig
  }

  // 2. Linked Worktrees: jeden schmutzigen Worktree per verify prüfen (#909)
  const linkedWorktrees = listLinkedWorktrees(repoRoot);
  for (const wt of linkedWorktrees) {
    if (!hasUncommittedChanges(wt)) continue;
    const { ok, output } = runVerify(wt);
    if (!ok) {
      console.log(
        JSON.stringify({
          reason:
            `Stop-Verify-Hook (#708/#909): npm run verify fehlgeschlagen in Worktree ${wt}.\n\n` +
            output.trim() +
            "\n\nGates fixen, bevor der Agent fertig ist.",
        })
      );
      process.exit(2);
    }
  }
  // Alles sauber oder verify grün → Stop freigeben (kein explizites exit(0) nötig, s. worktree-guard-hook.mjs)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();

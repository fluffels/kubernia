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

import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { diagnoseOrphans, fixOrphans, suspiciousWorktreeEntries } from "./cleanup-worktrees.mjs";

/**
 * Pfade **versionierter** Dateien unter `.claude/`, die `git status` als gelöscht
 * meldet — `null`, wenn git nicht befragbar ist (Aufrufer entscheidet fail-open).
 *
 * **Pathspec bewusst auf `.claude`**: der Löschpfad kann dank Guard strukturell
 * nur dort zuschlagen, und ein repo-weiter Vergleich würde die Löschung eines
 * PARALLEL arbeitenden Agenten im Haupt-Checkout als eigenen Datenverlust melden
 * (Fehlalarm mit gefährlicher Empfehlung — siehe Aufrufer).
 *
 * Nur die beiden Status-Spalten zählen (`" D"` unstaged, `"D "` staged, `"AD"`,
 * `"MD"`): ein `??`-Eintrag, dessen Pfad zufällig mit `D` beginnt, ist KEINE
 * Löschung. `-z` statt Zeilen, weil `core.quotepath` Umlaut-Pfade sonst gequotet
 * liefert und der Wiederherstellungs-Befehl damit ins Leere zeigt.
 */
export function deletedTrackedPaths(cwd, deps = {}) {
  const exec = deps.execSync ?? execSync;
  let out;
  try {
    out = exec("git status --porcelain -z -- .claude", { cwd, encoding: "utf-8" });
  } catch {
    return null;
  }
  const paths = [];
  for (const entry of String(out).split("\0")) {
    if (entry.length < 4) continue;
    const xy = entry.slice(0, 2);
    if (xy[0] === "D" || xy[1] === "D") paths.push(entry.slice(3));
  }
  return paths;
}

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
  if (!ok) return { blocked: false };

  // Reparse-Point an Worktree-Stelle: wird NIE gelöscht (rekursives Löschen darf
  // einem Link nicht folgen), aber auch nicht mehr stillschweigend übersehen —
  // `Dirent.isDirectory()` ist für eine Junction false, sie fiel deshalb bisher
  // durch jeden Filter (#1051).
  const suspicious = suspiciousWorktreeEntries(worktreesDir, deps);
  if (orphans.length === 0 && suspicious.length === 0) return { blocked: false };

  const problems = [];
  let removed = [];

  if (orphans.length > 0) {
    // Nur wenn es wirklich etwas zu löschen gibt, kostet der Datenverlust-Check
    // einen git-Aufruf — im Normalfall (leeres .claude/worktrees) null Latenz.
    const before = deletedTrackedPaths(mainRoot, deps);
    const result = fixOrphans(mainRoot, worktreesDir, orphans, deps);
    const after = deletedTrackedPaths(mainRoot, deps);
    removed = result.removed;

    if (result.refused.length > 0) {
      problems.push(
        `Der Schutzgurt (#1051) hat ${result.refused.length} Ziel(e) abgelehnt und NICHTS gelöscht: ` +
          result.refused.map(({ name, reason }) => `${name} (${reason})`).join("; ")
      );
    }

    if (result.errors.length > 0) {
      problems.push(
        `${result.errors.length} verwaiste Worktree-Ordner (${result.errors.join(", ")}) konnten nicht ` +
          `gelöscht werden (Datei-Lock? laufender Dev-Server?). Bitte PowerShell ` +
          `"Stop-Process -Name node -Force" prüfen, dann "node scripts/cleanup-worktrees.mjs --fix" ` +
          `erneut versuchen (AGENTS.md § Worktree entfernen).`
      );
    }

    // Der eigentliche #1051-Alarm: hat das Aufräumen versionierte Dateien
    // mitgerissen? Nur NEU hinzugekommene Löschungen zählen — ein Turn darf
    // legitim mit eigenen Löschungen enden. Bei git-Fehler (null) bewusst
    // fail-open, sonst blockiert ein kaputtes git jeden Turn-Stop.
    if (before && after) {
      const newlyDeleted = after.filter((p) => !before.includes(p));
      if (newlyDeleted.length > 0) {
        // Bewusst "prüfen, ggf. wiederherstellen" statt "sofort wiederherstellen":
        // ein blind ausgeführtes checkout würde eine ABSICHTLICHE Löschung des
        // laufenden Turns zurückholen. Pfade einzeln gequotet (Leerzeichen).
        const cmd = newlyDeleted.map((p) => `"${p}"`).join(" ");
        problems.push(
          `MÖGLICHER DATENVERLUST: nach dem Aufräumen sind ${newlyDeleted.length} versionierte ` +
            `Datei(en) unter .claude/ als gelöscht gemeldet: ${newlyDeleted.join(", ")} — bitte ` +
            `prüfen und, falls das Aufräumen sie mitgerissen hat, wiederherstellen mit ` +
            `"git -C ${mainRoot} checkout -- ${cmd}" — ohne das -C no-oppt der ` +
            `Befehl im Worktree lautlos. Vorfall an #1051 melden.`
        );
      }
    }
  }

  if (suspicious.length > 0) {
    problems.push(
      `Symlink/Junction an Worktree-Stelle (nie automatisch gelöscht): ` +
        suspicious
          .map((name) => `${name} — von Hand lösen: cmd /c rmdir "${join(worktreesDir, name)}"`)
          .join("; ")
    );
  }

  if (problems.length === 0) return { blocked: false, removed };

  return {
    blocked: true,
    reason: `Stop-Worktree-Cleanup-Hook (#908/#952/#1051): ${problems.join(" | ")}`,
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

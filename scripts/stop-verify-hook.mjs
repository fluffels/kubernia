// Kein Shebang: wie worktree-guard-hook.mjs, kein #! wegen Test-Import via Vitest/esbuild.
/**
 * Stop-Verify-Hook (#708) — Claude-Code-`Stop`-Hook.
 *
 * Läuft, wenn der Agent seinen Turn beendet. Frühindikator:
 * prüft ob `npm run verify` im aktuellen Checkout grün ist.
 *
 * Design-Entscheidung (#708):
 *  - Läuft im Haupt-Checkout-Kontext (abgeleitet aus dem Skript-Pfad).
 *    Bei normalem Worktree-Workflow gibt es dort keine uncommitteten Änderungen
 *    → Hook exitiert sofort (kein Overhead). Wert: fängt versehentliche
 *    Haupt-Checkout-Direktänderungen auf (zweite Mauer nach #735).
 *  - stop_hook_active:true → sofort freigeben (eingebautes Anti-Loop-Netz).
 *  - KEIN Ersatz für PR-Gate (CI bleibt die Mauer) und pre-push-Hook —
 *    ergänzt sie als zusätzlicher lokaler Frühindikator.
 *
 * Output bei blockiertem Stop: { "reason": "…" } auf stdout, exit-code != 0.
 */

import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

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

  if (!hasUncommittedChanges(repoRoot)) {
    process.exit(0); // sauberer Stand → nichts zu prüfen
  }

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
    process.exit(2); // != 0 → blockiert Stop
  }
  // verify grün → Stop freigeben (kein explizites exit(0) nötig, s. worktree-guard-hook.mjs)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();

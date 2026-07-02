/* Fitness-Function (#541): ESLint MUSS `.claude/worktrees/` global ignorieren.
 * Sonst scannt ein `eslint .` im Haupt-Checkout jeden Parallel-Worktree mit; die
 * #502-Komplexitäts-Suppressions (repo-relative Pfade) greifen dort nicht, und
 * vorbestehende God-Functions blockieren als „frische" Fehler JEDEN main-Push,
 * solange irgendein halbfertiger Worktree existiert. Dieser Guard verhindert eine
 * stille Reintroduktion, wenn jemand den Ignore-Eintrag entfernt. */
import { test } from "vitest";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("#541: eslint.config.js ignoriert .claude/worktrees (kein Scan fremder Parallel-Checkouts)", () => {
  const cfg = readFileSync(new URL("../eslint.config.js", import.meta.url), "utf8");
  assert.match(
    cfg,
    /ignores:\s*\[[^\]]*"\.claude\/worktrees\/"/,
    "`.claude/worktrees/` fehlt im globalen ignores-Block von eslint.config.js",
  );
});

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
 * stille Waisen-Cleanup bleibt der Hauptzweck dieses Hooks.
 *
 * Waisen-Cleanup (#952): seit #913 ist `rm -rf` hart in `deny` — der frühere
 * Shell-Fallback, wenn `git worktree remove` auf Windows am physischen Löschen
 * scheitert (laufender Dev-Server / Shell-cwd im Worktree, AGENTS.md Punkte 1-2),
 * ist damit blockiert. Statt darauf zu vertrauen, dass jemand manuell an
 * `node scripts/cleanup-worktrees.mjs --fix` denkt, prüft und räumt dieser Hook
 * bei JEDEM Stop automatisch auf (Logik aus worktree-aufraeumen.mjs, EINE Quelle).
 * Erfolgreich (keine Waisen oder alle entfernt) → still, kein Reibungsverlust.
 * Löschen schlägt fehl (Datei-Lock) → Stop blockieren mit klarer Meldung. Bewusst
 * NICHT die `rm -rf`-Deny aufweichen — der Workaround über `fs.rmSync` (kein
 * Shell-`rm`) bleibt sauber innerhalb der Least-Privilege-Policy (#901).
 *
 * Lens-Worktrees (#1425): ein registrierter `kq-<nr>-lens-r<runde>` bzw. `-lens-m<n>` ohne `kq-<nr>` (der Umsetzer hat den Worktree
 * entfernt, die Sabotage-Probe der Test-Lens aber nicht) wird entfernt, wenn er älter als 5 Minuten ist.
 *
 * Lose Dateien (#1476): eine reguläre Datei `kq-<nr>…` direkt unter `.claude/worktrees/`, deren `kq-<nr>` nicht mehr
 * registriert und älter als 5 Minuten ist (z.B. eine Lens-Sicherungskopie), wird still entfernt. Fremde Dateien und eine
 * gescheiterte Löschung erzeugen nur eine Warnung (`systemMessage`), nie einen Block.
 *
 * Zweiter Zweck (#1331): beim `SubagentStop` des Umsetzers prüft `umsetzer-abschluss.mjs`, dass ein offener PR mit
 * Auto-Merge nicht als Ende gemeldet wird (`ERGEBNIS: gemergt|abgebrochen`); sonst blockiert der Hook.
 *
 * Läuft auch als `SubagentStop`-Hook mit Matcher `kubernia-umsetzer` (#1309): der Stop-Hook feuert nur am
 * Ende des Hauptchats, das Ende des Umsetzers (der den Worktree anlegt und entfernt) sah er nie.
 *
 * Output bei blockiertem Stop: { "decision": "block", "reason": "…" } auf stdout UND derselbe Grund auf
 * stderr, exit-code 2 (Claude Code wertet bei Exit 2 stderr aus, das JSON deckt die Auswertung per
 * stdout ab). `stop_hook_active` gibt in beiden Ereignissen frei, damit der Hook nie endlos blockiert.
 */

import { execSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { diagnoseOrphans, entferneLensWorktrees, entferneVerwaisteDateien, fixOrphans, formatHalter, suspiciousWorktreeEntries } from "./worktree-aufraeumen.mjs";
import { istDirektaufruf, readStdin } from "./hook-io.mjs"; // gemeinsames Hook-I/O (stdin lesen, Direktaufruf erkennen)
import { abschlussBlockade, parseAbschlussInput } from "./umsetzer-abschluss.mjs";

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
 *  - Waisen gefunden, Löschen schlägt fehl (Datei-Lock, Ordner nicht leer) → { blocked: true, reason } mit möglichen Haltern (PID).
 *  - Ordner nach dem Löschversuch noch da, aber LEER (Git-Worktree schon entfernt, meist eine kurze Sperre) →
 *    { blocked: false, warning }: nur eine Warnung, der nächste Stop versucht es erneut (#1411).
 *  - git-Fehler (diagnoseOrphans meldet ok:false) → fail-open, { blocked: false }.
 */
export function checkAndFixOrphanWorktrees(repoRoot, deps = {}) {
  const { ok, orphans, lensOrphans = [], orphanFiles = [], foreignFiles = [], mainRoot, worktreesDir } = diagnoseOrphans(repoRoot, deps);
  if (!ok) return { blocked: false };

  // Reparse-Point an Worktree-Stelle: wird NIE gelöscht (rekursives Löschen darf
  // einem Link nicht folgen), aber auch nicht mehr stillschweigend übersehen —
  // `Dirent.isDirectory()` ist für eine Junction false, sie fiel deshalb bisher
  // durch jeden Filter (#1051).
  const suspicious = suspiciousWorktreeEntries(worktreesDir, deps);
  if (orphans.length === 0 && suspicious.length === 0 && lensOrphans.length === 0 && orphanFiles.length === 0 && foreignFiles.length === 0) return { blocked: false };

  const problems = [];
  const warnungen = [];
  let removed = [];
  let pending = [];

  // Lose Dateien (#1476): verwaiste still entfernen, alles andere nur warnen (nie blockieren).
  if (orphanFiles.length > 0) {
    const dateien = entferneVerwaisteDateien(mainRoot, worktreesDir, orphanFiles, deps);
    removed = [...dateien.removed];
    if (dateien.errors.length > 0) warnungen.push(`Lose Datei(en) ${dateien.errors.join(", ")} unter .claude/worktrees/ konnten nicht gelöscht werden.`);
    if (dateien.refused.length > 0) {
      warnungen.push(`Lose Datei(en) vom Schutzgurt abgelehnt, nichts gelöscht: ${dateien.refused.map(({ name, reason }) => `${name} (${reason})`).join("; ")}`);
    }
  }
  if (foreignFiles.length > 0) {
    warnungen.push(`Fremde lose Datei(en) unter .claude/worktrees/ (nicht kq-<nr>…, nie automatisch gelöscht): ${foreignFiles.join(", ")}. Herkunft klären und von Hand entfernen.`);
  }

  // Registrierte Lens-Worktrees ohne Feature-Worktree (#1425): per `git worktree remove --force`, Ergebnis geprüft.
  if (lensOrphans.length > 0) {
    const lens = entferneLensWorktrees(mainRoot, worktreesDir, lensOrphans, deps);
    removed = [...removed, ...lens.removed];
    if (lens.refused.length > 0) {
      problems.push(
        `Der Schutzgurt (#1051) hat ${lens.refused.length} Lens-Worktree(s) abgelehnt und NICHTS entfernt: ` +
          lens.refused.map(({ name, reason }) => `${name} (${reason})`).join("; ")
      );
    }
    if (lens.errors.length > 0) {
      problems.push(
        `${lens.errors.length} verwaiste Lens-Worktree(s) (${lens.errors.join(", ")}) konnten nicht entfernt werden. ` +
          lens.errors.map((n) => `${n}: ${formatHalter(lens.halter?.[n] ?? [])}`).join(" | ") +
          `. Dann "node scripts/cleanup-worktrees.mjs --fix" erneut versuchen (AGENTS.md § Worktree entfernen).`
      );
    }
  }

  if (orphans.length > 0) {
    // Nur wenn es wirklich etwas zu löschen gibt, kostet der Datenverlust-Check
    // einen git-Aufruf — im Normalfall (leeres .claude/worktrees) null Latenz.
    const before = deletedTrackedPaths(mainRoot, deps);
    const result = fixOrphans(mainRoot, worktreesDir, orphans, deps);
    const after = deletedTrackedPaths(mainRoot, deps);
    removed = [...removed, ...result.removed];
    pending = result.pending ?? [];

    if (result.refused.length > 0) {
      problems.push(
        `Der Schutzgurt (#1051) hat ${result.refused.length} Ziel(e) abgelehnt und NICHTS gelöscht: ` +
          result.refused.map(({ name, reason }) => `${name} (${reason})`).join("; ")
      );
    }

    if (result.errors.length > 0) {
      problems.push(
        `${result.errors.length} verwaiste Worktree-Ordner (${result.errors.join(", ")}) konnten nicht ` +
          `gelöscht werden (nicht leer: ein Prozess hält Dateien darin). ` +
          result.errors.map((n) => `${n}: ${formatHalter(result.halter?.[n] ?? [])}`).join(" | ") +
          `. Dann "node scripts/cleanup-worktrees.mjs --fix" erneut versuchen (AGENTS.md § Worktree entfernen).`
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

  if (pending.length > 0) {
    warnungen.push(`Worktree-Ordner ${pending.join(", ")} ist leer, aber gerade gesperrt (Git-Worktree ist schon entfernt). Der nächste Stop versucht das Löschen erneut, nichts zu tun.`);
  }
  const warning = warnungen.length > 0 ? warnungen.join(" ") : undefined;
  if (problems.length === 0) return { blocked: false, removed, ...(warning ? { warning } : {}) };

  return {
    blocked: true,
    reason: `Stop-Worktree-Cleanup-Hook (#908/#952/#1051): ${problems.join(" | ")}`,
  };
}

/**
 * Die ganze Hook-Entscheidung ohne Prozess-Exit: `{ exit, stdout, stderr }`. Pure bis auf `check`
 * (injizierbar), damit der Test Stop UND SubagentStop ohne echten Worktree-Zustand fährt.
 */
export function runHook(stdinText, repoRoot, check = checkAndFixOrphanWorktrees, abschlussDeps = {}) {
  const { stopHookActive } = parseStopInput(stdinText);
  if (stopHookActive) return { exit: 0, stdout: "", stderr: "" }; // bereits einmal blockiert → diesmal freigeben
  // Verwaiste Worktree-Ordner automatisch aufräumen (#908/#952) und den Umsetzer-Abschluss prüfen (#1331)
  const gruende = [];
  const orphanResult = check(repoRoot);
  if (orphanResult.blocked) gruende.push(orphanResult.reason);
  const abschluss = abschlussBlockade(parseAbschlussInput(stdinText), abschlussDeps);
  if (abschluss) gruende.push(abschluss);
  if (gruende.length === 0) {
    // Nur eine Warnung (leerer, gesperrter Ordner): Stop freigeben, die Meldung geht als systemMessage an die Nutzerin (#1411).
    return orphanResult.warning ? { exit: 0, stdout: JSON.stringify({ systemMessage: orphanResult.warning }), stderr: "" } : { exit: 0, stdout: "", stderr: "" };
  }
  const reason = gruende.join(" | ");
  return { exit: 2, stdout: JSON.stringify({ decision: "block", reason }), stderr: reason };
}

// ── CLI (vom Stop- und vom SubagentStop-Hook aufgerufen) ─────────────────────
function main() {
  const r = runHook(readStdin(), repoRootFromScriptUrl(import.meta.url));
  if (r.stdout) console.log(r.stdout);
  if (r.stderr) console.error(r.stderr);
  if (r.exit !== 0) process.exit(r.exit);
  // Sauber aufgeräumt (oder nichts zu tun) → Stop freigeben (kein explizites
  // exit(0) nötig, s. worktree-guard-hook.mjs).
}

if (istDirektaufruf(import.meta.url)) main();

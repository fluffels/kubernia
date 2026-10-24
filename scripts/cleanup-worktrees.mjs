// Kein Shebang: wird per `node scripts/cleanup-worktrees.mjs` gestartet (das CLI; die Logik steht in scripts/worktree-aufraeumen.mjs,
// die auch scripts/stop-verify-hook.mjs und test/harness/cleanup-worktrees.test.ts importieren).
/**
 * Diagnostik und Cleanup verwaister Worktree-Ordner (#908, #952).
 *
 * Dry-Run (Standard):
 *   node scripts/cleanup-worktrees.mjs
 *
 * Fix-Modus (löscht Geister-Ordner + prunet git-Einträge):
 *   node scripts/cleanup-worktrees.mjs --fix
 *
 * Lokale Branches nach dem Squash-Merge (#1579; Liste, mit `--fix` löschen; nie im Stop-Hook):
 *   node scripts/cleanup-worktrees.mjs --branches [--fix]
 * Gelöscht wird nur ein `<praefixe.branch><nr>…`-Branch, dessen Remote weg ist (`[gone]`), der in keinem Worktree ausgecheckt ist und dessen
 * Spitze dem Kopf-Commit eines gemergten PR entspricht; scheitert `gh`, wird nichts gelöscht.
 *
 * Geister = Ordner in .claude/worktrees/, die git worktree list nicht kennt.
 * Ursachen: git worktree remove ist auf Windows wegen laufendem Dev-Server
 * oder Shell-cwd-im-Worktree fehlgeschlagen (AGENTS.md Punkte 1-2). Seit #913
 * (rm-rf hart in `deny`) gibt es keinen Shell-Fallback mehr dafür — dieses
 * Skript räumt stattdessen über `fs.rmSync` auf (kein Shell-`rm`, `Bash(node:*)`
 * bleibt erlaubt).
 *
 * Lens-Worktrees (#1425): die Test-Lens sabotiert in `<praefixe.worktree><nr>-lens-r<runde>` bzw. `-lens-m<n>` (Merge-Delta-Lens) bzw. `-lens-a<n>` (Abnahme-Fix-Delta-Lens, Skill `review-lenses`). Bleibt so ein
 * Worktree REGISTRIERT stehen, obwohl sein Feature-Worktree `<praefixe.worktree><nr>` weg ist, fehlt er in der Waisen-Sicht oben
 * (die kennt nur unregistrierte Ordner). `verwaisteLensWorktrees` findet sie, `entferneLensWorktrees` räumt sie per
 * `git worktree remove --force` und prüft das Ergebnis.
 * Bewusste Grenzen: ein Feature-Worktree, der nicht `<praefixe.worktree><nr>` heißt, hat keinen erkennbaren Eltern-Worktree; seine
 * Lens-Worktrees gelten nach 5 Minuten als verwaist. Ein junger Lens-Worktree wird nur gemeldet.
 *
 * Lose Dateien (#1476): direkt unter `.claude/worktrees/` liegende reguläre Dateien (z.B. eine Sicherungskopie
 * `<praefixe.worktree><nr>-…-orig.bak`, die eine Lens neben ihren Worktree legte) hält `git worktree remove` nicht auf. Verwaist ist
 * eine Datei `<praefixe.worktree><nr>[-.]…`, deren `<praefixe.worktree><nr>` nicht mehr registriert und die älter als 5 Minuten ist; nur sie wird
 * entfernt (nicht rekursiv, keine Links, Schutzgurt wie bei Ordnern). Junge und fremd benannte Dateien werden nur gemeldet.
 *
 * Entscheidungslogik ist pure/exportiert und testbar (execSync/fs injizierbar) —
 * EINE Quelle für dieses CLI-Skript und den automatischen Check in
 * scripts/stop-verify-hook.mjs (#952).
 */

import { fileURLToPath } from "node:url";
import { istDirektaufruf } from "./hook-io.mjs";
import { execFileSync } from "node:child_process";
import { join, dirname } from "node:path";
import { ghJson } from "./gh-cli.mjs";
import { AUFRUF_EXIT, flagsLesen } from "./flag-lib.mjs";
import { ladeProjektConfig } from "./projekt-config-lib.mjs";
import { ticketNamen } from "./ticket-namen.mjs";
import {
  MIN_ORPHAN_AGE_MS,
  PR_LIMIT,
  branchesAufraeumen,
  diagnoseOrphans,
  entferneLensWorktrees,
  entferneVerwaisteDateien,
  fixOrphans,
  formatHalter,
  localWorktreeDirs,
  suspiciousWorktreeEntries,
} from "./worktree-aufraeumen.mjs";

// ── CLI ──────────────────────────────────────────────────────────────────────

/**
 * `--branches [--fix]`: gemergte lokale Ticket-Branches aufräumen (#1579); ohne `--fix` nur die Liste. Nie im Stop-Hook.
 * Liefert den Exit-Code (0 = ok, 1 = Abbruch oder Löschfehler) statt `process.exit`; `config` (oder fertige `namen`), `git`, `gh` (oder nur `ghJson`), `out` und `err` sind injizierbar (Tests).
 * Ein unvollständiger Config-Eintrag bricht ab, bevor git oder gh laufen (kein Standardwert).
 */
export function branchenModus(root, loeschen, {
  config,
  namen: namenIn,
  git = (args) => execFileSync("git", args, { cwd: root, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 }),
  gh: ghIn,
  ghJson: ghJsonFn = ghJson,
  out = console.log,
  err = console.error,
} = {}) {
  let namen;
  try {
    namen = namenIn ?? ticketNamen(config ?? ladeProjektConfig());
  } catch (e) {
    err(`Branch-Aufräumen abgebrochen, nichts gelöscht: ${e instanceof Error ? e.message : e}`);
    return 1;
  }
  try {
    git(["fetch", "--prune", "origin"]); // frische Remote-Refs: `[gone]` stammt sonst aus altem Stand
  } catch (e) {
    err(`Branch-Aufräumen abgebrochen, nichts gelöscht: git fetch --prune origin: ${e instanceof Error ? e.message : e}`);
    return 1;
  }
  const gh = ghIn ?? (() => ghJsonFn(["pr", "list", "--state", "merged", "--search", `head:${namen.praefixe.branch}`, "--json", "headRefName,headRefOid", "--limit", String(PR_LIMIT)]));
  const r = branchesAufraeumen({ git, gh, loeschen, namen });
  if (r.grund) {
    err(`Branch-Aufräumen abgebrochen, nichts gelöscht: ${r.grund}`);
    return 1;
  }
  out(`Lokale ${namen.praefixe.branch}*-Branches: ${r.kandidaten.length} gemergt und löschbar ([gone], nicht ausgecheckt, Spitze = gemergter PR-Kopf), ${r.behalten} bleiben.`);
  for (const n of r.kandidaten) out(`  ${loeschen && r.geloescht.includes(n) ? "gelöscht" : "löschbar "} ${n}`);
  if (!loeschen && r.kandidaten.length > 0) out("Zum Löschen: node scripts/cleanup-worktrees.mjs --branches --fix");
  for (const f of r.fehler) err(`  ✗ ${f}`);
  if (r.warnung) err(`Warnung: ${r.warnung}`);
  return r.ok ? 0 : 1;
}

/**
 * Einstieg, liefert in jedem Pfad den Exit-Code zurück (nie `process.exit`; der Aufrufer setzt `process.exitCode`). `--branches` gibt den Code von
 * `modus(root, loeschen, { namen })` weiter (`loeschen` nur mit `--fix`). `deps` (Tests): `modus`, `root`, `diagnoseDeps` (Nähte von `diagnoseOrphans`, z. B. `execSync`).
 */
export function main(argv = process.argv.slice(2), { modus = branchenModus, root = dirname(dirname(fileURLToPath(import.meta.url))), diagnoseDeps = {} } = {}) {
  const { werte, fehler } = flagsLesen(argv, { fix: { type: "boolean" }, branches: { type: "boolean" } });
  if (fehler) {
    console.error(`${fehler.text}
Aufruf: node scripts/cleanup-worktrees.mjs [--branches] [--fix]`);
    return AUFRUF_EXIT;
  }
  const FIX = werte.fix === true;
  const ROOT = root;
  let namen;
  try {
    namen = ticketNamen(ladeProjektConfig());
  } catch (e) {
    console.error(`Worktree-Aufräumen abgebrochen: ${e instanceof Error ? e.message : e}`);
    return 1;
  }
  if (werte.branches) {
    return modus(ROOT, FIX, { namen });
  }

  console.log("=== Worktree-Diagnose ===\n");
  console.log(`Root: ${ROOT}`);

  const { ok, orphans, young, lensOrphans, lensYoung, orphanFiles, youngFiles, foreignFiles, mainRoot, worktreesDir } = diagnoseOrphans(ROOT, { ...diagnoseDeps, namen });
  if (!ok) {
    console.error("git worktree list fehlgeschlagen — Diagnose abgebrochen.");
    return 1;
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
    return 0;
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
    console.log(`Fremde lose Dateien (Name nicht ${namen.praefixe.worktree}<nr>…, nie automatisch gelöscht): ${foreignFiles.join(", ")}`);
  }
  if (orphanFiles.length > 0) {
    console.log(`Verwaiste lose Dateien (${namen.praefixe.worktree}<nr> nicht mehr registriert, ${orphanFiles.length}):`);
    for (const name of orphanFiles) console.log(`  ✗ ${name}`);
    console.log();
  }

  if (orphans.length === 0 && lensOrphans.length === 0 && orphanFiles.length === 0) {
    console.log("Keine verwaisten Ordner — alles sauber.");
    // Ein gemeldeter Reparse-Point ist NICHT "sauber": exit 1, damit die
    // Warnung nicht in einem grünen Lauf untergeht (#1051).
    return suspicious.length > 0 ? 1 : 0;
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
    return 1;
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
    return 1;
  }

  if (errors.length > 0) {
    console.error(
      `\n${errors.length} Fehler beim Löschen. Den Halter gezielt per PID beenden (taskkill /PID <pid> /T /F bzw. in Git-Bash taskkill //PID <pid> //T //F, nie per Name), dann erneut versuchen.`
    );
    return 1;
  }

  console.log("\nFertig. Verify-Befehle:");
  console.log("  git worktree list");
  console.log(
    `  Test-Path '${worktreesDir}' (PowerShell, muss False sein) oder test -e '${worktreesDir}' (Git-Bash, Exit 1); ein leerer Ordner ist auch ok`
  );

  // Ein gemeldeter Reparse-Point bleibt offen (wird nie automatisch gelöscht,
  // #1051) — der Lauf darf deshalb nicht grün enden.
  return suspicious.length > 0 ? 1 : 0;
}

if (istDirektaufruf(import.meta.url)) process.exitCode = main();

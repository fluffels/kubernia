// Kein Shebang, kein Direktaufruf: Lib der Gate-Skripte (#1579, Konvention #1398: Einstiegsskripte importieren nicht voneinander,
// gemeinsamer Code steht in einer Lib; der Glob /scripts/check-*.mjs hält sie als Gate-Code geschützt).
/**
 * Gemeinsame Grundlagen der Gates: die Vergleichs-Basis des Slices (`resolveBase`, für check:diffsize, check:diffcoverage, check:lockfile,
 * den Review-Nachweis und verify-lauf), die Liste der prüfbaren Repo-Dateien (`listTrackedFiles`, `isCheckable`, für check:internalrefs und
 * check:steuerbytes) und das Markdown-Sammeln des Repos (`collectMarkdown`, für check:docdrift und check:contextsize).
 */
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { collectMarkdown as collectMd } from "./docs-gen/markdown.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// ── Vergleichs-Basis ───────────────────────────────────────────────────────────

/** Löst die Vergleichs-Basis auf (Commit, gegen den der Diff gemessen wird).
 *  Reihenfolge: explizites KQ_DIFF_BASE → Merge-Base gegen origin/main → gegen
 *  main. origin/main ZUERST, weil im pre-push-Hook HEAD == main ist und nur
 *  origin/main (der alte Stand) den zu pushenden Slice sichtbar macht. `runGit`
 *  ist injizierbar (Test); es wirft bei Fehler, wir fangen und gehen weiter.
 *  Rückgabe: Basis-SHA oder null (keine Basis auflösbar → Aufrufer degradiert). */
export function resolveBase(runGit, env = process.env) {
  const tryGit = (args) => {
    try {
      const out = runGit(args).trim();
      return out === "" ? null : out;
    } catch {
      return null;
    }
  };
  const explicit = (env.KQ_DIFF_BASE ?? "").trim();
  if (explicit !== "") {
    const sha = tryGit(["rev-parse", "--verify", "--quiet", `${explicit}^{commit}`]);
    if (sha) return sha;
  }
  return tryGit(["merge-base", "HEAD", "origin/main"]) ?? tryGit(["merge-base", "HEAD", "main"]);
}

// ── Prüfbare Dateien ───────────────────────────────────────────────────────────

/** Dateien, die bewusst NICHT geprüft werden. Grund ist in jedem Fall base64-/Binärrauschen,
 *  nicht Bequemlichkeit: `package-lock.json` trägt tausende base64-Integrity-Hashes, in denen
 *  ein kurzer Begriff zufällig zwischen zwei `/` landen und einen Wortgrenzen-Treffer
 *  vortäuschen kann. Textdateien mit eingebettetem base64 (z.B. `fonts.css`) bleiben bewusst
 *  IN der Prüfung — dort schützen die Wortgrenzen zuverlässig (empirisch geprüft: der eine
 *  Zufalls-Substring mitten in den Font-Bytes steht zwischen Wortzeichen und fällt sauber raus). */
export const EXCLUDED_FILES = ["package-lock.json"];

/** Endungen ohne prüfbaren Text (Binärassets). */
export const EXCLUDED_EXTENSIONS = [
  ".png", ".jpg", ".jpeg", ".gif", ".ico", ".webp",
  ".ttf", ".otf", ".woff", ".woff2",
  ".wav", ".mp3", ".ogg",
  ".zip", ".gz", ".pdf",
];

/** Alle vom Repo getrackten Dateien (via git, damit ignorierte/ungetrackte Pfade außen bleiben). */
export function listTrackedFiles(rootDir = ROOT, exec = execFileSync) {
  const out = exec("git", ["ls-files", "-z"], { cwd: rootDir, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  return out.split("\0").filter(Boolean);
}

/** True, wenn die Datei geprüft werden soll. */
export function isCheckable(file, excludedFiles = EXCLUDED_FILES, excludedExts = EXCLUDED_EXTENSIONS) {
  if (excludedFiles.includes(file)) return false;
  const lower = file.toLowerCase();
  return !excludedExts.some((ext) => lower.endsWith(ext));
}

// ── Markdown sammeln ───────────────────────────────────────────────────────────

/** Verzeichnisse, die beim Markdown-Sammeln nie betreten werden. */
const IGNORED_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "dist-offline",
  "dist-devpanel",
  "test-results",
  "playwright-report",
]);

/** Unterordner von .claude, die versioniert sind (Gegenstück zu den `!.claude/…/`-
 *  Ausnahmen in .gitignore) — nur DIESE werden unter .claude gescannt. Alles andere
 *  dort ist nicht versioniert: Worktrees paralleler Agenten (.claude/worktrees, volle
 *  Repo-Kopien), lokale Einstellungen, Tool-Caches. Bewusst eine Allowlist statt
 *  „alles außer worktrees": sonst röte der Wächter an lokal abgelegten, untrackten
 *  Dateien — lokal rot, CI grün (#1091; gleiche Abwägung wie test/harness/model-routing.test.ts).
 *  Bewusst auch kein `git ls-files`: eine neue, noch nicht ge-`add`-ete .md bliebe
 *  sonst lokal ungeprüft. test/docdrift.test.ts gleicht die Liste mit .gitignore ab. */
export const VERSIONED_CLAUDE_DIRS = new Set(["agents", "skills", "workflows"]);

// ── Markdown sammeln ───────────────────────────────────────────────────────────

/** Alle *.md im Repo (repo-relativer POSIX-Pfad), IGNORED_DIRS ausgenommen; unter
 *  dem .claude im Repo-Root nur die VERSIONED_CLAUDE_DIRS (und keine losen Dateien direkt
 *  darin). Anders als früher (Basename-Match) gilt das nur für das Root-.claude. */
export function collectMarkdown(rootDir = ROOT) {
  return collectMd(rootDir, ["."], {
    ueberspringe: (ent, relDir) => {
      const inClaude = relDir === ".claude";
      if (ent.isDirectory()) return IGNORED_DIRS.has(ent.name) || (inClaude && !VERSIONED_CLAUDE_DIRS.has(ent.name));
      return inClaude; // lose Dateien direkt in .claude
    },
  });
}

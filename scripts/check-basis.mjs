// Kein Shebang, kein Direktaufruf: Lib der Gate-Skripte (#1579, Konvention #1398: Einstiegsskripte importieren nicht voneinander,
// gemeinsamer Code steht in einer Lib; der Glob /scripts/check-*.mjs hält sie als Gate-Code geschützt).
/**
 * Gemeinsame Grundlagen der Gates: die Vergleichs-Basis des Slices (`resolveBase`, für check:diffsize, check:diffcoverage, check:lockfile,
 * den Review-Nachweis und verify-lauf), die Liste der prüfbaren Repo-Dateien (`listTrackedFiles`, `isCheckable`, für check:internalrefs und
 * check:steuerbytes) und das Markdown-Sammeln des Repos (`collectMarkdown`, für check:docdrift und check:contextsize).
 */
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { ladeProjektConfig, strukturAus, umgebungsWert } from "./projekt-config-lib.mjs";
import { fileURLToPath } from "node:url";
import { collectMarkdown as collectMd } from "./docs-gen/markdown.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// ── Vergleichs-Basis ───────────────────────────────────────────────────────────

/** Löst die Vergleichs-Basis auf (Commit, gegen den der Diff gemessen wird).
 *  Reihenfolge: explizites FACTORY_DIFF_BASE → Merge-Base gegen origin/main → gegen
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
  const explicit = (umgebungsWert(env, "FACTORY_DIFF_BASE") ?? "").trim();
  if (explicit !== "") {
    const sha = tryGit(["rev-parse", "--verify", "--quiet", `${explicit}^{commit}`]);
    if (sha) return sha;
  }
  return tryGit(["merge-base", "HEAD", "origin/main"]) ?? tryGit(["merge-base", "HEAD", "main"]);
}

// ── Diff-Zeilen und Messbereich (aus check-diffcoverage, #112) ───────────────────

/** Vereinheitlicht Pfad-Trenner auf POSIX. Nötig, weil der v8-lcov-Reporter unter
 *  Windows `SF:src\sim\pods.ts` schreibt, `git diff` aber `src/sim/pods.ts` — ohne
 *  Normalisierung fände der Schnitt NIE einen Treffer und das Gate wäre still blind. */
export function normalizePath(p) {
  return String(p).replace(/\\/g, "/").replace(/^\.\//, "");
}

/** Parst `git diff -U0` und liefert je Datei die Zeilennummern der NEUEN Seite.
 *
 *  Gelesen werden nur die Hunk-Header (`@@ -a,b +c,d @@`): `c` ist die erste Zeile der
 *  neuen Seite, `d` ihre Anzahl (ohne `,d`: genau eine). `d === 0` ist eine reine
 *  LÖSCHUNG und darf nichts beitragen, sonst zählte entfernter Code als neuer
 *  ungetesteter; `+++ /dev/null` fällt ganz raus. Pure — kein git, voll testbar. */
export function parseDiffLines(text) {
  const byFile = new Map();
  let current = null;
  // `+++ ` zählt nur im Kopfbereich (zwischen `diff --git` und dem ersten `@@`) als
  // Datei-Header — sonst kapert eine INHALTS-Zeile, die mit `++ ` beginnt, den Pfad und
  // die folgenden Hunks fallen unter einer Phantom-Datei still aus der Messung.
  // `diff --git ` ist der fälschungssichere Anker: eine Inhaltszeile trägt immer ein
  // `+`/`-` davor (`--- ` dagegen kann eine entfernte Zeile `-- a/x` sein).
  let imKopf = false;
  for (const raw of String(text).split(/\r?\n/)) {
    if (raw.startsWith("diff --git ")) {
      imKopf = true;
      current = null;
      continue;
    }
    if (imKopf && raw.startsWith("+++ ")) {
      const target = raw.slice(4).trim();
      current = target === "/dev/null" ? null : normalizePath(target.replace(/^b\//, ""));
      continue;
    }
    if (!raw.startsWith("@@") || current === null) continue;
    imKopf = false;
    const m = /^@@ -\S+ \+(\d+)(?:,(\d+))? @@/.exec(raw);
    if (!m) continue;
    const start = Number.parseInt(m[1], 10);
    const count = m[2] === undefined ? 1 : Number.parseInt(m[2], 10);
    if (!Number.isFinite(start) || !Number.isFinite(count) || count <= 0) continue;
    const lines = byFile.get(current) ?? new Set();
    for (let i = 0; i < count; i++) lines.add(start + i);
    byFile.set(current, lines);
  }
  return byFile;
}

/** Ist die Datei überhaupt Gegenstand der Coverage-Messung? Deckungsgleich mit dem
 *  `include` der Coverage-Config für die Quellwurzel (`struktur.quelle` der Projekt-Config) — Content-JSON, Assets und Skripte
 *  außerhalb der Quellwurzel sind kein ausführbarer Quellcode und fallen raus.
 *
 *  Endungen `.ts`, `.mts`, `.mjs`, `.cjs`, `.js` (das Factory-Repo hat seine Quellwurzel unter `scripts` mit `.mjs`; in einem Repo mit `src/` als Quellwurzel liegt dort nur `.ts`).
 *  `.d.ts` (auch `.d.mts`, `.d.cts`) ist ausgenommen: reine Typdeklarationen haben keine ausführbare Zeile, und ein
 *  Vitest-Bump, der sie aus dem Report nimmt, machte jeden PR darauf falsch rot. */
export function isMeasured(path, quelle = strukturAus(ladeProjektConfig()).quelle) {
  return path.startsWith(`${quelle}/`) && /\.(?:ts|mts|mjs|cjs|js)$/.test(path) && !/\.d\.[cm]?ts$/.test(path);
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

/** Überspringt der Markdown-Walker den Eintrag `name` in `relDir`? Einzige Quelle der Regel (Walker und `istGelesenesMarkdown`). */
function walkerUeberspringt(name, istOrdner, relDir) {
  const inClaude = relDir === ".claude";
  if (istOrdner) return IGNORED_DIRS.has(name) || (inClaude && !VERSIONED_CLAUDE_DIRS.has(name));
  return inClaude; // lose Dateien direkt in .claude
}

/** Liest der Doku-Drift-Wächter diese Markdown-Datei (repo-relativer POSIX-Pfad)? Dieselbe Regel wie `collectMarkdown`, auf einen Pfad angewandt (#1942). */
export function istGelesenesMarkdown(pfad) {
  if (!pfad.endsWith(".md")) return false;
  const teile = pfad.split("/");
  return teile.every((name, i) => i === teile.length - 1 || !walkerUeberspringt(name, true, teile.slice(0, i).join("/")))
    && !walkerUeberspringt(teile[teile.length - 1], false, teile.slice(0, -1).join("/"));
}

/** Alle *.md im Repo (repo-relativer POSIX-Pfad), IGNORED_DIRS ausgenommen; unter
 *  dem .claude im Repo-Root nur die VERSIONED_CLAUDE_DIRS (und keine losen Dateien direkt
 *  darin). Anders als früher (Basename-Match) gilt das nur für das Root-.claude. */
export function collectMarkdown(rootDir = ROOT) {
  return collectMd(rootDir, ["."], {
    ueberspringe: (ent, relDir) => walkerUeberspringt(ent.name, ent.isDirectory(), relDir),
  });
}

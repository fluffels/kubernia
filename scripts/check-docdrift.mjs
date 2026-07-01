// Kein Shebang — analog zu scripts/check-docmap.mjs: dieses Skript wird über
// `node scripts/check-docdrift.mjs` (npm run check:docdrift) gestartet UND von
// test/docdrift.test.ts importiert. Ein `#!` bricht genau diesen Vitest/esbuild-Import.
/**
 * Harness-Drift-Wächter (#529) — hält die "Doku als Kontext-Selektor" ehrlich,
 * jenseits der Datei-Landkarte (die bewacht #482 / check-docmap.mjs).
 *
 * Hintergrund: AGENTS.md, CLAUDE.md und README werden von JEDER KI-Session als
 * Kontext geladen. Sie nennen (1) `npm run <x>`-Kommandos, die es in package.json
 * geben MUSS, und (2) viele interne Markdown-Links + `#anker` zwischen den Docs.
 * Beides kann leise veralten — ein Agent tippt dann ein totes Kommando oder folgt
 * einem toten Link ins Leere. Der Datei-Landkarten-Wächter (#482) deckt das NICHT
 * ab. Dieser Wächter macht genau diesen Drift **rot**:
 *
 *   1. Tote Kommandos: jedes in der Doku erwähnte `npm run <x>` (bzw. `npm test`)
 *      existiert als Skript in package.json.
 *   2. Undokumentierte Kern-Skripte: jedes package.json-Skript (außer der bewusst
 *      ausgenommenen Entwickler-Convenience) wird in mind. einem der drei
 *      Kern-Docs (AGENTS.md/CLAUDE.md/README) erwähnt.
 *   3. Tote Links: jeder interne, repo-relative Markdown-Link zeigt auf eine
 *      existierende Datei/ein Verzeichnis.
 *   4. Tote Anker: jeder `#anker` (gleiche Datei oder auf eine .md) trifft eine
 *      real vorhandene Überschrift (GitHub-Slug-Regel).
 *
 * Bewusst ein reines Node-Skript (nur Builtins), analog zu check-docmap.mjs/
 * check-size.mjs: läuft plattformübergreifend über `npm run check:docdrift` und
 * im CI (als Teil von `npm run verify`). Die Parse-/Prüf-Logik wird zusätzlich
 * von test/docdrift.test.ts importiert — EINE Quelle der Wahrheit.
 *
 * Ausführen mit:  npm run check:docdrift   (oder als Teil von: npm run verify)
 */

import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join, relative, resolve, sep, posix } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Die drei Docs, die JEDE KI-Session lädt — nur DIESE verlangen, dass ein
 *  Kern-Skript dokumentiert ist (Rückwärts-Check). */
export const CORE_DOCS = ["AGENTS.md", "CLAUDE.md", "README.md"];

/** package.json-Skripte, die bewusst NICHT dokumentiert sein müssen: reine
 *  Entwickler-Convenience, kein Teil der Harness-Story (Gates/Builds/Tests). */
export const DOC_EXEMPT_SCRIPTS = new Set([
  "preview", // Vite-Vorschau des Host-Builds — lokale Convenience
  "preview:offline", // dito für den Offline-Build
  "test:watch", // Watch-Modus von Vitest — lokale Convenience (dokumentiert ist `npm test`)
]);

/** Verzeichnisse, die beim Markdown-Sammeln nie betreten werden. */
const IGNORED_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "dist-offline",
  "dist-devpanel",
  "test-results",
  "playwright-report",
  ".claude", // Worktrees paralleler Agenten (.claude/worktrees) nicht mitscannen
]);

// ── Markdown sammeln ───────────────────────────────────────────────────────────

/** Alle *.md im Repo (repo-relativer POSIX-Pfad), IGNORED_DIRS ausgenommen. */
export function collectMarkdown(rootDir = ROOT) {
  const out = [];
  const walk = (dir) => {
    for (const ent of readdirSync(dir, { withFileTypes: true })) {
      if (ent.isDirectory()) {
        if (!IGNORED_DIRS.has(ent.name)) walk(join(dir, ent.name));
      } else if (ent.isFile() && ent.name.endsWith(".md")) {
        out.push(relative(rootDir, join(dir, ent.name)).split(sep).join("/"));
      }
    }
  };
  walk(rootDir);
  return out.sort();
}

// ── Code-Fences ausblenden ─────────────────────────────────────────────────────

/** Ersetzt Zeilen innerhalb ``` / ~~~ -Fences durch Leerzeilen (Zeilenzahl bleibt
 *  erhalten). So werden `#`-Kommentare in bash-Blöcken NICHT als Überschrift und
 *  Beispiel-Links in Codeblöcken NICHT als echter Link gewertet. */
export function stripFencedCode(md) {
  const lines = md.split(/\r?\n/);
  let fence = null; // aktuelles Fence-Zeichen (` oder ~) oder null
  return lines
    .map((line) => {
      const m = line.match(/^\s*(`{3,}|~{3,})/);
      if (m) {
        const marker = m[1][0];
        if (fence === null) {
          fence = marker;
          return "";
        }
        if (fence === marker) {
          fence = null;
          return "";
        }
      }
      return fence === null ? line : "";
    })
    .join("\n");
}

// ── Kommandos ───────────────────────────────────────────────────────────────────

/** Alle in `md` referenzierten npm-Skriptnamen: `npm run <x>` sowie `npm test`
 *  (Alias für das Skript `test`). Kommandos werden bewusst INKL. Codeblöcken
 *  erfasst — dort (in ```bash-Beispielen) leben sie ja meist. */
export function parseNpmRunMentions(md) {
  const found = new Set();
  for (const m of md.matchAll(/\bnpm\s+run\s+([a-zA-Z0-9:_-]+)/g)) found.add(m[1]);
  if (/\bnpm\s+test\b/.test(md)) found.add("test");
  return found;
}

// ── Links & Anker ────────────────────────────────────────────────────────────────

/** Extrahiert interne Markdown-Links (inkl. Bilder) aus `md`. Externe Links
 *  (http/https/mailto/tel/Protokoll-relativ) werden ausgelassen. Rückgabe je
 *  Link: { target, path, anchor } — path repo-/datei-relativ wie geschrieben,
 *  anchor ohne führendes `#` (oder ""). Aus Code-Fence- und Inline-Code-
 *  bereinigtem Text (Beispiel-Links in Backticks zählen nicht). */
export function extractLinks(md) {
  const clean = stripFencedCode(md).replace(/`[^`\n]*`/g, "");
  const out = [];
  // [text](target) oder ![alt](target), Ziel bis Leerzeichen/Klammer, optionaler "Titel"
  for (const m of clean.matchAll(/!?\[[^\]]*\]\(\s*([^)\s]+)(?:\s+"[^"]*")?\s*\)/g)) {
    const target = m[1];
    if (/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(target)) continue; // http:, mailto:, //cdn …
    const hashAt = target.indexOf("#");
    const path = hashAt < 0 ? target : target.slice(0, hashAt);
    const anchor = hashAt < 0 ? "" : target.slice(hashAt + 1);
    out.push({ target, path, anchor });
  }
  return out;
}

/** GitHub-Überschriften-Slug: klein, Markup entfernt, Satzzeichen/Emoji raus,
 *  Leerzeichen → Bindestrich. Duplikate hängt der Aufrufer mit -1/-2 an. */
export function slugify(headingText) {
  return headingText
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1") // [text](url) → text
    .replace(/[`*_~]/g, "") // Inline-Markup-Zeichen entfernen
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, "") // nur Buchstaben/Zahlen/Space/_/- behalten
    .replace(/\s/g, "-");
}

/** Alle Überschriften-Anker einer Markdown-Datei (GitHub-Slugs inkl. -1/-2 bei
 *  Duplikaten). Code-Fences ausgeblendet, damit `#`-Kommentare nicht zählen. */
export function collectHeadingSlugs(md) {
  const slugs = [];
  const seen = new Map();
  for (const line of stripFencedCode(md).split(/\r?\n/)) {
    const m = line.match(/^(#{1,6})\s+(.*\S)\s*$/);
    if (!m) continue;
    const base = slugify(m[2]);
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    slugs.push(n === 0 ? base : `${base}-${n}`);
  }
  return slugs;
}

// ── Audit ────────────────────────────────────────────────────────────────────────

const isMd = (p) => p.toLowerCase().endsWith(".md");

/** Vergleicht Doku gegen Realität. Gibt strukturierte Befunde zurück (leere
 *  Arrays = ok). `rootDir` überschreibbar für deterministische Tests. */
export function auditDocDrift(rootDir = ROOT) {
  const pkg = JSON.parse(readFileSync(join(rootDir, "package.json"), "utf8"));
  const scripts = new Set(Object.keys(pkg.scripts ?? {}));
  const mdFiles = collectMarkdown(rootDir);

  // Doku-Inhalte einmal einlesen (Datei → Roh-Markdown).
  const content = new Map();
  for (const f of mdFiles) content.set(f, readFileSync(join(rootDir, f), "utf8"));

  // Headings je Datei cachen (für Anker-Auflösung).
  const headingCache = new Map();
  const headingsOf = (file) => {
    if (!headingCache.has(file)) {
      const abs = join(rootDir, file);
      headingCache.set(
        file,
        existsSync(abs) && statSync(abs).isFile() && isMd(file)
          ? new Set(collectHeadingSlugs(readFileSync(abs, "utf8")))
          : null,
      );
    }
    return headingCache.get(file);
  };

  // 1. Tote Kommandos: `npm run <x>` in IRGENDEINEM md, das es nicht als Skript gibt.
  const deadCommands = [];
  for (const f of mdFiles) {
    for (const name of parseNpmRunMentions(content.get(f))) {
      if (!scripts.has(name)) deadCommands.push({ file: f, script: name });
    }
  }

  // 2. Undokumentierte Kern-Skripte: package.json-Skript (außer Exempt) in KEINEM
  //    der Kern-Docs erwähnt.
  const coreDocMentions = new Set();
  for (const f of CORE_DOCS) {
    if (content.has(f)) for (const n of parseNpmRunMentions(content.get(f))) coreDocMentions.add(n);
  }
  const undocumentedScripts = [...scripts]
    .filter((s) => !DOC_EXEMPT_SCRIPTS.has(s) && !coreDocMentions.has(s))
    .sort();

  // 3./4. Tote Links & Anker.
  const deadLinks = [];
  const deadAnchors = [];
  for (const f of mdFiles) {
    const dir = posix.dirname(f);
    for (const { target, path, anchor } of extractLinks(content.get(f))) {
      // Reiner Anker (#foo) → Ziel ist die Datei selbst.
      const targetFile = path === "" ? f : normalizeRel(dir, path, rootDir);

      if (path !== "") {
        const abs = join(rootDir, targetFile);
        if (!existsSync(abs)) {
          deadLinks.push({ file: f, target, resolved: targetFile });
          continue; // Anker eines toten Ziels nicht separat melden
        }
      }
      if (anchor) {
        const heads = headingsOf(targetFile);
        // Anker nur für Markdown-Ziele prüfen (bei .ts o.ä. ist #Lxx ein Zeilenanker).
        if (heads && !heads.has(anchor)) {
          deadAnchors.push({ file: f, target, resolved: targetFile, anchor });
        }
      }
    }
  }

  return { mdFiles, scripts: [...scripts], deadCommands, undocumentedScripts, deadLinks, deadAnchors };
}

/** Löst einen relativen (oder `/`-absoluten) Link-Pfad auf repo-relativen
 *  POSIX-Pfad auf; strippt einen `:zeile`-Suffix (z.B. foo.ts:42). */
function normalizeRel(dir, path, rootDir) {
  const clean = path.replace(/:\d+$/, "");
  const abs = clean.startsWith("/")
    ? join(rootDir, clean.slice(1))
    : resolve(join(rootDir, dir), clean);
  return relative(rootDir, abs).split(sep).join("/");
}

// ── CLI ────────────────────────────────────────────────────────────────────────
function main() {
  const tty = process.stdout.isTTY;
  const paint = (code, s) => (tty ? `\x1b[${code}m${s}\x1b[0m` : s);
  const red = (s) => paint("31", s);
  const green = (s) => paint("32", s);

  const { mdFiles, deadCommands, undocumentedScripts, deadLinks, deadAnchors } = auditDocDrift();

  let bad = false;
  for (const c of deadCommands) {
    bad = true;
    console.error(red(`✖ Totes Kommando: „npm run ${c.script}" in ${c.file} existiert nicht in package.json.`));
  }
  for (const s of undocumentedScripts) {
    bad = true;
    console.error(
      red(
        `✖ Undokumentiertes Kern-Skript „${s}" — in AGENTS.md/CLAUDE.md/README erwähnen oder (mit Begründung) in scripts/check-docdrift.mjs › DOC_EXEMPT_SCRIPTS aufnehmen.`,
      ),
    );
  }
  for (const l of deadLinks) {
    bad = true;
    console.error(red(`✖ Toter Link: „${l.target}" in ${l.file} zeigt auf ${l.resolved} (existiert nicht).`));
  }
  for (const a of deadAnchors) {
    bad = true;
    console.error(red(`✖ Toter Anker: „${a.target}" in ${a.file} — Überschrift „#${a.anchor}" gibt es in ${a.resolved} nicht.`));
  }

  if (bad) {
    console.error(`\nHarness-Doku-Drift. Kommandos/Links/Anker in der Doku bzw. package.json angleichen.`);
    process.exit(1);
  }
  console.log(
    green(
      `✔ Harness-Doku deckt sich mit dem Code (${mdFiles.length} Markdown-Dateien, Kommandos/Links/Anker konsistent).`,
    ),
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();

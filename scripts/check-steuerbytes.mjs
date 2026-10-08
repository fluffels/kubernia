// Kein Shebang: dieses Skript wird über `node scripts/check-steuerbytes.mjs` (npm run check:steuerbytes) gestartet UND von
// test/steuerbytes.test.ts importiert. Ein `#!`-Token bricht sonst den Vitest/esbuild-Import (gleiche Falle wie bei check-size.mjs).
/**
 * Steuerbyte-Wächter (#1428 Z17, eigenes Gate seit #1460 Z5): eine getrackte Textdatei mit NUL oder einem anderen C0-Steuerbyte außer
 * Tab/LF/CR wird sonst bei der Begriffsprüfung (`check:internalrefs`) still übersprungen (`findViolations` hält sie für binär) und hielte
 * auch git für eine Binärdatei: Diffs, Review und Gates sähen sie nicht mehr (Anlass: ein Skript schrieb unter Git Bash ein echtes
 * NUL-Byte in eine Datei). Ein Gate prüft eine Fehlklasse: die Begriffe bleiben in `check:internalrefs`, die Steuerbytes hier.
 *
 * Dieselbe Dateimenge wie `check:internalrefs` (getrackte Dateien ohne Binär-Endungen), darum importiert dieses Skript dessen
 * `listTrackedFiles`/`isCheckable` (einseitig: check-internalrefs kennt dieses Skript nicht). Nur Dateien, keine Commit-Messages.
 * Nicht lesbare Dateien werden übersprungen statt das Gate zu sprengen.
 *
 * Ausführen mit:  npm run check:steuerbytes   (oder als Teil von: npm run verify)
 */

import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { isCheckable, listTrackedFiles } from "./check-internalrefs.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Erste Zeile (1-basiert) mit einem Steuerbyte (C0 außer Tab, LF und CR) oder `null`. Pur. */
export function ersteSteuerzeile(content) {
  let zeile = 1;
  for (let i = 0; i < content.length; i++) {
    const c = content.charCodeAt(i);
    if (c === 10) zeile += 1;
    else if (c < 32 && c !== 9 && c !== 13) return zeile;
  }
  return null;
}

/** Je Datei mit Steuerbyte ein Treffer `{ file, line }`. `readFile` ist injizierbar; nicht lesbare Dateien werden übersprungen. */
export function findSteuerbytes(files, readFile) {
  const hits = [];
  for (const file of files) {
    let content;
    try {
      content = readFile(file);
    } catch {
      continue;
    }
    const line = ersteSteuerzeile(content);
    if (line !== null) hits.push({ file, line });
  }
  return hits;
}

/** Kompletter Lauf gegen das echte Repo (`io` macht Dateiliste und Lesen für Tests injizierbar). */
export function runSteuerbytes(rootDir = ROOT, io = {}) {
  const { listFiles = listTrackedFiles, readFile = (rel) => readFileSync(join(rootDir, rel), "utf8") } = io;
  const files = listFiles(rootDir).filter((f) => isCheckable(f));
  return { files, violations: findSteuerbytes(files, readFile) };
}

function main() {
  const tty = process.stdout.isTTY;
  const paint = (code, s) => (tty ? `\x1b[${code}m${s}\x1b[0m` : s);
  const { files, violations } = runSteuerbytes();
  if (violations.length === 0) {
    console.log(paint("32", `✔ Keine Steuerbytes in Textdateien (${files.length} Dateien geprüft).`));
    return;
  }
  for (const v of violations) console.error(paint("31", `✖ ${v.file}:${v.line} — Steuerbyte in der Textdatei`));
  console.error(
    `\n${violations.length} Datei(en) mit NUL oder anderem C0-Steuerzeichen (außer Tab, LF, CR): git hielte sie für binär, Diff und Review sähen sie nicht. ` +
      `Skript per Write schreiben, Steuerzeichen nur als Escape-Folge im Quelltext (docs/agent-harness-faq.md).`,
  );
  process.exit(1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();

// Kein Shebang: dieses Skript wird über `node scripts/check-bundle.mjs`
// (npm run check:bundle) gestartet UND von test/bundle.test.ts importiert. Eine
// `#!`-Zeile bricht genau diesen Test-Import (Vitest/esbuild stolpert über das `#!`),
// darum bewusst weggelassen — analog zu check-size.mjs / check-diffsize.mjs.
/**
 * Bundle-Größenbudget-Wächter (#503) — Byte-Budget für die AUSGELIEFERTEN Artefakte.
 *
 * Hintergrund (Architektur-Analyse 2026-07, iSAQB): es gibt zwar ein Zeilen-Budget
 * je Quell-Modul (check-size.mjs, 800 LOC) und ein Diff-Budget je Slice
 * (check-diffsize.mjs), aber KEIN Byte-Budget für das, was der Nutzer wirklich lädt.
 * vite.config.ts setzt nur `chunkSizeWarningLimit` — das ist eine Log-WARNUNG, kein
 * Fail. Besonders der Offline-Build (vite-plugin-singlefile) inlined ALLE Assets als
 * base64 in EINE HTML — die Vorzeigefunktion („per Doppelklick offline spielbar"),
 * die bei jedem neuen PixelLab-Asset unbemerkt wächst. Bei Stardew-Scope wachsen die
 * Assets >> der Code; ohne hartes Gate rutscht das schleichend durch.
 *
 * Dieser Wächter misst die GEBAUTEN Artefakte und wird ROT, wenn eines sein
 * Byte-Budget überschreitet. Macht die `chunkSizeWarningLimit`-Behauptung wahr.
 *
 * WAS gemessen wird (bewusst zwei Ziele):
 *  1. dist-offline/index.html — die self-contained Offline-Datei (Code + ALLE Assets
 *     inline). Das eigentliche Wachstums-Risiko aus dem Ticket.
 *  2. Der Spielcode in dist/ (alle JS-Chunks OHNE den Phaser-`vendor`-Chunk). Phaser
 *     (~1,2 MB) ist bewusst ein eigener, langlebiger Vendor-Chunk (#199) und ändert
 *     sich selten — es NICHT mitzumessen hält das Budget auf UNSEREM Code, der bei
 *     Stardew-Scope wächst. Ein Phaser-Bump fällt separat beim Offline-Budget auf.
 *
 * WANN er läuft: NUR wenn die Builds da sind — als CI-Schritt NACH den Builds und
 * als Teil von `npm run verify:full` (nach `build`+`build:offline`). Bewusst NICHT
 * in der schnellen `npm run verify`-Kette, die baut nichts. Fehlt ein Artefakt,
 * wird der Wächter ROT (mit „erst bauen"-Hinweis) statt still grün — ein Gate, das
 * nichts gemessen hat, darf nicht grün melden.
 *
 * „Gleiche Allowlist-Philosophie" wie check-size (kein Grün-durch-Aufweichen): ist ein
 * Budget zu klein, wird es NICHT stillschweigend hochgesetzt — die Konstante hier wird
 * per reviewtem Commit mit Ein-Zeilen-Begründung angehoben (Ratchet nach oben, wenn
 * eine bewusste Ergänzung das Bundle legitim wachsen lässt), nie von der Maschine.
 * Die Budgets tragen bewusst MODERATE Kopffreiheit über dem Ist (nicht hauchdünn wie
 * die 800 LOC): Byte-Größen rauschen (Minifier-/Vite-/Phaser-Bumps), ein zu enges
 * Budget würde bei jedem Dependency-Update tripp­en → Override-Inflation → der Wächter
 * wird ignoriert (genau das #395-Antipattern). Genug Luft für ein paar Assets, aber
 * Alarm bei Weglauf-Wachstum.
 *
 * Reines Node-Skript (nur Builtins). Die Klassifikations-/Bewertungslogik ist als
 * pure, IO-freie Funktionen exportiert; das eigentliche Messen läuft über eine
 * injizierbare `io`-Schnittstelle — beides testet test/bundle.test.ts deterministisch
 * ohne echten Build. EINE Quelle der Wahrheit für Budgets, Klassifikation, Bewertung.
 *
 * Ausführen mit:  npm run check:bundle   (oder als Teil von: npm run verify:full)
 */

import { existsSync, statSync, readdirSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Byte-Budgets je Artefakt. `maxBytes` ist die harte Obergrenze (STRIKT: „über" heißt
 * `> maxBytes`, == Budget ist ok — analog zu check-size `loc > budget`).
 *
 * Ist-Werte bei Kalibrierung (2026-07-02, `npm run build` + `build:offline`):
 *   • dist-offline/index.html        ~2.39 MiB (2_509_465 B)  → Budget 2_750_000 (~+10 %)
 *   • Spielcode (dist/, ohne vendor) ~1.07 MiB (1_119_019 B)  → Budget 1_250_000 (~+12 %)
 */
export const BUNDLE_BUDGETS = [
  {
    label: "Offline-Build (self-contained HTML, alle Assets inline)",
    kind: "file",
    path: "dist-offline/index.html",
    maxBytes: 2_750_000,
  },
  {
    label: "Spielcode-Chunks in dist/ (ohne Phaser-vendor)",
    kind: "game-chunks",
    dir: "dist/assets",
    maxBytes: 1_250_000,
  },
];

/** Ist eine dist/-JS-Datei der langlebige Phaser-Vendor-Chunk (#199)? Vite benennt
 *  ihn `vendor-<hash>.js` (manualChunks-Name „vendor"). Der wird NICHT mitgemessen. */
export function isVendorChunk(name) {
  return /^vendor-.*\.js$/.test(name);
}

/** Zählt eine dist/-Datei zum Spielcode-Budget? Alle JS-Chunks außer dem Vendor-Chunk
 *  (also Entry-`index-*.js` + Bundler-Runtime-Glue + evtl. künftige App-Splits).
 *  Sourcemaps (.js.map) zählen nicht — reines Nutzer-Payload. */
export function isGameChunk(name) {
  return name.endsWith(".js") && !name.endsWith(".js.map") && !isVendorChunk(name);
}

/** Bewertet gemessene Bytes gegen das Budget. STRIKT größer = über (== ist ok). */
export function evaluateBudget(bytes, maxBytes) {
  return bytes > maxBytes;
}

/** Menschenlesbare Byte-Größe (B / KiB / MiB), für die Reports. */
export function fmtBytes(n) {
  if (n < 1024) return `${n} B`;
  const kib = n / 1024;
  if (kib < 1024) return `${kib.toFixed(1)} KiB`;
  return `${(kib / 1024).toFixed(2)} MiB`;
}

/**
 * Misst EIN Budget über die injizierte `io`-Schnittstelle.
 *   io.exists(relPath) → boolean
 *   io.size(relPath)   → Bytes (Number)
 *   io.list(relDir)    → string[] Dateinamen | null (Verzeichnis fehlt)
 * Rückgabe: { label, maxBytes, bytes, files, missing, over }.
 *   `missing` = das Artefakt liegt nicht vor (nicht gebaut) → NICHT bewertbar.
 */
export function measureBudget(budget, io) {
  if (budget.kind === "file") {
    if (!io.exists(budget.path)) {
      return { label: budget.label, maxBytes: budget.maxBytes, bytes: 0, files: [], missing: true, over: false };
    }
    const bytes = io.size(budget.path);
    return { label: budget.label, maxBytes: budget.maxBytes, bytes, files: [budget.path], missing: false, over: evaluateBudget(bytes, budget.maxBytes) };
  }
  // kind === "game-chunks": alle Nicht-Vendor-JS im Verzeichnis aufsummieren.
  const names = io.list(budget.dir);
  const chunks = (names ?? []).filter(isGameChunk).sort();
  if (names === null || chunks.length === 0) {
    return { label: budget.label, maxBytes: budget.maxBytes, bytes: 0, files: [], missing: true, over: false };
  }
  const files = chunks.map((n) => `${budget.dir}/${n}`);
  const bytes = files.reduce((sum, f) => sum + io.size(f), 0);
  return { label: budget.label, maxBytes: budget.maxBytes, bytes, files, missing: false, over: evaluateBudget(bytes, budget.maxBytes) };
}

/** Prüft alle Budgets. `io`/`budgets` injizierbar (Test). Rückgabe ist rein
 *  strukturiert; das CLI rendert es nur. */
export function checkBundle({ io, budgets = BUNDLE_BUDGETS } = {}) {
  const resolvedIo = io ?? defaultIo(ROOT);
  const results = budgets.map((b) => measureBudget(b, resolvedIo));
  return {
    results,
    missing: results.some((r) => r.missing),
    over: results.some((r) => r.over),
  };
}

/** Default-IO auf dem echten Dateisystem (repo-relativ zu `rootDir`). */
export function defaultIo(rootDir = ROOT) {
  return {
    exists: (p) => existsSync(join(rootDir, p)),
    size: (p) => statSync(join(rootDir, p)).size,
    list: (p) => {
      const abs = join(rootDir, p);
      return existsSync(abs) && statSync(abs).isDirectory() ? readdirSync(abs) : null;
    },
  };
}

// ── CLI ──────────────────────────────────────────────────────────────────────
function main() {
  const tty = process.stdout.isTTY;
  const paint = (code, s) => (tty ? `\x1b[${code}m${s}\x1b[0m` : s);
  const red = (s) => paint("31", s);
  const green = (s) => paint("32", s);
  const dim = (s) => paint("2", s);

  const { results, missing, over } = checkBundle();

  // Fehlende Artefakte: NICHT still grün — der Wächter läuft nach den Builds, ein
  // fehlendes Artefakt heißt „in falscher Reihenfolge aufgerufen / Build kaputt".
  if (missing) {
    for (const r of results.filter((x) => x.missing))
      console.error(red(`✖ Artefakt fehlt für „${r.label}" — nichts zu messen.`));
    console.error(
      `\nDie Builds fehlen. Erst bauen, dann prüfen:\n` +
        `  npm run build && npm run build:offline && npm run check:bundle\n` +
        `(im CI läuft check:bundle als Schritt NACH den Builds, in verify:full ebenso).`,
    );
    process.exit(1);
  }

  for (const r of results) {
    const line = `${r.label}: ${fmtBytes(r.bytes)} / Budget ${fmtBytes(r.maxBytes)}`;
    if (r.over) console.error(red(`✖ ${line} — überschritten (${r.bytes} > ${r.maxBytes} B).`));
    else console.log(dim(`• ${line} (${r.bytes} B)`));
  }

  if (over) {
    console.error(
      `\nBundle-Budget überschritten. Verkleinern (Assets optimieren/entfernen, Code trimmen)\n` +
        `— ODER, wenn das Wachstum bewusst und legitim ist, das Budget in scripts/check-bundle.mjs\n` +
        `(BUNDLE_BUDGETS) mit Ein-Zeilen-Begründung anheben (Ratchet, reviewter Commit).`,
    );
    process.exit(1);
  }

  console.log(green(`✔ Bundle-Budgets ok — alle Artefakte im Rahmen.`));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();

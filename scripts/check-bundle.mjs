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
 * WAS gemessen wird (bewusst drei Ziele):
 *  1. dist-offline/index.html — die self-contained Offline-Datei (Code + ALLE Assets
 *     inline). Das eigentliche Wachstums-Risiko aus dem Ticket.
 *  2. Der Spielcode in dist/ (alle JS-Chunks OHNE den Phaser-`vendor`-Chunk). Phaser
 *     (~1,2 MB) ist bewusst ein eigener, langlebiger Vendor-Chunk (#199) und ändert
 *     sich selten — es NICHT mitzumessen hält DIESES Budget auf UNSEREM Code, der bei
 *     Stardew-Scope wächst.
 *  3. Der Phaser-`vendor`-Chunk in dist/ selbst — sein EIGENES hartes Byte-Gate (#595).
 *     Vorher fiel ein Phaser-Bump, der den Vendor-Chunk aufbläht, nur indirekt übers
 *     Offline-HTML-Budget auf (dort mit dem Code zusammengerechnet), und vite hatte für
 *     ihn nur `chunkSizeWarningLimit` (eine Log-WARNUNG, kein Fail). Ein eigenes,
 *     ratchetbares Budget macht den Vendor-Chunk-Bump zu einem echten, gezielten Gate,
 *     ohne das Spielcode-Budget (Ziel 2) zu verwässern.
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
 * Ist-Werte bei Kalibrierung (2026-07-02/03, `npm run build` + `build:offline`):
 *   • dist-offline/index.html        ~2.91 MiB (3_048_514 B)  → Budget 3_100_000 (seit #690, +~118 KB für 4 Sturm-Trümmer-Assets + pier_ruined #691)
 *   • Spielcode (dist/, ohne vendor) ~1.26 MiB (1_317_022 B)  → Budget 1_380_000 (seit #252, +~66 KB für die 349 why-Begründungen)
 *   • Phaser-vendor-Chunk (dist/)    ~1.14 MiB (1_198_788 B)  → Budget 1_350_000 (~+12 %, #595)
 */
export const BUNDLE_BUDGETS = [
  {
    label: "Offline-Build (self-contained HTML, alle Assets inline)",
    kind: "file",
    path: "dist-offline/index.html",
    // #645: +30 KB für die 7 gerahmten HUD-Statuszeilen-Pixel-Icons (base64 inline).
    // #252: +~60 KB — die 349 „why"-Begründungen (Terminal-Tasks + Teach-Befehle) landen als Content-JSON im Bundle.
    // #647: +~13 KB — die 3 neuen Panel-Kopf-Icons (Shop/Krabbe/Spiel; Logbuch/Album/Terminal/Menü teilen sich #646-Icons, kein Zusatz-Byte).
    // #474: +~160 KB — Phaser 3→4 (v4 ist groesser als v3, Renderer komplett neu geschrieben).
    // #690: +~118 KB — 4 Sturm-Trümmer-PixelLab-Assets (lighthouse_ruined, crane_wrecked, house_office_damaged, ship_wrecked) + pier_ruined (#691); base64-inline.
    maxBytes: 3_200_000,
  },
  {
    label: "Spielcode-Chunks in dist/ (ohne Phaser-vendor)",
    kind: "game-chunks",
    dir: "dist/assets",
    // #252: +~66 KB — die 349 „why"-Begründungen im Content-JSON wachsen den Spielcode-Chunk.
    // #669: +~4 KB — 4 neue Innenraum-Möbel-PNGs (Tisch/Konsole/Buch/Amboss, je 32×32).
    maxBytes: 1_390_000,
  },
  {
    label: "Phaser-vendor-Chunk in dist/ (#595)",
    kind: "vendor-chunk",
    dir: "dist/assets",
    // #474: +~26 KB — Phaser 3→4 (v4 vendor-Chunk ist groesser als v3).
    maxBytes: 1_450_000,
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

/** Welche dist/-Dateien ein Chunk-Budget aufsummiert, je `kind`. Die beiden Filter sind
 *  komplementär: `game-chunks` = alles außer Vendor (Ziel 2), `vendor-chunk` = nur der
 *  Phaser-Vendor (Ziel 3, #595). EINE Quelle, damit `measureBudget` kind-generisch bleibt. */
export const CHUNK_FILTERS = {
  "game-chunks": isGameChunk,
  "vendor-chunk": isVendorChunk,
};

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
  // Chunk-Kinds ("game-chunks"/"vendor-chunk"): die passenden JS-Chunks aufsummieren.
  const pick = CHUNK_FILTERS[budget.kind];
  const names = io.list(budget.dir);
  const chunks = (names ?? []).filter(pick).sort();
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

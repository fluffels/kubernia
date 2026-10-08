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
 * WAS gemessen wird (bewusst vier Ziele; Begründung der Aufteilung: ADR 0018, #1408):
 *  1. dist-offline/index.html — die self-contained Offline-Datei (Code + ALLE Assets
 *     inline). Das eigentliche Wachstums-Risiko aus dem Ticket.
 *  2. Der Spielcode in dist/ (alle JS-Chunks direkt in dist/assets OHNE den Phaser-`vendor`-
 *     Chunk und OHNE die Content-Chunks in dist/assets/content/). Phaser
 *     (~1,2 MB) ist bewusst ein eigener, langlebiger Vendor-Chunk (#199) und ändert
 *     sich selten — es NICHT mitzumessen hält DIESES Budget auf UNSEREM Code, der bei
 *     Stardew-Scope wächst.
 *  3. Die Content-Chunks (dist/assets/content/, je Content-Datei und Karte einer): die erwartete
 *     Menge leitet sich aus den Quellen ab (scripts/content-chunks.cjs), ein fehlender oder
 *     unerwarteter Chunk ist rot, jeder Chunk hat einen Deckel (`maxBytesPerChunk`), die Summe
 *     ist der Auslöser für Stufe 2 (Lazy-Load je Region, ADR 0018).
 *  4. Der Phaser-`vendor`-Chunk in dist/ selbst — sein EIGENES hartes Byte-Gate (#595).
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

import { existsSync, readFileSync, statSync, readdirSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";

// Namensregel der Content-Chunks: EINE Quelle, dieselbe nutzt vite.config.ts (manualChunks).
const { CONTENT_CHUNK_DIR, expectedContentChunks, contentChunkCollisions, stempelAusHtml } = createRequire(import.meta.url)("./content-chunks.cjs");

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Content-Chunk-Ordner relativ zum Repo-Root (dist/ + gemeinsamer Teil aus content-chunks.cjs). */
const CONTENT_CHUNK_DIR_DIST = `dist/${CONTENT_CHUNK_DIR}`;

/** index.html des Host-Builds: trägt wie die Offline-Datei den Content-Stempel (vite.config.ts, #1411). */
const HOST_HTML = "dist/index.html";

/**
 * Byte-Budgets je Artefakt. `maxBytes` ist die harte Obergrenze (STRIKT: „über" heißt
 * `> maxBytes`, == Budget ist ok — analog zu check-size `loc > budget`).
 *
 * Kalibrierung (Stand #1408, `npm run build` + `build:offline`; Herleitung und Re-Evaluierung: ADR 0018):
 *   • Spielcode (ohne vendor, ohne Content) 501_798 B (gemessen mit #1408; nach dessen Merge 503_687 B) → Budget
 *     Ist +5 %, auf 10_000 aufgerundet = 530_000 (503_687 B ergäben dieselbe Rundung).
 *   • Content-Chunks: 54 Chunks, 770_281 B zusammen, größter 95_216 B → Deckel je Chunk 128_000,
 *     Summe 2_000_000 als Stufe-2-Auslöser (NICHT anheben: dann Lazy-Load je Region bauen, ADR 0018).
 *   • Offline-HTML ohne Content-Chunks: Offline-Budget 3_300_000 minus Content-Ist (770_281),
 *     auf 1_000 abgerundet = 2_529_000. Die Differenz beim Subtrahieren (~70 B Wrapper je Chunk)
 *     ist Messrauschen. Der Rest-Puffer gegenüber dem alten Budget bleibt so unverändert.
 *   • Phaser-vendor-Chunk (dist/) 1_450_000 (#595, #474).
 */
export const BUNDLE_BUDGETS = [
  {
    label: "Offline-Build (self-contained HTML, alle Assets inline, ohne Content-Chunks)",
    kind: "file",
    path: "dist-offline/index.html",
    // Die Offline-Datei enthält den Content inline; er wird über `subtractChunksDir` abgezogen und
    // zählt allein bei den Content-Chunks (ADR 0018). Gemessen: Offline-HTML minus Summe der Chunks.
    subtractChunksDir: CONTENT_CHUNK_DIR_DIST,
    maxBytes: 2_539_000, // #1469: +7_249 B für den Call-Vertrag der CLI-Familien (cliargs, kubeadm/git/aws-Tabellen), Stand 2_535_491 B
  },
  {
    label: "Spielcode-Chunks in dist/ (ohne Phaser-vendor, ohne Content)",
    kind: "game-chunks",
    dir: "dist/assets",
    maxBytes: 540_000, // #1469: +7_225 B (528_073 → 535_298) für denselben Vertrag; eine Quelle statt Handler-eigener Parser
  },
  {
    label: "Content-Chunks in dist/assets/content/ (je Datei/Karte, ADR 0018)",
    kind: "content-chunks",
    dir: CONTENT_CHUNK_DIR_DIST,
    // Deckel je Chunk: reißt eine Datei ihn, in Unterdateien splitten (src/content/AGENTS.md), NICHT anheben.
    maxBytesPerChunk: 128_000,
    // Chunk-Zahl: ab ~200 Chunks (alle per modulepreload beim Boot) ist Stufe 2 fällig (ADR 0018), nicht anheben.
    maxChunks: 200,
    // Summe: Auslöser für Stufe 2 (Lazy-Load je Region, ADR 0018). Anheben ist verboten, dann Stufe 2 bauen.
    maxBytes: 2_000_000,
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
  // Content-Chunks liegen in ihrem eigenen Ordner; dort zählt jede .js-Datei (kein .map).
  "content-chunks": (name) => name.endsWith(".js") && !name.endsWith(".js.map"),
};

/** Chunk-Name einer gebauten Content-Datei: Dateiname bis zum ersten Punkt
 *  (`content-quests-knut.BRXJNzh0.js` → `content-quests-knut`). */
export function builtChunkName(file) {
  return file.split(".")[0];
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
 * Vergleicht den Content-Stempel von `dist/index.html` und der Offline-Datei des Budgets. Rückgabe: `{ missing, hinweis }`
 * (ein Stempel oder eine Datei fehlt → erst bauen), `{ problem }` (verschiedene Stände) oder `{}` (gleich).
 *   io.readText(relPath) → Dateitext
 */
function pruefeContentStempel(budget, io) {
  const lies = (pfad) => (io.exists(pfad) ? stempelAusHtml(io.readText(pfad)) : null);
  const host = lies(HOST_HTML);
  const offline = lies(budget.path);
  if (host === null || offline === null) {
    const wo = [host === null ? HOST_HTML : null, offline === null ? budget.path : null].filter(Boolean).join(" und ");
    return { missing: true, hinweis: `Content-Stempel fehlt in ${wo} (kein Build von diesem Stand oder das Stempel-Plugin in vite.config.ts fehlt): beide Builds neu erzeugen` };
  }
  if (host !== offline) {
    return { problem: `dist/ und dist-offline/ stammen von verschiedenen Content-Ständen (Stempel ${host.slice(0, 12)} gegen ${offline.slice(0, 12)}): beide neu bauen (npm run build && npm run build:offline), sonst ist der Abzug der Content-Chunks falsch` };
  }
  return {};
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
    let bytes = io.size(budget.path);
    if (budget.subtractChunksDir) {
      // Offline-HTML ohne Content: die Chunk-Summe des Host-Builds abziehen. Fehlt der Host-Build, ist
      // nichts verlässlich zu messen → missing (Gate rot), nicht ungeprüft die ganze Datei gegen das kleinere Budget.
      const names = (io.list(budget.subtractChunksDir) ?? []).filter(CHUNK_FILTERS["content-chunks"]);
      if (names.length === 0) {
        return { label: budget.label, maxBytes: budget.maxBytes, bytes: 0, files: [], missing: true, over: false };
      }
      // Der Abzug gilt nur, wenn dist/ und dist-offline/ denselben Content-Stand haben (#1411): beide index.html
      // tragen den Stempel der Content-Quellen. Fehlt einer (alter Build, Plugin entfernt), ist nichts verlässlich zu messen.
      const stempel = pruefeContentStempel(budget, io);
      if (stempel.missing) return { label: budget.label, maxBytes: budget.maxBytes, bytes: 0, files: [], missing: true, over: false, hinweis: stempel.hinweis };
      if (stempel.problem) {
        return { label: budget.label, maxBytes: budget.maxBytes, bytes: 0, files: [], missing: false, over: true, problems: [stempel.problem], stempelProblem: true };
      }
      bytes -= names.reduce((sum, n) => sum + io.size(`${budget.subtractChunksDir}/${n}`), 0);
    }
    return { label: budget.label, maxBytes: budget.maxBytes, bytes, files: [budget.path], missing: false, over: evaluateBudget(bytes, budget.maxBytes) };
  }
  if (budget.kind === "content-chunks") return measureContentChunks(budget, io);
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

/** Content-Chunks (ADR 0018): erwartete Menge aus den Quellen gegen die gebaute, Deckel je Chunk, Summe.
 *  `problems` nennt jeden Verstoß einzeln (fehlend, unerwartet, zu groß, Summe); `over` = mindestens einer. */
function measureContentChunks(budget, io) {
  const base = { label: budget.label, maxBytes: budget.maxBytes, bytes: 0, files: [], missing: false, over: false, problems: [] };
  const names = io.list(budget.dir);
  if (names === null) return { ...base, missing: true };
  const built = names.filter(CHUNK_FILTERS["content-chunks"]).sort();
  const files = built.map((n) => `${budget.dir}/${n}`);
  const sizes = files.map((f) => io.size(f));
  const bytes = sizes.reduce((sum, n) => sum + n, 0);
  const expected = expectedContentChunks(io);
  const builtNames = new Set(built.map(builtChunkName));
  const problems = [];
  for (const e of expected) {
    if (!builtNames.has(e)) problems.push(`Content-Chunk ${e} fehlt (Quelldatei und Namensregel: scripts/content-chunks.cjs, ADR 0018)`);
  }
  for (const c of contentChunkCollisions(io)) {
    problems.push(`Namenskollision: ${c.files.join(" und ")} ergeben beide ${c.name} (Dateien umbenennen, Namensregel: scripts/content-chunks.cjs)`);
  }
  if (built.length > budget.maxChunks) {
    problems.push(`${built.length} Content-Chunks > ${budget.maxChunks}: Stufe-2-Auslöser, Lazy-Load je Region bauen (ADR 0018), Grenze nicht anheben`);
  }
  const expectedSet = new Set(expected);
  for (const n of [...builtNames].sort()) {
    if (!expectedSet.has(n)) problems.push(`Unerwarteter Content-Chunk ${n} (keine Quelldatei dazu, Namensregel: scripts/content-chunks.cjs)`);
  }
  files.forEach((f, i) => {
    if (sizes[i] > budget.maxBytesPerChunk) {
      problems.push(`${f}: ${sizes[i]} B > Deckel ${budget.maxBytesPerChunk} B je Chunk (Datei in Unterdateien splitten, Deckel nicht anheben)`);
    }
  });
  if (evaluateBudget(bytes, budget.maxBytes)) {
    problems.push(`Content-Summe ${bytes} B > ${budget.maxBytes} B: Stufe-2-Auslöser, Lazy-Load je Region bauen (ADR 0018), Budget nicht anheben`);
  }
  return { ...base, bytes, files, problems, over: problems.length > 0 };
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
    readText: (p) => readFileSync(join(rootDir, p), "utf8"),
    list: (p) => {
      const abs = join(rootDir, p);
      return existsSync(abs) && statSync(abs).isDirectory() ? readdirSync(abs) : null;
    },
    // Rekursiv alle Dateien (repo-relative Pfade, Posix-Trenner) für die erwartete Content-Chunk-Menge.
    listFiles: (p) => {
      const walk = (rel) => {
        const abs = join(rootDir, rel);
        if (!existsSync(abs) || !statSync(abs).isDirectory()) return [];
        return readdirSync(abs).flatMap((n) => {
          const r = `${rel}/${n}`;
          return statSync(join(rootDir, r)).isDirectory() ? walk(r) : [r];
        });
      };
      return existsSync(join(rootDir, p)) ? walk(p) : null;
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
      console.error(red(r.hinweis ? `✖ ${r.label}: ${r.hinweis}` : `✖ Artefakt fehlt für „${r.label}" — nichts zu messen.`));
    console.error(
      `\nDie Builds fehlen (oder dist/assets/content fehlt: greift manualChunks in vite.config.ts nicht mehr?). Erst bauen, dann prüfen:\n` +
        `  npm run build && npm run build:offline && npm run check:bundle\n` +
        `(im CI läuft check:bundle als Schritt NACH den Builds, in verify:full ebenso).`,
    );
    process.exit(1);
  }

  for (const r of results) {
    const line = `${r.label}: ${fmtBytes(r.bytes)} / Budget ${fmtBytes(r.maxBytes)}`;
    if (r.stempelProblem) {
      for (const p of r.problems) console.error(red(`✖ ${p}`));
    } else if (r.problems) {
      const pct = ((r.bytes / r.maxBytes) * 100).toFixed(0);
      console.log(dim(`• ${line} (${r.bytes} B, ${pct} % der Summe, ${r.files.length} Chunks)`));
      for (const p of r.problems) console.error(red(`✖ ${p}`));
    } else if (r.over) console.error(red(`✖ ${line} — überschritten (${r.bytes} > ${r.maxBytes} B).`));
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

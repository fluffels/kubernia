// Namensregel der Content-Chunks (#1408, ADR 0018) als EINE Quelle der Wahrheit.
//
// Der Host-Build (vite.config.ts, `manualChunks`) legt jede Content-Datei in einen eigenen Chunk,
// das Gate (scripts/check-bundle.mjs) leitet daraus die ERWARTETE Menge ab: ein fehlender oder
// unerwarteter Chunk ist rot. Bewusst .cjs (wie layers.cjs): vite.config.ts zieht es per
// createRequire, das Gate ebenso.

/** Ausgabeordner der Content-Chunks relativ zu dist/. */
const CONTENT_CHUNK_DIR = "assets/content";

const DATA_RE = /(?:^|\/)src\/content\/data\/(?:([^/]+)\/)?([^/]+)\.json$/;
const MAP_RE = /(?:^|\/)assets\/maps\/([^/]+)\.tmj$/;

const clean = (s) => s.toLowerCase().replace(/[^a-z0-9-]/g, "-");

/** Chunk-Name zu einer Modul-ID (Rollup-ID, auch mit Windows-Backslashes oder `?raw`); sonst undefined. */
function contentChunkName(id) {
  const p = id.replace(/\\/g, "/").replace(/\?.*$/, "");
  const data = DATA_RE.exec(p);
  if (data) return data[1] ? `content-${clean(data[1])}-${clean(data[2])}` : "content-core";
  const map = MAP_RE.exec(p);
  if (map) return `content-maps-${clean(map[1])}`;
  return undefined;
}

/** Erwartete Chunk-Namen aus den Quellen. `io.listFiles(relDir)` liefert rekursiv alle Dateien
 *  (repo-relative Pfade) oder null, wenn das Verzeichnis fehlt. */
function expectedContentChunks(io) {
  const names = new Set();
  for (const root of ["src/content/data", "assets/maps"]) {
    for (const f of io.listFiles(root) ?? []) {
      const n = contentChunkName(f);
      if (n) names.add(n);
    }
  }
  return [...names].sort();
}

/** Kollisionen der Namensregel: verschiedene Quelldateien, die auf denselben Chunk-Namen fallen
 *  (verlustbehaftete Bereinigung wie `Knut_DNS` gegen `knut-dns`, oder ein Datenordner `maps/` gegen
 *  `assets/maps/`). Nur `content-core` darf bewusst mehrere Dateien bündeln. Rollup fasst Module mit
 *  gleichem `manualChunks`-Namen still zusammen, dann griffe der Deckel je Datei nicht mehr.
 *  Rückgabe: Liste `{ name, files }`, leer = eindeutig. */
function contentChunkCollisions(io) {
  const byName = new Map();
  for (const root of ["src/content/data", "assets/maps"]) {
    for (const f of io.listFiles(root) ?? []) {
      const n = contentChunkName(f);
      if (!n || n === "content-core") continue;
      byName.set(n, [...(byName.get(n) ?? []), f]);
    }
  }
  return [...byName].filter(([, files]) => files.length > 1).map(([name, files]) => ({ name, files }));
}

module.exports = { CONTENT_CHUNK_DIR, contentChunkName, expectedContentChunks, contentChunkCollisions };

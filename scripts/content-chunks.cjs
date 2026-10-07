// Namensregel der Content-Chunks (#1408, ADR 0018) als EINE Quelle der Wahrheit.
//
// Der Host-Build (vite.config.ts, `manualChunks`) legt jede Content-Datei in einen eigenen Chunk,
// das Gate (scripts/check-bundle.mjs) leitet daraus die ERWARTETE Menge ab: ein fehlender oder
// unerwarteter Chunk ist rot. Bewusst .cjs (wie layers.cjs): vite.config.ts zieht es per
// createRequire, das Gate ebenso.
//
// Dazu der Stempel (#1411): ein Hash über alle Content-Quellen, den beide Builds als Meta-Tag in ihre
// index.html schreiben; das Gate vergleicht sie (das Offline-Budget zieht die Chunks des Host-Builds ab und
// braucht darum denselben Content-Stand in dist/ und dist-offline/).

const { createHash } = require("node:crypto");
const { existsSync, readFileSync, readdirSync, statSync } = require("node:fs");
const { join } = require("node:path");

/** Ausgabeordner der Content-Chunks relativ zu dist/. */
const CONTENT_CHUNK_DIR = "assets/content";

/** Quellordner der Content-Chunks (repo-relativ). */
const CONTENT_SOURCE_ROOTS = ["src/content/data", "assets/maps"];

/** Name des Meta-Tags, das den Content-Stempel in der index.html des Builds trägt. */
const CONTENT_STEMPEL_META = "kq-content-stempel";

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

/** Alle Quelldateien, die einen Content-Chunk speisen, als `{ file, name }` (repo-relative Pfade, Reihenfolge der
 *  Quellordner). Der gemeinsame Walker für die erwartete Menge, die Kollisionsprüfung und den Stempel.
 *  `io.listFiles(relDir)` liefert rekursiv alle Dateien oder null, wenn das Verzeichnis fehlt. */
function contentSourceFiles(io) {
  const out = [];
  for (const root of CONTENT_SOURCE_ROOTS) {
    for (const file of io.listFiles(root) ?? []) {
      const name = contentChunkName(file);
      if (name) out.push({ file, name });
    }
  }
  return out;
}

/** Erwartete Chunk-Namen aus den Quellen. */
function expectedContentChunks(io) {
  return [...new Set(contentSourceFiles(io).map((s) => s.name))].sort();
}

/** Kollisionen der Namensregel: verschiedene Quelldateien, die auf denselben Chunk-Namen fallen
 *  (verlustbehaftete Bereinigung wie `Knut_DNS` gegen `knut-dns`, oder ein Datenordner `maps/` gegen
 *  `assets/maps/`). Nur `content-core` darf bewusst mehrere Dateien bündeln. Rollup fasst Module mit
 *  gleichem `manualChunks`-Namen still zusammen, dann griffe der Deckel je Datei nicht mehr.
 *  Rückgabe: Liste `{ name, files }`, leer = eindeutig. */
function contentChunkCollisions(io) {
  const byName = new Map();
  for (const { file, name } of contentSourceFiles(io)) {
    if (name === "content-core") continue;
    byName.set(name, [...(byName.get(name) ?? []), file]);
  }
  return [...byName].filter(([, files]) => files.length > 1).map(([name, files]) => ({ name, files }));
}

/** Stempel des Content-Stands: sha256 über Pfad und Bytes aller Content-Quellen, nach Pfad sortiert (Reihenfolge
 *  der Platte spielt keine Rolle). `io.readFile(rel)` liefert Buffer oder String. Ein Wechsel an Inhalt, Name oder
 *  Menge der Dateien ändert den Stempel. */
function contentStempel(io) {
  const hash = createHash("sha256");
  const dateien = contentSourceFiles(io)
    .map((s) => s.file)
    .sort();
  for (const file of dateien) {
    hash.update(file).update("\0").update(io.readFile(file)).update("\0");
  }
  return hash.digest("hex");
}

/** Liest den Stempel aus einem HTML-Text (Meta-Tag `kq-content-stempel`); null, wenn keiner drinsteht. */
function stempelAusHtml(html) {
  const m = new RegExp(`<meta\\s+name="${CONTENT_STEMPEL_META}"\\s+content="([0-9a-f]+)"`).exec(String(html));
  return m ? m[1] : null;
}

/** Datei-IO auf dem echten Dateisystem für `contentStempel`/`contentSourceFiles` (repo-relativ zu `rootDir`). */
function fsContentIo(rootDir) {
  const walk = (rel) => {
    const abs = join(rootDir, rel);
    if (!existsSync(abs) || !statSync(abs).isDirectory()) return [];
    return readdirSync(abs).flatMap((n) => {
      const r = `${rel}/${n}`;
      return statSync(join(rootDir, r)).isDirectory() ? walk(r) : [r];
    });
  };
  return {
    listFiles: (p) => (existsSync(join(rootDir, p)) ? walk(p) : null),
    readFile: (rel) => readFileSync(join(rootDir, rel)),
  };
}

module.exports = {
  CONTENT_CHUNK_DIR,
  CONTENT_SOURCE_ROOTS,
  CONTENT_STEMPEL_META,
  contentChunkName,
  contentSourceFiles,
  expectedContentChunks,
  contentChunkCollisions,
  contentStempel,
  stempelAusHtml,
  fsContentIo,
};

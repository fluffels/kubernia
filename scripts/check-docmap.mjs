// Kein Shebang — analog zu scripts/check-size.mjs: dieses Skript wird über
// `node scripts/check-docmap.mjs` (npm run check:docmap) gestartet UND von
// test/docmap.test.ts importiert. Ein `#!` bricht genau diesen Vitest/esbuild-Import.
/**
 * Doku↔Code-Drift-Wächter (#482) — hält die CLAUDE.md-Landkarte ehrlich gegenüber dem Code.
 *
 * Hintergrund: Die CLAUDE.md-Landkarte und die arc42-Doku beschreiben, welche Datei zu
 * welcher Schicht/Subdomäne gehört. Ein KI-Agent wählt anhand dieser Doku das betroffene
 * Modul und lädt nur dessen Kontext — driftet Doku↔Code, zieht er das falsche/zu viel
 * Paket rein (explizites Qualitätsziel „KI-Entwickel-Effizienz", arc42 §1). Bisher hielt
 * nur die Prosa-Regel „Doku aktuell halten ist Teil von fertig" (AGENTS.md) die Landkarte
 * synchron — prozessual, nicht mechanisch. Dieser Wächter macht Drift **rot**:
 *
 *   1. Keine Geister-Zeilen: jede in der Landkarte genannte Datei/jedes Verzeichnis existiert.
 *   2. Keine verwaisten Module: jede src/-*.ts hat genau eine Landkarten-Zeile.
 *   3. Schicht-Konsistenz: die in der Landkarte deklarierte Schicht stimmt mit der
 *      dependency-cruiser-Zuordnung überein (EINE Quelle: scripts/layers.cjs).
 *
 * Bewusst ein reines Node-Skript (nur Builtins), analog zu check-size.mjs: läuft
 * plattformübergreifend über `npm run check:docmap` und im CI. Die Parse-/Prüf-Logik
 * wird zusätzlich von test/docmap.test.ts importiert — EINE Quelle der Wahrheit.
 *
 * Ausführen mit:  npm run check:docmap   (oder als Teil von: npm test)
 */

import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join, relative, sep } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { layerOf, LABEL_TO_LAYER } = require("./layers.cjs");

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Module, die bewusst KEINE Landkarten-Zeile brauchen (repo-relativ, POSIX).
 *  Leer gehalten: die AGENTS.md-Konvention verlangt für JEDES src-Modul eine Zeile.
 *  Reine Typdeklarationen (.d.ts) werden separat gefiltert (kein Laufzeit-Modul). */
export const ORPHAN_ALLOWLIST = [];

/** Liest die CLAUDE.md-Landkarte (nur die Tabelle mit Kopf „| Datei | Schicht | Zweck |").
 *  Gibt je Zeile { file, layer, isDir } zurück (file = repo-relativer POSIX-Pfad aus der
 *  ersten Spalte, layer = zweite Spalte). Bricht die Tabelle an der ersten Nicht-|-Zeile ab,
 *  damit die nachfolgende Tiefendoc-Tabelle NICHT mitgelesen wird. */
export function parseDocMap(claudeMd) {
  const lines = claudeMd.split(/\r?\n/);
  const headerIdx = lines.findIndex((l) => /^\|\s*Datei\s*\|\s*Schicht\s*\|/.test(l));
  if (headerIdx < 0)
    throw new Error("CLAUDE.md-Landkarte (Tabelle mit Kopf Datei/Schicht/Zweck) nicht gefunden.");

  const out = [];
  for (let i = headerIdx + 2; i < lines.length; i++) {
    const line = lines[i];
    if (!line.startsWith("|")) break; // Tabellenende
    const cells = line.split("|").slice(1, -1).map((c) => c.trim());
    if (cells.length < 2) continue;
    const m = cells[0].match(/`([^`]+)`/); // Pfad steht als `…` in der ersten Spalte
    if (!m) continue;
    const raw = m[1];
    const isDir = raw.endsWith("/");
    out.push({ file: isDir ? raw.replace(/\/$/, "") : raw, layer: cells[1], isDir });
  }
  return out;
}

/** Sammelt alle src/**\/*.ts (repo-relativer POSIX-Pfad), OHNE reine Typdeklarationen
 *  (.d.ts sind kein Laufzeit-Modul und stehen — wie beim dependency-cruiser — nicht in
 *  der Landkarte). `rootDir` überschreibbar, damit der Test deterministisch dasselbe
 *  Repo misst, unabhängig vom Arbeitsverzeichnis. */
export function collectSrcModules(rootDir = ROOT) {
  const out = [];
  const walk = (dir) => {
    for (const ent of readdirSync(dir, { withFileTypes: true })) {
      const abs = join(dir, ent.name);
      if (ent.isDirectory()) walk(abs);
      else if (ent.isFile() && ent.name.endsWith(".ts") && !ent.name.endsWith(".d.ts"))
        out.push(relative(rootDir, abs).split(sep).join("/"));
    }
  };
  walk(join(rootDir, "src"));
  return out.sort();
}

/** Vergleicht Landkarte gegen Code. Gibt strukturierte Befunde zurück (leere Arrays = ok). */
export function auditDocMap(rootDir = ROOT) {
  const claudeMd = readFileSync(join(rootDir, "CLAUDE.md"), "utf8");
  const entries = parseDocMap(claudeMd);
  const modules = collectSrcModules(rootDir);
  const moduleSet = new Set(modules);
  const allowed = new Set(ORPHAN_ALLOWLIST);

  const mappedFiles = new Set(entries.filter((e) => !e.isDir).map((e) => e.file));

  // 1. Geister-Zeilen: Landkarten-Eintrag ohne Datei/Verzeichnis auf der Platte.
  const ghosts = entries.filter((e) => {
    const abs = join(rootDir, e.file);
    if (!existsSync(abs)) return true;
    return e.isDir ? !statSync(abs).isDirectory() : !statSync(abs).isFile();
  });

  // 2. Verwaiste Module: src-*.ts ohne Landkarten-Zeile (außer Allowlist).
  const orphans = modules.filter((f) => !mappedFiles.has(f) && !allowed.has(f));

  // 3. Schicht-Konsistenz: deklarierte Schicht (Landkarte) vs. dependency-cruiser-Bucket.
  //    Nur für existierende .ts-Einträge (Verzeichnis-/Daten-Zeilen haben keine Code-Schicht).
  const layerMismatches = [];
  const unknownLabels = [];
  for (const e of entries) {
    if (e.isDir || !moduleSet.has(e.file)) continue;
    const expected = LABEL_TO_LAYER[e.layer];
    if (expected === undefined) {
      unknownLabels.push(e);
      continue;
    }
    const actual = layerOf(e.file);
    if (expected !== actual) layerMismatches.push({ ...e, expected, actual });
  }

  // 4. Stale Allowlist-Einträge (Datei existiert nicht mehr oder steht inzwischen doch in der Karte).
  const staleAllowlist = ORPHAN_ALLOWLIST.filter((f) => !moduleSet.has(f) || mappedFiles.has(f));

  return { entries, modules, ghosts, orphans, layerMismatches, unknownLabels, staleAllowlist };
}

// ── CLI ──────────────────────────────────────────────────────────────────────
function main() {
  const tty = process.stdout.isTTY;
  const paint = (code, s) => (tty ? `\x1b[${code}m${s}\x1b[0m` : s);
  const red = (s) => paint("31", s);
  const green = (s) => paint("32", s);

  const { entries, modules, ghosts, orphans, layerMismatches, unknownLabels, staleAllowlist } =
    auditDocMap();

  let bad = false;
  for (const g of ghosts) {
    bad = true;
    console.error(red(`✖ Geister-Zeile: „${g.file}" steht in der CLAUDE.md-Landkarte, existiert aber nicht.`));
  }
  for (const o of orphans) {
    bad = true;
    console.error(red(`✖ Verwaistes Modul: „${o}" hat keine Zeile in der CLAUDE.md-Landkarte (Zeile ergänzen).`));
  }
  for (const u of unknownLabels) {
    bad = true;
    console.error(red(`✖ Unbekannte Schicht „${u.layer}" für ${u.file} — in scripts/layers.cjs (LABEL_TO_LAYER) pflegen oder Tippfehler in CLAUDE.md fixen.`));
  }
  for (const m of layerMismatches) {
    bad = true;
    console.error(red(`✖ Schicht-Drift: ${m.file} steht als „${m.layer}" (→ ${m.expected}), gehört laut dependency-cruiser aber zu ${m.actual}.`));
  }
  for (const f of staleAllowlist) {
    bad = true;
    console.error(red(`✖ Stale ORPHAN_ALLOWLIST-Eintrag „${f}" — aus scripts/check-docmap.mjs entfernen.`));
  }

  if (bad) {
    console.error(`\nDoku↔Code-Drift. Landkarte in CLAUDE.md bzw. Schicht-Definition in scripts/layers.cjs angleichen.`);
    process.exit(1);
  }
  console.log(
    green(`✔ CLAUDE.md-Landkarte deckt sich mit dem Code (${entries.length} Zeilen, ${modules.length} src-Module, Schichten konsistent).`),
  );
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main();

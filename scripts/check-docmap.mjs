// Kein Shebang — analog zu scripts/check-size.mjs: dieses Skript wird über
// `node scripts/check-docmap.mjs` (npm run check:docmap) gestartet UND von
// test/docmap.test.ts importiert. Ein `#!` bricht genau diesen Vitest/esbuild-Import.
/**
 * Doku↔Code-Drift-Wächter (#482, Skalierung #907) — hält die Tiefendoc-Abdeckung ehrlich.
 *
 * Hintergrund: Eine per-Datei-Zeile in der Repo-Landkarte wächst linear mit den Modulen (~163→490 bei
 * großem Umfang). #907 ersetzt den per-File-Check der Landkarte durch einen Tiefendoc-Abdeckungs-Check:
 * jedes `<quelle>/*.ts` muss als Backtick-Pfad in `<moduldoku>/*.md` vorkommen (beide Pfade aus `struktur` der Projekt-Config).
 *
 *   1. Keine Geister-Einträge: jeder in den Tiefendocs genannte `<quelle>/…ts`-Pfad existiert.
 *   2. Keine verwaisten Module: jede Quell-*.ts ist in min. einem Tiefendoc erwähnt.
 *   3. Schicht-Konsistenz: weggefallen (#907) — `check:arch` (dependency-cruiser) erzwingt
 *      die eigentlichen Schichtgrenzen als CI-Gate; Doku-Schicht-Angaben sind nur noch Prosa.
 *
 * Bewusst ein reines Node-Skript (nur Builtins). Ausführen mit: npm run check:docmap
 */

import { fileURLToPath } from "node:url";
import { istDirektaufruf } from "./direktaufruf.mjs";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { ladeProjektConfig, strukturAus } from "./projekt-config-lib.mjs";
import { escapeRegex } from "./ticket-namen.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Module, die bewusst KEINE Tiefendoc-Zeile brauchen (repo-relativ, POSIX).
 *  Leer gehalten: die Konvention verlangt für JEDES Quellmodul eine Tiefendoc-Erwähnung.
 *  Reine Typdeklarationen (.d.ts) werden separat gefiltert (kein Laufzeit-Modul). */
export const ORPHAN_ALLOWLIST = [];

/** Die Struktur-Pfade `{ quelle, moduldoku }` aus der Projekt-Config; wirft ohne `struktur` (kein stiller Standardwert). */
const configStruktur = () => strukturAus(ladeProjektConfig());

/** Scannt alle `<moduldoku>/*.md` nach Backtick-Pfaden der Form `<quelle>/…ts`.
 *  Gibt ein Set der gefundenen Pfade zurück (repo-relativ, POSIX).
 *  `rootDir` überschreibbar, damit der Test deterministisch dasselbe Repo misst;
 *  `struktur` ohne Angabe aus der Projekt-Config. */
export function parseDeepDocMaps(rootDir = ROOT, struktur = configStruktur()) {
  const docsDir = join(rootDir, ...struktur.moduldoku.split("/"));
  const muster = new RegExp("`(" + escapeRegex(struktur.quelle) + "/[^`]+\\.ts)`", "g");
  const covered = new Set();
  for (const filename of readdirSync(docsDir)) {
    if (!filename.endsWith(".md")) continue;
    const text = readFileSync(join(docsDir, filename), "utf8");
    for (const m of text.matchAll(muster)) {
      covered.add(m[1]);
    }
  }
  return covered;
}

/** Sammelt alle `<quelle>/**\/*.ts` (repo-relativer POSIX-Pfad), OHNE reine Typdeklarationen
 *  (.d.ts sind kein Laufzeit-Modul und stehen nicht in den Tiefendocs). */
export function collectSrcModules(rootDir = ROOT, quelle = configStruktur().quelle) {
  const out = [];
  const walk = (dir) => {
    for (const ent of readdirSync(dir, { withFileTypes: true })) {
      const abs = join(dir, ent.name);
      if (ent.isDirectory()) walk(abs);
      else if (ent.isFile() && ent.name.endsWith(".ts") && !ent.name.endsWith(".d.ts"))
        out.push(relative(rootDir, abs).split(sep).join("/"));
    }
  };
  walk(join(rootDir, ...quelle.split("/")));
  return out.sort();
}

/** Vergleicht Tiefendocs gegen Code. Gibt strukturierte Befunde zurück (leere Arrays = ok). */
export function auditDocMap(rootDir = ROOT, struktur = configStruktur()) {
  const modules = collectSrcModules(rootDir, struktur.quelle);
  const moduleSet = new Set(modules);
  const allowed = new Set(ORPHAN_ALLOWLIST);
  const covered = parseDeepDocMaps(rootDir, struktur);

  // 1. Geister-Einträge: Tiefendoc nennt einen Pfad, der nicht in der Quellwurzel existiert.
  const ghosts = [...covered].filter((f) => !moduleSet.has(f));

  // 2. Verwaiste Module: Quell-*.ts ohne Tiefendoc-Erwähnung (außer Allowlist).
  const orphans = modules.filter((f) => !covered.has(f) && !allowed.has(f));

  // 3. Stale Allowlist-Einträge (Datei weg oder inzwischen doch in einem Tiefendoc).
  const staleAllowlist = ORPHAN_ALLOWLIST.filter((f) => !moduleSet.has(f) || covered.has(f));

  return { modules, ghosts, orphans, staleAllowlist };
}

// ── CLI ──────────────────────────────────────────────────────────────────────
function main() {
  const tty = process.stdout.isTTY;
  const paint = (code, s) => (tty ? `\x1b[${code}m${s}\x1b[0m` : s);
  const red = (s) => paint("31", s);
  const green = (s) => paint("32", s);

  let struktur;
  try {
    struktur = configStruktur();
  } catch (e) {
    console.error(`✖ ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  }
  const { modules, ghosts, orphans, staleAllowlist } = auditDocMap(ROOT, struktur);

  let bad = false;
  for (const f of ghosts) {
    bad = true;
    console.error(red(`✖ Geister-Eintrag: „${f}" steht in einem Tiefendoc, existiert aber nicht in ${struktur.quelle}/.`));
  }
  for (const o of orphans) {
    bad = true;
    console.error(
      red(`✖ Verwaistes Modul: „${o}" ist in keinem ${struktur.moduldoku}/*.md als Backtick-Pfad erwähnt (Zeile ergänzen).`),
    );
  }
  for (const f of staleAllowlist) {
    bad = true;
    console.error(red(`✖ Stale ORPHAN_ALLOWLIST-Eintrag „${f}" — aus scripts/check-docmap.mjs entfernen.`));
  }

  if (bad) {
    console.error(`\nDoku↔Code-Drift. Tiefendoc-Abdeckung in ${struktur.moduldoku}/*.md ergänzen.`);
    process.exit(1);
  }
  console.log(
    green(`✔ Tiefendoc-Abdeckung vollständig (${modules.length} Quell-Module (${struktur.quelle}) alle in ${struktur.moduldoku}/*.md erwähnt).`),
  );
}

if (istDirektaufruf(import.meta.url)) main();

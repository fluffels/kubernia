// Kein Shebang — analog zu scripts/check-size.mjs: dieses Skript wird über
// `node scripts/check-docmap.mjs` (npm run check:docmap) gestartet UND von
// test/docmap.test.ts importiert. Ein `#!` bricht genau diesen Vitest/esbuild-Import.
/**
 * Doku↔Code-Drift-Wächter (#482, Stardew-Skalierung #907) — hält die Tiefendoc-Abdeckung ehrlich.
 *
 * Hintergrund: Eine per-Datei-Zeile in CLAUDE.md wächst linear mit den Modulen (~163→490 bei
 * Stardew-Scope). #907 ersetzt den CLAUDE.md-per-File-Check durch einen Tiefendoc-Abdeckungs-Check:
 * jedes `src/*.ts` muss als Backtick-Pfad in `docs/module/*.md` vorkommen.
 *
 *   1. Keine Geister-Einträge: jeder in den Tiefendocs genannte `src/…ts`-Pfad existiert.
 *   2. Keine verwaisten Module: jede src/-*.ts ist in min. einem Tiefendoc erwähnt.
 *   3. Schicht-Konsistenz: weggefallen (#907) — `check:arch` (dependency-cruiser) erzwingt
 *      die eigentlichen Schichtgrenzen als CI-Gate; Doku-Schicht-Angaben sind nur noch Prosa.
 *
 * Bewusst ein reines Node-Skript (nur Builtins). Ausführen mit: npm run check:docmap
 */

import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join, relative, sep } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Module, die bewusst KEINE Tiefendoc-Zeile brauchen (repo-relativ, POSIX).
 *  Leer gehalten: die Konvention verlangt für JEDES src-Modul eine Tiefendoc-Erwähnung.
 *  Reine Typdeklarationen (.d.ts) werden separat gefiltert (kein Laufzeit-Modul). */
export const ORPHAN_ALLOWLIST = [];

/** Scannt alle `docs/module/*.md` nach Backtick-Pfaden der Form `src/…ts`.
 *  Gibt ein Set der gefundenen Pfade zurück (repo-relativ, POSIX).
 *  `rootDir` überschreibbar, damit der Test deterministisch dasselbe Repo misst. */
export function parseDeepDocMaps(rootDir = ROOT) {
  const docsDir = join(rootDir, "docs", "module");
  const covered = new Set();
  for (const filename of readdirSync(docsDir)) {
    if (!filename.endsWith(".md")) continue;
    const text = readFileSync(join(docsDir, filename), "utf8");
    for (const m of text.matchAll(/`(src\/[^`]+\.ts)`/g)) {
      covered.add(m[1]);
    }
  }
  return covered;
}

/** Sammelt alle src/**\/*.ts (repo-relativer POSIX-Pfad), OHNE reine Typdeklarationen
 *  (.d.ts sind kein Laufzeit-Modul und stehen nicht in den Tiefendocs). */
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

/** Vergleicht Tiefendocs gegen Code. Gibt strukturierte Befunde zurück (leere Arrays = ok). */
export function auditDocMap(rootDir = ROOT) {
  const modules = collectSrcModules(rootDir);
  const moduleSet = new Set(modules);
  const allowed = new Set(ORPHAN_ALLOWLIST);
  const covered = parseDeepDocMaps(rootDir);

  // 1. Geister-Einträge: Tiefendoc nennt einen Pfad, der nicht in src/ existiert.
  const ghosts = [...covered].filter((f) => !moduleSet.has(f));

  // 2. Verwaiste Module: src-*.ts ohne Tiefendoc-Erwähnung (außer Allowlist).
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

  const { modules, ghosts, orphans, staleAllowlist } = auditDocMap();

  let bad = false;
  for (const f of ghosts) {
    bad = true;
    console.error(red(`✖ Geister-Eintrag: „${f}" steht in einem Tiefendoc, existiert aber nicht in src/.`));
  }
  for (const o of orphans) {
    bad = true;
    console.error(
      red(`✖ Verwaistes Modul: „${o}" ist in keinem docs/module/*.md als Backtick-Pfad erwähnt (Zeile ergänzen).`),
    );
  }
  for (const f of staleAllowlist) {
    bad = true;
    console.error(red(`✖ Stale ORPHAN_ALLOWLIST-Eintrag „${f}" — aus scripts/check-docmap.mjs entfernen.`));
  }

  if (bad) {
    console.error(`\nDoku↔Code-Drift. Tiefendoc-Abdeckung in docs/module/*.md ergänzen.`);
    process.exit(1);
  }
  console.log(
    green(`✔ Tiefendoc-Abdeckung vollständig (${modules.length} src-Module alle in docs/module/*.md erwähnt).`),
  );
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main();

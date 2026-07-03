// Kein Shebang: dieses Skript wird über `node scripts/check-any-suppressions.mjs`
// (npm run check:anysuppress) gestartet UND von test/any-suppressions.test.ts
// importiert. Eine `#!`-Zeile bricht genau diesen Test-Import (Vitest/esbuild
// stolpert über das `#!`-Token), während sie für den npm-Aufruf wirkungslos ist.
// Darum bewusst weggelassen (identisch zu check-size.mjs/check-docdrift.mjs).
/**
 * `no-explicit-any`-Suppression-Wächter (#604) — Ratchet gegen einschleichendes `any`.
 *
 * Hintergrund: `@typescript-eslint/no-explicit-any` blockt seit #423 als Fehler, ist
 * aber pro Zeile per `// eslint-disable-next-line @typescript-eslint/no-explicit-any`
 * trivial aushebelbar. Anders als die Komplexitäts-Gates (#502, eslint-suppressions.json)
 * ZÄHLT oder DECKELT bislang nichts die Zahl dieser Disables — ein autonomer Agent
 * kann so unbemerkt `any` einschleusen, genau der Vektor, den die iSAQB-Analysen bei
 * den `[key:string]:any`-Seams beklagten.
 *
 * Dieser Wächter hält eine per-Datei-Baseline (`any-suppressions.json`, Muster wie
 * eslint-suppressions.json). „Kein Grün-durch-Aufweichen" — dieselbe Ratchet-Philosophie
 * wie check-size.mjs/#502:
 *   • Mehr Disables in einer Datei (oder eine neue Datei) als in der Baseline → ROT
 *     (jede neue `any`-Disable bricht — verlangt eine bewusste Baseline-Anhebung mit
 *     Ticket-Begründung im Commit, statt still durchzurutschen).
 *   • Weniger Disables als in der Baseline → ROT als STALE-Meldung (eine `any`-Brücke
 *     wurde aufgelöst → Baseline über `--write` nachziehen, damit der Ratchet klemmt).
 *   • Deckungsgleich → grün.
 *
 * Bewusst NUR `src/**` (Produktionscode) — Tests/Tooling dürfen `any` frei nutzen.
 * Bewusst ein reines Node-Skript (nur Builtins), analog zu check-size.mjs: läuft
 * plattformübergreifend über `npm run check:anysuppress` und im CI (via `npm run verify`).
 * Die Mess-/Vergleichslogik wird zusätzlich von test/any-suppressions.test.ts importiert
 * — EINE Quelle der Wahrheit, kein Auseinanderdriften zwischen Test und CLI.
 *
 * Baseline bewusst neu ziehen (nach einer reviewten `any`-Änderung):
 *   node scripts/check-any-suppressions.mjs --write
 */

import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join, relative, sep } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const BASELINE_FILE = join(ROOT, "any-suppressions.json");

/** Die bewachte Regel. Nur Disables, die GENAU diese Regel (oder alles) stummschalten,
 *  zählen — ein `// eslint-disable-next-line prefer-const` ist kein `any`-Schlupf. */
export const RULE = "@typescript-eslint/no-explicit-any";

/**
 * Zählt in `text` die eslint-disable-Direktiven, die `no-explicit-any` unterdrücken.
 * Erfasst alle Formen — `// eslint-disable-next-line …`, `// eslint-disable-line …`,
 * Block `/* eslint-disable … *\/` — sowohl mit der Regel explizit in der Liste als
 * auch **bare** (`eslint-disable` ohne Regelliste = schaltet ALLES ab, inkl. unserer
 * Regel; der gefährlichste Gaming-Vektor, darum bewusst mitgezählt).
 */
export function countAnySuppressions(text) {
  const re = /(?:\/\/|\/\*)\s*eslint-disable(?:-next-line|-line)?([^\n]*)/g;
  let count = 0;
  let m;
  while ((m = re.exec(text)) !== null) {
    // Regelliste = Rest der Direktive bis zum Kommentar-Ende (`*/`) bzw. Zeilenende.
    let rest = m[1];
    const end = rest.indexOf("*/");
    if (end !== -1) rest = rest.slice(0, end);
    rest = rest.trim();
    if (rest === "" || rest.includes(RULE)) count++;
  }
  return count;
}

/** Sammelt alle `src/**\/*.ts` (repo-relativer POSIX-Pfad) mit >0 `any`-Suppressions,
 *  als `{ file: count }`. `rootDir` überschreibbar, damit der Test deterministisch
 *  dasselbe Repo misst — unabhängig vom Arbeitsverzeichnis. */
export function collectSuppressions(rootDir = ROOT) {
  const out = {};
  const walk = (dir) => {
    for (const ent of readdirSync(dir, { withFileTypes: true })) {
      const abs = join(dir, ent.name);
      if (ent.isDirectory()) walk(abs);
      else if (ent.isFile() && ent.name.endsWith(".ts")) {
        const n = countAnySuppressions(readFileSync(abs, "utf8"));
        if (n > 0) out[relative(rootDir, abs).split(sep).join("/")] = n;
      }
    }
  };
  walk(join(rootDir, "src"));
  return out;
}

/** Liest die per-Datei-Baseline (leeres Objekt, falls die Datei fehlt). */
export function readBaseline(rootDir = ROOT) {
  try {
    return JSON.parse(readFileSync(join(rootDir, "any-suppressions.json"), "utf8"));
  } catch {
    return {};
  }
}

/**
 * Vergleicht den Ist-Stand gegen die Baseline. Gibt strukturierte Befunde zurück
 * (beide Arrays leer = ok):
 *   • increases: Datei hat MEHR (oder neu) `any`-Disables als erlaubt → ROT.
 *   • stale: Datei hat WENIGER als die Baseline (oder ist weg) → Baseline nachziehen.
 */
export function diffAgainstBaseline(current, baseline) {
  const increases = [];
  const stale = [];
  for (const file of Object.keys(current)) {
    const allowed = baseline[file] ?? 0;
    if (current[file] > allowed) increases.push({ file, count: current[file], allowed });
  }
  for (const file of Object.keys(baseline)) {
    const now = current[file] ?? 0;
    if (now < baseline[file]) stale.push({ file, count: now, baseline: baseline[file] });
  }
  return { increases, stale };
}

/** Serialisiert die Baseline stabil (Schlüssel sortiert) — deterministischer Diff. */
export function serializeBaseline(map) {
  const sorted = {};
  for (const k of Object.keys(map).sort()) sorted[k] = map[k];
  return JSON.stringify(sorted, null, 2) + "\n";
}

// ── CLI ──────────────────────────────────────────────────────────────────────
function main() {
  const tty = process.stdout.isTTY;
  const paint = (code, s) => (tty ? `\x1b[${code}m${s}\x1b[0m` : s);
  const red = (s) => paint("31", s);
  const green = (s) => paint("32", s);
  const dim = (s) => paint("2", s);

  const current = collectSuppressions();
  const total = Object.values(current).reduce((a, b) => a + b, 0);

  if (process.argv.includes("--write")) {
    writeFileSync(BASELINE_FILE, serializeBaseline(current));
    console.log(green(`✔ Baseline geschrieben: ${total} \`any\`-Suppression(en) in ${Object.keys(current).length} Datei(en).`));
    return;
  }

  const baseline = readBaseline();
  const { increases, stale } = diffAgainstBaseline(current, baseline);

  for (const i of increases)
    console.error(
      red(`✖ ${i.file}: ${i.count} \`${RULE}\`-Disable(s) > erlaubt ${i.allowed}.`),
    );
  for (const s of stale)
    console.error(
      red(
        `✖ Baseline stale: ${s.file} hat nur noch ${s.count} \`any\`-Disable(s) (Baseline ${s.baseline}) — ` +
          `Baseline mit \`node scripts/check-any-suppressions.mjs --write\` nachziehen.`,
      ),
    );

  if (increases.length === 0 && stale.length === 0) {
    console.log(dim(`  (${total} \`any\`-Suppression(en) in ${Object.keys(current).length} Datei(en) — alle in der Baseline)`));
    console.log(green(`✔ Keine neue \`${RULE}\`-Suppression.`));
    return;
  }

  if (increases.length)
    console.error(
      `\n${increases.length} Datei(en) mit neuer/zusätzlicher \`any\`-Disable. Den echten Typ herstellen ` +
        `— ODER, wenn die \`any\`-Brücke bewusst nötig ist (begründeter Kommentar am Disable, Ticket-Bezug), ` +
        `die Baseline bewusst anheben: \`node scripts/check-any-suppressions.mjs --write\` und im Commit begründen.`,
    );
  process.exit(1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();

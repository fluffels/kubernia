// Kein Shebang: dieses Skript wird ausschließlich über `node scripts/check-context-size.mjs`
// (npm run check:contextsize) gestartet UND von test/context-size.test.ts importiert. Ein
// `#!`-Token bricht sonst den Vitest/esbuild-Import (gleiche Falle wie bei check-size.mjs).
/**
 * Root-Kontextdatei-Wächter (#719) – Frühwarnung, dass AGENTS.md/CLAUDE.md zu groß werden.
 *
 * Hintergrund: anders als src/-Module (check:size, #390) haben die beiden Dateien, die
 * laut eigener Aussage JEDE Agenten-Session vollständig lädt, kein eigenes Größen-Gate.
 * Jede neue Regel bekommt Begründung + Präzedenzfall-Verweis in AGENTS.md – einzeln
 * sinnvoll, akkumuliert aber unbegrenzt in einer Datei, die pro Session mitläuft (reiner
 * Token-Kostentreiber ohne Bremse). Der Auslagerungsmechanismus existiert schon
 * (modul-lokale AGENTS.md, Vorbild src/content/AGENTS.md, #483; on-demand-Tiefendocs
 * docs/module/*.md, #394) – nur erzwang bisher nichts, ihn auch zu benutzen, BEVOR die
 * Wurzel wächst.
 *
 * Bewusst ein reines Node-Skript (nur Builtins), analog zu check-size.mjs – misst mit
 * derselben `countLines`-Logik (Re-Export von dort, keine zweite Zähl-Implementierung).
 * Die Mess-/Allowlist-Logik wird zusätzlich von test/context-size.test.ts importiert –
 * EINE Quelle der Wahrheit für Budget + Ausnahmen.
 *
 * Ausführen mit:  npm run check:contextsize   (oder als Teil von: npm run verify)
 */

import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { countLines } from "./check-size.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Zeilen-Budget je Root-Kontextdatei (repo-relativer Pfad). Kalibriert am Bestand zum
 *  Anlegen dieses Wächters (AGENTS.md 180, CLAUDE.md 295 Zeilen) + rund ein Drittel
 *  Kopffreiheit – fängt unbegrenztes Anwachsen ab, nicht den nächsten normalen Absatz.
 *  Weitere immer geladene Dateien (z.B. README) können hier bei Bedarf ergänzt werden. */
export const CONTEXT_BUDGETS = [
  { file: "AGENTS.md", budget: 240 },
  { file: "CLAUDE.md", budget: 380 },
];

/** Bewusst geduldete Ausnahmen: Datei → Grund mit offenem Tracking-Ticket. Gleiche
 *  Ratchet-Philosophie wie scripts/check-size.mjs (#390) – kein Grün-durch-Aufweichen
 *  des Budgets selbst, nur eine begründete Einzelfall-Ausnahme. Fällt die Datei wieder
 *  unter ihr Budget, meldet der Wächter den Eintrag als stale. */
export const ALLOWLIST = [];

/** Zeilenzahl je Root-Kontextdatei gegen ihr Budget. `rootDir`/`budgets` überschreibbar
 *  für deterministische Tests. */
export function collectContextSizes(rootDir = ROOT, budgets = CONTEXT_BUDGETS) {
  return budgets.map(({ file, budget }) => {
    const abs = join(rootDir, file);
    const loc = existsSync(abs) ? countLines(readFileSync(abs, "utf8")) : 0;
    return { file, loc, budget };
  });
}

/** Dateien strikt über ihrem eigenen Budget. */
export function findOversized(sizes) {
  return sizes.filter((s) => s.loc > s.budget);
}

// ── CLI ──────────────────────────────────────────────────────────────────────
function main() {
  const tty = process.stdout.isTTY;
  const paint = (code, s) => (tty ? `\x1b[${code}m${s}\x1b[0m` : s);
  const red = (s) => paint("31", s);
  const green = (s) => paint("32", s);
  const dim = (s) => paint("2", s);

  const sizes = collectContextSizes();
  const allow = new Map(ALLOWLIST.map((a) => [a.file, a.reason]));
  const oversized = findOversized(sizes);
  const oversizedFiles = new Set(oversized.map((s) => s.file));

  for (const s of sizes.filter((x) => !oversizedFiles.has(x.file)))
    console.log(dim(`• ${s.file}: ${s.loc}/${s.budget} Zeilen`));

  const violations = oversized.filter((s) => !allow.has(s.file));
  const allowed = oversized.filter((s) => allow.has(s.file));
  const stale = ALLOWLIST.filter((a) => !oversizedFiles.has(a.file));

  for (const a of allowed)
    console.log(dim(`• geduldet: ${a.file} (${a.loc} > ${a.budget} Zeilen) – ${allow.get(a.file)}`));

  for (const v of violations) console.error(red(`✖ ${v.file}: ${v.loc} Zeilen > Budget ${v.budget}`));

  for (const s of stale)
    console.error(
      red(
        `✖ Allowlist-Eintrag stale: ${s.file} liegt nicht mehr über Budget – Eintrag in scripts/check-context-size.mjs entfernen.`,
      ),
    );

  if (violations.length === 0 && stale.length === 0) {
    console.log(
      green(`✔ Root-Kontextdateien im Budget (${sizes.length} geprüft, außer ${allowed.length} dokumentierte Ausnahme(n)).`),
    );
    return;
  }

  if (violations.length)
    console.error(
      `\n${violations.length} Root-Kontextdatei(en) über dem Budget. Inhalt auslagern – ` +
        `bereichsspezifische Tiefe in eine modul-lokale AGENTS.md (Vorbild src/content/AGENTS.md, #483) ` +
        `bzw. ein docs/module/*.md-Tiefendoc (#394) – oder, mit offenem Auslagerungs-Ticket, bewusst in ` +
        `die ALLOWLIST in scripts/check-context-size.mjs aufnehmen.`,
    );
  process.exit(1);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main();

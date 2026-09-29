// Kein Shebang: dieses Skript wird ausschließlich über `node scripts/check-context-size.mjs`
// (npm run check:contextsize) gestartet UND von test/context-size.test.ts importiert. Ein
// `#!`-Token bricht sonst den Vitest/esbuild-Import (gleiche Falle wie bei check-size.mjs).
/**
 * Kontextdatei-Wächter (#719) – Frühwarnung, dass AGENTS.md zu groß wird.
 *
 * Seit #1088 zählt JEDE AGENTS.md im Repo, nicht nur die Wurzel: Claude Code (und andere
 * Tools) laden eine modul-lokale AGENTS.md automatisch, sobald dort eine Datei gelesen
 * wird. Ohne Messung wären sie eine neue, ungebremste On-Demand-Quelle – bei Stardew-Scope
 * mit vielen Bereichen genau die Stelle, an die das Wurzel-Gate den Inhalt hindrängt.
 * Modul-lokale Dateien bekommen ohne eigenen Eintrag MODULE_AGENTS_BUDGET (Default statt
 * Pflicht-Registrierung: der Walk misst jede neue Datei ohnehin sofort, eine Registrierung
 * brächte nur einen Gate-Config-Diff pro Content-PR). Bewusst KEIN Summen-Gate: modul-lokale
 * Dateien laden nur bei Bedarf, ein Summen-Cap bestrafte genau das Auslagern, das das
 * Wurzel-Gate erzwingen soll – die Summe steht darum nur als INFO in der CLI.
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
 * Gemessen werden ZEICHEN, nicht Zeilen (#1064, vorher #977/#1061): in Markdown-Fließtext
 * ist eine „Zeile" ein Absatz – AGENTS.md stand bei 159/200 Zeilen schon bei 75k Zeichen,
 * das Zeilen-Gate war nie bindend, weil die Datei in die Breite wuchs. Zeichen sind der
 * beste Token-Proxy, der in die build-freie `verify`-Kette passt (echte Tokens bräuchten
 * Netz + API-Key bzw. einen Tokenizer als Dependency). Die Token-Zahl gibt die CLI nur als
 * grobe INFO aus (≈ Zeichen / CHARS_PER_TOKEN) – das Budget selbst bleibt in Zeichen.
 * CR (`\r`) zählt nicht mit: sonst misst ein Windows-Checkout (core.autocrlf) mehr als die CI.
 *
 * Bewusst ein reines Node-Skript (nur Builtins), analog zu check-size.mjs.
 * Die Mess-/Allowlist-Logik wird zusätzlich von test/context-size.test.ts importiert –
 * EINE Quelle der Wahrheit für Budget + Ausnahmen.
 *
 * Ausführen mit:  npm run check:contextsize   (oder als Teil von: npm run verify)
 */

import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
// Derselbe Walk wie check:docdrift (#1091) – EINE Skip-Liste (node_modules, Builds,
// unversionierte .claude-Ordner inkl. .claude/worktrees). Änderungen dort wirken hier mit.
import { collectMarkdown } from "./check-docdrift.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Zeichen-Budget je Root-Kontextdatei (repo-relativer Pfad, #1064). Kalibriert am Bestand
 *  bei der Umstellung von Zeilen auf Zeichen (AGENTS.md 73.612, CLAUDE.md 18.068 Zeichen) +
 *  kleine Kopffreiheit. Das ist KEIN Aufweichen: das alte Zeilen-Budget hat die Größe nie
 *  gemessen. Im zweiten #1064-Slice wurde AGENTS.md auf ~24k Zeichen gekürzt
 *  (Langbegründung nach docs/agent-harness.md §3a) und das Budget auf 28.000 gezogen
 *  (Ist + ~15 %, wie beim ersten Kalibrieren; Ratchet nach unten). Mit #1078 (Slice A1) sind
 *  die Nachschlage-Tabellen der CLAUDE.md on-demand nach docs/referenz/ gezogen; seit #1087 ist
 *  CLAUDE.md gelöscht (AGENTS.md wird nativ geladen) und ihr Eintrag entfallen – dass sie nicht
 *  zurückkehrt, bewacht test/agents-md-native.test.ts.
 *  Weitere immer geladene Dateien (z.B. README) können hier bei Bedarf ergänzt werden. */
export const CONTEXT_BUDGETS = [
  { file: "AGENTS.md", budget: 28_000 },
];

/** Default-Zeichen-Budget je modul-lokaler AGENTS.md ohne eigenen Eintrag in
 *  CONTEXT_BUDGETS (#1088). Kalibriert wie die Wurzel: Ist von src/content/AGENTS.md
 *  (~10.300 Zeichen) + ~15 % Kopffreiheit. Ratchet nur nach unten. */
export const MODULE_AGENTS_BUDGET = 12_000;

/** Grobe Umrechnung nur für die INFO-Ausgabe (deutscher Markdown-Text, ~4,2 Zeichen/Token).
 *  Modellabhängig und damit bewusst kein Budget-Maßstab. */
export const CHARS_PER_TOKEN = 4.2;

/** Zeichen eines Textes, zeilenenden-neutral (CRLF zählt wie LF). */
export function countChars(text) {
  return text.replace(/\r/g, "").length;
}

/** Bewusst geduldete Ausnahmen: Datei → Grund mit offenem Tracking-Ticket. Gleiche
 *  Ratchet-Philosophie wie scripts/check-size.mjs (#390) – kein Grün-durch-Aufweichen
 *  des Budgets selbst, nur eine begründete Einzelfall-Ausnahme. Fällt die Datei wieder
 *  unter ihr Budget, meldet der Wächter den Eintrag als stale. */
export const ALLOWLIST = [];

/** Alle AGENTS.md im Repo (repo-relativer POSIX-Pfad, sortiert). */
export function collectAgentsFiles(rootDir = ROOT) {
  return collectMarkdown(rootDir).filter((f) => f === "AGENTS.md" || f.endsWith("/AGENTS.md"));
}

/** Zeichenzahl je Kontextdatei gegen ihr Budget: alle konfigurierten Dateien (auch
 *  fehlende, mit 0 Zeichen) plus jede gefundene AGENTS.md; ein expliziter Eintrag gewinnt
 *  über `moduleBudget`. `rootDir`/`budgets`/`moduleBudget` überschreibbar für Tests. */
export function collectContextSizes(rootDir = ROOT, budgets = CONTEXT_BUDGETS, moduleBudget = MODULE_AGENTS_BUDGET) {
  const budgetOf = new Map(budgets.map((b) => [b.file, b.budget]));
  const files = [...new Set([...budgets.map((b) => b.file), ...collectAgentsFiles(rootDir)])].sort();
  return files.map((file) => {
    const abs = join(rootDir, file);
    const chars = existsSync(abs) ? countChars(readFileSync(abs, "utf8")) : 0;
    return { file, chars, budget: budgetOf.get(file) ?? moduleBudget };
  });
}

/** Dateien strikt über ihrem eigenen Budget. */
export function findOversized(sizes) {
  return sizes.filter((s) => s.chars > s.budget);
}

/** Allowlist-Einträge, deren Datei nicht (mehr) über Budget liegt oder gar nicht gemessen
 *  wird – EINE Implementierung für CLI und Test. */
export function findStale(sizes, allowlist = ALLOWLIST) {
  const oversized = new Set(findOversized(sizes).map((s) => s.file));
  return allowlist.filter((a) => !oversized.has(a.file));
}

// ── CLI ──────────────────────────────────────────────────────────────────────
function main() {
  const tty = process.stdout.isTTY;
  const paint = (code, s) => (tty ? `\x1b[${code}m${s}\x1b[0m` : s);
  const red = (s) => paint("31", s);
  const green = (s) => paint("32", s);
  const dim = (s) => paint("2", s);
  const fmt = (n) => n.toLocaleString("de-DE");
  const tokens = (n) => `≈ ${fmt(Math.round(n / CHARS_PER_TOKEN))} Tokens`;

  const sizes = collectContextSizes();
  const allow = new Map(ALLOWLIST.map((a) => [a.file, a.reason]));
  const oversized = findOversized(sizes);
  const oversizedFiles = new Set(oversized.map((s) => s.file));

  for (const s of sizes.filter((x) => !oversizedFiles.has(x.file)))
    console.log(dim(`• ${s.file}: ${fmt(s.chars)}/${fmt(s.budget)} Zeichen (${tokens(s.chars)})`));

  const violations = oversized.filter((s) => !allow.has(s.file));
  const allowed = oversized.filter((s) => allow.has(s.file));
  const stale = findStale(sizes, ALLOWLIST);

  for (const a of allowed)
    console.log(dim(`• geduldet: ${a.file} (${fmt(a.chars)} > ${fmt(a.budget)} Zeichen) – ${allow.get(a.file)}`));

  for (const v of violations) console.error(red(`✖ ${v.file}: ${fmt(v.chars)} Zeichen > Budget ${fmt(v.budget)} (${tokens(v.chars)})`));

  for (const s of stale)
    console.error(
      red(
        `✖ Allowlist-Eintrag stale: ${s.file} liegt nicht mehr über Budget – Eintrag in scripts/check-context-size.mjs entfernen.`,
      ),
    );

  const total = sizes.reduce((sum, s) => sum + s.chars, 0);
  console.log(dim(`• INFO: ${sizes.length} Kontextdatei(en), zusammen ${fmt(total)} Zeichen (${tokens(total)}), kein Gate.`));

  if (violations.length === 0 && stale.length === 0) {
    console.log(
      green(`✔ Kontextdateien im Budget (${sizes.length} geprüft, außer ${allowed.length} dokumentierte Ausnahme(n)).`),
    );
    return;
  }

  if (violations.length)
    console.error(
      `\n${violations.length} Kontextdatei(en) über dem Budget. Inhalt auslagern – ` +
        `bereichsspezifische Tiefe in eine modul-lokale AGENTS.md (Vorbild src/content/AGENTS.md, #483) ` +
        `bzw. ein docs/module/*.md-Tiefendoc (#394) – oder, mit offenem Auslagerungs-Ticket, bewusst in ` +
        `die ALLOWLIST in scripts/check-context-size.mjs aufnehmen.`,
    );
  process.exit(1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();

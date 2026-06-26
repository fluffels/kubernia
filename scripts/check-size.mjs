// Kein Shebang: dieses Skript wird ausschließlich über `node scripts/check-size.mjs`
// (npm run check:size) gestartet UND von test/filesize.test.ts importiert. Eine
// `#!`-Zeile bricht genau diesen Test-Import quer über die Plattformen (Vitest/esbuild
// stolpert über das `#!`-Token → „Invalid or unexpected token"), während sie für den
// npm-Aufruf wirkungslos ist. Darum bewusst weggelassen.
/**
 * Dateigröße-Wächter (#390) – Frühwarnung gegen neue God-Files.
 *
 * Hintergrund: große Module sind bei Stardew-Scope teuer – Agenten lesen pro
 * Änderung viel mehr Kontext (Tokens), und je größer eine Datei, desto leichter
 * schleichen sich Regressionen ein. Dieser Wächter meldet jedes `src`-Modul über
 * einem Zeilen-Budget, BEVOR es zum nächsten WorldScene.ts (1344) wächst.
 *
 * Bewusst ein reines Node-Skript (nur Builtins), analog zu setup.mjs: läuft
 * plattformübergreifend über `npm run check:size` und im CI. Die Mess- und
 * Allowlist-Logik wird zusätzlich von test/filesize.test.ts importiert – EINE
 * Quelle der Wahrheit für Budget + Ausnahmen, damit nichts auseinanderdriftet.
 */

import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join, relative, sep } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

/** Zeilen-Budget pro Modul. Über diesem Wert gilt eine Datei als God-File-Verdacht.
 *  800 gewählt, weil game.ts (793) heute knapp darunter liegt und ohnehin (#392)
 *  aufgeteilt wird – die Schwelle fängt also echte Ausreißer, nicht den Normalfall. */
export const LOC_BUDGET = 800

/** Bewusst geduldete Ausnahmen: Datei (repo-relativ, POSIX) → Grund mit Tracking-Ticket.
 *  „Kein Grün-durch-Aufweichen": jede Ausnahme MUSS ein offenes Split-Ticket nennen.
 *  Fällt die Datei unter Budget (Split erledigt), meldet der Wächter den Eintrag als
 *  stale und schlägt fehl – das erinnert daran, die Ausnahme wieder zu entfernen. */
export const ALLOWLIST = [
  { file: 'src/content/drills.ts', reason: 'Capstone-Werft-Drills (#169) übers Budget; Split verfolgt in #457' },
]

/** Zählt physische Zeilen (wie `wc -l`; ein abschließender Zeilenumbruch zählt nicht doppelt). */
export function countLines(text) {
  const lines = text.split(/\r?\n/)
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop()
  return lines.length
}

/** Sammelt alle `src/**\/*.ts` (repo-relativer POSIX-Pfad) mit ihrer Zeilenzahl,
 *  größte zuerst. `rootDir` ist überschreibbar, damit der Test deterministisch
 *  dasselbe Repo misst – unabhängig vom aktuellen Arbeitsverzeichnis. */
export function collectSizes(rootDir = ROOT) {
  const out = []
  const walk = (dir) => {
    for (const ent of readdirSync(dir, { withFileTypes: true })) {
      const abs = join(dir, ent.name)
      if (ent.isDirectory()) walk(abs)
      else if (ent.isFile() && ent.name.endsWith('.ts'))
        out.push({ file: relative(rootDir, abs).split(sep).join('/'), loc: countLines(readFileSync(abs, 'utf8')) })
    }
  }
  walk(join(rootDir, 'src'))
  return out.sort((a, b) => b.loc - a.loc)
}

/** Module strikt über dem Budget. */
export function findOversized(sizes, budget = LOC_BUDGET) {
  return sizes.filter((s) => s.loc > budget)
}

// ── CLI ──────────────────────────────────────────────────────────────────────
function main() {
  const tty = process.stdout.isTTY
  const paint = (code, s) => (tty ? `\x1b[${code}m${s}\x1b[0m` : s)
  const red = (s) => paint('31', s)
  const green = (s) => paint('32', s)
  const dim = (s) => paint('2', s)

  const sizes = collectSizes()
  const allow = new Map(ALLOWLIST.map((a) => [a.file, a.reason]))
  const oversized = findOversized(sizes, LOC_BUDGET)
  const oversizedFiles = new Set(oversized.map((s) => s.file))

  const violations = oversized.filter((s) => !allow.has(s.file))
  const allowed = oversized.filter((s) => allow.has(s.file))
  const stale = ALLOWLIST.filter((a) => !oversizedFiles.has(a.file))

  for (const a of allowed)
    console.log(dim(`• geduldet: ${a.file} (${a.loc} > ${LOC_BUDGET} LOC) – ${allow.get(a.file)}`))

  for (const v of violations)
    console.error(red(`✖ ${v.file}: ${v.loc} Zeilen > Budget ${LOC_BUDGET}`))

  for (const s of stale)
    console.error(
      red(`✖ Allowlist-Eintrag stale: ${s.file} liegt nicht mehr über ${LOC_BUDGET} LOC – Eintrag in scripts/check-size.mjs entfernen.`),
    )

  if (violations.length === 0 && stale.length === 0) {
    console.log(green(`✔ Dateigröße ok – kein Modul über ${LOC_BUDGET} LOC (außer ${allowed.length} dokumentierte Ausnahme(n)).`))
    return
  }

  if (violations.length)
    console.error(
      `\n${violations.length} Modul(e) über dem Budget. Aufteilen (siehe #392/#393 als Vorlage) ` +
        `oder – mit offenem Split-Ticket – bewusst in die ALLOWLIST in scripts/check-size.mjs aufnehmen.`,
    )
  process.exit(1)
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main()

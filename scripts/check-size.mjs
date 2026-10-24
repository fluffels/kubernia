// Kein Shebang: dieses Skript wird ausschließlich über `node scripts/check-size.mjs`
// (npm run check:size) gestartet UND von test/filesize.test.ts importiert. Eine
// `#!`-Zeile bricht genau diesen Test-Import quer über die Plattformen (Vitest/esbuild
// stolpert über das `#!`-Token → „Invalid or unexpected token"), während sie für den
// npm-Aufruf wirkungslos ist. Darum bewusst weggelassen.
/**
 * Dateigröße-Wächter (#390) – Frühwarnung gegen neue God-Files.
 *
 * Hintergrund: große Module sind bei wachsendem Umfang teuer – Agenten lesen pro
 * Änderung viel mehr Kontext (Tokens), und je größer eine Datei, desto leichter
 * schleichen sich Regressionen ein. Dieser Wächter meldet jedes Quellmodul (Wurzel `struktur.quelle`
 * der Projekt-Config) über einem Zeilen-Budget, BEVOR es zum nächsten God-File wächst.
 *
 * Bewusst ein reines Node-Skript (nur Builtins), analog zu setup.mjs: läuft
 * plattformübergreifend über `npm run check:size` und im CI. Die Mess- und
 * Allowlist-Logik wird zusätzlich von test/filesize.test.ts importiert – EINE
 * Quelle der Wahrheit für Budget + Ausnahmen, damit nichts auseinanderdriftet.
 */

import { istDirektaufruf } from "./hook-io.mjs";
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, relative, sep } from 'node:path'
import { ausnahmenAus, ladeProjektConfig, strukturAus } from './projekt-config-lib.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

/** Zeilen-Budget pro Modul. Über diesem Wert gilt eine Datei als God-File-Verdacht.
 *  Die Schwelle fängt echte Ausreißer, nicht den Normalfall. */
export const LOC_BUDGET = 800

/**
 * Deckel für Workflow-Skripte unter `.claude/workflows/*.js` (#1349): über `LOC_BUDGET` nur mit Eintrag, und der Eintrag ist
 * ein Ratchet: wächst die Datei über `max`, ist es rot; schrumpft sie unter `max`, ist es rot mit „Deckel senken“ (der Deckel
 * folgt der Datei nach unten, nie nach oben ohne reviewten Commit). Aufteilen geht hier nicht: die Workflow-Laufzeit wrappt das
 * Skript, es hat keine Imports. Neue Workflow-Dateien über dem Budget brauchen einen eigenen Eintrag (mit Begründung).
 */
export const DECKEL = []

/** Zeichen ohne CR (CRLF zählt wie LF, wie check:contextsize). */
export function countChars(text) {
  return text.replace(/\r/g, '').length
}

/** Zählt physische Zeilen (wie `wc -l`; ein abschließender Zeilenumbruch zählt nicht doppelt). */
export function countLines(text) {
  const lines = text.split(/\r?\n/)
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop()
  return lines.length
}

/** Sammelt alle `<quelle>/**\/*.ts` (repo-relativer POSIX-Pfad) mit ihrer Zeilenzahl,
 *  größte zuerst. `rootDir` ist überschreibbar, damit der Test deterministisch
 *  dasselbe Repo misst – unabhängig vom aktuellen Arbeitsverzeichnis. `quelle` ist die Quellwurzel;
 *  ohne Angabe gilt `struktur.quelle` der Projekt-Config (wirft ohne diesen Schlüssel, kein stiller Standardwert). */
export function collectSizes(rootDir = ROOT, quelle = strukturAus(ladeProjektConfig()).quelle) {
  const out = []
  const walk = (dir) => {
    for (const ent of readdirSync(dir, { withFileTypes: true })) {
      const abs = join(dir, ent.name)
      if (ent.isDirectory()) walk(abs)
      else if (ent.isFile() && ent.name.endsWith('.ts'))
        out.push({ file: relative(rootDir, abs).split(sep).join('/'), loc: countLines(readFileSync(abs, 'utf8')) })
    }
  }
  walk(join(rootDir, quelle))
  return out.sort((a, b) => b.loc - a.loc)
}

/** Zeilenzahl je `.claude/workflows/*.js` (repo-relativer POSIX-Pfad); ohne Ordner leer. */
export function collectWorkflowSizes(rootDir = ROOT) {
  let eintraege
  try {
    eintraege = readdirSync(join(rootDir, '.claude', 'workflows'), { withFileTypes: true })
  } catch {
    return []
  }
  return eintraege
    .filter((e) => e.isFile() && e.name.endsWith('.js'))
    .map((e) => {
      const text = readFileSync(join(rootDir, '.claude', 'workflows', e.name), 'utf8')
      return { file: `.claude/workflows/${e.name}`, loc: countLines(text), chars: countChars(text) }
    })
    .sort((a, b) => b.loc - a.loc)
}

/**
 * Prüft Workflow-Skripte gegen `deckel`: Meldungen (leer = ok). Über `budget` ohne Eintrag, über `max`, unter `max`
 * (Deckel nachziehen) und Einträge ohne Datei bzw. mit Datei unter Budget (stale) sind Fehler. Pur.
 */
const REBASE_HINWEIS = " Paralleler PR, der dieselbe Datei ändert? Nach dem Rebase auf origin/main den Deckel auf die jetzt gemessene Zahl setzen (ein Konflikt in scripts/check-size.mjs ist dann erwartbar). Wächst die Datei durch den eigenen Diff, gilt weiter: kürzen oder bewusst per reviewtem Commit anheben."

/** Zeichen-Deckel (#1628, jeder DECKEL-Eintrag): über `maxZeichen` rot, mehr als `ZEICHEN_TOLERANZ` darunter rot (Ratchet mit Spielraum). */
export const ZEICHEN_TOLERANZ = 500
function pruefeZeichen(file, chars, d) {
  if (typeof d.maxZeichen !== 'number') return [`${file}: DECKEL-Eintrag ohne maxZeichen (Zeichen-Deckel, #1628) – gemessene Zeichenzahl eintragen.`]
  if (typeof chars !== 'number') return [`${file}: Messung ohne Zeichenzahl.`]
  if (chars > d.maxZeichen) return [`${file}: ${chars} Zeichen > Deckel ${d.maxZeichen}: kürzen statt wachsen (Anheben nur bewusst per reviewtem Commit mit Begründung).${REBASE_HINWEIS}`]
  if (chars < d.maxZeichen - ZEICHEN_TOLERANZ) return [`${file}: ${chars} Zeichen < Deckel ${d.maxZeichen} − ${ZEICHEN_TOLERANZ}: Deckel auf ${chars} senken (Ratchet, in scripts/check-size.mjs).${REBASE_HINWEIS}`]
  return []
}

export function pruefeDeckel(workflowSizes, deckel = DECKEL, budget = LOC_BUDGET) {
  const meldungen = []
  const eintrag = new Map(deckel.map((d) => [d.file, d]))
  const bekannt = new Map(workflowSizes.map((w) => [w.file, w.loc]))
  for (const { file, loc, chars } of workflowSizes) {
    const d = eintrag.get(file)
    if (loc <= budget) continue
    if (d) meldungen.push(...pruefeZeichen(file, chars, d))
    if (!d) meldungen.push(`${file}: ${loc} Zeilen > Budget ${budget} ohne Deckel (Eintrag DECKEL in scripts/check-size.mjs mit Begründung, oder kürzen).`)
    else if (loc > d.max) meldungen.push(`${file}: ${loc} Zeilen > Deckel ${d.max}: kürzen statt wachsen (Anheben nur bewusst per reviewtem Commit mit Begründung).${REBASE_HINWEIS}`)
    else if (loc < d.max) meldungen.push(`${file}: ${loc} Zeilen < Deckel ${d.max}: Deckel auf ${loc} senken (Ratchet, in scripts/check-size.mjs).${REBASE_HINWEIS}`)
  }
  for (const d of deckel) {
    const loc = bekannt.get(d.file)
    if (loc === undefined) meldungen.push(`DECKEL-Eintrag stale: ${d.file} existiert nicht mehr – Eintrag entfernen.`)
    else if (loc <= budget) meldungen.push(`DECKEL-Eintrag stale: ${d.file} liegt nicht mehr über ${budget} LOC – Eintrag entfernen.`)
  }
  return meldungen
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

  let quelle
  let ALLOWLIST
  try {
    const config = ladeProjektConfig()
    quelle = strukturAus(config).quelle
    ALLOWLIST = ausnahmenAus(config).groesse
  } catch (e) {
    console.error(`✖ ${e instanceof Error ? e.message : String(e)}`)
    process.exit(1)
  }
  const sizes = collectSizes(ROOT, quelle)
  const allow = new Map(ALLOWLIST.map((a) => [a.datei, a.grund]))
  const oversized = findOversized(sizes, LOC_BUDGET)
  const oversizedFiles = new Set(oversized.map((s) => s.file))

  const violations = oversized.filter((s) => !allow.has(s.file))
  const allowed = oversized.filter((s) => allow.has(s.file))
  const stale = ALLOWLIST.filter((a) => !oversizedFiles.has(a.datei))

  for (const a of allowed)
    console.log(dim(`• geduldet: ${a.file} (${a.loc} > ${LOC_BUDGET} LOC) – ${allow.get(a.file)}`))

  for (const v of violations)
    console.error(red(`✖ ${v.file}: ${v.loc} Zeilen > Budget ${LOC_BUDGET}`))

  for (const s of stale)
    console.error(
      red(`✖ Ausnahme stale: ${s.datei} liegt nicht mehr über ${LOC_BUDGET} LOC – Eintrag unter ausnahmen.groesse in .factory/projekt.json entfernen.`),
    )

  const deckelMeldungen = pruefeDeckel(collectWorkflowSizes())
  for (const m of deckelMeldungen) console.error(red(`✖ ${m}`))

  if (violations.length === 0 && stale.length === 0 && deckelMeldungen.length === 0) {
    console.log(green(`✔ Dateigröße ok – kein Modul über ${LOC_BUDGET} LOC (außer ${allowed.length} dokumentierte Ausnahme(n)); Workflow-Deckel eingehalten.`))
    return
  }

  if (violations.length)
    console.error(
      `\n${violations.length} Modul(e) über dem Budget. Aufteilen (siehe #392/#393 als Vorlage) ` +
        `oder – mit offenem Split-Ticket – bewusst unter ausnahmen.groesse in .factory/projekt.json aufnehmen (datei, grund mit #<nr>).`,
    )
  process.exit(1)
}

if (istDirektaufruf(import.meta.url)) main()

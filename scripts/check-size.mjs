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
 * Optional misst es auch Datendateien (Standard .json) gegen ein Zeilen-Budget: Block `datengroesse` der Projekt-Config, Logik in `datengroesse-lib.mjs` (factory#7).
 *
 * Bewusst ein reines Node-Skript (nur Builtins), analog zu setup.mjs: läuft
 * plattformübergreifend über `npm run check:size` und im CI. Die Mess- und
 * Allowlist-Logik wird zusätzlich von test/filesize.test.ts importiert – EINE
 * Quelle der Wahrheit für Budget + Ausnahmen, damit nichts auseinanderdriftet.
 */

import { istDirektaufruf } from "./direktaufruf.mjs";
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { strukturOrdnerBefunde } from './check-basis.mjs'
import { ausnahmenAus, datengroesseAus, ladeProjektConfig, PROJEKT_CONFIG } from './projekt-config-lib.mjs'
import { pruefeDatenGroessen, splitEmpfehlung } from './datengroesse-lib.mjs'
import { quellDateien, quellenAus, STANDARD_ENDUNGEN } from './quellwurzeln-lib.mjs'

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

/** Sammelt alle Quelldateien unter den Quellwurzeln (repo-relativer POSIX-Pfad) mit ihrer Zeilenzahl, größte zuerst. `quellen` ist ein String (eine wörtliche
 *  Wurzel, Endungen der JS/TS-Familie; Deklarationsdateien `.d.ts` zählen wie bisher mit) oder `{ wurzeln, endungen }` aus `quellenAus` (Globs, eigene Endungen,
 *  factory#181). `struktur.ohne` gilt hier bewusst nicht: ein großer Spec ist auch ein God-File. `rootDir` ist überschreibbar, damit der Test deterministisch
 *  dasselbe Repo misst; ohne Angabe gilt `struktur` der Projekt-Config (wirft ohne `quelle`, kein stiller Standardwert). */
export function collectSizes(rootDir = ROOT, quellen = quellenAus(ladeProjektConfig())) {
  const { wurzeln, endungen } = typeof quellen === 'string' ? { wurzeln: [quellen], endungen: STANDARD_ENDUNGEN } : quellen
  return quellDateien(rootDir, { wurzeln, endungen })
    .map((file) => ({ file, loc: countLines(readFileSync(join(rootDir, ...file.split('/')), 'utf8')) }))
    .sort((a, b) => b.loc - a.loc)
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

/** Zeichen-Deckel (#1628, jeder DECKEL-Eintrag): über `maxZeichen` rot, mehr als `ZEICHEN_TOLERANZ` darunter rot (Ratchet mit Toleranz). */
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

const DATEN_REBASE_HINWEIS = ` Paralleler PR, der dieselbe Datei ändert? Nach dem Rebase auf origin/main den Deckel unter datengroesse.deckel in ${PROJEKT_CONFIG} auf die jetzt gemessene Zahl setzen. Wächst die Datei durch den eigenen Diff, gilt weiter: teilen oder bewusst per reviewtem Commit anheben.`

/**
 * Datenbudget (factory#7): Datendateien (Standard .json) unter den Pfaden des Blocks `datengroesse` gegen dessen Zeilen-Budget, mit Deckel-Ratchet je bestehendem Monolithen.
 * Rückgabe `{ rot, info }`: Meldungstexte (Rot mit Split-Empfehlung bzw. Fix-Zeile). Ein fehlender Datenordner ist rot (fail-closed wie bei struktur.quelle, factory#168);
 * ohne Block ruft `main` diese Funktion nicht auf (No-op).
 */
export function datenBefunde(rootDir, block) {
  const ordner = strukturOrdnerBefunde(rootDir, { pfade: block.pfade }, ['pfade'], 'datengroesse')
  if (ordner.length > 0) return { rot: ordner, info: [] }
  const sizes = collectSizes(rootDir, { wurzeln: block.pfade, endungen: block.endungen })
  const rot = []
  const info = []
  for (const u of pruefeDatenGroessen(sizes, block)) {
    if (u.art === 'geduldet') info.push(u.text)
    else if (u.art === 'stale') rot.push(u.text)
    else if (u.art === 'unter-max') rot.push(u.text + DATEN_REBASE_HINWEIS)
    else {
      const text = readFileSync(join(rootDir, ...u.datei.split('/')), 'utf8')
      const empfehlung = splitEmpfehlung(text, { loc: u.loc, budget: block.budget, json: u.datei.endsWith('.json'), hinweis: block.hinweis })
      rot.push(`${u.text}${u.art === 'ueber-max' ? DATEN_REBASE_HINWEIS : ''}\n  Split-Empfehlung: ${empfehlung.replaceAll('\n', '\n    ')}`)
    }
  }
  return { rot, info }
}

/** Gibt das Ergebnis von `datenBefunde` aus (nur bei aktivem Block) und liefert die Zahl der roten Meldungen. */
function datenAusgeben(block, farbe) {
  if (!block) return 0
  const { rot, info } = datenBefunde(ROOT, block)
  info.forEach((t) => console.log(farbe.dim(`• geduldet: ${t}`)))
  rot.forEach((t) => console.error(farbe.red(`✖ ${t}`)))
  if (rot.length === 0) console.log(farbe.green(`✔ Datendateien ≤ ${block.budget} Zeilen (${block.deckel.length} Deckel).`))
  else {
    console.error(
      `\nDatendateien über dem Budget: teilen (Split-Empfehlung oben) oder – mit offenem Split-Ticket – einfrieren unter datengroesse.deckel in ${PROJEKT_CONFIG} ` +
        '({ datei, max: <gemessene Zeilen>, grund mit #<nr> }).',
    )
  }
  return rot.length
}

// ── CLI ──────────────────────────────────────────────────────────────────────
function main() {
  const tty = process.stdout.isTTY
  const paint = (code, s) => (tty ? `\x1b[${code}m${s}\x1b[0m` : s)
  const red = (s) => paint('31', s)
  const green = (s) => paint('32', s)
  const dim = (s) => paint('2', s)

  let quellen
  let ALLOWLIST
  let datengroesse
  try {
    const config = ladeProjektConfig()
    quellen = quellenAus(config)
    ALLOWLIST = ausnahmenAus(config).groesse
    datengroesse = datengroesseAus(config)
  } catch (e) {
    console.error(`✖ ${e instanceof Error ? e.message : String(e)}`)
    process.exit(1)
  }
  const befunde = strukturOrdnerBefunde(ROOT, { quelle: quellen.quelle }, ['quelle'])
  befunde.forEach((b) => console.error(red(`✖ ${b}`)))
  if (befunde.length > 0) process.exit(1)
  const sizes = collectSizes(ROOT, quellen)
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
      red(`✖ Ausnahme stale: ${s.datei} liegt nicht mehr über ${LOC_BUDGET} LOC – Eintrag unter ausnahmen.groesse in ${PROJEKT_CONFIG} entfernen.`),
    )

  const deckelMeldungen = pruefeDeckel(collectWorkflowSizes())
  for (const m of deckelMeldungen) console.error(red(`✖ ${m}`))

  const datenRot = datenAusgeben(datengroesse, { red, green, dim })

  if (violations.length === 0 && stale.length === 0 && deckelMeldungen.length === 0 && datenRot === 0) {
    console.log(green(`✔ Dateigröße ok – kein Modul über ${LOC_BUDGET} LOC (außer ${allowed.length} dokumentierte Ausnahme(n)); Workflow-Deckel eingehalten.`))
    return
  }

  if (violations.length)
    console.error(
      `\n${violations.length} Modul(e) über dem Budget. Aufteilen (siehe #392/#393 als Vorlage) ` +
        `oder – mit offenem Split-Ticket – bewusst unter ausnahmen.groesse in ${PROJEKT_CONFIG} aufnehmen (datei, grund mit #<nr>).`,
    )
  process.exit(1)
}

if (istDirektaufruf(import.meta.url)) main()

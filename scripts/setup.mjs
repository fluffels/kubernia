#!/usr/bin/env node
/**
 * One-Command-Setup für KubeQuest (#387).
 *
 * Bringt neue Entwickler:innen UND KI-Agenten in EINEM Schritt auf einen
 * lauffähigen, grünen Stand: Node-Version prüfen → Abhängigkeiten installieren
 * → Tests + Typecheck + Architektur-Wächter einmal laufen lassen.
 *
 * Bewusst ein reines Node-Skript (kein .sh/.ps1): läuft plattformübergreifend
 * (Windows/macOS/Linux) ohne doppelt gepflegte Shell-Varianten – aufgerufen über
 * `npm run setup`, die Datei-Endung bleibt für Nutzer:innen unsichtbar. Braucht
 * selbst keine Abhängigkeiten (nur Node-Builtins), läuft also im frischen Klon
 * noch vor dem ersten `npm install`.
 */

import { execSync } from 'node:child_process'
import { chmodSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

// Farben nur, wenn ein echtes Terminal dranhängt – CI-Logs bleiben sauber.
const tty = process.stdout.isTTY
const paint = (code, s) => (tty ? `\x1b[${code}m${s}\x1b[0m` : s)
const bold = (s) => paint('1', s)
const dim = (s) => paint('2', s)
const red = (s) => paint('31', s)
const green = (s) => paint('32', s)
const cyan = (s) => paint('36', s)

function fail(msg) {
  console.error(`\n${red('✖ Setup abgebrochen:')} ${msg}\n`)
  process.exit(1)
}

console.log(bold('\n⚓ KubeQuest – Setup\n'))

// 1) Node-Version gegen .nvmrc prüfen (SSOT der erwarteten Major-Version).
function requiredMajor() {
  try {
    return parseInt(readFileSync(join(ROOT, '.nvmrc'), 'utf8').trim(), 10)
  } catch {
    return 22 // Fallback = engines.node in package.json
  }
}
const needMajor = requiredMajor()
const haveMajor = parseInt(process.versions.node.split('.')[0], 10)
if (Number.isNaN(haveMajor) || haveMajor < needMajor) {
  fail(
    `Node ${needMajor}+ benötigt, gefunden ist ${process.versions.node}.\n` +
      `   Installiere eine passende Version (steht in .nvmrc), z.B. mit nvm: ` +
      cyan(`nvm install ${needMajor} && nvm use ${needMajor}`),
  )
}
console.log(`${green('✓')} Node ${process.versions.node} ${dim(`(≥ ${needMajor} ok)`)}\n`)

// 1b) Git-Hooks verdrahten (#528): den versionierten `.githooks/`-Ordner als
// `core.hooksPath` setzen, damit der committete pre-push-Hook greift (kein husky
// nötig). Idempotent, läuft in jedem Klon/Worktree einmal. Kein Git-Repo (z.B.
// Tarball-Download)? Nur ein Hinweis, kein Abbruch – Setup soll weiterlaufen.
console.log(bold('▶ Git-Hooks verdrahten') + dim('  (core.hooksPath → .githooks, #528)'))
try {
  execSync('git rev-parse --git-dir', { stdio: 'ignore', cwd: ROOT })
  execSync('git config core.hooksPath .githooks', { stdio: 'inherit', cwd: ROOT })
  // Ausführbar-Bit setzen (POSIX; auf Windows harmlos/no-op) – ohne läuft der
  // Hook dort nicht.
  try {
    chmodSync(join(ROOT, '.githooks', 'pre-push'), 0o755)
  } catch {
    // Datei fehlt/kein POSIX – der core.hooksPath-Eintrag oben genügt.
  }
  console.log(`${green('✓')} pre-push-Hook aktiv ${dim('(schnelle Gates vor Push auf main; Umgehung: git push --no-verify)')}\n`)
} catch {
  console.log(`${dim('… kein Git-Repo erkannt – Hook-Verdrahtung übersprungen (nur relevant beim Pushen).')}\n`)
}

// 2)–5) Die Schritte der Reihe nach – bei Fehler sofort abbrechen.
const steps = [
  ['Abhängigkeiten installieren', 'npm install'],
  ['Tests', 'npm test'],
  ['Typecheck (strict)', 'npm run typecheck'],
  ['Lint (ESLint)', 'npm run lint'],
  ['Architektur-Wächter', 'npm run check:arch'],
  ['Dateigröße-Wächter', 'npm run check:size'],
]

for (const [label, cmd] of steps) {
  console.log(bold(`▶ ${label}`) + dim(`  (${cmd})`))
  try {
    execSync(cmd, { stdio: 'inherit', cwd: ROOT })
  } catch {
    fail(
      `Schritt „${label}" (${cmd}) ist fehlgeschlagen. Die Ursache steht oben; ` +
        `behebe sie und starte ${cyan('npm run setup')} erneut.`,
    )
  }
  console.log()
}

console.log(green(bold('✅ Alles grün – leg los!')))
console.log(`   Dev-Server starten:    ${cyan('npm run dev')} ${dim('(dann die angezeigte Adresse im Browser öffnen)')}`)
console.log(`   Nächstes Ticket holen: ${cyan('gh issue list --state open --limit 500')} ${dim('(Ablauf: AGENTS.md)')}\n`)

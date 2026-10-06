/**
 * Gemeinsamer Helfer der Workflow-Wächter (#1239): schneidet einen markierten Block aus
 * `.claude/workflows/kubernia-ticket.js` und führt ihn per node:vm aus. Der Workflow lässt
 * sich nicht importieren (Top-Level-await gegen Laufzeit-Globals), darum wird der Block
 * zwischen zwei Markern ausgeschnitten.
 *
 * Liegt bewusst in test/harness/ (geschützter Pfad, Goodhart-Guard) und nicht in test/support/:
 * wer die Schneide-Logik der Wächter verbiegt, soll `maintainer-approved` brauchen.
 */
import { readFileSync } from "node:fs"
import { runInNewContext } from "node:vm"

const WORKFLOW = new URL("../../.claude/workflows/kubernia-ticket.js", import.meta.url)

/** Liest das Workflow-Skript und schneidet den Block zwischen den Markern aus. */
export function workflowBlock(anfang: string, ende: string): { quelle: string; block: string } {
  const quelle = readFileSync(WORKFLOW, "utf8")
  const start = quelle.indexOf(anfang)
  const stop = quelle.indexOf(ende)
  if (start === -1 || stop === -1 || stop <= start) {
    throw new Error(
      `Marker "${anfang}" / "${ende}" nicht (mehr) in .claude/workflows/kubernia-ticket.js ` +
        `gefunden. Wurde der Block umbenannt oder verschoben? Dann die Marker mitziehen — ` +
        `der Wächter-Test schneidet den Block daran aus.`,
    )
  }
  return { quelle, block: quelle.slice(start, stop) }
}

/** Führt den Block aus und gibt die benannte Funktion zurück (Cast gegen das implizite any). */
export function blockFunktion<T>(block: string, name: string): T {
  return runInNewContext(`${block}\n${name}`) as T
}

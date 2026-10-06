/**
 * Gemeinsamer Helfer der Workflow-Wächter (#1239): schneidet einen markierten Block aus
 * `.claude/workflows/kubernia-ticket.js` und führt ihn per node:vm aus. Der Workflow lässt
 * sich nicht importieren (Top-Level-await gegen Laufzeit-Globals), darum wird der Block
 * zwischen zwei Markern ausgeschnitten.
 *
 * Liegt bewusst in test/harness/ (geschützter Pfad, Audit-Kommentar) und nicht in test/support/:
 * wer die Schneide-Logik der Wächter verbiegt, hinterlässt eine Audit-Spur.
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

/**
 * Führt das ganze Workflow-Skript per node:vm gegen Stub-Globals aus (#1309, vorher doppelt in
 * model-routing.test.ts und review-staffel.test.ts) und gibt `endstand` zurück. `parallel` fehlt
 * absichtlich als Default: ein Lauf, der es nicht erwartet, bricht laut ab.
 */
export async function workflowAusfuehren<T = { ergebnis: string }>(
  agent: (prompt: string, o: { label: string; agentType?: string; model?: string; effort?: string }) => Promise<unknown>,
  opts: { parallel?: (thunks: (() => Promise<unknown>)[]) => Promise<unknown[]> } = {},
): Promise<T> {
  const quelle = readFileSync(WORKFLOW, "utf8").replace("export const meta", "const meta")
  const parallel =
    opts.parallel ??
    (() => {
      throw new Error("unerwartet")
    })
  const kontext = { agent, parallel, phase: () => undefined, log: () => undefined, args: undefined }
  return (await runInNewContext(`(async () => {
${quelle}
return endstand
})()`, kontext)) as T
}

/** Führt den Block aus und gibt die benannte Funktion zurück (Cast gegen das implizite any). */
export function blockFunktion<T>(block: string, name: string): T {
  return runInNewContext(`${block}\n${name}`) as T
}

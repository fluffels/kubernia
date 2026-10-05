/**
 * Fitness-Function für die /rename-Zeile nach dem Claimen (#1213).
 *
 * @harness-waechter – einziger Durchsetzer seiner Regel, darum im geschützten test/harness/ (#1165).
 *
 * Der Workflow lässt sich nicht importieren (Top-Level-await gegen Laufzeit-Globals, siehe
 * test/harness/workflow-args.test.ts); darum wird der Block zwischen den Markern ausgeschnitten
 * und per node:vm ausgeführt. Zusätzlich prüft der Test, dass die Skills die Zeile erwähnen.
 */
import { readFileSync } from "node:fs"
import { runInNewContext } from "node:vm"
import { describe, expect, it } from "vitest"

const lies = (pfad: string) => readFileSync(new URL(`../../${pfad}`, import.meta.url), "utf8")
const MARKER_ANFANG = "// ── rename-Kurztitel (#1213) — Anfang"
const MARKER_ENDE = "// ── rename-Kurztitel (#1213) — Ende"

const workflow = lies(".claude/workflows/kubernia-ticket.js")
const start = workflow.indexOf(MARKER_ANFANG)
const ende = workflow.indexOf(MARKER_ENDE)
if (start === -1 || ende <= start) {
  throw new Error(`Marker "${MARKER_ANFANG}" / "${MARKER_ENDE}" fehlen in kubernia-ticket.js`)
}
const renameKurztitel = runInNewContext(`${workflow.slice(start, ende)}\nrenameKurztitel`) as (titel: string) => string

describe("renameKurztitel", () => {
  it("lässt kurze ASCII-Titel unverändert", () => {
    expect(renameKurztitel("Harness: Fix")).toBe("Harness: Fix")
  })

  it("ersetzt Umlaute und ß durch ASCII", () => {
    expect(renameKurztitel("Größe prüfen für Ärzte öffnen")).toBe("Groesse pruefen fuer Aerzte oeffnen")
  })

  it("entfernt Emojis und andere Nicht-ASCII-Zeichen und verdichtet Leerraum", () => {
    expect(renameKurztitel("🚨  CI   rot – auf main")).toBe("CI rot auf main")
  })

  it("kürzt auf höchstens 40 Zeichen ohne Rand-Leerzeichen", () => {
    const kurz = renameKurztitel("a".repeat(39) + " " + "b".repeat(30))
    expect(kurz.length).toBeLessThanOrEqual(40)
    expect(kurz).toBe(kurz.trim())
  })
})

describe("/rename-Zeile ist in Workflow und Skills verankert", () => {
  it("Workflow loggt die Zeile nach dem Claim", () => {
    expect(workflow).toContain("/rename kq-${nr} ${renameKurztitel(")
  })

  it.each([".claude/skills/kubernia/SKILL.md", ".claude/skills/kubernia-loop/SKILL.md"])(
    "%s nennt /rename kq-<nr>",
    (pfad) => {
      expect(lies(pfad)).toContain("/rename kq-<nr> <Kurztitel>")
    },
  )
})

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
import { describe, expect, it } from "vitest"
import { blockFunktion, workflowBlock } from "./workflow-block"

const lies = (pfad: string) => readFileSync(new URL(`../../${pfad}`, import.meta.url), "utf8")
const MARKER_ANFANG = "// ── rename-Kurztitel (#1213) — Anfang"
const MARKER_ENDE = "// ── rename-Kurztitel (#1213) — Ende"

const { quelle: workflow, block } = workflowBlock(MARKER_ANFANG, MARKER_ENDE)
const renameKurztitel = blockFunktion<(titel: unknown) => string>(block, "renameKurztitel")
const renameZeile = blockFunktion<(nr: number, titel: unknown) => string>(block, "renameZeile")

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

  it("kürzt exakt auf 40 Zeichen ohne Rand-Leerzeichen", () => {
    expect(renameKurztitel("a".repeat(39) + " " + "b".repeat(30))).toBe("a".repeat(39))
  })

  it("lässt genau 40 Zeichen unverändert und kürzt 41", () => {
    expect(renameKurztitel("x".repeat(40))).toBe("x".repeat(40))
    expect(renameKurztitel("x".repeat(41))).toBe("x".repeat(40))
  })

  it("verschmilzt Tab/Zeilenumbruch nicht zu einem Wort", () => {
    expect(renameKurztitel("Fix\tCI\nrot")).toBe("Fix CI rot")
  })

  it("liefert für fehlenden oder reinen Emoji-Titel den leeren String", () => {
    expect(renameKurztitel(undefined)).toBe("")
    expect(renameKurztitel("🚨🔥")).toBe("")
  })
})

describe("renameZeile", () => {
  it("hängt den Kurztitel an", () => {
    expect(renameZeile(1239, "Harness: Fix")).toBe("/rename kq-1239 Harness: Fix")
  })

  it("lässt bei leerem Kurztitel kein Leerzeichen am Ende stehen", () => {
    expect(renameZeile(1239, "🚨🔥")).toBe("/rename kq-1239")
    expect(renameZeile(1239, undefined)).toBe("/rename kq-1239")
  })
})

describe("/rename-Zeile ist in Workflow und Skills verankert", () => {
  it("Workflow loggt die Zeile nach dem Claim", () => {
    expect(workflow).toContain("renameZeile(nr, auswahl.titel)")
  })

  it("die Zeile steht hinter der claimVerifiziert-Prüfung", () => {
    const claim = workflow.indexOf("if (!auswahl.claimVerifiziert)")
    const zeile = workflow.indexOf("renameZeile(nr, auswahl.titel)")
    expect(claim).toBeGreaterThan(-1)
    expect(zeile).toBeGreaterThan(claim)
  })

  it("kubernia-Skill nennt /rename kq-<nr>", () => {
    expect(lies(".claude/skills/kubernia/SKILL.md")).toContain("/rename kq-<nr> <Kurztitel>")
  })
})

describe("workflowBlock (gemeinsamer Wächter-Helfer, #1239)", () => {
  it("wirft mit erklärender Meldung, wenn ein Marker fehlt", () => {
    expect(() => workflowBlock("// gibt es nicht — Anfang", MARKER_ENDE)).toThrow(/nicht \(mehr\)/)
  })

  it("wirft bei vertauschten Markern statt einen leeren Block zu liefern", () => {
    expect(() => workflowBlock(MARKER_ENDE, MARKER_ANFANG)).toThrow(/nicht \(mehr\)/)
  })
})

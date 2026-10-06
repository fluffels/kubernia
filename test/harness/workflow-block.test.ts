/**
 * Wächter-Helfer `workflowBlock` (#1239): fehlende oder vertauschte Marker müssen laut scheitern,
 * statt einen leeren Block zu liefern.
 *
 * @harness-waechter – einziger Durchsetzer seiner Regel, darum im geschützten test/harness/ (#1165).
 */
import { describe, expect, it } from "vitest"
import { workflowBlock } from "./workflow-block"

const ANFANG = "// ── Review-Staffel (#1265) — Anfang"
const ENDE = "// ── Review-Staffel (#1265) — Ende"

describe("workflowBlock (gemeinsamer Wächter-Helfer, #1239)", () => {
  it("liefert den Block zwischen echten Markern", () => {
    expect(workflowBlock(ANFANG, ENDE).block.length).toBeGreaterThan(0)
  })

  it("wirft mit erklärender Meldung, wenn ein Marker fehlt", () => {
    expect(() => workflowBlock("// gibt es nicht — Anfang", ENDE)).toThrow(/nicht \(mehr\)/)
  })

  it("wirft bei vertauschten Markern statt einen leeren Block zu liefern", () => {
    expect(() => workflowBlock(ENDE, ANFANG)).toThrow(/nicht \(mehr\)/)
  })
})

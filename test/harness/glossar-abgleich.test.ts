/* Glossar-Abgleich im Agentenlauf (#1561 Z5, #1579) – Planer und Requirement-Treue-Lens prüfen neue Begriffe gegen docs/glossar.md (Spiel) und docs/harness-glossar.md (Harness).
 *
 * @harness-waechter – einziger Durchsetzer seiner Regel, darum im geschützten test/harness/ (#1165).
 *
 * Die Lens-Fassung steht im Skill und wörtlich im Workflow (Gleichheit erzwingt lens-abgleich.test.ts); hier steht nur,
 * dass der Punkt überhaupt vorhanden ist und die Planer-Definition den Pflichtpunkt trägt.
 */
import { describe, test } from "vitest";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const lies = (rel: string) => readFileSync(new URL(`../../${rel}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");

describe("Glossar-Abgleich (#1561 Z5)", () => {
  test("der Planer führt den Glossar-Abgleich als Pflichtpunkt des Plans und je Epic-Kind", () => {
    const planer = lies(".claude/agents/kubernia-planner.md");
    assert.match(planer, /\*\*Glossar-Abgleich \(Pflicht\):\*\*[^\n]*docs\/glossar\.md[^\n]*keine neuen Begriffe/);
    assert.match(planer, /\*\*Glossar-Abgleich \(Pflicht\):\*\*[^\n]*docs\/harness-glossar\.md[^\n]*keine neuen Begriffe/);
    assert.match(planer, /je Kind der Glossar-Abgleich/);
  });

  test("die Requirement-Treue-Lens prüft neue Begriffe gegen das Glossar, in Skill und Workflow", () => {
    for (const rel of [".claude/skills/review-lenses/SKILL.md", ".claude/workflows/kubernia-ticket.js"]) {
      const text = lies(rel).replace(/`/g, "");
      assert.match(text, /Neue Begriffe in Texten\/Bezeichnern gegen docs\/glossar\.md \(Spiel\) und docs\/harness-glossar\.md \(Harness\): ein Hafen-Wort in Sim-Text oder umgekehrt \(ACL\) ist blockierend/, rel);
      assert.match(text, /ein neu eingeführter Fachbegriff, der in keinem der beiden Glossare steht und im Diff nicht ergänzt wird \(auch ein Harness-Begriff in einem Harness-Text\), ist blockierend/, rel);
    }
  });
});

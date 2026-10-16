/* Jeder `ergebnis`-Wert des Ticket-Workflows ist im Skill dokumentiert (#1663 L44a).
 *
 * @harness-waechter – einziger Durchsetzer seiner Regel, darum im geschützten test/harness/ (#1165).
 *
 * Quelle der Werte: die `return { ergebnis: '…' }`-Literale von .claude/workflows/kubernia-ticket.js. Ein Wert, den der Skill
 * nicht nennt, lässt den aufrufenden Agenten ratlos. Teilergebnisse der Unter-Agenten (Schema-Enums) zählen nicht.
 */
import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

const WORKFLOW = readFileSync(new URL("../../.claude/workflows/kubernia-ticket.js", import.meta.url), "utf8");
const SKILL = readFileSync(new URL("../../.claude/skills/kubernia-workflow/SKILL.md", import.meta.url), "utf8");

/** Alle Werte, die der Workflow selbst zurückgibt. */
function werte(text: string): string[] {
  return [...new Set([...text.matchAll(/ergebnis:\s*'([a-z-]+)'/g)].map((m) => m[1]))].sort();
}

/** Werte, die im Skill nicht als Wort vorkommen. */
function fehlend(vorhanden: string[], skill: string): string[] {
  return vorhanden.filter((w) => !new RegExp(`(?<![a-z-])${w}(?![a-z-])`).test(skill));
}

describe("ergebnis-Werte des Workflows stehen im Skill", () => {
  test("der Prüfer meldet einen erfundenen Wert als fehlend (Negativfall)", () => {
    expect(fehlend(["xyz", "fertig"], "… fertig …")).toEqual(["xyz"]);
    expect(werte("return { ergebnis: 'xyz' }")).toEqual(["xyz"]);
    expect(werte("ergebnis: { type: 'string', enum: ['a-b'] }")).toEqual([]);
  });

  test("der Workflow liefert mindestens 8 Werte (Leer-Schutz)", () => {
    expect(werte(WORKFLOW).length).toBeGreaterThanOrEqual(8);
  });

  test("jeder Wert steht in SKILL.md", () => {
    expect(fehlend(werte(WORKFLOW), SKILL)).toEqual([]);
  });
});

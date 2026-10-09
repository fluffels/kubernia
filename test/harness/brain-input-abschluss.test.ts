/* Wächter für den Sitzungsabschluss (#1572 Z5): der kubernia-Skill (Schritt 5) und der Workflow-Skill rufen `brain-input`
 * IMMER auf; der Schritt entfällt nur, wenn dieser Aufruf mit unbekanntem Skill scheitert.
 *
 * @harness-waechter – einziger Durchsetzer seiner Regel, darum im geschützten test/harness/.
 *
 * Warum: „falls er in der Session verfügbar ist“ ließ den Hauptchat den Schritt am Sitzungsende überspringen, weil eine
 * spätere, kürzere Skill-Liste `brain-input` nicht mehr nannte. Eine Skill-Liste ist kein Beleg für Nichtverfügbarkeit.
 */
import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

const norm = (t: string) => t.replace(/\s+/g, " ");
const lies = (pfad: string) => norm(readFileSync(new URL(`../../${pfad}`, import.meta.url), "utf8"));
const SKILLS = [".claude/skills/kubernia/SKILL.md", ".claude/skills/kubernia-workflow/SKILL.md"];

describe("Sitzungsabschluss ruft brain-input immer auf (#1572)", () => {
  test.each(SKILLS)("%s: Aufruf-Wortlaut und Satz zur Skill-Liste stehen da", (pfad) => {
    const t = lies(pfad);
    expect(t).toContain('Skill({ skill: "brain-input" })');
    expect(t).toContain("eine spätere, kürzere Skill-Liste ist kein Beleg");
  });

  test.each(SKILLS)("%s: kein Vorab-Gate „falls verfügbar“ neben brain-input", (pfad) => {
    const t = lies(pfad);
    expect(t).not.toMatch(/falls er in der Session verfügbar ist/);
    expect(t).not.toMatch(/brain-input[^.]{0,40}falls verfügbar/);
  });

  test("der kubernia-Skill lässt den Schritt nur bei unbekanntem Skill entfallen", () => {
    expect(lies(SKILLS[0])).toMatch(/entfällt nur, wenn dieser Aufruf mit unbekanntem Skill scheitert/);
  });
});

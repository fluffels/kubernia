/* Spielrhythmus-Wächter (#1215) – die Spielquote wird im Board gepflegt, nicht aus der Historie gerechnet.
 *
 * @harness-waechter – einziger Durchsetzer seiner Regel, darum im geschützten test/harness/ (#1165).
 *
 * Fehlklasse: Skill-/Doku-/Workflow-Texte schreiben die frühere Historienrechnung („letzte zwei
 * gemergte PRs", „Spiel-Slot dran") fort, während AGENTS.md schon den Board-Rhythmus nennt.
 * Dann wählt ein Agent wieder nach Historie statt „oberstes freies Item".
 * Grenze: erkennt nur die bekannten Formulierungen (OLD_QUOTA_CLAIMS), nicht jede Umschreibung.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (p: string): string => readFileSync(p, "utf8");

const FILES = [
  "AGENTS.md",
  ".claude/skills/kubernia/SKILL.md",
  ".claude/skills/kubernia-loop/SKILL.md",
  ".claude/skills/forum/SKILL.md",
  ".claude/workflows/kubernia-ticket.js",
  "docs/agent-harness.md",
  "docs/ticket-reihenfolge.md",
];

/** Formulierungen der abgelegten Historienrechnung. */
const OLD_QUOTA_CLAIMS = [/Ausnahme:\s*Spielquote/i, /Spiel-Slot dran/i, /letzten zwei gemergten/i, /gemergten Ticket-PRs ein Spielticket/i, /kein Pflege-Schritt am Ticket-Ende/i, /puh, fertig"-Pflege-Schritt mehr/i];

describe("Spielrhythmus im Board (#1215)", () => {
  it.each(FILES)("%s beschreibt keine Historienrechnung mehr", (f) => {
    const text = read(f);
    for (const re of OLD_QUOTA_CLAIMS) expect(text, `${f} enthält ${String(re)}`).not.toMatch(re);
  });

  it("AGENTS.md nennt den Rhythmus: jede dritte Position, Pflege am Ticket-Ende und beim Einsortieren", () => {
    const t = read("AGENTS.md");
    expect(t).toMatch(/höchstens zwei Nicht-Spieltickets/);
    expect(t).toMatch(/Ende jedes Tickets/);
    expect(t).toMatch(/Einsortieren/);
  });

  it("Workflow-Cleanup und Einsortier-Stellen verweisen auf den Spielrhythmus-Schritt", () => {
    const w = read(".claude/workflows/kubernia-ticket.js");
    expect(w.match(/Spielrhythmus/g)?.length ?? 0).toBeGreaterThanOrEqual(3);
    expect(read("AGENTS.md")).toMatch(/Danach den Spielrhythmus-Schritt fahren/);
  });

  it("ticket-reihenfolge.md enthält den Pflege-Befehl (updateProjectV2ItemPosition) im Rhythmus-Abschnitt", () => {
    const t = read("docs/ticket-reihenfolge.md");
    const i = t.indexOf("## Spielrhythmus");
    expect(i).toBeGreaterThan(-1);
    const j = t.indexOf("\n## ", i + 1);
    expect(t.slice(i, j)).toMatch(/updateProjectV2ItemPosition/);
  });
});

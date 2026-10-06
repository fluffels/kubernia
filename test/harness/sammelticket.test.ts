/* Sammelticket-Position-Wächter (#1276) – die Zahl steht genau einmal, der jq-Index folgt ihr.
 *
 * @harness-waechter – einziger Durchsetzer seiner Regel, darum im geschützten test/harness/ (#1165).
 *
 * Die Board-Position des Sammeltickets „Harness-Härtung (gesammelt)" stand früher wörtlich in
 * AGENTS.md, docs/ticket-reihenfolge.md, im Workflow und im ADR. Die Maintainerin verschob sie
 * mehrfach (5 → 7 → 6), und jede Verschiebung hätte vier Stellen gebraucht. Regel jetzt:
 *
 *   1. AGENTS.md nennt die Position genau einmal (SSOT).
 *   2. Der jq-Index im Anlegen-Snippet von docs/ticket-reihenfolge.md ist Position − 2
 *      (0-basiert, und das frisch angelegte Item steht selbst nicht in der Zählung).
 *   3. Das Snippet schließt das neue Item aus (`.id != "$ITEM"`), sonst bekäme `afterId` bei
 *      genau Position-1 Todo-Items das neue Item selbst.
 *   4. Workflow und Sammelticket-Abschnitt von docs/ticket-reihenfolge.md nennen keine eigene Zahl
 *      und verweisen auf AGENTS.md. Das ADR darf die Historie mit Zahlen erzählen.
 */
import { describe, test } from "vitest";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const lies = (rel: string): string => readFileSync(fileURLToPath(new URL(`../../${rel}`, import.meta.url)), "utf8");

/** „Position 6“ und „Position: 6“ (auch mit Zeilenumbruch dazwischen). */
const POSITION = /Position\s*:?\s*(\d+)/g;
const POSITION_EINZELN = /Position\s*:?\s*\d+/;

/** Die Position aus AGENTS.md (genau ein Treffer) – wirft, wenn es keiner oder mehrere sind. */
function positionAusAgentsMd(text: string): number {
  const treffer = [...text.matchAll(POSITION)];
  assert.equal(treffer.length, 1, `AGENTS.md muss „Board-Position <N>“ genau einmal nennen (jede „Position <N>“), gefunden: ${treffer.length}`);
  return Number(treffer[0][1]);
}

/** Der Abschnitt „Sammelticket …" bis zur nächsten H2-Überschrift. */
function sammelticketAbschnitt(doc: string): string {
  const von = doc.indexOf("## Sammelticket");
  assert.ok(von >= 0, "docs/ticket-reihenfolge.md braucht den Abschnitt „Sammelticket …“");
  const bis = doc.indexOf("\n## ", von + 1);
  return doc.slice(von, bis < 0 ? undefined : bis);
}

/** Der generische Anlegen-Abschnitt (gilt für Sammelticket und Status-Ticket). */
function anlegenAbschnitt(doc: string): string {
  const von = doc.indexOf("## Anlegen auf Position N");
  assert.ok(von >= 0, "docs/ticket-reihenfolge.md braucht den Abschnitt „Anlegen auf Position N“");
  const bis = doc.indexOf("\n## ", von + 1);
  return doc.slice(von, bis < 0 ? undefined : bis);
}

describe("Sammelticket-Position (#1276)", () => {
  const agents = lies("AGENTS.md");
  const doc = lies("docs/ticket-reihenfolge.md");
  const abschnitt = sammelticketAbschnitt(doc);
  const anlegen = anlegenAbschnitt(doc);

  test("AGENTS.md nennt die Position genau einmal", () => {
    assert.ok(positionAusAgentsMd(agents) >= 1);
  });

  test("der Index im Snippet ist N − 2 (N = Position aus AGENTS.md, als Variable statt Literal)", () => {
    assert.match(anlegen, /\(\.\[\$N-2\] \/\/ \.\[-1\]\)\.id/);
    assert.match(anlegen, /^N=<Position>/m, "das Snippet trägt keine eigene Zahl für das Sammelticket");
  });

  test("das Snippet schließt das frisch angelegte Item aus der Zählung aus", () => {
    assert.ok(anlegen.includes('and .id != \\"$ITEM\\")]'), 'select(... and .id != \\"$ITEM\\")');
  });

  test("der Workflow doppelt die Zahl nicht, sondern verweist auf AGENTS.md", () => {
    const wf = lies(".claude/workflows/kubernia-ticket.js");
    assert.doesNotMatch(wf, POSITION_EINZELN);
    assert.match(wf, /Position laut AGENTS\.md/);
  });

  test("der Sammelticket-Abschnitt in ticket-reihenfolge.md doppelt die Zahl nicht", () => {
    assert.doesNotMatch(abschnitt, POSITION_EINZELN);
    assert.match(abschnitt, /Position laut AGENTS\.md/);
  });

  test("Negativfall: eine zweite Zahl in AGENTS.md oder keine wird erkannt", () => {
    assert.throws(() => positionAusAgentsMd("Board-Position 6 und wieder auf Position 7"));
    assert.throws(() => positionAusAgentsMd("keine Zahl hier"));
    assert.throws(() => positionAusAgentsMd("Board-Position 6 und Position: 7"), "auch die Schreibweise mit Doppelpunkt zählt");
    assert.equal(positionAusAgentsMd("Board-Position: 6"), 6);
    assert.equal(positionAusAgentsMd("Board-Position 6"), 6);
  });
});

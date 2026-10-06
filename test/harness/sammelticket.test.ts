/* Sammelticket-Position-Wächter (#1276) – die Zahl steht genau einmal, der jq-Index folgt ihr.
 *
 * @harness-waechter – einziger Durchsetzer seiner Regel, darum im geschützten test/harness/ (#1165).
 *
 * Die Board-Position des Sammeltickets „Harness-Härtung (gesammelt)" stand früher wörtlich in
 * AGENTS.md, docs/ticket-reihenfolge.md, im Workflow und im ADR. Die Maintainerin verschob sie
 * mehrfach (5 → 7 → 6), und jede Verschiebung hätte vier Stellen gebraucht. Regel jetzt:
 *
 *   1. AGENTS.md nennt die Position genau einmal (SSOT).
 *   2. Das Anlegen-Snippet von docs/ticket-reihenfolge.md setzt die Position über
 *      `board-place.mjs --position "$N" "$NR"`; die Zählung (N-1. Todo-Item ohne das neue Item) liegt
 *      getestet in scripts/board-lib.mjs › afterIdForPosition.
 *   3. Workflow und Sammelticket-Abschnitt von docs/ticket-reihenfolge.md nennen keine eigene Zahl
 *      und verweisen auf AGENTS.md. Das ADR darf die Historie mit Zahlen erzählen.
 */
import { describe, test } from "vitest";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const lies = (rel: string): string => readFileSync(fileURLToPath(new URL(`../../${rel}`, import.meta.url)), "utf8");

const POSITION = /Position (\d+)/g;

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

  test("das Snippet setzt die Position über board-place.mjs mit N als Variable (die Zählung ist in test/board.test.ts getestet)", () => {
    assert.match(anlegen, /board-place\.mjs --position "\$N" "\$NR"/);
    assert.match(anlegen, /^N=<Position>/m, "das Snippet trägt keine eigene Zahl für das Sammelticket");
  });

  test("das Snippet zählt nicht selbst per jq nach (sonst driftet es von der getesteten Logik)", () => {
    assert.doesNotMatch(anlegen, /\$N-2/);
  });

  test("der Workflow doppelt die Zahl nicht, sondern verweist auf AGENTS.md", () => {
    const wf = lies(".claude/workflows/kubernia-ticket.js");
    assert.doesNotMatch(wf, /Position \d+/);
    assert.match(wf, /Position laut AGENTS\.md/);
  });

  test("der Sammelticket-Abschnitt in ticket-reihenfolge.md doppelt die Zahl nicht", () => {
    assert.doesNotMatch(abschnitt, /Position \d+/);
    assert.match(abschnitt, /Position laut AGENTS\.md/);
  });

  test("Negativfall: eine zweite Zahl in AGENTS.md oder keine wird erkannt", () => {
    assert.throws(() => positionAusAgentsMd("Board-Position 6 und wieder auf Position 7"));
    assert.throws(() => positionAusAgentsMd("keine Zahl hier"));
  });

  test("Komplett-Regel: AGENTS.md und ticket-reihenfolge.md verlangen das ganze Sammelticket, keinen Rest-Übertrag (#1311)", () => {
    assert.match(agents, /Kommt es dran: abarbeiten, und zwar \*\*komplett\*\*/);
    assert.match(abschnitt, /\*\*Abarbeiten:\*\* \*\*alle\*\* Zeilen umsetzen, kein Teil und kein Rest-Übertrag/);
    assert.match(abschnitt, /KQ-Diffsize-Override/, "zu große PRs deckt der begründete Override");
  });

  test("Komplett-Regel: Umsetzer, Planer und Skill nennen sie", () => {
    assert.match(lies(".claude/agents/kubernia-umsetzer.md"), /setze ALLE Zeilen um/);
    assert.match(lies(".claude/agents/kubernia-planner.md"), /plane ALLE Zeilen/);
    assert.match(lies(".claude/skills/kubernia/SKILL.md"), /komplett umsetzen, kein Rest-Übertrag/);
    assert.match(lies(".claude/workflows/kubernia-ticket.js"), /setze ALLE Zeilen um/);
  });

  test("Negativfall: der alte Teil-Abarbeiten-Wortlaut steht nirgends mehr im Abschnitt oder in AGENTS.md", () => {
    assert.doesNotMatch(abschnitt, /passen/);
    assert.doesNotMatch(agents, new RegExp("was in einen PR " + "passt"));
  });
});

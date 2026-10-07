/* Sammelticket-Position-Wächter (#1276) – die Zahl steht genau einmal, der jq-Index folgt ihr.
 *
 * @harness-waechter – einziger Durchsetzer seiner Regel, darum im geschützten test/harness/ (#1165).
 *
 * Die Board-Position des Sammeltickets „Harness-Härtung (gesammelt)" stand früher wörtlich in
 * AGENTS.md, docs/ticket-reihenfolge.md, im Workflow und im ADR. Die Maintainerin verschob sie
 * mehrfach (5 → 7 → 6), und jede Verschiebung hätte vier Stellen gebraucht. Regel jetzt:
 *
 *   1. AGENTS.md nennt die Position genau einmal (SSOT).
 *   2. Das Anlegen läuft über scripts/sammelticket-anlegen.mjs (#1390): es liest die Zahl per
 *      `sammelticketPosition` aus AGENTS.md, setzt und prüft die Position; die Zählung (N-1. Todo-Item ohne
 *      das neue Item) liegt getestet in scripts/board-lib.mjs › afterIdForPosition und sammelticketKorrektur.
 *      Die Doku nennt das Skript und keine eigene Zahl.
 *   3. Workflow und Sammelticket-Abschnitt von docs/ticket-reihenfolge.md nennen keine eigene Zahl
 *      und verweisen auf AGENTS.md. Das ADR darf die Historie mit Zahlen erzählen.
 *
 * Jede weitere „Position <N>“ (auch „Position: <N>“) in AGENTS.md macht den Test absichtlich rot,
 * auch in anderem Zusammenhang; darum hat das wiederkehrende Status-Ticket keine Position mehr:
 * seinen Takt hält der Board-Takt board-takt.yml (#1351, #1390).
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

/** Der Abschnitt „Sammelticket „Harness-Härtung …“ bis zur nächsten H2-Überschrift. */
function sammelticketAbschnitt(doc: string): string {
  const von = doc.indexOf("## Sammelticket „Harness-Härtung");
  assert.ok(von >= 0, "docs/ticket-reihenfolge.md braucht den Abschnitt „Sammelticket …“");
  const bis = doc.indexOf("\n## ", von + 1);
  return doc.slice(von, bis < 0 ? undefined : bis);
}

/** Der Anlegen-Abschnitt (gilt für beide Sammeltickets). */
function anlegenAbschnitt(doc: string): string {
  const von = doc.indexOf("## Sammelticket anlegen");
  assert.ok(von >= 0, "docs/ticket-reihenfolge.md braucht den Abschnitt „Sammelticket anlegen“");
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

  test("das Anlegen läuft über das Skript, die Doku trägt keine eigene Zahl und zählt nicht selbst nach (die Zählung ist in test/board-korrektur.test.ts getestet)", () => {
    assert.match(anlegen, /node scripts\/sammelticket-anlegen\.mjs harness/);
    assert.match(anlegen, /Position laut AGENTS\.md/);
    assert.doesNotMatch(anlegen, POSITION_EINZELN, "keine eigene Positions-Zahl im Anlegen-Abschnitt");
    assert.doesNotMatch(anlegen, /\$N-2|--position "\$N"/, "kein Snippet, das selbst nachzählt");
  });

  test("das Skript liest die Position aus AGENTS.md per sammelticketPosition statt eine Zahl zu tragen", () => {
    const skript = lies("scripts/sammelticket-anlegen.mjs");
    assert.match(skript, /sammelticketPosition\(readFileSync\(new URL\("\.\.\/AGENTS\.md"/);
    assert.doesNotMatch(skript, POSITION_EINZELN);
    assert.doesNotMatch(lies("scripts/board-takt.mjs"), POSITION_EINZELN);
    assert.doesNotMatch(lies("scripts/board-place.mjs"), POSITION_EINZELN);
  });

  test("der Skill kubernia legt beim Claim eines Sammeltickets den Nachfolger über das Skript an", () => {
    assert.match(lies(".claude/skills/kubernia/SKILL.md"), /node scripts\/sammelticket-anlegen\.mjs harness --vorgaenger/);
  });

  test("AGENTS.md verweist für das Anlegen auf das Skript", () => {
    assert.match(agents, /sammelticket-anlegen\.mjs harness/);
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
    assert.match("Position: 6", POSITION_EINZELN, "auch die Einzel-Variante kennt den Doppelpunkt");
    assert.equal(positionAusAgentsMd("Board-Position 6"), 6);
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

describe("Sammelticket komplett statt halbiert (#1311, ersetzt die Halbierung aus #1309)", () => {
  const agents = lies("AGENTS.md");
  const doc = lies("docs/ticket-reihenfolge.md");
  const abarbeiten = doc.split("\n").find((z) => z.startsWith("- **Abarbeiten:**")) ?? "";
  const claimen = doc.split("\n").find((z) => z.startsWith("- **Beim Claimen des Sammeltickets**")) ?? "";

  /** Verlangt der Abarbeiten-Bullet ein Ergebnis je Zeile, alle Zeilen und den Override für zu große PRs? Ein Prädikat für Artefakt und Gegenbeispiel. */
  const nenntErgebnisPflicht = (s: string) => s.includes("**alle** Zeilen") && s.includes("**Ergebnis**") && s.includes("KQ-Diffsize-Override") && s.includes("nichts wird still ausgelagert");
  /** Beschreibt ein Text noch die Halbierung (die Teilung der Zeilenliste, #1309)? */
  const halbiert = (s: string) => /zweite Hälfte/.test(s) || /erste Hälfte/.test(s);

  test("Abarbeiten verlangt alle Zeilen mit je einem Ergebnis; Claimen überträgt nichts", () => {
    assert.ok(nenntErgebnisPflicht(abarbeiten), "Abarbeiten-Bullet: alle Zeilen, Ergebnis je Zeile, Override, nichts still auslagern");
    assert.ok(!halbiert(claimen), "Beim Claimen wird keine Hälfte übertragen");
    assert.match(claimen, /fehlt es, direkt eines anlegen/);
  });

  test("die Halbierung steht nirgends mehr in AGENTS.md oder im Abarbeiten-Bullet", () => {
    assert.ok(!halbiert(agents));
    assert.ok(!halbiert(abarbeiten));
  });

  test("Erkennung greift (Red-Green): der alte Wortlaut und die Halbierung fallen durch", () => {
    assert.ok(!nenntErgebnisPflicht("- **Abarbeiten:** so viele Zeilen umsetzen, wie " + "in **einen** PR " + "passen (`check:diffsize`)."));
    assert.ok(!nenntErgebnisPflicht("- **Abarbeiten:** jede Zeile der ersten Hälfte bekommt ein **Ergebnis**; KQ-Diffsize-Override."));
    assert.ok(halbiert("die **zweite " + "Hälfte** ins nächste Sammelticket übertragen"));
    assert.ok(!halbiert("kein Teil, kein Rest-Übertrag"));
    assert.ok(!nenntErgebnisPflicht(""));
  });
});

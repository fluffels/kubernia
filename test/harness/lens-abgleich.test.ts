/* Lens-Text-Abgleich (#1309) – Skill-Pfad und Workflow prüfen dieselben Punkte je Brille.
 *
 * @harness-waechter – einziger Durchsetzer seiner Regel, darum im geschützten test/harness/ (#1165).
 *
 * Die Prüfpunkte jeder Review-Brille stehen zweimal: im Skill `.claude/skills/review-lenses/SKILL.md`
 * (Skill-Pfad, tool-neutral) und in `LENSES[key].auftrag` des Workflows. Ohne Abgleich driftet eine
 * Fassung still: der Review prüft dann je nach Pfad etwas anderes. Der Wächter hält eine Tabelle je
 * Brille (ein Eintrag = ein Prüfpunkt, bestehend aus Stichwörtern, die in BEIDEN Texten vorkommen
 * müssen) und prüft zusätzlich, dass die Zahl der Prüfpunkte im Skill der Tabelle entspricht.
 *
 * Bewusst keine dritte, gemeinsame Quelle (#1311): Skill (Markdown für den Skill-Pfad) und Workflow (JS-Template) haben
 * unterschiedliche Formen, die Tabelle hier ist der Abgleich. Bei mehr als vier Brillen lohnt eine gemeinsame Datendatei.
 *
 * Grenze: ein neuer Prüfpunkt, der NUR im Workflow steht, fällt nicht auf; ein neuer Punkt im Skill
 * lässt die Zählung rot werden und zwingt zum Pflegen der Tabelle (und damit zum Abgleich).
 */
import { describe, test } from "vitest";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { blockFunktion, workflowBlock } from "./workflow-block";

const SKILL = readFileSync(new URL("../../.claude/skills/review-lenses/SKILL.md", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const lensen = blockFunktion<{ key: string; auftrag: string }[]>(
  workflowBlock("// ── Lens-Texte (#1309) — Anfang", "// ── Lens-Texte (#1309) — Ende").block,
  "LENSES",
);

/** Je Brille: Skill-Abschnitt (Kopfzeile bis Folgeabschnitt), Zeilenform der Prüfpunkte, Prüfpunkte als Stichwort-Gruppen. */
const TABELLE: { key: string; kopf: string; ende: string; punkt: RegExp; punkte: string[][] }[] = [
  {
    key: "architektur",
    kopf: "**Lens 1 — Architektur.**",
    ende: "**Lens 2",
    punkt: /^- /,
    punkte: [["Schicht"], ["Präsentation"], ["God-Function"], ["Duplizierung"], ["10×"]],
  },
  {
    key: "requirement-treue",
    kopf: "**Lens 2 — Requirement-Treue.**",
    ende: "**Lens 3",
    punkt: /^- /,
    punkte: [["Akzeptanzkriteri"], ["Scope-Kriechen"], ["README", "docs/module/"], ["Save-Format", "migriert"], ["Langfuse-Erfassung", "Messbehauptung"]],
  },
  {
    key: "test-adaequanz",
    kopf: "**Lens 3 — Test-Adäquanz.**",
    ende: "**Lens 4",
    punkt: /^- /,
    punkte: [["öffentliche API"], ["Negativfälle"], ["verfälscht", "Repro-Test"], ["Browser"]],
  },
  {
    key: "doku",
    kopf: "**Lens 4 — Doku**",
    ende: "## Findings-Format",
    punkt: /^\d+\. /,
    punkte: [["Akzeptanzkriteri"], ["SSOT"], ["Wächter"], ["10×"], ["Langfuse-Erfassung"]],
  },
];

/** Der Abschnitt einer Brille im Skill; wirft laut, wenn die Anker fehlen (kein stilles Leer-Grün). */
function skillAbschnitt(kopf: string, ende: string): string {
  const von = SKILL.indexOf(kopf);
  const bis = SKILL.indexOf(ende, von + kopf.length);
  if (von === -1 || bis === -1) throw new Error(`Skill-Abschnitt „${kopf}“ bis „${ende}“ nicht gefunden: Überschrift umbenannt? Dann die Tabelle mitziehen.`);
  return SKILL.slice(von, bis);
}

/** Stichwörter, die im Skill-Abschnitt ODER im Workflow-Auftrag fehlen (leer = abgeglichen). Pur, damit der Red-Green-Beweis gegen die echten Texte läuft. */
function fehlendeStichwoerter(skill: string, auftrag: string, punkte: string[][]): string[] {
  return punkte
    .flat()
    .flatMap((w) => [skill.includes(w) ? null : `Skill: ${w}`, auftrag.includes(w) ? null : `Workflow: ${w}`])
    .filter((x): x is string => x !== null);
}

/** Zahl der Prüfpunkte eines Skill-Abschnitts. */
const zaehlePunkte = (skill: string, punkt: RegExp): number => skill.split("\n").filter((z) => punkt.test(z)).length;

describe("Lens-Texte: Skill und Workflow prüfen dasselbe (#1309)", () => {
  test("der Workflow kennt genau die vier Brillen der Tabelle", () => {
    assert.deepEqual([...lensen].map((l) => l.key), TABELLE.map((t) => t.key));
  });

  for (const t of TABELLE) {
    describe(t.key, () => {
      const skill = skillAbschnitt(t.kopf, t.ende);
      const auftrag = lensen.find((l) => l.key === t.key)?.auftrag ?? "";

      test("jedes Stichwort steht im Skill-Abschnitt UND im Workflow-Auftrag", () => {
        assert.deepEqual(fehlendeStichwoerter(skill, auftrag, t.punkte), []);
      });

      test("die Zahl der Prüfpunkte im Skill entspricht der Tabelle", () => {
        assert.equal(zaehlePunkte(skill, t.punkt), t.punkte.length, "neuer oder entfallener Prüfpunkt im Skill: Tabelle und Workflow-Auftrag mitpflegen");
      });

      test("Red-Green gegen die echten Texte: ein entferntes Stichwort bzw. ein zusätzlicher Prüfpunkt wird gemeldet", () => {
        const wort = t.punkte[0][0];
        assert.deepEqual(fehlendeStichwoerter(skill.split(wort).join("XXX"), auftrag, t.punkte).filter((f) => f === `Skill: ${wort}`), [`Skill: ${wort}`], "Stichwort fehlt im Skill");
        assert.deepEqual(fehlendeStichwoerter(skill, auftrag.split(wort).join("XXX"), t.punkte).filter((f) => f === `Workflow: ${wort}`), [`Workflow: ${wort}`], "Stichwort fehlt im Workflow");
        const mehr = skill + (t.key === "doku" ? "\n9. neuer Prüfpunkt\n" : "\n- neuer Prüfpunkt\n");
        assert.equal(zaehlePunkte(mehr, t.punkt), t.punkte.length + 1, "ein zusätzlicher Prüfpunkt im Skill ändert die Zählung");
      });
    });
  }

  test("Abgleich greift (Red-Green): ein Stichwort, das nur in einem Text steht, fällt auf", () => {
    const skill = skillAbschnitt("**Lens 1 — Architektur.**", "**Lens 2");
    assert.ok(!skill.includes("Kryptoschwurbel"));
    assert.throws(() => skillAbschnitt("**Lens 9 — Gibt es nicht**", "**Lens 10"), /nicht gefunden/);
  });
});

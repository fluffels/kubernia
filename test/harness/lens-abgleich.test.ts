/* Lens-Struktur im Skill (#1309, #1311) – der Skill `review-lenses` ist die einzige Quelle der Prüfpunkte je Brille.
 *
 * @harness-waechter – einziger Durchsetzer seiner Regel, darum im geschützten test/harness/ (#1165).
 *
 * Die Prüfpunkte jeder Review-Brille stehen als Aufzählung im Skill `.agents/skills/review-lenses/SKILL.md`
 * (tool-neutral). Dieser Wächter verlangt vier Brillen in fester Reihenfolge, je mit Überschrift, Folgeabschnitt und
 * mindestens einem Prüfpunkt, damit eine umbenannte Überschrift oder ein leerer Abschnitt nicht still eine Brille
 * entfernt (die Orchestrierung und der Nachweis-Wächter hängen an diesen vier Brillen).
 */
import { describe, test } from "vitest";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const SKILL = readFileSync(new URL("../../.agents/skills/review-lenses/SKILL.md", import.meta.url), "utf8").replace(/\r\n/g, "\n");

/** Je Brille: Skill-Überschrift, Folgeabschnitt und Zeilenform der Prüfpunkte. */
const BRILLEN: { key: string; kopf: string; ende: string; punkt: RegExp }[] = [
  { key: "architektur", kopf: "**Lens 1 — Architektur.**", ende: "**Lens 2", punkt: /^- / },
  { key: "requirement-treue", kopf: "**Lens 2 — Requirement-Treue.**", ende: "**Lens 3", punkt: /^- / },
  { key: "test-adaequanz", kopf: "**Lens 3 — Test-Adäquanz.**", ende: "**Lens 4", punkt: /^- / },
  { key: "doku", kopf: "**Lens 4 — Doku**", ende: "## Findings-Format", punkt: /^\d+\. / },
];

/** Der Abschnitt einer Brille im Skill; wirft laut, wenn die Anker fehlen (kein stilles Leer-Grün). */
function abschnitt(skill: string, kopf: string, ende: string): string {
  const von = skill.indexOf(kopf);
  const bis = skill.indexOf(ende, von + kopf.length);
  if (von === -1 || bis === -1) throw new Error(`Skill-Abschnitt „${kopf}“ bis „${ende}“ nicht gefunden: Überschrift umbenannt? Dann BRILLEN mitziehen.`);
  return skill.slice(von, bis);
}

/** Die Prüfpunkte eines Skill-Abschnitts. */
const skillPunkte = (abschn: string, punkt: RegExp): string[] => abschn.split("\n").filter((z) => punkt.test(z));

describe("Lens-Struktur im Skill (#1311)", () => {
  test("vier Überschriften im Skill, in der Reihenfolge der Brillen", () => {
    const ueberschriften = SKILL.split("\n").filter((z) => /^\*\*Lens \d+ — /.test(z));
    assert.equal(ueberschriften.length, BRILLEN.length, "eine fünfte Brille im Skill: BRILLEN und den Nachweis-Wächter mitziehen");
    BRILLEN.forEach((b, i) => assert.ok(ueberschriften[i].startsWith(b.kopf.replace(/\.\*\*$/, "")), b.key));
  });

  for (const b of BRILLEN) {
    test(`${b.key}: der Abschnitt nennt mindestens einen Prüfpunkt`, () => {
      assert.ok(skillPunkte(abschnitt(SKILL, b.kopf, b.ende), b.punkt).length > 0, "Brille ohne Prüfpunkte");
    });
  }

  test("Red-Green: ein leerer Abschnitt und eine fehlende Brille werden gemeldet", () => {
    const b = BRILLEN[0];
    assert.equal(skillPunkte("**Lens 1 — Architektur.** nur Prosa\n", b.punkt).length, 0, "ohne Listenzeile keine Prüfpunkte");
    assert.throws(() => abschnitt(SKILL.replace(b.kopf, "**Umbenannt**"), b.kopf, b.ende), /nicht gefunden/);
  });

  test("die Doku-Lens läuft ohne Test-Brille, die Sabotage-Probe verlangt einen sauberen Stand", () => {
    assert.match(SKILL, /Test-Adäquanz entfällt, weil es ohne Code nichts zu sabotieren gibt/);
    assert.match(SKILL, /git status --porcelain\s+# MUSS leer sein/);
  });

  test("fehlende Anker im Skill werden laut gemeldet", () => {
    assert.throws(() => abschnitt(SKILL, "**Lens 9 — Gibt es nicht**", "**Lens 10"), /nicht gefunden/);
  });
});

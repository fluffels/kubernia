/* Lens-Text-Abgleich (#1309, #1311) – Skill-Pfad und Workflow prüfen dieselben Punkte je Brille.
 *
 * @harness-waechter – einziger Durchsetzer seiner Regel, darum im geschützten test/harness/ (#1165).
 *
 * Die Prüfpunkte jeder Review-Brille haben EINE Quelle: die Aufzählung im Skill
 * `.claude/skills/review-lenses/SKILL.md` (tool-neutral, Skill-Pfad). Der Workflow trägt sie wörtlich in
 * `LENSES[key].pruefpunkte` (normalisiert: ohne `**`, Backticks, Links, Doku-Nummerierung, mit zusammengefasstem
 * Leerraum) und baut den Auftrag daraus. Dieser Wächter verlangt Gleichheit je Brille, in derselben Reihenfolge: ein Punkt
 * nur im Workflow, nur im Skill, ein geändertes Wort oder eine Umordnung wird rot.
 *
 * Der Red-Green-Beweis läuft gegen die echten Texte (Skill und Workflow-Block), nicht gegen Attrappen.
 */
import { describe, test } from "vitest";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { blockFunktion, workflowBlock } from "./workflow-block";

const SKILL = readFileSync(new URL("../../.claude/skills/review-lenses/SKILL.md", import.meta.url), "utf8").replace(/\r\n/g, "\n");
type Lens = { key: string; pruefpunkte: string[]; auftrag: string };
// Aus dem vm-Kontext kopieren: Arrays dort haben einen fremden Prototyp (strictes deepEqual wäre sonst rot).
const lensen: Lens[] = Array.from(blockFunktion<Lens[]>(workflowBlock("// ── Lens-Texte (#1309) — Anfang", "// ── Lens-Texte (#1309) — Ende").block, "LENSES")).map((l) => ({ key: l.key, pruefpunkte: [...l.pruefpunkte], auftrag: l.auftrag }));

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

/** Skill-Zeile → Workflow-Form (ohne Markdown-Zeichen, Leerraum zusammengefasst, Nummerierung entfernt). */
const normalisiere = (zeile: string, punkt: RegExp): string =>
  zeile
    .replace(punkt, "")
    .replace(/\*\*/g, "")
    .replace(/`/g, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();

/** Die normalisierten Prüfpunkte eines Skill-Abschnitts. */
const skillPunkte = (abschn: string, punkt: RegExp): string[] =>
  abschn
    .split("\n")
    .filter((z) => punkt.test(z))
    .map((z) => normalisiere(z, punkt));

describe("Lens-Texte: eine Quelle, Skill und Workflow gleich (#1311)", () => {
  test("vier Brillen im Workflow, vier Überschriften im Skill, dieselben Schlüssel in derselben Reihenfolge", () => {
    assert.deepEqual(lensen.map((l) => l.key), BRILLEN.map((b) => b.key));
    const ueberschriften = SKILL.split("\n").filter((z) => /^\*\*Lens \d+ — /.test(z));
    assert.equal(ueberschriften.length, BRILLEN.length, "eine fünfte Brille im Skill: BRILLEN und Workflow mitziehen");
  });

  for (const b of BRILLEN) {
    describe(b.key, () => {
      const abschn = abschnitt(SKILL, b.kopf, b.ende);
      const lens = lensen.find((l) => l.key === b.key);

      test("pruefpunkte sind wörtlich gleich den normalisierten Skill-Punkten", () => {
        assert.ok(lens && lens.pruefpunkte.length > 0, "Brille ohne Prüfpunkte");
        assert.deepEqual(lens.pruefpunkte, skillPunkte(abschn, b.punkt));
      });

      test("der Auftrag enthält jeden Prüfpunkt als Listenzeile, Einleitung einzeilig ohne Fragezeichen, Regel-Zeile am Ende", () => {
        const zeilen = (lens?.auftrag ?? "").split("\n");
        for (const p of lens?.pruefpunkte ?? []) assert.ok(zeilen.includes(`- ${p}`), `Prüfpunkt fehlt im Auftrag: ${p}`);
        assert.ok(zeilen[0].startsWith("Lens „"), "Einleitung zuerst");
        assert.ok(!zeilen[0].includes("?"), "die Einleitung ist kein Prüfpunkt");
        assert.equal(zeilen[1], "Prüfe:");
        assert.ok(zeilen.some((z) => z.startsWith("Dein Regel-Ausschnitt")), "Regel-Zeile fehlt");
        const listenzeilen = zeilen.filter((z) => z.startsWith("- "));
        assert.equal(listenzeilen.length, lens?.pruefpunkte.length, "keine weiteren Listenpunkte außerhalb der Quelle");
      });

      test("Red-Green gegen die echten Texte: Wortänderung, Zusatzpunkt und Umordnung werden gemeldet", () => {
        const echt = skillPunkte(abschn, b.punkt);
        const wf = lens?.pruefpunkte ?? [];
        const gleich = (a: string[], c: string[]) => JSON.stringify(a) === JSON.stringify(c);
        assert.ok(gleich(echt, wf), "Ausgangslage grün");
        // Wort im Skill geändert
        const wort = echt[0].split(" ")[1];
        const zeilen = abschn.split("\n");
        const k = zeilen.findIndex((z) => b.punkt.test(z));
        zeilen[k] = zeilen[k].replace(wort, "VERFAELSCHT");
        assert.ok(!gleich(skillPunkte(zeilen.join("\n"), b.punkt), wf), "geändertes Wort im Skill");
        // Punkt nur im Skill
        assert.ok(!gleich(skillPunkte(abschn + (b.key === "doku" ? "\n9. neuer Punkt\n" : "\n- neuer Punkt\n"), b.punkt), wf), "Punkt nur im Skill");
        // Punkt nur im Workflow
        assert.ok(!gleich(echt, [...wf, "neuer Punkt"]), "Punkt nur im Workflow");
        // Umordnung
        assert.ok(!gleich(echt, [...wf].reverse()), "Umordnung");
      });
    });
  }

  test("der gebaute Auftrag trägt den Hinweis (Sabotage-Regel der Test-Lens, Doku-Lens ohne Test-Brille)", () => {
    const auftrag = (key: string) => lensen.find((l) => l.key === key)?.auftrag ?? "";
    assert.match(auftrag("test-adaequanz"), /NICHT wegoptimiert/);
    assert.match(auftrag("test-adaequanz"), /leeren git status --porcelain/);
    assert.match(auftrag("doku"), /Test-Brille entfällt/);
  });

  test("fehlende Anker im Skill werden laut gemeldet", () => {
    assert.throws(() => abschnitt(SKILL, "**Lens 9 — Gibt es nicht**", "**Lens 10"), /nicht gefunden/);
  });
});

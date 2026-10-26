/* Textreste entfernter Pfade, die an der Projekthistorie hängen (#1906, Fortsetzung von entfernte-pfade.test.ts).
 *
 * @harness-waechter – Projekt-Test (bleibt im Projekt, zieht nicht ins Factory-Repo): die Muster leiten sich aus dem echten Repo-Namen
 * und dem Ticket-Skill-Namen der Projekt-Config ab, weil nur dieses Projekt einen Skill `<Repo-Name>-workflow`, ein Workflow-Skript
 * `<Repo-Name>-ticket` und das Skill-Verzeichnis `skills/<Ticket-Skill>/` hatte. Scan und Schnappschuss-Blöcke: `test/support/entfernte-pfade.ts`.
 *
 * Fundstellen der Muster (ADRs sind historisch und tragen die alten Namen, sie sind vom Scan ausgenommen):
 *  - `<Repo-Name>-workflow`: ADR 0012 (Tabellenzeile zum entfernten Skill) und ADR 0022;
 *  - `<Repo-Name>-ticket`: ADR 0022 (das Workflow-Skript `<Repo-Name>-ticket.js`);
 *  - `skills/<Ticket-Skill>/`: keine Fundstelle in `docs/adr/` (`git log -S` auf den Pfad findet dort nichts); die Regel ist nur synthetisch getestet.
 */
import assert from "node:assert/strict";
import { describe, test } from "vitest";
import { type Rest, findeReste as findeResteMit, getrackteTextdateien, meldungMitFix } from "../support/entfernte-pfade";
import { projektConfig, repoName } from "../support/fremd-config";
import { escapeRe as esc } from "../support/regex";

// Die Namen kommen aus der echten Projekt-Config, nicht aus Literalen: der Scan liest die echten Repo-Dateien.
const C = projektConfig();
const R = repoName(C);
const NAME_WORKFLOW = `Skill ${R}-workflow`;
const NAME_TICKET = `Workflow-Skript ${R}-ticket`;
const NAME_VERZEICHNIS = "altes Ticket-Skill-Verzeichnis";

const RESTE_PROJEKT: Rest[] = [
  { name: NAME_WORKFLOW, muster: new RegExp(`${esc(R)}-workflow`), fix: "den Ist-Zustand beschreiben: der Ticket-Skill ist der einzige Ablauf, oder den Satz löschen" },
  { name: NAME_TICKET, muster: new RegExp(`${esc(R)}-ticket`), fix: "den Ist-Zustand beschreiben: es gibt kein Workflow-Skript für den Ticket-Ablauf, oder den Satz löschen" },
  { name: "Vorlage des Ticket-Skills", muster: /factory-ticket\/SKILL\.md\.vorlage/, fix: "die Quelle .agents/skills/factory-ticket/SKILL.md nennen: der Export rendert sie, eine Vorlage gibt es nicht" },
  { name: NAME_VERZEICHNIS, muster: new RegExp(`skills/${esc(C.agenten.ticketSkill)}/`), fix: "das Verzeichnis .agents/skills/factory-ticket/ nennen" },
];

const findeReste = (dateien: { pfad: string; inhalt: string }[]): string[] => findeResteMit(dateien, RESTE_PROJEKT);
const reste = (pfad: string, inhalt: string): string[] => findeReste([{ pfad, inhalt }]);

describe("Textreste mit Projektnamen (#1906)", () => {
  test("das Repo ist frei von Resten außerhalb der begründeten Ausnahmen", () => {
    const dateien = getrackteTextdateien();
    assert.ok(dateien.length > 200, "Dateiliste unerwartet klein: git ls-files fehlgeschlagen?");
    const treffer = findeReste(dateien);
    assert.deepEqual(treffer, [], `${meldungMitFix(treffer, RESTE_PROJEKT)}\nTreffer: ${treffer.join(", ")}`);
  });

  test("jede Regel nennt einen konkreten Fix-Hinweis, die Meldung nur den der getroffenen", () => {
    for (const r of RESTE_PROJEKT) assert.ok(r.fix.length > 10, `Regel ${r.name} ohne Fix-Hinweis`);
    const meldung = meldungMitFix(reste("docs/x.md", `Skill ${R}-workflow`), RESTE_PROJEKT);
    assert.ok(meldung.includes(RESTE_PROJEKT[0].fix));
    assert.ok(!meldung.includes(RESTE_PROJEKT[1].fix));
  });

  test.each([
    [NAME_WORKFLOW, `Der Skill \`${R}-workflow\` startet den Lauf.`],
    [NAME_TICKET, `Workflow({ name: "${R}-ticket" })`],
    [NAME_VERZEICHNIS, `Datei .claude/skills/${C.agenten.ticketSkill}/SKILL.md`],
  ])("Negativfall: ein eingeschleuster Rest wird gefunden (%s)", (name, text) => {
    assert.deepEqual(reste("docs/beispiel.md", `vorher\n${text}\nnachher`), [`docs/beispiel.md:2: ${name}`]);
  });

  test("Negativfall: harmlose Nachbarn lösen nicht aus (Projektname mit großem T, Workflows der CI, neues Skill-Verzeichnis)", () => {
    const sauber = `Der ${R}-Ticket-Ablauf ist der Skill ${C.agenten.ticketSkill}; die CI läuft in .github/workflows/ci.yml, der Ablauf in .agents/skills/factory-ticket/SKILL.md.`;
    assert.deepEqual(reste("docs/x.md", sauber), []);
  });

  test("Ausnahmen: ADRs und der Absenz-Test dürfen die Namen tragen, andere Pfade nicht", () => {
    const text = `${R}-ticket.js und ${R}-workflow`;
    assert.deepEqual(reste("docs/adr/0028-ein-ticket-ablauf.md", text), []);
    assert.deepEqual(reste("test/harness/model-routing.test.ts", text), []);
    assert.ok(reste("docs/modul.md", text).length > 0);
  });

  test("Verankerung am echten Projekt: die abgeleiteten Muster treffen die echten Altnamen aus den ADRs (außerhalb der Ausnahme)", () => {
    // Die Muster kommen aus der Config; ein falsch abgeleiteter Name (z. B. der Owner-Präfix) bliebe mit selbstgebauten Beispielen grün.
    const adr = (nr: string): string => {
      const datei = getrackteTextdateien().find((d) => d.pfad.startsWith(`docs/adr/${nr}-`));
      assert.ok(datei, `ADR ${nr} fehlt`);
      return datei.inhalt;
    };
    const namen = (inhalt: string): string[] => reste("docs/x.md", inhalt).map((t) => t.replace(/^docs\/x\.md:\d+: /, ""));
    const aus0022 = namen(adr("0022"));
    assert.ok(aus0022.includes(NAME_WORKFLOW), "ADR 0022 trägt den alten Skill-Namen");
    assert.ok(aus0022.includes(NAME_TICKET), "ADR 0022 trägt den alten Workflow-Skript-Namen");
    assert.ok(namen(adr("0012")).includes(NAME_WORKFLOW), "ADR 0012 trägt den alten Skill-Namen");
    const rollen = [C.agenten.planer, C.agenten.umsetzer, C.agenten.lens, C.agenten.gruppe];
    assert.ok(rollen.some((n) => adr("0012").includes(`${n}.md`)), "ADR 0012 trägt alte Agenten-Dateinamen (Regel im Kern-Wächter)");
  });
});

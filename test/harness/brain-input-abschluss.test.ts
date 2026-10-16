/* Wächter für den Sitzungsabschluss (#1572 Z5, #1723): der kubernia-Skill (Schritt 5) und der Workflow-Skill rufen `brain-input`
 * IMMER auf; der Schritt entfällt nur, wenn dieser Aufruf mit unbekanntem Skill scheitert. Seit #1723 nennen AGENTS.md, beide Skills,
 * Workflow und Umsetzer auch das Feld `BEFUNDE:` und den Fortsetzungs-Pfad („mach mit <nr> weiter“), Workflow-Verhalten im letzten Block.
 *
 * @harness-waechter – einziger Durchsetzer seiner Regel, darum im geschützten test/harness/.
 *
 * Warum: „falls er in der Session verfügbar ist“ ließ den Hauptchat den Schritt am Sitzungsende überspringen, weil eine
 * spätere, kürzere Skill-Liste `brain-input` nicht mehr nannte. Eine Skill-Liste ist kein Beleg für Nichtverfügbarkeit.
 */
import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { workflowLauf } from "./workflow-lauf";

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

/** Pflichtstellen je Datei (#1723): Fehlt eine, ist das Prädikat nicht leer. Prüft nur Text, nicht Verhalten. */
const PFLICHT: Record<string, { name: string; muster: RegExp }[]> = {
  "AGENTS.md": [
    { name: "Bullet", muster: /\*\*Abschluss ohne offene Befunde\.\*\*/ },
    { name: "Fortsetzungsauftrag ohne Skill", muster: /mach mit <nr> weiter/ },
    { name: "brain-input", muster: /`brain-input`/ },
    { name: "nie als Frage", muster: /nie als Frage/ },
    { name: "nur aus Evidenz", muster: /nur aus Evidenz/ },
    { name: "gemergter PR erledigt es nicht mehr", muster: /gemergter PR/ },
  ],
  ".claude/skills/kubernia/SKILL.md": [
    { name: "BEFUNDE:-Feld", muster: /BEFUNDE:/ },
    { name: "Fortsetzungs-Pfad im Schritt 5", muster: /\*\*Sitzungsabschluss\.\*\*[^\n]*mach mit <nr> weiter[^\n]*brain-input/ },
    { name: "brain-input im Abschluss", muster: /Skill\(\{ skill: "brain-input" \}\)/ },
    { name: "Verweis auf die Regel", muster: /AGENTS\.md § Abschluss ohne offene Befunde/ },
  ],
  ".claude/skills/kubernia-workflow/SKILL.md": [
    { name: "BEFUNDE:-Feld", muster: /BEFUNDE:/ },
    { name: "brain-input", muster: /Skill\(\{ skill: "brain-input" \}\)/ },
    { name: "Verweis auf die Regel", muster: /AGENTS\.md § Abschluss ohne offene Befunde/ },
  ],
  ".claude/workflows/kubernia-ticket.js": [
    { name: "BEFUNDE:-Zeile im Cleanup", muster: /BEFUNDE:/ },
    { name: "Feld befunde im Endstand", muster: /befunde:/ },
  ],
  ".claude/agents/kubernia-umsetzer.md": [
    { name: "Formatzeile mit Ziel-Ticket oder keine", muster: /^BEFUNDE: .*→ #<nr>.*keine/m },
    { name: "Eintragspflicht vor dem Bericht", muster: /Vor dem Bericht trägst du jeden Befund selbst ein/ },
  ],
};

/** Liste der fehlenden Pflichtstellen einer Datei (leer = vollständig). */
function abschlussLuecken(pfad: string, text: string): string[] {
  return (PFLICHT[pfad] ?? []).filter((p) => !p.muster.test(text)).map((p) => `${pfad}: ${p.name}`);
}

const rohLesen = (pfad: string) => readFileSync(new URL(`../../${pfad}`, import.meta.url), "utf8");

describe("Abschluss ohne offene Befunde, auch im Fortsetzungs-Pfad (#1723)", () => {
  test.each(Object.keys(PFLICHT))("%s: alle Pflichtstellen stehen da", (pfad) => {
    expect(abschlussLuecken(pfad, rohLesen(pfad))).toEqual([]);
  });

  test("Gegenbeispiel: Fassung ohne BEFUNDE: wird rot, in Skill, Workflow-Skill, Workflow und Umsetzer", () => {
    for (const pfad of Object.keys(PFLICHT).filter((p) => p !== "AGENTS.md")) {
      const ohne = rohLesen(pfad).replace(/BEFUNDE:/g, "BEFUND-");
      expect(abschlussLuecken(pfad, ohne).length, pfad).toBeGreaterThan(0);
    }
  });

  test("Gegenbeispiel: Schritt 5 ohne Fortsetzungs-Satz, AGENTS.md ohne brain-input und ohne Evidenz-Klausel werden rot", () => {
    const skill = ".claude/skills/kubernia/SKILL.md";
    expect(abschlussLuecken(skill, rohLesen(skill).replace(/mach mit <nr> weiter/g, "weiter")).length).toBeGreaterThan(0);
    expect(abschlussLuecken("AGENTS.md", rohLesen("AGENTS.md").replace(/`brain-input`/g, "`x`")).length).toBeGreaterThan(0);
    expect(abschlussLuecken("AGENTS.md", rohLesen("AGENTS.md").replace(/nur aus Evidenz/g, "gern")).length).toBeGreaterThan(0);
    expect(abschlussLuecken("AGENTS.md", rohLesen("AGENTS.md").replace(/gemergter PR/g, "PR")).length).toBeGreaterThan(0);
  });

  test("SSOT: „nie als Frage“ steht genau einmal in AGENTS.md und in keinem Skill-, Workflow- oder Agententext", () => {
    expect(rohLesen("AGENTS.md").match(/nie als Frage/g)?.length).toBe(1);
    for (const pfad of Object.keys(PFLICHT).filter((p) => p !== "AGENTS.md")) expect(rohLesen(pfad), pfad).not.toMatch(/nie als Frage/);
  });
});

describe("Workflow-Cleanup trägt Befunde ein und meldet BEFUNDE (#1723)", () => {
  const hinweis = { lens: "architektur", verdikt: "hinweise", findings: [{ schwere: "hinweis", befund: "Altlast ohne Test", ort: "a.ts:3", begruendung: "b" }] };
  const cleanupPrompt = (aufrufe: { label: string; prompt: string }[]) => aufrufe.find((a) => a.label === "cleanup:#42")?.prompt ?? "";

  test("Feld befunde des Umsetzers landet im Endstand, ohne Feld ist es leer", async () => {
    const mit = await workflowLauf({ umsetzen: { dateien: ["src/a.ts"], extra: { befunde: ["X → #1700"] } } });
    expect(mit.endstand.befunde).toEqual(["X → #1700"]);
    const ohne = await workflowLauf();
    expect(ohne.endstand.befunde).toEqual([]);
  });

  test("ein liegen gelassener Lens-Hinweis steht im Cleanup-Prompt, samt Zeile BEFUNDE: und Prüfung am Diff", async () => {
    const { aufrufe, endstand } = await workflowLauf({ runden: [{ architektur: hinweis }] });
    const p = cleanupPrompt(aufrufe);
    expect(p).toContain("Altlast ohne Test (a.ts:3)");
    expect(p).toMatch(/am Diff zutreffen/);
    expect(p).toMatch(/BEFUNDE: <je Befund/);
    expect(endstand.hinweiseOffen).toBe(1);
  });

  test("Negativ: eine „Bekannte Grenze“ und ein blockierendes Finding landen nicht als Hinweis im Cleanup-Prompt", async () => {
    const bericht = {
      lens: "architektur",
      verdikt: "hinweise",
      findings: [
        { schwere: "hinweis", befund: "Bekannte Grenze: Umweg X", ort: "g.mjs:1", begruendung: "b" },
        { schwere: "hinweis", befund: "Altlast ohne Test", ort: "a.ts:3", begruendung: "Bekannte Grenze des Parsers" },
        { schwere: "hinweis", befund: "Echter Hinweis", ort: "b.ts:2", begruendung: "b" },
      ],
    };
    const { aufrufe, endstand } = await workflowLauf({ runden: [{ architektur: bericht }] });
    const p = cleanupPrompt(aufrufe);
    expect(p).toContain("Echter Hinweis (b.ts:2)");
    expect(p).not.toContain("Umweg X");
    expect(p).not.toContain("Altlast ohne Test");
    expect(endstand.hinweiseOffen).toBe(1);
  });

  test("Negativ: ohne Hinweise und ausserhalbScope kein Eintragsblock, nur die BEFUNDE:-Zeile", async () => {
    const p = cleanupPrompt((await workflowLauf()).aufrufe);
    expect(p).not.toMatch(/offene Hinweise gefunden/);
    expect(p).toMatch(/BEFUNDE: <je Befund/);
  });
});

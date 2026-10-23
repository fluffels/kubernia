/* Wächter für den Sitzungsabschluss (#1572 Z5, #1723): der Ticket-Skill (Schritt 5) ruft den Abschluss-Skill
 * (`skills.abschluss`) IMMER auf; der Schritt entfällt nur, wenn dieser Aufruf mit unbekanntem Skill scheitert. Seit #1723 nennen AGENTS.md, der Skill
 * und der Umsetzer auch das Feld `BEFUNDE:` und den Fortsetzungs-Pfad („mach mit <nr> weiter“).
 *
 * @harness-waechter – einziger Durchsetzer seiner Regel, darum im geschützten test/harness/.
 *
 * Warum: „falls er in der Session verfügbar ist“ ließ den Hauptchat den Schritt am Sitzungsende überspringen, weil eine
 * spätere, kürzere Skill-Liste den Abschluss-Skill nicht mehr nannte. Eine Skill-Liste ist kein Beleg für Nichtverfügbarkeit.
 */
import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { projektConfig } from "../support/fremd-config";
import { liesMitProjektwerten, TICKET_ABLAUF } from "../support/ticket-ablauf";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import { escapeRegex } from "../../scripts/ticket-namen.mjs";

/** Der Abschluss-Skill der Projekt-Config (`skills.abschluss`): kein Literal im Kern-Test. */
const SKILL = projektConfig().skills.abschluss;
const SKILL_RE = (escapeRegex as (t: string) => string)(SKILL);

const norm = (t: string) => t.replace(/\s+/g, " ");
const lies = (pfad: string) => norm(rohLesen(pfad));
/** Der Ablauf wird mit den Projektwerten gelesen (`<skills.abschluss>` ist dort der Wert aus der Config, ADR 0022 F10), ebenso die AGENTS.md, alles andere roh. */
const rohLesen = (pfad: string): string => (pfad === TICKET_ABLAUF || pfad === "AGENTS.md" ? liesMitProjektwerten(pfad) : readFileSync(new URL(`../../${pfad}`, import.meta.url), "utf8"));
const SKILLS = [".agents/skills/factory/ablauf.md"];

describe("Sitzungsabschluss ruft den Abschluss-Skill immer auf (#1572)", () => {
  test.each(SKILLS)("%s: Aufruf-Wortlaut und Satz zur Skill-Liste stehen da", (pfad) => {
    const t = lies(pfad);
    expect(t).toContain(`Skill({ skill: "${SKILL}" })`);
    expect(t).toContain("eine spätere, kürzere Skill-Liste ist kein Beleg");
  });

  test.each(SKILLS)("%s: kein Vorab-Gate „falls verfügbar“ neben dem Abschluss-Skill", (pfad) => {
    const t = lies(pfad);
    expect(t).not.toMatch(/falls er in der Session verfügbar ist/);
    expect(t).not.toMatch(new RegExp(`${SKILL_RE}[^.]{0,40}falls verfügbar`));
  });

  test("der Ticket-Skill lässt den Schritt nur bei unbekanntem Skill entfallen", () => {
    expect(lies(SKILLS[0])).toMatch(/entfällt nur, wenn dieser Aufruf mit unbekanntem Skill scheitert/);
  });
});

/** Pflichtstellen je Datei (#1723): Fehlt eine, ist das Prädikat nicht leer. Prüft nur Text, nicht Verhalten. */
const PFLICHT: Record<string, { name: string; muster: RegExp }[]> = {
  "AGENTS.md": [
    { name: "Bullet", muster: /\*\*Abschluss ohne offene Befunde\.\*\*/ },
    { name: "Fortsetzungsauftrag ohne Skill", muster: /mach mit <nr> weiter/ },
    { name: "Abschluss-Skill", muster: new RegExp(`\`${SKILL_RE}\``) },
    { name: "nie als Frage", muster: /nie als Frage/ },
    { name: "nur aus Evidenz", muster: /nur aus Evidenz/ },
    { name: "gemergter PR erledigt es nicht mehr", muster: /gemergter PR/ },
  ],
  ".agents/skills/factory/ablauf.md": [
    { name: "BEFUNDE:-Feld im Sitzungsabschluss", muster: /\*\*Sitzungsabschluss\.\*\*[^\n]*BEFUNDE:/ },
    { name: "Fortsetzungs-Pfad im Schritt 5", muster: new RegExp(`\\*\\*Sitzungsabschluss\\.\\*\\*[^\\n]*mach mit <nr> weiter[^\\n]*${SKILL_RE}`) },
    { name: "Abschluss-Skill im Abschluss", muster: new RegExp(`Skill\\(\\{ skill: "${SKILL_RE}" \\}\\)`) },
    { name: "Verweis auf die Regel", muster: /AGENTS\.md § Abschluss ohne offene Befunde/ },
  ],
  ".claude/agents/factory-umsetzer.md": [
    { name: "Formatzeile mit Ziel-Ticket oder keine", muster: /^BEFUNDE: .*→ #<nr>.*keine/m },
    { name: "Eintragspflicht vor dem Bericht", muster: /Vor dem Bericht trägst du jeden Befund selbst ein/ },
    { name: "liegen gelassene Lens-Hinweise", muster: /liegen gelassene, zutreffende Lens-Hinweise/ },
    { name: "Bekannte Grenze ist kein Befund", muster: /„Bekannte Grenze“[^.]*sind kein Befund/ },
  ],
};

/** Liste der fehlenden Pflichtstellen einer Datei (leer = vollständig). */
function abschlussLuecken(pfad: string, text: string): string[] {
  return (PFLICHT[pfad] ?? []).filter((p) => !p.muster.test(text)).map((p) => `${pfad}: ${p.name}`);
}


describe("Abschluss ohne offene Befunde, auch im Fortsetzungs-Pfad (#1723)", () => {
  test.each(Object.keys(PFLICHT))("%s: alle Pflichtstellen stehen da", (pfad) => {
    expect(abschlussLuecken(pfad, rohLesen(pfad))).toEqual([]);
  });

  test("Gegenbeispiel: Fassung ohne BEFUNDE: wird rot, in Skill und Umsetzer", () => {
    for (const pfad of Object.keys(PFLICHT).filter((p) => p !== "AGENTS.md")) {
      const ohne = rohLesen(pfad).replace(/BEFUNDE:/g, "BEFUND-");
      expect(abschlussLuecken(pfad, ohne).length, pfad).toBeGreaterThan(0);
    }
  });

  test("Gegenbeispiel: Schritt 5 ohne Fortsetzungs-Satz, AGENTS.md ohne Abschluss-Skill und ohne Evidenz-Klausel werden rot", () => {
    const skill = ".agents/skills/factory/ablauf.md";
    expect(abschlussLuecken(skill, rohLesen(skill).replace(/mach mit <nr> weiter/g, "weiter")).length).toBeGreaterThan(0);
    expect(abschlussLuecken(skill, rohLesen(skill).replace("weiter“, „weiter“) oder Ad-hoc-Auftrag", "weiter“, „weiter“)\n\n- oder Ad-hoc-Auftrag")).length).toBeGreaterThan(0);
    expect(abschlussLuecken("AGENTS.md", rohLesen("AGENTS.md").replaceAll(`\`${SKILL}\``, "`x`")).length).toBeGreaterThan(0);
    expect(abschlussLuecken("AGENTS.md", rohLesen("AGENTS.md").replace(/nur aus Evidenz/g, "gern")).length).toBeGreaterThan(0);
    expect(abschlussLuecken("AGENTS.md", rohLesen("AGENTS.md").replace(/gemergter PR/g, "PR")).length).toBeGreaterThan(0);
  });

  test("Gegenbeispiel: Umsetzer ohne Lens-Hinweis-Satz oder ohne Bekannte-Grenze-Ausnahme wird rot", () => {
    const umsetzer = ".claude/agents/factory-umsetzer.md";
    expect(abschlussLuecken(umsetzer, rohLesen(umsetzer).replace("liegen gelassene, zutreffende Lens-Hinweise", "alle Lens-Hinweise")).length).toBeGreaterThan(0);
    expect(abschlussLuecken(umsetzer, rohLesen(umsetzer).replace("„Bekannte Grenze“ (Kopfkommentar des Guards, PR-Text) sind kein Befund", "„Bekannte Grenze“ (Kopfkommentar des Guards, PR-Text) sind ein Hinweis")).length).toBeGreaterThan(0);
  });

  test("Gegenbeispiel: BEFUNDE: nur im Zwischen-Hand-off, nicht im Sitzungsabschluss, wird rot", () => {
    const skill = ".agents/skills/factory/ablauf.md";
    expect(abschlussLuecken(skill, rohLesen(skill).replace("jede `BEFUNDE:`-Zeile des Umsetzers", "jede Befund-Zeile des Umsetzers")).length).toBeGreaterThan(0);
  });

  test("SSOT: „nie als Frage“ steht genau einmal in AGENTS.md und in keinem Skill- oder Agententext", () => {
    expect(rohLesen("AGENTS.md").match(/nie als Frage/g)?.length).toBe(1);
    for (const pfad of Object.keys(PFLICHT).filter((p) => p !== "AGENTS.md")) expect(rohLesen(pfad), pfad).not.toMatch(/nie als Frage/);
  });
});

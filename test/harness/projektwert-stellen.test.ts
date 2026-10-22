/* Projektwert-Stellen-Wächter (#1821, ADR 0022 F3f): die Agenten- und Skill-Dateien tragen ihre Projektwert-Marker.
 *
 * @harness-waechter – einziger Durchsetzer dieser Marker-Liste, darum im geschützten test/harness/ (#1165).
 *
 * Fehlt ein Zeilen-Marker (Frontmatter-Name aus der Config) oder ein Block, prüft `projektwertLauf` die Stelle nicht mehr und das
 * Drift-Gate bleibt grün, obwohl der Wert von Hand gepflegt wird. Die Dateinamen folgen der Rolle (`factory-<rolle>.md`, `factory-ticket/`), die Schlüssel stehen in `.factory/projekt.json`;
 * der Wächter trägt keine Projektliterale.
 */
import { describe, expect, test } from "vitest";
import { lies } from "./repo-texte";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as rawBesitz from "../../scripts/besitz-lib.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as rawPc from "../../scripts/projekt-config-lib.mjs";

interface Stellen {
  bloecke: unknown[];
  zeilen: { schluessel: string }[];
}
const B = rawBesitz as unknown as {
  projektwertStellen: (text: string, pfad?: string) => Stellen;
  PROJEKTWERT_START: string;
};
const P = rawPc as unknown as {
  ladeProjektConfig: () => { agenten: Record<string, string> };
  PROJEKT_CONFIG: string;
};

const agentPfad = (k: string): string => `.claude/agents/factory-${k}.md`;

/** Dateien mit Frontmatter-Zeilen-Marker: Pfad -> erwarteter Schlüssel. */
const ZEILEN: [string, string][] = [
  ...["planer", "umsetzer", "lens", "gruppe"].map((k): [string, string] => [agentPfad(k), `agenten.${k}`]),
  [".claude/skills/factory-ticket/SKILL.md", "agenten.ticketSkill"],
];

/** Dateien mit Projektwert-Block (geschlossene Liste). */
const BLOECKE: string[] = [
  agentPfad("planer"),
  agentPfad("umsetzer"),
  agentPfad("lens"),
  ".agents/skills/review-lenses/SKILL.md",
  ".claude/skills/factory/ablauf.md",
];

const lf = (pfad: string): string => lies(pfad).replace(/\r\n/g, "\n");

describe("Projektwert-Stellen in Agenten und Skills", () => {
  test.each(ZEILEN)("%s trägt den Zeilen-Marker %s", (pfad, schluessel) => {
    const st = B.projektwertStellen(lf(pfad), pfad);
    expect(st.zeilen.map((z) => z.schluessel)).toContain(schluessel);
  });

  test.each(BLOECKE)("%s trägt genau einen Projektwert-Block", (pfad) => {
    expect(B.projektwertStellen(lf(pfad), pfad).bloecke).toHaveLength(1);
  });

  test("der Wächter erkennt eine fehlende Stelle (Negativfall am Text)", () => {
    const ohne = lf(agentPfad("planer"))
      .split("\n")
      .filter((z) => !z.startsWith("# factory:projektwert"))
      .join("\n");
    expect(B.projektwertStellen(ohne).zeilen).toEqual([]);
  });

  test("besitz-lib trägt denselben Config-Pfad wie projekt-config-lib", () => {
    expect(lies("scripts/besitz-lib.mjs")).toContain(`"${P.PROJEKT_CONFIG}"`);
  });
});

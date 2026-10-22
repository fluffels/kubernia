/* @harness-waechter – Fitness-Function, im geschützten test/harness/ (#1460 Z4). */
/* Forum-Skill Schritt 6 verlangt das Ticket-Format der Auswahl (#1663 L4): `## Ziel`, `## Akzeptanzkriterien` samt Negativfall.
 * Ohne diese Vorgabe legt der Agent Tickets an, die das Spezifikations-Gate überspringt. */
import { describe, test } from "vitest";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const skill = readFileSync(fileURLToPath(new URL("../../.agents/skills/forum/SKILL.md", import.meta.url)), "utf8");
const schritt6 = skill.slice(skill.indexOf("**6. "), skill.indexOf("**7. "));

describe("Forum-Skill Schritt 6: Ticket-Format (#1663 L4)", () => {
  test("Schritt 6 ist auffindbar und abgegrenzt", () => {
    assert.ok(schritt6.includes("Ticket anlegen"));
    assert.ok(schritt6.includes("node scripts/spezifikation.mjs anlegen"), "Schritt 6 legt das Ticket über das Spezifikations-Skript an");
  });
  test("verlangt `## Ziel` und `## Akzeptanzkriterien` samt Negativfall", () => {
    assert.ok(schritt6.includes("## Ziel"));
    assert.ok(schritt6.includes("## Akzeptanzkriterien"));
    assert.match(schritt6, /Negativfall/);
  });
});

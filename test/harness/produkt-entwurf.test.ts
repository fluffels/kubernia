/* Wächter der Produkt-Entwürfe (#1714, ADR 0022): die Entwürfe unter `.factory/produkt/` (LICENSE, README) beschreiben den Harness als
 * source-available mit Alle Rechte vorbehalten, ohne Spiel- und Projektbezug und ohne Dark-Factory-Behauptung.
 *
 * @harness-waechter – einziger Durchsetzer seiner Regel, darum im geschützten test/harness/ (#1165).
 *
 * Grenze: geprüft werden nur diese zwei Dateien und die Wurzel-README (Wort „source-available“); der Scope der Selbstbeschreibung und das
 * Verbot von „Open Source“ stehen in selbstbeschreibung.test.ts. */
import { describe, test } from "vitest";
import assert from "node:assert/strict";
import { lies } from "./repo-texte";

/** Das Spiel-Muster der Lizenz-Entwürfe: „Spiel“ am Wortanfang, nicht „Beispiel“. */
const SPIEL_MUSTER = /\bspiel/i;

describe("Produkt-Entwürfe (#1714)", () => {
  const lizenz = (): string => lies(".factory/produkt/LICENSE");
  const readme = (): string => lies(".factory/produkt/README.md");

  test("Lizenz-Entwurf: Alle Rechte vorbehalten, ohne Spiel- oder Projektbezug", () => {
    assert.match(lizenz(), /Alle Rechte vorbehalten/);
    assert.doesNotMatch(lizenz(), SPIEL_MUSTER);
    assert.doesNotMatch(lizenz(), /kubernia|kubequest/i);
  });

  test("Lizenz-Entwurf nimmt keine Fremdbeiträge an und untersagt den Einsatz", () => {
    assert.match(lizenz(), /Beiträge Dritter werden nicht angenommen/);
    assert.doesNotMatch(lizenz(), /Einreichen von Beiträgen als Pull Request/);
    assert.match(lizenz(), /Ausführen oder Einsetzen/);
  });

  test("Namens-Grenzfall: „Beispiel“ trifft das Spiel-Muster nicht", () => {
    assert.doesNotMatch("zum Beispiel", SPIEL_MUSTER);
    assert.match("das Spiel", SPIEL_MUSTER);
  });

  test("README-Entwurf und Wurzel-README nennen den Harness source-available", () => {
    assert.match(readme(), /source-available/);
    assert.match(lies("README.md"), /source-available/);
  });

  test("README-Entwurf trägt den Produktnamen, ohne Projektnamen und ohne Dark-Factory-Behauptung", () => {
    assert.match(readme(), /Self-Improving Agent Harness and Factory/);
    assert.doesNotMatch(readme(), /kubernia/i);
    assert.doesNotMatch(readme(), /ist eine Dark Factory/i);
  });
});

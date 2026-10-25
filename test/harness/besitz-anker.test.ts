/* Test-Hilfe `besitzAnker` (#1933): der Leerlauf-Schutz der Kern-Tests liefert verteilte Besitz-Pfade und wirft, wenn keiner passt.
 *
 * @harness-waechter – Kern-Test: Gegenstand ist das Besitz-Manifest und der Helfer, der es für Scans liest.
 */
import { describe, test } from "vitest";
import assert from "node:assert/strict";
import { besitzAnker } from "../support/besitz-anker";

const E = (pfad: string, ring = "kern") => ({ pfad, ring });

describe("besitzAnker", () => {
  test("liefert eindeutige, sortierte Pfade der verteilten Einträge, die das Prädikat erfüllen", () => {
    const eintraege = [E("b/zwei.md"), E("a/eins.md"), E("a/eins.md"), E("c/drei.txt")];
    assert.deepEqual(besitzAnker((p) => p.endsWith(".md"), eintraege), ["a/eins.md", "b/zwei.md"]);
  });

  test("Einträge des Rings oberflaeche werden nicht verteilt und zählen nicht als Anker", () => {
    const eintraege = [E("nur/factory.md", "oberflaeche"), E("verteilt.md", "kern-nach-entkopplung")];
    assert.deepEqual(besitzAnker(() => true, eintraege), ["verteilt.md"]);
  });

  test("Negativfall: passt kein Pfad, wirft der Helfer mit „Leerlauf-Schutz“", () => {
    assert.throws(() => besitzAnker((p) => p.startsWith("gibt/es/nicht"), [E("a.md")]), /Leerlauf-Schutz/);
    assert.throws(() => besitzAnker(() => true, [E("nur/factory.md", "oberflaeche")]), /Leerlauf-Schutz/);
    assert.throws(() => besitzAnker(() => true, []), /Leerlauf-Schutz/);
  });

  test("ohne Manifest-Argument liest der Helfer das echte Besitz-Manifest (nicht leer)", () => {
    assert.ok(besitzAnker(() => true).length > 0);
  });
});

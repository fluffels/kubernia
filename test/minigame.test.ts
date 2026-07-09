/* Tests für Content-as-Data (#583): Stapel-Runden als JSON.
 * Prüft sowohl die geladenen ECHTEN Daten als auch das Schema-Verhalten des
 * Parsers bei KAPUTTEN Eingaben – die Validierung muss explizit fehlschlagen
 * (werfen), nie still durchwinken.
 * Ausführen mit:  npm test
 */
import { test } from "vitest";
import assert from "node:assert/strict";
import { STACK_ROUNDS, parseStackRounds, corruptImage } from "../src/content/minigame";
import { ContentValidationError } from "../src/content/parse";

/* ---------- Echte Daten: vollständig & konsistent geladen ---------- */

test("minigame: STACK_ROUNDS lädt alle Runden mit vollständigen Feldern", () => {
  assert.ok(STACK_ROUNDS.length >= 5, `nur ${STACK_ROUNDS.length} Runden`);
  for (const r of STACK_ROUNDS) {
    assert.ok(r.name.trim().length > 0, "leerer Runden-Name");
    assert.ok(r.layers.length >= 3, `Runde „${r.name}": zu wenige Schichten`);
    assert.ok(r.cacheTip.trim().length > 0, `Runde „${r.name}": leerer cacheTip`);
  }
  assert.equal(STACK_ROUNDS[0].name, "Statische Webseite");
});

/* ---------- parseStackRounds: gültige Daten ---------- */

test("parseStackRounds: akzeptiert wohlgeformte Daten", () => {
  const ok = parseStackRounds([{ name: "X", layers: ["a", "b", "c"], cacheTip: "Tipp" }]);
  assert.equal(ok[0].name, "X");
  assert.deepEqual(ok[0].layers, ["a", "b", "c"]);
});

/* ---------- parseStackRounds: kaputte Daten MÜSSEN explizit werfen (Negativfälle) ---------- */

test("parseStackRounds: wirft bei Nicht-Array", () => {
  assert.throws(() => parseStackRounds({}), ContentValidationError);
  assert.throws(() => parseStackRounds(null), ContentValidationError);
});

test("parseStackRounds: wirft bei leerem Array", () => {
  assert.throws(() => parseStackRounds([]), ContentValidationError);
});

test("parseStackRounds: wirft bei fehlendem Pflichtfeld (mit Pfad)", () => {
  assert.throws(
    () => parseStackRounds([{ layers: ["a", "b", "c"], cacheTip: "Tipp" }]),
    (e: unknown) => e instanceof ContentValidationError && /stack-rounds\[0\]\.name/.test(e.message),
  );
});

test("parseStackRounds: wirft bei leerem layers-Array", () => {
  assert.throws(
    () => parseStackRounds([{ name: "X", layers: [], cacheTip: "Tipp" }]),
    (e: unknown) => e instanceof ContentValidationError && /stack-rounds\[0\]\.layers/.test(e.message),
  );
});

test("parseStackRounds: wirft bei leerem cacheTip", () => {
  assert.throws(
    () => parseStackRounds([{ name: "X", layers: ["a", "b", "c"], cacheTip: "   " }]),
    ContentValidationError,
  );
});

test("parseStackRounds: wirft bei unbekanntem Schlüssel (Schema-Drift-Wächter)", () => {
  assert.throws(
    () => parseStackRounds([{ name: "X", layers: ["a", "b", "c"], cacheTip: "Tipp", tippfehler: true }]),
    (e: unknown) => e instanceof ContentValidationError && /stack-rounds\[0\]\.tippfehler/.test(e.message),
  );
});

/* ---------- corruptImage: unverändert (Mechanik, kein Content) ---------- */

test("corruptImage: liefert garantiert einen anderen String", () => {
  assert.notEqual(corruptImage("nginx"), "nginx");
  assert.notEqual(corruptImage("aaaa"), "aaaa");
});

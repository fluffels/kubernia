/* Tests für Content-as-Data (#583): Ränge + Shop als JSON.
 * Prüft sowohl die geladenen ECHTEN Daten (Vollständigkeit) als auch das
 * Schema-Verhalten der Parser bei KAPUTTEN Eingaben – die Validierung muss
 * explizit fehlschlagen (werfen), nie still durchwinken.
 * Ausführen mit:  npm test
 */
import { test } from "vitest";
import assert from "node:assert/strict";
import { RANKS, SHOP, parseRanks, parseShop } from "../src/content/progression";
import { ContentValidationError } from "../src/content/parse";

/* ---------- Echte Daten: vollständig & konsistent geladen ---------- */

test("progression: RANKS lädt alle Ränge mit vollständigen Feldern", () => {
  assert.ok(RANKS.length >= 9, `nur ${RANKS.length} Ränge`);
  for (const r of RANKS) {
    assert.ok(Number.isInteger(r.xp), `Rang „${r.name}": xp keine Ganzzahl`);
    assert.ok(r.name.trim().length > 0, "leerer Rang-Name");
    assert.ok(r.icon.trim().length > 0, `Rang „${r.name}": leeres icon`);
  }
  // Stichprobe gegen versehentliche Daten-Verschiebung beim JSON-Umzug.
  assert.equal(RANKS[0].name, "Landratte");
  assert.equal(RANKS[0].xp, 0);
});

test("progression: SHOP lädt alle Einträge, color als geparste Hex-Zahl", () => {
  assert.ok(SHOP.length >= 10, `nur ${SHOP.length} Shop-Einträge`);
  const flagLila = SHOP.find((s) => s.id === "flagge-lila");
  assert.ok(flagLila, "flagge-lila fehlt");
  assert.equal(flagLila?.color, 0x9b6bdf);
  const comfort = SHOP.find((s) => s.id === "befehlshistorie");
  assert.ok(comfort, "befehlshistorie fehlt");
  assert.equal(comfort?.unlockAt, 10);
});

/* ---------- parseRanks: gültige Daten ---------- */

test("parseRanks: akzeptiert wohlgeformte Daten", () => {
  const ok = parseRanks([{ xp: 0, name: "X", icon: "🦔" }]);
  assert.equal(ok[0].xp, 0);
  assert.equal(ok[0].name, "X");
});

/* ---------- parseRanks: kaputte Daten MÜSSEN explizit werfen (Negativfälle) ---------- */

test("parseRanks: wirft bei Nicht-Array", () => {
  assert.throws(() => parseRanks({}), ContentValidationError);
  assert.throws(() => parseRanks(null), ContentValidationError);
});

test("parseRanks: wirft bei leerem Array", () => {
  assert.throws(() => parseRanks([]), ContentValidationError);
});

test("parseRanks: wirft bei fehlendem Pflichtfeld (mit Pfad)", () => {
  assert.throws(
    () => parseRanks([{ xp: 0, icon: "🦔" }]),
    (e: unknown) => e instanceof ContentValidationError && /ranks\[0\]\.name/.test(e.message),
  );
});

test("parseRanks: wirft bei xp ohne Ganzzahl", () => {
  assert.throws(
    () => parseRanks([{ xp: 1.5, name: "X", icon: "🦔" }]),
    (e: unknown) => e instanceof ContentValidationError && /ranks\[0\]\.xp/.test(e.message),
  );
});

test("parseRanks: wirft bei unbekanntem Schlüssel (Schema-Drift-Wächter)", () => {
  assert.throws(
    () => parseRanks([{ xp: 0, name: "X", icon: "🦔", tippfehler: true }]),
    (e: unknown) => e instanceof ContentValidationError && /ranks\[0\]\.tippfehler/.test(e.message),
  );
});

/* ---------- parseShop: gültige Daten ---------- */

test("parseShop: akzeptiert wohlgeformte Daten mit allen optionalen Feldern", () => {
  const ok = parseShop([{
    id: "x", icon: "🔭", name: "X", price: 10, type: "consumable", desc: "…",
    sprite: 1, tex: "tex_x", color: "#9b6bdf", unlockAt: 5,
  }]);
  assert.equal(ok[0].color, 0x9b6bdf);
  assert.equal(ok[0].sprite, 1);
  assert.equal(ok[0].unlockAt, 5);
});

test("parseShop: akzeptiert minimale Daten ohne optionale Felder", () => {
  const ok = parseShop([{ id: "x", icon: "🔭", name: "X", price: 10, type: "consumable", desc: "…" }]);
  assert.equal(ok[0].sprite, undefined);
  assert.equal(ok[0].color, undefined);
});

/* ---------- parseShop: kaputte Daten MÜSSEN explizit werfen (Negativfälle) ---------- */

test("parseShop: wirft bei Nicht-Array", () => {
  assert.throws(() => parseShop({}), ContentValidationError);
});

test("parseShop: wirft bei leerem Array", () => {
  assert.throws(() => parseShop([]), ContentValidationError);
});

test("parseShop: wirft bei fehlendem Pflichtfeld (mit Pfad)", () => {
  assert.throws(
    () => parseShop([{ icon: "🔭", name: "X", price: 10, type: "consumable", desc: "…" }]),
    (e: unknown) => e instanceof ContentValidationError && /shop\[0\]\.id/.test(e.message),
  );
});

test("parseShop: wirft bei price ohne Ganzzahl", () => {
  assert.throws(
    () => parseShop([{ id: "x", icon: "🔭", name: "X", price: 9.5, type: "consumable", desc: "…" }]),
    (e: unknown) => e instanceof ContentValidationError && /shop\[0\]\.price/.test(e.message),
  );
});

test("parseShop: wirft bei ungültigem Hex-Farbwert", () => {
  assert.throws(
    () => parseShop([{ id: "x", icon: "🔭", name: "X", price: 10, type: "flag", desc: "…", color: "9b6bdf" }]),
    (e: unknown) => e instanceof ContentValidationError && /shop\[0\]\.color/.test(e.message),
  );
  assert.throws(
    () => parseShop([{ id: "x", icon: "🔭", name: "X", price: 10, type: "flag", desc: "…", color: "#zzzzzz" }]),
    ContentValidationError,
  );
});

test("parseShop: wirft bei unbekanntem Schlüssel (Schema-Drift-Wächter)", () => {
  assert.throws(
    () => parseShop([{ id: "x", icon: "🔭", name: "X", price: 10, type: "consumable", desc: "…", tippfehler: true }]),
    (e: unknown) => e instanceof ContentValidationError && /shop\[0\]\.tippfehler/.test(e.message),
  );
});

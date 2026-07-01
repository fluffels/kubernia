/* Tests für die Scenario-Validierung des Loaders (#494): reviveScenario.
 * Bis #494 wurde ein Inline-`scenario` per `as Scenario` ungeprüft durchgereicht –
 * ein Tippfehler im Schlüssel fiel erst still im Sim-Verhalten auf. reviveScenario
 * prüft nun strukturell gegen eine geschlossene Feld-Allowlist (fail-fast, Stil der
 * Check-DSL). Diese Tests decken Happy Path UND die Negativfälle ab, gegen die die
 * Validierung existiert (unbekannter Schlüssel, falsche JSON-Art, kaputte applyEffects).
 * Ausführen mit:  npm test
 */
import { test } from "vitest";
import assert from "node:assert/strict";
import {
  reviveScenario,
  SCENARIO_FIELD_NAMES,
  APPLY_EFFECT_KEY_NAMES,
} from "../src/content/scenario";
import { ContentValidationError } from "../src/content/parse";

/* ---------- Happy Path: gültige Szenarien werden durchgereicht ---------- */

test("reviveScenario: ein leeres Szenario ist gültig (alle Felder optional)", () => {
  const sc = reviveScenario({}, "x");
  assert.deepEqual(sc, {});
});

test("reviveScenario: ein realistisch bestücktes Szenario passt strukturell", () => {
  const raw = {
    bareMetal: false,
    controlPlane: { up: true, token: null, node: "node-1" },
    nodes: [{ name: "node-1" }],
    deployments: [{ name: "web", image: "nginx", replicas: 2 }],
    services: [],
    files: { "main.tf": "resource {}", "readme.md": "" },
    applyEffects: { "deploy.yaml": { deployment: { name: "web", image: "nginx", replicas: 1 } } },
    podSecurity: "baseline",
    gitRemoteAhead: 3,
    tfBackend: null,
    ciDeploy: null,
  };
  const sc = reviveScenario(raw, "x");
  // identisch durchgereicht (nur Validierung, keine Transformation)
  assert.deepEqual(sc, raw);
});

/* ---------- Negativfälle: die Lücke, gegen die #494 existiert ---------- */

test("reviveScenario: unbekannter Top-Level-Schlüssel (Tippfehler) scheitert hart", () => {
  // genau der stille Bug vor #494: `deploymnets` wurde ignoriert, reset() füllte Default
  assert.throws(
    () => reviveScenario({ deploymnets: [] }, "x"),
    (e: unknown) => e instanceof ContentValidationError && /deploymnets/.test((e as Error).message),
  );
});

test("reviveScenario: bekanntes Feld mit falscher JSON-Art scheitert (Array erwartet)", () => {
  assert.throws(
    () => reviveScenario({ deployments: { name: "web" } }, "x"),
    (e: unknown) => e instanceof ContentValidationError && /Array erwartet/.test((e as Error).message),
  );
});

test("reviveScenario: files mit nicht-String-Inhalt scheitert", () => {
  assert.throws(
    () => reviveScenario({ files: { "main.tf": 42 } }, "x"),
    (e: unknown) => e instanceof ContentValidationError && /String erwartet/.test((e as Error).message),
  );
});

test("reviveScenario: applyEffects mit unbekanntem Effekt-Schlüssel scheitert", () => {
  assert.throws(
    () => reviveScenario({ applyEffects: { "x.yaml": { deploymnet: {} } } }, "x"),
    (e: unknown) => e instanceof ContentValidationError && /unbekannter applyEffect-Schlüssel/.test((e as Error).message),
  );
});

test("reviveScenario: applyEffects-Eintrag muss ein Objekt sein", () => {
  assert.throws(
    () => reviveScenario({ applyEffects: { "x.yaml": "nope" } }, "x"),
    (e: unknown) => e instanceof ContentValidationError,
  );
});

test("reviveScenario: nicht-nullbares Einzel-Objekt darf nicht null sein (controlPlane)", () => {
  assert.throws(
    () => reviveScenario({ controlPlane: null }, "x"),
    (e: unknown) => e instanceof ContentValidationError,
  );
});

test("reviveScenario: nullbares Feld darf null sein (tfBackend)", () => {
  assert.doesNotThrow(() => reviveScenario({ tfBackend: null }, "x"));
});

test("reviveScenario: das Szenario selbst muss ein Objekt sein (kein Array/Skalar)", () => {
  assert.throws(() => reviveScenario([], "x"), ContentValidationError);
  assert.throws(() => reviveScenario("nope", "x"), ContentValidationError);
});

/* ---------- Allowlist-Ausschnitt: die im Content real genutzten Namen ---------- */

test("reviveScenario: die Allowlisten decken die real genutzten Felder ab", () => {
  for (const k of ["deployments", "services", "nodes", "files", "applyEffects", "controlPlane", "bareMetal", "podSecurity", "tfModules", "gitConflict"]) {
    assert.ok(SCENARIO_FIELD_NAMES.includes(k), `Scenario-Feld „${k}" fehlt in der Allowlist`);
  }
  for (const k of ["deployment", "service", "role", "statefulSet", "pvc"]) {
    assert.ok(APPLY_EFFECT_KEY_NAMES.includes(k), `applyEffect-Schlüssel „${k}" fehlt in der Allowlist`);
  }
});

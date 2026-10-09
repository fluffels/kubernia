/* @harness-waechter – Fitness-Function, im geschützten test/harness/ (#1544). */
/* Deploy-Validierung (#1544): struktureller Guard für die Eigenschaften, die der Workflow
 * als tragend bezeichnet. Der Job ist nicht-blockierend, ein stilles Aufweichen fiele sonst
 * nie auf. Bewusst eine Textprüfung (ein YAML-Workflow ist im Node-Test nicht ausführbar).
 * Red-Green: Entfernen von `shell: bash`, Ergänzen von `-ignore-missing-schemas` oder
 * Entfernen von `--strict` macht den jeweiligen Test rot. */
import { describe, test } from "vitest";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const yml = readFileSync(
  fileURLToPath(new URL("../../.github/workflows/deploy-validate.yml", import.meta.url)),
  "utf8",
);
// Kommentarzeilen ausblenden, damit Erklärungen im Kopf den Guard nicht auslösen.
const code = yml
  .split("\n")
  .filter((l) => !/^\s*#/.test(l))
  .join("\n");

describe("deploy-validate.yml hält seine tragenden Eigenschaften (#1544)", () => {
  test("defaults.run.shell: bash (pipefail), sonst wäre `helm template | kubeconform -` bei helm-Fehler grün", () => {
    assert.match(code, /^defaults:\n {2}run:\n {4}shell: bash$/m);
  });

  test("kein Step überschreibt die Shell", () => {
    assert.equal(/^\s+shell:/m.test(code.replace(/^defaults:\n {2}run:\n {4}shell: bash$/m, "")), false);
  });

  test("fail-closed: kein -ignore-missing-schemas", () => {
    assert.equal(code.includes("-ignore-missing-schemas"), false);
  });

  test("nicht-blockierend ohne continue-on-error (deterministisches Signal)", () => {
    assert.equal(code.includes("continue-on-error"), false);
  });

  test("jeder helm lint läuft mit --strict", () => {
    const lints = code.split("\n").filter((l) => /^\s*helm lint\b/.test(l));
    assert.ok(lints.length >= 2, "Default- und ci-Values-Lint erwartet");
    for (const l of lints) assert.match(l, /--strict/);
  });

  test("rohe Manifeste und gerendertes Chart werden mit CRD-Schemas validiert", () => {
    const kc = code.split("\n").filter((l) => /\bkubeconform -strict\b/.test(l));
    assert.ok(kc.length >= 3, "roh, Default und ci-Values erwartet");
    assert.match(code, /CRD_SCHEMAS: https:\/\/raw\.githubusercontent\.com\/datreeio\/CRDs-catalog\/[0-9a-f]{40}\//);
  });

  test("Job-Name beginnt mit keinem Required-Kontext (Shadowing)", () => {
    assert.match(yml, /name: Deploy-Manifeste prüfen/);
  });
});

/* @harness-waechter – Fitness-Function, im geschützten test/harness/ (#1564). */
/* Deploy-Ingress: keine `rewrite-target`-Annotation in rohen Manifesten und Chart. Das Spiel liegt
 * bei `path: /`, dort ist sie wirkungslos; bei einem anderen Pfad würde sie auch `/assets/...`
 * auf `/` umbiegen. `deploy-validate` (kubeconform) sieht eine zurückkehrende Annotation nicht,
 * weil sie schema-gültig ist. Das Chart-Template muss `ingress.annotations` weiterreichen, sonst
 * gehen z.B. cert-manager-Annotationen still verloren. Die Negativtests verfälschen den echten Text. */
import { describe, test } from "vitest";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const lies = (rel: string): string =>
  readFileSync(fileURLToPath(new URL(`../../deploy/${rel}`, import.meta.url)), "utf8");

const DATEIEN = [
  "ingress.yaml",
  "ingress-tls.yaml",
  "chart/templates/ingress.yaml",
  "chart/values.yaml",
  "chart/ci/tls-values.yaml",
] as const;

/** Zeilen ohne YAML-/Template-Kommentare, die `rewrite-target` setzen. */
function rewriteZeilen(text: string): string[] {
  return text
    .split(/\r?\n/)
    .filter((z) => !z.trimStart().startsWith("#"))
    .filter((z) => z.includes("rewrite-target"));
}

/** Das Chart-Template reicht `.Values.ingress.annotations` an `metadata.annotations` durch. */
function reichtAnnotationenDurch(template: string): boolean {
  return /\{\{-\s*with\s+\.Values\.ingress\.annotations\s*\}\}[\s\S]*annotations:[\s\S]*toYaml/.test(
    template,
  );
}

describe("deploy: Ingress-Annotationen", () => {
  for (const datei of DATEIEN) {
    test(`${datei} setzt kein rewrite-target`, () => {
      assert.deepEqual(rewriteZeilen(lies(datei)), []);
    });
  }

  test("Negativ: eine zurückkehrende Annotation wird erkannt", () => {
    const kaputt = lies("ingress.yaml").replace(
      "metadata:",
      "metadata:\n  annotations:\n    nginx.ingress.kubernetes.io/rewrite-target: /",
    );
    assert.equal(rewriteZeilen(kaputt).length, 1);
  });

  test("Chart-Template reicht ingress.annotations durch", () => {
    assert.ok(reichtAnnotationenDurch(lies("chart/templates/ingress.yaml")));
  });

  test("Negativ: ein Template ohne annotations-Durchreichung wird erkannt", () => {
    const kaputt = lies("chart/templates/ingress.yaml").replace(
      ".Values.ingress.annotations",
      ".Values.ingress.annotationz",
    );
    assert.equal(reichtAnnotationenDurch(kaputt), false);
  });
});

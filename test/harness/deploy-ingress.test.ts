/* @harness-waechter – Fitness-Function, im geschützten test/harness/ (#1564). */
/* Deploy-Ingress: keine `rewrite-target`-Annotation in rohen Manifesten und Chart. Das Spiel liegt
 * bei `path: /`, dort ist sie wirkungslos; bei einem anderen Pfad würde sie auch `/assets/...`
 * auf `/` umbiegen. `deploy-validate` (kubeconform) sieht eine zurückkehrende Annotation nicht,
 * weil sie schema-gültig ist. Das Chart-Template muss `ingress.annotations` weiterreichen, sonst
 * gehen z.B. cert-manager-Annotationen still verloren. Die Negativtests verfälschen den echten Text. */
import { describe, test } from "vitest";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const lies = (rel: string): string =>
  readFileSync(fileURLToPath(new URL(`../../deploy/${rel}`, import.meta.url)), "utf8");

/** Alle YAML-Dateien unter deploy/ (neue Manifeste fallen automatisch unter die Prüfung). */
const DATEIEN: string[] = readdirSync(fileURLToPath(new URL("../../deploy", import.meta.url)), {
  recursive: true,
})
  .map((p) => String(p).replace(/\\/g, "/"))
  .filter((p) => /\.ya?ml$/.test(p))
  .sort();

/** Zeilen ohne YAML-/Template-Kommentare, die `rewrite-target` setzen. */
function rewriteZeilen(text: string): string[] {
  return text
    .split(/\r?\n/)
    .filter((z) => !z.trimStart().startsWith("#"))
    .filter((z) => z.includes("rewrite-target"));
}

/** Das Chart-Template reicht `.Values.ingress.annotations` an `metadata.annotations` durch. */
function reichtAnnotationenDurch(template: string): boolean {
  // Nur der with-Block (bis zum ersten `{{- end }}`) zählt, nicht ein toYaml z.B. im TLS-Block.
  const block = /\{\{-\s*with\s+\.Values\.ingress\.annotations\s*\}\}([\s\S]*?)\{\{-\s*end\s*\}\}/.exec(
    template,
  )?.[1];
  return block !== undefined && /annotations:/.test(block) && /toYaml\s+\./.test(block);
}

describe("deploy: Ingress-Annotationen", () => {
  test("Guard: die bekannten Dateien sind in der Liste", () => {
    assert.ok(DATEIEN.length > 0);
    for (const d of [
      "ingress.yaml",
      "ingress-tls.yaml",
      "chart/templates/ingress.yaml",
      "chart/values.yaml",
      "chart/ci/tls-values.yaml",
    ]) {
      assert.ok(DATEIEN.includes(d), d);
    }
  });

  test("Kommentarzeilen mit rewrite-target zählen nicht", () => {
    assert.deepEqual(rewriteZeilen("# nginx.ingress.kubernetes.io/rewrite-target: /"), []);
    assert.deepEqual(rewriteZeilen("  # x: rewrite-target: /"), []);
  });

  test("Negativ: toYaml nur im Annotations-Block entfernt wird erkannt", () => {
    const t = lies("chart/templates/ingress.yaml");
    const m = /(\{\{-\s*with\s+\.Values\.ingress\.annotations\s*\}\}[\s\S]*?)toYaml \./.exec(t);
    assert.ok(m, "Vorlage hat toYaml . im Block");
    const kaputt = t.replace(m[0], m[1] + "x .");
    assert.equal(reichtAnnotationenDurch(kaputt), false);
  });

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

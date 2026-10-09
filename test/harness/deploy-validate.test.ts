/* @harness-waechter – Fitness-Function, im geschützten test/harness/ (#1544, gehärtet #1549). */
/* Deploy-Validierung: struktureller Guard für die Eigenschaften, die der Workflow als tragend
 * bezeichnet. Der Job ist nicht-blockierend, ein stilles Aufweichen fiele sonst nie auf.
 * Das Workflow-YAML wird geparst (nicht per Rohtext geprüft): Kommentare zählen nicht, `if:` und
 * `continue-on-error` an Job oder Step werden erkannt. Die `run:`-Skripte werden von
 * Shell-Kommentaren befreit, Zeilenfortsetzungen zusammengeführt und an `|`, `&&`, `||`, `;`
 * getrennt. Grenze: ein `#` innerhalb von Anführungszeichen würde als Kommentar behandelt
 * (im Workflow aktuell nicht vorhanden). Die Negativtests sabotieren den echten Workflow-Text
 * und erwarten genau den jeweiligen Verstoß. */
import { describe, test } from "vitest";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";

const original = readFileSync(
  fileURLToPath(new URL("../../.github/workflows/deploy-validate.yml", import.meta.url)),
  "utf8",
);

interface Step {
  name?: string;
  run?: string;
  shell?: string;
  if?: unknown;
  "continue-on-error"?: unknown;
}
interface Job {
  name?: string;
  defaults?: unknown;
  if?: unknown;
  "continue-on-error"?: unknown;
  steps?: Step[];
}
interface Workflow {
  env?: Record<string, string>;
  defaults?: { run?: { shell?: string } };
  jobs?: Record<string, Job>;
}

/** Zerlegt ein run-Skript in einzelne Befehle (ohne Kommentare, Fortsetzungen aufgelöst). */
function befehle(run: string): string[] {
  const ohneKommentar = run
    .split("\n")
    .map((l) => l.replace(/(^|\s)#.*$/, ""))
    .join("\n")
    .replace(/\\\n/g, " ");
  return ohneKommentar
    .split(/\|\|?|&&|;|\n/)
    .map((b) => b.trim().replace(/^(do|then)\s+/, ""))
    .filter((b) => b.length > 0);
}

/** Liefert alle Verstöße gegen die tragenden Eigenschaften; leer = Workflow ist in Ordnung. */
function verstoesse(text: string): string[] {
  const v: string[] = [];
  const wf = parse(text) as Workflow;
  if (wf.defaults?.run?.shell !== "bash") v.push("defaults.run.shell ist nicht bash (pipefail)");
  if (!/^[0-9a-f]{40}$/.test((wf.env?.CRD_SCHEMAS ?? "").split("/")[5] ?? "")) {
    v.push("env.CRD_SCHEMAS nicht auf einen 40-Hex-Commit gepinnt");
  }
  const job = wf.jobs?.validate;
  if (!job) return [...v, "Job validate fehlt"];
  if (!(job.name ?? "").startsWith("Deploy-Manifeste prüfen")) v.push("Jobname beginnt nicht mit „Deploy-Manifeste prüfen“");
  if (job.defaults !== undefined) v.push("Job überschreibt defaults");
  if (job.if !== undefined) v.push("Job hat if");
  if (job["continue-on-error"] !== undefined) v.push("Job hat continue-on-error");
  let lints = 0;
  let kubeconforms = 0;
  for (const step of job.steps ?? []) {
    const n = step.name ?? "?";
    if (step.shell !== undefined) v.push(`Step „${n}“ überschreibt die Shell`);
    if (step.if !== undefined) v.push(`Step „${n}“ hat if`);
    if (step["continue-on-error"] !== undefined) v.push(`Step „${n}“ hat continue-on-error`);
    const run = step.run ?? "";
    for (const muster of [/set \+o pipefail/, /set \+e\b/, /\|\|\s*true\b/, /-ignore-missing-schemas/]) {
      if (muster.test(run.split("\n").map((l) => l.replace(/(^|\s)#.*$/, "")).join("\n"))) {
        v.push(`Step „${n}“ enthält ${muster.source}`);
      }
    }
    for (const b of befehle(run)) {
      if (/^helm lint\b/.test(b)) {
        lints++;
        if (!/\s--strict\b/.test(b)) v.push(`helm lint ohne --strict: ${b}`);
      }
      if (/^kubeconform\b/.test(b)) {
        kubeconforms++;
        if (!/\s-strict\b/.test(b)) v.push(`kubeconform ohne -strict: ${b}`);
        if (!/-schema-location default\b/.test(b)) v.push(`kubeconform ohne -schema-location default: ${b}`);
        if (!/-schema-location "\$CRD_SCHEMAS"/.test(b)) v.push(`kubeconform ohne -schema-location "$CRD_SCHEMAS": ${b}`);
      }
    }
  }
  if (lints < 2) v.push("weniger als zwei helm lint (Default und ci-Values)");
  if (kubeconforms < 3) v.push("weniger als drei kubeconform (roh, Default, ci-Values)");
  return v;
}

/** Sabotiert den echten Workflow-Text; die Ersetzung muss greifen (sonst wäre der Test vakuös). */
function sabotiere(von: string | RegExp, nach: string): string {
  const s = original.replace(von, nach);
  assert.notEqual(s, original, "Sabotage hat den Text nicht verändert");
  return s;
}

describe("deploy-validate.yml hält seine tragenden Eigenschaften (#1544, #1549)", () => {
  test("der echte Workflow hat keinen Verstoß", () => {
    assert.deepEqual(verstoesse(original), []);
  });

  test("--strict nur im Kommentar zählt nicht", () => {
    const s = sabotiere("helm lint --strict deploy/chart\n", "helm lint deploy/chart # --strict\n");
    assert.deepEqual(verstoesse(s), ["helm lint ohne --strict: helm lint deploy/chart"]);
  });

  test("set +o pipefail am Anfang eines run wird erkannt", () => {
    const s = sabotiere("        run: helm version --short", "        run: |\n          set +o pipefail\n          helm version --short");
    assert.deepEqual(verstoesse(s), ["Step „Helm-Version“ enthält set \\+o pipefail"]);
  });

  test("|| true wird erkannt", () => {
    const s = sabotiere("run: helm version --short", "run: helm version --short || true");
    assert.deepEqual(verstoesse(s), ["Step „Helm-Version“ enthält \\|\\|\\s*true\\b"]);
  });

  test("-ignore-missing-schemas wird erkannt", () => {
    const s = sabotiere("kubeconform -strict -summary -kubernetes-version \"$KUBERNETES_VERSION\" \\\n", "kubeconform -strict -ignore-missing-schemas -summary -kubernetes-version \"$KUBERNETES_VERSION\" \\\n");
    assert.deepEqual(verstoesse(s), ["Step „Rohe Manifeste validieren“ enthält -ignore-missing-schemas"]);
  });

  test("if: false am Step wird erkannt", () => {
    const s = sabotiere("      - name: Helm-Version\n", "      - name: Helm-Version\n        if: false\n");
    assert.deepEqual(verstoesse(s), ["Step „Helm-Version“ hat if"]);
  });

  test("continue-on-error am Job wird erkannt", () => {
    const s = sabotiere("    timeout-minutes: 10\n", "    timeout-minutes: 10\n    continue-on-error: true\n");
    assert.deepEqual(verstoesse(s), ["Job hat continue-on-error"]);
  });

  test("shell am Step wird erkannt", () => {
    const s = sabotiere("      - name: Helm-Version\n", "      - name: Helm-Version\n        shell: sh\n");
    assert.deepEqual(verstoesse(s), ["Step „Helm-Version“ überschreibt die Shell"]);
  });

  test("fehlendes defaults.run.shell wird erkannt", () => {
    const s = sabotiere("    shell: bash\n", "    shell: sh\n");
    assert.deepEqual(verstoesse(s), ["defaults.run.shell ist nicht bash (pipefail)"]);
  });

  test("kubeconform ohne $CRD_SCHEMAS wird erkannt (jeder Aufruf einzeln)", () => {
    const s = sabotiere(/ -schema-location "\$CRD_SCHEMAS" \\\n/, " \\\n");
    const v = verstoesse(s);
    assert.equal(v.length, 1);
    assert.match(v[0], /^kubeconform ohne -schema-location "\$CRD_SCHEMAS": kubeconform -strict /);
  });

  test("kubeconform ohne -strict wird erkannt", () => {
    const s = sabotiere("kubeconform -strict -summary -kubernetes-version \"$KUBERNETES_VERSION\" \\\n", "kubeconform -summary -kubernetes-version \"$KUBERNETES_VERSION\" \\\n");
    assert.equal(verstoesse(s).length, 1);
    assert.match(verstoesse(s)[0], /^kubeconform ohne -strict:/);
  });

  test("CRD-Katalog nicht auf einen Commit gepinnt wird erkannt", () => {
    const s = sabotiere(/CRDs-catalog\/[0-9a-f]{40}\//, "CRDs-catalog/main/");
    assert.deepEqual(verstoesse(s), ["env.CRD_SCHEMAS nicht auf einen 40-Hex-Commit gepinnt"]);
  });

  test("umbenannter Job (Shadowing eines Required-Kontexts) wird erkannt", () => {
    const s = sabotiere("name: Deploy-Manifeste prüfen", "name: verify");
    assert.deepEqual(verstoesse(s), ["Jobname beginnt nicht mit „Deploy-Manifeste prüfen“"]);
  });
});

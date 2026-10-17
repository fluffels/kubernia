/* Test des Scan-Helfers `workflowDateien` (#1762 L20a): nur versionierte Skripte unter dem Ordner, rekursiv, ohne Fremdendungen.
 *
 * @harness-waechter – einziger Durchsetzer seiner Regel, darum im geschützten test/harness/ (#1165). */
import { describe, test } from "vitest";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { WORKFLOW_ORDNER, WURZEL, lies, workflowDateien } from "./repo-texte";

/** Leerlauf-Schutz (ADR 0028: Leerlaufen ist gewollt, aber der Ordner darf nicht still ignoriert oder umbenannt sein). */
describe("Workflow-Ordner", () => {
  test.each([`${WORKFLOW_ORDNER}/probe.js`, `${WORKFLOW_ORDNER}/x/probe.mjs`])("%s ist nicht von .gitignore erfasst", (pfad) => {
    const r = spawnSync("git", ["check-ignore", "-q", pfad], { cwd: WURZEL });
    assert.equal(r.status, 1, `${pfad} wäre ignoriert (Exit ${String(r.status)}); die Wächter über workflowDateien liefen leer`);
  });

  test("WORKFLOW_ORDNER ist der Ordner aus der docs-gen-Config (harness.workflows)", () => {
    const config = JSON.parse(lies("scripts/docs-gen/config.json")) as { harness: { workflows: string } };
    assert.equal(WORKFLOW_ORDNER, config.harness.workflows);
  });
});

describe("workflowDateien", () => {
  test("liefert versionierte Skripte unter dem Ordner, auch rekursiv", () => {
    const dateien = workflowDateien("scripts");
    assert.ok(dateien.includes("scripts/check-basis.mjs"));
    assert.ok(dateien.every((f) => f.startsWith("scripts/") && /\.(js|mjs|ts)$/.test(f)));
  });

  test("lässt Dateien mit anderer Endung aus", () => {
    assert.ok(!workflowDateien("docs").some((f) => f.endsWith(".md")));
  });

  test("ein fehlender Ordner ergibt eine leere Liste", () => {
    assert.deepEqual(workflowDateien("gibt-es-nicht"), []);
  });

  test("ein Ordner mit gleichem Namenspräfix zählt nicht (kein Teilstring-Treffer)", () => {
    assert.deepEqual(workflowDateien("scripts/check-bas"), []);
  });
});

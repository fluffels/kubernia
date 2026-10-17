/* Test des Scan-Helfers `workflowDateien` (#1762 L20a): nur versionierte Skripte unter dem Ordner, rekursiv, ohne Fremdendungen. */
import { describe, test } from "vitest";
import assert from "node:assert/strict";
import { workflowDateien } from "./repo-texte";

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

/* Board-Prio der Dependabot-Inbox-Action (#712) — struktureller Guard (Fitness-Function).
 *
 * Seit #627 ist das Board-Feld `Prio` die SSOT der Reihenfolge; ein Sammel-Issue
 * OHNE gesetztes `Prio` sortiert ganz nach unten und geht unter. Die Action
 * dependabot-inbox.yml setzt darum beim Anlegen des Sammel-Issues das
 * Board-`Prio`-Feld direkt auf "Kritisch" (GraphQL: addProjectV2ItemById idempotent +
 * updateProjectV2ItemFieldValue) — analog forum-inbox.yml (#644, test/forum-board-prio.test.ts)
 * und dem alarm-red-main-Job in ci.yml (#658). Dieser Test bewacht, dass diese
 * Verdrahtung nicht still aus der Workflow-Datei verschwindet — bewusst eine
 * Struktur-/Doku-Prüfung (wie docmap/filesize), keine Verhaltensprüfung (ein
 * YAML-Workflow ist im Node-Test nicht ausführbar). Red-Green: entfernt man die
 * Verdrahtung, wird er rot.
 *
 * Ausführen mit:  npm test
 */
import { describe, test } from "vitest";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const yml = readFileSync(
  fileURLToPath(new URL("../.github/workflows/dependabot-inbox.yml", import.meta.url)),
  "utf8",
);

describe("Dependabot-Inbox-Action setzt Board-Prio (#712)", () => {
  test("liest ein PROJECT_TOKEN-Secret (GITHUB_TOKEN kann kein User-Project V2 schreiben)", () => {
    assert.match(yml, /PROJECT_TOKEN:\s*\$\{\{\s*secrets\.PROJECT_TOKEN\s*\}\}/);
  });

  test("kennt Board-, Prio-Feld- und Kritisch-Options-ID", () => {
    assert.ok(yml.includes("PVT_kwHOD8746c4Barq_"), "Projekt-Node-ID fehlt");
    assert.ok(yml.includes("PVTSSF_lAHOD8746c4Barq_zhXBLXs"), "Prio-Feld-ID fehlt");
    assert.ok(yml.includes("0663cd9e"), "Options-ID für 'Kritisch' fehlt");
  });

  test("fügt das Issue idempotent hinzu UND setzt das Feld (beide Mutationen)", () => {
    assert.ok(yml.includes("addProjectV2ItemById"), "add-to-board-Mutation fehlt");
    assert.ok(yml.includes("updateProjectV2ItemFieldValue"), "set-field-Mutation fehlt");
  });

  test("degradiert ohne Secret graceful (nur Warnung, kein harter Abbruch)", () => {
    assert.ok(
      yml.includes('if [ -z "${PROJECT_TOKEN:-}" ]'),
      "leeres Secret muss abgefangen werden",
    );
    assert.match(yml, /::warning::[^\n]*PROJECT_TOKEN/);
  });

  test("setzt die Prio am NEU angelegten Issue (Aufruf hängt an gh issue create)", () => {
    assert.ok(
      yml.includes("new_url=$(gh issue create"),
      "die create-Ausgabe muss als URL erfasst werden",
    );
    assert.ok(
      yml.includes('set_board_prio "$new_url"'),
      "set_board_prio muss mit der neuen Issue-URL aufgerufen werden",
    );
  });

  test("schließt das Sammel-Issue automatisch, wenn keine Dependabot-PRs mehr offen sind", () => {
    assert.match(yml, /if \[ "\$count" -eq 0 \]/);
    assert.ok(
      yml.includes("gh issue close"),
      "auto-close-Aufruf fehlt, wenn keine PRs mehr offen sind",
    );
  });

  test("filtert offene PRs über den Dependabot-Autor", () => {
    assert.ok(
      yml.includes('--author "app/dependabot"'),
      "Autoren-Filter fehlt oder wurde umbenannt",
    );
  });
});

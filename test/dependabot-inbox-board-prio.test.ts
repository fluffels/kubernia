/* Board-Position der Dependabot-Inbox-Action (#712/#747) — struktureller Guard (Fitness-Function).
 *
 * Seit #747 ist die Reihenfolge die manuelle Board-Position (das "nächstes Ticket" ist
 * das oberste freie Item der Board-Liste; das frühere `Prio`-Feld ist entfernt). Ein
 * Sammel-Issue, das irgendwo im Board landet, kann untergehen. Die Action
 * dependabot-inbox.yml schiebt darum das Sammel-Issue an die OBERSTE Board-Position
 * (GraphQL: addProjectV2ItemById idempotent + updateProjectV2ItemPosition ohne afterId =
 * ganz oben) — analog forum-inbox.yml (test/forum-board-prio.test.ts) und dem
 * alarm-red-main-Job in ci.yml. Dieser Test bewacht, dass diese Verdrahtung nicht still
 * aus der Workflow-Datei verschwindet — bewusst eine Struktur-/Doku-Prüfung (wie
 * docmap/filesize), keine Verhaltensprüfung (ein YAML-Workflow ist im Node-Test nicht
 * ausführbar). Red-Green: entfernt man die Verdrahtung, wird er rot.
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

describe("Dependabot-Inbox-Action schiebt Sammel-Issue an die Board-Spitze (#747)", () => {
  test("liest ein PROJECT_TOKEN-Secret (GITHUB_TOKEN kann kein User-Project V2 schreiben)", () => {
    assert.match(yml, /PROJECT_TOKEN:\s*\$\{\{\s*secrets\.PROJECT_TOKEN\s*\}\}/);
  });

  test("kennt die Board-Node-ID", () => {
    assert.ok(yml.includes("PVT_kwHOD8746c4Barq_"), "Projekt-Node-ID fehlt");
  });

  test("das entfernte Prio-Feld wird NICHT mehr beschrieben (#747)", () => {
    assert.ok(
      !yml.includes("updateProjectV2ItemFieldValue"),
      "das Prio-Feld ist seit #747 entfernt — es darf nicht mehr gesetzt werden",
    );
    assert.ok(
      !yml.includes("PVTSSF_lAHOD8746c4Barq_zhXBLXs"),
      "die Prio-Feld-ID gehört seit #747 nicht mehr in den Workflow",
    );
  });

  test("fügt das Issue idempotent hinzu UND schiebt es an die Spitze (beide Mutationen)", () => {
    assert.ok(yml.includes("addProjectV2ItemById"), "add-to-board-Mutation fehlt");
    assert.ok(
      yml.includes("updateProjectV2ItemPosition"),
      "position-to-top-Mutation fehlt",
    );
  });

  test("degradiert ohne Secret graceful (nur Warnung, kein harter Abbruch)", () => {
    assert.ok(
      yml.includes('if [ -z "${PROJECT_TOKEN:-}" ]'),
      "leeres Secret muss abgefangen werden",
    );
    assert.match(yml, /::warning::[^\n]*PROJECT_TOKEN/);
  });

  test("positioniert das NEU angelegte Issue (Aufruf hängt an gh issue create)", () => {
    assert.ok(
      yml.includes("new_url=$(gh issue create"),
      "die create-Ausgabe muss als URL erfasst werden",
    );
    assert.ok(
      yml.includes('set_board_top "$new_url"'),
      "set_board_top muss mit der neuen Issue-URL aufgerufen werden",
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

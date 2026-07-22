/* Board-Top der Forum-Action (#644/#747) — struktureller Guard (Fitness-Function).
 *
 * Die Action forum-inbox.yml fügt beim Anlegen eines neuen Inbox-Issues das Issue
 * per addProjectV2ItemById zum Board hinzu und schiebt es via updateProjectV2ItemPosition
 * an die OBERSTE Board-Position. Seit #747 lebt die Reihenfolge als Board-Position (Drag &
 * Drop). Dieser Test bewacht, dass die Board-Verdrahtung nicht still verschwindet — bewusst
 * eine Struktur-/Doku-Prüfung (wie docmap/filesize), keine Verhaltensprüfung (ein
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
  fileURLToPath(new URL("../.github/workflows/forum-inbox.yml", import.meta.url)),
  "utf8",
);

describe("Forum-Action fügt Issue zum Board hinzu (#644)", () => {
  test("liest ein PROJECT_TOKEN-Secret (GITHUB_TOKEN kann kein User-Project V2 schreiben)", () => {
    assert.match(yml, /PROJECT_TOKEN:\s*\$\{\{\s*secrets\.PROJECT_TOKEN\s*\}\}/);
  });

  test("kennt die Board-Node-ID", () => {
    assert.ok(yml.includes("PVT_kwHOD8746c4Barq_"), "Projekt-Node-ID fehlt");
  });

  test("fügt das Issue idempotent zum Board hinzu (addProjectV2ItemById)", () => {
    assert.ok(yml.includes("addProjectV2ItemById"), "add-to-board-Mutation fehlt");
  });

  test("degradiert ohne Secret graceful (nur Warnung, kein harter Abbruch)", () => {
    assert.ok(
      yml.includes('if [ -z "${PROJECT_TOKEN:-}" ]'),
      "leeres Secret muss abgefangen werden",
    );
    assert.match(yml, /::warning::[^\n]*PROJECT_TOKEN/);
  });

  test("fügt das NEU angelegte Issue zum Board hinzu (Aufruf hängt an gh issue create)", () => {
    assert.ok(
      yml.includes("new_url=$(gh issue create"),
      "die create-Ausgabe muss als URL erfasst werden",
    );
    assert.ok(
      yml.includes('set_board_top "$new_url"'),
      "set_board_top muss mit der neuen Issue-URL aufgerufen werden",
    );
  });

  test("fängt einen GraphQL-Fehler ab, statt das ganze Script per set -e abzubrechen (#950)", () => {
    // Ein gesetztes, aber zu eng skopiertes PROJECT_TOKEN lässt gh api graphql
    // fehlschlagen. Bare Zuweisungen (item_id=$(...)) reißen unter `set -euo
    // pipefail` den ganzen Step ab (genau der Bug aus #950) – die Mutation muss
    // darum explizit gegen einen Fehlschlag abgesichert sein.
    assert.ok(
      yml.includes("if ! item_id=$(GH_TOKEN="),
      "die addProjectV2ItemById-Mutation muss gegen einen Fehlschlag abgesichert sein",
    );
    assert.ok(
      yml.includes('if ! GH_TOKEN="$PROJECT_TOKEN" gh api graphql'),
      "die updateProjectV2ItemPosition-Mutation muss gegen einen Fehlschlag abgesichert sein",
    );
    // Ein GraphQL-Fehler ist ein anderer Fall als das fehlende Secret – er braucht
    // eine eigene, sichtbare Meldung statt der set -e-Rohmeldung im Log.
    assert.match(
      yml,
      /::error::[^\n]*Scope/,
      "ein GraphQL-Fehler (z.B. falscher Token-Scope) muss sichtbar als ::error:: gemeldet werden",
    );
  });
});

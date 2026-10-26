/* Hauptchat-Modell dieses Projekts (#1882): `.claude/settings.json` setzt `model` auf den Alias `sonnet`.
 *
 * @harness-waechter – einziger Durchsetzer seiner Regel, darum im geschützten test/harness/ (#1165).
 *
 * Der Schlüssel `model` ist kein Besitz (`.factory/besitz.json` führt nur `permissions`, `sandbox` und `hooks`), das Drift-Gate sieht
 * ihn nicht; der Kern-Test `model-routing` im Factory-Repo prüft nur dessen Settings. Der Hauptchat orchestriert nur und läuft per
 * Projekt-Default auf `sonnet` (docs/model-routing.md), nie auf einer festen Modell-ID.
 *
 * Ausführen mit:  npm test
 */
import { describe, test } from "vitest";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const SETTINGS = fileURLToPath(new URL("../../.claude/settings.json", import.meta.url));

/** Das Hauptchat-Modell muss genau der Alias `sonnet` sein (nie eine feste ID). */
function modellBefunde(settings: { model?: unknown }): string[] {
  return settings.model === "sonnet" ? [] : [`model=${JSON.stringify(settings.model ?? null)}`];
}

describe("Hauptchat-Modell (#1882)", () => {
  test(".claude/settings.json setzt den Hauptchat auf den Alias sonnet", () => {
    assert.deepEqual(modellBefunde(JSON.parse(readFileSync(SETTINGS, "utf8")) as { model?: unknown }), []);
  });

  test("Red-Green: nur der Alias sonnet ist grün, feste IDs, andere Aliasse und ein fehlender Schlüssel nicht", () => {
    assert.deepEqual(modellBefunde({ model: "sonnet" }), []);
    for (const m of ["opus", "claude-sonnet-5-5", "Sonnet "]) assert.deepEqual(modellBefunde({ model: m }), [`model=${JSON.stringify(m)}`], m);
    assert.deepEqual(modellBefunde({}), ["model=null"]);
  });
});

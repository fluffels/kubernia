/* Das Factory-Board von kubernia führt die Issues des Factory-Repos (Fortschreibung #1883, ADR 0022 F10).
 *
 * @harness-waechter – Projekt-Test (bleibt im Projekt): die Kern-Logik (`boards[].repo`, Filter, Negativfall) ist im Factory-Repo getestet, der Wert der
 * Config ist projektspezifisch. Ohne ihn fiele das Factory-Board still auf das Repo der Config zurück, und `naechstes-ticket --bereich agentic` wählte
 * in kubernia wieder kubernia-Items statt das fremde Board zu melden (AGENTS.md › Ticket-Auswahl im Projekt). */
import assert from "node:assert/strict";
import { describe, test } from "vitest";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as raw from "../../scripts/projekt-config-lib.mjs";

type Board = { rolle: string; repo?: string };
const lib = raw as unknown as { ladeProjektConfig(): { repo: string; boards: Board[] }; boardRepo(b: Board, c: unknown): string; gleichesRepo(a: unknown, b: unknown): boolean };

describe("Boards und Repos (#1883)", () => {
  const config = lib.ladeProjektConfig();
  const board = (rolle: string) => config.boards.find((b) => b.rolle === rolle) as Board;

  test("das Produkt-Board führt die Issues dieses Repos", () => {
    assert.ok(lib.gleichesRepo(lib.boardRepo(board("produkt"), config), config.repo));
  });
  test("das Factory-Board führt die Issues eines anderen Repos (ein eigenes `repo` ist gesetzt)", () => {
    assert.equal(typeof board("factory").repo, "string");
    assert.ok(!lib.gleichesRepo(lib.boardRepo(board("factory"), config), config.repo));
  });
});

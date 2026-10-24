/* Forum-Notfall-Marker (#1932, ADR 0022 F10, Teil 7b-4): der Titel-Marker der Art `forum` steht wörtlich im Forum-Inbox-Workflow. Dieser Test ist ein
 * `projekt-test` (das Forum ist ein Projekt-Modul, der Workflow zieht nicht in den Export); die übrigen Notfall-Marker prüft der Kern-Test `board.test.ts`.
 *
 * @harness-waechter – einziger Durchsetzer seiner Regel, darum im geschützten test/harness/ (#1165).
 *
 * Grenze: geprüft wird nur, dass der Marker der Art im Workflow als `marker="…` steht; ob der Workflow ihn zur Laufzeit setzt, prüft kein Wächter. */
import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as rawLib from "../../scripts/board-lib.mjs";

const { NOTFAELLE } = rawLib as unknown as { NOTFAELLE: { art: string; marker: string; quelle: string }[] };

describe("Forum-Notfall-Marker (#1390 Z6a, #1932)", () => {
  test("der Marker der Art forum steht als marker=\"…\" im Inbox-Workflow", () => {
    const n = NOTFAELLE.find((x) => x.art === "forum");
    expect(n, "Notfall-Art forum").toBeDefined();
    const text = readFileSync(new URL(`../../${n?.quelle ?? ""}`, import.meta.url), "utf8");
    expect(text, `${n?.marker} in ${n?.quelle}`).toContain(`marker="${n?.marker}`);
  });
});

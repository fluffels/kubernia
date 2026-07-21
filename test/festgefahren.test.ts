/* Festgefahren-Wächter (#904) — Test der reinen, exportierten Logik.
 *
 * Der Wächter ist ein GitHub-Actions-Workflow (festgefahren.yml), der via
 * `workflow_run` nach jedem failed CI-Lauf auf einem PR prüft, ob die
 * Festgefahren-Schwelle erreicht ist. Der eigentliche gh-Aufruf braucht
 * Netz + Auth — er läuft im CI-Job, NICHT hier.
 *
 * Getestet wird die reine, offline + deterministische Logik:
 *   - isStuck(n): Schwellen-Check
 *   - buildStuckComment(count, url): Kommentartext-Wächter
 *   - Konstanten MAX_FAILED_PUSHES + STUCK_LABEL
 *
 * Ausführen mit:  npm test
 */
import { describe, test } from "vitest";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// Reines Tooling-Skript ohne Declaration-File (scripts/ nicht im tsconfig).
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as festgefahren from "../scripts/check-festgefahren.mjs";

const isStuck: (n: number) => boolean = festgefahren.isStuck;
const buildStuckComment: (count: number, url: string) => string = festgefahren.buildStuckComment;
const MAX_FAILED_PUSHES: number = festgefahren.MAX_FAILED_PUSHES;
const STUCK_LABEL: string = festgefahren.STUCK_LABEL;

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

describe("Festgefahren-Wächter (#904)", () => {
  // ── Konstanten: das Protokoll stimmt mit AGENTS.md überein ──────────────

  test("MAX_FAILED_PUSHES ist 4 (1 initial + 3 Fix-Versuche = 'dreimal' aus AGENTS.md)", () => {
    assert.strictEqual(MAX_FAILED_PUSHES, 4);
  });

  test("STUCK_LABEL ist 'status:festgefahren'", () => {
    assert.strictEqual(STUCK_LABEL, "status:festgefahren");
  });

  // ── isStuck: Schwellen-Check ─────────────────────────────────────────────

  test("isStuck: unter Schwelle → false", () => {
    assert.strictEqual(isStuck(0), false);
    assert.strictEqual(isStuck(1), false);
    assert.strictEqual(isStuck(2), false);
    assert.strictEqual(isStuck(3), false); // 3 = initial + 2 Fixes: noch NICHT stuck
  });

  test("isStuck: genau Schwelle → true (= 1 initial + 3 Fix-Versuche gescheitert)", () => {
    assert.strictEqual(isStuck(4), true);
  });

  test("isStuck: über Schwelle → true", () => {
    assert.strictEqual(isStuck(5), true);
    assert.strictEqual(isStuck(10), true);
  });

  // ── buildStuckComment: Kommentartext-Wächter ─────────────────────────────

  test("buildStuckComment enthält den Auslöser-Link", () => {
    const comment = buildStuckComment(4, "https://github.com/fluffels/kubernia/actions/runs/42");
    assert.ok(
      comment.includes("https://github.com/fluffels/kubernia/actions/runs/42"),
      "Kommentar muss den RUN_URL enthalten.",
    );
  });

  test("buildStuckComment nennt die Anzahl der Fehlschläge", () => {
    const comment = buildStuckComment(5, "https://example.com/run");
    assert.ok(comment.includes("5"), "Kommentar muss die Fehlschlag-Zahl nennen.");
  });

  test("buildStuckComment nennt die Anzahl der Fix-Versuche (failedCount - 1)", () => {
    const comment = buildStuckComment(4, "https://example.com/run");
    // 4 distinct Fehlschläge = 3 Fix-Versuche nach dem Initial-Fehlschlag
    assert.ok(comment.includes("3"), "Kommentar muss die Anzahl der Fix-Versuche nennen.");
  });

  test("buildStuckComment enthält das Label 'status:festgefahren'", () => {
    const comment = buildStuckComment(4, "https://example.com/run");
    assert.ok(
      comment.includes("status:festgefahren"),
      "Kommentar muss das gesetzte Label erwähnen.",
    );
  });

  test("buildStuckComment enthält Handlungsanweisung für den Agenten", () => {
    const comment = buildStuckComment(4, "https://example.com/run");
    assert.ok(
      comment.includes("Nicht weiterfixen"),
      "Kommentar muss die Handlungsanweisung 'Nicht weiterfixen' enthalten.",
    );
  });

  test("buildStuckComment ist ein nicht-leerer String", () => {
    const comment = buildStuckComment(4, "");
    assert.ok(typeof comment === "string" && comment.length > 0);
  });

  // ── Struktur: Dateien müssen existieren ──────────────────────────────────

  test("scripts/check-festgefahren.mjs existiert", () => {
    assert.ok(
      existsSync(join(ROOT, "scripts", "check-festgefahren.mjs")),
      "scripts/check-festgefahren.mjs muss existieren.",
    );
  });

  test(".github/workflows/festgefahren.yml existiert", () => {
    assert.ok(
      existsSync(join(ROOT, ".github", "workflows", "festgefahren.yml")),
      ".github/workflows/festgefahren.yml muss existieren.",
    );
  });
});

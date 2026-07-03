/* Doku-Aktualitäts-Wächter (#610) — hält die Harness-Roadmap in
 * docs/agent-harness.md § „Roadmap / bekannte Lücken" ehrlich: eine als „offen"
 * dokumentierte Ticket-Nummer, die auf GitHub längst geschlossen ist (der reale
 * #492-Befund aus iSAQB-Runde 3), ist Drift. check:docdrift (#529) prüft nur
 * Kommandos/Links/Anker, NICHT inhaltliche Aktualität.
 *
 * Der eigentliche gh-Abgleich braucht Netz + Auth und ist nicht deterministisch —
 * er läuft als eigener, non-blocking CI-Job (scripts/check-doc-tickets.mjs › main),
 * NICHT in dieser hermetischen Suite. Getestet wird hier die REINE, offline +
 * deterministische Parse-Logik `parseOpenHarnessTickets` (die testbare Wahrheit
 * hinter dem gh-Abgleich). Fitness-Function-Kategorie neben docdrift/docmap —
 * nicht mit Verhaltens-Tests vermischen.
 *
 * Ausführen mit:  npm test   (der gh-Abgleich: npm run check:doctickets)
 */
import { describe, test } from "vitest";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// Reines Node-Tooling-Skript ohne Declaration-File (scripts/ nicht im tsconfig).
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as checkDocTickets from "../scripts/check-doc-tickets.mjs";

const parseOpenHarnessTickets: (md: string) => number[] = checkDocTickets.parseOpenHarnessTickets;
const OPEN_TICKETS_START: string = checkDocTickets.OPEN_TICKETS_START;
const OPEN_TICKETS_END: string = checkDocTickets.OPEN_TICKETS_END;
const HARNESS_DOC: string = checkDocTickets.HARNESS_DOC;

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Baut ein Markdown-Fragment mit den echten Markern um `inner`. */
const withMarkers = (inner: string) => `${OPEN_TICKETS_START}\n${inner}\n${OPEN_TICKETS_END}`;

describe("Doku-Aktualitäts-Wächter (#610)", () => {
  // ── Red-Green: der Parser trifft genau die markierten Nummern ──

  test("extrahiert die #-Nummern zwischen den Markern (sortiert, dedupliziert)", () => {
    const md = withMarkers("| **#612** | x |\n| **#594** | y |\n| **#595** | z |");
    assert.deepEqual(parseOpenHarnessTickets(md), [594, 595, 612]);
  });

  test("erfasst mehrere Nummern in einer Zeile", () => {
    const md = withMarkers("| **#593 / #594 / #595** | Sammelzeile |");
    assert.deepEqual(parseOpenHarnessTickets(md), [593, 594, 595]);
  });

  test("ignoriert #-Nummern AUSSERHALB der Marker (z.B. das erledigte #492 in der Prosa)", () => {
    const md = [
      "> **#492 ist erledigt** — steht in der Prosa, zählt NICHT als offen.",
      "Auch ein Link [#530](x.md) davor zählt nicht.",
      withMarkers("| **#612** | echter offener Eintrag |"),
      "> Erledigt & raus: **#605**, **#591** — Prosa danach, zählt NICHT.",
    ].join("\n");
    assert.deepEqual(parseOpenHarnessTickets(md), [612]);
  });

  test("ignoriert #-Referenzen in der Beschreibungsspalte (nur die fett markierte Zeilen-Nummer zählt)", () => {
    // #503 steht als Referenz in der Beschreibung („ergänzt #503"), nicht fett → darf NICHT
    // als offen gelten (sonst meldet der Wächter das längst erledigte #503 als Drift).
    const md = withMarkers("| **#595** | Byte-Gate, ergänzt das Bundle-Budget #503. |");
    assert.deepEqual(parseOpenHarnessTickets(md), [595]);
  });

  test("liefert [] wenn die Marker fehlen oder verkehrt herum stehen", () => {
    assert.deepEqual(parseOpenHarnessTickets("| **#612** | ohne Marker |"), []);
    // End vor Start → kein gültiger Block
    assert.deepEqual(parseOpenHarnessTickets(`${OPEN_TICKETS_END}\n#612\n${OPEN_TICKETS_START}`), []);
  });

  test("leerer Marker-Block → keine offenen Tickets", () => {
    assert.deepEqual(parseOpenHarnessTickets(withMarkers("| Ticket | Was |\n|---|---|")), []);
  });

  // ── Gegen das echte Doc: die Marker existieren und #492 ist nicht (mehr) offen ──

  test("das echte agent-harness.md hat die Marker und listet eine nicht-leere, gültige Menge", () => {
    const md = readFileSync(join(ROOT, HARNESS_DOC), "utf8");
    const open = parseOpenHarnessTickets(md);
    assert.ok(open.length > 0, "Es sollte mindestens ein offen-markiertes Roadmap-Ticket geben.");
    // sortiert, eindeutig, positive Ganzzahlen
    assert.deepEqual(open, [...new Set(open)].sort((a, b) => a - b));
    assert.ok(
      open.every((n) => Number.isInteger(n) && n > 0),
      "Alle geparsten Werte müssen positive Ticket-Nummern sein.",
    );
    // Regressions-Lock auf den Auslöser-Befund: das erledigte #492 darf nie als offen gelten.
    assert.ok(!open.includes(492), "#492 ist erledigt und darf nicht als offen markiert sein.");
  });
});

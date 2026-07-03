/* `no-explicit-any`-Suppression-Wächter (#604) — Ratchet gegen einschleichendes `any`.
 *
 * `@typescript-eslint/no-explicit-any` blockt seit #423 als Fehler, ist aber pro Zeile
 * per `// eslint-disable-next-line`-Direktive trivial aushebelbar; nichts zählte oder
 * deckelte bislang die Zahl dieser Disables (anders als das Komplexitäts-Gate #502).
 * Dieser Test ist das Gate im `npm test`-CI; dieselbe Logik gibt es als CLI
 * `npm run check:anysuppress`.
 *
 * Die Mess-/Vergleichslogik wird aus scripts/check-any-suppressions.mjs importiert
 * (EINE Quelle der Wahrheit — kein Auseinanderdriften zwischen Test und CLI).
 *
 * Ausführen mit:  npm test   (oder gezielt: npm run check:anysuppress)
 */
import { describe, test } from "vitest";
import assert from "node:assert/strict";

// Reines Node-Tooling-Skript ohne Declaration-File (allowJs ist aus, scripts/ nicht im
// tsconfig-include) – der Laufzeit-Import genügt, die Typen deklarieren wir hier lokal.
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as checkAny from "../scripts/check-any-suppressions.mjs";

type CountMap = Record<string, number>;
type Diff = {
  increases: { file: string; count: number; allowed: number }[];
  stale: { file: string; count: number; baseline: number }[];
};

const RULE: string = checkAny.RULE;
const countAnySuppressions: (text: string) => number = checkAny.countAnySuppressions;
const collectSuppressions: (rootDir?: string) => CountMap = checkAny.collectSuppressions;
const readBaseline: (rootDir?: string) => CountMap = checkAny.readBaseline;
const diffAgainstBaseline: (current: CountMap, baseline: CountMap) => Diff = checkAny.diffAgainstBaseline;

const current = collectSuppressions();
const baseline = readBaseline();

describe("no-explicit-any-Suppression-Ratchet (#604)", () => {
  test("Ist-Stand deckt sich mit der Baseline — keine neue any-Disable", () => {
    const { increases } = diffAgainstBaseline(current, baseline);
    assert.deepEqual(
      increases,
      [],
      `Datei(en) mit mehr \`${RULE}\`-Disables als in any-suppressions.json erlaubt:\n` +
        increases.map((i) => `  ${i.file}: ${i.count} > ${i.allowed}`).join("\n") +
        `\nEchten Typ herstellen oder – mit begründetem Kommentar/Ticket-Bezug – die Baseline ` +
        `bewusst anheben (node scripts/check-any-suppressions.mjs --write).`,
    );
  });

  test("Baseline ist ehrlich: kein stale Eintrag (Datei hat weniger/keine Disables mehr)", () => {
    // Wird eine any-Brücke aufgelöst, sinkt die Ist-Zahl unter die Baseline und dieser
    // Test bricht – das erinnert daran, die Baseline nachzuziehen (Ratchet nach unten).
    const { stale } = diffAgainstBaseline(current, baseline);
    assert.deepEqual(
      stale,
      [],
      `Stale Baseline-Einträge (Datei hat weniger Disables als eingetragen) – ` +
        `Baseline nachziehen (node scripts/check-any-suppressions.mjs --write):\n` +
        stale.map((s) => `  ${s.file}: ${s.count} < ${s.baseline}`).join("\n"),
    );
  });

  test("Baseline betrifft nur Produktionscode (src/**) – kein Test/Tooling", () => {
    const nonSrc = Object.keys(baseline).filter((f) => !f.startsWith("src/"));
    assert.deepEqual(nonSrc, [], `Nicht-src-Einträge in der Baseline: ${nonSrc.join(", ")}`);
  });

  test("countAnySuppressions erkennt alle Disable-Formen, die no-explicit-any stummschalten", () => {
    assert.equal(countAnySuppressions(`// eslint-disable-next-line ${RULE}\nconst x: any = 1`), 1, "next-line explizit");
    assert.equal(countAnySuppressions(`const x: any = 1 // eslint-disable-line ${RULE}`), 1, "disable-line explizit");
    assert.equal(countAnySuppressions(`/* eslint-disable ${RULE} */`), 1, "Block explizit");
    assert.equal(countAnySuppressions(`// eslint-disable-next-line ${RULE}, prefer-const\n`), 1, "in Mehrfach-Regelliste");
    assert.equal(countAnySuppressions(`/* eslint-disable */`), 1, "bare disable = schaltet ALLES ab (Gaming-Vektor)");
    assert.equal(countAnySuppressions(`// eslint-disable-line\n`), 1, "bare disable-line");
  });

  test("countAnySuppressions ignoriert Direktiven, die no-explicit-any NICHT betreffen", () => {
    assert.equal(countAnySuppressions(`// eslint-disable-next-line prefer-const\n`), 0, "andere Regel zählt nicht");
    assert.equal(countAnySuppressions(`/* eslint-enable ${RULE} */`), 0, "enable zählt nicht");
    assert.equal(countAnySuppressions(`const s = "eslint-disable @typescript-eslint/no-explicit-any"`), 0, "String ohne Kommentar-Präfix zählt nicht");
    assert.equal(countAnySuppressions(`const x: any = 1 // TODO: entschärfen`), 0, "reiner Kommentar zählt nicht");
  });

  test("Detektion greift wirklich (Red-Green): ein erfundener Zuwachs/Rückgang wird gemeldet", () => {
    // No-op-Schutz: ein Wächter, der immer grün ist, wäre wertlos.
    const bumped = diffAgainstBaseline({ "src/foo.ts": 2 }, { "src/foo.ts": 1 });
    assert.equal(bumped.increases.length, 1, "eine zusätzliche Disable MUSS als increase rot werden");
    assert.equal(bumped.stale.length, 0);

    const fresh = diffAgainstBaseline({ "src/neu.ts": 1 }, {});
    assert.equal(fresh.increases.length, 1, "eine Disable in einer NICHT-baselineten Datei MUSS rot werden");

    const dropped = diffAgainstBaseline({}, { "src/foo.ts": 1 });
    assert.equal(dropped.stale.length, 1, "eine entfernte Disable MUSS als stale gemeldet werden (Ratchet nach unten)");

    const same = diffAgainstBaseline({ "src/foo.ts": 1 }, { "src/foo.ts": 1 });
    assert.deepEqual(same, { increases: [], stale: [] }, "deckungsgleich = grün");
  });
});

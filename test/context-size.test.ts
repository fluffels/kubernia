/* Root-Kontextdatei-Wächter (#719) – Frühwarnung gegen unbegrenzt wachsende AGENTS.md/
 * CLAUDE.md. Analog zu test/filesize.test.ts (#390), aber für die Dateien, die JEDE
 * Agenten-Session vollständig lädt statt für src/-Module.
 *
 * Die Mess-/Allowlist-Logik wird aus scripts/check-context-size.mjs importiert – EINE
 * Quelle der Wahrheit (kein Auseinanderdriften zwischen Test und CLI).
 *
 * Ausführen mit:  npm test   (oder gezielt: npm run check:contextsize)
 */
import { describe, test } from "vitest";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Reines Node-Tooling-Skript ohne Declaration-File (allowJs ist aus, scripts/ nicht im
// tsconfig-include) – der Laufzeit-Import genügt, die Typen deklarieren wir hier lokal.
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as checkContextSize from "../scripts/check-context-size.mjs";

type Budget = { file: string; budget: number };
type Sized = { file: string; chars: number; budget: number };
type Allow = { file: string; reason: string };

const CONTEXT_BUDGETS: Budget[] = checkContextSize.CONTEXT_BUDGETS;
const ALLOWLIST: Allow[] = checkContextSize.ALLOWLIST;
const collectContextSizes: (rootDir?: string, budgets?: Budget[]) => Sized[] = checkContextSize.collectContextSizes;
const findOversized: (sizes: Sized[]) => Sized[] = checkContextSize.findOversized;
// Neu mit #1064: sichtbarer Inline-Disable statt die Bulk-Baseline (Gate-Config) anzuheben,
// gleiches Muster wie test/claude-bridge.test.ts.
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
const countChars: (text: string) => number = checkContextSize.countChars;
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
const findStale: (sizes: Sized[], allowlist: Allow[]) => Allow[] = checkContextSize.findStale;

const sizes = collectContextSizes();
const allowedFiles = new Set(ALLOWLIST.map((a) => a.file));

describe("Root-Kontextdatei-Budget (#719, Zeichen seit #1064)", () => {
  test("kein Root-Kontextfile über seinem Zeichen-Budget (außer dokumentierten Ausnahmen)", () => {
    const violations = findOversized(sizes).filter((s) => !allowedFiles.has(s.file));
    assert.deepEqual(
      violations,
      [],
      `Root-Kontextdateien über Budget ohne Allowlist-Eintrag:\n` +
        violations.map((v) => `  ${v.file}: ${v.chars}/${v.budget}`).join("\n") +
        `\nInhalt auslagern (modul-lokale AGENTS.md / docs/module/*.md) oder – mit offenem Ticket – ` +
        `in scripts/check-context-size.mjs allowlisten.`,
    );
  });

  test("Allowlist ist ehrlich: jeder Eintrag liegt wirklich noch über seinem Budget (sonst stale)", () => {
    // Sobald eine Auslagerung die Datei unter ihr Budget bringt, wird der Eintrag stale
    // und dieser Test bricht – das erinnert daran, die Ausnahme wieder zu entfernen.
    const stale = findStale(sizes, ALLOWLIST);
    assert.deepEqual(
      stale,
      [],
      `Stale Allowlist-Einträge (Datei nicht mehr über Budget oder unbekannt) – aus ` +
        `scripts/check-context-size.mjs entfernen:\n` +
        stale.map((a) => `  ${a.file}`).join("\n"),
    );
  });

  test("jede konfigurierte Root-Kontextdatei existiert wirklich und wird gemessen", () => {
    for (const b of CONTEXT_BUDGETS) {
      const s = sizes.find((x) => x.file === b.file);
      assert.ok(s && s.chars > 0, `${b.file} sollte existieren und nicht leer sein`);
    }
  });

  test("Detektion greift wirklich (Red-Green): Budget 1 trifft jede Datei, Budget riesig keine", () => {
    // No-op-Schutz: ein Wächter, der immer grün ist, wäre wertlos.
    const tinyBudgets = CONTEXT_BUDGETS.map((b) => ({ ...b, budget: 1 }));
    const hugeBudgets = CONTEXT_BUDGETS.map((b) => ({ ...b, budget: 1_000_000 }));
    const tiny = findOversized(collectContextSizes(undefined, tinyBudgets)).length;
    const huge = findOversized(collectContextSizes(undefined, hugeBudgets)).length;
    assert.equal(tiny, CONTEXT_BUDGETS.length, "Budget 1 sollte für jede Datei einen Treffer liefern.");
    assert.equal(huge, 0, "Ein riesiges Budget sollte nichts melden.");
  });

  test("Zuwachs INNERHALB bestehender Zeilen schlägt an (#1061/#1064 – die Lücke der alten Zeilen-Metrik)", () => {
    // Genau der Fall, den das Zeilen-Budget nicht sah: gleiche Zeilenzahl, 5.000 Zeichen mehr.
    const dir = mkdtempSync(join(tmpdir(), "kq-contextsize-"));
    try {
      const lines = Array.from({ length: 10 }, (_, i) => `- Regel ${i}: kurz.`);
      writeFileSync(join(dir, "AGENTS.md"), lines.join("\n"));
      const [before] = collectContextSizes(dir, [{ file: "AGENTS.md", budget: 0 }]);
      const budgets = [{ file: "AGENTS.md", budget: before.chars + 1_000 }];
      assert.deepEqual(findOversized(collectContextSizes(dir, budgets)), [], "Ausgangsstand liegt im Budget.");

      lines[3] += " " + "x".repeat(5_000);
      writeFileSync(join(dir, "AGENTS.md"), lines.join("\n"));
      const grown = findOversized(collectContextSizes(dir, budgets));
      assert.equal(grown.length, 1, "5.000 Zeichen Zuwachs in einer bestehenden Zeile muss rot werden.");
      assert.equal(grown[0].chars, before.chars + 5_001);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("Grenze exakt: Budget == Zeichen ist grün, eins weniger ist rot", () => {
    const at: Sized[] = [{ file: "AGENTS.md", chars: 100, budget: 100 }];
    const over: Sized[] = [{ file: "AGENTS.md", chars: 100, budget: 99 }];
    assert.deepEqual(findOversized(at), []);
    assert.equal(findOversized(over).length, 1);
  });

  test("Stale-Erkennung (Red-Green): Eintrag für Datei im Budget oder ohne Messung ist stale, über Budget nicht", () => {
    const sized: Sized[] = [
      { file: "AGENTS.md", chars: 500, budget: 100 },
      { file: "CLAUDE.md", chars: 50, budget: 100 },
    ];
    const allow: Allow[] = [
      { file: "AGENTS.md", reason: "#1 Auslagerung offen" },
      { file: "CLAUDE.md", reason: "#2 längst erledigt" },
      { file: "GIBTS-NICHT.md", reason: "#3 Tippfehler" },
    ];
    assert.deepEqual(
      findStale(sized, allow).map((a) => a.file),
      ["CLAUDE.md", "GIBTS-NICHT.md"],
    );
  });

  test("Zählung ist zeilenenden-neutral: CRLF-Checkout (Windows/autocrlf) misst wie LF auf der CI", () => {
    const lf = ["a", "bb", "ccc"].join(String.fromCharCode(10));
    const crlf = ["a", "bb", "ccc"].join(String.fromCharCode(13, 10));
    assert.equal(countChars(crlf), countChars(lf));
    assert.equal(countChars(lf), lf.length);
  });
});

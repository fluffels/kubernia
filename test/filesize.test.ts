/* Dateigröße-Wächter (#390) – Frühwarnung gegen neue God-Files.
 *
 * Große Module sind bei großem Spielumfang teuer: Agenten lesen pro Änderung viel mehr
 * Kontext (Tokens), und je größer eine Datei, desto leichter schleichen sich
 * Regressionen ein (Befund: WorldScene.ts 1344, kubectl.ts 1220). Dieser Test ist
 * das Gate im `npm test`-CI; dieselbe Logik gibt es als CLI `npm run check:size`.
 *
 * Die Mess-/Allowlist-Logik wird aus scripts/check-size.mjs importiert (EINE Quelle
 * der Wahrheit – kein Auseinanderdriften zwischen Test und CLI).
 *
 * Ausführen mit:  npm test   (oder gezielt: npm run check:size)
 */
import { describe, test } from "vitest";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { fixture } from "./support/tmp-fixture";

// Reines Node-Tooling-Skript ohne Declaration-File (allowJs ist aus, scripts/ nicht im
// tsconfig-include) – der Laufzeit-Import genügt, die Typen deklarieren wir hier lokal.
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as checkSize from "../scripts/check-size.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as pcl from "../scripts/projekt-config-lib.mjs";

// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import { listTrackedFiles } from "../scripts/check-basis.mjs";

type Sized ={ file: string; loc: number; chars?: number };
type Allow = { datei: string; grund: string };

const LOC_BUDGET: number = checkSize.LOC_BUDGET;
const ALLOWLIST: Allow[] = (pcl as unknown as { ausnahmenAus(c: unknown): { groesse: Allow[] }; ladeProjektConfig(): unknown }).ausnahmenAus((pcl as unknown as { ladeProjektConfig(): unknown }).ladeProjektConfig()).groesse;
const collectSizes: (rootDir?: string, quelle?: string) => Sized[] = checkSize.collectSizes;
const findOversized: (sizes: Sized[], budget?: number) => Sized[] = checkSize.findOversized;
const countLines: (text: string) => number = checkSize.countLines;
type Deckel = { file: string; max: number; maxZeichen?: number; reason: string };
const deckelApi = checkSize as unknown as {
  DECKEL: Deckel[];
  collectWorkflowSizes: (rootDir?: string) => Sized[];
  pruefeDeckel: (sizes: Sized[], deckel?: Deckel[], budget?: number) => string[];
};
const { DECKEL, collectWorkflowSizes, pruefeDeckel } = deckelApi;

const sizes = collectSizes();
const allowedFiles = new Set(ALLOWLIST.map((a) => a.datei));

describe("Dateigröße-Budget (#390)", () => {
  test(`kein src-Modul über ${LOC_BUDGET} LOC (außer dokumentierten Ausnahmen)`, () => {
    const violations = findOversized(sizes, LOC_BUDGET).filter((s) => !allowedFiles.has(s.file));
    assert.deepEqual(
      violations,
      [],
      `Module über dem ${LOC_BUDGET}-LOC-Budget ohne Allowlist-Eintrag:\n` +
        violations.map((v) => `  ${v.file}: ${v.loc}`).join("\n") +
        `\nAufteilen (siehe #392/#393) oder – mit offenem Split-Ticket – unter ausnahmen.groesse in .factory/projekt.json aufnehmen.`,
    );
  });

  test("Allowlist ist ehrlich: jeder Eintrag liegt wirklich noch über Budget (sonst stale)", () => {
    // Sobald ein Split (#393/#397) eine Datei unter Budget bringt, wird der Eintrag stale
    // und dieser Test bricht – das erinnert daran, die Ausnahme wieder zu entfernen.
    const bySize = new Map(sizes.map((s) => [s.file, s.loc]));
    const stale = ALLOWLIST.filter((a) => {
      const loc = bySize.get(a.datei);
      return loc === undefined || loc <= LOC_BUDGET;
    });
    assert.deepEqual(
      stale,
      [],
      `Stale Allowlist-Einträge (Datei nicht mehr über Budget oder nicht mehr vorhanden) – ` +
        `aus ausnahmen.groesse (.factory/projekt.json) entfernen:\n` +
        stale.map((a) => `  ${a.datei}`).join("\n"),
    );
  });

  test("Detektion greift wirklich (Red-Green): mehr Budget ergibt nie mehr Treffer", () => {
    // No-op-Schutz: ein Wächter, der immer grün ist, wäre wertlos. Bei kleinem Budget
    // MÜSSEN Treffer kommen, bei unerreichbar großem KEINE – und monoton dazwischen.
    // Läuft auf einer Fixture (#1933): die Treffer hängen nicht an der Größe des Projekts, das den Test fährt.
    const wurzel = fixture({
      "lib/klein.ts": "x\n".repeat(10),
      "lib/mittel.ts": "x\n".repeat(60),
      "lib/gross.ts": "x\n".repeat(600),
    });
    const probe = collectSizes(wurzel, "lib");
    assert.equal(findOversized(probe, 50).length, 2, "Budget 50 trifft die Dateien mit 60 und 600 Zeilen.");
    assert.equal(findOversized(probe, 500).length, 1, "Budget 500 trifft nur die Datei mit 600 Zeilen.");
    assert.equal(findOversized(probe, 100000).length, 0, "Budget 100000 trifft nichts.");
    assert.equal(findOversized(sizes, 100000).length, 0, "Budget 100000 sollte in der heutigen Codebasis nichts melden.");
  });

  test("Leerlauf-Schutz: jede getrackte, existierende .ts-Datei der Quellwurzel steht in der Messung", () => {
    const quelle = pcl.strukturAus(pcl.ladeProjektConfig()).quelle;
    const wurzel = fileURLToPath(new URL("../", import.meta.url));
    const gemessen = new Set(sizes.map((s) => s.file));
    const erwartet = listTrackedFiles(wurzel).filter((f) => f.startsWith(`${quelle}/`) && f.endsWith(".ts") && existsSync(`${wurzel}${f}`));
    for (const f of erwartet) assert.ok(gemessen.has(f), `${f} fehlt in der Messung von collectSizes()`);
  });

  test("countLines zählt physische Zeilen wie wc -l", () => {
    assert.equal(countLines("a\nb\nc\n"), 3, "trailing newline darf nicht doppelt zählen");
    assert.equal(countLines("a\nb\nc"), 3, "ohne trailing newline gleich viele Zeilen");
    assert.equal(countLines(""), 0, "leere Datei = 0 Zeilen");
    assert.equal(countLines("a\r\nb\r\n"), 2, "CRLF wird wie LF gezählt");
  });
});

describe("Deckel für Workflow-Skripte (#1349)", () => {
  const WF = ".claude/workflows/fixture.js";
  const deckel: Deckel[] = [{ file: WF, max: 1000, maxZeichen: 50000, reason: "Test" }];

  test("das Repo hält seine Deckel (Ist-Zustand: keine Workflow-Skripte über dem Budget)", () => {
    const wf = collectWorkflowSizes();
    assert.deepEqual(pruefeDeckel(wf, DECKEL), []);
    assert.ok(DECKEL.every((d) => d.reason.length > 0 && typeof d.maxZeichen === "number"));
  });

  test("Wachstum über den Deckel: rot", () => {
    const m = pruefeDeckel([{ file: WF, loc: 1001 }], deckel).join(" ");
    assert.match(m, /1001 Zeilen > Deckel 1000/);
    assert.match(m, /Rebase auf origin\/main/, "Rebase-Hinweis (#1390 Z8)");
  });

  test("Schrumpfen ohne den Deckel zu senken: rot mit Zielwert (Ratchet)", () => {
    const m = pruefeDeckel([{ file: WF, loc: 950 }], deckel).join(" ");
    assert.match(m, /Deckel auf 950 senken/);
    assert.match(m, /Rebase auf origin\/main/, "Rebase-Hinweis (#1390 Z8)");
  });

  test("Meldungen ohne Deckel und stale tragen den Rebase-Hinweis nicht (#1390 Z8)", () => {
    assert.doesNotMatch(pruefeDeckel([{ file: ".claude/workflows/neu.js", loc: 801 }], []).join(" "), /Rebase/);
    assert.doesNotMatch(pruefeDeckel([], deckel).join(" "), /Rebase/);
  });

  test("genau auf dem Deckel: ok", () => {
    assert.deepEqual(pruefeDeckel([{ file: WF, loc: 1000, chars: 50000 }], deckel), []);
  });

  test("Zeichen-Deckel (#1628): +1 über maxZeichen rot, genau am Deckel und bis 500 darunter ok, 501 darunter rot", () => {
    const m = (chars: number) => pruefeDeckel([{ file: WF, loc: 1000, chars }], deckel);
    assert.match(m(50001).join(" "), /50001 Zeichen > Deckel 50000/);
    assert.deepEqual(m(50000), []);
    assert.deepEqual(m(49500), []);
    assert.match(m(49499).join(" "), /Deckel auf 49499 senken/);
  });

  test("Zeichen-Deckel: Eintrag ohne maxZeichen oder Messung ohne Zeichenzahl: rot", () => {
    assert.match(pruefeDeckel([{ file: WF, loc: 1000, chars: 5 }], [{ file: WF, max: 1000, reason: "x" }]).join(" "), /ohne maxZeichen/);
    assert.match(pruefeDeckel([{ file: WF, loc: 1000 }], deckel).join(" "), /ohne Zeichenzahl/);
  });

  test("collectWorkflowSizes liefert CR-neutrale Zeichen", async () => {
    const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const wurzel = mkdtempSync(join(tmpdir(), "size-"));
    try {
      mkdirSync(join(wurzel, ".claude", "workflows"), { recursive: true });
      writeFileSync(join(wurzel, ".claude", "workflows", "a.js"), "ab\r\ncd\r\n");
      assert.deepEqual(collectWorkflowSizes(wurzel), [{ file: ".claude/workflows/a.js", loc: 2, chars: 6 }]);
    } finally {
      rmSync(wurzel, { recursive: true, force: true });
    }
  });

  test("neue Workflow-Datei über dem Budget ohne Eintrag: rot; unter dem Budget: ok", () => {
    assert.match(pruefeDeckel([{ file: ".claude/workflows/neu.js", loc: 801 }], deckel.slice(0, 0)).join(" "), /ohne Deckel/);
    assert.deepEqual(pruefeDeckel([{ file: ".claude/workflows/neu.js", loc: 800 }], []), []);
  });

  test("Eintrag ohne Datei oder mit Datei unter Budget: stale", () => {
    assert.match(pruefeDeckel([], deckel).join(" "), /stale.*existiert nicht mehr/);
    assert.match(pruefeDeckel([{ file: WF, loc: 700 }], deckel).join(" "), /stale.*nicht mehr über 800/);
  });
});

describe("collectWorkflowSizes: Randfälle (#1349)", () => {
  test("fehlender Ordner: leere Liste; Nicht-.js-Dateien zählen nicht", async () => {
    const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const wurzel = mkdtempSync(join(tmpdir(), "size-"));
    try {
      assert.deepEqual(collectWorkflowSizes(wurzel), []);
      mkdirSync(join(wurzel, ".claude", "workflows"), { recursive: true });
      writeFileSync(join(wurzel, ".claude", "workflows", "a.js"), "x\ny\n");
      writeFileSync(join(wurzel, ".claude", "workflows", "b.md"), "x\n");
      assert.deepEqual(collectWorkflowSizes(wurzel), [{ file: ".claude/workflows/a.js", loc: 2, chars: 4 }]);
    } finally {
      rmSync(wurzel, { recursive: true, force: true });
    }
  });
});

describe("Quellwurzel aus der Config (#1843)", () => {
  test("collectSizes zählt die übergebene Quellwurzel (lib), nicht src", async () => {
    const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const wurzel = mkdtempSync(join(tmpdir(), "size-"));
    try {
      mkdirSync(join(wurzel, "lib", "sub"), { recursive: true });
      mkdirSync(join(wurzel, "src"), { recursive: true });
      writeFileSync(join(wurzel, "lib", "a.ts"), "x\ny\nz\n");
      writeFileSync(join(wurzel, "lib", "sub", "b.ts"), "x\n");
      writeFileSync(join(wurzel, "src", "c.ts"), "x\n".repeat(9));
      assert.deepEqual(collectSizes(wurzel, "lib"), [
        { file: "lib/a.ts", loc: 3 },
        { file: "lib/sub/b.ts", loc: 1 },
      ]);
      assert.deepEqual(collectSizes(wurzel, "src"), [{ file: "src/c.ts", loc: 9 }]);
    } finally {
      rmSync(wurzel, { recursive: true, force: true });
    }
  });

  test("ohne Quellwurzel gilt die der Projekt-Config (struktur.quelle), nicht ein fester Name", () => {
    assert.deepEqual(collectSizes(), collectSizes(undefined, pcl.strukturAus(pcl.ladeProjektConfig()).quelle));
  });
});

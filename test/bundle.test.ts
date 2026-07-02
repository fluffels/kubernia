/* Bundle-Größenbudget-Wächter (#503) — Byte-Budget für die ausgelieferten Artefakte.
 *
 * vite.config.ts setzt nur `chunkSizeWarningLimit` (Log-Warnung, kein Fail). Der
 * Offline-Build inlined ALLE Assets als base64 in EINE HTML und wächst bei jedem neuen
 * PixelLab-Asset unbemerkt. Dieser Wächter misst die gebauten Artefakte und wird rot
 * über Budget. Dieselbe Logik gibt es als CLI `npm run check:bundle` (Teil von
 * `npm run verify:full`, läuft NACH den Builds).
 *
 * Rein struktureller Wächter (wie filesize/diffsize/docdrift), bewusst kein
 * Verhaltens-Test. Die Klassifikations-/Bewertungs-/Mess-Logik wird aus
 * scripts/check-bundle.mjs importiert — EINE Quelle der Wahrheit (kein Drift zwischen
 * Test und CLI). Das Dateisystem wird NICHT gebraucht: `io` ist injiziert, damit der
 * Test deterministisch und OHNE echten Build läuft. Ein optionaler Zusatz-Check misst
 * die realen Artefakte nur, WENN sie zufällig vorliegen (z.B. nach einem lokalen Build).
 *
 * Ausführen mit:  npm test   (oder gezielt: npm run check:bundle nach einem Build)
 */
import { describe, test } from "vitest";
import assert from "node:assert/strict";

// Reines Node-Tooling-Skript ohne Declaration-File (allowJs aus, scripts/ nicht im
// tsconfig-include) – der Laufzeit-Import genügt, Typen lokal deklariert.
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as checkBundle from "../scripts/check-bundle.mjs";

type Budget =
  | { label: string; kind: "file"; path: string; maxBytes: number }
  | { label: string; kind: "game-chunks"; dir: string; maxBytes: number };
type Io = { exists: (p: string) => boolean; size: (p: string) => number; list: (p: string) => string[] | null };
type Measured = { label: string; maxBytes: number; bytes: number; files: string[]; missing: boolean; over: boolean };

const BUNDLE_BUDGETS: Budget[] = checkBundle.BUNDLE_BUDGETS;
const isVendorChunk: (n: string) => boolean = checkBundle.isVendorChunk;
const isGameChunk: (n: string) => boolean = checkBundle.isGameChunk;
const evaluateBudget: (bytes: number, max: number) => boolean = checkBundle.evaluateBudget;
const fmtBytes: (n: number) => string = checkBundle.fmtBytes;
const measureBudget: (b: Budget, io: Io) => Measured = checkBundle.measureBudget;
const check: (opts?: { io?: Io; budgets?: Budget[] }) => { results: Measured[]; missing: boolean; over: boolean } =
  checkBundle.checkBundle;
const defaultIo: (rootDir?: string) => Io = checkBundle.defaultIo;

// Ein Fake-Dateisystem für die injizierte io: nur die eingetragenen Dateien existieren.
const fakeIo = (files: Record<string, number>, dirs: Record<string, string[]> = {}): Io => ({
  exists: (p) => p in files,
  size: (p) => {
    if (!(p in files)) throw new Error(`size() auf nicht existierende Datei: ${p}`);
    return files[p];
  },
  list: (p) => dirs[p] ?? null,
});

describe("Bundle-Größenbudget (#503)", () => {
  test("isVendorChunk / isGameChunk: nur der vendor-Chunk ist Vendor, der Rest ist Spielcode", () => {
    assert.equal(isVendorChunk("vendor-clUN07v7.js"), true, "vendor-<hash>.js ist der Phaser-Chunk");
    assert.equal(isVendorChunk("index-Cvecvphz.js"), false, "der Entry-Chunk ist kein Vendor");
    assert.equal(isGameChunk("index-Cvecvphz.js"), true, "Entry-Chunk zählt zum Spielcode");
    assert.equal(isGameChunk("rolldown-runtime-QTnfLwEv.js"), true, "Bundler-Runtime-Glue zählt zum Spielcode");
    assert.equal(isGameChunk("vendor-clUN07v7.js"), false, "der Vendor-Chunk zählt NICHT zum Spielcode-Budget");
    assert.equal(isGameChunk("index-Cvecvphz.css"), false, "CSS ist kein JS-Chunk");
    assert.equal(isGameChunk("index-Cvecvphz.js.map"), false, "Sourcemaps zählen nicht (kein Nutzer-Payload)");
    assert.equal(isGameChunk("container-DTEZjtah.png"), false, "PNG-Assets sind kein JS-Chunk");
  });

  test("evaluateBudget: == Budget ist ok, > Budget ist über (strikt, wie check-size)", () => {
    assert.equal(evaluateBudget(1000, 1000), false, "genau am Budget = ok");
    assert.equal(evaluateBudget(1001, 1000), true, "ein Byte drüber = über");
    assert.equal(evaluateBudget(999, 1000), false, "drunter = ok");
  });

  test("fmtBytes: B / KiB / MiB werden sinnvoll gestuft", () => {
    assert.equal(fmtBytes(512), "512 B");
    assert.equal(fmtBytes(2048), "2.0 KiB");
    assert.equal(fmtBytes(2_509_465), "2.39 MiB");
  });

  test("measureBudget (file): misst die Dateigröße, erkennt Über-Budget", () => {
    const io = fakeIo({ "dist-offline/index.html": 3_000_000 });
    const b: Budget = { label: "offline", kind: "file", path: "dist-offline/index.html", maxBytes: 2_750_000 };
    const r = measureBudget(b, io);
    assert.equal(r.missing, false);
    assert.equal(r.bytes, 3_000_000);
    assert.equal(r.over, true, "3 MB > 2.75 MB Budget");
    assert.deepEqual(r.files, ["dist-offline/index.html"]);
  });

  test("measureBudget (file): fehlendes Artefakt → missing, nicht über", () => {
    const r = measureBudget(
      { label: "offline", kind: "file", path: "dist-offline/index.html", maxBytes: 2_750_000 },
      fakeIo({}),
    );
    assert.equal(r.missing, true);
    assert.equal(r.over, false, "was nicht da ist, ist nicht ‚über Budget‘");
  });

  test("measureBudget (game-chunks): summiert Nicht-Vendor-JS, ignoriert vendor/css/png", () => {
    const io = fakeIo(
      {
        "dist/assets/index-a.js": 1_000_000,
        "dist/assets/rolldown-runtime-b.js": 19_019,
        "dist/assets/vendor-c.js": 1_198_788, // darf NICHT mitgezählt werden
        "dist/assets/index-a.css": 29_485,
        "dist/assets/container.png": 9_459,
      },
      {
        "dist/assets": ["index-a.js", "rolldown-runtime-b.js", "vendor-c.js", "index-a.css", "container.png"],
      },
    );
    const b: Budget = { label: "code", kind: "game-chunks", dir: "dist/assets", maxBytes: 1_250_000 };
    const r = measureBudget(b, io);
    assert.equal(r.bytes, 1_000_000 + 19_019, "nur die zwei Nicht-Vendor-JS zählen");
    assert.equal(r.over, false, "1.019 MB liegt unter 1.25 MB Budget");
    assert.deepEqual(r.files, ["dist/assets/index-a.js", "dist/assets/rolldown-runtime-b.js"]);
  });

  test("measureBudget (game-chunks): fehlendes dist/ ODER kein JS-Chunk → missing", () => {
    const b: Budget = { label: "code", kind: "game-chunks", dir: "dist/assets", maxBytes: 1_250_000 };
    // Verzeichnis fehlt ganz.
    assert.equal(measureBudget(b, fakeIo({})).missing, true, "kein dist/assets → missing");
    // Verzeichnis da, aber nur Assets/Vendor, kein Spielcode-Chunk.
    const io = fakeIo(
      { "dist/assets/vendor-c.js": 1_000_000, "dist/assets/x.png": 100 },
      { "dist/assets": ["vendor-c.js", "x.png"] },
    );
    assert.equal(measureBudget(b, io).missing, true, "nur Vendor/PNG → kein messbarer Spielcode → missing");
  });

  test("checkBundle: unter Budget → nicht missing, nicht über", () => {
    const io = fakeIo(
      { "dist-offline/index.html": 2_500_000, "dist/assets/index-a.js": 1_100_000 },
      { "dist/assets": ["index-a.js"] },
    );
    const r = check({ io });
    assert.equal(r.missing, false);
    assert.equal(r.over, false);
    assert.equal(r.results.length, BUNDLE_BUDGETS.length);
  });

  test("checkBundle: ein Artefakt über Budget → over=true", () => {
    const io = fakeIo(
      { "dist-offline/index.html": 9_000_000, "dist/assets/index-a.js": 1_100_000 },
      { "dist/assets": ["index-a.js"] },
    );
    const r = check({ io });
    assert.equal(r.over, true, "die aufgeblähte Offline-HTML kippt das Gate");
    assert.equal(r.missing, false);
  });

  test("checkBundle: fehlende Artefakte → missing=true (Gate wird rot, nicht still grün)", () => {
    const r = check({ io: fakeIo({}) });
    assert.equal(r.missing, true, "ohne Build ist nichts zu messen → missing, nicht grün");
  });

  test("Detektion greift wirklich (Red-Green): winziges Budget trifft, riesiges nie", () => {
    // No-op-Schutz: ein Wächter, der immer grün ist, wäre wertlos.
    const files = { "dist-offline/index.html": 2_500_000, "dist/assets/index-a.js": 1_100_000 };
    const dirs = { "dist/assets": ["index-a.js"] };
    const tiny: Budget[] = [
      { label: "offline", kind: "file", path: "dist-offline/index.html", maxBytes: 1 },
      { label: "code", kind: "game-chunks", dir: "dist/assets", maxBytes: 1 },
    ];
    const huge: Budget[] = [
      { label: "offline", kind: "file", path: "dist-offline/index.html", maxBytes: 1e12 },
      { label: "code", kind: "game-chunks", dir: "dist/assets", maxBytes: 1e12 },
    ];
    assert.equal(check({ io: fakeIo(files, dirs), budgets: tiny }).over, true, "Budget 1 B MUSS treffen");
    assert.equal(check({ io: fakeIo(files, dirs), budgets: huge }).over, false, "riesiges Budget darf nie treffen");
  });

  test("BUNDLE_BUDGETS: zwei plausible, positive Budgets (offline-Datei + Spielcode-Chunks)", () => {
    assert.equal(BUNDLE_BUDGETS.length, 2);
    const kinds = BUNDLE_BUDGETS.map((b) => b.kind).sort();
    assert.deepEqual(kinds, ["file", "game-chunks"]);
    for (const b of BUNDLE_BUDGETS) {
      assert.ok(Number.isFinite(b.maxBytes) && b.maxBytes > 0, `${b.label}: maxBytes muss positiv sein`);
      // Grobe Sanity: Budgets liegen im Megabyte-Bereich (nicht versehentlich 0/KB oder GB).
      assert.ok(b.maxBytes > 500_000 && b.maxBytes < 20_000_000, `${b.label}: maxBytes plausibel im MB-Bereich`);
    }
  });

  // Optionaler Integrations-Check: NUR wenn die echten Artefakte zufällig vorliegen
  // (z.B. nach `npm run build` + `build:offline`). Ohne Build wird er übersprungen,
  // damit der schnelle `npm test`-Lauf (ohne Builds) grün bleibt.
  test("Integration: reale Artefakte liegen im Budget (übersprungen, wenn nicht gebaut)", () => {
    const io = defaultIo();
    const r = check({ io });
    if (r.missing) return; // nicht gebaut → nichts zu prüfen
    const over = r.results.filter((x) => x.over);
    assert.deepEqual(
      over.map((x) => `${x.label}: ${x.bytes} > ${x.maxBytes}`),
      [],
      "Gebaute Artefakte überschreiten ihr Budget — verkleinern oder Budget in scripts/check-bundle.mjs anheben (Ratchet).",
    );
  });
});

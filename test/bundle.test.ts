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
import { createRequire } from "node:module";

// Reines Node-Tooling-Skript ohne Declaration-File (allowJs aus, scripts/ nicht im
// tsconfig-include) – der Laufzeit-Import genügt, Typen lokal deklariert.
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as checkBundle from "../scripts/check-bundle.mjs";

type Budget =
  | { label: string; kind: "file"; path: string; maxBytes: number; subtractChunksDir?: string }
  | { label: string; kind: "game-chunks"; dir: string; maxBytes: number }
  | { label: string; kind: "vendor-chunk"; dir: string; maxBytes: number }
  | { label: string; kind: "content-chunks"; dir: string; maxBytes: number; maxBytesPerChunk: number; maxChunks: number };
type Io = {
  exists: (p: string) => boolean;
  size: (p: string) => number;
  list: (p: string) => string[] | null;
  listFiles: (p: string) => string[] | null;
};
type Measured = {
  label: string;
  maxBytes: number;
  bytes: number;
  files: string[];
  missing: boolean;
  over: boolean;
  problems?: string[];
};

const BUNDLE_BUDGETS: Budget[] = checkBundle.BUNDLE_BUDGETS;
const isVendorChunk: (n: string) => boolean = checkBundle.isVendorChunk;
const isGameChunk: (n: string) => boolean = checkBundle.isGameChunk;
const CHUNK_FILTERS: Record<string, (n: string) => boolean> = checkBundle.CHUNK_FILTERS;
const evaluateBudget: (bytes: number, max: number) => boolean = checkBundle.evaluateBudget;
const fmtBytes: (n: number) => string = checkBundle.fmtBytes;
const measureBudget: (b: Budget, io: Io) => Measured = checkBundle.measureBudget;
const check: (opts?: { io?: Io; budgets?: Budget[] }) => { results: Measured[]; missing: boolean; over: boolean } =
  checkBundle.checkBundle;
const defaultIo: (rootDir?: string) => Io = checkBundle.defaultIo;

// Quelldateien des Fake-Repos: daraus leitet das Gate die erwarteten Content-Chunks ab (content-core,
// content-quests-knut, content-maps-harbor).
const SOURCES = ["src/content/data/smalltalk.json", "src/content/data/npcs.json", "src/content/data/quests/knut.json", "assets/maps/harbor.tmj"];
const CONTENT_DIR = "dist/assets/content";
const CONTENT_FILES = ["content-core.aaa.js", "content-quests-knut.bbb.js", "content-maps-harbor.ccc.js"];

// Ein Fake-Dateisystem für die injizierte io: nur die eingetragenen Dateien existieren.
const fakeIo = (files: Record<string, number>, dirs: Record<string, string[]> = {}): Io => ({
  listFiles: (p) => {
    const hit = SOURCES.filter((s) => s.startsWith(`${p}/`));
    return hit.length ? hit : null;
  },
  exists: (p) => p in files,
  size: (p) => {
    if (!(p in files)) throw new Error(`size() auf nicht existierende Datei: ${p}`);
    return files[p];
  },
  list: (p) => dirs[p] ?? null,
});

// Ein gesundes Build: drei Content-Chunks (je 10 KB), Spielcode, Vendor, Offline-HTML (inkl. Content).
const healthyBuild = (over: { offline?: number; game?: number; vendor?: number; content?: Record<string, number> } = {}) => {
  const files: Record<string, number> = {
    "dist-offline/index.html": over.offline ?? 2_500_000,
    "dist/assets/index-a.js": over.game ?? 400_000,
    "dist/assets/vendor-c.js": over.vendor ?? 1_150_000,
  };
  const contentFiles = Object.keys(over.content ?? {}).length ? Object.keys(over.content ?? {}) : CONTENT_FILES;
  for (const f of contentFiles) files[`${CONTENT_DIR}/${f}`] = over.content?.[f] ?? 10_000;
  return fakeIo(files, { "dist/assets": ["index-a.js", "vendor-c.js", "content"], [CONTENT_DIR]: contentFiles });
};
const { expectedContentChunks } = createRequire(import.meta.url)("../scripts/content-chunks.cjs") as {
  expectedContentChunks: (io: { listFiles: (rel: string) => string[] | null }) => string[];
};
type ContentBudget = Extract<Budget, { kind: "content-chunks" }>;
const contentBudget = (): ContentBudget =>
  BUNDLE_BUDGETS.find((b): b is ContentBudget => b.kind === "content-chunks")!;

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

  test("measureBudget (vendor-chunk): summiert NUR den Phaser-vendor, ignoriert Spielcode/css/png (#595)", () => {
    const io = fakeIo(
      {
        "dist/assets/index-a.js": 1_000_000, // Spielcode – darf NICHT mitgezählt werden
        "dist/assets/rolldown-runtime-b.js": 19_019, // Glue – darf NICHT mitgezählt werden
        "dist/assets/vendor-c.js": 1_198_788, // NUR das zählt
        "dist/assets/index-a.css": 29_485,
        "dist/assets/container.png": 9_459,
      },
      {
        "dist/assets": ["index-a.js", "rolldown-runtime-b.js", "vendor-c.js", "index-a.css", "container.png"],
      },
    );
    const b: Budget = { label: "vendor", kind: "vendor-chunk", dir: "dist/assets", maxBytes: 1_350_000 };
    const r = measureBudget(b, io);
    assert.equal(r.bytes, 1_198_788, "nur der vendor-Chunk zählt");
    assert.equal(r.over, false, "1.14 MiB liegt unter 1.35 MB Budget");
    assert.deepEqual(r.files, ["dist/assets/vendor-c.js"]);
  });

  test("measureBudget (vendor-chunk): aufgeblähter Phaser-Bump kippt das eigene Gate (#595)", () => {
    const io = fakeIo(
      { "dist/assets/vendor-c.js": 1_500_000, "dist/assets/index-a.js": 1_000_000 },
      { "dist/assets": ["vendor-c.js", "index-a.js"] },
    );
    const b: Budget = { label: "vendor", kind: "vendor-chunk", dir: "dist/assets", maxBytes: 1_350_000 };
    const r = measureBudget(b, io);
    assert.equal(r.bytes, 1_500_000, "nur der vendor-Chunk, nicht der Spielcode");
    assert.equal(r.over, true, "1.5 MB > 1.35 MB Budget → über");
  });

  test("measureBudget (vendor-chunk): fehlendes dist/ ODER kein Vendor-Chunk → missing", () => {
    const b: Budget = { label: "vendor", kind: "vendor-chunk", dir: "dist/assets", maxBytes: 1_350_000 };
    assert.equal(measureBudget(b, fakeIo({})).missing, true, "kein dist/assets → missing");
    // Verzeichnis da, aber nur Spielcode/Assets, kein Vendor-Chunk (z.B. Vendor-Split entfernt).
    const io = fakeIo(
      { "dist/assets/index-a.js": 1_000_000, "dist/assets/x.png": 100 },
      { "dist/assets": ["index-a.js", "x.png"] },
    );
    assert.equal(measureBudget(b, io).missing, true, "kein messbarer Vendor-Chunk → missing, nicht still grün");
  });

  test("CHUNK_FILTERS: game-chunks und vendor-chunk sind komplementär (#595)", () => {
    // Jeder JS-Chunk (kein .map) fällt in genau eines der beiden Budgets – kein Chunk
    // wird doppelt gezählt, keiner fällt zwischen die Budgets.
    for (const name of ["vendor-clUN07v7.js", "index-Cvecvphz.js", "rolldown-runtime-QTnfLwEv.js"]) {
      const inGame = CHUNK_FILTERS["game-chunks"](name);
      const inVendor = CHUNK_FILTERS["vendor-chunk"](name);
      assert.equal(inGame !== inVendor, true, `${name}: genau eines von game/vendor, nie beides/keines`);
    }
    // Nicht-JS bzw. Sourcemaps fallen in KEIN Chunk-Budget.
    for (const name of ["index-Cvecvphz.css", "index-Cvecvphz.js.map", "container-DTEZjtah.png"]) {
      assert.equal(CHUNK_FILTERS["game-chunks"](name), false, `${name}: nicht im Spielcode-Budget`);
      assert.equal(CHUNK_FILTERS["vendor-chunk"](name), false, `${name}: nicht im Vendor-Budget`);
    }
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
    const r = check({ io: healthyBuild() });
    assert.equal(r.missing, false);
    assert.equal(r.over, false);
    assert.equal(r.results.length, BUNDLE_BUDGETS.length);
  });

  test("checkBundle: ein Artefakt über Budget → over=true", () => {
    const r = check({ io: healthyBuild({ offline: 9_000_000 }) });
    assert.equal(r.over, true, "die aufgeblähte Offline-HTML kippt das Gate");
    assert.equal(r.missing, false);
  });

  test("checkBundle: aufgeblähter Vendor-Chunk allein kippt das Gate (#595)", () => {
    // Offline + Spielcode im Budget, nur der Phaser-Vendor läuft weg → over=true.
    const r = check({ io: healthyBuild({ vendor: 1_500_000 }) });
    assert.equal(r.missing, false);
    assert.equal(r.over, true, "der Vendor-Chunk über seinem eigenen Budget kippt das Gate");
    const vendorResult = r.results.find((x) => x.label.includes("(#595)"));
    assert.equal(vendorResult?.over, true, "genau das Vendor-Budget ist über");
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

  test("BUNDLE_BUDGETS: vier plausible, positive Budgets (offline-Datei + Spielcode- + Content- + Vendor-Chunk)", () => {
    assert.equal(BUNDLE_BUDGETS.length, 4);
    const kinds = BUNDLE_BUDGETS.map((b) => b.kind).sort();
    assert.deepEqual(kinds, ["content-chunks", "file", "game-chunks", "vendor-chunk"]);
    for (const b of BUNDLE_BUDGETS) {
      assert.ok(Number.isFinite(b.maxBytes) && b.maxBytes > 0, `${b.label}: maxBytes muss positiv sein`);
      // Grobe Sanity: Budgets liegen im Megabyte-Bereich (nicht versehentlich 0/KB oder GB).
      assert.ok(b.maxBytes > 500_000 && b.maxBytes < 20_000_000, `${b.label}: maxBytes plausibel im MB-Bereich`);
    }
    // Der Offline-Wert zieht den Content ab (ADR 0018) und zeigt auf den Content-Ordner des Host-Builds.
    const offline = BUNDLE_BUDGETS.find((b) => b.kind === "file");
    assert.equal((offline as { subtractChunksDir?: string }).subtractChunksDir, CONTENT_DIR);
    // Jedes Chunk-Budget hat einen Filter in CHUNK_FILTERS (kind-generische Messung).
    for (const b of BUNDLE_BUDGETS.filter((x) => x.kind !== "file")) {
      assert.equal(typeof CHUNK_FILTERS[b.kind], "function", `${b.kind}: Filter in CHUNK_FILTERS vorhanden`);
    }
  });

  describe("Content-Chunks (#1408, ADR 0018)", () => {
    const budget = (): ContentBudget => ({ ...contentBudget(), maxBytesPerChunk: 20_000, maxBytes: 60_000 });

    test("alle erwarteten Chunks da und unter den Deckeln → ok", () => {
      const r = measureBudget(budget(), healthyBuild());
      assert.deepEqual(r.problems, []);
      assert.equal(r.over, false);
      assert.equal(r.bytes, 30_000);
    });

    test("erwarteter Chunk fehlt → rot mit Namen", () => {
      const r = measureBudget(budget(), healthyBuild({ content: { "content-core.aaa.js": 10_000, "content-maps-harbor.ccc.js": 10_000 } }));
      assert.equal(r.over, true);
      assert.ok(r.problems?.some((p) => p.includes("content-quests-knut") && p.includes("fehlt")), String(r.problems));
    });

    test("unerwarteter Chunk (keine Quelldatei) → rot", () => {
      const content = { "content-core.aaa.js": 1, "content-quests-knut.bbb.js": 1, "content-maps-harbor.ccc.js": 1, "content-quests-geist.ddd.js": 1 };
      const r = measureBudget(budget(), healthyBuild({ content }));
      assert.equal(r.over, true);
      assert.ok(r.problems?.some((p) => p.includes("content-quests-geist") && p.includes("Unerwartet")), String(r.problems));
    });

    test("Deckel je Chunk: genau am Deckel ok, +1 Byte rot", () => {
      const at = { "content-core.aaa.js": 20_000, "content-quests-knut.bbb.js": 1, "content-maps-harbor.ccc.js": 1 };
      assert.equal(measureBudget(budget(), healthyBuild({ content: at })).over, false);
      const over = { ...at, "content-core.aaa.js": 20_001 };
      const r = measureBudget(budget(), healthyBuild({ content: over }));
      assert.equal(r.over, true);
      assert.ok(r.problems?.some((p) => p.includes("content-core") && p.includes("Deckel")), String(r.problems));
    });

    test("Summe: genau am Auslöser ok, +1 Byte rot (Stufe 2)", () => {
      const at = { "content-core.aaa.js": 20_000, "content-quests-knut.bbb.js": 20_000, "content-maps-harbor.ccc.js": 20_000 };
      assert.equal(measureBudget(budget(), healthyBuild({ content: at })).over, false);
      const r = measureBudget(budget(), healthyBuild({ content: { ...at, "content-maps-harbor.ccc.js": 20_001 } }));
      assert.equal(r.over, true);
      assert.ok(r.problems?.some((p) => p.includes("Stufe-2")), String(r.problems));
    });

    test("Ordner dist/assets/content fehlt → missing, nicht grün", () => {
      const io = fakeIo({ "dist/assets/index-a.js": 1 }, { "dist/assets": ["index-a.js"] });
      const r = measureBudget(budget(), io);
      assert.equal(r.missing, true);
    });

    test("mehrere Core-Dateien ergeben genau einen content-core", () => {
      const expected = expectedContentChunks({
        listFiles: (p: string) => (p === "src/content/data" ? ["src/content/data/a.json", "src/content/data/b.json"] : null),
      });
      assert.deepEqual(expected, ["content-core"]);
    });

    test("Offline-Budget zieht die Content-Chunks ab: Grenze ok, +1 rot, ohne Content-Ordner missing", () => {
      const offline: Budget = { label: "o", kind: "file", path: "dist-offline/index.html", subtractChunksDir: CONTENT_DIR, maxBytes: 1_000_000 };
      // Content-Summe der gesunden Fixture: 30_000 → Offline-Rest = HTML − 30_000.
      assert.equal(measureBudget(offline, healthyBuild({ offline: 1_030_000 })).over, false, "Rest genau am Budget");
      const r = measureBudget(offline, healthyBuild({ offline: 1_030_001 }));
      assert.equal(r.over, true, "ein Byte drüber");
      assert.equal(r.bytes, 1_000_001);
      const noContent = fakeIo({ "dist-offline/index.html": 1 }, {});
      assert.equal(measureBudget(offline, noContent).missing, true, "ohne Host-Build nicht verlässlich messbar");
    });

    test("Nicht-JS-Dateien im Content-Ordner (.js.map, .css) zählen weder als Chunk noch als Bytes", () => {
      const files: Record<string, number> = {};
      for (const f of CONTENT_FILES) files[`${CONTENT_DIR}/${f}`] = 10_000;
      files[`${CONTENT_DIR}/content-core.aaa.js.map`] = 999_999;
      files[`${CONTENT_DIR}/x.css`] = 999_999;
      files["dist-offline/index.html"] = 1_030_000;
      const io = fakeIo(files, { [CONTENT_DIR]: [...CONTENT_FILES, "content-core.aaa.js.map", "x.css"] });
      const r = measureBudget(budget(), io);
      assert.deepEqual(r.problems, []);
      assert.equal(r.bytes, 30_000);
      const offline: Budget = { label: "o", kind: "file", path: "dist-offline/index.html", subtractChunksDir: CONTENT_DIR, maxBytes: 1_000_000 };
      assert.equal(measureBudget(offline, io).bytes, 1_000_000, "Offline-Abzug zählt nur .js");
    });

    test("Namenskollision zweier Quelldateien ist ein Problem im Gate", () => {
      const io = { ...healthyBuild(), listFiles: (p: string) => [...SOURCES, "src/content/data/quests/Knut_DNS.json", "src/content/data/quests/knut-dns.json"].filter((s) => s.startsWith(`${p}/`)) };
      const r = measureBudget(budget(), io);
      assert.ok(r.problems?.some((p) => p.includes("Namenskollision") && p.includes("content-quests-knut-dns")), String(r.problems));
    });

    test("Chunk-Zahl: genau am Limit ok, +1 rot (Stufe 2)", () => {
      const b: ContentBudget = { ...budget(), maxChunks: 3 };
      assert.equal(measureBudget(b, healthyBuild()).over, false);
      assert.equal(measureBudget({ ...b, maxChunks: 2 }, healthyBuild()).over, true);
    });

    test("Ratchet: Deckel, Summe und Chunk-Zahl der echten Budgets dürfen nicht wachsen (ADR 0018)", () => {
      const b = contentBudget();
      assert.ok(b.maxBytesPerChunk <= 128_000, "Deckel je Chunk nicht anheben, Datei splitten");
      assert.ok(b.maxBytes <= 2_000_000, "Summe nicht anheben, Stufe 2 bauen");
      assert.ok(b.maxChunks <= 200, "Chunk-Zahl nicht anheben, Stufe 2 bauen");
    });

    test("Red-Green: winziger Deckel greift, riesiger nie", () => {
      const tiny: Budget = { ...budget(), maxBytesPerChunk: 1 };
      const huge: Budget = { ...budget(), maxBytesPerChunk: 1e12, maxBytes: 1e12 };
      assert.equal(measureBudget(tiny, healthyBuild()).over, true);
      assert.equal(measureBudget(huge, healthyBuild()).over, false);
    });

    test("Spielcode zählt die Content-Chunks nicht mit (Unterordner)", () => {
      const r = measureBudget({ label: "c", kind: "game-chunks", dir: "dist/assets", maxBytes: 1e12 }, healthyBuild());
      assert.equal(r.bytes, 400_000);
    });
  });

  // Optionaler Integrations-Check: NUR wenn die echten Artefakte zufällig vorliegen
  // (z.B. nach `npm run build` + `build:offline`). Ohne Build wird er übersprungen,
  // damit der schnelle `npm test`-Lauf (ohne Builds) grün bleibt.
  test("Integration: reale Artefakte liegen im Budget (übersprungen, wenn nicht gebaut)", () => {
    const io = defaultIo();
    const r = check({ io });
    if (r.missing) return; // nicht gebaut → nichts zu prüfen
    // Gebaute Content-Chunks = erwartete aus den Quellen (nur wenn der Build vorliegt).
    const content = r.results.find((x) => x.problems);
    assert.deepEqual(content?.problems, [], "Content-Chunks: erwartete Menge, Deckel, Summe");
    const over = r.results.filter((x) => x.over);
    assert.deepEqual(
      over.map((x) => `${x.label}: ${x.bytes} > ${x.maxBytes}`),
      [],
      "Gebaute Artefakte überschreiten ihr Budget — verkleinern oder Budget in scripts/check-bundle.mjs anheben (Ratchet).",
    );
  });
});

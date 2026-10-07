/* Namensregel der Content-Chunks (#1408, ADR 0018): jede Datei unter src/content/data/<dir>/
 * bzw. jede Karte unter assets/maps/ wird ein eigener Chunk. EINE Regel (scripts/content-chunks.cjs)
 * speist vite.config.ts (manualChunks) UND scripts/check-bundle.mjs (erwartete Menge). */
import { describe, test } from "vitest";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const require = createRequire(import.meta.url);
const { contentChunkName, expectedContentChunks, contentChunkCollisions, CONTENT_CHUNK_DIR } = require("../scripts/content-chunks.cjs") as {
  contentChunkName: (id: string) => string | undefined;
  expectedContentChunks: (io: { listFiles: (rel: string) => string[] | null }) => string[];
  contentChunkCollisions: (io: { listFiles: (rel: string) => string[] | null }) => { name: string; files: string[] }[];
  CONTENT_CHUNK_DIR: string;
};

describe("contentChunkName (#1408)", () => {
  test("Unterverzeichnis-Datei → content-<dir>-<name> (Posix und Windows-ID)", () => {
    assert.equal(contentChunkName("/repo/src/content/data/quests/knut.json"), "content-quests-knut");
    assert.equal(contentChunkName("C:\\dev\\kubernia\\src\\content\\data\\crabquiz\\storage.json"), "content-crabquiz-storage");
  });
  test("Datei direkt unter data/ → gemeinsamer content-core", () => {
    assert.equal(contentChunkName("/repo/src/content/data/smalltalk.json"), "content-core");
    assert.equal(contentChunkName("/repo/src/content/data/npcs.json"), "content-core");
  });
  test("Karte (auch mit ?raw) → content-maps-<name>", () => {
    assert.equal(contentChunkName("/repo/assets/maps/harbor.tmj?raw"), "content-maps-harbor");
    assert.equal(contentChunkName("C:\\x\\assets\\maps\\test-map.tmj"), "content-maps-test-map");
  });
  test("Nicht-Content → undefined (Code, Vendor, fremdes JSON)", () => {
    assert.equal(contentChunkName("/repo/src/content/loader.ts"), undefined);
    assert.equal(contentChunkName("/repo/node_modules/phaser/src/x.json"), undefined);
    assert.equal(contentChunkName("/repo/package.json"), undefined);
    assert.equal(contentChunkName("/repo/src/other/data/quests/x.json"), undefined);
    assert.equal(contentChunkName("/repo/assets/maps/README.md"), undefined);
  });
  test("Zeichen außerhalb [a-z0-9-] werden zu -", () => {
    assert.equal(contentChunkName("/r/src/content/data/quests/Knut_DNS.json"), "content-quests-knut-dns");
  });
  test("injektiv über alle echten Quelldateien", () => {
    const names = expectedContentChunks({
      listFiles: (rel) => {
        const abs = join(process.cwd(), rel);
        try {
          return statSync(abs).isDirectory() ? walk(abs, rel) : null;
        } catch {
          return null;
        }
      },
    });
    assert.ok(names.length > 20, "es gibt viele Content-Dateien");
    assert.equal(new Set(names).size, names.length, "erwartete Menge ohne Doppelte");
    assert.ok(names.includes("content-core"));
    assert.ok(names.includes("content-quests-knut"));
    assert.ok(names.includes("content-maps-harbor"));
  });
  test("Kollision: verlustbehaftete Bereinigung (Knut_DNS gegen knut-dns) wird erkannt", () => {
    const files = ["src/content/data/quests/Knut_DNS.json", "src/content/data/quests/knut-dns.json"];
    const c = contentChunkCollisions({ listFiles: (p) => files.filter((f) => f.startsWith(`${p}/`)) });
    assert.equal(c.length, 1);
    assert.equal(c[0].name, "content-quests-knut-dns");
    assert.deepEqual(c[0].files, files);
  });
  test("Kollision: Datenordner maps/ gegen Karte assets/maps/ wird erkannt", () => {
    const files = ["src/content/data/maps/harbor.json", "assets/maps/harbor.tmj"];
    const c = contentChunkCollisions({ listFiles: (p) => files.filter((f) => f.startsWith(`${p}/`)) });
    assert.deepEqual(c.map((x) => x.name), ["content-maps-harbor"]);
  });
  test("keine Kollision: mehrere Core-Dateien sind gewollt, die echten Quellen sind eindeutig", () => {
    const core = ["src/content/data/a.json", "src/content/data/b.json"];
    assert.deepEqual(contentChunkCollisions({ listFiles: (p) => core.filter((f) => f.startsWith(`${p}/`)) }), []);
    const real = contentChunkCollisions({
      listFiles: (rel) => {
        try {
          return statSync(join(process.cwd(), rel)).isDirectory() ? walk(join(process.cwd(), rel), rel) : null;
        } catch {
          return null;
        }
      },
    });
    assert.deepEqual(real, []);
  });
  test("Chunk-Verzeichnis ist assets/content", () => {
    assert.equal(CONTENT_CHUNK_DIR, "assets/content");
  });
});

function walk(abs: string, rel: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(abs)) {
    const a = join(abs, e);
    const r = `${rel}/${e}`;
    if (statSync(a).isDirectory()) out.push(...walk(a, r));
    else out.push(r);
  }
  return out;
}

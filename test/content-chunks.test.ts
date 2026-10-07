/* Namensregel der Content-Chunks (#1408, ADR 0018): jede Datei unter src/content/data/<dir>/
 * bzw. jede Karte unter assets/maps/ wird ein eigener Chunk. EINE Regel (scripts/content-chunks.cjs)
 * speist vite.config.ts (manualChunks) UND scripts/check-bundle.mjs (erwartete Menge). */
import { describe, test } from "vitest";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const require = createRequire(import.meta.url);
const { contentChunkName, expectedContentChunks, CONTENT_CHUNK_DIR } = require("../scripts/content-chunks.cjs") as {
  contentChunkName: (id: string) => string | undefined;
  expectedContentChunks: (io: { listFiles: (rel: string) => string[] | null }) => string[];
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
    assert.equal(new Set(names).size, names.length, "keine Namenskollision");
    assert.ok(names.includes("content-core"));
    assert.ok(names.includes("content-quests-knut"));
    assert.ok(names.includes("content-maps-harbor"));
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

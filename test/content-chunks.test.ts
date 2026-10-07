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

describe("contentSourceFiles und Stempel (#1411)", () => {
  const m = require("../scripts/content-chunks.cjs") as {
    contentSourceFiles: (io: { listFiles: (rel: string) => string[] | null }) => { file: string; name: string }[];
    contentStempel: (io: { listFiles: (rel: string) => string[] | null; readFile: (rel: string) => Uint8Array | string }) => string;
    stempelAusHtml: (html: string) => string | null;
    CONTENT_STEMPEL_META: string;
    fsContentIo: (root: string) => { listFiles: (rel: string) => string[] | null; readFile: (rel: string) => Uint8Array };
  };
  const quellen = (files: Record<string, string>) => ({
    listFiles: (p: string) => {
      const hit = Object.keys(files).filter((f) => f.startsWith(`${p}/`));
      return hit.length ? hit : null;
    },
    readFile: (rel: string) => files[rel],
  });
  const BASIS = { "src/content/data/npcs.json": "{}", "src/content/data/quests/knut.json": "[1]", "assets/maps/harbor.tmj": "<map/>", "src/content/loader.ts": "x" };

  test("contentSourceFiles: nur Dateien, die einen Chunk speisen, mit ihrem Namen, beide Quellordner", () => {
    assert.deepEqual(
      m.contentSourceFiles(quellen(BASIS)).map((s) => `${s.file} → ${s.name}`),
      ["src/content/data/npcs.json → content-core", "src/content/data/quests/knut.json → content-quests-knut", "assets/maps/harbor.tmj → content-maps-harbor"],
    );
    assert.deepEqual(m.contentSourceFiles({ listFiles: () => null }), [], "fehlende Ordner → leer");
  });

  test("Stempel: gleicher Inhalt gleicher Hash, unabhängig von der Reihenfolge der Platte", () => {
    const umgekehrt = Object.fromEntries(Object.entries(BASIS).reverse());
    assert.equal(m.contentStempel(quellen(BASIS)), m.contentStempel(quellen(umgekehrt)));
    assert.match(m.contentStempel(quellen(BASIS)), /^[0-9a-f]{64}$/);
  });

  test("Stempel ändert sich bei geändertem Inhalt, neuer Datei und anderem Namen (Red-Green gegen Verwechslung)", () => {
    const s0 = m.contentStempel(quellen(BASIS));
    assert.notEqual(m.contentStempel(quellen({ ...BASIS, "src/content/data/quests/knut.json": "[2]" })), s0, "Inhalt");
    assert.notEqual(m.contentStempel(quellen({ ...BASIS, "src/content/data/quests/neu.json": "[]" })), s0, "neue Datei");
    const { "src/content/data/quests/knut.json": knut, ...rest } = BASIS;
    assert.notEqual(m.contentStempel(quellen({ ...rest, "src/content/data/quests/anna.json": knut })), s0, "gleicher Inhalt unter anderem Namen");
    assert.equal(m.contentStempel(quellen({ ...BASIS, "src/content/loader.ts": "anderer Code" })), s0, "Code außerhalb der Content-Quellen zählt nicht");
  });

  test("stempelAusHtml liest das Meta-Tag; ohne Tag oder mit Müll → null", () => {
    const html = `<head><meta name="${m.CONTENT_STEMPEL_META}" content="abc123"></head>`;
    assert.equal(m.stempelAusHtml(html), "abc123");
    assert.equal(m.stempelAusHtml("<head></head>"), null);
    assert.equal(m.stempelAusHtml(`<meta name="${m.CONTENT_STEMPEL_META}" content="">`), null);
    assert.equal(m.stempelAusHtml(`<meta name="anderer" content="abc">`), null);
  });

  test("fsContentIo liest die echten Quellen; der Stempel des Repos ist stabil", () => {
    const io = m.fsContentIo(process.cwd());
    assert.ok((io.listFiles("src/content/data") ?? []).length > 20);
    assert.equal(io.listFiles("gibt/es/nicht"), null);
    assert.equal(m.contentStempel(io), m.contentStempel(m.fsContentIo(process.cwd())));
  });
});

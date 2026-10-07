/* Abschnitte eines Review-Patches für das Read-Tool (#1379 Z7). */
import { describe, test } from "vitest";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as paModule from "../scripts/patch-abschnitte.mjs";

type Abschnitt = { offset: number; limit: number };
const pa = paModule as { abschnitte: (t: string, max?: number) => Abschnitt[]; MAX_ZEICHEN: number };
const zeilen = (n: number, len: number) => Array.from({ length: n }, () => "x".repeat(len)).join("\n");

describe("abschnitte", () => {
  test("leer ergibt keine Abschnitte, ein kleiner Patch genau einen", () => {
    assert.deepEqual(pa.abschnitte(""), []);
    assert.deepEqual(pa.abschnitte("a\nb\nc\n"), [{ offset: 1, limit: 3 }]);
  });
  test("Grenze exakt: passt in ein Budget, eine Zeile mehr bricht um", () => {
    // Je Zeile 2 Zeichen + 8 Präfix = 10; Budget 30 → 3 Zeilen je Abschnitt.
    assert.deepEqual(pa.abschnitte(zeilen(3, 2), 30), [{ offset: 1, limit: 3 }]);
    assert.deepEqual(pa.abschnitte(zeilen(4, 2), 30), [{ offset: 1, limit: 3 }, { offset: 4, limit: 1 }]);
  });
  test("eine Zeile über dem Budget ist ein eigener Abschnitt", () => {
    const t = ["a", "b".repeat(100), "c"].join("\n");
    assert.deepEqual(pa.abschnitte(t, 50), [{ offset: 1, limit: 1 }, { offset: 2, limit: 1 }, { offset: 3, limit: 1 }]);
  });
  test("CRLF zählt wie LF", () => {
    assert.deepEqual(pa.abschnitte("a\r\nb\r\nc\r\n", 1000), [{ offset: 1, limit: 3 }]);
  });
  test("jede Zeile genau einmal, ohne Lücke und Überlappung, jeder Abschnitt im Budget", () => {
    const lens = [1, 50, 400, 3, 3000, 7, 7, 7, 90, 1200];
    const text = Array.from({ length: 500 }, (_, i) => "y".repeat(lens[i % lens.length])).join("\n");
    const a = pa.abschnitte(text, 4000);
    assert.equal(a[0].offset, 1);
    for (let i = 1; i < a.length; i++) assert.equal(a[i].offset, a[i - 1].offset + a[i - 1].limit);
    assert.equal(a[a.length - 1].offset + a[a.length - 1].limit - 1, 500);
    const z = text.split("\n");
    for (const s of a) {
      const groesse = z.slice(s.offset - 1, s.offset - 1 + s.limit).reduce((n, l) => n + l.length + 8, 0);
      assert.ok(s.limit === 1 || groesse <= 4000, `Abschnitt ${s.offset} zu groß`);
    }
  });
});

describe("CLI", () => {
  test("nennt offset/limit je Abschnitt; fehlende Datei endet mit Exit 2", () => {
    const dir = mkdtempSync(join(tmpdir(), "kq-pa-"));
    try {
      const f = join(dir, "x.patch");
      writeFileSync(f, zeilen(1000, 100));
      const out = execFileSync(process.execPath, ["scripts/patch-abschnitte.mjs", f], { encoding: "utf8" }).trim().split("\n");
      assert.ok(out.length > 1);
      let naechster = 1;
      for (const z of out) {
        const m = /^offset=(\d+) limit=(\d+)$/.exec(z);
        assert.ok(m, z);
        assert.equal(Number(m[1]), naechster);
        naechster += Number(m[2]);
      }
      assert.equal(naechster, 1001);
      const fehlt = spawnSync(process.execPath, ["scripts/patch-abschnitte.mjs", join(dir, "nein.patch")], { encoding: "utf8" });
      assert.equal(fehlt.status, 2);
      assert.equal(spawnSync(process.execPath, ["scripts/patch-abschnitte.mjs"], { encoding: "utf8" }).status, 2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

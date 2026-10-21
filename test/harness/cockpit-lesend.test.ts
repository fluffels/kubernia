/* Cockpit-Wächter (#1821 L2) – das Cockpit bleibt nur lesend (ADR 0029 (d)).
 *
 * @harness-waechter – einziger Durchsetzer seiner Regel, darum im geschützten test/harness/ (#1165).
 *
 * Geschlossene Verbotsliste über alle getrackten `scripts/cockpit/**\/*.mjs`:
 *   1. `node:child_process` / `child_process` (Import, require, dynamischer Import, Re-Export) nur in `lauf.mjs`,
 *      der einzigen Prüfstelle mit Allowlist.
 *   2. Aus `node:fs`, `node:fs/promises`, `fs`, `fs/promises` dürfen nur benannte statische Importe stehen, und kein
 *      schreibender Name (writeFile, appendFile, mkdir, mkdtemp, rm, rmdir, unlink, rename, copyFile, cp, truncate,
 *      symlink, link, chmod, chown, utimes, jeweils auch …Sync; createWriteStream, open/openSync; `promises`).
 *      Standard-/Namespace-Import (`* as fs`), require und dynamischer Import eines fs-Moduls sind nicht prüfbar und
 *      damit verboten.
 *
 * Grenzen: gescannt wird der Quelltext samt Kommentaren (ein Treffer im Kommentar ist ein Fund); transitive Importe
 * außerhalb von `scripts/cockpit/` prüft dieser Test nicht; ein nicht-literaler Modulname im require/import() gilt als
 * nicht prüfbar und ist verboten. Bekannte Grenze: die Ausnahme für Unterprozesse gilt nur nach Dateiname (`lauf.mjs`),
 * nicht nach Pfad; eine verschachtelte `quellen/lauf.mjs` wäre ebenfalls ausgenommen. Das ist eine Lint-Schranke gegen Versehen, keine Sandbox.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, test } from "vitest";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

const SCHREIBEND = new Set([
  "writeFile", "appendFile", "mkdir", "mkdtemp", "rm", "rmdir", "unlink", "rename", "copyFile", "cp", "truncate",
  "symlink", "link", "chmod", "chown", "utimes", "open", "createWriteStream", "promises",
  "writeFileSync", "appendFileSync", "mkdirSync", "mkdtempSync", "rmSync", "rmdirSync", "unlinkSync", "renameSync",
  "copyFileSync", "cpSync", "truncateSync", "symlinkSync", "linkSync", "chmodSync", "chownSync", "utimesSync", "openSync",
]);
const FS_MODULE = new Set(["fs", "fs/promises"]);
const KIND_MODULE = "child_process";

const modul = (roh: string): string => roh.replace(/^node:/u, "");

/** Funde (Text je Verstoß) einer Datei; `name` ist der Dateiname ohne Pfad. Pur. */
function verstoesse(name: string, quelle: string): string[] {
  const funde: string[] = [];
  const meldeModul = (m: string, form: string, klammer: string | null): void => {
    const mod = modul(m);
    if (mod === KIND_MODULE && name !== "lauf.mjs") funde.push(`${KIND_MODULE} außerhalb von lauf.mjs (${form})`);
    if (!FS_MODULE.has(mod)) return;
    if (klammer === null) {
      funde.push(`${mod} nicht prüfbar (${form})`);
      return;
    }
    for (const teil of klammer.split(",")) {
      const quellName = teil.trim().split(/\s+as\s+/u)[0].trim();
      if (SCHREIBEND.has(quellName)) funde.push(`schreibende fs-Funktion ${quellName} aus ${mod}`);
    }
  };
  for (const m of quelle.matchAll(/(?:import|export)\s+([\w$*{}\s,]+?)\s*from\s*["']([^"']+)["']/gu)) {
    const klausel = m[1].trim();
    const benannt = /^\{([^}]*)\}$/u.exec(klausel);
    meldeModul(m[2], klausel.includes("*") ? "Namespace-Import" : benannt ? "Import" : "Standard-Import", benannt ? benannt[1] : null);
  }
  for (const m of quelle.matchAll(/\bimport\s+["']([^"']+)["']/gu)) meldeModul(m[1], "Import ohne Bindung", "");
  for (const m of quelle.matchAll(/\b(?:require|import)\s*\(\s*["']([^"']+)["']/gu)) meldeModul(m[1], "require/import()", null);
  if (/\b(?:require|import)\s*\(\s*(?!["'])/u.test(quelle)) funde.push("require/import() mit nicht-literalem Modulnamen (nicht prüfbar)");
  return funde;
}

function cockpitDateien(): string[] {
  const roh = execFileSync("git", ["ls-files", "-z", "--", "scripts/cockpit"], { cwd: ROOT, encoding: "utf8" });
  return roh.split("\0").filter((p) => /\.mjs$/u.test(p));
}

describe("Cockpit bleibt nur lesend (ADR 0029 (d))", () => {
  test("es gibt Cockpit-Dateien zu prüfen, und lauf.mjs ist dabei", () => {
    const dateien = cockpitDateien();
    assert.ok(dateien.length >= 5, `nur ${dateien.length} Dateien gefunden`);
    assert.ok(dateien.includes("scripts/cockpit/lauf.mjs"));
  });

  test("keine Datei startet Unterprozesse (außer lauf.mjs) oder schreibt ins Dateisystem", () => {
    const alle = cockpitDateien().flatMap((p) => {
      const name = p.split("/").pop() ?? p;
      return verstoesse(name, readFileSync(resolve(ROOT, p), "utf8")).map((f) => `${p}: ${f}`);
    });
    assert.deepEqual(alle, []);
  });

  describe("Gegenbeispiele (das Prädikat schlägt an)", () => {
    test("child_process in jeder Form außerhalb von lauf.mjs", () => {
      for (const q of [
        'import { execFile } from "node:child_process";',
        'import cp from "child_process";',
        'const { spawn } = require("node:child_process");',
        'const m = await import("child_process");',
        'export { spawn } from "node:child_process";',
        'import "node:child_process";',
      ]) assert.equal(verstoesse("seite.mjs", q).length, 1, q);
    });

    test("child_process in lauf.mjs ist erlaubt", () => {
      assert.deepEqual(verstoesse("lauf.mjs", 'import { execFile } from "node:child_process";'), []);
    });

    test("schreibende fs-Funktionen, auch mit Alias und Sync", () => {
      for (const q of [
        'import { writeFile } from "node:fs";',
        'import { readFileSync, writeFileSync } from "node:fs";',
        'import { rm as entfernen } from "fs";',
        'import { mkdir } from "node:fs/promises";',
        'import { createWriteStream } from "fs";',
        'import { openSync } from "node:fs";',
        'import { promises } from "node:fs";',
      ]) assert.equal(verstoesse("lauf.mjs", q).length, 1, q);
    });

    test("nicht prüfbare Formen eines fs-Moduls", () => {
      for (const q of [
        'import * as fs from "node:fs";',
        'import fs from "node:fs";',
        'const fs = require("fs");',
        'const fs = await import("node:fs/promises");',
        "const m = await import(name);",
      ]) assert.equal(verstoesse("seite.mjs", q).length, 1, q);
    });

    test("lesende fs-Importe und fremde Module sind erlaubt", () => {
      assert.deepEqual(verstoesse("server.mjs", 'import { readFileSync, statSync } from "node:fs";\nimport { resolve } from "node:path";'), []);
      assert.deepEqual(verstoesse("server.mjs", 'import { rename } from "./eigen.mjs";'), []);
    });
  });
});

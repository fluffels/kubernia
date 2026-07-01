/* Zufall & Determinismus (#492) – Unit-Tests des SSOT src/rng.ts UND die
 * Fitness-Function „kein Math.random in der Domäne/Content".
 *
 * Zwei Rollen in einer Datei (bewusst, gehört inhaltlich zusammen):
 *  1. Verhaltens-Tests des PRNG/Hash (mulberry32 seedbar & reproduzierbar,
 *     hashStr/hashHex stabil).
 *  2. Architektur-Wächter (Fitness-Function): src/sim/** + src/content/** dürfen
 *     `Math.random` nicht aufrufen – der Determinismus-Anspruch der puren Domäne
 *     wird so maschinell gehalten (neben der ESLint-Regel no-restricted-properties).
 *
 * Ausführen mit:  npm test
 */
import { describe, test } from "vitest";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { mulberry32, hashStr, hashHex, nextRandom, seedGlobalRng } from "../src/rng";

describe("mulberry32 – seedbarer PRNG (#492)", () => {
  test("gleicher Seed → exakt gleiche Zahlenfolge (reproduzierbar)", () => {
    const a = mulberry32(12345);
    const b = mulberry32(12345);
    const seqA = Array.from({ length: 20 }, () => a());
    const seqB = Array.from({ length: 20 }, () => b());
    assert.deepEqual(seqA, seqB, "Zwei Generatoren mit demselben Seed müssen identisch liefern.");
  });

  test("verschiedene Seeds → verschiedene Folgen (kein degenerierter Generator)", () => {
    const a = mulberry32(1);
    const b = mulberry32(2);
    const seqA = Array.from({ length: 20 }, () => a());
    const seqB = Array.from({ length: 20 }, () => b());
    assert.notDeepEqual(seqA, seqB, "Unterschiedliche Seeds dürfen nicht dieselbe Folge liefern.");
  });

  test("Werte liegen in [0,1)", () => {
    const r = mulberry32(999);
    for (let i = 0; i < 1000; i++) {
      const v = r();
      assert.ok(v >= 0 && v < 1, `Wert ${v} außerhalb [0,1)`);
    }
  });

  test("nextRandom() ist über seedGlobalRng() reproduzierbar pinbar", () => {
    seedGlobalRng(42);
    const first = Array.from({ length: 10 }, () => nextRandom());
    seedGlobalRng(42);
    const again = Array.from({ length: 10 }, () => nextRandom());
    assert.deepEqual(first, again, "Gleicher Seed über seedGlobalRng → gleicher globaler Strom.");
  });
});

describe("hashStr / hashHex – aus Namen abgeleitete stabile Werte (#492)", () => {
  test("hashStr ist deterministisch und ein uint32", () => {
    assert.equal(hashStr("web"), hashStr("web"), "Gleicher Name → gleicher Hash.");
    const h = hashStr("kasse");
    assert.ok(Number.isInteger(h) && h >= 0 && h <= 0xffffffff, "Hash muss ein uint32 sein.");
  });

  test("hashStr trennt verschiedene Namen", () => {
    assert.notEqual(hashStr("web"), hashStr("db"), "Verschiedene Namen sollten verschieden hashen.");
  });

  test("hashHex liefert stabile Hex-ID exakt gewünschter Länge", () => {
    assert.equal(hashHex("nginx:latest", 12).length, 12);
    assert.equal(hashHex("nginx:latest", 12), hashHex("nginx:latest", 12), "Gleicher Name → gleiche ID.");
    assert.match(hashHex("nginx:latest", 12), /^[0-9a-f]+$/, "Nur Hex-Ziffern.");
    assert.notEqual(hashHex("nginx:latest", 12), hashHex("redis:7", 12), "Verschiedene Images → verschiedene IDs.");
  });
});

/* ---------- Fitness-Function: kein Math.random in Domäne/Content ---------- */

/** Rekursiv alle .ts-Dateien unter `dir` (absolut). */
function tsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...tsFiles(full));
    else if (entry.endsWith(".ts")) out.push(full);
  }
  return out;
}

/** Findet echte `Math.random(`-AUFRUFE (nicht die Erwähnung in Prosa/Kommentaren). */
const MATH_RANDOM_CALL = /Math\s*\.\s*random\s*\(/;

const GUARDED_DIRS = [join(process.cwd(), "src", "sim"), join(process.cwd(), "src", "content")];

describe("Fitness-Function: Determinismus der Domäne (#492)", () => {
  test("kein Math.random()-Aufruf in src/sim/** und src/content/**", () => {
    const offenders: string[] = [];
    for (const dir of GUARDED_DIRS) {
      for (const file of tsFiles(dir)) {
        const text = readFileSync(file, "utf8");
        text.split("\n").forEach((line, i) => {
          if (MATH_RANDOM_CALL.test(line)) offenders.push(`${file}:${i + 1}  ${line.trim()}`);
        });
      }
    }
    assert.deepEqual(
      offenders,
      [],
      "Math.random in der deterministischen Schicht gefunden – nutze src/rng.ts " +
        "(nextRandom/hashStr/hashHex):\n" + offenders.join("\n"),
    );
  });

  test("Detektor greift wirklich (Red-Green, kein No-op)", () => {
    // Wäre der Detektor kaputt (immer grün), wäre der Wächter oben wertlos.
    assert.ok(MATH_RANDOM_CALL.test("const r = Math.random();"), "Aufruf muss erkannt werden.");
    assert.ok(MATH_RANDOM_CALL.test("x = Math . random ()"), "Auch mit Whitespace erkannt.");
    assert.ok(!MATH_RANDOM_CALL.test("// kein Math.random mehr hier"), "Prosa ohne Aufruf ist erlaubt.");
    assert.ok(GUARDED_DIRS.length === 2 && tsFiles(GUARDED_DIRS[0]).length > 0, "Es müssen wirklich Dateien gescannt werden.");
  });
});

/* Fitness-Function (#1572 Z10, Konvention #1398): ein Einstiegsskript (hat einen Direktaufruf-Guard und läuft per
 * `node scripts/<name>.mjs`) importiert nichts aus einem anderen Einstiegsskript. Gemeinsamer Code gehört in eine Lib ohne Guard
 * (`ticket-refs.mjs`, `mess-lib.mjs`, `transkript.mjs` …). Warum: ein Import aus einem Einstiegsskript zieht dessen
 * Modul-Toplevel und Abhängigkeiten mit (bei Hook-Skripten Latenz und Fehlerflächen) und koppelt zwei CLIs aneinander.
 *
 * @harness-waechter – einziger Durchsetzer seiner Regel, darum im geschützten test/harness/ (#1165).
 *
 * Kein Bestand mehr (#1579): jeder Importeur zählt, auch eine Lib; der Test fordert `paare == []`. Ein Einstiegsskript darf aus Libs
 * importieren, nie umgekehrt und nie aus einem anderen Einstieg.
 *
 * Bekannte Grenzen der Erkennung: `GUARD` kennt nur die drei Schreibweisen unten (z.B. `pathToFileURL(process.argv[1] ?? "")` nicht,
 * damit zählen `check-c4.mjs` und `docs-gen.mjs` nicht als Einstieg); `IMPORT` sieht nur statische Importe `from "./x.mjs"` mit
 * doppelten Anführungszeichen (kein `import "./x.mjs"`, kein `import()`). Heute fehlt dadurch kein Paar.
 */
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

const SKRIPTE = new URL("../../scripts/", import.meta.url);

/** Direktaufruf-Guard: `istDirektaufruf(import.meta.url)` oder der ausgeschriebene Vergleich mit `process.argv[1]`. */
const GUARD = /istDirektaufruf\(import\.meta\.url\)|import\.meta\.url\s*===\s*pathToFileURL\(process\.argv\[1\]\)|process\.argv\[1\][^\n]*import\.meta\.url/;
const IMPORT = /\bfrom\s+"\.\/([\w-]+)\.mjs"/g;

type Quelle = Record<string, string>;

/** Einstiegsskripte unter den Quelltexten (Name ohne Endung). Pur. */
export function einstiegsskripte(quellen: Quelle): Set<string> {
  return new Set(Object.entries(quellen).filter(([, text]) => GUARD.test(text)).map(([name]) => name));
}

/** Alle Paare `importeur -> ziel`, bei denen das Ziel ein Einstiegsskript ist; der Importeur ist ein Einstieg oder eine Lib. Pur. */
export function einstiegsPaare(quellen: Quelle): string[] {
  const einstiege = einstiegsskripte(quellen);
  const paare = new Set<string>();
  for (const [name, text] of Object.entries(quellen)) {
    for (const m of text.matchAll(IMPORT)) if (einstiege.has(m[1]) && m[1] !== name) paare.add(`${name} -> ${m[1]}`);
  }
  return [...paare].sort();
}

const lade = (): Quelle =>
  Object.fromEntries(
    readdirSync(SKRIPTE)
      .filter((n) => n.endsWith(".mjs"))
      .map((n) => [n.replace(/\.mjs$/, ""), readFileSync(new URL(n, SKRIPTE), "utf8")]),
  );

describe("Einstiegsskripte importieren nicht voneinander (#1398)", () => {
  const quellen = lade();
  const paare = einstiegsPaare(quellen);

  test("die Erkennung findet die Einstiegsskripte (Plausibilität)", () => {
    expect(einstiegsskripte(quellen).size).toBeGreaterThanOrEqual(40);
    expect(einstiegsskripte(quellen).has("ticket-lock")).toBe(true);
    expect(einstiegsskripte(quellen).has("mess-lib")).toBe(false);
    expect(einstiegsskripte(quellen).has("ticket-refs")).toBe(false);
  });

  test("kein Skript importiert aus einem Einstiegsskript (kein Bestand)", () => {
    expect(paare).toEqual([]);
  });

  test("ticket-lock importiert aus der Lib, nicht aus naechstes-ticket", () => {
    expect(quellen["ticket-lock"]).toMatch(/from "\.\/ticket-refs\.mjs"/);
    expect(quellen["ticket-lock"]).not.toMatch(/from "\.\/naechstes-ticket\.mjs"/);
  });
});

describe("Erkennung und Bewertung (Negativfälle gegen die Funktionen selbst)", () => {
  const guard = "if (istDirektaufruf(import.meta.url)) main();";
  test("ein Import aus einem Einstiegsskript wird als Paar erkannt, aus einer Lib nicht", () => {
    const quellen: Quelle = {
      a: `import { x } from "./b.mjs";\nimport { y } from "./lib.mjs";\n${guard}`,
      b: guard,
      lib: "export const y = 1;",
    };
    expect(einstiegsPaare(quellen)).toEqual(["a -> b"]);
  });
  test("auch eine Lib als Importeur zählt: Lib -> Einstieg ist ein Paar (Negativfall der früheren Grenze)", () => {
    expect(einstiegsPaare({ a: 'import { x } from "./b.mjs";', b: guard })).toEqual(["a -> b"]);
  });
  test("Einstieg -> Lib und Lib -> Lib sind keine Paare", () => {
    const a = `import { x } from "./l1.mjs";\n${guard}`;
    expect(einstiegsPaare({ a, l1: 'import { y } from "./l2.mjs";', l2: "export const y = 1;" })).toEqual([]);
  });
  test("ein Selbstimport zählt nicht", () => {
    expect(einstiegsPaare({ a: `import { x } from "./a.mjs";\n${guard}` })).toEqual([]);
  });
  test("alle drei Guard-Schreibweisen gelten als Einstieg", () => {
    const quellen: Quelle = {
      a: guard,
      b: "if (import.meta.url === pathToFileURL(process.argv[1]).href) main();",
      c: "if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();",
      d: "export const nichts = 1;",
    };
    expect([...einstiegsskripte(quellen)].sort()).toEqual(["a", "b", "c"]);
  });
});

/* Fitness-Function (#1572 Z10, Konvention #1398): ein Einstiegsskript (hat einen Direktaufruf-Guard und läuft per
 * `node scripts/<name>.mjs`) importiert nichts aus einem anderen Einstiegsskript. Gemeinsamer Code gehört in eine Lib ohne Guard
 * (`ticket-refs.mjs`, `mess-lib.mjs`, `transkript.mjs` …). Warum: ein Import aus einem Einstiegsskript zieht dessen
 * Modul-Toplevel und Abhängigkeiten mit (bei Hook-Skripten Latenz und Fehlerflächen) und koppelt zwei CLIs aneinander.
 *
 * @harness-waechter – einziger Durchsetzer seiner Regel, darum im geschützten test/harness/ (#1165).
 *
 * Ratchet: `BESTAND` friert die heutigen Paare ein (Abbau als Burn-down, Zeile im Sammelticket). Ein NEUES Paar ist rot, ein
 * veralteter Eintrag (Paar gibt es nicht mehr) ebenfalls: der Bestand darf nur schrumpfen.
 */
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

const SKRIPTE = new URL("../../scripts/", import.meta.url);

/** Direktaufruf-Guard: `istDirektaufruf(import.meta.url)` oder der ausgeschriebene Vergleich mit `process.argv[1]`. */
const GUARD = /istDirektaufruf\(import\.meta\.url\)|import\.meta\.url\s*===\s*pathToFileURL\(process\.argv\[1\]\)|process\.argv\[1\][^\n]*import\.meta\.url/;
const IMPORT = /\bfrom\s+"\.\/([\w-]+)\.mjs"/g;

/** Eingefrorener Bestand: `importeur -> ziel`, beide ohne Endung. Nur schrumpfend. */
export const BESTAND: readonly string[] = [
  "board-place -> gh-kontingent",
  "board-takt -> gh-kontingent",
  "check-context-size -> check-docdrift",
  "check-diffcoverage -> check-diffsize",
  "check-doc-tickets -> check-context-size",
  "check-doc-tickets -> check-size",
  "check-lockfile -> check-diffsize",
  "check-review-nachweis -> check-diffsize",
  "check-steuerbytes -> check-internalrefs",
  "cleanup-worktrees -> lens-edit-guard",
  "hauptchat-zerlegung -> token-baseline",
  "kontext-treiber -> subagent-laufzeit",
  "naechstes-ticket -> fremdtext",
  "naechstes-ticket -> gh-kontingent",
  "pretooluse-hook -> gh-guard-hook",
  "pretooluse-hook -> worktree-guard-hook",
  "pretooluse-hook -> worktree-guard-powershell",
  "sammelticket-anlegen -> gh-kontingent",
  "stop-verify-hook -> cleanup-worktrees",
  "subagent-laufzeit -> token-baseline",
  "verify-lauf -> check-diffsize",
  "worktree-guard-powershell -> worktree-guard-hook",
];

type Quelle = Record<string, string>;

/** Einstiegsskripte unter den Quelltexten (Name ohne Endung). Pur. */
export function einstiegsskripte(quellen: Quelle): Set<string> {
  return new Set(Object.entries(quellen).filter(([, text]) => GUARD.test(text)).map(([name]) => name));
}

/** Alle Paare `importeur -> ziel`, bei denen das Ziel ein Einstiegsskript ist und der Importeur selbst eines. Pur. */
export function einstiegsPaare(quellen: Quelle): string[] {
  const einstiege = einstiegsskripte(quellen);
  const paare = new Set<string>();
  for (const name of einstiege) {
    for (const m of quellen[name].matchAll(IMPORT)) if (einstiege.has(m[1]) && m[1] !== name) paare.add(`${name} -> ${m[1]}`);
  }
  return [...paare].sort();
}

/** Neue Paare (nicht im Bestand) und veraltete Bestandseinträge (kein Paar mehr). Pur. */
export function bewerte(paare: string[], bestand: readonly string[]): { neu: string[]; veraltet: string[] } {
  return { neu: paare.filter((p) => !bestand.includes(p)), veraltet: bestand.filter((p) => !paare.includes(p)) };
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

  test("kein neues Paar außerhalb des eingefrorenen Bestands", () => {
    expect(bewerte(paare, BESTAND).neu).toEqual([]);
  });

  test("der Bestand ist nicht veraltet (Ratchet: nur schrumpfen)", () => {
    expect(bewerte(paare, BESTAND).veraltet).toEqual([]);
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
  test("ein Importeur ohne Guard (selbst eine Lib) zählt nicht", () => {
    expect(einstiegsPaare({ a: 'import { x } from "./b.mjs";', b: guard })).toEqual([]);
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
  test("bewerte: neues Paar und veralteter Eintrag werden gemeldet", () => {
    expect(bewerte(["a -> b", "c -> d"], ["a -> b", "x -> y"])).toEqual({ neu: ["c -> d"], veraltet: ["x -> y"] });
  });
});

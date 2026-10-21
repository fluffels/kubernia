/* Wächter gegen handgeschriebene Flag-Schleifen (#1789) – ohne eigenes check-Skript.
 *
 * @harness-waechter – einziger Durchsetzer seiner Regel, darum im geschützten test/harness/.
 *
 * Jede getrackte Datei unter `scripts/`, die `function parseArgs` oder `parseArgs =` deklariert, muss `flagsLesen(`
 * aus `scripts/flag-lib.mjs` aufrufen. Der Import `parseArgs` aus `node:util` ist keine Deklaration. Die noch nicht
 * migrierten Skripte stehen in AUSNAHMEN, je Eintrag mit Kind-Ticket; die Liste darf nur schrumpfen (ein neuer Eintrag
 * ist gegen die Diff-Basis rot), ein verwaister Eintrag ist rot.
 *
 * Bewusste Grenze: eine Schleife unter anderem Namen als `parseArgs` fängt der Wächter nicht.
 */
import { describe, test } from "vitest";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as checkBasis from "../../scripts/check-basis.mjs";

export interface Datei {
  pfad: string;
  text: string;
}
export interface Ausnahme {
  pfad: string;
  ticket: string;
}

/** Die noch nicht migrierten Skripte mit ihrem Kind-Ticket (Epic #1782). */
export const AUSNAHMEN: Ausnahme[] = [
  { pfad: "scripts/hauptchat-zerlegung.mjs", ticket: "#1790" },
  { pfad: "scripts/kontext-treiber.mjs", ticket: "#1790" },
  { pfad: "scripts/langfuse-abgleich.mjs", ticket: "#1790" },
  { pfad: "scripts/lauf-ergebnis.mjs", ticket: "#1790" },
  { pfad: "scripts/pr-warten.mjs", ticket: "#1790" },
  { pfad: "scripts/subagent-laufzeit.mjs", ticket: "#1790" },
  { pfad: "scripts/abnahme.mjs", ticket: "#1791" },
  { pfad: "scripts/board-place.mjs", ticket: "#1791" },
  { pfad: "scripts/sammelticket-anlegen.mjs", ticket: "#1791" },
  { pfad: "scripts/sbom.mjs", ticket: "#1791" },
  { pfad: "scripts/spezifikation.mjs", ticket: "#1791" },
];

const DEKLARATION = /\bfunction\s+parseArgs\b|\bparseArgs\s*=(?!=)/;
const AUFRUF = /\bflagsLesen\(/;
const FIX_LIB = "Fix: Flags über `flagsLesen` aus `scripts/flag-lib.mjs` lesen (Skript-Konvention, docs/agent-harness.md), keine eigene Schleife.";
const FIX_AUSNAHME = "Fix: Eintrag aus AUSNAHMEN streichen.";

/** Probleme: Deklaration ohne `flagsLesen(` und nicht in der Ausnahmeliste, sowie verwaiste oder unbelegte Einträge. Pur. */
export function flagParserProbleme(dateien: Datei[], ausnahmen: Ausnahme[]): string[] {
  const out: string[] = [];
  const nachPfad = new Map(dateien.map((d) => [d.pfad, d.text]));
  const ausgenommen = new Set(ausnahmen.map((a) => a.pfad));
  for (const d of dateien) {
    if (DEKLARATION.test(d.text) && !AUFRUF.test(d.text) && !ausgenommen.has(d.pfad)) {
      out.push(`${d.pfad}: deklariert parseArgs, ohne flagsLesen( aufzurufen. ${FIX_LIB}`);
    }
  }
  for (const a of ausnahmen) {
    if (!/#\d+/.test(a.ticket)) out.push(`${a.pfad}: Ausnahme ohne Kind-Ticket (#<nr>) in AUSNAHMEN. Fix: Ticket nennen.`);
    const text = nachPfad.get(a.pfad);
    if (text === undefined) out.push(`${a.pfad}: verwaister Ausnahme-Eintrag, die Datei fehlt. ${FIX_AUSNAHME}`);
    else if (!DEKLARATION.test(text)) out.push(`${a.pfad}: verwaister Ausnahme-Eintrag, die Datei deklariert kein parseArgs mehr. ${FIX_AUSNAHME}`);
    else if (AUFRUF.test(text)) out.push(`${a.pfad}: verwaister Ausnahme-Eintrag, die Datei ruft schon flagsLesen( auf. ${FIX_AUSNAHME}`);
  }
  return out;
}

/** Pfade, die in `jetzt` stehen, aber nicht in `basis` (die Liste darf nur schrumpfen). */
export function neueAusnahmen(jetzt: Ausnahme[], basis: string[]): string[] {
  return jetzt.filter((a) => !basis.includes(a.pfad)).map((a) => `${a.pfad}: neuer Eintrag in AUSNAHMEN, die Liste darf nur schrumpfen. Fix: das Skript auf flagsLesen umstellen statt eintragen.`);
}

/** Pfade der Einträge aus dem Text dieser Testdatei (`pfad: "scripts/…"`). */
export function ausnahmePfade(quelle: string): string[] {
  return [...quelle.matchAll(/pfad:\s*"(scripts\/[^"]+)"/g)].map((m) => m[1] ?? "");
}

/** Prüfung gegen die Diff-Basis: `pruefen` (Basis da), `entfaellt` (lokal ohne Basis), `rot` (CI ohne Basis, fail-closed). */
export function diffBasisModus(basis: string | null, env: Record<string, string | undefined>): "pruefen" | "entfaellt" | "rot" {
  if (basis !== null) return "pruefen";
  return env.CI === "true" ? "rot" : "entfaellt";
}

const WURZEL = fileURLToPath(new URL("../..", import.meta.url));
const git = (args: string[]): string => execFileSync("git", args, { cwd: WURZEL, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
const SELBST = "test/harness/flag-parser.test.ts";

describe("Flag-Parser-Wächter", () => {
  test("Fixtures: eigene Schleife ist rot, mit flagsLesen und der bloße Import sind grün", () => {
    const f = (text: string): Datei[] => [{ pfad: "scripts/x.mjs", text }];
    assert.equal(flagParserProbleme(f("function parseArgs(argv) { return argv; }"), []).length, 1);
    assert.equal(flagParserProbleme(f("export const parseArgs = (a) => a;"), []).length, 1);
    assert.deepEqual(flagParserProbleme(f("function parseArgs(a) { return flagsLesen(a, {}); }"), []), []);
    assert.deepEqual(flagParserProbleme(f('import { parseArgs } from "node:util";\nparseArgs({});'), []), []);
    assert.deepEqual(flagParserProbleme(f("if (parseArgs === 1) {}"), []), []);
    assert.match(flagParserProbleme(f("function parseArgs() {}"), [])[0] ?? "", /Fix: Flags über `flagsLesen`/);
  });

  test("Fixtures: ausgenommene Datei ist grün, verwaiste und unbelegte Einträge sind rot", () => {
    const alt: Datei = { pfad: "scripts/a.mjs", text: "function parseArgs() {}" };
    assert.deepEqual(flagParserProbleme([alt], [{ pfad: "scripts/a.mjs", ticket: "#1" }]), []);
    const fehlt = flagParserProbleme([], [{ pfad: "scripts/a.mjs", ticket: "#1" }]);
    assert.match(fehlt[0] ?? "", /verwaist.*fehlt.*Fix: Eintrag aus AUSNAHMEN streichen/);
    const ohne = flagParserProbleme([{ pfad: "scripts/a.mjs", text: "export {};" }], [{ pfad: "scripts/a.mjs", ticket: "#1" }]);
    assert.match(ohne[0] ?? "", /kein parseArgs mehr/);
    const migriert = flagParserProbleme([{ pfad: "scripts/a.mjs", text: "function parseArgs(a) { return flagsLesen(a, {}); }" }], [{ pfad: "scripts/a.mjs", ticket: "#1" }]);
    assert.match(migriert[0] ?? "", /ruft schon flagsLesen/);
    assert.match(flagParserProbleme([alt], [{ pfad: "scripts/a.mjs", ticket: "später" }])[0] ?? "", /ohne Kind-Ticket/);
  });

  test("Fixtures: nur schrumpfen", () => {
    assert.deepEqual(neueAusnahmen([{ pfad: "scripts/a.mjs", ticket: "#1" }], ["scripts/a.mjs", "scripts/b.mjs"]), []);
    assert.equal(neueAusnahmen([{ pfad: "scripts/a.mjs", ticket: "#1" }, { pfad: "scripts/c.mjs", ticket: "#1" }], ["scripts/a.mjs"]).length, 1);
    assert.deepEqual(ausnahmePfade('{ pfad: "scripts/a.mjs", ticket: "#1" },\n  { pfad: "scripts/b.mjs", ticket: "#2" }'), ["scripts/a.mjs", "scripts/b.mjs"]);
  });

  test("Fixtures: Diff-Basis-Modus ist in der CI fail-closed", () => {
    assert.equal(diffBasisModus("abc", {}), "pruefen");
    assert.equal(diffBasisModus(null, {}), "entfaellt");
    assert.equal(diffBasisModus(null, { CI: "true" }), "rot");
  });

  test("echter Scan: jedes Skript mit parseArgs ruft flagsLesen( auf oder steht in AUSNAHMEN", () => {
    const pfade = git(["ls-files", "scripts"]).split("\n").filter((p) => /\.(?:mjs|cjs|js)$/.test(p));
    const dateien = pfade.map((pfad) => ({ pfad, text: readFileSync(new URL(`../../${pfad}`, import.meta.url), "utf8") }));
    assert.deepEqual(flagParserProbleme(dateien, AUSNAHMEN), []);
  });

  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
  const basis: string | null = checkBasis.resolveBase(git, process.env) ?? null;
  const basisText = ((): string | null => {
    if (basis === null) return null;
    try {
      return git(["show", `${basis}:${SELBST}`]);
    } catch {
      return null;
    }
  })();

  // Fehlt die Datei an der Basis (der Einführungs-PR), entfällt der Vergleich.
  test.skipIf(diffBasisModus(basis, process.env) === "entfaellt")("die Ausnahmeliste wurde gegen die Diff-Basis nicht erweitert", () => {
    assert.ok(basis, "keine Diff-Basis auflösbar (KQ_DIFF_BASE/origin/main fehlt)");
    if (basisText === null) return;
    assert.deepEqual(neueAusnahmen(AUSNAHMEN, ausnahmePfade(basisText)), []);
  });
});

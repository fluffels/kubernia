/* Wächter der Sparse-Checkouts in den Workflows (#1611, #1693): ein Workflow mit `sparse-checkout:` muss für jedes `node scripts/<x>.mjs`
 * die ganze Import-Hülle von <x> in der Sparse-Liste führen (`sparseProbleme`, pur, mit Fixtures getestet), sonst scheitert der Job mit
 * ERR_MODULE_NOT_FOUND; steht `scripts/projekt-config-lib.mjs` in der Hülle, gehört auch `.factory/projekt.json` in die Liste.
 * Heute checkt kein Workflow sparse aus; der Wächter greift, sobald einer es tut. ci, dependabot-inbox und forum-inbox rufen
 * `scripts/board-place.mjs` (große Import-Hülle) auf und checken darum das volle Repo aus: auch das bewacht dieser Test.
 *
 * Bewusste Grenzen: `importHuelle` erkennt nur `from "<pfad>"` in doppelten Anführungszeichen (kein `import "./x.mjs"`, kein
 * dynamisches `import()`, keine einfachen Anführungszeichen); `sparseListe` liest nur den ersten Sparse-Block je Workflow;
 * erkannt werden nur Aufrufe der Form `node scripts/<name>.mjs`.
 *
 * @harness-waechter – einziger Durchsetzer seiner Regel, darum im geschützten test/harness/ (#1165).
 */
import { describe, test } from "vitest";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, posix } from "node:path";
import { fileURLToPath } from "node:url";
import { besitzAnker } from "../support/besitz-anker";

const WURZEL = fileURLToPath(new URL("../../", import.meta.url));
const EINSTIEG = "scripts/projekt-config.mjs";
const LIB = "scripts/projekt-config-lib.mjs";
const lies = (pfad: string): string => readFileSync(WURZEL + pfad, "utf8");

/** Import-Hülle (Repo-Pfade) eines Skripts samt Einstieg; wirft bei einem Import, der weder `node:` noch relativ ist. Pur bis auf `leser`. */
export function importHuelle(einstieg: string, leser: (pfad: string) => string): string[] {
  const gesehen = new Set<string>();
  const offen = [einstieg];
  while (offen.length > 0) {
    const pfad = offen.pop() as string;
    if (gesehen.has(pfad)) continue;
    gesehen.add(pfad);
    for (const m of leser(pfad).matchAll(/\bfrom\s+"([^"]+)"/g)) {
      const ziel = m[1] ?? "";
      if (ziel.startsWith("node:")) continue;
      if (!ziel.startsWith(".")) throw new Error(`${pfad}: Import '${ziel}' ist weder node: noch relativ`);
      offen.push(posix.join(dirname(pfad), ziel));
    }
  }
  return [...gesehen].sort();
}

/** Dateien der Sparse-Checkout-Liste (`sparse-checkout: |` mit eingerückten Pfadzeilen). */
export function sparseListe(yml: string): string[] {
  const m = /^([ \t]*)sparse-checkout: \|\n((?:\1[ \t]+\S[^\n]*\n)+)/m.exec(yml);
  return m ? (m[2] ?? "").split("\n").map((z) => z.trim()).filter(Boolean) : [];
}

/** Fehlende Sparse-Einträge je `node scripts/<x>.mjs`-Aufruf eines Workflows mit `sparse-checkout:`; ohne Sparse-Block leer. Pur bis auf `leser`. */
export function sparseProbleme(yml: string, leser: (pfad: string) => string): string[] {
  if (!yml.includes("sparse-checkout:")) return [];
  const liste = sparseListe(yml);
  const probleme: string[] = [];
  for (const m of yml.matchAll(/\bnode scripts\/([\w.-]+\.mjs)/g)) {
    const skript = `scripts/${m[1] ?? ""}`;
    const huelle = importHuelle(skript, leser);
    const noetig = huelle.includes(LIB) ? [".factory/projekt.json", ...huelle] : huelle;
    for (const datei of noetig) if (!liste.includes(datei)) probleme.push(`${skript}: ${datei} fehlt in sparse-checkout`);
  }
  return [...new Set(probleme)];
}

describe("importHuelle / sparseListe", () => {
  const quellen: Record<string, string> = {
    "s/a.mjs": 'import { x } from "node:fs";\nimport { y } from "./b.mjs";',
    "s/b.mjs": 'import { z } from "node:path";',
    "s/c.mjs": 'import { y } from "./fremd-paket";\nimport q from "lodash";',
  };
  test("Hülle folgt relativen Importen, ignoriert node:", () => {
    assert.deepEqual(importHuelle("s/a.mjs", (p) => quellen[p] ?? ""), ["s/a.mjs", "s/b.mjs"]);
  });
  test("zyklische und mehrfach erreichte Importe terminieren, jede Datei einmal", () => {
    const zyklus: Record<string, string> = { "s/x.mjs": 'import a from "./y.mjs";', "s/y.mjs": 'import b from "./x.mjs";' };
    assert.deepEqual(importHuelle("s/x.mjs", (p) => zyklus[p] ?? ""), ["s/x.mjs", "s/y.mjs"]);
    const diamant: Record<string, string> = { "s/a.mjs": 'import b from "./b.mjs";\nimport c from "./c.mjs";', "s/b.mjs": 'import c from "./c.mjs";', "s/c.mjs": "" };
    assert.deepEqual(importHuelle("s/a.mjs", (p) => diamant[p] ?? ""), ["s/a.mjs", "s/b.mjs", "s/c.mjs"]);
  });
  test("ein Import aus dem Elternordner zählt als relativ", () => {
    const eltern: Record<string, string> = { "s/a.mjs": 'import b from "../lib/b.mjs";', "lib/b.mjs": "" };
    assert.deepEqual(importHuelle("s/a.mjs", (p) => eltern[p] ?? ""), ["lib/b.mjs", "s/a.mjs"]);
  });
  test("ein Paketimport bricht ab", () => {
    assert.throws(() => importHuelle("s/c.mjs", (p) => quellen[p] ?? ""), /weder node: noch relativ/);
  });
  test("sparseListe liest die Zeilen, ohne Liste leer", () => {
    assert.deepEqual(sparseListe("with:\n  sparse-checkout: |\n    a\n    b/c\n  x: 1\n"), ["a", "b/c"]);
    assert.deepEqual(sparseListe("with:\n  x: 1\n"), []);
  });
});

describe("sparseProbleme", () => {
  const quellen: Record<string, string> = {
    "scripts/a.mjs": 'import { l } from "./projekt-config-lib.mjs";',
    [LIB]: "",
    "scripts/b.mjs": 'import { x } from "node:fs";',
  };
  const leser = (p: string): string => quellen[p] ?? "";
  const yml = (liste: string[], aufruf: string): string =>
    `steps:\n  - uses: x\n    with:\n      sparse-checkout: |\n${liste.map((z) => `        ${z}\n`).join("")}  - run: ${aufruf}\n`;
  test("vollständige Liste (Skript, Lib, Config) ohne Befund", () => {
    assert.deepEqual(sparseProbleme(yml(["scripts/a.mjs", LIB, ".factory/projekt.json"], "node scripts/a.mjs"), leser), []);
  });
  test("fehlende Lib wird gemeldet", () => {
    assert.deepEqual(sparseProbleme(yml(["scripts/a.mjs", ".factory/projekt.json"], "node scripts/a.mjs"), leser), [`scripts/a.mjs: ${LIB} fehlt in sparse-checkout`]);
  });
  test("fehlende Config wird gemeldet, wenn die Lib in der Hülle steht", () => {
    assert.deepEqual(sparseProbleme(yml(["scripts/a.mjs", LIB], "node scripts/a.mjs"), leser), ["scripts/a.mjs: .factory/projekt.json fehlt in sparse-checkout"]);
  });
  test("ohne Lib in der Hülle ist die Config nicht nötig", () => {
    assert.deepEqual(sparseProbleme(yml(["scripts/b.mjs"], "node scripts/b.mjs"), leser), []);
  });
  test("das aufgerufene Skript selbst fehlt in der Liste", () => {
    assert.deepEqual(sparseProbleme(yml(["scripts/b.mjs"], "node scripts/a.mjs"), leser), [
      "scripts/a.mjs: .factory/projekt.json fehlt in sparse-checkout",
      "scripts/a.mjs: scripts/a.mjs fehlt in sparse-checkout",
      `scripts/a.mjs: ${LIB} fehlt in sparse-checkout`,
    ]);
  });
  test("derselbe Befund bei zwei Aufrufen (und gemeinsamer Lib zweier Skripte) wird nur einmal gemeldet", () => {
    assert.deepEqual(sparseProbleme(yml(["scripts/a.mjs", ".factory/projekt.json"], "node scripts/a.mjs\n  - run: node scripts/a.mjs"), leser), [`scripts/a.mjs: ${LIB} fehlt in sparse-checkout`]);
  });
  test("Workflow ohne Sparse-Checkout wird ignoriert", () => {
    assert.deepEqual(sparseProbleme("steps:\n  - run: node scripts/a.mjs\n", leser), []);
  });
});

describe("Sparse-Checkout der Workflows", () => {
  test("die Hülle des Einstiegs enthält die Lib und nur Dateien des Kerns", () => {
    const huelle = importHuelle(EINSTIEG, lies);
    assert.ok(huelle.includes(LIB));
    // Genau diese sechs: die Lib zieht die Spezifikations-Lib (`spracheMaengel`), die nur die Builtin-Fence-Helfer `markdown.mjs` (SSOT der Code-Fences) importiert, und die importfreien Skill-Pfade nach; jede weitere Datei ist ein bewusster Commit.
    assert.deepEqual(huelle, ["scripts/docs-gen/markdown.mjs", "scripts/flag-lib.mjs", LIB, EINSTIEG, "scripts/skill-pfade.mjs", "scripts/spezifikation-lib.mjs"],`Hülle wächst: ${huelle.join(", ")}`);
  });
  test("Workflows mit board-place.mjs checken das volle Repo aus und richten Node ein (#1628)", () => {
    const vorhanden = readdirSync(WURZEL + ".github/workflows").filter((n) => n.endsWith(".yml"));
    const nutzer = vorhanden.filter((n) => lies(`.github/workflows/${n}`).includes("scripts/board-place.mjs"));
    // Leerlauf-Schutz (#1933): jeder verteilte Besitz-Workflow liegt im Scan, und jeder davon, der board-place.mjs nennt, ist unter den Nutzern (Menge nicht leer).
    const besitz = besitzAnker((p) => /^\.github\/workflows\/[^/]+\.yml$/.test(p)).map((p) => p.slice(".github/workflows/".length));
    for (const n of besitz) assert.ok(vorhanden.includes(n), `Leerlauf-Schutz: ${n} liegt im Scan`);
    const besitzNutzer = besitz.filter((n) => lies(`.github/workflows/${n}`).includes("scripts/board-place.mjs"));
    assert.ok(besitzNutzer.length > 0, "Leerlauf-Schutz: kein Besitz-Workflow nennt board-place.mjs");
    for (const n of besitzNutzer) assert.ok(nutzer.includes(n), `${n} fehlt unter den board-place-Nutzern`);
    for (const n of nutzer) {
      const yml = lies(`.github/workflows/${n}`);
      assert.ok(!yml.includes("sparse-checkout:"), `${n}: board-place.mjs braucht seine ganze Import-Hülle, kein Sparse-Checkout`);
      assert.match(yml, /actions[/]checkout@v7/, `${n}: Checkout fehlt`);
      assert.match(yml, /actions[/]setup-node@v7/, `${n}: setup-node fehlt`);
    }
  });
  test("alle echten Workflows: jede Sparse-Liste trägt die Import-Hülle ihrer Skripte", () => {
    const namen = readdirSync(WURZEL + ".github/workflows").filter((n) => n.endsWith(".yml"));
    assert.ok(namen.length > 0, "keine Workflows gefunden");
    const probleme = namen.flatMap((n) => sparseProbleme(lies(`.github/workflows/${n}`), lies).map((p) => `${n}: ${p}`));
    assert.deepEqual(probleme, []);
  });
});

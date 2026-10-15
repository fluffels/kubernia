/* Wächter der Projekt-Config in den Workflows (#1611): ci.yml und dependabot-inbox.yml checken nur die Config und den Lader
 * per Sparse-Checkout aus. Fehlt eine Datei der Import-Hülle von `scripts/projekt-config.mjs` in der Liste, scheitert der Lader
 * im Job mit ERR_MODULE_NOT_FOUND, `set_board_top` meldet nur `::error::` und die Board-Position bleibt still ungesetzt.
 *
 * @harness-waechter – einziger Durchsetzer seiner Regel, darum im geschützten test/harness/ (#1165).
 */
import { describe, test } from "vitest";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, posix } from "node:path";
import { fileURLToPath } from "node:url";

const WURZEL = fileURLToPath(new URL("../../", import.meta.url));
const EINSTIEG = "scripts/projekt-config.mjs";
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
      if (!ziel.startsWith("./")) throw new Error(`${pfad}: Import '${ziel}' ist weder node: noch relativ`);
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

describe("importHuelle / sparseListe", () => {
  const quellen: Record<string, string> = {
    "s/a.mjs": 'import { x } from "node:fs";\nimport { y } from "./b.mjs";',
    "s/b.mjs": 'import { z } from "node:path";',
    "s/c.mjs": 'import { y } from "./fremd-paket";\nimport q from "lodash";',
  };
  test("Hülle folgt relativen Importen, ignoriert node:", () => {
    assert.deepEqual(importHuelle("s/a.mjs", (p) => quellen[p] ?? ""), ["s/a.mjs", "s/b.mjs"]);
  });
  test("ein Paketimport bricht ab", () => {
    assert.throws(() => importHuelle("s/c.mjs", (p) => quellen[p] ?? ""), /weder node: noch relativ/);
  });
  test("sparseListe liest die Zeilen, ohne Liste leer", () => {
    assert.deepEqual(sparseListe("with:\n  sparse-checkout: |\n    a\n    b/c\n  x: 1\n"), ["a", "b/c"]);
    assert.deepEqual(sparseListe("with:\n  x: 1\n"), []);
  });
});

describe("Sparse-Checkout der Projekt-Config in den Workflows", () => {
  const huelle = importHuelle(EINSTIEG, lies);
  test("die Hülle des Einstiegs enthält die Lib und nur Dateien des Kerns", () => {
    assert.ok(huelle.includes("scripts/projekt-config-lib.mjs"));
    assert.ok(huelle.length <= 3, `Hülle wächst: ${huelle.join(", ")}`);
  });
  for (const wf of ["ci", "dependabot-inbox"]) {
    const yml = lies(`.github/workflows/${wf}.yml`);
    test(`${wf}.yml: Sparse-Liste enthält Config und die ganze Import-Hülle, Checkout bricht den Job nicht ab`, () => {
      const liste = sparseListe(yml);
      for (const datei of [".factory/projekt.json", ...huelle]) assert.ok(liste.includes(datei), `${wf}.yml: ${datei} fehlt in sparse-checkout`);
      assert.match(yml, /name: Projekt-Config auschecken\n\s+continue-on-error: true\n\s+uses: actions\/checkout/);
    });
  }
});

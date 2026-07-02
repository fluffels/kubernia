/* #527: `npm run verify` ist die EINE SSOT-Kette über alle Gates.
 *
 * Motivation (siehe Ticket #527): Vor diesem Ticket musste ein Agent typecheck +
 * lint + check:arch + check:size + check:docmap + test EINZELN laufen lassen und
 * die CI listete dieselben Schritte separat – zwei Drift-Risiken: (a) ein Agent
 * VERGISST lokal ein Gate (die CI fängt es erst nach dem Direkt-Push auf main),
 * (b) CI-Reihenfolge und lokale Reihenfolge laufen auseinander.
 *
 * Diese Fitness-Function sichert genau das ab:
 *  - `verify` existiert und ruft JEDES Einzel-Gate auf (kein vergessenes Gate –
 *    auch ein künftig neu hinzugefügtes `check:*` muss in die Kette),
 *  - `verify:full` erweitert `verify` um beide Builds + den Boot-Smoke,
 *  - die CI ruft die `verify`-Kette auf, statt die Gates einzeln zu duplizieren.
 *
 * Rein struktureller Wächter (wie readme/docmap/filesize) – bewusst kein
 * Verhaltens-Test. Ausführen mit:  npm test
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const readRepo = (rel: string) =>
  readFileSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)), "utf8");

const pkg = JSON.parse(readRepo("package.json")) as {
  scripts: Record<string, string>;
};
const scripts = pkg.scripts;

// Build-ABHÄNGIGE Gates messen die GEBAUTEN Artefakte und können darum nicht in
// der build-freien `verify`-Kette laufen – sie gehören (wie test:coverage) hinter
// die Builds in `verify:full`. #503: check:bundle misst dist-offline/index.html +
// die dist/-Chunks, existiert also erst NACH `build`/`build:offline`.
const BUILD_DEPENDENT_GATES = new Set(["check:bundle"]);

// Die build-freien Einzel-Gates, die `verify` fährt: jedes `check:*` (außer den
// build-abhängigen) plus die drei Namens-Gates. Aus den Scripts abgeleitet, damit
// ein neu hinzugefügtes `check:*`-Gate den Test automatisch mitzieht (statt hier zu
// verrotten).
const GATE_SCRIPTS = [
  ...Object.keys(scripts).filter((n) => n.startsWith("check:") && !BUILD_DEPENDENT_GATES.has(n)),
  "typecheck",
  "lint",
  "test",
];

describe("#527 verify: eine SSOT-Kette über alle Gates", () => {
  it("`verify` existiert und ruft JEDES Einzel-Gate auf (kein vergessenes Gate)", () => {
    const verify = scripts.verify;
    expect(verify, "npm run verify muss existieren").toBeTruthy();
    for (const gate of GATE_SCRIPTS) {
      // `test` läuft als npm-Lifecycle `npm test`, die übrigen als `npm run <gate>`.
      const needle =
        gate === "test"
          ? /\bnpm test\b/
          : new RegExp(`\\bnpm run ${gate.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`);
      expect(verify, `verify muss das Gate "${gate}" enthalten`).toMatch(needle);
    }
  });

  it("`verify:full` erweitert `verify` um beide Builds + Boot-Smoke", () => {
    const full = scripts["verify:full"];
    expect(full, "npm run verify:full muss existieren").toBeTruthy();
    expect(full).toMatch(/\bnpm run verify\b/);
    expect(full).toMatch(/\bnpm run build\b/);
    expect(full).toMatch(/\bnpm run build:offline\b/);
    expect(full).toMatch(/\bnpm run (test:smoke|smoke)\b/);
  });

  it("build-abhängige Gates (#503 check:bundle) laufen in verify:full, NACH den Builds", () => {
    const full = scripts["verify:full"];
    for (const gate of BUILD_DEPENDENT_GATES) {
      const needle = new RegExp(`\\bnpm run ${gate.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`);
      expect(full, `verify:full muss das build-abhängige Gate "${gate}" enthalten`).toMatch(needle);
      // ... und zwar hinter build:offline (sonst fehlt das gemessene Artefakt).
      expect(
        full.indexOf(`npm run ${gate}`) > full.indexOf("npm run build:offline"),
        `"${gate}" muss NACH "build:offline" stehen`,
      ).toBe(true);
      // NICHT in der build-freien verify-Kette (dort gäbe es kein Artefakt zu messen).
      expect(
        new RegExp(`\\bnpm run ${gate.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(scripts.verify),
        `"${gate}" darf NICHT in der build-freien verify-Kette stehen`,
      ).toBe(false);
    }
  });

  it("die CI ruft die `verify`-Kette auf, statt die Gates einzeln zu duplizieren", () => {
    const ci = readRepo(".github/workflows/ci.yml");
    expect(ci, "ci.yml muss npm run verify aufrufen").toMatch(/\bnpm run verify\b/);
    // Die alten, einzeln duplizierten Gate-Steps dürfen NICHT mehr da sein –
    // sonst ist die SSOT wieder aufgeweicht (Gate läuft doppelt / kann driften).
    for (const gate of ["check:arch", "check:size", "check:docmap"]) {
      expect(
        ci.includes(`npm run ${gate}`),
        `ci.yml darf "${gate}" nicht mehr als eigenen Step fahren (läuft jetzt über npm run verify)`,
      ).toBe(false);
    }
  });
});

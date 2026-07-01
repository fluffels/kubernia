/* #528: Git pre-push-Hook — schnelle Gates lokal VOR `git push origin main`.
 *
 * Motivation (siehe Ticket #528): Der Workflow pusht bewusst DIREKT auf main
 * (kein PR/Required-Checks). Die CI-Gates laufen dadurch erst NACH dem Push —
 * in der Lücke dazwischen kann kaputter Code main rot machen. Ein committeter,
 * per `npm run setup` via `core.hooksPath` verdrahteter pre-push-Hook schließt
 * genau diese Lücke, indem er `npm run verify` lokal fährt und den Push bei Rot
 * abbricht (Umgehung bewusst per `git push --no-verify`).
 *
 * Diese Fitness-Function sichert ab, dass der Schutz nicht leise wegbröckelt:
 *  - der Hook existiert und fährt die verify-Kette (nicht ein Einzel-Gate),
 *  - er greift nur beim Push auf main (Feature-Branches bleiben schnell),
 *  - `npm run setup` verdrahtet ihn über core.hooksPath → .githooks (kein husky),
 *  - die Umgehungs-Option ist dokumentiert (Notfall bleibt möglich).
 *
 * Rein struktureller Wächter (wie readme/docmap/verify-script) – kein
 * Verhaltens-Test. Ausführen mit:  npm test
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const readRepo = (rel: string) =>
  readFileSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)), "utf8");

const hook = readRepo(".githooks/pre-push");
const setup = readRepo("scripts/setup.mjs");

describe("#528 pre-push-Hook: schnelle Gates vor Push auf main", () => {
  it("fährt die verify-Kette (nicht nur ein Einzel-Gate)", () => {
    expect(hook, "pre-push muss npm run verify aufrufen").toMatch(
      /\bnpm run verify\b/,
    );
    // NICHT verify:full — Builds/Boot-Smoke sind bewusst der CI überlassen,
    // damit der Hook zügig bleibt.
    expect(
      /\bnpm run verify:full\b/.test(hook),
      "pre-push darf NICHT verify:full fahren (zu langsam; Builds/Smoke macht die CI)",
    ).toBe(false);
  });

  it("greift nur beim Push auf main (Feature-Branches bleiben schnell)", () => {
    expect(
      hook,
      "pre-push muss auf refs/heads/main prüfen",
    ).toMatch(/refs\/heads\/main/);
  });

  it("bricht den Push bei Rot ab (exit-Code ≠ 0 im Rot-Fall)", () => {
    expect(hook, "pre-push muss im Rot-Fall exit 1 setzen").toMatch(/exit 1/);
  });

  it("dokumentiert die bewusste Notfall-Umgehung (--no-verify)", () => {
    expect(hook).toMatch(/--no-verify/);
  });

  it("wird von `npm run setup` über core.hooksPath → .githooks verdrahtet (kein husky)", () => {
    expect(
      setup,
      "setup.mjs muss core.hooksPath auf .githooks setzen",
    ).toMatch(/core\.hooksPath[^\n]*\.githooks/);
    // Kein husky-Dep: die Verdrahtung läuft nativ über git config.
    const pkg = JSON.parse(readRepo("package.json")) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const allDeps = {
      ...(pkg.dependencies ?? {}),
      ...(pkg.devDependencies ?? {}),
    };
    expect(
      Object.keys(allDeps).some((d) => d === "husky"),
      "husky darf keine Abhängigkeit sein – Hook läuft nativ über core.hooksPath",
    ).toBe(false);
  });
});

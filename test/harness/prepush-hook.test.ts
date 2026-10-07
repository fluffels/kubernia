/* #528: Git pre-push-Hook — schnelle Gates lokal vor einem Push auf `main`.
 *
 * @harness-waechter – einziger Durchsetzer seiner Regel, darum im geschützten test/harness/ (#1165).
 *
 * Motivation (Ticket #528, seit #592 nur noch Zusatznetz): `main` ist
 * server-seitig PR-gegated (Ruleset main-schutz ohne Bypass-Akteure, ADR 0009) — der
 * maßgebliche, nicht umgehbare Riegel sind die Required-Checks auf dem PR. Das
 * frühe lokale Feedback vor dem PR holt sich der Agent per manuellem
 * `npm run verify`. Der committete, per `npm run setup` via `core.hooksPath`
 * verdrahtete pre-push-Hook bleibt als Restnetz für den Fall, dass die
 * Protection je gelockert wird: Bei einem Push auf `main` fährt er
 * `npm run verify` lokal und bricht bei Rot ab (Umgehung bewusst per
 * `git push --no-verify`). Feature-Branch-Pushes lässt er ungeprüft durch.
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
  readFileSync(fileURLToPath(new URL(`../../${rel}`, import.meta.url)), "utf8");

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
    // Ohne Push auf main steigt der Hook früh grün aus, BEVOR verify läuft –
    // sonst würde jeder Feature-Branch-Push (rot→fix-Schleife) ausgebremst.
    // Die Spanne endet am eigenen `fi` – ein `exit 0` aus einem späteren Block
    // (z.B. dem Grün-Zweig nach verify) zählt nicht als Früh-Ausstieg.
    const earlyExit = /push_to_main"?\s*-eq\s*0(?:(?!\bfi\b)[\s\S])*?\bexit 0\b/.exec(
      hook,
    );
    expect(
      earlyExit,
      "pre-push muss ohne Push auf main früh mit exit 0 aussteigen",
    ).not.toBeNull();
    const verifyCall = hook.search(/^\s*if\s+npm run verify\b/m);
    expect(verifyCall, "pre-push muss `if npm run verify` enthalten").toBeGreaterThan(-1);
    expect(
      earlyExit!.index + earlyExit![0].length,
      "der Früh-Ausstieg muss VOR dem verify-Aufruf stehen",
    ).toBeLessThan(verifyCall);
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

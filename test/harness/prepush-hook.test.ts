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
 * `git push --no-verify`). Bei anderen Branches fährt er nur `check:diffsize` (#1740).
 *
 * Diese Fitness-Function sichert ab, dass der Schutz nicht leise wegbröckelt:
 *  - der Hook existiert und fährt die verify-Kette (nicht ein Einzel-Gate),
 *  - das volle verify greift nur beim Push auf main (Feature-Branches fahren nur den schnellen Diffsize-Check),
 *  - `npm run setup` verdrahtet ihn über core.hooksPath → .githooks (kein husky),
 *  - Pushes anderer Branches fahren `node scripts/check-diffsize.mjs` und brechen bei Rot ab (Verhaltens-Test mit Attrappe im Temp-Ordner),
 *  - die Umgehungs-Option ist dokumentiert (Notfall bleibt möglich).
 *
 * Strukturelle Wächter (wie readme/docmap/verify-script) plus ein Verhaltens-Test
 * des Diffsize-Zweigs mit Attrappe. Ausführen mit:  npm test
 */
import { afterEach, describe, it, expect } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { spawnSync } from "node:child_process";
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

const hatSh = spawnSync("sh", ["-c", "exit 0"]).status === 0;
const OID = "1".repeat(40);

describe.skipIf(!hatSh)("#1740 pre-push-Hook: Diffsize bei Pushes anderer Branches", () => {
  const dirs: string[] = [];
  afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });
  // Temp-Ordner mit Attrappe `scripts/check-diffsize.mjs`, die mit `exitCode` endet; der Hook läuft mit cwd dort.
  const lauf = (exitCode: number, ref: string, oid = OID) => {
    const d = mkdtempSync(join(tmpdir(), "prepush-"));
    dirs.push(d);
    mkdirSync(join(d, "scripts"));
    writeFileSync(join(d, "scripts", "check-diffsize.mjs"), `console.log("attrappe diffsize"); process.exit(${exitCode});`);
    const hookPfad = fileURLToPath(new URL("../../.githooks/pre-push", import.meta.url)).replaceAll("\\", "/");
    return spawnSync("sh", [hookPfad, "origin", "x"], { cwd: d, input: `${ref} ${oid} ${ref} ${"0".repeat(40)}\n`, encoding: "utf8" });
  };
  it("rotes check:diffsize bricht den Push eines Feature-Branches ab und nennt den Override", () => {
    const r = lauf(1, "refs/heads/feature/x");
    expect(r.status, r.stdout + r.stderr).toBe(1);
    expect(r.stdout).toContain("Diffsize-Override");
  });
  it("grünes check:diffsize lässt den Feature-Branch-Push durch", () => {
    const r = lauf(0, "refs/heads/feature/x");
    expect(r.status, r.stdout + r.stderr).toBe(0);
    expect(r.stdout).toContain("attrappe diffsize");
  });
  it("Branch-Löschung (lauter Nullen) prüft nichts", () => {
    const r = lauf(1, "refs/heads/feature/x", "0".repeat(40));
    expect(r.status, r.stdout + r.stderr).toBe(0);
    expect(r.stdout).not.toContain("attrappe diffsize");
  });
});

describe.skipIf(!hatSh)("#1762 L21c pre-push-Hook: welches Gate läuft bei welchem Push", () => {
  const dirs: string[] = [];
  afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });
  // Temp-Ordner mit Attrappe `scripts/check-diffsize.mjs` und einem falschen `npm` vorn im PATH; beide protokollieren ihren Aufruf.
  const lauf = (refs: { ref: string; oid?: string }[], { verifyExit = 0, diffsizeExit = 0 } = {}) => {
    const d = mkdtempSync(join(tmpdir(), "prepush-"));
    dirs.push(d);
    const log = join(d, "aufrufe.log").replaceAll("\\", "/");
    mkdirSync(join(d, "scripts"));
    mkdirSync(join(d, "bin"));
    writeFileSync(
      join(d, "scripts", "check-diffsize.mjs"),
      `import { appendFileSync } from "node:fs"; appendFileSync(${JSON.stringify(log)}, "diffsize\\n"); process.exit(${diffsizeExit});`,
    );
    writeFileSync(join(d, "bin", "npm"), `#!/bin/sh\necho "npm $*" >> "${log}"\nexit ${verifyExit}\n`, { mode: 0o755 });
    const hookPfad = fileURLToPath(new URL("../../.githooks/pre-push", import.meta.url)).replaceAll("\\", "/");
    const input = refs.map(({ ref, oid = OID }) => `${ref} ${oid} ${ref} ${"0".repeat(40)}\n`).join("");
    const r = spawnSync("sh", [hookPfad, "origin", "x"], {
      cwd: d,
      input,
      encoding: "utf8",
      env: { ...process.env, PATH: join(d, "bin") + delimiter + (process.env.PATH ?? "") },
    });
    const aufrufe = existsSync(log) ? readFileSync(log, "utf8").trim().split("\n") : [];
    return { r, aufrufe };
  };

  it("Push auf main fährt npm run verify und keinen Diffsize-Check", () => {
    const { r, aufrufe } = lauf([{ ref: "refs/heads/main" }]);
    expect(r.status, r.stdout + r.stderr).toBe(0);
    expect(aufrufe).toEqual(["npm run verify"]);
  });

  it("rotes verify bricht den Push auf main ab", () => {
    const { r, aufrufe } = lauf([{ ref: "refs/heads/main" }], { verifyExit: 1 });
    expect(r.status, r.stdout + r.stderr).toBe(1);
    expect(aufrufe).toEqual(["npm run verify"]);
  });

  it("Push eines anderen Branches fährt check-diffsize und kein verify", () => {
    const { r, aufrufe } = lauf([{ ref: "refs/heads/feature/x" }]);
    expect(r.status, r.stdout + r.stderr).toBe(0);
    expect(aufrufe).toEqual(["diffsize"]);
  });

  it("Löschung von main (nur Nullen) fährt weder verify noch Diffsize", () => {
    const { r, aufrufe } = lauf([{ ref: "refs/heads/main", oid: "0".repeat(40) }]);
    expect(r.status, r.stdout + r.stderr).toBe(0);
    expect(aufrufe).toEqual([]);
  });

  it("main und Feature-Branch zugleich: erst Diffsize, dann verify", () => {
    const { r, aufrufe } = lauf([{ ref: "refs/heads/main" }, { ref: "refs/heads/feature/x" }]);
    expect(r.status, r.stdout + r.stderr).toBe(0);
    expect(aufrufe).toEqual(["diffsize", "npm run verify"]);
  });

  it("rotes Diffsize bricht ab, bevor verify läuft", () => {
    const { r, aufrufe } = lauf([{ ref: "refs/heads/main" }, { ref: "refs/heads/feature/x" }], { diffsizeExit: 1 });
    expect(r.status, r.stdout + r.stderr).toBe(1);
    expect(aufrufe).toEqual(["diffsize"]);
  });
});

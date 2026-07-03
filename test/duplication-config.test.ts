/* Duplikations-Detektor-Wächter (#612) — hält die BEWUSST WEICHE Auslegung des
 * jscpd-Copy-Paste-Reports ehrlich. Struktureller Wächter (wie docdrift/bundle/
 * coverage-config), kein Verhaltens-Test.
 *
 * Hintergrund (iSAQB-Runde 3, docs/architektur-analyse-2026-07-03-iSAQB.md): die
 * SSOT-Umgehungen (#534/#577/#578, _resetNodes/#596) sind die einzige Regressionsklasse
 * ohne direkten Guard — nur der Invariant (wirft bei illegalem State) + Review fangen sie,
 * ein Copy-Paste-Detektor fehlte. jscpd macht Copy-Paste früh sichtbar, ist aber ABSICHTLICH
 * ein nur-berichtendes CI-Artefakt: harte Duplikat-Schwellen erzeugen viele False Positives
 * und würden — wie das dev-`npm audit` aus #395 — sonst abgeschaltet. Dieser Wächter hält
 * genau diese Entscheidung fest, damit sie nicht still zu einem harten Gate umkippt:
 *
 *   1. Werkzeug da: jscpd als devDependency + `check:duplication`-Skript (= `jscpd src`).
 *   2. Reporting-only: .jscpd.json setzt KEINEN `threshold` (jscpd exit 0 unabhängig von der
 *      Duplikatquote) und schreibt einen JSON-Report (maschinenlesbares Artefakt).
 *   3. Report-Ordner nie ins Repo (gitignored).
 *   4. NICHT-blockierend: `check:duplication` ist NICHT Teil der Gate-Ketten `verify`/
 *      `verify:full`, und der CI-Job fährt es mit `continue-on-error`.
 *
 * Ausführen mit:  npm test
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

const pkg = JSON.parse(read("package.json")) as {
  scripts: Record<string, string>;
  devDependencies: Record<string, string>;
};
const jscpdConfig = JSON.parse(read(".jscpd.json")) as Record<string, unknown>;

describe("Duplikations-Detektor (#612) — bewusst weich", () => {
  it("Werkzeug vorhanden: jscpd-devDep + check:duplication-Skript", () => {
    expect(pkg.devDependencies.jscpd, "jscpd muss devDependency sein").toBeTruthy();
    expect(pkg.scripts["check:duplication"], "check:duplication-Skript fehlt").toBeTruthy();
    // Das Skript ruft jscpd auf (Pfad als Arg, weil jscpd `path` aus der Config ohne Arg ignoriert).
    expect(pkg.scripts["check:duplication"]).toMatch(/\bjscpd\b/);
  });

  it("reporting-only: KEIN blockierender threshold in .jscpd.json", () => {
    // Der Kern der „weichen" Auslegung: ohne threshold beendet jscpd immer mit exit 0,
    // egal wie hoch die Duplikatquote ist. Ein gesetzter threshold würde den Report zu
    // einem harten Gate machen — genau das soll dieser Test verhindern (#612: bewusst weich).
    expect(
      "threshold" in jscpdConfig,
      "jscpd darf keinen `threshold` setzen — sonst wird der Report ein hartes Gate (siehe #612).",
    ).toBe(false);
  });

  it("erzeugt ein maschinenlesbares JSON-Artefakt in einem gitignorierten Ordner", () => {
    const reporters = jscpdConfig.reporters as string[] | undefined;
    expect(Array.isArray(reporters) && reporters.includes("json"), "json-Reporter fehlt").toBe(true);
    const output = jscpdConfig.output as string | undefined;
    expect(output, "output-Ordner fehlt").toBeTruthy();
    expect(read(".gitignore"), `${output}/ muss gitignored sein`).toContain(`${output}/`);
  });

  it("NICHT-blockierend: check:duplication ist in keiner Gate-Kette (verify/verify:full)", () => {
    expect(pkg.scripts.verify ?? "", "check:duplication darf nicht in `verify` hängen").not.toContain(
      "check:duplication",
    );
    expect(pkg.scripts["verify:full"] ?? "", "check:duplication darf nicht in `verify:full` hängen").not.toContain(
      "check:duplication",
    );
  });

  it("CI fährt den Report nicht-blockierend (eigener Job, continue-on-error)", () => {
    const ci = read(".github/workflows/ci.yml");
    expect(ci, "CI ruft check:duplication nicht auf").toContain("npm run check:duplication");
    // Der jscpd-Schritt trägt continue-on-error, damit ein jscpd-Fehler die CI nie rot färbt.
    const stepIdx = ci.indexOf("npm run check:duplication");
    const windowBefore = ci.slice(Math.max(0, stepIdx - 200), stepIdx);
    expect(windowBefore, "jscpd-CI-Schritt braucht continue-on-error").toContain("continue-on-error: true");
  });
});

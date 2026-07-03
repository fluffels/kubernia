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

// Netz-/nicht-deterministische Gates, die bewusst NICHT in der hermetischen,
// offline-fähigen `verify`-Kette laufen dürfen: #610 check:doctickets gleicht die
// offen-markierten Roadmap-Tickets gegen den echten `gh issue`-Status ab — das
// braucht Netz + Token und ist nicht deterministisch. Es läuft als eigener,
// non-blocking CI-Job (alarmierend) + lokal auf Zuruf, nicht als verify-Gate.
const NETWORK_DEPENDENT_GATES = new Set(["check:doctickets"]);

// Bewusst WEICHE, NICHT-blockierende `check:*` — keine Gates, sondern nur berichtende
// CI-Artefakte, die daher AUSDRÜCKLICH NICHT in die `verify`-Kette gehören. #612:
// check:duplication (jscpd) ist ein reiner Copy-Paste-Report ohne `threshold`; ein
// Platz in `verify` würde ihn zum harten Gate machen — genau das soll er nicht sein
// (die weiche Auslegung sichert test/duplication-config.test.ts).
const SOFT_NONBLOCKING_GATES = new Set(["check:duplication"]);

// Die build-freien Einzel-Gates, die `verify` fährt: jedes `check:*` (außer den
// build-, netzabhängigen und bewusst weichen) plus die drei Namens-Gates. Aus den
// Scripts abgeleitet, damit ein neu hinzugefügtes `check:*`-Gate den Test automatisch
// mitzieht (statt hier zu verrotten).
const GATE_SCRIPTS = [
  ...Object.keys(scripts).filter(
    (n) =>
      n.startsWith("check:") &&
      !BUILD_DEPENDENT_GATES.has(n) &&
      !NETWORK_DEPENDENT_GATES.has(n) &&
      !SOFT_NONBLOCKING_GATES.has(n),
  ),
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

  it("netzabhängige Gates (#610 check:doctickets) laufen NICHT in verify, sondern als eigener CI-Job", () => {
    for (const gate of NETWORK_DEPENDENT_GATES) {
      const needle = new RegExp(`\\bnpm run ${gate.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`);
      // Nicht in der hermetischen verify-Kette (dort gäbe es kein Netz/Token).
      expect(
        needle.test(scripts.verify),
        `"${gate}" darf NICHT in der offline-fähigen verify-Kette stehen`,
      ).toBe(false);
      // Aber es MUSS ein package.json-Skript sein (existiert & wird gepflegt).
      expect(scripts[gate], `"${gate}" muss als package.json-Skript existieren`).toBeTruthy();
      // ... und als eigener Schritt in der CI laufen (sonst alarmiert es nie automatisch).
      const ci = readRepo(".github/workflows/ci.yml");
      expect(ci.includes(`scripts/check-doc-tickets.mjs`) || needle.test(ci)).toBe(true);
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

/* #605: das CI-Post-hoc-Netz auf `main` — die zweite Grenze hinter dem PR-Gate #592.
 * Struktureller Wächter (wie oben): stellt sicher, dass die zwei Bausteine des Netzes
 * in ci.yml erhalten bleiben und nicht still zurückdriften:
 *  1. check:diffsize misst auf push:main gegen den Vorgänger-Commit (KQ_DIFF_BASE
 *     = github.event.before) — statt dort wie früher zu Grün zu degradieren.
 *  2. ein Alarm-Job öffnet bei rotem main ein prio:hoch-Issue, NUR auf push (nicht
 *     bei PRs) und ohne den Workflow zu blockieren.
 */
describe("#605 CI-Post-hoc-Netz auf main (zweite Grenze hinter #592)", () => {
  const ci = readRepo(".github/workflows/ci.yml");

  it("check:diffsize misst auf push:main gegen den Vorgänger-Commit (github.event.before)", () => {
    // Die verify-Basis muss auf push den Vorgänger heranziehen, damit der gemergte
    // Slice AUCH auf main gemessen wird (sonst No-op-grün wie vor #605).
    expect(ci).toMatch(/KQ_DIFF_BASE:\s*\$\{\{\s*github\.event\.pull_request\.base\.sha\s*\|\|\s*github\.event\.before\s*\}\}/);
  });

  it("ein Alarm-Job schlägt bei rotem main an — nur auf push, nicht blockierend", () => {
    expect(ci, "der Alarm-Job muss existieren").toMatch(/alarm-red-main:/);
    // Läuft NUR bei Fehlschlag UND nur auf push (ein roter PR ist Sache der Autorin).
    expect(ci).toMatch(/if:\s*failure\(\)\s*&&\s*github\.event_name\s*==\s*'push'/);
    // Hängt an den Korrektheits-/Security-Gates (nicht am passwortgated Devpanel-Build).
    expect(ci).toMatch(/needs:\s*\[build-test,\s*security-audit\]/);
    // Braucht Schreibrecht auf Issues, um den Alarm anzulegen.
    expect(ci).toMatch(/issues:\s*write/);
    // Legt ein prio:hoch-Issue an (Board-SSOT statt leicht übersehbarem rotem ✗).
    expect(ci).toMatch(/gh issue create[\s\S]*?--label "prio:hoch"/);
  });
});

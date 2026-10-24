/* Projekt-Gates von kubernia (#1932, ADR 0022 F10, Teil 7b-4): die Gates und CI-Werte, die nur dieses Spiel hat. Dieser Test ist ein `projekt-test`:
 * er prüft Builds, Smoke, Bundle-Budget, den TS-7-Wächter und das Alarm-Label und gehört nicht in den Kern (der Kern-Test `verify-script.test.ts` prüft
 * die projektneutrale Kette).
 *
 * @harness-waechter – einziger Durchsetzer seiner Regel, darum im geschützten test/harness/ (#1165).
 *
 * Quelle der Regeln (vorher in `verify-script.test.ts`): #503 check:bundle misst dist-offline/index.html und die dist/-Chunks, existiert also erst nach
 * `build`/`build:offline`; #847 check:tseslint-ts7 fragt die npm-Registry (Netz) und läuft nur als eigener, nicht blockierender CI-Job; #612 check:duplication
 * ist ein reiner Bericht ohne Schwelle; #658 das Alarm-Issue trägt ein existierendes `area:`-Label. Rein struktureller Wächter, kein Verhaltens-Test. */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const readRepo = (rel: string) => readFileSync(fileURLToPath(new URL(`../../${rel}`, import.meta.url)), "utf8");
const scripts = (JSON.parse(readRepo("package.json")) as { scripts: Record<string, string> }).scripts;
const ci = readRepo(".github/workflows/ci.yml");
const gate = (name: string) => new RegExp(`\\bnpm run ${name}\\b`);

describe("#527/#503 verify:full: Builds, Boot-Smoke und Bundle-Budget", () => {
  it("`verify:full` erweitert `verify` um beide Builds und den Boot-Smoke", () => {
    const full = scripts["verify:full"];
    expect(full, "npm run verify:full muss existieren").toBeTruthy();
    expect(full).toMatch(gate("verify"));
    expect(full).toMatch(gate("build"));
    expect(full).toMatch(gate("build:offline"));
    expect(full).toMatch(/\bnpm run (test:smoke|smoke)\b/);
  });

  it("check:bundle läuft in verify:full NACH den Builds und nicht in der build-freien verify-Kette", () => {
    const full = scripts["verify:full"];
    expect(full).toMatch(gate("check:bundle"));
    expect(full.indexOf("npm run check:bundle") > full.indexOf("npm run build:offline"), "check:bundle muss NACH build:offline stehen").toBe(true);
    expect(gate("check:bundle").test(scripts.verify), "check:bundle darf nicht in verify stehen").toBe(false);
  });
});

describe("#847 check:tseslint-ts7: Netz-Gate außerhalb von verify", () => {
  it("steht nicht in verify, ist ein package.json-Skript und läuft als eigener CI-Schritt", () => {
    expect(gate("check:tseslint-ts7").test(scripts.verify)).toBe(false);
    expect(scripts["check:tseslint-ts7"], "muss als Skript existieren").toBeTruthy();
    const datei = scripts["check:tseslint-ts7"].match(/scripts\/[\w.-]+\.mjs/)?.[0];
    expect(gate("check:tseslint-ts7").test(ci) || (datei != null && ci.includes(datei)), "muss als eigener CI-Schritt laufen").toBe(true);
  });
});

describe("#612 check:duplication: nur Bericht", () => {
  it("steht nicht in verify (ein Platz dort machte den Bericht zum harten Gate)", () => {
    expect(gate("check:duplication").test(scripts.verify)).toBe(false);
  });
});

describe("#658 Alarm-Issue bei rotem main", () => {
  it("trägt das Projekt-Label area:architektur", () => {
    expect(ci).toMatch(/ALARM_LABEL:\s*area:architektur/);
  });
});

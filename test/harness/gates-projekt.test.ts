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

/** Was der Projekt-Block der AGENTS.md hinter `verify:full` von Builds, Bundle-Budget und Smokes nennt: die fehlenden Begriffe. Pur. */
function verifyFullFehlt(projektBlock: string): string[] {
  const satz = /`npm run verify:full` ergänzt([^.]*)\./.exec(projektBlock)?.[1];
  if (satz === undefined) return ["Satz „`npm run verify:full` ergänzt …“ fehlt"];
  return ["Builds", "Bundle-Budget", "Smokes"].filter((begriff) => !satz.includes(begriff));
}

/** Der Projekt-Block (zwischen den Markern, die die Verteilung nie anfasst) einer AGENTS.md. Pur. */
function projektBlockVon(agents: string): string {
  const a = agents.indexOf("<!-- factory-projekt:start -->");
  const b = agents.indexOf("<!-- factory-projekt:ende -->");
  return a < 0 || b < a ? "" : agents.slice(a, b);
}

describe("verify:full im Projekt-Block der AGENTS.md nennt die Spielgates (#1932, #1921)", () => {
  const block = projektBlockVon(readRepo("AGENTS.md"));
  it("der echte Projekt-Block nennt Builds, Bundle-Budget und Smokes", () => {
    expect(block.length).toBeGreaterThan(100);
    expect(verifyFullFehlt(block)).toEqual([]);
  });
  it("Negativfälle: ohne „Builds“, ohne Bundle-Budget, ohne Smokes, ohne den Satz, Satz nur im Kern-Block", () => {
    const satz = "`npm run verify:full` ergänzt Coverage, Builds, Bundle-Budget und Smokes.";
    expect(verifyFullFehlt(satz)).toEqual([]);
    expect(verifyFullFehlt(satz.replace("Builds, ", ""))).toEqual(["Builds"]);
    expect(verifyFullFehlt(satz.replace("Bundle-Budget und ", ""))).toEqual(["Bundle-Budget"]);
    expect(verifyFullFehlt(satz.replace(" und Smokes", ""))).toEqual(["Smokes"]);
    expect(verifyFullFehlt("kein Satz")).toHaveLength(1);
    const agents = `<!-- factory-besitz:start kern -->\n${satz}\n<!-- factory-projekt:start -->\nnichts\n<!-- factory-projekt:ende -->`;
    expect(verifyFullFehlt(projektBlockVon(agents))).toHaveLength(1);
    expect(projektBlockVon("ohne Marker")).toBe("");
    const danach = `<!-- factory-projekt:start -->
nichts
<!-- factory-projekt:ende -->
${satz}`;
    expect(verifyFullFehlt(projektBlockVon(danach))).toHaveLength(1);
  });
});

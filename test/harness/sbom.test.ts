/* SBOM-Erzeugung (#1617, ADR 0022 F15): Prüfung der CycloneDX-Ausgabe, Fehlerpfade des Wrappers
 * und CI-Verdrahtung.
 *
 * @harness-waechter – bewacht, dass ci.yml die SBOM erzeugt, als Artefakt ablegt und ein fehlendes
 * Artefakt rot wird (kein continue-on-error, kein if: always()).
 */
import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as raw from "../../scripts/sbom.mjs";

type Io = { lauf: () => { status: number | null; stdout: string; stderr: string; error?: Error }; schreibe: (p: string, t: string) => void; entferne: (p: string) => void; log: (z: string) => void; fehler: (z: string) => void };
const S = raw as unknown as {
  NPM_ARGS: string[];
  STANDARD_AUS: string;
  pruefeSbom: (text: string) => string[];
  fuehreAus: (argv: string[], io: Io) => number;
};

const komp = (extra: Record<string, unknown> = {}) => ({ name: "phaser", version: "3.90.0", purl: "pkg:npm/phaser@3.90.0", ...extra });
function bom(patch: Record<string, unknown> = {}): string {
  return JSON.stringify({
    bomFormat: "CycloneDX",
    specVersion: "1.5",
    metadata: { component: { name: "kubernia" }, tools: [{ vendor: "npm", name: "cli", version: "10.9.8" }] },
    components: [komp()],
    ...patch,
  });
}

describe("pruefeSbom", () => {
  test("gültige Minimal-BOM: keine Fehler", () => {
    expect(S.pruefeSbom(bom())).toEqual([]);
  });
  test.each([
    ["leerer Text", "", /leer/],
    ["kaputtes JSON", "{nicht json", /JSON/],
    ["bomFormat fehlt", bom({ bomFormat: undefined }), /bomFormat/],
    ["bomFormat SPDX", bom({ bomFormat: "SPDX" }), /bomFormat/],
    ["specVersion fehlt", bom({ specVersion: undefined }), /specVersion/],
    ["specVersion Zahl", bom({ specVersion: 1.5 }), /specVersion/],
    ["specVersion 2.0", bom({ specVersion: "2.0" }), /specVersion/],
    ["metadata.component fehlt", bom({ metadata: {} }), /metadata\.component/],
    ["components fehlt", bom({ components: undefined }), /components/],
    ["components leer", bom({ components: [] }), /components/],
    ["Komponente ohne version", bom({ components: [komp({ version: undefined })] }), /version/],
    ["Komponente ohne purl", bom({ components: [komp({ purl: undefined })] }), /^1 Komponente/m],
    ["zweite Komponente ohne name", bom({ components: [komp(), komp({ name: undefined })] }), /^1 Komponente/m],
    ["Komponente mit leerer version", bom({ components: [komp({ version: "" })] }), /^1 Komponente/m],
    ["Komponente mit Leerzeichen-purl", bom({ components: [komp({ purl: "  " })] }), /^1 Komponente/m],
    ["metadata.component.name leer", bom({ metadata: { component: { name: " " } } }), /metadata\.component/],
    ["specVersion mit Suffix 1.5.1", bom({ specVersion: "1.5.1" }), /specVersion/],
    ["specVersion mit Suffix 1.5-rc", bom({ specVersion: "1.5-rc" }), /specVersion/],
  ])("Fehlerfall: %s", (_n, text, muster) => {
    const fehler = S.pruefeSbom(text);
    expect(fehler.length).toBeGreaterThan(0);
    expect(fehler.join("\n")).toMatch(muster);
  });
  test("mehrere Mängel ergeben mehrere Meldungen", () => {
    expect(S.pruefeSbom(bom({ bomFormat: "SPDX", specVersion: "2.0" })).length).toBeGreaterThanOrEqual(2);
  });
});

function io(lauf: Io["lauf"]) {
  const aufrufe: string[] = [];
  const logs: string[] = [];
  const fehlerLogs: string[] = [];
  const geschrieben: Array<[string, string]> = [];
  const impl: Io = {
    lauf: () => {
      aufrufe.push("lauf");
      return lauf();
    },
    schreibe: (p, t) => {
      aufrufe.push("schreibe");
      geschrieben.push([p, t]);
    },
    entferne: (p) => {
      aufrufe.push(`entferne:${p}`);
    },
    log: (z) => logs.push(z),
    fehler: (z) => fehlerLogs.push(z),
  };
  return { impl, aufrufe, logs, fehlerLogs, geschrieben };
}

describe("fuehreAus", () => {
  test("Erfolg: schreibt unveränderten Text nach STANDARD_AUS, Log nennt Anzahl und npm-Version", () => {
    const t = io(() => ({ status: 0, stdout: bom(), stderr: "" }));
    expect(S.fuehreAus([], t.impl)).toBe(0);
    expect(t.geschrieben).toEqual([[S.STANDARD_AUS, bom()]]);
    expect(t.logs.join("\n")).toMatch(/1 Komponenten/);
    expect(t.logs.join("\n")).toMatch(/npm 10\.9\.8/);
    expect(t.fehlerLogs).toEqual([]);
  });
  test("--aus ändert den Zielpfad", () => {
    const t = io(() => ({ status: 0, stdout: bom(), stderr: "" }));
    expect(S.fuehreAus(["--aus", "x/y.json"], t.impl)).toBe(0);
    expect(t.geschrieben[0][0]).toBe("x/y.json");
    expect(t.aufrufe[0]).toBe("entferne:x/y.json");
  });
  test("npm-Exit 1 (ESBOMPROBLEMS): Exit 1, Meldung mit Exit-Code und stderr, nichts geschrieben", () => {
    const t = io(() => ({ status: 1, stdout: "", stderr: "npm error code ESBOMPROBLEMS\nnpm error missing" }));
    expect(S.fuehreAus([], t.impl)).toBe(1);
    expect(t.geschrieben).toEqual([]);
    expect(t.fehlerLogs.join("\n")).toMatch(/Exit 1/);
    expect(t.fehlerLogs.join("\n")).toMatch(/ESBOMPROBLEMS/);
    expect(t.logs).toEqual([]); // Fehler gehen auf stderr, nicht stdout
  });
  test("Startfehler (ENOENT): Exit 1, nichts geschrieben", () => {
    const t = io(() => ({ status: null, stdout: "", stderr: "", error: new Error("spawn npm ENOENT") }));
    expect(S.fuehreAus([], t.impl)).toBe(1);
    expect(t.geschrieben).toEqual([]);
    expect(t.fehlerLogs.join("\n")).toMatch(/ENOENT/);
  });
  test.each([["leer", ""], ["ungültig", "{kaputt"]])("npm-Exit 0 mit %s stdout: Exit 1, nichts geschrieben", (_n, out) => {
    const t = io(() => ({ status: 0, stdout: out, stderr: "" }));
    expect(S.fuehreAus([], t.impl)).toBe(1);
    expect(t.geschrieben).toEqual([]);
  });
  test("entferne läuft vor lauf, auch im Fehlerfall", () => {
    const t = io(() => ({ status: 1, stdout: "", stderr: "x" }));
    S.fuehreAus([], t.impl);
    expect(t.aufrufe[0]).toBe(`entferne:${S.STANDARD_AUS}`);
    expect(t.aufrufe[1]).toBe("lauf");
  });
  test.each([[["--aus"]], [["--aus", ""]], [["--unbekannt"]], [["--aus", "a", "--aus", "b"]], [["x"]], [["--aus="]], [["--"]], [["--aus", "a", "--"]]])("ungültige Argumente %j: Exit 2, Aufrufzeile auf stderr, lauf nicht aufgerufen", (argv) => {
    const t = io(() => ({ status: 0, stdout: bom(), stderr: "" }));
    expect(S.fuehreAus(argv, t.impl)).toBe(2);
    expect(t.aufrufe).not.toContain("lauf");
    expect(t.fehlerLogs).toEqual(["Aufruf: node scripts/sbom.mjs [--aus <pfad>]"]);
    expect(t.logs).toEqual([]);
  });
});

test("Vertrag: npm-Aufruf erzeugt CycloneDX aus dem Lockfile", () => {
  const a = S.NPM_ARGS.join(" ");
  expect(a).toContain("--sbom-format cyclonedx");
  expect(S.NPM_ARGS).toContain("--package-lock-only");
});

describe("CI-Verdrahtung (ci.yml, Job build-test)", () => {
  const ci = readFileSync(new URL("../../.github/workflows/ci.yml", import.meta.url), "utf8");
  const job = /^ {2}build-test:\r?\n([\s\S]*?)(?=^ {2}[\w-]+:\r?\n|(?![\s\S]))/m.exec(ci)?.[1] ?? "";
  const schritte = job.split(/^ {6}- /m).slice(1);
  const erzeugen = schritte.findIndex((s) => /run:\s*npm run sbom\s*$/m.test(s));
  const hochladen = schritte.findIndex((s) => /uses:\s*actions\/upload-artifact@/.test(s) && s.includes(`path: ${S.STANDARD_AUS}`));

  test("Job build-test hat Erzeugen-Schritt, danach Upload-Schritt", () => {
    expect(job).not.toBe("");
    expect(erzeugen).toBeGreaterThanOrEqual(0);
    expect(hochladen).toBeGreaterThan(erzeugen);
  });
  test("fehlendes Artefakt ist rot (if-no-files-found: error)", () => {
    expect(schritte[hochladen]).toMatch(/if-no-files-found:\s*error/);
  });
  test("keiner der beiden Schritte schluckt den Fehler", () => {
    for (const i of [erzeugen, hochladen]) {
      expect(schritte[i]).not.toMatch(/continue-on-error:\s*true/);
      expect(schritte[i]).not.toMatch(/^\s*if:\s*always\(\)/m);
    }
  });
});

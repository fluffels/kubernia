/* Gate-Satz des Factory-Repos (#1925, ADR 0022 F10, Teil 7c): die Vorlagen `package.json`, `ci.yml` und `eslint.config.js` tragen genau die Gates der
 * kubernia-Kette, nur die bewusst entfallenden stehen mit Grund in den geschlossenen Listen unten. Dieser Test ist ein `projekt-test`: er vergleicht
 * die Vorlagen mit der Kette von kubernia und gehört nicht in den Kern (im Export gibt es keine zweite Kette zum Vergleichen).
 *
 * @harness-waechter – einziger Durchsetzer seiner Regel, darum im geschützten test/harness/ (#1165).
 *
 * Scan-Umfang (geschlossen): `scripts.verify` und `scripts.verify:full` in package.json (aufgelöst wie die Gate-Tabelle über `kettenSchritte`), alle
 * `check:*`-Skripte, die Gate-Nennungen in den Nicht-Kommentar-Zeilen von `.github/workflows/ci.yml` (Muster `npm run <x>`, `node scripts/<x>.mjs`,
 * `npm audit`) und die Regeln, die `eslint-suppressions.json` für Pfade unter `scripts/` nennt. Nicht gescannt: der Inhalt der Gates selbst.
 * Die Tabelle „Gate-Satz des Factory-Repos“ steht in `docs/adr/fortschreibungen/0022-1925-gate-satz.md`; beide nennen dieselben Listen.
 *
 * Bekannte Grenze: eine neue Regel im Kopf von `ci.yml` jenseits der drei Muster sieht der Test nicht. */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as rawKetten from "../../scripts/docs-gen/npm-ketten.mjs";

// Begründete Ausnahme wie in verify-script.test.ts: das .mjs hat kein Declaration-File.
// eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
const kettenSchritte = rawKetten.kettenSchritte as (scripts: Record<string, string>, chains: string[], kette: string) => string[];

const readRepo = (rel: string) => readFileSync(fileURLToPath(new URL(`../../${rel}`, import.meta.url)), "utf8");
const VORLAGEN = ".factory/produkt/vorlagen";
type Pkg = { scripts: Record<string, string> };
const quelle = (JSON.parse(readRepo("package.json")) as Pkg).scripts;
const vorlage = (JSON.parse(readRepo(`${VORLAGEN}/package.json.vorlage`)) as Pkg).scripts;
const KETTEN = ["verify", "verify:full"];

// Geschlossene Listen der Gates, die im Factory-Repo bewusst entfallen (Name → Grund).
const ENTFAELLT: Record<string, string> = {
  "check:arch": "dependency-cruiser prüft die Schichtung von src/, das Factory-Repo hat kein src/",
  "check:c4": "prüft das C4-Modell des Spiels (LikeC4), das Factory-Repo hat keines",
};
const ENTFAELLT_VERIFY_FULL: Record<string, string> = {
  build: "kein ausgeliefertes Bundle",
  "build:offline": "kein Offline-Build",
  "check:bundle": "kein Bundle-Budget ohne Build",
  "test:smoke": "kein Boot-Smoke ohne Spiel",
};
const ENTFAELLT_CHECK: Record<string, string> = {
  ...ENTFAELLT,
  "check:bundle": ENTFAELLT_VERIFY_FULL["check:bundle"],
  "check:tseslint-ts7": "Netz-Gate für die TypeScript-7-Migration des Spiels",
  "check:duplication": "Duplikat-Bericht über src/",
};
const ENTFAELLT_CI: Record<string, string> = {
  build: "kein ausgeliefertes Bundle",
  "build:offline": "kein Offline-Build",
  "build:devpanel": "kein Dev-Panel-Build",
  "check:bundle": "kein Bundle-Budget ohne Build",
  sbom: "kein ausgeliefertes Bundle, dessen Stückliste zu veröffentlichen wäre",
  "test:smoke": "kein Boot-Smoke ohne Spiel",
  "check-tseslint-ts7": "Netz-Gate für die TypeScript-7-Migration des Spiels",
  "check:duplication": "Duplikat-Bericht über src/",
};

const ohne = (liste: string[], raus: Record<string, string>) => liste.filter((s) => !(s in raus));

describe("Gate-Satz: package.json-Vorlage gegen die Kette von kubernia", () => {
  it("`verify` der Vorlage ist `verify` der Quelle ohne die entfallenden Gates, in gleicher Reihenfolge", () => {
    expect(kettenSchritte(vorlage, KETTEN, "verify")).toEqual(ohne(kettenSchritte(quelle, KETTEN, "verify"), ENTFAELLT));
    expect(kettenSchritte(vorlage, KETTEN, "verify")[0], "die Kette beginnt mit dem Typecheck").toBe("typecheck");
  });

  it("`verify:full` der Vorlage ist `verify:full` der Quelle ohne Builds, Bundle-Budget und Smoke (die Schritte von `verify` stehen für sich)", () => {
    const schritte = (s: Record<string, string>) => kettenSchritte(s, KETTEN, "verify:full");
    expect(schritte(vorlage)).toEqual(ohne(schritte(quelle), { ...ENTFAELLT, ...ENTFAELLT_VERIFY_FULL }));
    expect(schritte(vorlage), "die Coverage steht in verify:full").toContain("test:coverage");
  });

  it("jedes `check:*`-Skript der Quelle steht in der Vorlage oder mit Grund in der geschlossenen Liste", () => {
    for (const name of Object.keys(quelle).filter((n) => n.startsWith("check:"))) {
      expect(name in vorlage || name in ENTFAELLT_CHECK, `Gate „${name}“ fehlt in der Vorlage und steht nicht mit Grund in ENTFAELLT_CHECK`).toBe(true);
    }
  });

  it("die Listen der entfallenden Gates sind nicht veraltet: jeder Name ist ein Quell-Skript und fehlt in der Vorlage", () => {
    for (const liste of [ENTFAELLT, ENTFAELLT_VERIFY_FULL, ENTFAELLT_CHECK]) {
      for (const [name, grund] of Object.entries(liste)) {
        expect(grund.length, `${name}: Grund fehlt`).toBeGreaterThan(0);
        expect(name in quelle, `„${name}“ ist kein Skript der Quelle mehr (Eintrag streichen)`).toBe(true);
        expect(name in vorlage, `„${name}“ steht in der Vorlage, gehört nicht in die Liste der entfallenden`).toBe(false);
      }
    }
  });
});

/** Gate-Nennungen in den Nicht-Kommentar-Zeilen eines Workflows (Muster geschlossen: `npm run <x>`, `node scripts/<x>.mjs`, `npm audit`). */
const ciGates = (text: string): Set<string> => {
  const out = new Set<string>();
  for (const zeile of text.split("\n").filter((z) => !z.trim().startsWith("#"))) {
    for (const m of zeile.matchAll(/\bnpm run ([\w:.-]+)/g)) out.add(m[1]);
    for (const m of zeile.matchAll(/\bnode scripts\/([\w.-]+)\.mjs\b/g)) out.add(m[1]);
    if (/\bnpm audit\b/.test(zeile)) out.add("npm audit");
  }
  return out;
};

describe("Gate-Satz: ci.yml-Vorlage gegen die CI von kubernia", () => {
  const quellGates = ciGates(readRepo(".github/workflows/ci.yml"));
  const vorlagenGates = ciGates(readRepo(`${VORLAGEN}/.github/workflows/ci.yml.vorlage`));

  it("jede Gate-Nennung der CI steht in der Vorlage oder mit Grund in ENTFAELLT_CI", () => {
    for (const g of quellGates) {
      expect(vorlagenGates.has(g) || g in ENTFAELLT_CI, `CI-Gate „${g}“ fehlt in ci.yml.vorlage und steht nicht in ENTFAELLT_CI`).toBe(true);
    }
  });

  it("ENTFAELLT_CI ist nicht veraltet: jeder Name steht in der CI von kubernia und fehlt in der Vorlage", () => {
    for (const g of Object.keys(ENTFAELLT_CI)) {
      expect(quellGates.has(g), `„${g}“ steht nicht mehr in ci.yml (Eintrag streichen)`).toBe(true);
      expect(vorlagenGates.has(g), `„${g}“ steht in der Vorlage, gehört nicht in ENTFAELLT_CI`).toBe(false);
    }
  });

  it("jedes `npm run <x>` der Vorlage ist ein Skript der Vorlage (kein totes Kommando)", () => {
    const text = readRepo(`${VORLAGEN}/.github/workflows/ci.yml.vorlage`).split("\n").filter((z) => !z.trim().startsWith("#")).join("\n");
    const namen = [...text.matchAll(/\bnpm run ([\w:.-]+)/g)].map((m) => m[1]);
    expect(namen.length, "die Vorlage ruft Skripte auf").toBeGreaterThan(0);
    for (const n of namen) expect(n in vorlage, `ci.yml.vorlage ruft „${n}“ auf, das Skript fehlt in package.json.vorlage`).toBe(true);
  });
});

describe("Gate-Satz: eslint-Vorlage trägt die eingefrorenen Regeln und Deckel", () => {
  const eslintVorlage = readRepo(`${VORLAGEN}/eslint.config.js.vorlage`);
  const suppressions = JSON.parse(readRepo("eslint-suppressions.json")) as Record<string, Record<string, unknown>>;

  it("jede Regel, die `eslint-suppressions.json` für scripts/ einfriert, steht in der Vorlage (typbewusste @typescript-eslint-Regeln über recommendedTypeChecked)", () => {
    const regeln = new Set<string>();
    for (const [pfad, r] of Object.entries(suppressions)) {
      if (pfad.startsWith("scripts/")) for (const name of Object.keys(r)) regeln.add(name);
    }
    expect(regeln.size, "der Bestand unter scripts/ ist nicht leer").toBeGreaterThan(0);
    for (const regel of regeln) {
      if (regel.startsWith("@typescript-eslint/")) continue;
      expect(eslintVorlage, `die Regel „${regel}“ ist in scripts/ eingefroren, die Vorlage aktiviert sie nicht (der Export würde „stale suppressions“ melden)`).toMatch(new RegExp(`(^|[\\s"])${regel}"?:`, "m"));
    }
  });

  it("die Deckel der Vorlage haben dieselben Zahlen wie eslint.config.js", () => {
    const deckel = (t: string) => ({
      complexity: /complexity:\s*\["error",\s*(\d+)\]/.exec(t)?.[1],
      tiefe: /"max-depth":\s*\["error",\s*(\d+)\]/.exec(t)?.[1],
      zeilen: /max:\s*(\d+)/.exec(t)?.[1],
    });
    const echt = deckel(readRepo("eslint.config.js"));
    expect(echt.complexity, "Anker in eslint.config.js gefunden").toBeDefined();
    expect(deckel(eslintVorlage)).toEqual(echt);
  });
});

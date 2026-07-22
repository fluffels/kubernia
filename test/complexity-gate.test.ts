import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
// eslint.config.js ist bewusst JS (ESLint-Flat-Config) und hat keine Typdeklaration –
// wir prüfen hier gerade ihre Struktur, darum der bewusste Import ohne Typen.
// @ts-expect-error – kein .d.ts für die Flat-Config
import eslintConfig from "../eslint.config.js";

/* Ticket #502: Der Dateigröße-Deckel (check-size.mjs, 800 LOC/Datei) misst nur
 * physische Zeilen JE DATEI und sieht die eigentliche God-Function nicht (eine
 * 300-Zeilen-verschachtelte Funktion in einer sonst normalgroßen Datei). Drei
 * ESLint-Regeln ergänzen die fehlenden Dimensionen – complexity (Verzweigungslast),
 * max-lines-per-function (Funktionslänge) und max-depth (Verschachtelung). Diese
 * Fitness-Function bindet die Regel-KONFIG fest, damit niemand die Gates still
 * aufweicht (Schwelle hochdrehen, Regel entfernen, auf test/** ausweiten) und der
 * Suppressions-Ratchet nicht durch Suppression FREMDER Regeln umgangen wird.
 *
 * Ticket #868 teilt sich dieselbe Bulk-Suppression-Datei für eine ZWEITE, repo-
 * weite Regel-Familie (`recommendedTypeChecked`: no-unsafe-*, no-misused-promises,
 * …) – darum unten zwei erlaubte Familien statt einer einzelnen src-Pflicht. */

type RuleEntry = unknown;
interface FlatConfig {
  files?: string[];
  rules?: Record<string, RuleEntry>;
}

const configs = eslintConfig as unknown as FlatConfig[];

// Der EINE Block, der die Komplexitäts-Gates trägt: an complexity erkennbar.
const gateBlocks = configs.filter((c) => c.rules && "complexity" in c.rules);

describe("Komplexitäts-Gate #502: Regel-Konfiguration bleibt scharf", () => {
  it("wird an genau EINER Stelle gesetzt (kein verstreutes Übersteuern)", () => {
    expect(gateBlocks).toHaveLength(1);
  });

  const gate = gateBlocks[0];

  it("gilt NUR für Produktionscode (src/**), nicht für Tests/Tooling", () => {
    // Test-Callbacks (describe/it) sind legitim lang – die Metrik zielt auf
    // die Spiel-/Sim-/Wirtschaftslogik in src/, den Ort der God-Functions.
    expect(gate.files).toEqual(["src/**/*.ts"]);
  });

  it("hält complexity als Fehler bei höchstens 15 (Ticket-Vorgabe ~12-15)", () => {
    expect(gate.rules?.complexity).toEqual(["error", 15]);
  });

  it("hält max-depth als Fehler bei höchstens 4", () => {
    expect(gate.rules?.["max-depth"]).toEqual(["error", 4]);
  });

  it("hält max-lines-per-function als Fehler bei höchstens 120", () => {
    const rule = gate.rules?.["max-lines-per-function"] as
      | [string, { max: number; skipBlankLines: boolean; skipComments: boolean }]
      | undefined;
    expect(rule?.[0]).toBe("error");
    expect(rule?.[1].max).toBeLessThanOrEqual(120);
    expect(rule?.[1].skipBlankLines).toBe(true);
    expect(rule?.[1].skipComments).toBe(true);
  });
});

describe("Typecheck-Gate #868: recommendedTypeChecked bleibt aktiv", () => {
  // Stellvertretend: eine Regel, die NUR in recommendedTypeChecked steckt – fängt
  // ein stilles Downgrade zurück auf `recommended`.
  const typeCheckedBlocks = configs.filter(
    (c) => c.rules && "@typescript-eslint/no-unsafe-assignment" in c.rules,
  );

  it("wird an genau EINER Stelle gesetzt, repo-weit als Fehler (nicht Warnung/aus)", () => {
    expect(typeCheckedBlocks).toHaveLength(1);
    expect(typeCheckedBlocks[0].files).toEqual(["**/*.ts"]);
    expect(typeCheckedBlocks[0].rules?.["@typescript-eslint/no-unsafe-assignment"]).toBe("error");
  });
});

describe("Komplexitäts-Gate #502: Suppressions-Baseline ist ehrlich", () => {
  const suppressions = JSON.parse(
    readFileSync(fileURLToPath(new URL("../eslint-suppressions.json", import.meta.url)), "utf8"),
  ) as Record<string, Record<string, { count: number }>>;

  const COMPLEXITY_RULES = new Set(["complexity", "max-depth", "max-lines-per-function"]);

  // #868: bewusst fest statt aus typescript-eslint abgeleitet – eine künftig NEUE
  // Regel in recommendedTypeChecked soll als "fremde Regel" auffallen.
  const TYPECHECKED_RULES = new Set([
    "@typescript-eslint/no-unsafe-member-access",
    "@typescript-eslint/no-unsafe-call",
    "@typescript-eslint/no-unnecessary-type-assertion",
    "@typescript-eslint/no-unsafe-assignment",
    "@typescript-eslint/no-unsafe-return",
    "@typescript-eslint/no-unsafe-argument",
    "@typescript-eslint/prefer-promise-reject-errors",
    "@typescript-eslint/restrict-template-expressions",
    "@typescript-eslint/no-base-to-string",
    "@typescript-eslint/no-redundant-type-constituents",
    "@typescript-eslint/unbound-method",
    "@typescript-eslint/no-misused-promises",
  ]);

  const ALLOWED = new Set([...COMPLEXITY_RULES, ...TYPECHECKED_RULES]);

  it("unterdrückt AUSSCHLIESSLICH die Komplexitäts- oder die #868-Typsicherheits-Regeln (kein Gaming über sonstige Fremd-Regeln)", () => {
    const suppressedRules = new Set<string>();
    for (const perFile of Object.values(suppressions)) {
      for (const rule of Object.keys(perFile)) suppressedRules.add(rule);
    }
    const leaked = [...suppressedRules].filter((r) => !ALLOWED.has(r));
    expect(leaked, `Fremde Regel(n) in der Baseline: ${leaked.join(", ")}`).toEqual([]);
  });

  it("Komplexitäts-Familie bleibt auf Produktionscode (src/**) beschränkt – kein Test/Tooling", () => {
    const nonSrcWithComplexity = Object.entries(suppressions).filter(
      ([file, rules]) => !file.startsWith("src/") && Object.keys(rules).some((r) => COMPLEXITY_RULES.has(r)),
    );
    expect(
      nonSrcWithComplexity.map(([f]) => f),
      `Komplexitäts-Suppression außerhalb src/**: ${nonSrcWithComplexity.map(([f]) => f).join(", ")}`,
    ).toEqual([]);
  });
});

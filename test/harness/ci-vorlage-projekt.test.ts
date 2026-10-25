/* Drift-Wächter der CI-Vorlage (#1932, #1921): die Jobs `alarm-red-main` und `doc-freshness` stehen in `.github/workflows/ci.yml` und in
 * `.factory/produkt/vorlagen/.github/workflows/ci.yml.vorlage` fast wortgleich; dieser `projekt-test` vergleicht ihre Rümpfe, damit eine
 * Änderung an einer Stelle nicht still an der anderen fehlt. Er gehört zu kubernia (`ci.yml` ist Projektdatei, die Vorlage ihr Kern-Anteil).
 *
 * Normalisiert wird nur, was legitim abweicht: ganze Kommentarzeilen, Leerzeilen, Zeilenend-Kommentare hinter `schlüssel: wert`, Ticket-Verweise
 * `(#123)` und `, #123)` (Historie des Projekts) und der Wert von `ALARM_LABEL` (das Label des Projekts; das Alarm-Label von kubernia pinnt
 * `gates-projekt.test.ts`). Jede andere Abweichung (Schritte, Rechte, Skripttext, Meldungen) macht den Test rot.
 *
 * @harness-waechter – einziger Durchsetzer seiner Regel, darum im geschützten test/harness/ (#1165). */
import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const lies = (rel: string) => readFileSync(fileURLToPath(new URL(`../../${rel}`, import.meta.url)), "utf8").replace(/\r\n/g, "\n");
const CI = ".github/workflows/ci.yml";
const VORLAGE = ".factory/produkt/vorlagen/.github/workflows/ci.yml.vorlage";
const JOBS = ["alarm-red-main", "doc-freshness"] as const;

/** Zeilen eines Jobs unter `jobs:` (ohne die Kopfzeile `  name:`), bis zum nächsten Job auf derselben Ebene; leer, wenn es ihn nicht gibt. Pur. */
export function jobRumpf(yaml: string, name: string): string[] {
  const zeilen = yaml.split("\n");
  const start = zeilen.indexOf(`  ${name}:`);
  if (start < 0) return [];
  let ende = start + 1;
  while (ende < zeilen.length && !/^ {2}[a-z][\w-]*:$/.test(zeilen[ende] ?? "")) ende++;
  return zeilen.slice(start + 1, ende);
}

/** Rumpf ohne legitime Abweichungen (siehe Kopf). Pur. */
export function normalisiere(zeilen: string[]): string[] {
  return zeilen
    .filter((z) => z.trim() !== "" && !/^\s*#/.test(z))
    .map((z) =>
      z
        .replace(/^(\s*[\w-]+:\s[\w:.-]+)\s+#.*$/, "$1")
        .replace(/ ?\(#\d+\)/g, "")
        .replace(/, #\d+\)/g, ")")
        .replace(/^(\s*ALARM_LABEL:).*$/, "$1 <label>")
        .trimEnd(),
    );
}

/** Abweichungen zweier Jobrümpfe: je Zeile `n: ci.yml | Vorlage`, bei ungleicher Länge zusätzlich die Zeilenzahlen. Pur. */
export function abweichungen(projekt: string[], vorlage: string[]): string[] {
  const aus: string[] = [];
  const n = Math.max(projekt.length, vorlage.length);
  for (let i = 0; i < n; i++) {
    if (projekt[i] !== vorlage[i]) aus.push(`Zeile ${i + 1}: ci.yml „${projekt[i] ?? "(fehlt)"}“ ≠ Vorlage „${vorlage[i] ?? "(fehlt)"}“`);
  }
  return aus;
}

describe("CI-Vorlage: Jobrümpfe von ci.yml und ci.yml.vorlage (#1921)", () => {
  const ci = lies(CI);
  const vorlage = lies(VORLAGE);

  for (const job of JOBS) {
    test(`Job ${job}: gleicher Rumpf in ci.yml und Vorlage`, () => {
      const projekt = normalisiere(jobRumpf(ci, job));
      expect(projekt.length, `Job ${job} in ci.yml gefunden (Leerlauf-Schutz)`).toBeGreaterThan(10);
      expect(abweichungen(projekt, normalisiere(jobRumpf(vorlage, job)))).toEqual([]);
    });
  }

  test("Negativfälle: eine eingeschleuste Zeile, eine geänderte Zeile und ein fehlender Job werden gemeldet", () => {
    for (const job of JOBS) {
      const roh = jobRumpf(vorlage, job);
      const soll = normalisiere(roh);
      expect(abweichungen(normalisiere(roh), soll)).toEqual([]);
      const eingeschleust = [...roh.slice(0, 5), "      - run: echo eingeschleust", ...roh.slice(5)];
      expect(abweichungen(normalisiere(eingeschleust), soll).length, `${job}: eingeschleuste Zeile`).toBeGreaterThan(0);
      const geaendert = roh.map((z, i) => (i === 6 ? `${z}x` : z));
      expect(abweichungen(normalisiere(geaendert), soll).length, `${job}: geänderte Zeile`).toBeGreaterThan(0);
      expect(abweichungen(soll.slice(0, -1), soll).join(), `${job}: fehlende Schlusszeile`).toContain("(fehlt)");
    }
    expect(jobRumpf(vorlage, "gibt-es-nicht")).toEqual([]);
  });

  test("Normalisierung: Kommentare, Ticket-Verweise und das Label weichen legitim ab, ein echter Textunterschied nicht", () => {
    const a = ["  # Kommentar", "", "    name: Job (#12)", "      issues: read  # warum", "      ALARM_LABEL: area:a", '      echo "x, #950)"'];
    const b = ["    name: Job", "      issues: read # anderer Text", "      ALARM_LABEL: area:b", '      echo "x)"'];
    expect(normalisiere(a)).toEqual(normalisiere(b));
    expect(normalisiere(["      x: y   "])).toEqual(["      x: y"]);
    expect(normalisiere(["      issues: read"])).not.toEqual(normalisiere(["      issues: write"]));
    expect(normalisiere(["      run: echo # Zeilenend-Kommentar"])).toEqual(["      run: echo"]);
    expect(normalisiere(['      "ein # im Text"'])).toEqual(['      "ein # im Text"']);
  });
});

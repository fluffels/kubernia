/* Format-Wächter für ADR-Fortschreibungen (#1663 L51): jede Überschrift, die mit „Fortschreibung“ beginnt, hat die Form
 * `## Fortschreibung #<nr>[/#<nr>…] (JJJJ-MM-TT): <Titel>`.
 *
 * @harness-waechter – einziger Durchsetzer seiner Regel, darum im geschützten test/harness/ (#1165).
 *
 * Warum: ein ADR ist historisch und wird nur durch angehängte Abschnitte fortgeschrieben; eine einheitliche Überschrift macht sie
 * greifbar (Ticket, Datum, Thema) und für Werkzeuge auffindbar. Bewusste Grenze: geprüft wird nur die Überschriftenform, nicht, ob
 * das Datum zum Ticket passt, und Überschriften in Code-Fences zählen nicht. */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

const FORM = /^## Fortschreibung #\d+(\/#\d+)* \(\d{4}-\d{2}-\d{2}\): \S/;
const BEGINNT = /^#{1,6}\s+Fortschreibung/;

/** Überschriften (mit Zeilennummer) mit dem Anfang „Fortschreibung“, die nicht der Form entsprechen. Pur. */
function abweichende(text: string): string[] {
  const aus: string[] = [];
  let fence = false;
  text.split(/\r?\n/).forEach((zeile, i) => {
    if (/^\s*(```|~~~)/.test(zeile)) fence = !fence;
    else if (!fence && BEGINNT.test(zeile) && !FORM.test(zeile)) aus.push(`${i + 1}: ${zeile}`);
  });
  return aus;
}

describe("ADR-Fortschreibungen: Überschriftenform (#1663 L51)", () => {
  const dir = join(process.cwd(), "docs", "adr");
  const adrs = readdirSync(dir).filter((n) => /^\d{4}-.*\.md$/.test(n));

  test("es gibt ADRs und mindestens eine Fortschreibung zu prüfen (kein leerer Lauf)", () => {
    expect(adrs.length).toBeGreaterThan(20);
    expect(adrs.some((n) => readFileSync(join(dir, n), "utf8").includes("\n## Fortschreibung #"))).toBe(true);
  });

  test("jede Fortschreibungs-Überschrift in docs/adr/*.md hat die Form", () => {
    const fehler = adrs.flatMap((n) => abweichende(readFileSync(join(dir, n), "utf8")).map((z) => `${n}:${z}`));
    expect(fehler).toEqual([]);
  });

  test.each([
    ["## Fortschreibung #1646 (2026-10-16): Titel", true],
    ["## Fortschreibung #1279/#1276 (2026-10-06): Weichen", true],
    ["## Fortschreibung (#1646, 2026-10-16): Titel", false],
    ["## Fortschreibung #1646 (2026-10-16)", false],
    ["## Fortschreibung #1646 (2026-10-16): ", false],
    ["## Fortschreibung #1646 (16.10.2026): Titel", false],
    ["### Fortschreibung #1646 (2026-10-16): Titel", false],
    ["## Fortschreibung #1646/ (2026-10-16): Titel", false],
  ])("Negativfälle erkannt: %s", (zeile, ok) => {
    expect(abweichende(zeile).length === 0).toBe(ok);
  });

  test("Überschriften in Code-Fences zählen nicht, andere Überschriften nicht betroffen", () => {
    expect(abweichende("```\n## Fortschreibung kaputt\n```\n## Re-Evaluierung\n")).toEqual([]);
    expect(abweichende("## Fortschreibung kaputt")).toEqual(["1: ## Fortschreibung kaputt"]);
  });
});

/* Fortschreibungen als eigene Dateien (#1860): neue Fortschreibungen stehen unter docs/adr/fortschreibungen/, nicht mehr am Ende des ADR
 * (Anhängen am Dateiende kollidiert bei parallelen PRs und lässt die Reihenfolge driften). Der Bestand der angehängten Abschnitte ist
 * eingefroren (Ratchet: nur senken); jede Datei trägt Namensform, Kopfzeile und einen Zeiger im ADR. */
const DATEI_NAME = /^(\d{4})-(\d+)-[a-z0-9-]+\.md$/;
const DATEI_KOPF = /^# Fortschreibung #(\d+(?:\/#\d+)*) \(\d{4}-\d{2}-\d{2}\): \S/;
const ANGEHAENGT = /^## Fortschreibung/;

/** Bestand angehängter `## Fortschreibung`-Abschnitte je ADR (Stand #1860); neue ADRs und jedes Plus: 0. Nur senken. */
const BESTAND: Record<string, number> = {
  "0009": 3,
  "0012": 5,
  "0016": 12,
  "0017": 3,
  "0022": 36,
  "0025": 1,
  "0026": 2,
  "0027": 1,
  "0028": 1,
};

/** Zählt `## Fortschreibung`-Überschriften außerhalb von Code-Fences. Pur. */
function zaehleAngehaengte(text: string): number {
  let fence = false;
  let n = 0;
  for (const zeile of text.split(/\r?\n/)) {
    if (/^\s*(```|~~~)/.test(zeile)) fence = !fence;
    else if (!fence && ANGEHAENGT.test(zeile)) n++;
  }
  return n;
}

/** Meldungen zu einer Fortschreibungs-Datei (Name, Kopfzeile, Zeiger im ADR). Pur, `adrs` = Dateinamen und Texte der ADRs. */
function dateiFehler(name: string, text: string, adrs: Record<string, string>): string[] {
  const m = DATEI_NAME.exec(name);
  if (!m) return [`${name}: Name muss <NNNN>-<ticket>-<slug>.md sein`];
  const [, adrNr, ticket] = m;
  const fehler: string[] = [];
  const adrName = Object.keys(adrs).find((n) => n.startsWith(`${adrNr}-`));
  if (!adrName) return [`${name}: kein ADR ${adrNr}`];
  const kopf = DATEI_KOPF.exec(text.split(/\r?\n/).find((l) => l.startsWith("# ")) ?? "");
  if (!kopf) fehler.push(`${name}: erste Überschrift muss "# Fortschreibung #<nr> (JJJJ-MM-TT): <Titel>" lauten`);
  else if (kopf[1].split("/#")[0] !== ticket) fehler.push(`${name}: Ticket der Kopfzeile (#${kopf[1].split("/#")[0]}) passt nicht zum Dateinamen (#${ticket})`);
  if (!adrs[adrName].includes(`fortschreibungen/${adrNr}-`)) fehler.push(`${name}: ${adrName} enthält keinen Zeiger "fortschreibungen/${adrNr}-"`);
  return fehler;
}

describe("ADR-Fortschreibungen als Dateien und Ratchet (#1860)", () => {
  const dir = join(process.cwd(), "docs", "adr");
  const adrNamen = readdirSync(dir).filter((n) => /^\d{4}-.*\.md$/.test(n));
  const adrs = Object.fromEntries(adrNamen.map((n) => [n, readFileSync(join(dir, n), "utf8")]));
  const unter = join(dir, "fortschreibungen");
  const dateien = existsSync(unter) ? readdirSync(unter).filter((n) => n !== "README.md") : [];

  test("es gibt mindestens eine Fortschreibungs-Datei (kein leerer Lauf)", () => {
    expect(dateien.length).toBeGreaterThan(0);
  });

  test("jede Datei unter docs/adr/fortschreibungen/ hat Namen, Kopfzeile und Zeiger im ADR", () => {
    const fehler = dateien.flatMap((n) => dateiFehler(n, readFileSync(join(unter, n), "utf8"), adrs));
    expect(fehler).toEqual([]);
  });

  test("Ratchet: je ADR nicht mehr angehängte Fortschreibungen als der eingefrorene Bestand", () => {
    const ueber: string[] = [];
    const stale: string[] = [];
    for (const [n, text] of Object.entries(adrs)) {
      const nr = n.slice(0, 4);
      const ist = zaehleAngehaengte(text);
      const soll = BESTAND[nr] ?? 0;
      if (ist > soll) ueber.push(`${n}: ${ist} > ${soll} – neue Fortschreibung als Datei unter docs/adr/fortschreibungen/ ablegen`);
      if (ist < soll) stale.push(`${n}: ${ist} < ${soll} – BESTAND in diesem Test senken`);
    }
    expect([...ueber, ...stale]).toEqual([]);
  });

  const adrMock = { "0013-x.md": "Text\nSiehe fortschreibungen/0013-1-a.md\n" };
  test.each([
    ["Name ohne Ticket", "0013-a.md", "# Fortschreibung #1 (2026-10-22): T\n", adrMock],
    ["Name mit Großbuchstaben", "0013-1-Abc.md", "# Fortschreibung #1 (2026-10-22): T\n", adrMock],
    ["ADR fehlt", "0099-1-a.md", "# Fortschreibung #1 (2026-10-22): T\n", adrMock],
    ["Kopfzeile falsch", "0013-1-a.md", "# Fortschreibung 1: T\n", adrMock],
    ["Kopfzeile ohne Titel", "0013-1-a.md", "# Fortschreibung #1 (2026-10-22): \n", adrMock],
    ["Ticket weicht vom Namen ab", "0013-1-a.md", "# Fortschreibung #2 (2026-10-22): T\n", adrMock],
    ["Zeiger fehlt", "0013-1-a.md", "# Fortschreibung #1 (2026-10-22): T\n", { "0013-x.md": "Text\n" }],
  ])("Negativfall erkannt: %s", (_n, name, text, a) => {
    expect(dateiFehler(name, text, a).length).toBeGreaterThan(0);
  });

  test("gültige Datei und Sammel-Ticketform bleiben ohne Fund", () => {
    expect(dateiFehler("0013-1-a.md", "# Fortschreibung #1 (2026-10-22): T\n", adrMock)).toEqual([]);
    expect(dateiFehler("0013-1-a.md", "# Fortschreibung #1/#2 (2026-10-22): T\n", adrMock)).toEqual([]);
  });

  test("Zählung: Fences zählen nicht, jede Überschrift mit „## Fortschreibung“ zählt", () => {
    expect(zaehleAngehaengte("## Fortschreibung #1 (2026-10-22): T\n## Fortschreibung kaputt\n")).toBe(2);
    expect(zaehleAngehaengte("```\n## Fortschreibung #1 (2026-10-22): T\n```\n")).toBe(0);
    expect(zaehleAngehaengte("### Fortschreibung #1 (2026-10-22): T\n")).toBe(0);
  });
});

/* Factory-Seiten (#1967, #1968, ADR 0022 F10): das Inventar in `docs/referenz/anlaufstellen.md` nennt je Seite und Abschnitt ein Urteil, und die gekürzten Seiten bestehen nur noch aus Projektanteil.
 *
 * @harness-waechter – Projekt-Test (Fitness-Function über die eigene Doku): prüft das Inventar in `docs/referenz/anlaufstellen.md` und die Form der gekürzten Seiten.
 *
 * Umfang: Die Inventar-Tabelle ist die einzige Quelle; `GEKUERZT` leitet sich aus ihr ab (Seiten mit mindestens einer Zeile Urteil `Kern`, ohne `CORE_DOCS` von `check:docdrift`:
 * deren Rest-Inhalt muss bleiben, `befehle.md` prüft ein eigener Test nur am Abschnitt `## Umgebungsvariablen`).
 * `inventarBefunde` prüft: jede Tabellenzeile hat vier Zellen, einen Seitenpfad `docs/…md` in Backticks, das Urteil genau `Projekt` oder `Kern`, einen Zielort
 * und bei `Kern` einen Factory-Link; jede Inventar-Seite existiert; jede Seite unter `docs/` (außer `docs/adr/`) mit einer Zeile genau `<!-- factory-projekt:start -->`
 * oder einer Kern-Zeile steht im Inventar, und eine Seite mit Kern-Zeile hat dort mindestens eine Zeile `Kern` (beide Richtungen).
 * `kuerzungBefunde` prüft je gekürzte Seite: außerhalb der `factory-projekt`- und `GEN:`-Blöcke nur Überschriften, Leerzeilen, `>`-Zeilen vor der ersten `##` und Kern-Zeilen;
 * eine Überschrift ohne Block und ohne GEN trägt genau eine Kern-Zeile, mit Block höchstens eine; der Kennsatz `Konvergenzschleife` (Kernwissen) darf nicht vorkommen.
 * Jede gekürzte Seite verlinkt ihr eigenes Gegenstück im Factory-Repo (Pfad der URL gleich Seitenpfad).
 * Bekannte Grenzen: Kernwissen erkennt der Test nur an der Form und am Kennsatz, nicht an der Bedeutung; Prosa innerhalb eines Blocks bleibt Sache des Reviews;
 * Code-Zäune außerhalb von Blöcken zählen als Prosa; eine Kern-Zeile darf auf jedes github.com-Ziel zeigen (Repo und Tag bindet `check:factorylinks`, nicht dieser Test);
 * eine ganze Seite als Stub ohne Kern-Zeile und ohne Block (nur `# Titel` und `>`-Zeile) findet der Scan nicht, sie steht nur über die Tabelle im Inventar.
 * Der Test liest die echten Seiten (Lebendprobe mit Leerlauf-Schutz). */
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, test } from "vitest";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import { CORE_DOCS as KERN_DOKUS } from "../../scripts/check-docdrift.mjs";

const CORE_DOCS = KERN_DOKUS as readonly string[];
const WURZEL = fileURLToPath(new URL("../..", import.meta.url));
const lies = (pfad: string): string => readFileSync(`${WURZEL}${pfad}`, "utf8").replace(/\r\n/g, "\n");

const INVENTAR_DATEI = "docs/referenz/anlaufstellen.md";
const INVENTAR_UEBERSCHRIFT = "## Factory-Seiten: Projektanteil und Kern";
const BEFEHLE = "docs/referenz/befehle.md";
const KENNSATZ = /Konvergenzschleife/;
const KERN_ZEILE = /^Kern: \[[^\]]+\]\(https:\/\/github\.com\/[^)\s]+\)$/;
const START = "<!-- factory-projekt:start -->";
const ENDE = "<!-- factory-projekt:ende -->";
const GEN_START = /^<!-- GEN:[\w-]+ START -->$/;
const GEN_ENDE = /^<!-- GEN:[\w-]+ END -->$/;

/** Eine Seite unter `docs/`, die das Projekt-Inventar kennen muss: `kern` heißt, sie trägt eine Kern-Zeile. */
interface Scan { pfad: string; kern: boolean }

/** Seiten mit Marker oder Kern-Zeile; `docs/adr/` bleibt außen vor, ein Marker nur inline in Backticks zählt nicht. */
export function scanSeiten(dateien: readonly { pfad: string; md: string }[]): Scan[] {
  const treffer: Scan[] = [];
  for (const { pfad, md } of dateien) {
    if (pfad.startsWith("docs/adr/")) continue;
    const zeilen = md.split(/\r?\n/);
    const kern = zeilen.some((z) => KERN_ZEILE.test(z));
    if (kern || zeilen.includes(START)) treffer.push({ pfad, kern });
  }
  return treffer;
}

interface Inventar { urteile: Map<string, Set<string>>; befunde: string[] }

function inventarLesen(md: string): Inventar {
  const befunde: string[] = [];
  const urteile = new Map<string, Set<string>>();
  const zeilen = md.split("\n");
  const von = zeilen.findIndex((z) => z.trim() === INVENTAR_UEBERSCHRIFT);
  if (von < 0) return { urteile, befunde: [`Abschnitt „${INVENTAR_UEBERSCHRIFT.slice(3)}“ fehlt`] };
  let bis = zeilen.findIndex((z, i) => i > von && z.startsWith("## "));
  if (bis < 0) bis = zeilen.length;
  for (const z of zeilen.slice(von + 1, bis)) {
    if (!z.startsWith("|")) continue;
    const zellen = z.split("|").slice(1, -1).map((c) => c.trim());
    if (zellen.length !== 4) { befunde.push(`Tabellenzeile mit ${zellen.length} statt 4 Zellen: ${z.slice(0, 50)}`); continue; }
    if (zellen[0] === "Seite" || /^-+$/.test(zellen[0] ?? "")) continue;
    const [seite = "", , urteil = "", ziel = ""] = zellen;
    const pfad = /^`(docs\/[^`]+\.md)`$/.exec(seite)?.[1] ?? "";
    if (pfad === "") { befunde.push(`unbekannte Seite „${seite}“ (erwartet: Pfad docs/….md in Backticks)`); continue; }
    urteile.set(pfad, (urteile.get(pfad) ?? new Set<string>()).add(urteil));
    if (urteil !== "Projekt" && urteil !== "Kern") befunde.push(`${pfad}: Urteil „${urteil}“ ist weder Projekt noch Kern`);
    if (ziel === "") befunde.push(`${pfad}: Zielort fehlt`);
    else if (urteil === "Kern" && !ziel.includes("https://github.com/")) befunde.push(`${pfad}: Kern-Zeile ohne Factory-Link`);
  }
  return { urteile, befunde };
}

/** Das Inventar in beide Richtungen gegen die Dateien: jede Seite existiert, jede Seite mit Marker oder Kern-Zeile hat ein Urteil. */
export function inventarBefunde(md: string, scan: readonly Scan[], vorhanden: (pfad: string) => boolean): string[] {
  const { urteile, befunde } = inventarLesen(md);
  for (const pfad of urteile.keys()) if (!vorhanden(pfad)) befunde.push(`${pfad}: Seite existiert nicht`);
  for (const s of scan) {
    const u = urteile.get(s.pfad);
    if (!u) befunde.push(`${s.pfad}: ohne Urteil im Inventar`);
    else if (s.kern && !u.has("Kern") && !CORE_DOCS.includes(s.pfad)) befunde.push(`${s.pfad}: trägt Kern-Zeilen, das Inventar nennt kein Kern`);
  }
  return befunde;
}

/** Die gekürzten Seiten: alle mit mindestens einer Zeile `Kern` im Inventar, ohne die Seiten aus `CORE_DOCS`. */
export function gekuerzteSeiten(md: string): string[] {
  return [...inventarLesen(md).urteile].filter(([pfad, u]) => u.has("Kern") && !CORE_DOCS.includes(pfad)).map(([pfad]) => pfad);
}

/** Der Link ins Factory-Repo auf genau diese Seite (Pfad der URL gleich Seitenpfad), mit oder ohne Anker. */
export function gegenstueckBefund(seite: string, md: string): string | null {
  const pfad = seite.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`\\(https://github\\.com/[^)\\s]+/blob/[^/\\s)]+/${pfad}(#[^)\\s]*)?\\)`).test(md) ? null : `${seite}: kein Factory-Link auf das eigene Gegenstück`;
}

/** Der Abschnitt `## Umgebungsvariablen` bis zur nächsten `##`. */
export function umgebungsvariablenAbschnitt(md: string): string {
  const zeilen = md.split("\n");
  const von = zeilen.findIndex((z) => z === "## Umgebungsvariablen");
  if (von < 0) return "";
  const bis = zeilen.findIndex((z, i) => i > von && z.startsWith("## "));
  return zeilen.slice(von, bis < 0 ? zeilen.length : bis).join("\n");
}

interface Pruefung { befunde: string[]; ueberschriften: number }

export function kuerzungBefunde(md: string): Pruefung {
  const befunde: string[] = [];
  const zeilen = md.split("\n");
  if (KENNSATZ.test(md)) befunde.push("Kernwissen: der Kennsatz „Konvergenzschleife“ steht auf der Seite");
  const ersteH2 = zeilen.findIndex((z) => z.startsWith("## "));
  let block = false;
  let gen = false;
  let ueberschriften = 0;
  let aktuell: { zeile: number; titel: string; kern: number; inhalt: boolean } | null = null;
  const schliesse = (): void => {
    if (!aktuell) return;
    if (!aktuell.inhalt && aktuell.kern !== 1) befunde.push(`Zeile ${aktuell.zeile}: „${aktuell.titel}“ ohne Block braucht genau eine Kern-Zeile (hat ${aktuell.kern})`);
    if (aktuell.inhalt && aktuell.kern > 1) befunde.push(`Zeile ${aktuell.zeile}: „${aktuell.titel}“ hat ${aktuell.kern} Kern-Zeilen`);
    aktuell = null;
  };
  zeilen.forEach((z, i) => {
    const nr = i + 1;
    if (z === START) { if (block || gen) befunde.push(`Zeile ${nr}: Block geschachtelt`); block = true; if (aktuell) aktuell.inhalt = true; return; }
    if (z === ENDE) { if (!block) befunde.push(`Zeile ${nr}: Blockende ohne Anfang`); block = false; return; }
    if (GEN_START.test(z)) { if (block || gen) befunde.push(`Zeile ${nr}: GEN-Block geschachtelt`); gen = true; if (aktuell) aktuell.inhalt = true; return; }
    if (GEN_ENDE.test(z)) { if (!gen) befunde.push(`Zeile ${nr}: GEN-Ende ohne Anfang`); gen = false; return; }
    if (block || gen) return;
    if (z.trim() === "") return;
    const kopf = /^(#{1,6}) (.*)$/.exec(z);
    if (kopf) {
      schliesse();
      ueberschriften++;
      if (kopf[1] !== "#") aktuell = { zeile: nr, titel: kopf[2] ?? "", kern: 0, inhalt: false };
      return;
    }
    if (KERN_ZEILE.test(z)) { if (aktuell) aktuell.kern++; else befunde.push(`Zeile ${nr}: Kern-Zeile ohne Überschrift`); return; }
    if (z.startsWith(">") && (ersteH2 < 0 || i < ersteH2)) return;
    befunde.push(`Zeile ${nr}: Prosa außerhalb eines Blocks: ${z.slice(0, 60)}`);
  });
  schliesse();
  if (block) befunde.push("Block nicht geschlossen");
  if (gen) befunde.push("GEN-Block nicht geschlossen");
  return { befunde, ueberschriften };
}

const tabelle = (zeilen: string[]): string => `${INVENTAR_UEBERSCHRIFT}\n\n| Seite | Abschnitt | Urteil | Zielort |\n|---|---|---|---|\n${zeilen.join("\n")}\n\n## Nächster Abschnitt\n`;
const zeile = (seite: string, urteil = "Projekt", ziel = "bleibt hier"): string => `| \`${seite}\` | alles | ${urteil} | ${ziel} |`;
const SEITEN = ["docs/a.md", "docs/b.md"];
const vollstaendig = (): string[] => SEITEN.map((s) => zeile(s));
const alleDa = (): boolean => true;
const FL = "[Factory](https://github.com/o/f/blob/v0.2.0/docs/x.md)";
const KERN = "Kern: [Titel](https://github.com/o/f/blob/v0.2.0/docs/x.md#anker)";

describe("inventarBefunde (AK1)", () => {
  test("grün: Projekt- und Kern-Zeilen, Kern mit Factory-Link, Marker-Seiten im Inventar", () => {
    const scan = [{ pfad: "docs/a.md", kern: true }, { pfad: "docs/b.md", kern: false }];
    assert.deepEqual(inventarBefunde(tabelle([...vollstaendig(), zeile("docs/a.md", "Kern", FL)]), scan, alleDa), []);
  });
  test("rot: Urteil „gemischt“ ist weder Projekt noch Kern", () => {
    const b = inventarBefunde(tabelle([...vollstaendig(), zeile("docs/a.md", "gemischt")]), [], alleDa);
    assert.ok(b.some((x) => x.includes("gemischt")), b.join("\n"));
  });
  test("rot: leerer Zielort", () => {
    const b = inventarBefunde(tabelle([...vollstaendig(), zeile("docs/a.md", "Projekt", "")]), [], alleDa);
    assert.ok(b.some((x) => x.includes("Zielort fehlt")), b.join("\n"));
  });
  test("rot: Kern ohne Factory-Link", () => {
    const b = inventarBefunde(tabelle([...vollstaendig(), zeile("docs/a.md", "Kern", "bleibt hier")]), [], alleDa);
    assert.ok(b.some((x) => x.includes("ohne Factory-Link")), b.join("\n"));
  });
  test("rot: Abschnitt fehlt", () => {
    assert.equal(inventarBefunde("# Titel\n\n## Anderes\n", [], alleDa).length, 1);
  });
  test("grün: der Inventar-Abschnitt ist der letzte der Datei", () => {
    const md = tabelle(vollstaendig()).replace("\n## Nächster Abschnitt\n", "").trimEnd();
    assert.deepEqual(inventarBefunde(md, [], alleDa), []);
  });
  test("grün: Zeilen hinter dem nächsten ##-Abschnitt zählen nicht", () => {
    assert.deepEqual(inventarBefunde(`${tabelle(vollstaendig())}\n${zeile("docs/c.md", "gemischt")}\n`, [], alleDa), []);
  });
  test("rot: Tabellenzeile mit falscher Zellenzahl wird gemeldet statt übersprungen", () => {
    const fuenf = "| `docs/a.md` | a | Projekt | b | c |";
    const drei = "| `docs/a.md` | Projekt | b |";
    for (const z of [fuenf, drei]) {
      const b = inventarBefunde(tabelle([...vollstaendig(), z]), [], alleDa);
      assert.ok(b.some((x) => x.includes("Zellen")), b.join("\n"));
    }
  });
  test("rot: Seitenpfad ohne Backticks oder außerhalb von docs/ ist unbekannt", () => {
    for (const seite of ["| docs/a.md | alles | Projekt | bleibt hier |", zeile("src/a.md"), zeile("docs/a.txt")]) {
      const b = inventarBefunde(tabelle([...vollstaendig(), seite]), [], alleDa);
      assert.ok(b.some((x) => x.includes("unbekannte Seite")), b.join("\n"));
    }
  });
  test("rot: eine Inventar-Seite existiert nicht", () => {
    const b = inventarBefunde(tabelle(vollstaendig()), [], (p) => p !== "docs/b.md");
    assert.deepEqual(b, ["docs/b.md: Seite existiert nicht"]);
  });
  test("rot: eine Seite mit Marker fehlt im Inventar", () => {
    const b = inventarBefunde(tabelle([zeile("docs/a.md")]), [{ pfad: "docs/b.md", kern: false }], alleDa);
    assert.deepEqual(b, ["docs/b.md: ohne Urteil im Inventar"]);
  });
  test("rot: eine Seite mit Kern-Zeile hat im Inventar nur Projekt-Zeilen", () => {
    const b = inventarBefunde(tabelle(vollstaendig()), [{ pfad: "docs/a.md", kern: true }], alleDa);
    assert.deepEqual(b, ["docs/a.md: trägt Kern-Zeilen, das Inventar nennt kein Kern"]);
  });
  test("grün: eine CORE_DOCS-Seite mit Kern-Zeile braucht kein Kern-Urteil", () => {
    const b = inventarBefunde(tabelle([zeile(BEFEHLE)]), [{ pfad: BEFEHLE, kern: true }], alleDa);
    assert.deepEqual(b, []);
  });
});

describe("scanSeiten, gekuerzteSeiten, gegenstueckBefund, Umgebungsvariablen", () => {
  test("scanSeiten: Marker-Zeile und Kern-Zeile zählen, docs/adr/ und Inline-Marker nicht", () => {
    const scan = scanSeiten([
      { pfad: "docs/m.md", md: `# T\n\n${START}\nx\n${ENDE}\n` },
      { pfad: "docs/k.md", md: `# T\n\n## A\n\n${KERN}\r\n` },
      { pfad: "docs/adr/0001-x.md", md: `${START}\n${KERN}\n` },
      { pfad: "docs/inline.md", md: `Der Marker \`${START}\` steht nur im Text.\nKern: [T](lokal.md)\n` },
      { pfad: "docs/leer.md", md: "# T\n" },
    ]);
    assert.deepEqual(scan, [{ pfad: "docs/m.md", kern: false }, { pfad: "docs/k.md", kern: true }]);
  });
  test("gekuerzteSeiten: nur Seiten mit Zeile Kern, ohne CORE_DOCS", () => {
    const md = tabelle([zeile("docs/a.md", "Projekt"), zeile("docs/b.md", "Kern", FL), zeile("docs/b.md", "Projekt"), zeile(BEFEHLE, "Kern", FL), zeile("docs/c.md", "Projekt")]);
    assert.deepEqual(gekuerzteSeiten(md), ["docs/b.md"]);
    assert.deepEqual(gekuerzteSeiten(tabelle([zeile("docs/a.md", "Projekt")])), []);
  });
  test("gegenstueckBefund: grün mit eigenem Pfad (mit und ohne Anker), rot bei fremdem Pfad oder ohne Link", () => {
    const link = "https://github.com/o/f/blob/v0.2.0/docs/x.md";
    assert.equal(gegenstueckBefund("docs/x.md", `> [Seite](${link})`), null);
    assert.equal(gegenstueckBefund("docs/x.md", `Kern: [A](${link}#anker)`), null);
    assert.ok(gegenstueckBefund("docs/x.md", "> [Seite](https://github.com/o/f/blob/v0.2.0/docs/y.md)"));
    assert.ok(gegenstueckBefund("docs/x.md", "> [Seite](https://github.com/o/f/blob/v0.2.0/docs/xamd)"));
    assert.ok(gegenstueckBefund("docs/x.md", "> [Seite](x.md)"));
  });
  const kopf = "# Titel\n\n## Anderes\n\nProsa.\n\n";
  const umgebung = (inhalt: string): string => `${kopf}## Umgebungsvariablen\n\n${inhalt}\n## Danach\n\nProsa.\n`;
  test("umgebungsvariablenAbschnitt: reicht bis zur nächsten ##, fehlt leer", () => {
    const a = umgebungsvariablenAbschnitt(umgebung(KERN));
    assert.ok(a.startsWith("## Umgebungsvariablen") && !a.includes("Danach") && !a.includes("Anderes"));
    assert.equal(umgebungsvariablenAbschnitt("# T\n"), "");
  });
  test("befehle: grün mit Kern-Zeile und Block, rot mit FACTORY_-Zeile außerhalb des Blocks", () => {
    const block = `${START}\n\n| \`KQ_X\` | Projekt |\n\n${ENDE}\n`;
    assert.deepEqual(kuerzungBefunde(umgebungsvariablenAbschnitt(umgebung(`${KERN}\n\n${block}`))).befunde, []);
    const b = kuerzungBefunde(umgebungsvariablenAbschnitt(umgebung(`${KERN}\n\n| \`FACTORY_DIFF_BASE\` | Kern |\n\n${block}`))).befunde;
    assert.ok(b.some((x) => x.includes("Prosa außerhalb") && x.includes("FACTORY_DIFF_BASE")), b.join("\n"));
  });
});

describe("kuerzungBefunde (AK2 bis AK5)", () => {
  const kopf = "# Titel\n\n> Intro mit [Link](https://github.com/o/f/blob/v0.2.0/docs/x.md).\n\n";
  test("grün: Prosa im Block, GEN-Block, Container-Überschrift mit Kern-Zeile vor einer ###", () => {
    const md = `${kopf}## Container\n\n${KERN}\n\n### Stub\n\n${KERN}\n\n### Projekt\n\n${START}\n\nProsa im Block.\n\n${ENDE}\n\n### Generiert\n\n<!-- GEN:x START -->\ninhalt\n<!-- GEN:x END -->\n`;
    const p = kuerzungBefunde(md);
    assert.deepEqual(p.befunde, []);
    assert.equal(p.ueberschriften, 5);
  });
  test("rot: Prosa außerhalb eines Blocks", () => {
    const b = kuerzungBefunde(`${kopf}## A\n\n${KERN}\n\nKernwissen als freie Prosa.\n`).befunde;
    assert.ok(b.some((x) => x.includes("Prosa außerhalb")), b.join("\n"));
  });
  test("rot: Stub ohne Kern-Zeile", () => {
    const b = kuerzungBefunde(`${kopf}## A\n\n## B\n\n${KERN}\n`).befunde;
    assert.ok(b.some((x) => x.includes("„A“") && x.includes("genau eine Kern-Zeile")), b.join("\n"));
  });
  test("rot: Stub mit zwei Kern-Zeilen", () => {
    const b = kuerzungBefunde(`${kopf}## A\n\n${KERN}\n\n${KERN}\n`).befunde;
    assert.ok(b.some((x) => x.includes("genau eine Kern-Zeile")), b.join("\n"));
  });
  test("rot: Block mit zwei Kern-Zeilen", () => {
    const b = kuerzungBefunde(`${kopf}## A\n\n${KERN}\n\n${KERN}\n\n${START}\n\nx\n\n${ENDE}\n`).befunde;
    assert.ok(b.some((x) => x.includes("2 Kern-Zeilen")), b.join("\n"));
  });
  test("rot: der Kennsatz Konvergenzschleife steht auf der Seite", () => {
    const b = kuerzungBefunde(`${kopf}## A\n\n${START}\n\nDie review↔fix-Konvergenzschleife läuft so.\n\n${ENDE}\n`).befunde;
    assert.ok(b.some((x) => x.includes("Konvergenzschleife")), b.join("\n"));
  });
  test("rot: `>`-Zeile nach der ersten ##-Überschrift ist Prosa", () => {
    const b = kuerzungBefunde(`${kopf}## A\n\n${KERN}\n\n> später\n`).befunde;
    assert.ok(b.some((x) => x.includes("Prosa außerhalb")), b.join("\n"));
  });
  test("rot: Kern-Zeile ohne Factory-Link und unterbrochener Block", () => {
    assert.ok(kuerzungBefunde(`${kopf}## A\n\nKern: [Titel](lokal.md)\n`).befunde.some((x) => x.includes("Prosa außerhalb")));
    assert.ok(kuerzungBefunde(`${kopf}## A\n\n${START}\n\nx\n`).befunde.some((x) => x.includes("nicht geschlossen")));
  });
  test("rot: Kern-Zeile mit Prosa dahinter ist keine Kern-Zeile", () => {
    const b = kuerzungBefunde(`${kopf}## A\n\n${KERN} und Kernwissen dahinter\n`).befunde;
    assert.ok(b.some((x) => x.includes("Prosa außerhalb")), b.join("\n"));
  });
  const ohnePraefix = (b: string[]): string[] => b.map((x) => x.replace(/^Zeile \d+: /, ""));
  test("rot: Prosa vor der Kern-Zeile (Zeilenanfang)", () => {
    const b = kuerzungBefunde(`${kopf}## A\n\nKernwissen davor. ${KERN}\n`).befunde;
    assert.ok(b.some((x) => x.includes("Prosa außerhalb")), b.join("\n"));
  });
  test("rot: Marker mit Text davor oder dahinter sind keine Marker", () => {
    const hat = (md: string, text: string): void => {
      const b = kuerzungBefunde(`${kopf}## A\n\n${md}`).befunde;
      assert.ok(b.some((x) => x.includes(text)), b.join("\n"));
    };
    hat("<!-- GEN:x START --> Text\ny\n<!-- GEN:x END -->\n", "Prosa außerhalb");
    hat("Text <!-- GEN:x START -->\ny\n<!-- GEN:x END -->\n", "Prosa außerhalb");
    hat("<!-- GEN:x START -->\ny\n<!-- GEN:x END --> Text\n", "GEN-Block nicht geschlossen");
    hat("<!-- GEN:x START -->\nText <!-- GEN:x END -->\n", "GEN-Block nicht geschlossen");
  });
  test("rot: Block im GEN-Block und GEN-Block im GEN-Block (exakte Meldung)", () => {
    const blockInGen = kuerzungBefunde(`${kopf}## A\n\n<!-- GEN:x START -->\n${START}\nx\n${ENDE}\n<!-- GEN:x END -->\n`).befunde;
    assert.deepEqual(ohnePraefix(blockInGen), ["Block geschachtelt"]);
    const genInGen = kuerzungBefunde(`${kopf}## A\n\n<!-- GEN:x START -->\n<!-- GEN:y START -->\nx\n<!-- GEN:y END -->\n<!-- GEN:x END -->\n`).befunde;
    assert.ok(genInGen.some((x) => x.includes("GEN-Block geschachtelt")), genInGen.join("\n"));
  });
  test("rot: geschachtelter Block", () => {
    const b = kuerzungBefunde(`${kopf}## A\n\n${START}\n\n${START}\n\nx\n\n${ENDE}\n`).befunde;
    assert.ok(b.some((x) => x.includes("Block geschachtelt")), b.join("\n"));
  });
  test("rot: Blockende ohne Anfang", () => {
    const b = kuerzungBefunde(`${kopf}## A\n\n${KERN}\n\n${ENDE}\n`).befunde;
    assert.ok(b.some((x) => x.includes("Blockende ohne Anfang")), b.join("\n"));
  });
  test("rot: GEN-Block im Block, ohne Ende und GEN-Ende ohne Anfang", () => {
    const inBlock = kuerzungBefunde(`${kopf}## A\n\n${START}\n\n<!-- GEN:x START -->\ny\n<!-- GEN:x END -->\n\n${ENDE}\n`).befunde;
    assert.ok(inBlock.some((x) => x.includes("GEN-Block geschachtelt")), inBlock.join("\n"));
    const offen = kuerzungBefunde(`${kopf}## A\n\n<!-- GEN:x START -->\ny\n`).befunde;
    assert.ok(offen.some((x) => x.includes("GEN-Block nicht geschlossen")), offen.join("\n"));
    const ohneAnfang = kuerzungBefunde(`${kopf}## A\n\n${KERN}\n\n<!-- GEN:x END -->\n`).befunde;
    assert.ok(ohneAnfang.some((x) => x.includes("GEN-Ende ohne Anfang")), ohneAnfang.join("\n"));
  });
  test("rot: Kern-Zeile ohne Überschrift", () => {
    const b = kuerzungBefunde(`# Titel\n\n${KERN}\n\n## A\n\n${KERN}\n`).befunde;
    assert.deepEqual(b.map((x) => x.replace(/^Zeile \d+: /, "")), ["Kern-Zeile ohne Überschrift"]);
  });
  test("grün: Seite ohne ##-Überschrift mit `>`-Intro", () => {
    assert.deepEqual(kuerzungBefunde("# Titel\n\n> Intro\n").befunde, []);
  });
});

const docsSeiten = (ordner = "docs"): { pfad: string; md: string }[] =>
  readdirSync(`${WURZEL}${ordner}`, { withFileTypes: true }).flatMap((e) => {
    const pfad = `${ordner}/${e.name}`;
    if (e.isDirectory()) return docsSeiten(pfad);
    return e.name.endsWith(".md") ? [{ pfad, md: lies(pfad) }] : [];
  });

describe("Lebendprobe an den echten Seiten", () => {
  const inventar = lies(INVENTAR_DATEI);
  const GEKUERZT = gekuerzteSeiten(inventar);
  test("das Inventar und die Seiten mit Marker oder Kern-Zeile decken sich in beide Richtungen", () => {
    assert.deepEqual(inventarBefunde(inventar, scanSeiten(docsSeiten()), (p) => existsSync(`${WURZEL}${p}`)), []);
  });
  test("Leerlauf-Schutz: die Tabelle liefert gekürzte Seiten, jede trägt Überschrift und Kern-Zeile oder Factory-Link", () => {
    assert.ok(GEKUERZT.length >= 1, "GEKUERZT ist leer");
    for (const seite of ["docs/agent-harness.md", "docs/model-routing.md", "docs/harness-transfer.md"]) assert.ok(GEKUERZT.includes(seite), `${seite} fehlt in GEKUERZT`);
  });
  for (const seite of GEKUERZT) {
    test(`${seite} besteht nur aus Projektanteil, GEN-Blöcken und Kern-Zeilen und verlinkt ihr Gegenstück`, () => {
      const md = lies(seite);
      assert.deepEqual(kuerzungBefunde(md).befunde, []);
      assert.equal(gegenstueckBefund(seite, md), null);
    });
  }
  test(`${BEFEHLE}: der Abschnitt Umgebungsvariablen besteht nur aus Kern-Zeile und Projekt-Block`, () => {
    const abschnitt = umgebungsvariablenAbschnitt(lies(BEFEHLE));
    assert.ok(abschnitt !== "", "Abschnitt fehlt");
    assert.deepEqual(kuerzungBefunde(abschnitt).befunde, []);
    assert.equal(gegenstueckBefund(BEFEHLE, abschnitt), null);
  });
});

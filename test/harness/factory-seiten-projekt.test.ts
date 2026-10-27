/* Factory-Seiten (#1967, ADR 0022 F10): das Inventar nennt für sieben Seiten ein Urteil, und drei Seiten bestehen nur noch aus Projektanteil.
 *
 * @harness-waechter – Projekt-Test (Fitness-Function über die eigene Doku): prüft das Inventar in `docs/referenz/anlaufstellen.md` und die Form der gekürzten Seiten.
 *
 * Umfang: `inventarBefunde` verlangt alle sieben Seiten (geschlossene Liste) mit mindestens einer Zeile, Urteil genau `Projekt` oder `Kern`, nicht leerem Zielort
 * und bei `Kern` einem Factory-Link. `kuerzungBefunde` prüft je gekürzte Seite (geschlossene Liste `GEKUERZT`, #1968 ergänzt sie): außerhalb der
 * `factory-projekt`- und `GEN:`-Blöcke nur Überschriften, Leerzeilen, `>`-Zeilen vor der ersten `##` und Kern-Zeilen; eine Überschrift ohne Block und ohne GEN
 * trägt genau eine Kern-Zeile, mit Block höchstens eine; der Kennsatz `Konvergenzschleife` (Kernwissen) darf nicht vorkommen.
 * Bekannte Grenzen: Kernwissen erkennt der Test nur an der Form und am Kennsatz, nicht an der Bedeutung; Prosa innerhalb eines Blocks bleibt Sache des Reviews;
 * Code-Zäune außerhalb von Blöcken zählen als Prosa; eine Kern-Zeile darf auf jedes github.com-Ziel zeigen (Repo und Tag bindet `check:factorylinks`, nicht dieser Test). Der Test liest die echten Seiten (Lebendprobe mit Leerlauf-Schutz). */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, test } from "vitest";

const WURZEL = fileURLToPath(new URL("../..", import.meta.url));
const lies = (pfad: string): string => readFileSync(`${WURZEL}${pfad}`, "utf8").replace(/\r\n/g, "\n");

const INVENTAR_SEITEN = [
  "docs/agent-harness.md",
  "docs/agent-harness-faq.md",
  "docs/sicherheit-agenten.md",
  "docs/model-routing.md",
  "docs/ticket-reihenfolge.md",
  "docs/harness-glossar.md",
  "docs/referenz/befehle.md",
];
const GEKUERZT = ["docs/agent-harness.md", "docs/agent-harness-faq.md", "docs/sicherheit-agenten.md"];
const INVENTAR_DATEI = "docs/referenz/anlaufstellen.md";
const INVENTAR_UEBERSCHRIFT = "## Factory-Seiten: Projektanteil und Kern";
const KENNSATZ = /Konvergenzschleife/;
const KERN_ZEILE = /^Kern: \[[^\]]+\]\(https:\/\/github\.com\/[^)\s]+\)$/;
const START = "<!-- factory-projekt:start -->";
const ENDE = "<!-- factory-projekt:ende -->";
const GEN_START = /^<!-- GEN:[\w-]+ START -->$/;
const GEN_ENDE = /^<!-- GEN:[\w-]+ END -->$/;

export function inventarBefunde(md: string): string[] {
  const befunde: string[] = [];
  const zeilen = md.split("\n");
  const von = zeilen.findIndex((z) => z.trim() === INVENTAR_UEBERSCHRIFT);
  if (von < 0) return [`Abschnitt „${INVENTAR_UEBERSCHRIFT.slice(3)}“ fehlt`];
  let bis = zeilen.findIndex((z, i) => i > von && z.startsWith("## "));
  if (bis < 0) bis = zeilen.length;
  const gesehen = new Set<string>();
  for (const z of zeilen.slice(von + 1, bis)) {
    if (!z.startsWith("|")) continue;
    const zellen = z.split("|").slice(1, -1).map((c) => c.trim());
    if (zellen.length !== 4) { befunde.push(`Tabellenzeile mit ${zellen.length} statt 4 Zellen: ${z.slice(0, 50)}`); continue; }
    if (zellen[0] === "Seite" || /^-+$/.test(zellen[0] ?? "")) continue;
    const [seite = "", , urteil = "", ziel = ""] = zellen;
    const pfad = /^`([^`]+)`$/.exec(seite)?.[1] ?? "";
    if (!INVENTAR_SEITEN.includes(pfad)) { befunde.push(`unbekannte Seite „${seite}“ (geschlossene Liste)`); continue; }
    gesehen.add(pfad);
    if (urteil !== "Projekt" && urteil !== "Kern") befunde.push(`${pfad}: Urteil „${urteil}“ ist weder Projekt noch Kern`);
    if (ziel === "") befunde.push(`${pfad}: Zielort fehlt`);
    else if (urteil === "Kern" && !ziel.includes("https://github.com/")) befunde.push(`${pfad}: Kern-Zeile ohne Factory-Link`);
  }
  for (const s of INVENTAR_SEITEN) if (!gesehen.has(s)) befunde.push(`${s}: ohne Urteil im Inventar`);
  return befunde;
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
const vollstaendig = (): string[] => INVENTAR_SEITEN.map((s) => zeile(s));
const FL = "[Factory](https://github.com/o/f/blob/v0.2.0/docs/x.md)";
const KERN = "Kern: [Titel](https://github.com/o/f/blob/v0.2.0/docs/x.md#anker)";

describe("inventarBefunde (AK1)", () => {
  test("grün: alle sieben Seiten mit Urteil und Zielort, Kern mit Factory-Link", () => {
    assert.deepEqual(inventarBefunde(tabelle([...vollstaendig(), zeile("docs/agent-harness.md", "Kern", FL)])), []);
  });
  test("rot: eine Seite ohne Urteil", () => {
    const b = inventarBefunde(tabelle(vollstaendig().slice(1)));
    assert.ok(b.some((x) => x.includes("docs/agent-harness.md") && x.includes("ohne Urteil")), b.join("\n"));
  });
  test("rot: Urteil „gemischt“ ist weder Projekt noch Kern", () => {
    const b = inventarBefunde(tabelle([...vollstaendig(), zeile("docs/agent-harness.md", "gemischt")]));
    assert.ok(b.some((x) => x.includes("gemischt")), b.join("\n"));
  });
  test("rot: leerer Zielort", () => {
    const b = inventarBefunde(tabelle([...vollstaendig(), zeile("docs/agent-harness.md", "Projekt", "")]));
    assert.ok(b.some((x) => x.includes("Zielort fehlt")), b.join("\n"));
  });
  test("rot: Kern ohne Factory-Link", () => {
    const b = inventarBefunde(tabelle([...vollstaendig(), zeile("docs/agent-harness.md", "Kern", "bleibt hier")]));
    assert.ok(b.some((x) => x.includes("ohne Factory-Link")), b.join("\n"));
  });
  test("rot: Seite außerhalb der geschlossenen Liste", () => {
    const b = inventarBefunde(tabelle([...vollstaendig(), zeile("docs/andere.md")]));
    assert.ok(b.some((x) => x.includes("unbekannte Seite")), b.join("\n"));
  });
  test("rot: Abschnitt fehlt", () => {
    assert.equal(inventarBefunde("# Titel\n\n## Anderes\n").length, 1);
  });
  test("grün: der Inventar-Abschnitt ist der letzte der Datei", () => {
    const md = tabelle(vollstaendig()).replace("\n## Nächster Abschnitt\n", "").trimEnd();
    assert.deepEqual(inventarBefunde(md), []);
  });
  test("grün: Zeilen hinter dem nächsten ##-Abschnitt zählen nicht", () => {
    assert.deepEqual(inventarBefunde(`${tabelle(vollstaendig())}\n${zeile("docs/andere.md")}\n`), []);
  });
  test("rot: Tabellenzeile mit falscher Zellenzahl wird gemeldet statt übersprungen", () => {
    const fuenf = "| `docs/agent-harness.md` | a | Projekt | b | c |";
    const drei = "| `docs/agent-harness.md` | Projekt | b |";
    for (const z of [fuenf, drei]) {
      const b = inventarBefunde(tabelle([...vollstaendig(), z]));
      assert.ok(b.some((x) => x.includes("Zellen")), b.join("\n"));
    }
  });
  test("rot: Seitenpfad ohne Backticks ist unbekannt", () => {
    const b = inventarBefunde(tabelle([...vollstaendig(), "| docs/agent-harness.md | alles | Projekt | bleibt hier |"]));
    assert.ok(b.some((x) => x.includes("unbekannte Seite")), b.join("\n"));
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

describe("Lebendprobe an den echten Seiten", () => {
  test("das Inventar deckt alle sieben Seiten ab", () => {
    const md = lies(INVENTAR_DATEI);
    assert.deepEqual(inventarBefunde(md), []);
    const seiten = new Set([...md.matchAll(/^\| `(docs\/[^`]+)` \|/gm)].map((m) => m[1]));
    assert.ok(seiten.size >= INVENTAR_SEITEN.length, `nur ${seiten.size} Seiten im Inventar`);
  });
  for (const seite of GEKUERZT) {
    test(`${seite} besteht nur aus Projektanteil, GEN-Blöcken und Kern-Zeilen`, () => {
      const p = kuerzungBefunde(lies(seite));
      assert.deepEqual(p.befunde, []);
      assert.ok(p.ueberschriften >= 3, `nur ${p.ueberschriften} Überschriften gescannt`);
    });
  }
});

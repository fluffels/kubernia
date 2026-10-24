/* Extraktionsliste und Test-Hülle (#1875, ADR 0022 F10, Teil 5): `.factory/extraktion.json` ordnet jede Testdatei mit Bezug
 * zum Besitz als `kern-test` (zieht ins Factory-Repo) oder `projekt-test` (bleibt) ein; die Test-Hülle verlangt, dass jeder
 * lokale Import eines Kern-Tests (und der Test-Hilfen und Fixtures) auf Besitz, die Projekt-Config oder einen mitziehenden
 * Eintrag der Liste zeigt. Die Struktur der Liste prüft `pruefeExtraktion` (scripts/besitz-extraktion.mjs).
 *
 * @harness-waechter – einziger Durchsetzer seiner Regel, darum im geschützten test/harness/ (#1165).
 *
 * Bezug eines Tests: ein relativer Import, der auf eine Ganz-Datei-Besitz-Einheit auflöst, oder die wörtliche Nennung eines
 * Besitz-Pfads im Text. Bekannte Grenzen (fail-open, nicht fail-closed): ein zusammengesetzter Pfad (`join("scripts", name)`)
 * und ein per `readFileSync` gelesener Projekt-Text sind für Bezug und Hülle unsichtbar; ein unauflösbarer Spezifizierer
 * (`require("./fehlt")` als Fixture-Text) zählt nicht. Dieser Test selbst ist ein `projekt-test`: er entfällt mit der
 * einmaligen Extraktion (K9). */
import { describe, test } from "vitest";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as rawBesitz from "../../scripts/besitz-lib.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as rawExtraktion from "../../scripts/besitz-extraktion.mjs";

interface ExtraktionEintrag {
  muster?: string;
  ring?: string;
  art: string;
  grund: string;
}
interface Liste {
  version: number;
  eintraege: ExtraktionEintrag[];
}
interface BesitzEintrag {
  pfad: string;
  block?: string;
  schluessel?: string;
  ring: string;
}
interface Lib {
  EXTRAKTION_PFAD: string;
  extraktionsArten: (quelle: string) => Record<string, ((p: string) => boolean) | null>;
  MITZIEHEND: string[];
  RINGE: string[];
  NUR_FACTORY: string[];
  musterRegex: (muster: string) => RegExp;
  artVon: (liste: Liste, pfad: string) => string | null;
  pruefeExtraktion: (liste: Liste, opt: { getrackt: string[]; besitz: BesitzEintrag[]; quelle?: string; ringe?: string[]; nurFactory?: string[] }) => string[];
  istGanzeDatei: (e: BesitzEintrag) => boolean;
  zielDatei: (von: string, spec: string, getrackt: Set<string>) => string | null;
  bezugsTests: (getrackt: string[], lies: (p: string) => string | null, ganzerBesitz: Set<string>) => string[];
  zuordnungsLuecken: (liste: Liste, bezug: string[]) => string[];
  lesebezuege: (von: string, text: string, getrackt: Set<string>) => string[];
  huellenVerstoesse: (liste: Liste, getrackt: string[], lies: (p: string) => string | null, ganzerBesitz: Set<string>) => string[];
  testHuelle: (verstoesse: string[], ausnahmen: Record<string, string>, quelle: string) => string[];
}
// Begründete Ausnahme wie in kern-reinheit.test.ts: das .mjs hat kein Declaration-File.
const { EXTRAKTION_PFAD, extraktionsArten, MITZIEHEND, RINGE, NUR_FACTORY, musterRegex, artVon, pruefeExtraktion, istGanzeDatei, zielDatei, bezugsTests, zuordnungsLuecken, lesebezuege, huellenVerstoesse, testHuelle } =
  { ...rawBesitz, ...rawExtraktion } as unknown as Lib;

const WURZEL = fileURLToPath(new URL("../../", import.meta.url));
const PROJEKT_CONFIG = ".factory/projekt.json";

const DATEN_DATEI = "Daten-Datei des Kern-Wächters (Baseline oder Abdeckung): ihre Werte sind Projektzustand, der Export entscheidet über Mitgabe oder Neuerzeugung (#1880)";
/** Offene Ausnahmen der Test-Hülle: "<von> -> <nach>" → Grund mit Ticket (K6 #1876 bis #1879, K7 #1880). Darf nur schrumpfen. */
export const TEST_HUELLE_AUSNAHMEN: Record<string, string> = {
  "test/harness/emoji-ratchet.test.ts -> test/harness/emoji-baseline.json": DATEN_DATEI,
  "test/harness/harness-inventar.test.ts -> test/harness/kern-abdeckung.json": DATEN_DATEI,
  "test/harness/kern-links.test.ts -> test/harness/kern-links-baseline.json": DATEN_DATEI,
  "test/harness/kern-reinheit.test.ts -> test/harness/kern-abdeckung.json": DATEN_DATEI,
  "test/harness/kern-reinheit.test.ts -> test/harness/kern-literale-baseline.json": DATEN_DATEI,
  "test/harness/skills-sync.test.ts -> test/harness/kern-abdeckung.json": DATEN_DATEI,
};


// ── Fixtures ──────────────────────────────────────────────────────────────────

const ein = (pfad: string): BesitzEintrag => ({ pfad, ring: "kern" });
const eintrag = (muster: string, art: string, grund = "Grund"): ExtraktionEintrag => ({ muster, art, grund });
const ringEintrag = (ring: string, art = "nur-factory"): ExtraktionEintrag => ({ ring, art, grund: "Grund" });
const liste = (...eintraege: ExtraktionEintrag[]): Liste => ({ version: 1, eintraege });
const GETRACKT = ["scripts/a.mjs", "test/a.test.ts", "test/b.test.ts", "test/support/h.ts", "test/support/f.json", "src/p.ts", "package.json", ".factory/produkt/README.md"];
const OPT = { getrackt: GETRACKT, besitz: [ein("scripts/a.mjs")], quelle: "src", ringe: ["kern", "oberflaeche"], nurFactory: ["oberflaeche"] };
const GUT = liste(
  eintrag("test/a.test.ts", "kern-test"),
  eintrag("test/b.test.ts", "projekt-test"),
  eintrag("test/support/h.ts", "test-hilfe"),
  eintrag("test/support/f.json", "fixture"),
  eintrag("package.json", "infrastruktur-anteil"),
  eintrag(".factory/produkt/README.md", "produkt-wurzel"),
  ringEintrag("oberflaeche"),
);
const meldungen = (l: Liste, opt: Partial<typeof OPT> = {}): string => pruefeExtraktion(l, { ...OPT, ...opt }).join("\n");
const mit = (l: Liste, ...mehr: ExtraktionEintrag[]): Liste => ({ ...l, eintraege: [...l.eintraege, ...mehr] });
const ohne = (l: Liste, pred: (e: ExtraktionEintrag) => boolean): Liste => ({ ...l, eintraege: l.eintraege.filter((e) => !pred(e)) });

describe("Extraktionsliste: Muster und Struktur (#1875)", () => {
  test("musterRegex: * bleibt im Pfadsegment, alles andere ist wörtlich", () => {
    assert.ok(musterRegex("test/a*.test.ts").test("test/ab.test.ts"));
    assert.ok(!musterRegex("test/a*.test.ts").test("test/a/b.test.ts"), "keine Ordnergrenze");
    assert.ok(!musterRegex("test/a.test.ts").test("test/aXtest.ts"), "der Punkt ist wörtlich");
    assert.ok(!musterRegex("test/a").test("xtest/a"), "am Anfang verankert");
    assert.ok(!musterRegex("test/a").test("test/ab"), "am Ende verankert");
    assert.ok(musterRegex("a+(b)*").test("a+(b)xyz") && !musterRegex("a+(b)*").test("aab"), "Regex-Zeichen sind wörtlich");
  });
  test("artVon: Art des treffenden Muster-Eintrags, sonst null; Ring-Einträge zählen nicht", () => {
    assert.equal(artVon(GUT, "test/a.test.ts"), "kern-test");
    assert.equal(artVon(GUT, "test/b.test.ts"), "projekt-test");
    assert.equal(artVon(GUT, "test/x.test.ts"), null);
    assert.equal(artVon(liste(ringEintrag("oberflaeche")), "oberflaeche"), null);
  });
  test("die geschlossene Art-Liste: nur projekt-test zieht nicht mit", () => {
    assert.deepEqual(Object.keys(extraktionsArten("src")).sort(), ["factory-seite", "fixture", "infrastruktur", "infrastruktur-anteil", "kern-test", "nur-factory", "produkt-wurzel", "projekt-test", "test-hilfe"]);
    assert.ok(!MITZIEHEND.includes("projekt-test") && MITZIEHEND.includes("kern-test") && MITZIEHEND.includes("nur-factory"));
  });
  test("eine gültige Liste ist grün", () => {
    assert.deepEqual(pruefeExtraktion(GUT, OPT), []);
  });
  test("falsche Version, fehlende Einträge und Eintrag mit beidem oder keinem von muster/ring sind rot", () => {
    assert.match(meldungen({ ...GUT, version: 2 }), /version muss 1 sein/);
    assert.match(meldungen({ version: 1 } as unknown as Liste), /eintraege fehlt/);
    assert.match(meldungen(mit(GUT, { muster: "src/p.ts", ring: "kern", art: "infrastruktur", grund: "g" })), /genau eines von muster oder ring/);
    assert.match(meldungen(mit(GUT, { art: "infrastruktur", grund: "g" })), /genau eines von muster oder ring/);
  });
  test("unbekannte Art und leerer Grund sind rot", () => {
    assert.match(meldungen(mit(GUT, eintrag("scripts/a.mjs", "magie"))), /unbekannte art 'magie'/);
    assert.match(meldungen(mit(GUT, eintrag("src/p.ts", "infrastruktur", " "))), /grund fehlt/);
    assert.match(meldungen(mit(GUT, { muster: "src/p.ts", art: "infrastruktur" } as ExtraktionEintrag)), /grund fehlt/, "ein Eintrag ganz ohne grund");
    assert.match(meldungen(mit(GUT, { muster: "src/p.ts", art: "constructor", grund: "g" })), /unbekannte art 'constructor'/);
  });
  test("ein Muster ohne Treffer, auf Besitz oder mit Überlappung ist rot", () => {
    assert.match(meldungen(mit(GUT, eintrag("test/fehlt.test.ts", "kern-test"))), /test\/fehlt\.test\.ts: Eintrag ohne Treffer/);
    assert.match(meldungen(mit(GUT, eintrag("scripts/a.mjs", "infrastruktur"))), /trifft die Besitz-Datei scripts\/a\.mjs/);
    assert.match(meldungen(mit(GUT, eintrag("test/*.test.ts", "projekt-test"))), /test\/a\.test\.ts: von mehreren Einträgen getroffen/);
  });
  test("eine Art am falschen Ort ist rot, je Art", () => {
    const rot = (muster: string, art: string): string => meldungen(mit(ohne(GUT, (e) => e.muster === "package.json"), eintrag(muster, art)));
    assert.match(rot("src/p.ts", "kern-test"), /liegt nicht an einem Ort der art kern-test/);
    assert.match(rot("test/support/h.ts", "projekt-test"), /art projekt-test/);
    assert.match(rot("package.json", "test-hilfe"), /art test-hilfe/);
    assert.match(rot("package.json", "fixture"), /art fixture/);
    assert.match(rot("src/p.ts", "infrastruktur"), /art infrastruktur/);
    assert.match(rot("test/support/f.json", "infrastruktur-anteil"), /art infrastruktur-anteil/);
    assert.match(rot("package.json", "factory-seite"), /art factory-seite/);
    assert.match(rot("package.json", "produkt-wurzel"), /art produkt-wurzel/);
  });
  test("Orts-Grenzen je Art: Endung, .test.ts, .md und Verschachtelung zählen", () => {
    const g = ["test/support/x.json", "test/support/y.test.ts", "docs/a.txt", ".factory/produkt/x/y", "test/support/ok.ts"];
    const rot = (muster: string, art: string): string => meldungen(liste(eintrag(muster, art)), { getrackt: g, besitz: [], nurFactory: [] });
    assert.match(rot("test/support/x.json", "test-hilfe"), /art test-hilfe/, "Test-Hilfe braucht eine Code-Endung");
    assert.match(rot("test/support/y.test.ts", "test-hilfe"), /art test-hilfe/);
    assert.match(rot("test/support/y.test.ts", "fixture"), /art fixture/);
    assert.match(rot("docs/a.txt", "factory-seite"), /art factory-seite/);
    assert.match(rot(".factory/produkt/x/y", "produkt-wurzel"), /art produkt-wurzel/);
    assert.doesNotMatch(rot("test/support/ok.ts", "test-hilfe"), /liegt nicht an einem Ort/);
    assert.doesNotMatch(rot("test/support/x.json", "fixture"), /liegt nicht an einem Ort/);
  });
  test("Ring-Einträge: andere Art, unbekannter Ring, Ring ohne Nur-Factory und nur-factory als Muster sind rot", () => {
    assert.match(meldungen(mit(GUT, ringEintrag("kern", "infrastruktur"))), /Ring-Eintrag hat die art nur-factory/);
    assert.match(meldungen(mit(GUT, ringEintrag("gibtsnicht"))), /ring gibtsnicht: unbekannter Ring/);
    assert.match(meldungen(mit(GUT, ringEintrag("kern"))), /ring kern: der Ring ist nicht nur Factory/);
    assert.match(meldungen(mit(GUT, eintrag("src/p.ts", "nur-factory"))), /nur-factory gilt nur als Ring-Eintrag/);
  });
  test("ein Nur-Factory-Ring ohne Ring-Eintrag ist rot", () => {
    assert.match(meldungen(ohne(GUT, (e) => e.ring === "oberflaeche")), /ring oberflaeche: Ring ist nur Factory, braucht einen Ring-Eintrag/);
  });
  test("eine Datei direkt in .factory/produkt/ ohne produkt-wurzel ist rot", () => {
    assert.match(meldungen(ohne(GUT, (e) => e.art === "produkt-wurzel")), /\.factory\/produkt\/README\.md: Wurzel-Datei des Factory-Repos/);
  });
  test("Standardwerte: ohne ringe/nurFactory gilt die Ring-Tabelle der Lib", () => {
    assert.ok(NUR_FACTORY.every((r) => RINGE.includes(r)));
    const liefert = pruefeExtraktion(ohne(GUT, (e) => e.ring !== undefined), { getrackt: GETRACKT, besitz: [], quelle: "src" });
    assert.match(liefert.join("\n"), new RegExp(`ring ${NUR_FACTORY[0] ?? "?"}: Ring ist nur Factory`));
    assert.doesNotMatch(pruefeExtraktion(mit(GUT, ringEintrag("kern")), { getrackt: GETRACKT, besitz: [], quelle: "src" }).join("\n"), /unbekannter Ring/, "kern ist ein Ring der Lib");
  });
});

describe("Extraktionsliste: Bezug, Zuordnung und Test-Hülle (#1875)", () => {
  const BESITZ = new Set(["scripts/a.mjs"]);
  const dateien: Record<string, string> = {
    "test/mit-import.test.ts": 'import { x } from "../scripts/a";\n',
    "test/mit-nennung.test.ts": 'const p = "scripts/a.mjs";\n',
    "test/fixture-text.test.ts": 'const t = `require("./fehlt")`;\n',
    "test/ohne.test.ts": 'import { y } from "./support/h";\n',
    "test/support/h.ts": "export const y = 1;\n",
    "scripts/a.mjs": "export const x = 1;\n",
    "src/p.ts": "export const p = 1;\n",
    "test/b.test.ts": "x\n",
  };
  const getrackt = Object.keys(dateien);
  const lies = (p: string): string | null => dateien[p] ?? null;

  test("zielDatei: roh, endungslos über .ts/.mjs/.cjs/.js, nichts getrackt: null", () => {
    const g = new Set(["a/b.ts", "a/c.mjs", "a/d.cjs", "a/e.js", "a/f.json", "z.ts"]);
    assert.equal(zielDatei("a/x.test.ts", "./b", g), "a/b.ts");
    assert.equal(zielDatei("a/x.test.ts", "./c", g), "a/c.mjs");
    assert.equal(zielDatei("a/x.test.ts", "./d", g), "a/d.cjs");
    assert.equal(zielDatei("a/x.test.ts", "./e", g), "a/e.js");
    assert.equal(zielDatei("a/x.test.ts", "./f.json", g), "a/f.json");
    assert.equal(zielDatei("a/x.test.ts", "../z", g), "z.ts");
    assert.equal(zielDatei("a/x.test.ts", "./fehlt", g), null);
  });
  test("bezugsTests: Import oder wörtliche Pfadnennung zählt, Fixture-Text und fremde Importe nicht", () => {
    assert.deepEqual(bezugsTests(getrackt, lies, BESITZ), ["test/mit-import.test.ts", "test/mit-nennung.test.ts"]);
    assert.deepEqual(bezugsTests(getrackt, lies, new Set()), [], "ohne Besitz kein Bezug");
  });
  test("zuordnungsLuecken: ein Test mit Bezug ohne Eintrag ist rot und nennt den Weg, mit Eintrag grün (K6)", () => {
    const bezug = ["test/mit-import.test.ts"];
    assert.match(zuordnungsLuecken(liste(), bezug).join(), /test\/mit-import\.test\.ts: in \.factory\/extraktion\.json als kern-test .* oder projekt-test .* eintragen/);
    assert.deepEqual(zuordnungsLuecken(liste(eintrag("test/mit-import.test.ts", "kern-test")), bezug), []);
    assert.deepEqual(zuordnungsLuecken(liste(eintrag("test/mit-import.test.ts", "projekt-test")), bezug), []);
    assert.notDeepEqual(zuordnungsLuecken(liste(eintrag("test/mit-import.test.ts", "fixture")), bezug), [], "eine andere Art ordnet nicht zu");
    assert.deepEqual(zuordnungsLuecken(liste(), []), [], "ein Test ohne Bezug braucht keinen Eintrag");
  });
  test("Test-Hülle: kern-test mit Import aus src/ ist rot und nennt den Weg, derselbe Import im projekt-test grün (K6)", () => {
    const text = { ...dateien, "test/k.test.ts": 'import { p } from "../src/p";\n' };
    const g = Object.keys(text);
    const l = (art: string): Liste => liste(eintrag("test/k.test.ts", art));
    const v = huellenVerstoesse(l("kern-test"), g, (p) => text[p as keyof typeof text] ?? null, BESITZ);
    assert.deepEqual(v, ["test/k.test.ts -> src/p.ts"]);
    assert.match(testHuelle(v, {}, "src").join(), /src\/ ist Projektcode: den Test als projekt-test einordnen oder die Abhängigkeit durch ein Fixture ersetzen/);
    assert.deepEqual(huellenVerstoesse(l("projekt-test"), g, (p) => text[p as keyof typeof text] ?? null, BESITZ), []);
  });
  test("Test-Hülle: Ziele Besitz, Projekt-Config und eingetragene Hilfe grün, nicht eingetragene Hilfe und projekt-test-Ziel rot", () => {
    const text: Record<string, string> = {
      "test/k.test.ts": 'import "../scripts/a"; import "../.factory/projekt.json"; import "./support/h"; import "./b.test";\n',
      "scripts/a.mjs": "",
      ".factory/projekt.json": "{}",
      "test/support/h.ts": "",
      "test/b.test.ts": "",
    };
    const g = Object.keys(text);
    const lesen = (p: string): string | null => text[p] ?? null;
    const l = liste(eintrag("test/k.test.ts", "kern-test"), eintrag("test/b.test.ts", "projekt-test"));
    assert.deepEqual(huellenVerstoesse(l, g, lesen, BESITZ), ["test/k.test.ts -> test/support/h.ts", "test/k.test.ts -> test/b.test.ts"]);
    assert.match(testHuelle(["test/k.test.ts -> test/support/h.ts"], {}, "src").join(), /Ziel als test-hilfe oder fixture eintragen .* den Import entfernen oder den Test als projekt-test einordnen/);
    const l2 = liste(eintrag("test/k.test.ts", "kern-test"), eintrag("test/support/h.ts", "test-hilfe"), eintrag("test/b.test.ts", "projekt-test"));
    assert.deepEqual(huellenVerstoesse(l2, g, lesen, BESITZ), ["test/k.test.ts -> test/b.test.ts"]);
  });
  test("Test-Hülle ist transitiv: eine Test-Hilfe mit Import aus src/ ist rot, ein Fixture ohne Code-Endung wird nicht gelesen", () => {
    const text: Record<string, string> = {
      "test/support/h.ts": 'import "../../src/p"; import "./fehlt";\n',
      "test/support/f.json": 'import "../../src/p";',
      "test/support/g.mjs": 'import "../../src/p";\n',
      "src/p.ts": "",
    };
    const g = Object.keys(text);
    const l = liste(eintrag("test/support/h.ts", "test-hilfe"), eintrag("test/support/f.json", "fixture"), eintrag("test/support/g.mjs", "fixture"));
    assert.deepEqual(huellenVerstoesse(l, g, (p) => text[p] ?? null, new Set()), ["test/support/h.ts -> src/p.ts", "test/support/g.mjs -> src/p.ts"], "Fixture mit Code-Endung zählt, ohne nicht, ein unauflösbarer Import nicht");
    assert.deepEqual(huellenVerstoesse(l, g, () => null, new Set()), [], "ohne Text nichts zu prüfen");
  });
  test("Lese-Bezüge: ein Pfad-Literal (auch aus mehreren Literalen eines Aufrufs) auf eine getrackte Datei unter test/ zählt, sonst nicht", () => {
    const g = new Set(["test/a.test.ts", "test/fixtures/x.json", "docs/a.md"]);
    const l = (text: string): string[] => lesebezuege("test/a.test.ts", text, g);
    assert.deepEqual(l('readFileSync(join(__dirname, "./fixtures/x.json"))'), ["test/fixtures/x.json"]);
    assert.deepEqual(l('new URL("../test/fixtures/x.json", import.meta.url)'), ["test/fixtures/x.json"]);
    assert.deepEqual(l('join(WURZEL, "test", "fixtures", "x.json")'), ["test/fixtures/x.json"]);
    assert.deepEqual(l("lies(`fixtures/x.json`)"), ["test/fixtures/x.json"]);
    assert.deepEqual(l("lies('fixtures/x.json')"), ["test/fixtures/x.json"], "einfache Anführungszeichen");
    assert.deepEqual(l('/* lies("fixtures/x.json") */'), [], "Blockkommentar-Zeile");
    const tief = new Set(["test/harness/a.test.ts", "test/a/b/c/d/x.json", "test/a/b/c/d/e/x.json"]);
    const lt = (text: string): string[] => lesebezuege("test/harness/a.test.ts", text, tief);
    assert.deepEqual(lt('join(R, "test", "fixtures", "x.json")'), [], "ab dem Ordner des Tests löst nichts auf");
    assert.deepEqual(lt('join(R, "test", "a", "b", "c", "d", "x.json")'), ["test/a/b/c/d/x.json"], "sechs Literale ab der Wurzel");
    assert.deepEqual(lt('join(R, "test", "a", "b", "c", "d", "e", "x.json")'), [], "sieben Literale liegen außerhalb des Fensters");
    assert.deepEqual(l('lies("fixtures/y.json")'), [], "keine getrackte Datei");
    assert.deepEqual(l('lies("docs/a.md")'), [], "außerhalb von test/ bleibt unsichtbar (Grenze)");
    assert.deepEqual(l('lies("a.test.ts")'), [], "die Datei selbst zählt nicht");
    assert.deepEqual(l('// lies("fixtures/x.json")\n * "fixtures/x.json"'), [], "Kommentare zählen nicht");
  });
  test("Test-Hülle: ein per readFileSync gelesenes Fixture muss in der Liste stehen, sonst rot mit Weg (K2)", () => {
    const text: Record<string, string> = { "test/k.test.ts": 'const d = readFileSync(join(__dirname, "./fixtures/x.json"), "utf8");\n', "test/fixtures/x.json": "{}" };
    const g = Object.keys(text);
    const lesen = (p: string): string | null => text[p] ?? null;
    const v = huellenVerstoesse(liste(eintrag("test/k.test.ts", "kern-test")), g, lesen, new Set());
    assert.deepEqual(v, ["test/k.test.ts -> test/fixtures/x.json"]);
    assert.match(testHuelle(v, {}, "src").join(), /Ziel als test-hilfe oder fixture eintragen/);
    assert.deepEqual(huellenVerstoesse(liste(eintrag("test/k.test.ts", "kern-test"), eintrag("test/fixtures/x.json", "fixture")), g, lesen, new Set()), []);
    assert.deepEqual(huellenVerstoesse(liste(eintrag("test/k.test.ts", "projekt-test")), g, lesen, new Set()), [], "ein projekt-test liest frei");
  });
  test("Test-Hülle: Ausnahmen mit Ticket grün, ohne Ticket rot, veraltet rot, auf src/ rot", () => {
    const v = ["test/k.test.ts -> test/support/h.ts"];
    assert.deepEqual(testHuelle(v, { [v[0] ?? ""]: "K6 #1876" }, "src"), []);
    assert.match(testHuelle(v, { [v[0] ?? ""]: "später" }, "src").join(), /Ausnahme ohne Ticket/);
    assert.match(testHuelle([], { [v[0] ?? ""]: "K6 #1876" }, "src").join(), /Ausnahme veraltet/);
    const s = ["test/k.test.ts -> src/p.ts"];
    assert.match(testHuelle(s, { [s[0] ?? ""]: "K6 #1876" }, "src").join(), /Ausnahme auf src\/ ist nie erlaubt/);
  });
});

describe("Extraktionsliste: Quellwurzel als Parameter und Vorkompilierung (#1888)", () => {
  const getrackt = ["scripts/a.mjs", "src/p.ts", "lib/p.ts", "test/a.test.ts"];
  const opt = { getrackt, besitz: [ein("scripts/a.mjs")], ringe: ["kern"], nurFactory: [] as string[] };
  const l = (muster: string): Liste => liste(eintrag(muster, "infrastruktur"));

  test("Infrastruktur liegt weder in test/, docs/ noch in der Quellwurzel der Config: quelle lib macht lib/ zum Projektcode, src/ zur Infrastruktur", () => {
    assert.match(pruefeExtraktion(l("lib/p.ts"), { ...opt, quelle: "lib" }).join("\n"), /lib\/p\.ts liegt nicht an einem Ort der art infrastruktur/);
    assert.doesNotMatch(pruefeExtraktion(l("src/p.ts"), { ...opt, quelle: "lib" }).join("\n"), /liegt nicht an einem Ort/);
    assert.match(pruefeExtraktion(l("src/p.ts"), { ...opt, quelle: "src" }).join("\n"), /src\/p\.ts liegt nicht an einem Ort der art infrastruktur/);
    assert.doesNotMatch(pruefeExtraktion(l("lib/p.ts"), { ...opt, quelle: "src" }).join("\n"), /liegt nicht an einem Ort/);
  });
  test("extraktionsArten(quelle): dieselben Arten für jede Quellwurzel, nur der Ort der Infrastruktur folgt ihr", () => {
    assert.deepEqual(Object.keys(extraktionsArten("lib")), Object.keys(extraktionsArten("src")));
    assert.equal(extraktionsArten("lib").infrastruktur?.("src/x.ts"), true);
    assert.equal(extraktionsArten("lib").infrastruktur?.("lib/x.ts"), false);
    assert.equal(extraktionsArten("lib")["infrastruktur-anteil"]?.("docs/x.md"), false);
    // Ausnahme in docs/: nur die Diagramm-Vorlagen (genau eine Ebene, nur .mmd), für beide Infrastruktur-Arten
    for (const art of ["infrastruktur", "infrastruktur-anteil"] as const) {
      assert.equal(extraktionsArten("lib")[art]?.("docs/diagramme/x.mmd"), true, art);
      assert.equal(extraktionsArten("lib")[art]?.("docs/x.mmd"), false, art);
      assert.equal(extraktionsArten("lib")[art]?.("docs/diagramme/x.md"), false, art);
      assert.equal(extraktionsArten("lib")[art]?.("docs/diagramme/sub/x.mmd"), false, art);
      assert.equal(extraktionsArten("lib")[art]?.("docs/diagramme/xmmd"), false, art);
      assert.equal(extraktionsArten("lib")[art]?.("docs/diagramme/x-mmd"), false, art, "der Punkt vor mmd ist maskiert");
      assert.equal(extraktionsArten("lib")[art]?.("docs/diagramme/x.mmd.md"), false, art, "die Endung ist verankert");
      assert.equal(extraktionsArten("lib")[art]?.("test/docs/diagramme/x.mmd"), false, art, "der Pfad ist an der Wurzel verankert");
      assert.equal(extraktionsArten("lib")[art]?.("lib/docs/diagramme/x.mmd"), false, art, "auch unter der Quellwurzel");
    }
  });
  test("ohne Quellwurzel bricht die Prüfung ab (der Kern kennt keinen festen Namen)", () => {
    assert.throws(() => pruefeExtraktion(l("src/p.ts"), opt), /quelle .* fehlt/);
    assert.throws(() => pruefeExtraktion(l("src/p.ts"), { ...opt, quelle: "" }), /quelle .* fehlt/);
  });
  test("artVon: vorkompiliert, gleiches Ergebnis wie die Einzelprüfung; die Muster werden je Liste einmal gelesen", () => {
    let zugriffe = 0;
    const gezaehlt = (muster: string, art: string): ExtraktionEintrag => ({ get muster(): string { zugriffe++; return muster; }, art, grund: "g" });
    const gross = liste(gezaehlt("test/*.test.ts", "kern-test"), gezaehlt("scripts/*.mjs", "infrastruktur"), gezaehlt("src/*", "infrastruktur"));
    const ist = ["test/a.test.ts", "scripts/a.mjs", "src/p.ts", "nichts.txt"].map((p) => artVon(gross, p));
    assert.deepEqual(ist, ["kern-test", "infrastruktur", "infrastruktur", null]);
    const nachErstem = zugriffe;
    for (let i = 0; i < 20; i++) artVon(gross, "test/a.test.ts");
    assert.equal(zugriffe, nachErstem, "weitere Aufrufe lesen die Muster nicht erneut");
    const naiv = (p: string): string | null => GUT.eintraege.find((e) => e.muster !== undefined && musterRegex(e.muster).test(p))?.art ?? null;
    for (const p of [...GETRACKT, "nichts.txt", "test/x.test.ts"]) assert.equal(artVon(GUT, p), naiv(p), p);
  });
  test("artVon: ein neuer Eintrag oder eine ausgetauschte Eintragsliste ist beim nächsten Aufruf sichtbar", () => {
    const l2: Liste = liste(eintrag("test/a.test.ts", "kern-test"));
    assert.equal(artVon(l2, "test/b.test.ts"), null);
    l2.eintraege.push(eintrag("test/b.test.ts", "projekt-test"));
    assert.equal(artVon(l2, "test/b.test.ts"), "projekt-test", "angehängt");
    l2.eintraege = [eintrag("test/b.test.ts", "kern-test"), eintrag("test/c.test.ts", "kern-test")];
    assert.equal(artVon(l2, "test/b.test.ts"), "kern-test", "ausgetauscht (gleiche Länge)");
  });
});

describe("Test-Hülle: erlaubte Ziel-Arten (#1888)", () => {
  const text: Record<string, string> = {
    "test/k.test.ts": 'import "../package.json"; import "../docs/s.md"; import "../scripts/i.mjs"; import "./b.test"; import "../src/p"; import "./loose";\n',
    "package.json": "{}",
    "docs/s.md": "",
    "scripts/i.mjs": "",
    "test/b.test.ts": "",
    "test/loose.ts": "",
    "src/p.ts": "",
  };
  const g = Object.keys(text);
  const lesen = (p: string): string | null => text[p] ?? null;
  const l = liste(
    eintrag("test/k.test.ts", "kern-test"),
    eintrag("package.json", "infrastruktur-anteil"),
    eintrag("docs/s.md", "factory-seite"),
    eintrag("scripts/i.mjs", "infrastruktur"),
    eintrag("test/b.test.ts", "projekt-test"),
  );

  test("Entscheidung: infrastruktur-anteil (Vorlage), factory-seite (Kopie) und infrastruktur sind erlaubte Ziele eines Kern-Tests", () => {
    assert.ok(["infrastruktur-anteil", "factory-seite", "infrastruktur"].every((a) => MITZIEHEND.includes(a)));
    assert.ok(!huellenVerstoesse(l, g, lesen, new Set()).some((v) => /package\.json|docs\/s\.md|scripts\/i\.mjs/.test(v)));
  });
  test("verboten bleiben ein projekt-test und eine nicht eingeordnete Datei (src/ und test/loose.ts); nur-factory ist nie Muster-Ziel", () => {
    assert.deepEqual(huellenVerstoesse(l, g, lesen, new Set()), ["test/k.test.ts -> test/b.test.ts", "test/k.test.ts -> src/p.ts", "test/k.test.ts -> test/loose.ts"]);
    assert.ok(MITZIEHEND.includes("nur-factory") && !MITZIEHEND.includes("projekt-test"));
    assert.equal(extraktionsArten("src")["nur-factory"], null, "nur-factory hat keinen Ort: er steht nur als Ring-Eintrag");
  });
});

// ── Echtes Repo ───────────────────────────────────────────────────────────────

const lesenWurzel = (pfad: string): string | null => (existsSync(WURZEL + pfad) ? readFileSync(WURZEL + pfad, "utf8") : null);
const getracktEcht = execFileSync("git", ["ls-files"], { cwd: WURZEL, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
  .split("\n")
  .filter((p) => p !== "" && existsSync(WURZEL + p));
const besitzEcht = (JSON.parse(readFileSync(WURZEL + ".factory/besitz.json", "utf8")) as { eintraege: BesitzEintrag[] }).eintraege;
const ganzerBesitz = new Set(besitzEcht.filter((e) => istGanzeDatei(e)).map((e) => e.pfad));
const listeEcht = JSON.parse(readFileSync(WURZEL + EXTRAKTION_PFAD, "utf8")) as Liste;
const quelle = (JSON.parse(readFileSync(WURZEL + PROJEKT_CONFIG, "utf8")) as { struktur: { quelle: string } }).struktur.quelle;

describe("Extraktionsliste im echten Repo (#1875)", () => {
  test("die Liste ist gültig: Struktur, Orte, kein Eintrag auf Besitz, Ring oberflaeche und Wurzel-Dateien", () => {
    assert.deepEqual(pruefeExtraktion(listeEcht, { getrackt: getracktEcht, besitz: besitzEcht, quelle }), []);
  });
  test("jede Testdatei mit Bezug zum Besitz ist als kern-test oder projekt-test eingeordnet", () => {
    const bezug = bezugsTests(getracktEcht, lesenWurzel, ganzerBesitz);
    assert.ok(bezug.length > 100, "der Bezug wird erkannt (sonst wäre der Wächter still aus)");
    assert.deepEqual(zuordnungsLuecken(listeEcht, bezug), []);
  });
  test("jeder lokale Import eines Kern-Tests (und jeder Test-Hilfe) zeigt auf Besitz, die Projekt-Config oder einen mitziehenden Eintrag", () => {
    const v = huellenVerstoesse(listeEcht, getracktEcht, lesenWurzel, ganzerBesitz);
    assert.deepEqual(testHuelle(v, TEST_HUELLE_AUSNAHMEN, quelle), []);
  });
  test("Pins: oberflaeche ist nur Factory, README und LICENSE sind Wurzel-Dateien, Infrastruktur steht in der Liste", () => {
    assert.ok(listeEcht.eintraege.some((e) => e.ring === "oberflaeche" && e.art === "nur-factory"));
    assert.equal(artVon(listeEcht, ".factory/produkt/README.md"), "produkt-wurzel");
    assert.equal(artVon(listeEcht, ".factory/produkt/LICENSE"), "produkt-wurzel");
    assert.equal(artVon(listeEcht, "test/harness/extraktion.test.ts"), "projekt-test", "dieser Wächter bleibt im Projekt und entfällt mit der Extraktion");
    for (const p of [".gitattributes", ".nvmrc"]) assert.equal(artVon(listeEcht, p), "infrastruktur", p);
    for (const p of ["package.json", "tsconfig.json", "eslint.config.js", "vite.config.ts", ".github/workflows/ci.yml"]) assert.equal(artVon(listeEcht, p), "infrastruktur-anteil", p);
  });
  test("jede Seite, auf die Besitz verlinkt (kern-links-baseline), ist als factory-seite eingetragen", () => {
    const paare = (JSON.parse(readFileSync(WURZEL + "test/harness/kern-links-baseline.json", "utf8")) as { paare: string[] }).paare;
    const ziele = [...new Set(paare.map((p) => p.split(" -> ")[1] ?? "").filter((z) => z.startsWith("docs/")))];
    assert.ok(ziele.length >= 11, "Link-Ziele gefunden");
    for (const z of ziele) assert.equal(artVon(listeEcht, z), "factory-seite", z);
  });
});

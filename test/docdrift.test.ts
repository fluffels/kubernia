/* Harness-Drift-Wächter (#529) – hält die "Doku als Kontext-Selektor" ehrlich,
 * jenseits der Datei-Landkarte (die bewacht #482 / docmap.test.ts).
 *
 * AGENTS.md, CLAUDE.md und README werden von JEDER KI-Session als Kontext geladen.
 * Sie nennen `npm run <x>`-Kommandos (die es geben muss) und verweisen mit vielen
 * internen Markdown-Links + `#ankern` quer auf andere Harness-Docs. Beides veraltet
 * leise – ein Agent tippt dann ein totes Kommando oder folgt einem toten Link.
 * Dieser Test macht genau diesen Drift ROT. Fitness-Function-Kategorie neben
 * layering/filesize/docmap (#390/#482), nicht mit Verhaltens-Tests vermischen.
 *
 * Prüf-Logik importiert aus scripts/check-docdrift.mjs (EINE Quelle der Wahrheit
 * mit der CLI `npm run check:docdrift`).
 *
 * Ausführen mit:  npm test   (oder gezielt: npm run check:docdrift)
 */
import { describe, test } from "vitest";
import assert from "node:assert/strict";

// Reines Node-Tooling-Skript ohne Declaration-File (allowJs aus, scripts/ nicht im tsconfig)
// – der Laufzeit-Import genügt, die Typen deklarieren wir hier lokal.
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as checkDocDrift from "../scripts/check-docdrift.mjs";

const parseNpmRunMentions: (md: string) => Set<string> = checkDocDrift.parseNpmRunMentions;
const extractLinks: (md: string) => { target: string; path: string; anchor: string }[] =
  checkDocDrift.extractLinks;
const slugify: (t: string) => string = checkDocDrift.slugify;
const collectHeadingSlugs: (md: string) => string[] = checkDocDrift.collectHeadingSlugs;
const auditDocDrift: () => {
  deadCommands: { file: string; script: string }[];
  undocumentedScripts: string[];
  deadLinks: { file: string; target: string; resolved: string }[];
  deadAnchors: { file: string; target: string; resolved: string; anchor: string }[];
} = checkDocDrift.auditDocDrift;

const audit = auditDocDrift();

describe("Harness-Doku-Drift (#529)", () => {
  test("keine toten Kommandos: jedes dokumentierte `npm run <x>` existiert in package.json", () => {
    assert.deepEqual(
      audit.deadCommands.map((c) => `${c.file}: npm run ${c.script}`),
      [],
      "Diese in der Doku erwähnten npm-Skripte gibt es nicht (mehr) – Kommando korrigieren oder Skript anlegen.",
    );
  });

  test("keine undokumentierten Kern-Skripte: jedes package.json-Skript steht in AGENTS.md/CLAUDE.md/README", () => {
    assert.deepEqual(
      audit.undocumentedScripts,
      [],
      "Diese package.json-Skripte werden in keinem Kern-Doc erwähnt – dokumentieren oder (mit Begründung) in " +
        "scripts/check-docdrift.mjs › DOC_EXEMPT_SCRIPTS aufnehmen.",
    );
  });

  test("keine toten Links: jeder interne Markdown-Link zeigt auf eine existierende Datei", () => {
    assert.deepEqual(
      audit.deadLinks.map((l) => `${l.file}: „${l.target}" → ${l.resolved}`),
      [],
      "Diese internen Links zeigen ins Leere – Pfad korrigieren oder Ziel anlegen.",
    );
  });

  test("keine toten Anker: jeder `#anker` trifft eine reale Überschrift", () => {
    assert.deepEqual(
      audit.deadAnchors.map((a) => `${a.file}: „${a.target}" (#${a.anchor} fehlt in ${a.resolved})`),
      [],
      "Diese Anker-Links treffen keine Überschrift – Anker/Überschrift angleichen (GitHub-Slug-Regel).",
    );
  });

  // ── Red-Green: die Mechanik greift wirklich (ein immer-grüner Wächter wäre wertlos) ──

  test("parseNpmRunMentions erkennt `npm run x` und `npm test`, nicht `npm install`", () => {
    const found = parseNpmRunMentions(
      "Erst `npm install`, dann `npm run build:offline` und `npm test`, aber nicht npm audit.",
    );
    assert.equal(found.has("build:offline"), true);
    assert.equal(found.has("test"), true); // `npm test` → Skript `test`
    assert.equal(found.has("install"), false); // npm-Builtin, kein Skript
    assert.equal(found.has("audit"), false);
  });

  test("extractLinks liefert interne Links (mit Anker), lässt externe aus", () => {
    const md = [
      "Siehe [Regeln](AGENTS.md#konventionen) und [Karte](../CLAUDE.md).",
      "Extern: [Repo](https://github.com/fluffels/kubequest) und [Mail](mailto:x@y.z).",
      "Bild: ![Logo](assets/logo.png).",
    ].join("\n");
    const links = extractLinks(md);
    assert.deepEqual(
      links.map((l) => l.target),
      ["AGENTS.md#konventionen", "../CLAUDE.md", "assets/logo.png"],
      "Nur interne Links (inkl. Bild); http/mailto müssen ausgelassen sein.",
    );
    const anchored = links.find((l) => l.path === "AGENTS.md");
    assert.equal(anchored?.anchor, "konventionen");
  });

  test("extractLinks ignoriert Links in Code-Fences und Inline-Code", () => {
    const md = ["```", "[nur Beispiel](tote-datei.md)", "```", "Echt: [x](CLAUDE.md), Code: `[y](z.md)`."].join(
      "\n",
    );
    assert.deepEqual(
      extractLinks(md).map((l) => l.target),
      ["CLAUDE.md"],
      "Beispiel-Links in ```-Fences und `inline`-Code dürfen nicht als echte Links zählen.",
    );
  });

  test("slugify folgt der GitHub-Regel (Emoji/Em-Dash/Umlaute)", () => {
    assert.equal(slugify("Das Wichtigste zuerst (harte Regeln)"), "das-wichtigste-zuerst-harte-regeln");
    // Emoji + Em-Dash erzeugen führenden bzw. doppelten Bindestrich (echtes AGENTS.md-Beispiel):
    assert.equal(
      slugify("⭐ Oberste Regel — über allem, auch über den ADRs"),
      "-oberste-regel--über-allem-auch-über-den-adrs",
    );
  });

  test("collectHeadingSlugs überspringt Code-Fences und dedupliziert mit -1/-2", () => {
    const md = [
      "# Titel",
      "## Abschnitt",
      "```bash",
      "# kein Heading (bash-Kommentar)",
      "```",
      "## Abschnitt",
    ].join("\n");
    assert.deepEqual(collectHeadingSlugs(md), ["titel", "abschnitt", "abschnitt-1"]);
  });
});

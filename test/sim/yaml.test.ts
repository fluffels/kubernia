import { describe, it, expect } from "vitest";
import { parseYamlDocuments, YamlError, type YamlValue } from "../../src/sim/yaml";

function one(text: string): YamlValue {
  const docs = parseYamlDocuments(text);
  expect(docs).toHaveLength(1);
  return docs[0];
}

function errOf(text: string): YamlError {
  try {
    parseYamlDocuments(text);
  } catch (e) {
    if (e instanceof YamlError) return e;
    throw e;
  }
  throw new Error("kein YamlError für: " + JSON.stringify(text));
}

describe("YAML-Parser: gültige Eingaben", () => {
  const cases: [string, string, YamlValue][] = [
    ["Mapping mit Skalaren", "a: 1\nb: 2.5\nc: true\nd: false\ne: null\nf: ~\ng: text\nh:\n", { a: 1, b: 2.5, c: true, d: false, e: null, f: null, g: "text", h: null }],
    ["Quoted-Strings", 'a: "x: y # z"\nb: \'it\'\'s\'\nc: "ta\\tb"\n', { a: "x: y # z", b: "it's", c: "ta\tb" }],
    ["Versions-/Einheiten-Strings bleiben Text", "a: 1.2.3\nb: 256Mi\nc: 80m\n", { a: "1.2.3", b: "256Mi", c: "80m" }],
    ["verschachteltes Mapping", "a:\n  b:\n    c: 1\n  d: 2\ne: 3\n", { a: { b: { c: 1 }, d: 2 }, e: 3 }],
    ["Sequenz mit Skalaren", "a:\n  - 1\n  - x\n  - \"y\"\n", { a: [1, "x", "y"] }],
    ["Sequenz auf Key-Höhe", "a:\n- name: x\n  v: 1\n- name: y\nb: 2\n", { a: [{ name: "x", v: 1 }, { name: "y" }], b: 2 }],
    ["Sequenz von Mappings", "c:\n  - name: x\n    image: i\n    ports:\n      - containerPort: 80\n  - name: y\n", { c: [{ name: "x", image: "i", ports: [{ containerPort: 80 }] }, { name: "y" }] }],
    ["Sequenz in Sequenz", "- - 1\n  - 2\n- 3\n", [[1, 2], 3]],
    ["Wurzel-Sequenz", "- a\n- b\n", ["a", "b"]],
    ["Kommentare", "# kopf\na: 1 # ende\n\n  # eingerückt\nb: x#nicht\nc: \"#nicht\"\nd: http://x/#frag\n", { a: 1, b: "x#nicht", c: "#nicht", d: "http://x/#frag" }],
    ["Flow leer und flach", 'a: {}\nb: []\nc: ["a", "b"]\nd: [1, x]\n', { a: {}, b: [], c: ["a", "b"], d: [1, "x"] }],
    ["Flow-Liste mit Komma im String", 'a: ["a,b", c]\n', { a: ["a,b", "c"] }],
    ["Literal |", "a: |\n  eins\n  zwei\n\n  vier\nb: 1\n", { a: "eins\nzwei\n\nvier\n", b: 1 }],
    ["Literal |-", "a: |-\n  eins\n  zwei\n\nb: 1\n", { a: "eins\nzwei", b: 1 }],
    ["Literal |+", "a: |+\n  eins\n\nb: 1\n", { a: "eins\n\n", b: 1 }],
    ["Literal mit Tiefe und Doppelpunkt", "a: |\n  x:\n    y: z # kein Kommentar\n", { a: "x:\n  y: z # kein Kommentar\n" }],
    ["Literal in Sequenz", "- |\n  a\n  b\n- c\n", ["a\nb\n", "c"]],
    ["Quoted Key", '"a.b/c": 1\n\'d e\': 2\n', { "a.b/c": 1, "d e": 2 }],
    ["Key mit Punkt und Slash", "app.kubernetes.io/name: web\n", { "app.kubernetes.io/name": "web" }],
    ["Wert mit Doppelpunkt ohne Leerzeichen", "image: registry:5000/web:1.0\n", { image: "registry:5000/web:1.0" }],
    ["CRLF", "a: 1\r\nb:\r\n  c: 2\r\n", { a: 1, b: { c: 2 } }],
    ["Wert in der Folgezeile", "a:\n  wert\n", { a: "wert" }],
    ["negative Zahl", "a: -3\n", { a: -3 }],
  ];
  it.each(cases)("%s", (_n, text, expected) => {
    expect(one(text)).toStrictEqual(expected);
  });

  it("Multi-Dokument: leere Dokumente fallen weg", () => {
    expect(parseYamlDocuments("---\na: 1\n---\n# nur Kommentar\n---\nb: 2\n---\n")).toStrictEqual([{ a: 1 }, { b: 2 }]);
  });

  it("leere Datei ergibt keine Dokumente", () => {
    expect(parseYamlDocuments("")).toStrictEqual([]);
    expect(parseYamlDocuments("\n# nur Kommentar\n\n")).toStrictEqual([]);
  });

  it("Zeilennummern zählen über Dokumentgrenzen hinweg absolut", () => {
    expect(errOf("a: 1\n---\nb: 2\n  c: 3\n").line).toBe(4);
  });
});

describe("YAML-Parser: harte Fehler mit Zeile", () => {
  const cases: [string, string, number, RegExp][] = [
    ["Tab in der Einrückung", "a:\n\tb: 1\n", 2, /Tab/],
    ["Tab nach Leerzeichen", "a:\n  \tb: 1\n", 2, /Tab/],
    ["falsche Einrückung (tiefer)", "a: 1\n  b: 2\n", 2, /Einrückung|Plain/],
    ["inkonsistente Einrückung (Rücksprung)", "a:\n    b: 1\n  c: 2\n", 3, /Einrückung/],
    ["Eintrag in Sequenz zu flach", "a:\n  - x: 1\n   y: 2\n", 3, /Einrückung|unerwartet|Plain/],
    ["doppelter Key", "a: 1\nb: 2\na: 3\n", 3, /doppelter Key "a".*Zeile 1/],
    ["doppelter Key verschachtelt", "m:\n  x: 1\n  x: 2\n", 3, /doppelter Key "x".*Zeile 2/],
    ["Flow-Mapping mit Inhalt", "a: {b: 1}\n", 1, /Flow-Mapping/],
    ["Flow-Mapping in Sequenz", "- {b: 1}\n", 1, /Flow-Mapping/],
    ["verschachtelter Flow", "a: [[1]]\n", 1, /verschachtelt/],
    ["Flow-Liste offen", "a: [1, 2\n", 1, /nicht geschlossen/],
    ["Flow-Liste Komma fehlt", "a: [1 2 \"x\"]\n", 1, /Komma|Element/],
    ["Flow-Liste Komma am Ende", "a: [1,]\n", 1, /Komma/],
    ["Flow-Liste leeres Element", "a: [1,,2]\n", 1, /leeres/],
    ["Anker", "a: &x 1\n", 1, /Anker/],
    ["Alias", "a: *x\n", 1, /Alias/],
    ["Alias als Zeile", "*x\n", 1, /Alias/],
    ["Tag", "a: !!str 1\n", 1, /Tag/],
    ["Direktive", "%YAML 1.2\na: 1\n", 1, /Direktive/],
    ["komplexer Key", "a: ? x\n", 1, /komplex/],
    ["gefalteter Block", "a: >\n  x\n", 1, /gefalt/],
    ["Block-Kopf mit Zahl", "a: |2\n  x\n", 1, /Block-Kopf/],
    ["mehrzeiliger Plain-Skalar", "a: eins\n  zwei\n", 2, /mehrzeilig/],
    ["mehrzeiliger String", 'a: "eins\n  zwei"\n', 1, /nicht geschlossen/],
    ["fehlendes Leerzeichen nach Doppelpunkt", "a: 1\nb:wert\n", 2, /Leerzeichen/],
    ["Zeile ohne Doppelpunkt", "a: 1\nfoo\n", 2, /key: wert/],
    ["Doppelpunkt im Wert", "a: b: c\n", 1, /Doppelpunkt/],
    ["Liste in derselben Zeile wie Key", "a: - x\n", 1, /Liste/],
    ["Text nach schließendem Quote", 'a: "x" y\n', 1, /Text hinter/],
    ["unbekannte Escape-Sequenz", 'a: "\\q"\n', 1, /Escape/],
    ["Key __proto__", "__proto__: 1\n", 1, /__proto__/],
    ["Listeneintrag zwischen Mapping-Einträgen", "a: 1\n- x\n", 2, /Listeneintrag/],
    ["Inhalt hinter ---", "--- a: 1\n", 1, /---/],
    ["Block-Literal mit zu flacher Zeile", "a: |\n    tief\n  flach\n", 3, /Block/],
    ["Wurzel: zweiter Wert", "a\nb\n", 2, /unerwartet/],
  ];
  it.each(cases)("%s", (_n, text, line, re) => {
    const e = errOf(text);
    expect(e.line).toBe(line);
    expect(e.reason).toMatch(re);
    expect(e.message).toBe("yaml: line " + line + ": " + e.reason);
  });

  it("zu tiefe Verschachtelung wird abgefangen, kein Stack-Überlauf", () => {
    const deep = Array.from({ length: 200 }, (_v, i) => " ".repeat(i) + "k:").join("\n");
    expect(errOf(deep).reason).toMatch(/zu tief/);
    expect(errOf("- ".repeat(2000) + "x").reason).toMatch(/zu tief/);
  });

  it("zu lange Dateien werden abgewiesen", () => {
    expect(errOf("a: 1\n".repeat(5001)).reason).toMatch(/zu lang/);
  });
});

describe("YAML-Parser: Quote- und Kommentar-Randfälle", () => {
  it("Apostroph mitten im Wort öffnet keinen String, Kommentar wird entfernt", () => {
    expect(one("a: it's # kommentar\n")).toStrictEqual({ a: "it's" });
  });
  it("escaptes Anführungszeichen im String, # darin bleibt", () => {
    expect(one('a: "x\\" # y"\n')).toStrictEqual({ a: 'x" # y' });
  });
  it("BOM, --- mit Kommentar, große Ganzzahl bleibt Text", () => {
    expect(parseYamlDocuments("﻿a: 1\n--- # neu\nb: 12345678901234567890\n")).toStrictEqual([{ a: 1 }, { b: "12345678901234567890" }]);
  });
});

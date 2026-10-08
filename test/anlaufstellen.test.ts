/* Projekt-Brain-Index (#1428 Z5): `docs/referenz/anlaufstellen.md` ist der Einstieg ins Brain (ADR 0015). Zwei Dinge dürfen nicht still
 * driften: (1) jedes ADR steht im Index (0019 und 0020 fehlten ein Ticket lang), (2) jede Brain-Seite unter docs/ ist über Links vom
 * Index aus erreichbar (eine Seite, die niemand verlinkt, wird nie gelesen). Fitness-Function über die echten Dateien, mit Negativfällen
 * gegen die Hilfsfunktionen. */
import { describe, expect, test } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join, posix } from "node:path";

const WURZEL = process.cwd();
const INDEX = "docs/referenz/anlaufstellen.md";

/** Alle `.md`-Dateien unter `docs/` (relativ, mit `/`). */
function docsSeiten(): string[] {
  const aus: string[] = [];
  const geh = (rel: string) => {
    for (const e of readdirSync(join(WURZEL, rel), { withFileTypes: true })) {
      const p = `${rel}/${e.name}`;
      if (e.isDirectory()) geh(p);
      else if (e.name.endsWith(".md")) aus.push(p);
    }
  };
  geh("docs");
  return aus.sort();
}

/** Lokale Markdown-Ziele (ohne Anker, ohne http) eines Textes, aufgelöst relativ zur Datei `von` (Repo-Pfad mit `/`). Pur. */
function lokaleMdLinks(text: string, von: string): string[] {
  const ziele = [...text.matchAll(/\]\(([^)\s]+?\.md)(?:#[^)\s]*)?\)/g)].map((m) => m[1]).filter((z) => !/^[a-z]+:/i.test(z));
  return ziele.map((z) => (z.startsWith("/") ? z.slice(1) : posix.normalize(posix.join(posix.dirname(von), z))));
}

/** Seiten, die von `start` über lokale Markdown-Links erreichbar sind (nur Seiten aus `vorhanden`). Pur bis auf `lies`. */
function erreichbar(start: string, vorhanden: Set<string>, lies: (p: string) => string): Set<string> {
  const gesehen = new Set<string>([start]);
  const offen = [start];
  while (offen.length > 0) {
    const p = offen.pop() as string;
    for (const z of lokaleMdLinks(lies(p), p)) {
      if (vorhanden.has(z) && !gesehen.has(z)) {
        gesehen.add(z);
        offen.push(z);
      }
    }
  }
  return gesehen;
}

describe("anlaufstellen.md: ADR-Index vollständig (#1428 Z5)", () => {
  test("jedes docs/adr/NNNN-*.md ist im Index verlinkt", () => {
    const index = readFileSync(join(WURZEL, INDEX), "utf8");
    const adrs = docsSeiten().filter((p) => /^docs\/adr\/\d{4}-.*\.md$/.test(p));
    expect(adrs.length).toBeGreaterThan(20);
    const verlinkt = new Set(lokaleMdLinks(index, INDEX));
    expect(adrs.filter((a) => !verlinkt.has(a))).toEqual([]);
  });
});

describe("Brain-Seiten sind vom Index aus erreichbar (#1428 Z5)", () => {
  test("jede docs/**.md ist über Links erreichbar (transitiv, ausgehend von anlaufstellen.md)", () => {
    const seiten = new Set(docsSeiten());
    const ok = erreichbar(INDEX, seiten, (p) => readFileSync(join(WURZEL, p), "utf8"));
    expect([...seiten].filter((s) => !ok.has(s))).toEqual([]);
  });

  test("Negativ: eine unverlinkte Seite wird als nicht erreichbar gefunden, ein Link über zwei Ordner und /-Pfad lösen auf", () => {
    const dateien: Record<string, string> = {
      "docs/referenz/anlaufstellen.md": "[a](../a.md) [x](https://x.de/b.md) [anker](../c/d.md#abschnitt) [abs](/docs/e.md)",
      "docs/a.md": "kein Link",
      "docs/c/d.md": "[zurück](../a.md)",
      "docs/e.md": "",
      "docs/verwaist.md": "[auf a](a.md)",
    };
    const ok = erreichbar("docs/referenz/anlaufstellen.md", new Set(Object.keys(dateien)), (p) => dateien[p]);
    expect([...ok].sort()).toEqual(["docs/a.md", "docs/c/d.md", "docs/e.md", "docs/referenz/anlaufstellen.md"]);
    expect(ok.has("docs/verwaist.md")).toBe(false);
  });

  test("lokaleMdLinks: Anker und externe Ziele fallen weg, relative Pfade werden aufgelöst", () => {
    expect(lokaleMdLinks("[a](../adr/0001-x.md#k) [b](http://x/y.md) [c](bild.png)", "docs/referenz/anlaufstellen.md")).toEqual(["docs/adr/0001-x.md"]);
  });

});

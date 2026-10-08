/* Harness-Inventar-Wächter (#1361).
 *
 * @harness-waechter – einziger Durchsetzer seiner Regel, darum im geschützten test/harness/ (#1165).
 * `docs/harness-inventar.md` bewertet jeden Eigenbau gegen native Features und trägt maschinenlesbare
 * Prüfstand-Marker („Geprüft bis <Werkzeug> <Stand>“), die der Wochenabgleich (#1362) fortschreibt.
 * Drei Dinge dürfen nicht still driften: (1) jedes der fünf Werkzeuge hat genau einen regelkonformen
 * Marker, (2) jeder Baustein der generierten README-Tabelle (ADR 0017) steht in einer Inventarzeile,
 * (3) Urteil und Spielunabhängig nutzen nur das feste Vokabular. Negativfälle gegen die pure Hilfsfunktionen. */
import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as inventar from "../../scripts/docs-gen/harness-inventar.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as docsGen from "../../scripts/docs-gen.mjs";

const WURZEL = process.cwd();
const SEITE = "docs/harness-inventar.md";
const WERKZEUGE = ["Claude Code", "Langfuse", "PixelLab", "Playwright", "GitHub"] as const;
const MARKER = /^- Geprüft bis (Claude Code|Langfuse|PixelLab|Playwright|GitHub) (v?\d+\.\d+\.\d+|\d{4}-\d{2}-\d{2})$/gm;
const KOPF = "| Eigenbau | Zweck | Natives Gegenstück (Doku-Link, ab Version) | Urteil | Spielunabhängig |";
const URTEIL = /^(behalten|ersetzen|beobachten)(:|$)/;
const UNABHAENGIG = /^(ja|nein|teilweise)\b/;

const inventarApi = inventar as unknown as { harnessInventarGenerator: (ctx: { rootDir: string; config: Record<string, unknown> }) => string };
const docsGenApi = docsGen as unknown as { loadConfig: (rootDir?: string) => Record<string, unknown> };

/** Marker (Werkzeug, Stand) aus einem Text. Pur. */
function marker(text: string): { werkzeug: string; stand: string }[] {
  return [...text.matchAll(MARKER)].map((m) => ({ werkzeug: m[1], stand: m[2] }));
}

/** Meldungen zum Prüfstand: jedes Werkzeug genau einmal, keine Zeile mit „Geprüft bis“ außerhalb des Formats. Pur. */
function prueffstandProbleme(text: string): string[] {
  const probleme: string[] = [];
  const gefunden = marker(text).map((m) => m.werkzeug);
  for (const w of WERKZEUGE) {
    const n = gefunden.filter((g) => g === w).length;
    if (n !== 1) probleme.push(`${w}: ${n} Marker statt 1`);
  }
  const roh = text.split("\n").filter((z) => /^- Geprüft bis /.test(z));
  const ok = new Set([...text.matchAll(MARKER)].map((m) => m[0]));
  for (const z of roh) if (!ok.has(z)) probleme.push(`Marker nicht regelkonform: ${z}`);
  return probleme;
}

type Zeile = { zellen: string[] };

/** Zeilen aller Tabellen mit dem fünfspaltigen Inventar-Kopf (ohne Kopf und Trennzeile). Pur. */
function inventarZeilen(text: string): Zeile[] {
  const zeilen = text.split("\n");
  const aus: Zeile[] = [];
  for (let i = 0; i < zeilen.length; i++) {
    if (zeilen[i].trim() !== KOPF) continue;
    for (let j = i + 2; j < zeilen.length && zeilen[j].startsWith("|"); j++) {
      aus.push({ zellen: zeilen[j].split("|").slice(1, -1).map((z) => z.trim()) });
    }
  }
  return aus;
}

/** Namen der Bausteine aus der generierten Tabelle (zweite Spalte, ohne Backticks). Pur. */
function generierteNamen(tabelle: string): string[] {
  return tabelle
    .split("\n")
    .slice(2)
    .map((z) => z.split("|")[2]?.trim().replace(/^`|`$/g, "") ?? "")
    .filter((n) => n !== "");
}

/** Bausteine ohne Inventarzeile: Name muss exakt als `name` in der ersten Zelle stehen. Pur. */
function ohneZeile(namen: string[], zeilen: Zeile[]): string[] {
  const erste = zeilen.flatMap((z) => [...z.zellen[0].matchAll(/`([^`]+)`/g)].map((m) => m[1]));
  return [...new Set(namen)].filter((n) => !erste.includes(n));
}

/** Zellen, die das feste Vokabular verletzen. Pur. */
function vokabularProbleme(zeilen: Zeile[]): string[] {
  const p: string[] = [];
  for (const z of zeilen) {
    if (z.zellen.length !== 5) p.push(`${z.zellen[0]}: ${z.zellen.length} statt 5 Zellen`);
    else {
      if (!URTEIL.test(z.zellen[3])) p.push(`${z.zellen[0]}: Urteil „${z.zellen[3]}“`);
      if (!UNABHAENGIG.test(z.zellen[4])) p.push(`${z.zellen[0]}: Spielunabhängig „${z.zellen[4]}“`);
    }
  }
  return p;
}

const seite = () => readFileSync(join(WURZEL, SEITE), "utf8");

describe("harness-inventar.md: Prüfstand-Marker (#1361)", () => {
  test("die echte Seite hat je Werkzeug genau einen regelkonformen Marker", () => {
    expect(prueffstandProbleme(seite())).toEqual([]);
  });

  test("Claude Code trägt eine vollständige Version mit v, die anderen keinen v-Präfix bei Datum", () => {
    const m = marker(seite());
    expect(m.find((x) => x.werkzeug === "Claude Code")?.stand).toMatch(/^v\d+\.\d+\.\d+$/);
  });

  test("Negativ: fehlendes Werkzeug, doppeltes Werkzeug, Version ohne Patch, Nachsatz", () => {
    const voll = WERKZEUGE.map((w) => `- Geprüft bis ${w} ${w === "Claude Code" ? "v2.1.294" : "2026-10-08"}`);
    expect(prueffstandProbleme(voll.join("\n"))).toEqual([]);
    expect(prueffstandProbleme(voll.slice(1).join("\n")).join()).toContain("Claude Code: 0");
    expect(prueffstandProbleme([...voll, voll[1]].join("\n")).join()).toContain("Langfuse: 2");
    expect(prueffstandProbleme(voll.map((z) => z.replace("v2.1.294", "v2.1")).join("\n")).join()).toContain("Claude Code: 0");
    expect(prueffstandProbleme(voll.map((z) => `${z} (geschätzt)`).join("\n")).join()).toContain("Langfuse: 0");
  });
});

describe("harness-inventar.md: Vollständigkeit gegen die generierte Tabelle (#1361)", () => {
  test("jeder Baustein der README-Tabelle steht in Backticks in der ersten Zelle einer Inventarzeile", () => {
    const config = docsGenApi.loadConfig(WURZEL);
    const namen = generierteNamen(inventarApi.harnessInventarGenerator({ rootDir: WURZEL, config }));
    expect(namen.length).toBeGreaterThan(10);
    expect(ohneZeile(namen, inventarZeilen(seite()))).toEqual([]);
  });

  test("Negativ: fehlende Zeile wird gemeldet, `kubernia` wird nicht durch `kubernia-lens` gedeckt", () => {
    const zeilen: Zeile[] = [{ zellen: ["`kubernia-lens`, `Explore`", "", "", "behalten", "ja"] }];
    expect(ohneZeile(["Explore", "kubernia", "kubernia-lens", "Stop"], zeilen)).toEqual(["kubernia", "Stop"]);
  });

  test("Negativ: der Parser findet nur Tabellen mit dem fünfspaltigen Kopf", () => {
    const text = `| A | B |\n|---|---|\n| \`x\` | y |\n\n${KOPF}\n|---|---|---|---|---|\n| \`z\` | a | b | behalten | ja |\n`;
    expect(inventarZeilen(text).map((z) => z.zellen[0])).toEqual(["`z`"]);
  });
});

describe("harness-inventar.md: festes Vokabular (#1361)", () => {
  test("die echte Seite hat Zeilen und nur erlaubte Urteile und Spielunabhängig-Werte", () => {
    const zeilen = inventarZeilen(seite());
    expect(zeilen.length).toBeGreaterThan(20);
    expect(vokabularProbleme(zeilen)).toEqual([]);
  });

  test("Negativ: Tippfehler, freies Wort, falsche Zellenzahl", () => {
    const z = (urteil: string, ja: string): Zeile => ({ zellen: ["`a`", "z", "n", urteil, ja] });
    expect(vokabularProbleme([z("behalten: Grund", "teilweise")])).toEqual([]);
    expect(vokabularProbleme([z("ersetzten", "ja")]).join()).toContain("Urteil");
    expect(vokabularProbleme([z("vielleicht", "ja")]).join()).toContain("Urteil");
    expect(vokabularProbleme([z("ersetzen", "vielleicht")]).join()).toContain("Spielunabhängig");
    expect(vokabularProbleme([{ zellen: ["`a`", "z"] }]).join()).toContain("2 statt 5");
  });
});

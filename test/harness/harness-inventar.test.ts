/* Harness-Inventar-Wächter (#1361).
 *
 * @harness-waechter – einziger Durchsetzer seiner Regel, darum im geschützten test/harness/ (#1165).
 * `docs/harness-inventar.md` bewertet jeden Eigenbau gegen native Features und trägt maschinenlesbare
 * Prüfstand-Marker („Geprüft bis <Werkzeug> <Stand>“), die der Wochenabgleich (#1362) fortschreibt.
 * Drei Dinge dürfen nicht still driften: (1) jedes der fünf Werkzeuge hat genau einen regelkonformen
 * Marker, (2) jeder Baustein der generierten README-Tabelle (ADR 0017) steht in einer Inventarzeile,
 * (3) Urteil und Spielunabhängig nutzen nur das feste Vokabular. Negativfälle gegen die pure Hilfsfunktionen.
 * Bewusste Grenzen: Der Generator benennt Hooks nur je Event, ein neuer Guard unter einem bestehenden Event verlangt keine neue Zeile;
 * der erste Backtick-Name der ersten Zelle ist der Name der Zeile; ein Marker in einem Codeblock zählt;
 * die Abschnitte B und C (Skripte, Regeln) sind Handlisten ohne Generator-Abgleich.
 * Einordnung (#1693): jede Datei unter scripts/ aus Besitz-Manifest und Kern-Abdeckung (Art `modul`) steht in einer Zeile, jeder
 * genannte Name ist auflösbar und eingeordnet, die Spalte „Modul“ stimmt mit der Art überein. Ring und ja/teilweise/nein werden
 * bewusst nicht abgeglichen (ADR 0022 §1 Ausnahmen), außer `oberflaeche`: eine Zeile „Oberfläche“ nennt nur Besitz mit Ring `oberflaeche` und umgekehrt (ADR 0029); das Manifest bleibt die Besitz-SSOT. */
import { describe, expect, test } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ladeBesitzManifest } from "../support/besitz-anker";

// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as inventar from "../../scripts/docs-gen/harness-inventar.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as docsGen from "../../scripts/docs-gen.mjs";

// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import { musterRegex } from "../../scripts/besitz-extraktion.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import { QUELL_VERZEICHNIS, ZEIGER_MARKE } from "../../scripts/skill-pfade.mjs";

const WURZEL = process.cwd();
const SEITE = "docs/harness-inventar.md";
const WERKZEUGE = ["Claude Code", "Langfuse", "PixelLab", "Playwright", "GitHub"] as const;
const MARKER = /^- Geprüft bis (Claude Code|Langfuse|PixelLab|Playwright|GitHub) (v?\d+\.\d+\.\d+|\d{4}-\d{2}-\d{2})$/gm;
const KOPF = "| Eigenbau | Zweck | Natives Gegenstück (Doku-Link, ab Version) | Urteil | Spielunabhängig |";
const URTEIL = /^(behalten|ersetzen|beobachten)(:|$)/;
const UNABHAENGIG = /^(ja|nein|teilweise|Modul|Oberfläche)(:|$)/;

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
  for (const m of marker(text)) {
    if (m.werkzeug === "Claude Code" && !m.stand.startsWith("v")) probleme.push(`Claude Code ohne v: ${m.stand}`);
    if (m.werkzeug !== "Claude Code" && m.stand.startsWith("v")) probleme.push(`${m.werkzeug} mit v: ${m.stand}`);
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
  const erste = zeilen.map((z) => /`([^`]+)`/.exec(z.zellen[0])?.[1] ?? z.zellen[0]);
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

/** Seitentext mit LF (unter Windows checkt `core.autocrlf` CRLF aus). */
const seite = () => readFileSync(join(WURZEL, SEITE), "utf8").replace(/\r\n/g, "\n");

/** Zahl der Tabellen mit dem Inventar-Kopf. Pur. */
const kopfZahl = (text: string) => text.split("\n").filter((z) => z.trim() === KOPF).length;

/** Erste Backtick-Namen je Zeile, die mehrfach vorkommen (eine Zeile je Eigenbau). Pur. */
function doppelt(zeilen: Zeile[]): string[] {
  const erste = zeilen.map((z) => /`([^`]+)`/.exec(z.zellen[0])?.[1] ?? z.zellen[0]);
  return [...new Set(erste.filter((n, i) => erste.indexOf(n) !== i))];
}

describe("harness-inventar.md: Prüfstand-Marker (#1361)", () => {
  test("die echte Seite hat je Werkzeug genau einen regelkonformen Marker", () => {
    expect(prueffstandProbleme(seite())).toEqual([]);
  });

  test("Claude Code trägt eine vollständige Version mit v, kein anderes Werkzeug ein v", () => {
    const m = marker(seite());
    expect(m.find((x) => x.werkzeug === "Claude Code")?.stand).toMatch(/^v\d+\.\d+\.\d+$/);
    expect(m.filter((x) => x.werkzeug !== "Claude Code" && x.stand.startsWith("v"))).toEqual([]);
  });

  test("Negativ: v bei einem anderen Werkzeug, Claude Code ohne v; CRLF-Zeilenenden brauchen die Normalisierung", () => {
    const voll = WERKZEUGE.map((w) => `- Geprüft bis ${w} ${w === "Claude Code" ? "v2.1.294" : "2026-10-08"}`);
    expect(prueffstandProbleme(voll.join("\n").replace("Langfuse 2026-10-08", "Langfuse v1.2.0")).join()).toContain("Langfuse mit v");
    expect(prueffstandProbleme(voll.join("\n").replace("v2.1.294", "2.1.294")).join()).toContain("Claude Code ohne v");
    expect(prueffstandProbleme(voll.join("\r\n")).length).toBeGreaterThan(0);
    expect(prueffstandProbleme(voll.join("\r\n").replace(/\r\n/g, "\n"))).toEqual([]);
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

  test("Negativ: fehlende Zeile wird gemeldet, `demo` wird nicht durch `demo-lens` gedeckt", () => {
    const zeilen: Zeile[] = [{ zellen: ["`demo-lens`", "", "", "behalten", "ja"] }];
    expect(ohneZeile(["Explore", "demo", "demo-lens", "Stop"], zeilen)).toEqual(["Explore", "demo", "Stop"]);
  });

  test("Negativ: nur der erste Backtick-Name der ersten Zelle deckt (ein späterer Name in derselben Zelle nicht)", () => {
    const zeilen: Zeile[] = [{ zellen: ["`sih-umsetzer`, Hinweis `sih-lens`", "", "", "behalten", "ja"] }];
    expect(ohneZeile(["sih-umsetzer", "sih-lens"], zeilen)).toEqual(["sih-lens"]);
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
    expect(kopfZahl(seite())).toBe(4);
    expect(doppelt(zeilen)).toEqual([]);
    expect(vokabularProbleme(zeilen)).toEqual([]);
  });

  test("Negativ: Tippfehler, freies Wort, falsche Zellenzahl", () => {
    const z = (urteil: string, ja: string): Zeile => ({ zellen: ["`a`", "z", "n", urteil, ja] });
    expect(vokabularProbleme([z("behalten: Grund", "teilweise")])).toEqual([]);
    expect(vokabularProbleme([z("ersetzten", "ja")]).join()).toContain("Urteil");
    expect(vokabularProbleme([z("vielleicht", "ja")]).join()).toContain("Urteil");
    expect(vokabularProbleme([z("behalten", "Modul")])).toEqual([]);
    expect(vokabularProbleme([z("behalten", "modul")]).join()).toContain("Spielunabhängig");
    expect(vokabularProbleme([z("ersetzen", "vielleicht")]).join()).toContain("Spielunabhängig");
    expect(vokabularProbleme([z("ersetzen", "ja (unklar)")]).join()).toContain("Spielunabhängig");
    expect(doppelt([z("a", "ja"), { zellen: ["`a`, `b`", "", "", "behalten", "ja"] }])).toEqual(["a"]);
    expect(vokabularProbleme([{ zellen: ["`a`", "z"] }]).join()).toContain("2 statt 5");
  });
});

type Abdeckung = Record<string, { art: string }>;
type Einordnung = { zeilen: Zeile[]; besitz: { pfad: string; ring?: string }[]; abdeckung: Abdeckung; dateien: string[] };

/** Repo-Pfad eines Backtick-Tokens der ersten Zelle, oder null (Agent, Hook-Ereignis, Flag, Platzhalter). Pur. */
function tokenPfad(token: string): string | null {
  const name = token.split(/\s/)[0];
  if (/^[\w.*-]+\.(mjs|cjs)$/.test(name)) return `scripts/${name}`;
  if (/^[\w.*-]+\.yml$/.test(name)) return `.github/workflows/${name}`;
  if (name.includes("/") && /^[\w.*/-]+$/.test(name)) return name;
  return null;
}

/** Dateien, die ein Pfad, Glob (`*` = ein Segment) oder Verzeichnis (Endung `/`) trifft. Pur. */
function treffer(pfad: string, dateien: string[]): string[] {
  if (pfad.endsWith("/")) return dateien.filter((d) => d.startsWith(pfad));
  const re = (musterRegex as (muster: string) => RegExp)(pfad);
  return dateien.filter((d) => re.test(d));
}

/** Meldungen zur Einordnung der Skripte: Vollständigkeit (R1), Auflösbarkeit (R2), Spalte „Modul“ (R3), Spalte „Oberfläche“ (R4). Pur. */
function einordnungsProbleme({ zeilen, besitz, abdeckung, dateien }: Einordnung): string[] {
  const probleme: string[] = [];
  const modul = new Set(Object.entries(abdeckung).filter(([, v]) => v.art === "modul").map(([k]) => k));
  const oberflaeche = new Set(besitz.filter((b) => b.ring === "oberflaeche").map((b) => b.pfad));
  const eingeordnet = new Set([...besitz.map((b) => b.pfad), ...Object.keys(abdeckung)]);
  const genannt = new Set<string>();
  for (const z of zeilen) {
    const name = z.zellen[0];
    const dieZeile = new Set<string>();
    for (const m of name.matchAll(/`([^`]+)`/g)) {
      const pfad = tokenPfad(m[1]);
      if (pfad === null) continue;
      const hits = treffer(pfad, dateien);
      if (hits.length === 0) probleme.push(`${name}: ${pfad} nicht auflösbar`);
      for (const h of hits) {
        dieZeile.add(h);
        genannt.add(h);
        if (!eingeordnet.has(h)) probleme.push(`${name}: ${h} weder im Besitz-Manifest noch in der Kern-Abdeckung`);
      }
    }
    const nichtModul = [...dieZeile].filter((d) => !modul.has(d));
    const nichtOberflaeche = [...dieZeile].filter((d) => !oberflaeche.has(d));
    const spalteOberflaeche = z.zellen[4]?.startsWith("Oberfläche") ?? false;
    if (spalteOberflaeche && nichtOberflaeche.length > 0) probleme.push(`${name}: Oberfläche-Zeile nennt ${nichtOberflaeche.join(", ")}`);
    if (!spalteOberflaeche && dieZeile.size > 0 && nichtOberflaeche.length === 0) probleme.push(`${name}: nennt nur Oberfläche-Dateien, Spalte „${z.zellen[4]}“`);
    const spalteModul = z.zellen[4]?.startsWith("Modul") ?? false;
    if (spalteModul && nichtModul.length > 0) probleme.push(`${name}: Modul-Zeile nennt ${nichtModul.join(", ")}`);
    if (!spalteModul && dieZeile.size > 0 && nichtModul.length === 0) probleme.push(`${name}: nennt nur Modul-Dateien, Spalte „${z.zellen[4]}“`);
  }
  const skripte = [...besitz.map((b) => b.pfad), ...modul].filter((p) => /^scripts\/.+\.(mjs|cjs)$/.test(p));
  for (const p of new Set(skripte)) if (!genannt.has(p)) probleme.push(`${p} steht in keiner Inventarzeile`);
  return probleme;
}

describe("harness-inventar.md: Einordnung der Skripte (#1693)", () => {
  const dateien = ["scripts/a.mjs", "scripts/b.mjs", "scripts/lib/c.mjs", "scripts/worktree-guard-x.mjs", ".github/workflows/t.yml"];
  const rolle = (name: string, ja = "teilweise"): Zeile => ({ zellen: [name, "z", "n", "behalten", ja] });
  const lauf = (zeilen: Zeile[], over: Partial<Einordnung> = {}) =>
    einordnungsProbleme({ zeilen, besitz: [{ pfad: "scripts/a.mjs" }], abdeckung: { "scripts/b.mjs": { art: "modul" } }, dateien, ...over });

  test("die echten Quellen sind lückenlos eingeordnet", () => {
    const besitz = ladeBesitzManifest().eintraege;
    const abdeckung = JSON.parse(readFileSync(join(WURZEL, "test/harness/kern-abdeckung.json"), "utf8")) as Abdeckung;
    const dateien = execFileSync("git", ["ls-files"], { cwd: WURZEL, encoding: "utf8" }).split(/\r?\n/).filter((d) => d !== "");
    expect(einordnungsProbleme({ zeilen: inventarZeilen(seite()), besitz, abdeckung, dateien })).toEqual([]);
  });

  test("Positiv: Name, Glob, Verzeichnis, Workflow, gemischte Zeile und Nicht-Dateien", () => {
    const besitz = [{ pfad: "scripts/a.mjs" }, { pfad: "scripts/lib/c.mjs" }, { pfad: ".github/workflows/t.yml" }];
    const zeilen = [rolle("Eins (`a.mjs`, `Hook`, `--flag`, `<x>`, `t.yml`)"), rolle("Zwei (`b.mjs`)", "Modul"), rolle("`scripts/lib/`")];
    expect(lauf(zeilen, { besitz })).toEqual([]);
    expect(lauf([rolle("`a.mjs --flag`"), rolle("`b.mjs`", "Modul")])).toEqual([]);
    expect(lauf([rolle("`a.mjs`, `b.mjs`")])).toEqual([]);
    expect(lauf([rolle("`a.mjs`, `b.mjs`", "Modul")]).join()).toContain("Modul-Zeile nennt scripts/a.mjs");
  });

  test("Negativ R1: eine Datei ohne Zeile wird gemeldet (Besitz und Modul)", () => {
    expect(lauf([rolle("`a.mjs`")]).join()).toContain("scripts/b.mjs steht in keiner Inventarzeile");
    expect(lauf([rolle("`b.mjs`", "Modul")]).join()).toContain("scripts/a.mjs steht in keiner Inventarzeile");
    expect(lauf([rolle("`a.mjs`")], { abdeckung: { "scripts/b.mjs": { art: "projekt" } } })).toEqual([]);
  });

  test("Negativ R1: ein Glob oder Verzeichnis deckt nur seine Treffer", () => {
    const o = { besitz: [{ pfad: "scripts/worktree-guard-x.mjs" }, { pfad: "scripts/lib/c.mjs" }], abdeckung: {} };
    expect(lauf([rolle("`worktree-guard-*.mjs`"), rolle("`scripts/lib/`")], o)).toEqual([]);
    expect(lauf([rolle("`guard-*.mjs`"), rolle("`scripts/lib/`")], o).join()).toContain("nicht auflösbar");
    expect(lauf([rolle("`worktree-guard-*.mjs`")], o).join()).toContain("scripts/lib/c.mjs steht in keiner");
    expect(lauf([rolle("`scripts/leer/`")], o).join()).toContain("scripts/leer/ nicht auflösbar");
  });

  test("Negativ R2: Tippfehler, nicht eingeordnete Datei, nicht eingeordneter Workflow", () => {
    const grund = [rolle("`a.mjs`"), rolle("`b.mjs`", "Modul")];
    expect(lauf([...grund, rolle("`aa.mjs`")]).join()).toContain("scripts/aa.mjs nicht auflösbar");
    expect(lauf([...grund, rolle("`scripts/lib/c.mjs`")]).join()).toContain("weder im Besitz-Manifest");
    expect(lauf([...grund, rolle("`t.yml`")]).join()).toContain(".github/workflows/t.yml");
  });

  test("Negativ R3: reine Modul-Zeile mit teilweise, Modul-Zeile mit Besitz-Datei, Zeile ohne Dateien bleibt frei", () => {
    const sicher = rolle("`a.mjs`");
    expect(lauf([sicher, rolle("`b.mjs`", "teilweise")]).join()).toContain("nennt nur Modul-Dateien, Spalte „teilweise“");
    expect(lauf([rolle("`a.mjs`", "Modul"), rolle("`b.mjs`", "Modul")]).join()).toContain("Modul-Zeile nennt scripts/a.mjs");
    expect(lauf([sicher, rolle("`b.mjs`", "Modul"), rolle("`Agent`", "Modul"), rolle("`Hook`", "ja")])).toEqual([]);
    expect(lauf([sicher, rolle("`b.mjs`", "Modul"), { zellen: ["`Agent`"] }])).toEqual([]);
  });

  test("R4 positiv: eine Oberfläche-Zeile mit Oberflächen-Besitz bleibt frei", () => {
    const besitz = [{ pfad: "scripts/a.mjs" }, { pfad: "scripts/lib/c.mjs", ring: "oberflaeche" }];
    const o = { besitz, abdeckung: { "scripts/b.mjs": { art: "modul" } }, dateien: ["scripts/a.mjs", "scripts/b.mjs", "scripts/lib/c.mjs"] };
    expect(lauf([rolle("`a.mjs`"), rolle("`b.mjs`", "Modul"), rolle("`scripts/lib/`", "Oberfläche")], o)).toEqual([]);
  });

  test("Negativ R4: Oberfläche-Zeile mit Kern-Besitz, reine Oberflächen-Zeile mit ja, Schreibweise ohne Umlaut", () => {
    const besitz = [{ pfad: "scripts/a.mjs" }, { pfad: "scripts/lib/c.mjs", ring: "oberflaeche" }];
    const o = { besitz, abdeckung: { "scripts/b.mjs": { art: "modul" } }, dateien: ["scripts/a.mjs", "scripts/b.mjs", "scripts/lib/c.mjs"] };
    const grund = [rolle("`a.mjs`"), rolle("`b.mjs`", "Modul")];
    expect(lauf([...grund, rolle("`scripts/lib/`", "Oberfläche"), rolle("`a.mjs`", "Oberfläche")], o).join()).toContain("Oberfläche-Zeile nennt scripts/a.mjs");
    expect(lauf([...grund, rolle("`scripts/lib/`", "ja")], o).join()).toContain("nennt nur Oberfläche-Dateien, Spalte „ja“");
    expect(UNABHAENGIG.test("Oberflaeche")).toBe(false);
    expect(UNABHAENGIG.test("Oberfläche")).toBe(true);
  });

  test("CRLF-Seiten ergeben dieselben Zeilen und Funde wie LF", () => {
    const text = `${KOPF}\n|---|---|---|---|---|\n| \`a.mjs\` | z | n | behalten | ja |\n`;
    const o = { abdeckung: {} };
    expect(inventarZeilen(text.replace(/\n/g, "\r\n"))).toEqual(inventarZeilen(text));
    expect(lauf(inventarZeilen(text.replace(/\n/g, "\r\n")), o)).toEqual([]);
    expect(lauf([], o).join()).toContain("scripts/a.mjs steht in keiner");
  });
});

describe("Skill-Katalog nennt die Quelle hinter einem Zeiger (#1866)", () => {
  const skill = (name: string, rumpf: string) => `---\nname: ${name}\nmodel: sonnet\n---\n\n${rumpf}\n`;
  const katalog = () => {
    const w = mkdtempSync(join(tmpdir(), "inventar-skill-"));
    try {
      mkdirSync(join(w, ".claude/skills/zeig"), { recursive: true });
      mkdirSync(join(w, ".claude/skills/voll"), { recursive: true });
      writeFileSync(join(w, ".claude/skills/zeig/SKILL.md"), skill("zeig", `${ZEIGER_MARKE}\nLies die Quelle.`));
      writeFileSync(join(w, ".claude/skills/voll/SKILL.md"), skill("voll", "Echter Volltext."));
      return (inventar as unknown as { harnessKatalog: (w: string, c: { skills: string }) => { skills: { name: string; datei: string }[] } }).harnessKatalog(w, { skills: ".claude/skills" }).skills;
    } finally {
      rmSync(w, { recursive: true, force: true });
    }
  };

  test("ein Zeiger mit Marke nennt die Quelle unter .agents/skills", () => {
    expect(katalog().find((s) => s.name === "zeig")?.datei).toBe(`${QUELL_VERZEICHNIS}/zeig/SKILL.md`);
  });

  test("Negativ: ein Volltext-Skill ohne Marke behält seinen Pfad", () => {
    expect(katalog().find((s) => s.name === "voll")?.datei).toBe(".claude/skills/voll/SKILL.md");
  });
});

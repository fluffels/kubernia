/* Architekturmodell-Wächter (#1420, ADR 0020): `check:c4` gleicht das LikeC4-Modell gegen die SSOTs ab
 * (scripts/layers.cjs über ladeModell/schichtVon/sollKanten, Top-Level von src/). Die puren Fälle bekommen den
 * Adapter-Output als einfache Objekte; der Adapter selbst läuft gegen echte Fixture-Workspaces.
 */
import { afterEach, describe, test } from "vitest";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";

// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as raw from "../scripts/check-c4.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as schichten from "../scripts/docs-gen/schichten.mjs";

type Schicht = { id: string; label: string; technik?: string; muster: string | null; wurzeln: string[]; darf: string[] };
type Modell = { quellwurzel: string; schichten: Schicht[]; extern: { id: string; label: string; muster: string }[] };
type El = { id: string; kind: string; title: string; parentId: string | null; datei: string; zeile: number; tags?: string[]; beschreibung?: string | null; technik?: string | null };
type Bez = { von: string; nach: string; datei: string; zeile: number; titel?: string | null; beschreibung?: string | null };
type View = { id: string; titel: string; knoten: number; datei: string; zeile: number; kanten?: { von: string; nach: string; label?: string | null }[] };
type C4 = { elemente: El[]; beziehungen: Bez[]; views: View[] };
type Meldung = { datei: string; zeile: number; art: string; element: string; text: string; fix: string };
type Cfg = { workspace: string; quelle: string; bindungen: Record<string, string>; erzaehlung: string[]; maxKnotenJeView: number; pflichtViews?: string[]; hexagon?: { datei: string; abschnitt: string } };
type Hexagon = { text: string | null; existiert: (p: string) => boolean };
const api = raw as unknown as {
  srcModule: (rootDir: string, quelle: string) => { name: string; pfade: string[] }[];
  pruefeArchitektur: (a: { modell: Modell; module: { name: string; pfade: string[] }[]; c4: C4; cfg: Cfg; hexagon: Hexagon; schichtQuelle?: string }) => Meldung[];
  leseHexagon: (text: string, abschnitt: string, quelle: string) => { ports: { name: string; zwei: string; ort: string[]; schicht: string }[]; adapter: { name: string; zwei: string; ort: string[]; schicht: string }[]; pfade: { pfad: string; zeile: number }[] } | null;
  formatiere: (m: Meldung) => string;
  ladeC4Modell: (rootDir: string, workspace: string) => Promise<C4>;
  cli: (argv: string[], io: { rootDir: string; out: (s: string) => void; err: (s: string) => void; spawn?: (args: string[]) => number }) => Promise<number>;
};
const { ladeModell } = schichten as unknown as { ladeModell: (rootDir: string, layers: string) => Modell };

const req = createRequire(import.meta.url);
const echt = req("../scripts/layers.cjs") as { SCHICHT_MODELL: Modell; layerOf: (f: string) => string };

const PHASER = "node_modules[/\\\\]phaser[/\\\\]";
const basis = (): Modell => ({
  quellwurzel: "src/",
  schichten: [
    { id: "praesentation", label: "Präsentation", technik: "Phaser/DOM", muster: "^src/ui(\\.ts$|/)", wurzeln: ["ui"], darf: ["anwendung", "domaene", "phaser"] },
    { id: "anwendung", label: "Anwendung", muster: "^src/game(\\.ts$|/)", wurzeln: ["game"], darf: ["domaene"] },
    { id: "domaene", label: "pure Domäne", muster: null, wurzeln: [], darf: [] },
  ],
  extern: [{ id: "phaser", label: "Phaser", muster: PHASER }],
});

const dirs: string[] = [];
function fixture(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "kq-c4-"));
  dirs.push(root);
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(root, rel);
    mkdirSync(join(abs, ".."), { recursive: true });
    writeFileSync(abs, content);
  }
  return root;
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const layersFile = (m: unknown) => `module.exports = { SCHICHT_MODELL: ${JSON.stringify(m)} };\n`;
/** Projekt-Config mit dem Block `struktur`: `struktur.quelle` muss zu `architektur.quelle` passen. */
const projektConfig = (quelle = "src"): string => JSON.stringify({ struktur: { quelle, moduldoku: "docs/module" } });
const srcFiles = (extra: Record<string, string> = {}) => ({
  ".factory/projekt.json": projektConfig(),
  "scripts/layers.cjs": layersFile(basis()),
  "src/ui/a.ts": "",
  "src/ui.ts": "",
  "src/game/a.ts": "",
  "src/content/a.ts": "",
  "src/content.ts": "",
  "src/vite-env.d.ts": "",
  ...extra,
});

const CFG: Cfg = {
  workspace: "docs/architektur",
  quelle: "src",
  bindungen: { schicht: "schicht", bibliothek: "extern", modul: "modul", port: "port", adapter: "adapter" },
  erzaehlung: ["person", "system", "container", "datenspeicher"],
  maxKnotenJeView: 25,
  pflichtViews: ["index"],
  hexagon: { datei: "docs/arc42.md", abschnitt: "Hexagonale Sicht" },
};
const ARC42 = "docs/arc42.md";
const hexText = (ports = "| Content-Quelle | getrieben | `src/content/a.ts` | pure Domäne |", adapter = "| Tastatur | Content-Quelle | `src/ui/a.ts` | Präsentation |", prosa = "Nur Prosa."): string =>
  ["# Titel", "", "### Hexagonale Sicht", "", prosa, "", "| Port | Seite | Ort | Schicht |", "|---|---|---|---|", ports, "", "| Adapter | Port | Ort | Schicht |", "|---|---|---|---|", adapter, "", "### Nächster Abschnitt", "`src/gibtsnicht.ts`", ""].join("\n");
const hexVorhanden = (p: string) => ["src/content/a.ts", "src/ui/a.ts", "src/game/a.ts", "src/ui.ts"].includes(p);
const DATEI = "docs/architektur/spiel.c4";
const el = (id: string, kind: string, title: string, parentId: string | null = null, zeile = 1, tags?: string[]): El => ({ id, kind, title, parentId, datei: DATEI, zeile, ...(tags ? { tags } : {}) });
const bez = (von: string, nach: string, zeile = 50): Bez => ({ von, nach, datei: DATEI, zeile });
const gueltig = (): C4 => ({
  elemente: [
    el("k", "system", "Kubernia"),
    el("k.app", "container", "Spiel-App", "k"),
    el("k.app.pr", "schicht", "Präsentation", "k.app"),
    el("k.app.an", "schicht", "Anwendung", "k.app"),
    el("k.app.do", "schicht", "pure Domäne", "k.app"),
    el("k.app.ph", "bibliothek", "Phaser", "k.app"),
    el("k.app.pr.ui", "modul", "ui", "k.app.pr"),
    el("k.app.an.game", "modul", "game", "k.app.an"),
    el("k.app.do.content", "modul", "content", "k.app.do"),
    el("sp", "datenspeicher", "Spielstand"),
    el("k.app.do.content.q", "port", "Content-Quelle", "k.app.do.content", 20, ["getrieben"]),
    el("k.app.pr.ui.t", "adapter", "Tastatur", "k.app.pr.ui", 21),
  ],
  beziehungen: [
    bez("k.app.pr", "k.app.an"),
    bez("k.app.pr", "k.app.do"),
    bez("k.app.pr", "k.app.ph"),
    bez("k.app.an", "k.app.do"),
    bez("k.app.an", "sp"),
    bez("k.app.pr.ui.t", "k.app.do.content.q", 60),
  ],
  views: [{ id: "index", titel: "Kontext", knoten: 3, datei: DATEI, zeile: 70 }],
});

function lauf(c4: C4, extra: Record<string, string> = {}, cfg: Cfg | null = CFG, hexagon: Hexagon = { text: hexText(), existiert: hexVorhanden }): Meldung[] {
  const root = fixture(srcFiles(extra));
  const modell = ladeModell(root, "scripts/layers.cjs");
  return api.pruefeArchitektur({ modell, module: api.srcModule(root, "src"), c4, cfg: cfg as unknown as Cfg, hexagon, schichtQuelle: "scripts/layers.cjs" });
}
const texte = (ms: Meldung[]) => ms.map((m) => api.formatiere(m));
const treffer = (ms: Meldung[], re: RegExp) => texte(ms).filter((t) => re.test(t));

describe("Fundort bei mehreren .c4-Dateien (#1421, Befund 2)", () => {
  const HARNESS = "docs/architektur/harness.c4";
  /** Modell, in dem harness.c4 vor spiel.c4 liegt (LikeC4 liefert alphabetisch) und das erste Element eine Person ist. */
  const mehrere = (): C4 => {
    const c4 = gueltig();
    c4.elemente = [{ ...el("m", "person", "Maintainerin"), datei: HARNESS }, ...c4.elemente];
    return c4;
  };

  test("fehlendes Modul und fehlende Bibliothek nennen die Datei der Spiel-Elemente, nicht die des ersten Elements", () => {
    const c4 = mehrere();
    c4.elemente = c4.elemente.filter((e) => e.id !== "k.app.an.game" && e.id !== "k.app.pr.ui" && e.id !== "k.app.pr.ui.t");
    c4.beziehungen = c4.beziehungen.filter((b) => !b.von.includes("pr.ui") && !b.nach.includes("pr.ui"));
    const modul = treffer(lauf(c4), /modul „(game|ui)“.*fehlt/);
    assert.equal(modul.length, 2);
    assert.ok(modul.every((x) => x.includes(`Fix: Element modul`) && x.includes(`in ${DATEI} anlegen`) && !x.includes(HARNESS)), modul.join("\n"));
    const lib = mehrere();
    lib.elemente = lib.elemente.filter((e) => e.kind !== "bibliothek");
    lib.beziehungen = lib.beziehungen.filter((b) => b.nach !== "k.app.ph");
    const t = treffer(lauf(lib), /bibliothek „Phaser“.*fehlt/);
    assert.equal(t.length, 1);
    assert.ok(t[0].includes(`Fix: Element bibliothek 'Phaser' in ${DATEI} anlegen`), t[0]);
    assert.ok(t[0].startsWith(`✖ ${DATEI}:`), t[0]);
  });

  test("ohne irgendein Spiel-Element: der Workspace; die Datei von Harness-Elementen zählt nicht", () => {
    const c4: C4 = { elemente: [{ ...el("m", "person", "Maintainerin"), datei: HARNESS }], beziehungen: [], views: [{ id: "index", titel: "Kontext", knoten: 1, datei: HARNESS, zeile: 1 }] };
    const t = treffer(lauf(c4), /schicht „Präsentation“.*fehlt/);
    assert.equal(t.length, 1);
    assert.ok(t[0].startsWith("✖ docs/architektur:1 "), t[0]);
  });

  test("die Schicht-Quelle in den Texten kommt aus dem Eingabefeld, nicht fest aus dem Code", () => {
    const c4 = gueltig();
    c4.elemente.push(el("k.app.zz", "schicht", "Erfundene Schicht", "k.app", 9));
    const root = fixture(srcFiles());
    const ms = api.pruefeArchitektur({ modell: ladeModell(root, "scripts/layers.cjs"), module: api.srcModule(root, "src"), c4, cfg: CFG, hexagon: { text: hexText(), existiert: hexVorhanden }, schichtQuelle: "lib/mein-modell.cjs" });
    const t = treffer(ms, /Erfundene Schicht/);
    assert.equal(t.length, 1);
    assert.match(t[0], /keine Quelle in lib\/mein-modell\.cjs/);
    assert.doesNotMatch(t[0], /scripts\/layers\.cjs/);
  });
});

describe("Pflicht-Views (#1421)", () => {
  const mit = (pflicht: unknown): Cfg => ({ ...CFG, pflichtViews: pflicht as string[] });

  test("alle vorhanden: grün; eine fehlt: rot mit Fix und Config-Fundort", () => {
    const c4 = gueltig();
    assert.deepEqual(texte(lauf(c4, {}, mit(["index"]))), []);
    const t = texte(lauf(c4, {}, mit(["index", "ticket-lauf"])));
    assert.equal(t.length, 1);
    assert.match(t[0], /^✖ scripts\/docs-gen\/config\.json:1 view „ticket-lauf“: Pflicht-View fehlt im Modell\. Fix: View 'ticket-lauf' unter docs\/architektur anlegen/);
  });

  test("Config ohne pflichtViews, leer oder mit Nicht-Strings: rot, nur die Config-Meldung", () => {
    for (const kaputt of [undefined, [], [""], [1], "index"]) {
      const t = texte(lauf(gueltig(), {}, mit(kaputt)));
      assert.equal(t.length, 1, JSON.stringify(kaputt));
      assert.match(t[0], /pflichtViews ist keine nicht-leere Liste von View-Namen/, JSON.stringify(kaputt));
    }
  });
});

describe("Ziffern-Regel: keine Zahlen aus SSOT-Konstanten in Labels (#1421)", () => {
  const rot = (c4: C4) => texte(lauf(c4)).filter((x) => /freistehende Zahl/.test(x));

  test("freistehende Zahl in Beschreibung, Technik, Beziehungs-Titel und -Beschreibung, Schritt-Label und View-Titel ist rot", () => {
    const c4 = gueltig();
    c4.elemente[0].beschreibung = "drei Brillen, 3 Pässe";
    c4.elemente[1].technik = "Cap 2";
    c4.beziehungen[0].titel = "nach 3 Versuchen";
    c4.beziehungen[1].beschreibung = "7";
    c4.views[0].titel = "Ansicht 2";
    c4.views.push({ id: "dyn", titel: "Lauf", knoten: 2, datei: DATEI, zeile: 90, kanten: [{ von: "k", nach: "k.app", label: "Cap 2" }] });
    const t = rot(c4);
    assert.equal(t.length, 6, t.join("\n"));
    assert.ok(t.some((x) => /Schritt-Label „Cap 2“/.test(x)));
    assert.ok(t.some((x) => /view „index“: Titel „Ansicht 2“/.test(x)));
  });

  test("Zahl nach Satzzeichen oder Bindestrich ist rot (Klammer, Doppelpunkt, Bindestrich), Zahl hinter einem Buchstaben nicht", () => {
    for (const text of ["(3 Pässe)", "Cap:2", "Lens-Cap-2", "a/3", "x 12"]) {
      const c4 = gueltig();
      c4.elemente[0].beschreibung = text;
      assert.equal(rot(c4).length, 1, text);
    }
    const ok = gueltig();
    ok.elemente[0].beschreibung = "k8s, arc42, a1";
    assert.equal(rot(ok).length, 0);
  });

  test("Zahlen im Wort (arc42, k8s) und Zahlwörter sind grün; der Titel einer gebundenen Art ist ausgenommen", () => {
    const c4 = gueltig();
    c4.elemente[0].beschreibung = "arc42 und k8s, drei Brillen";
    c4.elemente.push(el("sy", "system", "Cluster k8s"));
    c4.elemente.push(el("k.app.pr.ui.m3", "adapter", "Port 8080", "k.app.pr.ui"));
    assert.deepEqual(rot(c4).filter((x) => !/Port 8080/.test(x)), []);
    assert.equal(rot(c4).length, 0, "Titel einer gebundenen Art (adapter) wird nicht geprüft");
  });

  test("der Titel einer nicht gebundenen Art (Erzählung) mit freistehender Zahl ist rot; null und fehlende Felder sind grün", () => {
    const c4 = gueltig();
    c4.elemente.push(el("sy", "system", "System 2"));
    c4.elemente[0].beschreibung = null;
    c4.beziehungen[0].titel = null;
    const t = rot(c4);
    assert.equal(t.length, 1);
    assert.match(t[0], /system „System 2“: Titel „System 2“/);
  });
});

describe("srcModule: Top-Level von src/", () => {
  test("Ordner plus .ts-Dateien ohne gleichnamigen Ordner, ohne .d.ts (Barrel und vite-env.d.ts ergeben kein eigenes Modul)", () => {
    const root = fixture(srcFiles({ "src/main.ts": "", "src/.versteckt/x.ts": "" }));
    const m = api.srcModule(root, "src");
    assert.deepEqual(m.map((x) => x.name), ["content", "game", "main", "ui"]);
    assert.deepEqual(m.find((x) => x.name === "content")?.pfade, ["src/content.ts", "src/content/"], "Barrel und Ordner bilden EIN Modul");
    assert.deepEqual(m.find((x) => x.name === "main")?.pfade, ["src/main.ts"]);
  });

  test("Nicht-.ts-Dateien auf Top-Level (css, json, md) ergeben kein Modul", () => {
    const root = fixture(srcFiles({ "src/style.css": "", "src/data.json": "", "src/NOTIZ.md": "" }));
    assert.deepEqual(api.srcModule(root, "src").map((x) => x.name), ["content", "game", "ui"]);
  });
});

describe("pruefeArchitektur", () => {
  test("Happy Path: gültiges Modell ergibt keine Meldung", () => {
    assert.deepEqual(texte(lauf(gueltig())), []);
  });

  test("Schicht fehlt im Modell: rot mit Fix", () => {
    const c4 = gueltig();
    c4.elemente = c4.elemente.filter((e) => e.id !== "k.app.an.game" && e.id !== "k.app.an");
    c4.beziehungen = c4.beziehungen.filter((b) => !b.von.startsWith("k.app.an") && !b.nach.startsWith("k.app.an"));
    const t = treffer(lauf(c4), /Anwendung/);
    assert.ok(t.some((x) => /schicht „Anwendung“.*fehlt.*Fix: /.test(x)), t.join("\n"));
  });

  test("Schicht ohne Quelle in layers.cjs: rot", () => {
    const c4 = gueltig();
    c4.elemente.push(el("k.app.zz", "schicht", "Erfundene Schicht", "k.app", 9));
    const t = treffer(lauf(c4), /Erfundene Schicht/);
    assert.equal(t.length, 1);
    assert.match(t[0], /docs\/architektur\/spiel\.c4:9 /);
    assert.match(t[0], /Fix: .*layers\.cjs/);
  });

  test("Bibliothek: fehlt bzw. ohne Quelle ist rot", () => {
    const fehlt = gueltig();
    fehlt.elemente = fehlt.elemente.filter((e) => e.id !== "k.app.ph");
    fehlt.beziehungen = fehlt.beziehungen.filter((b) => b.nach !== "k.app.ph");
    assert.ok(treffer(lauf(fehlt), /bibliothek „Phaser“.*fehlt/).length >= 1);
    const ohne = gueltig();
    ohne.elemente.push(el("k.app.x", "bibliothek", "Vue", "k.app"));
    assert.equal(treffer(lauf(ohne), /bibliothek „Vue“/).length, 1);
  });

  test("Modul fehlt im Modell: rot, Fundort ist die Schicht", () => {
    const root = fixture(srcFiles({ "src/xyz/a.ts": "" }));
    const modell = ladeModell(root, "scripts/layers.cjs");
    const ms = api.pruefeArchitektur({ modell, module: api.srcModule(root, "src"), c4: gueltig(), cfg: CFG, hexagon: { text: hexText(), existiert: hexVorhanden } });
    const t = treffer(ms, /xyz/);
    assert.equal(t.length, 1);
    assert.match(t[0], /modul „xyz“.*Fix: .*pure Domäne/);
    assert.match(t[0], /docs\/architektur\/spiel\.c4:1 /);
  });

  test("Modul ohne Eintrag in der Quellwurzel: die Meldung nennt cfg.quelle statt eines festen src (#1860)", () => {
    const c4 = gueltig();
    c4.elemente.push(el("k.app.do.geist", "modul", "geist", "k.app.do", 12));
    const root = fixture(srcFiles());
    const modell = ladeModell(root, "scripts/layers.cjs");
    const ms = api.pruefeArchitektur({ modell, module: [{ name: "game", pfade: ["lib/game/"] }], c4, cfg: { ...CFG, quelle: "lib" }, hexagon: { text: hexText(), existiert: hexVorhanden }, schichtQuelle: "scripts/layers.cjs" });
    const t = treffer(ms, /modul „geist“/);
    assert.equal(t.length, 1);
    assert.match(t[0], /kein Eintrag in lib\/ \(Top-Level: game\)/);
    assert.match(t[0], /Top-Level-Eintrag von lib\//);
    assert.doesNotMatch(t[0], /src\//);
  });

  test("Modul ohne src/-Eintrag: rot", () => {
    const c4 = gueltig();
    c4.elemente.push(el("k.app.do.geist", "modul", "geist", "k.app.do", 12));
    const t = treffer(lauf(c4), /geist/);
    assert.equal(t.length, 1);
    assert.match(t[0], /spiel\.c4:12 .*modul „geist“.*Fix: /);
  });

  test("Modul unter falscher Schicht: rot (ui liegt in der Präsentation, nicht in der Anwendung)", () => {
    const c4 = gueltig();
    const ui = c4.elemente.find((e) => e.id === "k.app.pr.ui")!;
    ui.parentId = "k.app.an";
    const t = treffer(lauf(c4), /modul „ui“/);
    assert.equal(t.length, 1);
    assert.match(t[0], /Präsentation/);
  });

  test("Modul ohne Schicht als Eltern-Element: rot", () => {
    const c4 = gueltig();
    c4.elemente.find((e) => e.id === "k.app.pr.ui")!.parentId = "k.app";
    assert.equal(treffer(lauf(c4), /modul „ui“/).length, 1);
  });

  test("Datei und Ordner liefern verschiedene Schichten: rot", () => {
    // src/ui.ts (Präsentation) neben src/ui/ ist ok; ein Barrel, das woanders landet, nicht.
    const modell = basis();
    modell.schichten[1].muster = "^src/(game|conflict)(\\.ts$|/)";
    modell.schichten[0].muster = "^src/(ui|conflict)/";
    const root = fixture({ "scripts/layers.cjs": layersFile(modell), "src/conflict/a.ts": "", "src/conflict.ts": "" });
    const m = ladeModell(root, "scripts/layers.cjs");
    const c4 = gueltig();
    const ms = api.pruefeArchitektur({ modell: m, module: api.srcModule(root, "src"), c4, cfg: CFG, hexagon: { text: hexText(), existiert: hexVorhanden } });
    assert.ok(treffer(ms, /conflict.*verschiedenen Schichten/).length >= 1, texte(ms).join("\n"));
  });

  test("verbotene Schicht-Kante: rot", () => {
    const c4 = gueltig();
    c4.beziehungen.push(bez("k.app.an", "k.app.pr", 77));
    const t = treffer(lauf(c4), /verboten/);
    assert.equal(t.length, 1);
    assert.match(t[0], /spiel\.c4:77 .*Anwendung → Präsentation.*Fix: /);
  });

  test("fehlende Schicht-Kante: rot", () => {
    const c4 = gueltig();
    c4.beziehungen = c4.beziehungen.filter((b) => !(b.von === "k.app.an" && b.nach === "k.app.do"));
    const t = treffer(lauf(c4), /fehlt/);
    assert.equal(t.length, 1);
    assert.match(t[0], /Anwendung → pure Domäne.*Fix: /);
  });

  test("Kante zur Bibliothek wird wie eine Schicht-Kante geprüft", () => {
    const c4 = gueltig();
    c4.beziehungen.push(bez("k.app.an", "k.app.ph", 80));
    assert.equal(treffer(lauf(c4), /Anwendung → Phaser.*verboten/).length, 1);
  });

  test("Kante mit Modul-Ende ist rot (nicht ableitbar), Kante mit Erzählungs-Ende bleibt frei", () => {
    const c4 = gueltig();
    c4.beziehungen.push(bez("k.app.pr.ui", "k.app.an.game", 90));
    const t = treffer(lauf(c4), /spiel\.c4:90/);
    assert.equal(t.length, 1);
    assert.match(t[0], /Modul-Ende.*ableitbar/);
    const frei = gueltig();
    frei.beziehungen.push(bez("sp", "k", 91), bez("k", "k.app.pr", 92));
    assert.deepEqual(texte(lauf(frei)), []);
  });

  test("unbekannte Art ist rot (fail-closed), eine Erzählungs-Art bleibt grün", () => {
    const c4 = gueltig();
    c4.elemente.push(el("k.neu", "komponente", "Neu", "k", 33));
    const t = treffer(lauf(c4), /komponente/);
    assert.equal(t.length, 1);
    assert.match(t[0], /spiel\.c4:33 .*Fix: .*(erzaehlung|bindungen)/);
  });

  test("doppelter Titel in einer gebundenen Art ist rot", () => {
    const c4 = gueltig();
    c4.elemente.push(el("k.app.pr.ui2", "modul", "ui", "k.app.pr", 40));
    const t = treffer(lauf(c4), /doppelt/);
    assert.ok(t.length >= 1);
    assert.match(t[0], /modul „ui“/);
    const s = gueltig();
    s.elemente.push(el("k.app.pr2", "schicht", "Präsentation", "k.app", 41));
    assert.ok(treffer(lauf(s), /schicht „Präsentation“.*doppelt/).length >= 1);
  });

  test("gleicher Titel in einer Erzählungs-Art oder in zwei verschiedenen gebundenen Arten ist kein Duplikat", () => {
    const c4 = gueltig();
    c4.elemente.push(el("a.w", "container", "Worker", "k", 40), el("b.w", "container", "Worker", "k", 41));
    c4.elemente.push(el("k.app.pr.x", "modul", "Präsentation", "k.app.pr", 42));
    const t = treffer(lauf(c4), /doppelt/);
    assert.deepEqual(t, [], t.join("\n"));
  });

  test("Config-Fehler sind rot: Block fehlt, unbekannter Binder, Art zugleich gebunden und Erzählung", () => {
    const ohne = lauf(gueltig(), {}, null);
    assert.ok(treffer(ohne, /config\.json.*architektur/).length >= 1);
    const binder = lauf(gueltig(), {}, { ...CFG, bindungen: { ...CFG.bindungen, schicht: "gibtsnicht" } });
    assert.ok(treffer(binder, /gibtsnicht/).length >= 1);
    const doppelt = lauf(gueltig(), {}, { ...CFG, erzaehlung: [...CFG.erzaehlung, "schicht"] });
    assert.ok(treffer(doppelt, /schicht.*zugleich/).length >= 1);
    for (const kaputt of [{ maxKnotenJeView: undefined }, { maxKnotenJeView: 0 }, { maxKnotenJeView: -1 }, { maxKnotenJeView: "25" }, { maxKnotenJeView: 2.5 }]) {
      const ms = lauf(gueltig(), {}, { ...CFG, ...kaputt } as unknown as Cfg);
      assert.ok(treffer(ms, /maxKnotenJeView ist keine positive Zahl/).length >= 1, JSON.stringify(kaputt));
    }
    assert.ok(treffer(lauf(gueltig(), {}, { ...CFG, workspace: "" }), /workspace oder quelle/).length >= 1);
    assert.ok(treffer(lauf(gueltig(), {}, { ...CFG, quelle: "" }), /workspace oder quelle/).length >= 1);
  });

  test("View-Deckel: genau am Deckel grün, Deckel + 1 rot", () => {
    const am = gueltig();
    am.views.push({ id: "gross", titel: "Groß", knoten: 25, datei: DATEI, zeile: 100 });
    assert.deepEqual(texte(lauf(am)), []);
    const drueber = gueltig();
    drueber.views.push({ id: "gross", titel: "Groß", knoten: 26, datei: DATEI, zeile: 100 });
    const t = treffer(lauf(drueber), /spiel\.c4:100 /);
    assert.equal(t.length, 1);
    assert.match(t[0], /26.*25.*Fix: .*teilen/);
  });

  test("jede Meldung nennt Datei:Zeile und einen Fix", () => {
    const c4 = gueltig();
    c4.elemente.push(el("k.app.zz", "schicht", "Erfundene Schicht", "k.app", 9));
    c4.beziehungen.push(bez("k.app.an", "k.app.pr", 77));
    for (const t of texte(lauf(c4))) assert.match(t, /\.c4:\d+ .*Fix: /);
  });

  test("Bindung an die ECHTE Schicht-Zuordnung: layerOf und schichtVon stimmen für Top-Level-Pfade überein", () => {
    const { schichtVon } = schichten as unknown as { schichtVon: (p: string, m: Modell) => string | null };
    for (const p of ["src/main.ts", "src/scenes/", "src/game/", "src/sim/", "src/content.ts"]) {
      assert.equal(schichtVon(p, echt.SCHICHT_MODELL), echt.layerOf(p), p);
    }
  });
});

describe("Hexagon-Sicht (#1567, ADR 0024)", () => {
  const mitText = (text: string | null, existiert = hexVorhanden, c4 = gueltig()) => lauf(c4, {}, CFG, { text, existiert });
  const PORT = "| Content-Quelle | getrieben | `src/content/a.ts` | pure Domäne |";
  const ADAPTER = "| Tastatur | Content-Quelle | `src/ui/a.ts` | Präsentation |";

  test("leseHexagon erkennt nur Pfade unter der übergebenen Quellwurzel (#1860)", () => {
    const text = hexText("| Content-Quelle | getrieben | `lib/content/a.ts` | pure Domäne |", "| Tastatur | Content-Quelle | `src/ui/a.ts` | Präsentation |", "Prosa `lib/game/a.ts`.");
    const hex = api.leseHexagon(text, "Hexagonale Sicht", "lib");
    assert.ok(hex);
    assert.deepEqual(hex.ports.map((p) => p.ort), [["lib/content/a.ts"]]);
    assert.deepEqual(hex.adapter.map((a) => a.ort), [[]]);
    assert.deepEqual(hex.pfade.map((p) => p.pfad), ["lib/game/a.ts", "lib/content/a.ts"]);
    assert.deepEqual(api.leseHexagon(text, "Hexagonale Sicht", "li")?.pfade, []);
  });

  test("leseHexagon: Sonderzeichen der Quellwurzel sind wörtlich, `s.c` trifft `sxc/` nicht (#1866 L25a)", () => {
    const text = hexText("| Content-Quelle | getrieben | `s.c/content/a.ts` | pure Domäne |", "| Tastatur | Content-Quelle | `sxc/ui/a.ts` | Präsentation |");
    const hex = api.leseHexagon(text, "Hexagonale Sicht", "s.c");
    assert.ok(hex);
    assert.deepEqual(hex.pfade.map((p) => p.pfad), ["s.c/content/a.ts"]);
    assert.deepEqual(hex.adapter.map((a) => a.ort), [[]]);
  });

  test("leseHexagon: Tabellen, Pfade bis zur nächsten Überschrift, Code-Fences ausgeblendet", () => {
    const text = hexText(PORT, ADAPTER, "Prosa `src/game/a.ts`.\n\n```\n### Hexagonale Sicht\n`src/im-fence.ts`\n```");
    const hex = api.leseHexagon(text, "Hexagonale Sicht", "src");
    assert.ok(hex);
    assert.deepEqual(hex.ports.map((p) => [p.name, p.zwei, p.ort, p.schicht]), [["Content-Quelle", "getrieben", ["src/content/a.ts"], "pure Domäne"]]);
    assert.deepEqual(hex.adapter.map((a) => [a.name, a.zwei]), [["Tastatur", "Content-Quelle"]]);
    assert.deepEqual(hex.pfade.map((p) => p.pfad), ["src/game/a.ts", "src/content/a.ts", "src/ui/a.ts"]);
    assert.equal(api.leseHexagon("# nur Titel\n", "Hexagonale Sicht", "src"), null);
    assert.equal(api.leseHexagon("```\n### Hexagonale Sicht\n```\n", "Hexagonale Sicht", "src"), null, "Überschrift im Fence zählt nicht");
  });

  test("Happy Path: keine Meldung", () => {
    assert.deepEqual(texte(mitText(hexText())), []);
  });

  test("Pfad in einer Tabellenzelle existiert nicht: rot mit Datei:Zeile der arc42-Datei", () => {
    const t = treffer(mitText(hexText(PORT.replace("src/content/a.ts", "src/content/weg.ts"))), /Pfad existiert nicht/);
    assert.equal(t.length, 1);
    assert.match(t[0], /docs\/arc42\.md:\d+ .*src\/content\/weg\.ts.*Fix: /);
  });

  test("Pfad in der Prosa existiert nicht: rot; ein Pfad hinter der nächsten Überschrift zählt nicht", () => {
    const t = treffer(mitText(hexText(PORT, ADAPTER, "Siehe `src/fehlt/x.ts`.")), /Pfad existiert nicht/);
    assert.equal(t.length, 1);
    assert.match(t[0], /src\/fehlt\/x\.ts/);
    assert.doesNotMatch(texte(mitText(hexText())).join("\n"), /gibtsnicht/);
  });

  test("Abschnitt fehlt, Datei fehlt: je eine Meldung", () => {
    assert.equal(treffer(mitText("# nichts\n"), /Abschnitt .*fehlt/).length, 1);
    assert.equal(treffer(mitText(null), /Abschnitt .*fehlt/).length, 1);
  });

  test("Ports- oder Adapter-Tabelle leer: rot, und eine umbenannte Kopfzeile erkennt die Tabelle nicht", () => {
    assert.equal(treffer(mitText(hexText("", ADAPTER)), /Ports-Tabelle fehlt oder ist leer/).length, 1);
    assert.equal(treffer(mitText(hexText(PORT, "")), /Adapter-Tabelle fehlt oder ist leer/).length, 1);
    assert.equal(treffer(mitText(hexText().replace("| Adapter | Port |", "| Adaptor | Port |")), /Adapter-Tabelle fehlt oder ist leer/).length, 1);
  });

  test("Config ohne hexagon-Block: rot, fail-closed", () => {
    const { hexagon: _weg, ...ohne } = CFG;
    void _weg;
    const t = treffer(lauf(gueltig(), {}, ohne), /Block "hexagon".*fehlt.*Fix: /);
    assert.equal(t.length, 1);
  });

  test("Seite weder treibend noch getrieben: rot", () => {
    const t = treffer(mitText(hexText(PORT.replace("getrieben", "seitlich"))), /Seite „seitlich“ ist weder treibend noch getrieben/);
    assert.equal(t.length, 1);
  });

  test("Schicht-Spalte widerspricht layers.cjs: rot, auch für ein Adapter-src/ui-Pfad als „pure Domäne“", () => {
    const t = treffer(mitText(hexText(PORT, ADAPTER.replace("Präsentation", "pure Domäne"))), /widerspricht scripts\/layers\.cjs.*„Präsentation“/);
    assert.equal(t.length, 1);
    assert.equal(treffer(mitText(hexText(PORT.replace("pure Domäne", "Anwendung"))), /widerspricht scripts\/layers\.cjs/).length, 1);
  });

  test("Pfade einer Zeile in zwei Top-Level-Modulen, Pfad außerhalb src/, Zeile ohne Pfad: rot", () => {
    assert.equal(treffer(mitText(hexText(PORT, "| Tastatur | Content-Quelle | `src/ui/a.ts`, `src/game/a.ts` | Präsentation |")), /mehreren Top-Level-Modulen/).length, 1);
    assert.equal(treffer(mitText(hexText(PORT, "| Tastatur | Content-Quelle | `test/x.ts` | Präsentation |"), (p) => p === "test/x.ts" || hexVorhanden(p)), /nicht unter src\//).length, 1);
    assert.equal(treffer(mitText(hexText(PORT, "| Tastatur | Content-Quelle | ohne Pfad | Präsentation |")), /keinen Backtick-Pfad/).length, 1);
  });

  test("Adapter nennt einen Port, der in der Ports-Tabelle fehlt; doppelte Zeile; Zeile mit falscher Zellenzahl", () => {
    assert.equal(treffer(mitText(hexText(PORT, ADAPTER.replace("| Content-Quelle |", "| Unbekannt |"))), /Port „Unbekannt“ steht nicht in der Ports-Tabelle/).length, 1);
    assert.equal(treffer(mitText(hexText(`${PORT}\n${PORT}`)), /Zeile kommt doppelt vor/).length, 1);
    assert.equal(treffer(mitText(hexText(`${PORT}\n| Kaputt | getrieben |`)), /nicht vier Zellen/).length, 1);
  });

  test("Modell gegen Tabelle, beide Richtungen: Port fehlt im Modell, Adapter fehlt im Modell, Element nicht in der Tabelle", () => {
    const ohnePort = gueltig();
    ohnePort.elemente = ohnePort.elemente.filter((e) => e.kind !== "port");
    assert.equal(treffer(lauf(ohnePort), /port „Content-Quelle“: fehlt im Modell/).length, 1);
    const ohneAdapter = gueltig();
    ohneAdapter.elemente = ohneAdapter.elemente.filter((e) => e.kind !== "adapter");
    assert.equal(treffer(lauf(ohneAdapter), /adapter „Tastatur“: fehlt im Modell/).length, 1);
    const extra = gueltig();
    extra.elemente.push(el("k.app.pr.ui.x", "adapter", "Erfunden", "k.app.pr.ui", 33));
    extra.elemente.push(el("k.app.do.content.y", "port", "Erfunden", "k.app.do.content", 34, ["treibend"]));
    assert.equal(treffer(lauf(extra), /adapter „Erfunden“.*steht nicht in der Adapter-Tabelle/).length, 1);
    assert.equal(treffer(lauf(extra), /port „Erfunden“.*steht nicht in der Ports-Tabelle/).length, 1);
  });

  test("Adapter unter falschem Modul: rot", () => {
    const c4 = gueltig();
    const a = c4.elemente.find((e) => e.id === "k.app.pr.ui.t");
    assert.ok(a);
    a.parentId = "k.app.an.game";
    const t = treffer(lauf(c4), /adapter „Tastatur“: liegt unter „game“.*Modul „ui“/);
    assert.equal(t.length, 1);
  });

  test("Port-Tag fehlt, widerspricht der Seite oder ist doppelt: rot", () => {
    for (const tags of [[], ["treibend"], ["treibend", "getrieben"]]) {
      const c4 = gueltig();
      const p = c4.elemente.find((e) => e.kind === "port");
      assert.ok(p);
      p.tags = tags;
      assert.equal(treffer(lauf(c4), /port „Content-Quelle“: Tag .*passt nicht zur Seite „getrieben“/).length, 1, tags.join());
    }
  });

  test("Kante Adapter → Port fehlt, falsche Richtung, falscher Port, doppelt, zusätzlich mit Port-Ende: rot", () => {
    const ohne = gueltig();
    ohne.beziehungen = ohne.beziehungen.filter((b) => b.von !== "k.app.pr.ui.t");
    assert.equal(treffer(lauf(ohne), /Kante Adapter → Port fehlt/).length, 1);
    const umgekehrt = gueltig();
    umgekehrt.beziehungen = umgekehrt.beziehungen.map((b) => (b.von === "k.app.pr.ui.t" ? { ...b, von: b.nach, nach: b.von } : b));
    assert.equal(treffer(lauf(umgekehrt), /Kante mit Port-\/Adapter-Ende ist nicht Adapter → Port/).length, 1);
    assert.equal(treffer(lauf(umgekehrt), /Kante Adapter → Port fehlt/).length, 1);
    const doppelt = gueltig();
    doppelt.beziehungen.push(bez("k.app.pr.ui.t", "k.app.do.content.q", 61));
    assert.equal(treffer(lauf(doppelt), /Kante kommt doppelt vor/).length, 1);
    const zusaetzlich = gueltig();
    zusaetzlich.beziehungen.push(bez("k.app.an.game", "k.app.do.content.q", 62));
    assert.equal(treffer(lauf(zusaetzlich), /Kante mit Port-\/Adapter-Ende ist nicht Adapter → Port/).length, 1);
  });

  test("Schicht-Richtung Adapter → Port nicht erlaubt: rot; gleiche Schicht und erlaubte Richtung bleiben grün", () => {
    // pure Domäne darf nicht in die Präsentation: Adapter in der Domäne, Port in der Präsentation.
    const port = "| Anzeige | treibend | `src/ui/a.ts` | Präsentation |";
    const adapter = "| Import | Anzeige | `src/content/a.ts` | pure Domäne |";
    const c4 = gueltig();
    c4.elemente = c4.elemente.filter((e) => e.kind !== "port" && e.kind !== "adapter");
    c4.beziehungen = c4.beziehungen.filter((b) => b.von !== "k.app.pr.ui.t");
    c4.elemente.push(el("k.app.pr.ui.p", "port", "Anzeige", "k.app.pr.ui", 40, ["treibend"]), el("k.app.do.content.a", "adapter", "Import", "k.app.do.content", 41));
    c4.beziehungen.push(bez("k.app.do.content.a", "k.app.pr.ui.p", 63));
    const t = treffer(lauf(c4, {}, CFG, { text: hexText(port, adapter), existiert: hexVorhanden }), /Schicht-Richtung pure Domäne → Präsentation/);
    assert.equal(t.length, 1);
    assert.deepEqual(texte(mitText(hexText())), []);
  });

  test("Adapter und Port in derselben Schicht ergeben keine Schicht-Richtungs-Meldung", () => {
    const c4 = gueltig();
    const a = c4.elemente.find((e) => e.kind === "adapter");
    assert.ok(a);
    a.parentId = "k.app.do.content";
    const t = mitText(hexText(PORT, "| Tastatur | Content-Quelle | `src/content/a.ts` | pure Domäne |"), hexVorhanden, c4);
    assert.deepEqual(texte(t), []);
  });

  test("Top-Level-Datei src/ui.ts gehört zum Modul ui; src/ ohne Rest ist kein Modul", () => {
    assert.deepEqual(texte(mitText(hexText(PORT, "| Tastatur | Content-Quelle | `src/ui.ts` | Präsentation |"))), []);
    assert.equal(treffer(mitText(hexText(PORT, "| Tastatur | Content-Quelle | `src/` | Präsentation |")), /nicht unter src\//).length, 1);
  });

  test("Ort in verschiedenen Schichten (Barrel und Ordner): eine Meldung statt Absturz", () => {
    const modell = basis();
    modell.schichten[1].muster = "^src/(game|conflict)(\\.ts$|/)";
    modell.schichten[0].muster = "^src/(ui|conflict)/";
    const extra = { "scripts/layers.cjs": layersFile(modell), "src/conflict/a.ts": "", "src/conflict.ts": "" };
    const text = hexText(PORT, "| Tastatur | Content-Quelle | `src/conflict.ts`, `src/conflict/a.ts` | Präsentation |");
    const t = treffer(lauf(gueltig(), extra, CFG, { text, existiert: () => true }), /verschiedenen oder unbekannten Schichten/);
    assert.equal(t.length, 1);
  });

  test("Elternprüfung: Adapter ohne Eltern oder direkt unter einer Schicht ist rot", () => {
    const ohne = gueltig();
    const a = ohne.elemente.find((e) => e.kind === "adapter");
    assert.ok(a);
    a.parentId = null;
    assert.equal(treffer(lauf(ohne), /adapter „Tastatur“: liegt unter keinem Element/).length, 1);
    const unterSchicht = gueltig();
    const b = unterSchicht.elemente.find((e) => e.kind === "adapter");
    assert.ok(b);
    b.parentId = "k.app.pr";
    assert.equal(treffer(lauf(unterSchicht), /adapter „Tastatur“: liegt unter „Präsentation“/).length, 1);
  });

  test("eine weitere Tabelle im Abschnitt ohne Port-/Adapter-Kopf wird nicht als Adapter gelesen", () => {
    const text = hexText().replace("### Nächster Abschnitt", "Zwischentext.\n\n| A | B |\n|---|---|\n| x | y |\n\n### Nächster Abschnitt");
    assert.deepEqual(texte(mitText(text)), []);
  });

  test("eine Überschrift der Ebene 4 beendet den Abschnitt nicht: Pfade dahinter werden geprüft", () => {
    const t = treffer(mitText(hexText(PORT, ADAPTER, "#### Unterteil\n\n`src/fehlt/y.ts`")), /Pfad existiert nicht/);
    assert.equal(t.length, 1);
  });

  test("Adapter zeigt auf einen anderen existierenden Port als die Tabelle: rot", () => {
    const c4 = gueltig();
    c4.elemente.push(el("k.app.an.game.z", "port", "Zweit", "k.app.an.game", 22, ["treibend"]));
    c4.beziehungen = c4.beziehungen.map((b) => (b.von === "k.app.pr.ui.t" ? { ...b, nach: "k.app.an.game.z" } : b));
    const text = hexText(`${PORT}\n| Zweit | treibend | \`src/game/a.ts\` | Anwendung |`);
    const ms = mitText(text, hexVorhanden, c4);
    assert.equal(treffer(ms, /Kante mit Port-\/Adapter-Ende ist nicht Adapter → Port/).length, 1);
    assert.equal(treffer(ms, /Kante Adapter → Port fehlt/).length, 1);
  });

  test("Config: hexagon ohne abschnitt ist rot", () => {
    const cfg = { ...CFG, hexagon: { datei: "docs/arc42.md" } } as unknown as Cfg;
    assert.equal(treffer(lauf(gueltig(), {}, cfg), /Block "hexagon".*fehlt/).length, 1);
  });

  test("Pfade unter scripts/ und docs/ in der Prosa werden geprüft", () => {
    const t = treffer(mitText(hexText(PORT, ADAPTER, "Siehe `scripts/fehlt.cjs` und `docs/fehlt.md`.")), /Pfad existiert nicht/);
    assert.equal(t.length, 2);
  });

  test("View mit abgeleiteter Kante mit Modul-Ende: rot; Kante zwischen Schichten bleibt grün", () => {
    const c4 = gueltig();
    c4.views = [{ id: "mod", titel: "Mod", knoten: 3, datei: DATEI, zeile: 80, kanten: [{ von: "k.app.pr.ui", nach: "k.app.an.game" }] }];
    const t = treffer(lauf(c4), /spiel\.c4:80 view „mod“: zeigt die abgeleitete Kante ui → game/);
    assert.equal(t.length, 1);
    c4.views = [...gueltig().views, { id: "ok", titel: "Ok", knoten: 3, datei: DATEI, zeile: 80, kanten: [{ von: "k.app.pr", nach: "k.app.an" }] }];
    assert.deepEqual(texte(lauf(c4)), []);
  });

  test("View-Kante mit nur einem Modul-Ende (beide Richtungen) ist rot; unbekannte Kanten-IDs werden ignoriert", () => {
    const c4 = gueltig();
    c4.views = [{ id: "halb", titel: "Halb", knoten: 3, datei: DATEI, zeile: 80, kanten: [{ von: "k.app.pr", nach: "k.app.an.game" }, { von: "k.app.an.game", nach: "k.app.pr" }, { von: "gibts.nicht", nach: "k.app.an.game" }, { von: "k.app.pr", nach: "gibts.nicht" }] }];
    assert.equal(treffer(lauf(c4), /view „halb“: zeigt die abgeleitete Kante/).length, 2);
  });

  test("Ort in einer Bibliothek statt einer Schicht (schichtVon liefert eine Extern-ID): eine Meldung statt Absturz", () => {
    const text = hexText(PORT, "| Tastatur | Content-Quelle | `src/dep/node_modules/phaser/a.ts` | Präsentation |");
    const t = treffer(lauf(gueltig(), {}, CFG, { text, existiert: () => true }), /verschiedenen oder unbekannten Schichten/);
    assert.equal(t.length, 1);
  });

  test("Adapter unter einem Nicht-Modul mit dem Titel des Moduls ist rot (Art zählt, nicht nur der Titel)", () => {
    const c4 = gueltig();
    c4.elemente.push(el("k.app.pr.uiS", "schicht", "ui", "k.app.pr", 30));
    const a = c4.elemente.find((e) => e.kind === "adapter");
    assert.ok(a);
    a.parentId = "k.app.pr.uiS";
    assert.equal(treffer(lauf(c4), /adapter „Tastatur“: liegt unter „ui“/).length, 1);
  });

  test("eine Überschrift der Ebene 1 oder 2 beendet den Abschnitt: Pfade dahinter zählen nicht", () => {
    const text = hexText().replace("### Nächster Abschnitt", "## 6. Nächstes Kapitel");
    assert.deepEqual(texte(mitText(text)), []);
    assert.deepEqual(texte(mitText(hexText().replace("### Nächster Abschnitt", "# Anhang"))), [], "Ebene 1 beendet ihn ebenfalls");
  });
});

describe("ladeC4Modell: der Adapter", () => {
  const SPEC = "specification {\n  element schicht\n  element modul\n}\n";
  test("gültiger Workspace: Form, parentId und Datei relativ mit /", async () => {
    const root = fixture({
      "docs/architektur/spec.c4": SPEC,
      "docs/architektur/m.c4": "model {\n  a = schicht 'A' {\n    m = modul 'm'\n  }\n  b = schicht 'B'\n  a -> b\n}\nviews {\n  view index {\n    include *\n  }\n}\n",
    });
    const c4 = await api.ladeC4Modell(root, "docs/architektur");
    const m = c4.elemente.find((e) => e.id === "a.m");
    assert.ok(m);
    assert.equal(m.kind, "modul");
    assert.equal(m.title, "m");
    assert.equal(m.parentId, "a");
    assert.equal(m.datei, "docs/architektur/m.c4");
    assert.equal(m.zeile, 3, "1-basiert");
    assert.equal(c4.elemente.find((e) => e.id === "a")?.parentId, null);
    assert.deepEqual(c4.beziehungen.map((b) => [b.von, b.nach]), [["a", "b"]]);
    assert.equal(c4.beziehungen[0].datei, "docs/architektur/m.c4");
    assert.deepEqual(c4.views.map((v) => [v.id, v.knoten]), [["index", 2]]);
    assert.deepEqual(c4.views[0].kanten, [{ von: "a", nach: "b" }]);
  }, 30000);

  test("Beschreibung, Technik, Beziehungs-Titel und Schritt-Label einer dynamischen View kommen an (#1421)", async () => {
    const root = fixture({
      "docs/architektur/spec.c4": SPEC,
      "docs/architektur/m.c4": [
        "model {",
        "  a = schicht 'A' {",
        "    description 'Beschreibung A'",
        "    technology 'Technik A'",
        "  }",
        "  b = schicht 'B'",
        "  a -> b 'Kante AB' 'Text AB'",
        "}",
        "views {",
        "  view index {",
        "    include *",
        "  }",
        "  dynamic view ablauf {",
        "    a -> b 'Schritt eins'",
        "  }",
        "}",
        "",
      ].join("\n"),
    });
    const c4 = await api.ladeC4Modell(root, "docs/architektur");
    const a = c4.elemente.find((e) => e.id === "a");
    assert.equal(a?.beschreibung, "Beschreibung A");
    assert.equal(a?.technik, "Technik A");
    assert.equal(c4.elemente.find((e) => e.id === "b")?.beschreibung, null);
    assert.deepEqual([c4.beziehungen[0].titel, c4.beziehungen[0].beschreibung], ["Kante AB", "Text AB"]);
    assert.deepEqual(c4.views.find((v) => v.id === "ablauf")?.kanten, [{ von: "a", nach: "b", label: "Schritt eins" }]);
    assert.equal(c4.views.find((v) => v.id === "index")?.kanten?.[0].label, undefined, "nur dynamische Views tragen Schritt-Labels");
  }, 30000);

  test("Tags eines Elements kommen als Namen ohne #", async () => {
    const root = fixture({
      "docs/architektur/spec.c4": "specification {\n  tag getrieben\n  element port\n}\n",
      "docs/architektur/m.c4": "model {\n  p = port 'P' {\n    #getrieben\n  }\n  q = port 'Q'\n}\nviews {\n  view index {\n    include *\n  }\n}\n",
    });
    const c4 = await api.ladeC4Modell(root, "docs/architektur");
    assert.deepEqual(c4.elemente.find((e) => e.id === "p")?.tags, ["getrieben"]);
    assert.deepEqual(c4.elemente.find((e) => e.id === "q")?.tags, []);
  }, 30000);

  test("kaputter Workspace: wirft mit Datei und Zeile", async () => {
    const root = fixture({
      "docs/architektur/spec.c4": SPEC,
      "docs/architektur/kaputt.c4": "model {\n  a = schicht 'A'\n  a -> gibtsNicht\n}\n",
    });
    await assert.rejects(api.ladeC4Modell(root, "docs/architektur"), /kaputt\.c4:3/);
  }, 30000);
});

const cliConfig = JSON.stringify({ schichten: { layers: "scripts/layers.cjs" }, architektur: CFG });
const SPEC = "specification {\n  tag getrieben\n  element schicht\n  element bibliothek\n  element modul\n  element port\n  element adapter\n}\n";
const MODELL = [
  "model {",
  "  pr = schicht 'Präsentation' {",
  "    ui = modul 'ui' {",
  "      tastatur = adapter 'Tastatur'",
  "    }",
  "  }",
  "  an = schicht 'Anwendung' {",
  "    game = modul 'game'",
  "  }",
  "  do = schicht 'pure Domäne' {",
  "    content = modul 'content' {",
  "      quelle = port 'Content-Quelle' {",
  "        #getrieben",
  "      }",
  "    }",
  "  }",
  "  ph = bibliothek 'Phaser'",
  "  pr -> an",
  "  pr -> do",
  "  pr -> ph",
  "  an -> do",
  "  pr.ui.tastatur -> do.content.quelle",
  "}",
  "",
].join("\n");
const cliFixture = (extra: Record<string, string> = {}) =>
  fixture(srcFiles({ "scripts/docs-gen/config.json": cliConfig, "docs/architektur/spec.c4": SPEC, "docs/architektur/m.c4": MODELL, [ARC42]: hexText(), ...extra }));
async function cliLauf(root: string, spawn: (a: string[]) => number) {
  const out: string[] = [];
  const err: string[] = [];
  const code = await api.cli([], { rootDir: root, out: (s) => out.push(s), err: (s) => err.push(s), spawn });
  return { code, out: out.join("\n"), err: err.join("\n") };
}

describe("cli: Harness-Bindung (#1421)", () => {
  const SPEC_H = SPEC.replace("  element adapter\n", "  element adapter\n  element githook\n  element mcp\n");
  const HARNESS_CFG = JSON.stringify({
    schichten: { layers: "scripts/layers.cjs" },
    harness: { gitHooks: ".githooks", mcp: ".mcp.json" },
    architektur: { ...CFG, bindungen: { ...CFG.bindungen, githook: "githook", mcp: "mcp" } },
  });
  const harnessFixture = (modell: string, extra: Record<string, string> = {}) =>
    cliFixture({
      "scripts/docs-gen/config.json": HARNESS_CFG,
      "docs/architektur/spec.c4": SPEC_H,
      "docs/architektur/h.c4": modell,
      ".githooks/pre-push": "#!/bin/sh\n",
      ".mcp.json": JSON.stringify({ mcpServers: { playwright: {} } }),
      ...extra,
    });
  const VOLL = "model {\n  gh = githook 'pre-push'\n  pw = mcp 'playwright'\n}\n";

  test("alles abgeglichen: Exit 0, die Erfolgsmeldung nennt die Quellen aus der Config", async () => {
    const r = await cliLauf(harnessFixture(VOLL), () => 0);
    assert.equal(r.err, "");
    assert.equal(r.code, 0);
    assert.match(r.out, /scripts\/layers\.cjs, src\/ und den Harness-Quellen/);
  }, 30000);

  test("ein Git-Hook fehlt im Modell: Exit 1 mit Meldung", async () => {
    const r = await cliLauf(harnessFixture(VOLL, { ".githooks/commit-msg": "#!/bin/sh\n" }), () => 0);
    assert.equal(r.code, 1);
    assert.match(r.err, /githook „commit-msg“: fehlt im Modell, steht aber in \.githooks\. Fix: /);
  }, 30000);

  test("eine Quelle fehlt (.mcp.json weg): Exit 1 mit abgleich-Meldung statt Absturz", async () => {
    const root = harnessFixture(VOLL);
    rmSync(join(root, ".mcp.json"));
    const r = await cliLauf(root, () => 0);
    assert.equal(r.code, 1);
    assert.match(r.err, /abgleich.*\.mcp\.json fehlt/);
  }, 30000);
});

describe("cli", () => {
  test("alles grün: Exit 0 und Erfolgsmeldung, validate dann format --check", async () => {
    const calls: string[][] = [];
    const r = await cliLauf(cliFixture(), (a) => (calls.push(a), 0));
    assert.equal(r.err, "");
    assert.equal(r.code, 0);
    assert.match(r.out, /check:c4: .*überein/);
    assert.deepEqual(calls.map((a) => a[0]), ["validate", "format"]);
    assert.deepEqual(calls[1].slice(0, 2), ["format", "--check"]);
  }, 30000);

  test("Abgleich-Abweichung (neuer src/-Ordner) macht das Gate rot, auch wenn validate und format grün sind", async () => {
    const r = await cliLauf(cliFixture({ "src/xyz/a.ts": "" }), () => 0);
    assert.equal(r.code, 1);
    assert.match(r.err, /✖ .*\.c4:\d+ modul „xyz“.*Fix: /);
    assert.equal(r.out, "");
  }, 30000);

  test("Hexagon-Pfad existiert nicht (echtes Dateisystem): Exit 1; arc42-Datei fehlt: Exit 1", async () => {
    const r = await cliLauf(cliFixture({ [ARC42]: hexText().replace("`src/ui/a.ts`", "`src/ui/weg.ts`") }), () => 0);
    assert.equal(r.code, 1);
    assert.match(r.err, /docs\/arc42\.md:\d+ hexagon „src\/ui\/weg\.ts“: Pfad existiert nicht.*Fix: /);
    const ohne = await cliLauf(cliFixture({ [ARC42]: "" }), () => 0);
    assert.equal(ohne.code, 1);
    assert.match(ohne.err, /Abschnitt .*fehlt/);
  }, 30000);

  test("nur format rot (Abgleich grün): Exit 1 mit Fix npm run c4:format", async () => {
    const r = await cliLauf(cliFixture(), (a) => (a[0] === "format" ? 1 : 0));
    assert.equal(r.code, 1);
    assert.match(r.err, /npm run c4:format/);
    assert.doesNotMatch(r.err, /modul|abgleich/);
  }, 30000);

  test("der Abgleich wirft (layers.cjs fehlt): Exit 1 mit abgleich-Meldung", async () => {
    const cfg = JSON.stringify({ schichten: { layers: "scripts/gibtsnicht.cjs" }, architektur: CFG });
    const r = await cliLauf(cliFixture({ "scripts/docs-gen/config.json": cfg }), () => 0);
    assert.equal(r.code, 1);
    assert.match(r.err, /abgleich.*Fix: /);
  }, 30000);

  test("validate rot bricht ab (kein format, kein Abgleich), Fix nennt die .c4-Datei", async () => {
    const calls: string[][] = [];
    const r = await cliLauf(cliFixture(), (a) => (calls.push(a), 1));
    assert.equal(r.code, 1);
    assert.equal(calls.length, 1);
    assert.match(r.err, /Fix: .*\.c4/);
  });

  test("likec4 nicht installiert (spawn liefert -1): Exit 1 mit Fix npm ci", async () => {
    const r = await cliLauf(cliFixture(), () => -1);
    assert.equal(r.code, 1);
    assert.match(r.err, /Fix: npm ci/);
  });

  test("Config fehlt oder ist kaputt: Exit 1, kein likec4-Aufruf", async () => {
    const calls: string[][] = [];
    const ohne = await cliLauf(fixture(srcFiles()), (a) => (calls.push(a), 0));
    assert.equal(ohne.code, 1);
    assert.match(ohne.err, /config\.json/);
    const kaputt = await cliLauf(fixture(srcFiles({ "scripts/docs-gen/config.json": "{ nicht json" })), (a) => (calls.push(a), 0));
    assert.equal(kaputt.code, 1);
    assert.equal(calls.length, 0);
  });

  test("Config ist kein JSON-Objekt (null, Liste, Zahl): Exit 1 mit Meldung statt TypeError, kein likec4-Aufruf (#1428 Z19)", async () => {
    for (const roh of ["null", "[]", "42", '"text"']) {
      const calls: string[][] = [];
      const r = await cliLauf(fixture(srcFiles({ "scripts/docs-gen/config.json": roh })), (a) => (calls.push(a), 0));
      assert.equal(r.code, 1, roh);
      assert.match(r.err, /kein JSON-Objekt/, roh);
      assert.equal(calls.length, 0, roh);
    }
  });

  test("architektur.quelle weicht von der Quellwurzel des Schicht-Modells ab: Exit 1 mit abgleich-Meldung (#1428 Z13)", async () => {
    const cfg = JSON.stringify({ schichten: { layers: "scripts/layers.cjs" }, architektur: { ...CFG, quelle: "lib" } });
    const r = await cliLauf(cliFixture({ "scripts/docs-gen/config.json": cfg, ".factory/projekt.json": projektConfig("lib") }), () => 0);
    assert.equal(r.code, 1);
    assert.match(r.err, /architektur\.quelle „lib“ passt nicht zur Quellwurzel „src\/“/);
  }, 30000);

  test("struktur.quelle weicht von architektur.quelle ab: Exit 1, beide Dateien genannt, kein likec4-Aufruf (#1866 L17)", async () => {
    const calls: string[][] = [];
    const r = await cliLauf(cliFixture({ ".factory/projekt.json": projektConfig("lib") }), (a) => (calls.push(a), 0));
    assert.equal(r.code, 1);
    assert.match(r.err, /scripts\/docs-gen\/config\.json:1 architektur\.quelle „src“ weicht von struktur\.quelle „lib“ in \.factory\/projekt\.json ab.*Fix: /);
    assert.equal(calls.length, 0);
  });

  test("Projekt-Config ohne struktur oder nicht lesbar: Exit 1 mit Fix, kein likec4-Aufruf (#1866 L17)", async () => {
    for (const extra of [{ ".factory/projekt.json": "{}" }, { ".factory/projekt.json": "{ kaputt" }]) {
      const calls: string[][] = [];
      const r = await cliLauf(cliFixture(extra), (a) => (calls.push(a), 0));
      assert.equal(r.code, 1, JSON.stringify(extra));
      assert.match(r.err, /\.factory\/projekt\.json:1 struktur .*Fix: /);
      assert.equal(calls.length, 0);
    }
  });

  test("Block architektur fehlt: Exit 1 mit gezieltem Fix, kein likec4-Aufruf", async () => {
    const calls: string[][] = [];
    const cfg = JSON.stringify({ schichten: { layers: "scripts/layers.cjs" } });
    const r = await cliLauf(fixture(srcFiles({ "scripts/docs-gen/config.json": cfg })), (a) => (calls.push(a), 0));
    assert.equal(r.code, 1);
    assert.match(r.err, /Block "architektur" fehlt.*Fix: /);
    assert.equal(calls.length, 0);
  });
});

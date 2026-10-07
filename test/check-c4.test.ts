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
import { fileURLToPath } from "node:url";

// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as raw from "../scripts/check-c4.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as schichten from "../scripts/docs-gen/schichten.mjs";

type Schicht = { id: string; label: string; technik?: string; muster: string | null; wurzeln: string[]; darf: string[] };
type Modell = { quellwurzel: string; schichten: Schicht[]; extern: { id: string; label: string; muster: string }[] };
type El = { id: string; kind: string; title: string; parentId: string | null; datei: string; zeile: number };
type Bez = { von: string; nach: string; datei: string; zeile: number };
type View = { id: string; titel: string; knoten: number; datei: string; zeile: number };
type C4 = { elemente: El[]; beziehungen: Bez[]; views: View[] };
type Meldung = { datei: string; zeile: number; art: string; element: string; text: string; fix: string };
type Cfg = { workspace: string; quelle: string; bindungen: Record<string, string>; erzaehlung: string[]; maxKnotenJeView: number };
const api = raw as unknown as {
  srcModule: (rootDir: string, quelle: string) => { name: string; pfade: string[] }[];
  pruefeArchitektur: (a: { modell: Modell; module: { name: string; pfade: string[] }[]; c4: C4; cfg: Cfg }) => Meldung[];
  formatiere: (m: Meldung) => string;
  ladeC4Modell: (rootDir: string, workspace: string) => Promise<C4>;
  cli: (argv: string[], io: { rootDir: string; out: (s: string) => void; err: (s: string) => void; spawn?: (args: string[]) => number }) => Promise<number>;
};
const { ladeModell } = schichten as unknown as { ladeModell: (rootDir: string, layers: string) => Modell };

const req = createRequire(import.meta.url);
const ECHT_PFAD = fileURLToPath(new URL("../scripts/layers.cjs", import.meta.url));
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

const layersFile = (m: unknown) => `module.exports = { SCHICHT_MODELL: ${JSON.stringify(m)}, pruefeModell: require(${JSON.stringify(ECHT_PFAD)}).pruefeModell };\n`;
const srcFiles = (extra: Record<string, string> = {}) => ({
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
  bindungen: { schicht: "schicht", bibliothek: "extern", modul: "modul" },
  erzaehlung: ["person", "system", "container", "datenspeicher"],
  maxKnotenJeView: 25,
};
const DATEI = "docs/architektur/spiel.c4";
const el = (id: string, kind: string, title: string, parentId: string | null = null, zeile = 1): El => ({ id, kind, title, parentId, datei: DATEI, zeile });
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
  ],
  beziehungen: [
    bez("k.app.pr", "k.app.an"),
    bez("k.app.pr", "k.app.do"),
    bez("k.app.pr", "k.app.ph"),
    bez("k.app.an", "k.app.do"),
    bez("k.app.an", "sp"),
  ],
  views: [{ id: "index", titel: "Kontext", knoten: 3, datei: DATEI, zeile: 70 }],
});

function lauf(c4: C4, extra: Record<string, string> = {}, cfg: Cfg | null = CFG): Meldung[] {
  const root = fixture(srcFiles(extra));
  const modell = ladeModell(root, "scripts/layers.cjs");
  return api.pruefeArchitektur({ modell, module: api.srcModule(root, "src"), c4, cfg: cfg as unknown as Cfg });
}
const texte = (ms: Meldung[]) => ms.map((m) => api.formatiere(m));
const treffer = (ms: Meldung[], re: RegExp) => texte(ms).filter((t) => re.test(t));

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
    const ms = api.pruefeArchitektur({ modell, module: api.srcModule(root, "src"), c4: gueltig(), cfg: CFG });
    const t = treffer(ms, /xyz/);
    assert.equal(t.length, 1);
    assert.match(t[0], /modul „xyz“.*Fix: .*pure Domäne/);
    assert.match(t[0], /docs\/architektur\/spiel\.c4:1 /);
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
    const ms = api.pruefeArchitektur({ modell: m, module: api.srcModule(root, "src"), c4, cfg: CFG });
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
const SPEC = "specification {\n  element schicht\n  element bibliothek\n  element modul\n}\n";
const MODELL = [
  "model {",
  "  pr = schicht 'Präsentation' {",
  "    ui = modul 'ui'",
  "  }",
  "  an = schicht 'Anwendung' {",
  "    game = modul 'game'",
  "  }",
  "  do = schicht 'pure Domäne' {",
  "    content = modul 'content'",
  "  }",
  "  ph = bibliothek 'Phaser'",
  "  pr -> an",
  "  pr -> do",
  "  pr -> ph",
  "  an -> do",
  "}",
  "",
].join("\n");
const cliFixture = (extra: Record<string, string> = {}) =>
  fixture(srcFiles({ "scripts/docs-gen/config.json": cliConfig, "docs/architektur/spec.c4": SPEC, "docs/architektur/m.c4": MODELL, ...extra }));
async function cliLauf(root: string, spawn: (a: string[]) => number) {
  const out: string[] = [];
  const err: string[] = [];
  const code = await api.cli([], { rootDir: root, out: (s) => out.push(s), err: (s) => err.push(s), spawn });
  return { code, out: out.join("\n"), err: err.join("\n") };
}

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

  test("Block architektur fehlt: Exit 1 mit gezieltem Fix, kein likec4-Aufruf", async () => {
    const calls: string[][] = [];
    const cfg = JSON.stringify({ schichten: { layers: "scripts/layers.cjs" } });
    const r = await cliLauf(fixture(srcFiles({ "scripts/docs-gen/config.json": cfg })), (a) => (calls.push(a), 0));
    assert.equal(r.code, 1);
    assert.match(r.err, /Block "architektur" fehlt.*Fix: /);
    assert.equal(calls.length, 0);
  });
});

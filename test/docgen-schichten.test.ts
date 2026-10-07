/* Schichtdiagramme (#1368): Generatoren `schichten-soll` (aus SCHICHT_MODELL in scripts/layers.cjs)
 * und `schichten-ist` (aus dem JSON von dependency-cruiser, auf Schichten verdichtet).
 * Fixture-Layers im mkdtemp-Root; dazu die Bindung an die echte Schicht-Zuordnung (`layerOf`).
 */
import { afterEach, describe, test } from "vitest";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as schichten from "../scripts/docs-gen/schichten.mjs";

type Schicht = { id: string; label: string; technik?: string; muster: string | null; wurzeln: string[]; darf: string[] };
type Modell = { schichten: Schicht[]; extern: { id: string; label: string; muster: string }[] };
type Cfg = Record<string, unknown>;
type Kante = [string, string];
const api = schichten as unknown as {
  ladeModell: (rootDir: string, layers: string) => Modell;
  schichtVon: (pfad: string, m: Modell) => string | null;
  sollKanten: (m: Modell) => Kante[];
  istKanten: (json: unknown, m: Modell) => Kante[];
  renderDiagramm: (m: Modell, k: Kante[]) => string;
  ungenutztZeile: (m: Modell, soll: Kante[], ist: Kante[]) => string;
  schichtenSollGenerator: (ctx: { rootDir: string; config: Cfg }) => string;
  schichtenIstGenerator: (ctx: { rootDir: string; config: Cfg }) => string;
};

const req = createRequire(import.meta.url);
const echt = req("../scripts/layers.cjs") as { SCHICHT_MODELL: Modell; layerOf: (f: string) => string; pruefeModell: (m: Modell) => void; verbotsRegeln: (m: Modell) => unknown[] };
const ECHT_PFAD = fileURLToPath(new URL("../scripts/layers.cjs", import.meta.url));

const PHASER = "node_modules[/\\\\]phaser[/\\\\]";
const basis = (): Modell => ({
  schichten: [
    { id: "praesentation", label: "Präsentation", technik: "Phaser/DOM", muster: "^src/ui(\\.ts$|/)", wurzeln: ["ui"], darf: ["anwendung", "domaene", "phaser"] },
    { id: "anwendung", label: "Anwendung", muster: "^src/game(\\.ts$|/)", wurzeln: ["game"], darf: ["domaene"] },
    { id: "domaene", label: "pure Domäne", muster: null, wurzeln: [], darf: [] },
  ],
  extern: [{ id: "phaser", label: "Phaser", muster: PHASER }],
});

const dirs: string[] = [];
function fixture(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "kq-schichten-"));
  dirs.push(root);
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(root, rel);
    mkdirSync(join(abs, ".."), { recursive: true });
    writeFileSync(abs, content);
  }
  return root;
}
const layersFile = (m: unknown) => `module.exports = { SCHICHT_MODELL: ${JSON.stringify(m)}, pruefeModell: require(${JSON.stringify(ECHT_PFAD)}).pruefeModell };\n`;
const fixtureMitModell = (m: unknown, extra: Record<string, string> = {}) => fixture({ "scripts/layers.cjs": layersFile(m), ...extra });
const cfg = (extra: Cfg = {}): Cfg => ({ schichten: { layers: "scripts/layers.cjs", ...extra } });
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const soll = (m: Modell) => api.schichtenSollGenerator({ rootDir: fixtureMitModell(m), config: cfg() });
const cruiseJson = (mods: Record<string, string[]>) => ({
  modules: Object.entries(mods).map(([source, deps]) => ({ source, dependencies: deps.map((resolved) => ({ resolved })) })),
});

describe("Soll-Diagramm", () => {
  test("Grundfall: Knoten, Kanten, Phaser/DOM nur an der Präsentation", () => {
    const out = soll(basis());
    assert.match(out, /^```mermaid\n---\n/);
    assert.match(out, /s_praesentation\["Präsentation · Phaser\/DOM<br\/>ui"\]/);
    assert.match(out, /s_domaene\["pure Domäne<br\/>alles übrige unter src\/"\]/);
    assert.match(out, /x_phaser\{\{"Phaser"\}\}/);
    for (const k of ["s_praesentation --> s_anwendung", "s_praesentation --> s_domaene", "s_anwendung --> s_domaene", "s_praesentation -.-> x_phaser"])
      assert.ok(out.includes(`\n  ${k}\n`), k);
    assert.ok(!/s_(anwendung|domaene) -\.->/.test(out), "nur Schichten mit phaser in darf zeigen auf Phaser");
    assert.match(out, /class s_praesentation engine\n/);
    assert.ok(!/engine\b.*s_anwendung/.test(out));
  });

  test("eine neue Schicht erscheint im Diagramm", () => {
    const m = basis();
    m.schichten.splice(2, 0, { id: "infrastruktur", label: "Infrastruktur", muster: "^src/infra(\\.ts$|/)", wurzeln: ["infra"], darf: ["domaene"] });
    const out = soll(m);
    assert.match(out, /s_infrastruktur\["Infrastruktur<br\/>infra"\]/);
    assert.ok(out.includes("\n  s_infrastruktur --> s_domaene\n"));
  });

  test("eine entfernte erlaubte Kante verschwindet, der Rest bleibt", () => {
    const m = basis();
    const mit = soll(m);
    m.schichten[1].darf = [];
    const ohne = soll(m);
    assert.ok(mit.includes("\n  s_anwendung --> s_domaene\n"));
    assert.ok(!ohne.includes("s_anwendung --> s_domaene"));
    assert.equal(ohne, mit.replace("  s_anwendung --> s_domaene\n", ""));
  });

  test("deterministisch: gleiche Eingabe gleicher Text, Reihenfolge der darf-Liste egal", () => {
    const m = basis();
    const a = soll(m);
    assert.equal(soll(m), a);
    m.schichten[0].darf = ["phaser", "domaene", "anwendung"];
    assert.equal(soll(m), a);
  });

  test("ein gegenseitig erlaubtes Paar wird genau ein <-->", () => {
    const m = basis();
    m.schichten[1].darf = ["praesentation", "domaene"];
    const out = soll(m);
    assert.equal(out.split("<-->").length - 1, 1);
    assert.ok(out.includes("\n  s_praesentation <--> s_anwendung\n"));
    assert.ok(!out.includes("s_anwendung --> s_praesentation"));
  });

  test("Frontmatter fixiert Theme und Layout, kein Titel", () => {
    const out = soll(basis());
    assert.match(out, /theme: base/);
    assert.match(out, /layout: dagre/);
    assert.ok(!/title:/.test(out));
  });

  test("Kanten stehen in Modell-Reihenfolge, Phaser-Kanten zuletzt", () => {
    const out = soll(basis());
    const i = (s: string) => out.indexOf(s);
    assert.ok(i("s_praesentation --> s_anwendung") < i("s_anwendung --> s_domaene"));
    assert.ok(i("s_anwendung --> s_domaene") < i("s_praesentation -.-> x_phaser"));
  });
});

describe("Modell-Prüfung (Negativfälle)", () => {
  const wirft = (mut: (m: Modell) => void, muster: RegExp) => {
    const m = basis();
    mut(m);
    assert.throws(() => echt.pruefeModell(m), muster);
  };
  test("echtes Modell ist gültig", () => assert.doesNotThrow(() => echt.pruefeModell(echt.SCHICHT_MODELL)));
  test("unbekanntes darf-Ziel", () => wirft((m) => m.schichten[1].darf.push("nirgendwo"), /unbekanntes Ziel "nirgendwo"/));
  test("doppelte ID", () => wirft((m) => (m.schichten[1].id = "domaene"), /doppelte ID "domaene"/));
  test("keine Auffang-Schicht", () => wirft((m) => (m.schichten[2].muster = "^src/x"), /Auffang-Schicht.*gefunden: 0/));
  test("zwei Auffang-Schichten", () => wirft((m) => (m.schichten[1].muster = null), /Auffang-Schicht.*gefunden: 2/));
  test("reservierte ID end", () => wirft((m) => (m.schichten[1].id = "end"), /reservierte ID "end"/));
  test("ungültige ID", () => wirft((m) => (m.schichten[1].id = "Mit Leerzeichen"), /ungültige oder reservierte ID/));
  test('Anführungszeichen im Label', () => wirft((m) => (m.schichten[1].label = 'Ein "Label"'), /ungültiges Label/));
  test("darf ist keine Liste", () => wirft((m) => ((m.schichten[1] as { darf: unknown }).darf = "domaene"), /darf ist keine Liste/));
  test("ungültige Technik", () => wirft((m) => (m.schichten[0].technik = 'Phaser"DOM'), /ungültige Technik/));
  test("leeres Label", () => wirft((m) => (m.schichten[1].label = ""), /ungültiges Label/));
  test("spitze Klammern und Zeilenumbruch im Label", () => {
    wirft((m) => (m.schichten[1].label = "a<b"), /ungültiges Label/);
    wirft((m) => (m.schichten[1].label = "a>b"), /ungültiges Label/);
    wirft((m) => (m.schichten[1].label = "a\nb"),/ungültiges Label/);
  });
  test.each(['"', "<", ">", "\r", "\n"])("Technik mit unzulässigem Zeichen %j wirft", (z) =>
    wirft((m) => (m.schichten[0].technik = `Phaser${z}DOM`), /ungültige Technik bei "praesentation"/),
  );
  test.each(['"', "<", ">", "\r", "\n"])("Label mit unzulässigem Zeichen %j wirft", (z) =>
    wirft((m) => (m.schichten[1].label = `a${z}b`), /ungültiges Label bei "anwendung"/),
  );
  test("verbotsRegeln prüft das Modell zuerst (fail-closed)", () => {
    const m = basis();
    m.schichten[1].darf.push("nirgendwo");
    assert.throws(() => echt.verbotsRegeln(m), /unbekanntes Ziel "nirgendwo"/);
    assert.ok(echt.verbotsRegeln(basis()).length > 0);
  });
  test("keine Schichten", () => assert.throws(() => echt.pruefeModell({ schichten: [], extern: [] }), /keine Schichten/));
  test("fehlende layers-Datei", () => {
    assert.throws(() => api.schichtenSollGenerator({ rootDir: fixture({}), config: cfg() }), /fehlt/);
  });
  test("layers-Datei ohne pruefeModell", () => {
    const root = fixture({ "scripts/layers.cjs": `module.exports = { SCHICHT_MODELL: ${JSON.stringify(basis())} };` });
    assert.throws(() => api.schichtenSollGenerator({ rootDir: root, config: cfg() }), /kein pruefeModell/);
  });
  test("layers-Datei mit kaputtem Modell wirft die Modell-Prüfung", () => {
    const kaputt = basis();
    kaputt.schichten[1].darf.push("nirgendwo");
    assert.throws(() => api.schichtenSollGenerator({ rootDir: fixtureMitModell(kaputt), config: cfg() }), /unbekanntes Ziel/);
  });
  test("layers-Datei ohne SCHICHT_MODELL", () => {
    const root = fixture({ "scripts/layers.cjs": "module.exports = {};" });
    assert.throws(() => api.schichtenSollGenerator({ rootDir: root, config: cfg() }), /kein SCHICHT_MODELL/);
  });
  test("Config ohne Block schichten", () => {
    assert.throws(() => api.schichtenSollGenerator({ rootDir: fixtureMitModell(basis()), config: {} }), /Block "schichten"/);
  });
});

describe("Ist-Kanten (Verdichtung)", () => {
  const m = basis();
  test("Kanten innerhalb einer Schicht, .d.ts-Quellen, Assets und fremde Pakete fallen weg", () => {
    const k = api.istKanten(
      cruiseJson({
        "src/ui/": ["src/ui.ts", "src/game/", "node_modules/phaser/", "node_modules/vite/", "assets/pixellab/x.png"],
        "src/game.ts": ["src/sim/", "src/game/"],
        "src/vite-env.d.ts": ["src/ui/"],
        "src/sim/": ["src/sim/"],
      }),
      m,
    );
    assert.deepEqual(k, [
      ["praesentation", "anwendung"],
      ["praesentation", "phaser"],
      ["anwendung", "domaene"],
    ]);
  });
  test("Collapse-Pfade mit Schrägstrich am Ende und Backslash-Pfade werden eingeordnet", () => {
    assert.equal(api.schichtVon("src/ui/", m), "praesentation");
    assert.equal(api.schichtVon("src\\game\\x.ts", m), "anwendung");
    assert.equal(api.schichtVon("src/uieval.ts", m), "domaene");
    assert.equal(api.schichtVon("node_modules\\phaser\\", m), "phaser");
    assert.equal(api.schichtVon("node_modules/vite/", m), null);
  });
  test("eine Kante außerhalb des Solls wirft mit Hinweis auf check:arch", () => {
    assert.throws(() => api.istKanten(cruiseJson({ "src/sim/": ["src/game/"] }), m), /domaene → anwendung.*check:arch/);
    assert.throws(() => api.istKanten(cruiseJson({ "src/game/": ["node_modules/phaser/"] }), m), /anwendung → phaser/);
  });
  test("Extern-Quellen (Phaser) werden nicht als Quelle ausgewertet", () => {
    assert.deepEqual(api.istKanten(cruiseJson({ "node_modules/phaser/": ["src/sim/"] }), m), []);
  });
  test("leeres oder fehlendes modules ergibt keine Kanten", () => {
    assert.deepEqual(api.istKanten({}, m), []);
  });
  test("ungenutzte Richtungen: Liste bzw. alle N", () => {
    const s = api.sollKanten(m);
    assert.equal(api.ungenutztZeile(m, s, s), "Alle 4 erlaubten Richtungen sind genutzt.");
    const ist = s.filter(([v, n]) => !(v === "praesentation" && n === "phaser"));
    assert.equal(api.ungenutztZeile(m, s, ist), "Erlaubt, aber ungenutzt: Präsentation → Phaser.");
  });
  test("Ist-Diagramm zeigt nur genutzte Kanten", () => {
    const out = api.renderDiagramm(m, [["anwendung", "domaene"]]);
    assert.ok(out.includes("s_anwendung --> s_domaene"));
    assert.ok(!out.includes("s_praesentation -->"));
  });
});

describe("Ist-Generator (dependency-cruiser als Prozess)", () => {
  const skript = (body: string) => ({ "fake.mjs": body });
  const gen = (body: string) => api.schichtenIstGenerator({ rootDir: fixtureMitModell(basis(), skript(body)), config: cfg({ cruise: ["fake.mjs"] }) });
  test("JSON auf stdout ergibt Diagramm samt Zeile zu ungenutzten Richtungen", () => {
    const json = JSON.stringify(cruiseJson({ "src/game/": ["src/sim/"] }));
    const out = gen(`process.stdout.write(${JSON.stringify(json)});`);
    assert.match(out, /s_anwendung --> s_domaene/);
    assert.match(out, /Erlaubt, aber ungenutzt: Präsentation → Anwendung/);
  });
  test("Exit-Code ungleich 0 wirft mit Hinweis auf check:arch", () => {
    assert.throws(() => gen("process.exit(2);"), /check:arch grün/);
  });
  test("kaputtes JSON wirft", () => {
    assert.throws(() => gen('process.stdout.write("{kaputt");'), /kein gültiges JSON/);
  });
  test("Ist-Kante außerhalb des Solls wirft", () => {
    const json = JSON.stringify(cruiseJson({ "src/sim/": ["src/ui/"] }));
    assert.throws(() => gen(`process.stdout.write(${JSON.stringify(json)});`), /außerhalb des Solls/);
  });
  test("ohne cruise-Argumente wirft", () => {
    assert.throws(() => api.schichtenIstGenerator({ rootDir: fixtureMitModell(basis()), config: cfg() }), /schichten\.cruise/);
  });
});

describe("Bindung an die echte Schicht-Zuordnung", () => {
  const srcFiles = (): string[] => {
    const out: string[] = [];
    const walk = (rel: string) => {
      for (const e of readdirSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)), { withFileTypes: true })) {
        if (e.isDirectory()) walk(`${rel}/${e.name}`);
        else if (e.isFile() && e.name.endsWith(".ts")) out.push(`${rel}/${e.name}`);
      }
    };
    walk("src");
    return out;
  };
  test("schichtVon stimmt für jede src-Datei mit layerOf überein", () => {
    const files = srcFiles();
    assert.ok(files.length > 100);
    for (const f of files) assert.equal(api.schichtVon(f, echt.SCHICHT_MODELL), echt.layerOf(f), f);
  });
  test("ladeModell lädt das echte Modell relativ zu rootDir", () => {
    assert.deepEqual(api.ladeModell(process.cwd(), "scripts/layers.cjs"), echt.SCHICHT_MODELL);
  });
});

/* Generatoren `quest-graph` und `quests-je-thema` (#1370): Regionen-/Quest-Graph und Quest-Zahlen aus den
 * Content-Daten. Läuft gegen ein Fixture-Root (Regionen, Quests, Standplätze); jeder Rot-Fall ist ein eigener
 * Test, dazu der Bindungstest gegen den echten Loader und die Marker-Präsenz in der Repo-Doku. */
import { describe, test } from "vitest";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fixture } from "./support/tmp-fixture";
import { KQContent } from "../src/content";

// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as qm from "../scripts/docs-gen/quests.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as gen from "../scripts/docs-gen.mjs";

type Cfg = Record<string, unknown>;
type Ctx = { rootDir: string; config: Cfg };
type Daten = { quests: { id: string; region: string }[]; regionen: { map: string }[] };
const api = qm as unknown as {
  ladeQuestDaten: (root: string, cfg: unknown) => Daten;
  questGraphGenerator: (c: Ctx) => string;
  questsJeThemaGenerator: (c: Ctx) => string;
};
const loadConfig = (gen as unknown as { loadConfig: (root: string) => Cfg }).loadConfig;

const config: Cfg = {
  quests: { ordner: "d/quests", reihenfolge: "d/quest-order.json", themen: "d/quest-topics.json", standplaetze: "d/entities.json", npcs: "d/npcs.json" },
};
type Q = { id: string; title: string; giver: string; topic: string; requires?: string[] };
const q = (id: string, giver: string, extra: Partial<Q> = {}): Q => ({ id, title: `Titel ${id}`, giver, topic: "t1", ...extra });
const json = (v: unknown) => JSON.stringify(v);

const BASIS = {
  "d/quests/ole.json": json([q("a-eins", "ole", { title: 'Erste "Quest" #1 <b> & Co' }), q("b-zwei", "ole")]),
  "d/quests/runa.json": json([q("c-drei", "runa", { topic: "t2", requires: ["a-eins"] })]),
  "d/quest-order.json": json(["a-eins", "c-drei", "b-zwei"]),
  "d/entities.json": json({ npcs: [{ id: "ole", map: "harbor" }, { id: "runa", map: "werft" }] }),
  "d/npcs.json": json({ ole: { name: "Ole" }, runa: { name: "Runa" } }),
  "d/quest-topics.json": json([{ id: "t1", label: "Eins" }, { id: "t2", label: "Zwei | Pipe" }]),
};
const mit = (extra: Record<string, string>): Record<string, string> => ({ ...BASIS, ...extra });
const graph = (files: Record<string, string>) => api.questGraphGenerator({ rootDir: fixture(files), config });
const thema = (files: Record<string, string>) => api.questsJeThemaGenerator({ rootDir: fixture(files), config });

describe("quest-graph: Ausgabe", () => {
  test("je Region ein Abschnitt mit Knoten je Quest, Lernpfad-Kanten und Stubs", () => {
    const out = graph(mit({}));
    assert.match(out, /### Region `harbor`/);
    assert.match(out, /### Region `werft`/);
    assert.match(out, /2 Quests · Geber: Ole/);
    assert.match(out, /1 Quest · Geber: Runa/);
    assert.match(out, /q_a_eins\[".*<br\/>Ole"\]/);
    assert.match(out, /aus_harbor\(\["aus harbor"\]\)/);
    assert.match(out, /aus_harbor --> q_c_drei/);
    assert.match(out, /nach_harbor\(\["weiter nach harbor"\]\)/);
    assert.match(out, /q_c_drei --> nach_harbor/);
    assert.match(out, /aus_werft --> q_b_zwei/);
  });
  test("Überblick: Regionen-Knoten, Start, Übergänge, requires über die Regionsgrenze gestrichelt", () => {
    const out = graph(mit({}));
    assert.match(out, /r_harbor\["harbor<br\/>2 Quests · Ole"\]/);
    assert.match(out, /start --> r_harbor/);
    assert.match(out, /r_harbor --> r_werft/);
    assert.match(out, /r_werft --> r_harbor/);
    assert.match(out, /r_harbor -\. requires \.-> r_werft/);
    assert.match(out, /ext_q_a_eins\(\["Erste #quot;Quest#quot; #35;1 #lt;b#gt; #amp; Co \(harbor\)"\]\)/);
    assert.match(out, /ext_q_a_eins -\. requires \.-> q_c_drei/);
  });
  test("Titel mit Anführungszeichen, #, <, > und & sind escaped (kein Roh-Zeichen im Label)", () => {
    const out = graph(mit({}));
    assert.match(out, /Erste #quot;Quest#quot; #35;1 #lt;b#gt; #amp; Co<br\/>Ole/);
    assert.ok(!out.includes('"Quest"'), "rohe Anführungszeichen würden das Label brechen");
  });
  test("mehrere Übergänge zwischen denselben Regionen werden zusammengefasst (Label k×)", () => {
    const files = mit({
      "d/quests/ole.json": json([q("a", "ole"), q("b", "ole"), q("d", "ole")]),
      "d/quests/runa.json": json([q("c", "runa", { topic: "t2" }), q("e", "runa", { topic: "t2" })]),
      "d/quest-order.json": json(["a", "c", "b", "e", "d"]),
    });
    const out = graph(files);
    assert.match(out, /r_harbor -->\|"2×"\| r_werft/);
    assert.match(out, /r_werft -->\|"2×"\| r_harbor/);
  });
  test("neue Region erscheint, gelöschte verschwindet samt ihrer Kanten", () => {
    const neu = mit({
      "d/quests/bo.json": json([q("x-neu", "bo")]),
      "d/quest-order.json": json(["a-eins", "c-drei", "b-zwei", "x-neu"]),
      "d/entities.json": json({ npcs: [{ id: "ole", map: "harbor" }, { id: "runa", map: "werft" }, { id: "bo", map: "insel" }] }),
      "d/npcs.json": json({ ole: { name: "Ole" }, runa: { name: "Runa" }, bo: { name: "Bo" } }),
    });
    const mitInsel = graph(neu);
    assert.match(mitInsel, /### Region `insel`/);
    assert.match(mitInsel, /r_insel\["insel<br\/>1 Quest · Bo"\]/);
    const ohne = graph(mit({ "d/quests/runa.json": json([]), "d/quest-order.json": json(["a-eins", "b-zwei"]) }));
    assert.ok(!ohne.includes("werft") && !ohne.includes("c_drei"));
    assert.match(ohne, /q_a_eins --> q_b_zwei/, "Kette ist neu verbunden");
  });
  test("deterministisch: Datei-Aufteilung und JSON-Schlüsselreihenfolge ändern nichts", () => {
    const a = graph(mit({}));
    const umgebaut = mit({
      "d/quests/a-alles.json": json([q("c-drei", "runa", { topic: "t2", requires: ["a-eins"] }), q("b-zwei", "ole")]),
      "d/quests/z-rest.json": json([{ topic: "t1", giver: "ole", title: 'Erste "Quest" #1 <b> & Co', id: "a-eins" }]),
    });
    delete (umgebaut as Record<string, string | undefined>)["d/quests/ole.json"];
    delete (umgebaut as Record<string, string | undefined>)["d/quests/runa.json"];
    assert.equal(graph(umgebaut), a);
    assert.equal(graph(mit({})), a);
  });
});

describe("quest-graph: rot", () => {
  const rot = (files: Record<string, string>, muster: RegExp) => assert.throws(() => graph(files), muster);
  test("Quest fehlt in quest-order.json", () => {
    rot(mit({ "d/quest-order.json": json(["a-eins", "c-drei"]) }), /Quest "b-zwei" fehlt in d\/quest-order\.json/);
  });
  test("unbekannte oder doppelte ID in der Reihenfolge", () => {
    rot(mit({ "d/quest-order.json": json(["a-eins", "c-drei", "b-zwei", "geist"]) }), /unbekannte Quest-ID "geist"/);
    rot(mit({ "d/quest-order.json": json(["a-eins", "c-drei", "b-zwei", "a-eins"]) }), /"a-eins" steht doppelt/);
  });
  test("doppelte Quest-ID in den Quest-Dateien", () => {
    rot(mit({ "d/quests/bo.json": json([q("a-eins", "ole")]) }), /Quest-ID "a-eins" kommt doppelt vor/);
  });
  test("Geber ohne Standplatz oder ohne Namen", () => {
    rot(mit({ "d/entities.json": json({ npcs: [{ id: "ole", map: "harbor" }] }) }), /Geber "runa" hat keinen Standplatz/);
    rot(mit({ "d/npcs.json": json({ ole: { name: "Ole" } }) }), /Geber "runa" hat keinen Namen/);
  });
  test("unbekanntes requires und unbekanntes Thema", () => {
    rot(mit({ "d/quests/runa.json": json([q("c-drei", "runa", { topic: "t2", requires: ["nix"] })]) }), /requires verweist auf unbekannte Quest "nix"/);
    rot(mit({ "d/quests/runa.json": json([q("c-drei", "runa", { topic: "t9" })]) }), /unbekanntes Thema "t9"/);
  });
  test("Kollision der Mermaid-Bezeichner (a-b und a_b)", () => {
    rot(
      mit({
        "d/quests/ole.json": json([q("a-b", "ole"), q("a_b", "ole")]),
        "d/quests/runa.json": json([]),
        "d/quest-order.json": json(["a-b", "a_b"]),
      }),
      /Mermaid-Bezeichner "q_a_b" kollidiert/,
    );
  });
  test("fehlende Pfade, kaputtes JSON, fehlende Config und kein Inhalt", () => {
    rot({ ...BASIS, "d/quests/ole.json": "{" }, /kein gültiges JSON/);
    rot({ ...BASIS, "d/quests/ole.json": json({}) }, /muss ein Array von Quests sein/);
    rot({ ...BASIS, "d/quests/ole.json": json([{ id: "x" }]) }, /title fehlt/);
    rot({ ...BASIS, "d/quests/ole.json": json([q("a-eins", "ole", { requires: "x" as unknown as string[] })]) }, /requires muss eine Liste/);
    rot({ "d/quest-order.json": "[]" }, /Quest-Ordner d\/quests nicht gefunden/);
    assert.throws(() => api.questGraphGenerator({ rootDir: fixture(BASIS), config: { quests: {} } }), /config\.quests\.ordner fehlt/);
    const leer = { ...mit({ "d/quests/ole.json": json([]), "d/quests/runa.json": json([]), "d/quest-order.json": "[]" }) };
    rot(leer, /keine Quests gefunden/);
  });
});

describe("quest-graph: weitere Kanten, Zerlegung und Deckel", () => {
  test("requires innerhalb einer Region ist eine gestrichelte Kante im Regionsdiagramm", () => {
    const out = graph(mit({ "d/quests/ole.json": json([q("a-eins", "ole"), q("b-zwei", "ole", { requires: ["a-eins"] })]) }));
    assert.match(out, /\n {2}q_a_eins -\. requires \.-> q_b_zwei/);
  });
  test("Überblick: mehrere requires zwischen denselben Regionen ergeben genau eine gestrichelte Kante", () => {
    const out = graph(
      mit({ "d/quests/runa.json": json([q("c-drei", "runa", { topic: "t2", requires: ["a-eins"] }), q("e-vier", "runa", { topic: "t2", requires: ["b-zwei"] })]), "d/quest-order.json": json(["a-eins", "c-drei", "e-vier", "b-zwei"]) }),
    );
    assert.equal(out.split("r_harbor -. requires .-> r_werft").length - 1, 1);
  });
  test("Kollision der Regions-Bezeichner (Karten a-b und a_b) ist rot", () => {
    assert.throws(
      () =>
        graph(
          mit({
            "d/entities.json": json({ npcs: [{ id: "ole", map: "a-b" }, { id: "runa", map: "a_b" }] }),
          }),
        ),
      /Mermaid-Bezeichner "r_a_b" kollidiert/,
    );
  });
  test("ein NPC auf zwei Karten macht die Region unbestimmt: rot", () => {
    assert.throws(
      () => graph(mit({ "d/entities.json": json({ npcs: [{ id: "ole", map: "harbor" }, { id: "ole", map: "insel" }, { id: "runa", map: "werft" }] }) })),
      /NPC "ole" hat mehrere Standplätze/,
    );
  });
  test("große Region wird in Teile zerlegt, Teile sind über Stubs verbunden", () => {
    const files = mit({
      "d/quests/ole.json": json([q("a", "ole"), q("b", "ole"), q("c", "ole")]),
      "d/quests/runa.json": json([]),
      "d/quest-order.json": json(["a", "b", "c"]),
    });
    const c = { quests: { ...(config.quests as object), maxQuestsJeDiagramm: 2 } };
    const out = api.questGraphGenerator({ rootDir: fixture(files), config: c });
    assert.match(out, /#### Teil 1 von 2 \(2 Quests\)/);
    assert.match(out, /#### Teil 2 von 2 \(1 Quest\)/);
    assert.match(out, /weiter nach harbor, Teil 2/);
    assert.match(out, /aus harbor, Teil 1/);
    assert.ok(!graph(files).includes("Teil 1 von"), "unter dem Deckel bleibt es ein Diagramm");
  });
  test("Diagramm über dem Zeichen-Deckel ist rot statt still unlesbar", () => {
    const lang = mit({ "d/quests/ole.json": json([q("a-eins", "ole", { title: "x".repeat(41000) }), q("b-zwei", "ole")]) });
    assert.throws(() => graph(lang), /Deckel 40000/);
  });
  test("quest-order.json oder quest-topics.json kein Array: rot mit sprechender Meldung", () => {
    assert.throws(() => graph(mit({ "d/quest-order.json": "{}" })), /muss ein Array von Quest-IDs sein/);
    assert.throws(() => graph(mit({ "d/quest-topics.json": "{}" })), /muss ein Array sein/);
  });
});

describe("quests-je-thema", () => {
  test("Zählung je Thema in Themen-Reihenfolge, Geber, Gesamtzeile; Pipe in Label escaped", () => {
    const out = thema(mit({}));
    const zeilen = out.split("\n");
    assert.equal(zeilen[0], "| Thema | Quests | Geber |");
    assert.equal(zeilen[2], "| Eins | 2 | Ole |");
    assert.equal(zeilen[3], "| Zwei \\| Pipe | 1 | Runa |");
    assert.equal(zeilen[4], "| **Gesamt** | **3** |  |");
  });
  test("Thema ohne Quests zeigt 0; neue Quest erhöht, gelöschte senkt die Zahl", () => {
    const leer = thema(mit({ "d/quest-topics.json": json([{ id: "t1", label: "Eins" }, { id: "t2", label: "Zwei" }, { id: "t3", label: "Leer" }]) }));
    assert.match(leer, /\| Leer \| 0 \| – \|/);
    const mehr = thema(mit({ "d/quests/ole.json": json([q("a-eins", "ole"), q("b-zwei", "ole"), q("n", "ole")]), "d/quest-order.json": json(["a-eins", "c-drei", "b-zwei", "n"]) }));
    assert.match(mehr, /\| Eins \| 3 \| Ole \|/);
    const weniger = thema(mit({ "d/quests/ole.json": json([q("a-eins", "ole")]), "d/quest-order.json": json(["a-eins", "c-drei"]) }));
    assert.match(weniger, /\| Eins \| 1 \| Ole \|/);
    assert.match(weniger, /\*\*2\*\*/);
  });
  test("deterministisch", () => {
    assert.equal(thema(mit({})), thema(mit({})));
  });
});

describe("Bindung an den echten Content", () => {
  test("ladeQuestDaten liefert dieselben Quests in derselben Reihenfolge wie der Loader", () => {
    const config = loadConfig(process.cwd()) as { quests: unknown };
    const daten = api.ladeQuestDaten(process.cwd(), config.quests);
    assert.deepEqual(
      daten.quests.map((x) => x.id),
      KQContent.QUESTS.map((x) => x.id),
    );
  });
  test("jede Region der Daten steht als Überschrift in der generierten Seite", () => {
    const config = loadConfig(process.cwd());
    const daten = api.ladeQuestDaten(process.cwd(), config.quests);
    const out = api.questGraphGenerator({ rootDir: process.cwd(), config });
    for (const r of daten.regionen) assert.ok(out.includes(`### Region \`${r.map}\``), r.map);
  });
});

describe("Marker in der Repo-Doku", () => {
  // Die Engine bemerkt einen gelöschten Marker nicht (es gäbe nichts zu vergleichen): hier wird er festgenagelt.
  const marker: [string, string][] = [
    ["docs/module/app.md", "save-versionen"],
    ["docs/module/content-questgraph.md", "quest-graph"],
    ["README.md", "quests-je-thema"],
  ];
  for (const [datei, name] of marker) {
    test(`${datei} enthält GEN:${name}`, () => {
      const text = readFileSync(datei, "utf8");
      assert.ok(text.includes(`<!-- GEN:${name} START -->`) && text.includes(`<!-- GEN:${name} END -->`));
    });
  }
});

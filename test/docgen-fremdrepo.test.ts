/* docs-gen ist projektneutral (#1373): ein Mini-Repo, das nicht Kubernia ist (Python „wetterdienst“, kein
 * package.json, kein src/), läuft durch denselben Kern (Engine, ADR-Liste, Zeitleiste, Schichten Soll/Ist)
 * mit eigener Config, eigener Schicht-Definition, eigenem Import-Adapter und eigener Registry. Dazu ein
 * Import-Wächter: der übertragbare Kern importiert nichts aus dem Kubernia- oder Harness-Stack.
 * Das Fixture entsteht im Temp-Ordner (test/support/tmp-fixture.ts), nichts davon liegt im Repo.
 */
import { describe, test } from "vitest";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fixture } from "./support/tmp-fixture";

// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as docsGen from "../scripts/docs-gen.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as adr from "../scripts/docs-gen/adr.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as zeit from "../scripts/docs-gen/zeitleiste.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as schichten from "../scripts/docs-gen/schichten.mjs";

type Gen = Record<string, (ctx: { rootDir: string; config: Record<string, unknown> }) => string>;
const cli = (docsGen as unknown as { cli: (argv: string[], o: { rootDir: string; generators: Gen; out: (s: string) => void; err: (s: string) => void }) => number }).cli;

/** Eigene Registry des Fremd-Repos: nur Kern-Generatoren, kein Harness-Stack, kein Spiel. */
const generators: Gen = {
  "adr-liste": (adr as unknown as { adrListeGenerator: Gen[string] }).adrListeGenerator,
  zeitleiste: (zeit as unknown as { zeitleisteGenerator: Gen[string] }).zeitleisteGenerator,
  "schichten-soll": (schichten as unknown as { schichtenSollGenerator: Gen[string] }).schichtenSollGenerator,
  "schichten-ist": (schichten as unknown as { schichtenIstGenerator: Gen[string] }).schichtenIstGenerator,
};

const MODELL = {
  quellwurzel: "wetter/",
  schichten: [
    { id: "api", label: "Schnittstelle", wurzeln: ["api"], muster: "^wetter/api(\\.py$|/)", darf: ["dienste", "modell"] },
    { id: "dienste", label: "Dienste", wurzeln: ["dienste"], muster: "^wetter/dienste(\\.py$|/)", darf: ["modell", "httpx"] },
    { id: "modell", label: "Modell", wurzeln: [], muster: null, darf: [] },
  ],
  extern: [{ id: "httpx", label: "httpx", muster: "^site-packages/httpx/" }],
};
const PRUEFER_MINI = `function (m) { if (typeof m.quellwurzel !== "string" || !m.quellwurzel.endsWith("/")) throw new Error("quellwurzel fehlt"); }`;
const layersDatei = (modell: unknown, pruefer = PRUEFER_MINI) => `module.exports = { SCHICHT_MODELL: ${JSON.stringify(modell)}, pruefeModell: ${pruefer} };\n`;

/** Import-Adapter für Python: liest wetter/**.py und gibt die Form von dependency-cruiser aus. */
const IMPORTGRAPH = `
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
const walk = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(d, e.name)) : e.name.endsWith(".py") ? [join(d, e.name).split("\\\\").join("/")] : []));
function aufloesen(mod) {
  const teile = mod.split(".");
  if (teile[0] !== "wetter") return "site-packages/" + teile[0] + "/";
  for (let n = teile.length; n > 1; n--) {
    const p = teile.slice(0, n).join("/");
    if (existsSync(p + ".py")) return p + ".py";
    if (existsSync(p)) return p + "/";
  }
  return "wetter/";
}
const modules = walk("wetter").map((source) => {
  const dependencies = [];
  for (const m of readFileSync(source, "utf8").matchAll(/^\\s*(?:from\\s+([\\w.]+)\\s+import\\s+(.+)|import\\s+([\\w.]+))/gm)) {
    if (m[3]) dependencies.push({ resolved: aufloesen(m[3]) });
    else for (const name of m[2].split(",")) dependencies.push({ resolved: aufloesen(m[1] + "." + name.trim()) });
  }
  return { source, dependencies };
});
process.stdout.write(JSON.stringify({ modules }));
`;

const README = `# Wetterdienst

## Entscheidungen

<!-- GEN:adr-liste START -->
<!-- GEN:adr-liste END -->

## Zeitleiste

<!-- GEN:zeitleiste START -->
<!-- GEN:zeitleiste END -->

## Schichten

<!-- GEN:schichten-soll START -->
<!-- GEN:schichten-soll END -->

<!-- GEN:schichten-ist START -->
<!-- GEN:schichten-ist END -->
`;
const adrDatei = (nr: string, titel: string, datum: string) => `# ADR ${nr}: ${titel}\n\n> Status: **akzeptiert** · Datum: ${datum}\n\n## Kontext\n\nText.\n`;

const mini = (extra: Record<string, string> = {}): Record<string, string> => ({
  "wetter/api/routen.py": "from wetter.dienste import vorhersage\nfrom wetter.modell import Ort\n",
  "wetter/dienste/vorhersage.py": "import httpx\nfrom wetter.modell import Ort\n",
  "wetter/modell.py": "class Ort:\n    pass\n",
  "docs/adr/0001-zeitzonen-utc.md": adrDatei("0001", "Zeitzonen immer in UTC", "2026-03-01"),
  "docs/adr/0002-httpx-als-client.md": adrDatei("0002", "httpx als HTTP-Client", "2026-03-15"),
  "docs/meilensteine.json": JSON.stringify({ meilensteine: [{ datum: "2026-03-10", text: "Erste Vorhersage live" }] }),
  "werkzeug/schichten.cjs": layersDatei(MODELL),
  "werkzeug/importgraph.mjs": IMPORTGRAPH,
  "werkzeug/docs-gen.json": JSON.stringify({
    markdown: ["README.md"],
    befehl: "make docs",
    adr: { ordner: "docs/adr" },
    zeitleiste: { meilensteine: "docs/meilensteine.json" },
    schichten: { layers: "werkzeug/schichten.cjs", cruise: ["werkzeug/importgraph.mjs"] },
  }),
  "README.md": README,
  ...extra,
});

const lauf = (root: string, ...argv: string[]) => {
  const out: string[] = [];
  const err: string[] = [];
  const code = cli(["--config", "werkzeug/docs-gen.json", ...argv], { rootDir: root, generators, out: (s) => out.push(s), err: (s) => err.push(s) });
  return { code, out: out.join("\n"), err: err.join("\n") };
};
const readme = (root: string) => readFileSync(join(root, "README.md"), "utf8");

describe("docs-gen auf einem Fremd-Repo (Python, nicht Kubernia)", () => {
  test("schreiben, danach ist der Prüflauf grün", () => {
    const root = fixture(mini());
    const w = lauf(root, "--write");
    assert.equal(w.code, 0, w.err);
    assert.match(w.out, /geschrieben: README\.md/);
    const c = lauf(root);
    assert.equal(c.code, 0, c.err);
    assert.match(c.out, /aktuell/);
  });

  test("die Ausgabe trägt das Fremd-Repo, nichts von Kubernia", () => {
    const root = fixture(mini());
    lauf(root, "--write");
    const t = readme(root);
    assert.match(t, /alles übrige unter wetter\//);
    assert.match(t, /Zeitzonen immer in UTC/);
    assert.match(t, /Erste Vorhersage live/);
    assert.match(t, /s_api --> s_dienste/);
    assert.match(t, /s_api --> s_modell/);
    assert.match(t, /s_dienste --> s_modell/);
    assert.match(t, /Alle 4 erlaubten Richtungen sind genutzt/);
    assert.match(t, /s_dienste -\.-> x_httpx/);
    assert.match(t, /Generiert von make docs/);
    for (const fremd of ["src/", "Phaser", "Kubernia", "npm run"]) assert.ok(!t.includes(fremd), `"${fremd}" darf im Fremd-Repo nicht auftauchen`);
  });

  test("ein neues ADR macht den Prüflauf rot, mit dem Befehl aus der Config; die Datei bleibt unverändert", () => {
    const root = fixture(mini());
    lauf(root, "--write");
    const vorher = readme(root);
    const stale = fixture({ ...mini({ "README.md": vorher }), "docs/adr/0003-neu.md": adrDatei("0003", "Neues ADR", "2026-04-01") });
    const c = lauf(stale);
    assert.equal(c.code, 1);
    assert.match(c.err, /veraltet/);
    assert.match(c.err, /Fix: make docs/);
    assert.doesNotMatch(c.err, /npm run/);
    assert.equal(readme(stale), vorher);
  });

  test("ein verbotener Import (Modell → Schnittstelle) in einer .py-Datei macht den Lauf rot", () => {
    const root = fixture(mini({ "wetter/modell.py": "from wetter.api import routen\nclass Ort:\n    pass\n" }));
    const c = lauf(root, "--write");
    assert.equal(c.code, 1);
    assert.match(c.err, /außerhalb des Solls/);
    assert.match(c.err, /modell → api/);
    assert.doesNotMatch(c.err, /npm run|check:arch/);
    assert.equal(readme(root), README, "fail-closed: nichts geschrieben");
  });

  test("eine Schicht-Definition ohne Quellwurzel macht den Lauf rot, auch mit einem Prüfer, der nichts prüft", () => {
    const ohne: Record<string, unknown> = { ...MODELL };
    delete ohne.quellwurzel;
    const root = fixture(mini({ "werkzeug/schichten.cjs": layersDatei(ohne, "function () {}") }));
    const c = lauf(root, "--write");
    assert.equal(c.code, 1);
    assert.match(c.err, /quellwurzel/);
    assert.equal(readme(root), README);
  });
});

describe("Kern-Schnitt: übertragbare Module importieren keinen Harness-Stack", () => {
  // Bekannte Grenze: erkannt werden statische `import`/`export … from`, `import("…")`, `require("…")` und `createRequire(…)("…")` mit
  // einfachen oder doppelten Anführungszeichen (#1428 Z12). Nicht erkannt: ein dynamischer Pfad (z.B. die Layers-Datei, die schichten.mjs
  // aus der Config lädt, bleibt erlaubt) und ein `createRequire`-Ergebnis, das erst in einer Variablen steht.
  const KERN = ["markdown", "adr", "zeitleiste", "schichten"];
  const importeAus = (text: string): string[] => [
    ...[...text.matchAll(/^\s*(?:import|export)\s+(?:[^;]*?\sfrom\s+)?["']([^"']+)["']/gm)].map((m) => m[1]),
    ...[...text.matchAll(/\bimport\(\s*["']([^"']+)["']\s*\)/g)].map((m) => m[1]),
    ...[...text.matchAll(/\brequire\(\s*["']([^"']+)["']\s*\)/g)].map((m) => m[1]),
    ...[...text.matchAll(/\bcreateRequire\([^)]*\)\(\s*["']([^"']+)["']\s*\)/g)].map((m) => m[1]),
  ];
  const importe = (rel: string): string[] => importeAus(readFileSync(join(__dirname, "..", rel), "utf8"));
  test.each(KERN)("scripts/docs-gen/%s.mjs: nur node:* und Kern-Module", (name) => {
    for (const spec of importe(`scripts/docs-gen/${name}.mjs`)) {
      const ok = spec.startsWith("node:") || KERN.some((k) => spec === `./${k}.mjs`);
      assert.ok(ok, `${name}.mjs importiert ${spec} (kein Kern-Modul)`);
    }
  });
  test("scripts/docs-gen.mjs: nur node:*, markdown.mjs und der Tauschpunkt registry.mjs", () => {
    for (const spec of importe("scripts/docs-gen.mjs")) {
      const ok = spec.startsWith("node:") || spec === "./docs-gen/markdown.mjs" || spec === "./docs-gen/registry.mjs";
      assert.ok(ok, `docs-gen.mjs importiert ${spec}`);
    }
  });
  test("der Wächter erkennt Fremd-Importe in allen unterstützten Formen (Negativfall)", () => {
    const fremd = ['import { x } from "./quests.mjs";', "import { x } from './quests.mjs';", 'import "./quests.mjs";', 'export { x } from "./quests.mjs";', 'const m = await import("./quests.mjs");'];
    for (const zeile of fremd) assert.deepEqual(importeAus(zeile), ["./quests.mjs"], zeile);
    assert.deepEqual(importeAus('import { y } from "node:fs";'), ["node:fs"]);
  });
  test("der Wächter erkennt require und createRequire mit literalem Pfad; ein dynamischer Pfad bleibt erlaubt (#1428 Z12)", () => {
    assert.deepEqual(importeAus('const q = require("./quests.cjs");'), ["./quests.cjs"]);
    assert.deepEqual(importeAus("const q = require('./quests.cjs');"), ["./quests.cjs"]);
    assert.deepEqual(importeAus('const q = createRequire(import.meta.url)("./quests.cjs");'), ["./quests.cjs"]);
    assert.deepEqual(importeAus("const q = require(pfad);"), []);
    assert.deepEqual(importeAus("const q = createRequire(import.meta.url)(layersPfad);"), []);
  });
});

/* docs-gen ist projektneutral (#1373): ein Mini-Repo, das nicht das Ursprungsprojekt ist (Python „wetterdienst“, kein
 * package.json, kein src/), läuft durch denselben Kern (Engine, ADR-Liste, Zeitleiste, Schichten Soll/Ist)
 * mit eigener Config, eigener Schicht-Definition, eigenem Import-Adapter und eigener Registry (Kern-Registry plus
 * optional `generatoren` aus der Config, ADR 0022 F6). Dazu ein
 * Import-Wächter: die Module der Ring-`kern`-Ableitung importieren nichts außerhalb ihrer Import-Hülle (`node:*` und andere Kern-Module).
 * Das Fixture entsteht im Temp-Ordner (test/support/tmp-fixture.ts), nichts davon liegt im Repo.
 */
import { describe, test } from "vitest";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fixture } from "./support/tmp-fixture";
import { projektConfig, repoName } from "./support/fremd-config";
import { importeAus } from "./harness/hook-importe";

// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as docsGen from "../scripts/docs-gen.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as adr from "../scripts/docs-gen/adr.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as zeit from "../scripts/docs-gen/zeitleiste.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as schichten from "../scripts/docs-gen/schichten.mjs";

type Gen = Record<string, (ctx: { rootDir: string; config: Record<string, unknown> }) => string>;
const cli = (docsGen as unknown as { cli: (argv: string[], o: { rootDir: string; generators?: Gen; out: (s: string) => void; err: (s: string) => void }) => Promise<number> }).cli;

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
/** Die Schicht-Definition des Fremd-Repos liefert nur Daten; geprüft wird mit dem Kern (#1612). Ein mitgelieferter Prüfer (`pruefer`) wird ignoriert. */
const layersDatei = (modell: unknown, pruefer?: string) => `module.exports = { SCHICHT_MODELL: ${JSON.stringify(modell)}${pruefer ? `, pruefeModell: ${pruefer}` : ""} };\n`;

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

const CONFIG: Record<string, unknown> = {
  markdown: ["README.md"],
  befehl: "make docs",
  adr: { ordner: "docs/adr" },
  zeitleiste: { meilensteine: "docs/meilensteine.json" },
  schichten: { layers: "werkzeug/schichten.cjs", cruise: ["werkzeug/importgraph.mjs"] },
};
const mitConfig = (extra: Record<string, unknown>) => ({ "werkzeug/docs-gen.json": JSON.stringify({ ...CONFIG, ...extra }) });

const mini = (extra: Record<string, string> = {}): Record<string, string> => ({
  "wetter/api/routen.py": "from wetter.dienste import vorhersage\nfrom wetter.modell import Ort\n",
  "wetter/dienste/vorhersage.py": "import httpx\nfrom wetter.modell import Ort\n",
  "wetter/modell.py": "class Ort:\n    pass\n",
  "docs/adr/0001-zeitzonen-utc.md": adrDatei("0001", "Zeitzonen immer in UTC", "2026-03-01"),
  "docs/adr/0002-httpx-als-client.md": adrDatei("0002", "httpx als HTTP-Client", "2026-03-15"),
  "docs/meilensteine.json": JSON.stringify({ meilensteine: [{ datum: "2026-03-10", text: "Erste Vorhersage live" }] }),
  "werkzeug/schichten.cjs": layersDatei(MODELL),
  "werkzeug/importgraph.mjs": IMPORTGRAPH,
  "werkzeug/docs-gen.json": JSON.stringify(CONFIG),
  "README.md": README,
  ...extra,
});

const lauf = async (root: string, ...argv: string[]) => {
  const out: string[] = [];
  const err: string[] = [];
  const code = await cli(["--config", "werkzeug/docs-gen.json", ...argv], { rootDir: root, generators, out: (s) => out.push(s), err: (s) => err.push(s) });
  return { code, out: out.join("\n"), err: err.join("\n") };
};
/** Wie `lauf`, aber ohne eigene Registry: die Engine lädt Kern-Registry plus `config.generatoren` selbst (AK3 von #1710). */
const laufKern = async (root: string, ...argv: string[]) => {
  const out: string[] = [];
  const err: string[] = [];
  const code = await cli(["--config", "werkzeug/docs-gen.json", ...argv], { rootDir: root, out: (s) => out.push(s), err: (s) => err.push(s) });
  return { code, out: out.join("\n"), err: err.join("\n") };
};
const readme = (root: string) => readFileSync(join(root, "README.md"), "utf8");

describe("docs-gen auf einem Fremd-Repo (Python, nicht das Ursprungsprojekt)", () => {
  test("schreiben, danach ist der Prüflauf grün", async () => {
    const root = fixture(mini());
    const w = await lauf(root, "--write");
    assert.equal(w.code, 0, w.err);
    assert.match(w.out, /geschrieben: README\.md/);
    const c = await lauf(root);
    assert.equal(c.code, 0, c.err);
    assert.match(c.out, /aktuell/);
  });

  test("die Ausgabe trägt das Fremd-Repo, nichts vom Ursprungsprojekt", async () => {
    const root = fixture(mini());
    await lauf(root, "--write");
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
    for (const fremd of ["src/", "npm run"]) assert.ok(!t.includes(fremd), `"${fremd}" darf im Fremd-Repo nicht auftauchen`);
    const echt = projektConfig();
    for (const fremd of [repoName(echt), ...Object.values(echt.projektliterale ?? {})]) assert.ok(!t.toLowerCase().includes(fremd.toLowerCase()), `"${fremd}" darf im Fremd-Repo nicht auftauchen`);
  });

  test("ein neues ADR macht den Prüflauf rot, mit dem Befehl aus der Config; die Datei bleibt unverändert", async () => {
    const root = fixture(mini());
    await lauf(root, "--write");
    const vorher = readme(root);
    const stale = fixture({ ...mini({ "README.md": vorher }), "docs/adr/0003-neu.md": adrDatei("0003", "Neues ADR", "2026-04-01") });
    const c = await lauf(stale);
    assert.equal(c.code, 1);
    assert.match(c.err, /veraltet/);
    assert.match(c.err, /Fix: make docs/);
    assert.doesNotMatch(c.err, /npm run/);
    assert.equal(readme(stale), vorher);
  });

  test("ein verbotener Import (Modell → Schnittstelle) in einer .py-Datei macht den Lauf rot", async () => {
    const root = fixture(mini({ "wetter/modell.py": "from wetter.api import routen\nclass Ort:\n    pass\n" }));
    const c = await lauf(root, "--write");
    assert.equal(c.code, 1);
    assert.match(c.err, /außerhalb des Solls/);
    assert.match(c.err, /modell → api/);
    assert.doesNotMatch(c.err, /npm run|check:arch/);
    assert.equal(readme(root), README, "fail-closed: nichts geschrieben");
  });

  test("eine Schicht-Definition ohne Quellwurzel macht den Lauf rot, auch mit einem Prüfer, der nichts prüft", async () => {
    const ohne: Record<string, unknown> = { ...MODELL };
    delete ohne.quellwurzel;
    const root = fixture(mini({ "werkzeug/schichten.cjs": layersDatei(ohne, "function () {}") }));
    const c = await lauf(root, "--write");
    assert.equal(c.code, 1);
    assert.match(c.err, /quellwurzel/);
    assert.equal(readme(root), README);
  });
});

describe("docs-gen ohne eigene Registry: Kern plus config.generatoren (ADR 0022 F6, #1710)", () => {
  const SPIEL_MARKER = (name: string) => `\n<!-- GEN:${name} START -->\n<!-- GEN:${name} END -->\n`;
  const WETTER_GEN = 'export const wetterKarte = ({ rootDir, config }) => `Karte aus ${config.wetter.ort} (${rootDir.length > 0 ? "root" : ""})`;\n';

  test("ohne Spiel-Generatoren und ohne `generatoren` läuft docs-gen fehlerfrei (Schreiben, danach Prüflauf grün)", async () => {
    const root = fixture(mini());
    const w = await laufKern(root, "--write");
    assert.equal(w.code, 0, w.err);
    assert.match(w.out, /geschrieben: README\.md/);
    const c = await laufKern(root);
    assert.equal(c.code, 0, c.err);
    assert.match(c.out, /aktuell/);
  });

  test("ein Marker eines Spiel-Generators ohne Config-Eintrag ist ein Fehler (Exit 1, nichts geschrieben)", async () => {
    const root = fixture(mini({ "README.md": README + SPIEL_MARKER("quest-graph") }));
    const c = await laufKern(root, "--write");
    assert.equal(c.code, 1);
    assert.match(c.err, /unbekannter Generator "quest-graph"/);
    assert.equal(readme(root), README + SPIEL_MARKER("quest-graph"));
  });

  test("ein in der Config genannter, aber fehlender Generator bricht mit klarer Meldung ab (Marker, Pfad, `fehlt`)", async () => {
    const root = fixture(mini(mitConfig({ generatoren: { "wetter-karte": { datei: "werkzeug/fehlt.mjs", name: "wetterKarte" } } })));
    const c = await laufKern(root, "--write");
    assert.equal(c.code, 1);
    assert.match(c.err, /config\.generatoren\.wetter-karte/);
    assert.match(c.err, /werkzeug\/fehlt\.mjs/);
    assert.match(c.err, /fehlt/);
    assert.match(c.err, /Fix: config\.generatoren/);
    assert.equal(readme(root), README, "fail-closed: nichts geschrieben");
  });

  test("eine Datei ohne den genannten Export bricht mit klarer Meldung ab", async () => {
    const root = fixture(mini({ ...mitConfig({ generatoren: { "wetter-karte": { datei: "werkzeug/wetter-gen.mjs", name: "gibtsNicht" } } }), "werkzeug/wetter-gen.mjs": WETTER_GEN }));
    const c = await laufKern(root, "--write");
    assert.equal(c.code, 1);
    assert.match(c.err, /config\.generatoren\.wetter-karte: werkzeug\/wetter-gen\.mjs exportiert keine Funktion "gibtsNicht"/);
  });

  test("ein eigener Projekt-Generator wird aus der Config geladen und gerendert", async () => {
    const root = fixture(
      mini({
        ...mitConfig({ generatoren: { "wetter-karte": { datei: "werkzeug/wetter-gen.mjs", name: "wetterKarte" } }, wetter: { ort: "Hamburg" } }),
        "werkzeug/wetter-gen.mjs": WETTER_GEN,
        "README.md": README + SPIEL_MARKER("wetter-karte"),
      }),
    );
    const w = await laufKern(root, "--write");
    assert.equal(w.code, 0, w.err);
    assert.match(readme(root), /Karte aus Hamburg/);
    assert.equal((await laufKern(root)).code, 0);
  });
});

describe("Kern-Schnitt: Module der Ring-kern-Ableitung importieren nichts außerhalb ihrer Import-Hülle", () => {
  // Bekannte Grenze: erkannt werden statische `import`/`export … from`, `import("…")`, `require("…")` und `createRequire(…)("…")` mit
  // einfachen oder doppelten Anführungszeichen (#1428 Z12). Nicht erkannt: ein dynamischer Pfad (z.B. die Layers-Datei, die schichten.mjs
  // aus der Config lädt, bleibt erlaubt) und ein `createRequire`-Ergebnis, das erst in einer Variablen steht.
  // Die Kern-Module kommen aus dem Besitz-Manifest (Ring kern), nicht aus einer Handliste (kein Drift).
  const besitz = JSON.parse(readFileSync(join(__dirname, "..", ".factory/besitz.json"), "utf8")) as { eintraege: { pfad: string; ring: string }[] };
  const kernPfade = besitz.eintraege.filter((e) => e.ring === "kern").map((e) => e.pfad);
  const KERN = kernPfade.flatMap((p) => /^scripts\/docs-gen\/([\w-]+)\.mjs$/.exec(p)?.[1] ?? []);
  // Die CommonJS-Kern-Module (Schicht-Kern, #1612) darf schichten.mjs laden (relativer Spezifizierer aus scripts/docs-gen/).
  const KERN_CJS = kernPfade.flatMap((p) => (/^scripts\/[\w-]+\.cjs$/.test(p) ? `../${p.slice("scripts/".length)}` : []));
  // Die importfreie Kern-Konstanten-Lib neben docs-gen/ (skill-pfade.mjs) darf geladen werden.
  const KERN_SKRIPTE = kernPfade.includes("scripts/skill-pfade.mjs") ? ["../skill-pfade.mjs"] : [];
  test("die Ableitung aus dem Besitz-Manifest ist nicht leer und enthält den Schicht-Kern", () => {
    assert.ok(KERN.includes("schichten"), KERN.join());
    assert.ok(KERN_CJS.includes("../schichten-kern.cjs"), KERN_CJS.join());
  });
  const importe = (rel: string): string[] => importeAus(readFileSync(join(__dirname, "..", rel), "utf8"));
  test.each(KERN)("scripts/docs-gen/%s.mjs: nur node:* und Kern-Module", (name) => {
    for (const spec of importe(`scripts/docs-gen/${name}.mjs`)) {
      const ok = spec.startsWith("node:") || KERN.some((k) => spec === `./${k}.mjs`) || KERN_CJS.includes(spec) || KERN_SKRIPTE.includes(spec);
      assert.ok(ok, `${name}.mjs importiert ${spec} (kein Kern-Modul)`);
    }
  });
  test("scripts/schichten-kern.cjs importiert nichts außer node:* (#1612)", () => {
    assert.deepEqual(importe("scripts/schichten-kern.cjs").filter((spec) => !spec.startsWith("node:")), []);
  });
  test("scripts/docs-gen.mjs: nur node:*, markdown.mjs, der Tauschpunkt registry.mjs und der Flag-Leser flag-lib.mjs (Kern, nur node:util)", () => {
    for (const spec of importe("scripts/docs-gen.mjs")) {
      const ok = spec.startsWith("node:") || spec === "./docs-gen/markdown.mjs" || spec === "./docs-gen/registry.mjs" || spec === "./flag-lib.mjs";
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

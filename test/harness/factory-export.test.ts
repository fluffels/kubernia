/* Export-Werkzeug des Factory-Repos (#1923, ADR 0022 F10, Teil 7a): `scripts/factory-export.mjs` schreibt den Anfangsstand des Factory-Repos aus einem Commit.
 * Dieser Test ist ein `projekt-test` und entfällt mit dem einmaligen Werkzeug (K9, #1882).
 *
 * @harness-waechter – einziger Durchsetzer seiner Regel (der Export bleibt rein und schreibt nichts bei einem Befund), darum im geschützten test/harness/ (#1165).
 *
 * Reale Quelle ist `HEAD` dieses Repos (gelesen per git wie beim Sync). Ein uncommittetes Vorlagen-File macht den Integrationsteil darum rot:
 * erst committen, dann testen. Die Negativfälle verändern einen Hüll-Leser (`mitAenderung`), nie die Datei auf der Platte. */
import { afterEach, beforeAll, describe, test } from "vitest";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as rawExport from "../../scripts/factory-export.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as rawLib from "../../scripts/factory-export-lib.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as rawSync from "../../scripts/factory-sync.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as rawBesitz from "../../scripts/besitz-lib.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as rawSkills from "../../scripts/skills-sync.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import { ROLLEN_PFADE } from "../../scripts/projekt-config-lib.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import { ZEIGER_WURZEL, zeigerText } from "../../scripts/skill-pfade.mjs";

interface Leser {
  fehler?: string;
  commit: string;
  pfade: string[];
  lies(pfad: string): string | null;
  ausfuehrbar(pfad: string): boolean;
  vorladen(pfade: string[]): void;
}
interface Ergebnis {
  dateien: Map<string, { text: string; ausfuehrbar: boolean }>;
  befunde: string[];
  bericht: { sha: string; anzahl: number; durchgelassen: number; durchgelassenJeMuster: number[]; relativUnaufloesbar: number; paketUnbekannt: string[]; literalRest: [string, number][]; praefixUmgeschrieben: number };
}
interface Lock {
  name?: string;
  version?: string;
  lockfileVersion?: number;
  requires?: boolean;
  packages: Record<string, Record<string, unknown>>;
}
const ex = rawExport as unknown as {
  baueExport(opt: { leser: Leser }): Ergebnis;
  cli(argv: string[], opt?: { leser?: Leser; out?: (s: string) => void; err?: (s: string) => void }): number;
  WAECHTER_DATEN: Record<string, unknown>;
};
const lib = rawLib as unknown as {
  lockAuszug(lock: Lock, pkg: Record<string, unknown>): { lock: Lock | null; befunde: string[] };
  kuberniaBegriffe(kub: unknown, fac: unknown): Record<string, RegExp>;
  pruefePaketImporte(d: Map<string, string>, kub: unknown, vorlage: unknown): { befunde: string[]; unbekannt: string[] };
  pruefeRelativeImporte(d: Map<string, string>, quelle: Set<string>): { befunde: string[]; unaufloesbar: number };
  pruefeSkriptBezuege(d: Map<string, string>): { befunde: string[] };
  pruefeLokalePfade(d: Map<string, string>, repos: string[]): { befunde: string[]; durchgelassen: number; jeMuster: number[] };
  pruefeLiterale(d: Map<string, string>, b: Record<string, RegExp>, aus: (p: string) => string | null): { befunde: string[]; rest: Map<string, number> };
  schreibePraefixUm(text: string, von: string, nach: string): { text: string; anzahl: number };
  paketName(spec: string): string | null;
  vorlagenZiel(pfad: string): string | null;
  pruefeSchutzliste(e: { vorlage: string; codeowners: string; quelle: string; pfade: string[] }): string[];
  SCHUTZ_OHNE_TREFFER: string[];
};
const leserVomCommit = (rawSync as unknown as { leserVomCommit: (quelle: string, rev: string) => Leser }).leserVomCommit;
const { projektwertLauf } = rawBesitz as unknown as { projektwertLauf: (wurzel: string, config: () => unknown) => { dateien: number; fehler: string[]; abweichungen: string[] } };

const WURZEL = fileURLToPath(new URL("../../", import.meta.url));
const temp: string[] = [];
const leerOrdner = (): string => {
  const d = mkdtempSync(join(tmpdir(), "fexp-"));
  temp.push(d);
  return d;
};
const aufraeumen = (): void => {
  for (const d of temp.splice(0)) rmSync(d, { recursive: true, force: true });
};
afterEach(aufraeumen);

/** Leser mit Änderungen: `text` ersetzt oder ergänzt die Datei, `null` entfernt sie (aus `pfade` und `lies`). */
function mitAenderung(basis: Leser, aend: Record<string, string | null>): Leser {
  const pfade = new Set(basis.pfade.filter((p) => aend[p] !== null));
  for (const [p, t] of Object.entries(aend)) if (t !== null) pfade.add(p);
  return {
    commit: basis.commit,
    pfade: [...pfade],
    lies: (p) => (Object.hasOwn(aend, p) ? aend[p] : basis.lies(p)),
    ausfuehrbar: (p) => basis.ausfuehrbar(p),
    vorladen: (ps) => basis.vorladen(ps),
  };
}

function lauf(argv: string[], leser?: Leser): { code: number; out: string; err: string } {
  const out: string[] = [];
  const err: string[] = [];
  const code = ex.cli(argv, { leser, out: (s) => out.push(s), err: (s) => err.push(s) });
  return { code, out: out.join("\n"), err: err.join("\n") };
}

function dateiListe(wurzel: string, rel = ""): string[] {
  const out: string[] = [];
  for (const d of readdirSync(join(wurzel, rel), { withFileTypes: true })) {
    const pfad = rel === "" ? d.name : `${rel}/${d.name}`;
    if (d.isDirectory()) out.push(...dateiListe(wurzel, pfad));
    else out.push(pfad);
  }
  return out.sort();
}

describe("lockAuszug", () => {
  const lock: Lock = {
    lockfileVersion: 3,
    requires: true,
    packages: {
      "": { name: "alt", version: "9.9.9", dependencies: { x: "^1" }, devDependencies: { y: "^1" } },
      "node_modules/x": { version: "1.0.0", dependencies: { b: "^1" } },
      "node_modules/x/node_modules/b": { version: "1.1.0" },
      "node_modules/b": { version: "2.0.0", dev: true },
      "node_modules/y": { version: "1.0.0", dependencies: { b: "^2" }, optionalDependencies: { opt: "^1" }, peerDependencies: { pe: "^1" } },
      "node_modules/pe": { version: "1.0.0", peer: true },
      "node_modules/unbenutzt": { version: "1.0.0" },
    },
  };
  const pkg = { name: "neu", version: "0.1.0", devDependencies: { x: "^1", y: "^1" }, engines: { node: ">=22" } };

  test("Hülle der Wurzel-Abhängigkeiten in Quellreihenfolge, neue Wurzel aus der Vorlage, Flags unverändert", () => {
    const r = lib.lockAuszug(lock, pkg);
    assert.deepEqual(r.befunde, []);
    assert.deepEqual(Object.keys(r.lock?.packages ?? {}), ["", "node_modules/x", "node_modules/x/node_modules/b", "node_modules/b", "node_modules/y", "node_modules/pe"]);
    assert.deepEqual(r.lock?.packages[""], pkg);
    assert.deepEqual(r.lock?.packages["node_modules/b"], { version: "2.0.0", dev: true });
    assert.equal(r.lock?.name, "neu");
    assert.equal(r.lock?.lockfileVersion, 3);
    assert.equal(r.lock?.requires, true);
  });

  test("Auflösung nach Node-Art: ein Eintrag unter dem Elternpaket verdeckt den gehobenen, auch aus einer Zwischenebene heraus", () => {
    const tief: Lock = {
      packages: {
        "": { dependencies: { a: "^1" } },
        "node_modules/a": { version: "1.0.0", dependencies: { b: "^1" } },
        "node_modules/a/node_modules/b": { version: "1.0.0", dependencies: { c: "^1" } },
        "node_modules/a/node_modules/c": { version: "1.0.0" },
        "node_modules/c": { version: "2.0.0" },
      },
    };
    const r = lib.lockAuszug(tief, { name: "neu", version: "0.1.0", dependencies: { a: "^1" } });
    assert.deepEqual(Object.keys(r.lock?.packages ?? {}), ["", "node_modules/a", "node_modules/a/node_modules/b", "node_modules/a/node_modules/c"]);
  });

  test("eine fehlende optionale Wurzel-Abhängigkeit ist kein Befund und bleibt in der neuen Wurzel", () => {
    const r = lib.lockAuszug(lock, { name: "neu", version: "0.1.0", devDependencies: { x: "^1" }, optionalDependencies: { fehlt: "^1" } });
    assert.deepEqual(r.befunde, []);
    assert.deepEqual(r.lock?.packages[""].optionalDependencies, { fehlt: "^1" });
  });

  test("ein Lock ohne packages ist ein Befund", () => {
    for (const kaputt of [{ packages: null }, null]) {
      const k = lib.lockAuszug(kaputt as unknown as Lock, pkg);
      assert.equal(k.lock, null);
      assert.match(k.befunde.join("|"), /keine packages/);
    }
    const r = lib.lockAuszug({} as Lock, pkg);
    assert.equal(r.lock, null);
    assert.match(r.befunde.join("|"), /keine packages/);
    const ohneWurzel = lib.lockAuszug({ packages: { "node_modules/x": { version: "1.0.0" } } }, { name: "neu", version: "0.1.0", devDependencies: { x: "^1" } });
    assert.deepEqual(Object.keys(ohneWurzel.lock?.packages ?? {}).sort(), ["", "node_modules/x"]);
  });

  test("ein verschachtelter Eintrag verdeckt den gehobenen: nicht erreichbare Einträge entfallen", () => {
    const r = lib.lockAuszug(lock, { name: "neu", version: "0.1.0", devDependencies: { x: "^1" } });
    assert.deepEqual(Object.keys(r.lock?.packages ?? {}), ["", "node_modules/x", "node_modules/x/node_modules/b"]);
  });

  test("fehlendes Pflichtziel ist ein Befund, ein fehlendes optionales oder Peer-Ziel nicht", () => {
    const r = lib.lockAuszug(lock, { name: "neu", version: "0.1.0", devDependencies: { x: "^1", nix: "^1" } });
    assert.equal(r.befunde.length, 1);
    assert.match(r.befunde[0], /'nix' \(Wurzel\)/);
    const kaputt = structuredClone(lock);
    kaputt.packages["node_modules/x"].dependencies = { b: "^1", zz: "^1" };
    assert.match(lib.lockAuszug(kaputt, pkg).befunde.join("|"), /'zz' \(node_modules\/x\)/);
  });
});

describe("schreibePraefixUm (#1932)", () => {
  test("schreibt den Commit-Zeilen-Präfix vor Großbuchstaben um und zählt die Treffer", () => {
    const r = lib.schreibePraefixUm("`KQ-Review:` und KQ-Diffsize-Override: #<nr>", "KQ-", "SIH-");
    assert.equal(r.text, "`SIH-Review:` und SIH-Diffsize-Override: #<nr>");
    assert.equal(r.anzahl, 2);
  });
  test("lässt Teilwörter, Zahlen, Kleinschreibung und den nackten Präfix stehen", () => {
    const text = "XKQ-A, KQ-123, kq-foo, `KQ-`, feature/kq-12, NKQ-Review";
    const r = lib.schreibePraefixUm(text, "KQ-", "SIH-");
    assert.equal(r.text, text);
    assert.equal(r.anzahl, 0);
  });
  test("ein Präfix mit Regex-Zeichen wird wörtlich genommen", () => {
    assert.equal(lib.schreibePraefixUm("A.-Review und AX-Review", "A.-", "B-").text, "B-Review und AX-Review");
  });
});

describe("kuberniaBegriffe", () => {
  const kub = {
    repo: "o/kub",
    boards: [{ besitzer: "o" }],
    praefixe: { commitZeile: "AA-", branch: "feature/aa-", worktree: "aa-" },
    labels: { harness: "area:harness" },
    agenten: { planer: "kub-planer", umsetzer: "kub-u", lens: "kub-l", gruppe: "kub-g", ticketSkill: "kub-t" },
    skills: { abschluss: "brain" },
    projektliterale: { Hof: "hof" },
  };
  const fac = { ...kub, repo: "o/fac", praefixe: { commitZeile: "BB-", branch: "feature/bb-", worktree: "bb-" }, agenten: { planer: "fac-p", umsetzer: "fac-u", lens: "fac-l", gruppe: "fac-g", ticketSkill: "fac-t" }, projektliterale: { Hof: "hof", kub: "kub" } };

  test("geteilte Begriffe (Owner, Label, Skill) entfallen, verschiedene und Projektliterale der Factory bleiben", () => {
    const b = lib.kuberniaBegriffe(kub, fac);
    assert.deepEqual(Object.keys(b).sort(), ["Agent", "Branch", "Env", "Hof", "Praefix", "Repo", "Worktree", "kub"].sort());
    assert.ok("kub".match(b.kub));
  });

  test("ein Begriff, den die Factory-Config gar nicht kennt (kein Skill), bleibt; fehlende projektliterale der Factory-Config werfen nicht", () => {
    assert.ok("Skill" in lib.kuberniaBegriffe(kub, { ...fac, skills: {} }));
    const ohneLiterale = lib.kuberniaBegriffe(kub, { ...fac, projektliterale: undefined });
    assert.ok("Hof" in ohneLiterale);
  });

  test("ein Projektliteral der Factory bleibt auch dann, wenn die Regex in beiden Configs gleich ist", () => {
    assert.ok("Hof" in lib.kuberniaBegriffe(kub, fac));
  });
});

describe("Prüfungen (pur)", () => {
  test("relative Importe: im Export unauflösbar ist ein Befund; in der Quelle schon unauflösbar nur in einer Testdatei Fixture-Text (gezählt), sonst ein Befund; Kommentare zählen nicht", () => {
    const dateien = new Map([
      ["scripts/a.mjs", 'import "./b.mjs";\nimport "./c.mjs";\nimport "./fehlt.mjs";\n'],
      ["scripts/b.mjs", "export const b = 1;\n"],
      ["test/t.test.ts", 'const text = `import "./fixture.mjs";`;\n'],
      ["scripts/k.mjs", '// import "./kommentar.mjs";\n/**\n * import "./block.mjs";\n */\nexport const k = 1;\n'],
      ["test/support/h.ts", 'import "./hilfe-fehlt.mjs";\n'],
      ["scripts/d.mjs", 'import("./dyn-fehlt.mjs")// x\nrequire("./req-fehlt.cjs")// y\n'],
      ["scripts/z.mjs", "/* a */\nimport './zwischen.mjs';\n/* b */\n"],
      ["scripts/g.mjs", '// Glob a/*/b im Kopf\nimport "./nach-glob.mjs";\nconst u = "https://h"; import "./gleiche-zeile.mjs";\n/** Ende */\n'],
      [
        "scripts/q.mjs",
        ['const s1 = "//x"; import "./q1.mjs";', "const s2 = '//x'; import \"./q2.mjs\";", 'const s3 = `//x`; import "./q3.mjs";', 'const s4 = a\\//x; import "./q4.mjs";', ""].join("\n"),
      ],
    ]);
    const r = lib.pruefeRelativeImporte(dateien, new Set(["scripts/a.mjs", "scripts/b.mjs", "scripts/c.mjs"]));
    assert.equal(r.befunde.length, 12);
    assert.match(r.befunde[0], /scripts\/a\.mjs: relativer Import '\.\/c\.mjs' löst im Export nicht auf/);
    assert.match(r.befunde[1], /scripts\/a\.mjs: relativer Import '\.\/fehlt\.mjs' löst weder im Export noch in der Quelle auf/);
    const alle = r.befunde.join("|");
    assert.match(alle, /test\/support\/h\.ts: relativer Import '\.\/hilfe-fehlt\.mjs'/);
    assert.match(alle, /scripts\/g\.mjs: relativer Import '\.\/nach-glob\.mjs'/);
    assert.match(alle, /scripts\/g\.mjs: relativer Import '\.\/gleiche-zeile\.mjs'/);
    assert.match(alle, /scripts\/z\.mjs: relativer Import '\.\/zwischen\.mjs'/);
    assert.match(alle, /scripts\/d\.mjs: relativer Import '\.\/dyn-fehlt\.mjs'/);
    assert.match(alle, /scripts\/d\.mjs: relativer Import '\.\/req-fehlt\.cjs'/);
    for (const k of ["q1", "q2", "q3", "q4"]) assert.match(alle, new RegExp("scripts/q\\.mjs: relativer Import '\\./" + k + "\\.mjs'"));
    assert.equal(r.unaufloesbar, 1);
    const doku = lib.pruefeRelativeImporte(new Map([["docs/x.md", 'import "./c.mjs";']]), new Set(["docs/x.md", "docs/c.mjs"]));
    assert.deepEqual(doku, { befunde: [], unaufloesbar: 0 });
  });

  test("Paket-Importe: unbekannter Name und Builtins zählen nicht, ein Paket von kubernia ohne Vorlage ist ein Befund, ebenso Vorlage ohne kubernia oder mit anderer Range", () => {
    const d = new Map([
      ["scripts/a.mjs", 'import "yaml";\nimport "node:fs";\nimport "fs/promises";\nimport "picomatch/lib";\nimport "vitest/config";\nimport "left-pad";\n// import "kommentar";\n'],
      ["test/t.test.ts", 'const text = `import "lodash";`;\n'],
    ]);
    const kub = { dependencies: { yaml: "^2" }, devDependencies: { picomatch: "^4", vitest: "^5" } };
    const r = lib.pruefePaketImporte(d, kub, { devDependencies: { yaml: "^2", vitest: "^5" } });
    assert.deepEqual(r.unbekannt, ["lodash"]);
    assert.equal(r.befunde.length, 2);
    assert.match(r.befunde[0], /Paket 'picomatch' steht nicht in der package\.json-Vorlage/);
    assert.match(r.befunde[1], /scripts\/a\.mjs: Paket 'left-pad' steht weder in der package\.json-Vorlage noch in kubernia/);
    const vorlage = lib.pruefePaketImporte(new Map(), kub, { devDependencies: { yaml: "^3", nur: "^1" } }).befunde.join("|");
    assert.match(vorlage, /'yaml' hat die Range \^3, kubernia \^2/);
    assert.match(vorlage, /'nur' steht in kubernia nicht/);
    assert.deepEqual(lib.pruefePaketImporte(new Map([["docs/x.md", 'import "picomatch";']]), kub, { devDependencies: {} }).befunde, []);
  });

  test("paketName kürzt Pfade auf das Paket und erkennt Nicht-Namen", () => {
    assert.equal(lib.paketName("vitest/config"), "vitest");
    assert.equal(lib.paketName("@a/b/c"), "@a/b");
    assert.equal(lib.paketName("./x.mjs"), null);
    assert.equal(lib.paketName("node:fs"), null);
    assert.equal(lib.paketName("fs/promises"), null);
    assert.equal(lib.paketName("${ziel}"), "?${ziel}");
  });

  test("Skriptbezüge: nur package.json, settings und Workflows zählen, ein Bezug ohne Datei im Export ist ein Befund", () => {
    const d = new Map([
      ["package.json", '{"scripts":{"a":"node scripts/da.mjs","b":"node scripts/fehlt.mjs"}}'],
      ["scripts/da.mjs", ""],
      ["docs/x.md", "scripts/ignoriert.mjs"],
      [".github/workflows/ci.yml", "run: node scripts/weg.cjs"],
      [".claude/settings.json", '{"command":"node scripts/hook.mjs"}'],
    ]);
    const r = lib.pruefeSkriptBezuege(d).befunde.join("|");
    assert.match(r, /package\.json: nennt scripts\/fehlt\.mjs/);
    assert.match(r, /ci\.yml: nennt scripts\/weg\.cjs/);
    assert.match(r, /settings\.json: nennt scripts\/hook\.mjs/);
    assert.doesNotMatch(r, /da\.mjs|ignoriert/);
    assert.match(lib.pruefeSkriptBezuege(new Map([[".github/workflows/b.yaml", "run: node scripts/weg.mjs"]])).befunde.join("|"), /b\.yaml: nennt scripts\/weg\.mjs/);
  });

  test("vorlagenZiel: nur Dateien mit der Endung .vorlage unter dem Vorlagen-Ordner haben ein Ziel", () => {
    assert.equal(lib.vorlagenZiel(".factory/produkt/vorlagen/a/b.json.vorlage"), "a/b.json");
    assert.equal(lib.vorlagenZiel(".factory/produkt/vorlagen/notiz.txt"), null);
    assert.equal(lib.vorlagenZiel(".factory/produkt/andere/x.vorlage"), null);
  });

  test("lokale Pfade: ein echter Name ist ein Befund, Platzhalter und Fixture-Wurzeln werden nur gezählt", () => {
    const L = "C" + ":\\";
    const d = new Map([
      ["scripts/a.mjs", `${L}Users\\Echt\\x\n${L}Users\\Max\\x\n${L}dev\\repo\nnichts\n`],
      ["docs/b.md", "kein Pfad\n"],
    ]);
    const r = lib.pruefeLokalePfade(d, ["egal"]);
    assert.equal(r.befunde.length, 1);
    assert.match(r.befunde[0], /scripts\/a\.mjs:1: lokaler Pfad \(nutzer\)/);
    assert.equal(r.durchgelassen, 2);
  });

  test("lokale Pfade: ein Laufwerkspfad mit dem Namen eines der beiden Repos ist ein Befund, POSIX-Kandidaten und Laufwerks-Fixtures werden gezählt, ausgeschlossene Dateien nicht geprüft", () => {
    const L = "C" + ":\\";
    const repos = lib.pruefeLokalePfade(new Map([["docs/a.md", `${L}foo\\kubernia\\x\n${L}foo\\selbst\\x\n`]]), ["kubernia", "selbst"]);
    assert.equal(repos.befunde.length, 2);
    assert.match(repos.befunde.join("|"), /docs\/a\.md:1: lokaler Pfad \(repo\)/);
    assert.match(repos.befunde.join("|"), /docs\/a\.md:2: lokaler Pfad \(repo\)/);
    assert.deepEqual(lib.pruefeLokalePfade(new Map([["docs/a.md", `${L}foo\\kubernia\\x`]]), ["egal"]).befunde, []);
    const mitBefund = lib.pruefeLokalePfade(new Map([["docs/a.md", `${L}dev\\kubernia\\x`]]), ["kubernia"]);
    assert.equal(mitBefund.befunde.length, 1);
    assert.deepEqual([mitBefund.durchgelassen, mitBefund.jeMuster], [0, [0, 0, 0]]);
    const posix = lib.pruefeLokalePfade(new Map([["scripts/p.mjs", "/c/dev/proj\n/Users/Max/proj\na/Users/Max/proj\nnichts\n"]]), ["egal"]);
    assert.deepEqual(posix, { befunde: [], durchgelassen: 2, jeMuster: [0, 1, 1] });
    const mehrere = lib.pruefeLokalePfade(new Map([["scripts/p.mjs", "/c/dev/a und /Users/Max/b\n"]]), ["egal"]);
    assert.deepEqual(mehrere, { befunde: [], durchgelassen: 1, jeMuster: [0, 1, 1] });
    const eingebettet = lib.pruefeLokalePfade(new Map([["scripts/p.mjs", ["x/c/dev/a", "https://h/c/dev/a", ""].join("\n")]]), ["egal"]);
    assert.deepEqual(eingebettet, { befunde: [], durchgelassen: 0, jeMuster: [0, 0, 0] });
    const ausgeschlossen = lib.pruefeLokalePfade(new Map([["package-lock.json", `${L}Users\\Echt\\x`]]), ["egal"]);
    assert.deepEqual(ausgeschlossen, { befunde: [], durchgelassen: 0, jeMuster: [0, 0, 0] });
  });

  test("Literale: Befund je Datei und Begriff, ausgenommene Dateien werden gezählt oder übersprungen", () => {
    const d = new Map([
      ["a.mjs", "kub und kub"],
      ["docs/s.md", "kub"],
      ["frei.json", "kub kub kub"],
      ["sauber.mjs", "nichts"],
    ]);
    const r = lib.pruefeLiterale(d, { Repo: /kub/g }, (p) => (p === "docs/s.md" ? "zaehlen" : p === "frei.json" ? "frei" : null));
    assert.deepEqual(r.befunde, ["a.mjs: kubernia-Literal 'Repo' (2x)"]);
    assert.deepEqual([...r.rest], [["docs/s.md", 1]]);
    const doppelt = lib.pruefeLiterale(new Map([["docs/s.md", "kub und kuberniaartig"], ["a.mjs", "kub"]]), { Literal: /kub/g, Repo: /kub/gi }, (p) => (p === "docs/s.md" ? "zaehlen" : null));
    assert.deepEqual(doppelt.befunde, ["a.mjs: kubernia-Literal 'Literal' (1x)"]);
    assert.deepEqual([...doppelt.rest], [["docs/s.md", 1]]);
    assert.deepEqual(lib.pruefeLiterale(new Map([["a.mjs", "a - b"]]), { Leer: /x*/g }, () => null).befunde, []);
    assert.deepEqual(lib.pruefeLiterale(new Map([["a.mjs", "x-kq"]]), { Rand: /-kq/g }, () => null).befunde, ["a.mjs: kubernia-Literal 'Rand' (1x)"]);
    const ueberlappt = lib.pruefeLiterale(new Map([["docs/s.md", "feature/kq-12"], ["a.mjs", "feature/kq-12"]]), { KQ: /(?<![\p{L}\p{N}_])kq(?![\p{L}\p{N}_])/giu, Branch: /feature\/kq-/g }, (p) => (p === "docs/s.md" ? "zaehlen" : null));
    assert.deepEqual(ueberlappt.befunde, ["a.mjs: kubernia-Literal 'KQ' (1x)"]);
    assert.deepEqual([...ueberlappt.rest], [["docs/s.md", 1]]);
    assert.deepEqual(lib.pruefeLiterale(new Map([["a.mjs", "process.env.KQ_NAME"]]), { Env: /\bKQ_(?=[A-Z0-9])/g }, () => null).befunde, ["a.mjs: kubernia-Literal 'Env' (1x)"]);
    assert.deepEqual(lib.pruefeLiterale(new Map([["a.mjs", "xkq"], ["b.mjs", "kqx"]]), { K: /kq/g }, () => null).befunde, [], "ein Teilwort mit einem Zeichen Abstand zum Rand trifft nicht");
    assert.deepEqual(lib.pruefeLiterale(new Map([["a.mjs", "kub1 1kub"]]), { K: /kub/g }, () => null).befunde, [], "Ziffern am Treffer grenzen ab");
    assert.deepEqual([...lib.pruefeLiterale(new Map([["docs/s.md", "kub kub"]]), { K: /kub/g }, () => "zaehlen").rest], [["docs/s.md", 2]]);
    const innen = lib.pruefeLiterale(new Map([["a.mjs", "KQ-kq"], ["b.mjs", "kq-KQ"]]), { A: /KQ-|-KQ/g, B: /-kq|kq-/g }, () => null);
    assert.deepEqual(innen.befunde, ["a.mjs: kubernia-Literal 'A' (1x)", "b.mjs: kubernia-Literal 'A' (1x)"]);
    const stoesst = lib.pruefeLiterale(new Map([["a.mjs", "KQ-KQ-Plan"], ["b.mjs", "KQ-feature/kq-1"], ["c.mjs", "feature/kq-KQ-1"]]), { P: /KQ-/g, B: /feature\/kq-/g }, () => null);
    assert.deepEqual(stoesst.befunde, [
      "a.mjs: kubernia-Literal 'P' (2x)",
      "b.mjs: kubernia-Literal 'P' (1x)",
      "b.mjs: kubernia-Literal 'B' (1x)",
      "c.mjs: kubernia-Literal 'P' (1x)",
      "c.mjs: kubernia-Literal 'B' (1x)",
    ]);
    const praefix = lib.pruefeLiterale(new Map([["a.mjs", "KQ-Plan und xKQ-Plan"]]), { Praefix: /KQ-/g }, () => null);
    assert.deepEqual(praefix.befunde, ["a.mjs: kubernia-Literal 'Praefix' (1x)"]);
    const zwei = lib.pruefeLiterale(new Map([["docs/s.md", "kub und zwei"]]), { A: /kub/g, B: /zwei/g }, () => "zaehlen");
    assert.deepEqual([...zwei.rest], [["docs/s.md", 2]]);
  });
});


describe("pruefeSchutzliste (pur)", () => {
  const KOPF = ["/scripts/check-*.mjs", "/.github/protected-paths.json", "/.github/CODEOWNERS"];
  const HARNESS = ["AGENTS.md", "/CLAUDE.md", "/CLAUDE.local.md", "/.claude/", "/scripts/*-mcp.mjs"];
  const WAECHTER = ["/test/harness/"];
  const PFADE = ["scripts/check-size.mjs", ".github/protected-paths.json", ".github/CODEOWNERS", "AGENTS.md", ".claude/settings.json", "test/harness/a.test.ts", "src/modul/AGENTS.md", "README.md"];
  const quelleText = (extra: string[] = []): string => JSON.stringify({ gate: [...KOPF, ...extra], harness: HARNESS, waechter: WAECHTER });
  const owners = (muster: string[]): string => `# Kopf\n\n${muster.map((m) => `${m} @owner`).join("\n")}\n`;
  const alle = [...KOPF, ...HARNESS, ...WAECHTER];
  const pruefe = (o: { vorlage?: string; codeowners?: string; quelle?: string; pfade?: string[] } = {}): string[] =>
    lib.pruefeSchutzliste({ vorlage: o.vorlage ?? quelleText(), codeowners: o.codeowners ?? owners(alle), quelle: o.quelle === undefined ? quelleText() : o.quelle, pfade: o.pfade ?? PFADE });

  test("deckungsgleiche Vorlage ist kein Befund; die drei Muster der geschlossenen Liste dürfen ohne Treffer stehen", () => {
    assert.deepEqual(pruefe(), []);
    assert.deepEqual(lib.SCHUTZ_OHNE_TREFFER, ["/CLAUDE.md", "/CLAUDE.local.md", "/scripts/*-mcp.mjs"]);
  });

  test("(a) ein Muster der Vorlage ohne Treffer und außerhalb der geschlossenen Liste ist ein Befund", () => {
    const mit = [...KOPF, "/scripts/gibts-nicht.mjs"];
    const vorlage = JSON.stringify({ gate: mit, harness: HARNESS, waechter: WAECHTER });
    const r = pruefe({ vorlage, codeowners: owners([...mit, ...HARNESS, ...WAECHTER]) });
    assert.deepEqual(r, ["protected-paths.json (Vorlage): Muster '/scripts/gibts-nicht.mjs' trifft keinen Exportpfad und steht nicht in der geschlossenen Liste"]);
  });

  test("(b) ein Muster der Quelle, das einen Exportpfad trifft und in der Vorlage fehlt, ist ein Befund (Drift-Schutz)", () => {
    const ohne = JSON.stringify({ gate: KOPF.filter((m) => m !== "/scripts/check-*.mjs"), harness: HARNESS, waechter: WAECHTER });
    const r = pruefe({ vorlage: ohne, codeowners: owners(alle.filter((m) => m !== "/scripts/check-*.mjs")) });
    assert.deepEqual(r, ["protected-paths.json (Vorlage): Muster '/scripts/check-*.mjs' der Quelle trifft 'scripts/check-size.mjs', fehlt aber in der Vorlage"]);
  });

  test("(b) ein Quell-Muster ohne Treffer im Export darf in der Vorlage fehlen; unverankertes AGENTS.md trifft auch modul-lokale Dateien", () => {
    assert.deepEqual(pruefe({ quelle: quelleText(["/.jscpd.json"]) }), []);
    const nurModul = pruefe({
      pfade: ["src/modul/AGENTS.md", ".github/protected-paths.json", ".github/CODEOWNERS"],
      vorlage: JSON.stringify({ gate: [KOPF[1], KOPF[2]], harness: ["AGENTS.md", "/CLAUDE.md", "/CLAUDE.local.md", "/scripts/*-mcp.mjs"] }),
      codeowners: owners([KOPF[1], KOPF[2], "AGENTS.md", "/CLAUDE.md", "/CLAUDE.local.md", "/scripts/*-mcp.mjs"]),
      quelle: JSON.stringify({ gate: [KOPF[1], KOPF[2]], harness: ["AGENTS.md", "/CLAUDE.md", "/CLAUDE.local.md", "/scripts/*-mcp.mjs"] }),
    });
    assert.deepEqual(nurModul, [], "AGENTS.md trifft src/modul/AGENTS.md");
  });

  test("(c) CODEOWNERS und protected-paths-Vorlage müssen dieselbe Menge sein (in beide Richtungen)", () => {
    const mehr = pruefe({ codeowners: owners([...alle, "/extra.json"]) });
    assert.equal(mehr.length, 1);
    assert.match(mehr[0], /CODEOWNERS \(Vorlage\): .*nur in CODEOWNERS: \/extra\.json/);
    const weniger = pruefe({ codeowners: owners(alle.filter((m) => m !== "/.claude/")) });
    assert.equal(weniger.length, 1);
    assert.match(weniger[0], /CODEOWNERS \(Vorlage\): .*nur in protected-paths\.json: \/\.claude\//);
  });

  test("kaputtes JSON in Vorlage oder Quelle ist ein Befund statt einer Ausnahme", () => {
    assert.match(pruefe({ vorlage: "{ nein" }).join("|"), /protected-paths\.json \(Vorlage\): kein gültiges JSON/);
    assert.match(pruefe({ quelle: "{ nein" }).join("|"), /protected-paths\.json \(Quelle\): kein gültiges JSON/);
    assert.match(pruefe({ quelle: null as unknown as string }).join("|"), /protected-paths\.json \(Quelle\): kein gültiges JSON/, "fehlende Quelle (lies liefert null)");
  });

  test("Werte, die keine Liste sind, und Einträge, die kein Text sind, zählen nicht als Muster; Kommentarzeilen in CODEOWNERS auch nicht", () => {
    const mit = JSON.stringify({ hinweis: "kein Muster", gate: [...KOPF, 42], harness: HARNESS, waechter: WAECHTER });
    assert.deepEqual(pruefe({ vorlage: mit, quelle: mit }), []);
    assert.deepEqual(pruefe({ codeowners: `# @owner nur ein Kommentar\n${owners(alle)}` }), []);
  });
});
describe("Export aus HEAD", () => {
  let leser: Leser;
  let echt: Ergebnis;
  beforeAll(() => {
    leser = leserVomCommit(WURZEL, "HEAD");
    assert.equal(leser.fehler, undefined);
    echt = ex.baueExport({ leser });
  }, 60_000);

  test("der echte Stand hat keinen Befund und der Bericht nennt den Export-SHA", () => {
    assert.deepEqual(echt.befunde, []);
    assert.equal(echt.bericht.sha, execFileSync("git", ["-C", WURZEL, "rev-parse", "HEAD"], { encoding: "utf8" }).trim());
    assert.ok(echt.dateien.size > 300);
    assert.equal(echt.bericht.anzahl, echt.dateien.size);
  }, 60_000);

  test("#1932: Factory-Seiten tragen den Präfix der Factory-Config, keine KQ-Commit-Zeile mehr", () => {
    const harness = echt.dateien.get("docs/agent-harness.md")?.text ?? "";
    assert.match(harness, /SIH-Lockfile-Override/);
    assert.doesNotMatch(harness, /(?<![\w-])KQ-\p{Lu}/u);
    assert.ok(echt.bericht.praefixUmgeschrieben > 0);
  });

  test("AK1: zwei Läufe in zwei leere Ordner sind byte-gleich (Dateiliste, Inhalt, Ausführbar-Bit)", () => {
    const [a, b] = [leerOrdner(), leerOrdner()];
    const [la, lb] = [lauf(["--ziel", a], leser), lauf(["--ziel", b], leser)];
    assert.equal(la.code, 0, la.err);
    assert.equal(lb.code, 0, lb.err);
    assert.match(la.out, new RegExp(`Export-SHA ${echt.bericht.sha}`));
    assert.match(la.out, /je Muster .+ = \d+; .+ = \d+; .+ = \d+/);
    const liste = dateiListe(a);
    assert.deepEqual(liste, dateiListe(b));
    assert.deepEqual(liste, [...echt.dateien.keys()].sort());
    for (const p of liste) {
      assert.ok(readFileSync(join(a, p)).equals(readFileSync(join(b, p))), `${p} weicht ab`);
      if (process.platform !== "win32") assert.equal((statSync(join(a, p)).mode & 0o111) !== 0, echt.dateien.get(p)?.ausfuehrbar, `${p}: Ausführbar-Bit`);
    }
  }, 60_000);

  test("AK1: ein nicht leeres Ziel endet mit Exit 1, und nichts wird geschrieben; fehlendes --ziel ist Exit 2", () => {
    const z = leerOrdner();
    writeFileSync(join(z, "vorhanden.txt"), "x");
    const r = lauf(["--ziel", z], leser);
    assert.equal(r.code, 1);
    assert.match(r.err, /kein leerer Ordner/);
    assert.deepEqual(readdirSync(z), ["vorhanden.txt"]);
    const datei = join(z, "vorhanden.txt");
    assert.equal(lauf(["--ziel", datei], leser).code, 1);
    assert.equal(lauf([], leser).code, 2);
  });

  test("AK1: ein Ziel, das noch nicht existiert, wird angelegt", () => {
    const z = join(leerOrdner(), "neu", "tief");
    assert.equal(lauf(["--ziel", z], leser).code, 0);
    assert.ok(existsSync(join(z, "AGENTS.md")));
  }, 60_000);

  test("Config, AGENTS.md und settings des Exports tragen die Factory-Werte, nichts von kubernia", () => {
    const text = (p: string): string => echt.dateien.get(p)?.text ?? "";
    const config = JSON.parse(text(".factory/projekt.json")) as Record<string, Record<string, string> | string>;
    const kub = JSON.parse(leser.lies(".factory/projekt.json") ?? "{}") as Record<string, Record<string, string> | string>;
    assert.equal(config.repo, "fluffels/self-improving-agent-harness-and-factory");
    assert.deepEqual(config.praefixe, { commitZeile: "SIH-", branch: "feature/sih-", worktree: "sih-" });
    assert.deepEqual(config.agenten, { planer: "sih-planer", umsetzer: "sih-umsetzer", lens: "sih-lens", gruppe: "sih-gruppe", ticketSkill: "sih-ticket" });
    assert.deepEqual(config.labels, kub.labels);
    assert.deepEqual(config.boards, kub.boards);
    assert.deepEqual(config.projektliterale, { ...(kub.projektliterale as Record<string, string>), kubernia: "kubernia", KQ: "KQ" });
    const agents = text("AGENTS.md");
    assert.match(agents, /\| `praefixe\.commitZeile` \| `SIH-` \|/);
    assert.match(agents, /\| `agenten\.ticketSkill` \| `sih-ticket` \|/);
    assert.doesNotMatch(agents, /KQ-|kubernia/i);
    assert.match(agents, /<!-- factory-projekt:start -->[\s\S]*<!-- factory-projekt:ende -->/);
    const settings = JSON.parse(text(".claude/settings.json")) as { permissions: { allow: string[] }; hooks: unknown; model: string };
    assert.ok(settings.permissions.allow.includes("mcp__langfuse__queryMetrics"));
    assert.ok(settings.permissions.allow.includes("mcp__playwright"), "der Browser-Server der Vorlage steht in der Ergänzung (#1931)");
    assert.ok(!settings.permissions.allow.includes("mcp__likec4"));
    assert.ok(settings.hooks !== undefined);
    assert.equal(settings.model, "sonnet");
  });

  test("Projektwerte: der Wächter der Projektwert-Blöcke meldet im geschriebenen Export keinen Fehler", () => {
    const z = leerOrdner();
    assert.equal(lauf(["--ziel", z], leser).code, 0);
    const config = JSON.parse(readFileSync(join(z, ".factory/projekt.json"), "utf8")) as unknown;
    const r = projektwertLauf(z, () => config);
    assert.deepEqual(r.fehler, []);
    assert.deepEqual(r.abweichungen, []);
    assert.ok(r.dateien > 0);
  }, 60_000);

  test("AK3: check-internalrefs ist im Export grün (nach git init und git add)", () => {
    const z = leerOrdner();
    assert.equal(lauf(["--ziel", z], leser).code, 0);
    execFileSync("git", ["init", "-q"], { cwd: z });
    execFileSync("git", ["add", "-A"], { cwd: z });
    const r = execFileSync("node", ["scripts/check-internalrefs.mjs"], { cwd: z, encoding: "utf8" });
    assert.match(r, /Keine internen Referenzen/);
  }, 60_000);

  test("AK4: Daten-Dateien der Kern-Wächter stehen nur mit ihrem Kern-Anteil im Export", () => {
    const text = (p: string): string => echt.dateien.get(p)?.text ?? "";
    const pfade = new Set(echt.dateien.keys());
    for (const p of ["test/harness/emoji-baseline.json", "eslint-suppressions.json", "any-suppressions.json"]) {
      for (const k of Object.keys(JSON.parse(text(p)) as object)) assert.ok(pfade.has(k), `${p}: ${k} ist kein Exportpfad`);
    }
    const abdeckung = JSON.parse(text("test/harness/kern-abdeckung.json")) as Record<string, unknown>;
    assert.ok(Object.keys(abdeckung).length > 0);
    for (const k of Object.keys(abdeckung)) assert.ok(pfade.has(k), `kern-abdeckung: ${k} hat keinen Treffer im Export`);
    const liste = JSON.parse(text(".factory/extraktion.json")) as { eintraege: { art: string }[] };
    assert.deepEqual([...new Set(liste.eintraege.map((e) => e.art))].sort(), ["fixture", "kern-test", "test-hilfe"]);
    assert.equal(text("test/harness/kern-literale-baseline.json"), "{}\n");
    const mitBaseline = ex.baueExport({ leser: mitAenderung(leser, { "test/harness/kern-literale-baseline.json": '{"scripts/x.mjs":{"Repo":3}}' }) });
    assert.equal(mitBaseline.dateien.get("test/harness/kern-literale-baseline.json")?.text, "{}\n");
    assert.equal(text("test/harness/kern-links-baseline.json"), leser.lies("test/harness/kern-links-baseline.json"));
    assert.equal(text(".factory/besitz.json"), leser.lies(".factory/besitz.json"));
  });

  test("AK4: jede Daten-Datei, die extraktion.test.ts als Daten-Datei des Kern-Wächters nennt, steht in WAECHTER_DATEN", () => {
    const quelle = readFileSync(join(WURZEL, "test/harness/extraktion.test.ts"), "utf8");
    const ziele = [...quelle.matchAll(/ -> ([^"\s]+)": DATEN_DATEI/g)].map((m) => m[1]);
    assert.ok(ziele.length >= 4, "der Abgleich fand keine Ziele");
    for (const z of ziele) assert.ok(z in ex.WAECHTER_DATEN, `${z} fehlt in WAECHTER_DATEN`);
  });

  test("#1929: die acht Daten-Dateien der Kern-Skripte liegen im Export, die Vorlagen sind gültig und tragen die Factory-Werte", () => {
    const pfade = [".github/protected-paths.json", ".github/CODEOWNERS", ".github/wiedervorlagen.json", "scripts/docs-gen/config.json", "scripts/layers.cjs", "scripts/setup.mjs", ".gitignore", ".mcp.json"];
    for (const p of pfade) assert.ok(echt.dateien.has(p), `${p} fehlt im Export`);
    const text = (p: string): string => echt.dateien.get(p)?.text ?? "";
    assert.deepEqual(JSON.parse(text(".github/wiedervorlagen.json")), []);
    for (const p of [".github/protected-paths.json", "scripts/docs-gen/config.json", ".mcp.json"]) assert.doesNotThrow(() => JSON.parse(text(p)), p);
    const mcp = JSON.parse(text(".mcp.json")) as { mcpServers: Record<string, { command: string; args: string[] }> };
    assert.deepEqual(Object.keys(mcp.mcpServers), ["playwright"]);
    const quellLock = JSON.parse(leser.lies("package-lock.json") ?? "") as Lock;
    const version = quellLock.packages["node_modules/@playwright/mcp"]?.version;
    assert.match(String(version), /^\d+\.\d+\.\d+/, "kubernia pinnt @playwright/mcp im Lock");
    assert.equal(mcp.mcpServers.playwright.command, "npx");
    assert.ok(mcp.mcpServers.playwright.args.includes(`@playwright/mcp@${String(version)}`), "der Server ist auf die Version des Locks von kubernia gepinnt");
    for (const m of ["/CLAUDE.md", "/CLAUDE.local.md", "/scripts/*-mcp.mjs"]) assert.ok(text(".github/protected-paths.json").includes(`"${m}"`), `${m} (geschlossene Liste) fehlt`);
    const ignore = text(".gitignore").split("\n");
    for (const o of ["agents", "skills", "workflows"]) assert.ok(ignore.includes(`!.claude/${o}/`), `.gitignore ohne !.claude/${o}/`);
  });

  test("#1929: Daten für die elf Kern-Tests liegen im Export: Coverage-Reporter, Diagramm-Vorlagen mit den Namen des Factory-Repos, Langfuse-Seite und -Regel", () => {
    const text = (p: string): string => echt.dateien.get(p)?.text ?? "";
    assert.match(text("vite.config.ts"), /reporter:\s*\[[^\]]*"lcovonly"/);
    assert.match(text("vite.config.ts"), /reportsDirectory:\s*"coverage"/);
    for (const p of ["docs/diagramme/agenten-ablauf.mmd", "docs/diagramme/agenten-sequenz.mmd", "docs/diagramme/leitplanken-schichten.mmd", "docs/langfuse-hook-patch.md"]) assert.ok(echt.dateien.has(p), `${p} fehlt im Export`);
    assert.match(text("docs/diagramme/agenten-ablauf.mmd"), /\$\{agent:sih-planer\}/);
    assert.doesNotMatch(text("docs/diagramme/agenten-sequenz.mmd"), /forum/i);
    assert.match(text("AGENTS.md"), /Langfuse-Erfassung erhalten[^\n]*model-routing\.md#langfuse-erfassung-belegen-1293/);
  });

  test("#1929: setup.mjs besteht node --check und nennt kein Projekt; layers.cjs lädt gegen den Schicht-Kern und liefert die vier Schicht-IDs", () => {
    const dir = leerOrdner();
    for (const p of ["scripts/setup.mjs", "scripts/layers.cjs", "scripts/schichten-kern.cjs"]) {
      mkdirSync(join(dir, "scripts"), { recursive: true });
      writeFileSync(join(dir, p), echt.dateien.get(p)?.text ?? "");
    }
    execFileSync(process.execPath, ["--check", join(dir, "scripts/setup.mjs")]);
    assert.doesNotMatch(echt.dateien.get("scripts/setup.mjs")?.text ?? "", /kubernia/i);
    const layers = createRequire(import.meta.url)(join(dir, "scripts/layers.cjs")) as { LAYERS: Record<string, string>; layerOf: (f: string) => string };
    assert.deepEqual(Object.values(layers.LAYERS).sort(), ["anwendung", "domaene", "einstieg", "praesentation"]);
    assert.equal(layers.layerOf("scripts/check-size.mjs"), layers.LAYERS.DOMAIN, "alles übrige unter der Quellwurzel ist die Auffang-Schicht");
  });

  test("#1930: Ticket-Skill der Rolle ticketSkill und sein Zeiger liegen im Export, Name aus der Config, nur der Produkt-Bereich", () => {
    const quellPfad = (ROLLEN_PFADE as Record<string, string>).ticketSkill;
    const ordner = quellPfad.split("/").slice(-2, -1)[0];
    const text = (p: string): string => echt.dateien.get(p)?.text ?? "";
    const quelle = text(quellPfad);
    assert.ok(quelle.length > 0, `${quellPfad} fehlt im Export`);
    const factory = JSON.parse(text(".factory/projekt.json")) as { agenten: { ticketSkill: string } };
    assert.ok(quelle.split("\n").join("|").includes(`# factory:projektwert agenten.ticketSkill|name: ${factory.agenten.ticketSkill}|`), "Marker und Name der Config stehen untereinander");
    assert.ok(quelle.includes("--bereich spiel"));
    assert.ok(!quelle.includes("--bereich agentic"));
    const zeiger = text(`${String(ZEIGER_WURZEL)}/${ordner}/SKILL.md`);
    assert.equal(zeiger, (zeigerText as (n: string, t: string) => string)(ordner, quelle), "der Zeiger ist aus der gerenderten Quelle berechnet");
    const z = leerOrdner();
    assert.equal(lauf(["--ziel", z], leser).code, 0);
    const stand = (rawSkills as unknown as { liesStand(w: string): unknown; pruefeSkills(s: unknown): unknown[] });
    assert.deepEqual(stand.pruefeSkills(stand.liesStand(z)), []);
    assert.doesNotMatch(quelle + zeiger, /kubernia|KQ/i);
  }, 60_000);

  test("#1931: die Settings-Vorlage trägt die Kontext-Schalter und gibt jeden Server der .mcp.json frei, die Ergänzung der Config erreicht permissions", () => {
    const text = (p: string): string => echt.dateien.get(p)?.text ?? "";
    const settings = JSON.parse(text(".claude/settings.json")) as { enabledPlugins: Record<string, boolean>; enabledMcpjsonServers: string[]; permissions: { allow: string[]; ask: string[] } };
    assert.equal(settings.enabledPlugins["data@synced"], false);
    assert.equal(settings.enabledPlugins["cowork-plugin-management@synced"], false);
    const server = Object.keys((JSON.parse(text(".mcp.json")) as { mcpServers: Record<string, unknown> }).mcpServers);
    assert.ok(server.length > 0, ".mcp.json des Exports führt keinen Server");
    for (const s of server) assert.ok(settings.enabledMcpjsonServers.includes(s), `Server ${s} der .mcp.json ist in enabledMcpjsonServers nicht freigegeben`);
    const config = JSON.parse(text(".factory/projekt.json")) as { berechtigungen: { allow: string[]; ask: string[] } };
    assert.ok(config.berechtigungen.allow.includes("mcp__playwright"));
    assert.ok(settings.permissions.allow.includes("mcp__playwright"));
    assert.ok(settings.permissions.ask.includes("mcp__playwright__browser_run_code_unsafe"));
  });

  test("Lock: Wurzel entspricht der Vorlage, jede Wurzel-Abhängigkeit hat einen Eintrag, Einträge sind unverändert aus kubernia", () => {
    const lock = JSON.parse(echt.dateien.get("package-lock.json")?.text ?? "{}") as Lock;
    const pkg = JSON.parse(echt.dateien.get("package.json")?.text ?? "{}") as { devDependencies: Record<string, string> };
    const quelle = JSON.parse(leser.lies("package-lock.json") ?? "{}") as Lock;
    assert.equal(lock.name, "self-improving-agent-harness-and-factory");
    assert.deepEqual(lock.packages[""].devDependencies, pkg.devDependencies);
    for (const d of Object.keys(pkg.devDependencies)) assert.ok(`node_modules/${d}` in lock.packages, `${d} fehlt im Lock`);
    for (const [p, e] of Object.entries(lock.packages)) if (p !== "") assert.deepEqual(e, quelle.packages[p], `${p} weicht von kubernia ab`);
    assert.ok(Object.keys(lock.packages).length < Object.keys(quelle.packages).length);
  });

  test("das Ausführbar-Bit der Quelle gilt für kopierte Dateien, nie für berechnete; Wurzel-Dateien der Produkt-Art liegen an der Wurzel", () => {
    const exec = new Set(["scripts/check-size.mjs", "test/support/tmp-fixture.ts", ".factory/produkt/README.md", ".nvmrc"]);
    const r = ex.baueExport({ leser: { ...leser, ausfuehrbar: (p) => exec.has(p) || p === "AGENTS.md" } });
    assert.deepEqual(r.befunde, []);
    for (const p of ["scripts/check-size.mjs", "test/support/tmp-fixture.ts", "README.md", ".nvmrc"]) assert.equal(r.dateien.get(p)?.ausfuehrbar, true, p);
    for (const p of ["AGENTS.md", "package.json", "scripts/check-docmap.mjs"]) assert.equal(r.dateien.get(p)?.ausfuehrbar, false, p);
    assert.ok(r.dateien.has("LICENSE"));
    assert.ok(!r.dateien.has(".factory/produkt/README.md"));
    if (process.platform !== "win32") {
      const z = leerOrdner();
      assert.equal(lauf(["--ziel", z], { ...leser, ausfuehrbar: (p) => exec.has(p) }).code, 0);
      assert.equal((statSync(join(z, "scripts/check-size.mjs")).mode & 0o111) !== 0, true);
      assert.equal((statSync(join(z, "AGENTS.md")).mode & 0o111) !== 0, false);
    }
  });

  test("ohne injizierten Leser liest die Kommandozeile den Commit per git (--commit, --quelle)", () => {
    const z = leerOrdner();
    const r = lauf(["--ziel", z, "--commit", echt.bericht.sha, "--quelle", WURZEL]);
    assert.equal(r.code, 0, r.err);
    assert.match(r.out, new RegExp(`Export-SHA ${echt.bericht.sha}`));
    assert.ok(existsSync(join(z, "package-lock.json")));
    assert.equal(lauf(["--ziel", leerOrdner()]).code, 0);
    const standard = lauf(["--ziel", leerOrdner(), "--quelle", WURZEL]);
    assert.equal(standard.code, 0, standard.err);
    assert.match(standard.out, new RegExp(`Export-SHA ${echt.bericht.sha}`));
    const falsch = lauf(["--ziel", leerOrdner(), "--commit", "gibt-es-nicht", "--quelle", WURZEL]);
    assert.equal(falsch.code, 1);
    assert.match(falsch.err, /gibt es in der Quelle nicht/);
  }, 60_000);

  test("Bericht zählt durchgelassene Pfade, Fixture-Rauschen und den Rest der Factory-Seiten", () => {
    const b = echt.bericht;
    assert.ok(b.durchgelassen > 0);
    assert.ok(b.relativUnaufloesbar > 0);
    assert.ok(b.paketUnbekannt.includes("lodash"));
    assert.ok(b.literalRest.length > 0 && b.literalRest.every(([p]) => p.startsWith("docs/") || p === ".factory/projekt.json"));
    assert.ok(b.literalRest.some(([p, n]) => p === ".factory/projekt.json" && n > 0));
    assert.equal(b.durchgelassenJeMuster.length, 3);
    assert.ok(b.durchgelassenJeMuster.every((n) => n > 0));
    const summe = (r: Ergebnis): number => r.bericht.literalRest.reduce((s, [, n]) => s + n, 0);
    const seite = "docs/model-routing.md";
    const plus = ex.baueExport({ leser: mitAenderung(leser, { [seite]: `${leser.lies(seite) ?? ""}\nkubernia\n` }) });
    assert.equal(summe(plus), summe(echt) + 1, "ein einzelnes kubernia zählt einmal, nicht je Begriff");
    const umgekehrt = ex.baueExport({ leser: { ...leser, pfade: [...leser.pfade].reverse() } });
    assert.deepEqual(umgekehrt.befunde, []);
    const pfade = umgekehrt.bericht.literalRest.map(([p]) => p);
    assert.ok(pfade.length > 1);
    assert.deepEqual(pfade, [...pfade].sort());
  });

  describe("Negativfälle: Befund, Exit 1, nichts geschrieben", () => {
    const abbruch = (aend: Record<string, string | null>, muster: RegExp): void => {
      const z = leerOrdner();
      const r = lauf(["--ziel", z], mitAenderung(leser, aend));
      assert.equal(r.code, 1, r.out);
      assert.match(r.err, muster);
      assert.match(r.err, /nichts geschrieben/);
      assert.deepEqual(readdirSync(z), []);
    };
    const befund = (aend: Record<string, string | null>, muster: RegExp): void => {
      assert.match(ex.baueExport({ leser: mitAenderung(leser, aend) }).befunde.join("\n"), muster);
    };
    const basisText = (p: string): string => leser.lies(p) ?? "";

    test("AK6: fehlt eine Besitz-Datei, bricht der Export ab", () => {
      abbruch({ "scripts/check-size.mjs": null }, /scripts\/check-size\.mjs: Pfad existiert nicht/);
    });

    test("AK6: hat ein Muster der Extraktionsliste keinen Treffer, bricht der Export ab", () => {
      abbruch({ "test/fixtures/projekt-fremd.json": null }, /test\/fixtures\/projekt-fremd\.json: Eintrag ohne Treffer/);
    });

    test("AK6: fehlt die Vorlage eines infrastruktur-anteil, bricht der Export ab", () => {
      abbruch({ ".factory/produkt/vorlagen/tsconfig.json.vorlage": null }, /tsconfig\.json\.vorlage: Vorlage fehlt/);
    });


    test("#1930: fehlt die Vorlage des Ticket-Skills, bricht der Export ab", () => {
      const vorlage = `.factory/produkt/vorlagen/${(ROLLEN_PFADE as Record<string, string>).ticketSkill}.vorlage`;
      abbruch({ [vorlage]: null }, /SKILL\.md\.vorlage: Vorlage fehlt/);
    });

    test("#1930: ohne Eintrag der Quelle in der Extraktionsliste und ohne Vorlage meldet der Export den fehlenden Ticket-Skill statt abzustürzen", () => {
      const quelle = (ROLLEN_PFADE as Record<string, string>).ticketSkill;
      const alle = basisText(".factory/extraktion.json").split("\n");
      const liste = alle.filter((z) => !z.includes(`"muster":"${quelle}"`));
      assert.equal(liste.length, alle.length - 1, "genau ein Eintrag entfällt");
      befund({ ".factory/extraktion.json": liste.join("\n"), [`.factory/produkt/vorlagen/${quelle}.vorlage`]: null }, /Vorlage der Rolle ticketSkill fehlt im Export/);
    });

    test("#1929: fehlt die Vorlage einer der neuen Daten-Dateien, bricht der Export ab", () => {
      abbruch({ ".factory/produkt/vorlagen/.github/wiedervorlagen.json.vorlage": null }, /wiedervorlagen\.json\.vorlage: Vorlage fehlt/);
    });

    test("#1929: ein Muster der Quelle, das im Export Pfade trifft, aber in der protected-paths-Vorlage fehlt, bricht den Export ab (Drift-Schutz)", () => {
      const vorlage = JSON.parse(basisText(".factory/produkt/vorlagen/.github/protected-paths.json.vorlage")) as Record<string, string[]>;
      vorlage.gate = vorlage.gate.filter((m) => m !== "/scripts/check-*.mjs");
      abbruch({ ".factory/produkt/vorlagen/.github/protected-paths.json.vorlage": JSON.stringify(vorlage) }, /protected-paths\.json \(Vorlage\): Muster '\/scripts\/check-\*\.mjs' der Quelle trifft 'scripts\/check-[a-z-]+\.mjs', fehlt aber in der Vorlage/);
    });

    test("#1929: ein erfundenes Muster ohne Treffer in der Vorlage und in CODEOWNERS bricht den Export ab; die CODEOWNERS-Vorlage muss dieselben Muster tragen", () => {
      const vorlage = JSON.parse(basisText(".factory/produkt/vorlagen/.github/protected-paths.json.vorlage")) as Record<string, string[]>;
      vorlage.gate.push("/scripts/gibts-nicht.mjs");
      befund({ ".factory/produkt/vorlagen/.github/protected-paths.json.vorlage": JSON.stringify(vorlage) }, /Muster '\/scripts\/gibts-nicht\.mjs' trifft keinen Exportpfad/);
      befund({ ".factory/produkt/vorlagen/.github/CODEOWNERS.vorlage": `${basisText(".factory/produkt/vorlagen/.github/CODEOWNERS.vorlage")}/extra.json @fluffels\n` }, /CODEOWNERS \(Vorlage\): Muster weichen von protected-paths\.json ab \(nur in CODEOWNERS: \/extra\.json/);
    });

    test("#1929: fehlen Schutzliste und CODEOWNERS im Export (Einträge und Vorlagen entfernt), ist das ein Befund", () => {
      const liste = JSON.parse(basisText(".factory/extraktion.json")) as { eintraege: { muster?: string }[] };
      liste.eintraege = liste.eintraege.filter((e) => e.muster !== ".github/protected-paths.json" && e.muster !== ".github/CODEOWNERS");
      befund(
        {
          ".factory/extraktion.json": JSON.stringify(liste),
          ".factory/produkt/vorlagen/.github/protected-paths.json.vorlage": null,
          ".factory/produkt/vorlagen/.github/CODEOWNERS.vorlage": null,
        },
        /\.github\/protected-paths\.json und \.github\/CODEOWNERS gehören in den Export/,
      );
    });

    test.each([
      [".github/CODEOWNERS", ".factory/produkt/vorlagen/.github/CODEOWNERS.vorlage"],
      [".github/protected-paths.json", ".factory/produkt/vorlagen/.github/protected-paths.json.vorlage"],
    ])("#1929: fehlt nur %s im Export (Eintrag und Vorlage entfernt), ist das ein Befund und keine Ausnahme", (datei, vorlage) => {
      const liste = JSON.parse(basisText(".factory/extraktion.json")) as { eintraege: { muster?: string }[] };
      liste.eintraege = liste.eintraege.filter((e) => e.muster !== datei);
      befund({ ".factory/extraktion.json": JSON.stringify(liste), [vorlage]: null }, /\.github\/protected-paths\.json und \.github\/CODEOWNERS gehören in den Export/);
    });

    test("AK6: ein kubernia in einer Kern-Einheit macht die Literal-Prüfung rot", () => {
      abbruch({ "scripts/check-size.mjs": `${basisText("scripts/check-size.mjs")}\n// kubernia\n` }, /scripts\/check-size\.mjs: kubernia-Literal 'kubernia' \(1x\)/);
    });

    test("eine Vorlage ohne Verwendung ist ein Befund", () => {
      befund({ ".factory/produkt/vorlagen/zzz.txt.vorlage": "x" }, /zzz\.txt\.vorlage: Vorlage ohne Verwendung/);
    });

    test("ein Kern-Schlüssel in der settings-Vorlage ist ein Befund", () => {
      const vorlage = JSON.parse(basisText(".factory/produkt/vorlagen/.claude/settings.json.vorlage")) as Record<string, unknown>;
      befund({ ".factory/produkt/vorlagen/.claude/settings.json.vorlage": JSON.stringify({ ...vorlage, permissions: { allow: [] } }) }, /Kern-Schlüssel 'permissions' gehört nicht in die Vorlage/);
    });

    test("ein relativer Import auf eine nicht exportierte Datei ist ein Befund", () => {
      befund({ "scripts/check-size.mjs": `${basisText("scripts/check-size.mjs")}\nimport "./content-chunks.cjs";\n` }, /scripts\/check-size\.mjs: relativer Import '\.\/content-chunks\.cjs' löst im Export nicht auf/);
    });

    test("ein Paket, das kubernia kennt und die Vorlage nicht, ist ein Befund", () => {
      befund({ "scripts/check-size.mjs": `${basisText("scripts/check-size.mjs")}\nimport "picomatch";\n` }, /scripts\/check-size\.mjs: Paket 'picomatch' steht nicht in der package\.json-Vorlage/);
    });

    test("ein Skriptbezug auf eine nicht exportierte Datei ist ein Befund", () => {
      const pkg = JSON.parse(basisText(".factory/produkt/vorlagen/package.json.vorlage")) as { scripts: Record<string, string> };
      pkg.scripts.forum = "node scripts/mcp-launch.mjs";
      befund({ ".factory/produkt/vorlagen/package.json.vorlage": JSON.stringify(pkg) }, /package\.json: nennt scripts\/mcp-launch\.mjs, das nicht im Export liegt/);
    });

    test("ein lokaler Pfad mit echtem Namen ist ein Befund", () => {
      const pfad = "C" + ":\\" + "Users\\Echt\\x";
      befund({ "scripts/check-size.mjs": `${basisText("scripts/check-size.mjs")}\n// ${pfad}\n` }, /scripts\/check-size\.mjs:\d+: lokaler Pfad \(nutzer\)/);
    });

    test("fehlt struktur.quelle in der Config oder packages im Lock, ist das ein Befund", () => {
      const kub = JSON.parse(basisText(".factory/projekt.json")) as Record<string, unknown>;
      delete kub.struktur;
      befund({ ".factory/projekt.json": JSON.stringify(kub) }, /struktur.quelle fehlt/);
      befund({ ".factory/projekt.json": JSON.stringify({ ...kub, struktur: { quelle: "" } }) }, /struktur\.quelle fehlt/);
      befund({ "package.json": null }, /package\.json: Eintrag ohne Treffer/);
      befund({ "package.json": "{" }, /package\.json: kein gültiges JSON/);
      befund({ "package-lock.json": null }, /package-lock\.json: Datei fehlt/);
      befund({ "package-lock.json": "{" }, /package-lock\.json: kein gültiges JSON/);
      befund({ "package-lock.json": "{}" }, /Lock: keine packages/);
    });

    test("ein Laufwerkspfad mit dem Namen der Quelle oder des Factory-Repos ist ein Befund", () => {
      const L = "C" + ":\\";
      for (const name of ["kubernia", "self-improving-agent-harness-and-factory"]) {
        befund({ "scripts/check-size.mjs": `${basisText("scripts/check-size.mjs")}\n// ${L}foo\\${name}\\x\n` }, /scripts\/check-size\.mjs:\d+: lokaler Pfad \(repo\)/);
      }
    });

    test("ein Lock-Eintrag, der in kubernia fehlt, ist ein Befund", () => {
      const pkg = JSON.parse(basisText(".factory/produkt/vorlagen/package.json.vorlage")) as { devDependencies: Record<string, string> };
      pkg.devDependencies.nichtda = "^1.0.0";
      befund({ ".factory/produkt/vorlagen/package.json.vorlage": JSON.stringify(pkg) }, /Lock: 'nichtda' \(Wurzel\) hat keinen Eintrag/);
    });

    test("fehlen Manifest, Liste oder Daten-Datei, bricht der Export mit einer Meldung ab", () => {
      befund({ ".factory/besitz.json": null }, /\.factory\/besitz\.json: Datei fehlt/);
      befund({ ".factory/extraktion.json": '{"version":1}' }, /Manifest oder Extraktionsliste ohne Liste 'eintraege'/);
      befund({ ".factory/extraktion.json": "{" }, /\.factory\/extraktion\.json: kein gültiges JSON/);
      befund({ "test/harness/kern-links-baseline.json": null }, /kern-links-baseline\.json: nicht lesbar/);
      befund({ "test/harness/kern-abdeckung.json": "{kaputt" }, /kern-abdeckung\.json: Filter der Daten-Datei scheitert/);
    });

    test("kaputte Vorlagen sind Befunde: ungültiges JSON, Config-Fehler, AGENTS.md ohne Marker", () => {
      befund({ ".factory/produkt/vorlagen/.factory/projekt.json.vorlage": "{" }, /projekt\.json\.vorlage: kein gültiges JSON/);
      befund({ ".factory/produkt/vorlagen/.factory/projekt.json.vorlage": '{"berechtigungen":5}' }, /projekt\.json des Exports: .*berechtigungen/);
      befund({ ".factory/produkt/vorlagen/package.json.vorlage": "{" }, /package\.json\.vorlage: kein gültiges JSON/);
      befund({ ".factory/produkt/vorlagen/AGENTS.md.vorlage": "# ohne Marker\n" }, /AGENTS\.md: /);
    });

    test("zwei Quellen auf demselben Zielpfad und eine Binärdatei sind Befunde", () => {
      const liste = JSON.parse(basisText(".factory/extraktion.json")) as { eintraege: object[] };
      liste.eintraege.push({ muster: ".factory/produkt/AGENTS.md", art: "produkt-wurzel", grund: "Test" });
      befund({ ".factory/extraktion.json": JSON.stringify(liste), ".factory/produkt/AGENTS.md": "x" }, /AGENTS\.md: Kollision zweier Quellen/);
      befund({ "test/fixtures/projekt-fremd.json": "a\0b" }, /projekt-fremd\.json: Binärdatei/);
    });

    test("ein Projektwert-Block ohne Ende in einer Besitz-Datei ist ein Befund", () => {
      const p = ".claude/agents/factory-umsetzer.md";
      befund({ [p]: `${basisText(p)}\n<!-- factory:projektwerte:start -->\n` }, /Projektwert-Block/);
    });


    test("ein Glob im Zeilenkommentar verdeckt keinen echten Import, ein Env-Name und eine überlappende Fundstelle zählen", () => {
      const datei = "scripts/projektwerte.mjs";
      const text = basisText(datei);
      assert.match(text, /^\/\/.*\/\*/m, "die Datei trägt einen Zeilenkommentar mit /*");
      befund({ [datei]: `${text}\nimport "./gibt-es-nicht.mjs";\n` }, /scripts\/projektwerte\.mjs: relativer Import '\.\/gibt-es-nicht\.mjs' löst weder/);
      const eingefuegt = text.replace('"./projekt-config-lib.mjs"', '"./gibt-es-nicht.mjs"');
      assert.notEqual(eingefuegt, text);
      befund({ [datei]: eingefuegt }, /scripts\/projektwerte\.mjs: relativer Import '\.\/gibt-es-nicht\.mjs'/);
      befund({ "scripts/besitz-lib.mjs": `${basisText("scripts/besitz-lib.mjs")}\nconst v = process.env.KQ_LANGFUSE;\n` }, /scripts\/besitz-lib\.mjs: kubernia-Literal 'Env'/);
      const doppelt = ex.baueExport({ leser: mitAenderung(leser, { "scripts/besitz-lib.mjs": `${basisText("scripts/besitz-lib.mjs")}\n// feature/kq-12\n` }) });
      assert.deepEqual(doppelt.befunde, ["scripts/besitz-lib.mjs: kubernia-Literal 'KQ' (1x)"]);
    });

    test("ein Teilwort wie kuberniaartig ist kein Literal, ein einzelnes kubernia meldet nur das Literal kubernia", () => {
      const teil = ex.baueExport({ leser: mitAenderung(leser, { "scripts/besitz-lib.mjs": `${basisText("scripts/besitz-lib.mjs")}\n// kuberniaartig\n` }) });
      assert.deepEqual(teil.befunde, []);
      const ganz = ex.baueExport({ leser: mitAenderung(leser, { "scripts/besitz-lib.mjs": `${basisText("scripts/besitz-lib.mjs")}\n// kubernia\n` }) });
      assert.deepEqual(ganz.befunde, ["scripts/besitz-lib.mjs: kubernia-Literal 'kubernia' (1x)"]);
    });

    test("ein nicht auflösbarer Import oder ein unbekanntes Paket in echtem Code ist ein Befund, im Kommentar nicht", () => {
      const lib = "scripts/besitz-lib.mjs";
      befund({ [lib]: `${basisText(lib)}\nimport x from './gibt-es-nicht.mjs';\n` }, /scripts\/besitz-lib\.mjs: relativer Import '\.\/gibt-es-nicht\.mjs' löst weder im Export noch in der Quelle auf/);
      befund({ [lib]: `${basisText(lib)}\nimport 'left-pad';\n` }, /scripts\/besitz-lib\.mjs: Paket 'left-pad' steht weder in der package\.json-Vorlage noch in kubernia/);
      const kommentar = ex.baueExport({ leser: mitAenderung(leser, { [lib]: `${basisText(lib)}\n// import x from './gibt-es-nicht.mjs';\n` }) });
      assert.deepEqual(kommentar.befunde, []);
    });
  });
});

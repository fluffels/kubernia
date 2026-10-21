/* Sync-Werkzeug und Drift-Gate (#1613, ADR 0022 F9): Bearbeitungs-Primitive der Besitz-Lib, Sync in ein synthetisches
 * Fremdrepo (Temp-Ordner, nichts davon liegt im Repo), Drift-Gate und ein Lauf mit dem echten Besitz dieses Repos. */
import { afterEach, describe, test } from "vitest";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as rawLib from "../scripts/besitz-lib.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as rawSync from "../scripts/factory-sync.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as rawDrift from "../scripts/check-factory-drift.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as rawPc from "../scripts/projekt-config-lib.mjs";

interface Span {
  start: number;
  ende: number;
}
interface Lib {
  eolVon(t: string): string;
  einheitHash(e: { pfad: string; block?: string; schluessel?: string }, text: string): string | null;
  jsonSchluesselSpanne(t: string, k: string): Span | null;
  setzeJsonSchluessel(t: string, k: string, wert: string): string;
  setzeBlock(t: string, block: string, blockText: string): string;
  markerStart(id: string): string;
  markerEnde(id: string): string;
}
interface Opt {
  cwd?: string;
  out?: (s: string) => void;
  err?: (s: string) => void;
}
interface Sync {
  PROJEKT_PFAD: string;
  cli(argv: string[], opt?: Opt): number;
}
interface Drift {
  pruefeDrift(lies: (p: string) => string | null): { entfaellt: boolean; fehler: string[]; einheiten: number };
  cli(argv: string[], opt?: Opt): number;
}
const lib = rawLib as unknown as Lib;
const sync = rawSync as unknown as Sync;
const drift = rawDrift as unknown as Drift;
const pc = rawPc as unknown as { PROJEKT_CONFIG: string };

const WURZEL = fileURLToPath(new URL("../", import.meta.url));
const temps: string[] = [];
afterEach(() => {
  for (const d of temps.splice(0)) rmSync(d, { recursive: true, force: true });
});
const tmp = (): string => {
  const d = mkdtempSync(join(tmpdir(), "kq-fsync-"));
  temps.push(d);
  return d;
};
const schreibe = (wurzel: string, rel: string, text: string): void => {
  const voll = join(wurzel, ...rel.split("/"));
  mkdirSync(dirname(voll), { recursive: true });
  writeFileSync(voll, text);
};
const lies = (wurzel: string, rel: string): string => readFileSync(join(wurzel, ...rel.split("/")), "utf8");

// ── Besitz-Lib: Primitive ─────────────────────────────────────────────────────

describe("setzeBlock", () => {
  const S = lib.markerStart("b");
  const E = lib.markerEnde("b");
  test("ersetzt Start- bis einschließlich Ende-Marker, Umgebung bleibt byte-gleich", () => {
    const r = lib.setzeBlock(`vor\n${S}\nalt\n${E}\nnach\n`, "b", `${S}\nneu\n${E}`);
    assert.equal(r, `vor\n${S}\nneu\n${E}\nnach\n`);
  });
  test("fehlende, doppelte oder vertauschte Marker sind ein Fehler", () => {
    assert.throws(() => lib.setzeBlock("nichts", "b", "x"), /genau einmal/);
    assert.throws(() => lib.setzeBlock(`${S}${S}${E}`, "b", "x"), /genau einmal/);
    assert.throws(() => lib.setzeBlock(`${E}${S}`, "b", "x"), /vor dem Start/);
  });
});

describe("jsonSchluesselSpanne / setzeJsonSchluessel", () => {
  const T = '{\n    "a": 1,\n    "b": {"x": [1, "}", {"y": 2}]},\n    "c": "s\\"t"\n}\n';
  test("Spanne umfasst den Werttext (verschachtelt, Klammern und Anführungszeichen in Strings)", () => {
    const sp = lib.jsonSchluesselSpanne(T, "b");
    assert.ok(sp);
    assert.equal(T.slice(sp.start, sp.ende), '{"x": [1, "}", {"y": 2}]}');
    const c = lib.jsonSchluesselSpanne(T, "c");
    assert.equal(T.slice(c?.start, c?.ende), '"s\\"t"');
    assert.equal(lib.jsonSchluesselSpanne(T, "fehlt"), null);
  });
  test("ersetzen: nur der Werttext ändert sich, alles andere byte-gleich", () => {
    assert.equal(lib.setzeJsonSchluessel(T, "a", "[2]"), T.replace('"a": 1', '"a": [2]'));
  });
  test("fehlender Schlüssel wird als letzte Eigenschaft in der Einrückung der ersten eingefügt", () => {
    const r = lib.setzeJsonSchluessel(T, "z", "true");
    assert.equal(r, '{\n    "a": 1,\n    "b": {"x": [1, "}", {"y": 2}]},\n    "c": "s\\"t",\n    "z": true\n}\n');
    assert.equal((JSON.parse(r) as { z: boolean }).z, true);
    assert.equal(lib.setzeJsonSchluessel('{"a": 1}', "z", "2"), '{"a": 1, "z": 2}');
    assert.equal(lib.setzeJsonSchluessel("{}", "z", "2"), '{\n  "z": 2\n}');
    assert.equal(lib.setzeJsonSchluessel('{\r\n  "a": 1\r\n}', "z", "2"), '{\r\n  "a": 1,\r\n  "z": 2\r\n}');
  });
  test("doppelter Schlüssel oben, ungültiges JSON und Wurzel ohne Objekt sind ein Fehler", () => {
    assert.throws(() => lib.jsonSchluesselSpanne('{"a":1,"a":2}', "a"), /doppelter Schlüssel/);
    assert.throws(() => lib.jsonSchluesselSpanne("{kaputt", "a"));
    assert.throws(() => lib.jsonSchluesselSpanne("[1]", "a"), /kein Objekt/);
    assert.doesNotThrow(() => lib.jsonSchluesselSpanne('{"a":{"a":1},"b":1}', "b"));
  });
});

describe("einheitHash", () => {
  test("CRLF und LF liefern denselben Hash, anderer Inhalt einen anderen, nicht Auflösbares null", () => {
    const e = { pfad: "x" };
    assert.equal(lib.einheitHash(e, "a\r\nb\r\n"), lib.einheitHash(e, "a\nb\n"));
    assert.notEqual(lib.einheitHash(e, "a\nb\n"), lib.einheitHash(e, "a\nc\n"));
    assert.equal(lib.einheitHash({ pfad: "x", schluessel: "k" }, "{}"), null);
    assert.equal(lib.einheitHash({ pfad: "x", block: "b" }, "ohne"), null);
  });
});

// ── Fremdrepo-Fixture ─────────────────────────────────────────────────────────

const blockText = (inhalt: string): string => `${lib.markerStart("stopps")}\n${inhalt}\n${lib.markerEnde("stopps")}`;
const MANIFEST = {
  version: 1,
  eintraege: [
    { pfad: "scripts/a.mjs", ring: "kern", quelle: "t" },
    { pfad: "AGENTS.md", block: "stopps", ring: "kern", quelle: "t" },
    { pfad: ".claude/settings.json", schluessel: "permissions", ring: "kern", quelle: "t" },
    { pfad: ".claude/settings.json", schluessel: "sandbox", ring: "kern", quelle: "t" },
  ],
};
const QUELLE_SETTINGS = '{\n  "model": "quelle-modell",\n  "permissions": {\n    "allow": ["Bash(ls)"]\n  },\n  "sandbox": { "enabled": true }\n}\n';
const ZIEL_AGENTS = `# Projekt\n\nEigener Text.\n\n${blockText("alter Stopp")}\n\nMehr Projekttext.\n`;
const ZIEL_SETTINGS = '{\n    "model": "opus",\n    "enabledPlugins": {"x": true},\n    "permissions": {"allow": []}\n}\n';

function baueQuelle(): string {
  const q = tmp();
  schreibe(q, ".factory/besitz.json", JSON.stringify(MANIFEST, null, 2) + "\n");
  schreibe(q, "scripts/a.mjs", "export const a = 1;\n");
  schreibe(q, "AGENTS.md", `# Quelle\n\n${blockText("neuer Stopp")}\n`);
  schreibe(q, ".claude/settings.json", QUELLE_SETTINGS);
  return q;
}
function baueZiel(): string {
  const z = tmp();
  schreibe(z, "AGENTS.md", ZIEL_AGENTS);
  schreibe(z, ".claude/settings.json", ZIEL_SETTINGS);
  schreibe(z, "src/eigen.ts", "// Projekt\n");
  return z;
}
interface Lauf {
  code: number;
  out: string;
  err: string;
}
function laufe(argv: string[], cwd?: string): Lauf {
  const out: string[] = [];
  const err: string[] = [];
  const code = sync.cli(argv, { cwd, out: (s) => out.push(s), err: (s) => err.push(s) });
  return { code, out: out.join("\n"), err: err.join("\n") };
}
const alleDateien = (z: string): string[] =>
  [".factory/besitz.json", ".factory/sync-stand.json", "scripts/a.mjs", "AGENTS.md", ".claude/settings.json", "src/eigen.ts"].map((p) => `${p}=${existsSync(join(z, p)) ? lies(z, p) : "-"}`);

describe("factory-sync (Fremdrepo-Fixture)", () => {
  test("überschreibt nur Besitz, Projektteile bleiben byte-gleich, Sync-Stand ohne absoluten Pfad", () => {
    const q = baueQuelle();
    const z = baueZiel();
    const r = laufe(["--quelle", q, "--ziel", z]);
    assert.equal(r.code, 0, r.err);
    assert.equal(lies(z, "scripts/a.mjs"), "export const a = 1;\n");
    assert.equal(lies(z, "AGENTS.md"), ZIEL_AGENTS.replace("alter Stopp", "neuer Stopp"));
    const s = JSON.parse(lies(z, ".claude/settings.json")) as Record<string, unknown>;
    assert.deepEqual(s.permissions, { allow: ["Bash(ls)"] });
    assert.deepEqual(s.sandbox, { enabled: true });
    assert.equal(s.model, "opus");
    assert.deepEqual(s.enabledPlugins, { x: true });
    // Projektschlüssel im eigenen Format: Zeilen vor und zwischen den Besitz-Schlüsseln bleiben wörtlich.
    assert.ok(lies(z, ".claude/settings.json").startsWith('{\n    "model": "opus",\n    "enabledPlugins": {"x": true},\n    "permissions": {\n'));
    assert.equal(lies(z, "src/eigen.ts"), "// Projekt\n");
    assert.equal(lies(z, ".factory/besitz.json"), lies(q, ".factory/besitz.json"));
    const stand = lies(z, ".factory/sync-stand.json");
    assert.ok(!stand.includes(q) && !stand.includes(z) && !/[A-Za-z]:[\\/]/.test(stand), "Sync-Stand trägt einen Pfad");
    const st = JSON.parse(stand) as { version: number; manifest: string; einheiten: Record<string, string> };
    assert.deepEqual(Object.keys(st.einheiten), ["scripts/a.mjs", "AGENTS.md#stopps", ".claude/settings.json#/permissions", ".claude/settings.json#/sandbox"].sort());
    assert.ok(!existsSync(join(z, ".factory/projekt.json")), "projekt.json wurde angelegt");
  });

  test("zweiter Lauf schreibt nichts, alle Dateien inklusive Sync-Stand bleiben byte-gleich", () => {
    const q = baueQuelle();
    const z = baueZiel();
    assert.equal(laufe(["--quelle", q, "--ziel", z]).code, 0);
    const vorher = alleDateien(z);
    const r = laufe(["--quelle", q, "--ziel", z]);
    assert.equal(r.code, 0, r.err);
    assert.match(r.out, /0 geändert/);
    assert.deepEqual(alleDateien(z), vorher);
  });

  test("kaputter alter Sync-Stand im Ziel wird überschrieben, der Sync läuft durch", () => {
    const q = baueQuelle();
    const z = baueZiel();
    schreibe(z, ".factory/sync-stand.json", "{kaputt");
    const r = laufe(["--quelle", q, "--ziel", z]);
    assert.equal(r.code, 0, r.err);
    assert.equal((JSON.parse(lies(z, ".factory/sync-stand.json")) as { version: number }).version, 1);
  });

  test("--trocken schreibt nichts", () => {
    const q = baueQuelle();
    const z = baueZiel();
    const vorher = alleDateien(z);
    const r = laufe(["--quelle", q, "--ziel", z, "--trocken"]);
    assert.equal(r.code, 0, r.err);
    assert.match(r.out, /würde geändert: AGENTS\.md/);
    assert.deepEqual(alleDateien(z), vorher);
  });

  test("CRLF-Ziel mit gleichem Inhalt bleibt unberührt, mit anderem Inhalt wird CRLF geschrieben", () => {
    const q = baueQuelle();
    const z = baueZiel();
    assert.equal(laufe(["--quelle", q, "--ziel", z]).code, 0);
    const crlf = (t: string): string => t.replace(/\n/g, "\r\n");
    for (const p of ["scripts/a.mjs", "AGENTS.md", ".claude/settings.json", ".factory/besitz.json", ".factory/sync-stand.json"]) schreibe(z, p, crlf(lies(z, p)));
    const vorher = alleDateien(z);
    const r = laufe(["--quelle", q, "--ziel", z]);
    assert.match(r.out, /0 geändert/);
    assert.deepEqual(alleDateien(z), vorher);
    schreibe(q, "scripts/a.mjs", "export const a = 2;\n");
    assert.equal(laufe(["--quelle", q, "--ziel", z]).code, 0);
    assert.equal(lies(z, "scripts/a.mjs"), "export const a = 2;\r\n");
    assert.equal(lies(z, "AGENTS.md"), crlf(ZIEL_AGENTS.replace("alter Stopp", "neuer Stopp")));
  });

  test("fehlende settings.json wird mit den eigenen Schlüsseln angelegt, fehlender Schlüssel ergänzt", () => {
    const q = baueQuelle();
    const z = baueZiel();
    rmSync(join(z, ".claude/settings.json"));
    assert.equal(laufe(["--quelle", q, "--ziel", z]).code, 0);
    assert.deepEqual(JSON.parse(lies(z, ".claude/settings.json")), { permissions: { allow: ["Bash(ls)"] }, sandbox: { enabled: true } });
    schreibe(z, ".claude/settings.json", '{\n  "model": "m",\n  "permissions": {}\n}\n');
    assert.equal(laufe(["--quelle", q, "--ziel", z]).code, 0);
    assert.deepEqual(JSON.parse(lies(z, ".claude/settings.json")), { model: "m", permissions: { allow: ["Bash(ls)"] }, sandbox: { enabled: true } });
  });

  test("entfallene Einheit wird gemeldet, ihre Datei bleibt", () => {
    const q = baueQuelle();
    const z = baueZiel();
    assert.equal(laufe(["--quelle", q, "--ziel", z]).code, 0);
    const kleiner = { version: 1, eintraege: MANIFEST.eintraege.filter((e) => e.pfad !== "scripts/a.mjs") };
    schreibe(q, ".factory/besitz.json", JSON.stringify(kleiner, null, 2) + "\n");
    const r = laufe(["--quelle", q, "--ziel", z]);
    assert.equal(r.code, 0, r.err);
    assert.match(r.out, /Einheit 'scripts\/a\.mjs' ist kein Besitz mehr/);
    assert.equal(lies(z, "scripts/a.mjs"), "export const a = 1;\n");
  });

  describe("Negativfälle schreiben nichts", () => {
    const abgelehnt = (q: string, z: string, muster: RegExp): void => {
      const vorher = alleDateien(z);
      const r = laufe(["--quelle", q, "--ziel", z]);
      assert.equal(r.code, 1, r.out);
      assert.match(r.err, muster);
      assert.match(r.err, /nichts geschrieben/);
      assert.deepEqual(alleDateien(z), vorher);
    };
    test("Marker fehlen im Ziel", () => {
      const z = baueZiel();
      schreibe(z, "AGENTS.md", "# Projekt ohne Marker\n");
      abgelehnt(baueQuelle(), z, /AGENTS\.md: Block 'stopps': .*genau einmal/);
    });
    test("Ziel-JSON ungültig oder mit doppeltem Schlüssel", () => {
      const q = baueQuelle();
      const z = baueZiel();
      schreibe(z, ".claude/settings.json", "{kaputt");
      abgelehnt(q, z, /settings\.json/);
      schreibe(z, ".claude/settings.json", '{"permissions":{},"permissions":{}}');
      abgelehnt(q, z, /doppelter Schlüssel/);
    });
    test("Manifest-Pfad mit '..' oder absolut", () => {
      for (const pfad of ["../aussen.txt", "/etc/passwd"]) {
        const q = baueQuelle();
        schreibe(q, ".factory/besitz.json", JSON.stringify({ version: 1, eintraege: [{ pfad, ring: "kern", quelle: "t" }] }));
        abgelehnt(q, baueZiel(), /Pfad unsicher/);
      }
    });
    test("ungültiges Quell-Manifest und Besitz-Datei fehlt in der Quelle", () => {
      const q = baueQuelle();
      schreibe(q, ".factory/besitz.json", "kein json");
      abgelehnt(q, baueZiel(), /kein gültiges JSON/);
      const q2 = baueQuelle();
      rmSync(join(q2, "scripts/a.mjs"));
      abgelehnt(q2, baueZiel(), /Pfad existiert nicht/);
    });
    test("projekt.json ist nie Besitz", () => {
      const q = baueQuelle();
      schreibe(q, ".factory/projekt.json", "{}");
      schreibe(q, ".factory/besitz.json", JSON.stringify({ version: 1, eintraege: [{ pfad: ".factory/projekt.json", ring: "kern", quelle: "t" }] }));
      abgelehnt(q, baueZiel(), /nie Besitz/);
    });
    test("Quell-Manifest ohne Liste eintraege: Exit 1 statt Absturz", () => {
      const q = baueQuelle();
      schreibe(q, ".factory/besitz.json", '{"version":1}');
      abgelehnt(q, baueZiel(), /keine Liste 'eintraege'/);
    });
    test("Quelle gleich Ziel", () => {
      const q = baueQuelle();
      const r = laufe(["--quelle", q, "--ziel", q]);
      assert.equal(r.code, 1);
      assert.match(r.err, /derselbe Ordner/);
    });
    test("Aufruf ohne --quelle, mit unbekannter Option oder fehlendem Ordner: Exit 2", () => {
      assert.equal(laufe([]).code, 2);
      assert.match(laufe([]).err, /--quelle/);
      assert.equal(laufe(["--quelle", baueQuelle(), "--wat"]).code, 2);
      assert.equal(laufe(["--quelle", join(tmp(), "gibt-es-nicht"), "--ziel", baueZiel()]).code, 2);
    });
  });

  test.skipIf(process.platform === "win32")("neue Datei übernimmt das Ausführbit der Quelle", () => {
    const q = baueQuelle();
    chmodSync(join(q, "scripts/a.mjs"), 0o755);
    const z = baueZiel();
    assert.equal(laufe(["--quelle", q, "--ziel", z]).code, 0);
    assert.ok((statSync(join(z, "scripts/a.mjs")).mode & 0o111) !== 0);
  });
});

// ── Drift-Gate ────────────────────────────────────────────────────────────────

function gesyncterZiel(): string {
  const q = baueQuelle();
  const z = baueZiel();
  assert.equal(laufe(["--quelle", q, "--ziel", z]).code, 0);
  return z;
}
function drift1(z: string): { code: number; out: string; err: string } {
  const out: string[] = [];
  const err: string[] = [];
  const code = drift.cli(["--wurzel", z], { out: (s) => out.push(s), err: (s) => err.push(s) });
  return { code, out: out.join("\n"), err: err.join("\n") };
}

describe("pruefeErgebnis (Selbstprüfung des Syncs)", () => {
  const pe = (rawSync as unknown as { pruefeErgebnis: (p: string, e: unknown[], src: string, ziel: string | null, erg: string) => string[] }).pruefeErgebnis;
  const ein = [{ pfad: "s.json", schluessel: "k" }];
  const src = '{"k":1}';
  test("korrektes Ergebnis ist grün", () => {
    assert.deepEqual(pe("s.json", ein, src, '{"p":2,"k":0}', '{"p":2,"k":1}'), []);
  });
  test("Besitz-Schlüssel weicht ab, Projektschlüssel verändert, neuer Schlüssel ohne Besitz", () => {
    assert.match(pe("s.json", ein, src, '{"p":2}', '{"p":2,"k":9}').join(), /Schlüssel 'k' weicht/);
    assert.match(pe("s.json", ein, src, '{"p":2}', '{"p":3,"k":1}').join(), /Projektschlüssel 'p' wurde verändert/);
    assert.match(pe("s.json", ein, src, '{"p":2}', '{"p":2,"k":1,"neu":1}').join(), /'neu' ist neu und kein Besitz/);
  });
  test("Block weicht von der Quelle ab", () => {
    const b = [{ pfad: "a.md", block: "x" }];
    const blk = (t: string): string => `${lib.markerStart("x")}${t}${lib.markerEnde("x")}`;
    assert.deepEqual(pe("a.md", b, blk("1"), null, `vor${blk("1")}`), []);
    assert.match(pe("a.md", b, blk("1"), null, `vor${blk("2")}`).join(), /a\.md#x: Block weicht/);
  });
});

describe("check-factory-drift", () => {
  test("grün nach dem Sync; ohne Sync-Stand entfällt die Prüfung mit einer Zeile (Exit 0)", () => {
    const z = gesyncterZiel();
    const r = drift1(z);
    assert.equal(r.code, 0, r.err);
    assert.match(r.out, /4 Einheiten ohne Drift/);
    rmSync(join(z, ".factory/sync-stand.json"));
    const e = drift1(z);
    assert.equal(e.code, 0);
    assert.match(e.out, /Prüfung entfällt/);
  });

  const rot = (z: string, muster: RegExp): void => {
    const r = drift1(z);
    assert.equal(r.code, 1, r.out);
    assert.match(r.err, muster);
    assert.match(r.err, /upstream/);
    assert.match(r.err, /\.factory\/projekt\.json/);
  };
  test("rot mit dem Weg bei geänderter Datei", () => {
    const z = gesyncterZiel();
    schreibe(z, "scripts/a.mjs", "export const a = 99;\n");
    rot(z, /scripts\/a\.mjs: Besitz wurde im Projekt verändert/);
  });
  test("rot bei geändertem Block-Inhalt", () => {
    const z = gesyncterZiel();
    schreibe(z, "AGENTS.md", lies(z, "AGENTS.md").replace("neuer Stopp", "eigener Stopp"));
    rot(z, /AGENTS\.md#stopps: Besitz wurde/);
  });
  test("rot bei geänderten permissions (JSON-Schlüssel-Besitz), grün bei Projektschlüssel", () => {
    const z = gesyncterZiel();
    const orig = lies(z, ".claude/settings.json");
    schreibe(z, ".claude/settings.json", orig.replace('"model": "opus"', '"model": "anderes"'));
    assert.equal(drift1(z).code, 0, "Projektschlüssel darf sich ändern");
    schreibe(z, ".claude/settings.json", orig.replace("Bash(ls)", "Bash(rm -rf /)"));
    rot(z, /settings\.json#\/permissions: Besitz wurde/);
  });
  test("rot bei gelöschter Besitz-Datei, entferntem Marker und gelöschtem Schlüssel", () => {
    const z = gesyncterZiel();
    rmSync(join(z, "scripts/a.mjs"));
    rot(z, /scripts\/a\.mjs: Besitz fehlt/);
    const z2 = gesyncterZiel();
    schreibe(z2, "AGENTS.md", "# ohne Marker\n");
    rot(z2, /AGENTS\.md#stopps: Besitz fehlt/);
    const z3 = gesyncterZiel();
    schreibe(z3, ".claude/settings.json", '{"model": "x"}');
    rot(z3, /settings\.json#\/sandbox: Besitz fehlt/);
  });
  test("rot bei entferntem Manifest-Eintrag und kaputtem Sync-Stand", () => {
    const z = gesyncterZiel();
    const m = JSON.parse(lies(z, ".factory/besitz.json")) as typeof MANIFEST;
    m.eintraege.pop();
    schreibe(z, ".factory/besitz.json", JSON.stringify(m, null, 2) + "\n");
    rot(z, /besitz\.json weicht vom Sync-Stand ab/);
    const z2 = gesyncterZiel();
    schreibe(z2, ".factory/sync-stand.json", "{kaputt");
    rot(z2, /kein gültiges JSON/);
    schreibe(z2, ".factory/sync-stand.json", '{"version":1}');
    rot(z2, /kaputt/);
  });
  test("rot bei gelöschtem Manifest trotz Sync-Stand und bei Einheit ohne Eintrag im Sync-Stand", () => {
    const z = gesyncterZiel();
    const st = JSON.parse(lies(z, ".factory/sync-stand.json")) as { einheiten: Record<string, string> };
    delete st.einheiten["scripts/a.mjs"];
    schreibe(z, ".factory/sync-stand.json", JSON.stringify(st));
    rot(z, /scripts\/a\.mjs: im Manifest, aber nicht im Sync-Stand/);
    const z2 = gesyncterZiel();
    rmSync(join(z2, ".factory/besitz.json"));
    rot(z2, /besitz\.json fehlt/);
  });
  test("Manifest und Sync-Stand listen verschiedene Einheiten", () => {
    const z = gesyncterZiel();
    const st = JSON.parse(lies(z, ".factory/sync-stand.json")) as { einheiten: Record<string, string> };
    st.einheiten["scripts/extra.mjs"] = "sha256:00";
    schreibe(z, ".factory/sync-stand.json", JSON.stringify(st));
    rot(z, /scripts\/extra\.mjs: im Sync-Stand, aber nicht im Manifest/);
  });
  test("grün bei Änderung außerhalb des Blocks und bei reinem CRLF", () => {
    const z = gesyncterZiel();
    schreibe(z, "AGENTS.md", lies(z, "AGENTS.md").replace("Eigener Text.", "Ganz anderer Text."));
    assert.equal(drift1(z).code, 0);
    for (const p of ["scripts/a.mjs", "AGENTS.md", ".claude/settings.json", ".factory/besitz.json"]) schreibe(z, p, lies(z, p).replace(/\n/g, "\r\n"));
    assert.equal(drift1(z).code, 0);
  });
  test("pruefeDrift lehnt einen unsicheren Manifest-Pfad ab statt außerhalb zu lesen", () => {
    const z = gesyncterZiel();
    const stand = JSON.parse(lies(z, ".factory/sync-stand.json")) as { manifest: string; einheiten: Record<string, string> };
    const m = JSON.stringify({ version: 1, eintraege: [{ pfad: "../x", ring: "kern", quelle: "t" }] });
    stand.einheiten = { "../x": "sha256:00" };
    const gelesen: string[] = [];
    // Jeder andere Pfad liefert Text: nur die Pfad-Sperre verhindert, dass "../x" gelesen wird.
    const lesen = (p: string): string | null => {
      gelesen.push(p);
      return p === ".factory/besitz.json" ? m : p === ".factory/sync-stand.json" ? JSON.stringify(stand) : "irgendein Text";
    };
    stand.manifest = (rawLib as unknown as { textHash(t: string): string }).textHash(m);
    const r = drift.pruefeDrift(lesen);
    assert.ok(r.fehler.some((f) => /\.\.\/x: Besitz fehlt/.test(f)), r.fehler.join("|"));
    assert.ok(!gelesen.includes("../x"), "unsicherer Pfad wurde gelesen");
  });
  test("Aufruf mit unbekannter Option: Exit 2", () => {
    assert.equal(drift.cli(["--wat"], { err: () => undefined }), 2);
  });
});

// ── Projektwerte (#1746): Sync rendert aus der Config des Ziels, das Drift-Gate prüft sie immer ──────────

const PW = { start: "<!-- factory:projektwerte:start -->", ende: "<!-- factory:projektwerte:end -->" };
const PW_MANIFEST = {
  version: 1,
  eintraege: [
    { pfad: ".claude/agents/w.md", ring: "kern", quelle: "t" },
    { pfad: "docs/d.md", block: "pw", ring: "kern", quelle: "t" },
  ],
};
const pwBlock = (inhalt: string): string => `${lib.markerStart("pw")}\n${PW.start}\n${inhalt}${PW.ende}\n${lib.markerEnde("pw")}`;
const PW_AGENT = "---\n# factory:projektwert agenten.planer\nname: quelle-planer\nmodel: opus\n---\n# Agent\n";
function pwConfig(planer: string): string {
  const echt = JSON.parse(readFileSync(join(WURZEL, ".factory/projekt.json"), "utf8")) as { repo: string; agenten: Record<string, string> };
  echt.repo = "acme/demo";
  echt.agenten.planer = planer;
  return JSON.stringify(echt, null, 2) + "\n";
}
function pwQuelle(): string {
  const q = tmp();
  schreibe(q, ".factory/besitz.json", JSON.stringify(PW_MANIFEST, null, 2) + "\n");
  schreibe(q, ".claude/agents/w.md", PW_AGENT);
  schreibe(q, "docs/d.md", `# D\n\n${pwBlock("Quellwert\n")}\n`);
  return q;
}
function pwZiel(planer = "wk-planer"): string {
  const z = tmp();
  schreibe(z, ".factory/projekt.json", pwConfig(planer));
  schreibe(z, "docs/d.md", `# Ziel\n\n${pwBlock("alt\n")}\n\nProjekttext\n`);
  return z;
}

describe("Projektwerte im Sync und im Drift-Gate (#1746)", () => {
  test("der Config-Pfad hat eine Quelle: sync-Alias und projekt-config-lib sind gleich (#1821)", () => {
    assert.equal(sync.PROJEKT_PFAD, pc.PROJEKT_CONFIG);
  });

  test("K1: Ganze Datei und Block-Einheit bekommen die Werte aus der Config des Ziels, der zweite Lauf schreibt nichts", () => {
    const q = pwQuelle();
    const z = pwZiel();
    const r = laufe(["--quelle", q, "--ziel", z]);
    assert.equal(r.code, 0, r.err);
    assert.match(lies(z, ".claude/agents/w.md"), /\nname: wk-planer\n/);
    assert.match(lies(z, "docs/d.md"), /\| `agenten\.planer` \| `wk-planer` \|/);
    assert.ok(lies(z, "docs/d.md").endsWith("\n\nProjekttext\n"));
    assert.match(lies(q, ".claude/agents/w.md"), /name: quelle-planer/, "die Quelle bleibt unverändert");
    const vorher = [lies(z, ".claude/agents/w.md"), lies(z, "docs/d.md"), lies(z, ".factory/sync-stand.json")];
    const zwei = laufe(["--quelle", q, "--ziel", z]);
    assert.match(zwei.out, /0 geändert/);
    assert.deepEqual([lies(z, ".claude/agents/w.md"), lies(z, "docs/d.md"), lies(z, ".factory/sync-stand.json")], vorher);
  });

  test("der Sync-Stand-Hash ist der Hash des Quelltextes mit geleerten Werten, zwei Ziele mit anderen Werten teilen ihn", () => {
    const q = pwQuelle();
    const a = pwZiel("eins-planer");
    const b = pwZiel("zwei-planer");
    assert.equal(laufe(["--quelle", q, "--ziel", a]).code, 0);
    assert.equal(laufe(["--quelle", q, "--ziel", b]).code, 0);
    const stand = (z: string): Record<string, string> => (JSON.parse(lies(z, ".factory/sync-stand.json")) as { einheiten: Record<string, string> }).einheiten;
    assert.deepEqual(stand(a), stand(b));
    assert.equal(stand(a)[".claude/agents/w.md"], lib.einheitHash({ pfad: ".claude/agents/w.md" }, PW_AGENT));
    assert.equal(drift1(a).code, 0, drift1(a).err);
    assert.equal(drift1(b).code, 0, drift1(b).err);
  });

  test("Ziel ohne Config, Marker ohne Ende und fehlender Schlüssel brechen ab, nichts wird geschrieben", () => {
    const ohneConfig = pwZiel();
    rmSync(join(ohneConfig, ".factory/projekt.json"));
    const faelle: [string, string, RegExp][] = [
      ["ohne Config", ohneConfig, /Projekt-Config fehlt/],
      ["Marker ohne Ende", pwZiel(), /w\.md:2: .*kein Ende/],
      ["fehlender Schlüssel", pwZiel(), /agenten\.fehlt.*Fix:/s],
    ];
    for (const [name, z, muster] of faelle) {
      const q = pwQuelle();
      if (name === "Marker ohne Ende") schreibe(q, ".claude/agents/w.md", PW_AGENT.replace("---\n# factory:projektwert agenten.planer\nname: quelle-planer\nmodel: opus\n---\n", `---\n${PW.start}\nname: x\n---\n`));
      if (name === "fehlender Schlüssel") schreibe(q, ".claude/agents/w.md", PW_AGENT.replace("agenten.planer", "agenten.fehlt"));
      const vorher = z === ohneConfig ? [] : [lies(z, "docs/d.md")];
      const r = laufe(["--quelle", q, "--ziel", z]);
      assert.equal(r.code, 1, name);
      assert.match(r.err, muster, name);
      assert.match(r.err, /nichts geschrieben/, name);
      assert.ok(!existsSync(join(z, ".claude/agents/w.md")), `${name}: Datei geschrieben`);
      if (vorher.length > 0) assert.equal(lies(z, "docs/d.md"), vorher[0], name);
    }
  });

  test("eine Fehlermeldung, die schon mit dem Pfad beginnt, bekommt ihn nicht doppelt vorangestellt (#1821)", () => {
    const q = pwQuelle();
    schreibe(q, ".claude/agents/w.md", PW_AGENT.replace("agenten.planer", "agenten.fehlt"));
    const r = laufe(["--quelle", q, "--ziel", pwZiel()]);
    assert.equal(r.code, 1);
    const zeile = r.err.split("\n").find((z) => z.includes("agenten.fehlt")) ?? "";
    assert.equal(zeile.split(".claude/agents/w.md").length - 1, 1, zeile);
    const z = pwZiel();
    rmSync(join(z, ".factory/projekt.json"));
    assert.match(laufe(["--quelle", pwQuelle(), "--ziel", z]).err, /\.claude\/agents\/w\.md: Projekt-Config fehlt/);
  });

  test("ein Pfad mit 'weicht von' löst keinen --write-Hinweis im Drift-Gate aus (#1821)", () => {
    const z = pwZiel();
    assert.equal(laufe(["--quelle", pwQuelle(), "--ziel", z]).code, 0);
    rmSync(join(z, ".factory/sync-stand.json"));
    schreibe(z, ".claude/agents/weicht von.md", `${PW.start}\nohne Ende\n`);
    const r = drift1(z);
    assert.equal(r.code, 1);
    assert.match(r.err, /kein Ende/);
    assert.doesNotMatch(r.err, /projektwerte\.mjs --write/);
  });

  test("Fixture-Repos ohne Projektwert-Stellen brauchen keine Config", () => {
    const z = baueZiel();
    assert.ok(!existsSync(join(z, ".factory/projekt.json")));
    assert.equal(laufe(["--quelle", baueQuelle(), "--ziel", z]).code, 0);
  });

  test("K2: das Drift-Gate ist ohne Sync-Stand rot, wenn ein Wert von der Config abweicht, und nennt den Weg", () => {
    const q = pwQuelle();
    const z = pwZiel();
    assert.equal(laufe(["--quelle", q, "--ziel", z]).code, 0);
    rmSync(join(z, ".factory/sync-stand.json"));
    const gruen = drift1(z);
    assert.equal(gruen.code, 0, gruen.err);
    assert.match(gruen.out, /Besitz-Prüfung entfällt/);
    schreibe(z, ".claude/agents/w.md", lies(z, ".claude/agents/w.md").replace("name: wk-planer", "name: von-hand"));
    const rot = drift1(z);
    assert.equal(rot.code, 1);
    assert.match(rot.err, /w\.md:3: Projektwert 'agenten\.planer'/);
    assert.match(rot.err, /projektwerte\.mjs --write/);
    assert.match(rot.err, /\.factory\/projekt\.json/);
    schreibe(z, ".claude/agents/w.md", lies(z, ".claude/agents/w.md").replace("name: von-hand", "name: wk-planer"));
    schreibe(z, "docs/d.md", lies(z, "docs/d.md").replace("`wk-planer` |", "`manipuliert` |"));
    const block = drift1(z);
    assert.match(block.err, /Projektwert-Block weicht/);
    assert.match(block.err, /projektwerte\.mjs --write/);
    schreibe(z, "docs/d.md", `${lies(z, "docs/d.md")}\n<!-- factory:projektwerte:start -->\nohne Ende\n`);
    const kaputt = drift1(z);
    assert.equal(kaputt.code, 1);
    assert.match(kaputt.err, /kein Ende/);
    assert.doesNotMatch(kaputt.err, /projektwerte\.mjs --write/);
  });

  test("mit Sync-Stand: ein manipulierter Wert ist nur Projektwert-Drift, der Besitz-Hash bleibt grün; ein entfernter Marker ist Besitz-Drift", () => {
    const z = pwZiel();
    assert.equal(laufe(["--quelle", pwQuelle(), "--ziel", z]).code, 0);
    schreibe(z, ".claude/agents/w.md", lies(z, ".claude/agents/w.md").replace("name: wk-planer", "name: von-hand"));
    const r = drift1(z);
    assert.equal(r.code, 1);
    assert.doesNotMatch(r.err, /Besitz wurde im Projekt verändert/);
    schreibe(z, ".claude/agents/w.md", lies(z, ".claude/agents/w.md").replace("# factory:projektwert agenten.planer\n", ""));
    assert.match(drift1(z).err, /Besitz wurde im Projekt verändert/, "entfernter Marker ändert den normalisierten Text");
  });
});

// ── Echter Besitz dieses Repos in ein Fremdrepo ───────────────────────────────

// Prozess-Test (kopiert den Besitz, startet das Drift-Gate zweimal): unter Last braucht er mehr als die 5 s des Defaults.
describe("echtes Fremdrepo mit dem Besitz dieses Repos", { timeout: 30_000 }, () => {
  test("Sync, Drift-Gate aus der Zielkopie grün (Import-Hülle trägt), Besitz-Änderung macht es rot", () => {
    const z = tmp();
    schreibe(z, "AGENTS.md", `# Fremdes Projekt\n\n${blockText("alter Stopp")}\n`);
    schreibe(z, ".claude/settings.json", '{\n  "model": "x"\n}\n');
    const config = pwConfig("wk-planer");
    schreibe(z, ".factory/projekt.json", config);
    const r = laufe(["--quelle", WURZEL, "--ziel", z]);
    assert.equal(r.code, 0, r.err);
    assert.match(lies(z, ".claude/agents/kubernia-planner.md"), /\nname: wk-planer\n/, "Projektwert aus der Config des Ziels");
    const gate = (): { status: number | null; stderr: string } => {
      const p = spawnSync(process.execPath, [join(z, "scripts", "check-factory-drift.mjs")], { cwd: z, encoding: "utf8" });
      return { status: p.status, stderr: p.stderr };
    };
    assert.equal(gate().status, 0, gate().stderr);
    schreibe(z, "scripts/hook-io.mjs", lies(z, "scripts/hook-io.mjs") + "\n// Projektänderung\n");
    const rot = gate();
    assert.equal(rot.status, 1);
    assert.match(rot.stderr, /scripts\/hook-io\.mjs: Besitz wurde im Projekt verändert/);
    assert.match(rot.stderr, /upstream/);
    assert.ok(existsSync(join(z, ".factory/besitz.json")));
    assert.equal(lies(z, ".factory/projekt.json"), config, "projekt.json bleibt, wie sie war");
    schreibe(z, "scripts/hook-io.mjs", lies(z, "scripts/hook-io.mjs").replace("\n// Projektänderung\n", ""));
    assert.equal(gate().status, 0, gate().stderr);
    schreibe(z, ".claude/agents/kubernia-planner.md", lies(z, ".claude/agents/kubernia-planner.md").replace("name: wk-planer", "name: von-hand"));
    const pw = gate();
    assert.equal(pw.status, 1);
    assert.match(pw.stderr, /kubernia-planner\.md:3: Projektwert 'agenten\.planer'/);
    assert.match(pw.stderr, /projektwerte\.mjs --write/);
  });

  test.skipIf(process.platform === "win32")("das Ausführbit des Pre-Push-Hooks kommt mit", () => {
    const z = tmp();
    schreibe(z, "AGENTS.md", `${blockText("x")}\n`);
    schreibe(z, ".factory/projekt.json", pwConfig("wk-planer"));
    assert.equal(laufe(["--quelle", WURZEL, "--ziel", z]).code, 0);
    assert.ok((statSync(join(z, ".githooks/pre-push")).mode & 0o111) !== 0);
  });
});

// ── Ring oberflaeche (ADR 0029): gehört der Factory, wird nie verteilt ───────────

describe("Ring oberflaeche (ADR 0029)", () => {
  const COCKPIT = "scripts/cockpit/o.mjs";
  const mitCockpit = (ring: string): string => {
    const q = baueQuelle();
    const m = { version: 1, eintraege: [...MANIFEST.eintraege, { pfad: COCKPIT, ring, quelle: "t" }] };
    schreibe(q, ".factory/besitz.json", JSON.stringify(m, null, 2) + "\n");
    schreibe(q, COCKPIT, "export const o = 1;\n");
    return q;
  };

  test("der Sync legt keine oberflaeche-Datei im Ziel an, der Sync-Stand listet sie nicht, das Manifest geht ganz ins Ziel", () => {
    const q = mitCockpit("oberflaeche");
    const z = baueZiel();
    const r = laufe(["--quelle", q, "--ziel", z]);
    assert.equal(r.code, 0, r.err);
    assert.ok(!existsSync(join(z, COCKPIT)), "oberflaeche-Datei wurde ins Projekt übertragen");
    assert.ok(!r.out.includes("scripts/cockpit/"), r.out);
    const st = JSON.parse(lies(z, ".factory/sync-stand.json")) as { einheiten: Record<string, string> };
    assert.ok(!(COCKPIT in st.einheiten), "Sync-Stand listet die oberflaeche-Einheit");
    assert.equal(Object.keys(st.einheiten).length, 4);
    assert.equal(lies(z, ".factory/besitz.json"), lies(q, ".factory/besitz.json"));
    const d = drift1(z);
    assert.equal(d.code, 0, d.err);
    assert.match(d.out, /4 Einheiten ohne Drift/);
  });

  test("das Drift-Gate erwartet die oberflaeche-Datei nicht und ignoriert eine Handänderung im Projekt", () => {
    const z = baueZiel();
    assert.equal(laufe(["--quelle", mitCockpit("oberflaeche"), "--ziel", z]).code, 0);
    schreibe(z, COCKPIT, "// im Projekt von Hand angelegt\n");
    assert.equal(drift1(z).code, 0);
  });

  test("Negativfall: ein unbekannter Ring (Umlaut-Schreibweise) bleibt rot, nichts wird geschrieben", () => {
    const z = baueZiel();
    const vorher = alleDateien(z);
    const r = laufe(["--quelle", mitCockpit("oberfläche"), "--ziel", z]);
    assert.equal(r.code, 1, r.out);
    assert.match(r.err, /unbekannter Ring 'oberfläche'/);
    assert.deepEqual(alleDateien(z), vorher);
    assert.ok(!existsSync(join(z, COCKPIT)));
  });

  test("Ring-Wechsel kern -> oberflaeche: wird gemeldet, die Datei bleibt, das Drift-Gate bleibt grün", () => {
    const z = baueZiel();
    assert.equal(laufe(["--quelle", mitCockpit("kern"), "--ziel", z]).code, 0);
    assert.ok(existsSync(join(z, COCKPIT)), "als kern verteilt");
    const r = laufe(["--quelle", mitCockpit("oberflaeche"), "--ziel", z]);
    assert.equal(r.code, 0, r.err);
    assert.match(r.out, /Einheit 'scripts\/cockpit\/o\.mjs' wird nicht mehr verteilt \(Ring oberflaeche\), im Ziel nicht gelöscht/);
    const meldungen = (t: string): string[] => t.split("\n").filter((l) => /nicht mehr verteilt|kein Besitz mehr/.test(l));
    assert.equal(meldungen(r.out).length, 1, "Meldung auch für weiter verteilte Einheiten");
    assert.deepEqual(meldungen(laufe(["--quelle", mitCockpit("oberflaeche"), "--ziel", z]).out), [], "zweiter Sync ohne Ring-Wechsel meldet nichts");
    assert.ok(existsSync(join(z, COCKPIT)));
    assert.equal(drift1(z).code, 0);
  });

  test("pruefeDrift ist fail-closed: ein Ring außerhalb der Nur-Factory-Liste wird geprüft", () => {
    const m = JSON.stringify({ version: 1, eintraege: [{ pfad: "x.txt", ring: "irgendwas", quelle: "t" }] });
    const lib2 = rawLib as unknown as { textHash(t: string): string; einheitHash(e: { pfad: string }, t: string): string };
    const stand = { version: 1, manifest: lib2.textHash(m), einheiten: { "x.txt": lib2.einheitHash({ pfad: "x.txt" }, "alt") } };
    const lesen = (text: string) => (p: string): string | null => (p === ".factory/besitz.json" ? m : p === ".factory/sync-stand.json" ? JSON.stringify(stand) : p === "x.txt" ? text : null);
    assert.deepEqual(drift.pruefeDrift(lesen("alt")).fehler, []);
    assert.match(drift.pruefeDrift(lesen("neu")).fehler.join(), /x\.txt: Besitz wurde im Projekt verändert/);
  });

  test("pruefeDrift: eine oberflaeche-Einheit im Sync-Stand bekommt eine eigene Meldung, eine echte Waise bleibt 'nicht im Manifest'", () => {
    const m = JSON.stringify({ version: 1, eintraege: [{ pfad: "o.txt", ring: "oberflaeche", quelle: "t" }] });
    const lib2 = rawLib as unknown as { textHash(t: string): string };
    const stand = { version: 1, manifest: lib2.textHash(m), einheiten: { "o.txt": "sha256:00", "waise.txt": "sha256:00" } };
    const lesen = (p: string): string | null => (p === ".factory/besitz.json" ? m : p === ".factory/sync-stand.json" ? JSON.stringify(stand) : null);
    const f = drift.pruefeDrift(lesen).fehler.join("|");
    assert.match(f, /o\.txt: im Sync-Stand, wird aber nicht verteilt \(Ring oberflaeche\)/);
    assert.doesNotMatch(f, /o\.txt: im Sync-Stand, aber nicht im Manifest/);
    assert.match(f, /waise\.txt: im Sync-Stand, aber nicht im Manifest/);
  });
});

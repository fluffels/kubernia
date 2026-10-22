/* Sync-Werkzeug und Drift-Gate (#1613, ADR 0022 F9): Bearbeitungs-Primitive der Besitz-Lib, Sync in ein synthetisches
 * Fremdrepo (Temp-Ordner, nichts davon liegt im Repo), Drift-Gate und ein Lauf mit dem echten Besitz dieses Repos. */
import { afterAll, afterEach, describe, test } from "vitest";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
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
  wirdVerteilt: (e: { ring: string }) => boolean;
}
interface Opt {
  cwd?: string;
  out?: (s: string) => void;
  err?: (s: string) => void;
}
interface TagLeser {
  fehler?: string;
  stand?: { commit: string; tag: string; sauber: boolean };
  lies(p: string): string | null;
  ausfuehrbar(p: string): boolean;
  vorladen(p: string[]): void;
}
interface Sync {
  PROJEKT_PFAD: string;
  quelleVomTag(quelle: string, tag: string): TagLeser;
  cli(argv: string[], opt?: Opt): number;
}
interface Drift {
  pruefeDrift(lies: (p: string) => string | null): { entfaellt: boolean; fehler: string[]; einheiten: number };
  cli(argv: string[], opt?: Opt): number;
}
const lib = rawLib as unknown as Lib;
const { wirdVerteilt } = lib;
const sync = rawSync as unknown as Sync;
const drift = rawDrift as unknown as Drift;
const pc = rawPc as unknown as { PROJEKT_CONFIG: string; ROLLEN_PFADE: Record<string, string>; PROJEKT_ROLLEN: string[] };

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

const kernText = (inhalt: string): string => `${lib.markerStart("kern")}\n${inhalt}\n${lib.markerEnde("kern")}`;
const blockText = (inhalt: string): string => `${lib.markerStart("stopps")}\n${inhalt}\n${lib.markerEnde("stopps")}`;
const ROLLEN_EINTRAEGE = Object.entries(pc.ROLLEN_PFADE)
  .filter(([rolle]) => !pc.PROJEKT_ROLLEN.includes(rolle))
  .map(([, pfad]) => ({ pfad, ring: "kern", quelle: "t" }));
const MANIFEST = {
  version: 1,
  eintraege: [
    ...ROLLEN_EINTRAEGE,
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
  for (const e of ROLLEN_EINTRAEGE) schreibe(q, e.pfad, "rolle\n");
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
const TAG_QUELLE = { commit: "0".repeat(40), tag: "v1", sauber: true };
// Git-Fixtures: ein Tag auf dem Stand der Quelle (Commit nur bei Änderung, sonst verschöbe ein leerer Commit den Tag).
const GIT_KONFIG = ["-c", "user.name=t", "-c", "user.email=t@example.invalid", "-c", "commit.gpgsign=false", "-c", "tag.gpgsign=false", "-c", "core.autocrlf=false"];
const git = (q: string, args: string[]): string => execFileSync("git", ["-C", q, ...GIT_KONFIG, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
function taggen(q: string, tag = "v1", opt: { annotiert?: boolean; exec?: string[] } = {}): void {
  const neu = !existsSync(join(q, ".git"));
  if (neu) git(q, ["init", "-q"]);
  git(q, ["add", "-A"]);
  if (opt.exec !== undefined && opt.exec.length > 0) git(q, ["update-index", "--chmod=+x", "--", ...opt.exec]);
  if (neu || git(q, ["status", "--porcelain"]) !== "") git(q, ["commit", "-q", "-m", "t"]);
  git(q, opt.annotiert === true ? ["tag", "-f", "-a", "-m", "t", tag] : ["tag", "-f", tag]);
}
const commitVon = (q: string, tag = "v1"): string => git(q, ["rev-parse", `${tag}^{commit}`]);
function vomTag(q: string, z: string, extra: string[] = [], tag = "v1"): Lauf {
  taggen(q, tag);
  return laufe(["--quelle", q, "--ziel", z, "--tag", tag, ...extra]);
}
// Der echte Besitz dieses Repos als getaggte Kopie (das Repo selbst wird nie getaggt: Refs sind über die Worktrees geteilt), einmal je Datei.
let echteKopie: string | null = null;
afterAll(() => {
  if (echteKopie !== null) rmSync(echteKopie, { recursive: true, force: true });
});
function echteQuelle(): string {
  if (echteKopie !== null) return echteKopie;
  const k = mkdtempSync(join(tmpdir(), "kq-fsync-echt-"));
  echteKopie = k;
  const manifestText = readFileSync(join(WURZEL, ".factory/besitz.json"), "utf8");
  const pfade = new Set([".factory/besitz.json", ...(JSON.parse(manifestText) as { eintraege: { pfad: string }[] }).eintraege.map((e) => e.pfad)]);
  for (const p of pfade) schreibe(k, p, readFileSync(join(WURZEL, ...p.split("/")), "utf8"));
  git(k, ["init", "-q"]);
  git(k, ["add", "-A"]);
  const exec = git(WURZEL, ["ls-files", "-s", "--", ...pfade])
    .split("\n")
    .filter((l) => l.startsWith("100755"))
    .map((l) => l.split("\t")[1]);
  for (const p of exec) chmodSync(join(k, ...p.split("/")), 0o755);
  taggen(k, "v1", { exec });
  return k;
}
const alleDateien = (z: string): string[] =>
  [".factory/besitz.json", ".factory/sync-stand.json", "scripts/a.mjs", "AGENTS.md", ".claude/settings.json", "src/eigen.ts"].map((p) => `${p}=${existsSync(join(z, p)) ? lies(z, p) : "-"}`);

describe("factory-sync (Fremdrepo-Fixture)", () => {
  test("überschreibt nur Besitz, Projektteile bleiben byte-gleich, Sync-Stand ohne absoluten Pfad", () => {
    const q = baueQuelle();
    const z = baueZiel();
    const r = vomTag(q, z);
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
    assert.deepEqual(Object.keys(st.einheiten), [...ROLLEN_EINTRAEGE.map((e) => e.pfad), "scripts/a.mjs", "AGENTS.md#stopps", ".claude/settings.json#/permissions", ".claude/settings.json#/sandbox"].sort());
    assert.ok(!existsSync(join(z, ".factory/projekt.json")), "projekt.json wurde angelegt");
  });

  test("zweiter Lauf schreibt nichts, alle Dateien inklusive Sync-Stand bleiben byte-gleich", () => {
    const q = baueQuelle();
    const z = baueZiel();
    assert.equal(vomTag(q, z).code, 0);
    const vorher = alleDateien(z);
    const r = vomTag(q, z);
    assert.equal(r.code, 0, r.err);
    assert.match(r.out, /0 geändert/);
    assert.deepEqual(alleDateien(z), vorher);
  });

  test("kaputter alter Sync-Stand im Ziel wird überschrieben, der Sync läuft durch", () => {
    const q = baueQuelle();
    const z = baueZiel();
    schreibe(z, ".factory/sync-stand.json", "{kaputt");
    const r = vomTag(q, z);
    assert.equal(r.code, 0, r.err);
    assert.equal((JSON.parse(lies(z, ".factory/sync-stand.json")) as { version: number }).version, 2);
  });

  test("--trocken schreibt nichts", () => {
    const q = baueQuelle();
    const z = baueZiel();
    const vorher = alleDateien(z);
    const r = vomTag(q, z, ["--trocken"]);
    assert.equal(r.code, 0, r.err);
    assert.match(r.out, /würde geändert: AGENTS\.md/);
    assert.deepEqual(alleDateien(z), vorher);
  });

  test("CRLF-Ziel mit gleichem Inhalt bleibt unberührt, mit anderem Inhalt wird CRLF geschrieben", () => {
    const q = baueQuelle();
    const z = baueZiel();
    assert.equal(vomTag(q, z).code, 0);
    const crlf = (t: string): string => t.replace(/\n/g, "\r\n");
    for (const p of ["scripts/a.mjs", "AGENTS.md", ".claude/settings.json", ".factory/besitz.json", ".factory/sync-stand.json"]) schreibe(z, p, crlf(lies(z, p)));
    const vorher = alleDateien(z);
    const r = vomTag(q, z);
    assert.match(r.out, /0 geändert/);
    assert.deepEqual(alleDateien(z), vorher);
    schreibe(q, "scripts/a.mjs", "export const a = 2;\n");
    assert.equal(vomTag(q, z).code, 0);
    assert.equal(lies(z, "scripts/a.mjs"), "export const a = 2;\r\n");
    assert.equal(lies(z, "AGENTS.md"), crlf(ZIEL_AGENTS.replace("alter Stopp", "neuer Stopp")));
  });

  test("fehlende settings.json wird mit den eigenen Schlüsseln angelegt, fehlender Schlüssel ergänzt", () => {
    const q = baueQuelle();
    const z = baueZiel();
    rmSync(join(z, ".claude/settings.json"));
    assert.equal(vomTag(q, z).code, 0);
    assert.deepEqual(JSON.parse(lies(z, ".claude/settings.json")), { permissions: { allow: ["Bash(ls)"] }, sandbox: { enabled: true } });
    schreibe(z, ".claude/settings.json", '{\n  "model": "m",\n  "permissions": {}\n}\n');
    assert.equal(vomTag(q, z).code, 0);
    assert.deepEqual(JSON.parse(lies(z, ".claude/settings.json")), { model: "m", permissions: { allow: ["Bash(ls)"] }, sandbox: { enabled: true } });
  });

  test("entfallene Einheit wird gemeldet, ihre Datei bleibt", () => {
    const q = baueQuelle();
    const z = baueZiel();
    assert.equal(vomTag(q, z).code, 0);
    const kleiner = { version: 1, eintraege: MANIFEST.eintraege.filter((e) => e.pfad !== "scripts/a.mjs") };
    schreibe(q, ".factory/besitz.json", JSON.stringify(kleiner, null, 2) + "\n");
    const r = vomTag(q, z);
    assert.equal(r.code, 0, r.err);
    assert.match(r.out, /Einheit 'scripts\/a\.mjs' ist kein Besitz mehr/);
    assert.equal(lies(z, "scripts/a.mjs"), "export const a = 1;\n");
  });

  describe("Negativfälle schreiben nichts", () => {
    const abgelehnt = (q: string, z: string, muster: RegExp): void => {
      const vorher = alleDateien(z);
      const r = vomTag(q, z);
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
    taggen(q, "v1", { exec: ["scripts/a.mjs"] });
    const z = baueZiel();
    assert.equal(laufe(["--quelle", q, "--ziel", z, "--tag", "v1"]).code, 0);
    assert.ok((statSync(join(z, "scripts/a.mjs")).mode & 0o111) !== 0);
  });
});

// ── Drift-Gate ────────────────────────────────────────────────────────────────

function gesyncterZiel(): string {
  const q = baueQuelle();
  const z = baueZiel();
  assert.equal(vomTag(q, z).code, 0);
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
    assert.match(r.out, new RegExp(`${MANIFEST.eintraege.length} Einheiten ohne Drift`));
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
    assert.doesNotMatch(drift1(z).err, /außerhalb der Besitz-Marker/, "der Block-Hinweis gehört nur zu Block-Einheiten");
  });
  test("rot bei geändertem Block-Inhalt", () => {
    const z = gesyncterZiel();
    schreibe(z, "AGENTS.md", lies(z, "AGENTS.md").replace("neuer Stopp", "eigener Stopp"));
    rot(z, /AGENTS\.md#stopps: Besitz wurde/);
    assert.match(drift1(z).err, /Projektergänzungen gehören außerhalb der Besitz-Marker/);
  });
  test("rot bei geänderten permissions (JSON-Schlüssel-Besitz), grün bei Projektschlüssel", () => {
    const z = gesyncterZiel();
    const orig = lies(z, ".claude/settings.json");
    schreibe(z, ".claude/settings.json", orig.replace('"model": "opus"', '"model": "anderes"'));
    assert.equal(drift1(z).code, 0, "Projektschlüssel darf sich ändern");
    schreibe(z, ".claude/settings.json", orig.replace("Bash(ls)", "Bash(rm -rf /)"));
    rot(z, /settings\.json#\/permissions: Besitz wurde/);
    assert.doesNotMatch(drift1(z).err, /außerhalb der Besitz-Marker/, "kein Marker-Hinweis bei JSON-Schlüsseln");
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
    ...ROLLEN_EINTRAEGE,
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
  for (const e of ROLLEN_EINTRAEGE) schreibe(q, e.pfad, "rolle\n");
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
    const r = vomTag(q, z);
    assert.equal(r.code, 0, r.err);
    assert.match(lies(z, ".claude/agents/w.md"), /\nname: wk-planer\n/);
    assert.match(lies(z, "docs/d.md"), /\| `agenten\.planer` \| `wk-planer` \|/);
    assert.ok(lies(z, "docs/d.md").endsWith("\n\nProjekttext\n"));
    assert.match(lies(q, ".claude/agents/w.md"), /name: quelle-planer/, "die Quelle bleibt unverändert");
    const vorher = [lies(z, ".claude/agents/w.md"), lies(z, "docs/d.md"), lies(z, ".factory/sync-stand.json")];
    const zwei = vomTag(q, z);
    assert.match(zwei.out, /0 geändert/);
    assert.deepEqual([lies(z, ".claude/agents/w.md"), lies(z, "docs/d.md"), lies(z, ".factory/sync-stand.json")], vorher);
  });

  test("der Sync-Stand-Hash ist der Hash des Quelltextes mit geleerten Werten, zwei Ziele mit anderen Werten teilen ihn", () => {
    const q = pwQuelle();
    const a = pwZiel("eins-planer");
    const b = pwZiel("zwei-planer");
    assert.equal(vomTag(q, a).code, 0);
    assert.equal(vomTag(q, b).code, 0);
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
      const r = vomTag(q, z);
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
    const r = vomTag(q, pwZiel());
    assert.equal(r.code, 1);
    const zeile = r.err.split("\n").find((z) => z.includes("agenten.fehlt")) ?? "";
    assert.equal(zeile.split(".claude/agents/w.md").length - 1, 1, zeile);
    const z = pwZiel();
    rmSync(join(z, ".factory/projekt.json"));
    assert.match(vomTag(pwQuelle(), z).err, /\.claude\/agents\/w\.md: Projekt-Config fehlt/);
  });

  test("ein Pfad mit 'weicht von' löst keinen --write-Hinweis im Drift-Gate aus (#1821)", () => {
    const z = pwZiel();
    assert.equal(vomTag(pwQuelle(), z).code, 0);
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
    assert.equal(vomTag(baueQuelle(), z).code, 0);
  });

  test("K2: das Drift-Gate ist ohne Sync-Stand rot, wenn ein Wert von der Config abweicht, und nennt den Weg", () => {
    const q = pwQuelle();
    const z = pwZiel();
    assert.equal(vomTag(q, z).code, 0);
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
    assert.equal(vomTag(pwQuelle(), z).code, 0);
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
    schreibe(z, "AGENTS.md", `# Fremdes Projekt\n\n${kernText("alter Stopp")}\n`);
    schreibe(z, ".claude/settings.json", '{\n  "model": "x"\n}\n');
    const config = pwConfig("wk-planer");
    schreibe(z, ".factory/projekt.json", config);
    const r = vomTag(echteQuelle(), z);
    assert.equal(r.code, 0, r.err);
    assert.match(lies(z, ".claude/agents/factory-planer.md"), /\nname: wk-planer\n/, "Projektwert aus der Config des Ziels");
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
    schreibe(z, ".claude/agents/factory-planer.md", lies(z, ".claude/agents/factory-planer.md").replace("name: wk-planer", "name: von-hand"));
    const pw = gate();
    assert.equal(pw.status, 1);
    assert.match(pw.stderr, /factory-planer.md:3: Projektwert 'agenten\.planer'/);
    assert.match(pw.stderr, /projektwerte\.mjs --write/);
  });

  test("ohne Projekt-Leitfrage und Optik-Messlatte (#1709): Sync und Drift-Gate ohne Meldung dazu, kein verteilter Besitz trägt den Spielbezug", () => {
    const z = tmp();
    const projekt = "<!-- factory-projekt:start -->\nEigene Regel des Fremdprojekts.\n<!-- factory-projekt:ende -->";
    schreibe(z, "AGENTS.md", `# Fremdes Projekt\n\n${kernText("alter Kern")}\n\n${projekt}\n`);
    schreibe(z, ".claude/settings.json", '{\n  "model": "x"\n}\n');
    const echt = JSON.parse(pwConfig("wk-planer")) as Record<string, unknown>;
    delete echt.projektliterale;
    schreibe(z, ".factory/projekt.json", JSON.stringify(echt, null, 2) + "\n");
    const r = vomTag(echteQuelle(), z);
    assert.equal(r.code, 0, r.err);
    const p = spawnSync(process.execPath, [join(z, "scripts", "check-factory-drift.mjs")], { cwd: z, encoding: "utf8" });
    assert.equal(p.status, 0, p.stderr);
    for (const text of [r.out, r.err, p.stdout, p.stderr]) assert.doesNotMatch(text, /Leitfrage|Messlatte|Optik|stardew/i);
    const manifest = JSON.parse(readFileSync(join(WURZEL, ".factory/besitz.json"), "utf8")) as { eintraege: { pfad: string; ring: string }[] };
    const verteilt = [...new Set(manifest.eintraege.filter((e) => wirdVerteilt(e)).map((e) => e.pfad))];
    assert.ok(verteilt.includes(".claude/agents/factory-planer.md"), "der Planer wird verteilt (sonst wäre der Test vakuös)");
    for (const pfad of verteilt) assert.doesNotMatch(lies(z, pfad), /stardew/i, `${pfad} im Ziel trägt den Spielbezug`);
  });

  test.skipIf(process.platform === "win32")("das Ausführbit des Pre-Push-Hooks kommt mit", () => {
    const z = tmp();
    schreibe(z, "AGENTS.md", `${kernText("x")}\n`);
    schreibe(z, ".factory/projekt.json", pwConfig("wk-planer"));
    assert.equal(vomTag(echteQuelle(), z).code, 0);
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
    const r = vomTag(q, z);
    assert.equal(r.code, 0, r.err);
    assert.ok(!existsSync(join(z, COCKPIT)), "oberflaeche-Datei wurde ins Projekt übertragen");
    assert.ok(!r.out.includes("scripts/cockpit/"), r.out);
    const st = JSON.parse(lies(z, ".factory/sync-stand.json")) as { einheiten: Record<string, string> };
    assert.ok(!(COCKPIT in st.einheiten), "Sync-Stand listet die oberflaeche-Einheit");
    assert.equal(Object.keys(st.einheiten).length, MANIFEST.eintraege.length);
    assert.equal(lies(z, ".factory/besitz.json"), lies(q, ".factory/besitz.json"));
    const d = drift1(z);
    assert.equal(d.code, 0, d.err);
    assert.match(d.out, new RegExp(`${MANIFEST.eintraege.length} Einheiten ohne Drift`));
  });

  test("das Drift-Gate erwartet die oberflaeche-Datei nicht und ignoriert eine Handänderung im Projekt", () => {
    const z = baueZiel();
    assert.equal(vomTag(mitCockpit("oberflaeche"), z).code, 0);
    schreibe(z, COCKPIT, "// im Projekt von Hand angelegt\n");
    assert.equal(drift1(z).code, 0);
  });

  test("Negativfall: ein unbekannter Ring (Umlaut-Schreibweise) bleibt rot, nichts wird geschrieben", () => {
    const z = baueZiel();
    const vorher = alleDateien(z);
    const r = vomTag(mitCockpit("oberfläche"), z);
    assert.equal(r.code, 1, r.out);
    assert.match(r.err, /unbekannter Ring 'oberfläche'/);
    assert.deepEqual(alleDateien(z), vorher);
    assert.ok(!existsSync(join(z, COCKPIT)));
  });

  test("Ring-Wechsel kern -> oberflaeche: wird gemeldet, die Datei bleibt, das Drift-Gate bleibt grün", () => {
    const z = baueZiel();
    assert.equal(vomTag(mitCockpit("kern"), z).code, 0);
    assert.ok(existsSync(join(z, COCKPIT)), "als kern verteilt");
    const r = vomTag(mitCockpit("oberflaeche"), z);
    assert.equal(r.code, 0, r.err);
    assert.match(r.out, /Einheit 'scripts\/cockpit\/o\.mjs' wird nicht mehr verteilt \(Ring oberflaeche\), im Ziel nicht gelöscht/);
    const meldungen = (t: string): string[] => t.split("\n").filter((l) => /nicht mehr verteilt|kein Besitz mehr/.test(l));
    assert.equal(meldungen(r.out).length, 1, "Meldung auch für weiter verteilte Einheiten");
    assert.deepEqual(meldungen(vomTag(mitCockpit("oberflaeche"), z).out), [], "zweiter Sync ohne Ring-Wechsel meldet nichts");
    assert.ok(existsSync(join(z, COCKPIT)));
    assert.equal(drift1(z).code, 0);
  });

  test("pruefeDrift ist fail-closed: ein Ring außerhalb der Nur-Factory-Liste wird geprüft", () => {
    const m = JSON.stringify({ version: 1, eintraege: [{ pfad: "x.txt", ring: "irgendwas", quelle: "t" }] });
    const lib2 = rawLib as unknown as { textHash(t: string): string; einheitHash(e: { pfad: string }, t: string): string };
    const stand = { version: 2, quelle: TAG_QUELLE, manifest: lib2.textHash(m), einheiten: { "x.txt": lib2.einheitHash({ pfad: "x.txt" }, "alt") } };
    const lesen = (text: string) => (p: string): string | null => (p === ".factory/besitz.json" ? m : p === ".factory/sync-stand.json" ? JSON.stringify(stand) : p === "x.txt" ? text : null);
    assert.deepEqual(drift.pruefeDrift(lesen("alt")).fehler, []);
    assert.match(drift.pruefeDrift(lesen("neu")).fehler.join(), /x\.txt: Besitz wurde im Projekt verändert/);
  });

  test("pruefeDrift: eine oberflaeche-Einheit im Sync-Stand bekommt eine eigene Meldung, eine echte Waise bleibt 'nicht im Manifest'", () => {
    const m = JSON.stringify({ version: 1, eintraege: [{ pfad: "o.txt", ring: "oberflaeche", quelle: "t" }] });
    const lib2 = rawLib as unknown as { textHash(t: string): string };
    const stand = { version: 2, quelle: TAG_QUELLE, manifest: lib2.textHash(m), einheiten: { "o.txt": "sha256:00", "waise.txt": "sha256:00" } };
    const lesen = (p: string): string | null => (p === ".factory/besitz.json" ? m : p === ".factory/sync-stand.json" ? JSON.stringify(stand) : null);
    const f = drift.pruefeDrift(lesen).fehler.join("|");
    assert.match(f, /o\.txt: im Sync-Stand, wird aber nicht verteilt \(Ring oberflaeche\)/);
    assert.doesNotMatch(f, /o\.txt: im Sync-Stand, aber nicht im Manifest/);
    assert.match(f, /waise\.txt: im Sync-Stand, aber nicht im Manifest/);
  });

  test("kein Lauf legt eine oberflaeche-Einheit an: Tag, Entwurf und alle Negativläufe (#1871)", () => {
    const cockpit = (z: string): boolean => existsSync(join(z, COCKPIT));
    const q = mitCockpit("oberflaeche");
    taggen(q, "v1");
    const faelle: string[][] = [["--tag", "v1"], ["--entwurf"], ["--tag", "v9"], []];
    for (const extra of faelle) {
      const z = baueZiel();
      const r = laufe(["--quelle", q, "--ziel", z, ...extra]);
      assert.equal(r.code, extra.includes("--tag") && !extra.includes("v9") || extra.includes("--entwurf") ? 0 : 1, `${extra.join(" ")}: ${r.err}`);
      assert.ok(!cockpit(z), `${extra.join(" ") || "ohne Flag"}: oberflaeche-Datei im Ziel`);
    }
  });
});

// ── Sync vom Tag (#1871) ─────────────────────────────────────────────────────────

describe("Sync vom Tag (#1871)", () => {
  const BESITZ = ".factory/besitz.json";
  const mitManifest = (q: string, eintraege: unknown[]): void => schreibe(q, BESITZ, JSON.stringify({ version: 1, eintraege }, null, 2) + "\n");

  test("AK1: Arbeitsbaum und spätere Commits ändern das Ergebnis nicht, Umlaute und fehlender Schluss-Zeilenumbruch bleiben byte-gleich", () => {
    const q = baueQuelle();
    mitManifest(q, [...MANIFEST.eintraege, { pfad: "scripts/b.mjs", ring: "kern", quelle: "t" }]);
    schreibe(q, "scripts/a.mjs", "// Grüße €\n");
    schreibe(q, "scripts/b.mjs", "ohne Zeilenumbruch äöü €");
    taggen(q, "v1");
    schreibe(q, "scripts/a.mjs", "// nach dem Tag, ungecommittet\n");
    schreibe(q, "scripts/b.mjs", "// nach dem Tag, committet\n");
    taggen(q, "spaeter");
    schreibe(q, "scripts/b.mjs", "// Arbeitsbaum\n");
    const z = baueZiel();
    const r = laufe(["--quelle", q, "--ziel", z, "--tag", "v1"]);
    assert.equal(r.code, 0, r.err);
    assert.equal(lies(z, "scripts/a.mjs"), "// Grüße €\n");
    assert.equal(lies(z, "scripts/b.mjs"), "ohne Zeilenumbruch äöü €");
    const st = JSON.parse(lies(z, ".factory/sync-stand.json")) as { einheiten: Record<string, string> };
    assert.equal(st.einheiten["scripts/a.mjs"], lib.einheitHash({ pfad: "scripts/a.mjs" }, "// Grüße €\n"));
    assert.equal(st.einheiten["scripts/b.mjs"], lib.einheitHash({ pfad: "scripts/b.mjs" }, "ohne Zeilenumbruch äöü €"));
  });

  test("AK1: der Leser liefert den Tag-Stand, Ausführbar-Bit aus dem Baum, null für Pfade außerhalb des Tags", () => {
    const q = baueQuelle();
    taggen(q, "v1", { exec: ["scripts/a.mjs"] });
    schreibe(q, "scripts/neu.mjs", "nur im Arbeitsbaum\n");
    const v = sync.quelleVomTag(q, "v1");
    assert.equal(v.fehler, undefined);
    assert.equal(v.ausfuehrbar("scripts/a.mjs"), true);
    assert.equal(v.ausfuehrbar("AGENTS.md"), false);
    assert.equal(v.lies("scripts/neu.mjs"), null);
    assert.equal(v.lies("gibt/es/nicht.txt"), null);
    assert.equal(v.lies("scripts/a.mjs"), "export const a = 1;\n");
    const w = sync.quelleVomTag(q, "v1");
    w.vorladen(["scripts/a.mjs", "AGENTS.md", "gibt/es/nicht.txt", "scripts/neu.mjs"]);
    assert.equal(w.lies("scripts/a.mjs"), "export const a = 1;\n");
    assert.match(w.lies("AGENTS.md") ?? "", /^# Quelle\n/);
    assert.equal(w.lies("scripts/neu.mjs"), null);
  });

  test("AK2: Sync-Stand Version 2 mit quelle { commit, tag, sauber: true } in dieser Reihenfolge", () => {
    const q = baueQuelle();
    const z = baueZiel();
    assert.equal(vomTag(q, z).code, 0);
    const st = JSON.parse(lies(z, ".factory/sync-stand.json")) as { version: number; quelle: Record<string, unknown> };
    assert.equal(st.version, 2);
    assert.deepEqual(st.quelle, { commit: commitVon(q), tag: "v1", sauber: true });
    assert.deepEqual(Object.keys(st.quelle), ["commit", "tag", "sauber"]);
    assert.equal(drift1(z).code, 0, drift1(z).err);
  });

  test("AK2: bei einem annotierten Tag steht der aufgelöste Commit im Stand, nicht das Tag-Objekt", () => {
    const q = baueQuelle();
    const z = baueZiel();
    taggen(q, "v2", { annotiert: true });
    assert.equal(laufe(["--quelle", q, "--ziel", z, "--tag", "v2"]).code, 0);
    const st = JSON.parse(lies(z, ".factory/sync-stand.json")) as { quelle: { commit: string; tag: string } };
    assert.equal(st.quelle.commit, commitVon(q, "v2"));
    assert.notEqual(st.quelle.commit, git(q, ["rev-parse", "v2"]), "das Tag-Objekt ist nicht der Commit");
    assert.equal(st.quelle.tag, "v2");
  });

  test("AK3: ohne --tag und ohne --entwurf Exit 1, Meldung mit beiden Wegen, nichts geschrieben", () => {
    const q = baueQuelle();
    taggen(q, "v1");
    const z = baueZiel();
    const vorher = alleDateien(z);
    const r = laufe(["--quelle", q, "--ziel", z]);
    assert.equal(r.code, 1, r.out);
    assert.match(r.err, /ohne --tag synct factory-sync nicht/);
    assert.match(r.err, /--entwurf/);
    assert.match(r.err, /nichts geschrieben/);
    assert.deepEqual(alleDateien(z), vorher);
  });

  test("AK3: --entwurf liest den Arbeitsbaum ohne Tag, der Stand trägt keinen tag, das Drift-Gate bleibt rot", () => {
    const q = baueQuelle();
    taggen(q, "v1");
    schreibe(q, "scripts/a.mjs", "export const a = 7; // ungecommittet\n");
    const z = baueZiel();
    const r = laufe(["--quelle", q, "--ziel", z, "--entwurf"]);
    assert.equal(r.code, 0, r.err);
    assert.equal(lies(z, "scripts/a.mjs"), "export const a = 7; // ungecommittet\n");
    assert.match(r.out, /Hinweis: Entwurf aus dem Arbeitsbaum/);
    const st = JSON.parse(lies(z, ".factory/sync-stand.json")) as { version: number; quelle: Record<string, unknown> };
    assert.equal(st.version, 2);
    assert.ok(!("tag" in st.quelle), "ein Entwurf trägt keinen Tag");
    assert.equal(st.quelle.sauber, false, "schmutziger Arbeitsbaum");
    const d = drift1(z);
    assert.equal(d.code, 1);
    assert.match(d.err, /von einem Tag neu syncen/);
  });

  test("AK3: --entwurf ohne Git-Repo: commit 'unbekannt', sauber false", () => {
    const q = baueQuelle();
    const z = baueZiel();
    assert.equal(laufe(["--quelle", q, "--ziel", z, "--entwurf"]).code, 0);
    const st = JSON.parse(lies(z, ".factory/sync-stand.json")) as { quelle: unknown };
    assert.deepEqual(st.quelle, { commit: "unbekannt", sauber: false });
  });

  describe("AK7: Negativfälle enden mit Exit 1 und schreiben nichts", () => {
    const abgelehntMit = (q: string, extra: string[], muster: RegExp): void => {
      const z = baueZiel();
      const vorher = alleDateien(z);
      const r = laufe(["--quelle", q, "--ziel", z, ...extra]);
      assert.equal(r.code, 1, r.out);
      assert.match(r.err, muster);
      assert.deepEqual(alleDateien(z), vorher);
    };
    test("Tag fehlt, Branch statt Tag, ungültiger Tag-Name, Quelle ohne Git", () => {
      const q = baueQuelle();
      taggen(q, "v1");
      git(q, ["branch", "probe-branch"]);
      abgelehntMit(q, ["--tag", "v9"], /Tag 'v9' gibt es in der Quelle nicht/);
      abgelehntMit(q, ["--tag", "probe-branch"], /'probe-branch' ist ein Branch, kein Tag/);
      abgelehntMit(q, ["--tag", "a..b"], /'a\.\.b' ist kein gültiger Tag-Name/);
      abgelehntMit(baueQuelle(), ["--tag", "v1"], /Quelle ist kein Git-Repo/);
    });
    test("Aufruffehler: --tag ohne Wert und --tag zusammen mit --entwurf enden mit Exit 2", () => {
      const q = baueQuelle();
      taggen(q, "v1");
      const ohneWert = laufe(["--quelle", q, "--ziel", baueZiel(), "--tag"]);
      assert.equal(ohneWert.code, 2);
      assert.match(ohneWert.err, /--tag braucht einen Namen/);
      const beide = laufe(["--quelle", q, "--ziel", baueZiel(), "--tag", "v1", "--entwurf"]);
      assert.equal(beide.code, 2);
      assert.match(beide.err, /schließen sich aus/);
    });
  });

  describe("AK5: Rollen-Pfade sind verteilte Einheiten im Quell-Manifest", () => {
    const ohneRolle = (rolle: string, ersatz?: unknown): string => {
      const q = baueQuelle();
      const pfad = pc.ROLLEN_PFADE[rolle];
      mitManifest(q, [...MANIFEST.eintraege.filter((e) => e.pfad !== pfad), ...(ersatz === undefined ? [] : [ersatz])]);
      return q;
    };
    const bricht = (q: string, muster: RegExp): void => {
      const z = baueZiel();
      const vorher = alleDateien(z);
      const r = vomTag(q, z);
      assert.equal(r.code, 1, r.out);
      assert.match(r.err, muster);
      assert.match(r.err, /nichts geschrieben/);
      assert.deepEqual(alleDateien(z), vorher);
    };
    test("fehlender Planer-Eintrag bricht ab und nennt den Pfad", () => {
      bricht(ohneRolle("planer"), /Rollen-Pfad '\.claude\/agents\/factory-planer\.md' \(planer\) ist keine verteilte Einheit/);
    });
    test("jede der vier Besitz-Rollen wird geprüft", () => {
      for (const rolle of Object.keys(pc.ROLLEN_PFADE).filter((r) => !pc.PROJEKT_ROLLEN.includes(r))) {
        bricht(ohneRolle(rolle), new RegExp(`\\(${rolle}\\) ist keine verteilte Einheit`));
      }
    });
    test("Rolle im Ring oberflaeche oder nur als Block zählt nicht als verteilte ganze Datei", () => {
      const pfad = pc.ROLLEN_PFADE.lens;
      bricht(ohneRolle("lens", { pfad, ring: "oberflaeche", quelle: "t" }), /\(lens\) ist keine verteilte Einheit/);
      bricht(ohneRolle("lens", { pfad, block: "x", ring: "kern", quelle: "t" }), /\(lens\) ist keine verteilte Einheit/);
      bricht(ohneRolle("lens", { pfad, schluessel: "x", ring: "kern", quelle: "t" }), /\(lens\) ist keine verteilte Einheit/);
    });
    test("der Ticket-Skill ist Projektdatei: fehlt er im Ziel, nur ein Hinweis; liegt er dort, keiner", () => {
      const pfad = pc.ROLLEN_PFADE.ticketSkill;
      const z = baueZiel();
      const ohne = vomTag(baueQuelle(), z);
      assert.equal(ohne.code, 0, ohne.err);
      assert.match(ohne.out, /Hinweis: Rollen-Pfad '\.agents\/skills\/factory-ticket\/SKILL\.md' \(ticketSkill\) fehlt im Ziel/);
      assert.ok(!existsSync(join(z, pfad)), "der Sync legt die Projektdatei nicht an");
      const z2 = baueZiel();
      schreibe(z2, pfad, "# eigener Skill\n");
      const mit = vomTag(baueQuelle(), z2);
      assert.equal(mit.code, 0, mit.err);
      assert.doesNotMatch(mit.out, /ticketSkill/);
      assert.equal(lies(z2, pfad), "# eigener Skill\n");
    });
    test("am echten Manifest: die Besitz-Rollen sind ganze verteilte Einheiten, die Projekt-Rollen stehen nicht darin", () => {
      const m = JSON.parse(readFileSync(join(WURZEL, BESITZ), "utf8")) as { eintraege: { pfad: string; block?: string; schluessel?: string; ring: string }[] };
      for (const [rolle, pfad] of Object.entries(pc.ROLLEN_PFADE)) {
        const eintraege = m.eintraege.filter((e) => e.pfad === pfad);
        if (pc.PROJEKT_ROLLEN.includes(rolle)) assert.equal(eintraege.length, 0, `${rolle} gehört dem Projekt`);
        else assert.ok(eintraege.some((e) => e.block === undefined && e.schluessel === undefined && wirdVerteilt(e)), `${rolle}: ${pfad} ist keine ganze verteilte Einheit`);
      }
    });
  });

  describe("AK4: das Drift-Gate verlangt einen sauberen Tag (pruefeDrift pur)", () => {
    const m = JSON.stringify({ version: 1, eintraege: [{ pfad: "x.txt", ring: "kern", quelle: "t" }] });
    const lib2 = rawLib as unknown as { textHash(t: string): string; einheitHash(e: { pfad: string }, t: string): string };
    const fehlerMit = (stand: Record<string, unknown>): string[] => {
      const voll = { manifest: lib2.textHash(m), einheiten: { "x.txt": lib2.einheitHash({ pfad: "x.txt" }, "alt") }, ...stand };
      const lesen = (p: string): string | null => (p === ".factory/besitz.json" ? m : p === ".factory/sync-stand.json" ? JSON.stringify(voll) : p === "x.txt" ? "alt" : null);
      return drift.pruefeDrift(lesen).fehler;
    };
    test("Version 1 ohne Tag ist rot und nennt den Weg mit --tag", () => {
      const f = fehlerMit({ version: 1, quelle: { commit: "abc", sauber: true } });
      assert.equal(f.length, 1, f.join("|"));
      assert.match(f[0], /nicht von einem Tag/);
      assert.match(f[0], /Weg: von einem Tag neu syncen/);
      assert.match(f[0], /--tag <name>/);
    });
    test("Version 2 ohne Tag, mit leerem Tag oder ohne quelle ist rot", () => {
      assert.match(fehlerMit({ version: 2, quelle: { commit: "abc", sauber: true } }).join(), /nicht von einem Tag/);
      assert.match(fehlerMit({ version: 2, quelle: { commit: "abc", tag: "", sauber: true } }).join(), /nicht von einem Tag/);
      assert.match(fehlerMit({ version: 2 }).join(), /nicht von einem Tag/);
    });
    test("sauber: false ist rot, auch mit Tag", () => {
      const f = fehlerMit({ version: 2, quelle: { commit: "abc", tag: "v1", sauber: false } });
      assert.equal(f.length, 1, f.join("|"));
      assert.match(f[0], /sauber: false/);
      assert.match(f[0], /von einem Tag neu syncen/);
    });
    test("kaputte Herkunftswerte sind rot: Tag kein String, sauber fehlt oder ist kein Boolean", () => {
      for (const tag of [null, 1, true]) assert.match(fehlerMit({ version: 2, quelle: { commit: "abc", tag, sauber: true } }).join(), /nicht von einem Tag/, `tag=${String(tag)}`);
      assert.match(fehlerMit({ version: 2, quelle: { commit: "abc", tag: "v1" } }).join(), /sauber: false/, "sauber fehlt");
      assert.match(fehlerMit({ version: 2, quelle: { commit: "abc", tag: "v1", sauber: "true" } }).join(), /sauber: false/, "sauber als String");
    });
    test("Version 2 mit Tag und sauber: true ist grün, jede andere Version ist kaputt", () => {
      assert.deepEqual(fehlerMit({ version: 2, quelle: { commit: "abc", tag: "v1", sauber: true } }), []);
      assert.match(fehlerMit({ version: 3, quelle: { commit: "abc", tag: "v1", sauber: true } }).join(), /kaputt/);
    });
    test("die Herkunft kommt zusätzlich zu Einheiten-Befunden, nicht statt ihrer", () => {
      const lesen = (p: string): string | null => {
        if (p === ".factory/besitz.json") return m;
        if (p === ".factory/sync-stand.json") return JSON.stringify({ version: 1, quelle: { commit: "a", sauber: true }, manifest: lib2.textHash(m), einheiten: { "x.txt": lib2.einheitHash({ pfad: "x.txt" }, "alt") } });
        return p === "x.txt" ? "geändert" : null;
      };
      const f = drift.pruefeDrift(lesen).fehler.join("|");
      assert.match(f, /nicht von einem Tag/);
      assert.match(f, /x\.txt: Besitz wurde im Projekt verändert/);
      const zeilen = drift.pruefeDrift(lesen).fehler;
      assert.match(zeilen.find((z) => z.includes("nicht von einem Tag")) ?? "", /Weg: von einem Tag neu syncen/);
      assert.match(zeilen.find((z) => z.includes("x.txt: Besitz")) ?? "", /Weg: Änderung upstream/);
      assert.doesNotMatch(zeilen.find((z) => z.includes("x.txt: Besitz")) ?? "", /von einem Tag neu syncen/);
    });
  });
});

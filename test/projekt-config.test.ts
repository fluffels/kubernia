/* Projekt-Config (#1611, ADR 0022 F2): Validierung, Lader, Kommandozeile und der AK3-Negativfall
 * (fehlende Config bricht das Werkzeug ab, kein stiller Standardwert). */
import { afterEach, describe, test } from "vitest";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as rawPc from "../scripts/projekt-config-lib.mjs";

interface Pc {
  pruefeProjektConfig(wert: unknown): string[];
  ladeProjektConfig(opt?: { rootDir?: string; pfad?: string }): { repo: string };
  cli(argv: string[], opt?: { rootDir?: string; out?: (s: string) => void; err?: (s: string) => void }): number;
}
const pc = rawPc as unknown as Pc;

const WURZEL = fileURLToPath(new URL("../", import.meta.url));

type Cfg = Record<string, unknown> & { board?: Record<string, unknown> };
const gueltig = (): Cfg => ({
  version: 1,
  repo: "acme/demo",
  board: { besitzer: "acme", besitzerTyp: "org", nummer: 7, projectId: "PVT_x", statusFeldId: 5, statusFeldNodeId: "PVTSSF_y", todoOptionId: "abc" },
  projektliterale: { Zelda: "zelda" },
});

const temps: string[] = [];
const tmp = (): string => {
  const d = mkdtempSync(join(tmpdir(), "kq-projekt-"));
  temps.push(d);
  return d;
};
afterEach(() => {
  for (const d of temps.splice(0)) rmSync(d, { recursive: true, force: true });
});

const meld = (w: unknown): string => pc.pruefeProjektConfig(w).join("|");

describe("pruefeProjektConfig", () => {
  test("gültige Config und die echte Config sind grün", () => {
    assert.deepEqual(pc.pruefeProjektConfig(gueltig()), []);
    assert.deepEqual(pc.pruefeProjektConfig(JSON.parse(readFileSync(WURZEL + ".factory/projekt.json", "utf8"))), []);
    const ohne = gueltig();
    delete ohne.projektliterale;
    assert.deepEqual(pc.pruefeProjektConfig(ohne), []);
  });

  test("Negativfälle je Pflichtschlüssel", () => {
    const mit = (mut: (c: Cfg) => void): string => {
      const c = gueltig();
      mut(c);
      return meld(c);
    };
    assert.match(meld(null), /JSON-Objekt/);
    assert.match(meld([]), /JSON-Objekt/);
    assert.match(mit((c) => (c.version = 2)), /version/);
    assert.match(mit((c) => delete c.version), /version/);
    assert.match(mit((c) => delete c.repo), /repo/);
    assert.match(mit((c) => (c.repo = "ohneSchraegstrich")), /repo/);
    assert.match(mit((c) => (c.repo = 5)), /repo/);
    assert.match(mit((c) => delete c.board), /board muss/);
    assert.match(mit((c) => delete c.board?.besitzer), /board\.besitzer/);
    assert.match(mit((c) => ((c.board ??= {}).besitzer = " ")), /board\.besitzer/);
    assert.match(mit((c) => ((c.board ??= {}).besitzerTyp = "team")), /besitzerTyp/);
    assert.match(mit((c) => ((c.board ??= {}).nummer = 0)), /board\.nummer/);
    assert.match(mit((c) => ((c.board ??= {}).nummer = 1.5)), /board\.nummer/);
    assert.match(mit((c) => ((c.board ??= {}).statusFeldId = "5")), /statusFeldId/);
    assert.match(mit((c) => delete c.board?.projectId), /board\.projectId/);
    assert.match(mit((c) => ((c.board ??= {}).statusFeldNodeId = "")), /statusFeldNodeId/);
    assert.match(mit((c) => ((c.board ??= {}).todoOptionId = 3)), /todoOptionId/);
    assert.match(mit((c) => (c.projektliterale = [])), /projektliterale/);
    assert.match(mit((c) => (c.projektliterale = { Zelda: "" })), /projektliterale\.Zelda/);
  });
});

describe("ladeProjektConfig", () => {
  test("liest eine gültige Datei", () => {
    const d = tmp();
    mkdirSync(join(d, ".factory"));
    writeFileSync(join(d, ".factory/projekt.json"), JSON.stringify(gueltig()));
    assert.equal(pc.ladeProjektConfig({ rootDir: d }).repo, "acme/demo");
  });
  test("fehlende Datei, kaputtes JSON, Liste und fehlender Schlüssel werfen mit Pfad und Fix-Zeile", () => {
    const d = tmp();
    assert.throws(() => pc.ladeProjektConfig({ rootDir: d }), /\.factory[\\/]projekt\.json[\s\S]*Fix:/);
    mkdirSync(join(d, ".factory"));
    writeFileSync(join(d, ".factory/projekt.json"), "{kaputt");
    assert.throws(() => pc.ladeProjektConfig({ rootDir: d }), /kein gültiges JSON/);
    writeFileSync(join(d, ".factory/projekt.json"), "[]");
    assert.throws(() => pc.ladeProjektConfig({ rootDir: d }), /JSON-Objekt/);
    const c = gueltig();
    delete c.board?.projectId;
    writeFileSync(join(d, ".factory/projekt.json"), JSON.stringify(c));
    assert.throws(() => pc.ladeProjektConfig({ rootDir: d }), /board\.projectId[\s\S]*Fix:/);
  });
});

describe("cli", () => {
  const lauf = (argv: string[], rootDir = WURZEL): { code: number; out: string[]; err: string[] } => {
    const out: string[] = [];
    const err: string[] = [];
    const code = pc.cli(argv, { rootDir, out: (s: string) => out.push(s), err: (s: string) => err.push(s) });
    return { code, out, err };
  };
  const mitConfig = (): string => {
    const d = tmp();
    const p = join(d, "c.json");
    writeFileSync(p, JSON.stringify(gueltig()));
    return p;
  };
  test("gibt String- und Zahlwerte aus", () => {
    const p = mitConfig();
    assert.deepEqual(lauf(["--config", p, "board.projectId"]), { code: 0, out: ["PVT_x"], err: [] });
    assert.deepEqual(lauf(["board.nummer", "--config", p]).out, ["7"]);
    assert.deepEqual(lauf(["repo", "--config", p]).out, ["acme/demo"]);
  });
  test("fehlender Schlüssel, Objekt statt Skalar, fehlende Config, fehlender Pfad: Exit 1; ohne Schlüssel Exit 2", () => {
    const p = mitConfig();
    assert.equal(lauf(["--config", p, "board.gibtsnicht"]).code, 1);
    assert.equal(lauf(["--config", p, "board"]).code, 1);
    assert.equal(lauf(["--config", p, "constructor"]).code, 1);
    const fehlt = lauf(["--config", join(tmp(), "nein.json"), "repo"]);
    assert.equal(fehlt.code, 1);
    assert.match(fehlt.err.join(), /Fix:/);
    assert.equal(lauf(["--config"]).code, 1);
    assert.equal(lauf([]).code, 2);
  });
});

describe("Einstieg scripts/projekt-config.mjs", () => {
  const start = (...args: string[]): { status: number | null; stdout: string; stderr: string } =>
    spawnSync(process.execPath, [join(WURZEL, "scripts/projekt-config.mjs"), ...args], { encoding: "utf8" });
  test("gibt den Wert der echten Config aus; fehlender Schlüssel Exit 1, ohne Schlüssel Exit 2", () => {
    const echt = JSON.parse(readFileSync(WURZEL + ".factory/projekt.json", "utf8")) as { board: { projectId: string } };
    const r = start("board.projectId");
    assert.equal(r.status, 0);
    assert.equal(r.stdout.trim(), echt.board.projectId);
    assert.equal(start("board.gibtsnicht").status, 1);
    assert.equal(start().status, 2);
  });
});

describe("kein stiller Standardwert (AK3)", () => {
  test("board-lib und gh-cli ohne .factory/projekt.json: Import bricht mit Projekt-Config-Meldung, ohne Projektnamen", () => {
    const d = tmp();
    mkdirSync(join(d, "scripts"));
    for (const f of ["board-lib.mjs", "gh-cli.mjs", "projekt-config-lib.mjs"]) copyFileSync(join(WURZEL, "scripts", f), join(d, "scripts", f));
    const r = spawnSync(process.execPath, ["-e", `import(${JSON.stringify("file:///" + join(d, "scripts/board-lib.mjs").replace(/\\/g, "/"))})`], { encoding: "utf8", cwd: d });
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /Projekt-Config/);
    assert.doesNotMatch(r.stdout + r.stderr, /PVT_/);
  });
});

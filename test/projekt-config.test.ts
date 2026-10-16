/* Projekt-Config (#1611, ADR 0022 F2): Validierung, Lader, Kommandozeile und der AK3-Negativfall
 * (fehlende Config bricht das Werkzeug ab, kein stiller Standardwert). */
import { afterEach, describe, test } from "vitest";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as rawPc from "../scripts/projekt-config-lib.mjs";

interface Pc {
  pruefeProjektConfig(wert: unknown): string[];
  ladeProjektConfig(opt?: { rootDir?: string; pfad?: string }): { repo: string };
  trenneConfigArg(argv: string[]): { args?: string[]; pfad?: string; fehler?: string };
  boardPfad(board: Record<string, unknown>): string;
  cli(argv: string[], opt?: { rootDir?: string; out?: (s: string) => void; err?: (s: string) => void }): number;
}
const pc = rawPc as unknown as Pc;

const WURZEL = fileURLToPath(new URL("../", import.meta.url));

type Cfg = Record<string, unknown> & { boards?: Record<string, unknown>[] };
const mkBoard = (rolle: string, nummer: number, projectId: string): Record<string, unknown> => ({
  rolle,
  besitzer: "acme",
  besitzerTyp: "org",
  nummer,
  projectId,
  statusFeldId: 5,
  statusFeldNodeId: "x_status",
  todoOptionId: "abc",
});
const gueltig = (): Cfg => ({
  version: 2,
  repo: "acme/demo",
  boards: [mkBoard("produkt", 7, "p_eins"), mkBoard("factory", 8, "p_zwei")],
  praefixe: { commitZeile: "ZD-", branch: "feature/zd-", worktree: "zd-" },
  labels: { harness: "area:werk", festgefahren: "status:steckt", forum: "forum", dependabotInbox: "area:werk" },
  agenten: { planer: "demo-planer", umsetzer: "demo-umsetzer", lens: "demo-lens", gruppe: "demo-gruppe", ticketSkill: "demo" },
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
    const b1 = (c: Cfg): Record<string, unknown> => c.boards?.[1] ?? {};
    assert.match(mit((c) => (c.version = 1)), /version/);
    assert.match(mit((c) => delete c.version), /version/);
    assert.match(mit((c) => delete c.repo), /repo/);
    assert.match(mit((c) => (c.repo = "ohneSchraegstrich")), /repo/);
    assert.match(mit((c) => (c.repo = 5)), /repo/);
    assert.match(mit((c) => delete b1(c).besitzer), /boards\.1\.besitzer/);
    assert.match(mit((c) => (b1(c).besitzer = " ")), /boards\.1\.besitzer/);
    assert.match(mit((c) => (b1(c).besitzerTyp = "team")), /boards\.1\.besitzerTyp/);
    assert.match(mit((c) => (b1(c).nummer = 0)), /boards\.1\.nummer/);
    assert.match(mit((c) => (b1(c).nummer = 1.5)), /boards\.1\.nummer/);
    assert.match(mit((c) => (b1(c).statusFeldId = "5")), /boards\.1\.statusFeldId/);
    assert.match(mit((c) => delete b1(c).projectId), /boards\.1\.projectId/);
    assert.match(mit((c) => (b1(c).statusFeldNodeId = "")), /boards\.1\.statusFeldNodeId/);
    assert.match(mit((c) => (b1(c).todoOptionId = 3)), /boards\.1\.todoOptionId/);
    assert.match(mit((c) => (c.projektliterale = [])), /projektliterale/);
    assert.match(mit((c) => (c.projektliterale = { Zelda: "" })), /projektliterale\.Zelda/);
  });

  test("praefixe, labels, agenten (#1741): je Pflichtschlüssel ein Negativfall (fest verdrahtete Liste, kein Export)", () => {
    const ohne = (pfad: string[]): string => {
      const c = gueltig() as Record<string, unknown>;
      let o = c;
      for (const k of pfad.slice(0, -1)) o = o[k] as Record<string, unknown>;
      delete o[pfad[pfad.length - 1]];
      return meld(c);
    };
    const pflicht = [
      ["praefixe"], ["praefixe", "commitZeile"], ["praefixe", "branch"], ["praefixe", "worktree"],
      ["labels"], ["labels", "harness"], ["labels", "festgefahren"], ["labels", "forum"], ["labels", "dependabotInbox"],
      ["agenten"], ["agenten", "planer"], ["agenten", "umsetzer"], ["agenten", "lens"], ["agenten", "gruppe"], ["agenten", "ticketSkill"],
    ];
    for (const pfad of pflicht) assert.ok(ohne(pfad).includes(pfad.join(".")), pfad.join("."));
  });

  test("praefixe: Muster (Commit-Zeilen-Präfix, Branch, Worktree)", () => {
    const mit = (k: string, v: unknown): string => {
      const c = gueltig() as Record<string, unknown>;
      (c.praefixe as Record<string, unknown>)[k] = v;
      return meld(c);
    };
    for (const schlecht of ["zd-", "ZD", "ZD--", "1D-", "", 5, "-", "Z D-", "ZD-x"]) {
      assert.match(mit("commitZeile", schlecht), /praefixe\.commitZeile/, String(schlecht));
    }
    assert.equal(mit("commitZeile", "AB12-"), "");
    for (const schlecht of [".", "a.b", "a*", "a(", "a\\b", "a b", "", 5, "a|b", "a+"]) assert.match(mit("branch", schlecht), /praefixe\.branch/, String(schlecht));
    assert.equal(mit("branch", "feat/x-"), "");
    for (const schlecht of [".", "a*", "a(", "a\\b", "a b", "", "a/b", 5]) assert.match(mit("worktree", schlecht), /praefixe\.worktree/, String(schlecht));
    assert.equal(mit("worktree", "wt-"), "");
  });

  test("agenten: kein Doppelpunkt, kein Leerraum, nicht mit - am Anfang", () => {
    const mit = (k: string, v: unknown): string => {
      const c = gueltig() as Record<string, unknown>;
      (c.agenten as Record<string, unknown>)[k] = v;
      return meld(c);
    };
    for (const schlecht of ["a:b", "-x", "a b", "", 7]) assert.match(mit("lens", schlecht), /agenten\.lens/, String(schlecht));
    assert.equal(mit("lens", "x-y_1"), "");
  });

  test("labels: leer oder kein String ist rot, weitere Labels mit gleicher Prüfung erlaubt", () => {
    const mit = (k: string, v: unknown): string => {
      const c = gueltig() as Record<string, unknown>;
      (c.labels as Record<string, unknown>)[k] = v;
      return meld(c);
    };
    assert.match(mit("harness", ""), /labels\.harness/);
    assert.match(mit("forum", 3), /labels\.forum/);
    assert.equal(mit("extra", "area:zusatz"), "");
    assert.match(mit("extra", " "), /labels\.extra/);
    assert.match(meld({ ...gueltig(), labels: [] }), /labels muss/);
  });

  test("boards (#1728): Liste, Rollen, Eindeutigkeit", () => {
    const mit = (mut: (c: Cfg) => void): string => {
      const c = gueltig();
      mut(c);
      return meld(c);
    };
    assert.match(mit((c) => delete c.boards), /boards muss/);
    assert.match(mit((c) => ((c as Record<string, unknown>).boards = [])), /boards muss/);
    assert.match(mit((c) => ((c as Record<string, unknown>).boards = {})), /boards muss/);
    assert.match(
      mit((c) => {
        delete c.boards;
        (c as Record<string, unknown>).board = mkBoard("produkt", 1, "x"); // altes v1-Schema
      }),
      /boards muss/,
    );
    assert.match(mit((c) => ((c.boards as unknown[])[0] = "kein Objekt")), /boards\.0 muss ein Objekt/);
    assert.match(mit((c) => ((c.boards as Record<string, unknown>[])[1].rolle = "unbekannt")), /boards\.1\.rolle/);
    assert.match(mit((c) => ((c.boards as Record<string, unknown>[])[1].rolle = "produkt")), /Rolle produkt kommt mehrfach/);
    assert.match(mit((c) => (c.boards as unknown[]).pop()), /Rolle factory fehlt/);
    assert.match(mit((c) => ((c.boards as Record<string, unknown>[])[1].projectId = "p_eins")), /projectId.*mehrfach/);
    assert.match(mit((c) => ((c.boards as Record<string, unknown>[])[1].nummer = 7)), /Board.*mehrfach/);
    // Grenzfall: gleiche Nummer bei verschiedenem Besitzer ist ein anderes Board
    const anders = gueltig();
    Object.assign((anders.boards as Record<string, unknown>[])[1], { nummer: 7, besitzer: "andere" });
    assert.deepEqual(pc.pruefeProjektConfig(anders), []);
  });

  test("spezifikation.hartAb (#1615): optional, sonst positive Ganzzahl", () => {
    const mit = (wert: unknown): string[] => pc.pruefeProjektConfig({ ...gueltig(), spezifikation: wert });
    assert.deepEqual(mit({ hartAb: 100 }), []);
    for (const schlecht of [5, [], null, {}, { hartAb: 0 }, { hartAb: -3 }, { hartAb: 1.5 }, { hartAb: "7" }]) {
      assert.match(mit(schlecht).join("\n"), /spezifikation\.hartAb/);
    }
  });
});

describe("boardPfad", () => {
  test("user ergibt users/…, org ergibt orgs/…; die echte Config bleibt beim bisherigen Board-Pfad", () => {
    const b = gueltig().boards?.[0];
    assert.equal(pc.boardPfad({ ...b, besitzerTyp: "user" }), "users/acme/projectsV2/7");
    assert.equal(pc.boardPfad({ ...b, besitzerTyp: "org" }), "orgs/acme/projectsV2/7");
    const echt = pc.ladeProjektConfig() as unknown as { boards: Record<string, unknown>[] };
    assert.equal(pc.boardPfad(echt.boards[0]), `users/${String(echt.boards[0].besitzer)}/projectsV2/1`);
  });
});

describe("ladeProjektConfig", () => {
  test("liest eine gültige Datei", () => {
    const d = tmp();
    mkdirSync(join(d, ".factory"));
    writeFileSync(join(d, ".factory/projekt.json"), JSON.stringify(gueltig()));
    assert.equal(pc.ladeProjektConfig({ rootDir: d }).repo, "acme/demo");
  });
  test("fehlt praefixe.commitZeile, nennt die Meldung den absoluten Pfad, den Schlüssel und eine Fix-Zeile", () => {
    const d = tmp();
    mkdirSync(join(d, ".factory"));
    const c = gueltig() as Record<string, unknown>;
    delete (c.praefixe as Record<string, unknown>).commitZeile;
    writeFileSync(join(d, ".factory/projekt.json"), JSON.stringify(c));
    let meldung = "";
    try {
      pc.ladeProjektConfig({ rootDir: d });
    } catch (e) {
      meldung = e instanceof Error ? e.message : String(e);
    }
    assert.ok(meldung.includes(join(d, ".factory/projekt.json")), meldung);
    assert.match(meldung, /praefixe\.commitZeile/);
    assert.match(meldung, /^Fix:/m);
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
    delete c.boards?.[0].projectId;
    writeFileSync(join(d, ".factory/projekt.json"), JSON.stringify(c));
    assert.throws(() => pc.ladeProjektConfig({ rootDir: d }), /boards\.0\.projectId[\s\S]*Fix:/);
    writeFileSync(join(d, ".factory/projekt.json"), JSON.stringify({ ...gueltig(), version: 1, board: gueltig().boards?.[0], boards: undefined }));
    assert.throws(() => pc.ladeProjektConfig({ rootDir: d }), /projekt\.json[\s\S]*version muss 2[\s\S]*boards[\s\S]*Fix:/);
  });
});

describe("trenneConfigArg", () => {
  test("trennt --config samt Pfad ab, meldet fehlenden Pfad", () => {
    assert.deepEqual(pc.trenneConfigArg(["a", "--config", "p.json", "b"]), { args: ["a", "b"], pfad: "p.json" });
    assert.deepEqual(pc.trenneConfigArg(["a"]), { args: ["a"], pfad: undefined });
    assert.match(pc.trenneConfigArg(["--config"]).fehler ?? "", /Pfad[\s\S]*Fix:/);
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
    assert.deepEqual(lauf(["--config", p, "boards.0.projectId"]), { code: 0, out: ["p_eins"], err: [] });
    assert.deepEqual(lauf(["boards.1.nummer", "--config", p]).out, ["8"]);
    assert.deepEqual(lauf(["boards.1.projectId", "--config", p]).out, ["p_zwei"]);
    assert.deepEqual(lauf(["repo", "--config", p]).out, ["acme/demo"]);
  });
  test("Listenindex nur als Ziffernfolge innerhalb der Liste (kein length, keine führende Null)", () => {
    const p = mitConfig();
    for (const k of ["boards.2.projectId", "boards.length", "boards.01.projectId", "boards.1", "boards.-1.projectId"]) {
      assert.equal(lauf(["--config", p, k]).code, 1, k);
    }
  });
  test("fehlender Schlüssel, Objekt statt Skalar, fehlende Config, fehlender Pfad: Exit 1; ohne Schlüssel Exit 2", () => {
    const p = mitConfig();
    assert.equal(lauf(["--config", p, "boards.0.gibtsnicht"]).code, 1);
    assert.equal(lauf(["--config", p, "boards"]).code, 1);
    assert.equal(lauf(["--config", p, "boards.0"]).code, 1);
    assert.equal(lauf(["--config", p, "constructor"]).code, 1);
    const fehlt = lauf(["--config", join(tmp(), "nein.json"), "repo"]);
    assert.equal(fehlt.code, 1);
    assert.match(fehlt.err.join(), /Fix:/);
    assert.equal(lauf(["--config"]).code, 1);
    assert.equal(lauf([]).code, 2);
  });
});

describe("Einstieg scripts/projekt-config.mjs", { timeout: 30_000 }, () => {
  const start = (...args: string[]): { status: number | null; stdout: string; stderr: string } =>
    spawnSync(process.execPath, [join(WURZEL, "scripts/projekt-config.mjs"), ...args], { encoding: "utf8" });
  test("gibt den Wert der echten Config aus; fehlender Schlüssel Exit 1, ohne Schlüssel Exit 2", () => {
    const echt = JSON.parse(readFileSync(WURZEL + ".factory/projekt.json", "utf8")) as { boards: { projectId: string }[] };
    const r = start("boards.1.projectId");
    assert.equal(r.status, 0);
    assert.equal(r.stdout.trim(), echt.boards[1].projectId);
    assert.equal(start("boards.0.gibtsnicht").status, 1);
    assert.equal(start().status, 2);
  });
});

describe("kein stiller Standardwert (AK3)", { timeout: 30_000 }, () => {
  test("board-lib und gh-cli ohne .factory/projekt.json: Import bricht mit Projekt-Config-Meldung, ohne Projektnamen", () => {
    const d = tmp();
    mkdirSync(join(d, "scripts"));
    for (const f of ["board-lib.mjs", "gh-cli.mjs", "projekt-config-lib.mjs"]) copyFileSync(join(WURZEL, "scripts", f), join(d, "scripts", f));
    const r = spawnSync(process.execPath, ["-e", `import(${JSON.stringify(pathToFileURL(join(d, "scripts/board-lib.mjs")).href)})`], { encoding: "utf8", cwd: d });
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /Projekt-Config/);
    assert.doesNotMatch((r.stdout + r.stderr).split(d).join(""), /PVT_|fluffels|kubernia/); // ohne den Temp-Pfad, der selbst so heißen könnte
  });
});

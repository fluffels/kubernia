/* Projekt-Config (#1611, ADR 0022 F2): Validierung, Lader, Kommandozeile und der AK3-Negativfall
 * (fehlende Config bricht das Werkzeug ab, kein stiller Standardwert). */
import { afterEach, describe, test, vi } from "vitest";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { altName } from "./support/env-alt";
import { projektConfig, repoName } from "./support/fremd-config";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import { escapeRegex } from "../scripts/ticket-namen.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as rawPc from "../scripts/projekt-config-lib.mjs";

interface Pc {
  pruefeProjektConfig(wert: unknown): string[];
  ladeProjektConfig(opt?: { rootDir?: string; pfad?: string; env?: Record<string, string | undefined> }): { repo: string };
  trenneConfigArg(argv: string[]): { args?: string[]; pfad?: string; fehler?: string };
  configAusAufruf(argv: string[], deps?: { lade?: (a: { pfad?: string }) => unknown }): { args: string[]; config?: unknown; fehler?: string };
  boardPfad(board: Record<string, unknown>): string;
  cli(argv: string[], opt?: { rootDir?: string; out?: (s: string) => void; err?: (s: string) => void }): number;
  altEnvPraefix(config: unknown): string | null;
  altEnvName(name: string, config: unknown): string | null;
  spracheAus(config: unknown): { umschrift?: string[]; spezifikation: Record<string, unknown> };
  berechtigungenAus(config: unknown): { allow: string[]; ask: string[]; deny: string[] };
  sandboxAus(config: unknown): { allowedDomains: string[]; envVars: { name: string; mode: string }[] };
  ergaenzungAusText(text: string | null): { allow: string[]; sandbox: { allowedDomains: string[]; envVars: unknown[] } };
  umschriftAus(config: unknown): string[];
  strukturAus(config: unknown): { quelle: string; moduldoku: string };
  ausnahmenAus(config: unknown): { groesse: { datei: string; grund: string }[]; kontext: { datei: string; grund: string }[] };
  umgebungsWert(env: Record<string, string | undefined>, name: string): string | undefined;
  kernEnvNamen(ordner: string): string[];
  sammleKernEnv(datei: string, text: string): { literale: Set<string>; ohneLiteral: string[] };
  sammleKernEnvIn(ordner: string, bezug?: string | null): { literale: Set<string>; ohneLiteral: string[] };
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
  skills: { abschluss: "demo-abschluss" },
  projektliterale: { Zelda: "zelda" },
});

const temps: string[] = [];
const tmp = (): string => {
  const d = mkdtempSync(join(tmpdir(), "projekt-config-"));
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
    assert.match(mit((c) => delete c.skills), /skills/);
    assert.match(mit((c) => (c.skills = {})), /skills\.abschluss fehlt/);
    assert.match(mit((c) => (c.skills = { abschluss: "" })), /skills\.abschluss muss/);
    assert.match(mit((c) => (c.skills = [])), /skills muss/);
    assert.match(mit((c) => (c.rulesetSpiegel = "")), /rulesetSpiegel/);
    assert.match(mit((c) => (c.rulesetSpiegel = 5)), /rulesetSpiegel/);
    assert.deepEqual(pc.pruefeProjektConfig({ ...gueltig(), rulesetSpiegel: ".github/r.json" }), []);
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
  describe("Env-Schalter FACTORY_PROJEKT_CONFIG", () => {
    const schreibe = (d: string, name: string, repo: string): string => {
      const p = join(d, name);
      writeFileSync(p, JSON.stringify({ ...gueltig(), repo }));
      return p;
    };
    test("ohne Pfad und ohne rootDir gilt der Pfad aus der Umgebung statt des Standardpfads", () => {
      const fremd = schreibe(tmp(), "fremd.json", "acme/fremd");
      assert.equal(pc.ladeProjektConfig({ env: { FACTORY_PROJEKT_CONFIG: fremd } }).repo, "acme/fremd");
    });
    test("Standard-Umgebung ist process.env: ein Kindprozess mit gesetzter Variable lädt die Fremd-Config", () => {
      const fremd = schreibe(tmp(), "fremd.json", "acme/kind");
      const lib = pathToFileURL(join(WURZEL, "scripts/projekt-config-lib.mjs")).href;
      const r = spawnSync(process.execPath, ["-e", `import(${JSON.stringify(lib)}).then((m) => console.log(m.ladeProjektConfig().repo))`], {
        encoding: "utf8",
        cwd: WURZEL,
        env: { ...process.env, FACTORY_PROJEKT_CONFIG: fremd },
        timeout: 20_000,
      });
      assert.equal(r.stdout.trim(), "acme/kind", r.stderr);
    });
    test("ein expliziter pfad geht vor der Umgebung", () => {
      const d = tmp();
      const a = schreibe(d, "a.json", "acme/a");
      const b = schreibe(d, "b.json", "acme/b");
      assert.equal(pc.ladeProjektConfig({ pfad: a, env: { FACTORY_PROJEKT_CONFIG: b } }).repo, "acme/a");
    });
    test("ein explizites rootDir (anderes Repo) ignoriert die Umgebung", () => {
      const d = tmp();
      mkdirSync(join(d, ".factory"));
      writeFileSync(join(d, ".factory/projekt.json"), JSON.stringify({ ...gueltig(), repo: "acme/standard" }));
      const fremd = schreibe(d, "fremd.json", "acme/fremd");
      assert.equal(pc.ladeProjektConfig({ rootDir: d, env: { FACTORY_PROJEKT_CONFIG: fremd } }).repo, "acme/standard");
    });
    test("ohne oder leere Variable gilt der Standardpfad des Repos", () => {
      const standard = pc.ladeProjektConfig({ pfad: ".factory/projekt.json" }).repo;
      assert.equal(pc.ladeProjektConfig({ env: {} }).repo, standard);
      assert.equal(pc.ladeProjektConfig({ env: { FACTORY_PROJEKT_CONFIG: "" } }).repo, standard);
    });
    test("eine fehlende Datei am Env-Pfad wirft mit Pfad und Fix-Zeile", () => {
      assert.throws(() => pc.ladeProjektConfig({ env: { FACTORY_PROJEKT_CONFIG: "gibt-es-nicht.json" } }), /gibt-es-nicht\.json[\s\S]*Fix:/);
    });
  });
});

describe("configAusAufruf", () => {
  test("--config ohne Wert: fehler ohne ✖-Präfix (das setzt der Aufrufer), mit Fix, ohne die Config zu laden (#1866 L25c)", () => {
    const r = pc.configAusAufruf(["a", "--config"], { lade: () => assert.fail("keine Config laden") });
    assert.ok(r.fehler);
    assert.doesNotMatch(r.fehler, /^✖/);
    assert.match(r.fehler, /^--config braucht einen Pfad[\s\S]*Fix:/);
    assert.deepEqual(r.args, ["a", "--config"]);
  });
  test("Ladefehler wird als fehler durchgereicht, Gutfall liefert config und die restlichen Argumente", () => {
    assert.equal(pc.configAusAufruf(["--config", "x.json"], { lade: () => { throw new Error("kaputt"); } }).fehler, "kaputt");
    const ok = pc.configAusAufruf(["a", "--config", "x.json"], { lade: (a) => ({ pfad: a.pfad }) });
    assert.deepEqual(ok, { args: ["a"], config: { pfad: "x.json" } });
  });
});

describe("trenneConfigArg", () => {
  test("trennt --config samt Pfad ab, meldet fehlenden Pfad", () => {
    assert.deepEqual(pc.trenneConfigArg(["a", "--config", "p.json", "b"]), { args: ["a", "b"], pfad: "p.json" });
    assert.deepEqual(pc.trenneConfigArg(["a"]), { args: ["a"], pfad: undefined });
    assert.match(pc.trenneConfigArg(["--config"]).fehler ?? "", /Pfad[\s\S]*Fix:/);
    assert.deepEqual(pc.trenneConfigArg(["--config=p.json", "b"]), { args: ["b"], pfad: "p.json" });
    assert.deepEqual(pc.trenneConfigArg(["--pr", "5", "--config", "p.json"]), { args: ["--pr", "5"], pfad: "p.json" });
    assert.match(pc.trenneConfigArg(["--config="]).fehler ?? "", /Pfad/);
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
  test("fehlender Schlüssel, Objekt statt Skalar, fehlende Config, Exit 1; Aufruf-Fehler (ohne Schlüssel, fehlender --config-Wert, unbekanntes oder doppeltes Argument) Exit 2", () => {
    const p = mitConfig();
    assert.equal(lauf(["--config", p, "boards.0.gibtsnicht"]).code, 1);
    assert.equal(lauf(["--config", p, "boards"]).code, 1);
    assert.equal(lauf(["--config", p, "boards.0"]).code, 1);
    assert.equal(lauf(["--config", p, "constructor"]).code, 1);
    const fehlt = lauf(["--config", join(tmp(), "nein.json"), "repo"]);
    assert.equal(fehlt.code, 1);
    assert.match(fehlt.err.join(), /Fix:/);
    assert.equal(lauf(["--config"]).code, 2);
    assert.equal(lauf([]).code, 2);
    for (const argv of [["--bogus", "repo"], ["repo", "zwei"], ["--config", p, "--config", p, "repo"], ["--config=", "repo"]]) {
      const r = lauf(argv);
      assert.equal(r.code, 2, argv.join(" "));
      assert.deepEqual(r.out, []);
      assert.match(r.err.join(), /Fix: node scripts\/projekt-config\.mjs/);
    }
    assert.deepEqual(lauf([`--config=${p}`, "repo"]).out, ["acme/demo"]);
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

describe("altEnvPraefix", () => {
  test("Commit-Zeilen-Präfix: Bindestrich wird zum Unterstrich", () => {
    assert.equal(pc.altEnvPraefix({ praefixe: { commitZeile: "ZD-" } }), "ZD_");
    assert.equal(pc.altEnvPraefix({ praefixe: { commitZeile: "AB1-" } }), "AB1_");
  });
  test("fehlend oder ungültig: null", () => {
    for (const c of [undefined, null, {}, { praefixe: {} }, { praefixe: { commitZeile: "" } }, { praefixe: { commitZeile: "-" } }, { praefixe: { commitZeile: 5 } }, { praefixe: { commitZeile: "zd-" } }]) {
      assert.equal(pc.altEnvPraefix(c), null, JSON.stringify(c));
    }
  });
});

describe("altEnvName", () => {
  const config = { praefixe: { commitZeile: "ZD-" } };
  test("Normalfall: Kernpräfix wird durch den Altpräfix ersetzt", () => {
    assert.equal(pc.altEnvName("FACTORY_DIFF_BASE", config), "ZD_DIFF_BASE");
  });
  test("fehlender Altpräfix: null", () => {
    assert.equal(pc.altEnvName("FACTORY_DIFF_BASE", {}), null);
    assert.equal(pc.altEnvName("FACTORY_DIFF_BASE", undefined), null);
  });
  test("Name ohne Kernpräfix: null", () => {
    assert.equal(pc.altEnvName("DIFF_BASE", config), null);
    assert.equal(pc.altEnvName("ZD_DIFF_BASE", config), null);
  });
  test("Kernpräfix allein: null", () => {
    assert.equal(pc.altEnvName("FACTORY_", config), null);
  });
  test("kein String: null", () => {
    assert.equal(pc.altEnvName(5 as unknown as string, config), null);
  });
});

describe("umgebungsWert", () => {
  test("der neue Name liefert den Wert", () => {
    assert.equal(pc.umgebungsWert({ FACTORY_X_Y: "neu" }, "FACTORY_X_Y"), "neu");
  });
  test("ein gesetzter Altname wird ignoriert, nichts geht nach stderr", () => {
    const geschrieben: unknown[] = [];
    const spy = vi.spyOn(process.stderr, "write").mockImplementation((s: unknown) => (geschrieben.push(s), true));
    try {
      const alt = altName("FACTORY_X_Y");
      assert.equal(pc.umgebungsWert({ [alt]: "alt" }, "FACTORY_X_Y"), undefined);
      assert.equal(pc.umgebungsWert({ [alt]: "alt", FACTORY_X_Y: "neu" }, "FACTORY_X_Y"), "neu");
    } finally {
      spy.mockRestore();
    }
    assert.deepEqual(geschrieben, []);
  });
  test("keiner gesetzt: undefined", () => {
    assert.equal(pc.umgebungsWert({}, "FACTORY_X_Y"), undefined);
  });
  test("leerer neuer Name zählt als gesetzt", () => {
    assert.equal(pc.umgebungsWert({ FACTORY_X_Y: "" }, "FACTORY_X_Y"), "");
  });
  test("Name ohne FACTORY_-Präfix oder nur das Präfix: Wurf", () => {
    assert.throws(() => pc.umgebungsWert({}, "ZD_X_Y"), /FACTORY_/);
    assert.throws(() => pc.umgebungsWert({}, "FACTORY_"), /FACTORY_/);
    assert.throws(() => pc.umgebungsWert({}, undefined as unknown as string), /FACTORY_/);
    assert.throws(() => pc.umgebungsWert({}, 5 as unknown as string), /FACTORY_/);
  });
});

describe("kernEnvNamen und sammleKernEnv", () => {
  test("sammelt rekursiv aus *.mjs, sortiert, ohne Kommentarzeilen und Nicht-mjs, zwei Literale je Zeile zählen", () => {
    const d = tmp();
    mkdirSync(join(d, "unter"));
    writeFileSync(join(d, "a.mjs"), 'a(umgebungsWert(e, "FACTORY_B"), umgebungsWert(e, "FACTORY_A"))\n// umgebungsWert(e, "FACTORY_KOMM")\n * umgebungsWert(e, "FACTORY_STERN")\n');
    writeFileSync(join(d, "unter", "b.mjs"), 'const x = umgebungsWert(env, "FACTORY_TIEF");\n');
    writeFileSync(join(d, "c.ts"), 'umgebungsWert(e, "FACTORY_TS")\n');
    assert.deepEqual(pc.kernEnvNamen(d), ["FACTORY_A", "FACTORY_B", "FACTORY_TIEF"]);
  });
  test("sammleKernEnvIn: Literale und Aufrufe ohne Literal aus allen Dateien, Namen relativ zum Bezug", () => {
    const d = tmp();
    mkdirSync(join(d, "unter"));
    writeFileSync(join(d, "a.mjs"), 'umgebungsWert(e, "FACTORY_A")\n');
    writeFileSync(join(d, "unter", "b.mjs"), "const x = umgebungsWert(env, name);\n");
    writeFileSync(join(d, "c.ts"), "umgebungsWert(e, name)\n");
    const f = pc.sammleKernEnvIn(d, d);
    assert.deepEqual([...f.literale], ["FACTORY_A"]);
    assert.deepEqual(f.ohneLiteral, ["unter/b.mjs:1"]);
    assert.deepEqual(pc.sammleKernEnvIn(d).ohneLiteral.map((x) => x.endsWith("/unter/b.mjs:1")), [true]);
  });
  test("sammleKernEnvIn: ein Bezug, der kein Präfix des Ordners ist, schneidet nichts ab; Schrägstrich und Backslash am Bezugsende sind gleich", () => {
    const d = tmp();
    mkdirSync(join(d, "unter"));
    mkdirSync(join(d, "anders"));
    writeFileSync(join(d, "unter", "b.mjs"), "const x = umgebungsWert(env, name);\n");
    const fest = (p: string): string => p.split("\\").join("/");
    assert.deepEqual(pc.sammleKernEnvIn(join(d, "unter"), join(d, "anders")).ohneLiteral, [`${fest(join(d, "unter", "b.mjs"))}:1`]);
    assert.deepEqual(pc.sammleKernEnvIn(join(d, "unter"), join(d, "anders-lang-genug-fuer-abschnitt")).ohneLiteral, [`${fest(join(d, "unter", "b.mjs"))}:1`]);
    for (const bezug of [d, `${d}/`, `${d}\\`, fest(d)]) assert.deepEqual(pc.sammleKernEnvIn(join(d, "unter"), bezug).ohneLiteral, ["unter/b.mjs:1"], bezug);
  });
  test("das echte scripts/ enthält die Diff-Basis", () => {
    assert.ok(pc.kernEnvNamen(join(WURZEL, "scripts")).includes("FACTORY_DIFF_BASE"));
  });
  test("Aufruf ohne Literal wird gemeldet, die Definition nicht", () => {
    assert.deepEqual(pc.sammleKernEnv("scripts/x.mjs", "const v = umgebungsWert(env, name);\n").ohneLiteral, ["scripts/x.mjs:1"]);
    assert.deepEqual(pc.sammleKernEnv("scripts/projekt-config-lib.mjs", "export function umgebungsWert(env, name) {\n").ohneLiteral, []);
  });
});

describe("kein stiller Standardwert (AK3)", { timeout: 30_000 }, () => {
  test("board-lib und gh-cli ohne .factory/projekt.json: Import bricht mit Projekt-Config-Meldung, ohne Projektnamen", () => {
    const d = tmp();
    mkdirSync(join(d, "scripts", "docs-gen"), { recursive: true });
    for (const f of ["board-lib.mjs", "gh-cli.mjs", "projekt-config-lib.mjs", "fremdtext-lib.mjs", "flag-lib.mjs", "spezifikation-lib.mjs", "skill-pfade.mjs", "docs-gen/markdown.mjs"]) copyFileSync(join(WURZEL, "scripts", f), join(d, "scripts", f));
    const r = spawnSync(process.execPath, ["-e", `import(${JSON.stringify(pathToFileURL(join(d, "scripts/board-lib.mjs")).href)})`], { encoding: "utf8", cwd: d });
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /Projekt-Config/);
    // Negativfall „echter Wert erscheint nicht“: Board-ID-Präfix, Owner und Repo-Name der echten Config (das Präfix mit Anführungszeichen dahinter ist keine Board-ID)
    const echt = projektConfig();
    const muster = new RegExp(["PVT_", echt.repo.split("/")[0], repoName(echt)].map((w) => (escapeRegex as (t: string) => string)(w)).join("|"));
    assert.doesNotMatch((r.stdout + r.stderr).split(d).join(""), muster); // ohne den Temp-Pfad, der selbst so heißen könnte
  });
});

describe("Sprache als Projektwert (#1711)", () => {
  const sprache = (): Record<string, unknown> => structuredClone(pc.spracheAus(pc.ladeProjektConfig()));
  const spez = (s: Record<string, unknown>): Record<string, unknown> => s.spezifikation as Record<string, unknown>;
  const mit = (s: unknown): string[] => pc.pruefeProjektConfig({ ...gueltig(), sprache: s });

  test("spracheAus: ohne sprache wirft mit Schlüssel und Fix-Zeile (kein stiller Deutsch-Standardwert)", () => {
    for (const leer of [{}, { sprache: null }, { sprache: {} }, { sprache: { umschrift: [] } }, null, undefined]) {
      assert.throws(() => pc.spracheAus(leer), /sprache[\s\S]*Fix:/);
    }
  });
  test("echte Config: sprache vorhanden und gültig", () => {
    const config = pc.ladeProjektConfig() as unknown as Record<string, unknown>;
    assert.equal(typeof pc.spracheAus(config).spezifikation.ziel, "string");
    assert.deepEqual(pc.pruefeProjektConfig(config), []);
    assert.deepEqual(mit(sprache()), []);
  });
  test("sprache ist beim Laden optional (die Test-Config hat keine), aber ein kaputter Block wird gemeldet", () => {
    assert.deepEqual(pc.pruefeProjektConfig(gueltig()), []);
    assert.match(mit("deutsch").join("|"), /sprache muss ein Objekt/);
  });
  test("Muster, die nicht als Regex kompilieren, werden gemeldet", () => {
    const s = sprache();
    (spez(s).negativfall as Record<string, unknown>).muster = "(";
    assert.match(mit(s).join("|"), /sprache\.spezifikation\.negativfall\.muster ist keine gültige Regex/);
  });
  test("jedes der drei Muster wird einzeln geprüft: ohne muster, ohne Wort, kein Objekt, kaputte Regex", () => {
    for (const k of ["negativfall", "begrenzung", "allquantor"]) {
      const ohneMuster = sprache();
      delete (spez(ohneMuster)[k] as Record<string, unknown>).muster;
      assert.match(mit(ohneMuster).join("|"), new RegExp(`sprache\\.spezifikation\\.${k} muss ein Objekt mit nicht-leerem wort und muster`), `${k} ohne muster`);
      const ohneWort = sprache();
      (spez(ohneWort)[k] as Record<string, unknown>).wort = "";
      assert.match(mit(ohneWort).join("|"), new RegExp(`sprache\\.spezifikation\\.${k} muss ein Objekt`), `${k} ohne wort`);
      const keinObjekt = sprache();
      delete spez(keinObjekt)[k];
      assert.match(mit(keinObjekt).join("|"), new RegExp(`sprache\\.spezifikation\\.${k} muss ein Objekt`), `${k} fehlt`);
      const kaputt = sprache();
      (spez(kaputt)[k] as Record<string, unknown>).muster = "(";
      assert.match(mit(kaputt).join("|"), new RegExp(`sprache\\.spezifikation\\.${k}\\.muster ist keine gültige Regex`), `${k} kaputt`);
    }
  });
  test("akzeptanzkriterien: Liste mit leerem Text und Nicht-Liste werden gemeldet", () => {
    for (const schlecht of [["Akzeptanzkriterien", " "], "Akzeptanzkriterien", undefined]) {
      const s = sprache();
      spez(s).akzeptanzkriterien = schlecht;
      assert.match(mit(s).join("|"), /sprache\.spezifikation\.akzeptanzkriterien muss eine nicht-leere Liste/, JSON.stringify(schlecht));
    }
  });
  test("Muster ohne Wort, leere Kriterienliste und leere Texte werden gemeldet", () => {
    const a = sprache();
    delete (spez(a).begrenzung as Record<string, unknown>).wort;
    assert.match(mit(a).join("|"), /sprache\.spezifikation\.begrenzung muss ein Objekt mit nicht-leerem wort und muster/);
    const b = sprache();
    spez(b).akzeptanzkriterien = [];
    assert.match(mit(b).join("|"), /sprache\.spezifikation\.akzeptanzkriterien muss eine nicht-leere Liste/);
    const c = sprache();
    spez(c).ziel = " ";
    spez(c).nachMerge = 3;
    const m = mit(c).join("|");
    assert.match(m, /sprache\.spezifikation\.ziel muss ein nicht-leerer String/);
    assert.match(m, /sprache\.spezifikation\.nachMerge muss ein nicht-leerer String/);
  });
  test("umschrift: nur kleingeschriebene ASCII-Wörter (Für, Großbuchstaben, Leerzeichen, Nicht-Liste werden gemeldet)", () => {
    for (const schlecht of [["Für"], ["Fuer"], ["zwei wörter"], ["a-b"], "fuer", [3], []]) {
      const s = sprache();
      s.umschrift = schlecht;
      assert.match(mit(s).join("|"), /sprache\.umschrift muss eine nicht-leere Liste/, JSON.stringify(schlecht));
    }
    const s = sprache();
    delete s.umschrift;
    assert.match(mit(s).join("|"), /sprache\.umschrift/);
  });
  test("umschriftAus: liefert die Liste der echten Config, wirft ohne nicht-leere Liste", () => {
    const liste = pc.umschriftAus(pc.ladeProjektConfig());
    assert.ok(liste.includes("fuer"));
    for (const leer of [{}, { sprache: {} }, { sprache: { umschrift: [] } }, { sprache: { umschrift: "fuer" } }, null]) {
      assert.throws(() => pc.umschriftAus(leer), /sprache\.umschrift[\s\S]*Fix:/);
    }
  });
  test("sprache.spezifikation fehlt oder ist kein Objekt: gemeldet", () => {
    const s = sprache();
    delete s.spezifikation;
    assert.match(mit(s).join("|"), /sprache\.spezifikation muss ein Objekt/);
  });
});

describe("ungültige sprache: jeder Einstieg endet mit ✖-Zeile und Fix, ohne Stacktrace (#1843)", { timeout: 60_000 }, () => {
  const EINSTIEGE: string[][] = [
    ["projekt-config.mjs", "repo"],
    ["check-abnahme-nachweis.mjs"],
    ["naechstes-ticket.mjs"],
    ["spezifikation.mjs", "pruefen"],
    ["abnahme.mjs"],
  ];
  const mitSprache = (sprache: unknown): string => {
    const d = tmp();
    const pfad = join(d, "projekt.json");
    writeFileSync(pfad, JSON.stringify({ ...pc.ladeProjektConfig(), sprache }));
    return pfad;
  };
  for (const [name, sprache] of [["leer", {}], ["ohne Wörter", { spezifikation: {} }]] as const) {
    test(`sprache ${name}: ✖, Fix-Zeile, kein Stacktrace, Exit ungleich 0`, () => {
      const pfad = mitSprache(sprache);
      for (const args of EINSTIEGE) {
        const r = spawnSync(process.execPath, [join(WURZEL, "scripts", args[0] ?? ""), ...args.slice(1), "--config", pfad], { encoding: "utf8", cwd: WURZEL, timeout: 20_000 });
        const text = `${r.stderr}${r.stdout}`;
        const wer = `${args.join(" ")}: ${text.slice(0, 300)}`;
        assert.notEqual(r.status, 0, wer);
        assert.match(text, /✖/, wer);
        assert.match(text, /Fix:/, wer);
        assert.match(text, /sprache/, wer);
        assert.doesNotMatch(text, /^\s+at /m, wer);
      }
    });
  }
});

describe("check:size und check:docmap lesen die Struktur aus der Config, ohne sie endet es mit ✖ statt Stacktrace (#1843)", { timeout: 60_000 }, () => {
  const fremdrepo = (struktur: unknown): string => {
    const d = tmp();
    cpSync(join(WURZEL, "scripts"), join(d, "scripts"), { recursive: true });
    mkdirSync(join(d, ".factory"));
    const rest = { ...(pc.ladeProjektConfig() as Record<string, unknown>) };
    delete rest.struktur;
    writeFileSync(join(d, ".factory", "projekt.json"), JSON.stringify(struktur === undefined ? rest : { ...rest, struktur }));
    mkdirSync(join(d, "lib"));
    mkdirSync(join(d, "handbuch", "module"), { recursive: true });
    writeFileSync(join(d, "lib", "gross.ts"), "x\n".repeat(801));
    return d;
  };
  const lauf = (d: string, skript: string) => {
    const r = spawnSync(process.execPath, [join(d, "scripts", skript)], { encoding: "utf8", cwd: d, timeout: 20_000 });
    return { status: r.status, text: `${r.stderr}${r.stdout}` };
  };
  test("mit struktur.quelle=lib messen beide lib, nicht src", () => {
    const d = fremdrepo({ quelle: "lib", moduldoku: "handbuch/module" });
    const groesse = lauf(d, "check-size.mjs");
    assert.equal(groesse.status, 1, groesse.text);
    assert.match(groesse.text, /✖ lib\/gross\.ts: 801 Zeilen/);
    const karte = lauf(d, "check-docmap.mjs");
    assert.equal(karte.status, 1, karte.text);
    assert.match(karte.text, /Verwaistes Modul: „lib\/gross\.ts" ist in keinem handbuch\/module\/\*\.md/);
  });
  test("die Funktionen ohne Pfadangabe lesen struktur aus der Config (Default-Parameter)", () => {
    const d = fremdrepo({ quelle: "lib", moduldoku: "handbuch/module" });
    writeFileSync(join(d, "handbuch", "module", "m.md"), "`lib/gross.ts` ist beschrieben.\n");
    writeFileSync(
      join(d, "lauf.mjs"),
      [
        'import { collectSizes } from "./scripts/check-size.mjs";',
        'import { auditDocMap, collectSrcModules, parseDeepDocMaps } from "./scripts/check-docmap.mjs";',
        "console.log(JSON.stringify({ groesse: collectSizes().map((s) => s.file), module: collectSrcModules(), audit: auditDocMap().modules, doku: [...parseDeepDocMaps()] }));",
      ].join("\n"),
    );
    const r = spawnSync(process.execPath, [join(d, "lauf.mjs")], { encoding: "utf8", cwd: d, timeout: 20_000 });
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(JSON.parse(r.stdout), { groesse: ["lib/gross.ts"], module: ["lib/gross.ts"], audit: ["lib/gross.ts"], doku: ["lib/gross.ts"] });
  });
  test("ohne struktur: ✖, Schlüssel, Fix-Zeile, kein Stacktrace, Exit 1 (kein stiller Standardwert)", () => {
    const d = fremdrepo(undefined);
    for (const skript of ["check-size.mjs", "check-docmap.mjs"]) {
      const r = lauf(d, skript);
      assert.equal(r.status, 1, `${skript}: ${r.text}`);
      assert.match(r.text, /✖ [\s\S]*struktur/, skript);
      assert.match(r.text, /Fix:/, skript);
      assert.doesNotMatch(r.text, /^\s+at /m, skript);
    }
  });
});

describe("Struktur-Pfade als Projektwert (#1843)", () => {
  const mit = (s: unknown): string[] => pc.pruefeProjektConfig({ ...gueltig(), struktur: s });

  test("strukturAus: liefert quelle und moduldoku, die der echten Config zeigen auf vorhandene Ordner (die Werte prüft ein Projekt-Test)", () => {
    const echt = pc.strukturAus(pc.ladeProjektConfig());
    for (const p of [echt.quelle, echt.moduldoku]) assert.ok(existsSync(join(WURZEL, p)), `struktur-Pfad ${p} fehlt im Repo`);
    assert.deepEqual(pc.strukturAus({ struktur: { quelle: "lib", moduldoku: "docs/mod" } }), { quelle: "lib", moduldoku: "docs/mod" });
  });
  test("strukturAus: ohne Block, Nicht-Objekt oder leeren Pfad wirft mit Schlüssel und Fix-Zeile (kein stiller Standardwert)", () => {
    const falsch = [{}, null, undefined, { struktur: null }, { struktur: "src" }, { struktur: [] }, { struktur: {} },
      { struktur: { quelle: "", moduldoku: "d" } }, { struktur: { quelle: "s", moduldoku: " " } }, { struktur: { quelle: "s" } }, { struktur: { moduldoku: "d" } }];
    for (const f of falsch) assert.throws(() => pc.strukturAus(f), /struktur[\s\S]*Fix:/, JSON.stringify(f));
  });
  test("struktur ist beim Laden optional, ein kaputter Block wird gemeldet", () => {
    assert.deepEqual(pc.pruefeProjektConfig(gueltig()), []);
    assert.deepEqual(mit({ quelle: "lib", moduldoku: "docs/mod" }), []);
    assert.match(mit("src").join("|"), /struktur muss ein Objekt/);
    assert.match(mit({ quelle: "", moduldoku: "d" }).join("|"), /struktur\.quelle muss ein nicht-leerer String/);
    assert.match(mit({ quelle: "s", moduldoku: 3 }).join("|"), /struktur\.moduldoku muss ein nicht-leerer String/);
  });
  test("struktur-Pfade müssen repo-relativ und POSIX sein (kein absoluter Pfad, kein .., kein Backslash, kein End-Slash)", () => {
    const schlecht = ["/src", "C:/src", "a/../b", "..", "src\\x", "src/", "./src", "a//b"];
    for (const p of schlecht) {
      assert.match(mit({ quelle: p, moduldoku: "docs/module" }).join("|"), /struktur\.quelle muss ein repo-relativer POSIX-Pfad/, p);
      assert.match(mit({ quelle: "src", moduldoku: p }).join("|"), /struktur\.moduldoku muss ein repo-relativer POSIX-Pfad/, p);
      assert.throws(() => pc.strukturAus({ struktur: { quelle: p, moduldoku: "d" } }), /repo-relativer POSIX-Pfad[\s\S]*Fix:/, p);
    }
    for (const p of ["src", "docs/module", "a/b.c/d"]) assert.deepEqual(mit({ quelle: p, moduldoku: p }), [], p);
  });
});

describe("Ausnahmelisten als Projektwert (#1860)", () => {
  const mit = (a: unknown): string[] => pc.pruefeProjektConfig({ ...gueltig(), ausnahmen: a });
  const ok = { datei: "src/gross.ts", grund: "#893 Split offen" };

  test("ausnahmenAus: ohne Block leer, sonst die Einträge; die Dateien der echten Config existieren (die Werte prüft ein Projekt-Test)", () => {
    assert.deepEqual(pc.ausnahmenAus({}), { groesse: [], kontext: [] });
    assert.deepEqual(pc.ausnahmenAus({ ausnahmen: { groesse: [ok] } }), { groesse: [ok], kontext: [] });
    assert.deepEqual(pc.ausnahmenAus({ ausnahmen: { kontext: [ok] } }), { groesse: [], kontext: [ok] });
    const echt = pc.ausnahmenAus(pc.ladeProjektConfig());
    for (const a of [...echt.groesse, ...echt.kontext]) assert.ok(existsSync(join(WURZEL, a.datei)), `Ausnahme-Datei ${a.datei} fehlt im Repo`);
  });
  test("ausnahmenAus: ein kaputter Block wirft mit Schlüssel und Fix-Zeile", () => {
    for (const falsch of ["x", [], { groesse: {} }, { groesse: [{ datei: "a.ts" }] }]) {
      assert.throws(() => pc.ausnahmenAus({ ausnahmen: falsch }), /ausnahmen[\s\S]*Fix:/, JSON.stringify(falsch));
    }
  });
  test("Form: ausnahmen ist optional, gültige Einträge sind ok", () => {
    assert.deepEqual(pc.pruefeProjektConfig(gueltig()), []);
    assert.deepEqual(mit({ groesse: [ok], kontext: [] }), []);
    assert.deepEqual(mit({}), []);
  });
  test("Form: Nicht-Objekt, Nicht-Liste, unbekannter Schlüssel, fehlende Felder werden gemeldet", () => {
    assert.match(mit("x").join("|"), /ausnahmen muss ein Objekt/);
    assert.match(mit({ groesse: {} }).join("|"), /ausnahmen\.groesse muss eine Liste/);
    assert.match(mit({ kontext: "x" }).join("|"), /ausnahmen\.kontext muss eine Liste/);
    assert.match(mit({ andere: [] }).join("|"), /ausnahmen\.andere ist kein bekannter Schlüssel/);
    assert.match(mit({ groesse: [null] }).join("|"), /ausnahmen\.groesse\[0\] muss ein Objekt/);
    assert.match(mit({ groesse: [{ grund: "#1 x" }] }).join("|"), /ausnahmen\.groesse\[0\]\.datei muss ein nicht-leerer String/);
    assert.match(mit({ groesse: [{ datei: "a.ts" }] }).join("|"), /ausnahmen\.groesse\[0\]\.grund muss ein nicht-leerer String/);
  });
  test("Form: der Grund nennt ein Ticket #<nr>, die Datei ist repo-relativ POSIX, eine Datei steht nur einmal", () => {
    assert.match(mit({ groesse: [{ datei: "a.ts", grund: "ohne Ticket" }] }).join("|"), /ausnahmen\.groesse\[0\]\.grund muss ein Ticket #<nr> nennen/);
    assert.match(mit({ groesse: [{ datei: "a.ts", grund: "Split bis 2027" }] }).join("|"), /muss ein Ticket #<nr> nennen/);
    for (const p of ["/a.ts", "C:/a.ts", "a/../b.ts", "a\\b.ts", "a/"]) {
      assert.match(mit({ kontext: [{ datei: p, grund: "#1 x" }] }).join("|"), /ausnahmen\.kontext\[0\]\.datei muss ein repo-relativer POSIX-Pfad/, p);
    }
    assert.match(mit({ groesse: [ok, ok] }).join("|"), /ausnahmen\.groesse\[1\]\.datei „src\/gross\.ts“ steht doppelt/);
  });
});

describe("Berechtigungs-Ergänzung als Projektwert (#1874)", () => {
  const mit = (b: unknown): string[] => pc.pruefeProjektConfig({ ...gueltig(), berechtigungen: b });

  test("berechtigungenAus: ohne Block leer, sonst die Listen; die echte Config ist lesbar (die Werte prüft ein Projekt-Test)", () => {
    assert.deepEqual(pc.berechtigungenAus({}), { allow: [], ask: [], deny: [] });
    assert.deepEqual(pc.berechtigungenAus({ berechtigungen: { allow: ["mcp__a"] } }), { allow: ["mcp__a"], ask: [], deny: [] });
    assert.doesNotThrow(() => pc.berechtigungenAus(pc.ladeProjektConfig()));
  });
  test("berechtigungenAus: ein kaputter Block wirft mit Schlüssel und Fix-Zeile", () => {
    for (const falsch of ["x", [], { allow: {} }, { allow: ["Bash(rm:*)"] }]) {
      assert.throws(() => pc.berechtigungenAus({ berechtigungen: falsch }), /berechtigungen[\s\S]*Fix:/, JSON.stringify(falsch));
    }
  });
  test("Form: gültiger Block und Fehlen sind ok", () => {
    assert.deepEqual(mit({ allow: ["mcp__a"], ask: ["mcp__a__x"], deny: ["mcp__b"] }), []);
    assert.deepEqual(mit({}), []);
    assert.deepEqual(pc.pruefeProjektConfig(gueltig()), []);
  });
  test("Form: fremde Unterschlüssel, Nicht-Listen, Einträge ohne mcp__, mit Leerraum oder doppelt werden gemeldet", () => {
    assert.match(mit("x").join("|"), /berechtigungen muss ein Objekt/);
    assert.match(mit({ defaultMode: "bypassPermissions" }).join("|"), /berechtigungen\.defaultMode ist kein bekannter Schlüssel \(erlaubt: allow, ask, deny\)/);
    assert.match(mit({ additionalDirectories: ["/"] }).join("|"), /berechtigungen\.additionalDirectories ist kein bekannter Schlüssel/);
    assert.match(mit({ allow: "mcp__a" }).join("|"), /berechtigungen\.allow muss eine Liste/);
    assert.match(mit({ ask: ["Bash(rm:*)"] }).join("|"), /berechtigungen\.ask\[0\] muss mit „mcp__“ beginnen/);
    assert.match(mit({ allow: [""] }).join("|"), /berechtigungen\.allow\[0\] muss ein nicht-leerer String ohne Leerraum/);
    assert.match(mit({ allow: [1] }).join("|"), /berechtigungen\.allow\[0\] muss ein nicht-leerer String/);
    assert.match(mit({ deny: ["mcp__a b"] }).join("|"), /berechtigungen\.deny\[0\] muss ein nicht-leerer String ohne Leerraum/);
    assert.match(mit({ allow: ["mcp__a", "mcp__a"] }).join("|"), /berechtigungen\.allow\[1\] „mcp__a“ steht doppelt/);
  });
});

describe("Config-Block sandbox (#1888)", () => {
  const gueltig = (): Record<string, unknown> => pc.ladeProjektConfig();
  const mit = (b: unknown): string[] => pc.pruefeProjektConfig({ ...gueltig(), sandbox: b });

  test("sandboxAus: ohne Block leer, sonst die Listen; die echte Config ist lesbar (die Werte prüft ein Projekt-Test)", () => {
    assert.deepEqual(pc.sandboxAus({}), { allowedDomains: [], envVars: [] });
    assert.deepEqual(pc.sandboxAus({ sandbox: { allowedDomains: ["*.a.example"] } }), { allowedDomains: ["*.a.example"], envVars: [] });
    assert.doesNotThrow(() => pc.sandboxAus(pc.ladeProjektConfig()));
  });
  test("ergaenzungAusText: beide Ergänzungen aus dem Dateitext, ohne Datei leer, kaputtes JSON wirft", () => {
    const e = pc.ergaenzungAusText(JSON.stringify({ berechtigungen: { allow: ["mcp__a"] }, sandbox: { allowedDomains: ["x.example"] } }));
    assert.deepEqual([e.allow, e.sandbox.allowedDomains], [["mcp__a"], ["x.example"]]);
    assert.deepEqual(pc.ergaenzungAusText(null).sandbox, { allowedDomains: [], envVars: [] });
    assert.throws(() => pc.ergaenzungAusText("{kaputt"), /kein gültiges JSON/);
  });
  test("sandboxAus: ein kaputter Block wirft mit Schlüssel und Fix-Zeile", () => {
    for (const falsch of ["x", [], { allowedDomains: {} }, { envVars: [{ name: "X", mode: "allow" }] }]) {
      assert.throws(() => pc.sandboxAus({ sandbox: falsch }), /sandbox[\s\S]*Fix:/, JSON.stringify(falsch));
    }
  });
  test("Form: gültiger Block und Fehlen sind ok", () => {
    assert.deepEqual(mit({ allowedDomains: ["*.a.example"], envVars: [{ name: "A_TOKEN", mode: "deny" }] }), []);
    assert.deepEqual(mit({}), []);
  });
  test("Form: fremde Schlüssel, Nicht-Listen, Leerraum, doppelte Namen und envVars ohne mode deny werden gemeldet", () => {
    assert.match(mit("x").join("|"), /sandbox muss ein Objekt/);
    assert.match(mit({ filesystem: {} }).join("|"), /sandbox\.filesystem ist kein bekannter Schlüssel \(erlaubt: allowedDomains, envVars\)/);
    assert.match(mit({ allowedDomains: "a" }).join("|"), /sandbox\.allowedDomains muss eine Liste/);
    assert.match(mit({ allowedDomains: ["a b"] }).join("|"), /sandbox\.allowedDomains\[0\] braucht einen nicht-leeren Namen ohne Leerraum/);
    assert.match(mit({ allowedDomains: ["a.example", "a.example"] }).join("|"), /sandbox\.allowedDomains\[1\] „a\.example“ steht doppelt/);
    assert.match(mit({ envVars: ["A"] }).join("|"), /sandbox\.envVars\[0\] braucht einen nicht-leeren Namen/);
    assert.match(mit({ envVars: [{ name: "A", mode: "allow" }] }).join("|"), /sandbox\.envVars\[0\] muss die Form \{ "name": …, "mode": "deny" \} haben/);
    assert.match(mit({ envVars: [{ name: "A", mode: "deny", extra: 1 }] }).join("|"), /muss die Form/);
  });
});

describe("check:size und check:contextsize lesen die Ausnahmen aus der Config (#1860)", { timeout: 60_000 }, () => {
  const repo = (ausnahmen: unknown): string => {
    const d = tmp();
    cpSync(join(WURZEL, "scripts"), join(d, "scripts"), { recursive: true });
    mkdirSync(join(d, ".factory"));
    writeFileSync(join(d, ".factory", "projekt.json"), JSON.stringify({ ...(pc.ladeProjektConfig() as Record<string, unknown>), struktur: { quelle: "lib", moduldoku: "docs/module" }, ausnahmen }));
    mkdirSync(join(d, "lib"));
    writeFileSync(join(d, "lib", "gross.ts"), "x\n".repeat(801));
    writeFileSync(join(d, "lib", "klein.ts"), "x\n");
    return d;
  };
  const lauf = (d: string, skript: string) => {
    const r = spawnSync(process.execPath, [join(d, "scripts", skript)], { encoding: "utf8", cwd: d, timeout: 20_000 });
    return { status: r.status, text: `${r.stderr}${r.stdout}` };
  };
  test("check:size: eine Datei der Liste ist geduldet, ohne Eintrag rot, ein nicht mehr zu großer Eintrag stale", () => {
    const ohne = lauf(repo({ groesse: [] }), "check-size.mjs");
    assert.match(ohne.text, /✖ lib\/gross\.ts: 801 Zeilen/);
    const mit = lauf(repo({ groesse: [{ datei: "lib/gross.ts", grund: "#5 Split offen" }] }), "check-size.mjs");
    assert.doesNotMatch(mit.text, /✖ lib\/gross\.ts/);
    assert.match(mit.text, /geduldet: lib\/gross\.ts[\s\S]*#5 Split offen/);
    const stale = lauf(repo({ groesse: [{ datei: "lib/gross.ts", grund: "#5 x" }, { datei: "lib/klein.ts", grund: "#6 x" }] }), "check-size.mjs");
    assert.match(stale.text, /✖ Ausnahme stale: lib\/klein\.ts[\s\S]*ausnahmen\.groesse/);
    assert.equal(stale.status, 1, stale.text);
  });
  test("check:size und check:contextsize: eine kaputte Liste endet mit ✖, Fix-Zeile und Exit 1 (kein Stacktrace)", () => {
    for (const skript of ["check-size.mjs", "check-context-size.mjs"]) {
      const r = lauf(repo({ groesse: [{ datei: "lib/gross.ts", grund: "ohne Ticket" }] }), skript);
      assert.equal(r.status, 1, `${skript}: ${r.text}`);
      assert.match(r.text, /✖ [\s\S]*ausnahmen\.groesse\[0\]\.grund[\s\S]*Fix:/, skript);
      assert.doesNotMatch(r.text, /^\s+at /m, skript);
    }
  });
});

describe("check:contextsize, check:anysuppress und check:diffcoverage: Ausnahmen- und Struktur-Block aus der Config (#1860)", { timeout: 60_000 }, () => {
  const repo = (zusatz: Record<string, unknown>, agentsZeichen = 0): string => {
    const d = tmp();
    cpSync(join(WURZEL, "scripts"), join(d, "scripts"), { recursive: true });
    mkdirSync(join(d, ".factory"));
    writeFileSync(join(d, ".factory", "projekt.json"), JSON.stringify({ ...(pc.ladeProjektConfig() as Record<string, unknown>), ...zusatz }));
    if (agentsZeichen > 0) writeFileSync(join(d, "AGENTS.md"), "x".repeat(agentsZeichen));
    return d;
  };
  const lauf = (d: string, skript: string) => {
    const r = spawnSync(process.execPath, [join(d, "scripts", skript)], { encoding: "utf8", cwd: d, timeout: 20_000 });
    return { status: r.status, text: `${r.stderr}${r.stdout}` };
  };
  const struktur = { quelle: "lib", moduldoku: "docs/module" };

  test("check:contextsize: eine zu große Datei in ausnahmen.kontext ist geduldet, ohne Eintrag rot", () => {
    const ohne = lauf(repo({ struktur, ausnahmen: { kontext: [] } }, 40_000), "check-context-size.mjs");
    assert.equal(ohne.status, 1, ohne.text);
    assert.match(ohne.text, /✖ AGENTS\.md: 40\.000 Zeichen > Budget/);
    const mit = lauf(repo({ struktur, ausnahmen: { kontext: [{ datei: "AGENTS.md", grund: "#5 Auslagerung offen" }] } }, 40_000), "check-context-size.mjs");
    assert.equal(mit.status, 0, mit.text);
    assert.match(mit.text, /geduldet: AGENTS\.md[\s\S]*#5 Auslagerung offen/);
  });
  test("check:contextsize: ein Eintrag für eine Datei im Budget ist stale", () => {
    const r = lauf(repo({ struktur, ausnahmen: { kontext: [{ datei: "AGENTS.md", grund: "#5 x" }] } }, 100), "check-context-size.mjs");
    assert.equal(r.status, 1, r.text);
    assert.match(r.text, /✖ Ausnahme stale: AGENTS\.md[\s\S]*ausnahmen\.kontext/);
  });
  test("check:anysuppress und check:diffcoverage: ein kaputtes struktur.quelle endet mit ✖, Fix-Zeile und Exit 1 (kein Stacktrace)", () => {
    for (const skript of ["check-any-suppressions.mjs", "check-diffcoverage.mjs"]) {
      const r = lauf(repo({ struktur: { quelle: "../x", moduldoku: "docs/module" } }), skript);
      assert.equal(r.status, 1, `${skript}: ${r.text}`);
      assert.match(r.text, /✖ [\s\S]*struktur\.quelle[\s\S]*Fix:/, skript);
      assert.doesNotMatch(r.text, /^\s+at /m, skript);
    }
  });
  test("check:anysuppress und check:diffcoverage: ohne struktur-Block (beim Laden optional) endet es mit ✖, Fix-Zeile und Exit 1", () => {
    for (const skript of ["check-any-suppressions.mjs", "check-diffcoverage.mjs"]) {
      const r = lauf(repo({ struktur: undefined }), skript);
      assert.equal(r.status, 1, `${skript}: ${r.text}`);
      assert.match(r.text, /✖ [\s\S]*struktur[\s\S]*Fix:/, skript);
      assert.doesNotMatch(r.text, /^\s+at /m, skript);
    }
  });
});

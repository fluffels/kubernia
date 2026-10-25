/* @harness-waechter
 * Fremd-Config-Probe (#1906): ergänzt die Fremd-Config um die Blöcke der echten Config, wählt die Kern-Tests aus der Extraktionsliste
 * und fährt sie mit `FACTORY_PROJEKT_CONFIG` im Kindlauf; die echte `.factory/projekt.json` bleibt unberührt.
 *
 * Reines Node-Tooling ohne Declaration-File: Import über `unknown` auf ein lokales Interface. */
import { afterEach, describe, expect, test } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as raw from "../../scripts/fremd-config-probe.mjs";
import { FREMD, projektConfig } from "../support/fremd-config";

type Lauf = { befehl: string; args: string[]; env: Record<string, string | undefined> };
type Bewertung = { exit: number; erwartet: string[]; unerwartet: string[]; ueberfluessig: string[]; meldungen: string[] };
type Ergebnis = Bewertung & { konfigPfad: string; ergaenzt: string[]; tests: string[] };
interface Probe {
  PROBE_ENV: string;
  PROBE_WURZEL_ENV: string;
  PROBE_STANDARD: string;
  PROBE_MARKER: string;
  PROBE_TEST: string;
  istMarkiert: (text: string | null) => boolean;
  rotePfade: (berichtText: string, wurzel: string) => string[] | null;
  bewerte: (o: { status: number | null | undefined; rot: string[] | null; markiert: string[] }) => Bewertung;
  baueProbeConfig: (fremd: Record<string, unknown>, echt: Record<string, unknown>) => { config: Record<string, unknown>; ergaenzt: string[] };
  kernTestPfade: (liste: unknown, getrackt: string[], ohne?: string[]) => string[];
  probe: (o: {
    wurzel: string;
    fremdPfad: string;
    getrackt: string[];
    run: (l: Lauf) => { status: number | null };
    tempOrdner?: () => string;
    env?: Record<string, string | undefined>;
    ohne?: string[];
  }) => Ergebnis;
  cli: (argv: string[], o?: { wurzel?: string; out?: (s: string) => void; err?: (s: string) => void; getrackt?: string[]; run?: (l: Lauf) => { status: number | null } }) => number;
}
const p = raw as unknown as Probe;

const dirs: string[] = [];
const tmp = (): string => {
  const d = mkdtempSync(join(tmpdir(), "fremd-probe-"));
  dirs.push(d);
  return d;
};
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const LISTE = {
  version: 1,
  eintraege: [
    { muster: "test/a.test.ts", art: "kern-test", grund: "x" },
    { muster: "test/b*.test.ts", art: "kern-test", grund: "x" },
    { muster: "test/p.test.ts", art: "projekt-test", grund: "x" },
    { muster: "test/support/h.ts", art: "test-hilfe", grund: "x" },
  ],
};

describe("baueProbeConfig", () => {
  test("Blöcke, die in der Fremd-Config fehlen, kommen aus der echten Config; vorhandene bleiben fremd", () => {
    const r = p.baueProbeConfig({ repo: "zz/z", sprache: { a: 1 } }, { repo: "echt/echt", sprache: { a: 2 }, spezifikation: { x: 1 }, sandbox: { y: 2 } });
    expect(r.config).toEqual({ repo: "zz/z", sprache: { a: 1 }, spezifikation: { x: 1 }, sandbox: { y: 2 } });
    expect(r.ergaenzt).toEqual(["spezifikation", "sandbox"]);
  });
  test("nichts fehlt: nichts ergänzt, Eingaben bleiben unverändert (Kopie)", () => {
    const fremd = { repo: "zz/z" };
    const r = p.baueProbeConfig(fremd, { repo: "echt/echt" });
    expect(r.ergaenzt).toEqual([]);
    expect(r.config).not.toBe(fremd);
    expect(r.config).toEqual({ repo: "zz/z" });
  });
  test("die echte Fremd-Config bekommt den Block spezifikation aus der echten Config", () => {
    const echt = projektConfig() as unknown as Record<string, unknown>;
    const r = p.baueProbeConfig(FREMD as unknown as Record<string, unknown>, echt);
    expect(r.ergaenzt).toContain("spezifikation");
    expect(r.config.repo).toBe(FREMD.repo);
  });
});

describe("kernTestPfade", () => {
  test("nur getrackte Dateien der Art kern-test, sortiert, ohne ausgenommene", () => {
    const getrackt = ["test/a.test.ts", "test/b2.test.ts", "test/p.test.ts", "test/support/h.ts", "test/c.test.ts", "src/x.ts"];
    expect(p.kernTestPfade(LISTE, getrackt)).toEqual(["test/a.test.ts", "test/b2.test.ts"]);
    expect(p.kernTestPfade(LISTE, getrackt, ["test/a.test.ts"])).toEqual(["test/b2.test.ts"]);
  });
  test("eine Datei, die kein Test ist, wird auch bei passender Art nicht gefahren", () => {
    const liste = { version: 1, eintraege: [{ muster: "test/fix/*", art: "kern-test", grund: "x" }] };
    expect(p.kernTestPfade(liste, ["test/fix/a.json"])).toEqual([]);
  });
});

describe("istMarkiert", () => {
  test("Marker mit Grund in den ersten Zeilen zählt", () => {
    expect(p.istMarkiert(`/* @harness-waechter\n * @probe-echte-dateien liest echte Projektdateien\n */\nimport x`)).toBe(true);
    expect(p.istMarkiert("// @probe-echte-dateien Grund\r\nimport x")).toBe(true);
  });
  test("Negativ: ohne Grund, ohne Marker, nicht lesbar oder erst nach dem Kopf zählt nicht", () => {
    expect(p.istMarkiert("// @probe-echte-dateien\nimport x")).toBe(false);
    expect(p.istMarkiert("// @probe-echte-dateien   \nimport x")).toBe(false);
    expect(p.istMarkiert("import x")).toBe(false);
    expect(p.istMarkiert(null)).toBe(false);
    expect(p.istMarkiert(`${"\n".repeat(60)}// @probe-echte-dateien Grund`)).toBe(false);
  });
});

describe("rotePfade", () => {
  const bericht = (ergebnisse: unknown): string => JSON.stringify({ testResults: ergebnisse });
  test("nur Dateien mit Status failed, relativ zur Wurzel mit Schrägstrich, sortiert", () => {
    const w = join(tmpdir(), "w");
    const t = bericht([
      { name: join(w, "test", "b.test.ts"), status: "failed" },
      { name: join(w, "test", "harness", "a.test.ts"), status: "failed" },
      { name: join(w, "test", "c.test.ts"), status: "passed" },
    ]);
    expect(p.rotePfade(t, w)).toEqual(["test/b.test.ts", "test/harness/a.test.ts"]);
  });
  test("Negativ: kein JSON, falsche Form oder Eintrag ohne Namen ergibt null bzw. wird übergangen", () => {
    expect(p.rotePfade("kein json", "/w")).toBeNull();
    expect(p.rotePfade(JSON.stringify({ x: 1 }), "/w")).toBeNull();
    expect(p.rotePfade("null", "/w")).toBeNull();
    expect(p.rotePfade(bericht([{ status: "failed" }, null]), "/w")).toEqual([]);
  });
});

describe("bewerte", () => {
  test("alles grün, nichts markiert: Exit 0, keine Meldung", () => {
    expect(p.bewerte({ status: 0, rot: null, markiert: [] })).toEqual({ exit: 0, erwartet: [], unerwartet: [], ueberfluessig: [], meldungen: [] });
  });
  test("nur markierte Dateien rot: Exit 0 mit Meldung „erwartet rot“", () => {
    const r = p.bewerte({ status: 1, rot: ["test/a.test.ts"], markiert: ["test/a.test.ts", "test/b.test.ts"] });
    expect(r.erwartet).toEqual(["test/a.test.ts"]);
    expect(r.ueberfluessig).toEqual(["test/b.test.ts"]);
    expect(r.exit).toBe(1);
    const nur = p.bewerte({ status: 1, rot: ["test/a.test.ts"], markiert: ["test/a.test.ts"] });
    expect(nur.exit).toBe(0);
    expect(nur.meldungen.join("\n")).toMatch(/erwartet rot/);
  });
  test("Negativ: eine unmarkierte rote Datei ist Exit 1, auch neben markierten", () => {
    const r = p.bewerte({ status: 1, rot: ["test/a.test.ts", "test/x.test.ts"], markiert: ["test/a.test.ts"] });
    expect(r.exit).toBe(1);
    expect(r.unerwartet).toEqual(["test/x.test.ts"]);
    expect(r.meldungen.join("\n")).toMatch(/ohne Marker[\s\S]*test\/x\.test\.ts/);
  });
  test("Ratsche: eine markierte Datei, die grün ist, meldet „Marker entfernen“ und ist Exit 1", () => {
    const r = p.bewerte({ status: 0, rot: null, markiert: ["test/a.test.ts"] });
    expect(r.exit).toBe(1);
    expect(r.meldungen.join("\n")).toMatch(/@probe-echte-dateien entfernen[\s\S]*test\/a\.test\.ts/);
  });
  test("Negativ fail-closed: kein Status, rot ohne lesbaren Bericht oder ohne rote Datei ist Exit 1", () => {
    expect(p.bewerte({ status: null, rot: [], markiert: [] }).exit).toBe(1);
    expect(p.bewerte({ status: undefined, rot: [], markiert: [] }).exit).toBe(1);
    expect(p.bewerte({ status: 1, rot: null, markiert: ["test/a.test.ts"] })).toMatchObject({ exit: 1, meldungen: [expect.stringMatching(/Bericht/)] });
    expect(p.bewerte({ status: 1, rot: [], markiert: ["test/a.test.ts"] })).toMatchObject({ exit: 1, meldungen: [expect.stringMatching(/keine rote/)] });
  });
});

describe("probe", () => {
  test("Kindlauf bekommt Wurzel-Riegel und JSON-Bericht; markierte rote Datei ist Exit 0, ungemarkte rot ist Exit 1", () => {
    const wurzel = tmp();
    mkdirSync(join(wurzel, ".factory"));
    mkdirSync(join(wurzel, "test"));
    writeFileSync(join(wurzel, ".factory/projekt.json"), JSON.stringify({ repo: "echt/echt" }));
    writeFileSync(join(wurzel, ".factory/extraktion.json"), JSON.stringify(LISTE));
    writeFileSync(join(wurzel, "fremd.json"), JSON.stringify({ repo: "zz/z" }));
    writeFileSync(join(wurzel, "test/a.test.ts"), "// @probe-echte-dateien liest echte Dateien\n");
    writeFileSync(join(wurzel, "test/b1.test.ts"), "// ohne Marker\n");
    const rotBei = (rot: string[]) => (lauf: Lauf): { status: number } => {
      const flag = lauf.args.find((a) => a.startsWith("--outputFile.json=")) ?? "";
      writeFileSync(flag.slice("--outputFile.json=".length), JSON.stringify({ testResults: rot.map((r) => ({ name: join(wurzel, r), status: "failed" })) }));
      expect(lauf.args).toEqual(expect.arrayContaining(["--reporter=default", "--reporter=json"]));
      expect(lauf.env[p.PROBE_WURZEL_ENV]).toBe(wurzel);
      return { status: 1 };
    };
    const getrackt = ["test/a.test.ts", "test/b1.test.ts"];
    const erwartet = p.probe({ wurzel, fremdPfad: "fremd.json", getrackt, tempOrdner: tmp, run: rotBei(["test/a.test.ts"]) });
    expect(erwartet.exit).toBe(0);
    expect(erwartet.erwartet).toEqual(["test/a.test.ts"]);
    expect(p.probe({ wurzel, fremdPfad: "fremd.json", getrackt, tempOrdner: tmp, run: rotBei(["test/a.test.ts", "test/b1.test.ts"]) }).exit).toBe(1);
    expect(p.probe({ wurzel, fremdPfad: "fremd.json", getrackt, tempOrdner: tmp, run: () => ({ status: 0 }) }).ueberfluessig).toEqual(["test/a.test.ts"]);
  });
  test("der Standard der Probe ist die eigene Fixture, die es gibt und deren Werte von der Fremd-Config abweichen", () => {
    const eigene = JSON.parse(readFileSync(join(__dirname, "../..", p.PROBE_STANDARD), "utf8")) as { repo: string };
    expect(eigene.repo).not.toBe(FREMD.repo);
    expect(JSON.stringify(eigene)).not.toMatch(/zz/i);
  });

  const baue = (): { wurzel: string; fremdPfad: string; projektText: string } => {
    const wurzel = tmp();
    mkdirSync(join(wurzel, ".factory"));
    const projektText = JSON.stringify({ repo: "echt/echt", spezifikation: { s: 1 } });
    writeFileSync(join(wurzel, ".factory/projekt.json"), projektText);
    writeFileSync(join(wurzel, ".factory/extraktion.json"), JSON.stringify(LISTE));
    writeFileSync(join(wurzel, "fremd.json"), JSON.stringify({ repo: "zz/z" }));
    return { wurzel, fremdPfad: "fremd.json", projektText };
  };
  test("Kindlauf bekommt die Temp-Config per Env, enthält fremdes Repo plus ergänzten Block; die echte Datei bleibt, Temp wird entfernt", () => {
    const { wurzel, fremdPfad, projektText } = baue();
    const tempWurzel = tmp();
    const gesehen: { lauf: Lauf; text: string }[] = [];
    const r = p.probe({
      wurzel,
      fremdPfad,
      getrackt: ["test/a.test.ts", "test/p.test.ts", "test/b1.test.ts"],
      tempOrdner: () => tempWurzel,
      env: { VORHANDEN: "1" },
      run: (lauf) => {
        gesehen.push({ lauf, text: readFileSync(lauf.env[p.PROBE_ENV] ?? "", "utf8") });
        return { status: 1 };
      },
    });
    expect(r.exit).toBe(1);
    expect(gesehen).toHaveLength(1);
    const eintrag = gesehen[0];
    expect(JSON.parse(eintrag?.text ?? "{}")).toEqual({ repo: "zz/z", spezifikation: { s: 1 } });
    expect(eintrag?.lauf.env.VORHANDEN).toBe("1");
    expect(eintrag?.lauf.args).toEqual(expect.arrayContaining(["test/a.test.ts", "test/b1.test.ts"]));
    expect(eintrag?.lauf.args).not.toContain("test/p.test.ts");
    expect(r.tests).toEqual(["test/a.test.ts", "test/b1.test.ts"]);
    expect(r.ergaenzt).toEqual(["spezifikation"]);
    expect(readFileSync(join(wurzel, ".factory/projekt.json"), "utf8")).toBe(projektText);
    expect(() => readFileSync(r.konfigPfad, "utf8")).toThrow();
  });
  test("die Umgebung des Aufrufers wird nicht verändert (Schalter nur im Kindlauf)", () => {
    const { wurzel, fremdPfad } = baue();
    const env: Record<string, string | undefined> = {};
    p.probe({ wurzel, fremdPfad, getrackt: ["test/a.test.ts"], tempOrdner: tmp, env, run: () => ({ status: 0 }) });
    expect(env[p.PROBE_ENV]).toBeUndefined();
  });
  test("ohne `ohne`-Argument läuft die Probe nie im eigenen Kindlauf, auch wenn die Liste sie als kern-test führt", () => {
    const { wurzel, fremdPfad } = baue();
    const liste = { ...LISTE, eintraege: [...LISTE.eintraege, { muster: p.PROBE_TEST, art: "kern-test", grund: "x" }] };
    writeFileSync(join(wurzel, ".factory/extraktion.json"), JSON.stringify(liste));
    const r = p.probe({ wurzel, fremdPfad, getrackt: ["test/a.test.ts", p.PROBE_TEST], tempOrdner: tmp, run: () => ({ status: 0 }) });
    expect(r.tests).toEqual(["test/a.test.ts"]);
  });
  test("ein Kindlauf ohne Exit-Status (Abbruch) ist rot, nie grün", () => {
    const { wurzel, fremdPfad } = baue();
    const r = p.probe({ wurzel, fremdPfad, getrackt: ["test/a.test.ts"], tempOrdner: tmp, run: () => ({ status: null }) });
    expect(r.exit).not.toBe(0);
  });
  test("keine Kern-Tests: wirft, statt grün zu melden", () => {
    const { wurzel, fremdPfad } = baue();
    expect(() => p.probe({ wurzel, fremdPfad, getrackt: ["test/p.test.ts"], tempOrdner: tmp, run: () => ({ status: 0 }) })).toThrow(/Kern-Test/);
  });
  test("fehlende Fremd-Config: wirft mit Pfad und Fix-Zeile, ohne den Kindlauf zu starten", () => {
    const { wurzel } = baue();
    let gestartet = false;
    expect(() => p.probe({ wurzel, fremdPfad: "gibt-es-nicht.json", getrackt: ["test/a.test.ts"], tempOrdner: tmp, run: () => ((gestartet = true), { status: 0 }) })).toThrow(/gibt-es-nicht\.json[\s\S]*Fix:/);
    expect(gestartet).toBe(false);
  });
});

describe("cli", () => {
  test("unbekanntes Flag: Aufruf-Exit 2 mit Aufrufzeile", () => {
    const err: string[] = [];
    expect(p.cli(["--gibtsnicht"], { err: (s) => err.push(s), out: () => {} })).toBe(2);
    expect(err.join("\n")).toMatch(/Aufruf:/);
  });
  test("Exit des Kindlaufs wird durchgereicht", () => {
    const wurzel = tmp();
    mkdirSync(join(wurzel, ".factory"));
    writeFileSync(join(wurzel, ".factory/projekt.json"), JSON.stringify({ repo: "echt/echt" }));
    writeFileSync(join(wurzel, ".factory/extraktion.json"), JSON.stringify(LISTE));
    writeFileSync(join(wurzel, "fremd.json"), JSON.stringify({ repo: "zz/z" }));
    const out: string[] = [];
    const lauf = (status: number) => p.cli(["--fremd", "fremd.json"], { wurzel, out: (s) => out.push(s), err: () => {}, getrackt: ["test/a.test.ts"], run: () => ({ status }) });
    expect(lauf(0)).toBe(0);
    expect(lauf(1)).toBe(1);
  });
  test("fehlende Fremd-Config: Exit 1 mit Meldung auf err, nie Exit 0 (fail-closed)", () => {
    const wurzel = tmp();
    mkdirSync(join(wurzel, ".factory"));
    writeFileSync(join(wurzel, ".factory/projekt.json"), JSON.stringify({ repo: "echt/echt" }));
    writeFileSync(join(wurzel, ".factory/extraktion.json"), JSON.stringify(LISTE));
    const err: string[] = [];
    let gestartet = false;
    const exit = p.cli(["--fremd", "gibt-es-nicht.json"], { wurzel, out: () => {}, err: (s) => err.push(s), getrackt: ["test/a.test.ts"], run: () => ((gestartet = true), { status: 0 }) });
    expect(exit).toBe(1);
    expect(err.join("\n")).toMatch(/gibt-es-nicht\.json/);
    expect(gestartet).toBe(false);
  });
  test("--wurzel wählt das Repo, dessen Config und Extraktionsliste gelten", () => {
    const wurzel = tmp();
    mkdirSync(join(wurzel, ".factory"));
    writeFileSync(join(wurzel, ".factory/projekt.json"), JSON.stringify({ repo: "echt/echt" }));
    writeFileSync(join(wurzel, ".factory/extraktion.json"), JSON.stringify(LISTE));
    writeFileSync(join(wurzel, "fremd.json"), JSON.stringify({ repo: "zz/z" }));
    const andere = tmp();
    const err: string[] = [];
    const exit = p.cli(["--wurzel", wurzel, "--fremd", "fremd.json"], { wurzel: andere, out: () => {}, err: (s) => err.push(s), getrackt: ["test/a.test.ts"], run: () => ({ status: 0 }) });
    expect(err).toEqual([]);
    expect(exit).toBe(0);
  });
});

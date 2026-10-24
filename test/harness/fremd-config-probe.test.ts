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
type Ergebnis = { exit: number; konfigPfad: string; ergaenzt: string[]; tests: string[] };
interface Probe {
  PROBE_ENV: string;
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

describe("probe", () => {
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
});

#!/usr/bin/env node
/* Fremd-Config-Probe (#1906): fährt die Kern-Tests (Art `kern-test` der Extraktionsliste) gegen eine Fremd-Config.
 *
 *   node scripts/fremd-config-probe.mjs [--fremd <pfad>] [--wurzel <pfad>]   (npm run probe:fremdconfig)
 *
 * Die Temp-Config besteht aus der Fremd-Config (Standard `test/fixtures/projekt-fremd.json`) plus allen Blöcken der echten Config, die dort
 * fehlen (abgeleitet, nicht aufgelistet). Der Pfad geht nur dem Kindlauf per `FACTORY_PROJEKT_CONFIG` (`ladeProjektConfig`) mit; die echte
 * `.factory/projekt.json` wird nie gelesen zum Schreiben, die Umgebung des Aufrufers bleibt unverändert. Exit: 0 grün, 1 rot (Kindlauf), 2 Aufruf.
 * Rot ist ein übersehenes Projektliteral (beheben), ein fehlender Block (echten Block ergänzen) oder ein Test, der echte Projektdateien liest
 * (bekannte Ausnahme, im PR nennen). Die Funktionen sind pur bzw. nehmen Läufer und Dateizugriff als Parameter.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { artVon, EXTRAKTION_PFAD } from "./besitz-lib.mjs";
import { AUFRUF_EXIT, flagsLesen } from "./flag-lib.mjs";
import { istDirektaufruf } from "./hook-io.mjs";
import { PROJEKT_CONFIG } from "./projekt-config-lib.mjs";

/** Name der Umgebungsvariable, die `ladeProjektConfig` liest; die Probe setzt sie nur im Kindlauf. */
export const PROBE_ENV = "FACTORY_PROJEKT_CONFIG";

/** Standard-Fremd-Config. */
export const FREMD_STANDARD = "test/fixtures/projekt-fremd.json";

/** Die Testdatei der Probe selbst läuft nie im Kindlauf (sie startete sonst die Probe in der Probe). */
export const PROBE_TEST = "test/harness/fremd-config-probe.test.ts";

const WURZEL = join(dirname(fileURLToPath(import.meta.url)), "..");
const AUFRUF = "Aufruf: node scripts/fremd-config-probe.mjs [--fremd <pfad>] [--wurzel <pfad>]";

/** Pur: Kopie der Fremd-Config plus jeder Block der echten Config, der in der Fremd-Config fehlt. `ergaenzt` nennt die übernommenen Schlüssel in der Reihenfolge der echten Config. */
export function baueProbeConfig(fremd, echt) {
  const config = { ...fremd };
  const ergaenzt = [];
  for (const [k, v] of Object.entries(echt)) {
    if (Object.hasOwn(config, k)) continue;
    config[k] = v;
    ergaenzt.push(k);
  }
  return { config, ergaenzt };
}

/** Pur: die getrackten Testdateien, die die Extraktionsliste als `kern-test` führt, sortiert, ohne `ohne`. */
export function kernTestPfade(liste, getrackt, ohne = []) {
  return getrackt
    .filter((p) => /^test\/.*\.test\.ts$/.test(p) && artVon(liste, p) === "kern-test" && !ohne.includes(p))
    .sort();
}

function leseJson(pfad, was) {
  try {
    return JSON.parse(readFileSync(pfad, "utf8"));
  } catch (e) {
    throw new Error(`${was} fehlt oder ist kein gültiges JSON: ${pfad} (${e instanceof Error ? e.message : e})\nFix: ${was === "Fremd-Config" ? `--fremd <pfad> angeben oder ${FREMD_STANDARD} anlegen` : `${was} im Repo anlegen`}`, { cause: e });
  }
}

/** Standard-Läufer: Vitest als Kindprozess mit durchgereichter Ausgabe. */
const vitestLauf = ({ befehl, args, env, cwd }) => spawnSync(befehl, args, { cwd, env, stdio: "inherit" });

/** Standard: die getrackten Dateien aus Git. */
function gitGetrackt(wurzel) {
  const r = spawnSync("git", ["-C", wurzel, "ls-files"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(`git ls-files schlug fehl in ${wurzel}\nFix: die Probe in einem Git-Checkout starten (--wurzel <pfad>)`);
  return r.stdout.split(/\r?\n/).filter(Boolean);
}

/**
 * Baut die Temp-Config, fährt die Kern-Tests im Kindlauf damit und räumt auf. Wirft bei fehlender Config oder Extraktionsliste und ohne Kern-Tests.
 * `run({ befehl, args, env, cwd })` liefert `{ status }`; `status` ohne Zahl (Abbruch) zählt als rot.
 */
export function probe({ wurzel = WURZEL, fremdPfad = FREMD_STANDARD, getrackt = gitGetrackt(wurzel), run = vitestLauf, tempOrdner = tmpdir, env = process.env, ohne = [PROBE_TEST], vitest = join(wurzel, "node_modules", "vitest", "vitest.mjs") } = {}) {
  const fremd = leseJson(resolve(wurzel, fremdPfad), "Fremd-Config");
  const echt = leseJson(join(wurzel, PROJEKT_CONFIG), "Projekt-Config");
  const liste = leseJson(join(wurzel, EXTRAKTION_PFAD), "Extraktionsliste");
  const tests = kernTestPfade(liste, getrackt, ohne);
  if (tests.length === 0) throw new Error(`keine Kern-Test-Dateien in ${EXTRAKTION_PFAD} gefunden\nFix: Einträge der Art kern-test und getrackte Testdateien prüfen`);
  const { config, ergaenzt } = baueProbeConfig(fremd, echt);
  const ordner = mkdtempSync(join(tempOrdner(), "fremd-probe-"));
  const konfigPfad = join(ordner, "projekt.json");
  try {
    mkdirSync(ordner, { recursive: true });
    writeFileSync(konfigPfad, `${JSON.stringify(config, null, 2)}\n`);
    const r = run({ befehl: process.execPath, args: [vitest, "run", ...tests], env: { ...env, [PROBE_ENV]: konfigPfad }, cwd: wurzel });
    return { exit: typeof r.status === "number" ? r.status : 1, konfigPfad, ergaenzt, tests };
  } finally {
    rmSync(ordner, { recursive: true, force: true });
  }
}

/** Kommandozeile; gibt den Exit-Code zurück. */
export function cli(argv, { wurzel = WURZEL, out = console.log, err = console.error, getrackt, run } = {}) {
  const gelesen = flagsLesen(argv, { fremd: { type: "string" }, wurzel: { type: "string" } });
  if (gelesen.fehler) {
    err(`fremd-config-probe: ${gelesen.fehler.text}\n${AUFRUF}`);
    return AUFRUF_EXIT;
  }
  const w = gelesen.werte.wurzel ?? wurzel;
  let r;
  try {
    r = probe({ wurzel: w, fremdPfad: gelesen.werte.fremd, ...(getrackt ? { getrackt } : {}), ...(run ? { run } : {}) });
  } catch (e) {
    err(`fremd-config-probe: ${e instanceof Error ? e.message : e}`);
    return 1;
  }
  out(`fremd-config-probe: ${r.tests.length} Kern-Test-Dateien, ergänzte Blöcke der echten Config: ${r.ergaenzt.join(", ") || "keine"}, Exit ${r.exit}`);
  return r.exit;
}

if (istDirektaufruf(import.meta.url)) process.exitCode = cli(process.argv.slice(2));

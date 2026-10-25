#!/usr/bin/env node
/* Fremd-Config-Probe (#1906): fährt die Kern-Tests (Art `kern-test` der Extraktionsliste) gegen eine Fremd-Config.
 *
 *   node scripts/fremd-config-probe.mjs [--fremd <pfad>] [--wurzel <pfad>]   (npm run probe:fremdconfig)
 *
 * Die Temp-Config besteht aus der Probe-Config (Standard `test/fixtures/projekt-probe.json`, eigene Werte, die nie mit der Fremd-Config der Tests
 * kollidieren) plus allen Blöcken der echten Config, die dort fehlen (abgeleitet, nicht aufgelistet). Der Pfad geht nur dem Kindlauf per
 * `FACTORY_PROJEKT_CONFIG` mit, zusammen mit `FACTORY_PROJEKT_WURZEL` (der Lader gilt die Variable nur unter Vitest und nur in dieser Wurzel, so erben
 * sie keine Temp-Repos); die echte `.factory/projekt.json` bleibt unberührt, die Umgebung des Aufrufers unverändert.
 * Exit: 0 grün, 1 rot, 2 Aufruf. Rot ist ein übersehenes Projektliteral oder ein fehlender Block (beheben). Ein Test, der echte Projektdateien liest,
 * trägt im Kopf `@probe-echte-dateien <Grund>`: seine Datei darf rot sein (Exit 0, „erwartet rot“); wird sie grün, meldet die Probe „Marker entfernen“
 * und scheitert (Ratsche). Bekannte Grenze: der Marker gilt je Datei, nicht je Test. Die Funktionen sind pur bzw. nehmen Läufer und Dateizugriff als Parameter.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { artVon, EXTRAKTION_PFAD, istTestDatei } from "./besitz-extraktion.mjs";
import { AUFRUF_EXIT, flagsLesen } from "./flag-lib.mjs";
import { istDirektaufruf } from "./direktaufruf.mjs";
import { PROJEKT_CONFIG } from "./projekt-config-lib.mjs";

/** Name der Umgebungsvariable, die `ladeProjektConfig` liest; die Probe setzt sie nur im Kindlauf. */
export const PROBE_ENV = "FACTORY_PROJEKT_CONFIG";

/** Name der Umgebungsvariable, die dem Lader die Wurzel nennt, für die `FACTORY_PROJEKT_CONFIG` gilt (Riegel, `ladeProjektConfig`). */
export const PROBE_WURZEL_ENV = "FACTORY_PROJEKT_WURZEL";

/** Standard-Config der Probe: eigene Werte, nie die der Fremd-Config der Tests (`test/support/fremd-config.ts`). */
export const PROBE_STANDARD = "test/fixtures/projekt-probe.json";

/** Marker im Kopf einer Testdatei (erste Zeilen), die echte Projektdateien liest und darum unter der Probe rot sein darf; verlangt einen Grund. */
export const PROBE_MARKER = "@probe-echte-dateien";
const MARKER_MUSTER = /@probe-echte-dateien[ \t]+\S/;
const KOPF_ZEILEN = 40;

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
    .filter((p) => istTestDatei(p) && artVon(liste, p) === "kern-test" && !ohne.includes(p))
    .sort();
}

/** Pur: trägt der Kopf (erste Zeilen) einer Testdatei den Marker samt Grund? `null` (Datei nicht lesbar) zählt als unmarkiert. */
export function istMarkiert(text) {
  return typeof text === "string" && MARKER_MUSTER.test(text.split(/\r?\n/).slice(0, KOPF_ZEILEN).join("\n"));
}

/** Pur: die roten Dateien (Status `failed`) aus dem Text des Vitest-JSON-Berichts, relativ zur Wurzel mit `/`; `null`, wenn der Text kein Bericht ist. */
export function rotePfade(berichtText, wurzel) {
  let b;
  try {
    b = JSON.parse(berichtText);
  } catch {
    return null;
  }
  if (!b || !Array.isArray(b.testResults)) return null;
  return b.testResults
    .filter((r) => r && r.status === "failed" && typeof r.name === "string")
    .map((r) => relative(wurzel, r.name).split(sep).join("/"))
    .sort();
}

const ABBRUCH = { erwartet: [], unerwartet: [], ueberfluessig: [] };

/**
 * Pur: wertet den Kindlauf aus. `status`: Exit des Kindlaufs; `rot`: rote Dateien aus dem Bericht (`null` = kein lesbarer Bericht); `markiert`: die
 * gefahrenen Dateien mit Marker. Exit 0 nur ohne unerwartetes Rot und ohne überflüssigen Marker; ein Kindlauf ohne Status, ohne Bericht bei Rot oder
 * rot ohne rote Datei ist fail-closed rot. `meldungen` nennt jeden Grund.
 */
export function bewerte({ status, rot, markiert }) {
  if (typeof status !== "number") return { exit: 1, ...ABBRUCH, meldungen: ["Kindlauf ohne Exit-Status (Abbruch)"] };
  if (status !== 0 && rot === null) return { exit: 1, ...ABBRUCH, meldungen: [`Kindlauf rot (Exit ${status}), aber kein lesbarer Vitest-Bericht`] };
  if (status !== 0 && rot?.length === 0) return { exit: 1, ...ABBRUCH, meldungen: [`Kindlauf rot (Exit ${status}), aber keine rote Testdatei im Bericht`] };
  const roteDateien = status === 0 ? [] : (rot ?? []);
  const erwartet = roteDateien.filter((d) => markiert.includes(d));
  const unerwartet = roteDateien.filter((d) => !markiert.includes(d));
  const ueberfluessig = markiert.filter((d) => !roteDateien.includes(d));
  const meldungen = [];
  if (unerwartet.length > 0) meldungen.push(`rot ohne Marker (übersehenes Projektliteral, beheben): ${unerwartet.join(", ")}`);
  if (erwartet.length > 0) meldungen.push(`erwartet rot (echte Projektdateien): ${erwartet.join(", ")}`);
  if (ueberfluessig.length > 0) meldungen.push(`grün trotz Marker, ${PROBE_MARKER} entfernen: ${ueberfluessig.join(", ")}`);
  return { exit: unerwartet.length > 0 || ueberfluessig.length > 0 ? 1 : 0, erwartet, unerwartet, ueberfluessig, meldungen };
}

function leseText(pfad) {
  try {
    return readFileSync(pfad, "utf8");
  } catch {
    return null;
  }
}

function leseJson(pfad, was) {
  try {
    return JSON.parse(readFileSync(pfad, "utf8"));
  } catch (e) {
    throw new Error(`${was} fehlt oder ist kein gültiges JSON: ${pfad} (${e instanceof Error ? e.message : e})\nFix: ${was === "Fremd-Config" ? `--fremd <pfad> angeben oder ${PROBE_STANDARD} anlegen` : `${was} im Repo anlegen`}`, { cause: e });
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
export function probe({ wurzel = WURZEL, fremdPfad = PROBE_STANDARD, getrackt = gitGetrackt(wurzel), run = vitestLauf, tempOrdner = tmpdir, env = process.env, ohne = [PROBE_TEST], vitest = join(wurzel, "node_modules", "vitest", "vitest.mjs") } = {}) {
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
    const berichtPfad = join(ordner, "bericht.json");
    const args = [vitest, "run", ...tests, "--reporter=default", "--reporter=json", `--outputFile.json=${berichtPfad}`];
    const r = run({ befehl: process.execPath, args, env: { ...env, [PROBE_ENV]: konfigPfad, [PROBE_WURZEL_ENV]: resolve(wurzel) }, cwd: wurzel });
    const bericht = leseText(berichtPfad);
    const markiert = tests.filter((t) => istMarkiert(leseText(join(wurzel, t))));
    const b = bewerte({ status: r.status, rot: bericht === null ? null : rotePfade(bericht, resolve(wurzel)), markiert });
    return { ...b, konfigPfad, ergaenzt, tests };
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
  for (const m of r.meldungen) out(`fremd-config-probe: ${m}`);
  return r.exit;
}

if (istDirektaufruf(import.meta.url)) process.exitCode = cli(process.argv.slice(2));

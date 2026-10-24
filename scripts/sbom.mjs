#!/usr/bin/env node
/* CycloneDX-SBOM der npm-Abhängigkeiten (#1617, ADR 0022 F15).
 *
 * Werkzeug: `npm sbom` (in npm eingebaut, https://docs.npmjs.com/cli/v10/commands/npm-sbom), Quelle ist
 * das Lockfile (`--package-lock-only`: reproduzierbar, unabhängig von node_modules). Eine reine
 * Umleitung `> datei` hinterließe bei einem Fehler eine leere Datei; darum prüft dieses Skript die
 * Ausgabe, bevor es schreibt, und entfernt vorher eine alte Datei. Dependency-Track bewusst nicht.
 *
 * Aufruf: node scripts/sbom.mjs [--aus <pfad>]   (Standard: sbom/bom.cdx.json)
 * Exit: 0 ok, 1 Erzeugung oder Prüfung fehlgeschlagen, 2 falsche Argumente. */
import { istDirektaufruf } from "./direktaufruf.mjs";
import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { flagsLesen } from "./flag-lib.mjs";

export const NPM_ARGS = ["sbom", "--sbom-format", "cyclonedx", "--sbom-type", "application", "--package-lock-only"];
export const STANDARD_AUS = "sbom/bom.cdx.json";

const istText = (v) => typeof v === "string" && v.trim() !== "";

/** Liefert die Mängel der Ausgabe als Liste; leer = gültig. */
export function pruefeSbom(text) {
  if (typeof text !== "string" || text.trim() === "") return ["Ausgabe ist leer"];
  let bom;
  try {
    bom = JSON.parse(text);
  } catch (err) {
    return [`Ausgabe ist kein gültiges JSON: ${err.message}`];
  }
  const fehler = [];
  if (bom?.bomFormat !== "CycloneDX") fehler.push(`bomFormat ist nicht "CycloneDX" (${JSON.stringify(bom?.bomFormat)})`);
  if (typeof bom?.specVersion !== "string" || !/^1\.\d+$/.test(bom.specVersion)) fehler.push(`specVersion fehlt oder ist unerwartet (${JSON.stringify(bom?.specVersion)})`);
  if (!istText(bom?.metadata?.component?.name)) fehler.push("metadata.component.name fehlt");
  const komponenten = bom?.components;
  if (!Array.isArray(komponenten) || komponenten.length === 0) {
    fehler.push("components fehlt oder ist leer");
    return fehler;
  }
  const unvollstaendig = komponenten.filter((k) => !istText(k?.name) || !istText(k?.version) || !istText(k?.purl));
  if (unvollstaendig.length > 0) fehler.push(`${unvollstaendig.length} Komponente(n) ohne name, version oder purl`);
  return fehler;
}

function parseArgs(argv) {
  const { werte, fehler } = flagsLesen(argv, { aus: { type: "string" } });
  if (fehler) return null;
  if (werte.aus === undefined) return STANDARD_AUS;
  return istText(werte.aus) ? werte.aus : null;
}

/** `io = { lauf, schreibe, entferne, log, fehler }` (`fehler` schreibt auf stderr) ist injizierbar (Tests rufen kein echtes npm). */
export function fuehreAus(argv, io) {
  const aus = parseArgs(argv);
  if (aus === null) {
    io.fehler("Aufruf: node scripts/sbom.mjs [--aus <pfad>]");
    return 2;
  }
  io.entferne(aus);
  const r = io.lauf();
  if (r.error || r.status !== 0) {
    const stderr = String(r.stderr ?? "").split(/\r?\n/).filter(Boolean).slice(0, 5).join("\n");
    io.fehler(`SBOM-Erzeugung fehlgeschlagen (npm ${NPM_ARGS.join(" ")}, Exit ${r.status}${r.error ? `, ${r.error.message}` : ""})${stderr ? `\n${stderr}` : ""}`);
    return 1;
  }
  const fehler = pruefeSbom(r.stdout);
  if (fehler.length > 0) {
    io.fehler(`SBOM ungültig:\n- ${fehler.join("\n- ")}`);
    return 1;
  }
  io.schreibe(aus, r.stdout);
  const bom = JSON.parse(r.stdout);
  const werkzeuge = Array.isArray(bom.metadata?.tools) ? bom.metadata.tools : (bom.metadata?.tools?.components ?? []);
  const tool = werkzeuge.find((c) => c.vendor === "npm" || c.name === "npm")?.version ?? "?";
  io.log(`SBOM ${aus}: CycloneDX ${bom.specVersion}, ${bom.components.length} Komponenten, npm ${tool}`);
  return 0;
}

const echteIo = {
  lauf: () => spawnSync("npm", NPM_ARGS, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, timeout: 120_000, shell: process.platform === "win32" }),
  schreibe: (pfad, text) => {
    mkdirSync(dirname(pfad), { recursive: true });
    writeFileSync(pfad, text);
  },
  entferne: (pfad) => rmSync(pfad, { force: true }),
  log: (z) => console.log(z),
  fehler: (z) => console.error(z),
};

if (istDirektaufruf(import.meta.url)) process.exitCode = fuehreAus(process.argv.slice(2), echteIo);

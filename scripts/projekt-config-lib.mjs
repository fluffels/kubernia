// Lib ohne Direktaufruf-Guard; die Kommandozeile startet scripts/projekt-config.mjs.
/**
 * Projekt-Config (#1611, ADR 0022 F2): Repo, Besitzer und Board-IDs kommen zur Laufzeit aus `.factory/projekt.json`,
 * nicht aus Literalen im Kern. Fehlt die Datei oder ein Pflichtschlüssel, bricht der Lader mit klarer Meldung ab:
 * es gibt bewusst keinen stillen Standardwert. Dieses Modul trägt selbst kein Projektliteral.
 *
 * Kommandozeile (über den Einstieg projekt-config.mjs): `node scripts/projekt-config.mjs [--config <pfad>] <schluessel.pfad>` gibt einen Skalarwert aus
 * (Exit 0), 1 bei fehlender/ungültiger Config oder fehlendem Schlüssel, 2 ohne Schlüssel.
 *
 * Nur Node-Builtins (läuft auch in Workflows ohne `npm ci`).
 */
import { readFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const PROJEKT_CONFIG = ".factory/projekt.json";

const ROOT = fileURLToPath(new URL("../", import.meta.url));

const istText = (v) => typeof v === "string" && v.trim() !== "";
const istPositiv = (v) => Number.isInteger(v) && v > 0;
const istObjekt = (v) => typeof v === "object" && v !== null && !Array.isArray(v);

/** Pur: prüft die geparste Config, gibt die Liste der Fehler zurück (leer = gültig). */
export function pruefeProjektConfig(wert) {
  if (!istObjekt(wert)) return ["Config muss ein JSON-Objekt sein"];
  const fehler = [];
  if (wert.version !== 1) fehler.push("version muss 1 sein");
  if (!istText(wert.repo) || !/^[^/\s]+\/[^/\s]+$/.test(wert.repo)) fehler.push("repo muss die Form owner/name haben");
  const b = wert.board;
  if (!istObjekt(b)) {
    fehler.push("board muss ein Objekt sein");
  } else {
    if (!istText(b.besitzer)) fehler.push("board.besitzer muss ein nicht-leerer String sein");
    if (b.besitzerTyp !== "user" && b.besitzerTyp !== "org") fehler.push('board.besitzerTyp muss "user" oder "org" sein');
    if (!istPositiv(b.nummer)) fehler.push("board.nummer muss eine positive Ganzzahl sein");
    if (!istPositiv(b.statusFeldId)) fehler.push("board.statusFeldId muss eine positive Ganzzahl sein");
    for (const k of ["projectId", "statusFeldNodeId", "todoOptionId"]) {
      if (!istText(b[k])) fehler.push(`board.${k} muss ein nicht-leerer String sein`);
    }
  }
  if (wert.projektliterale !== undefined) {
    if (!istObjekt(wert.projektliterale)) {
      fehler.push("projektliterale muss ein Objekt (Name → String) sein");
    } else {
      for (const [name, lit] of Object.entries(wert.projektliterale)) {
        if (!istText(lit)) fehler.push(`projektliterale.${name} muss ein nicht-leerer String sein`);
      }
    }
  }
  return fehler;
}

/** Liest und prüft die Config; wirft mit Pfad, allen Fehlern und einer „Fix:“-Zeile. */
export function ladeProjektConfig({ rootDir = ROOT, pfad = PROJEKT_CONFIG } = {}) {
  const abs = isAbsolute(pfad) ? pfad : resolve(rootDir, pfad);
  let roh;
  try {
    roh = readFileSync(abs, "utf8");
  } catch {
    throw new Error(`Projekt-Config fehlt oder ist nicht lesbar: ${abs}\nFix: ${PROJEKT_CONFIG} anlegen (Pflichtschlüssel: version, repo, board.*)`);
  }
  let wert;
  try {
    wert = JSON.parse(roh);
  } catch (e) {
    throw new Error(`Projekt-Config ist kein gültiges JSON: ${abs} (${e instanceof Error ? e.message : e})\nFix: JSON-Syntax korrigieren`);
  }
  const fehler = pruefeProjektConfig(wert);
  if (fehler.length) {
    throw new Error(`Projekt-Config ungültig: ${abs}\n- ${fehler.join("\n- ")}\nFix: Pflichtschlüssel in ${PROJEKT_CONFIG} ergänzen bzw. korrigieren`);
  }
  return wert;
}

/** Kommandozeile; gibt den Exit-Code zurück. */
export function cli(argv, { rootDir = ROOT, out = console.log, err = console.error } = {}) {
  const args = [...argv];
  let pfad;
  const ci = args.indexOf("--config");
  if (ci >= 0) {
    pfad = args[ci + 1];
    if (!pfad) {
      err("✖ --config braucht einen Pfad\n\nFix: --config <pfad> angeben oder weglassen");
      return 1;
    }
    args.splice(ci, 2);
  }
  const schluessel = args[0];
  if (!schluessel) {
    err("✖ Schlüssel fehlt\n\nFix: node scripts/projekt-config.mjs [--config <pfad>] <schluessel.pfad>");
    return 2;
  }
  let cfg;
  try {
    cfg = ladeProjektConfig({ rootDir, pfad });
  } catch (e) {
    err(`✖ ${e instanceof Error ? e.message : e}`);
    return 1;
  }
  let wert = cfg;
  for (const teil of schluessel.split(".")) {
    wert = istObjekt(wert) && Object.hasOwn(wert, teil) ? wert[teil] : undefined;
  }
  if (wert === undefined || istObjekt(wert) || Array.isArray(wert)) {
    err(`✖ Schlüssel nicht gefunden oder kein Skalar: ${schluessel}\n\nFix: Schlüssel in ${PROJEKT_CONFIG} prüfen`);
    return 1;
  }
  out(String(wert));
  return 0;
}

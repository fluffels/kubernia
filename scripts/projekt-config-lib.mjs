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

export const BOARD_ROLLEN = ["produkt", "factory"];

/** Pur: prüft ein Board-Objekt; `praefix` ist der Schlüsselpfad für die Fehlermeldungen (z. B. `boards.1.`). */
function pruefeBoard(b, praefix) {
  const fehler = [];
  if (!BOARD_ROLLEN.includes(b.rolle)) fehler.push(`${praefix}rolle muss eine von ${BOARD_ROLLEN.join(", ")} sein`);
  if (!istText(b.besitzer)) fehler.push(`${praefix}besitzer muss ein nicht-leerer String sein`);
  if (b.besitzerTyp !== "user" && b.besitzerTyp !== "org") fehler.push(`${praefix}besitzerTyp muss "user" oder "org" sein`);
  if (!istPositiv(b.nummer)) fehler.push(`${praefix}nummer muss eine positive Ganzzahl sein`);
  if (!istPositiv(b.statusFeldId)) fehler.push(`${praefix}statusFeldId muss eine positive Ganzzahl sein`);
  for (const k of ["projectId", "statusFeldNodeId", "todoOptionId"]) {
    if (!istText(b[k])) fehler.push(`${praefix}${k} muss ein nicht-leerer String sein`);
  }
  return fehler;
}

/** Pur: prüft die Board-Liste (Einzelprüfung, genau eins je Rolle, eindeutige projectId und REST-Pfad). */
function pruefeBoards(boards) {
  if (!Array.isArray(boards) || boards.length === 0) return ["boards muss eine nicht-leere Liste von Board-Objekten sein"];
  const fehler = [];
  const projekte = new Set();
  const pfade = new Set();
  const rollen = new Map();
  boards.forEach((b, i) => {
    if (!istObjekt(b)) {
      fehler.push(`boards.${i} muss ein Objekt sein`);
      return;
    }
    fehler.push(...pruefeBoard(b, `boards.${i}.`));
    if (BOARD_ROLLEN.includes(b.rolle)) rollen.set(b.rolle, (rollen.get(b.rolle) ?? 0) + 1);
    if (istText(b.projectId)) {
      if (projekte.has(b.projectId)) fehler.push(`boards.${i}.projectId kommt mehrfach vor`);
      projekte.add(b.projectId);
    }
    if (istText(b.besitzer) && istPositiv(b.nummer)) {
      const pfad = boardPfad(b);
      if (pfade.has(pfad)) fehler.push(`boards.${i}: Board ${pfad} kommt mehrfach vor`);
      pfade.add(pfad);
    }
  });
  for (const rolle of BOARD_ROLLEN) {
    const n = rollen.get(rolle) ?? 0;
    if (n === 0) fehler.push(`Rolle ${rolle} fehlt in boards (genau ein Board je Rolle)`);
    if (n > 1) fehler.push(`Rolle ${rolle} kommt mehrfach in boards vor (genau ein Board je Rolle)`);
  }
  return fehler;
}

/** Pur: prüft die geparste Config, gibt die Liste der Fehler zurück (leer = gültig). */
export function pruefeProjektConfig(wert) {
  if (!istObjekt(wert)) return ["Config muss ein JSON-Objekt sein"];
  const fehler = [];
  if (wert.version !== 2) fehler.push("version muss 2 sein (Schema mit boards-Liste)");
  if (!istText(wert.repo) || !/^[^/\s]+\/[^/\s]+$/.test(wert.repo)) fehler.push("repo muss die Form owner/name haben");
  fehler.push(...pruefeBoards(wert.boards));
  if (wert.projektliterale !== undefined) {
    if (!istObjekt(wert.projektliterale)) {
      fehler.push("projektliterale muss ein Objekt (Name → String) sein");
    } else {
      for (const [name, lit] of Object.entries(wert.projektliterale)) {
        if (!istText(lit)) fehler.push(`projektliterale.${name} muss ein nicht-leerer String sein`);
      }
    }
  }
  if (wert.spezifikation !== undefined) {
    if (!istObjekt(wert.spezifikation) || !istPositiv(wert.spezifikation.hartAb)) fehler.push("spezifikation.hartAb muss eine positive Ganzzahl sein (Stichtag: Issue-Nummer, ab der das Spezifikations-Gate hart ist)");
  }
  return fehler;
}

/** REST-Pfad des Boards: `users|orgs/<besitzer>/projectsV2/<nummer>`. Pur. */
export function boardPfad(board) {
  return `${board.besitzerTyp === "org" ? "orgs" : "users"}/${board.besitzer}/projectsV2/${board.nummer}`;
}

/** Liest und prüft die Config; wirft mit Pfad, allen Fehlern und einer „Fix:“-Zeile. */
export function ladeProjektConfig({ rootDir = ROOT, pfad = PROJEKT_CONFIG } = {}) {
  const abs = isAbsolute(pfad) ? pfad : resolve(rootDir, pfad);
  let roh;
  try {
    roh = readFileSync(abs, "utf8");
  } catch {
    throw new Error(`Projekt-Config fehlt oder ist nicht lesbar: ${abs}\nFix: ${PROJEKT_CONFIG} anlegen (Pflichtschlüssel: version, repo, boards[])`);
  }
  let wert;
  try {
    wert = JSON.parse(roh);
  } catch (e) {
    throw new Error(`Projekt-Config ist kein gültiges JSON: ${abs} (${e instanceof Error ? e.message : e})\nFix: JSON-Syntax korrigieren`, { cause: e });
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
    if (Array.isArray(wert)) wert = /^(0|[1-9]\d*)$/.test(teil) && Number(teil) < wert.length ? wert[Number(teil)] : undefined;
    else wert = istObjekt(wert) && Object.hasOwn(wert, teil) ? wert[teil] : undefined;
  }
  if (wert === undefined || istObjekt(wert) || Array.isArray(wert)) {
    err(`✖ Schlüssel nicht gefunden oder kein Skalar: ${schluessel}\n\nFix: Schlüssel in ${PROJEKT_CONFIG} prüfen`);
    return 1;
  }
  out(String(wert));
  return 0;
}
